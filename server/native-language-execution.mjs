import {languageHash,validateFrozenLanguageMaterial} from './native-language-materials.mjs';
import {checkNativeProse,NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {parseModelJson} from '../public/model-output-values.mjs';
import {languageError} from '../public/workspace-language.mjs';

export const NATIVE_CONTRACT='native-language-v1';
export const NATIVE_VERDICTS=Object.freeze({PASS:'符合',FAIL:'不符合',UNKNOWN:'无法判定',NA:'不适用'});
export const REQUIRED_NATIVE_PROMPTS=['inspection.raw','inspection.structured','context','retry','capability.site','capability.intent','capability.demandSummary','capability.negativeVoice','capability.translation','capability.timing','program.knowledge','program.explicit-failure','program.non-time-failure','program.dependency','program.timing','program.non-time','program.capability-failed','program.site-pending','program.timing-pending','program.site-conflict','program.site-unmapped','program.parent-missing','program.site-low-confidence','program.translation-low-confidence','program.metric-source-unavailable','program.metric-standard-missing','program.metric-calculated'];
export function nativeSourceConfiguration(snapshot){
 const configuration=structuredClone(snapshot.configuration);configuration.inspectionLanguage='zh';
 return{configuration,taxonomy:snapshot.taxonomy??null,exceptions:snapshot.exceptions??[]};
}
export function nativeExecutionContext(task,frozen){
 validateFrozenLanguageMaterial(frozen);
 const s=task.executionSnapshot,e=s?.languageExecution;
 if(!e||languageHash(e)!==languageHash(frozen.languageExecution)||s.languageMaterialRef!==languageHash(frozen)||e.languageValidatorVersion!==NATIVE_LANGUAGE_VALIDATOR)languageError('NATIVE_MATERIAL_INVALID','The task must reference its exact reviewed language package and supported validator.');
 if(task.scene!=='新品产品咨询')languageError('EC_ARBITRATION_PENDING','EC native execution remains closed pending arbitration and bilingual review.');
 const prompt=frozen.selected.find(m=>m.id===e.promptBundleRef.id),clauses=Object.fromEntries(prompt.clauses.map(c=>[c.clauseId,c.text]));
 if(REQUIRED_NATIVE_PROMPTS.some(id=>!clauses[id]))languageError('NATIVE_MATERIAL_INCOMPLETE','The native prompt package is missing required execution or program-message clauses.');
 const rules=new Map(frozen.selected.filter(m=>m.kind==='rule').map(m=>[m.id,m]));
 for(const rule of task.basisSnapshot.rules.filter(r=>r.ruleKind!=='meta')){const m=rules.get(rule.id);if(!m||m.version!==rule.version||['pass','fail','exception'].some(id=>!m.clauses.some(c=>c.clauseId===id)))languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing exact reviewed rule version: ${rule.id}@${rule.version}`);}
 // Bind the reviewed pair to the original catalog/configuration bytes as well as
 // version labels. Merely reusing an ID must not authorize changed conditions.
 for(const source of [...task.basisSnapshot.rules.filter(r=>r.ruleKind!=='meta'),...task.basisSnapshot.policies]){
  if(frozen.paired.find(m=>m.id===source.id)?.sourceHash!==languageHash(source))languageError('NATIVE_SOURCE_MISMATCH',`Reviewed source has changed: ${source.id}`);
  if(source.sections){const ids=frozen.selected.find(m=>m.id===source.id).clauses.map(c=>c.clauseId);if(source.sections.some(s=>!ids.includes(s.id))||ids.some(id=>!source.sections.some(s=>s.id===id)))languageError('NATIVE_MATERIAL_INCOMPLETE',`Policy section coverage differs: ${source.id}`);}
 }
 for(const [id,p] of Object.entries(s.configuration.ruleExecutionPolicies||{}))if(p.modelCriteria&&['model.pass','model.fail','model.exception'].some(k=>!rules.get(id)?.clauses.some(c=>c.clauseId===k)))languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing reviewed component criteria: ${id}`);
 for(const source of [s.taxonomy,...(s.exceptions||[])].filter(Boolean))if(!frozen.paired.some(m=>m.id===source.id&&m.sourceHash===languageHash(source)))languageError('NATIVE_MATERIAL_INCOMPLETE',`Unreviewed taxonomy or exception table: ${source.id}`);
 const covered=(id,keys)=>{const ids=new Set(frozen.selected.find(m=>m.id===id)?.clauses.map(c=>c.clauseId));if(keys.some(k=>!ids.has(k)))languageError('NATIVE_MATERIAL_INCOMPLETE',`Reviewed clause coverage is incomplete: ${id}`);};
 if(s.taxonomy)covered(s.taxonomy.id,[...s.taxonomy.labels.flatMap(l=>[l.id,...(l.definition?['definition-'+l.id]:[])]),...(s.taxonomy.principles||[]).map((_,i)=>'principle-'+(i+1)),...(s.taxonomy.examples||[]).map((_,i)=>'example-'+(i+1))]);
 for(const table of s.exceptions||[])covered(table.id,table.entries.map(e=>e.id));
 if(frozen.paired.find(m=>m.id==='NATIVE-CONFIG')?.sourceHash!==languageHash(nativeSourceConfiguration(s)))languageError('NATIVE_SOURCE_MISMATCH','Reviewed scene configuration has changed.');
 return{language:e.contentLanguage,execution:e,frozen,clauses,rules,attempt:1,maxAttempts:1};
}
export function nativeMessage(context,key,parameters={}){
 const template=context.clauses[key];if(!template)languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing native message: ${key}`);
 return template.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g,(_,k)=>{if(parameters[k]===undefined)languageError('NATIVE_PARAMETER_MISSING',`Missing message parameter: ${k}`);return String(parameters[k]);});
}
export function nativeRuleBasis(basis,context){
 const rules=basis.rules.map(r=>{const m=context.rules.get(r.id);if(!m||m.version!==r.version)languageError('NATIVE_MATERIAL_INCOMPLETE',`Unreviewed rule: ${r.id}`);const c=Object.fromEntries(m.clauses.map(c=>[c.clauseId,c.text]));return{id:r.id,version:r.version,title:m.title,scope:m.scope,policyIds:[...r.policyIds],passCriteria:c['model.pass']||c.pass,failCriteria:c['model.fail']||c.fail,exceptionCriteria:c['model.exception']||c.exception};});
 const linked=new Set(rules.flatMap(r=>r.policyIds));
 const policies=basis.policies.filter(p=>linked.has(p.id)).map(p=>{const m=context.frozen.selected.find(m=>m.kind==='policy'&&m.id===p.id&&m.version===p.version);if(!m)languageError('NATIVE_MATERIAL_INCOMPLETE',`Unreviewed policy: ${p.id}@${p.version}`);return{id:p.id,version:p.version,title:m.title,referenceKey:`${encodeURIComponent(p.id)}@${p.version}#`,sections:m.clauses.map(c=>({id:c.clauseId,title:c.clauseId,text:c.text,referenceKey:`${encodeURIComponent(p.id)}@${p.version}#${encodeURIComponent(c.clauseId)}`}))};});
 return{capturedAt:basis.capturedAt,effectiveDate:basis.effectiveDate,rules,policies};
}
export function nativeMessages(prepared,basis,context,{kind='inspection.structured',sceneCapabilities,snapshot}={}){
 const data=structuredClone(prepared.input||JSON.parse(prepared.messages[1].content));
 data.basis=nativeRuleBasis({...basis,rules:basis.rules.filter(r=>!data.timeRuleIds?.includes(r.id))},context);
 // Source blocks/turns are kept byte-for-byte. Only instruction material is selected.
 if(sceneCapabilities)data.sceneContext={outputs:sceneCapabilities.outputs,ruleDependencies:snapshot.configuration.ruleDependencies,ruleExecutionPolicies:Object.fromEntries(Object.entries(snapshot.configuration.ruleExecutionPolicies||{}).map(([id,p])=>[id,{mode:p.mode}])),exceptionTables:(snapshot.exceptions||[]).map(table=>({id:table.id,version:table.version,entries:table.entries.map(entry=>({id:entry.id,condition:context.frozen.selected.find(m=>m.id===table.id).clauses.find(c=>c.clauseId===entry.id).text,result:entry.result==='不适用'?'NA':'CONTINUE',requires:entry.requires,priority:entry.priority}))}))};
 data.contentLanguage=context.language;data.contract=NATIVE_CONTRACT;
 if(context.validationFeedback)data.validationFeedback=structuredClone(context.validationFeedback);
 const glossary=context.frozen.selected.find(m=>m.kind==='glossary');
 const content=nativeMessage(context,kind)+'\n'+nativeMessage(context,'context')+'\n'+glossary.clauses.map(c=>c.text).join('\n')+(context.attempt>1?'\n'+nativeMessage(context,'retry'):'');
 return {...prepared,messages:[{role:'system',content},{role:'user',content:JSON.stringify(data)}],input:data,promptVersion:context.execution.promptBundleRef.hash};
}
export function nativeCapabilityMessages(input,prepared,context){
 const data=structuredClone(input);delete data.nativeContext;
 if(input.capability==='intent'){
  const taxonomy=context.frozen.selected.find(m=>m.kind==='taxonomy');if(!taxonomy)languageError('NATIVE_MATERIAL_INCOMPLETE','Reviewed taxonomy execution instructions are required.');
  // Stable IDs/parents stay machine values; names, principles and examples use reviewed text.
  data.taxonomy={labels:input.taxonomy.labels.map(l=>{const c=taxonomy.clauses.find(c=>c.clauseId===l.id);if(!c)languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing reviewed taxonomy label ${l.id}`);return{id:l.id,parentId:l.parentId||null,label:c.text,...(l.definition?{definition:taxonomy.clauses.find(c=>c.clauseId==='definition-'+l.id).text}:{})};}),instructions:taxonomy.clauses.filter(c=>!input.taxonomy.labels.some(l=>l.id===c.clauseId||'definition-'+l.id===c.clauseId))};
 }
 data.contract=NATIVE_CONTRACT;data.targetLanguage=context.language;
 return{...prepared,messages:[{role:'system',content:nativeMessage(context,`capability.${input.capability}`)+'\n'+nativeMessage(context,'context')+(context.attempt>1?'\n'+nativeMessage(context,'retry'):'')+'\nJSON Schema: '+JSON.stringify(prepared.outputSchema)},{role:'user',content:JSON.stringify(data)}]};
}
export function adaptNativeRuleOutput(content){
 const reject=(path,reasonCode,expected)=>{const diagnostic={layer:'native-wire',path,reasonCode,expected};throw Object.assign(new Error(expected),{code:'INVALID_OUTPUT',diagnostic,traceOutput:{diagnostic}});};
 let body;try{body=parseModelJson(content);}catch{reject('$','invalid_json','Valid JSON; escape quotes inside string values.');}
 if(!Array.isArray(body?.results))reject('results','rule_coverage','A results array with one result per requested rule.');
 for(const [i,r] of body.results.entries()){if(!r||typeof r!=='object'||Array.isArray(r)||!Object.hasOwn(NATIVE_VERDICTS,r.verdict))reject(`results[${i}].verdict`,'invalid_verdict','Native verdict must be PASS, FAIL, UNKNOWN or NA.');r.verdict=NATIVE_VERDICTS[r.verdict];}
 return JSON.stringify(body);
}
export function nativeValidationFeedback(error){
 const d=error?.diagnostic;
 if(d&&['native-wire','structured-results'].includes(d.layer))return structuredClone(d);
 if(error?.nativeLanguageFailure)return{layer:'native-language',path:'results.reason',reasonCode:'language_unverified',expected:'Write the explanatory prose in the frozen contentLanguage; keep evidence quotes in the original language.'};
 return undefined;
}
export function nativeAssurance(result,context,{capability,sourceQuotes=[],names=[]}={}){
 const fields=[['reason',result.reason]];
 if(['demandSummary','negativeVoice','translation'].includes(capability)&&result.status==='completed')fields.push(['value.text',result.value.text]);
 if(capability==='timing')for(const [i,q] of (result.value?.queries||[]).entries())fields.push([`value.queries.${i}.topic`,q.topic]);
 const checked=fields.map(([path,text])=>({path,...checkNativeProse(text,context.language,{sourceQuotes:path==='value.text'&&capability==='translation'?[]:sourceQuotes,names})}));
 const status=checked.some(f=>f.status==='mismatch')?'mismatch':checked.some(f=>f.status==='uncertain')?'uncertain':'verified';
 return{version:NATIVE_LANGUAGE_VALIDATOR,language:context.language,status,requiresHumanReview:status!=='verified',fields:checked,attempt:context.attempt};
}
export function assureNativeResults(results,context,options={}){
 const annotated=results.map(result=>({...result,languageValidation:nativeAssurance(result,context,options),nativeContract:{version:NATIVE_CONTRACT,adapterVersion:'native-verdict-map-v1',originalVerdict:Object.keys(NATIVE_VERDICTS).find(k=>NATIVE_VERDICTS[k]===result.verdict),materialHash:context.execution.selectedMaterialHash}}));
 if(annotated.some(r=>r.languageValidation.status!=='verified')&&context.attempt<context.maxAttempts){const e=new Error('Native output language did not pass validation; retry the original input in the frozen language.');Object.assign(e,{code:'INVALID_OUTPUT',nativeLanguageFailure:true,traceOutput:{contract:NATIVE_CONTRACT,language:context.language,candidates:annotated}});throw e;}
 return annotated;
}
export function assureNativeCapability(result,context,input){
 const value={...result,languageValidation:nativeAssurance(result,context,{capability:input.capability,sourceQuotes:(result.evidence||[]).map(e=>e.quote)})};
 if(value.languageValidation.status!=='verified')throw Object.assign(new Error('Native capability language needs review.'),{code:'INVALID_OUTPUT',validationReason:'language_unverified',nativeCandidate:value,traceOutput:{contract:NATIVE_CONTRACT,capability:input.capability,candidate:value}});
 return value;
}
export function nativeProgramResults(before,after,context,snapshot,capabilities){
 return after.map((r,i)=>{
  const original=before[i],policy=snapshot.configuration.ruleExecutionPolicies?.[r.ruleId],deps=snapshot.configuration.ruleDependencies[r.ruleId]||[],missing=deps.filter(d=>capabilities.outputs[d]?.status!=='completed');
  const languageDeps=deps.filter(d=>capabilities.outputs[d]?.languageValidation?.status&&capabilities.outputs[d].languageValidation.status!=='verified');
  if(!r.sceneProgramDecision)return languageDeps.length?{...r,sceneDependencies:deps.map(d=>({capability:d,...capabilities.outputs[d]}))}:r;
  let reason;
  if(policy?.mode==='missing-knowledge'||policy?.mode==='missing-knowledge-or-model')reason=nativeMessage(context,policy.mode==='missing-knowledge-or-model'&&original.verdict==='不符合'?'program.explicit-failure':'program.knowledge',{reason:original.reason});
  else if(policy?.mode==='timing-or-model'&&original.verdict==='不符合')reason=nativeMessage(context,'program.non-time-failure',{reason:original.reason});
  else if(missing.length)reason=nativeMessage(context,'program.dependency',{capabilities:missing.join(', ')});
  else{reason=nativeMessage(context,'program.timing',{metrics:JSON.stringify(capabilities.outputs.timing?.metrics?.map(m=>({metric:m.metric,siteId:m.siteId,status:m.status,standard:m.standard?.value,unit:m.standard?.unit,actual:m.actual?.map(a=>a.value)}))||[])});if(policy?.mode==='timing-or-model')reason+='\n'+nativeMessage(context,'program.non-time',{reason:original.reason});}
  const invalid=deps.some(d=>capabilities.outputs[d]?.languageValidation?.status&&capabilities.outputs[d].languageValidation.status!=='verified');
  return{...r,reason,languageValidation:invalid?{...original.languageValidation,status:original.languageValidation?.status==='mismatch'?'mismatch':'uncertain',requiresHumanReview:true,fields:[...(original.languageValidation?.fields||[]),{path:'dependencies',status:'uncertain',reasonCode:'dependency-language-unverified'}]}:original.languageValidation};
 });
}
