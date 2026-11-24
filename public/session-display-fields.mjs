/** AI explanations only. Source quotes, user edits and audit history stay original. */
export function sessionDisplayFields(session){
 const fields=[];
 const add=(id,text)=>{if(typeof text==='string'&&text.trim())fields.push({id,text});};
 for(const result of session?.aiResults||[]){
  const prefix=`aiResults.${result.ruleId}`;add(prefix+'.reason',result.reason);
  (result.batchEvidence||[]).forEach((group,index)=>add(`${prefix}.batchEvidence.${index}.reason`,group.reason));
  for(const [key,value] of Object.entries(result.subChecks||{}))add(`${prefix}.subChecks.${key}.reason`,value?.reason);
 }
 for(const [key,value] of Object.entries(session?.sceneCapabilities?.outputs||{})){
  add(`capabilities.${key}.reason`,value?.reason);add(`capabilities.${key}.value.reason`,value?.value?.reason);add(`capabilities.${key}.fallbackReason`,value?.fallbackReason);
  (value?.metrics||[]).forEach((metric,index)=>add(`capabilities.${key}.metrics.${index}.reason`,metric?.reason));
 }
 add('ecommerce.aiTypeReason',session?.ecommerce?.aiTypeReason);
 return fields;
}
