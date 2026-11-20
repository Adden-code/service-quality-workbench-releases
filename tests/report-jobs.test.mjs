import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {publishedFixture,sourceRow,cutoff} from './v21-runtime-fixtures.mjs';
import {ecommerceSourceProjection,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';

const base='D:/Codex project/outputs/service-business-delivery-20261104/jobs-tests';
function inputState(){
 const rows=[3,4,5].map((row,index)=>{
  const s=sourceRow({row,reply:'Thank you for sharing your experience.',type:index===2?'好评正向':'好评负向'});
  s.ecommerce.raw[8]=index===2?'Great quality and useful features.':'The battery stops working.';s.ecommerce.raw[21]='';
  Object.assign(s,ecommerceSourceProjection(s.ecommerce));return s;
 });
 const {state}=publishedFixture(rows),task=state.tasks[0];task.aiRun={id:'quality-before-export',inspectionAt:cutoff,startedAt:cutoff};
 for(const [i,s]of state.sessions.entries()){
  s.aiExecution={status:'completed',runId:task.aiRun.id};s.aiResults=[timeJudgment(s,{basis:task.basisSnapshot,inspectionAt:cutoff}),...EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:i===0&&ruleId==='EC-TEXT'?'不符合':'符合',reason:i===0?'The reply has a spelling error.':'已按冻结口径检查',evidence:[1,2],referenceIds:[]}))];
 }
 return state;
}
function answer(kind,input){
 if(kind==='translation')return{items:input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'en',translation:'中文译文：'+item.text}))};
 if(kind==='caseHighlights')return{cases:input.candidates.slice(0,input.limit).map(item=>({id:item.id,score:4,commentary:'结合回复内容给出具体回应',quote:item.reply.slice(0,12)}))};
 if(kind==='issueClusters')return{clusters:[{label:'拼写规范',summary:'存在需要校对的表达',memberIds:input.records.map(r=>r.id),action:'发布前逐字校对回复文本'}]};
 return{items:input.records.map(item=>({id:item.id,valid:true,scene:'产品质量',painPoint:'电池无法正常工作',reason:'包含具体产品故障',evidenceQuote:item.comment.slice(0,12)}))};
}
async function fixture(t,{hook,retryDelayMs=1}={}){
 const {createReportJobs}=await import('../server/report-jobs.mjs');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/job-');
 let state=inputState(),revision=7,config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'fixture-report',authMode:'bearer',apiKey:'FICTIONAL_PRIVATE_KEY_NOT_SAVED',timeoutMs:120000,reasoningEffort:'low',maxTokens:null};
 const calls=[],store={read:async()=>({state:structuredClone(state),revision,initialized:true})},modelConfig={getPrivate:()=>({...config})};
 const client={engine:'local-test',async enrichBusinessReport(request){calls.push(structuredClone({kind:request.kind,input:request.input}));return hook?hook(request,calls):answer(request.kind,request.input);}};
 let service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs});
 t.after(async()=>{await service.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return{dir,calls,store,client,modelConfig,taskId:state.tasks[0].id,get service(){return service;},setState(value){state=value;revision++;},setConfig(value){config={...config,...value};},async restart(){await service.close();service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs});}};
}
test('0113 report partial translations survive restart and missing-only retry',async t=>{
 let partial=true,accepted;
 const f=await fixture(t,{hook:({kind,input})=>{const result=answer(kind,input);if(kind!=='translation'||!partial)return result;if(accepted)return{items:[]};accepted=result.items[0].id;return{items:[result.items[0]]};}});
 await f.service.create({jobId:'partial-report',taskId:f.taskId,targetLang:'zh'});await f.service.waitForIdle();let result=await f.service.getResult('partial-report');
 assert.equal(result.enrichment.translationStats.completedTexts,1);assert.ok(result.enrichment.translationStats.failedTexts>0);await f.restart();result=await f.service.getResult('partial-report');assert.equal(result.enrichment.translationStats.completedTexts,1);
 partial=false;const start=f.calls.length;await f.service.retry('partial-report');await f.service.waitForIdle();result=await f.service.getResult('partial-report');assert.equal(result.job.status,'completed');assert.ok(f.calls.slice(start).filter(c=>c.kind==='translation').every(c=>!c.input.items.some(i=>i.id===accepted)));
});
test('business report job deduplicates translations, freezes both exports and persists without model keys',async t=>{
 const f=await fixture(t),input={jobId:'report-first',taskId:f.taskId,conclusionMode:'combined',targetLang:'zh'};
 await f.service.create(input);await f.service.waitForIdle();const job=await f.service.get(input.jobId),result=await f.service.getResult(input.jobId);
 assert.equal(job.status,'completed');assert.equal(result.snapshot.records.length,3);assert.equal(result.snapshot.metrics.total,3);assert.equal(result.enrichment.excellentCases.length,1);assert.equal(result.enrichment.vocItems.length,2);
 const translated=f.calls.filter(c=>c.kind==='translation').flatMap(c=>c.input.items);assert.equal(new Set(translated.map(i=>i.text)).size,3);assert.equal(translated.length,3);
 assert.equal(result.enrichment.translations[result.snapshot.records[0].id].reply.text,result.enrichment.translations[result.snapshot.records[1].id].reply.text);
 const before=JSON.stringify(result.snapshot);f.setState(inputState());await f.service.create(input);await f.service.waitForIdle();assert.equal(JSON.stringify((await f.service.getResult(input.jobId)).snapshot),before);
 await f.restart();assert.equal((await f.service.get(input.jobId)).status,'completed');assert.equal((await f.service.getResult(input.jobId)).snapshot.records.length,3);
 async function scan(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await scan(p);else if(entry.name.endsWith('.json'))assert.ok(!(await fs.readFile(p,'utf8')).includes('FICTIONAL_PRIVATE_KEY_NOT_SAVED'));}}await scan(f.dir);
});
test('invalid output retries then succeeds while persistent failures leave exportable blanks and warnings',async t=>{
 let translations=0;const f=await fixture(t,{hook:request=>{if(request.kind==='translation'&&++translations===1)throw Object.assign(new Error('generated bad JSON'),{code:'INVALID_OUTPUT'});return answer(request.kind,request.input);}});
 await f.service.create({jobId:'retry-success',taskId:f.taskId});await f.service.waitForIdle();assert.equal((await f.service.get('retry-success')).status,'completed');assert.equal(translations,2);
 const g=await fixture(t,{hook:request=>{if(request.kind==='translation')throw Object.assign(new Error('invalid output'),{code:'INVALID_OUTPUT'});return answer(request.kind,request.input);}});
 await g.service.create({jobId:'retry-fails',taskId:g.taskId});await g.service.waitForIdle();const result=await g.service.getResult('retry-fails');assert.equal(result.job.status,'completed_with_warnings');assert.ok(result.enrichment.translationStats.failedTexts>0);assert.ok(result.enrichment.translationStats.affectedRecords>0);assert.equal(result.snapshot.records.length,3);
});
test('fatal authentication stops later model calls but still yields a labelled partial delivery',async t=>{
 const f=await fixture(t,{hook:()=>{throw Object.assign(new Error('rejected'),{code:'AUTHENTICATION'});}});await f.service.create({jobId:'auth-failed',taskId:f.taskId});await f.service.waitForIdle();assert.equal(f.calls.length,1);const result=await f.service.getResult('auth-failed');assert.equal(result.job.status,'completed_with_warnings');assert.ok(result.enrichment.warnings.length);assert.equal(result.snapshot.metrics.total,3);
});
test('new report reuses exact translation cache across conclusion modes without reusing analysis',async t=>{
 const f=await fixture(t);await f.service.create({jobId:'cache-one',taskId:f.taskId,conclusionMode:'ai'});await f.service.waitForIdle();const count=f.calls.filter(c=>c.kind==='translation').length;
 await f.service.create({jobId:'cache-two',taskId:f.taskId,conclusionMode:'combined'});await f.service.waitForIdle();assert.equal(f.calls.filter(c=>c.kind==='translation').length,count);assert.equal((await f.service.getResult('cache-two')).snapshot.conclusionMode,'combined');
});

test('configured translation confidence survives cache reuse, English reload and exported audit sheet',async t=>{
 const {defaultScenePackage,resolveSceneRuntime}=await import('../public/scene-configuration.mjs');
 const {sceneDeliverySheets}=await import('../public/scene-delivery.mjs');
 const state=inputState(),task=state.tasks[0],p=defaultScenePackage({id:task.scene,name:'Synthetic EC',engine:'ecommerce'},task.basisSnapshot);
 p.configuration.executionMode='configured';p.template.renderMode='configured';
 task.executionSnapshot={configuration:p.configuration,template:p.template,runtime:resolveSceneRuntime(p.configuration,{outputLanguages:['zh','en']}),taxonomy:null,exceptions:[]};
 const f=await fixture(t,{hook:({kind,input})=>kind==='translation'?{items:input.items.map(x=>({id:x.id,translation:x.text,isTargetLanguage:true,detectedLanguage:'en',confidence:.87}))}:answer(kind,input)});f.setState(state);
 await f.service.create({jobId:'confidence-one',taskId:f.taskId,targetLang:'en'});await f.service.waitForIdle();
 assert.equal((await f.service.get('confidence-one')).status,'completed');const calls=f.calls.filter(x=>x.kind==='translation');assert.ok(calls.every(x=>x.input.includeConfidence));
 await f.service.create({jobId:'confidence-two',taskId:f.taskId,targetLang:'en',conclusionMode:'ai'});await f.service.waitForIdle();assert.equal(f.calls.filter(x=>x.kind==='translation').length,calls.length);
 await f.restart();const result=await f.service.getResult('confidence-two');assert.equal(result.job.status,'completed');assert.equal(result.enrichment.translations[result.snapshot.records[0].id].reply.confidence,.87);
 const sheets=sceneDeliverySheets(result.snapshot,result.enrichment);assert.ok(sheets.some(s=>s.rows.some(r=>r.includes(.87)||r.includes('0.87'))));
});
test('pause preserves the snapshot, blocks new dispatch, and resume requires its original endpoint',async t=>{
 let entered,release;const called=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const f=await fixture(t,{hook:async request=>{entered();await gate;return answer(request.kind,request.input);}});await f.service.create({jobId:'pause-one',taskId:f.taskId});await called;await f.service.pause('pause-one');release();await f.service.waitForIdle();assert.equal((await f.service.get('pause-one')).status,'paused');assert.equal(f.calls.length,1);
 f.setConfig({baseUrl:'http://127.0.0.1:2/v1'});await assert.rejects(f.service.resume('pause-one'),/地址|认证|原设置/);f.setConfig({baseUrl:'http://127.0.0.1:1/v1'});await f.service.resume('pause-one');await f.service.waitForIdle();assert.equal((await f.service.get('pause-one')).status,'completed');
});

test('backup busy probe keeps a softly paused report busy until its result is persisted',async t=>{
 let enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 const f=await fixture(t,{hook:async request=>{enter();await gate;return answer(request.kind,request.input);}});
 try{
  assert.equal(f.service.isBusy(),false);const creation=f.service.create({jobId:'backup-busy',taskId:f.taskId});assert.equal(f.service.isBusy(),true);await creation;await entered;
  await f.service.pause('backup-busy');assert.equal((await f.service.get('backup-busy')).status,'paused');assert.equal(f.service.isBusy(),true);
  release();await f.service.waitForIdle();assert.equal(f.service.isBusy(),false);assert.equal((await f.service.get('backup-busy')).status,'paused');
  await f.service.resume('backup-busy');await f.service.waitForIdle();assert.equal(f.service.isBusy(),false);
 }finally{release();}
});
test('source changes reject reuse of a job ID while old delivery remains frozen',async t=>{
 const f=await fixture(t);await f.service.create({jobId:'immutable',taskId:f.taskId});await f.service.waitForIdle();const before=await f.service.getResult('immutable');const changed=inputState();changed.tasks[0].name='changed title';f.setState(changed);await assert.rejects(f.service.create({jobId:'immutable',taskId:f.taskId}),/冲突|不同|变化/);assert.deepEqual((await f.service.getResult('immutable')).snapshot,before.snapshot);await assert.rejects(f.service.get('../bad'),/标识|不存在/);
});

test('01117 different request IDs atomically reuse the same frozen report across tabs and restart',async t=>{
 let release,enter;const gate=new Promise(r=>release=r),entered=new Promise(r=>enter=r);
 const f=await fixture(t,{hook:async request=>{enter();await gate;return answer(request.kind,request.input);}});
 try{
  const requests=Array.from({length:4},(_,i)=>({jobId:`tab-${i}`,taskId:f.taskId,reportLanguage:'zh'}));
  const created=await Promise.all(requests.map(input=>f.service.create(input)));await entered;
  assert.equal(new Set(created.map(j=>j.id)).size,1);assert.equal(created.filter(j=>j.reused===true).length,3);
  assert.equal((await f.service.list(f.taskId)).length,1);release();await f.service.waitForIdle();const calls=f.calls.length;
  const before=await f.service.getResult(created[0].id);await f.restart();f.setConfig({configured:false,apiKey:null});
  const recovered=await f.service.create({jobId:'after-restart',taskId:f.taskId,reportLanguage:'en'});
  assert.equal(recovered.id,created[0].id);assert.equal(recovered.reused,true);assert.equal(recovered.options.reportLanguage,'zh');
  assert.equal(f.calls.length,calls);assert.deepEqual((await f.service.getResult(recovered.id)).snapshot,before.snapshot);
  assert.equal((await fs.readdir(path.join(f.dir,'report-jobs'))).length,1);
 }finally{release();}
});

test('01117 semantic snapshot changes create a new job without changing historical outputs',async t=>{
 const f=await fixture(t);await f.service.create({jobId:'before-review',taskId:f.taskId});await f.service.waitForIdle();
 const before=await f.service.getResult('before-review'),state=inputState();state.sessions[0].aiResults[1].reason='Updated verified explanation';f.setState(state);
 const changed=await f.service.create({jobId:'after-review',taskId:f.taskId});await f.service.waitForIdle();
 assert.equal(changed.id,'after-review');assert.notEqual(changed.snapshotFingerprint,before.job.snapshotFingerprint);
 assert.deepEqual((await f.service.getResult('before-review')).snapshot,before.snapshot);assert.equal((await f.service.list(f.taskId)).length,2);
});

test('01117 incomplete existing reports are mounted, never silently rerun by generate',async t=>{
 const f=await fixture(t,{hook:()=>{throw Object.assign(new Error('bad output'),{code:'INVALID_OUTPUT'});}});
 await f.service.create({jobId:'incomplete-original',taskId:f.taskId});await f.service.waitForIdle();const calls=f.calls.length;
 const mounted=await f.service.create({jobId:'incomplete-new-id',taskId:f.taskId});
 assert.equal(mounted.id,'incomplete-original');assert.equal(mounted.reused,true);assert.equal(mounted.status,'completed_with_warnings');assert.equal(f.calls.length,calls);
});

test('01117 restored partial output remains pending and retry preserves accepted translations',async t=>{
 let partial=true,accepted;const f=await fixture(t,{hook:({kind,input})=>{const result=answer(kind,input);if(kind!=='translation'||!partial)return result;if(accepted)return{items:[]};accepted=result.items[0].id;return{items:[result.items[0]]};}});
 await f.service.create({jobId:'partial-crash',taskId:f.taskId});await f.service.waitForIdle();await f.service.close();
 const file=path.join(f.dir,'report-jobs','partial-crash','job.json'),job=JSON.parse(await fs.readFile(file,'utf8')),unit=job.units.find(u=>u.partialResult);assert.ok(unit);job.status='running';unit.status='running';await fs.writeFile(file,JSON.stringify(job));
 const before=f.calls.length;await f.restart();assert.equal((await f.service.get('partial-crash')).nodes.find(n=>n.id===unit.id).status,'pending');assert.equal(f.calls.length,before);partial=false;
 await f.service.resume('partial-crash');await f.service.waitForIdle();assert.equal((await f.service.get('partial-crash')).status,'completed');assert.ok(f.calls.slice(before).filter(c=>c.kind==='translation').every(c=>!c.input.items.some(i=>i.id===accepted)));
});

test('01117 coercion events persist in attempt history and survive committed-output recovery',async t=>{
 const {prepareReportEnrichment,parseReportEnrichment}=await import('../server/report-enrichment.mjs');
 const f=await fixture(t,{hook:({kind,input})=>{const value=answer(kind,input);if(kind==='caseHighlights')value.cases.forEach(c=>c.score='5');return parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment(kind,input));}});
 await f.service.create({jobId:'audit-recovery',taskId:f.taskId});await f.service.waitForIdle();let job=await f.service.get('audit-recovery');const node=job.nodes.find(n=>n.kind==='caseHighlights');
 let detail=await f.service.getNode(job.id,node.id);assert.deepEqual(detail.attempts[0].coercion.changes.map(c=>[c.before,c.after]),[['5',5]]);
 await f.service.close();const file=path.join(f.dir,'report-jobs',job.id,'job.json'),saved=JSON.parse(await fs.readFile(file,'utf8')),unit=saved.units.find(u=>u.id===node.id);saved.status='running';unit.status='running';unit.history=[];await fs.writeFile(file,JSON.stringify(saved));await f.restart();
 detail=await f.service.getNode(job.id,node.id);assert.equal(detail.attempts[0].coercion.changes[0].after,5);const disk=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(disk.units.find(u=>u.id===node.id).history[0].coercion.changes[0].before,'5');
});
test('closing while create is waiting for workspace data never leaves a running job on disk',async t=>{
 const f=await fixture(t);let entered,release;const seen=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),read=f.store.read;
 f.store.read=async()=>{entered();await gate;return read();};const creation=f.service.create({jobId:'close-create',taskId:f.taskId});await seen;const stopping=f.service.close();release();await creation.catch(()=>{});await stopping;
 const jobFile=path.join(f.dir,'report-jobs','close-create','job.json');const disk=await fs.readFile(jobFile,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});assert.ok(!disk||disk.status!=='running','closed service cannot persist an active job');assert.equal(f.calls.length,0);
});
test('an interrupted job starts paused after restart and successful nodes survive retry of only failures',async t=>{
 let healthy=false;const f=await fixture(t,{hook:request=>{if(request.kind==='translation'&&!healthy)throw Object.assign(new Error('bad output'),{code:'INVALID_OUTPUT'});return answer(request.kind,request.input);}});
 await f.service.create({jobId:'only-failed',taskId:f.taskId});await f.service.waitForIdle();const before=f.calls.filter(call=>call.kind!=='translation').length;healthy=true;await f.service.retry('only-failed');await f.service.waitForIdle();assert.equal((await f.service.get('only-failed')).status,'completed');assert.equal(f.calls.filter(call=>call.kind!=='translation').length,before);
 const meta=path.join(f.dir,'report-jobs','only-failed','job.json');await f.service.close();const stored=JSON.parse(await fs.readFile(meta,'utf8'));stored.status='running';await fs.writeFile(meta,JSON.stringify(stored));const calls=f.calls.length;await f.restart();assert.equal((await f.service.get('only-failed')).status,'paused');assert.equal(f.calls.length,calls,'restart must not call models');
});
test('uncommitted creation folders are preserved without blocking the workspace',async t=>{
 const dir=await fs.mkdtemp((await fs.mkdir(base,{recursive:true}),base+'/orphan-'));t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const staged=path.join(dir,'report-jobs','.creating-draft-abcd');await fs.mkdir(staged,{recursive:true});await fs.writeFile(path.join(staged,'snapshot.json'),'incomplete');
 const {createReportJobStore}=await import('../server/report-job-store.mjs');const files=await createReportJobStore({dataDir:dir});assert.deepEqual(await files.list(),[]);assert.equal(await fs.readFile(path.join(staged,'snapshot.json'),'utf8'),'incomplete');await files.close();
});
test('a result read during retry uses one consistent point-in-time job status and warning set',async t=>{
 let healthy=false;const f=await fixture(t,{hook:request=>{if(request.kind==='translation'&&!healthy)throw Object.assign(new Error('bad output'),{code:'INVALID_OUTPUT'});return answer(request.kind,request.input);}});
 await f.service.create({jobId:'result-race',taskId:f.taskId});await f.service.waitForIdle();await f.restart();
 const original=fs.readFile;let release,entered;const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>entered=resolve);let intercepted=false;
 fs.readFile=async(file,...args)=>{if(!intercepted&&path.resolve(String(file))===path.resolve(f.dir,'report-jobs','result-race','n2.json')){intercepted=true;entered();await gate;}return original(file,...args);};
 try{const reading=f.service.getResult('result-race');await seen;healthy=true;await f.service.retry('result-race');await f.service.waitForIdle();release();const older=await reading;assert.equal(older.job.status,'completed_with_warnings');assert.equal(older.enrichment.status,older.job.status);assert.ok(older.enrichment.translationStats.failedTexts>0);assert.equal((await f.service.get('result-race')).status,'completed');}
 finally{release();fs.readFile=original;}
});
for(const status of ['running','paused'])test(`restart recovers committed non-translation output from ${status} before retrying`,async t=>{
 const f=await fixture(t);await f.service.create({jobId:'checkpoint-recovery',taskId:f.taskId});await f.service.waitForIdle();await f.service.close();
 const file=path.join(f.dir,'report-jobs','checkpoint-recovery','job.json'),job=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(job.units[1].kind,'caseHighlights');job.status=status;job.units[1].status='running';job.units[1].history=[];job.units[1].durationMs=0;delete job.units[1].resultSha256;await fs.writeFile(file,JSON.stringify(job));const before=f.calls.length;
 await f.restart();const recovered=await f.service.getResult('checkpoint-recovery');assert.equal(recovered.job.status,'paused');assert.equal(recovered.job.nodes[1].status,'completed');assert.equal(recovered.enrichment.excellentCases.length,1);assert.equal(f.calls.length,before);
 await f.service.resume('checkpoint-recovery');await f.service.waitForIdle();assert.equal(f.calls.length,before);assert.equal((await f.service.get('checkpoint-recovery')).status,'completed');
});
