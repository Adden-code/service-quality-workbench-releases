import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createBusinessState,createImportedTask,saveReview,confirmReview,reopenReview,getDashboard,getDashboardScope} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {applyTaskLifecycle,isArchivedTask,isVoidedTask,taskInFolder,taskVoidBlockers,usableTaskState} from '../public/task-lifecycle.mjs';
import {tasksView,exportSessions} from '../public/views.mjs';
import {getManagementReport} from '../public/management-report.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';

const scratch=path.resolve('D:/Codex project/outputs/service0104-20261115/lifecycle-tests');
const at='2026-11-15T09:00:00+08:00';
const later='2026-11-15T09:10:00+08:00';
const actor='合成审核员';
const modelConfig={getPrivate:()=>({configured:true,connectionTested:true,baseUrl:'http://127.0.0.1:9/v1',authMode:'none',apiKey:null,model:'synthetic-lifecycle',timeoutMs:1000,reasoningEffort:null,maxTokens:null}),getPublic:()=>({configured:true,connectionTested:true,baseUrl:'http://127.0.0.1:9/v1',authMode:'none',model:'synthetic-lifecycle',timeoutMs:1000,reasoningEffort:null,maxTokens:null})};
const source={name:'synthetic-lifecycle.json',sha256:'a'.repeat(64),size:20};
function taskInput(catalog,storedSource=source,index=1){
 return{name:`Synthetic lifecycle batch ${index}`,reviewer:actor,source:storedSource,basisSnapshot:createBasisSnapshot(catalog,{ruleIds:['R004'],effectiveDate:'2026-11-15',now:at}),now:at,sessions:[{id:`LIFE-SOURCE-${index}`,scene:'新品产品咨询',startedAt:'2026-11-15T08:00:00+08:00',topic:'合成颜色咨询',channel:'合成渠道',product:'合成产品',agent:'合成客服',customer:'合成客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'有哪些颜色？'},{id:2,role:'客服',text:'请查看正式产品资料中的颜色。'}]}]};
}
function inMemory(count=1){const catalog=createCatalog();let state=createBusinessState();for(let i=1;i<=count;i++)state=createImportedTask(state,taskInput(catalog,source,i));return{state,catalog,taskId:state.tasks[0].id,sessionId:state.tasks[0].sessionIds[0]};}
async function directory(){await fs.mkdir(scratch,{recursive:true});return fs.mkdtemp(path.join(scratch,'case-'));}
async function persisted(t,{count=1}={}){
 const dataDir=await directory(),cleanups=[];let store=await createWorkspaceStore({dataDir});
 const catalog=createCatalog(),storedSource=await store.putSource(Buffer.from('Synthetic original; no business data'),'synthetic-lifecycle.json');let state=createBusinessState();
 for(let i=1;i<=count;i++)state=createImportedTask(state,taskInput(catalog,storedSource,i));
 await store.save({baseRevision:0,mutationId:'initial',state,catalog});t.after(async()=>{for(const cleanup of cleanups)await cleanup();await store.close();assert.ok(path.resolve(dataDir).startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return{dataDir,taskId:state.tasks[0].id,sessionId:state.tasks[0].sessionIds[0],get store(){return store;},addCleanup(cleanup){cleanups.push(cleanup);},async restart(){await store.close();store=await createWorkspaceStore({dataDir});return store.read();}};
}
async function saveState(store,state,id){const doc=await store.read();return store.save({baseRevision:doc.revision,mutationId:id,state,catalog:doc.catalog});}

test('0104 archive and restore retain every source, frozen basis, result and audit through restart',async t=>{
 const f=await persisted(t),before=await f.store.read();assert.equal(before.state.tasks[0].lifecycle,undefined);
 const archived=await f.store.updateTaskLifecycle([f.taskId],'archive',{actor,now:at});
 assert.equal(archived.revision,before.revision+1);assert.ok(isArchivedTask(archived.state.tasks[0]));
 const {lifecycle,...task}=archived.state.tasks[0];assert.equal(task.status,'已归档');assert.equal(lifecycle.previousStatus,before.state.tasks[0].status);assert.deepEqual({...task,status:before.state.tasks[0].status},before.state.tasks[0]);assert.deepEqual(archived.state.sessions,before.state.sessions);assert.deepEqual(archived.state.activity,before.state.activity);assert.deepEqual(archived.catalog,before.catalog);
 assert.deepEqual(lifecycle.events,[{action:'archive',at,actor,reason:''}]);
 const replay=await f.store.updateTaskLifecycle([f.taskId],'archive',{actor,now:later});assert.equal(replay.revision,archived.revision);
 assert.deepEqual((await f.restart()).state,archived.state);
 const restored=await f.store.updateTaskLifecycle([f.taskId],'restore',{actor,now:later});assert.ok(!isArchivedTask(restored.state.tasks[0]));assert.deepEqual(restored.state.sessions,before.state.sessions);assert.deepEqual(restored.state.tasks[0].lifecycle.events.map(e=>e.action),['archive','restore']);
 const original=await f.store.getSource(before.state.tasks[0].source.sha256);assert.equal(original.bytes.toString(),'Synthetic original; no business data');
});

test('0104 task folders hide archive and void by default and keep separate visible audit lists',()=>{
 let {state}=inMemory(3);const [voided,archived,active]=state.tasks;
 state=applyTaskLifecycle(state,archived.id,'archive',{actor,now:at});state=applyTaskLifecycle(state,voided.id,'void',{reason:'合成测试批次作废',actor,now:at});
 assert.deepEqual(state.tasks.filter(t=>taskInFolder(t)).map(t=>t.id),[active.id]);
 assert.deepEqual(state.tasks.filter(t=>taskInFolder(t,'archived')).map(t=>t.id),[archived.id]);assert.deepEqual(state.tasks.filter(t=>taskInFolder(t,'voided')).map(t=>t.id),[voided.id]);assert.equal(state.tasks.filter(t=>taskInFolder(t,'all')).length,3);
 const html=tasksView(state,{taskFolder:'active',taskStatus:'全部'});assert.match(html,new RegExp(active.name));assert.ok(!html.includes(archived.name));assert.ok(!html.includes(voided.name));
 assert.ok(tasksView(state,{taskFolder:'archived',taskStatus:'全部'}).includes(archived.name));assert.ok(tasksView(state,{taskFolder:'voided',taskStatus:'全部'}).includes(voided.name));
});

test('0104 void requires a reason, retains original rows and blocks subsequent mutations',async t=>{
 const f=await persisted(t),before=await f.store.read();
 await assert.rejects(f.store.updateTaskLifecycle([f.taskId],'void',{reason:'  ',actor,now:at}),/原因/);await assert.rejects(f.store.updateTaskLifecycle([f.taskId],'void',{reason:'x'.repeat(2001),actor,now:at}),/原因/);
 const after=await f.store.updateTaskLifecycle([f.taskId],'void',{reason:'  重复合成测试  ',actor,now:at});assert.ok(isVoidedTask(after.state.tasks[0]));assert.equal(after.state.tasks[0].lifecycle.voidReason,'重复合成测试');assert.deepEqual(after.state.sessions,before.state.sessions);assert.deepEqual(after.state.tasks[0].basisSnapshot,before.state.tasks[0].basisSnapshot);
 for(const action of ['restore','archive','deliverable'])await assert.rejects(f.store.updateTaskLifecycle([f.taskId],action,{actor,now:later,deliveryId:'late-export'}),/作废/);
 const edited=structuredClone(after.state);edited.sessions[0].review.notes='不应允许新的审核';await assert.rejects(saveState(f.store,edited,'review-after-void'),/作废/);
 assert.deepEqual((await f.restart()).state,after.state);
});

test('0117 human confirmation may be archived and voided without erasing results',async t=>{
 const f=await persisted(t);let doc=await f.store.read();let state=saveReview(doc.state,f.sessionId,{ruleId:'R004',verdict:'符合',reason:'Synthetic review',evidence:[2],referenceIds:[]},at);state=confirmReview(state,f.sessionId,at);await saveState(f.store,state,'human-confirm');
 await f.store.updateTaskLifecycle([f.taskId],'archive',{actor,now:later});const archived=await f.store.read();const voided=await f.store.updateTaskLifecycle([f.taskId],'void',{actor,reason:'Discard synthetic task',now:later});assert.equal(voided.state.tasks[0].status,'已作废');assert.deepEqual(voided.state.sessions,archived.state.sessions);
});

test('0104 past human confirmation cannot be erased or relabelled to bypass void eligibility',async t=>{
 const f=await persisted(t);let state=(await f.store.read()).state;
 state=saveReview(state,f.sessionId,{ruleId:'R004',verdict:'符合',reason:'合成独立审核',evidence:[2],referenceIds:[]},at);state=confirmReview(state,f.sessionId,at);await saveState(f.store,state,'confirm-before-reopen');
 state=reopenReview(state,f.sessionId,later);await saveState(f.store,state,'reopen-before-bypass');
 const original=await f.store.read(),event=state.activity.find(item=>item.action==='确认审核');assert.ok(event);
 const erased=structuredClone(state);erased.activity=erased.activity.filter(item=>item.id!==event.id);await assert.rejects(saveState(f.store,erased,'erase-confirmation'),/审计|活动|确认记录/);
 const relabelled=structuredClone(state);relabelled.activity.find(item=>item.id===event.id).action='普通查看';await assert.rejects(saveState(f.store,relabelled,'relabel-confirmation'),/审计|活动|确认记录/);
 assert.deepEqual(await f.store.read(),original);const discarded=await f.store.updateTaskLifecycle([f.taskId],'void',{reason:'保留确认审计后作废',actor,now:later});assert.deepEqual(discarded.state.activity,original.state.activity);
});

test('0104 a voided test batch can be imported anew while the original remains immutable',async t=>{
 const f=await persisted(t);const original=await f.store.read();
 assert.equal(createImportedTask(original.state,taskInput(original.catalog,original.state.tasks[0].source,1)).tasks[0].importLineage.ordinal,2);
 await f.store.updateTaskLifecycle([f.taskId],'archive',{actor,now:at});let doc=await f.store.read();assert.equal(createImportedTask(doc.state,taskInput(doc.catalog,doc.state.tasks[0].source,1)).tasks[0].importLineage.ordinal,2);
 await f.store.updateTaskLifecycle([f.taskId],'void',{reason:'重新建立合成测试批次',actor,now:later});doc=await f.store.read();const old=structuredClone(doc.state.tasks[0]),oldRow=structuredClone(doc.state.sessions[0]);
 const recreated=createImportedTask(doc.state,{...taskInput(doc.catalog,old.source,1),name:'Synthetic corrected batch'});const saved=await saveState(f.store,recreated,'reimport-after-void');assert.equal(saved.state.tasks.length,2);assert.equal(saved.state.sessions.length,2);
 assert.notEqual(saved.state.tasks[0].id,f.taskId);assert.deepEqual(saved.state.tasks.find(task=>task.id===f.taskId),old);assert.deepEqual(saved.state.sessions.find(row=>row.id===f.sessionId),oldRow);assert.equal(usableTaskState(saved.state).tasks.length,1);
});

test('0104 persisted raw XLSX may be reimported after void without rewriting the former lineage or evidence',async t=>{
 const dataDir=await directory();let store=await createWorkspaceStore({dataDir});
 t.after(async()=>{await store.close();assert.ok(path.resolve(dataDir).startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const bytes=await workbook([{name:'Synthetic Raw',headers:['ID','客服','消息详情','保留列'],rows:[['RAW-LIFE-1','合成客服甲','客户：有哪些颜色？\r\n客服：请查看正式资料。','合成附加值甲'],['RAW-LIFE-2','合成客服乙','客户：规格是什么？\n客服：请查看产品规格。','合成附加值乙']],rowNumbers:[5,8]}]);
 const original=await store.putSource(bytes,'synthetic-raw-lifecycle.xlsx'),parsed=await parseRawTranscriptFile({name:original.name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,parsed.errors.join(';'));
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{ruleIds:['R004'],effectiveDate:'2026-11-15',now:at});
 const input={name:'Synthetic raw original batch',source:original,sessions:parsed.sessions,basisSnapshot,reviewer:actor,rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'},outputLanguage:'zh'},now:at};
 let state=createImportedTask(createBusinessState(),input);const oldTaskId=state.tasks[0].id,oldSessionId=state.tasks[0].sessionIds[0];
 state=saveReview(state,oldSessionId,{ruleId:'R004',verdict:'无法判定',reason:'合成草稿，尚未人工确认',evidence:[],evidenceQuotes:[],referenceIds:[]},at);
 await store.save({baseRevision:0,mutationId:'raw-initial',state,catalog});assert.equal(createImportedTask(state,input).tasks[0].importLineage.ordinal,2);
 const voided=await store.updateTaskLifecycle([oldTaskId],'void',{reason:'合成测试批次重新导入',actor,now:later}),oldTask=structuredClone(voided.state.tasks[0]),oldSessions=structuredClone(voided.state.sessions);
 const recreated=createImportedTask(voided.state,{...input,name:'Synthetic raw corrected batch',now:later});const saved=await saveState(store,recreated,'raw-reimport-after-void');
 assert.equal(saved.state.tasks.length,2);assert.equal(saved.state.sessions.length,4);assert.notEqual(saved.state.tasks[0].id,oldTaskId);assert.equal(saved.state.tasks[0].reinspectionOf,undefined,'An intentional new import is separate from a lineage-based reinspection.');
 assert.deepEqual(saved.state.tasks.find(task=>task.id===oldTaskId),oldTask);assert.deepEqual(saved.state.sessions.filter(row=>row.taskId===oldTaskId),oldSessions);
 const fresh=saved.state.sessions.filter(row=>row.taskId!==oldTaskId);assert.deepEqual(fresh.map(row=>row.externalId),oldSessions.map(row=>row.externalId));assert.deepEqual(fresh.map(row=>row.rawTranscript),oldSessions.map(row=>row.rawTranscript));assert.deepEqual(fresh.map(row=>row.rawTranscript.row),[5,8]);assert.ok(fresh.every(row=>!Object.keys(row.review.drafts).length));
 assert.equal(usableTaskState(saved.state).sessions.length,2);assert.equal((await store.getSource(original.sha256)).bytes.equals(Buffer.from(bytes)),true);
 await store.close();store=await createWorkspaceStore({dataDir});const restarted=await store.read();assert.deepEqual(restarted.state,saved.state);assert.deepEqual(restarted.catalog,saved.catalog);assert.equal((await store.getSource(original.sha256)).bytes.equals(Buffer.from(bytes)),true);
});

test('0104 running, paused or queued work cannot be voided',()=>{
 const {state,taskId}=inMemory();
 for(const status of ['queued','running','paused']){const s=structuredClone(state);s.tasks[0].aiStatus=status;assert.throws(()=>applyTaskLifecycle(s,taskId,'void',{reason:'合成测试',actor,now:at}),/队列/);}
 const s=structuredClone(state);s.sessions[0].aiExecution={status:'running'};assert.throws(()=>applyTaskLifecycle(s,taskId,'void',{reason:'合成测试',actor,now:at}),/队列/);
});

test('0104 registered delivery is idempotent and remains auditable after archive and void',async t=>{
 const f=await persisted(t);const first=await f.store.updateTaskLifecycle([f.taskId],'deliverable',{deliveryId:'delivery-1',kind:'xlsx',actor,now:at});const replay=await f.store.updateTaskLifecycle([f.taskId],'deliverable',{deliveryId:'delivery-1',kind:'xlsx',actor,now:later});assert.equal(first.revision,replay.revision);assert.equal(replay.state.tasks[0].lifecycle.deliverables.length,1);
 await f.store.updateTaskLifecycle([f.taskId],'archive',{actor,now:later});const discarded=await f.store.updateTaskLifecycle([f.taskId],'void',{reason:'保留历史交付物后作废',actor,now:later});assert.equal(discarded.state.tasks[0].lifecycle.deliverables.length,1);
});

test('0104 delivery registration before void is retained; registration after void is rejected',async t=>{
 for(const order of ['delivery-first','void-first']){
  const f=await persisted(t);const deliver=()=>f.store.updateTaskLifecycle([f.taskId],'deliverable',{deliveryId:'race-output',kind:'html',actor,now:at});const cancel=()=>f.store.updateTaskLifecycle([f.taskId],'void',{reason:'竞争合成测试',actor,now:at});
  const outcomes=await Promise.allSettled(order==='delivery-first'?[deliver(),cancel()]:[cancel(),deliver()]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,order==='delivery-first'?2:1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,order==='delivery-first'?0:1);
  const task=(await f.store.read()).state.tasks[0];assert.equal(task.lifecycle.deliverables.length,order==='delivery-first'?1:0);assert.equal(isVoidedTask(task),true);
 }
});

test('0104 registering a multi-task output is atomic when one task is voided',async t=>{
 const f=await persisted(t,{count:2});let doc=await f.store.read();const ids=doc.state.tasks.map(task=>task.id);await f.store.updateTaskLifecycle([ids[1]],'void',{reason:'合成作废',actor,now:at});const before=await f.store.read();
 await assert.rejects(f.store.updateTaskLifecycle(ids,'deliverable',{deliveryId:'all-output',kind:'xlsx',actor,now:later}),/作废/);assert.deepEqual(await f.store.read(),before);assert.equal((await f.store.read()).state.tasks[0].lifecycle,undefined);
});

test('0104 ordinary workspace saves cannot forge, erase or edit task lifecycle',async t=>{
 const f=await persisted(t);let doc=await f.store.read();const forged=applyTaskLifecycle(doc.state,f.taskId,'archive',{actor,now:at});await assert.rejects(saveState(f.store,forged,'forge-life'),/接口修改/);
 await f.store.updateTaskLifecycle([f.taskId],'archive',{actor,now:at});doc=await f.store.read();const erased=structuredClone(doc.state);delete erased.tasks[0].lifecycle;await assert.rejects(saveState(f.store,erased,'erase-life'),/接口修改/);
 const altered=structuredClone(doc.state);altered.tasks[0].lifecycle.events[0].actor='伪造审核员';await assert.rejects(saveState(f.store,altered,'change-life'),/接口修改/);
 await assert.rejects(f.store.updateAI(({state,catalog})=>({state:applyTaskLifecycle(state,f.taskId,'restore',{actor,now:later}),catalog})),/接口修改|AI更新/);
 assert.deepEqual(await f.store.read(),doc);
});

test('0104 a newly submitted task cannot arrive pre-archived or pre-voided',async t=>{
 const f=await persisted(t);const doc=await f.store.read();let state=createImportedTask(doc.state,taskInput(doc.catalog,doc.state.tasks[0].source,2));state=applyTaskLifecycle(state,state.tasks[0].id,'archive',{actor,now:at});await assert.rejects(saveState(f.store,state,'prefilled-lifecycle'),/预置生命周期/);
});

test('0104 business aggregates exclude voided rows and continue to include archived rows',()=>{
 let {state}=inMemory(3);const [voided,archived,active]=state.tasks;state=applyTaskLifecycle(state,voided.id,'void',{reason:'合成测试',actor,now:at});state=applyTaskLifecycle(state,archived.id,'archive',{actor,now:at});
 assert.deepEqual(usableTaskState(state).tasks.map(task=>task.id),[archived.id,active.id]);assert.equal(state.sessions.length,3);
 const scope=getDashboardScope(state,{period:'all',referenceDate:'2026-11-15',repeatImports:'include'});assert.equal(scope.sessions.length,2);assert.ok(scope.sessions.some(row=>row.taskId===archived.id));assert.ok(scope.sessions.every(row=>row.taskId!==voided.id));
 assert.equal(getDashboard(state,{period:'all',referenceDate:'2026-11-15',repeatImports:'include'}).totalSessions,2);assert.equal(getManagementReport(state,{period:'all',referenceDate:'2026-11-15',repeatImports:'include'}).stats.totalSessions,2);
 assert.equal(exportSessions(state,{includePending:true}).length,2);
});

test('0104 voided task cannot start an AI run or produce any model calls',async t=>{
 const f=await persisted(t);let calls=0;const ai=await createAiService({store:f.store,modelConfig,client:{inspect:async()=>{calls++;throw new Error('Must not call a model');}},maxAttempts:1});f.addCleanup(()=>ai.close());
 const before=await f.store.updateTaskLifecycle([f.taskId],'void',{reason:'合成作废',actor,now:at});await assert.rejects(ai.start(f.taskId,'VOID-RUN'),/作废/);await ai.waitForIdle();assert.equal(calls,0);assert.deepEqual(await f.store.read(),before);
});

test('0104 lifecycle HTTP validates the same-origin write contract and retains state',async t=>{
 const f=await persisted(t);await f.store.close();let calls=0;const server=await createWorkbenchServer({dataDir:f.dataDir,modelConfig,arkClient:{inspect:async()=>{calls++;throw new Error('Must not call a model');}},catalogSeed:null});server.listen(0,'127.0.0.1');await once(server,'listening');f.addCleanup(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const origin=`http://127.0.0.1:${server.address().port}`,doc=await(await fetch(origin+'/api/workspace')).json(),headers={'Content-Type':'application/json',Origin:origin,'X-Workspace-Token':doc.token};
 const post=(input,h=headers)=>fetch(origin+'/api/task-lifecycle',{method:'POST',headers:h,body:JSON.stringify(input)});
 let response=await post({taskIds:[f.taskId],action:'archive'},{'Content-Type':'application/json'});assert.equal(response.status,403);
 response=await post({taskIds:[f.taskId],action:'archive',actor});assert.equal(response.status,200);const archived=await response.json();assert.ok(isArchivedTask(archived.state.tasks[0]));assert.deepEqual(archived.state.sessions,doc.state.sessions);
 response=await post({taskIds:[f.taskId],action:'restore',actor});assert.equal(response.status,200);
 response=await post({taskIds:[f.taskId],action:'void',reason:' ',actor,administratorConfirmed:true});assert.equal(response.status,409);
 response=await post({taskIds:[f.taskId],action:'void',reason:'HTTP 合成测试批次',actor,administratorConfirmed:true});assert.equal(response.status,200);
 response=await fetch(origin+`/api/tasks/${f.taskId}/ai`,{method:'POST',headers,body:JSON.stringify({runId:'after-http-void'})});assert.ok([400,409].includes(response.status));assert.match(await response.text(),/作废/);
 response=await fetch(origin+'/api/report-jobs',{method:'POST',headers,body:JSON.stringify({jobId:'after-http-void',taskId:f.taskId})});assert.ok([400,409].includes(response.status));assert.match(await response.text(),/作废/);
 assert.equal(calls,0);
});
