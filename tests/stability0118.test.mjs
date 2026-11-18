import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelJson} from '../public/model-output-values.mjs';
import {taskProblemSummary,capabilityPauseSummary} from '../public/task-diagnostics.mjs';
import {taskQueueNotice} from '../public/task-queue-ui.mjs';
import {taskImportLink} from '../public/task-workbench.mjs';
import {deliveryDownloadHint} from '../public/delivery-download-hint.mjs';
import {reviewQueue,reviewHeader} from '../public/review-view.mjs';
import {reviewCompletion} from '../public/review-flow.mjs';
import {fixture,ui} from './review-state0118.test.mjs';
import {setLocale} from '../public/i18n.mjs';
test('one model JSON boundary accepts complete fenced JSON, rejects ambiguous or fabricated envelopes',()=>{
 for(const input of ['{"confidence":"0.9"}','```json\n{"confidence":"0.9"}\n```','```JSON\r\n{"confidence":"0.9"}\r\n```','```\n{"confidence":"0.9"}\n```'])assert.deepEqual(parseModelJson(input),{confidence:'0.9'});
 for(const input of ['answer: {"confidence":0.9}','```json\n{}\n``` trailing','```json\n{}\n```\n```json\n{}\n```','{"confidence":NaN}',undefined])assert.throws(()=>parseModelJson(input));
});
test('paused capability guidance has counts, concrete actions and review access; summaries exclude free text',()=>{
 const task={id:'SYNTHETIC-TASK',aiStatus:'paused',aiQueue:{status:'paused',stopReason:'capability_failure_rate'},capabilityMonitor:{intent:{total:25,technicalFailures:25,businessUncertain:0,rate:1,paused:true,secret:'DO NOT EXPORT'}},source:{text:'CUSTOMER SECRET'},name:'CUSTOMER NAME',aiRun:{id:'synthetic-run',apiKey:'SECRET'}};
 assert.match(capabilityPauseSummary(task),/25 个样本中 25 个/);const html=taskQueueNotice({tasks:[task],sessions:[]},task);assert.match(html,/复制问题摘要/);assert.match(html,/审核已完成结果/);assert.match(html,/管理员/);
 const summary=taskProblemSummary(task,{version:'test',buildId:'test-build'});assert.doesNotMatch(summary,/SECRET|CUSTOMER|apiKey|source"|text"/);assert.equal(JSON.parse(summary).capabilities[0].technicalFailures,25);
 task.aiQueue.stopReason='interrupted';assert.match(taskQueueNotice({tasks:[task],sessions:[]},task),/用户意图：25 个样本中 25 个技术失败/);
});
test('first-import navigation handles removed parent without a dead action',()=>{
 const first={id:'T1',mode:'manual'},repeat={id:'T2',mode:'manual',importLineage:{schemaVersion:1,ordinal:2,firstTaskId:'T1'}};
 assert.match(taskImportLink({tasks:[first,repeat],sessions:[]},repeat),/data-act="task-detail" data-id="T1"/);
 const html=taskImportLink({tasks:[repeat],sessions:[],taskDeletionAudit:[{task:first}]},repeat);assert.match(html,/已删除/);assert.doesNotMatch(html,/data-act="task-detail"/);
});
test('downloads explain each disabled stage adjacent to buttons, including after a failed job',()=>{
 assert.match(deliveryDownloadHint({}),/先生成业务交付物/);assert.match(deliveryDownloadHint({job:{status:'running',resultAvailable:false}}),/首份结果/);
 assert.match(deliveryDownloadHint({job:{status:'failed',resultAvailable:false}}),/重试缺失项/);assert.equal(deliveryDownloadHint({job:{status:'running',resultAvailable:true}}),'');
 assert.match(deliveryDownloadHint({downloading:true}),/正在准备下载/);assert.match(deliveryDownloadHint({},true),/First click Generate/);
});
test('running manual batches expose saved results to review and scope selection consistently',()=>{
 const state=fixture();state.tasks[0].status='质检中';assert.deepEqual(reviewQueue(state,ui()).map(s=>s.id),['DRAFT','FAIL']);assert.equal(reviewCompletion(state,ui()).pending,2);assert.match(reviewHeader(state,ui()),/T-SYNTHETIC/);
 state.tasks[0].lifecycle={archivedAt:'2026-11-18T00:00:00Z'};assert.equal(reviewQueue(state,ui({reviewTaskId:''})).length,0);
});
test('new review state labels and pause guidance work in English',()=>{
 setLocale('en');try{assert.match(capabilityPauseSummary({capabilityMonitor:{ecommerceClassification:{total:20,technicalFailures:20,paused:true}}}),/Review classification: 20\/20/);}finally{setLocale('zh');}
});
