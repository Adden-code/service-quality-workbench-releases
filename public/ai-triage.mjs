import {nativeLanguageIssue} from './native-language-validation.mjs';
import {hasUnverifiedEvidence} from './evidence-status.mjs';
import {aggregateRuleId} from './scene-aggregate.mjs';
import {hasCompletedAI,hasRawFallback} from './session-result-availability.mjs';
import {isInactiveTask,isVoidedTask} from './task-lifecycle.mjs';
import {hasEcommerceClassification,classificationReviewed} from './ecommerce-classification-review.mjs';
/** Shared routing contract. AI adjudications never masquerade as human reviews. */
import {isRawTranscriptSession} from './raw-transcript.mjs';
import {validateRawResultAssurance,rawTimeRuleIds} from './raw-evidence.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';
import {normalizeCalibratedPolicy,ruleExemption,allRulesExempt,mandatorySampleCount,sampleRank} from './rule-calibration-policy.mjs';
export const DEFAULT_REVIEW_POLICY=Object.freeze({version:1,enabled:true,confidenceThreshold:0.90,calibrationStatus:'unvalidated'});
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function normalizeReviewPolicy(input=DEFAULT_REVIEW_POLICY){
 if(input?.version===2)return normalizeCalibratedPolicy(input);
 if(!object(input)||Object.keys(input).some(k=>!['version','enabled','confidenceThreshold','calibrationStatus'].includes(k)))throw new Error('分级审核策略字段无效。');
 const p={...DEFAULT_REVIEW_POLICY,...input};
 if(p.version!==1||typeof p.enabled!=='boolean'||typeof p.confidenceThreshold!=='number'||!Number.isFinite(p.confidenceThreshold)||p.confidenceThreshold<0||p.confidenceThreshold>1||p.calibrationStatus!=='unvalidated')throw new Error('分级审核门槛须为0至1的数值；真实基准尚未标定。');
 return p;
}
function enabled(session){return [1,2].includes(session.reviewPolicy?.version)&&session.reviewPolicy.enabled===true;}
function deriveRuleDecision(session,policy,{at,runId,basis}){
 const expected=session.expectedRuleIds||[],results=session.aiResults||[],complete=session.aiExecution?.status==='completed'&&expected.length>0&&expected.length===results.length&&new Set(results.map(r=>r.ruleId)).size===expected.length&&expected.every(id=>results.some(r=>r.ruleId===id));
 const ruleDecisions=expected.map(ruleId=>{
  const result=results.find(r=>r.ruleId===ruleId),rule=policy.rules.find(r=>r.ruleId===ruleId),assignment=session.calibrationAssignments?.find(a=>a.ruleId===ruleId&&a.runId===runId&&a.calibrationId===rule?.calibrationId);
  const local=result?deriveAIDecision({...session,expectedRuleIds:[ruleId],aiResults:[result]}, {...DEFAULT_REVIEW_POLICY,confidenceThreshold:0},{at,runId,basis:{...basis,rules:(basis?.rules||[]).filter(r=>r.id===ruleId)}}):null;
  const errors=(local?.reasonCodes||[]).filter(code=>!['missing_confidence','low_confidence'].includes(code));
  const definition=basis?.rules?.find(r=>r.id===ruleId);
  if(/整体判定/.test(definition?.category||'')&&result?.verdict==='符合'&&results.some(r=>r.ruleId!==ruleId&&r.verdict==='不符合'))errors.push('rule_conflict');
  const qualified=policy.enabled&&complete&&result?.verdict==='符合'&&rule&&assignment?.active&&!errors.length;
  return{ruleId,status:qualified?(assignment.sampled?'sample':'exempt'):'manual',calibrationId:rule?.calibrationId||null,reasonCodes:!complete?['output_failure']:!rule?['rule_uncalibrated']:!assignment?.active?['calibration_inactive']:result?.verdict!=='符合'?['non_pass']:errors,ordinal:assignment?.ordinal||null};
 });
 const status=ruleDecisions.length&&ruleDecisions.every(r=>r.status==='exempt')?'PASS':results.some(r=>r.verdict==='不符合')?'FAIL':'UNCERTAIN';
 return{version:2,status,runId:runId||'',decidedAt:at,calibrationStatus:'per-rule',ruleDecisions,reasonCodes:status==='PASS'?[]:['rule_review_required'],reasons:status==='PASS'?[]:['仅达标规则的符合项可免审；抽检项、其他判定和未达标规则仍须人工。']};
}
export function deriveAIDecision(session,input,{at=new Date().toISOString(),runId=session.aiExecution?.runId,basis}={}){
 if(input?.version===2)return deriveRuleDecision(session,normalizeReviewPolicy(input),{at,runId,basis});
 const policy=normalizeReviewPolicy(input),issues=[],codes=[];let confidence=1;
 const issue=(code,message)=>{if(!codes.includes(code)){codes.push(code);issues.push(message);}};
 const expected=session.expectedRuleIds||[],results=session.aiResults||[],turns=session.turns||[],raw=isRawTranscriptSession(session);
 const unavailableTimeRules=raw&&session.rawTranscript.timePolicy?.mode==='unavailable'?rawTimeRuleIds(basis):[];
 if(session.aiExecution?.status!=='completed')issue('output_failure','AI未形成完整有效输出，须由人工核对。');
 if(!expected.length||new Set(expected).size!==expected.length||results.length!==expected.length||new Set(results.map(r=>r.ruleId)).size!==expected.length||results.some(r=>!expected.includes(r.ruleId)))issue('missing_checks','检核结果未完整覆盖冻结规则。');
 for(const result of results){
  if(nativeLanguageIssue(result))issue('language_unverified','AI理由语种尚未核验，须人工确认，不能免审。');
  if(hasUnverifiedEvidence(result))issue('quote_unverified','本项依据未核验，可由人工确认，不能免审。');
  const localTime=result.ruleId==='EC-TIME'&&Boolean(session.ecommerce);
  const value=localTime?1:result.confidence;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)issue('missing_confidence','模型未提供有效置信度，不能免审。');
  else{confidence=Math.min(confidence,value);if(value<policy.confidenceThreshold)issue('low_confidence','至少一项置信度低于本任务门槛。');}
  if(!['符合','不符合','无法判定','不适用'].includes(result.verdict)||result.verdict==='无法判定')issue('indeterminate','至少一项证据不足或无法判定。');
  if(typeof result.reason!=='string'||!result.reason.trim())issue('invalid_reason','判定缺少可追溯的理由。');
  if(raw){
   const assurance=validateRawResultAssurance(result,session);
   if(!assurance.valid)issue('quote_mismatch','引文无法在本行原始单元格逐字定位，须人工核对。');
   if(result.rawValidation?.status!=='verified'&&result.rawValidation?.status!=='unverified-quote')issue('raw_result_degraded','原文结果经程序降级或执行失败，须人工核对。');
   if(unavailableTimeRules.includes(result.ruleId)&&result.verdict!=='无法判定')issue('source_time_unavailable','未提供可靠来源时间，纯时效类检核须保留无法判定。');
  }else if(!Array.isArray(result.evidence)||result.evidence.some(id=>!Number.isSafeInteger(id)||!turns.some(t=>t.id===id)))issue('invalid_evidence','轮次证据无效。');
  if(!localTime){
   if(!Array.isArray(result.conflictsWith))issue('missing_consistency','模型未完成规则间一致性检查。');
   else if(result.conflictsWith.length)issue('rule_conflict','规则之间存在尚未消解的结论冲突。');
   const quotes=result.evidenceQuotes;
   if((!Array.isArray(quotes)||!quotes.length)&&!hasUnverifiedEvidence(result))issue('missing_quote','缺少可逐字定位的原文引文或不适用依据。');
   for(const quote of !raw&&Array.isArray(quotes)?quotes:[]){
    const turn=turns.find(t=>t.id===quote?.turnId);
    if(!turn||typeof quote.quote!=='string'||!quote.quote.trim()||!turn.text.includes(quote.quote)||!result.evidence?.includes(quote.turnId))issue('quote_mismatch','引文无法在声明轮次逐字定位。');
    else if(quote.role!==undefined&&quote.role!==turn.role)issue('quote_role_mismatch','引文角色与声明轮次不符。');
   }
  }
  const rule=basis?.rules?.find(r=>r.id===result.ruleId);
  if(rule?.policyIds?.length&&(!Array.isArray(result.referenceIds)||!result.referenceIds.length))issue('missing_reference','判定未引用本任务冻结的依据。');
 }
 const principle=(basis?.rules||[]).filter(r=>/整体判定/.test(r.category||''));
 for(const rule of principle){const p=results.find(r=>r.ruleId===rule.id),others=results.filter(r=>r.ruleId!==rule.id);if(p&&others.length&&((p.verdict==='符合'&&others.some(r=>r.verdict==='不符合'))||(p.verdict==='不符合'&&others.every(r=>['符合','不适用'].includes(r.verdict)))))issue('rule_conflict','整体判定原则与逐项结论互相矛盾。');}
 if(results.length&&results.every(r=>r.verdict==='不适用'))issue('no_applicable_checks','全部检核项不适用，不能形成质量通过。');
 const status=issues.length?'UNCERTAIN':results.some(r=>r.verdict==='不符合')?'FAIL':'PASS';
 return {version:1,status,runId:runId||'',decidedAt:at,confidence:codes.includes('missing_confidence')?null:confidence,confidenceThreshold:policy.confidenceThreshold,calibrationStatus:policy.calibrationStatus,reasonCodes:codes,reasons:issues};
}
export function isAIFinal(session){return Boolean((!hasEcommerceClassification(session)||classificationReviewed(session))&&enabled(session)&&session.aiDecision?.status==='PASS'&&(session.reviewPolicy.version!==2||allRulesExempt(session))&&session.aiExecution?.status==='completed'&&session.aiDecision.runId===session.aiExecution.runId&&!session.review?.returned&&session.review?.status==='待审核'&&!session.review?.notes?.trim()&&!session.review?.history?.length&&!Object.keys(session.review?.drafts||{}).length);}
export const isFinalSession=session=>session.review?.status==='已确认'||isAIFinal(session);
export const isReviewWorkComplete=session=>isFinalSession(session)||isProcessedUnknown(session);
export function requiresHumanReview(session){
 if(hasEcommerceClassification(session)&&!classificationReviewed(session))return true;
 if(isReviewWorkComplete(session))return false;
 if(!enabled(session))return true;
 return Boolean(hasCompletedAI(session)||session.review?.returned||session.aiDecision||session.aiExecution?.status==='failed'||Object.keys(session.review?.drafts||{}).length||['已暂存','待补充'].includes(session.review?.status));
}
/** Read-only business projection used by all review entry points and displays. */
export function getReviewPresentation(session,task){
 const human=session.review?.status==='已确认',processedUnknown=isProcessedUnknown(session),aiFinal=isAIFinal(session),inactive=isInactiveTask(task);
 const aggregate=aggregateRuleId(task?.executionSnapshot||session.executionSnapshot),expected=(session.expectedRuleIds||session.aiResults?.map(r=>r.ruleId)||[]).filter(id=>id!==aggregate),ready=hasCompletedAI(session),fallback=hasRawFallback(session);
 const aiCount=ready?session.aiResults.filter(r=>expected.includes(r.ruleId)).length:0,draftCount=Object.keys(session.review?.drafts||{}).length;
 const needsReview=!inactive&&requiresHumanReview(session),pendingCount=human||processedUnknown||aiFinal?0:expected.filter(id=>!ruleExemption(session,id)&&!session.review?.drafts?.[id]).length;
 const returned=Boolean(session.review?.returned),execution=session.aiExecution?.status||'not_run';
 const kind=human?'human':processedUnknown?'processed-unknown':aiFinal?'ai-final':returned?'returned':aiCount?'pending-ai':draftCount?'pending-draft':fallback||execution==='failed'?'pending-manual':needsReview?'pending-manual':'waiting';
 return {kind,aiCount,draftCount,pendingCount,needsReview,aiFinal,human,processedUnknown,returned,execution,inactive,lifecycle:isVoidedTask(task)?'voided':inactive?'archived':'active',ready:aiCount>0||draftCount>0||fallback,initialPending:needsReview&&aiCount>0};
}
export function getReviewRouting(session){
 const aiFinal=isAIFinal(session),human=session.review?.status==='已确认';
 return {status:enabled(session)?session.aiDecision?.status||(hasCompletedAI(session)||session.aiExecution?.status==='failed'?'UNCERTAIN':'NOT_RUN'):'LEGACY',aiFinal,needsReview:requiresHumanReview(session),...(isProcessedUnknown(session)?{processedUnknown:true}:{}),resultSource:human?'human':aiFinal?'ai':null,returned:Boolean(session.review?.returned),reasons:clone(session.aiDecision?.reasons||[])};
}
export function reviewQueueBreakdown(state){
 const byTask=(state.tasks||[]).map(task=>{const items=(state.sessions||[]).filter(s=>s.taskId===task.id&&getReviewPresentation(s,task).needsReview);return {taskId:task.id,name:task.name,scene:task.scene||items[0]?.scene||'',count:items.length,fail:items.filter(s=>s.aiDecision?.status==='FAIL'&&!s.review?.returned).length,uncertain:items.filter(s=>s.aiDecision?.status==='UNCERTAIN'&&!s.review?.returned).length,returned:items.filter(s=>s.review?.returned).length};}).filter(t=>t.count);
 const byScene=[];for(const task of byTask){let row=byScene.find(s=>s.scene===task.scene);if(!row){row={scene:task.scene,count:0};byScene.push(row);}row.count+=task.count;}
 return {total:byTask.reduce((n,t)=>n+t.count,0),aiFinal:(state.sessions||[]).filter(isAIFinal).length,humanConfirmed:(state.sessions||[]).filter(s=>s.review?.status==='已确认').length,byTask,byScene};
}
export function returnToHumanReview(state,{sessionIds,taskId,ruleIds,candidateSessionIds,reason,reviewer,now=new Date().toISOString()}={}){
 if(typeof reason!=='string'||!reason.trim()||reason.length>2000)throw new Error('请填写退回人工的原因（不超过2000字符）。');
 if(typeof reviewer!=='string'||!reviewer.trim()||reviewer.length>80)throw new Error('请填写操作人标签。');
 if(typeof now!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(now)||!Number.isFinite(Date.parse(now)))throw new Error('退回时间须含时区。');
 if(sessionIds!==undefined&&(!Array.isArray(sessionIds)||!sessionIds.length||sessionIds.some(id=>typeof id!=='string')))throw new Error('请选择要退回的会话。');
 if(candidateSessionIds!==undefined&&(!Array.isArray(candidateSessionIds)||!candidateSessionIds.length||candidateSessionIds.some(id=>typeof id!=='string'||!id)))throw new Error('请选择要退回的会话。');
 if(!sessionIds?.length&&!taskId)throw new Error('请选择退回范围。');
 if(ruleIds!==undefined&&(!Array.isArray(ruleIds)||!ruleIds.length||ruleIds.some(id=>typeof id!=='string'||!id)))throw new Error('请选择规则范围。');
 const next=clone(state),selected=next.sessions.filter(s=>(!candidateSessionIds||candidateSessionIds.includes(s.id))&&(!sessionIds||sessionIds.includes(s.id))&&(!taskId||s.taskId===taskId)&&(!ruleIds||ruleIds.some(id=>s.expectedRuleIds?.includes(id)))&&(isAIFinal(s)||(s.review?.returned&&s.aiDecision?.status==='PASS'&&s.review.status!=='已确认')));
 if(!selected.length)throw new Error('所选范围没有可退回的AI终判PASS记录。');
 for(const session of selected){
  if(session.review.returned&&session.review.returned.reason===reason.trim())continue;
  const record={at:now,reviewer:reviewer.trim(),reason:reason.trim(),runId:session.aiDecision.runId,scope:ruleIds?'rule':taskId&&!sessionIds?'task':'session',...(ruleIds?{ruleIds:[...new Set(ruleIds)]}:{})};
  session.review.returned=record;session.review.returnHistory=[...(session.review.returnHistory||[]),clone(record)];session.review.status='待审核';session.review.completedAt=null;
  next.activity??=[];next.activity.unshift({id:`RETURN-${session.id}-${session.review.returnHistory.length}`,sessionId:session.id,taskId:session.taskId,action:'AI终判标记可疑并退回人工',at:now,reviewer:reviewer.trim()});
 }
 for(const task of next.tasks||[]){const rows=next.sessions.filter(s=>s.taskId===task.id);if(!rows.length)continue;task.progress=Math.round(rows.filter(isFinalSession).length/rows.length*100);task.status=rows.every(isFinalSession)?'已完成':'待审核';}
 return next;
}
/** Called at durable run completion; existing immutable decisions are retained. */
export function applyAIDecisions(state,task,at=new Date().toISOString()){
 if(!task.reviewPolicy?.enabled)return;const pending=[];
 for(const session of state.sessions.filter(s=>s.taskId===task.id)){
  if(session.review.status==='已确认'||!session.aiExecution||session.aiExecution.status==='running')continue;
  if(session.aiDecision&&session.aiDecision.runId===session.aiExecution.runId&&session.aiExecution.status==='completed')continue;
  if(task.reviewPolicy.version===2){
   session.calibrationAssignments=task.reviewPolicy.rules.map(rule=>{
    const record=state.ruleCalibrations?.records?.find(r=>r.id===rule.calibrationId),active=record?.enabled&&!record.forbidden&&!record.invalidatedAt&&task.aiRun?.modelConfigFingerprint===rule.modelFingerprint&&session.aiExecution?.promptVersion===rule.promptVersion;
    const sourceKey=session.rawTranscript?.textSha256||JSON.stringify([task.source?.sha256,session.externalId]);
    const existing=state.sessions.filter(s=>s.id!==session.id).flatMap(s=>s.calibrationAssignments||[]).filter(a=>a.calibrationId===rule.calibrationId&&a.eligible),prior=existing.find(a=>a.sourceKey===sourceKey);
    const draft={ruleId:rule.ruleId,calibrationId:rule.calibrationId,active:Boolean(active),ordinal:0,sampled:false,runId:session.aiExecution.runId,sourceKey};
    const probe=deriveRuleDecision({...session,calibrationAssignments:[draft]},task.reviewPolicy,{at,runId:session.aiExecution.runId,basis:task.basisSnapshot});
    const eligible=probe.ruleDecisions.some(d=>d.ruleId===rule.ruleId&&d.status==='exempt'),ordinal=eligible?(prior?.ordinal||1+existing.reduce((m,a)=>Math.max(m,a.ordinal||0),0)):0;
    return{...draft,eligible,ordinal,sampled:eligible&&!task.reviewPolicy.sampling&&ordinal%5===1};
   });
  }
  pending.push(session);
 }
 if(task.reviewPolicy.sampling){for(const rule of task.reviewPolicy.rules){const candidates=state.sessions.filter(s=>s.taskId===task.id).map(s=>({s,a:s.calibrationAssignments?.find(a=>a.ruleId===rule.ruleId&&a.calibrationId===rule.calibrationId&&a.eligible)})).filter(x=>x.a),existing=candidates.filter(x=>x.a.sampled).length,needed=Math.max(0,mandatorySampleCount(candidates.length)-existing);const pool=candidates.filter(x=>pending.includes(x.s)&&!x.a.sampled).sort((a,b)=>sampleRank([task.id,task.aiRun.id,rule.calibrationId,a.s.id].join('|'))-sampleRank([task.id,task.aiRun.id,rule.calibrationId,b.s.id].join('|'))||a.s.id.localeCompare(b.s.id));for(const {a} of pool.slice(0,needed))a.sampled=true;}}
 for(const session of pending)session.aiDecision=deriveAIDecision(session,task.reviewPolicy,{at,runId:session.aiExecution.runId,basis:task.basisSnapshot});
 const sessions=state.sessions.filter(s=>s.taskId===task.id);task.progress=sessions.length?Math.round(sessions.filter(isFinalSession).length/sessions.length*100):0;task.status=sessions.length&&sessions.every(isFinalSession)?'已完成':'待审核';
}
/** Retrying a failed execution starts a new current decision, preserving its audit. */
export function archiveFailedAIDecision(session){
 if(session.aiDecision&&(session.aiExecution?.status==='failed'||session.aiResults?.some(r=>r.comparisonAssessment?.status==='incomplete'))){
  session.aiDecisionHistory=[...(session.aiDecisionHistory||[]),clone(session.aiDecision)];delete session.aiDecision;
 }
}
