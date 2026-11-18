import {getLocale} from './i18n.mjs';
import {e} from './ui.mjs';
const names={site:['站点识别','Site identification'],intent:['用户意图','Intent'],salesStage:['销售环节','Sales stage'],demandSummary:['诉求总结','Demand summary'],negativeVoice:['负面声音','Negative voice'],translation:['前置翻译','Input translation'],timing:['时效计算','Timing'],ecommerceClassification:['评价归类','Review classification']};
export const capabilityName=key=>(names[key]||[key,key])[getLocale()==='en'?1:0];
export function capabilityPauseSummary(task){
 const entries=Object.entries(task.capabilityMonitor||{}).filter(([,m])=>m.paused);
 const en=getLocale()==='en';
 return entries.map(([key,m])=>en?`${capabilityName(key)}: ${m.technicalFailures}/${m.total} technical failures`:`${capabilityName(key)}：${m.total} 个样本中 ${m.technicalFailures} 个技术失败`).join('；');
}
export function capabilityHelpActions(task){
 const en=getLocale()==='en';return `<div class="toolbar-group"><button class="btn small" data-act="workflow-open" data-id="${e(task.id)}">${en?'View failure details':'查看失败详情'}</button><button class="btn small" data-act="task-problem-summary" data-id="${e(task.id)}">${en?'Copy problem summary':'复制问题摘要'}</button><button class="btn small" data-act="model-settings">${en?'Check model settings':'检查模型设置'}</button><button class="btn small" data-act="task-review" data-id="${e(task.id)}">${en?'Review saved results':'审核已完成结果'}</button></div>`;
}
// Deliberately allowlisted: no source text, model response, API key or file path.
export function taskProblemSummary(task,build={}){
 return JSON.stringify({productVersion:build.version||null,buildId:build.buildId||null,sourceCommit:build.sourceCommit||null,resourceFingerprint:build.resourceFingerprint||null,taskId:task.id,runId:task.aiRun?.id||null,status:task.aiQueue?.status||task.aiStatus||null,stopReason:task.aiQueue?.stopReason||null,capabilities:Object.entries(task.capabilityMonitor||{}).map(([key,m])=>({capability:key,total:m.total,technicalFailures:m.technicalFailures,businessUncertain:m.businessUncertain,rate:m.rate,paused:Boolean(m.paused)}))},null,2);
}
