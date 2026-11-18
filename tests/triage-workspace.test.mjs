import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createBusinessState,createImportedTask,getSessionResults,getDashboard,markPending} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot,referenceKey} from '../public/task-basis.mjs';
import {DEFAULT_REVIEW_POLICY,isAIFinal,requiresHumanReview,returnToHumanReview} from '../public/ai-triage.mjs';
async function setup(t,{failure=false,count=1}={}){
 const parent=path.resolve('tests/.onboarding-scratch');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'triage-store-')),store=await createWorkspaceStore({dataDir:dir});
 const source=await store.putSource(Buffer.from('synthetic quality conversation'),'synthetic.json'),catalog=createCatalog(),basis=createBasisSnapshot(catalog,{effectiveDate:'2026-11-11',ruleIds:['R004']});
 const raw={id:'SYN-TRIAGE-1',scene:'新品产品咨询',startedAt:'2026-11-11T09:00:00+08:00',topic:'Battery',product:'Synthetic',channel:'Chat',agent:'Agent',customer:'Customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'How long does the battery last?',at:''},{id:2,role:'客服',text:'I will check the official document.',at:''}]};
 const state=createImportedTask(createBusinessState(),{name:'Synthetic triage task',sessions:Array.from({length:count},(_,i)=>({...structuredClone(raw),id:`${raw.id}-${i+1}`})),source,basisSnapshot:basis,reviewer:'Reviewer',reviewPolicy:DEFAULT_REVIEW_POLICY});
 await store.save({baseRevision:0,mutationId:'initial',state,catalog});
 const modelConfig={getPrivate:()=>({apiKey:null,model:'synthetic',baseUrl:'http://127.0.0.1:10080/v1',authMode:'none',connectionTested:true,configured:true})};let calls=0;
 const client={inspect:async()=>{calls++;if(failure)throw Object.assign(new Error('synthetic invalid output'),{code:'invalid_output'});return {modelId:'synthetic',results:[{ruleId:'R004',verdict:'符合',reason:'The reply checks official information.',evidence:[2],referenceIds:[referenceKey(basis.policies[0],basis.policies[0].sections[0])],confidence:0.95,evidenceQuotes:[{turnId:2,quote:raw.turns[1].text,role:'客服'}],conflictsWith:[]}]};}};
 const ai=await createAiService({store,modelConfig,client,retryDelayMs:1,maxAttempts:2});t.after(async()=>{await ai.close();await store.close();assert.ok(dir.startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return {store,ai,taskId:state.tasks[0].id,setFailure:value=>failure=value,get calls(){return calls;}};
}
test('new policy freezes on task and session, AI PASS becomes final with durable source and separate human state',async t=>{
 const f=await setup(t);await f.ai.start(f.taskId,'TRIAGE-RUN-1');await f.ai.waitForIdle();const doc=await f.store.read(),s=doc.state.sessions[0];
 assert.deepEqual(s.reviewPolicy,doc.state.tasks[0].reviewPolicy);assert.equal(isAIFinal(s),true);assert.equal(s.review.status,'待审核');assert.equal(doc.state.tasks[0].status,'已完成');assert.equal(doc.state.tasks[0].progress,100);
 assert.equal(getSessionResults(s)[0].final.source,'AI终判');assert.equal(getSessionResults(s)[0].reviewed,false);
 const metrics=getDashboard(doc.state,{period:'batch',taskId:f.taskId});assert.equal(metrics.aiFinalCount,1);assert.equal(metrics.humanConfirmedCount,0);assert.equal(metrics.pendingCount,0);assert.equal(metrics.passCount,1);
});
test('retry-exhausted invalid outputs are auditable uncertain while execution remains failed',async t=>{
 const f=await setup(t,{failure:true});await f.ai.start(f.taskId,'TRIAGE-RUN-FAIL');await f.ai.waitForIdle();const doc=await f.store.read(),s=doc.state.sessions[0];
 assert.equal(f.calls,2);assert.equal(s.aiExecution.status,'failed');assert.equal(doc.state.tasks[0].aiStatus,'failed');assert.equal(s.aiDecision.status,'UNCERTAIN');assert.equal(requiresHumanReview(s),true);assert.equal(s.aiResults.length,0);
});
test('ordinary workspace updates cannot forge AI decisions or delete return audit history',async t=>{
 const f=await setup(t);await f.ai.start(f.taskId,'TRIAGE-RUN-AUDIT');await f.ai.waitForIdle();let doc=await f.store.read(),forged=structuredClone(doc.state);forged.sessions[0].aiDecision.status='FAIL';
 await assert.rejects(f.store.save({baseRevision:doc.revision,mutationId:'forge-decision',state:forged,catalog:doc.catalog}),/AI终判|不可改写|不一致/);
 const returned=returnToHumanReview(doc.state,{sessionIds:[doc.state.sessions[0].id],reason:'Audit the evidence',reviewer:'Auditor'});await f.store.save({baseRevision:doc.revision,mutationId:'return-human',state:returned,catalog:doc.catalog});doc=await f.store.read();assert.equal(requiresHumanReview(doc.state.sessions[0]),true);
 const removed=structuredClone(doc.state);delete removed.sessions[0].review.returned;removed.sessions[0].review.returnHistory=[];
 await assert.rejects(f.store.save({baseRevision:doc.revision,mutationId:'erase-return',state:removed,catalog:doc.catalog}),/退回|历史/);
});
test('uncertain failed output can be retried by resume or a new run while retaining its original decision audit',async t=>{
 for(const retry of ['resume','new-run']){
  const f=await setup(t,{failure:true});await f.ai.start(f.taskId,`FIRST-${retry}`);await f.ai.waitForIdle();assert.equal((await f.store.read()).state.sessions[0].aiDecision.status,'UNCERTAIN');f.setFailure(false);
  if(retry==='resume')await f.ai.resume(f.taskId);else await f.ai.start(f.taskId,'RETRY-NEW');await f.ai.waitForIdle();
  const doc=await f.store.read(),s=doc.state.sessions[0];assert.equal(f.ai.runtime().error,'');assert.equal(isAIFinal(s),true,retry);assert.equal(s.aiDecisionHistory.length,1);assert.equal(s.aiDecisionHistory[0].status,'UNCERTAIN');assert.equal(s.aiDecisionHistory[0].runId,`FIRST-${retry}`);assert.equal(f.calls,3);
  const erased=structuredClone(doc.state);erased.sessions[0].aiDecisionHistory=[];await assert.rejects(f.store.save({baseRevision:doc.revision,mutationId:'erase-prior-decision',state:erased,catalog:doc.catalog}),/AI|不可|审计/);
 }
});
test('human pending-evidence work is protected from AI and cannot silently become an exempt PASS',async t=>{
 const f=await setup(t,{count:2});let doc=await f.store.read();const id=doc.state.sessions[0].id,held=markPending(doc.state,id,'Official source is missing; obtain evidence first.');await f.store.save({baseRevision:doc.revision,mutationId:'human-evidence-hold',state:held,catalog:doc.catalog});
 await f.ai.start(f.taskId,'TRIAGE-MANUAL-HOLD');await f.ai.waitForIdle();doc=await f.store.read();const s=doc.state.sessions.find(s=>s.id===id);assert.equal(f.calls,1);assert.equal(s.aiExecution,undefined);assert.equal(s.review.status,'待补充');assert.equal(s.review.notes,'Official source is missing; obtain evidence first.');assert.equal(isAIFinal(s),false);assert.equal(requiresHumanReview(s),true);assert.equal(doc.state.tasks[0].status,'待审核');assert.equal(getDashboard(doc.state,{period:'batch',taskId:f.taskId}).pendingCount,1);
});
