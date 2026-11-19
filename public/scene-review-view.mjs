import {hasUnverifiedEvidence} from './evidence-status.mjs';
import {capabilityHelpActions,capabilityName} from './task-diagnostics.mjs';
import {classificationReviewForm} from './ecommerce-classification-review.mjs';
import {e} from './ui.mjs';
import {getLocale} from './i18n.mjs';
import {derivedOverall} from './scene-aggregate.mjs';
export function sceneAggregateNotice(state,session,results){
 const task=state.tasks.find(t=>t.id===session.taskId),summary=derivedOverall(task?.executionSnapshot,results.map(r=>({...r,verdict:r.final?.verdict||r.verdict})));if(!summary)return'';
 const en=getLocale()==='en',labels={'符合':'Pass','不符合':'Fail','不适用':'NA','无法判定':'Undetermined','未执行':'Not executed'};
 return`<p class="soft-note scene-aggregate-notice"><strong>${en?'Current aggregate':'当前子项汇总'}：${e(en?labels[summary.verdict]:summary.verdict)}</strong> · ${summary.algorithm==='fail-only.v2'?(en?'NP-R01: any Fail makes the overall Fail; otherwise judged conversations Pass. Undetermined checks remain separately visible.':`NP-R01自动汇总：已判会话有Fail则Fail，否则Pass。${summary.unknownCount?`含 ${summary.unknownCount} 项无法判定，单独留痕。`:''}`):en?'NP-R01 is derived from the 16 checks and updates after item corrections. It requires no separate review. Undetermined and not executed never count as Pass.':'NP-R01自动汇总，随16个子项更新，不计入人工待办；无法判定和未执行不计为通过。'}</p>`;
}
const businessTerms={
 'firstResponseDuration':['首次响应时长','First response time'],'queryWaitDuration':['单次查询等待时长','Query wait time'],
 'firstResponseMinutes':['首次响应时长','First response time'],'queryWaitMinutes':['单次查询等待时长','Query wait time'],'queriesPerIssue':['同一问题查询次数','Queries for the same issue'],
 'intent':['用户意图','Intent'],'demandSummary':['诉求总结','Demand summary'],'negativeVoice':['负面声音','Negative voice'],'translation':['前置翻译','Input translation'],
 'configuration-pending':['站点标准待维护','Site standards need maintenance'],'configuration.pending':['站点标准待维护','Site standards need maintenance'],
 'source-field':['来自批次站点字段','Batch site field'],'source-conflict':['批次站点信息冲突','Conflicting site fields'],'source-unmapped':['站点字段未匹配','Site field not matched'],
 'batch-default':['采用本批默认站点','Batch default site'],'ai-grounded':['AI识别，依据已核验','AI identified, evidence verified'],'low-confidence':['识别把握不足','Low identification confidence'],
 'taxonomy-parent':['按意图分类归属确定','Derived from intent category'],'unverified':['依据未核验','Evidence unverified'],'evidence-ambiguous':['旧结果引文无法唯一定位','Legacy quote location ambiguous'],
 'firstResponseSeconds':['首次响应时长','First response time'],'queryWaitSeconds':['单次查询等待时长','Query wait time'],'sameIssueQueries':['同一问题查询次数','Queries for the same issue'],
 'firstResponse':['首次响应时长','First response time'],'queryWait':['单次查询等待时长','Query wait time'],'queryCount':['同一问题查询次数','Queries for the same issue'],
 'quoted-raw-with-declared-timezone':['会话原文时间（按批次时区）','Original timestamps with batch timezone'],'source-turn-timestamp':['原始消息时间','Original message timestamps'],
 seconds:['秒','seconds'],minutes:['分钟','minutes'],count:['次','times'],completed:['已完成','Completed'],uncertain:['无法判定','Undetermined'],failed:['执行失败','Execution failed'],
};
export function reviewBusinessText(value,english=getLocale()==='en'){
 const text=typeof value==='string'?value:'',known=businessTerms[text];if(known)return known[english?1:0];
 let result=text;for(const [key,labels]of Object.entries(businessTerms))result=result.replaceAll(key,labels[english?1:0]);
 // Unknown machine identifiers/JSON belong in the existing run diagnostics, never in the business review view.
 return /[{}]|\b[A-Za-z]+[._][A-Za-z]+\b/.test(result)?(english?'See run details for technical information.':'详细技术信息请在运行记录中查看。'):result;
}
export function sceneReviewEvidence(session,ruleId,classificationDraft){
 const outputs=session.sceneCapabilities?.outputs;if(!outputs)return'';const english=getLocale()==='en',metrics=outputs.timing?.metrics||[],L=(zh,en)=>english?en:zh,T=v=>e(reviewBusinessText(v,english));
 const rows=Object.entries(outputs).map(([key,value])=>`<tr><td>${e(capabilityName(key))}</td><td>${hasUnverifiedEvidence(value)?L('已产出 · 依据未核验','Produced · evidence unverified'):T(value.status||'未执行')}</td><td>${T(value.origin==='configuration-pending'||value.origin==='configuration.pending'?'configuration-pending':value.fallbackReason||value.reason||value.origin||L('无补充说明','No additional note'))}</td></tr>`).join('');
 return`${ruleId==='EC-TIME'?classificationReviewForm(session,classificationDraft):''}<details class="scene-review-evidence"><summary>${L('辅助判定与站点时效依据','Auxiliary evidence and site timing')}</summary><div class="table-wrap"><table><thead><tr>${[L('能力','Capability'),L('状态','Status'),L('说明','Explanation')].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>${metrics.length?`<div class="table-wrap"><table><thead><tr>${(english?['Metric','Site','Standard','Actual values','Time source','Result']:['指标','站点','适用阈值','实际值','时间来源','判定']).map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${metrics.map(m=>`<tr><td>${T(m.metric)}</td><td>${T(m.siteId)}</td><td>${m.standard?`${e(m.standard.value)} ${T(m.standard.unit)}`:'—'}</td><td>${e((m.actual||[]).map(x=>`${x.topic||''}: ${x.value??'?'}`).join('；'))}</td><td>${T(m.timeSource||'—')}</td><td>${T(m.verdict||'无法判定')}</td></tr>`).join('')}</tbody></table></div>`:''}</details>`;
}

export function sceneCapabilityMonitor(task){
 const entries=Object.entries(task.capabilityMonitor||{});if(!entries.length)return '';const en=getLocale()==='en',labels={site:'站点识别',intent:'意图',salesStage:'销售环节',demandSummary:'诉求总结',negativeVoice:'负面声音',translation:'前置翻译',timing:'时效计算'};
 return `<details class="scene-capability-monitor" ${entries.some(([,m])=>m.paused)?'open':''}><summary>${en?'Auxiliary capability health':'辅助能力运行情况'}</summary><p>${en?'Technical failures and undetermined evidence are counted separately. Unverified evidence is annotated separately and does not trigger the technical failure breaker.':'技术故障与业务/依据无法判定分开统计；引文未核验保留原判并单列标注，不触发技术故障熔断。技术失败仍按冻结窗口与阈值暂停。'}</p><table><thead><tr>${(en?['Capability','Sample','Technical failures','Business / evidence undetermined','Status']:['能力','统计样本','技术失败','业务/依据无法判定','状态']).map(v=>`<th>${e(v)}</th>`).join('')}</tr></thead><tbody>${entries.map(([key,m])=>`<tr><td>${e(capabilityName(key))}</td><td>${m.total}</td><td>${m.technicalFailures} (${(m.rate*100).toFixed(1)}%)</td><td>${m.businessUncertain}${m.unverifiedEvidence?`<small> · ${en?'evidence unverified':'依据未核验'} ${m.unverifiedEvidence}</small>`:''}${m.evidenceAmbiguities?`<small class="muted"> · ${en?"ambiguous quotes":"其中引文歧义"} ${m.evidenceAmbiguities}</small>`:""}</td><td>${m.paused?(en?'Paused: fix the cause, then resume':'已暂停：排查原因后继续'):(en?'Monitoring':'监测中')}</td></tr>`).join('')}</tbody></table>${entries.some(([,m])=>m.technicalFailures>0)?capabilityHelpActions(task):''}</details>`;
}
