import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createInitialState,getDashboard,INITIAL_TASK_ID,confirmReview,saveReview,acceptAI,createTask} from '../public/domain.mjs';
const reportUrl=new URL('../public/management-report.mjs',import.meta.url);
async function implementation(){assert.ok(existsSync(reportUrl),'缺少独立的管理分析报告');return import(reportUrl);}

test('all-session management scope includes previous months for global completion',async()=>{
 const {getManagementReport,buildManagementHtml}=await implementation();const state=createInitialState();state.sessions[0].startedAt='2026-09-30T09:00:00+08:00';
 const all=getManagementReport(state,{period:'all'}),month=getManagementReport(state,{period:'month'});
 assert.equal(all.stats.totalSessions,32);assert.equal(month.stats.totalSessions,31);assert.equal(all.scope.start,'2026-09-30');
 assert.match(buildManagementHtml(state,{period:'all'}),/全部可审核会话/);
 const withWaiting=createTask(state,{name:'尚待质检',templateIds:['DEMO_PRE001']});
 assert.equal(getManagementReport(withWaiting,{period:'all'}).stats.totalSessions,32);
});

test('management scope and metrics match dashboard for month, week and batch',async()=>{
  const {getManagementReport}=await implementation();const state=createInitialState();
  for(const options of [{period:'month'},{period:'week'},{period:'batch',taskId:INITIAL_TASK_ID}]){
    const model=getManagementReport(state,options),stats=getDashboard(state,options);
    for(const key of ['totalSessions','reviewedCount','pendingCount','problemSessions','issueCount','unknownCount','changedCount'])assert.equal(model.stats[key],stats[key],`${options.period}.${key}`);
    assert.deepEqual(model.stats.trend,stats.trend);
    assert.equal(model.batches.reduce((n,row)=>n+row.total,0),stats.totalSessions);
    assert.equal(model.batches.reduce((n,row)=>n+row.reviewed,0),stats.reviewedCount);
  }
});

test('unconfirmed cases produce progress, not final quality or a misleading zero-percent pass rate',async()=>{
  const {getManagementReport,buildManagementHtml}=await implementation();
  const state=acceptAI(createInitialState(),'DEMO_PRE008'),options={period:'batch',taskId:INITIAL_TASK_ID};
  const model=getManagementReport(state,options);
  assert.equal(model.stats.totalSessions,8);assert.equal(model.stats.reviewedCount,0);assert.equal(model.problemRate,null);
  assert.equal(model.quality.reduce((n,row)=>n+row.count,0),0);
  assert.match(buildManagementHtml(state,options),/暂无人工已确认结果/);
  assert.doesNotMatch(model.findings.join(''),/全部通过|没有问题|质量合格/);
});

test('quality categories are disjoint and unknown outcomes are not called passed',async()=>{
  const {getManagementReport}=await implementation();
  let state=confirmReview(createInitialState(),'DEMO_PRE008');
  state=confirmReview(state,'DEMO_PRE005');
  state=saveReview(state,'DEMO_PRE003',{ruleId:'R002',verdict:'符合',reason:'已领券，3299减200为3099。',evidence:[2],referenceIds:['P002-2']});
  state=confirmReview(state,'DEMO_PRE003');
  const model=getManagementReport(state,{period:'batch',taskId:INITIAL_TASK_ID});
  assert.equal(model.quality.find(row=>row.key==='problem').count,1);
  assert.equal(model.quality.find(row=>row.key==='undetermined').count,1);
  assert.equal(model.quality.find(row=>row.key==='no-issue').count,1);
  assert.equal(model.quality.reduce((n,row)=>n+row.count,0),model.stats.reviewedCount);
  assert.equal(model.stats.issueCount,2);assert.equal(model.problemRate,33.3);
});

test('management HTML is a macro report without transcripts or individual customer records',async()=>{
  const {buildManagementHtml}=await implementation();const state=createInitialState();
  const html=buildManagementHtml(state,{period:'month'});
  for(const title of ['质量管理报告','审核进度','质量结果分布','主要问题分布','会话审核趋势','批次汇总','管理关注事项','统计口径'])assert.ok(html.includes(title),title);
  assert.ok(html.includes('2026-10-01'));assert.ok(html.includes('2026-10-18'));
  assert.ok(!html.includes(state.sessions[0].turns[0].text));
  assert.doesNotMatch(html,/DEMO_PRE00[1-8]|<script\b|<link\b|https?:\/\//i);
  assert.match(html,/@media print/);assert.match(html,/虚构/);assert.match(html,/问题会话数（条）/);
});

test('management HTML escapes batch names without mutating source state',async()=>{
  const {buildManagementHtml}=await implementation();const state=createInitialState();
  state.tasks[0].name='<script>alert("x")</script>&批次';
  const before=JSON.stringify(state);
  const html=buildManagementHtml(state,{period:'batch',taskId:state.tasks[0].id});
  assert.match(html,/&lt;script&gt;alert/);assert.doesNotMatch(html,/<script\b/i);
  assert.equal(JSON.stringify(state),before);
});

test('empty reporting period does not reuse old data or invent quality conclusions',async()=>{
  const {getManagementReport,buildManagementHtml}=await implementation();const options={period:'month',referenceDate:'2026-11-18'};
  const model=getManagementReport(createInitialState(),options);
  assert.equal(model.stats.totalSessions,0);assert.equal(model.problemRate,null);assert.equal(model.batches.length,0);
  const html=buildManagementHtml(createInitialState(),options);
  assert.match(html,/当前范围暂无会话/);assert.doesNotMatch(html,/NaN|Infinity/);
  assert.doesNotMatch([...model.findings,...model.actions].join(''),/质量提升|效率提升/);
});

function manualReportFixture(){
 const rules=[{id:'R-REPLY',name:'自定义评论响应',title:'自定义评论响应',category:'评论处置',version:'V4.0',policyIds:['P-REPLY']},{id:'R-PLAN',name:'自定义解决路径',title:'自定义解决路径',category:'评论处置',version:'V1.1',policyIds:['P-REPLY']}];
 const task={id:'TASK-MANUAL-REPORT',name:'运营评论审核',mode:'manual',aiStatus:'not_run',status:'已完成',progress:100,sessionIds:['S-MANUAL-REPORT'],basisSnapshot:{effectiveDate:'2026-10-20',capturedAt:'2026-10-29T10:00:00Z',rules,policies:[]}};
 const session={id:'S-MANUAL-REPORT',taskId:task.id,externalId:'业务源ID',scene:'电商评论回复',startedAt:'2026-10-25T10:00:00+08:00',topic:'真实导入主题',customer:'禁止泄露的客户',expectedRuleIds:rules.map(r=>r.id),aiResults:[],turns:[{id:1,role:'客户',text:'禁止出现在管理报告的真实原文'}],review:{status:'已确认',reviewer:'业务审核员',completedAt:'2026-10-29T11:00:00+08:00',drafts:Object.fromEntries(rules.map(r=>[r.id,{ruleId:r.id,verdict:'不符合',reason:'人工独立复核',evidence:[1],referenceIds:[],source:'人工独立审核'}])),notes:''}};
 return {schemaVersion:1,tasks:[task],sessions:[session],activity:[]};
}

test('management report shows complete AI coverage without counting failures as quality findings',async()=>{
 const {getManagementReport,buildManagementHtml}=await implementation(),state=manualReportFixture();
 const first=state.sessions[0];
 first.aiResults=first.expectedRuleIds.map(ruleId=>({ruleId,verdict:'符合',reason:'独立AI检查完成',evidence:[1],referenceIds:[]}));
 first.aiExecution={status:'completed'};
 const failed=structuredClone(first);failed.id='FAILED-ROW';failed.aiResults=[];failed.aiExecution={status:'failed',errorCode:'timeout'};failed.review={status:'待审核',drafts:{},notes:''};
 const pending=structuredClone(failed);pending.id='PENDING-ROW';delete pending.aiExecution;
 state.sessions.push(failed,pending);state.tasks[0].sessionIds=state.sessions.map(row=>row.id);
 const report=getManagementReport(state,{period:'batch',taskId:state.tasks[0].id});
 assert.deepEqual(report.aiCoverage,{total:3,completed:1,failed:1,unfinished:1});
 assert.equal(report.stats.reviewedCount,1);assert.equal(report.stats.problemSessions,1);
 const html=buildManagementHtml(state,{period:'batch',taskId:state.tasks[0].id});
 assert.match(html,/AI处理覆盖情况/);assert.match(html,/调用失败不作为内容不符合/);
 assert.doesNotMatch(html,/FAILED-ROW|PENDING-ROW/,'管理报告不暴露行级记录');
});

test('waiting for comparison is unfinished coverage rather than a failed model call',async()=>{
 const {getManagementReport}=await implementation(),state=manualReportFixture(),session=state.sessions[0];
 session.aiExecution={status:'failed',errorCode:'dependency_incomplete'};
 state.tasks[0].aiQueue={status:'running',phase:'comparison',rows:[{sessionId:session.id,status:'completed'}],comparison:{status:'running'}};
 const options={period:'batch',taskId:state.tasks[0].id};
 assert.deepEqual(getManagementReport(state,options).aiCoverage,{total:1,completed:0,failed:0,unfinished:1});
 state.tasks[0].aiQueue.comparison.status='failed';state.tasks[0].aiQueue.status='failed';
 assert.equal(getManagementReport(state,options).aiCoverage.failed,1);
});

test('manual management reports count custom issues without AI processing or human override claims',async()=>{
 const {getManagementReport,buildManagementHtml}=await implementation(),state=manualReportFixture(),options={period:'batch',taskId:state.tasks[0].id,referenceDate:'2026-10-29'};
 const model=getManagementReport(state,options),html=buildManagementHtml(state,options);
 assert.equal(model.stats.aiProcessed,0);assert.equal(model.stats.changedCount,0);assert.equal(model.stats.problemSessions,1);assert.equal(model.stats.issueCount,2);
 assert.equal(model.batches[0].problems,1);assert.equal(model.batches[0].issues,2);assert.equal(model.ranks.length,2);
 assert.match(html,/自定义评论响应/);assert.match(html,/人工独立审核/);assert.match(html,/AI未执行|AI未运行/);
 assert.doesNotMatch(html,/虚构演示|数据与规则均为虚构|演示截止|结果来自当前浏览器记录/);
 assert.doesNotMatch(html,/禁止出现在管理报告的真实原文|禁止泄露的客户/);
});

test('mixed management reporting identifies demo subset while preserving manual context',async()=>{
 const {buildManagementHtml}=await implementation(),manual=manualReportFixture(),demo=createInitialState();
 const html=buildManagementHtml({...demo,tasks:[...manual.tasks,...demo.tasks],sessions:[...manual.sessions,...demo.sessions]},{period:'all',referenceDate:'2026-10-29'});
 assert.match(html,/业务导入/);assert.match(html,/演示/);assert.doesNotMatch(html,/数据与规则均为虚构演示/);
});
