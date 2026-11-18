import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {applyAIDecisions} from '../public/ai-triage.mjs';
import {EC_HEADERS,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';

const base='D:/Codex project/outputs/service-retest-20261106/task2-test-work/comparison';
const comparisonAnswer=input=>({similarPairs:[],checkedIds:input.representatives.map(rep=>rep.id)});
async function setup(t,{comparisonResponse,invalidFirstRow=false,invalidRowId,maxAttempts,comparisonMaxAttempts,retryDelayMs=25,count=3}={}){
  await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/unit-');
  const store=await createWorkspaceStore({dataDir:dir}),traceStore=await createWorkflowTraceStore({dataDir:dir});
  const rows=Array.from({length:count},(_,index)=>{
    const raw=Array(22).fill('');raw[0]='合成区域';raw[8]=`合成评论${index}`;raw[9]=`合成独立回复${index}`;raw[11]='合成同一管理员';raw[12]='2026-10-30 09:00:00';raw[13]='2026-10-30 10:00:00';raw[14]='差评';raw[15]='PRIVATE_OLD_REFERENCE';return raw;
  });
  const bytes=await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill('合成检核标准'),...rows]}]);
  const filename='比较重试_三条合成.xlsx',parsed=await parseEcommerceFile({name:filename,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
  const source=await store.putSource(bytes,filename),catalog=ensureEcommerceCatalog(createBusinessCatalog());
  const state=createImportedTask(createBusinessState(),{name:'比较自动重试合成验收',reviewer:'合成审核员',sessions:parsed.sessions,source,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-03',ruleIds:EC_RULE_IDS})});
  await store.save({state,catalog,baseRevision:0,mutationId:'comparison-retry-initial'});
  const calls=[],history=[],failures=[],counts=new Map();let rowCalls=0;
  const watchedStore={...store,async updateAI(operation){const saved=await store.updateAI(operation);const task=saved.state.tasks[0];if(task.aiQueue)history.push({phase:task.aiQueue.phase,status:task.aiQueue.status,comparison:structuredClone(task.aiQueue.comparison)});return saved;}};
  const client=createArkClient({fetchImpl:async(_url,options)=>{
    assert.ok(!options.body.includes('PRIVATE_OLD_REFERENCE'));
    const request=JSON.parse(options.body),input=JSON.parse(request.messages[1].content);let content,status=200,finishReason='stop';
    if(input.session){rowCalls++;content=invalidFirstRow&&rowCalls===1||invalidRowId?.(input.session.id)?'not-json':JSON.stringify({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'合成可核验输出',evidence:[1,2],referenceIds:[]}))});}
    else{
      const key=input.representatives.map(rep=>rep.id).sort().join('|'),attempt=(counts.get(key)||0)+1;counts.set(key,attempt);
      calls.push({key,attempt,at:performance.now(),input:structuredClone(input),system:request.messages[0].content,maxTokens:request.max_tokens});
      const answer=comparisonResponse?await comparisonResponse({input,attempt,key,store}):{value:attempt===1?{similarPairs:[],checkedIds:[]}:comparisonAnswer(input)};
      status=answer.status??200;finishReason=answer.finishReason??'stop';content=typeof answer.value==='string'?answer.value:JSON.stringify(answer.value??comparisonAnswer(input));
    }
    return new Response(JSON.stringify(status>=400?{error:{message:'synthetic provider error'}}:{model:'synthetic-retry-model',choices:[{finish_reason:finishReason,message:{content}}]}),{status});
  }});
  const ai=await createAiService({store:watchedStore,traceStore,client,retryDelayMs,...(maxAttempts===undefined?{}:{maxAttempts}),...(comparisonMaxAttempts===undefined?{}:{comparisonMaxAttempts}),onError:error=>failures.push({code:error.code,message:error.message,stack:error.stack,cause:error.cause?{code:error.cause.code,syscall:error.cause.syscall,path:error.cause.path,dest:error.cause.dest}:null}),modelConfig:{getPrivate:()=>({baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-retry-model',authMode:'none',configured:true,connectionTested:true,apiKey:null})}});
  t.after(async()=>{await ai.close();await traceStore.close();await store.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
  return{dir,store,ai,traceStore,calls,history,failures,counts,taskId:state.tasks[0].id,get rowCalls(){return rowCalls;}};
}
const taskOf=async f=>(await f.store.read()).state.tasks[0];

test('default budget retries real INVALID_OUTPUT in all three comparison blocks and completes without human intervention',async t=>{
  const f=await setup(t);await f.ai.start(f.taskId,'comparison-invalid-default',{batchSize:2});await f.ai.waitForIdle();
  const task=await taskOf(f);assert.equal(task.aiStatus,'completed',JSON.stringify({failures:f.failures,runtime:f.ai.runtime()}));assert.equal(task.aiQueue.comparison.status,'completed');
  assert.equal(task.aiQueue.comparison.blocks.length,3);assert.deepEqual([...f.counts.values()],[2,2,2]);assert.ok(task.aiQueue.comparison.blocks.every(block=>block.status==='completed'&&block.attempts===2&&!block.errorCode));assert.equal(f.rowCalls,3);
  for(const key of f.counts.keys()){const attempts=f.calls.filter(call=>call.key===key);assert.ok(attempts[1].at-attempts[0].at>=20,'automatic attempts honor configured retry delay');}
  assert.ok(!f.history.some(row=>row.comparison?.blocks.some(block=>block.status==='failed'&&block.attempts===1)),'retryable failures are not marked terminal before the budget is exhausted');
  const trace=await f.traceStore.read('comparison-invalid-default');assert.ok(trace.nodes.some(node=>node.id==='c0-a1-validation'&&node.status==='failed'));assert.ok(trace.nodes.some(node=>node.id==='c0-a2-validation'&&node.status==='completed'));assert.equal(trace.status,'completed');
});
test('comparison failures exhaust the default three attempts before their terminal failed status',async t=>{
  const f=await setup(t,{comparisonResponse:()=>({value:{similarPairs:[],checkedIds:[]}})});await f.ai.start(f.taskId,'comparison-invalid-exhausted',{batchSize:2});await f.ai.waitForIdle();
  const task=await taskOf(f);assert.equal(task.aiStatus,'partial');assert.equal(task.aiQueue.comparison.status,'failed');assert.deepEqual([...f.counts.values()],[3,3,3]);assert.ok(task.aiQueue.comparison.blocks.every(block=>block.status==='failed'&&block.attempts===3&&block.errorCode==='invalid_output'));
  assert.ok(!f.history.some(row=>row.comparison?.blocks.some(block=>block.status==='failed'&&block.attempts===1)));assert.deepEqual(f.failures,[]);
});
test('a paused invalid comparison does not dispatch a retry until explicitly resumed',async t=>{
  let release,entered;const gate=new Promise(resolve=>release=resolve),called=new Promise(resolve=>entered=resolve);
  const f=await setup(t,{comparisonResponse:async({input,attempt})=>{if(attempt===1){entered();await gate;return{value:{similarPairs:[],checkedIds:[]}};}return{value:comparisonAnswer(input)};}});
  await f.ai.start(f.taskId,'comparison-pause',{batchSize:2});await called;await f.ai.pause(f.taskId);release();await f.ai.waitForIdle();
  let task=await taskOf(f);assert.equal(task.aiStatus,'paused');assert.equal(f.calls.length,1);assert.equal(task.aiQueue.comparison.status,'pending');assert.ok(task.aiQueue.comparison.blocks.every(block=>block.status!=='failed'));
  await f.ai.resume(f.taskId);await f.ai.waitForIdle();task=await taskOf(f);assert.equal(task.aiStatus,'completed',JSON.stringify(f.failures));assert.equal(task.aiRun.id,'comparison-pause');
});
for(const status of [400,401,403])test(`fatal comparison HTTP ${status} neither retries nor dispatches later blocks`,async t=>{
  const f=await setup(t,{comparisonResponse:()=>({status})});await f.ai.start(f.taskId,`comparison-fatal-${status}`,{batchSize:2});await f.ai.waitForIdle();const task=await taskOf(f);
  assert.equal(f.calls.length,1,JSON.stringify({failures:f.failures,runtime:f.ai.runtime(),status:task.aiStatus}));assert.equal(task.aiQueue.comparison.blocks[0].attempts,1);assert.equal(task.aiQueue.comparison.blocks[0].status,'failed');assert.ok(task.aiQueue.comparison.blocks.slice(1).every(block=>block.status==='pending'&&block.attempts===0));assert.equal(task.aiQueue.stopReason,({400:'request_rejected',401:'authentication',403:'permission'})[status]);
});
test('row INVALID_OUTPUT retains its two-attempt default independently of comparison validation',async t=>{
  const f=await setup(t,{invalidFirstRow:true,comparisonResponse:({input})=>({value:comparisonAnswer(input)})});await f.ai.start(f.taskId,'row-invalid-parity',{batchSize:2});await f.ai.waitForIdle();const task=await taskOf(f);
  assert.equal(task.aiStatus,'completed',JSON.stringify(f.failures));assert.equal(f.rowCalls,4);assert.equal(task.aiQueue.rows[0].attempts,2);assert.ok(task.aiQueue.rows.slice(1).every(row=>row.attempts===1));
});

test('two invalid comparison outputs then a complete equivalent output finish automatically with bounded feedback and third-attempt trace parts',async t=>{
 const f=await setup(t,{count:5,retryDelayMs:1,comparisonResponse:({input,attempt})=>{
  if(attempt===1)return{value:JSON.stringify({similarPairs:[],checkedIds:[input.representatives[0].id,'PRIVATE_UNKNOWN_MODEL_ID']})+'\n'+'PRIVATE_PRIOR_BUSINESS_OUTPUT'.repeat(3000)};
  if(attempt===2)return{value:{similarPairs:[],checkedIds:[]}};
  const value=comparisonAnswer(input);value.checkedIds.push(...value.checkedIds);return{value:'全部指定配对已完成。\n```json\n'+JSON.stringify(value)+'\n```\n比较结束。'};
 }});
 await f.ai.start(f.taskId,'comparison-third-automatic',{batchSize:2});await f.ai.waitForIdle();const doc=await f.store.read(),task=doc.state.tasks[0];
 assert.equal(task.aiStatus,'completed',JSON.stringify({failures:f.failures,runtime:f.ai.runtime()}));assert.equal(f.rowCalls,5);assert.equal(task.aiQueue.comparison.blocks.length,10);assert.deepEqual([...f.counts.values()],Array(10).fill(3));
 assert.ok(task.aiQueue.rows.every(row=>row.attempts===1&&row.semanticResult));assert.ok(doc.state.sessions.every(session=>session.aiResults.length===5));
 for(const key of f.counts.keys()){
  const calls=f.calls.filter(call=>call.key===key);assert.equal(calls.length,3);assert.ok(!Object.hasOwn(calls[0].input,'validationFeedback'));
  for(const call of calls.slice(1)){
   const {validationFeedback,...input}=call.input;assert.deepEqual(input,calls[0].input);assert.equal(call.system,calls[0].system);assert.equal(call.maxTokens,calls[0].maxTokens);
   assert.ok(validationFeedback.codes.includes('missing_checked_ids'));assert.ok(validationFeedback.missingRepresentativeIds.every(id=>input.representatives.some(rep=>rep.id===id)));assert.ok(JSON.stringify(validationFeedback).length<4096);assert.doesNotMatch(JSON.stringify(call.input),/PRIVATE_UNKNOWN_MODEL_ID|PRIVATE_PRIOR_BUSINESS_OUTPUT/);
  }
  assert.ok(calls[1].input.validationFeedback.codes.includes('unknown_checked_ids'));assert.equal(calls[2].input.validationFeedback.counts.missingCheckedIds,calls[2].input.representatives.length);
 }
 assert.equal((await f.traceStore.list(f.taskId)).length,1);const trace=await f.traceStore.read(task.aiRun.id),traces=await Promise.all(trace.meta.tracePartIds.map(async id=>JSON.parse(await fs.readFile(path.join(f.dir,'workflow-runs',id+'.json'),'utf8'))));assert.ok(traces.length>1);assert.ok(traces.every(run=>run.nodes.length<=64&&run.status==='completed'));
 const nodes=trace.nodes;for(const index of task.aiQueue.comparison.blocks.keys()){
  const third=nodes.find(node=>node.id===`c${index}-a3-validation`);assert.equal(third.status,'completed');assert.match(third.label,/尝试3/);assert.equal(third.input.attempt,3);
  const first=nodes.find(node=>node.id===`c${index}-a1-validation`);assert.equal(first.output.kind,'ecommerceComparison');assert.ok(first.output.diagnostic.codes.includes('unknown_checked_ids'));assert.equal(first.output.content.length,20000);assert.equal(first.output.contentTruncated,true);
 }
 assert.deepEqual(f.failures,[]);t.diagnostic(JSON.stringify({syntheticRows:5,rowCalls:f.rowCalls,comparisonBlocks:10,comparisonCalls:f.calls.length,traceParts:traces.length,realModelCalls:0}));
});

test('exhausted comparisons preserve row checkpoints and manual resume runs only the failed block',async t=>{
 let failedKey,repair=false;const f=await setup(t,{retryDelayMs:1,comparisonResponse:({input,key})=>{failedKey??=key;return{value:key===failedKey&&!repair?{similarPairs:[],checkedIds:[]}:comparisonAnswer(input)};}});
 await f.ai.start(f.taskId,'comparison-selective-resume',{batchSize:2});await f.ai.waitForIdle();let doc=await f.store.read(),task=doc.state.tasks[0];
 assert.equal(task.aiStatus,'partial');assert.equal(f.rowCalls,3);assert.deepEqual([...f.counts.values()],[3,1,1]);assert.equal(task.aiQueue.comparison.blocks.filter(block=>block.status==='failed').length,1);
 assert.ok(task.aiQueue.rows.every(row=>row.semanticResult&&row.status==='completed'));assert.ok(doc.state.sessions.every(session=>session.aiResults.length===5&&session.aiExecution.status==='completed'));
 const savedRows=structuredClone(task.aiQueue.rows),successful=structuredClone(task.aiQueue.comparison.blocks.filter(block=>block.status==='completed'));repair=true;
 await f.ai.resume(f.taskId);await f.ai.waitForIdle();doc=await f.store.read();task=doc.state.tasks[0];assert.equal(task.aiStatus,'completed',JSON.stringify(f.failures));assert.equal(f.rowCalls,3);assert.deepEqual([...f.counts.values()],[4,1,1]);
 assert.deepEqual(task.aiQueue.rows.map(row=>row.semanticResult),savedRows.map(row=>row.semanticResult));for(const block of successful)assert.deepEqual(task.aiQueue.comparison.blocks.find(value=>value.id===block.id),block);
 assert.ok(doc.state.sessions.every(session=>session.aiResults.length===5));const resume=await f.traceStore.read('comparison-selective-resume.resume-1');assert.ok(!resume.nodes.some(node=>/^r\d+-/.test(node.id)));assert.equal(resume.nodes.filter(node=>/^c\d+-a\d+-model$/.test(node.id)).length,1);assert.deepEqual(f.failures,[]);
});

for(const [maxAttempts,comparisonMaxAttempts,expected] of [[1,undefined,1],[2,undefined,2],[1,3,3],[3,1,1]])test(`legacy maxAttempts ${maxAttempts} and comparison override ${comparisonMaxAttempts??'unset'} use comparison budget ${expected}`,async t=>{
 const f=await setup(t,{maxAttempts,comparisonMaxAttempts,retryDelayMs:1,comparisonResponse:()=>({value:{similarPairs:[],checkedIds:[]}})});await f.ai.start(f.taskId,`comparison-budget-${maxAttempts}-${comparisonMaxAttempts??'legacy'}`,{batchSize:2});await f.ai.waitForIdle();const task=await taskOf(f);
 assert.deepEqual([...f.counts.values()],Array(3).fill(expected));assert.ok(task.aiQueue.comparison.blocks.every(block=>block.attempts===expected&&block.status==='failed'));assert.equal(f.rowCalls,3);assert.equal(task.aiStatus,'partial');
 const trace=await f.traceStore.read(task.aiRun.id);assert.ok(!trace.nodes.some(node=>new RegExp(`^c\\d+-a${expected+1}-`).test(node.id)));assert.deepEqual(f.failures,[]);
});

test('comparison attempt override must be an integer within one through three',async()=>{
 const store={read:async()=>{throw new Error('invalid budget reached storage');}};
 for(const comparisonMaxAttempts of [0,4,1.5,'3',null])await assert.rejects(createAiService({store,comparisonMaxAttempts}),TypeError);
});
test('closing during an in-flight comparison cancels without retries or later block dispatch',async t=>{
  let release,entered;const gate=new Promise(resolve=>release=resolve),called=new Promise(resolve=>entered=resolve);
  const f=await setup(t,{comparisonResponse:async()=>{entered();await gate;return{value:{similarPairs:[],checkedIds:[]}};}});
  await f.ai.start(f.taskId,'comparison-close',{batchSize:2});await called;await f.ai.close();release();
  const task=await taskOf(f);assert.equal(task.aiStatus,'paused');assert.equal(task.aiQueue.stopReason,'interrupted');assert.equal(f.calls.length,1);assert.ok(task.aiQueue.comparison.blocks.every(block=>block.status==='pending'));assert.deepEqual(f.failures,[]);
});
test('output-token exhaustion is not retried with the same unchanged output budget',async t=>{
  const f=await setup(t,{comparisonResponse:()=>({finishReason:'length'})});await f.ai.start(f.taskId,'comparison-truncated',{batchSize:2});await f.ai.waitForIdle();const task=await taskOf(f);
  assert.equal(task.aiStatus,'partial');assert.deepEqual([...f.counts.values()],[1,1,1]);assert.ok(task.aiQueue.comparison.blocks.every(block=>block.status==='failed'&&block.errorCode==='output_truncated'));
});
test('completed comparison blocks do not hide an exhausted independent row validation failure',async t=>{
  const f=await setup(t,{invalidRowId:id=>id.endsWith('-S1'),comparisonResponse:({input})=>({value:comparisonAnswer(input)})});await f.ai.start(f.taskId,'comparison-row-failure',{batchSize:2});await f.ai.waitForIdle();
  const task=await taskOf(f);assert.equal(task.aiQueue.comparison.status,'completed');assert.equal(task.aiStatus,'partial');assert.equal(task.aiQueue.rows[0].status,'failed');assert.equal(task.aiQueue.rows[0].attempts,2);assert.equal(task.aiQueue.rows[0].errorCode,'invalid_output');assert.ok(task.aiQueue.rows.slice(1).every(row=>row.status==='completed'));assert.equal(f.rowCalls,4);
});

test('startup recovers legacy dependency-failed row checkpoints without any model request',async t=>{
 const f=await setup(t,{maxAttempts:1,comparisonResponse:()=>({value:{similarPairs:[],checkedIds:[]}})});await f.ai.start(f.taskId,'legacy-dependency-recovery');await f.ai.waitForIdle();await f.ai.close();await f.store.close();
 const filename=path.join(f.dir,'workspace.json'),doc=JSON.parse(await fs.readFile(filename,'utf8'));for(const s of doc.state.sessions){s.aiResults=[];s.aiExecution={...s.aiExecution,status:'failed',errorCode:'dependency_incomplete',error:'Legacy batch dependency incomplete'};delete s.aiDecision;delete s.aiDecisionHistory;delete s.calibrationAssignments;}const task=doc.state.tasks[0];task.aiStatus=task.aiQueue.status=task.aiRun.status='failed';task.aiRun.done=0;task.aiRun.failed=0;for(const entry of doc.state.aiTaskQueue.entries)if(entry.taskId===task.id)entry.status='failed';for(const row of task.aiQueue.rows)delete row.resultStatus;applyAIDecisions(doc.state,task,task.aiRun.completedAt);const priorDecisions=doc.state.sessions.map(s=>structuredClone(s.aiDecision));await fs.writeFile(filename,JSON.stringify(doc));
 const store=await createWorkspaceStore({dataDir:f.dir});let calls=0,service;try{service=await createAiService({store,modelConfig:{getPrivate:()=>({})},client:{inspectEcommerceRow:()=>{calls++;throw new Error('Unexpected request');}}});const restored=await store.read();assert.equal(calls,0);assert.equal(restored.state.tasks[0].aiStatus,'partial');assert.equal(restored.state.tasks[0].aiRun.done,3);for(const s of restored.state.sessions){assert.equal(s.aiResults.length,5);assert.equal(s.aiResults.find(r=>r.ruleId==='EC-TEXT').verdict,'符合');assert.equal(s.aiResults.find(r=>r.ruleId==='EC-TARGET').verdict,'无法判定');const prior=priorDecisions[restored.state.sessions.indexOf(s)];if(prior)assert.deepEqual(s.aiDecisionHistory.at(-1),prior);}await store.validateIntegrity();}finally{await service?.close();await store.close();}
});
