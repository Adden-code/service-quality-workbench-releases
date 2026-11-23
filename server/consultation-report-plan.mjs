import {hasReportClusterPolicy,buildReportIssueClusters} from '../public/report-issue-clusters.mjs';
import {createHash} from 'node:crypto';
import {selectConsultationErrorCases,consultationConfiguration,consultationNeedsAnalysis,consultationTaxonomyMissing} from '../public/consultation-delivery.mjs';
import {selectConsultationCaseExcerpts} from '../public/consultation-excerpts.mjs';
import {CONSULTATION_ENRICHMENT_LIMITS} from './consultation-enrichment.mjs';
import {SCENARIO_FIELDS_PROMPT_VERSION,scenarioFieldsInputTooLarge,validateScenarioFieldsResult} from './scenario-fields.mjs';
import {REPORT_TRANSLATION_PROMPT_VERSION,validateReportTranslationResult} from './report-enrichment.mjs';
import {CONVERSATION_UNVERIFIED,assertRoleEvidenceSupport,unverifiedRoleEvidence,roleEvidenceNotice} from '../public/role-evidence.mjs';
import {isRawReport,validateRawReportRecord,rawReportNotices} from '../public/raw-report-evidence.mjs';

export const CONSULTATION_REPORT_PLAN_VERSION='consultation-report-plan-v1';
export const SCENARIO_REPORT_PLAN_VERSION='consultation-report-plan-v2-scenarios';
export const consultationReportPlanVersion=snapshot=>isRawReport(snapshot)?'consultation-report-plan-v3-raw-quote':consultationConfiguration(snapshot).custom?SCENARIO_REPORT_PLAN_VERSION:CONSULTATION_REPORT_PLAN_VERSION;
export const CONSULTATION_TRANSLATION_PROMPT_VERSION=`consultation-translation-segment-v2:${REPORT_TRANSLATION_PROMPT_VERSION}`;
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const tooLarge=()=>({code:'INPUT_TOO_LARGE',message:'该分析节点超过输入预算，完整原文已保留；请调整来源或分析范围后重新生成。'});
const storage=()=>{throw Object.assign(new Error('产品咨询生成计划、冻结来源或已完成输出不一致。'),{code:'REPORT_STORAGE',status:500});};

function recordsOf(snapshot){
 if(snapshot?.deliveryType!=='consultation-v1'||!Array.isArray(snapshot.records)||!Array.isArray(snapshot.basis?.dimensions)||!Array.isArray(snapshot.basis?.policies))storage();
 try{assertRoleEvidenceSupport(snapshot,consultationConfiguration(snapshot));}catch{storage();}
 const seen=new Set();for(const record of snapshot.records){if(typeof record.id!=='string'||!record.id||seen.has(record.id)||typeof record.conversation!=='string'||!Array.isArray(record.turns)||!Array.isArray(record.final))storage();if(isRawReport(snapshot))try{validateRawReportRecord(record,snapshot.original,snapshot.source);}catch{storage();}seen.add(record.id);}return snapshot.records;
}
function fieldsOf(snapshot){
 const records=recordsOf(snapshot),config=consultationConfiguration(snapshot),selected=new Set((config.report.sections.includes('cases')?selectConsultationErrorCases(snapshot,10):[]).map(record=>record.id)),fields=[];
 for(const record of records){fields.push({recordId:record.id,field:'conversation',text:record.conversation});if(selected.has(record.id))for(const turn of selectConsultationCaseExcerpts(record))fields.push({recordId:record.id,field:`excerpt-${turn.id}`,text:turn.text});}return fields;
}
function splitText(text,max=18000){
 const parts=[];let start=0;while(start<text.length){let end=Math.min(start+max,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;parts.push(text.slice(start,end));start=end;}return parts;
}
// Frozen catalog records retain ownership and provenance for the delivery trail.
// Model inputs use a separate DTO; expanding catalog metadata must not expand
// the closed model contract or mutate the original frozen references.
function policyInputs(policies){return policies.map(policy=>({id:policy?.id,version:policy?.version,title:policy?.title,category:policy?.category,sections:Array.isArray(policy?.sections)?policy.sections.map(section=>({id:section?.id,title:section?.title,text:section?.text})):policy?.sections}));}
function reportRecord(record){return isRawReport(record)?{id:record.id,inputMode:record.inputMode,text:record.conversation}:{id:record.id,turns:record.turns.map(turn=>({id:turn.id,role:turn.role,text:turn.text})),conversation:record.conversation};}
function analysisInput(snapshot,record){const config=consultationConfiguration(snapshot);return{record:reportRecord(record),taxonomy:policyInputs(config.analysisFields.includes('intent')?snapshot.basis.policies:[]),...(unverifiedRoleEvidence(snapshot)&&!isRawReport(snapshot)?{roleEvidenceMode:CONVERSATION_UNVERIFIED}:{}),...(config.custom?{analysisFields:[...config.analysisFields],includeVoc:config.report.sections.includes('voc')}:{})};}
function scenarioInput(snapshot,record){const config=consultationConfiguration(snapshot);return{record:reportRecord(record),fields:clone(config.customFields),policies:policyInputs(snapshot.basis.policies),scenario:{id:config.scenario.id,version:config.scenario.version},source:{name:snapshot.source.name,sha256:snapshot.source.sha256,size:snapshot.source.size}};}
function oversizedAnalysis(input){
 const limits=CONSULTATION_ENRICHMENT_LIMITS;
 if((input.record.text??input.record.conversation).length>limits.conversationChars||(input.record.turns||[]).length>limits.turns||(input.record.turns||[]).some(turn=>typeof turn.text!=='string'||turn.text.length>limits.turnChars)||input.taxonomy.length>limits.taxonomyPolicies)return true;
 let count=0;const projected=[];
 for(const policy of input.taxonomy){const sections=Array.isArray(policy.sections)?policy.sections:[];count+=sections.length;if(sections.some(section=>String(section.text??'').length>limits.turnChars))return true;if(policy.category==='分类体系'||String(policy.title??'').includes('分类体系'))projected.push({id:policy.id,version:policy.version,title:policy.title,category:policy.category,sections:sections.map(section=>({id:section.id,title:section.title,text:section.text}))});}
 return count>limits.taxonomySections||Buffer.byteLength(JSON.stringify({...input,taxonomy:projected}),'utf8')>limits.inputBytes;
}
function excerptContext(record){
 const selected=selectConsultationCaseExcerpts(record),body=selected.length?selected.map(turn=>turn.raw?`原文引文（角色未核验）：${turn.text}`:`第${turn.id}轮 ${turn.role}：${turn.text}`).join('\n'):record.conversation;
 const header='【原会话节选，非完整原文；仅供已判问题的原因归纳】\n',tail='\n【上下文已限长；完整原文保留于交付快照】',budget=6000;
 if(header.length+body.length<=budget)return header+body;
 let end=budget-header.length-tail.length;if(/[\uD800-\uDBFF]/.test(body[end-1])&&/[\uDC00-\uDFFF]/.test(body[end]))end--;return header+body.slice(0,end)+tail;
}
function issueRecord(record,dimension){
 const failed=record.final.filter(item=>item.verdict==='Fail'&&dimension.ruleIds.includes(item.ruleId||item.id));
 return{id:record.id,reason:failed.map(item=>`${item.label||item.ruleId||item.id}：${item.reason||'未提供具体判定理由。'}`).join('\n'),conversation:excerptContext(record)};
}
function oversizedIssues(input){return input.records.length>CONSULTATION_ENRICHMENT_LIMITS.issuesRecords||JSON.stringify(input).length>CONSULTATION_ENRICHMENT_LIMITS.issuesChars||Buffer.byteLength(JSON.stringify(input),'utf8')>CONSULTATION_ENRICHMENT_LIMITS.inputBytes;}
function unitError(unit){if(unit.inputError)throw Object.assign(new Error(unit.inputError.message),{code:unit.inputError.code,status:413});}

export function planConsultationReport(snapshot,configFingerprint){
 const records=recordsOf(snapshot),translations=new Map(),units=[],config=consultationConfiguration(snapshot);
 const add=(kind,label,details)=>{const unit={id:`n${units.length+1}`,kind,label,...details,status:'pending',attempts:0,durationMs:0,history:[]};units.push(unit);return unit;};
 for(const field of fieldsOf(snapshot)){
  if(!field.text.trim())continue;const parts=splitText(field.text);
  for(const [partIndex,text]of parts.entries()){
   const id='t'+hash(text),key=hash({text,targetLang:snapshot.targetLang,model:configFingerprint,prompt:CONSULTATION_TRANSLATION_PROMPT_VERSION+(snapshot.executionSnapshot?.configuration.executionMode==='configured'?'-confidence-v1':'')});
   if(!translations.has(id))translations.set(id,{id,text,key,refs:[],...(!text.trim()?{literal:true}:{})});translations.get(id).refs.push({recordId:field.recordId,field:field.field,partIndex,partCount:parts.length});
  }
 }
 let translationNumber=0;for(const item of translations.values())if(!item.literal)add('translation',`会话及选摘翻译 ${++translationNumber}`,{itemIds:[item.id]});
 if(consultationNeedsAnalysis(snapshot))for(const record of records){const unit=add('consultationAnalysis',`会话辅助分析 · ${record.externalId||record.id}`,{recordIds:[record.id]});if(oversizedAnalysis(analysisInput(snapshot,record)))unit.inputError=tooLarge();}
 if(config.customFields.length)for(const record of records){const input=scenarioInput(snapshot,record),unit=add('scenarioFields',`场景字段提取 · ${record.externalId||record.id}`,{recordIds:[record.id],cacheKey:hash({input,scenario:config.scenario,source:snapshot.source,model:configFingerprint,prompt:SCENARIO_FIELDS_PROMPT_VERSION,...(unverifiedRoleEvidence(snapshot)?{roleEvidenceMode:CONVERSATION_UNVERIFIED}:{})})});if(scenarioFieldsInputTooLarge(input))unit.inputError=tooLarge();}
 for(const dimension of config.report.sections.includes('improvements')?snapshot.basis.dimensions:[]){
  if(typeof dimension.key!=='string'||!dimension.key.trim()||!Array.isArray(dimension.ruleIds))storage();
  const selected=records.filter(record=>record.final.some(item=>item.verdict==='Fail'&&dimension.ruleIds.includes(item.ruleId||item.id))),groups=[];let group=[];
  for(const record of selected){const candidate=[...group,issueRecord(record,dimension)];if(group.length&&oversizedIssues({category:dimension.key,records:candidate})){groups.push(group);group=[];}group.push(issueRecord(record,dimension));if(oversizedIssues({category:dimension.key,records:group})){groups.push(group);group=[];}}
  if(group.length)groups.push(group);
  groups.forEach((items,index)=>{const unit=add('consultationIssues',`${dimension.label||dimension.key}原因 ${index+1}`,{category:dimension.key,recordIds:items.map(item=>item.id)});if(oversizedIssues({category:dimension.key,records:items}))unit.inputError=tooLarge();});
 }
 if(snapshot.executionSnapshot?.configuration.executionMode==='configured'){const passing=records.filter(r=>r.final.every(x=>['Pass','NA'].includes(x.verdict))&&r.final.some(x=>x.verdict==='Pass'));for(let i=0;i<passing.length;i+=5)add('caseHighlights',`通过会话亮点 ${i/5+1}`,{recordIds:passing.slice(i,i+5).map(r=>r.id)});}
 return{translations,units};
}

export function consultationInputFor(snapshot,unit,prepared){
 unitError(unit);const records=new Map(recordsOf(snapshot).map(record=>[record.id,record]));
 if(unit.kind==='translation'){
  if(!Array.isArray(unit.itemIds)||unit.itemIds.length!==1)storage();return{targetLang:snapshot.targetLang,...(snapshot.executionSnapshot?.configuration.executionMode==='configured'?{includeConfidence:true}:{}),items:unit.itemIds.map(id=>{const item=prepared.translations.get(id);if(!item)storage();return{id:item.id,text:item.text};})};
 }
 if(!Array.isArray(unit.recordIds)||unit.recordIds.some(id=>!records.has(id))||new Set(unit.recordIds).size!==unit.recordIds.length)storage();
 if(unit.kind==='caseHighlights')return{caseDomain:'conversation',candidates:unit.recordIds.map(id=>{const r=records.get(id);return{id,comment:r.conversation,reply:r.conversation};}),limit:Math.min(5,unit.recordIds.length)};
 if(unit.kind==='consultationAnalysis'){
  if(unit.recordIds.length!==1)storage();const input=analysisInput(snapshot,records.get(unit.recordIds[0]));if(oversizedAnalysis(input))throw Object.assign(new Error(tooLarge().message),{code:'INPUT_TOO_LARGE',status:413});return input;
 }
 if(unit.kind==='scenarioFields'){
  if(unit.recordIds.length!==1||!consultationConfiguration(snapshot).customFields.length)storage();const input=scenarioInput(snapshot,records.get(unit.recordIds[0]));if(scenarioFieldsInputTooLarge(input))throw Object.assign(new Error(tooLarge().message),{code:'INPUT_TOO_LARGE',status:413});return input;
 }
 if(unit.kind!=='consultationIssues')storage();const dimension=snapshot.basis.dimensions.find(value=>value.key===unit.category);if(!dimension)storage();
 const input={category:unit.category,records:unit.recordIds.map(id=>issueRecord(records.get(id),dimension))};if(oversizedIssues(input))throw Object.assign(new Error(tooLarge().message),{code:'INPUT_TOO_LARGE',status:413});return input;
}

export function mergeConsultationReport(snapshot,job,prepared,outputs){
 const excellentCases=[];
 const records=recordsOf(snapshot),fields=fieldsOf(snapshot),translations=Object.fromEntries(records.map(record=>[record.id,{}])),fieldParts=new Map(),states=new Map(),analyses={},scenarioFields={},clusters=[],warnings=[],config=consultationConfiguration(snapshot),needsAnalysis=consultationNeedsAnalysis(snapshot),includeVoc=config.report.sections.includes('voc');
 for(const field of fields){translations[field.recordId][field.field]={status:field.text.trim()?'pending':'empty',text:''};fieldParts.set(JSON.stringify([field.recordId,field.field]),{...field,parts:[]});}
 const distribute=(item,state)=>{states.set(item.id,state.status);for(const ref of item.refs){const field=fieldParts.get(JSON.stringify([ref.recordId,ref.field]));if(!field||field.parts[ref.partIndex])storage();field.parts[ref.partIndex]={...clone(state),partCount:ref.partCount};}};
 for(const item of prepared.translations.values())if(item.literal)distribute(item,{status:'literal',text:item.text});
 for(const savedUnit of job.units){
  let unit=savedUnit,output=unit.status==='completed'||unit.partialResult===true?outputs.get(unit.id):null;if(unit.status==='completed'&&!output)storage();
  if(output&&unit.kind==='translation'&&snapshot.targetLang==='en'){
   try{output=validateReportTranslationResult({items:output.items},{...consultationInputFor(snapshot,unit,prepared),items:consultationInputFor(snapshot,unit,prepared).items.filter(i=>output.items.some(o=>o.id===i.id))});}
   catch(error){if(error.code!=='INVALID_OUTPUT')throw error;unit={...unit,status:'failed',errorCode:'invalid_output',error:'已保存译文未通过英文语种校验，请重试缺失项。'};output=null;}
  }
  if(unit.kind==='translation')for(const id of unit.itemIds){
   const item=prepared.translations.get(id);if(!item)storage();const values=output?.items?.filter(value=>value.id===id),value=values?.[0];
   if(output&&(!Array.isArray(values)||values.length!==1||typeof value.translation!=='string'||!value.translation.trim()||typeof value.isTargetLanguage!=='boolean'||typeof value.detectedLanguage!=='string'))storage();
   const state=value?{status:value.isTargetLanguage?'same':'translated',text:value.isTargetLanguage?item.text:value.translation,detectedLanguage:value.detectedLanguage,...(value.confidence!==undefined?{confidence:value.confidence}:{})}:{status:unit.status==='failed'?'failed':'pending',text:'',...(unit.errorCode?{errorCode:unit.errorCode}:{})};distribute(item,state);
  }
  else if(unit.kind==='caseHighlights'){if(output)excellentCases.push(...output.cases);}
  else if(unit.kind==='consultationAnalysis'){
   const id=unit.recordIds[0],value=output?.items?.find(item=>item.id===id);if(output&&(!Array.isArray(output.items)||output.items.length!==1||!value))storage();
   analyses[id]=value?{...clone(value),status:'completed',...(unverifiedRoleEvidence(snapshot)?{roleEvidenceMode:CONVERSATION_UNVERIFIED}:{})}:{status:unit.status==='failed'?'failed':'pending',...(unit.errorCode?{errorCode:unit.errorCode}:{})};
  }else if(unit.kind==='scenarioFields'){
   const id=unit.recordIds[0];let result;if(output){try{result=validateScenarioFieldsResult(output,scenarioInput(snapshot,records.find(record=>record.id===id)));}catch{storage();}}
   scenarioFields[id]=result?{status:'completed',fields:clone(result.fields)}:{status:unit.status==='failed'?'failed':'pending',...(unit.errorCode?{errorCode:unit.errorCode}:{})};
  }else if(unit.kind==='consultationIssues'&&output){if(!Array.isArray(output.clusters))storage();clusters.push(...output.clusters.map(cluster=>({...clone(cluster),category:unit.category,ruleId:unit.category,...(hasReportClusterPolicy(snapshot)?{sourceUnitId:unit.id}:{})})));}
  if(unit.status==='failed')warnings.push({kind:unit.kind,code:unit.errorCode||'provider_error',message:unit.error||'本节点未完成，内容已保留待重试。',recordIds:unit.recordIds?[...unit.recordIds]:[...new Set(unit.itemIds.flatMap(id=>prepared.translations.get(id).refs.map(ref=>ref.recordId)))]});
 }
 if(consultationTaxonomyMissing(snapshot))warnings.push({kind:'configuration',code:'taxonomy_not_configured',message:'未配置分类体系；意图列保留配置提示，其它分析正常生成。',recordIds:records.map(record=>record.id)});
 if(unverifiedRoleEvidence(snapshot))warnings.push({kind:'roleEvidence',code:'conversation_roles_unverified',message:isRawReport(snapshot)?rawReportNotices(snapshot)[0]:roleEvidenceNotice(),recordIds:records.map(record=>record.id)});
 let missingCells=0;const missing=new Set(),failed=new Set();
 for(const field of fieldParts.values()){
  if(!field.text.trim())continue;const parts=field.parts,expected=parts[0]?.partCount??splitText(field.text).length,complete=parts.length===expected&&Array.from({length:expected},(_,i)=>parts[i]).every(Boolean)&&parts.every(part=>['same','translated','literal'].includes(part.status));
  let value;if(complete){const semantic=parts.filter(part=>part.status!=='literal'),same=semantic.length>0&&semantic.every(part=>part.status==='same'),languages=[...new Set(semantic.map(part=>part.detectedLanguage))];value={status:same?'same':'translated',text:same?field.text:parts.map(part=>part.text).join(''),detectedLanguage:languages.length===1?languages[0]:'mixed',...(semantic.length&&semantic.every(p=>typeof p.confidence==='number')?{confidence:Math.min(...semantic.map(p=>p.confidence))}:{})};}
  else{const bad=parts.find(part=>part?.status==='failed');value={status:bad?'failed':'pending',text:'',...(bad?.errorCode?{errorCode:bad.errorCode}:{})};missingCells++;missing.add(field.recordId);if(bad)failed.add(field.recordId);}
  translations[field.recordId][field.field]=value;
 }
 if(needsAnalysis)for(const record of records)if(!analyses[record.id])analyses[record.id]={status:'pending'};
 if(config.customFields.length)for(const record of records)if(!scenarioFields[record.id])scenarioFields[record.id]={status:'pending'};
 const analysisStats={total:needsAnalysis?records.length:0,completed:0,failed:0,pending:0,missingRecords:0,negative:0,neutral:0,positiveExcluded:0,uncertain:0,inScope:0,unresolvedScope:0,validVoc:0,invalidVoc:0},vocItems=[];
 for(const record of needsAnalysis?records:[]){const value=analyses[record.id];if(value.status!=='completed'){analysisStats[value.status==='failed'?'failed':'pending']++;continue;}analysisStats.completed++;if(!includeVoc)continue;if(value.sentiment==='正向'){analysisStats.positiveExcluded++;continue;}if(!['负向','中性'].includes(value.sentiment)){analysisStats.uncertain++;continue;}analysisStats[value.sentiment==='负向'?'negative':'neutral']++;analysisStats.inScope++;if(value.voc){vocItems.push({id:record.id,...clone(value.voc),sentiment:value.sentiment,...(unverifiedRoleEvidence(snapshot)?{roleEvidenceMode:CONVERSATION_UNVERIFIED}:{})});analysisStats[value.voc.valid?'validVoc':'invalidVoc']++;}}
 analysisStats.missingRecords=analysisStats.failed+analysisStats.pending;analysisStats.unresolvedScope=analysisStats.missingRecords+analysisStats.uncertain;
 const combined=new Map();for(const cluster of clusters){const key=JSON.stringify([cluster.category,String(cluster.label).trim().toLowerCase()]);if(!combined.has(key))combined.set(key,{...cluster,memberIds:[],summaries:[],actions:[]});const group=combined.get(key);group.memberIds=[...new Set([...group.memberIds,...cluster.memberIds])];if(cluster.summary&&!group.summaries.includes(cluster.summary))group.summaries.push(cluster.summary);if(cluster.action&&!group.actions.includes(cluster.action))group.actions.push(cluster.action);}
 const issueClusters=[...combined.values()].map(({summaries,actions,...group})=>({...group,summary:summaries.join('；'),action:actions.join('；')}));
 let totalTexts=0,literalTexts=0,completedTexts=0,failedTexts=0,pendingTexts=0;for(const item of prepared.translations.values()){if(item.literal){literalTexts++;continue;}totalTexts++;const status=states.get(item.id);if(['same','translated'].includes(status))completedTexts++;else if(status==='failed')failedTexts++;else pendingTexts++;}
 return{targetLang:snapshot.targetLang,status:job.status,generatedAt:job.updatedAt,...(unverifiedRoleEvidence(snapshot)?{roleEvidenceMode:CONVERSATION_UNVERIFIED}:{}),translations,...(snapshot.executionSnapshot?.configuration.executionMode==='configured'?{excellentCases:excellentCases.sort((a,b)=>b.score-a.score).slice(0,5)}:{}),consultationAnalysis:analyses,...(config.custom?{scenarioFields}:{}),analysisStats,vocItems,...(hasReportClusterPolicy(snapshot)?buildReportIssueClusters(snapshot,clusters):{issueClusters}),warnings,translationStats:{totalTexts,literalTexts,completedTexts,failedTexts,pendingTexts,affectedRecords:failed.size,missingRecords:missing.size,missingCells},analysisComplete:job.units.filter(unit=>unit.kind!=='translation').every(unit=>unit.status==='completed')};
}
