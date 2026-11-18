import {samplingDescription} from './rule-calibration-policy.mjs';
import {ruleExemption} from './rule-calibration-policy.mjs';
import {normalizeReviewPolicy,getReviewRouting,deriveAIDecision} from './ai-triage.mjs';
import {escapeHTML as e} from './ui.mjs';
import {rawReportNotices} from './raw-report-evidence.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';

const clone=value=>structuredClone(value);
export const hasReviewPolicy=value=>value?.reviewPolicy!==undefined;
export const triageEnabled=value=>value?.reviewPolicy?.enabled===true;
export function freezeReviewRouting(session,task){
  const processedUnknown=isProcessedUnknown(session);
  if(!hasReviewPolicy(task)&&!hasReviewPolicy(session)&&!processedUnknown&&!session.review?.resolutionHistory?.length)return null;
  const policy=normalizeReviewPolicy(session.reviewPolicy??task.reviewPolicy??{enabled:false}),projected={...session,reviewPolicy:policy},routing=getReviewRouting(projected);
  if(!policy.enabled){
    const human=session.review?.status==='已确认';
    Object.assign(routing,{status:human?'HUMAN_CONFIRMED':'MANUAL_REVIEW',aiFinal:false,needsReview:!human&&!processedUnknown,resultSource:human?'human':null,reasons:human||processedUnknown?clone(routing.reasons):[...routing.reasons,'AI免审已关闭；须由本轮人工确认最终结果。']});
  }
  if(routing.aiFinal){
    const proof=deriveAIDecision(projected,policy,{at:session.aiDecision.decidedAt,runId:session.aiExecution.runId,basis:task.basisSnapshot});
    if(proof.status!=='PASS')Object.assign(routing,{status:'UNCERTAIN',aiFinal:false,needsReview:true,resultSource:null,reasons:clone(proof.reasons)});
  }
  return{...routing,...(policy.version===2?{exemptRuleIds:(session.expectedRuleIds||[]).filter(id=>ruleExemption(session,id)),ruleCalibrationRevocations:clone(session.ruleCalibrationRevocations||[])}:{}),...(processedUnknown||session.review?.resolutionHistory?.length?{processedUnknown,resolutionAudit:{current:clone(session.review.resolution||null),history:clone(session.review.resolutionHistory||[])}}:{}),policy:clone(policy),decision:session.aiDecision?clone(session.aiDecision):null,decisionHistory:clone(session.aiDecisionHistory||[]),returnAudit:{current:session.review?.returned?clone(session.review.returned):null,history:clone(session.review?.returnHistory||[])}};
}
export function triageConclusionPolicy(mode,language='zh',policy){
  if(policy?.version===2&&mode!=='ai')return language==='en'?'Final results combine explicitly calibrated rule-level AI exemptions and current human confirmations. Mandatory samples and non-exempt checks require human confirmation.':'最终结果逐项采用已标定规则的AI免审或本轮人工确认；强制抽检与非免审项仍须人工确认。';
  if(mode==='ai')return language==='en'?'AI initial judgments only; not final performance data':'仅采用AI初判；初判不作为最终绩效结论';
  if(policy?.enabled===false)return language==='en'?'AI final is disabled; manual review only. Only current confirmed human review forms final conclusions. Historical references do not confirm this run.':'AI免审已关闭；仅本轮人工确认形成最终结论，历史人工参考不充当本轮确认';
  return language==='en'?'Current confirmed human review > proved AI-final PASS; FAIL, UNCERTAIN and returned results await human review. Historical references do not confirm this run.':'本轮人工确认 > 证据校验通过的AI终判PASS；FAIL、UNCERTAIN及退回记录待人工，不采用历史人工参考充当本轮确认';
}
export function triageMetrics(records){
  return{aiFinalCount:records.filter(record=>record.routing?.aiFinal).length,humanConfirmedCount:records.filter(record=>record.routing?.resultSource==='human').length,pendingHumanCount:records.filter(record=>record.routing?.needsReview).length,processedUnknownCount:records.filter(record=>record.routing?.processedUnknown).length,returnedCount:records.filter(record=>record.routing?.returned).length};
}
export function pendingHumanResult(item,routing){return{...clone(item),verdict:'待判定',reason:routing?.processedUnknown?'审核工作已处理，结论仍无法判定；原判断与处理原因独立保留，不进入最终质量分母。':'本轮AI初判尚待人工核对，未形成最终结论。',source:'pending_human',...(Array.isArray(item.evidence)?{evidence:[]}:{} )};}
export const resultSourceLabel=(source,language='zh')=>language==='en'?({ai:'AI final',human:'Human confirmed',ai_final:'AI final',confirmed:'Human confirmed',pending_human:'Pending human',initial:'AI initial — not final performance data'})[source]||'Pending human':({ai:'AI终判',human:'人工确认',ai_final:'AI终判',confirmed:'人工确认',pending_human:'待人工',initial:'AI初判（非绩效最终）'})[source]||'待人工';
export function resultProvenanceSheet(snapshot,language='zh'){
  if(!hasReviewPolicy(snapshot))return null;const english=language==='en';
  return{name:english?'Result provenance':'判定来源与分流',headers:english?['Conversation ID','Original ID','Final result source','Routing status','AI final','Pending human','Confidence','Confidence threshold','Calibration','Export scope','Return reason','Return time','Returned by','Return audit','Routing reasons','Frozen policy','AI decision','Processed; still undetermined','Processing reason','Processed by label','Processed at','Processing audit']:['会话ID','原会话ID','最终判定来源','分流状态','AI终判','待人工','置信度','置信度门槛','真实基准','导出口径','退回原因','退回时间','退回操作人','退回审计','分流原因','策略快照','AI分流记录','已处理仍无法判定','处理原因','处理操作人标签','处理时间','处理审计'],
    rows:snapshot.records.map(record=>{const routing=record.routing,returned=routing?.returnAudit?.current;return[record.id,record.externalId||record.id,routing?.processedUnknown?(english?'Processed; still undetermined':'已处理，结论仍无法判定'):resultSourceLabel(routing?.resultSource,language),routing?.status||'NOT_RUN',Boolean(routing?.aiFinal),Boolean(routing?.needsReview),routing?.decision?.confidence??'',routing?.policy?.confidenceThreshold??snapshot.reviewPolicy.confidenceThreshold??'',snapshot.reviewPolicy.version===2?(english?'Rule-level calibration; see frozen policy':'逐规则标定，详见策略快照'):(english?'unvalidated — not calibrated':'未标定（unvalidated）'),snapshot.resultScope==='initial'?resultSourceLabel('initial',language):english?'Final conclusions':'最终结论',returned?.reason||'',returned?.at||'',returned?.reviewer||'',JSON.stringify(routing?.returnAudit||{}),(routing?.reasons||[]).join('; '),JSON.stringify(routing?.policy||snapshot.reviewPolicy),JSON.stringify({...routing?.decision,...(routing?.exemptRuleIds?{effectiveExemptRuleIds:routing.exemptRuleIds,revocations:routing.ruleCalibrationRevocations}:{})}),Boolean(routing?.processedUnknown),routing?.resolutionAudit?.current?.reason||'',routing?.resolutionAudit?.current?.actor||'',routing?.resolutionAudit?.current?.at||'',JSON.stringify(routing?.resolutionAudit||{})];})};
}
export function triageReportNotice(snapshot,language='zh'){
  const raw=rawReportNotices(snapshot,language),rawNotice=raw.length?`<aside class="notice raw-quality-boundary">${raw.map(text=>`<p>${e(text)}</p>`).join('')}</aside>`:'';
  if(!hasReviewPolicy(snapshot))return rawNotice;const counts=triageMetrics(snapshot.records),english=language==='en',initial=snapshot.resultScope==='initial';
  const summary=english?`AI final: ${counts.aiFinalCount}; Human confirmed: ${counts.humanConfirmedCount}; Pending human: ${counts.pendingHumanCount}; Returned: ${counts.returnedCount}; Processed, still undetermined: ${counts.processedUnknownCount}.`:`AI终判 ${counts.aiFinalCount} 条；人工确认 ${counts.humanConfirmedCount} 条；待人工 ${counts.pendingHumanCount} 条；退回 ${counts.returnedCount} 条；已处理仍无法判定 ${counts.processedUnknownCount} 条。`;
  const manualOnly=snapshot.reviewPolicy.enabled===false?(english?'AI final is disabled; manual review only. Only current human confirmations enter final quality denominators. ':'AI免审已关闭；本任务仅本轮人工确认进入最终质量分母。'):'';
  const policy=snapshot.reviewPolicy.version===2?(english?`Rule-level calibration: ≥30 independent pairs and ≥80% agreement. PASS candidates: ${samplingDescription(snapshot.reviewPolicy,true)}. Observed errors >20% stop the rule and trigger recall. Rule sources and revocation events are included in the frozen routing audit.`:`规则级标定：独立验证≥30对、一致率≥80%。仅符合候选可免审，${samplingDescription(snapshot.reviewPolicy)}强制抽检；人工核验错误率>20%停用并回溯。逐规则来源与停用记录见分流审计。`):manualOnly+(english?`Saved confidence threshold: ${snapshot.reviewPolicy.confidenceThreshold}. Calibration: unvalidated — not calibrated against real business data. FAIL, UNCERTAIN and returned cases do not enter final quality denominators before current human confirmation.`:`保存的置信度门槛 ${snapshot.reviewPolicy.confidenceThreshold}；真实基准未标定（unvalidated）。FAIL、UNCERTAIN和退回记录在本轮人工确认前，不进入最终质量分母。`);
  return rawNotice+`<aside class="notice result-provenance" data-result-scope="${initial?'initial':'final'}"><strong>${e(english?'Result provenance and review routing':'判定来源与分流')}</strong><p>${e(summary)}</p><p>${e(policy)}</p>${counts.processedUnknownCount?`<p>${e(english?'Processed records with undetermined conclusions remain separate. Work completion is not human confirmation or a pass and does not add to final quality denominators.':'已处理但结论仍无法判定的会话单列；工作完成不代表人工确认或通过，不增加最终质量分母。')}</p>`:''}${initial?`<p><strong>${e(english?'This view contains AI initial judgments, not final performance data.':'本视图导出AI初判，初判不作为最终绩效结论。')}</strong></p>`:''}</aside>`;
}
