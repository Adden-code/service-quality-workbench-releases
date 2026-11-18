import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAIDecision,DEFAULT_REVIEW_POLICY,getReviewPresentation} from '../public/ai-triage.mjs';
import {reviewQueue,reviewView} from '../public/review-view.mjs';
import {reviewRoutingSummary} from '../public/review-routing-ui.mjs';
import {reviewCompletion,nextPendingSession} from '../public/review-flow.mjs';
export function fixture(){
 const rule={id:'R-SYNTHETIC',title:'Synthetic',policyIds:[]};
 const row=(id,verdict)=>{const s={id,externalId:id,taskId:'T-SYNTHETIC',scene:'新品产品咨询',topic:'Synthetic',product:'Synthetic',expectedRuleIds:[rule.id],reviewPolicy:{...DEFAULT_REVIEW_POLICY},turns:[{id:1,role:'客服',text:'Synthetic answer.'}],aiExecution:{status:verdict?'completed':'not_run',runId:'synthetic-run'},aiResults:verdict?[{ruleId:rule.id,verdict,confidence:0.95,reason:'Synthetic evidence.',evidence:[1],referenceIds:[],evidenceQuotes:[{turnId:1,quote:'Synthetic answer.',role:'客服'}],conflictsWith:[]}]:[],review:{status:'待审核',reviewer:'Synthetic',drafts:{},notes:'',history:[]}};if(verdict)s.aiDecision=deriveAIDecision(s,s.reviewPolicy);return s;};
 const waiting=row('WAIT'),draft=row('DRAFT','符合'),fail=row('FAIL','不符合'),final=row('FINAL','符合');draft.review.drafts[rule.id]={verdict:'符合',reason:'Synthetic human draft.',evidence:[1],referenceIds:[]};
 return{tasks:[{id:'T-SYNTHETIC',mode:'manual',status:'待审核',scene:'新品产品咨询',name:'Synthetic',basisSnapshot:{rules:[rule],policies:[]}}],sessions:[waiting,draft,fail,final],activity:[]};
}
export const ui=extra=>({dataMode:'manual',reviewTaskId:'T-SYNTHETIC',reviewStatus:'待确认',reviewQuery:'',selectedId:'WAIT',openRules:[],highlightedTurns:[],resultFilter:'全部',...extra});
test('completed PASS with a human draft is reviewable, never mislabeled unexecuted',()=>{
 const s=fixture().sessions[1],p=getReviewPresentation(s);assert.equal(p.aiCount,1);assert.equal(p.pendingCount,0);assert.equal(p.needsReview,true);assert.equal(p.aiFinal,false);
 assert.doesNotMatch(reviewRoutingSummary(s),/AI尚未执行完成/);assert.match(reviewRoutingSummary(s),/草稿已齐，待提交确认/);
});
test('initial entry skips unexecuted records and filter counts distinguish initial from final AI decisions',()=>{
 const state=fixture(),view=ui();assert.deepEqual(reviewQueue(state,view).map(s=>s.id),['DRAFT','FAIL']);
 assert.equal(nextPendingSession(state,ui({selectedId:''})).id,'DRAFT');
 assert.deepEqual(reviewQueue(state,ui({reviewStatus:'AI初判待确认'})).map(s=>s.id),['DRAFT','FAIL']);
 assert.deepEqual(reviewQueue(state,ui({reviewStatus:'AI终判免审'})).map(s=>s.id),['FINAL']);
 const html=reviewView(state,view);assert.equal(view.selectedId,'DRAFT');assert.match(html,/AI初判待确认/);assert.match(html,/AI终判免审/);assert.equal(reviewCompletion(state,view).pending,2);
});
test('saved complete results without a routing summary remain visible and reviewable',()=>{
 const state=fixture(),s=state.sessions[1];delete s.aiDecision;assert.equal(getReviewPresentation(s).aiCount,1);assert.equal(getReviewPresentation(s).needsReview,true);
 assert.ok(reviewQueue(state,ui()).includes(s));assert.doesNotMatch(reviewRoutingSummary(s),/AI尚未执行完成/);
});
test('lifecycle and terminal human states take priority without modifying source results',()=>{
 const state=fixture(),s=state.sessions[1],before=structuredClone(s);
 assert.equal(getReviewPresentation(s,{...state.tasks[0],lifecycle:{archivedAt:'2026-11-18T00:00:00Z'}}).needsReview,false);
 assert.deepEqual(s,before);s.review.status='已确认';assert.equal(getReviewPresentation(s).pendingCount,0);
});
test('first page with no ready records explains waiting and exposes all records',()=>{
 const state=fixture();state.sessions=state.sessions.slice(0,1);const html=reviewView(state,ui());assert.match(html,/暂无待确认|没有可审核/);assert.match(html,/查看全部记录/);
});
