import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createInitialState,confirmReview,createTask,INITIAL_TASK_ID,reopenReview} from '../public/domain.mjs';
import {reviewView,reviewHeader} from '../public/review-view.mjs';
const url=new URL('../public/review-flow.mjs',import.meta.url);
async function api(){assert.ok(existsSync(url),'缺少审核完成与待审导航逻辑');return import(url);}
const ui=(extra={})=>({reviewTaskId:INITIAL_TASK_ID,reviewStatus:'全部',reviewQuery:'',selectedId:'DEMO_PRE001',resultFilter:'全部',openRules:['R001'],highlightedTurns:[],...extra});
function completed(){let state=createInitialState();for(let i=1;i<=8;i++)state=confirmReview(state,`DEMO_PRE00${i}`);return state;}

test('completed batch is independent of search and still exposes pending other batches',async()=>{
 const {reviewCompletion}=await api();let state=completed();state=createTask(state,{name:'另一待审批次',templateIds:['DEMO_PRE001']});state.tasks[0].status='待审核';state.tasks[0].progress=100;
 const info=reviewCompletion(state,ui({reviewQuery:'无匹配',reviewStatus:'待确认'}));
 assert.equal(info.complete,true);assert.equal(info.total,8);assert.equal(info.confirmed,8);assert.equal(info.pending,0);assert.equal(info.otherPending,1);assert.equal(info.nextTaskId,state.tasks[0].id);
});
test('last confirmation shows completion not generic empty state and historical view remains available',async()=>{
 await api();const html=reviewView(completed(),ui());
 assert.match(html,/全部审核完成/);assert.match(html,/data-act="completion-export"/);assert.match(html,/data-act="completion-report"/);assert.match(html,/data-act="view-confirmed"/);assert.doesNotMatch(html,/确认本会话/);
 assert.match(reviewView(completed(),ui({showReviewRecords:true})),/data-act="show-completion"/);
});
test('next-session targets pending even when browsing confirmed history and never loops into confirmed',async()=>{
 const {nextPendingSession}=await api();const state=confirmReview(createInitialState(),'DEMO_PRE001');
 assert.equal(nextPendingSession(state,ui({reviewStatus:'已确认'}))?.id,'DEMO_PRE002');
 assert.equal(nextPendingSession(completed(),ui()),null);
});
test('zero scope and search empty are not incorrectly marked complete; reopened changes completion',async()=>{
 const {reviewCompletion}=await api();assert.equal(reviewCompletion(createInitialState(),ui({reviewTaskId:'absent'})).complete,false);
 assert.equal(reviewCompletion(createInitialState(),ui({reviewQuery:'不存在'})).complete,false);
 assert.equal(reviewCompletion(reopenReview(completed(),'DEMO_PRE008'),ui()).pending,1);
});
test('processing batches are not falsely counted as pending human reviews or global completion',async()=>{
 const {reviewCompletion}=await api();const state=createTask(completed(),{name:'待质检材料',templateIds:['DEMO_PRE001']});
 const info=reviewCompletion(state,ui());assert.equal(info.globalPending,0);assert.equal(info.waitingTasks,1);
 const html=reviewView(state,ui());assert.doesNotMatch(html,/<h1>全部审核完成/);assert.match(html,/尚未进入人工审核/);
});
test('completed header reports true batch totals rather than zero filtered pending rows',()=>{
 const html=reviewHeader(completed(),ui({reviewStatus:'待确认',reviewQuery:'none'}));
 assert.match(html,/8 \/ 8 条已确认/);assert.doesNotMatch(html,/0条会话/);
});
test('reopening from completed history keeps the reopened conversation editable and selected',async()=>{
 const {reopenReviewContext}=await api();assert.equal(typeof reopenReviewContext,'function');
 const controls=ui({selectedId:'DEMO_PRE008',reviewStatus:'已确认',reviewQuery:'old filter',showReviewRecords:true});
 const nextUi=reopenReviewContext(controls),state=reopenReview(completed(),'DEMO_PRE008');
 assert.equal(controls.reviewStatus,'已确认');assert.equal(nextUi.reviewStatus,'全部');assert.equal(nextUi.selectedId,'DEMO_PRE008');
 const html=reviewView(state,nextUi);assert.match(html,/确认本会话/);assert.match(html,/低价促单与私人收款/);assert.doesNotMatch(html,/全部审核完成/);
});
