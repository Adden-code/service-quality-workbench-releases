import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ecommerceMappingFixture,mappingSourceHeaders} from './import-mapping098-fixture.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {EC_RULE_IDS,validateEcommerceRecord,validateEcommerceSource,validateEcommerceSources,ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {inspectEcommerceBatch} from '../server/ecommerce-engine.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
const clone=value=>structuredClone(value),now='2026-11-11T10:00:00+08:00';
const base=fileURLToPath(new URL('../../import-mapping098/runtime/',import.meta.url));
async function api(){
 const conversion=new URL('../public/ecommerce-conversion.mjs',import.meta.url),mapping=new URL('../server/import-mapping.mjs',import.meta.url);
 assert.ok(existsSync(conversion),'missing reviewed ecommerce mapping boundary');assert.ok(existsSync(mapping),'missing strict headers-only model contract');
 return{...await import(conversion),...await import(mapping)};
}
async function reviewed(f,a){const source=await a.inspectEcommerceMappingSource(f.file,{selectedSheet:f.sheet});return{source,receipt:a.createReviewedEcommerceMapping(source,f.mappings,{reviewed:true,applied:true})};}
const modelInput=source=>Object.fromEntries(['sourceName','fileSha256','sheet','sheetIndex','headers'].map(key=>[key,source[key]]));
function stateFor(parsed,source){const catalog=ensureEcommerceCatalog(createBusinessCatalog(),{now}),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-11',ruleIds:EC_RULE_IDS,now});return{catalog,basisSnapshot,state:createImportedTask(createBusinessState(),{name:'用户确认源列映射',sessions:parsed.sessions,source,basisSnapshot,reviewer:'Synthetic reviewer',now})};}

test('headers-only source inspection preserves declaration order and requires explicit worksheet choice when ambiguous',async()=>{
 const a=await api(),f=await ecommerceMappingFixture({multiple:true}),source=await a.inspectEcommerceMappingSource(f.file);
 assert.deepEqual(source.availableSheetNames,['第二来源',f.sheet]);assert.equal(source.selectedSheet,null);assert.equal(Object.hasOwn(source,'headers'),false);
 const selected=await a.inspectEcommerceMappingSource(f.file,{selectedSheet:f.sheet});assert.equal(selected.sheetIndex,2);assert.deepEqual(selected.headers,f.headers);assert.match(selected.fileSha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(selected),/PRIVATE_HISTORY|PRIVATE_STANDARD|Synthetic comment/);
 await assert.rejects(a.inspectEcommerceMappingSource(f.file,{selectedSheet:'missing'}),/工作表/);
});

test('model preparation exposes only exact input headers and static 22 targets, allowing partial draft suggestions',async()=>{
 const a=await api(),f=await ecommerceMappingFixture(),{source}=await reviewed(f,a),input=modelInput(source),prepared=a.prepareImportMappingPrompt(input);
 assert.deepEqual(prepared.input,input);assert.equal(typeof prepared.promptVersion,'string');assert.doesNotMatch(JSON.stringify(prepared),/PRIVATE_HISTORY|PRIVATE_STANDARD|Synthetic comment/);
 const partial={mappings:f.mappings.slice(0,2)};assert.deepEqual(a.parseImportMappingResult(JSON.stringify(partial),input),partial);
 assert.deepEqual(a.parseImportMappingResult('{"mappings":[]}',input),{mappings:[]});
 for(const change of [v=>v.samples=[['PRIVATE']],v=>v.headers[0]=1,v=>v.fileSha256='x',v=>v.sheetIndex=0]){const bad=clone(input);change(bad);assert.throws(()=>a.prepareImportMappingPrompt(bad),error=>error.code==='INVALID_INPUT');}
});

test('strict mapping output rejects fabricated headers, duplicate target or source, extra fields, unknown columns and malformed JSON',async()=>{
 const a=await api(),f=await ecommerceMappingFixture(),{source}=await reviewed(f,a),input=modelInput(source);
 for(const change of [v=>v.mappings[0].sourceHeader+='改写',v=>v.mappings[0].sourceColumn=999,v=>v.mappings[0].targetIndex=22,v=>v.mappings[0].targetIndex=0.5,v=>v.mappings[0].extra='x',v=>v.extra='x',v=>v.mappings.push(clone(v.mappings[0])),v=>{v.mappings[1].sourceColumn=v.mappings[0].sourceColumn;v.mappings[1].sourceHeader=v.mappings[0].sourceHeader;}]){const bad={mappings:clone(f.mappings)};change(bad);assert.throws(()=>a.parseImportMappingResult(JSON.stringify(bad),input),error=>error.code==='INVALID_OUTPUT');}
 assert.throws(()=>a.parseImportMappingResult('```json\n{"mappings":[]}\n```',input),error=>error.code==='INVALID_OUTPUT');
});

test('two independent explicit confirmations and all22 target mappings are required for an applied receipt',async()=>{
 const a=await api(),f=await ecommerceMappingFixture(),source=await a.inspectEcommerceMappingSource(f.file);
 for(const confirmations of [{},{reviewed:true},{applied:true},{reviewed:1,applied:true},{reviewed:true,applied:'true'}])assert.throws(()=>a.createReviewedEcommerceMapping(source,f.mappings,confirmations),/确认/);
 assert.throws(()=>a.createReviewedEcommerceMapping(source,f.mappings.slice(0,21),{reviewed:true,applied:true}),/22|缺失/);
 const receipt=a.createReviewedEcommerceMapping(source,f.mappings,{reviewed:true,applied:true});assert.equal(receipt.schemaVersion,1);assert.equal(receipt.reviewed,true);assert.equal(receipt.applied,true);assert.deepEqual(receipt.mappings,f.mappings);
 for(const change of [v=>v.fileSha256='a'.repeat(64),v=>v.sheet='other',v=>v.sheetIndex=2,v=>v.reviewed=false,v=>v.applied=false,v=>v.extra='x']){const bad=clone(receipt);change(bad);assert.throws(()=>a.validateReviewedEcommerceMapping(bad,source));}
});

test('unrecognized source headers remain failed until an explicit complete mapping is applied through the same parser',async()=>{
 const a=await api(),f=await ecommerceMappingFixture(),original=Buffer.from(f.bytes),initial=await parseEcommerceFile(f.file);assert.equal(initial.valid,false);assert.deepEqual(initial.sessions,[]);
 const {receipt}=await reviewed(f,a),parsed=await parseEcommerceFile(f.file,{reviewedMapping:receipt});assert.equal(parsed.valid,true,parsed.errors.join('；'));assert.deepEqual(parsed.sessions.map(s=>s.ecommerce.row),[3,27]);
 for(const [index,session]of parsed.sessions.entries()){const record=session.ecommerce;assert.equal(record.schemaVersion,5);assert.deepEqual(record.headers,mappingSourceHeaders);assert.deepEqual(record.raw,f.records[index].raw);assert.deepEqual(record.reviewedMapping,receipt);assert.equal(validateEcommerceRecord(record),true);assert.equal(validateEcommerceSource(session),true);assert.match(session.id,/-S1-(?:3|27)$/);assert.doesNotMatch(JSON.stringify({turns:session.turns,fields:session.contextFields}),/PRIVATE_/);}
 assert.deepEqual(Buffer.from(await f.file.arrayBuffer()),original);assert.equal(parsed.selectedSheetIndex,1);assert.match(parsed.warnings.join('；'),/确认.*映射|映射.*确认/);
 for(const change of [r=>r.fileSha256='a'.repeat(64),r=>r.mappings.pop(),r=>r.mappings[0].sourceHeader='invented',r=>r.applied=false]){const receiptBad=clone(receipt);change(receiptBad);const bad=await parseEcommerceFile(f.file,{reviewedMapping:receiptBad});assert.equal(bad.valid,false);assert.deepEqual(bad.sessions,[]);}
 const wrongSheet=await parseEcommerceFile(f.file,{reviewedMapping:receipt,selectedSheet:'other'});assert.equal(wrongSheet.valid,false);
});

test('genuinely missing target columns or row2 standards cannot be invented or bypassed by mapping suggestions',async()=>{
 const a=await api(),missing=await ecommerceMappingFixture({missing:true}),source=await a.inspectEcommerceMappingSource(missing.file);
 assert.equal(a.validateEcommerceMapping(missing.mappings,source.headers).length,21);assert.throws(()=>a.createReviewedEcommerceMapping(source,missing.mappings,{reviewed:true,applied:true}),/22|缺失/);
 const fabricated=clone(missing.mappings);fabricated.push({targetIndex:21,sourceColumn:1,sourceHeader:source.headers[0]});assert.throws(()=>a.createReviewedEcommerceMapping(source,fabricated,{reviewed:true,applied:true}),/重复|冲突/);
 const f=await ecommerceMappingFixture({noStandard:true}),{receipt}=await reviewed(f,a),parsed=await parseEcommerceFile(f.file,{reviewedMapping:receipt});assert.equal(parsed.valid,false);assert.match(parsed.errors.join('；'),/第2行|标准/);assert.deepEqual(parsed.sessions,[]);
});

test('mapping retains unknown original times as unknown rather than generating timestamps',async()=>{
 const a=await api(),f=await ecommerceMappingFixture({unknownTimes:true}),{receipt}=await reviewed(f,a),parsed=await parseEcommerceFile(f.file,{reviewedMapping:receipt});assert.equal(parsed.valid,true,parsed.errors.join('；'));
 const record=parsed.sessions[0].ecommerce;assert.equal(record.raw[12],'来源未给出完整时点');assert.deepEqual(record.normalizedTimes,{commentTime:null,replyTime:null});assert.equal(parsed.sessions[0].startedAt,'');
});

test('schema5 source mapping receipt survives workspace persistence/restart and both exports retain exact provenance',async t=>{
 const a=await api(),f=await ecommerceMappingFixture(),{receipt}=await reviewed(f,a),parsed=await parseEcommerceFile(f.file,{reviewedMapping:receipt});assert.equal(parsed.valid,true,parsed.errors.join('；'));
 await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'store-'));let store=await createWorkspaceStore({dataDir});t.after(async()=>{await store.close();assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const source={...await store.putSource(f.bytes,f.file.name),worksheet:{name:parsed.selectedSheet,index:parsed.selectedSheetIndex}},state=stateFor(parsed,source);assert.equal(validateWorkspace(state.state,state.catalog),true);
 await store.save({...state,baseRevision:0,mutationId:'reviewed-mapping'});await store.close();store=await createWorkspaceStore({dataDir});const saved=(await store.read()).state;assert.deepEqual(saved.sessions.map(s=>s.ecommerce),parsed.sessions.map(s=>s.ecommerce));assert.deepEqual(await fs.readFile(path.join(dataDir,'sources',source.sha256)),Buffer.from(f.bytes));
 const snapshot=createBusinessDeliverySnapshot(saved,{taskId:saved.tasks[0].id,now});assert.deepEqual(snapshot.reviewedMapping,receipt);assert.deepEqual(snapshot.headers22,mappingSourceHeaders);
 for(const language of ['zh','en']){const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,{}, {language})),main=tables[language==='en'?'Inspection Details':'检核明细'],map=tables[language==='en'?'Source Column Map':'源列映射'];assert.deepEqual(main[0].slice(0,22),mappingSourceHeaders);for(const item of f.records){const row=main.find(row=>row[XLSX_ROW_NUMBER]===item.row);assert.deepEqual(row.slice(0,22),item.raw);assert.equal(row[43],'PRIVATE_EXTENSION');}assert.ok(map.some(row=>/User-reviewed|用户确认/.test(row[4])));}
 for(const change of [s=>s.reviewedMapping.fileSha256='a'.repeat(64),s=>s.reviewedMapping.mappings[0].sourceHeader='invented',s=>s.sourceColumns.core[0]=s.sourceColumns.core[1]]){const bad=clone(snapshot);change(bad);for(const language of ['zh','en'])await assert.rejects(buildBusinessDeliveryXlsx(bad,{}, {language}));}
 const bad=clone(parsed.sessions[0].ecommerce);bad.schemaVersion=4;delete bad.reviewedMapping;assert.throws(()=>validateEcommerceRecord(bad),/表头/);
 const changed=clone(saved);changed.sessions[0].ecommerce.reviewedMapping.applied=false;assert.throws(()=>validateWorkspace(changed,state.catalog,saved));
});

test('actual Ark client prepares headers-only mappings through the existing request transport and strict parser',async()=>{
 const a=await api(),f=await ecommerceMappingFixture(),{source}=await reviewed(f,a),input=modelInput(source);let calls=0,sent;
 const client=createArkClient({fetchImpl:async(_url,options)=>{calls++;sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({mappings:f.mappings})}}]}));}});
 assert.equal(typeof client.prepareImportMapping,'function');const result=await client.prepareImportMapping({config:{configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-mapping',authMode:'none',timeoutMs:10000},input});assert.deepEqual(result.mappings,f.mappings);assert.equal(calls,1);assert.equal(result.promptVersion,a.IMPORT_MAPPING_PROMPT_VERSION);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_HISTORY|PRIVATE_STANDARD|Synthetic comment|Synthetic reply/);
 await assert.rejects(client.prepareImportMapping({config:{authMode:'none'},input:{...input,samples:[]}}),error=>error.code==='INVALID_INPUT');assert.equal(calls,1);
});

test('schema5 executes the original quality client without historical-cell leakage and retains deterministic time audit fields',async()=>{
 const a=await api(),f=await ecommerceMappingFixture(),{receipt}=await reviewed(f,a),parsed=await parseEcommerceFile(f.file,{reviewedMapping:receipt});assert.equal(parsed.valid,true,parsed.errors.join('；'));
 const source={name:f.file.name,size:f.bytes.length,sha256:receipt.fileSha256,worksheet:{name:f.sheet,index:f.sheetIndex}},state=stateFor(parsed,source),session=state.state.sessions[0],traces={};let sent;
 const semantic=EC_RULE_IDS.filter(ruleId=>ruleId!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'合成来源对应当前原文。',evidence:[1,2],referenceIds:[]}));
 const client=createArkClient({fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:semantic})}}]}));}});
 await client.inspectEcommerceRow({config:{authMode:'none',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-only',timeoutMs:10000},session,basis:state.basisSnapshot});assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_|reviewedMapping|sourceColumns|mappings/);
 await inspectEcommerceBatch({sessions:[session],basis:state.basisSnapshot,config:{model:'synthetic-only'},trace:{step:async(id,input,operation)=>{traces[id]=input;return operation();}},client:{inspectEcommerce:async()=>({records:[{sessionId:session.id,results:semantic}],duplicateGroups:[]})}});
 assert.equal(traces.deterministic.sessions[0].dateSystem,'1900');assert.deepEqual(traces.deterministic.sessions[0].normalizedTimes,session.ecommerce.normalizedTimes);
});

test('schema5 async report snapshots preserve the reviewed receipt across restart and fingerprint checks reject provenance changes',async t=>{
 const a=await api(),f=await ecommerceMappingFixture(),{receipt}=await reviewed(f,a),parsed=await parseEcommerceFile(f.file,{reviewedMapping:receipt});assert.equal(parsed.valid,true,parsed.errors.join('；'));
 const source={name:f.file.name,size:f.bytes.length,sha256:receipt.fileSha256,worksheet:{name:f.sheet,index:f.sheetIndex}},state=stateFor(parsed,source);
 await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'reports-'));let calls=0;
 const options={dataDir,store:{read:async()=>({state:clone(state.state),revision:1})},modelConfig:{getPrivate:()=>({configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-only',authMode:'none',timeoutMs:10000,reasoningEffort:'low',maxTokens:null})},client:{enrichBusinessReport:async({kind,input})=>{calls++;assert.equal(kind,'translation');return{items:input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'en',translation:'合成中文译文。'}))};}},retryDelayMs:1};
 let service=await createReportJobs(options);t.after(async()=>{await service.close();assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 await service.create({jobId:'schema5-report',taskId:state.state.tasks[0].id});await service.waitForIdle();const first=await service.getResult('schema5-report');assert.equal(first.job.status,'completed');assert.deepEqual(first.snapshot.reviewedMapping,receipt);
 const count=calls;await service.close();service=await createReportJobs(options);assert.deepEqual((await service.getResult('schema5-report')).snapshot,first.snapshot);assert.equal(calls,count);
 await service.close();const file=path.join(dataDir,'report-jobs','schema5-report','snapshot.json'),changed=JSON.parse(await fs.readFile(file,'utf8'));changed.reviewedMapping.mappings[0].sourceHeader='篡改来源';await fs.writeFile(file,JSON.stringify(changed));service=await createReportJobs(options);await assert.rejects(service.getResult('schema5-report'),/快照指纹/);assert.equal(calls,count);
});
