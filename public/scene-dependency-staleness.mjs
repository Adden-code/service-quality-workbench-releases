// A technical classification gap is different from missing business evidence.
// Only these two explicitly identified outcomes may be superseded after recovery.
export const CLASSIFICATION_DEPENDENT_RULE_IDS=Object.freeze(['EC-TIME','EC-STEPS']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const classification=capabilities=>capabilities?.outputs?.ecommerceClassification;
export const hasHumanDependencyReview=s=>Boolean(s.review&&(s.review.status!=='待审核'||Object.keys(s.review.drafts||{}).length||s.review.notes?.trim()||s.review.history?.length||s.review.classification||s.review.returned||s.review.completedAt));
export const dependencyRecoveryRun=(session,task)=>[task?.aiRun,...(task?.aiRunHistory||[])].find(run=>run?.id===session?.aiExecution?.runId);
const classificationUnknown=reason=>/(?:分类|归类).*(?:未知|未确定|不确定|缺失|失败|无法|未完成)|(?:未知|未确定|缺失|失败|无法).*(?:分类|归类)|classification.*(?:unknown|missing|unavailable|failed)|(?:unknown|missing|unavailable|failed).*classification/i.test(reason||'');
export function classificationBlockedRuleIds(session){
 if(!session?.ecommerce)return [];
 return(session.aiResults||[]).filter(result=>{
  if(result.verdict!=='无法判定')return false;
  if(result.ruleId==='EC-TIME')return result.timeFacts?.executionProfile==='ec-business-v1'&&result.timeFacts.evaluationType===null&&result.timeFacts.reason==='评价分类尚未确定，未选择时效阈值。';
  if(result.ruleId!=='EC-STEPS')return false;
  const dependency=result.sceneDependencies?.find(d=>d.capability==='ecommerceClassification');
  if(!result.sceneProgramDecision||!dependency||dependency.status==='completed')return false;
  const component=result.sceneModelComponent;
  // A business unknown in the original model component stays unknown. Legacy
  // components explicitly reporting missing classification are retryable too.
  return Boolean(component&&(component.verdict!=='无法判定'||classificationUnknown(component.reason)));
 }).map(result=>result.ruleId);
}
export function dependencyStaleness(session,task){
 const row=task?.aiQueue?.rows?.find(r=>r.sessionId===session?.id),last=row?.capabilityRecovery?.at(-1),ruleIds=classificationBlockedRuleIds(session);
 const output=classification(session?.sceneCapabilities),candidate=last?.candidateCapabilities&&classification(last.candidateCapabilities);
 const recovered=Boolean(candidate?.status==='completed'||output?.status==='completed'),protectedRow=hasHumanDependencyReview(session);
 const failed=output?.status==='failed'||output?.dependencyBlocked===true;
 const affected=ruleIds.length?ruleIds:last?.ruleIds||[],review=session?.review,c=review?.classification,recoveryAt=Date.parse(last?.at),checkpoint=last?.humanReviewCheckpoint;
 const resolvedByHuman=Boolean(protectedRow&&recovered&&review.status==='已确认'&&c?.runId===session.aiExecution?.runId&&Date.parse(c.at)>=recoveryAt&&(!checkpoint||c.at!==checkpoint.classificationAt)&&affected.length&&affected.every(id=>review.drafts?.[id]&&review.drafts[id].source!=='AI接受'&&(review.history||[]).slice(checkpoint?.historyLength||0).some(h=>h.ruleId===id&&Date.parse(h.at)>=recoveryAt&&h.after?.source!=='AI接受')));
 const relevant=!resolvedByHuman&&Boolean(ruleIds.length&&(failed||recovered)||protectedRow&&candidate?.status==='completed'&&last?.ruleIds?.length);
 const canRetry=Boolean(relevant&&task?.executionSnapshot?.configuration.executionMode==='configured'&&dependencyRecoveryRun(session,task)&&!task.lifecycle?.archivedAt&&!task.lifecycle?.voidedAt);
 return{ruleIds:resolvedByHuman?[]:affected,recovered,protected:protectedRow,stale:relevant,canRetry,resolvedByHuman,candidateResults:last?.candidateResults||[],lastError:last?.ruleRecoveryError||null,
  message:!relevant?'':protectedRow?(recovered?'评价归类能力已恢复；本行人工记录及原判保留。可单行重试查看候选判断，候选不会覆盖人工结果。':'评价归类能力未完成；本行人工记录及原判保留，可单行重试依赖项。'):(recovered?'评价归类能力已恢复，仍有依赖旧分类的未知项，可单行重试。':'评价归类能力未完成，时效或回复结构待依赖恢复后重算。')};
}

// Authoritative storage guard. This is deliberately independent of server-only
// helpers so the exact superseding scope can also be inspected by the UI/tests.
export function isDependencyRecoveryTransition(before,after){
 const old=before.sceneCapabilities?.dependencyRecoveryHistory||[],next=after.sceneCapabilities?.dependencyRecoveryHistory||[];
 if(next.length!==old.length+1||!same(old,next.slice(0,-1)))return false;
 const audit=next.at(-1),ids=classificationBlockedRuleIds(before),changed=before.aiResults.filter((result,index)=>!same(result,after.aiResults[index])).map(result=>result.ruleId);
 if(!audit||audit.version!==1||!['automatic-recovery','row-retry'].includes(audit.trigger)||!audit.at||!Number.isFinite(Date.parse(audit.at))||audit.runId!==before.aiExecution?.runId||before.aiExecution?.status!=='completed'||!same(before.aiExecution,after.aiExecution)||hasHumanDependencyReview(before)||hasHumanDependencyReview(after)||!same(before.review,after.review)||before.aiResults.length!==after.aiResults.length||!changed.length||changed.some(id=>!ids.includes(id))||!same(audit.ruleIds,changed))return false;
 if(!same(audit.beforeResults,before.aiResults.filter(r=>changed.includes(r.ruleId)))||!same(audit.afterResults,after.aiResults.filter(r=>changed.includes(r.ruleId)))||!same(audit.beforeClassification,classification(before.sceneCapabilities)??null)||!same(audit.afterClassification,classification(after.sceneCapabilities)??null)||audit.afterClassification?.status!=='completed')return false;
 if(!same(audit.beforeJudgmentClassificationSnapshot,before.sceneCapabilities?.judgmentClassificationSnapshot??null)||!same(audit.afterJudgmentClassificationSnapshot,after.sceneCapabilities?.judgmentClassificationSnapshot??null))return false;
 const oldFrozen=before.sceneCapabilities?.judgmentClassificationSnapshot,newFrozen=after.sceneCapabilities?.judgmentClassificationSnapshot;
 if(changed.includes('EC-TIME')?newFrozen!==undefined:oldFrozen?!same(oldFrozen,newFrozen):newFrozen!==undefined&&!same(newFrozen,{runId:before.aiExecution.runId,output:classification(before.sceneCapabilities)??null}))return false;
 if(!same(audit.beforeDecision,before.aiDecision??null)||!same(audit.afterDecision,after.aiDecision??null))return false;
 const priorHistory=before.aiDecisionHistory||[],history=after.aiDecisionHistory||[];
 if(!same(history,before.aiDecision?[...priorHistory,before.aiDecision]:priorHistory))return false;
 return true;
}

export function validateDependencyRecoveryHistory(before,after,{trustedAI=false}={}){
 const old=before.sceneCapabilities?.dependencyRecoveryHistory||[],next=after.sceneCapabilities?.dependencyRecoveryHistory||[];
 if(!Array.isArray(next)||next.length<old.length||!same(old,next.slice(0,old.length)))throw new Error('依赖重算的原判与审计记录不可删除或改写。');
 if(next.length!==old.length&&(!trustedAI||!isDependencyRecoveryTransition(before,after)))throw new Error('依赖重算只允许技术依赖恢复后定向追加原判及新判，人工记录保持冻结。');
 return next.length!==old.length;
}
