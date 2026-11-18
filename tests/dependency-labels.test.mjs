import test from 'node:test';
import assert from 'node:assert/strict';
import {createImportedTask,getSessionResults} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {sessionAIStatus,sessionAIIndicator,hasSuccessfulAI} from '../public/model-ui.mjs';
import {buildResultXlsx,readXlsx,buildHtmlReport} from '../public/io.mjs';
import {exportsView} from '../public/views.mjs';
import {manualResultCard} from '../public/business-review.mjs';

function fixture(){
 const catalog=createCatalog(),now='2026-11-03T10:00:00+08:00';
 const state=createImportedTask({schemaVersion:1,businessMigrationVersion:1,tasks:[],sessions:[],activity:[]},{name:'依赖状态验证',fileName:'检查.json',source:{sha256:'c'.repeat(64),name:'检查.json',size:10},reviewer:'测试审核员',now,
 basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-03',ruleIds:['R004'],now}),
 sessions:[{id:'SOURCE-1',scene:'新品产品咨询',startedAt:now,topic:'流程验证',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'流程验证输入'}]}]});
 state.sessions[0].aiExecution={status:'failed',errorCode:'dependency_incomplete',error:'等待批次比较完成',runId:'check-run',modelId:'configured-model'};
 return state;
}

test('dependency-pending result is clearly labelled and never counts as successful AI',()=>{
 const session=fixture().sessions[0];
 assert.equal(sessionAIStatus(session),'dependency_pending');
 assert.equal(hasSuccessfulAI(session),false);
 assert.match(sessionAIIndicator(session),/依赖检查未完成/);
 assert.doesNotMatch(sessionAIIndicator(session),/AI质检失败/);
 const state=fixture();
 const card=manualResultCard(state,state.sessions[0],getSessionResults(state.sessions[0])[0],{openRules:['R004']},false);
 assert.match(card,/依赖检查未完成/);
});

test('detail exports and preview preserve dependency state instead of inventing a failed judgment',async()=>{
 const state=fixture(),taskId=state.tasks[0].id,options={taskId,includePending:true};
 const sheets=await readXlsx(await buildResultXlsx(state,options));
 for(const name of ['结果明细','会话汇总']){
  const [headers,record]=sheets[name];
  assert.equal(record[headers.indexOf('AI执行状态')],'依赖检查未完成');
 }
 assert.match(buildHtmlReport(state,options),/依赖检查未完成/);
 assert.match(exportsView(state,{dataMode:'manual',exportTaskId:taskId,includePending:true,reportPeriod:'batch',reportTaskId:taskId}),/依赖检查未完成/);
});
