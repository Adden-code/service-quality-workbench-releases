import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createAiService} from '../server/ai-service.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {taskQueueControls,taskQueueInfo} from '../public/task-queue-ui.mjs';
import {applyTaskLifecycle,taskVoidBlockers} from '../public/task-lifecycle.mjs';

const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
async function fixture(t){
 const base=path.resolve('tests/.scheduler-scratch');await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'cancel0104-'));
 const store=await createWorkspaceStore({dataDir}),catalog=createCatalog(),source=await store.putSource(Buffer.from('Synthetic paused cancellation only.'),'synthetic.json');
 const basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-15',ruleIds:['R004']});
 const state=createImportedTask(createBusinessState(),{name:'合成暂停任务',reviewer:'合成审核员',basisSnapshot,source,sessions:Array.from({length:3},(_,index)=>({id:`S-${index}`,scene:'新品产品咨询',startedAt:'2026-11-15T09:00:00+08:00',topic:'合成咨询',channel:'合成',product:'合成',agent:'合成客服',customer:'合成客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客服',text:'合成回复。'}]}))});
 await store.save({baseRevision:0,mutationId:'fixture',state,catalog});
 const gate=deferred(),entered=deferred();let calls=0;
 const modelConfig={getPrivate:()=>({configured:true,connectionTested:true,baseUrl:'http://synthetic.invalid/v1',authMode:'none',model:'synthetic'})};
 const client={inspect:async request=>{calls++;if(calls===2){entered.resolve();await gate.promise;}return {results:request.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'合成回复符合规则。',evidence:[1],referenceIds:[]})),modelId:'synthetic',promptVersion:'synthetic'};}};
 let ai=await createAiService({store,modelConfig,client,maxAttempts:1});
 t.after(async()=>{gate.resolve();await ai.close();await store.close();assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return {store,taskId:state.tasks[0].id,gate,entered,get ai(){return ai;},get calls(){return calls;},async restart(){await ai.close();ai=await createAiService({store,modelConfig,client,maxAttempts:1});}};
}

test('paused cancellation waits for in-flight work, preserves saved results and enables void',async t=>{
 const f=await fixture(t);await f.ai.start(f.taskId,'paused-cancel',{concurrency:1});await f.entered.promise;await f.ai.pause(f.taskId);
 let doc=await f.store.read(),task=doc.state.tasks[0];assert.equal(taskQueueInfo(doc.state,task).canCancel,false);
 assert.match(taskQueueControls(doc.state,task),/data-act="cancel-queued-ai"[^>]*disabled/);
 await assert.rejects(f.ai.cancel(f.taskId),/当前请求结束/);assert.equal(f.calls,2);
 f.gate.resolve();await f.ai.waitForIdle();doc=await f.store.read();task=doc.state.tasks[0];
 const sessions=JSON.stringify(doc.state.sessions),rows=JSON.stringify(task.aiQueue.rows),snapshot=JSON.stringify(task.basisSnapshot);
 assert.equal(taskQueueInfo(doc.state,task).canCancel,true);assert.match(taskQueueControls(doc.state,task),/继续任务队列/);assert.match(taskQueueControls(doc.state,task),/取消本次运行/);
 assert.ok(taskVoidBlockers(doc.state,task).length);
 await f.ai.cancel(f.taskId);await f.ai.waitForIdle();doc=await f.store.read();task=doc.state.tasks[0];
 assert.equal(task.aiStatus,'cancelled');assert.equal(task.aiRun.status,'cancelled');assert.ok(task.aiRun.completedAt);
 assert.equal(JSON.stringify(doc.state.sessions),sessions);assert.equal(JSON.stringify(task.aiQueue.rows),rows);assert.equal(JSON.stringify(task.basisSnapshot),snapshot);assert.equal(f.calls,2);
 assert.equal(doc.state.aiTaskQueue.entries[0].status,'cancelled');assert.equal(doc.state.aiTaskQueue.status,'paused');assert.deepEqual(f.ai.runtime().queue,[]);
 assert.deepEqual(taskVoidBlockers(doc.state,task),[]);assert.ok(applyTaskLifecycle(doc.state,f.taskId,'void',{reason:'合成测试批次'}).tasks[0].lifecycle.voidedAt);
 const revision=doc.revision;await f.ai.cancel(f.taskId);assert.equal((await f.store.read()).revision,revision);
 await f.restart();await f.ai.waitForIdle();assert.equal(f.calls,2);assert.equal((await f.store.read()).state.tasks[0].aiStatus,'cancelled');
});

test('legacy paused run without scheduler entry cancels without resuming or discarding its frozen state',async t=>{
 const f=await fixture(t);await f.ai.start(f.taskId,'legacy-cancel',{concurrency:1});await f.entered.promise;await f.ai.pause(f.taskId);f.gate.resolve();await f.ai.waitForIdle();
 await f.store.updateAI(({state,catalog})=>{delete state.aiTaskQueue;state.tasks[0].aiQueue.stopReason='interrupted';return {state,catalog};});
 await f.restart();const before=await f.store.read();assert.equal(before.state.aiTaskQueue,undefined);
 await f.ai.cancel(f.taskId);await f.ai.waitForIdle();const after=await f.store.read();
 assert.equal(after.state.tasks[0].aiStatus,'cancelled');assert.deepEqual(after.state.sessions,before.state.sessions);assert.equal(f.calls,2);
 assert.equal(after.state.aiTaskQueue.entries.length,1);assert.equal(after.state.aiTaskQueue.entries[0].runId,'legacy-cancel');assert.equal(after.state.aiTaskQueue.entries[0].status,'cancelled');
});
