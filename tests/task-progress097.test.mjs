import test from 'node:test';
import assert from 'node:assert/strict';
import {taskTable,tasksView,exportsView} from '../public/views.mjs';
import {taskExecution,taskMatchesStatus,handleTaskReportAction} from '../public/task-workbench.mjs';
import {deriveAIDecision,DEFAULT_REVIEW_POLICY} from '../public/ai-triage.mjs';
import {businessExportView} from '../public/business-export-view.mjs';
import {setLocale} from '../public/i18n.mjs';

const at='2026-11-11T09:00:00+08:00';
function fixture(statuses=['PASS'],{policy=true,id='task-progress'}={}){
  const rule={id:'SYN-R1',title:'合成回应检查',name:'合成回应检查',category:'服务规范',version:'V1',policyIds:[]};
  const task={id,name:`Synthetic ${id}`,mode:'manual',scene:'新品产品咨询',createdAt:at,aiStatus:statuses.includes('PENDING')?'partial':'completed',basisSnapshot:{rules:[rule],policies:[]},...(policy?{reviewPolicy:structuredClone(DEFAULT_REVIEW_POLICY)}:{})};
  const sessions=statuses.map((status,index)=>{
    const session={id:`${id}-s${index}`,taskId:id,scene:task.scene,externalId:`SYN-${index}`,startedAt:at,turns:[{id:1,role:'客服',text:'我先核对正式资料。'}],expectedRuleIds:[rule.id],aiResults:[],review:{status:'待审核',drafts:{},notes:'',history:[]},...(policy?{reviewPolicy:structuredClone(DEFAULT_REVIEW_POLICY)}:{})};
    if(status!=='PENDING'){
      session.aiExecution={status:'completed',runId:`${id}-run-${index}`};
      session.aiResults=[{ruleId:rule.id,verdict:status==='FAIL'?'不符合':'符合',reason:'合成检查：逐字核对客服回应。',evidence:[1],referenceIds:[],confidence:0.99,conflictsWith:[],evidenceQuotes:[{turnId:1,role:'客服',quote:session.turns[0].text}]}];
      if(policy)session.aiDecision=deriveAIDecision(session,task.reviewPolicy,{at,basis:task.basisSnapshot});
    }
    if(status==='HUMAN'){session.review.status='已确认';session.review.completedAt=at;}
    return session;
  });
  task.sessionIds=sessions.map(session=>session.id);
  return {tasks:[task],sessions,activity:[]};
}
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const row=html=>html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]||'';

test('task list shows complete review when every current record is an eligible AI final',()=>{
  const state=fixture(['PASS','PASS']),task=state.tasks[0];
  assert.deepEqual(state.sessions.map(session=>session.aiDecision.status),['PASS','PASS']);
  assert.equal(taskExecution(state,task).finalized,2);
  const html=taskTable(state,[task]),display=text(row(html));
  assert.match(html,/<th>审核进度<\/th>/);
  assert.match(display,/2 \/ 2 100%/);
  assert.match(display,/AI终判 2 条/);
  assert.match(display,/人工已确认 0 条/);
  assert.match(display,/审核已完成/);
  assert.doesNotMatch(display,/待人工确认|待人工审核/);
});

test('mixed task separates final sources, pending human review, and records awaiting AI execution',()=>{
  const state=fixture(['PASS','HUMAN','FAIL','PENDING']),task=state.tasks[0],display=text(row(taskTable(state,[task])));
  assert.equal(taskExecution(state,task).finalized,2);
  assert.match(display,/2 \/ 4 50%/);
  assert.match(display,/AI终判 1 条/);
  assert.match(display,/人工已确认 1 条/);
  assert.match(display,/待人工审核 1 条/);
  assert.match(display,/等待AI结果 1 条/);
  assert.equal(taskMatchesStatus(state,task,'待人工确认'),true);
  assert.equal(taskMatchesStatus(state,task,'审核已完成'),false);
});

test('unrun task does not claim that human confirmation is already required',()=>{
  const state=fixture(['PENDING']),display=text(row(taskTable(state,state.tasks)));
  assert.match(display,/0 \/ 1 0%/);
  assert.match(display,/等待AI结果 1 条/);
  assert.doesNotMatch(display,/待人工确认|待人工审核 [1-9]/);
});

test('legacy tasks keep manual-only progress and manual completion semantics',()=>{
  const partial=fixture(['HUMAN','PASS'],{policy:false}),completed=fixture(['HUMAN'],{policy:false});
  assert.match(text(row(taskTable(partial,partial.tasks))),/1 \/ 2 50%/);
  assert.match(text(row(taskTable(partial,partial.tasks))),/待人工审核 1 条/);
  assert.equal(taskMatchesStatus(partial,partial.tasks[0],'人工已完成'),false);
  assert.match(text(row(taskTable(completed,completed.tasks))),/1 \/ 1 100%/);
  assert.equal(taskMatchesStatus(completed,completed.tasks[0],'人工已完成'),true);
});

test('list filters explain AI-inclusive completion without changing their stored values',()=>{
  const state=fixture(),html=tasksView(state,{taskStatus:'全部'});
  assert.match(html,/<option value="审核已完成"[^>]*>审核已完成（含AI终判）<\/option>/);
  assert.match(html,/<option value="人工已完成"[^>]*>全部人工已确认<\/option>/);
  assert.doesNotMatch(html,/AI初判保留依据版本，人工确认后形成最终结论。/);
  assert.match(html,/AI终判和人工确认分别保留来源/);
});

test('English task rows and filter labels retain the same finalization meaning',()=>{
  setLocale('en');
  try{
    const state=fixture(['PASS','HUMAN','FAIL','PENDING']),html=tasksView(state,{taskStatus:'全部'}),display=text(row(html));
    assert.match(html,/<th>Review progress<\/th>/);
    assert.match(display,/2 \/ 4 50%/);
    assert.match(display,/AI final 1 records/);
    assert.match(display,/Human confirmed 1 records/);
    assert.match(display,/1 records need human review/);
    assert.match(display,/1 records awaiting AI results/);
    assert.match(html,/<option value="审核已完成"[^>]*>Review complete \(includes AI final\)<\/option>/);
    assert.match(html,/<option value="人工已完成"[^>]*>All human confirmed<\/option>/);
  }finally{setLocale('zh');}
});

test('task-detail report shortcuts align current business selection before rendering either destination',()=>{
  const a=fixture(['PASS'],{id:'task-A'}),b=fixture(['PASS'],{id:'task-B'}),state={tasks:[...a.tasks,...b.tasks],sessions:[...a.sessions,...b.sessions],activity:[]};
  const ui={businessTaskId:'task-B',exportTaskId:'task-B',reportTaskId:'task-B',reportPeriod:'month'},seen=[];
  const navigate=page=>seen.push({page,ui:structuredClone(ui),html:businessExportView(state,ui,{})});
  assert.equal(handleTaskReportAction('task-detail-export','task-A',{ui,navigate}),true);
  assert.equal(seen[0].ui.businessTaskId,'task-A');
  assert.match(seen[0].html,/<option value="task-A" selected/);
  assert.equal(handleTaskReportAction('task-detail-report','task-B',{ui,navigate}),true);
  assert.equal(seen[1].ui.businessTaskId,'task-B');
  assert.match(seen[1].html,/<option value="task-B" selected/);
  assert.deepEqual(seen.map(item=>[item.ui.exportTaskId,item.ui.reportTaskId,item.ui.businessTaskId]),[['task-A','task-A','task-A'],['task-B','task-B','task-B']]);
});
test('completion report events reset the task and final-only scopes instead of retaining a previous export selection',()=>{
 for(const action of ['completion-export','completion-report']){
  const ui={businessTaskId:'previous',exportTaskId:'previous',reportTaskId:'previous',includePending:true,reportPeriod:'month'};
  let page;
  assert.equal(handleTaskReportAction(action,'task-completed',{ui,navigate:value=>page=value}),true);
  assert.equal(page,'exports');assert.equal(ui.businessTaskId,'task-completed');assert.equal(ui.exportTaskId,'task-completed');assert.equal(ui.reportTaskId,'task-completed');assert.equal(ui.includePending,false);assert.equal(ui.reportPeriod,'batch');
 }
});
test('export preview calls an AI final result decided rather than awaiting review',()=>{
 const state=fixture();
 const html=exportsView(state,{dataMode:'manual',exportTaskId:state.tasks[0].id,includePending:false,reportPeriod:'batch',reportTaskId:state.tasks[0].id});
 const preview=html.slice(html.indexOf('class="panel export-preview"'));
 assert.match(preview,/已由AI判定/);assert.doesNotMatch(preview,/>待审核</);
});
