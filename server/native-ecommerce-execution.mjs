import {nativeMessage,assureNativeResults} from './native-language-execution.mjs';
import {businessReplySimilarity,businessDuplicateAssessment} from '../public/ecommerce-business-profile.mjs';
import {hasTargetCalibrationPolicy,hasTargetLimitedPolicy} from '../public/ecommerce-semantic-policy.mjs';

// Render program facts directly from frozen calculation results. The original
// timeFacts remain byte-for-byte recomputable; no generated prose is translated.
export function nativeEcommerceBatchFacts(sessions,basis){
 return{assessment:hasTargetCalibrationPolicy(basis)?businessDuplicateAssessment(sessions,basis):null,byId:new Map(sessions.map(s=>[s.id,s])),groupFacts:new Map()};
}
export function nativeEcommerceProgramResults(session,results,context,basis,sessions=[session],batchFacts){
 if(!context)return results;
 const enumType={'好评正向':'positive-positive','好评负向':'positive-negative','中评':'neutral','差评':'negative','无效评价':'invalid','无法判定':'unknown'};
 const batch=batchFacts||nativeEcommerceBatchFacts(sessions,basis),assessment=batch.assessment;
 return results.map(result=>{
  let value=structuredClone(result),changed=false;
  if(value.ruleId==='EC-TIME'){
   const f=value.timeFacts||{};
   const facts={mode:f.mode??null,status:f.replyStatus??null,outcome:f.outcome??null,startAt:f.startAt??null,endAt:f.endAt??null,elapsedHours:Number.isFinite(f.elapsedMs)?f.elapsedMs/3600000:null,thresholdHours:f.thresholdHours??null,thresholdSource:f.thresholdSource??null,evaluationType:enumType[f.evaluationType]??null,calendarConfirmed:f.calendarConfirmed??null};
   value.reason=nativeMessage(context,'program.ec-time',{facts:JSON.stringify(facts)});changed=true;
  }else if(!session.ecommerce.raw[9].trim()){
   value.reason=nativeMessage(context,'program.ec-unreplied');changed=true;
   if(value.comparisonAssessment)value.comparisonAssessment.semanticReason=value.reason;
  }else if(value.ruleId==='EC-TARGET'){
   const semantic=value.comparisonAssessment?.semanticReason||value.semanticReason||value.reason;
   const invalid=hasTargetLimitedPolicy(basis)&&session.sceneCapabilities?.outputs?.ecommerceClassification?.value?.evaluationType==='无效评价';
   const missingComment=!session.ecommerce.raw[8].trim();
   const facts={comparisonStatus:value.comparisonAssessment?.status||'completed',pendingBlocks:value.comparisonAssessment?.pendingBlockIds?.length||0,duplicateGroups:(value.batchEvidence||[]).map(g=>({sessionIds:g.sessionIds,kind:g.kind})),advisory:assessment?.advisoryGroups.some(g=>g.sessionIds.includes(session.id))||false,missingAdministrator:assessment?.missingAdministratorSessionIds.includes(session.id)||false,similarityThreshold:basis.businessProfile?.similarity.threshold??null,minimumRecords:basis.businessProfile?.similarity.minimumRecords??3,scope:basis.businessProfile?.similarity.scope??'batch-administrator'};
   const reason=missingComment?nativeMessage(context,'program.ec-missing-comment'):invalid?nativeMessage(context,'program.ec-invalid'):semantic;
   value.reason=nativeMessage(context,'program.ec-target',{reason,facts:JSON.stringify(facts)});changed=true;
   if(value.semanticReason)value.semanticReason=reason;
   if(value.comparisonAssessment)value.comparisonAssessment.semanticReason=reason;
   if(value.batchEvidence)value.batchEvidence=value.batchEvidence.map(g=>{
    const key=JSON.stringify([g.sessionIds,g.kind]);let facts=batch.groupFacts.get(key);
    if(!facts){const rows=g.sessionIds.map(id=>batch.byId.get(id)).filter(Boolean),scores=[];
     for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)scores.push(businessReplySimilarity(rows[i].ecommerce.raw[9],rows[j].ecommerce.raw[9]));
     facts=JSON.stringify({sessionIds:g.sessionIds,kind:g.kind,minimumSimilarity:scores.length?Math.min(...scores):null,threshold:basis.businessProfile?.similarity.threshold??null});batch.groupFacts.set(key,facts);
    }
    return{...g,reason:nativeMessage(context,'program.ec-duplicate',{facts})};
   });
  }
  if(!changed)return value;
  const original=value.languageValidation,annotated=assureNativeResults([value],{...context,attempt:1,maxAttempts:1},{sourceQuotes:session.turns.map(t=>t.text)})[0];
  // Preserve the model's original wire verdict when a program finding changes
  // the final verdict. Locally created rows have their own executor identity.
  annotated.nativeContract=value.nativeContract?{...value.nativeContract,programExecutor:'native-ec-program-v1'}:{...annotated.nativeContract,adapterVersion:'native-ec-program-v1'};
  if(original&&original.status!=='verified')annotated.languageValidation={...original,requiresHumanReview:true};
  return annotated;
 });
}
