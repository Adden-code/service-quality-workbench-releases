import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateTaskEta,etaDisplayRange} from '../public/task-eta.mjs';
import {taskEtaNotice,taskQueueNotice} from '../public/task-queue-ui.mjs';
import {setLocale} from '../public/i18n.mjs';

const zero=Date.parse('2026-11-15T10:00:00Z'),at=seconds=>new Date(zero+seconds*1000).toISOString(),now=zero+44000;
function fixture(){
  const completed=[0,1,2].map(index=>({sessionId:'C'+index,runId:'current',batchId:'segment-1',status:'completed',attempts:1,startedAt:at(index*10),completedAt:at((index+1)*10)}));
  const pending=Array.from({length:8},(_,index)=>({sessionId:'P'+index,runId:'current',batchId:'segment-2',status:index<2?'running':'pending',attempts:index<2?1:0,startedAt:index<2?at(40):null}));
  const task={id:'task',scene:'新品产品咨询',aiStatus:'running',aiRun:{id:'current',status:'running',startedAt:at(-3600)},aiQueue:{status:'running',phase:'rows',settings:{concurrency:2},rows:[...completed,...pending]}};
  const state={tasks:[task],sessions:task.aiQueue.rows.map(row=>({id:row.sessionId,taskId:task.id})),aiTaskQueue:{status:'ready',entries:[]}};
  return{task,state};
}

test('ETA is a range based on actual successful row timestamps, not time spent queued',()=>{
  const {task}=fixture(),before=structuredClone(task),eta=estimateTaskEta(task,{now});
  assert.equal(eta.kind,'estimate');assert.equal(eta.sampleCount,3);assert.equal(eta.completed,3);assert.equal(eta.remaining,8);
  assert.deepEqual(eta.rangeMs,[26000,72000]);assert.deepEqual(task,before);
  task.aiRun.startedAt=at(-100000);assert.deepEqual(estimateTaskEta(task,{now}).rangeMs,eta.rangeMs);
});

test('configured concurrency and sequential dispatch segments both affect ETA',()=>{
  const {task}=fixture(),parallel=estimateTaskEta(task,{now});
  task.aiQueue.settings.concurrency=1;assert.equal(estimateTaskEta(task,{now}).rangeMs[1],parallel.rangeMs[1]*2);
  task.aiQueue.settings.concurrency=4;
  task.aiQueue.rows.filter(row=>row.status!=='completed').forEach((row,index)=>row.batchId='one-row-segment-'+index);
  assert.equal(estimateTaskEta(task,{now}).rangeMs[1],parallel.rangeMs[1]*2);
});

test('fewer than three timings, local-only fast checks, and timestamps from old runs do not produce ETA',()=>{
  for(const change of [task=>task.aiQueue.rows[0].runId='previous',task=>task.aiQueue.rows[0].completedAt='invalid',task=>task.aiQueue.rows.filter(row=>row.status==='completed').forEach(row=>row.completedAt=new Date(Date.parse(row.startedAt)+100).toISOString())]){
    const {task}=fixture();change(task);assert.equal(estimateTaskEta(task,{now}).kind,'estimating');assert.equal(estimateTaskEta(task,{now}).rangeMs,null);
  }
});

test('paused, queued, failed, cancelled and complete states never show a numeric ETA',()=>{
  for(const [status,kind] of [['paused','paused'],['interrupted','paused'],['queued','queued'],['partial','incomplete'],['failed','incomplete'],['cancelled','cancelled'],['completed','completed']]){
    const {task}=fixture(),eta=estimateTaskEta(task,{now,status});assert.equal(eta.kind,kind);assert.equal(eta.rangeMs,null);
  }
  const {task}=fixture();assert.equal(estimateTaskEta(task,{now,queueStatus:'paused'}).kind,'paused');
});

test('retrying and failed rows suppress estimates; clean timings after a retry rebuild the sample',()=>{
  const {task}=fixture(),running=task.aiQueue.rows.find(row=>row.status==='running');
  running.attempts=2;assert.equal(estimateTaskEta(task,{now}).kind,'retrying');
  running.status='failed';assert.equal(estimateTaskEta(task,{now}).kind,'incomplete');
  running.status='pending';running.attempts=1;assert.equal(estimateTaskEta(task,{now}).kind,'retrying');
  running.status='completed';running.attempts=2;running.startedAt=at(1);running.completedAt=at(2);
  assert.equal(estimateTaskEta(task,{now}).kind,'estimate');
  running.completedAt=at(35);assert.equal(estimateTaskEta(task,{now}).kind,'estimating');
});

test('batch comparison is its own stage and never inherits row ETA',()=>{
  const {task,state}=fixture();task.scene='电商评论回复';task.aiQueue.comparison={status:'running',blocks:[{status:'completed'},{status:'running'},{status:'pending'}]};
  assert.equal(estimateTaskEta(task,{now}).comparisonPending,true);
  assert.match(taskEtaNotice(state,task,{now}),/之后仍需整批重复比较/);
  task.aiQueue.phase='comparison';const eta=estimateTaskEta(task,{now});assert.equal(eta.kind,'comparison');assert.equal(eta.rangeMs,null);assert.equal(eta.comparisonCompleted,1);assert.equal(eta.comparisonTotal,3);
  const html=taskEtaNotice(state,task,{now});assert.match(html,/批次重复比较：1 \/ 3 块/);assert.doesNotMatch(html,/预计还需/);
});

test('long-running or malformed active timestamps withdraw an outdated estimate',()=>{
  for(const startedAt of [at(-100),'not-a-date',at(500)]){
    const {task}=fixture();task.aiQueue.rows.find(row=>row.status==='running').startedAt=startedAt;
    assert.equal(estimateTaskEta(task,{now}).kind,'slow');
  }
  const {task}=fixture();assert.equal(estimateTaskEta(task,{now:'bad-clock'}).rangeMs,null);
});

test('completed rows retained from another run and protected human rows cannot contaminate timing',()=>{
  const {task}=fixture(),baseline=estimateTaskEta(task,{now});
  task.aiQueue.rows.push({status:'completed',runId:'old',attempts:1,startedAt:at(-1000),completedAt:at(40)},{status:'protected',runId:'current',attempts:1,startedAt:at(-500),completedAt:at(40)});
  const eta=estimateTaskEta(task,{now});assert.deepEqual(eta.rangeMs,baseline.rangeMs);assert.equal(eta.sampleCount,3);assert.equal(eta.completed,5);
});

test('after all rows finish the UI shows saving instead of zero-time completion',()=>{
  const {task}=fixture();task.aiQueue.rows.forEach(row=>row.status='completed');
  assert.equal(estimateTaskEta(task,{now}).kind,'finishing');assert.equal(estimateTaskEta(task,{now}).rangeMs,null);
});

test('time bounds are coarse and render as a range with units',()=>{
  assert.deepEqual(etaDisplayRange([26000,72000]),{unit:'seconds',min:15,max:75});
  assert.deepEqual(etaDisplayRange([650,1800]),{unit:'seconds',min:0,max:15});
  assert.deepEqual(etaDisplayRange([120000,300000]),{unit:'minutes',min:2,max:5});
  assert.deepEqual(etaDisplayRange([3600000,10800000]),{unit:'hours',min:1,max:3});
  for(const value of [null,[],[NaN,1],[-1,1],[2,1]])assert.equal(etaDisplayRange(value),null);
  const {task,state}=fixture(),html=taskQueueNotice(state,task,{now});assert.match(html,/逐条检核：3 \/ 11/);assert.match(html,/本阶段预计还需 15–75 秒/);
});

test('500-row warning appears before execution and keeps ecommerce in one business task',()=>{
  const {task,state}=fixture();delete task.aiQueue;task.aiStatus='not_run';task.scene='电商评论回复';state.sessions=Array.from({length:500},(_,index)=>({id:'row-'+index,taskId:task.id}));
  const html=taskQueueNotice(state,task,{now});assert.match(html,/本批 500 条/);assert.match(html,/后台处理/);assert.match(html,/同一业务任务/);assert.doesNotMatch(html,/预计还需/);
  state.sessions.pop();assert.equal(taskQueueNotice(state,task,{now}),'');
});

test('English ETA covers estimates, non-estimated stages and whole-batch notices without changing saved data',()=>{
  setLocale('en');try{
    for(const status of ['running','queued','paused','failed','interrupted']){
      const {task,state}=fixture();task.aiQueue.status=status;task.aiStatus=status;const before=JSON.stringify(state),html=taskEtaNotice(state,task,{now});
      assert.doesNotMatch(html,/\p{Script=Han}/u);assert.equal(JSON.stringify(state),before);
      if(status==='running')assert.match(html,/Estimated time left in this stage: 15–75 seconds/);
    }
    const {task,state}=fixture();task.aiQueue.phase='comparison';task.aiQueue.comparison={status:'running',blocks:[{status:'running'}]};assert.doesNotMatch(taskEtaNotice(state,task,{now}),/\p{Script=Han}/u);
    delete task.aiQueue;task.aiStatus='not_run';task.scene='电商评论回复';state.sessions=Array.from({length:500},()=>({taskId:task.id}));const large=taskEtaNotice(state,task,{now});assert.match(large,/one business task/);assert.doesNotMatch(large,/\p{Script=Han}/u);
  }finally{setLocale('zh');}
});
