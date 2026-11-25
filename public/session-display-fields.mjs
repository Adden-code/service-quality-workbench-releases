/** AI explanations only. Source quotes, user edits and audit history stay original. */
export function sessionDisplayFields(session,task){
 const fields=[];
 const add=(id,text)=>{if(typeof text==='string'&&text.trim())fields.push({id,text});};
 for(const result of session?.aiResults||[]){
  const prefix=`aiResults.${result.ruleId}`;add(prefix+'.reason',result.reason);
  (result.turnRefs||[]).forEach((hint,index)=>add(`${prefix}.turnRefs.${index}`,hint));
  (result.batchEvidence||[]).forEach((group,index)=>add(`${prefix}.batchEvidence.${index}.reason`,group.reason));
  for(const [key,value] of Object.entries(result.subChecks||{}))add(`${prefix}.subChecks.${key}.reason`,value?.reason);
 }
 const capabilities=(outputs,prefix)=>{for(const [key,value] of Object.entries(outputs||{})){
  for(const field of ['reason','fallbackReason','summary'])add(`${prefix}.${key}.${field}`,value?.[field]);
  for(const field of ['reason','text','label','summary','demandSummary','negativeVoice'])add(`${prefix}.${key}.value.${field}`,value?.value?.[field]);
  (value?.metrics||[]).forEach((metric,index)=>{add(`${prefix}.${key}.metrics.${index}.reason`,metric?.reason);(metric?.actual||[]).forEach((actual,i)=>add(`${prefix}.${key}.metrics.${index}.actual.${i}.topic`,actual?.topic));});
 }};
 capabilities(session?.sceneCapabilities?.outputs,'capabilities');
 // Recovery candidates are model output, separate from saved human judgments.
 const candidate=task?.aiQueue?.rows?.find(row=>row.sessionId===session?.id)?.capabilityRecovery?.at(-1);
 if(candidate){capabilities(candidate.candidateCapabilities?.outputs,'recovery.capabilities');for(const result of candidate.candidateResults||[])add(`recovery.results.${result.ruleId}.reason`,result.reason);}
 add('ecommerce.aiTypeReason',session?.ecommerce?.aiTypeReason);
 return fields;
}
