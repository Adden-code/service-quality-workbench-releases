import {parseReportEnrichment,ReportEnrichmentError} from './report-enrichment.mjs';
import {languageHash,validateFrozenLanguageMaterial} from './native-language-materials.mjs';
import {checkNativeProse,NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {parseModelJson} from '../public/model-output-values.mjs';
import {languageError} from '../public/workspace-language.mjs';

export const NATIVE_REPORT_CONTRACT='native-report-v1';
export const NATIVE_REPORT_KINDS=Object.freeze(['consultationAnalysis','consultationIssues','caseHighlights','scenarioFields']);
export const REQUIRED_NATIVE_REPORT_PROMPTS=Object.freeze(['report.context',...NATIVE_REPORT_KINDS.map(kind=>`report.${kind}`),'report.retry']);
export const NATIVE_REPORT_ENUMS=Object.freeze({
 salesStage:Object.freeze({PRE_SALES:'售前',IN_SALES:'售中',AFTER_SALES:'售后',UNKNOWN:'待判定'}),
 sentiment:Object.freeze({POSITIVE:'正向',NEUTRAL:'中性',NEGATIVE:'负向',UNKNOWN:'待判定'}),
 scene:Object.freeze({PRODUCT_QUALITY:'产品质量',COMPATIBILITY_FEATURES:'兼容性与功能',MISSING_ACCESSORIES:'赠品与配件缺失',AFTER_SALES_RETURNS:'售后/退换货',DELIVERY:'物流配送',CUSTOMER_SERVICE:'客服响应',PRICE:'价格',OTHER:'其他'}),
 intent:Object.freeze({UNCONFIGURED:'未配置分类体系',UNKNOWN:'待判定'})
});
const own=(value,key)=>value!==null&&typeof value==='object'&&Object.hasOwn(value,key);
const clone=value=>structuredClone(value);
const fail=(path,reasonCode)=>{
 const error=new ReportEnrichmentError('INVALID_OUTPUT','Native report fields or source evidence failed validation.',502);
 error.diagnostic={layer:'native-report-wire',path,reasonCode};error.traceOutput={diagnostic:error.diagnostic};throw error;
};

// Recheck the selected bytes, rather than trusting a caller-supplied clause map.
// This is also the report creation gate: Stage 2 bundles cannot authorize Stage 3.
export function assertNativeReportCoverage(context,kinds=NATIVE_REPORT_KINDS){
 validateFrozenLanguageMaterial(context?.frozen);
 if(context?.execution?.mode!=='native-v1'||context.language!==context.execution.contentLanguage||languageHash(context.execution)!==languageHash(context.frozen.languageExecution))languageError('NATIVE_MATERIAL_INVALID','The report must use the exact task-frozen native execution package.');
 const prompt=context.frozen.selected.find(material=>material.id===context.execution.promptBundleRef.id&&material.kind==='prompt');
 if(!prompt||languageHash(prompt)!==context.execution.promptBundleRef.hash)languageError('NATIVE_MATERIAL_INVALID','The report prompt hash differs from the task-frozen package.');
 const clauses=Object.fromEntries(prompt.clauses.map(clause=>[clause.clauseId,clause.text]));
 if(languageHash(clauses)!==languageHash(context.clauses))languageError('NATIVE_MATERIAL_INVALID','The report instructions differ from the reviewed selected prompt bytes.');
 if(!Array.isArray(kinds)||kinds.some(kind=>!NATIVE_REPORT_KINDS.includes(kind)))languageError('NATIVE_REPORT_KIND_UNSUPPORTED','Native report analysis is available only for NP consultation report nodes.');
 for(const id of ['report.context','report.retry',...kinds.map(kind=>`report.${kind}`)])if(!clauses[id])languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing reviewed report prompt clause: ${id}`);
 return context;
}
function clause(context,id){const value=context.clauses[id];if(!value)languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing reviewed report prompt clause: ${id}`);return value;}
function localizedPolicy(policy,context){
 const selected=context.frozen.selected.find(material=>material.id===policy.id&&material.version===policy.version&&material.kind==='policy');
 if(!selected)languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing reviewed report reference: ${policy.id}@${policy.version}`);
 return{...clone(policy),title:selected.title,sections:policy.sections.map(section=>{
  const c=selected.clauses.find(c=>c.clauseId===section.id);if(!c)languageError('NATIVE_MATERIAL_INCOMPLETE',`Missing reviewed report section: ${policy.id}#${section.id}`);
  return{...clone(section),title:section.id,text:c.text};
 })};
}
function localizedInput(prepared,context){
 const input=clone(prepared.input);
 if(input.taxonomy)input.taxonomy=input.taxonomy.map(policy=>({...localizedPolicy(policy,context),category:'分类体系'}));
 if(input.policies)input.policies=input.policies.map(policy=>localizedPolicy(policy,context));
 if(input.referenceMaterials)input.referenceMaterials=input.referenceMaterials.map(policy=>localizedPolicy(policy,context));
 if(prepared.kind==='scenarioFields')input.fields=input.fields.map(field=>({...field,label:clause(context,`report.field.${field.id}.label`),instruction:clause(context,`report.field.${field.id}.instruction`)}));
 if(prepared.kind==='consultationIssues'){
  const material=context.frozen.paired.find(material=>material.id===input.category||['zh','en'].some(lang=>material.locales[lang].title===input.category));
  if(material)input.category=context.frozen.selected.find(selected=>selected.id===material.id).title;
 }
 return input;
}
// Feedback deliberately contains no provider prose, arbitrary paths or diagnostic
// messages. The reviewed retry clause supplies the actual repair instructions.
export function nativeReportRetryFeedback(error,kind){
 if(!NATIVE_REPORT_KINDS.includes(kind)||!error||!['INVALID_OUTPUT','invalid_output'].includes(error.code??error.errorCode))return undefined;
 return{kind,errorCode:'INVALID_OUTPUT',reasonCode:error.nativeLanguageFailure||error.reasonCode==='language_unverified'?'language_unverified':'invalid_fields'};
}
export function nativeReportMessages(prepared,context,{retryFeedback}={}){
 assertNativeReportCoverage(context,[prepared?.kind]);
 const input=localizedInput(prepared,context),wireInput=clone(input);
 // Internal taxonomy filtering uses its legacy machine category. The model sees
 // a neutral category token and the reviewed text, never the Chinese prompt.
 for(const policy of wireInput.taxonomy||[])policy.category='taxonomy';
 const validationFeedback=nativeReportRetryFeedback(retryFeedback,prepared.kind);
 const content=[clause(context,'report.context'),clause(context,`report.${prepared.kind}`),...(context.attempt>1||validationFeedback?[clause(context,'report.retry')]:[])].join('\n');
 return{...prepared,input,nativeContext:context,promptVersion:context.execution.promptBundleRef.hash,messages:[{role:'system',content},{role:'user',content:JSON.stringify({kind:prepared.kind,input:wireInput,contract:NATIVE_REPORT_CONTRACT,contentLanguage:context.language,...(validationFeedback?{validationFeedback}:{})})}]};
}
function enumValue(value,map,path){if(!own(map,value))fail(path,'invalid_machine_enum');return map[value];}
function adaptWire(value,prepared){
 if(prepared.kind!=='consultationAnalysis')return value;
 if(!Array.isArray(value?.items))fail('items','invalid_analysis_structure');
 for(const [index,item]of value.items.entries()){
  if(!item||typeof item!=='object'||Array.isArray(item))fail(`items[${index}]`,'invalid_analysis_structure');
  for(const key of ['salesStage','sentiment'])if(own(item,key))item[key]=enumValue(item[key],NATIVE_REPORT_ENUMS[key],`items[${index}].${key}`);
  if(own(item,'voc')&&own(item.voc,'scene'))item.voc.scene=enumValue(item.voc.scene,NATIVE_REPORT_ENUMS.scene,`items[${index}].voc.scene`);
  const intentSelected=prepared.input.analysisFields===undefined||prepared.input.analysisFields.includes('intent');
  if(intentSelected&&!prepared.input.taxonomy.length&&(item.intentLabel!=='UNCONFIGURED'||item.intentReferenceId!==''))fail(`items[${index}].intentLabel`,'invalid_intent_configuration');
  if(intentSelected&&prepared.input.taxonomy.length&&!own(NATIVE_REPORT_ENUMS.intent,item.intentLabel)){
   const section=prepared.input.taxonomy.flatMap(policy=>policy.sections.map(section=>({section,key:`${encodeURIComponent(policy.id)}@${policy.version}#${encodeURIComponent(section.id)}`}))).find(entry=>entry.key===item.intentReferenceId)?.section;
   if(typeof item.intentLabel!=='string'||!item.intentLabel.trim()||!section?.text.includes(item.intentLabel))fail(`items[${index}].intentLabel`,'invalid_reviewed_intent');
  }
  if(own(NATIVE_REPORT_ENUMS.intent,item.intentLabel))item.intentLabel=NATIVE_REPORT_ENUMS.intent[item.intentLabel];
  // Reject localized sentinels on the wire even though the legacy parser owns
  // the no-taxonomy sentinel. This keeps machine values language-independent.
  else if(Object.values(NATIVE_REPORT_ENUMS.intent).includes(item.intentLabel))fail(`items[${index}].intentLabel`,'invalid_machine_enum');
 }
 return value;
}
function reportAssurance(value,prepared){
 const context=prepared.nativeContext,fields=[];
 const check=(path,text,sourceQuotes=[])=>fields.push({path,...checkNativeProse(text,context.language,{sourceQuotes})});
 if(prepared.kind==='consultationAnalysis')for(const [i,item]of value.items.entries()){
  const prefix=`items[${i}]`,quotes=[...(item.negativeVoices||[]).map(voice=>voice.quote),item.voc?.evidenceQuote].filter(Boolean);
  for(const key of ['salesSubstage','demandSummary'])if(own(item,key))check(`${prefix}.${key}`,item[key],quotes);
  // intentLabel is an exact reviewed taxonomy substring or an adapted sentinel;
  // it is not unconstrained model prose and is validated by the taxonomy parser.
  if(item.voc){if(item.voc.valid)check(`${prefix}.voc.painPoint`,item.voc.painPoint,quotes);check(`${prefix}.voc.reason`,item.voc.reason,quotes);}
 }
 if(prepared.kind==='consultationIssues')for(const [i,item]of value.clusters.entries())for(const key of ['label','summary','action'])check(`clusters[${i}].${key}`,item[key]);
 if(prepared.kind==='caseHighlights')for(const [i,item]of value.cases.entries())check(`cases[${i}].commentary`,item.commentary,[item.quote]);
 if(prepared.kind==='scenarioFields')for(const [i,item]of value.fields.entries())if(!item.missing&&prepared.input.fields.find(field=>field.id===item.id).type==='text')check(`fields[${i}].value`,item.value);
 // A selected quote/enum-only task generates no human prose. Its source and
 // enums were checked above; do not invent a language failure for absent prose.
 if(!fields.length)fields.push({path:'machineValues',status:'verified',reasonCode:'no-generated-prose'});
 const status=fields.some(field=>field.status==='mismatch')?'mismatch':fields.some(field=>field.status==='uncertain')?'uncertain':'verified';
 return{version:NATIVE_LANGUAGE_VALIDATOR,language:context.language,status,requiresHumanReview:status!=='verified',fields,attempt:Number.isSafeInteger(context.attempt)&&context.attempt>0?context.attempt:1};
}
export function stripNativeReportAudit(value){const {languageValidation,nativeContract,...result}=value;return result;}
export function parseNativeReportEnrichment(content,prepared,{allowPartial=false}={}){
 const context=prepared?.nativeContext;assertNativeReportCoverage(context,[prepared?.kind]);
 if(typeof content!=='string'||content.length>2*1024*1024)fail('$','invalid_content');
 let wire;try{wire=parseModelJson(content);}catch{fail('$','invalid_json');}
 const result=parseReportEnrichment(JSON.stringify(adaptWire(wire,prepared)),prepared,{allowPartial,nativeProse:true});
 const languageValidation=reportAssurance(result,prepared),candidate={...result,languageValidation,nativeContract:{version:NATIVE_REPORT_CONTRACT,adapterVersion:'native-report-enums-v1',kind:prepared.kind,materialHash:context.execution.selectedMaterialHash,promptBundleHash:context.execution.promptBundleRef.hash}};
 if(languageValidation.status!=='verified'){
  const error=new ReportEnrichmentError('INVALID_OUTPUT','Native report language requires review; the original candidate has been retained.',502);
  Object.assign(error,{nativeLanguageFailure:true,validationReason:'language_unverified',nativeCandidate:candidate,retryable:languageValidation.attempt<Math.max(1,Math.min(3,Number.isSafeInteger(context.maxAttempts)?context.maxAttempts:1)),traceOutput:{kind:prepared.kind,contract:NATIVE_REPORT_CONTRACT,language:context.language,candidate}});throw error;
 }
 return candidate;
}

// Persisted report results contain internal enums and parser audit, whereas the
// model boundary accepts native machine enums. Project a copy back to the wire
// before replaying the same parser; never translate or repair human prose.
export function nativeReportWireValue(value,kind){
 const {modelId,requestId,usage,promptVersion,partial,coercion,evidenceValidation,...result}=stripNativeReportAudit(clone(value));
 if(kind==='consultationAnalysis'&&Array.isArray(result.items))result.items=result.items.map(item=>{
  const {speakerAttribution,...row}=item;
  for(const key of ['salesStage','sentiment'])if(own(row,key))row[key]=Object.keys(NATIVE_REPORT_ENUMS[key]).find(token=>NATIVE_REPORT_ENUMS[key][token]===row[key])??row[key];
  if(row.voc)row.voc.scene=Object.keys(NATIVE_REPORT_ENUMS.scene).find(token=>NATIVE_REPORT_ENUMS.scene[token]===row.voc.scene)??row.voc.scene;
  if(own(row,'intentLabel'))row.intentLabel=Object.keys(NATIVE_REPORT_ENUMS.intent).find(token=>NATIVE_REPORT_ENUMS.intent[token]===row.intentLabel)??row.intentLabel;
  if(row.negativeVoices)row.negativeVoices=row.negativeVoices.map(({matches,speakerAttribution,...voice})=>voice);
  return row;
 });
 if(kind==='caseHighlights'&&Array.isArray(result.cases))result.cases=result.cases.map(({coercion,evidenceValidation,...item})=>{
  for(const change of coercion?.changes||[])if(change.field==='score'&&change.reasonCode==='numeric_string_to_integer'&&change.after===item.score)item.score=change.before;
  return item;
 });
 if(kind==='scenarioFields'&&Array.isArray(result.fields))result.fields=result.fields.map(({matches,speakerAttribution,...field})=>field);
 return result;
}
