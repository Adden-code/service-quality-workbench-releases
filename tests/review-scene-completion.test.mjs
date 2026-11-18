import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCompletion,nextPendingSession,completionView} from '../public/review-flow.mjs';
import {reviewQueue,reviewView} from '../public/review-view.mjs';
import {DEFAULT_REVIEW_POLICY} from '../public/ai-triage.mjs';
import {setLocale} from '../public/i18n.mjs';

const sceneA='新品产品咨询',sceneB='电商评论回复';
const controls=extra=>({dataMode:'manual',reviewTaskId:'',reviewSceneFilter:'',reviewStatus:'待确认',reviewQuery:'',selectedId:'A1',showReviewRecords:false,openRules:[],highlightedTurns:[],resultFilter:'全部',...extra});
function fixture({secondAConfirmed=true,notRunB=false,legacy=false}={}){
  const row=(id,taskId,scene,confirmed)=>({id,externalId:id,taskId,scene,topic:`Synthetic ${id}`,expectedRuleIds:[],turns:[],aiResults:[],...(legacy?{}:{reviewPolicy:{...DEFAULT_REVIEW_POLICY}}),aiExecution:{status:'completed',runId:id},aiDecision:{status:'FAIL',runId:id,reasons:[]},review:{status:confirmed?'已确认':'待审核',drafts:{},notes:'',reviewer:'Synthetic reviewer',history:[],completedAt:confirmed?'2026-11-11T10:00:00+08:00':null}});
  const tasks=[{id:'TA1',name:'Synthetic batch one',scene:sceneA,status:'已完成',mode:'manual'},{id:'TA2',name:'Synthetic batch two',scene:sceneA,status:secondAConfirmed?'已完成':'待审核',mode:'manual'},{id:'TB',name:'Synthetic scene B batch',scene:sceneB,status:'待审核',mode:'manual'}];
  const sessions=[row('A1','TA1',sceneA,true),row('A2','TA2',sceneA,secondAConfirmed),row('B1','TB',sceneB,false)];
  if(notRunB){const unrun=row('B2','TB',sceneB,false);delete unrun.aiExecution;delete unrun.aiDecision;sessions.push(unrun);}
  return {tasks,sessions,activity:[]};
}

test('a completed selected scene shows its summary while another scene remains pending',()=>{
  const state=fixture({notRunB:true}),ui=controls({reviewSceneFilter:sceneA}),info=reviewCompletion(state,ui);
  assert.equal(reviewQueue(state,ui).length,0);assert.equal(nextPendingSession(state,ui),null);
  assert.equal(info.total,2);assert.equal(info.confirmed,2);assert.equal(info.complete,true);assert.equal(info.pending,0);assert.equal(info.notRun,0);
  assert.equal(info.globalPending,1);assert.equal(info.globalNotRun,1);assert.equal(info.otherPending,1);assert.equal(info.nextTaskId,'TB');assert.equal(info.nextSessionId,'B1');
  assert.equal(info.scopeKind,'scene');assert.match(info.scopeLabel,/新品产品咨询/);assert.doesNotMatch(info.scopeLabel,/全部/);
  const html=reviewView(state,ui);assert.match(html,/class="review-completion panel"/);assert.match(html,/本场景审核完成/);assert.match(html,/继续其他待审范围/);assert.match(html,/data-act="review-clear-scene"/);assert.doesNotMatch(html,/暂无会话|本批次审核完成|当前批次已完成/);
});

test('scene completion ignores searches but not unfinished records within that scene',()=>{
  const state=fixture({secondAConfirmed:false}),ui=controls({reviewSceneFilter:sceneA,reviewQuery:'no matches'}),info=reviewCompletion(state,ui);
  assert.equal(info.complete,false);assert.equal(info.total,2);assert.equal(info.pending,1);assert.equal(info.otherPending,1);assert.equal(info.globalPending,2);
  assert.equal(nextPendingSession(state,ui)?.id,'A2');assert.doesNotMatch(reviewView(state,ui),/class="review-completion panel"/);
});

test('task plus scene uses their intersection and counts pending work in the complement',()=>{
  const state=fixture({secondAConfirmed:false}),ui=controls({reviewTaskId:'TA1',reviewSceneFilter:sceneA}),info=reviewCompletion(state,ui);
  assert.equal(info.total,1);assert.equal(info.complete,true);assert.equal(info.otherPending,2);assert.equal(info.globalPending,2);assert.equal(info.nextTaskId,'TA2');assert.equal(info.scopeKind,'task-scene');
  assert.match(info.scopeLabel,/Synthetic batch one/);assert.match(info.scopeLabel,/新品产品咨询/);
  assert.match(reviewView(state,ui),/当前任务与场景审核完成/);
  const mismatch=reviewCompletion(state,controls({reviewTaskId:'TA1',reviewSceneFilter:sceneB}));assert.equal(mismatch.total,0);assert.equal(mismatch.complete,false);assert.equal(mismatch.otherPending,2);
});

test('unfiltered and legacy task scopes retain their previous completion behavior',()=>{
  const state=fixture({secondAConfirmed:false,legacy:true}),taskInfo=reviewCompletion(state,controls({reviewTaskId:'TA1'}));
  assert.equal(taskInfo.total,1);assert.equal(taskInfo.complete,true);assert.equal(taskInfo.scopeLabel,'Synthetic batch one');assert.equal(taskInfo.otherPending,2);assert.equal(taskInfo.scopeKind,'task');
  const all=reviewCompletion(state,controls());assert.equal(all.total,3);assert.equal(all.pending,2);assert.equal(all.otherPending,0);assert.equal(all.nextTaskId,'');assert.equal(all.scopeLabel,'全部可审核批次');assert.equal(all.scopeKind,'all');
  for(const row of state.sessions)row.review.status='已确认';
  assert.match(completionView(reviewCompletion(state,controls())),/全部审核完成/);
});

test('continue target reaches another review scope when the app clears the scene filter',()=>{
  const state=fixture(),info=reviewCompletion(state,controls({reviewSceneFilter:sceneA}));
  const next=controls({reviewTaskId:info.nextTaskId,reviewSceneFilter:'',selectedId:info.nextSessionId});
  assert.deepEqual(reviewQueue(state,next).map(row=>row.id),['B1']);assert.equal(reviewCompletion(state,next).pending,1);assert.equal(reviewCompletion(state,next).complete,false);
});

test('scene and combined-scope completion copy is translated without translating task source names',()=>{
  const state=fixture();setLocale('en');try{
    const sceneHtml=completionView(reviewCompletion(state,controls({reviewSceneFilter:sceneA})));assert.match(sceneHtml,/Scenario review complete/);assert.match(sceneHtml,/Scenario:/);assert.match(sceneHtml,/Continue other pending scopes/);assert.doesNotMatch(sceneHtml,/本场景审核完成|其他审核范围|新品产品咨询/);
    const bothHtml=completionView(reviewCompletion(state,controls({reviewTaskId:'TA1',reviewSceneFilter:sceneA})));assert.match(bothHtml,/Task and scenario review complete/);assert.match(bothHtml,/Synthetic batch one/);assert.match(bothHtml,/Scenario:/);
  }finally{setLocale('zh');}
});

test('legacy task completion actions retain their English labels',()=>{
  const state=fixture({secondAConfirmed:false,legacy:true});setLocale('en');try{
    const html=completionView(reviewCompletion(state,controls({reviewTaskId:'TA1'})));
    assert.match(html,/View management summary/);assert.match(html,/Export inspection details/);assert.match(html,/Continue other pending batches/);assert.match(html,/View all records/);
    assert.doesNotMatch(html,/查看管理汇总|导出质检明细|继续其他待审批次|查看全部记录/);
  }finally{setLocale('zh');}
});
