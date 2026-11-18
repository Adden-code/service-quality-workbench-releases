import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDetailView,taskExecution,taskMatchesStatus,taskStage} from '../public/task-workbench.mjs';
import {DEFAULT_REVIEW_POLICY,deriveAIDecision} from '../public/ai-triage.mjs';
import {setLocale} from '../public/i18n.mjs';

const at='2026-11-11T10:00:00+08:00';
function fixture(){
  const task=(id,aiStatus)=>({id,name:`Synthetic ${id}`,mode:'manual',scene:'新品产品咨询',aiStatus,status:'待审核',aiRun:{id:`run-${id}`,status:aiStatus},basisSnapshot:{effectiveDate:'2026-11-11',rules:[{id:'Q1',title:'Synthetic rule',policyIds:[]}],policies:[]}});
  const tasks=[task('OLD-PARTIAL','partial'),task('OLD-FAILED','failed'),task('ACTIVE','running'),task('WAITING','queued'),task('PAUSED','paused'),task('CANCELLED','cancelled')];
  const session=(id,taskId,status='failed',confirmed=false)=>({id,taskId,topic:'Synthetic topic',scene:'新品产品咨询',expectedRuleIds:['Q1'],turns:[{id:1,role:'客服',text:'Synthetic answer.'}],aiExecution:status==='not_run'?undefined:{status,runId:`run-${taskId}`},aiResults:status==='completed'?[{ruleId:'Q1',verdict:'符合',reason:'Synthetic reason.',evidence:[1],referenceIds:[],confidence:0.95,evidenceQuotes:[{turnId:1,quote:'Synthetic answer.',role:'客服'}],conflictsWith:[]}]:[],review:{status:confirmed?'已确认':'待审核',drafts:{},reviewer:'Synthetic reviewer',notes:'',completedAt:confirmed?at:null}});
  const sessions=[session('P1','OLD-PARTIAL'),session('P2','OLD-PARTIAL','not_run'),session('P3','OLD-PARTIAL','completed'),session('P4','OLD-PARTIAL','failed',true),session('F1','OLD-FAILED'),session('F2','OLD-FAILED','completed'),session('A1','ACTIVE','running'),session('W1','WAITING','not_run'),session('Z1','PAUSED','not_run'),session('C1','CANCELLED','not_run')];
  const entry=(taskId,sequence,status)=>({taskId,runId:`run-${taskId}`,sequence,status,queuedAt:at,completedAt:null,blockedReason:null});
  const aiTaskQueue={version:1,status:'ready',pauseReason:null,nextSequence:10,entries:[entry('OLD-PARTIAL',1,'partial'),entry('OLD-PARTIAL',2,'partial'),entry('OLD-FAILED',3,'failed'),entry('ACTIVE',5,'running'),entry('WAITING',7,'queued'),entry('PAUSED',9,'paused'),entry('CANCELLED',6,'cancelled')]};
  return {tasks,sessions,aiTaskQueue,activity:[]};
}
const taskFor=(state,id)=>state.tasks.find(task=>task.id===id);

test('queue positions include the running task and exclude terminal entries',async()=>{
  const {taskQueueInfo}=await import('../public/task-queue-ui.mjs'),state=fixture();
  assert.equal(taskQueueInfo(state,taskFor(state,'ACTIVE')).position,1);
  const waiting=taskQueueInfo(state,taskFor(state,'WAITING'));
  assert.equal(waiting.position,2);assert.equal(waiting.pendingCount,3);assert.equal(waiting.status,'queued');assert.equal(waiting.canCancel,true);
  assert.equal(taskQueueInfo(state,taskFor(state,'CANCELLED')).position,null);
});

test('a paused task upgraded without a scheduler entry resumes its own saved run',async()=>{
 const {taskQueueControls}=await import('../public/task-queue-ui.mjs'),state=fixture(),task=taskFor(state,'PAUSED');delete state.aiTaskQueue;
 const html=taskQueueControls(state,task,{eligible:true});assert.match(html,/data-act="resume-ai" data-id="PAUSED"/);assert.doesNotMatch(html,/resume-ai-queue/);
});

test('previous incomplete warning counts unfinished conversations, deduplicating tasks and excluding human confirmations',async()=>{
  const {taskQueueInfo,taskQueueBadge}=await import('../public/task-queue-ui.mjs'),state=fixture(),task=taskFor(state,'WAITING');
  const info=taskQueueInfo(state,task);assert.equal(info.previousIncompleteSessions,3);assert.equal(info.previousIncompleteTasks,2);
  assert.match(taskQueueBadge(state,task),/前序仍有 3 条会话未完成/);assert.doesNotMatch(taskQueueBadge(state,task),/前序仍有 2 条/);
});

test('queued task detail offers cancellation without another start or an unstarted label',()=>{
  const state=fixture(),html=taskDetailView(state,{taskDetailId:'WAITING'});
  assert.match(html,/队列第2位/);assert.match(html,/data-act="cancel-queued-ai" data-id="WAITING"/);
  assert.doesNotMatch(html,/data-act="run-ai"|AI未开始|>未开始</);
  assert.equal(taskExecution(state,taskFor(state,'WAITING')).status,'queued');assert.equal(taskMatchesStatus(state,taskFor(state,'WAITING'),'AI排队中'),true);
});

test('queued and settled paused entries can be cancelled while cancelled tasks can be restarted',async()=>{
  const {taskQueueControls}=await import('../public/task-queue-ui.mjs'),state=fixture();
  assert.doesNotMatch(taskQueueControls(state,taskFor(state,'ACTIVE'),{eligible:true}),/cancel-queued-ai/);
  assert.match(taskQueueControls(state,taskFor(state,'PAUSED'),{eligible:true}),/cancel-queued-ai/);
  const html=taskQueueControls(state,taskFor(state,'CANCELLED'),{eligible:true});assert.match(html,/data-act="run-ai"/);assert.doesNotMatch(html,/disabled/);
});

test('queue pause and restart explain that resumption applies to the whole serial queue',async()=>{
  const {taskQueueControls,taskQueueNotice}=await import('../public/task-queue-ui.mjs'),state=fixture();state.aiTaskQueue.status='paused';state.aiTaskQueue.pauseReason='interrupted';
  const task=taskFor(state,'WAITING'),controls=taskQueueControls(state,task,{eligible:true});
  assert.match(controls,/data-act="resume-ai-queue"/);assert.match(controls,/继续任务队列/);assert.match(controls,/cancel-queued-ai/);
  assert.match(taskQueueNotice(state,task),/重启|中断/);assert.match(taskQueueNotice(state,task),/同一时间只执行一个任务/);
});

test('configuration and connection pauses provide a model-settings recovery path',async()=>{
  const {taskQueueNotice}=await import('../public/task-queue-ui.mjs');
  for(const reason of ['config_changed','connection_required']){
    const state=fixture();state.aiTaskQueue.status='paused';state.aiTaskQueue.pauseReason=reason;
    const html=taskQueueNotice(state,taskFor(state,'WAITING'));assert.match(html,/data-act="model-settings"/);assert.match(html,/测试连接/);assert.match(html,/继续任务队列/);
  }
});

test('cleaning snapshot totals and download link use the saved counts instead of fixed examples',()=>{
  const state=fixture(),task=taskFor(state,'WAITING');task.cleaningReportSnapshot={counts:{sourceRows:11,includedSessions:7,includedTurns:33,manualChanges:2,excludedRows:4,excludedSegments:9},reviewer:'Synthetic cleaner',confirmedAt:at};
  const html=taskDetailView(state,{taskDetailId:task.id});
  for(const [key,value] of Object.entries(task.cleaningReportSnapshot.counts))assert.match(html,new RegExp(`data-cleaning-count="${key}"[^>]*>${value}<`));
  assert.match(html,/data-act="download-cleaning-report" data-id="WAITING"/);assert.doesNotMatch(html,/1735|49条/);
});

test('task execution and progress separate human confirmations from AI finals',()=>{
  const state=fixture(),task=taskFor(state,'WAITING'),pass=state.sessions.find(session=>session.id==='W1');
  task.reviewPolicy={...DEFAULT_REVIEW_POLICY,confidenceThreshold:0.93};pass.reviewPolicy={...task.reviewPolicy};
  pass.aiExecution={status:'completed',runId:'run-WAITING'};pass.aiResults=[{ruleId:'Q1',verdict:'符合',reason:'Synthetic reason.',confidence:0.95,evidence:[1],evidenceQuotes:[{turnId:1,quote:'Synthetic answer.',role:'客服'}],referenceIds:[],conflictsWith:[]}];pass.aiDecision=deriveAIDecision(pass,pass.reviewPolicy,{at});
  state.sessions.push({...structuredClone(pass),id:'HUMAN',review:{...pass.review,status:'已确认',completedAt:at}});
  const c=taskExecution(state,task);assert.equal(c.humanConfirmed,1);assert.equal(c.aiFinal,1);assert.equal(c.finalized,2);assert.equal(c.confirmed,1);assert.equal(taskStage(state,task),4);
  const html=taskDetailView(state,{taskDetailId:task.id});assert.match(html,/AI已判定/);assert.match(html,/人工已确认/);assert.match(html,/width:100%/);assert.match(html,/0\.93/);assert.match(html,/尚未.*标定/);assert.doesNotMatch(html,/AI初判须人工确认/);
});

test('queue controls and cleaning summary have English UI without mutating saved state',async()=>{
  const {taskQueueBadge,taskQueueNotice}=await import('../public/task-queue-ui.mjs'),state=fixture(),task=taskFor(state,'WAITING');state.aiTaskQueue.status='paused';state.aiTaskQueue.pauseReason='config_changed';
  task.cleaningReportSnapshot={counts:{sourceRows:11,includedSessions:7,includedTurns:33,manualChanges:2,excludedRows:4,excludedSegments:9},reviewer:'Synthetic cleaner',confirmedAt:at};const before=JSON.stringify(state);
  setLocale('en');try{
    assert.match(taskQueueBadge(state,task),/Queue position 2/);assert.match(taskQueueNotice(state,task),/Model settings/);
    const html=taskDetailView(state,{taskDetailId:task.id});assert.match(html,/Cleaning report/);assert.match(html,/Source rows/);assert.match(html,/Resume task queue/);assert.doesNotMatch(html,/下载清洗报告|继续任务队列/);assert.equal(JSON.stringify(state),before);
  }finally{setLocale('zh');}
});
