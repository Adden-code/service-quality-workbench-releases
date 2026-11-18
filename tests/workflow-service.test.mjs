import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createInitialState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createEcommerceSample} from '../public/ecommerce-sample.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {EC_RULE_IDS,ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

async function setup(t,{invalidFirst=false,gate,count=3,largeResults=false,modelSettings={},maxAttempts}={}){
 const base='D:/Codex project/outputs/service-workflow-20261030';await fs.mkdir(base,{recursive:true});
 const dir=await fs.mkdtemp(base+'/unit-'),store=await createWorkspaceStore({dataDir:dir}),traces=await createWorkflowTraceStore({dataDir:dir});
 const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'完全虚构.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
 const source=await store.putSource(bytes,'完全虚构.xlsx'),catalog=ensureEcommerceCatalog(createCatalog());
 const selected=count<=18?parsed.sessions.slice(0,count):Array.from({length:count},(_,i)=>{const s=structuredClone(parsed.sessions[0]);s.ecommerce.row=i+3;s.id=ecommerceRecordId(s.ecommerce);s.externalId=s.id;Object.assign(s,ecommerceSourceProjection(s.ecommerce));return s;});
 const state=createImportedTask(createInitialState(),{name:'追踪虚构验证',reviewer:'虚构审核员',sessions:selected,source,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS})});
 const task=state.tasks[0];await store.save({state,catalog,baseRevision:0,mutationId:'initial'});let calls=0;
 const client=createArkClient({fetchImpl:async(url,options)=>{
   calls++;const payload=JSON.parse(options.body),input=JSON.parse(payload.messages[1].content);
   assert.doesNotMatch(options.body,/fixture-secret-key/);
   for(const s of parsed.sessions.slice(0,3)){if(s.ecommerce.raw[21])assert.ok(!options.body.includes(s.ecommerce.raw[21]));}
   if(gate)await gate;
   const content=invalidFirst&&calls===1?'not-json':JSON.stringify(input.session?{results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:largeResults?'x'.repeat(20000):'虚构语义结果',evidence:input.session.turns.map(t=>t.id),referenceIds:[]}))}:{similarPairs:[],checkedIds:input.representatives.map(r=>r.id)});
   return new Response(JSON.stringify({id:`fictional-${calls}`,model:'fictional-model',choices:[{finish_reason:'stop',message:{content,reasoning_content:'HIDDEN_REASONING'}}],usage:{total_tokens:30}}));
 }});
 const failures=[];const ai=await createAiService({store,traceStore:traces,client,...(maxAttempts===undefined?{}:{maxAttempts}),onError:error=>failures.push({code:error.code,message:error.message,stack:error.stack,causeCode:error.cause?.code}),modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fixture-secret-key',model:'glm-5.3-flash',...modelSettings})}});
 t.after(async()=>{await ai.close();await traces.close();await store.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return{ai,store,traces,dir,failures,taskId:task.id,get calls(){return calls;}};
}
test('actual row service exposes source-row attempt nodes and retains result snapshots without labels',async t=>{
 let release;const gate=new Promise(r=>release=r),f=await setup(t,{gate});
 await f.ai.start(f.taskId,'trace-live');let running;
 for(let i=0;i<100;i++){running=await f.traces.read('trace-live');if(running?.nodes.find(n=>n.id==='r0-a1-model')?.status==='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(running?.nodes.find(n=>n.id==='r0-a1-model')?.status,'running');assert.equal(running.nodes.find(n=>n.id==='merge'),undefined);
 release();await f.ai.waitForIdle();const done=await f.traces.read('trace-live');
 assert.equal(done.status,'completed');assert.equal(done.nodes.length,12);assert.ok(done.nodes.every(n=>n.status==='completed'));
 assert.equal(done.nodes.find(n=>n.id==='merge').output.persisted,3);
 assert.equal(done.summary.done,3);assert.doesNotMatch(JSON.stringify(done),/fixture-secret-key|HIDDEN_REASONING/);
 const saved=await f.store.read();assert.equal(saved.state.sessions.filter(s=>s.taskId===f.taskId&&s.review.status==='已确认').length,0);
});
test('MaaS traces retain the safe frozen settings and matching fingerprint without key or human labels',async t=>{
 const modelSettings={baseUrl:'http://127.0.0.1:54321/v1',model:'GLM-测试模型',authMode:'none',timeoutMs:150000,reasoningEffort:'low',maxTokens:12000};
 const f=await setup(t,{modelSettings:{...modelSettings,apiKey:null}});await f.ai.start(f.taskId,'trace-maas');await f.ai.waitForIdle();
 const run=await f.traces.read('trace-maas'),task=(await f.store.read()).state.tasks[0];
 assert.equal(task.aiStatus,'completed',JSON.stringify(f.failures));assert.deepEqual(run.meta.modelConfig,modelSettings);assert.equal(run.meta.modelConfigFingerprint,task.aiRun.modelConfigFingerprint);assert.match(run.meta.modelConfigFingerprint,/^[a-f0-9]{64}$/);
 assert.doesNotMatch(JSON.stringify(run),/fixture-secret-key|apiKey|authorization|humanReference|HIDDEN_REASONING/i);
 assert.ok(run.nodes.some(n=>n.id==='r0-a1-model'&&n.input.messages));
});
test('invalid row JSON fails its validation only; retry keeps prior run and original references',async t=>{
 const f=await setup(t,{invalidFirst:true,maxAttempts:1});const before=(await f.store.read()).state.sessions.filter(s=>s.taskId===f.taskId).map(s=>s.ecommerce);
 await f.ai.start(f.taskId,'trace-bad');await f.ai.waitForIdle();const bad=await f.traces.read('trace-bad');
 assert.equal(bad.status,'partial');assert.equal(bad.nodes.find(n=>n.id==='r0-a1-model').status,'completed');assert.equal(bad.nodes.find(n=>n.id==='r0-a1-validation').status,'failed');assert.equal(bad.nodes.find(n=>n.id==='r0-a1-validation').input.content,'not-json');assert.equal(bad.nodes.find(n=>n.id==='merge').status,'completed');
 await f.ai.start(f.taskId,'trace-retry');await f.ai.waitForIdle();assert.equal((await f.store.read()).state.tasks[0].aiStatus,'completed',JSON.stringify({runtime:f.ai.runtime(),failures:f.failures}));assert.equal(f.calls,4);
 assert.equal((await f.traces.list(f.taskId)).length,2);assert.equal((await f.traces.read('trace-bad')).status,'partial');assert.equal((await f.traces.read('trace-retry')).status,'completed');
 assert.deepEqual((await f.store.read()).state.sessions.filter(s=>s.taskId===f.taskId).map(s=>s.ecommerce),before);
});
test('an entirely failed retry is failed for that run even when task has older successful records',async()=>{
 let doc={initialized:true,state:{tasks:[{id:'task-retry',mode:'manual',aiStatus:'not_run',basisSnapshot:{rules:[]}}],sessions:[1,2].map(n=>({id:`s${n}`,taskId:'task-retry',turns:[{id:1,role:'客户',text:'虚构咨询'}],review:{status:'待审核',drafts:{}},aiResults:[]}))},catalog:{}};
 const store={read:async()=>structuredClone(doc),updateAI:async operation=>{const updated=operation(structuredClone(doc));doc={...doc,...updated};return structuredClone(doc);}};
 let calls=0;const traceRuns=[];const traceStore={begin:async run=>{traceRuns.push({...run});},step:async(_run,_node,_input,operation)=>operation(),skip:async()=>{},finish:async(id,value)=>Object.assign(traceRuns.find(r=>r.id===id),value)};
 const client={inspect:async()=>{calls++;if(calls!==1)throw Object.assign(new Error('fictional failure'),{code:'rate_limit'});return{results:[],modelId:'fixture'};}};
 const ai=await createAiService({store,traceStore,client,maxAttempts:1,modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fixture-only-key',model:'fixture'})}});
 await ai.start('task-retry','first-run');await ai.waitForIdle();assert.equal(doc.state.tasks[0].aiStatus,'partial');
 await ai.start('task-retry','retry-all-failed');await ai.waitForIdle();
 assert.equal(doc.state.tasks[0].aiStatus,'partial');
 const retry=traceRuns.find(r=>r.id==='retry-all-failed');assert.equal(retry.summary.done,0);assert.equal(retry.summary.failed,1);assert.equal(retry.summary.total,1);assert.equal(retry.status,'failed');await ai.close();
});

test('more than 64 actual nodes roll physical parts while one logical trace keeps every source row and bounded snapshots',async t=>{
 const f=await setup(t,{count:25,largeResults:true});await f.ai.start(f.taskId,'large-row-trace');await f.ai.waitForIdle();
 const runs=await f.traces.list(f.taskId),run=await f.traces.read('large-row-trace'),task=(await f.store.read()).state.tasks[0];
 assert.equal(task.aiStatus,'completed',JSON.stringify(f.failures));assert.equal(runs.length,1);assert.equal(run.nodes.length,78);assert.equal(run.meta.tracePartIds.length,2);
 assert.equal(run.summary.done,25);assert.equal(task.aiRun.done,25);assert.ok(run.nodes.some(n=>n.label.includes('原表行27')));
 const truncated=run.nodes.find(n=>n.input?.truncated);assert.ok(truncated);assert.equal(truncated.input.limitBytes,65536);assert.match(truncated.input.sha256,/^[a-f0-9]{64}$/);assert.ok(truncated.input.source.sourceRow>=3);
 for(const id of run.meta.tracePartIds){const raw=await fs.readFile(path.join(f.dir,'workflow-runs',id+'.json'));assert.ok(raw.byteLength<32*1024*1024);const part=JSON.parse(raw);assert.ok(part.nodes.length<=64);assert.ok(part.nodes.length<=4096);}
});
