import {isAIFinal} from './ai-triage.mjs';
import {isVoidedTask} from './task-lifecycle.mjs';
import {html as h,t} from './i18n.mjs';
import {e,icon} from './ui.mjs';
const labels={rule_review_required:'规则未免审或被强制抽检',rule_uncalibrated:'规则尚未达标标定',calibration_inactive:'标定未启用或运行指纹已变化',non_pass:'该规则不是符合判定',mandatory_sample:'强制人工抽检',low_confidence:'置信度低于任务门槛',missing_confidence:'缺少有效置信度',indeterminate:'存在无法判定项',output_failure:'AI输出未完整完成',missing_checks:'冻结检核项覆盖不完整',invalid_reason:'判定理由缺失',quote_mismatch:'引文定位校验未通过',raw_result_degraded:'结果经程序降级',source_time_unavailable:'来源时间不可用',invalid_evidence:'轮次证据无效',missing_consistency:'缺少规则一致性检查',rule_conflict:'规则结论存在冲突',missing_quote:'缺少原文引文',quote_role_mismatch:'引文角色不符',missing_reference:'缺少冻结依据引用',no_applicable_checks:'全部检核项不适用',has_fail:'存在不符合项',returned:'已标记可疑退回',policy_disabled:'该任务未启用免审',legacy:'旧任务未记录分级策略',no_decision:'尚无有效AI判定记录',manual_work:'已有人工作业记录'};
export function buildTriageDiagnostics(state,{taskId=''}={}){
 const taskMap=new Map((state.tasks||[]).filter(task=>!isVoidedTask(task)&&(!taskId||task.id===taskId)).map(task=>[task.id,task]));
 const sessions=(state.sessions||[]).filter(s=>taskMap.has(s.taskId));
 const counts=new Map();let eligible=0,onlyConfidence=0;
 for(const session of sessions){
  if(isAIFinal(session)){eligible++;continue;}
  const reasons=new Set(session.aiDecision?.reasonCodes||[]);
  for(const entry of session.aiDecision?.ruleDecisions||[]){if(entry.status==='sample')reasons.add('mandatory_sample');for(const code of entry.reasonCodes||[])reasons.add(code);}
  // Program-enforced timing unknowns are recorded on the saved result. A valid
  // unknown does not trigger deriveAIDecision's invalid-timing-result branch.
  if((session.aiResults||[]).some(r=>r.rawValidation?.reasonCodes?.includes('source_time_unavailable')))reasons.add('source_time_unavailable');
  if((session.aiResults||[]).some(r=>r.verdict==='不符合'))reasons.add('has_fail');
  if(session.review?.returned)reasons.add('returned');
  if(session.reviewPolicy?.enabled===false)reasons.add('policy_disabled');
  if(session.reviewPolicy===undefined)reasons.add('legacy');
  if(!session.aiDecision)reasons.add('no_decision');
  if(session.review?.status!=='待审核'||session.review?.notes?.trim()||session.review?.history?.length||Object.keys(session.review?.drafts||{}).length)reasons.add('manual_work');
  if(reasons.size===1&&reasons.has('low_confidence'))onlyConfidence++;
  for(const code of reasons)counts.set(code,(counts.get(code)||0)+1);
 }
 return {total:sessions.length,aiFinal:eligible,notAiFinal:sessions.length-eligible,onlyConfidence,reasons:[...counts].map(([code,count])=>({code,label:labels[code]||'其他已记录原因',count})).sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code))};
}
export function triageDiagnosticsDialog(dialog,state){
 if(dialog?.type!=='triage-diagnostics')return '';
 const model=buildTriageDiagnostics(state,{taskId:dialog.taskId||''}),task=state.tasks.find(t=>t.id===dialog.taskId);
 return h`<div class="modal-backdrop" data-backdrop="true"><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><header class="modal-head"><div><h2 id="dialog-title">免审阻断原因</h2><p>${e(task?.name||t('全部本机任务'))}</p></div><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header><div class="modal-body"><p>${t('纳入 {0} 条，当前AI终判 {1} 条，未处于AI终判 {2} 条。',{0:model.total,1:model.aiFinal,2:model.notAiFinal})}</p><p class="soft-note">${t('仅记录到“低置信度”这一阻断原因的有 {0} 条。此数不等于降低门槛后可安全免审的数量。',{0:model.onlyConfidence})}</p><div class="table-wrap"><table><thead><tr><th>阻断原因</th><th>涉及会话</th></tr></thead><tbody>${model.reasons.map(row=>h`<tr><td>${t(row.label)}</td><td>${row.count}</td></tr>`).join('')||h`<tr><td colspan="2">当前没有已记录的阻断原因。</td></tr>`}</tbody></table></div><p class="hint">同一会话可能涉及多个原因，不能相加当作会话总数。使用任务已保存的判定与冻结门槛，不重新调用模型；人工已处理的记录也可能保留原始阻断原因。</p><p class="hint">先检查资料、时效与引文问题，再决定是否用独立人工金标准标定门槛。</p></div><footer class="modal-footer"><small>当前状态诊断，不是准确率评测</small><button class="btn primary" data-act="close-modal">关闭</button></footer></section></div>`;
}
