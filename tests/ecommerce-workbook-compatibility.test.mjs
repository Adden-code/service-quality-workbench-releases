import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import {workbook,readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {EC_HEADERS,EC_RULE_IDS,validateEcommerceRecord,validateEcommerceSource,ecommerceRecordId,ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {timeJudgment,inspectEcommerceBatch} from '../server/ecommerce-engine.mjs';
import {createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';

const now='2026-11-05T09:00:00+08:00';
const raw=()=>['欧洲','2026-11','西欧','虚构国家','00001','00002','00003','虚构产品','COMMENT_ONLY','REPLY_ONLY','5','虚构管理员','46325.833333333336','46326.833333333336','PRIVATE_TYPE',...Array(6).fill('PRIVATE_HUMAN'),'PRIVATE_ISSUE'];
const realHeaders=()=>{const h=[...EC_HEADERS];h[2]='Region\n区域';h[10]='grade\n评分';h[14]='Comment Types\nPositive Good:4-5 points\n评价类型\n好评正向：4-5分';return h;};
const extHeaders=['产品系列','质检人','质检时间'];
const extStandards=['PRIVATE_EXT_CRITERION','保留原文','PRIVATE_EXT_TIME_CRITERION'];
const extValues=['PRIVATE_EXT_PRODUCT','PRIVATE_EXT_REVIEWER','PRIVATE_EXT_TIME'];
const sheet=(name='Sheet1',{headers=realHeaders(),extensions=[],standards=Array(22).fill(''),rows=[raw()],rowNumbers}={})=>({name,headers:[...headers,...extensions],rows:[standards,...rows],...(rowNumbers?{rowNumbers}:{})});
const asFile=bytes=>new File([bytes],'生成兼容性测试.xlsx');
const parse=(bytes,options)=>parseEcommerceFile(asFile(bytes),options);
const expectValid=p=>{assert.equal(p.valid,true,p.errors.join('；'));return p;};

test('real Grade, Comment Types and Region bilingual labels work in core positions and preserve original text',async()=>{
 const p=expectValid(await parse(await workbook([sheet()]))),r=p.sessions[0].ecommerce;
 assert.deepEqual(r.headers,realHeaders());assert.equal(r.sheet,'Sheet1');assert.equal(r.sheetIndex,1);assert.equal(r.schemaVersion,3);
 assert.deepEqual(r.extensions,{headers:[],standards:[],raw:[]});assert.deepEqual(r.raw,raw());
 assert.equal(p.selectedSheet,'Sheet1');assert.deepEqual(p.availableSheetNames,['Sheet1']);
 assert.match(p.sessions[0].id,/-S1-3$/);assert.equal(ecommerceRecordId(r),p.sessions[0].id);
 assert.deepEqual(r.normalizedTimes,{commentTime:'2026-10-30T20:00:00+08:00',replyTime:'2026-10-31T20:00:00+08:00'});
 assert.equal(timeJudgment(p.sessions[0]).verdict,'符合');assert.equal(validateEcommerceSource(p.sessions[0]),true);
});

test('NFKC, Chinese-first aliases and explanations map by headers with cross-column labels rejected',async()=>{
 const headers=realHeaders();headers[2]='区域\nＲｅｇｉｏｎ';headers[10]='评分 ＧＲＡＤＥ';headers[14]='评价类型\nＣｏｍｍｅｎｔ　Ｔｙｐｅｓ\n说明：只保留历史分类';
 expectValid(await parse(await workbook([sheet('中文 源表',{headers})])));
 const swapped=[...headers];swapped[2]='区域';[swapped[8],swapped[9]]=[swapped[9],swapped[8]];const reordered=expectValid(await parse(await workbook([sheet('乱序表',{headers:swapped})])));assert.equal(reordered.sessions[0].ecommerce.raw[8],raw()[9]);assert.equal(reordered.sessions[0].ecommerce.raw[9],raw()[8]);
 for(const change of [h=>h[2]='Country 国家',h=>h[10]='Grade Rating Country',h=>h[14]='Comment Time',h=>h.splice(21,1)]){
  const h=[...headers];change(h);const p=await parse(await workbook([sheet('错误表',{headers:h})]));assert.equal(p.valid,false);assert.deepEqual(p.sessions,[]);assert.match(p.errors.join('；'),/表头|顺序|22|列/);
 }
});

test('detects matching worksheets by structure and requires explicit selection for ambiguity',async()=>{
 const bytes=await workbook([{name:'说明',headers:['说明'],rows:[['PRIVATE_IGNORED']]},sheet('中文 源表'),sheet('Other Data')]);
 const pending=await parse(bytes);assert.equal(pending.valid,false);assert.deepEqual(pending.sessions,[]);assert.deepEqual(pending.availableSheetNames,['中文 源表','Other Data']);assert.equal(pending.selectedSheet,null);assert.match(pending.errors.join('；'),/选择.*工作表/);
 const first=expectValid(await parse(bytes,{selectedSheet:'中文 源表'})),second=expectValid(await parse(bytes,{selectedSheet:'Other Data'}));
 assert.equal(first.sessions[0].ecommerce.sheetIndex,2);assert.equal(second.sessions[0].ecommerce.sheetIndex,3);assert.notEqual(first.sessions[0].id,second.sessions[0].id);
 assert.match(first.sessions[0].id,/-S2-3$/);assert.match(second.sessions[0].id,/-S3-3$/);
 const invalid=await parse(bytes,{selectedSheet:'说明'});assert.equal(invalid.valid,false);assert.match(invalid.errors.join('；'),/选择|工作表/);
 const only=expectValid(await parse(await workbook([{name:'说明',headers:['说明'],rows:[['x']]},sheet('中文 源表')])));assert.equal(only.selectedSheet,'中文 源表');assert.equal(only.sessions[0].ecommerce.sheetIndex,2);
});

test('workbook declaration order controls numeric worksheet indexes and names are preserved as data',async()=>{
 const bytes=await workbook([sheet('10'),sheet('2'),sheet('中文 <源表> & "')]);
 const p=expectValid(await parse(bytes,{selectedSheet:'2'}));assert.deepEqual(p.availableSheetNames,['10','2','中文 <源表> & "']);assert.equal(p.selectedSheetIndex,2);assert.equal(p.sessions[0].ecommerce.sheetIndex,2);
 const escaped=expectValid(await parse(bytes,{selectedSheet:'中文 <源表> & "'}));assert.equal(escaped.sessions[0].ecommerce.sheet,'中文 <源表> & "');assert.equal(escaped.selectedSheetIndex,3);
 for(const maxColumns of [0,1.5,16385,'100',null,Infinity])await assert.rejects(readXlsx(bytes,{maxColumns}),/1至16384|整数/);
});

test('source worksheet metadata is closed, agrees with v3 records and preserves later-position legacy Sheet4',async()=>{
 const bytes=await workbook([{name:'说明',headers:['说明'],rows:[]},sheet('Sheet4',{headers:[...EC_HEADERS]})]),p=expectValid(await parse(bytes));
 const catalog=ensureEcommerceCatalog(createBusinessCatalog(),{now}),basisSnapshot=createBasisSnapshot(catalog,{ruleIds:EC_RULE_IDS,effectiveDate:'2026-11-05',now});
 const source={name:'fixture.xlsx',size:bytes.length,sha256:p.sessions[0].ecommerce.fileSha256,worksheet:{name:p.selectedSheet,index:p.selectedSheetIndex}};
 const create=(sessions=p.sessions,s=source)=>createImportedTask(createBusinessState(),{name:'来源任务',sessions,source:s,basisSnapshot,reviewer:'虚构审核人',now});
 const state=create();assert.equal(validateWorkspace(state,catalog),true);assert.deepEqual(state.tasks[0].source.worksheet,{name:'Sheet4',index:2});const frozen=createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now});assert.deepEqual(frozen.sourceSheet,{name:'Sheet4',index:2});
 for(const worksheet of [{name:'Other',index:2},{name:'Sheet4',index:0},{name:'Sheet4',index:16385},{name:'Sheet4',index:2,extra:true}])assert.throws(()=>create(p.sessions,{...source,worksheet}),/工作表|来源/);
 const renamed=expectValid(await parse(await workbook([sheet('数据表')])));const sourceV3={...source,sha256:renamed.sessions[0].ecommerce.fileSha256,worksheet:{name:'数据表',index:2}};assert.throws(()=>create(renamed.sessions,sourceV3),/工作表|来源/);
 const changed=structuredClone(state);changed.tasks[0].source.worksheet.name='Other';assert.throws(()=>validateWorkspace(changed,catalog,state),/工作表|来源|原文件/);
 const old=structuredClone(state);delete old.tasks[0].source.worksheet;assert.equal(validateWorkspace(old,catalog),true);assert.deepEqual(createBusinessDeliverySnapshot(old,{taskId:old.tasks[0].id,now}).sourceSheet,{name:'Sheet4',index:null});
});

test('22+N retains positional blank/duplicate headers, standards and sparse rows while empty styled tails are ignored',async()=>{
 const headers=[...extHeaders,'','产品系列'],values=[...extValues,'INTERNAL_BLANK_HEADER_VALUE','DUPLICATE_VALUE'];
 const bytes=await workbook([sheet('业务 数据',{extensions:headers,standards:[...Array(22).fill(''),...extStandards,'',''],rows:[[...raw(),...values]],rowNumbers:[2,27]})]);
 const zip=await JSZip.loadAsync(bytes);zip.file('xl/worksheets/sheet1.xml',(await zip.file('xl/worksheets/sheet1.xml').async('string')).replace(/<\/row>/g,'<c r="XFD$ROW" s="1"/></row>').replace(/<row r="(\d+)"[\s\S]*?<\/row>/g,(v,r)=>v.replace('$ROW',r)));
 const p=expectValid(await parse(await zip.generateAsync({type:'uint8array'}))),r=p.sessions[0].ecommerce;
 assert.equal(r.row,27);assert.deepEqual(r.extensions,{headers,standards:[...extStandards,'',''],raw:values});assert.deepEqual(r.raw,raw());assert.match(p.sessions[0].id,/-S1-27$/);
 assert.doesNotMatch(JSON.stringify({turns:p.sessions[0].turns,fields:p.sessions[0].contextFields}),/PRIVATE|INTERNAL|DUPLICATE/);
 assert.ok(p.warnings.some(w=>/表头|空|重复/.test(w)));
});

test('ordinary Sheet4 N0 keeps v2 shape and stable legacy identifiers even at a later sheet position',async()=>{
 const p=expectValid(await parse(await workbook([{name:'说明',headers:['说明'],rows:[]},sheet('Sheet4',{headers:[...EC_HEADERS]})]))),r=p.sessions[0].ecommerce;
 assert.equal(r.schemaVersion,2);assert.equal(r.sheetIndex,undefined);assert.equal(r.extensions,undefined);assert.match(p.sessions[0].id,/-Sheet4-3$/);
 const legacy={schemaVersion:1,sheet:'Sheet4',row:3,fileSha256:r.fileSha256,headers:[...EC_HEADERS],standards:[...r.standards],raw:[...r.raw],thresholdHours:24};assert.equal(validateEcommerceRecord(legacy),true);assert.equal(ecommerceRecordId(legacy),p.sessions[0].id);
 const withExtensions=expectValid(await parse(await workbook([sheet('Sheet4',{extensions:['产品系列'],rows:[[...raw(),'PRIVATE_EXT']]})])));assert.equal(withExtensions.sessions[0].ecommerce.schemaVersion,3);assert.match(withExtensions.sessions[0].id,/-S1-3$/);
});

test('v3 is a closed bounded schema with no coercion or inconsistent extension lengths',async()=>{
 const r=expectValid(await parse(await workbook([sheet('源表',{extensions:extHeaders,rows:[[...raw(),...extValues]]})]))).sessions[0].ecommerce;
 assert.equal(validateEcommerceRecord(r),true);
 for(const change of [r=>r.extra=true,r=>r.sheet='',r=>r.sheet=' '.repeat(2),r=>r.sheet='s'.repeat(81),r=>r.sheetIndex=0,r=>r.sheetIndex=1.2,r=>r.sheetIndex=16385,r=>r.extensions.extra=[],r=>r.extensions.headers.pop(),r=>r.extensions.raw[0]=12,r=>r.extensions.standards[0]='x'.repeat(20001),r=>r.normalizedTimes.commentTime=null,r=>r.schemaVersion=2]){
  const bad=structuredClone(r);change(bad);assert.throws(()=>validateEcommerceRecord(bad));
 }
 const tooWide=structuredClone(r);tooWide.extensions={headers:Array(16342).fill(''),standards:Array(16342).fill(''),raw:Array(16342).fill('')};assert.throws(()=>validateEcommerceRecord(tooWide),/列|16384/);
});

test('readXlsx and parser retain extensions beyond100 within a declared bounded range and reject unsafe output width',async()=>{
 const extensions=Array.from({length:100},(_,i)=>`附列${i}`),values=extensions.map((_,i)=>`PRIVATE_EXT_${i}`),bytes=await workbook([sheet('Wide',{extensions,rows:[[...raw(),...values]]})]);
 await assert.rejects(readXlsx(bytes),/列/);const p=expectValid(await parse(bytes));assert.deepEqual(p.sessions[0].ecommerce.extensions.raw,values);
 const catalog=ensureEcommerceCatalog(createBusinessCatalog(),{now}),basisSnapshot=createBasisSnapshot(catalog,{ruleIds:EC_RULE_IDS,effectiveDate:'2026-11-05',now}),state=createImportedTask(createBusinessState(),{name:'宽表测试',sessions:p.sessions,source:{name:'wide.xlsx',size:bytes.length,sha256:p.sessions[0].ecommerce.fileSha256},basisSnapshot,reviewer:'虚构审核人',now});const frozen=createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now});
 for(const language of ['zh','en']){const tables=await readXlsx(await buildBusinessDeliveryXlsx(frozen,{}, {language}),{maxColumns:16384}),main=tables[language==='en'?'Inspection Details':'检核明细'];assert.equal(main[0].length,143);assert.deepEqual(main[2].slice(43),values);}
 const zip=await JSZip.loadAsync(await workbook([sheet()]));zip.file('xl/worksheets/sheet1.xml',(await zip.file('xl/worksheets/sheet1.xml').async('string')).replace('</sheetData>','<row r="4"><c r="XFD4" t="inlineStr"><is><t>OUTSIDE_SAFE_EXTENT</t></is></c></row></sheetData>'));
 const bad=await parse(await zip.generateAsync({type:'uint8array'}));assert.equal(bad.valid,false);assert.deepEqual(bad.sessions,[]);assert.match(bad.errors.join('；'),/列|16384/);
});

test('import→workspace source save→quality request→snapshot→Chinese and English exports keeps core43 indexes and original extras',async t=>{
 const base='D:/Codex project/outputs/service-real-defects-20261105/BCD';await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/store-');
 const bytes=await workbook([sheet('业务 数据',{extensions:extHeaders,standards:[...Array(22).fill(''),...extStandards],rows:[[...raw(),...extValues]],rowNumbers:[2,27]})]),p=expectValid(await parse(bytes));
 let store=await createWorkspaceStore({dataDir:dir});t.after(async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true});});const source={...await store.putSource(bytes,'生成兼容性测试.xlsx'),worksheet:{name:p.selectedSheet,index:p.selectedSheetIndex}};
 const catalog=ensureEcommerceCatalog(createBusinessCatalog(),{now}),basisSnapshot=createBasisSnapshot(catalog,{ruleIds:EC_RULE_IDS,effectiveDate:'2026-11-05',now});
 const state=createImportedTask(createBusinessState(),{name:'兼容性任务',fileName:source.name,sessions:p.sessions,source,basisSnapshot,reviewer:'虚构审核人',now});
 assert.equal(validateWorkspace(state,catalog),true);await store.save({state,catalog,baseRevision:0,mutationId:'compat-save'});await store.close();store=await createWorkspaceStore({dataDir:dir});const saved=(await store.read()).state;assert.deepEqual(saved.sessions[0].ecommerce,p.sessions[0].ecommerce);assert.deepEqual(saved.tasks[0].source.worksheet,source.worksheet);
 let sent;const client=createArkClient({fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'合成兼容性检查',evidence:[1,2],referenceIds:[]}))})}}]}));}});
 const session=saved.sessions[0],quality=await client.inspectEcommerceRow({config:{apiKey:'fixture-only-key'},session,basis:basisSnapshot});assert.equal(quality.results.length,4);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE|extensions|raw|INTERNAL/);
 const traces={};await inspectEcommerceBatch({sessions:[session],basis:basisSnapshot,config:{model:'fixture'},trace:{step:async(id,input,operation)=>{traces[id]=structuredClone(input);return operation();}},client:{inspectEcommerce:async()=>({records:[{sessionId:session.id,results:quality.results}],duplicateGroups:[],modelId:'fixture'})}});assert.equal(traces.deterministic.sessions[0].dateSystem,'1900');assert.deepEqual(traces.deterministic.sessions[0].normalizedTimes,session.ecommerce.normalizedTimes);assert.doesNotMatch(JSON.stringify(traces.deterministic),/PRIVATE_EXT/);
 const forged=structuredClone(session);forged.contextFields.push({key:'extra',label:'额外',type:'text',value:extValues[0],source:{sheet:'业务 数据',row:27,column:extHeaders[0]}});assert.throws(()=>validateEcommerceSource(forged),/投影|模型字段/);
 const unknown=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'合成检查',evidence:[1],referenceIds:['UNKNOWN-REFERENCE']}))})}}]}))});await assert.rejects(unknown.inspectEcommerceRow({config:{apiKey:'fixture-only-key'},session,basis:basisSnapshot}),error=>error.code==='INVALID_OUTPUT');
 session.aiExecution={status:'completed',runId:'compat-ai'};session.aiResults=[timeJudgment(session),...quality.results];
 const snap=createBusinessDeliverySnapshot(saved,{taskId:saved.tasks[0].id,now});assert.equal(snap.sourceSheet.name,'业务 数据');assert.equal(snap.sourceSheet.index,1);assert.deepEqual(snap.extensions,{headers:extHeaders,standards:extStandards});assert.deepEqual(snap.records[0].extensionValues,extValues);
 await fs.writeFile(`${base}/compatibility-input.xlsx`,bytes);await fs.writeFile(`${base}/compatibility-snapshot.json`,JSON.stringify(snap,null,2));await fs.writeFile(`${base}/compatibility-model-request.json`,JSON.stringify(sent,null,2));
 const fields=collectReportTranslationFields(snap,{});assert.ok(fields.some(f=>f.text==='产品系列'));assert.ok(fields.every(f=>!extValues.includes(f.text)&&!extStandards.includes(f.text)));
 for(const language of ['zh','en']){
  const output=await buildBusinessDeliveryXlsx(snap,{}, {language});const tables=await readXlsx(output),main=tables[language==='en'?'Inspection Details':'检核明细'];assert.equal(main[0].length,46);assert.deepEqual(main[0].slice(0,22),realHeaders());assert.deepEqual(main[0].slice(43),extHeaders);assert.deepEqual(main[1].slice(43),extStandards);
  const row=main.find(r=>r[XLSX_ROW_NUMBER]===27);assert.deepEqual(row.slice(0,22),raw());assert.deepEqual(row.slice(43),extValues);assert.equal(row[24],language==='en'?'Pass':'通过');assert.equal(row[41],language==='en'?'Pass':'通过');assert.equal(row[42],'');
  assert.ok(tables[language==='en'?'Methodology':'口径说明'].flat().includes('业务 数据'));assert.ok(tables[language==='en'?'Field Guide':'字段说明'].some(r=>r[0]==='44'&&r[1]==='产品系列'));
  const html=buildBusinessReportHtml(snap,{}, {language});assert.ok(html.includes('业务 数据'));await fs.writeFile(`${base}/compatibility-${language}.html`,html);
  await fs.writeFile(`${base}/compatibility-${language}.xlsx`,output);
 }
 const bad=structuredClone(saved);bad.sessions.push(structuredClone(session));const next=bad.sessions[1];next.id+='-2';next.ecommerce.sheet='另表';next.ecommerce.sheetIndex=2;next.ecommerce.row=28;assert.throws(()=>createBusinessDeliverySnapshot(bad,{taskId:bad.tasks[0].id,now}),/工作表|表头|来源/);
 const mismatch=structuredClone(saved);mismatch.sessions.push(structuredClone(session));mismatch.sessions[1].id+='-2';mismatch.sessions[1].ecommerce.row=28;mismatch.sessions[1].ecommerce.extensions.headers[0]='不同表头';assert.throws(()=>createBusinessDeliverySnapshot(mismatch,{taskId:mismatch.tasks[0].id,now}),/扩展|表头|来源/);
});
