import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAIDecision,DEFAULT_REVIEW_POLICY,returnToHumanReview,isAIFinal,reviewQueueBreakdown} from '../public/ai-triage.mjs';
import {reviewQueue,reviewView} from '../public/review-view.mjs';
import {reviewCompletion,nextPendingSession} from '../public/review-flow.mjs';
import {setLocale} from '../public/i18n.mjs';
import {reviewRoutingSummary,reviewNavigationBadge,returnReviewDialog,triagePolicyFields,readTriagePolicy} from '../public/review-routing-ui.mjs';

const policy={...DEFAULT_REVIEW_POLICY},rule={id:'R-UI',title:'颜色回答',name:'颜色回答',policyIds:[]};
const ui=(extra={})=>({dataMode:'manual',reviewTaskId:'T-UI',reviewStatus:'全部',reviewQuery:'',selectedId:'S-PASS',openRules:['R-UI'],highlightedTurns:[],resultFilter:'全部',...extra});
function fixture(){
  const session=(id,verdict,status='completed')=>{
    const row={id,externalId:id,taskId:'T-UI',scene:'新品产品咨询',topic:'合成颜色咨询',product:'合成产品',expectedRuleIds:[rule.id],reviewPolicy:{...policy},turns:[{id:1,role:'客服',text:'仅有白色。'}],aiExecution:{status,runId:`run-${id}`},aiResults:status==='completed'?[{ruleId:rule.id,verdict,confidence:0.95,reason:'按合成规则核对原文。',evidence:[1],referenceIds:[],evidenceQuotes:[{turnId:1,quote:'仅有白色。',role:'客服'}],conflictsWith:[]}]:[],review:{status:'待审核',reviewer:'合成审核员',drafts:{},notes:'',completedAt:null}};
    if(status==='completed')row.aiDecision=deriveAIDecision(row,policy);
    return row;
  };
  const sessions=[session('S-PASS','符合'),session('S-FAIL','不符合'),session('S-UNKNOWN','无法判定'),session('S-NOTRUN','符合','not_run')];
  return {tasks:[{id:'T-UI',name:'合成批次',mode:'manual',status:'待审核',scene:'新品产品咨询',basisSnapshot:{rules:[rule],policies:[],effectiveDate:'2026-11-11'}}],sessions,activity:[]};
}

test('pending queue excludes AI PASS and new unrun records, while all records can locate either',()=>{
  const state=fixture();assert.ok(isAIFinal(state.sessions[0]));
  assert.deepEqual(reviewQueue(state,ui({reviewStatus:'待确认'})).map(row=>row.id),['S-FAIL','S-UNKNOWN']);
  assert.deepEqual(reviewQueue(state,ui({reviewStatus:'AI已判定'})).map(row=>row.id),['S-PASS']);
  assert.equal(reviewQueue(state,ui()).length,4);
  assert.equal(nextPendingSession(state,ui()).id,'S-FAIL');
});

test('AI final view labels source and threshold and offers a real return action',()=>{
  const state=fixture(),html=reviewView(state,ui({reviewStatus:'AI已判定',showReviewRecords:true}));
  assert.match(html,/已由AI判定/);assert.match(html,/0\.90/);assert.match(html,/尚未.*标定/);
  assert.match(html,/data-act="review-return"/);assert.doesNotMatch(html,/人工草稿 · 符合/);
});

test('zero pending reviews with unrun records never becomes completed work',()=>{
  const state=fixture();state.sessions=state.sessions.filter(row=>['S-PASS','S-NOTRUN'].includes(row.id));
  const info=reviewCompletion(state,ui());assert.equal(info.pending,0);assert.equal(info.aiFinal,1);assert.equal(info.notRun,1);assert.equal(info.complete,false);
  assert.doesNotMatch(reviewView(state,ui()),/<h1>全部审核完成/);
});

test('an empty pending filter on a new unrun scope renders a valid empty queue',()=>{
  const state=fixture();state.sessions=state.sessions.filter(row=>row.id==='S-NOTRUN');
  assert.doesNotThrow(()=>reviewView(state,ui({reviewStatus:'待确认'})));
  assert.match(reviewView(state,ui({reviewStatus:'待确认'})),/没有可审核的会话/);
});

test('completed mix reports human confirmation and AI adjudication separately',()=>{
  const state=fixture();state.sessions=state.sessions.slice(0,2);state.sessions[1].review.status='已确认';
  const info=reviewCompletion(state,ui());assert.equal(info.complete,true);assert.equal(info.confirmed,1);assert.equal(info.aiFinal,1);
  const html=reviewView(state,ui());assert.match(html,/AI已判定/);assert.match(html,/人工已确认/);assert.match(html,/查看全部记录/);
});

test('returned PASS re-enters pending once and preserves original AI result',()=>{
  const state=fixture(),original=structuredClone(state.sessions[0].aiResults);
  const next=returnToHumanReview(state,{sessionIds:['S-PASS','S-PASS'],reason:'合成疑点',reviewer:'合成审核员'});
  assert.deepEqual(next.sessions[0].aiResults,original);
  assert.equal(reviewQueue(next,ui({reviewStatus:'待确认'})).filter(row=>row.id==='S-PASS').length,1);
  assert.equal(reviewQueueBreakdown(next).total,3);
});

test('return controller commits single, task and rule scopes with required reason',async()=>{
  const {createReviewRoutingController}=await import('../public/review-routing-ui.mjs');
  let state=fixture(),dialog={type:'return-ai',sessionIds:['S-PASS']},commits=0;
  const controls={'return-review-reason':{value:''},'return-reviewer':{value:'合成审核员'}};
  const root={querySelector(selector){return controls[selector.slice(1)]||null;},querySelectorAll(){return [];}};
  const controller=createReviewRoutingController({getState:()=>state,getUI:()=>ui(),getDialog:()=>dialog,getRoot:()=>root,commit:async updater=>{commits++;state=updater(state);},closeDialog(){dialog=null;},render(){},navigate(){},selectSession(){},now:()=> '2026-11-11T08:00:00Z'});
  await assert.rejects(controller.handleAction('review-return-submit',{}),/原因/);assert.equal(commits,0);
  controls['return-review-reason'].value='单条合成疑点';await controller.handleAction('review-return-submit',{});assert.equal(commits,1);assert.equal(state.sessions[0].review.returned.reason,'单条合成疑点');
  for(const scope of ['task','rule']){
    state=fixture();dialog={type:'return-ai',taskId:'T-UI',scope};controls['return-review-reason'].value=`${scope}合成疑点`;
    root.querySelectorAll=()=>scope==='rule'?[{value:'R-UI',checked:true}]:[];
    await controller.handleAction('review-return-submit',{});
    assert.equal(state.sessions[0].review.returned.scope,scope);assert.equal(state.sessions[1].review.returned,undefined);
  }
});

test('policy fields and parser keep the unvalidated threshold explicit',async()=>{
  const {triagePolicyFields,readTriagePolicy}=await import('../public/review-routing-ui.mjs');
  assert.match(triagePolicyFields(),/0\.90/);assert.match(triagePolicyFields(),/尚未.*标定/);
  const root={querySelector(selector){return selector==='#triage-enabled'?{checked:true}:selector==='#triage-threshold'?{value:'0.92'}:null;}};
  assert.deepEqual(readTriagePolicy(root),{...policy,confidenceThreshold:0.92});
});

test('human independent confirmation retains final priority even if AI was never run',()=>{
  const state=fixture(),session=state.sessions.at(-1);session.review.status='已确认';
  const html=reviewRoutingSummary(session);assert.match(html,/人工已确认/);assert.match(html,/人工确认结果为最终结论/);assert.doesNotMatch(html,/未执行的记录不计为审核完成/);
});

test('blank threshold is rejected instead of silently becoming zero',()=>{
  const root={querySelector(selector){return selector==='#triage-enabled'?{checked:true}:{value:''};}};
  assert.throws(()=>readTriagePolicy(root),/0至1/);
});

test('routing, breakdown, return and threshold controls have English UI while preserving source records',()=>{
  const state=fixture(),before=JSON.stringify(state),dialog={type:'return-ai',sessionIds:['S-PASS'],reason:'原始人工输入'};
  setLocale('en');try{
    const routing=reviewRoutingSummary(state.sessions[0]);assert.match(routing,/Completed by AI/);assert.match(routing,/Threshold 0\.90/);assert.doesNotMatch(routing,/尚未用真实|标记可疑/);
    const navigation=reviewNavigationBadge(reviewQueueBreakdown(state));assert.match(navigation,/By task/);assert.match(navigation,/AI failures/);assert.doesNotMatch(navigation,/待审构成|按场景/);
    const fields=triagePolicyFields();assert.match(fields,/Review routing \(pilot\)/);assert.match(fields,/has not been calibrated/);assert.doesNotMatch(fields,/内测|门槛/);
    const body=returnReviewDialog(dialog,state).body;assert.match(body,/Return reason \(required\)/);assert.match(body,/Submit for human review/);assert.match(body,/原始人工输入/);assert.doesNotMatch(body,/退回原因（必填）|操作人标签（必填）/);
    assert.equal(JSON.stringify(state),before);
  }finally{setLocale('zh');}
});
