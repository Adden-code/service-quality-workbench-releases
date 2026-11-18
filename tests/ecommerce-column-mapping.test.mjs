import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import JSZip from 'jszip';
import {workbook,readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {EC_HEADERS,EC_RULE_IDS,validateEcommerceRecord,validateEcommerceSources,validateEcommerceSource,ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {inspectEcommerceBatch,timeJudgment} from '../server/ecommerce-engine.mjs';
import {createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';

const now='2026-11-06T09:00:00+08:00';
const core=Array.from({length:22},(_,i)=>i);
const layouts={front:['x0','x1','x2',...core],interleaved:[0,'x0',1,2,3,4,'x1',...core.slice(5,15),'x2',...core.slice(15)],tail:[...core,'x0','x1','x2'],shuffled:[9,2,'x0',12,21,0,7,14,'x1',4,13,8,6,18,1,20,10,5,19,3,15,11,'x2',17,16]};
const extraHeaders=['PRIVATE_EXTENSION_A','','PRIVATE_EXTENSION_A'];
const extraStandards=['PRIVATE_STANDARD_A','PRIVATE_STANDARD_B','PRIVATE_STANDARD_C'];
const extraValues=['PRIVATE_EXTRA_A','PRIVATE_EXTRA_B','PRIVATE_EXTRA_C'];
const raw=(row=3,dateSystem='1900')=>['GROUP_'+row,'PERIOD_'+row,'REGION_'+row,'COUNTRY_'+row,'0000'+row,'0001'+row,'0002'+row,'PRODUCT_'+row,'COMMENT_'+row,'REPLY_'+row,'5','ADMIN_'+row,dateSystem==='1904'?'44863.833333333336':'46325.833333333336',dateSystem==='1904'?'44864.833333333336':'46326.833333333336','PRIVATE_EVALUATION',...Array.from({length:7},(_,i)=>'PRIVATE_HISTORY_'+i)];
const standards=core.map(i=>'CORE_STANDARD_'+i);
const mapped=(layout,values,extras)=>layout.map(i=>typeof i==='number'?values[i]:extras[Number(i.slice(1))]);
const expectedMap=layout=>({core:core.map(i=>layout.indexOf(i)+1),extensions:layout.flatMap((i,p)=>typeof i==='string'?[p+1]:[])});
const asFile=bytes=>({name:'生成映射测试.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
const parse=bytes=>parseEcommerceFile(asFile(bytes));
const valid=p=>{assert.equal(p.valid,true,p.errors.join('；'));return p;};
async function bytesFor(layout=layouts.front,{headers=[...EC_HEADERS],dateSystem='1900',rows=[3,7,27],styled=false}={}){
 const bytes=await workbook([{name:'来源 数据',headers:mapped(layout,headers,extraHeaders),rows:[mapped(layout,standards,extraStandards),...rows.map(row=>mapped(layout,raw(row,dateSystem),extraValues))],rowNumbers:[2,...rows]}]);
 if(dateSystem==='1900'&&!styled)return bytes;
 const zip=await JSZip.loadAsync(bytes);
 if(dateSystem==='1904')zip.file('xl/workbook.xml',(await zip.file('xl/workbook.xml').async('string')).replace('<sheets>','<workbookPr date1904="1"/><sheets>'));
 if(styled)zip.file('xl/worksheets/sheet1.xml',(await zip.file('xl/worksheets/sheet1.xml').async('string')).replace(/(<row r="(\d+)"[^>]*>[\s\S]*?)<\/row>/g,(_,body,row)=>`${body}<c r="XFD${row}" s="1"/></row>`));
 return zip.generateAsync({type:'uint8array'});
}
function stateFor(parsed,source){
 const catalog=ensureEcommerceCatalog(createBusinessCatalog(),{now}),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-06',ruleIds:EC_RULE_IDS,now});
 return{catalog,basisSnapshot,state:createImportedTask(createBusinessState(),{name:'任意源列映射',sessions:parsed.sessions,source:source??{name:'生成映射测试.xlsx',size:1,sha256:parsed.sessions[0].ecommerce.fileSha256,worksheet:{name:parsed.selectedSheet,index:parsed.selectedSheetIndex}},basisSnapshot,reviewer:'虚构审核人',now})};
}

for(const [name,layout]of Object.entries(layouts))test(`${name} source layout preserves semantic core22, extra relative order, row2 criteria and sparse physical rows`,async()=>{
 const p=valid(await parse(await bytesFor(layout,{styled:true}))),map=expectedMap(layout);
 for(const [i,s]of p.sessions.entries()){
  const r=s.ecommerce;assert.deepEqual(r.raw,raw([3,7,27][i]));assert.equal(r.raw[8],'COMMENT_'+r.row);assert.equal(r.row,[3,7,27][i]);
  assert.deepEqual(r.headers,EC_HEADERS);assert.deepEqual(r.standards,standards);assert.deepEqual(r.extensions,{headers:extraHeaders,standards:extraStandards,raw:extraValues});
  assert.equal(r.schemaVersion,name==='tail'?3:4);assert.deepEqual(r.sourceColumns,name==='tail'?undefined:map);
  assert.deepEqual(r.normalizedTimes,{commentTime:'2026-10-30T20:00:00+08:00',replyTime:'2026-10-31T20:00:00+08:00'});assert.equal(timeJudgment(s).verdict,'符合');
  assert.equal(validateEcommerceSource(s),true);assert.equal(typeof s.contextFields[0].source.column,'string');assert.equal(s.contextFields[0].source.column,EC_HEADERS[0]);
  assert.ok(s.contextFields.every(f=>!Object.hasOwn(f.source,'columnIndex')));assert.doesNotMatch(JSON.stringify({turns:s.turns,contextFields:s.contextFields}),/PRIVATE_/);
 }
 assert.ok(p.warnings.some(w=>/空标签|重复标签/.test(w)));
});

test('mapped Excel1904 times retain their original serials and deterministic trace provenance',async()=>{
 const p=valid(await parse(await bytesFor(layouts.interleaved,{dateSystem:'1904',rows:[27]}))),s=p.sessions[0];assert.deepEqual(s.ecommerce.raw,raw(27,'1904'));assert.equal(s.ecommerce.dateSystem,'1904');
 assert.equal(s.ecommerce.normalizedTimes.commentTime,'2026-10-30T20:00:00+08:00');const traces={};
 await inspectEcommerceBatch({sessions:[s],basis:stateFor(p).basisSnapshot,config:{model:'fixture'},trace:{step:async(id,input,operation)=>{traces[id]=input;return operation();}},client:{inspectEcommerce:async()=>({records:[{sessionId:s.id,results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'生成判定',evidence:[1,2],referenceIds:[]}))}],duplicateGroups:[],modelId:'fixture'})}});
 assert.equal(traces.deterministic.sessions[0].dateSystem,'1904');assert.deepEqual(traces.deterministic.sessions[0].normalizedTimes,s.ecommerce.normalizedTimes);
});

test('identical bilingual Region aliases use only demonstrable legacy relative core order with a warning',async()=>{
 const headers=[...EC_HEADERS];headers[0]='区域\nRegion';headers[2]='区域\nRegion';
 const p=valid(await parse(await bytesFor(layouts.interleaved,{headers})));assert.deepEqual(p.sessions[0].ecommerce.raw,raw());assert.match(p.warnings.join('；'),/Region.*相对顺序|相对顺序.*Region/);
 const explained=[...EC_HEADERS];explained[0]=explained[2]='Region\n区域（业务说明）';const explainedLegacy=valid(await parse(await bytesFor(layouts.interleaved,{headers:explained})));assert.deepEqual(explainedLegacy.sessions[0].ecommerce.raw,raw());assert.match(explainedLegacy.warnings.join('；'),/原相对顺序/);
 const ambiguous=await parse(await bytesFor(layouts.shuffled,{headers}));assert.equal(ambiguous.valid,false);assert.deepEqual(ambiguous.sessions,[]);assert.match(ambiguous.errors.join('；'),/Region|区域/);assert.match(ambiguous.errors.join('；'),/歧义|无法唯一|明确/);
 const legacy=[...EC_HEADERS];legacy[0]='区域\nRegion';legacy[2]='Region';const retained=valid(await parse(await bytesFor(layouts.front,{headers:legacy})));assert.deepEqual(retained.sessions[0].ecommerce.raw,raw());assert.match(retained.warnings.join('；'),/原相对顺序/);
});

test('swapping only the two distinct canonical Region columns follows unique headers instead of guessing legacy order',async()=>{
 const layout=[...core];[layout[0],layout[2]]=[layout[2],layout[0]];const bytes=await workbook([{name:'Sheet4',headers:layout.map(index=>EC_HEADERS[index]),rows:[layout.map(index=>standards[index]),layout.map(index=>raw()[index])]}]),p=valid(await parse(bytes));assert.equal(p.sessions[0].ecommerce.schemaVersion,4);assert.deepEqual(p.sessions[0].ecommerce.raw,raw());assert.deepEqual(p.sessions[0].ecommerce.sourceColumns,{core:[3,2,1,...core.slice(3).map(i=>i+1)],extensions:[]});
 assert.equal(p.sessions[0].contextFields.find(f=>f.key==='regionGroup').value,'GROUP_3');assert.equal(p.sessions[0].contextFields.find(f=>f.key==='region').value,'REGION_3');const {state}=stateFor(p),snapshot=createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now});for(const language of ['zh','en']){const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,{}, {language})),line=tables[language==='en'?'Inspection Details':'检核明细'][2];assert.equal(line[0],'GROUP_3');assert.equal(line[2],'REGION_3');}
});

for(const [kind,suffix]of [['parenthesized','（业务说明）'],['direct prose','业务说明：保留原始区域值'],['bilingual explanation','\n说明：original region value / 原始区域值']])test(`canonical Region pair with ${kind} keeps its identity when only the two columns are swapped`,async()=>{
 const headers=[...EC_HEADERS];headers[0]=`Region\n区域${suffix}`;headers[2]=`区域${suffix}`;const layout=[...core];[layout[0],layout[2]]=[layout[2],layout[0]];
 const bytes=await workbook([{name:'Sheet4',headers:layout.map(index=>headers[index]),rows:[layout.map(index=>standards[index]),layout.map(index=>raw()[index])]}]),p=valid(await parse(bytes)),s=p.sessions[0];assert.equal(s.ecommerce.schemaVersion,4);assert.deepEqual(s.ecommerce.raw,raw());assert.deepEqual(s.ecommerce.headers,headers);assert.deepEqual(s.ecommerce.sourceColumns,{core:[3,2,1,...core.slice(3).map(i=>i+1)],extensions:[]});
 assert.equal(s.contextFields.find(f=>f.key==='regionGroup').value,'GROUP_3');assert.equal(s.contextFields.find(f=>f.key==='regionGroup').source.column,headers[0]);assert.equal(s.contextFields.find(f=>f.key==='region').value,'REGION_3');assert.equal(s.contextFields.find(f=>f.key==='region').source.column,headers[2]);
 const {state}=stateFor(p),snapshot=createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now});for(const language of ['zh','en']){const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,{}, {language})),main=tables[language==='en'?'Inspection Details':'检核明细'];assert.equal(main[0][0],headers[0]);assert.equal(main[0][2],headers[2]);assert.equal(main[2][0],'GROUP_3');assert.equal(main[2][2],'REGION_3');}
});

for(const region of ['Region','区域\nRegion'])test(`ordered legacy partial Region pair 区域 / ${region.replaceAll('\n',' ')} keeps its original mapping and schema`,async()=>{
 const headers=[...EC_HEADERS];headers[0]='区域';headers[2]=region;
 for(const [layout,version]of [[core,2],[layouts.tail,3],[layouts.front,4]]){
  const bytes=await workbook([{name:'Sheet4',headers:mapped(layout,headers,extraHeaders),rows:[mapped(layout,standards,extraStandards),mapped(layout,raw(),extraValues)]}]),p=valid(await parse(bytes)),s=p.sessions[0];assert.equal(s.ecommerce.schemaVersion,version);assert.deepEqual(s.ecommerce.raw,raw());assert.deepEqual(s.ecommerce.headers,headers);assert.deepEqual(s.ecommerce.sourceColumns,version===4?expectedMap(layout):undefined);assert.match(s.id,version===2?/-Sheet4-3$/:/-S1-3$/);assert.match(p.warnings.join('；'),/原相对顺序/);assert.equal(s.contextFields.find(f=>f.key==='regionGroup').value,'GROUP_3');assert.equal(s.contextFields.find(f=>f.key==='region').value,'REGION_3');
 }
});

test('partially canonical and identical explained Region aliases remain ambiguous after a genuine core reorder',async()=>{
 for(const [first,third]of [['区域','Region'],['区域','区域\nRegion'],['Region 区域','区域\nRegion'],['Region\n区域（业务说明）','Region\n区域（业务说明）']]){
  const headers=[...EC_HEADERS];headers[0]=first;headers[2]=third;const p=await parse(await bytesFor(layouts.shuffled,{headers,rows:[3]}));assert.equal(p.valid,false);assert.deepEqual(p.sessions,[]);assert.match(p.errors.join('；'),/歧义|无法唯一/);
 }
});

test('Region priority never resolves ambiguous duplicate candidates of unrelated core fields',async()=>{
 const headers=[...EC_HEADERS];headers[3]='Country（业务说明）';const p=await parse(await workbook([{name:'Sheet4',headers:[...headers,'国家级政策'],rows:[Array(23).fill(''),[...raw(),'PRIVATE_POLICY']]}]));assert.equal(p.valid,false);assert.deepEqual(p.sessions,[]);assert.match(p.errors.join('；'),/国家.*重复|国家.*冲突/);
});

test('an existing Region bilingual alias owned by only one core field permits a uniquely proven reordered assignment',async()=>{
 const headers=[...EC_HEADERS];headers[0]='Region 区域 Region（业务说明）';const layout=[...core];[layout[0],layout[2]]=[layout[2],layout[0]];const bytes=await workbook([{name:'Sheet4',headers:layout.map(index=>headers[index]),rows:[layout.map(index=>standards[index]),layout.map(index=>raw()[index])]}]),p=valid(await parse(bytes));assert.deepEqual(p.sessions[0].ecommerce.raw,raw());assert.equal(p.sessions[0].ecommerce.schemaVersion,4);assert.equal(p.sessions[0].contextFields.find(field=>field.key==='regionGroup').value,'GROUP_3');assert.equal(p.sessions[0].contextFields.find(field=>field.key==='region').value,'REGION_3');
});

test('500 mapped rows with20 long explanatory headers retain source evidence within a bounded import time',async()=>{
 const headers=EC_HEADERS.map((header,index)=>[0,2].includes(index)?header:header+' 说明：'+'x'.repeat(19000)),layout=['x0',...core],bytes=await workbook([{name:'Sheet4',headers:mapped(layout,headers,extraHeaders),rows:[Array(23).fill(''),...Array.from({length:500},(_,i)=>mapped(layout,raw(i+3),extraValues))]}]);
 const start=performance.now(),p=valid(await parse(bytes)),elapsed=performance.now()-start;assert.equal(p.sessions.length,500);assert.deepEqual(p.sessions[0].ecommerce.raw,raw(3));assert.deepEqual(p.sessions[499].ecommerce.raw,raw(502));assert.deepEqual(p.sessions[0].ecommerce.headers,headers);assert.ok(elapsed<10000,`500-row mapped import took ${Math.round(elapsed)}ms (budget 10000ms)`);
});

test('reused header analysis never skips mutations to existing header arrays or source map objects',async()=>{
 const p=valid(await parse(await bytesFor(layouts.shuffled,{rows:[3]}))),record=p.sessions[0].ecommerce;assert.equal(validateEcommerceRecord(record),true);
 const prior=record.headers[8];record.headers[8]='Country';assert.throws(()=>validateEcommerceRecord(record),/评论内容|国家|缺失|冲突/);record.headers[8]=prior;assert.equal(validateEcommerceRecord(record),true);
 const priorExtra=record.extensions.headers[0];record.extensions.headers[0]='Comment Content';assert.throws(()=>validateEcommerceRecord(record),/评论内容|重复|冲突/);record.extensions.headers[0]=priorExtra;assert.equal(validateEcommerceRecord(record),true);
 const priorColumn=record.sourceColumns.core[0];record.sourceColumns.core[0]=record.sourceColumns.core[1];assert.throws(()=>validateEcommerceRecord(record),/来源映射/);record.sourceColumns.core[0]=priorColumn;assert.equal(validateEcommerceRecord(record),true);
 record.headers[0]=record.headers[2]='Region';assert.throws(()=>validateEcommerceRecord(record),/歧义|无法唯一/);
});

test('reordered core-only Sheet4 uses schema4 and fixed43 outputs without extensions',async()=>{
 const layout=[...core].reverse(),bytes=await workbook([{name:'Sheet4',headers:layout.map(index=>EC_HEADERS[index]),rows:[layout.map(index=>standards[index]),layout.map(index=>raw()[index])]}]),p=valid(await parse(bytes));
 assert.equal(p.sessions[0].ecommerce.schemaVersion,4);assert.match(p.sessions[0].id,/-S1-3$/);assert.deepEqual(p.sessions[0].ecommerce.sourceColumns,{core:core.map(index=>22-index),extensions:[]});
 const {state}=stateFor(p),snapshot=createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now});
 for(const language of ['zh','en']){const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,{}, {language}));assert.equal(tables[language==='en'?'Inspection Details':'检核明细'][0].length,44);assert.equal(tables[language==='en'?'Source Column Map':'源列映射'].length,23);}
});

test('mapped rich-text bilingual and explanatory aliases keep source labels and time fieldEvidence as text',async()=>{
 const headers=[...EC_HEADERS];headers[2]='区域\nRegion';headers[10]='grade评分';headers[12]='Comment Time\n说明：'+ '字段说明'.repeat(50);headers[14]='Comment Types\nPositive Good:4-5 points\n评价类型\n好评正向：4-5分';
 const zip=await JSZip.loadAsync(await bytesFor(layouts.front,{headers,rows:[3]}));zip.file('xl/worksheets/sheet1.xml',(await zip.file('xl/worksheets/sheet1.xml').async('string')).replace(/<c r="N1"[^>]*>[\s\S]*?<\/c>/,'<c r="N1" t="inlineStr"><is><r><t>grade</t></r><r><t>评分</t></r></is></c>'));
 const p=valid(await parse(await zip.generateAsync({type:'uint8array'}))),s=p.sessions[0];assert.deepEqual(s.ecommerce.headers,headers);assert.equal(s.contextFields.find(f=>f.key==='rating').source.column,'grade评分');assert.equal(s.contextFields.find(f=>f.key==='commentTime').source.column,EC_HEADERS[12]);assert.deepEqual(timeJudgment(s).fieldEvidence,['commentTime','replyTime']);assert.equal(validateEcommerceSource(s),true);
});

test('missing, duplicate, conflicting and cross-column concatenated core headers reject atomically with field information',async()=>{
 for(const change of [h=>h[8]='未登记评论字段',h=>h[8]='Comment Time',h=>h[8]='Comment Content / Reply Content',h=>h[15]='Is there any text quality issue?']){
  const headers=[...EC_HEADERS];change(headers);const p=await parse(await bytesFor(layouts.front,{headers}));assert.equal(p.valid,false);assert.deepEqual(p.sessions,[]);assert.equal(p.turnCount,0);assert.match(p.errors.join('；'),/评论|Comment|文本质量|text quality/);
 }
 const duplicated=['x0',...core,'duplicate'],values=raw();const bytes=await workbook([{name:'重复表头',headers:duplicated.map(i=>i==='duplicate'?'评论内容':i==='x0'?'其他':EC_HEADERS[i]),rows:[Array(24).fill(''),duplicated.map(i=>typeof i==='number'?values[i]:'EXTRA')]}]);const p=await parse(bytes);assert.equal(p.valid,false);assert.deepEqual(p.sessions,[]);assert.match(p.errors.join('；'),/评论内容.*重复|评论内容.*冲突|评论内容.*唯一/);
});

test('schema4 source map is closed, complete, positional, header-consistent and frozen across a task',async()=>{
 const p=valid(await parse(await bytesFor())),r=p.sessions[0].ecommerce;assert.equal(validateEcommerceRecord(r),true);
 for(const change of [r=>r.extra=true,r=>r.sourceColumns.extra=[],r=>r.sourceColumns.core.pop(),r=>r.sourceColumns.extensions.pop(),r=>r.sourceColumns.core[0]=0,r=>r.sourceColumns.core[0]='4',r=>r.sourceColumns.core[0]=4.5,r=>r.sourceColumns.core[0]=5,r=>r.sourceColumns.extensions[0]=26,r=>r.sourceColumns.extensions.reverse(),r=>r.normalizedTimes.commentTime=null,r=>r.schemaVersion=3]){
  const bad=structuredClone(r);change(bad);assert.throws(()=>validateEcommerceRecord(bad));
 }
 const other=valid(await parse(await bytesFor(layouts.interleaved))).sessions[1].ecommerce;other.fileSha256=r.fileSha256;assert.throws(()=>validateEcommerceSources([r,other]),/来源|完全一致|映射/);
 const {state,catalog}=stateFor(p),changed=structuredClone(state);changed.sessions[0].ecommerce.extensions.raw[0]='ALTERED';assert.throws(()=>validateWorkspace(changed,catalog,state),/不可改写|原文/);
 const changedMap=structuredClone(state);for(const s of changedMap.sessions)[s.ecommerce.sourceColumns.core[8],s.ecommerce.sourceColumns.core[9]]=[s.ecommerce.sourceColumns.core[9],s.ecommerce.sourceColumns.core[8]];assert.throws(()=>validateWorkspace(changedMap,catalog,state),/不可改写|原文/);
 const mixed=structuredClone(state);mixed.sessions[1].ecommerce.sourceColumns=other.sourceColumns;assert.throws(()=>validateWorkspace(mixed,catalog),/来源|完全一致|映射/);
});

test('mapped source bytes and maps persist across restart, model input excludes references and both exports retain source mapping',async t=>{
 const base=path.resolve('..','mapping-test-work');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'store-'));let store=await createWorkspaceStore({dataDir:dir});
 t.after(async()=>{await store.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const bytes=await bytesFor(layouts.shuffled),p=valid(await parse(bytes)),source={...await store.putSource(bytes,'生成映射测试.xlsx'),worksheet:{name:p.selectedSheet,index:p.selectedSheetIndex}},f=stateFor(p,source);
 await store.save({...f,baseRevision:0,mutationId:'mapping-save'});await store.close();store=await createWorkspaceStore({dataDir:dir});const saved=(await store.read()).state;assert.deepEqual(saved.sessions.map(s=>s.ecommerce),p.sessions.map(s=>s.ecommerce));
 assert.deepEqual(await fs.readFile(path.join(dir,'sources',source.sha256)),Buffer.from(bytes));
 let sent;const client=createArkClient({fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'生成判定',evidence:[1,2],referenceIds:[]}))})}}]}));}});
 await client.inspectEcommerceRow({config:{apiKey:'fictional-only'},session:saved.sessions[0],basis:f.basisSnapshot});assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_|sourceColumns|extensions|CORE_STANDARD/);
 const snapshot=createBusinessDeliverySnapshot(saved,{taskId:saved.tasks[0].id,now}),before=JSON.stringify(snapshot);assert.deepEqual(snapshot.sourceColumns,expectedMap(layouts.shuffled));
 for(const language of ['zh','en']){
  const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,{}, {language})),main=tables[language==='en'?'Inspection Details':'检核明细'];assert.equal(main[0].length,47);assert.deepEqual(main[0].slice(0,22),EC_HEADERS);assert.deepEqual(main[0].slice(43,-1),extraHeaders);assert.deepEqual(main[1].slice(0,22),standards);assert.deepEqual(main[1].slice(43,-1),extraStandards);
  if(language==='zh'){assert.ok(main[1][30].includes(`第${snapshot.sourceColumns.core[15]}列`));assert.ok(main[1][35].includes(`第${snapshot.sourceColumns.core[20]}列`));}
  for(const row of [3,7,27]){const line=main.find(r=>r[XLSX_ROW_NUMBER]===row);assert.deepEqual(line.slice(0,22),raw(row));assert.deepEqual(line.slice(43,-1),extraValues);}
  const mapping=tables[language==='en'?'Source Column Map':'源列映射'];assert.ok(mapping);assert.equal(mapping.length,26);
  for(const [i,physical]of snapshot.sourceColumns.core.entries()){const line=mapping.find(r=>r[0]===String(physical));assert.equal(line[1],String(i+1));assert.equal(line[2],EC_HEADERS[i]);}
  for(const [i,physical]of snapshot.sourceColumns.extensions.entries()){const line=mapping.find(r=>r[0]===String(physical));assert.equal(line[1],String(44+i));assert.equal(line[2],extraHeaders[i]);}
 }
 assert.equal(JSON.stringify(snapshot),before);saved.sessions[0].ecommerce.raw[8]='LATER_COMMENT';assert.equal(snapshot.records[0].raw22[8],'COMMENT_3');
 const bad=structuredClone(snapshot);bad.sourceColumns.core[8]=bad.sourceColumns.core[9];for(const language of ['zh','en'])await assert.rejects(buildBusinessDeliveryXlsx(bad,{}, {language}),/映射|来源|表头/);
});

test('mapped report jobs freeze source maps and restart with no model calls or source rewrites',async t=>{
 const base=path.resolve('..','mapping-test-work');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'report-'));const p=valid(await parse(await bytesFor(layouts.front,{rows:[3]}))),f=stateFor(p);let calls=0;
 const store={read:async()=>({state:structuredClone(f.state),revision:1,initialized:true})},modelConfig={getPrivate:()=>({configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'fixture',authMode:'none',apiKey:null,timeoutMs:120000,reasoningEffort:'low',maxTokens:null})},client={async enrichBusinessReport({kind,input}){calls++;if(kind==='translation')return{items:input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'en',translation:'生成译文'}))};throw new Error('unexpected fixture node');}};
 let service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs:0});t.after(async()=>{await service.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 await service.create({jobId:'mapped-frozen',taskId:f.state.tasks[0].id});await service.waitForIdle();const frozen=(await service.getResult('mapped-frozen')).snapshot;assert.deepEqual(frozen.sourceColumns,expectedMap(layouts.front));const beforeCalls=calls;
 f.state.sessions[0].ecommerce.raw[8]='CHANGED_AFTER_FREEZE';await service.close();service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs:0});assert.deepEqual((await service.getResult('mapped-frozen')).snapshot,frozen);assert.equal(calls,beforeCalls);
 await service.close();const file=path.join(dir,'report-jobs','mapped-frozen','snapshot.json'),tampered=JSON.parse(await fs.readFile(file,'utf8'));[tampered.sourceColumns.core[8],tampered.sourceColumns.core[9]]=[tampered.sourceColumns.core[9],tampered.sourceColumns.core[8]];await fs.writeFile(file,JSON.stringify(tampered));service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs:0});await assert.rejects(service.getResult('mapped-frozen'),/快照指纹/);assert.equal(calls,beforeCalls);
});
