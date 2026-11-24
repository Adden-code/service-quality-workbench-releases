import {activeDesktopJobCount} from './desktop-activity.mjs';
import {deliveryUnitProgress,projectIncompleteDelivery,adoptIncompleteDelivery} from './delivery-progress.mjs';
import {REPORT_CLUSTER_POLICY,hasReportClusterPolicy,buildReportIssueClusters} from '../public/report-issue-clusters.mjs';
import {createJobScheduler,validJobConcurrency,serialOperations,interleaveReportUnits} from './bounded-job-scheduler.mjs';
import {validatePartialReportResult,rebuildValidatedReportAudit} from './report-enrichment.mjs';
const reportVocKind=(snapshot,id)=>{const a=snapshot.sceneAudit?.find(a=>a.id===id);return a?.review?.classification?.runId===a?.execution?.runId?a?.review?.classification?.vocKind:a?.capabilities?.outputs?.ecommerceClassification?.value?.vocKind;};
import {createHash} from 'node:crypto';
import {isVoidedTask} from '../public/task-lifecycle.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createReportJobStore,ReportJobError,reportJobId} from './report-job-store.mjs';
import {modelConfigSnapshot,modelConfigFingerprint} from './model-config.mjs';
import {REPORT_TRANSLATION_PROMPT_VERSION,validateReportTranslationResult} from './report-enrichment.mjs';
import {createBusinessDeliverySnapshot,selectBusinessErrorCases,BUSINESS_RULES} from '../public/business-delivery.mjs';
import {loadConsultationOriginal} from './consultation-source.mjs';
import {planConsultationReport,consultationInputFor,mergeConsultationReport,consultationReportPlanVersion} from './consultation-report-plan.mjs';
import {isConsultationTask} from '../public/consultation-delivery.mjs';
import {validateScenarioFieldsResult} from './scenario-fields.mjs';
import {CONVERSATION_UNVERIFIED,normalizeRoleEvidenceMode} from '../public/role-evidence.mjs';
import {safeConsultationDiagnostic,consultationRetryFeedback} from './consultation-enrichment.mjs';

const copy=value=>structuredClone(value),now=()=>new Date().toISOString();
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const fingerprint=snapshot=>{const value=copy(snapshot);delete value.createdAt;return hash(value);};
function outputAudit(output,secret){
 const audit={};
 if(output?.coercion?.version===1&&Array.isArray(output.coercion.changes))audit.coercion=bounded(output.coercion,secret);
 if(output?.evidenceValidation?.version===1&&Array.isArray(output.evidenceValidation.matches))audit.evidenceValidation=bounded({version:1,matches:output.evidenceValidation.matches.map(({rawQuote,...match})=>({...match,rawQuote:(rawQuote||'').slice(0,240),quotePreview:(rawQuote||'').length>240,rawQuoteSha256:hash(rawQuote||''),rawQuoteCharacters:(rawQuote||'').length}))},secret);
 return audit;
}
const retryable=code=>['invalid_output','timeout','network','rate_limit','provider_unavailable','provider_error'].includes(code);
const fatal=code=>['authentication','permission','request_rejected','not_configured'].includes(code);
const messages={invalid_input:'报告分析输入、字段配置或冻结依据无效，请检查后重试；未生成的分析保留为缺失。',invalid_output:'模型输出未通过完整性校验。',timeout:'模型调用超时。',network:'模型连接失败。',rate_limit:'模型服务限流。',provider_unavailable:'模型服务暂不可用。',authentication:'模型鉴权失败，已停止后续调用。',permission:'模型权限不足，已停止后续调用。',request_rejected:'模型拒绝当前请求配置，已停止后续调用。',not_configured:'模型尚未配置，译文和AI分析未生成。',output_truncated:'模型输出被截断，未采用不完整内容。',input_too_large:'输入超过模型请求预算，原文未截断。',interrupted:'任务中断，已完成的内容保留。',provider_error:'模型生成失败。'};
function failure(error){const key=String(error?.code||'provider_error').toLowerCase();return{errorCode:Object.hasOwn(messages,key)?key:'provider_error',error:messages[key]||messages.provider_error};}
const isStorageError=error=>error?.code==='REPORT_STORAGE'||String(error?.code||'').startsWith('trace_');
const chunks=(items,{maxItems=10,maxChars=12000,maxBytes=120000}={})=>{
 const groups=[];let group=[],chars=0,bytes=0;
 for(const item of items){const text=JSON.stringify(item),size=Buffer.byteLength(text);if(group.length&&(group.length>=maxItems||chars+text.length>maxChars||bytes+size>maxBytes)){groups.push(group);group=[];chars=0;bytes=0;}group.push(item);chars+=text.length;bytes+=size;}if(group.length)groups.push(group);return groups;
};
function plan(snapshot,configFingerprint){
 if(snapshot.deliveryType==='consultation-v1')return planConsultationReport(snapshot,configFingerprint);
 const translations=new Map(),units=[];const add=(kind,label,details)=>units.push({id:`n${units.length+1}`,kind,label,...details,status:'pending',attempts:0,durationMs:0,history:[]});
 const errors=selectBusinessErrorCases(snapshot,10),errorIds=new Set(errors.map(row=>row.id));
 for(const record of snapshot.records){for(const [field,text]of [['comment',record.raw22[8]],['reply',record.raw22[9]],...(errorIds.has(record.id)?[['humanIssue',record.raw22[21]]]:[])]){
  if(!text?.trim())continue;const id='t'+hash(text),key=hash({text,targetLang:snapshot.targetLang,model:configFingerprint,prompt:REPORT_TRANSLATION_PROMPT_VERSION+(snapshot.executionSnapshot?.configuration.executionMode==='configured'?'-confidence-v1':'')});
  if(!translations.has(id))translations.set(id,{id,text,key,refs:[]});translations.get(id).refs.push({recordId:record.id,field});
 }}
 chunks([...translations.values()],{maxItems:6,maxChars:12000,maxBytes:120000}).forEach((items,index)=>add('translation',`翻译批次 ${index+1}`,{itemIds:items.map(item=>item.id)}));
 const excellent=snapshot.records.filter(row=>row.finalOverall==='通过'&&row.evaluationType==='好评正向'&&row.replyStatus!=='unreplied'&&row.raw22[9].trim());
 chunks(excellent.map(row=>({id:row.id,comment:row.raw22[8],reply:row.raw22[9]})),{maxChars:100000}).forEach((items,index)=>add('caseHighlights',`优秀案例 ${index+1}`,{recordIds:items.map(item=>item.id)}));
 for(const rule of BUSINESS_RULES){const selected=snapshot.records.filter(row=>row.replyStatus!=='unreplied'&&row.final.some(item=>(item.ruleId||item.id)===rule.id&&item.verdict==='不通过'));
  chunks(selected.map(row=>({id:row.id,reason:row.final.find(item=>(item.ruleId||item.id)===rule.id).reason,comment:row.raw22[8],reply:row.raw22[9]})),{maxChars:100000}).forEach((items,index)=>add('issueClusters',`${rule.shortLabel||rule.label}原因 ${index+1}`,{ruleId:rule.id,recordIds:items.map(item=>item.id)}));
 }
 const profile=snapshot.executionSnapshot?.configuration.basis.executionProfile==='ec-business-v1';
 const voc=snapshot.records.filter(row=>(profile?['好评负向','中评','差评']:['好评负向','中评']).includes(row.evaluationType)&&row.raw22[8].trim()&&(!profile||!['strong-negative','none'].includes(reportVocKind(snapshot,row.id))));
 chunks(voc.map(row=>({id:row.id,comment:row.raw22[8]})),{maxChars:100000}).forEach((items,index)=>add('voc',`用户原声 ${index+1}`,{recordIds:items.map(item=>item.id)}));
 return{translations,units};
}
function inputFor(snapshot,unit,prepared){
 if(snapshot.deliveryType==='consultation-v1')return consultationInputFor(snapshot,unit,prepared);
 const byId=new Map(snapshot.records.map(row=>[row.id,row]));
 if(unit.kind==='translation')return{targetLang:snapshot.targetLang,...(snapshot.executionSnapshot?.configuration.executionMode==='configured'?{includeConfidence:true}:{}),items:unit.itemIds.map(id=>{const item=prepared.translations.get(id);if(!item)throw new ReportJobError('翻译计划与冻结来源不一致。',500,'REPORT_STORAGE');return{id:item.id,text:item.text};})};
 const rows=unit.recordIds.map(id=>{const row=byId.get(id);if(!row)throw new ReportJobError('分析计划与冻结来源不一致。',500,'REPORT_STORAGE');return row;});
 if(unit.kind==='caseHighlights')return{candidates:rows.map(row=>({id:row.id,comment:row.raw22[8],reply:row.raw22[9]})),limit:Math.min(5,rows.length),...(snapshot.executionSnapshot?.configuration.referenceMaterials?.length?{referenceMaterials:copy(snapshot.executionSnapshot.configuration.referenceMaterials)}:{})};
 if(unit.kind==='issueClusters')return{ruleId:unit.ruleId,records:rows.map(row=>({id:row.id,reason:row.final.find(item=>(item.ruleId||item.id)===unit.ruleId)?.reason||'',comment:row.raw22[8],reply:row.raw22[9]}))};
 return{records:rows.map(row=>({id:row.id,comment:row.raw22[8]}))};
}
function progress(job){return deliveryUnitProgress(job.units);}
function summary(job){return{schemaVersion:1,id:job.id,...(job.reportClusterPolicy?{reportClusterPolicy:job.reportClusterPolicy}:{}),concurrency:job.concurrency??2,taskId:job.taskId,taskName:job.taskName,createdAt:job.createdAt,updatedAt:job.updatedAt,status:job.status,phase:job.phase,options:copy(job.options),snapshotFingerprint:job.snapshotFingerprint,sourceRevision:job.sourceRevision,progress:progress(job),warningsCount:job.units.filter(unit=>unit.status==='failed').length,resultAvailable:true,stopReason:job.stopReason||'',modelConfig:copy(job.modelConfig),traceRunIds:[...job.traceRunIds],nodes:job.units.map(({id,kind,label,status,attempts,durationMs,errorCode,error,notApplicable})=>({id,kind,label,status,attempts,durationMs,...(notApplicable?{notApplicable:true}:{}),...(errorCode?{errorCode,error}:{})}))};}
function bounded(value,secret){const clean=input=>typeof input==='string'?(secret?input.split(secret).join('[已隐藏密钥]'):input):Array.isArray(input)?input.map(clean):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).filter(([key])=>!['apikey','authorization','proxyauthorization'].includes(key.toLowerCase().replace(/[\s_-]/g,''))).map(([key,item])=>[key,clean(item)])):input??null;const safe=clean(value),text=JSON.stringify(safe),bytes=Buffer.byteLength(text);return bytes<=16384?safe:{truncated:true,bytes,limitBytes:16384,sha256:hash(text),preview:text.slice(0,3000),...(safe?.kind==='consultationAnalysis'&&safeConsultationDiagnostic(safe.diagnostic)?{diagnostic:safeConsultationDiagnostic(safe.diagnostic)}:{}),reason:'节点快照已摘要；原文及完整成功输出保留在交付任务中。'};}
async function abortable(operation,signal){if(signal.aborted)throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'});let cancel;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{cancel=()=>reject(Object.assign(new Error('interrupted'),{code:'INTERRUPTED'}));signal.addEventListener('abort',cancel,{once:true});})]);}finally{if(cancel)signal.removeEventListener('abort',cancel);}}

// This default applies only when creating a job; saved jobs without the field
// continue using their original two-worker fallback in summary and execution.
export async function createReportJobs({dataDir,store,modelConfig,client,traceStore,maxAttempts=2,retryDelayMs=500,concurrency=4,onError=()=>{}}={}){
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw new TypeError('Invalid report attempt budget.');
 if(!validJobConcurrency(concurrency))throw new TypeError('Report concurrency must be an integer from 2 to 4.');
 const files=await createReportJobStore({dataDir}),jobs=new Map(),snapshots=new Map(),outputs=new Map(),active=new Map();let closing=false,closePromise=null,serialTail=Promise.resolve(),pendingOperations=0;
 const serial=operation=>{pendingOperations++;const next=serialTail.then(operation).finally(()=>{pendingOperations--;});serialTail=next.catch(()=>{});return next;};
 const persist=async job=>{job.updatedAt=now();await files.save(job);};
 for(const job of await files.list()){
  if(!['running','paused','completed','completed_with_warnings'].includes(job.status)||(job.concurrency!==undefined&&!validJobConcurrency(job.concurrency))||!job.modelConfig||typeof job.snapshotFingerprint!=='string')throw new ReportJobError('交付任务记录损坏，原文件已保留。',500,'REPORT_STORAGE');
  jobs.set(job.id,job);if(job.status==='running'||(job.status==='paused'&&job.units.some(unit=>unit.status==='running'))){
   job.status='paused';job.stopReason=job.stopReason||'interrupted';
   for(const unit of job.units)if(unit.status==='running'){
    const saved=await files.result(job.id,unit.id);
    if(saved){
     if(saved.sha256!==hash(JSON.stringify(saved.value)))throw new ReportJobError('中断节点输出的指纹不一致，原文件已保留。',500,'REPORT_STORAGE');
     const attempt=await files.attempt(job.id,unit.id,unit.attempts);
     const partial=Boolean(saved.value?.partial||(unit.partialResult&&attempt?.status!=='completed'));
     unit.resultSha256=saved.sha256;unit.status=partial?'pending':'completed';if(partial)unit.partialResult=true;else delete unit.partialResult;outputs.set(job.id+'/'+unit.id,saved.value);
     if(attempt&&!unit.history.some(item=>item.attempt===unit.attempts)){const {input,output,...info}=attempt;unit.history.push(info);unit.durationMs+=info.durationMs||0;unit.completedAt=info.completedAt;}
    }else unit.status='pending';
   }
   await persist(job);
  }
 }
 const find=id=>{const job=jobs.get(reportJobId(id));if(!job)throw new ReportJobError('交付任务不存在。',404);return job;};
 async function snapshotOf(job){if(!snapshots.has(job.id)){const snapshot=await files.snapshot(job.id);if(fingerprint(snapshot)!==job.snapshotFingerprint)throw new ReportJobError('交付任务快照指纹不一致，原文件已保留。',500,'REPORT_STORAGE');snapshots.set(job.id,snapshot);}const snapshot=snapshots.get(job.id);try{if(normalizeRoleEvidenceMode(job.options?.roleEvidenceMode)!==normalizeRoleEvidenceMode(snapshot.roleEvidenceMode)||snapshot.deliveryType!=='consultation-v1'&&normalizeRoleEvidenceMode(snapshot.roleEvidenceMode)===CONVERSATION_UNVERIFIED)throw new Error();}catch{throw new ReportJobError('交付任务引用口径与已冻结快照不一致，原文件已保留。',500,'REPORT_STORAGE');}if(snapshot.deliveryType==='consultation-v1'&&job.planVersion!==consultationReportPlanVersion(snapshot))throw new ReportJobError('新品交付计划版本与已冻结任务不一致，请保留旧结果并重新生成。',500,'REPORT_STORAGE');return snapshot;}
 async function outputOf(job,unit){const key=job.id+'/'+unit.id;if(outputs.has(key))return outputs.get(key);const envelope=await files.result(job.id,unit.id);if(!envelope||envelope.sha256!==unit.resultSha256||hash(JSON.stringify(envelope.value))!==envelope.sha256)throw new ReportJobError('已生成内容的指纹不一致，原文件已保留。',500,'REPORT_STORAGE');outputs.set(key,envelope.value);return envelope.value;}
 // Project legacy completed translations through the current target guard.
 // Reads never rewrite saved jobs, attempts, results or caches and never call a model.
 async function visibleJob(saved){
  const job=projectIncompleteDelivery(copy(saved));const snapshot=job.options?.targetLang==='en'?await snapshotOf(job):null;
  const prepared=snapshot?plan(snapshot,job.modelConfigFingerprint):null;let invalid=false;
  for(const unit of job.units)if(unit.kind==='translation'&&unit.status==='completed'){
   const output=await outputOf(job,unit);
   unit.notApplicable=Array.isArray(output?.items)&&output.items.length>0&&output.items.every(item=>item.isTargetLanguage===true);
   if(job.options?.targetLang!=='en')continue;
   try{validateReportTranslationResult({items:output?.items},inputFor(snapshot,unit,prepared));}
   catch(error){if(error.code!=='INVALID_OUTPUT')throw error;delete unit.notApplicable;unit.status='failed';unit.errorCode='invalid_output';unit.error='已保存译文未通过英文语种校验，请重试缺失项。';invalid=true;}
  }
  if(invalid&&job.status==='completed')job.status='completed_with_warnings';return job;
 }
 function adoptTranslationFailures(job,view){adoptIncompleteDelivery(job,view);for(const unit of job.units){const checked=view.units.find(item=>item.id===unit.id);if(unit.kind==='translation'&&unit.status==='completed'&&checked?.status==='failed'){unit.status='failed';unit.errorCode=checked.errorCode;unit.error=checked.error;}}}
 function validatedTranslations(value,input){
  try{return validateReportTranslationResult({items:value?.items},input);}
  catch(error){if(error.code==='INVALID_OUTPUT')error.traceOutput={kind:'translation',content:JSON.stringify(value??null).slice(0,20000)};throw error;}
 }
 function savedConfig(job){const current=modelConfig.getPrivate(),selected=modelConfigSnapshot(current);if(selected.baseUrl!==job.modelConfig.baseUrl||selected.authMode!==job.modelConfig.authMode)throw new ReportJobError('模型地址或认证方式已变化，请恢复原设置后继续，或重新生成交付任务。',409);return{...copy(job.modelConfig),apiKey:job.modelConfig.authMode==='none'?null:current.apiKey,configured:current.configured};}
 async function resultOf(job){
  job=await visibleJob(job);
  if((await snapshotOf(job)).deliveryType==='consultation-v1'){
   const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.modelConfigFingerprint),saved=new Map();
   for(const unit of job.units)if(unit.status==='completed'||unit.partialResult===true)saved.set(unit.id,await outputOf(job,unit));
   return{snapshot:copy(snapshot),enrichment:mergeConsultationReport(snapshot,job,prepared,saved),job:summary(job)};
  }
  const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.modelConfigFingerprint),translations=Object.fromEntries(snapshot.records.map(row=>[row.id,Object.fromEntries(['comment','reply','humanIssue'].map(field=>[field,{status:'empty',text:''}]))])),states=new Map();
  const excellent=[],clusters=[],vocItems=snapshot.records.filter(row=>['好评负向','中评'].includes(row.evaluationType)&&!row.raw22[8].trim()).map(row=>({id:row.id,valid:false,scene:'',painPoint:'',reason:'评论内容为空，无法归类具体问题。',evidenceQuote:''})),warnings=[];
  for(const unit of job.units){
   const output=unit.status==='completed'||unit.partialResult===true?await outputOf(job,unit):null;
   if(unit.kind==='translation'){
    for(const id of unit.itemIds){const item=prepared.translations.get(id),value=output?.items?.find(row=>row.id===id);let translated;
     if(value)translated={status:value.isTargetLanguage?'same':'translated',text:value.isTargetLanguage?item.text:value.translation,detectedLanguage:value.detectedLanguage,...(value.confidence!==undefined?{confidence:value.confidence}:{})};
     else translated={status:unit.status==='failed'?'failed':'pending',text:'',...(unit.errorCode?{errorCode:unit.errorCode}:{})};
     states.set(id,translated.status);for(const ref of item.refs)translations[ref.recordId][ref.field]=copy(translated);
    }
   }else if(output){if(unit.kind==='caseHighlights')excellent.push(...output.cases);else if(unit.kind==='issueClusters')clusters.push(...output.clusters.map(value=>({...value,ruleId:unit.ruleId,...(hasReportClusterPolicy(snapshot)?{sourceUnitId:unit.id}:{})})));else vocItems.push(...output.items);}
   if(unit.status==='failed')warnings.push({kind:unit.kind,code:unit.errorCode,message:unit.error,recordIds:unit.recordIds||[...new Set(unit.itemIds.flatMap(id=>prepared.translations.get(id).refs.map(ref=>ref.recordId)))]});
  }
  const failed=new Set(),missing=new Set();let failedTexts=0,pendingTexts=0,completedTexts=0,missingCells=0;
  for(const item of prepared.translations.values()){const status=states.get(item.id);if(status==='failed')failedTexts++;else if(['same','translated'].includes(status))completedTexts++;else pendingTexts++;if(!['same','translated'].includes(status)){missingCells+=item.refs.length;for(const ref of item.refs){missing.add(ref.recordId);if(status==='failed')failed.add(ref.recordId);}}}
  const byId=new Map(snapshot.records.map(row=>[row.id,row])),best=new Map();for(const item of excellent)if(!best.has(item.id)||item.score>best.get(item.id).score)best.set(item.id,item);
  const excellentCases=[...best.values()].sort((a,b)=>b.score-a.score||(byId.get(a.id)?.sourceRow||0)-(byId.get(b.id)?.sourceRow||0)).slice(0,5);
  const combined=new Map();for(const cluster of clusters){const key=cluster.ruleId+'\0'+cluster.label.trim().toLowerCase();if(!combined.has(key))combined.set(key,{...cluster,memberIds:[]});const group=combined.get(key);group.memberIds=[...new Set([...group.memberIds,...cluster.memberIds])];}
  if(snapshot.executionSnapshot?.configuration.basis.executionProfile==='ec-business-v1')for(const row of snapshot.records){if(reportVocKind(snapshot,row.id)==='strong-negative'){const a=snapshot.sceneAudit.find(a=>a.id===row.id),e=a.capabilities?.outputs?.ecommerceClassification?.evidence||[];vocItems.push({id:row.id,valid:false,vocKind:'strong-negative',scene:'强烈负面情绪',painPoint:'',reason:'明确负面态度，纳入负面VOC；不归具体问题类型。',evidenceQuote:e.map(x=>x.quote).join('\n')||row.raw22[8]});}}
  const enrichment={targetLang:snapshot.targetLang,status:job.status,generatedAt:job.updatedAt,translations,excellentCases,...(hasReportClusterPolicy(snapshot)?buildReportIssueClusters(snapshot,clusters):{issueClusters:[...combined.values()]}),vocItems,warnings,translationStats:{totalTexts:prepared.translations.size,completedTexts,failedTexts,pendingTexts,affectedRecords:failed.size,missingRecords:missing.size,missingCells},analysisComplete:!job.units.some(unit=>unit.kind!=='translation'&&unit.status!=='completed')};
  return{snapshot:copy(snapshot),enrichment,job:summary(job)};
 }
 function launch(job,config){const work={job,config,controller:new AbortController(),paused:false,promise:null};active.set(job.id,work);work.promise=Promise.resolve().then(()=>execute(work));return work;}
 async function execute(work){
  const job=work.job,parts=[],nodeRuns=new Map();let partCount=0;const register=serialOperations();
  const canDispatch=()=>!closing&&!work.paused&&!work.controller.signal.aborted&&!work.stopped&&!fatal(job.stopReason);
  const scheduler=work.scheduler=createJobScheduler({concurrency:job.concurrency??2,retryDelayMs,signal:work.controller.signal,canDispatch});
  async function step(id,label,input,operation){
   if(!traceStore)return operation();const runId=await register(async()=>{let runId=nodeRuns.get(id);
   if(!runId){if(!parts.length||partCount>=64){runId=`${job.id}.r${job.round}.s${job.resumeCount}.p${parts.length+1}`;await traceStore.begin({id:runId,taskId:job.id,engine:client.engine||'native-node',kind:'business-export',nodes:[{id,label}],meta:{sourceTaskId:job.taskId,parentRunId:parts[0]||runId,part:parts.length+1}});parts.push(runId);job.traceRunIds.push(runId);partCount=1;}else{runId=parts.at(-1);await traceStore.appendNodes(runId,[{id,label}]);partCount++;}nodeRuns.set(id,runId);await persist(job);}return runId;});
   let value;await traceStore.step(runId,id,bounded(input,work.config.apiKey),async()=>{try{value=await operation();return bounded(value,work.config.apiKey);}catch(error){if(error.traceOutput!==undefined)error.traceOutput=bounded(error.traceOutput,work.config.apiKey);throw error;}});return value;
  }
  try{
   const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.modelConfigFingerprint);
   await step('snapshot','冻结交付来源',{source:job.taskId,sourceRevision:job.sourceRevision,fingerprint:job.snapshotFingerprint,records:snapshot.records.length,conclusionMode:snapshot.conclusionMode,targetLang:snapshot.targetLang},async()=>({frozen:true}));
   await scheduler.run(interleaveReportUnits(job.units.filter(unit=>!['completed','failed'].includes(unit.status))),async unit=>{
    if(!canDispatch())return;if(unit.partialResult===true)await outputOf(job,unit);job.phase=unit.kind;
    for(let attempt=1;attempt<=maxAttempts&&canDispatch();attempt++){
     if(!await scheduler.ready())break;
     unit.status='running';unit.attempts++;unit.startedAt=now();unit.completedAt=null;delete unit.errorCode;delete unit.error;await persist(job);const started=Date.now();let input,output,error,retryFeedback;
     try{
      input=inputFor(snapshot,unit,prepared);
      if(unit.kind==='consultationAnalysis'){
       const previous=unit.history.findLast(item=>item.errorCode==='invalid_output');
       if(previous){const saved=await files.attempt(job.id,unit.id,previous.attempt);retryFeedback=consultationRetryFeedback(saved?.output?.diagnostic,input);}
      }else if(['caseHighlights','issueClusters','voc'].includes(unit.kind)&&unit.history.some(item=>item.errorCode==='invalid_output')){
       retryFeedback={kind:unit.kind,code:'invalid_output'};
      }
      output=await step(`${unit.id}-a${unit.attempts}-execute`,unit.label,{kind:unit.kind,input,...(retryFeedback?{validationFeedback:retryFeedback}:{})},async()=>{
       if(unit.kind==='translation'){
        const cached=new Map();for(const item of input.items){const value=await files.cache(prepared.translations.get(item.id).key);if(value){try{const validated=validatedTranslations({items:[{...value,id:item.id}]},{...input,items:[item]});cached.set(item.id,validated.items[0]);}catch(error){if(error.code!=='INVALID_OUTPUT')throw error;}}}
        const pending=input.items.filter(item=>!cached.has(item.id));let generated={items:[]};
        if(pending.length){if(!await scheduler.ready())throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'});if(work.config.configured===false||(work.config.authMode!=='none'&&!work.config.apiKey))throw Object.assign(new Error('not configured'),{code:'NOT_CONFIGURED'});const pendingInput={...input,items:pending};generated=validatePartialReportResult('translation',await scheduler.request(()=>abortable(()=>client.enrichBusinessReport({config:work.config,kind:unit.kind,input:pendingInput,signal:work.controller.signal,trace:{step:(node,data,operation)=>step(`${unit.id}-a${unit.attempts}-${node}`,`${unit.label} · ${node}`,data,operation)}}),work.controller.signal),unit.attempts),pendingInput);}
        for(const item of generated.items){const key=prepared.translations.get(item.id)?.key;if(!key)throw Object.assign(new Error('unexpected translation id'),{code:'INVALID_OUTPUT'});await files.putCache(key,{translation:item.translation,isTargetLanguage:item.isTargetLanguage,detectedLanguage:item.detectedLanguage,...(item.confidence!==undefined?{confidence:item.confidence}:{})});cached.set(item.id,item);}
        if(input.items.some(item=>!cached.has(item.id))){const partial={items:input.items.filter(item=>cached.has(item.id)).map(item=>cached.get(item.id))};if(partial.items.length){unit.partialResult=true;unit.resultSha256=await files.saveResult(job.id,unit.id,partial);outputs.set(job.id+'/'+unit.id,partial);}throw Object.assign(new Error('missing translation; valid items preserved'),{code:'INVALID_OUTPUT'});}return{items:input.items.map(item=>cached.get(item.id))};
       }
       if(unit.kind==='scenarioFields'){
        if(typeof unit.cacheKey!=='string'||!/^[a-f0-9]{64}$/.test(unit.cacheKey))throw new ReportJobError('场景字段缓存配置缺失。',500,'REPORT_STORAGE');
        const cached=await files.cache(unit.cacheKey);if(cached){try{return validateScenarioFieldsResult(cached,input);}catch{throw new ReportJobError('场景字段缓存与冻结输入不一致。',500,'REPORT_STORAGE');}}
        if(!await scheduler.ready())throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'});if(work.config.configured===false||(work.config.authMode!=='none'&&!work.config.apiKey))throw Object.assign(new Error('not configured'),{code:'NOT_CONFIGURED'});
        const generated=await scheduler.request(()=>abortable(()=>client.enrichBusinessReport({config:work.config,kind:unit.kind,input,signal:work.controller.signal,trace:{step:(node,data,operation)=>step(`${unit.id}-a${unit.attempts}-${node}`,`${unit.label} · ${node}`,data,operation)}}),work.controller.signal),unit.attempts),validated=validateScenarioFieldsResult(generated,input);
        await files.putCache(unit.cacheKey,validated);return validated;
       }
       if(!await scheduler.ready())throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'});if(work.config.configured===false||(work.config.authMode!=='none'&&!work.config.apiKey))throw Object.assign(new Error('not configured'),{code:'NOT_CONFIGURED'});
       return scheduler.request(()=>abortable(()=>client.enrichBusinessReport({config:work.config,kind:unit.kind,input,...(retryFeedback?{retryFeedback}:{}),signal:work.controller.signal,trace:{step:(node,data,operation)=>step(`${unit.id}-a${unit.attempts}-${node}`,`${unit.label} · ${node}`,data,operation)}}),work.controller.signal),unit.attempts);
      });
     }catch(cause){if(isStorageError(cause)){work.stopped=true;throw cause;}error=cause;const code=failure(cause).errorCode;if(fatal(code))job.stopReason=code;}
     unit.durationMs+=Math.max(0,Date.now()-started);unit.completedAt=now();
     if(!error&&output?.partial)error=Object.assign(new Error('partial report output'),{code:'INVALID_OUTPUT',partialOutput:output});
     if(error?.partialOutput){const old=outputs.get(job.id+'/'+unit.id);let safe=copy(error.partialOutput);if(old?.cases?.length){safe.cases=[...new Map([...old.cases,...safe.cases].map(c=>[c.id,c])).values()].sort((a,b)=>b.score-a.score).slice(0,input.limit);safe=rebuildValidatedReportAudit(safe,'cases');if(safe.cases.length>=Math.min(input.limit,input.candidates.length)){delete safe.partial;error=null;output=safe;}}unit.partialResult=Boolean(error);if(error){error.partialOutput=safe;unit.resultSha256=await files.saveResult(job.id,unit.id,safe);outputs.set(job.id+'/'+unit.id,safe);}}
     const problem=error?failure(error):null;const info={attempt:unit.attempts,startedAt:unit.startedAt,completedAt:unit.completedAt,durationMs:Math.max(0,Date.now()-started),status:error?'failed':'completed',...(problem||{}),...outputAudit(error?.partialOutput??output,work.config.apiKey)};unit.history.push(info);
     await files.saveAttempt(job.id,unit.id,unit.attempts,{...info,input:bounded(input,work.config.apiKey),...(retryFeedback?{validationFeedback:bounded(retryFeedback,work.config.apiKey)}:{}),output:bounded(error?.traceOutput??output??null,work.config.apiKey)});
     if(!error){delete unit.partialResult;const safe=copy(output);unit.resultSha256=await files.saveResult(job.id,unit.id,safe);outputs.set(job.id+'/'+unit.id,safe);unit.status='completed';await persist(job);break;}
     const willRetry=canDispatch()&&retryable(problem.errorCode)&&attempt<maxAttempts;unit.status=closing||work.paused||problem.errorCode==='interrupted'||willRetry?'pending':'failed';Object.assign(unit,problem);await persist(job);
     if(fatal(problem.errorCode)){job.stopReason=problem.errorCode;for(const pending of job.units)if(pending.status==='pending'){pending.status='failed';Object.assign(pending,problem);}await persist(job);break;}
     if(!willRetry)break;try{await delay(retryDelayMs*2**(attempt-1),undefined,{signal:work.controller.signal});}catch{break;}
    }
   });
   if(fatal(job.stopReason)){const problem=failure({code:job.stopReason});for(const unit of job.units)if(unit.status==='pending'){unit.status='failed';Object.assign(unit,problem);}}
   if(closing||work.paused||work.controller.signal.aborted){job.status='paused';job.completedAt=null;if(closing)job.stopReason='interrupted';}
   else{job.status=job.units.some(unit=>unit.status!=='completed')?'completed_with_warnings':'completed';job.completedAt=now();job.phase='ready';}
   await persist(job);
  }catch(error){onError(error);job.status='paused';job.stopReason='storage_error';job.completedAt=null;for(const unit of job.units)if(unit.status==='running')unit.status='pending';await persist(job).catch(()=>{});}
  finally{
   if(traceStore)for(const id of parts)await traceStore.finish(id,{status:job.status==='paused'?'interrupted':job.status==='completed'?'completed':'partial',summary:{...progress(job),queueStatus:job.status}}).catch(onError);
   if(active.get(job.id)===work)active.delete(job.id);
  }
 }
 return{
  create(input){return serial(async()=>{
   if(closing)throw new ReportJobError('服务正在关闭。',503);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['jobId','taskId','conclusionMode','targetLang','reportLanguage','roleEvidenceMode','concurrency'].includes(key))||(input.concurrency!==undefined&&!validJobConcurrency(input.concurrency))||(input.reportLanguage!==undefined&&!['zh','en'].includes(input.reportLanguage)))throw new ReportJobError('交付任务参数无效。');
   const id=reportJobId(input.jobId);if(typeof input.taskId!=='string'||!input.taskId.trim()||input.taskId.length>160)throw new ReportJobError('请选择质检任务。');
   const doc=await store.read();const allowed=doc.state.tasks.find(t=>t.id===input.taskId)?.executionSnapshot?.runtime.values.outputLanguages;if(allowed&&!allowed.includes(input.targetLang??'zh'))throw new ReportJobError('输出语种不在本任务冻结的运行参数内，请使用已选语种。');if(isVoidedTask(doc.state.tasks.find(task=>task.id===input.taskId)))throw new ReportJobError('作废任务仅供追溯，不能生成新交付物。');let snapshot;try{const task=doc.state.tasks?.find(value=>value.id===input.taskId),original=isConsultationTask(doc.state,task)?await loadConsultationOriginal({state:doc.state,task,store}):undefined;snapshot=createBusinessDeliverySnapshot(doc.state,{taskId:input.taskId,conclusionMode:input.conclusionMode??'combined',targetLang:input.targetLang??'zh',roleEvidenceMode:input.roleEvidenceMode,original,now:now()});}catch(error){throw new ReportJobError(error.message);}
   // Stamp only newly created report snapshots. Never backfill saved jobs.
   snapshot.reportClusterPolicy=REPORT_CLUSTER_POLICY;
   const signature=fingerprint(snapshot);
   if(jobs.has(id)){const old=find(id);if(old.snapshotFingerprint!==signature)throw new ReportJobError('相同任务标识对应不同来源或口径，不能覆盖；请重新生成。',409);return{...summary(await visibleJob(old)),reused:true};}
   // Serialized with creation: different tabs/request IDs must share the same frozen delivery.
   // The established fingerprint includes source, conclusions, language and frozen configuration;
   // only generation time is excluded. Existing snapshots and their hashes are never rewritten.
   const existing=[...jobs.values()].filter(job=>job.taskId===input.taskId&&job.snapshotFingerprint===signature).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
   if(existing)return{...summary(await visibleJob(existing)),reused:true};
   const config=modelConfig.getPrivate(),saved=modelConfigSnapshot(config),configFingerprint=modelConfigFingerprint(config),prepared=plan(snapshot,configFingerprint),createdAt=now();
   const job={schemaVersion:1,id,reportClusterPolicy:snapshot.reportClusterPolicy,concurrency:input.concurrency??concurrency,taskId:input.taskId,taskName:snapshot.taskName,createdAt,updatedAt:createdAt,status:'running',phase:'snapshot',completedAt:null,sourceRevision:doc.revision??null,snapshotFingerprint:signature,options:{conclusionMode:snapshot.conclusionMode,targetLang:snapshot.targetLang,...(input.reportLanguage?{reportLanguage:input.reportLanguage}:{}),...(snapshot.roleEvidenceMode===CONVERSATION_UNVERIFIED?{roleEvidenceMode:CONVERSATION_UNVERIFIED}:{})},modelConfig:saved,modelConfigFingerprint:configFingerprint,units:prepared.units,traceRunIds:[],round:1,resumeCount:0,...(snapshot.deliveryType==='consultation-v1'?{planVersion:consultationReportPlanVersion(snapshot)}:{})};
   // Reserve the deliverable in the workspace serial queue before writing its frozen output.
   // This closes the race with task invalidation; a failed file write remains conservatively logged.
   if(store.updateTaskLifecycle)await store.updateTaskLifecycle([input.taskId],'deliverable',{deliveryId:id,kind:'business-report'});
   await files.create(job,snapshot);jobs.set(id,job);snapshots.set(id,snapshot);launch(job,{...saved,apiKey:saved.authMode==='none'?null:config.apiKey,configured:config.configured});return summary(job);
  });},
  async list(taskId){return Promise.all([...jobs.values()].filter(job=>!taskId||job.taskId===taskId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(async job=>summary(await visibleJob(job))));},
  async get(id){return summary(await visibleJob(find(id)));},
  async getResult(id){return resultOf(copy(find(id)));},
  async getNode(id,nodeId){const job=await visibleJob(find(id)),unit=job.units.find(node=>node.id===nodeId);if(!unit)throw new ReportJobError('生成节点不存在。',404);const attempts=[];for(const item of unit.history){const detail=await files.attempt(id,nodeId,item.attempt);if(detail)attempts.push(detail);}return{node:summary(job).nodes.find(node=>node.id===nodeId),attempts,input:attempts.at(-1)?.input??null,output:attempts.at(-1)?.output??null};},
  pause(id){return serial(async()=>{const job=find(id);if(active.has(id)){const work=active.get(id);work.paused=true;work.scheduler?.wake();}if(job.status==='running'){job.status='paused';job.completedAt=null;job.stopReason='user_paused';await persist(job);}return summary(job);});},
  resume(id){return serial(async()=>{const job=find(id);if(closing)throw new ReportJobError('服务正在关闭。',503);if(active.has(job.id))throw new ReportJobError('请求仍在收尾，请稍后继续。',409);if(job.status!=='paused')return summary(await visibleJob(job));await snapshotOf(job);const config=savedConfig(job);adoptTranslationFailures(job,await visibleJob(job));job.status='running';delete job.stopReason;job.resumeCount++;await persist(job);launch(job,config);return summary(job);});},
  retry(id){return serial(async()=>{const job=find(id);if(closing)throw new ReportJobError('服务正在关闭。',503);if(active.has(job.id))throw new ReportJobError('已有生成请求正在执行。',409);await snapshotOf(job);const config=savedConfig(job);adoptTranslationFailures(job,await visibleJob(job));if(!job.units.some(unit=>unit.status==='failed'))return summary(job);for(const unit of job.units)if(unit.status==='failed'){unit.status='pending';delete unit.error;delete unit.errorCode;}job.status='running';delete job.stopReason;job.round++;await persist(job);launch(job,config);return summary(job);});},
  activityCount(){return activeDesktopJobCount({pendingOperations,activeIds:[...active.keys()],jobs:[...jobs.values()]});},
  isBusy(){return pendingOperations>0||active.size>0;},
  async waitForIdle(){await serialTail;while(active.size){await Promise.all([...active.values()].map(work=>work.promise));await serialTail;}},
  close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{await serialTail;for(const work of active.values())work.controller.abort();await Promise.all([...active.values()].map(work=>work.promise));await files.close();})();return closePromise;},
 };
}
