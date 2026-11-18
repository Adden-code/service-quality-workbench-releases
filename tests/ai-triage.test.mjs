import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../public/ai-triage.mjs').catch(()=>({}));
const at='2026-11-11T08:00:00.000Z';
const policy={version:1,enabled:true,confidenceThreshold:0.90,calibrationStatus:'unvalidated'};
function session(){return {id:'S1',taskId:'T1',scene:'新品产品咨询',reviewPolicy:structuredClone(policy),turns:[{id:1,role:'客户',text:'Please tell me about the battery.'},{id:2,role:'客服',text:'The battery lasts for two days.'}],expectedRuleIds:['R1'],aiExecution:{status:'completed',runId:'RUN1',completedAt:at},aiResults:[{ruleId:'R1',verdict:'符合',confidence:0.95,reason:'Answered the battery question.',evidence:[2],evidenceQuotes:[{turnId:2,quote:'The battery lasts for two days.',role:'客服'}],referenceIds:['P1@V1.0#S1'],conflictsWith:[]}],review:{status:'待审核',reviewer:'Reviewer',completedAt:null,drafts:{},history:[],notes:''}};}
const derive=s=>api.deriveAIDecision(s,policy,{at,runId:'RUN1'});
test('validated high-confidence pass is AI-final, never a fabricated human confirmation',()=>{
 assert.equal(typeof api.deriveAIDecision,'function');const s=session();s.aiDecision=derive(s);
 assert.equal(s.aiDecision.status,'PASS');assert.equal(api.isAIFinal(s),true);assert.equal(api.isFinalSession(s),true);assert.equal(api.requiresHumanReview(s),false);assert.equal(s.review.status,'待审核');assert.equal(api.getReviewRouting(s).resultSource,'ai');
});
test('failure requires human and uncertain takes precedence over any claimed fail',()=>{
 const s=session();s.aiResults[0].verdict='不符合';s.aiDecision=derive(s);assert.equal(s.aiDecision.status,'FAIL');assert.equal(api.requiresHumanReview(s),true);assert.equal(api.isFinalSession(s),false);
 s.aiResults[0].confidence=0.89;s.aiDecision=derive(s);assert.equal(s.aiDecision.status,'UNCERTAIN');assert.ok(s.aiDecision.reasonCodes.includes('low_confidence'));
});
test('missing confidence, missing checks, quote mismatch, wrong role, conflicts and failed output cannot auto pass',()=>{
 const cases={missing_confidence:s=>delete s.aiResults[0].confidence,missing_checks:s=>s.expectedRuleIds.push('R2'),quote_mismatch:s=>s.aiResults[0].evidenceQuotes[0].quote='Invented quote',quote_role_mismatch:s=>s.aiResults[0].evidenceQuotes[0].role='客户',rule_conflict:s=>s.aiResults[0].conflictsWith=['R2'],output_failure:s=>{s.aiResults=[];s.aiExecution.status='failed';s.aiExecution.errorCode='invalid_output';},missing_consistency:s=>delete s.aiResults[0].conflictsWith,missing_quote:s=>delete s.aiResults[0].evidenceQuotes};
 for(const [label,change] of Object.entries(cases)){const s=session();change(s);s.aiDecision=derive(s);assert.equal(s.aiDecision.status,'UNCERTAIN',label);assert.equal(api.isAIFinal(s),false,label);assert.equal(api.requiresHumanReview(s),true,label);}
});
test('new unprocessed conversations are not pending AI review; manual drafts remain independently reviewable',()=>{
 const s=session();s.aiResults=[];delete s.aiExecution;assert.equal(api.getReviewRouting(s).status,'NOT_RUN');assert.equal(api.requiresHumanReview(s),false);assert.equal(api.isFinalSession(s),false);
 s.review.drafts.R1={ruleId:'R1',verdict:'符合'};assert.equal(api.requiresHumanReview(s),true);
 const legacy=session();delete legacy.reviewPolicy;assert.equal(api.requiresHumanReview(legacy),true);assert.equal(api.isAIFinal(legacy),false);
});
test('per-task and per-scene pending counts count fail, uncertain and returned once',()=>{
 const pass=session();pass.aiDecision=derive(pass);const fail=session();fail.id='S2';fail.aiResults[0].verdict='不符合';fail.aiDecision=derive(fail);
 const unknown=session();unknown.id='S3';unknown.taskId='T2';unknown.scene='电商评论回复';unknown.aiResults[0].confidence=0.1;unknown.aiDecision=derive(unknown);
 const state={tasks:[{id:'T1',name:'Product',scene:'新品产品咨询'},{id:'T2',name:'Reviews',scene:'电商评论回复'}],sessions:[pass,fail,unknown],activity:[]};
 const count=api.reviewQueueBreakdown(state);assert.equal(count.total,2);assert.equal(count.aiFinal,1);assert.deepEqual(count.byTask.map(r=>[r.taskId,r.count]),[['T1',1],['T2',1]]);
 const returned=api.returnToHumanReview(state,{sessionIds:['S1','S1'],reason:'Check this answer.',reviewer:'Reviewer',now:at});assert.equal(api.reviewQueueBreakdown(returned).total,3);assert.equal(returned.sessions[0].review.returnHistory.length,1);assert.deepEqual(returned.sessions[0].aiDecision,pass.aiDecision);assert.equal(state.sessions[0].review.returnHistory,undefined);
 const again=api.returnToHumanReview(returned,{sessionIds:['S1'],reason:'Check this answer.',reviewer:'Reviewer',now:at});assert.equal(again.sessions[0].review.returnHistory.length,1);
});
test('task/rule return selects only matching AI-final records and confirmed human decisions retain precedence',()=>{
 const a=session();a.aiDecision=derive(a);const b=session();b.id='S2';b.expectedRuleIds=['R9'];b.aiResults[0].ruleId='R9';b.aiDecision=derive(b);
 const state={tasks:[{id:'T1',name:'Task'}],sessions:[a,b],activity:[]};
 const changed=api.returnToHumanReview(state,{taskId:'T1',ruleIds:['R1'],reason:'Rule audit',reviewer:'Auditor',now:at});assert.equal(api.requiresHumanReview(changed.sessions[0]),true);assert.equal(api.isAIFinal(changed.sessions[1]),true);
 changed.sessions[0].review.status='已确认';changed.sessions[0].review.completedAt=at;assert.equal(api.getReviewRouting(changed.sessions[0]).resultSource,'human');assert.equal(api.requiresHumanReview(changed.sessions[0]),false);
 assert.throws(()=>api.returnToHumanReview(state,{taskId:'T1',reason:'',reviewer:'Reviewer',now:at}),/原因/);
});
test('policy validates finite threshold and retains explicit uncalibrated status',()=>{
 assert.deepEqual(api.normalizeReviewPolicy(),policy);for(const threshold of [-1,1.1,NaN,'0.90'])assert.throws(()=>api.normalizeReviewPolicy({...policy,confidenceThreshold:threshold}));
 assert.equal(api.normalizeReviewPolicy({...policy,confidenceThreshold:0.97}).calibrationStatus,'unvalidated');
});
test('a high-confidence NA item without applicability evidence cannot exempt an otherwise passing conversation',()=>{
 const s=session();s.expectedRuleIds.push('R2');s.aiResults.push({ruleId:'R2',verdict:'不适用',reason:'No steps requested.',evidence:[],referenceIds:[],confidence:0.99,conflictsWith:[],evidenceQuotes:[]});s.aiDecision=derive(s);
 assert.equal(s.aiDecision.status,'UNCERTAIN');assert.ok(s.aiDecision.reasonCodes.includes('missing_quote'));
 s.aiResults[1].evidence=[1];s.aiResults[1].evidenceQuotes=[{turnId:1,quote:s.turns[0].text,role:'客户'}];s.aiDecision=derive(s);assert.equal(s.aiDecision.status,'PASS');
});
