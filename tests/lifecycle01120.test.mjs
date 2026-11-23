import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {createAiService} from '../server/ai-service.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createModelConfig} from '../server/model-config.mjs';
import {createBusinessState,createImportedTask,saveReview,confirmReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {taskLifecycleDialog} from '../public/task-lifecycle-ui.mjs';
import {taskQueueControls,taskQueueNotice,taskQueueBadge} from '../public/task-queue-ui.mjs';
import {taskExecution} from '../public/task-workbench.mjs';
import {taskTable} from '../public/views.mjs';

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

test('01120 explicit pause-all holds new work and queue resume leaves individually paused tasks paused',async t=>{
 const entered=deferred(),gate=deferred();const f=await fixture(t,{counts:[2,1,1],cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}});
 const [a,b,c]=f.taskIds;await f.ai.start(a,'pause-all-A',{concurrency:1});await entered.promise;await f.ai.pause(a);await f.ai.pauseQueue();await f.ai.start(b,'pause-all-B');gate.resolve();await f.ai.waitForIdle();await f.ai.start(c,'pause-all-C');await f.ai.waitForIdle();
 assert.equal(f.calls.length,1);assert.equal(f.ai.runtime().queuePauseReason,'user');await f.ai.resumeQueue();await f.ai.waitForIdle();
 assert.deepEqual(f.calls.map(c=>c.sessionId),['SYNTH-1-1','SYNTH-2-1','SYNTH-3-1']);assert.equal((await f.read()).state.tasks.find(t=>t.id===a).aiStatus,'paused');
 await f.ai.resume(a);await f.ai.waitForIdle();assert.equal(f.calls.at(-1).sessionId,'SYNTH-1-2');
});

for(const paused of [false,true])test(`01120 ${paused?'paused':'running'} cancel/void drains in-flight work once, preserves human results and audits once`,async t=>{
 const entered=deferred(),gate=deferred();const f=await fixture(t,{counts:[3,1],cleanup:gate.resolve,inspect:async(request,n)=>{if(n===2){entered.resolve();await gate.promise;}return result(request);}});
 const [a,b]=f.taskIds;await f.ai.start(a,'drain-A',{concurrency:1});await entered.promise;await f.ai.start(b,'drain-B');if(paused)await f.ai.pause(a);
 let before=await f.read();const row=before.state.sessions.find(s=>s.taskId===a&&s.externalId==='SYNTH-1-1');let state=saveReview(before.state,row.id,{ruleId:'R004',verdict:'符合',reason:'Synthetic independent human confirmation',evidence:[1],referenceIds:[]},new Date().toISOString());state=confirmReview(state,row.id,new Date().toISOString());await f.store.save({baseRevision:before.revision,mutationId:'human-preserve',state,catalog:before.catalog});before=await f.read();
 const audit={actor:'Synthetic local administrator',reason:'Synthetic duplicate batch',administratorConfirmed:true,cancelAI:true};
 const cancelling=f.ai.cancel(a),voiding=f.ai.voidTask(a,audit),repeat=f.ai.voidTask(a,audit);assert.equal(voiding,repeat);
 await assert.rejects(f.ai.voidTask(a,{...audit,reason:'Different reason'}),/另一份确认/);
 await assert.rejects(f.ai.resume(a),/正在取消或作废/);await assert.rejects(f.ai.start(a,'race-start'),/正在取消或作废/);
 await immediate();assert.equal((await f.read()).state.tasks.find(t=>t.id===a).lifecycle,undefined);gate.resolve();await Promise.all([cancelling,voiding,repeat]);await f.ai.waitForIdle();
 const after=await f.read(),task=after.state.tasks.find(t=>t.id===a);assert.equal(task.status,'已作废');assert.equal(task.aiRun.status,'cancelled');assert.equal(task.lifecycle.events.length,1);assert.equal(task.lifecycle.events[0].cancelledRunId,'drain-A');assert.equal(task.lifecycle.events[0].administratorConfirmed,true);
 assert.deepEqual(after.state.sessions.find(s=>s.id===row.id),before.state.sessions.find(s=>s.id===row.id));assert.deepEqual(after.state.activity,before.state.activity);assert.deepEqual(task.basisSnapshot,before.state.tasks.find(t=>t.id===a).basisSnapshot);assert.deepEqual(task.source,before.state.tasks.find(t=>t.id===a).source);
 assert.equal(after.state.sessions.find(s=>s.taskId===a&&s.externalId==='SYNTH-1-2').aiExecution.status,'completed');assert.equal(after.state.sessions.find(s=>s.taskId===a&&s.externalId==='SYNTH-1-3').aiExecution,undefined);assert.equal(after.state.tasks.find(t=>t.id===b).aiStatus,'completed');assert.equal(f.calls.length,3);
 const revision=after.revision;await f.ai.cancel(a);await f.ai.voidTask(a,audit);assert.equal((await f.read()).revision,revision);await f.restart();assert.deepEqual((await f.read()).state,after.state);assert.deepEqual(f.errors,[]);
});

test('01120 invalid void confirmation cannot cancel any work and a cancelled task can be voided while another runs',async t=>{
 const entered=deferred(),gate=deferred();const f=await fixture(t,{counts:[2,1],cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}});
 const [a,b]=f.taskIds;await f.ai.start(a,'invalid-A',{concurrency:1});await entered.promise;await f.ai.start(b,'invalid-B');const before=await f.read();
 for(const options of [{actor:'Admin',reason:'Test',cancelAI:true},{actor:'Admin',reason:' ',administratorConfirmed:true,cancelAI:true},{actor:'Admin',reason:'Test',administratorConfirmed:true}])await assert.rejects(f.ai.voidTask(a,options),/管理员|原因|勾选/);
 assert.deepEqual((await f.read()).state,before.state);await f.ai.voidTask(b,{actor:'Admin',reason:'Queued duplicate',administratorConfirmed:true,cancelAI:true});assert.equal(f.calls.length,1);assert.equal((await f.read()).state.tasks.find(t=>t.id===b).status,'已作废');gate.resolve();await f.ai.waitForIdle();assert.equal(f.calls.length,2);
});

test('01120 individual resume does not release an explicit global hold or another paused task',async t=>{
 const f=await fixture(t);const [a,b]=f.taskIds;await f.ai.pauseQueue();await f.ai.start(a,'held-A');await f.ai.start(b,'held-B');await f.ai.pause(a);await f.ai.pause(b);await f.ai.resume(a);await f.ai.waitForIdle();assert.equal(f.calls.length,0);assert.equal(f.ai.runtime().queuePauseReason,'user');await f.ai.resumeQueue();await f.ai.waitForIdle();assert.equal(f.calls.length,1);assert.equal((await f.read()).state.tasks.find(t=>t.id===b).aiStatus,'paused');
});

test('01120 a task resume cannot bypass another frozen configuration hold or change state before rejecting',async t=>{
 const entered=deferred(),gate=deferred(),f=await fixture(t,{cleanup:gate.resolve,inspect:async(request,n)=>{if(n===1){entered.resolve();await gate.promise;}return result(request);}}),[a,b,c]=f.taskIds;
 await f.ai.start(a,'config-race-A');await entered.promise;await f.ai.start(b,'config-race-B');await f.config.update({model:'synthetic-B'});await f.certify();await f.ai.start(c,'config-race-C');gate.resolve();await f.ai.waitForIdle();await f.ai.pause(c);const before=await f.read();await assert.rejects(f.ai.resume(c),/模型或参数已变化，请新建批次重检，原批次结果保留/);assert.deepEqual(await f.read(),before);assert.equal(f.calls.length,1);
});

test('01120 paused controls, cancellation consent and global queued banner remain actionable',()=>{
 const task={id:'task',name:'Synthetic',aiStatus:'paused',aiRun:{id:'run',status:'paused'},aiQueue:{status:'paused',stopReason:'user_task'}},state={tasks:[task],sessions:[{taskId:'task',aiExecution:{status:'running'}}],aiTaskQueue:{status:'ready',pauseReason:null,entries:[{taskId:'task',runId:'run',sequence:1,status:'paused',blockedReason:'user_task'}]}};
 assert.doesNotMatch(taskQueueControls(state,task,{eligible:false}),/disabled/);assert.match(taskQueueNotice(state,task),/其他任务仍可继续/);
 let html=taskLifecycleDialog({type:'task-lifecycle',taskId:'task',action:'void'},state);assert.match(html,/lifecycle-cancel-ai/);assert.match(html,/data-act="task-lifecycle-save" disabled/);
 html=taskLifecycleDialog({type:'task-lifecycle',taskId:'task',action:'void',cancelAI:true,administratorConfirmed:true,actor:'Synthetic admin',reason:'Synthetic duplicate'},state);assert.doesNotMatch(html,/data-act="task-lifecycle-save" disabled/);assert.match(html,/lifecycle-administrator" checked/);assert.match(html,/不代表登录身份验证/);
 task.aiStatus='queued';state.aiTaskQueue.entries[0].status='queued';state.aiTaskQueue.status='paused';state.aiTaskQueue.pauseReason='user';state.aiTaskQueue.entries[0].blockedReason=null;delete task.aiQueue.stopReason;html=taskQueueNotice(state,task);assert.match(html,/全局队列已暂停/);assert.match(html,/data-act="resume-ai-queue"/);
});

test('01120 partial label counts actual failed or missing results but completed human work remains complete',()=>{
 const task={id:'task',name:'Synthetic partial',mode:'manual',status:'待审核',aiStatus:'completed'},base={taskId:'task',expectedRuleIds:['R004'],turns:[{id:1,role:'客服',text:'Synthetic'}],review:{status:'待审核',drafts:{}}};
 const state={tasks:[task],sessions:[{...structuredClone(base),id:'done',aiExecution:{status:'completed'},aiResults:[{ruleId:'R004',verdict:'符合',reason:'Synthetic',evidence:[1],referenceIds:[]}]},{...structuredClone(base),id:'failed',aiExecution:{status:'failed'},aiResults:[]},{...structuredClone(base),id:'pending',aiResults:[]}],activity:[]};
 assert.equal(taskExecution(state,task).pendingProcessing,2);assert.match(taskQueueBadge(state,task),/部分完成（2条待处理）/);assert.match(taskTable(state,[task]),/部分完成（2条待处理）/);
 for(const row of state.sessions)row.review.status='已确认';assert.equal(taskExecution(state,task).pendingProcessing,0);assert.doesNotMatch(taskQueueBadge(state,task),/部分完成/);assert.match(taskTable(state,[task]),/人工已完成/);
});

