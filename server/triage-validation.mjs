import {deriveAIDecision,normalizeReviewPolicy,isAIFinal} from '../public/ai-triage.mjs';
import {isRawTranscriptSession} from '../public/raw-transcript.mjs';
import {validateRawResultAssurance,rawTimeRuleIds} from '../public/raw-evidence.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const equal=(a,b)=>stable(a)===stable(b);
const fail=message=>{throw new Error(message);};
const time=value=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
export function validateResultAssurance(result,session){
 if(result.evidenceValidation!==undefined&&(!object(result.evidenceValidation)||result.evidenceValidation.version!==1||result.evidenceValidation.status!=='unverified'||!Array.isArray(result.evidenceValidation.rejectedQuotes)&&!Array.isArray(result.evidenceValidation.dependencies)))fail('证据核验标注无效。');
 if(result.confidence!==undefined&&(typeof result.confidence!=='number'||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1))fail('AI置信度须为0至1有限数值。');
 if(result.conflictsWith!==undefined&&(!Array.isArray(result.conflictsWith)||new Set(result.conflictsWith).size!==result.conflictsWith.length||result.conflictsWith.some(id=>!session.expectedRuleIds?.includes(id)||id===result.ruleId)))fail('AI冲突规则必须属于本会话预期检核项。');
 if(isRawTranscriptSession(session)){
  const assurance=validateRawResultAssurance(result,session);
  if(!assurance.valid)fail(`原文逐字引文、来源摘要或定位校验失败：${assurance.reasonCodes.join('、')}。`);
  return;
 }
 if(result.evidenceQuotes!==undefined){
  if(!Array.isArray(result.evidenceQuotes)||result.evidenceQuotes.length>500)fail('AI逐字引文结构无效。');
  for(const q of result.evidenceQuotes){const turn=session.turns.find(t=>t.id===q?.turnId);if(!object(q)||Object.keys(q).some(k=>!['turnId','quote','role'].includes(k))||!Number.isSafeInteger(q.turnId)||!turn||!result.evidence?.includes(q.turnId)||typeof q.quote!=='string'||!q.quote.trim()||q.quote.length>20000||!turn.text.includes(q.quote)||(q.role!==undefined&&q.role!==turn.role))fail('AI逐字引文未通过轮次及角色校验。');}
 }
}
export function validateTriageTask(task){if(task.reviewPolicy!==undefined&&!equal(task.reviewPolicy,normalizeReviewPolicy(task.reviewPolicy)))fail('任务分级审核策略不完整。');}
export function validateTriageSession(session,task){
 if(!equal(session.reviewPolicy,task.reviewPolicy))fail('会话分级审核策略须与冻结任务一致。');
 for(const result of session.aiResults||[])validateResultAssurance(result,session);
 if(isRawTranscriptSession(session)){
  for(const result of Object.values(session.review.drafts||{}))validateResultAssurance(result,session);
  const rawResults=session.aiResults||[];
  const programTimeIds=new Set(session.rawTranscript.timePolicy?.mode==='unavailable'?rawTimeRuleIds(task.basisSnapshot):[]);
  const failureResult=result=>result.verdict==='无法判定'&&(result.rawValidation?.status==='program-fallback'||programTimeIds.has(result.ruleId)&&result.rawValidation?.status==='verified'&&result.rawValidation.reasonCodes?.includes('source_time_unavailable')&&result.confidence===0&&result.evidenceQuotes?.length===0);
  if(rawResults.some(result=>result.rawValidation?.status==='program-fallback')&&(session.aiExecution?.status!=='failed'||rawResults.some(result=>!failureResult(result))))fail('程序无法判定占位只允许完整保留在执行失败的原文行。');
  if(session.aiExecution?.status==='failed'&&rawResults.length&&rawResults.some(result=>!failureResult(result)))fail('原文执行失败不能伪装为AI有效完成结果。');
  if(session.rawTranscript.timePolicy?.mode==='unavailable'){
   const ids=rawTimeRuleIds(task.basisSnapshot);
   if(rawResults.some(result=>ids.includes(result.ruleId)&&result.verdict!=='无法判定'))fail('未提供可靠来源时间，原文纯时效AI结果须为无法判定。');
  }
 }
 if(session.aiDecisionHistory!==undefined){
  if(!Array.isArray(session.aiDecisionHistory)||session.aiDecisionHistory.length>10000)fail('AI判定审计历史无效。');
  for(const d of session.aiDecisionHistory){const run=[task.aiRun,...(task.aiRunHistory||[])].find(r=>r?.id===d?.runId);if(!object(d)||![1,2].includes(d.version)||!['UNCERTAIN','FAIL'].includes(d.status)||!run||!time(d.decidedAt)||!Array.isArray(d.reasonCodes)||!Array.isArray(d.reasons)||d.reasonCodes.some(c=>typeof c!=='string')||d.reasons.some(c=>typeof c!=='string'))fail('历史AI不确定判定须保留有效原运行及诊断。');}
 }
 if(session.aiDecision!==undefined){
  const d=session.aiDecision;if(!task.reviewPolicy?.enabled||!object(d)||!time(d.decidedAt)||!session.aiExecution||session.aiExecution.status==='running'||d.runId!==session.aiExecution.runId)fail('AI终判须关联有效冻结策略及本次执行。');
  const expected=deriveAIDecision(session,task.reviewPolicy,{at:d.decidedAt,runId:d.runId,basis:task.basisSnapshot});if(!equal(d,expected))fail('AI终判与实际证据、置信度或冻结门槛不一致。');
 }
 const r=session.review;
 if(r.returned!==undefined||r.returnHistory!==undefined){
  if(!session.aiDecision||session.aiDecision.status!=='PASS'||!Array.isArray(r.returnHistory)||!r.returnHistory.length||!equal(r.returned,r.returnHistory.at(-1)))fail('退回人工必须保留原AI终判及追加记录。');
  for(const h of r.returnHistory){if(!object(h)||Object.keys(h).some(k=>!['at','reviewer','reason','runId','scope','ruleIds'].includes(k))||!time(h.at)||typeof h.reviewer!=='string'||!h.reviewer.trim()||h.reviewer.length>80||typeof h.reason!=='string'||!h.reason.trim()||h.reason.length>2000||h.runId!==session.aiDecision.runId||!['session','task','rule'].includes(h.scope)||(h.ruleIds!==undefined&&(!Array.isArray(h.ruleIds)||!h.ruleIds.length||h.ruleIds.some(id=>!session.expectedRuleIds.includes(id)))))fail('退回人工的原因、操作人或范围记录无效。');}
 }
}
export function validateReturnTransition(before,after){
 const old=before.review.returnHistory||[],next=after.review.returnHistory||[];
 if(isRawTranscriptSession(before)&&isAIFinal(before)&&!equal(before.review,after.review)&&next.length===old.length)fail('原文AI终判只读，修改前须标记可疑并保留退回人工的原因与操作人。');
 if(next.length<old.length||!equal(old,next.slice(0,old.length)))fail('已有退回人工审计历史不可删除或修改。');
 if(next.length>old.length&&(!isAIFinal(before)&&!before.review.returned))fail('仅AI终判PASS记录允许标记可疑退回人工。');
 if(before.review.returned!==undefined&&after.review.returned===undefined)fail('退回人工标记不可静默移除；请完成人工确认。');
}
export function validateDecisionHistoryTransition(before,after){
 const old=before.aiDecisionHistory||[],next=after.aiDecisionHistory||[];
 if(!Array.isArray(next)||next.length<old.length||!equal(old,next.slice(0,old.length)))fail('AI判定审计历史不可删除或改写。');
 const incomplete=before.aiResults?.some(r=>r.comparisonAssessment?.status==='incomplete');
 const dependencyRecovered=(before.aiExecution?.errorCode==='dependency_incomplete'||incomplete)&&after.aiExecution?.status==='completed';
 if(next.length!==old.length&&(next.length!==old.length+1||(before.aiExecution?.status!=='failed'&&!incomplete)||!['UNCERTAIN','FAIL'].includes(before.aiDecision?.status)||(!dependencyRecovered&&after.aiExecution?.status!=='running')||(after.aiDecision!==undefined&&!dependencyRecovered)||!equal(next.at(-1),before.aiDecision)))fail('AI判定审计只允许重试失败项或恢复已完成比较依赖时追加原不确定记录。');
}
