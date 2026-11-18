import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../public/catalog.mjs';
import {reviewView,humanFooter} from '../public/review-view.mjs';
import {dialogView} from '../public/dialogs.mjs';
import {tasksView,overviewView,exportsView} from '../public/views.mjs';

function fixture(){
  const catalog=createCatalog();
  const rule={...catalog.rules[3],id:'QA-NEW',name:'检查是否回答颜色',title:'检查是否回答颜色',policyIds:['DOC-NEW']};
  const policy={...catalog.policies[0],id:'DOC-NEW',title:'任务当时的产品资料',sections:[{id:'颜色',title:'颜色范围',text:'仅有月白和松青两种颜色。'}]};
  policy.content=policy.sections.map(s=>`${s.id} ${s.title}\n${s.text}`).join('\n\n');
  const session={id:'TASK-NEW-S1',externalId:'NEW-UNSEEN-001',taskId:'TASK-NEW',scene:'新品产品咨询',topic:'全新手表颜色询问',product:'澄光X2',customer:'虚构客户甲',agent:'虚构客服乙',channel:'虚构商城',startedAt:'2026-10-29T09:00:00+08:00',expectedRuleIds:['QA-NEW'],aiResults:[],turns:[{id:1,role:'客户',speaker:'虚构客户甲',at:'2026-10-29T09:00:00+08:00',text:'澄光X2有什么颜色？'}],review:{status:'待审核',reviewer:'质检员甲（虚构）',completedAt:null,drafts:{},notes:''}};
  const task={id:'TASK-NEW',name:'新文件任务',mode:'manual',aiStatus:'not_run',status:'待审核',progress:0,sessionIds:[session.id],createdAt:'2026-10-29T10:00:00+08:00',basisSnapshot:{capturedAt:'2026-10-29T10:00:00+08:00',effectiveDate:'2026-10-29',rules:[rule],policies:[policy]},source:{sha256:'a'.repeat(64),name:'新业务.json',size:100}};
  const state={schemaVersion:1,tasks:[task],sessions:[session],activity:[]};
  const ui={dataMode:'manual',page:'review',reviewTaskId:task.id,reviewStatus:'全部',reviewQuery:'',selectedId:session.id,openRules:['QA-NEW'],highlightedTurns:[],resultFilter:'全部',period:'batch',dashboardTaskId:task.id,taskStatus:'全部',taskQuery:'',exportTaskId:task.id,includePending:true,reportPeriod:'batch',reportTaskId:task.id};
  return {state,ui,catalog,session,task};
}

test('manual review renders expected checks and never offers accepting nonexistent AI',()=>{
  const {state,ui,session}=fixture(),html=reviewView(state,ui);
  assert.match(html,/AI未执行/);assert.match(html,/检查是否回答颜色/);assert.match(html,/待人工判断/);
  assert.doesNotMatch(html,/data-act="accept-ai"/);assert.doesNotMatch(humanFooter(session,'',ui),/data-rule="R001"/);
  assert.match(html,/1项检查/);assert.doesNotMatch(html,/AI初判为虚构预置结果/);
});

test('business import preview displays uploaded original data rather than demo templates',()=>{
  const {state,ui,session,catalog}=fixture();
  const html=dialogView({type:'new-task',mode:'manual',step:2,fileName:'新业务.json',catalog,parsed:{valid:true,sessions:[session],turnCount:1,warnings:[]}},state,ui);
  assert.match(html,/NEW-UNSEEN-001/);assert.match(html,/全新手表颜色询问/);assert.match(html,/审核人/);
  assert.doesNotMatch(html,/已识别演示材料|原文、规则及资料关联已检查/);
});

test('manual edit and policy dialogs use the task snapshot names, text and reference options',()=>{
  const {state,ui}=fixture();
  const edit=dialogView({type:'edit-result',ruleId:'QA-NEW'},state,ui);
  assert.match(edit,/检查是否回答颜色/);assert.match(edit,/颜色范围/);assert.match(edit,/AI.*未执行/);
  const policy=dialogView({type:'policy',id:'DOC-NEW@V1.0#%E9%A2%9C%E8%89%B2'},state,ui);
  assert.match(policy,/仅有月白和松青两种颜色/);assert.match(policy,/任务当时的产品资料/);
  assert.doesNotMatch(policy,/以下为虚构的产品及服务政策/);
});

test('business task and dashboard copy reflects persisted files and actual dates',()=>{
  const {state,ui}=fixture(),tasks=tasksView(state,ui),overview=overviewView(state,ui);
  assert.match(tasks,/新建质检任务/);assert.match(tasks,/下载原文件/);assert.match(tasks,/AI未执行/);
  assert.doesNotMatch(tasks,/所有数据仅保存在当前浏览器/);
  assert.doesNotMatch(overview,/演示数据截至 2026\.10\.18|全部材料和统计均为虚构/);
});

test('manual export preview includes saved human judgments even with an empty AI array',()=>{
  const {state,ui,session}=fixture();
  session.review.drafts['QA-NEW']={ruleId:'QA-NEW',verdict:'不符合',reason:'只讲发货，未回答颜色',evidence:[1],referenceIds:['DOC-NEW@V1.0#%E9%A2%9C%E8%89%B2'],source:'人工独立审核'};
  const html=exportsView(state,ui);
  assert.match(html,/NEW-UNSEEN-001/);assert.match(html,/检查是否回答颜色/);assert.match(html,/AI未执行/);
  assert.doesNotMatch(html,/当前范围没有可导出的结果/);
});
