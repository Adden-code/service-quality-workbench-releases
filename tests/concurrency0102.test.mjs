import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {parseRawInspectionResult} from '../server/raw-inspection.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {taskStartSettings,taskDetailView} from '../public/task-workbench.mjs';
const now='2026-11-12T10:00:00+08:00';
async function fixture(t,{legacy=false,selected=4,timing=false,fail=false,outputLanguage='zh'}={}){
 const parent=path.resolve('tests/.concurrency0102');await fs.mkdir(parent,{recursive:true});
 const dataDir=await fs.mkdtemp(path.join(parent,'case-')),store=await createWorkspaceStore({dataDir});
 const bytes=await workbook([{name:'Synthetic',headers:['会话ID','客服','消息详情'],rows:Array.from({length:4},(_,n)=>['SYN-'+n,'Synthetic agent','Customer: question '+n+'.\r\nAgent: exact response.'])}]);
 const source=await store.putSource(bytes,'synthetic-concurrency.xlsx'),parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes}),catalog=createCatalog();
 if(timing){const r=catalog.rules.find(r=>r.id==='R004');r.category='服务时效';r.title='首次响应时间';}
 const basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds:timing==='mixed'?['R001','R004']:['R004'],now});
 const state=createImportedTask(createBusinessState(),{name:'Synthetic concurrency',source,sessions:parsed.sessions,basisSnapshot,reviewer:'Synthetic reviewer',executionSettings:{concurrency:selected},rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'},outputLanguage},now});
 if(legacy)delete state.tasks[0].executionSettings;
 await store.save({baseRevision:0,mutationId:'initial',state,catalog});
 let active=0,max=0,calls=0,transport=0,gate=null,release,failure=fail;
 const client=timing?createArkClient({fetchImpl:async(_url,options)=>{transport++;calls++;active++;max=Math.max(max,active);try{if(gate)await gate;await delay(2);if(failure)throw new Error('Synthetic provider network failure.');const input=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({recordId:input.record.recordId,results:input.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic valid response.',evidenceQuotes:[{quote:input.record.text}],referenceIds:rule.policyIds.map(id=>input.basis.policies.find(p=>p.id===id).sections[0].referenceKey),confidence:'0.99',conflictsWith:[]}))})}}]}),{headers:{'Content-Type':'application/json'}});}finally{active--;}}}):{engine:'synthetic',async inspectRaw(r){calls++;active++;max=Math.max(max,active);if(gate)await gate;await delay(2);active--;if(failure===true||failure==='one'&&r.session.externalId==='SYN-0')throw Object.assign(new Error('Synthetic contract failure'),{code:'INVALID_OUTPUT'});return{modelId:'synthetic-concurrency',results:parseRawInspectionResult(JSON.stringify({recordId:r.session.id,results:r.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic exact response.',evidenceQuotes:[{quote:r.session.rawTranscript.text}],referenceIds:[],confidence:0.99,conflictsWith:[]}))}),r)};}};
 const modelConfig={getPrivate:()=>({baseUrl:'http://127.0.0.1:9/v1',model:'synthetic-concurrency',authMode:'none',configured:true,connectionTested:true,timeoutMs:1000})};
 const ai=await createAiService({store,modelConfig,client,maxAttempts:1,retryDelayMs:1});
 t.after(async()=>{release?.();await ai.close();await store.close();assert.ok(dataDir.startsWith(parent+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return{state,store,ai,taskId:state.tasks[0].id,get calls(){return calls;},get max(){return max;},get transport(){return transport;},setFailure:value=>{failure=value;},async run(id,patch,expected){
  gate=new Promise(resolve=>release=resolve);max=0;
  try{await ai.start(state.tasks[0].id,id,patch);const deadline=Date.now()+8000;while(active<expected&&Date.now()<deadline)await delay(5);assert.equal(active,expected,'Expected workers must be in flight before releasing the synthetic provider.');}finally{release();gate=null;}
  await ai.waitForIdle();
 }};
}
for(const patch of [{batchSize:30},{}])test('partial raw start patch retains selected four workers: '+JSON.stringify(patch),async t=>{
 const f=await fixture(t);await f.run('PARTIAL-SETTINGS',patch,4);
 const task=(await f.store.read()).state.tasks[0];assert.equal(task.aiQueue.settings.concurrency,4);assert.equal(f.max,4);assert.equal(f.calls,4);assert.equal(task.aiStatus,'completed');
 assert.equal(task.aiQueue.settings.batchSize,patch.batchSize??20);
});
test('a legacy raw task with no stored execution settings starts at four without an offline state patch',async t=>{
 const f=await fixture(t,{legacy:true});await f.run('LEGACY-FIRST',undefined,4);assert.equal((await f.store.read()).state.tasks[0].aiQueue.settings.concurrency,4);assert.equal(f.max,4);
});
for(const concurrency of [1,2,3,4])test('explicit raw request concurrency remains '+concurrency,async t=>{
 const f=await fixture(t);await f.run('EXPLICIT-'+concurrency,{concurrency},concurrency);assert.equal(f.max,concurrency);assert.equal((await f.store.read()).state.tasks[0].aiQueue.settings.concurrency,concurrency);
});
test('partial patch retains an explicit task choice of two',async t=>{
 const f=await fixture(t,{selected:2});await f.run('SELECTED-TWO',{batchSize:9},2);assert.equal(f.max,2);assert.equal((await f.store.read()).state.tasks[0].aiQueue.settings.batchSize,9);
});
test('invalid patch cannot hide behind task defaults',async t=>{
 const f=await fixture(t);for(const value of [null,[],{concurrency:5},{concurrency:'4'},{untrusted:4}])await assert.rejects(f.ai.start(f.taskId,'INVALID',value));assert.equal(f.calls,0);
});
test('a failed legacy queue can choose a new-run concurrency through the normal detail control',async t=>{
 const f=await fixture(t,{selected:1,fail:true});await f.ai.start(f.taskId,'FIRST-FAIL');await f.ai.waitForIdle();
 const doc=await f.store.read(),task=doc.state.tasks[0],ui={taskDetailId:task.id,dataMode:'manual',rawStartConcurrency:{[task.id]:4}};
 assert.equal(task.aiQueue.status,'failed');assert.equal(taskStartSettings(task,ui).concurrency,4);
 const html=taskDetailView(doc.state,ui);assert.match(html,/id="raw-start-concurrency"/);assert.match(html,/<option value="4" selected/);
 assert.equal(task.aiQueue.settings.concurrency,1,'Merely selecting next-run concurrency must not rewrite the old queue.');
 task.aiQueue.status='paused';assert.equal(taskStartSettings(task,ui).concurrency,1);assert.doesNotMatch(taskDetailView(doc.state,ui),/id="raw-start-concurrency"/);
});
test('program-only raw time checks make zero transport requests and zero recorded model attempts',async t=>{
 const f=await fixture(t,{timing:true});await f.ai.start(f.taskId,'LOCAL-TIME');await f.ai.waitForIdle();
 const doc=await f.store.read(),task=doc.state.tasks[0];assert.equal(f.transport,0);assert.equal(task.aiStatus,'completed');
 assert.ok(task.aiQueue.rows.every(r=>r.attempts===1&&Array.isArray(r.rawAttempts)&&r.rawAttempts.length===0));
 assert.ok(doc.state.sessions.every(s=>s.aiResults[0].verdict==='无法判定'&&s.aiResults[0].reason==='未提供可靠来源时间'));
});

for(const outputLanguage of ['zh','en'])test('mixed model failure retains fixed program time and remains retryable: '+outputLanguage,async t=>{
 const f=await fixture(t,{timing:'mixed',fail:true,selected:1,outputLanguage});await f.run('MIXED-FAIL',undefined,1);
 const first=await f.store.read();assert.equal(first.state.tasks[0].aiStatus,'failed');
 for(const s of first.state.sessions){assert.equal(s.aiResults.find(r=>r.ruleId==='R004').reason,outputLanguage==='en'?'Reliable source timestamps were not provided.':'未提供可靠来源时间');assert.equal(s.aiResults.find(r=>r.ruleId==='R001').rawValidation.status,'program-fallback');}
 f.setFailure(false);await f.run('MIXED-RETRY',{concurrency:4},4);const after=await f.store.read();
 assert.equal(after.state.tasks[0].aiStatus,'completed');assert.equal(after.state.tasks[0].aiQueue.settings.concurrency,4);assert.equal(f.calls,8);
 assert.ok(after.state.sessions.every(s=>s.aiResults.find(r=>r.ruleId==='R001').verdict==='符合'&&s.aiResults.find(r=>r.ruleId==='R004').verdict==='无法判定'));
});

test('new concurrency on retry retains already successful sessions',async t=>{
 const f=await fixture(t,{selected:1,fail:'one'});await f.run('FIRST-PARTIAL',undefined,1);const first=await f.store.read(),successful=first.state.sessions.filter(s=>s.aiExecution.status==='completed');assert.equal(successful.length,3);
 f.setFailure(false);await f.run('RETRY-ONLY-ONE',{concurrency:4},1);const after=await f.store.read();assert.equal(f.calls,5);for(const s of successful)assert.deepEqual(after.state.sessions.find(x=>x.id===s.id),s);
 assert.equal(after.state.tasks[0].aiQueue.settings.concurrency,4);assert.equal(after.state.tasks[0].aiRunHistory[0].id,'FIRST-PARTIAL');
});
