import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createInitialState,createImportedTask,saveReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

const url=new URL('../server/ai-service.mjs',import.meta.url);
async function setup(t,{inspect,count=2,sessionOverrides={}}={}){
  assert.ok(existsSync(url),'缺少真实AI任务服务');const {createAiService}=await import(url);
  const base='D:/Codex project/outputs/service-quality-ark-integration-20261029/';
  const dir=await fs.mkdtemp(base+'test-ai-'),store=await createWorkspaceStore({dataDir:dir});
  let calls=0;const modelConfig={getPrivate:()=>({connectionTested:true,apiKey:'fixture-secret-key',model:'glm-5.3-flash',baseUrl:'https://ark.cn-beijing.volces.com/api/plan/v3'})};
  const client={inspect:async request=>{calls++;return inspect?inspect(request,calls):{results:request.basis.rules.map(r=>({ruleId:r.id,verdict:'符合',reason:'虚构会话先核对资料，没有夸大。',evidence:[2],referenceIds:[]})),modelId:'glm-5.3-flash',requestId:`fixture-request-${calls}`,promptVersion:'qa-ark-v1',usage:{total_tokens:70}};}};
  const catalog=createCatalog(),source=await store.putSource(Buffer.from('fictional original'),'fictional.json');
  const basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-10-29',ruleIds:['R004']});
  const sessions=Array.from({length:count},(_,i)=>({id:`ARK-NEW-${i+1}`,scene:'新品产品咨询',startedAt:'2026-10-01T09:00:00+08:00',topic:'虚构颜色咨询',channel:'虚构渠道',product:'虚构X2',agent:'虚构客服',customer:'虚构客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'虚构客户',at:'',text:'有哪些颜色？'},{id:2,role:'客服',speaker:'虚构客服',at:'',text:'我先核对正式资料。'}]}));
  const state=createImportedTask(createInitialState(),{name:'真实API形状验证',fileName:'fictional.json',sessions:sessions.map(s=>({...s,...sessionOverrides})),source,basisSnapshot,reviewer:'虚构审核员'});
  await store.save({state,catalog,baseRevision:0,mutationId:'initial'});
  const ai=await createAiService({store,modelConfig,client,maxAttempts:1});
  t.after(async()=>{await ai.close();await store.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
  return {store,ai,taskId:state.tasks[0].id,get calls(){return calls;},dir,modelConfig};
}

test('AI batch persists each real result and metadata without confirming human review; replay never calls twice',async t=>{
  const f=await setup(t);await f.ai.start(f.taskId,'run-1');await f.ai.waitForIdle();
  let doc=await f.store.read(),task=doc.state.tasks[0],cases=doc.state.sessions.filter(s=>s.taskId===f.taskId);
  assert.equal(task.aiStatus,'completed');assert.equal(task.aiRun.done,2);assert.equal(f.calls,2);
  for(const s of cases){assert.equal(s.aiExecution.status,'completed');assert.equal(s.review.status,'待审核');assert.deepEqual(s.review.drafts,{});assert.equal(s.aiResults.length,1);assert.match(s.aiExecution.inputSha256,/^[a-f0-9]{64}$/);}
  await f.ai.start(f.taskId,'run-1');await f.ai.waitForIdle();assert.equal(f.calls,2);
  await assert.rejects(f.ai.start(f.taskId,'run-2'),/没有|可运行|已完成/);
  // HTTP client state cannot manufacture an alternate AI conclusion after the server saved it.
  doc=await f.store.read();doc.state.sessions.find(s=>s.taskId===f.taskId).aiResults[0].verdict='不符合';
  await assert.rejects(f.store.save({baseRevision:doc.revision,mutationId:'forged',state:doc.state,catalog:doc.catalog}),/AI|原文|不可/);
});
test('AI input fingerprint distinguishes explicit context field values',async t=>{
 const fingerprints=[];
 for(const value of [1,5]){
  const f=await setup(t,{count:1,sessionOverrides:{contextFields:[{key:'rating',label:'评价星级',type:'number',value,source:{sheet:'评论',row:2,column:'星级'}}]}});
  await f.ai.start(f.taskId,'run-field');await f.ai.waitForIdle();
  fingerprints.push((await f.store.read()).state.sessions.find(s=>s.taskId===f.taskId).aiExecution.inputSha256);
 }
 assert.notEqual(fingerprints[0],fingerprints[1]);
});

test('partial failure stays visible; retry skips successes and old run IDs remain idempotent',async t=>{
  const f=await setup(t,{inspect:async(request,n)=>{if(n===2)throw Object.assign(new Error('do not echo internal payload'),{code:'rate_limit',status:429});return {results:[{ruleId:'R004',verdict:'符合',reason:'虚构通过',evidence:[2],referenceIds:[]}],modelId:'glm-5.3-flash',requestId:`ok-${n}`,promptVersion:'qa-ark-v1'};}});
  await f.ai.start(f.taskId,'run-first');await f.ai.waitForIdle();let doc=await f.store.read();
  assert.equal(doc.state.tasks[0].aiStatus,'partial');const failed=doc.state.sessions.find(s=>s.aiExecution?.status==='failed');assert.equal(failed.aiResults.length,0);assert.doesNotMatch(failed.aiExecution.error,/internal payload/);
  await f.ai.start(f.taskId,'run-retry');await f.ai.waitForIdle();assert.equal(f.calls,3);
  doc=await f.store.read();assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.equal(doc.state.tasks[0].aiRunHistory.length,1);
  await f.ai.start(f.taskId,'run-first');await f.ai.waitForIdle();assert.equal(f.calls,3);
});

test('human work is excluded and an active batch cannot be started again',async t=>{
  let release;const gate=new Promise(r=>release=r);
  const f=await setup(t,{inspect:async request=>{await gate;return {results:[{ruleId:'R004',verdict:'符合',reason:'虚构判断',evidence:[2],referenceIds:[]}],modelId:'glm-5.3-flash',promptVersion:'qa-ark-v1'};}});
  let doc=await f.store.read();const s=doc.state.sessions.find(s=>s.taskId===f.taskId);doc.state=saveReview(doc.state,s.id,{ruleId:'R004',verdict:'符合',reason:'人工已开始',evidence:[2],referenceIds:[]});await f.store.save({...doc,baseRevision:doc.revision,mutationId:'human'});
  await f.ai.start(f.taskId,'run-active');await assert.rejects(f.ai.start(f.taskId,'run-other'),/处理|运行/);release();await f.ai.waitForIdle();
  doc=await f.store.read();assert.equal(f.calls,1);assert.equal(doc.state.sessions.find(x=>x.id===s.id).aiResults.length,0);
});

test('shutdown aborts requests and persists interruption, while recovery does not auto-call the provider',async t=>{
  let called;const entered=new Promise(r=>called=r);
  const f=await setup(t,{count:1,inspect:request=>new Promise((resolve,reject)=>{called();request.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});
  await f.ai.start(f.taskId,'run-interrupt');await entered;await f.ai.close();
  const doc=await f.store.read();assert.equal(doc.state.tasks[0].aiStatus,'paused');const s=doc.state.sessions.find(s=>s.taskId===f.taskId);assert.equal(s.aiExecution.status,'failed');assert.equal(s.aiExecution.errorCode,'interrupted');assert.equal(f.calls,1);
});

test('backup busy probe includes queued controls and paused in-flight AI until checkpointed',async t=>{
 let enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 const f=await setup(t,{inspect:async()=>{enter();await gate;return{results:[{ruleId:'R004',verdict:'符合',reason:'合成判断',evidence:[2],referenceIds:[]}],modelId:'glm-5.3-flash',promptVersion:'qa-ark-v1'};}});
 try{
  assert.equal(f.ai.isBusy(),false);const starting=f.ai.start(f.taskId,'backup-busy');assert.equal(f.ai.isBusy(),true,'control is busy before its first await');await starting;await entered;
  await f.ai.pause(f.taskId);assert.equal(f.ai.runtime().queueStatus,'ready');assert.equal(f.ai.isBusy(),true,'paused UI still has an in-flight request');
  release();await f.ai.waitForIdle();assert.equal(f.ai.isBusy(),false,'stable paused queue does not dispatch itself');assert.ok(f.ai.runtime().queue.length);
  const resuming=f.ai.resume(f.taskId);assert.equal(f.ai.isBusy(),true);await resuming;await f.ai.waitForIdle();assert.equal(f.ai.isBusy(),false);
 }finally{release();}
});

