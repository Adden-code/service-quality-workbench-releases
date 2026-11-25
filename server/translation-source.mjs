import {createHash} from 'node:crypto';
import {getTaskBasis} from '../public/task-basis.mjs';
import {findScenario} from '../public/scenarios.mjs';
import {sessionDisplayFields} from '../public/session-display-fields.mjs';
import {rulePreparationFields,sceneDraftFields} from '../public/admin-draft-fields.mjs';
import {rulePreparationId} from './admin-draft-store.mjs';

export class TranslationJobError extends Error {
 constructor(message,status=400,code='TRANSLATION_INPUT'){super(message);this.name='TranslationJobError';this.status=status;this.code=code;}
}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':plain(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export const translationHash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function translationJobId(id){if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))throw new TranslationJobError('翻译任务标识无效。');return id;}
const validToken=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200&&!/[\p{Cc}]/u.test(value);
export function translationSource(source){
 const shapes={'rule-preparation':['kind','preparationId'],'scene-draft':['kind','draftId','revision'],'session-display':['kind','taskId','sessionId'],session:['kind','taskId','sessionId'],task:['kind','taskId'],rule:['kind','id','version'],policy:['kind','id','version'],catalog:['kind','section'],scenario:['kind','id'],report:['kind','jobId']};
 const keys=plain(source)&&Object.hasOwn(shapes,source.kind)?shapes[source.kind]:null;
 if(!keys||Object.keys(source).length!==keys.length||!keys.every(key=>Object.hasOwn(source,key)&&validToken(source[key])))throw new TranslationJobError('翻译来源选择器无效，不接受自定义文本或额外字段。');
 if(source.kind==='catalog'&&!['rules','policies'].includes(source.section))throw new TranslationJobError('翻译目录范围无效。');
 if(['rule','policy'].includes(source.kind)&&!/^V(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(source.version))throw new TranslationJobError('请选择明确的规则或政策版本。');
 if(source.kind==='report')translationJobId(source.jobId);
 if(source.kind==='rule-preparation')rulePreparationId(source.preparationId);
 if(source.kind==='scene-draft'&&(!/^SCD-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(source.draftId)||!/^([1-9]\d{0,9})$/.test(source.revision)))throw new TranslationJobError('场景草稿来源或版本无效。');
 return Object.fromEntries(keys.map(key=>[key,source[key]]));
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>typeof value?.[key]==='string'||typeof value?.[key]==='number'||typeof value?.[key]==='boolean').map(key=>[key,value[key]]));
const record=(item,kind)=>({...pick(item,['id','version','title','name','category','scope','changeNote','effectiveAt','expiresAt']),...(kind==='rules'?{...pick(item,['passCriteria','failCriteria','exceptionCriteria']),policyIds:(item.policyIds||[]).filter(value=>typeof value==='string')}:{sections:(item.sections||[]).map(section=>pick(section,['id','title','text']))})});
const basisOf=basis=>({...pick(basis,['capturedAt','effectiveDate']),rules:(basis?.rules||[]).map(rule=>record(rule,'rules')),policies:(basis?.policies||[]).map(policy=>record(policy,'policies'))});
const reasonOf=item=>({...pick(item,['ruleId','verdict','reason','source']),...(Array.isArray(item?.evidence)?{evidence:item.evidence.filter(Number.isInteger)}:{}),...(Array.isArray(item?.batchEvidence)?{batchEvidence:item.batchEvidence.map(group=>pick(group,['reason']))}:{})});
const sessionOf=session=>({...pick(session,['id','taskId','topic','product','intent','demandSummary','negativeVoice','salesStage']),turns:(session.turns||[]).map(turn=>pick(turn,['id','role','text'])),aiResults:(session.aiResults||[]).map(reasonOf),review:{...pick(session.review,['status','notes']),drafts:Object.fromEntries(Object.entries(session.review?.drafts||{}).map(([id,item])=>[id,reasonOf(item)]))}});
const taskOf=task=>pick(task,['id','name','scene']);
const scenarioOf=scenario=>({...pick(scenario,['id','version','name']),customFields:(scenario.customFields||[]).map(field=>({...pick(field,['id','label','instruction']),options:(field.options||[]).filter(value=>typeof value==='string')})),report:pick(scenario.report,['title','groupLabel'])});

/** Only explicit human-readable fields enter the model. Identifiers/statuses stay metadata. */
function fieldsOf(data){
 const fields=[];
 const add=(id,value)=>{if(typeof value==='string'&&value.trim())fields.push({id,text:value});};
 const readable=(value,prefix,keys)=>{for(const key of keys)add(prefix+'.'+key,value?.[key]);};
 const rule=(item,prefix)=>readable(item,prefix,['title','name','category','scope','changeNote','passCriteria','failCriteria','exceptionCriteria']);
 const policy=(item,prefix)=>{readable(item,prefix,['title','category','scope','changeNote']);for(const section of item.sections||[])readable(section,prefix+'.sections.'+section.id,['title','text']);};
 if(data.task)readable(data.task,'task',['name']);
 if(data.basis){for(const item of data.basis.rules)rule(item,'basis.rules.'+item.id+'@'+item.version);for(const item of data.basis.policies)policy(item,'basis.policies.'+item.id+'@'+item.version);}
 if(data.rule)rule(data.rule,'rule.'+data.rule.id+'@'+data.rule.version);
 if(data.policy)policy(data.policy,'policy.'+data.policy.id+'@'+data.policy.version);
 for(const item of data.catalog||[])readable(item,'catalog.'+item.id+'@'+item.version,['title','category','scope']);
 const resultReason=(item,prefix)=>{add(prefix+'.reason',item.reason);(item.batchEvidence||[]).forEach((group,index)=>add(prefix+'.batchEvidence.'+index+'.reason',group.reason));};
 for(const session of data.sessions||[]){const prefix='sessions.'+session.id;readable(session,prefix,['topic','product','intent','demandSummary','negativeVoice','salesStage']);for(const turn of session.turns)add(prefix+'.turns.'+turn.id+'.text',turn.text);for(const item of session.aiResults)resultReason(item,prefix+'.aiResults.'+item.ruleId);for(const [id,item] of Object.entries(session.review.drafts))resultReason(item,prefix+'.review.drafts.'+id);add(prefix+'.review.notes',session.review.notes);}
 if(data.scenario){const item=data.scenario;add('scenario.name',item.name);readable(item.report,'scenario.report',['title','groupLabel']);for(const field of item.customFields){readable(field,'scenario.customFields.'+field.id,['label','instruction']);field.options.forEach((value,index)=>add('scenario.customFields.'+field.id+'.options.'+index,value));}}
 return fields;
}
function validateFields(fields){
 if(!Array.isArray(fields)||fields.length>100000)throw new TranslationJobError('翻译来源文本超出支持范围。',413);
 const seen=new Set();for(const item of fields){if(!plain(item)||Object.keys(item).some(key=>!['id','text'].includes(key))||!validToken(item.id)||seen.has(item.id)||typeof item.text!=='string'||!item.text.trim()||item.text.length>2*1024*1024)throw new TranslationJobError('翻译来源字段无效、重复或超出支持范围。');seen.add(item.id);}
 if(Buffer.byteLength(JSON.stringify(fields))>48*1024*1024)throw new TranslationJobError('翻译来源文本超出支持范围。',413);
 return structuredClone(fields);
}
export async function freezeTranslationSource({source,store,reportJobs,collectReportFields,adminDrafts}){
 source=translationSource(source);let data,fields,sourceRevision=null;
 if(source.kind==='rule-preparation'){
  if(!adminDrafts?.get)throw new TranslationJobError('规则起草来源服务不可用。',503);
  const saved=await adminDrafts.get(source.preparationId);
  fields=validateFields(rulePreparationFields(saved.result));data={preparation:{id:saved.id,createdAt:saved.createdAt,sourceSha256:saved.source.sha256,...pick(saved.result,['modelId','requestId','promptVersion'])}};
 }else if(source.kind==='report'){
  if(!reportJobs?.getResult)throw new TranslationJobError('交付来源服务不可用。',503);
  const saved=await reportJobs.getResult(source.jobId);
  if(!['completed','completed_with_warnings'].includes(saved.job?.status))throw new TranslationJobError('请先完成基础交付任务，再翻译报告内容。',409);
  const collector=collectReportFields||(await import('../public/report-locale.mjs')).collectReportTranslationFields;
  fields=validateFields(collector(saved.snapshot,saved.enrichment));
  data={report:{jobId:source.jobId,...pick(saved.job,['snapshotFingerprint','sourceRevision']),...pick(saved.snapshot,['taskId','deliveryType','conclusionMode','targetLang'])}};sourceRevision=saved.job.sourceRevision??null;
 }else{
  const doc=await store.read();sourceRevision=doc.revision??null;
  const state=doc.state||{},catalog=doc.catalog||{};
  if(source.kind==='scene-draft'){
   const draft=state.scenePackageDrafts?.find(item=>item.id===source.draftId);
   if(!draft?.preparation)throw new TranslationJobError('AI场景草稿来源不存在。',404);
   if(String(draft.revision)!==source.revision)throw new TranslationJobError('场景草稿已修改，请保存并刷新英文预览。',409);
   sourceRevision=draft.revision;fields=validateFields(sceneDraftFields(draft));data={draft:pick(draft,['id','revision','sceneId','status']),preparation:{at:draft.preparation.at,model:pick(draft.preparation.model,['modelId','modelFingerprint']),source:pick(draft.preparation.source?.source,['sha256'])}};
  }else if(source.kind==='session-display'){
   const task=state.tasks?.find(item=>item.id===source.taskId),session=state.sessions?.find(item=>item.taskId===source.taskId&&item.id===source.sessionId);
   if(!task||!session)throw new TranslationJobError('翻译来源会话不存在或不属于当前任务。',404);
   fields=validateFields(sessionDisplayFields(session,task));data={task:pick(task,['id']),session:pick(session,['id','taskId'])};
  }else if(source.kind==='session'||source.kind==='task'){
   const task=state.tasks?.find(item=>item.id===source.taskId);if(!task)throw new TranslationJobError('翻译来源任务不存在。',404);
   const sessions=(state.sessions||[]).filter(item=>item.taskId===task.id&&(source.kind==='task'||item.id===source.sessionId));if(source.kind==='session'&&sessions.length!==1)throw new TranslationJobError('翻译来源会话不存在或不属于当前任务。',404);
   data={task:taskOf(task),basis:basisOf(getTaskBasis(state,task)),sessions:sessions.map(sessionOf)};
  }else if(source.kind==='rule'||source.kind==='policy'){
   const values=(catalog[source.kind==='rule'?'rules':'policies']||[]).filter(item=>item.id===source.id&&item.version===source.version);if(values.length!==1)throw new TranslationJobError('翻译来源的明确版本不存在。',404);data={[source.kind]:record(values[0],source.kind==='rule'?'rules':'policies')};
  }else if(source.kind==='catalog')data={catalog:(catalog[source.section]||[]).map(item=>pick(item,['id','version','title','category','scope']))};
  else{const scenario=findScenario(state,source.id);if(!scenario)throw new TranslationJobError('翻译来源场景不存在。',404);data={scenario:scenarioOf(scenario)};}
  fields??=validateFields(fieldsOf(data));
 }
 const snapshot={schemaVersion:1,source,sourceRevision,data,fields};return{snapshot,sourceFingerprint:translationHash(snapshot)};
}
