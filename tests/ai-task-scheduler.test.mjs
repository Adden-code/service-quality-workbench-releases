import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {createAiService} from '../server/ai-service.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createModelConfig} from '../server/model-config.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const result=request=>({results:request.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'合成会话按冻结规则检查。',evidence:[1],referenceIds:[]})),modelId:request.config.model,promptVersion:'synthetic-scheduler'});
async function fixture(t,{inspect,counts=[1,1,1],cleanup=()=>{},wrapStore=value=>value}={}){
  const scratch=path.resolve('tests/.scheduler-scratch');await fs.mkdir(scratch,{recursive:true});
  const dataDir=await fs.mkdtemp(path.join(scratch,'queue-'));
  let store=await createWorkspaceStore({dataDir}),ai;
  const configOptions={dataDir,env:{},protectSecret:async value=>'opaque:'+Buffer.from(value).toString('base64'),unprotectSecret:async value=>Buffer.from(value.slice(7),'base64').toString()};
  let config=await createModelConfig(configOptions);
  await config.update({baseUrl:'http://synthetic.invalid/v1',model:'synthetic-A',authMode:'none'});
  const certify=async()=>{const pending=await config.beginConnectionTest();await config.finishConnectionTest(pending.token,true);};await certify();
  const source=await store.putSource(Buffer.from('Synthetic queue source; no business records.'),'synthetic.json'),catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-11',ruleIds:['R004']});
  let state=createBusinessState();const taskIds=[];
  for(let index=0;index<counts.length;index++){
    const name=`Synthetic task ${index+1}`;
    state=createImportedTask(state,{name,source,reviewer:'Synthetic reviewer',basisSnapshot,sessions:Array.from({length:counts[index]},(_,row)=>({id:`SYNTH-${index+1}-${row+1}`,scene:'新品产品咨询',startedAt:'2026-11-10T09:00:00+08:00',topic:'Synthetic',channel:'Synthetic',product:'Synthetic',agent:'Synthetic',customer:'Synthetic',completeness:'完整',missingNote:'',turns:[{id:1,role:'客服',text:'我先核对正式产品资料。'}]}))});
    taskIds.push(state.tasks.find(task=>task.name===name).id);
  }
  await store.save({baseRevision:0,mutationId:'synthetic-scheduler',state,catalog});
  const calls=[],errors=[],client={inspect:async request=>{calls.push(structuredClone({sessionId:request.session.externalId,config:request.config}));return inspect?inspect(request,calls.length):result(request);}};
  const service=()=>createAiService({store:wrapStore(store),modelConfig:config,client,maxAttempts:1,retryDelayMs:1,onError:error=>errors.push(error)});
  ai=await service();
  t.after(async()=>{cleanup();await ai.close();await store.close();assert.ok(dataDir.startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  return{taskIds,calls,errors,client,certify,get store(){return store;},get ai(){return ai;},get config(){return config;},get dataDir(){return dataDir;},async restart(){await ai.close();await store.close();store=await createWorkspaceStore({dataDir});config=await createModelConfig(configOptions);ai=await service();},async read(){return store.read();}};
}

test('accepted tasks persist FIFO positions and waitForIdle drains the complete serial queue',async t=>{
  const gate=deferred(),entered=deferred();let active=0,maxActive=0;
  const f=await fixture(t,{cleanup:gate.resolve,inspect:async(request,n)=>{active++;maxActive=Math.max(maxActive,active);try{if(n===1){entered.resolve();await gate.promise;}return result(request);}finally{active--;}}});
  const [a,b,c]=f.taskIds;await f.ai.start(a,'serial-A');await entered.promise;await f.ai.start(b,'serial-B');await f.ai.start(c,'serial-C');
  let doc=await f.read();assert.equal(doc.state.tasks.find(task=>task.id===b).aiStatus,'queued');assert.equal(f.calls.length,1);
  assert.deepEqual(f.ai.runtime().queue.map(item=>[item.taskId,item.position,item.status]),[[a,1,'running'],[b,2,'queued'],[c,3,'queued']]);
  const disk=JSON.parse(await fs.readFile(path.join(f.dataDir,'workspace.json'),'utf8'));assert.deepEqual(disk.state.aiTaskQueue.entries.map(item=>item.runId),['serial-A','serial-B','serial-C']);
  const idle=f.ai.waitForIdle();gate.resolve();await idle;doc=await f.read();
  assert.deepEqual(f.calls.map(call=>call.sessionId),['SYNTH-1-1','SYNTH-2-1','SYNTH-3-1']);assert.equal(maxActive,1);assert.ok(doc.state.tasks.every(task=>task.aiStatus==='completed'));assert.deepEqual(f.ai.runtime().queue,[]);assert.deepEqual(f.errors,[]);
});

for(const terminal of ['partial','failed'])test(`${terminal} predecessor automatically starts the next task and exposes its incomplete count`,async t=>{
  const gate=deferred(),entered=deferred(),second=deferred(),secondEntered=deferred();
  const f=await fixture(t,{counts:[2,1],cleanup:()=>{gate.resolve();second.resolve();},inspect:async request=>{if(request.session.externalId==='SYNTH-1-1'){entered.resolve();await gate.promise;}if(request.session.externalId.startsWith('SYNTH-2')){secondEntered.resolve();await second.promise;}else if(terminal==='failed'||request.session.externalId==='SYNTH-1-2')throw Object.assign(new Error('Synthetic failure'),{code:'timeout'});return result(request);}});
  const [a,b]=f.taskIds;await f.ai.start(a,`${terminal}-A`);await entered.promise;await f.ai.start(b,`${terminal}-B`);gate.resolve();await secondEntered.promise;
  const doc=await f.read();assert.equal(doc.state.tasks.find(task=>task.id===a).aiStatus,terminal);assert.equal(f.ai.runtime().queue[0].taskId,b);assert.equal(f.ai.runtime().queue[0].previousIncompleteCount,1);assert.equal(f.ai.runtime().previousIncompleteCount,1);
  second.resolve();await f.ai.waitForIdle();assert.equal((await f.read()).state.tasks.find(task=>task.id===b).aiStatus,'completed');assert.equal(f.ai.runtime().previousIncompleteCount,1);
});

test('a queued task can be cancelled without a provider call and accepted run IDs remain idempotent',async t=>{
  const gate=deferred(),entered=deferred();const f=await fixture(t,{cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}});
  const [a,b,c]=f.taskIds;await f.ai.start(a,'cancel-A');await entered.promise;await f.ai.start(b,'cancel-B');await f.ai.start(c,'cancel-C');
  await f.ai.start(b,'cancel-B');assert.equal((await f.read()).state.aiTaskQueue.entries.length,3);await f.ai.cancel(b);await f.ai.cancel(b);
  assert.equal((await f.read()).state.tasks.find(task=>task.id===b).aiStatus,'cancelled');await f.ai.start(b,'cancel-B');gate.resolve();await f.ai.waitForIdle();
  assert.deepEqual(f.calls.map(call=>call.sessionId),['SYNTH-1-1','SYNTH-3-1']);assert.equal((await f.read()).state.aiTaskQueue.entries.find(item=>item.taskId===b).status,'cancelled');
});

test('a changed and successfully tested configuration holds the frozen FIFO head until explicit recovery',async t=>{
  const gate=deferred(),entered=deferred();const f=await fixture(t,{cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}});
  const [a,b,c]=f.taskIds;await f.ai.start(a,'config-A');await entered.promise;await f.ai.start(b,'config-B');await f.config.update({model:'synthetic-B'});await f.certify();await f.ai.start(c,'config-C');
  gate.resolve();await f.ai.waitForIdle();assert.equal(f.calls.length,1);let runtime=f.ai.runtime();assert.equal(runtime.queueStatus,'paused');assert.equal(runtime.queuePauseReason,'config_changed');assert.equal(runtime.queue[0].taskId,b);assert.equal(runtime.queue[0].blockedReason,'config_changed');
  await f.config.update({model:'synthetic-A'});await assert.rejects(f.ai.resumeQueue(),/测试/);assert.equal(f.calls.length,1);await f.certify();await immediate();assert.equal(f.calls.length,1);
  await f.ai.resumeQueue();await f.ai.waitForIdle();assert.equal(f.calls.length,2);runtime=f.ai.runtime();assert.equal(runtime.queue[0].taskId,c);assert.equal(runtime.queuePauseReason,'config_changed');assert.equal(f.calls[1].config.model,'synthetic-A');
  assert.doesNotMatch(JSON.stringify((await f.read()).state.aiTaskQueue),/apiKey|authorization|opaque:/i);
});

test('failed retesting of the same configuration prevents automatic dispatch of already accepted tasks',async t=>{
  const gate=deferred(),entered=deferred();const f=await fixture(t,{cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}});
  const [a,b]=f.taskIds;await f.ai.start(a,'test-A');await entered.promise;await f.ai.start(b,'test-B');const retest=await f.config.beginConnectionTest();await f.config.finishConnectionTest(retest.token,false);
  gate.resolve();await f.ai.waitForIdle();assert.equal(f.calls.length,1);assert.equal(f.ai.runtime().queuePauseReason,'connection_required');await assert.rejects(f.ai.resumeQueue(),/测试/);
  await f.certify();await f.ai.resumeQueue();await f.ai.waitForIdle();assert.equal(f.calls.length,2);
});

test('01120 pausing one task allows a queued task and a newly added task to dispatch',async t=>{
  const gate=deferred(),entered=deferred();const f=await fixture(t,{counts:[2,1,1],cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}});
  // Keep one row pending so this test isolates pause/resume, independent of new-task defaults.
  const [a,b,c]=f.taskIds;await f.ai.start(a,'pause-A',{concurrency:1});await entered.promise;await f.ai.start(b,'pause-B');await f.ai.pause(a);gate.resolve();await f.ai.waitForIdle();
  assert.equal(f.calls.length,2);assert.equal(f.ai.runtime().queueStatus,'ready');assert.deepEqual(f.ai.runtime().queue.map(item=>item.status),['paused']);
  await f.ai.start(c,'pause-C');await f.ai.waitForIdle();assert.equal(f.calls.length,3);assert.equal(f.ai.isBusy(),false);
  await f.ai.resume(a);await f.ai.waitForIdle();assert.deepEqual(f.calls.map(call=>call.sessionId),['SYNTH-1-1','SYNTH-2-1','SYNTH-3-1','SYNTH-1-2']);
});

test('restart retains queued order and cancellation while requiring an explicit queue resume',async t=>{
  const entered=deferred();let first=true;
  const f=await fixture(t,{counts:[1,1,1,1],inspect:async request=>{if(first){first=false;entered.resolve();await new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(new Error('Synthetic abort')),{once:true}));}return result(request);}});
  const [a,b,c,d]=f.taskIds;await f.ai.start(a,'restart-A');await entered.promise;await f.ai.start(b,'restart-B');await f.ai.start(c,'restart-C');await f.ai.cancel(c);await f.ai.close();
  // Recreate the last durable checkpoint of an abrupt process stop, then reopen disk.
  await f.store.updateAI(({state,catalog})=>{const task=state.tasks.find(task=>task.id===a),session=state.sessions.find(session=>session.taskId===a),queue=state.aiTaskQueue;queue.status='ready';queue.pauseReason=null;for(const entry of queue.entries)entry.blockedReason=null;queue.entries.find(entry=>entry.taskId===a).status='running';task.aiStatus='running';task.aiRun.status='running';task.aiQueue.status='running';task.aiQueue.rows[0].status='running';session.aiExecution.status='running';session.aiExecution.completedAt=null;delete session.aiExecution.error;delete session.aiExecution.errorCode;return{state,catalog};});
  await f.restart();await immediate();
  assert.equal(f.calls.length,1);assert.equal(f.ai.runtime().queueStatus,'paused');assert.equal(f.ai.runtime().queuePauseReason,'interrupted');assert.deepEqual(f.ai.runtime().queue.map(item=>item.runId),['restart-A','restart-B']);
  await f.ai.start(d,'restart-D');await f.ai.waitForIdle();assert.equal(f.calls.length,1);await f.ai.resumeQueue();await f.ai.waitForIdle();assert.deepEqual(f.calls.map(call=>call.sessionId),['SYNTH-1-1','SYNTH-1-1','SYNTH-2-1','SYNTH-4-1']);assert.equal((await f.read()).state.tasks.find(task=>task.id===c).aiStatus,'cancelled');
});

test('missing connectionTested cannot bypass the successful current configuration test gate',async t=>{
  const f=await fixture(t);await f.ai.close();
  const unsafe={getPrivate:()=>({configured:true,authMode:'none',baseUrl:'http://synthetic.invalid/v1',model:'synthetic-A'})};
  const service=await createAiService({store:f.store,modelConfig:unsafe,client:f.client});t.after(()=>service.close());
  await assert.rejects(service.start(f.taskIds[0],'missing-test'),/测试/);assert.equal(f.calls.length,0);
});

test('a dispatch-checkpoint storage failure pauses the queue without charging the next task',async t=>{
  const gate=deferred(),entered=deferred();
  const f=await fixture(t,{cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);},wrapStore:store=>({read:()=>store.read(),updateAI:updater=>store.updateAI(async document=>{const next=await updater(document);if(next.state.tasks.some(task=>task.name==='Synthetic task 2'&&task.aiStatus==='running'))throw Object.assign(new Error('Synthetic dispatch EIO'),{code:'EIO'});return next;})})});
  const [a,b]=f.taskIds;await f.ai.start(a,'storage-A');await entered.promise;await f.ai.start(b,'storage-B');gate.resolve();
  await assert.doesNotReject(f.ai.waitForIdle());assert.equal(f.calls.length,1);assert.equal(f.ai.runtime().queueStatus,'paused');assert.equal(f.ai.runtime().queuePauseReason,'storage_error');assert.match(f.ai.runtime().error,/存储/);assert.equal(f.ai.runtime().queue[0].taskId,b);
  assert.equal((await f.read()).state.tasks.find(task=>task.id===a).aiStatus,'completed');assert.equal((await f.read()).state.tasks.find(task=>task.id===b).aiStatus,'queued');assert.equal(f.errors.length,1);
});

test('dispatch reads a newly tested rotated key without ever persisting either synthetic key in the queue',async t=>{
  const gate=deferred(),entered=deferred(),firstKey='synthetic-old-credential',nextKey='synthetic-rotated-credential';
  const f=await fixture(t,{cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}});
  await f.config.update({authMode:'bearer',apiKey:firstKey});await f.certify();const [a,b]=f.taskIds;await f.ai.start(a,'key-A');await entered.promise;await f.ai.start(b,'key-B');await f.config.update({apiKey:nextKey});await f.certify();gate.resolve();await f.ai.waitForIdle();
  assert.equal(f.calls[0].config.apiKey,firstKey);assert.equal(f.calls[1].config.apiKey,nextKey);const disk=await fs.readFile(path.join(f.dataDir,'workspace.json'),'utf8');assert.ok(!disk.includes(firstKey)&&!disk.includes(nextKey));assert.doesNotMatch(JSON.stringify((await f.read()).state.aiTaskQueue),/apiKey|authorization|opaque:/i);
});
