import test from 'node:test';
import assert from 'node:assert/strict';
import {updateTaskDraftInput} from '../public/task-draft.mjs';
import {executionSettingsFields} from '../public/task-workbench.mjs';
import {normalizeExecutionSettings} from '../public/execution-settings.mjs';
import {overviewView} from '../public/views.mjs';
import {createInitialState} from '../public/domain.mjs';
import {rawReviewView, rawEditDialog} from '../public/raw-review-view.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {setLocale} from '../public/i18n.mjs';
import {taskTimeRuleNotice, updateTaskRuleSelection} from '../public/task-rule-selection-ui.mjs';
import {batchReturnControl} from '../public/review-routing-ui.mjs';

test('execution inputs are retained synchronously before a model-settings detour', () => {
  const draft = {type:'new-task', mode:'manual', parsed:{rawDirect:true}};
  assert.equal(updateTaskDraftInput(draft, {id:'task-concurrency', value:'2'}), true);
  assert.equal(updateTaskDraftInput(draft, {id:'task-batch-size', value:'15'}), true);
  const restored = structuredClone(draft);
  assert.deepEqual(normalizeExecutionSettings(restored.executionSettings), {concurrency:2,batchSize:15,maxWorkBytes:64000});
  assert.match(executionSettingsFields(restored.executionSettings, 'task', {raw:true}), /id="task-concurrency"[^>]+value="2"/);
});

test('incomplete number input survives rendering and remains invalid at submission', () => {
  const draft = {type:'new-task', mode:'manual', parsed:{rawDirect:true}};
  updateTaskDraftInput(draft, {id:'task-concurrency', value:''});
  assert.doesNotThrow(() => executionSettingsFields(draft.executionSettings, 'task', {raw:true}));
  assert.match(executionSettingsFields(draft.executionSettings, 'task', {raw:true}), /id="task-concurrency"[^>]+value=""/);
  assert.throws(() => normalizeExecutionSettings(draft.executionSettings, {raw:true}), /同时处理记录数/);
  updateTaskDraftInput(draft, {id:'task-concurrency', value:'3'});
  assert.equal(normalizeExecutionSettings(draft.executionSettings, {raw:true}).concurrency, 3);
});

test('unknown conversation dates have an explicit route to batch statistics', () => {
  const state = createInitialState();
  for (const session of state.sessions) session.startedAt = '';
  const ui = {dataMode:'manual', period:'month', dashboardTaskId:state.tasks[0].id};
  const html = overviewView(state, ui);
  assert.match(html, /data-act="overview-undated-task"/);
  assert.match(html, /按批次查看完整结果/);
  assert.doesNotMatch(overviewView(state, {...ui,period:'batch'}), /data-act="overview-undated-task"/);
  setLocale('en',{storage:null});
  try { assert.match(overviewView(state, ui), /View complete batch results/); }
  finally { setLocale('zh',{storage:null}); }
});

function reviewFixture() {
  const rule = {id:'UX-R1', title:'合成检查', name:'合成检查', version:'V1', policyIds:[]};
  const task = {id:'UX-TASK', mode:'manual', inputMode:'raw-transcript-v1', name:'合成任务', basisSnapshot:{rules:[rule],policies:[]}};
  const session = {
    id:'UX-ROW', taskId:task.id, externalId:'UX-ROW', expectedRuleIds:[rule.id], turns:[],
    rawTranscript:{text:'Synthetic source',row:2,timePolicy:{mode:'unavailable'}},
    reviewPolicy:{version:1,enabled:true,confidenceThreshold:0.9},
    aiDecision:{status:'UNCERTAIN',runId:'UX-RUN',confidence:0.7,reasons:['至少一项置信度低于本任务门槛。'],reasonCodes:['low_confidence']},
    aiExecution:{status:'completed',runId:'UX-RUN'},
    review:{status:'待审核',reviewer:'合成审核员',notes:'',history:[],drafts:{}},
    aiResults:[{ruleId:rule.id,verdict:'符合',reason:'Synthetic result',confidence:0.7,conflictsWith:[],evidence:[],evidenceQuotes:[],referenceIds:[]}]
  };
  return {state:{tasks:[task],sessions:[session]},session};
}

test('raw review explains low-confidence routing and marks the selected queue filter', () => {
  const {state,session} = reviewFixture();
  const html = rawReviewView(state,{reviewStatus:'待确认',openRules:[]},{session,queue:[session]});
  assert.match(html, /需核实.*1/);
  assert.match(html, /至少一项置信度低于本任务门槛/);
  assert.match(html, /aria-pressed="true"[^>]*data-act="review-status"[^>]*data-value="待确认"/);
});

test('every manual quotation input has an accessible name', () => {
  const {state,session} = reviewFixture();
  const html = rawEditDialog({ruleId:'UX-R1',evidenceQuotes:[{quote:'first'},{quote:'second'}]},state,session).body;
  assert.match(html, /aria-label="证据引文 1"/);
  assert.match(html, /aria-label="证据引文 2"/);
});

test('unexpected connectivity response explains the test failure without a session diagnosis', async () => {
  const client = createArkClient({fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'unexpected'},finish_reason:'stop'}]}))});
  await assert.rejects(client.test({config:{baseUrl:'http://127.0.0.1:9/v1',model:'synthetic',authMode:'none',timeoutMs:1000}}), error => {
    assert.match(error.message, /连接测试.*OK/);
    assert.doesNotMatch(error.message, /本会话/);
    return true;
  });
});

test('timing advisory follows selected rules and refreshes with checkbox changes', () => {
  const timeRule = {id:'UX-TIME',title:'首次响应时效',category:'响应时效'};
  const draft = {parsed:{rawDirect:true},rawImportOptions:{timePolicy:{mode:'unavailable'}},ruleIds:[],basisSnapshot:{rules:[],policies:[]}};
  assert.doesNotMatch(taskTimeRuleNotice(draft), /首次响应时效/);
  draft.ruleIds = ['UX-TIME'];
  draft.basisSnapshot.rules = [timeRule];
  assert.match(taskTimeRuleNotice(draft), /首次响应时效/);
  const notice = {innerHTML:''};
  const root = {querySelector:selector=>selector==='[data-task-time-notice]'?notice:null,querySelectorAll:()=>[]};
  updateTaskRuleSelection(root,draft);
  assert.match(notice.innerHTML, /首次响应时效/);
  draft.basisSnapshot.rules = [];
  updateTaskRuleSelection(root,draft);
  assert.doesNotMatch(notice.innerHTML, /首次响应时效/);
});

test('batch review return action translates its label next to an icon', () => {
  const {state,session} = reviewFixture();
  session.aiDecision.status = 'PASS';
  session.aiDecision.confidence = 0.96;
  setLocale('en',{storage:null});
  try { assert.match(batchReturnControl(state,{}), /Flag by task \/ rule/); }
  finally { setLocale('zh',{storage:null}); }
});

test('raw review retains the return reason and operator beside the pending record', () => {
  const {state,session} = reviewFixture();
  session.aiResults[0].confidence = 0.96;
  session.review.returned = {reason:'核对新版本操作步骤',reviewer:'合成审核员',at:'2026-11-13T10:00:00+08:00'};
  const html = rawReviewView(state,{reviewStatus:'待确认',openRules:[]},{session,queue:[session]});
  assert.match(html, /退回原因/);
  assert.match(html, /核对新版本操作步骤/);
  assert.match(html, /合成审核员/);
  assert.match(html, /data-rule-card="UX-R1"/);
});

test('raw review shows saved pending status and notes after a reload', () => {
  const {state,session} = reviewFixture();
  session.review.status = '待补充';
  session.review.notes = '补充设备型号后再确认';
  const html = rawReviewView(state,{reviewStatus:'全部',openRules:[]},{session,queue:[session]});
  assert.match(html, /UX-ROW · 待补充/);
  assert.match(html, /补充设备型号后再确认/);
  assert.match(html, /<strong>人工最终结论<\/strong>.*待补充/);
});
