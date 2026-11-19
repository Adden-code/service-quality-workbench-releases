import {dependencyStaleness} from './scene-dependency-staleness.mjs';
import {isInactiveTask} from './task-lifecycle.mjs';
import {e} from './ui.mjs';
import {getLocale} from './i18n.mjs';

export function dependencyRecoveryBadge(session,task){
 const info=dependencyStaleness(session,task);if(!info.stale)return '';
 return `<span class="badge warning">${getLocale()==='en'?`${info.ruleIds.length} items need dependency refresh`:`${info.ruleIds.length} 项依据待更新`}</span>`;
}
export function dependencyRecoveryNotice(session,task){
 const info=dependencyStaleness(session,task);if(!info.stale||isInactiveTask(task))return '';
 const en=getLocale()==='en',names={'EC-TIME':en?'Reply timeliness':'回复时效','EC-STEPS':en?'Reply structure':'回复结构'},count=info.ruleIds.length;
 const candidate=task?.aiQueue?.rows?.find(r=>r.sessionId===session.id)?.capabilityRecovery?.at(-1)?.candidateCapabilities?.outputs?.ecommerceClassification;
 const classification=candidate?.status==='completed'?`<p>${en?'Recovered classification candidate':'恢复后的评价归类候选'}：${e(candidate.value?.evaluationType||'')} · ${e(candidate.reason||'')}</p>`:'';
 const title=info.recovered?(en?`Classification recovered; ${count} judgments still use the earlier state`:`评价归类已恢复，本会话 ${count} 项判定仍基于旧状态`):(en?`${count} judgments await classification recovery`:`本会话 ${count} 项判定待评价归类恢复`);
 const explanation=info.protected?(en?'Saved human judgments stay unchanged. Retry this record to view candidate judgments, then reopen review, check the classification and affected items, and confirm again.':'已保存的人工记录不自动覆盖。请先单行重试查看候选判断，再点“重新审核”，核对评价归类及相关项后重新确认。'):(en?'Only judgments blocked by the missing classification will be recalculated. Other judgments remain unchanged.':'仅重算因评价归类未确定而产生的无法判定项，其余判定保留。');
 return `<details class="hint dependency-recovery" open><summary><strong>${e(title)}</strong></summary><p>${e(explanation)}</p>${classification}${info.candidateResults.length?`<ul>${info.candidateResults.map(result=>`<li><strong>${e(names[result.ruleId]||result.ruleId)} · ${e(result.verdict)}</strong>：${e(result.reason)}</li>`).join('')}</ul>`:''}${info.lastError?`<p>${e(info.lastError.message||info.lastError.reason||'部分依赖项未完成，请查看运行记录后重试。')}</p>`:''}${info.canRetry?`<button class="btn small" data-act="retry-scene-dependencies" data-id="${e(session.id)}">${en?'Retry this record’s dependencies':'重试本行依赖项'}</button>`:''}</details>`;
}
