import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReportEnrichment,parseReportEnrichment,validatePartialReportResult} from '../server/report-enrichment.mjs';
import {newProductContentGaps} from '../public/rule-content-health.mjs';
import {inlineAttention,orderedInlineDrafts} from '../public/ecommerce-inline-review.mjs';
import {availableSessions,reviewQueue,reviewView} from '../public/review-view.mjs';
import {applyTaskLifecycle,migrateTaskLifecycleStatus} from '../public/task-lifecycle.mjs';
import {createInitialState,saveReview,getDashboard} from '../public/domain.mjs';
import {createAiService} from '../server/ai-service.mjs';

test('0113 archived historical quality stays visible but overview pending work becomes zero',()=>{
 let state=createInitialState();const total=state.sessions.length;
 for(const task of state.tasks)state=applyTaskLifecycle(state,task.id,'archive',{actor:'Synthetic reviewer',now:'2026-11-17T08:00:00Z'});
 const stats=getDashboard(state,{period:'all'});assert.equal(stats.pendingCount,0);assert.equal(stats.totalSessions,total);
});

test('0113 startup never recovers or dispatches archived legacy comparison or running checkpoints',async()=>{
 const task={id:'archived',mode:'manual',status:'已归档',aiStatus:'running',aiQueue:{comparison:{blocks:[]}},lifecycle:{archivedAt:'2026-11-17T08:00:00Z'}},state={tasks:[task],sessions:[{id:'s',taskId:task.id,aiExecution:{status:'failed',errorCode:'dependency_incomplete'}}],aiTaskQueue:{status:'ready',pauseReason:null,entries:[{taskId:task.id,runId:'legacy',status:'running',sequence:1}]}};
 const before=structuredClone(state);let writes=0,calls=0;
 const service=await createAiService({store:{read:async()=>({initialized:true,state:structuredClone(state)}),updateAI:async()=>{writes++;throw new Error('Archived state must be untouched');}},modelConfig:{getPrivate:()=>{calls++;throw new Error('No model config needed');}},client:{}});
 await service.waitForIdle();assert.equal(service.isBusy(),false);await service.close();assert.equal(writes,0);assert.equal(calls,0);assert.deepEqual(state,before);
});

test('0113 independent translation validation keeps valid rows without relaxing evidence or language guards',()=>{
 const input={targetLang:'en',items:[{id:'a',text:'需要帮助'},{id:'b',text:'请处理问题'}]},prepared=prepareReportEnrichment('translation',input);
 const value={items:[{id:'a',translation:'Please help.',isTargetLanguage:false,detectedLanguage:'zh'},{id:'b',translation:'请处理问题',isTargetLanguage:false,detectedLanguage:'zh'}]};
 assert.throws(()=>parseReportEnrichment(JSON.stringify(value),prepared),/不完整/);
 const partial=parseReportEnrichment(JSON.stringify(value),prepared,{allowPartial:true});assert.deepEqual(partial.items.map(i=>i.id),['a']);assert.deepEqual(partial.partial.missingIds,['b']);
 assert.throws(()=>validatePartialReportResult('translation',{items:[value.items[0],value.items[0]]},input),/不完整/);
 assert.throws(()=>parseReportEnrichment(JSON.stringify(value)+JSON.stringify(value),prepared,{allowPartial:true}),/不完整/);
});
test('0113 excellent cases preserve literal valid excerpts and mark missing candidates',()=>{
 const input={candidates:[{id:'a',comment:'Good.',reply:'Glad to help.'},{id:'b',comment:'Useful.',reply:'Thank you.'}],limit:2};
 const result=parseReportEnrichment(JSON.stringify({cases:[{id:'a',score:4,commentary:'回应具体反馈。',quote:'Glad to help.'},{id:'b',score:5,commentary:'证据伪造。',quote:'invented'}]}),prepareReportEnrichment('caseHighlights',input),{allowPartial:true});
 assert.equal(result.cases.length,1);assert.equal(result.partial.acceptedCount,1);assert.deepEqual(result.partial.rejectedIds,['b']);
});
test('0113 old rule content receives an actionable warning without modifying frozen rules',()=>{
 const basis={rules:[{id:'NP-R13',exceptionCriteria:'Generic NA'},{id:'NP-R17',scope:'新品产品咨询',exceptionCriteria:'Generic'}]},before=structuredClone(basis);
 assert.equal(newProductContentGaps(basis).length,3);assert.deepEqual(basis,before);
});
test('0113 archive excludes pending queue, rejects edits, supports read-only history and restores original workflow',()=>{
 const state=createInitialState(),id=state.tasks[0].id,s=state.sessions.find(s=>s.taskId===id),before=structuredClone(state);
 const archived=applyTaskLifecycle(state,id,'archive',{actor:'Synthetic reviewer',now:'2026-11-17T08:00:00Z'});
 assert.equal(archived.tasks[0].status,'已归档');assert.ok(!availableSessions(archived).some(r=>r.taskId===id));assert.ok(!reviewQueue(archived,{reviewStatus:'全部'}).some(r=>r.taskId===id));
 assert.throws(()=>saveReview(archived,s.id,{},'2026-11-17T09:00:00Z'),/只读/);
 assert.match(reviewView(archived,{reviewTaskId:id}),/历史只读/);assert.doesNotMatch(reviewView(archived,{reviewTaskId:id}),/data-act="(confirm|reopen|ec-inline-save)/);
 const restored=applyTaskLifecycle(archived,id,'restore',{actor:'Synthetic reviewer',now:'2026-11-17T09:00:00Z'});assert.equal(restored.tasks[0].status,before.tasks[0].status);assert.deepEqual(restored.sessions,before.sessions);
 const legacy=structuredClone(archived);legacy.tasks[0].status=before.tasks[0].status;delete legacy.tasks[0].lifecycle.previousStatus;
 const migrated=migrateTaskLifecycleStatus({state:legacy,catalog:{}});assert.equal(migrated.changed,true);assert.equal(migrated.state.tasks[0].status,'已归档');assert.deepEqual(migrated.state.sessions,before.sessions);
});
test('0113 attention includes partial comparison even when another sub-check determines a verdict',()=>{
 assert.equal(inlineAttention({verdict:'符合',comparisonAssessment:{status:'incomplete'}}),true);assert.equal(inlineAttention({verdict:'不适用'}),false);assert.equal(inlineAttention({verdict:'无法判定'}),true);
});
