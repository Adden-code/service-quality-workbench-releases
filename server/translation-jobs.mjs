import {createJobScheduler,validJobConcurrency,serialOperations} from './bounded-job-scheduler.mjs';
import {validatePartialReportResult} from './report-enrichment.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createTranslationJobStore,translationStorageError} from './translation-job-store.mjs';
import {TranslationJobError,translationJobId,translationSource,freezeTranslationSource,translationHash} from './translation-source.mjs';
import {modelConfigSnapshot,modelConfigFingerprint} from './model-config.mjs';
import {prepareReportEnrichment,parseReportEnrichment,REPORT_ENRICHMENT_PROMPT_VERSION,REPORT_TRANSLATION_PROMPT_VERSION} from './report-enrichment.mjs';
import {plausibleEnglishTranslation} from '../public/translation-language.mjs';

export const CONTENT_TRANSLATION_PROMPT_VERSION=`content-translation-v2:${REPORT_ENRICHMENT_PROMPT_VERSION}:translation`;
// Persisted job/plan identity stays load-compatible; only reusable cache entries
// use the stricter translation contract. Text, segment and unit IDs are stable.
export const CONTENT_TRANSLATION_CACHE_VERSION=`content-translation-cache-v3:${REPORT_TRANSLATION_PROMPT_VERSION}`;
const copy=value=>structuredClone(value),now=()=>new Date().toISOString();
const retryable=new Set(['invalid_output','timeout','network','rate_limit','provider_unavailable','provider_error']);
const fatal=new Set(['authentication','permission','request_rejected','not_configured']);
const messages={invalid_output:'翻译结果的结构、语种或完整性校验失败。',timeout:'翻译模型调用超时。',network:'翻译模型连接失败。',rate_limit:'翻译模型服务限流。',provider_unavailable:'翻译模型暂不可用。',provider_error:'翻译模型生成失败。',authentication:'翻译模型鉴权失败，已停止后续调用。',permission:'翻译模型权限不足，已停止后续调用。',request_rejected:'翻译请求被模型服务拒绝，已停止后续调用。',not_configured:'尚未配置翻译模型，原文已保留。',interrupted:'翻译中断，已完成内容已保留。',output_truncated:'翻译输出被截断，未采用不完整内容。',input_too_large:'翻译输入超过模型预算，原文未截断。'};
function failure(error){const code=String(error?.code||'provider_error').toLowerCase();return{errorCode:Object.hasOwn(messages,code)?code:'provider_error',error:messages[code]||messages.provider_error};}
const storageError=error=>error?.code==='TRANSLATION_STORAGE'||String(error?.code||'').startsWith('trace_');
function splitText(text){
 const parts=[];let start=0;
 while(start<text.length){let end=Math.min(text.length,start+12000);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push(text.slice(start,end));start=end;}
 return parts;
}
function plan(snapshot,language,modelFingerprint){
 const texts=new Map(),segments=new Map(),units=[];
 for(const field of snapshot.fields){const id='t'+translationHash(field.text);if(texts.has(id))continue;const item={id,text:field.text,partIds:[]};splitText(field.text).forEach(text=>{const partId='p'+translationHash(text);item.partIds.push(partId);if(!segments.has(partId))segments.set(partId,{id:partId,text,key:translationHash({text,targetLang:language,model:modelFingerprint,prompt:CONTENT_TRANSLATION_CACHE_VERSION})});});texts.set(id,item);}
 let batch=[],chars=0;const flush=()=>{if(batch.length){units.push({id:'n'+(units.length+1),label:'翻译批次 '+(units.length+1),itemIds:batch,status:'pending',attempts:0,durationMs:0,history:[]});batch=[];chars=0;}};
 for(const item of segments.values()){if(batch.length&&(batch.length>=8||chars+item.text.length>12000))flush();batch.push(item.id);chars+=item.text.length;}flush();
 return{texts,segments,units};
}
function progress(job){const counts={total:job.units.length,done:0,failed:0,pending:0,running:0};for(const node of job.units){if(node.status==='completed')counts.done++;else if(Object.hasOwn(counts,node.status))counts[node.status]++;}return{...counts,percent:counts.total?Math.round((counts.done+counts.failed)/counts.total*100):100};}
function summary(job){return{id:job.id,status:job.status,source:copy(job.source),concurrency:job.concurrency??2,targetLang:job.targetLang,sourceFingerprint:job.sourceFingerprint,progress:progress(job),nodes:job.units.map(({id,label,status,attempts,error,errorCode,durationMs})=>({id,label,status,attempts,durationMs,...(error?{error,errorCode}:{})})),warningsCount:job.units.filter(node=>node.status==='failed').length,resultAvailable:true,createdAt:job.createdAt,updatedAt:job.updatedAt,...(job.stopReason?{stopReason:job.stopReason}:{}),traceRunIds:[...job.traceRunIds]};}
const hidden=new Set(['apikey','authorization','proxyauthorization','workspacetoken','bridgetoken','password','secret','credentials','reasoningcontent']);
function bounded(value,secret){
 const clean=item=>typeof item==='string'?(secret?item.split(secret).join('[hidden]'):item):Array.isArray(item)?item.map(clean):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).filter(([key])=>!hidden.has(key.toLowerCase().replace(/[\s_-]/g,''))).map(([key,child])=>[key,clean(child)])):item??null;
 const result=clean(value),text=JSON.stringify(result);return Buffer.byteLength(text)<=256*1024?result:{truncated:true,sha256:translationHash(text),bytes:Buffer.byteLength(text),reason:'完整来源与成功译文保留在翻译任务检查点中。'};
}
function invalidOutput(){throw Object.assign(new Error(messages.invalid_output),{code:'INVALID_OUTPUT'});}
function validateOutput(value,input){
 const prepared=prepareReportEnrichment('translation',input),output=parseReportEnrichment(JSON.stringify({items:value?.items}),prepared),originals=new Map(input.items.map(item=>[item.id,item.text]));
 for(const item of output.items){const raw=value.items.find(raw=>raw.id===item.id),original=originals.get(item.id);if(item.isTargetLanguage&&raw.translation!==original)invalidOutput();
  if(item.detectedLanguage==='und'&&(item.translation!==original||[...original].some(character=>/\p{L}/u.test(character)&&!/[\p{Script=Latin}]/u.test(character))))invalidOutput();
  if(!item.isTargetLanguage&&item.detectedLanguage!=='und'&&/\p{L}/u.test(original)){
   if(input.targetLang==='en'&&!plausibleEnglishTranslation(item.translation,original))invalidOutput();
   if(input.targetLang==='zh'&&!/\p{Script=Han}/u.test(item.translation))invalidOutput();
  }}return output;
}
async function abortable(operation,signal){if(signal.aborted)throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'});let cancel;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{cancel=()=>reject(Object.assign(new Error('interrupted'),{code:'INTERRUPTED'}));signal.addEventListener('abort',cancel,{once:true});})]);}finally{if(cancel)signal.removeEventListener('abort',cancel);}}

// New-job defaults never migrate the concurrency of an existing saved job.
export async function createTranslationJobs({dataDir,store,modelConfig,client,traceStore,reportJobs,collectReportFields,fsOps,maxAttempts=2,retryDelayMs=500,concurrency=4,onError=()=>{}}={}){
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3||!Number.isSafeInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>60000)throw new TypeError('Invalid translation retry budget.');
 if(!validJobConcurrency(concurrency))throw new TypeError('Translation concurrency must be an integer from 2 to 4.');
 const files=await createTranslationJobStore({dataDir,...(fsOps?{fsOps}:{})}),jobs=new Map(),snapshots=new Map(),outputs=new Map(),active=new Map();let closing=false,closePromise,serialTail=Promise.resolve(),pendingOperations=0;
 const serial=operation=>{pendingOperations++;const next=serialTail.then(operation).finally(()=>{pendingOperations--;});serialTail=next.catch(()=>{});return next;};
 const persist=async job=>{job.updatedAt=now();await files.save(job);};
 const find=id=>{const job=jobs.get(translationJobId(id));if(!job)throw new TranslationJobError('翻译任务不存在。',404);return job;};
 async function snapshotOf(job){if(!snapshots.has(job.id)){const value=await files.snapshot(job.id);if(translationHash(value)!==job.sourceFingerprint)throw translationStorageError();snapshots.set(job.id,value);}return snapshots.get(job.id);}
 function savedConfig(job){const current=modelConfig.getPrivate();if(modelConfigFingerprint(current)!==job.modelConfigFingerprint)throw new TranslationJobError('翻译任务的模型设置已变化，请恢复原设置后继续，或新建翻译任务。',409);return{...copy(job.modelConfig),configured:current.configured,apiKey:job.modelConfig.authMode==='none'?null:current.apiKey};}
 async function outputOf(job,unit){const key=job.id+'/'+unit.id;if(outputs.has(key))return outputs.get(key);const saved=await files.result(job.id,unit.id);if(!saved||saved.sha256!==unit.resultSha256)throw translationStorageError();outputs.set(key,saved.value);return saved.value;}
 const unitInput=(job,unit,prepared)=>({targetLang:job.targetLang,items:unit.itemIds.map(id=>({id,text:prepared.segments.get(id)?.text}))});
 function rejectSavedOutput(unit){unit.status='failed';unit.errorCode='invalid_output';unit.error='已保存译文未通过英文语种校验，请重试缺失项。';}
 async function visibleJob(saved){
  const job=copy(saved);if(job.targetLang!=='en')return job;const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.targetLang,job.modelConfigFingerprint);let invalid=false;
  for(const unit of job.units)if(unit.status==='completed'){
   const output=await outputOf(job,unit);
   try{validateOutput(output,unitInput(job,unit,prepared));}
   catch(error){if(error.code!=='INVALID_OUTPUT')throw error;rejectSavedOutput(unit);invalid=true;}
  }
  if(invalid&&job.status==='completed')job.status='completed_with_warnings';return job;
 }
 function adoptTranslationFailures(job,view){for(const unit of job.units){const checked=view.units.find(item=>item.id===unit.id);if(unit.status==='completed'&&checked?.status==='failed'){unit.rejectedResultSha256=unit.resultSha256;rejectSavedOutput(unit);}}}
 async function recover(job){
  const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.targetLang,job.modelConfigFingerprint);
  for(const unit of job.units){
   if(unit.status==='completed')continue;
   const key=job.id+'/'+unit.id;let saved=await files.result(job.id,unit.id);
   const input=unitInput(job,unit,prepared);
   if(saved&&saved.sha256===unit.rejectedResultSha256){const memory=outputs.get(key);if(memory&&translationHash(memory)===unit.rejectedResultSha256)outputs.delete(key);saved=null;}
   if(!saved&&outputs.has(key)){const value=outputs.get(key);try{validateOutput({items:value.items},value.partial?{...input,items:input.items.filter(i=>value.items.some(o=>o.id===i.id))}:input);}catch{throw translationStorageError();}saved={value,sha256:await files.saveResult(job.id,unit.id,value)};}
   if(saved?.value?.partial===true){const inputSubset={...input,items:input.items.filter(i=>saved.value.items?.some(o=>o.id===i.id))};validateOutput({items:saved.value.items},inputSubset);unit.partialResult=true;unit.resultSha256=saved.sha256;outputs.set(key,saved.value);for(const item of saved.value.items)await files.putCache(prepared.segments.get(item.id).key,{translation:item.translation,isTargetLanguage:item.isTargetLanguage,detectedLanguage:item.detectedLanguage});if(unit.status==='running')unit.status='pending';continue;}
   if(saved){
    try{validateOutput(saved.value,input);}catch(error){if(error.code!=='INVALID_OUTPUT')throw error;unit.rejectedResultSha256=saved.sha256;rejectSavedOutput(unit);outputs.delete(key);continue;}
    let detail=unit.attempts?await files.attempt(job.id,unit.id,unit.attempts):null;
    if(!detail){const info=unit.history.find(item=>item.attempt===unit.attempts&&item.status==='completed')||{attempt:unit.attempts,startedAt:unit.startedAt||now(),completedAt:now(),durationMs:0,status:'completed',recovered:true};detail={...info,input,output:saved.value};await files.saveAttempt(job.id,unit.id,unit.attempts,detail);}
    if(!unit.history.some(item=>item.attempt===detail.attempt)){const{input,output,...info}=detail;unit.history.push(info);}
    unit.status='completed';unit.resultSha256=saved.sha256;delete unit.error;delete unit.errorCode;outputs.set(key,saved.value);
   }else if(unit.status==='running')unit.status='pending';
  }
 }
 for(const job of await files.list()){
  if(!['running','paused','completed','completed_with_warnings'].includes(job.status)||(job.concurrency!==undefined&&!validJobConcurrency(job.concurrency))||!job.modelConfig||job.promptVersion!==CONTENT_TRANSLATION_PROMPT_VERSION||modelConfigFingerprint(job.modelConfig)!==job.modelConfigFingerprint||!Array.isArray(job.traceRunIds))throw translationStorageError();
  translationSource(job.source);const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.targetLang,job.modelConfigFingerprint);if(prepared.units.length!==job.units.length||job.units.some((unit,index)=>unit.id!==prepared.units[index].id||JSON.stringify(unit.itemIds)!==JSON.stringify(prepared.units[index].itemIds)||!['completed','pending','running','failed'].includes(unit.status)||!Array.isArray(unit.history)))throw translationStorageError();
  jobs.set(job.id,job);if(job.status==='running'||job.units.some(unit=>unit.status==='running')){job.status='paused';job.stopReason='interrupted';await recover(job);await persist(job);}
 }
 async function resultOf(job){
  job=await visibleJob(job);
  const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.targetLang,job.modelConfigFingerprint),values=new Map(),states=new Map(),warnings=[];
  for(const unit of job.units){for(const id of unit.itemIds)states.set(id,unit.status);if(unit.status==='completed'||unit.partialResult===true){const output=await outputOf(job,unit);for(const item of output.items){values.set(item.id,item);states.set(item.id,'completed');}}else for(const id of unit.itemIds)states.set(id,unit.status);if(unit.status==='failed')warnings.push({nodeId:unit.id,code:unit.errorCode,message:unit.error});}
  const translated=new Map();for(const item of prepared.texts.values()){const parts=item.partIds.map(id=>values.get(id)),failed=item.partIds.some(id=>states.get(id)==='failed');translated.set(item.text,{text:parts.every(Boolean)?parts.map(part=>part.isTargetLanguage?prepared.segments.get(part.id).text:part.translation).join(''):'',status:parts.every(Boolean)?parts.every(part=>part.isTargetLanguage)?'same':'translated':failed?'failed':'pending'});}
  return{job:summary(job),sourceFingerprint:job.sourceFingerprint,sourceSnapshot:copy(snapshot),translations:snapshot.fields.map(field=>({id:field.id,sourceText:field.text,...translated.get(field.text)})),warnings};
 }
 function launch(job,config){const work={job,config,paused:false,controller:new AbortController(),promise:null};active.set(job.id,work);work.promise=Promise.resolve().then(()=>execute(work));}
 function kick(){if(closing)return;for(const job of jobs.values()){if(job.status!=='running'||active.has(job.id))continue;let config;try{config=savedConfig(job);}catch(error){job.status='paused';job.stopReason='configuration_changed';serial(()=>persist(job)).catch(onError);continue;}launch(job,config);}}
 async function execute(work){
  const job=work.job,runIds=[],nodeRuns=new Map();let count=0;const register=serialOperations();
  const canDispatch=()=>!closing&&!work.paused&&!work.controller.signal.aborted&&!work.stopped&&!fatal.has(job.stopReason);
  const scheduler=work.scheduler=createJobScheduler({concurrency:job.concurrency??2,retryDelayMs,signal:work.controller.signal,canDispatch});
  async function step(id,label,input,operation){
   if(!traceStore)return operation();const runId=await register(async()=>{let runId=nodeRuns.get(id);
   if(!runId){if(!runIds.length||count>=64){runId=`${job.id}.translation.r${job.round}.s${job.resumeCount}.p${runIds.length+1}`;await traceStore.begin({id:runId,taskId:job.id,engine:client.engine||'native-node',kind:'content-translation',nodes:[{id,label}],meta:{source:copy(job.source),sourceFingerprint:job.sourceFingerprint,parentRunId:runIds[0]||runId,part:runIds.length+1}});runIds.push(runId);job.traceRunIds.push(runId);count=1;}else{runId=runIds.at(-1);await traceStore.appendNodes(runId,[{id,label}]);count++;}nodeRuns.set(id,runId);await persist(job);}return runId;});
   let result;await traceStore.step(runId,id,bounded(input,work.config.apiKey),async()=>{try{result=await operation();return bounded(result,work.config.apiKey);}catch(error){if(error.traceOutput!==undefined)error.traceOutput=bounded(error.traceOutput,work.config.apiKey);throw error;}});return result;
  }
  try{
   const snapshot=await snapshotOf(job),prepared=plan(snapshot,job.targetLang,job.modelConfigFingerprint);await recover(job);
   await scheduler.run(job.units.filter(unit=>!['completed','failed'].includes(unit.status)),async unit=>{
    if(!canDispatch())return;
    for(let roundAttempt=1;roundAttempt<=maxAttempts&&canDispatch();roundAttempt++){
     if(!await scheduler.ready())break;
     unit.status='running';unit.attempts++;unit.startedAt=now();delete unit.error;delete unit.errorCode;await persist(job);const started=Date.now(),input={targetLang:job.targetLang,items:unit.itemIds.map(id=>({id,text:prepared.segments.get(id).text}))};let output,error;
     try{output=await step(`${unit.id}-a${unit.attempts}`,unit.label,input,async()=>{
       const cached=new Map();for(const item of input.items){const value=await files.cache(prepared.segments.get(item.id).key);if(value){try{const validated=validateOutput({items:[{...value,id:item.id}]},{targetLang:job.targetLang,items:[item]});cached.set(item.id,validated.items[0]);}catch(error){if(error.code!=='INVALID_OUTPUT')throw error;}}}
       const pending=input.items.filter(item=>!cached.has(item.id));
       if(pending.length){if(!await scheduler.ready())throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'});if(work.config.configured===false||(work.config.authMode!=='none'&&!work.config.apiKey)||typeof client?.enrichBusinessReport!=='function')throw Object.assign(new Error('not configured'),{code:'NOT_CONFIGURED'});
        const request={targetLang:job.targetLang,items:pending},generated=await scheduler.request(()=>abortable(()=>client.enrichBusinessReport({config:work.config,kind:'translation',input:request,signal:work.controller.signal,trace:{step:(node,data,operation)=>step(`${unit.id}-a${unit.attempts}-${node}`,unit.label+' · '+node,data,operation)}}),work.controller.signal),unit.attempts),validated=validatePartialReportResult('translation',generated,request);
        for(const item of validated.items){try{const single=validateOutput({items:[item]},{...request,items:request.items.filter(i=>i.id===item.id)});cached.set(item.id,single.items[0]);}catch(error){if(error.code!=='INVALID_OUTPUT')throw error;}}
       }
       if(input.items.some(item=>!cached.has(item.id))){const partial={partial:true,items:input.items.filter(item=>cached.has(item.id)).map(item=>cached.get(item.id))};if(partial.items.length){outputs.set(job.id+'/'+unit.id,partial);unit.partialResult=true;unit.resultSha256=await files.saveResult(job.id,unit.id,partial);for(const item of partial.items)await files.putCache(prepared.segments.get(item.id).key,{translation:item.translation,isTargetLanguage:item.isTargetLanguage,detectedLanguage:item.detectedLanguage});}throw Object.assign(new Error('missing translation; valid items preserved'),{code:'INVALID_OUTPUT'});}
       output=validateOutput({items:input.items.map(item=>cached.get(item.id))},input);return output;
      });}catch(cause){if(storageError(cause)){if(output)outputs.set(job.id+'/'+unit.id,output);work.stopped=true;throw cause;}error=cause;const code=failure(cause).errorCode;if(fatal.has(code))job.stopReason=code;}
     const durationMs=Math.max(0,Date.now()-started),problem=error?failure(error):null,info={attempt:unit.attempts,startedAt:unit.startedAt,completedAt:now(),durationMs,status:error?'failed':'completed',...(problem||{})};unit.durationMs+=durationMs;unit.history.push(info);
     if(!error){delete unit.partialResult;
      // Persist the validated batch before secondary attempt/cache writes. Keep
      // it in memory too so a failed disk write can be resumed without a charge.
      outputs.set(job.id+'/'+unit.id,output);unit.resultSha256=await files.saveResult(job.id,unit.id,output);
      await files.saveAttempt(job.id,unit.id,unit.attempts,{...info,input:bounded(input,work.config.apiKey),output:bounded(output,work.config.apiKey)});
      unit.status='completed';await persist(job);
      for(const item of output.items){const{id,...value}=item;await files.putCache(prepared.segments.get(id).key,value);}
      break;
     }
     await files.saveAttempt(job.id,unit.id,unit.attempts,{...info,input:bounded(input,work.config.apiKey),output:bounded(error.traceOutput??null,work.config.apiKey)});
     const retry=canDispatch()&&retryable.has(problem.errorCode)&&roundAttempt<maxAttempts;unit.status=!canDispatch()||problem.errorCode==='interrupted'||retry?'pending':'failed';Object.assign(unit,problem);await persist(job);
     if(fatal.has(problem.errorCode)){job.stopReason=problem.errorCode;for(const node of job.units)if(node.status==='pending'){node.status='failed';Object.assign(node,problem);}await persist(job);break;}
     if(!retry)break;try{await delay(retryDelayMs*2**(roundAttempt-1),undefined,{signal:work.controller.signal});}catch{break;}
    }
   });
   if(fatal.has(job.stopReason)){const problem=failure({code:job.stopReason});for(const unit of job.units)if(unit.status==='pending'){unit.status='failed';Object.assign(unit,problem);}}
   if(closing||work.paused||work.controller.signal.aborted){job.status='paused';if(closing)job.stopReason='interrupted';}
   else job.status=job.units.some(unit=>unit.status!=='completed')?'completed_with_warnings':'completed';
   await persist(job);
  }catch(error){onError(error);job.status='paused';job.stopReason='storage_error';await recover(job).catch(onError);for(const unit of job.units)if(unit.status==='running')unit.status='pending';await persist(job).catch(onError);}
  finally{
   if(traceStore)for(const id of runIds)await traceStore.finish(id,{status:job.status==='paused'?'interrupted':job.status==='completed'?'completed':'partial',summary:{...progress(job),queueStatus:job.status}}).catch(onError);
   if(active.get(job.id)===work)active.delete(job.id);if(!closing)serial(()=>kick()).catch(onError);
  }
 }
 return{
  create(input){return serial(async()=>{
   if(closing)throw new TranslationJobError('服务正在关闭，无法创建翻译任务。',503);
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['jobId','source','targetLang','concurrency'].includes(key))||(input.concurrency!==undefined&&!validJobConcurrency(input.concurrency))||!['zh','en'].includes(input.targetLang))throw new TranslationJobError('翻译任务参数无效。');
   const id=translationJobId(input.jobId),source=translationSource(input.source),{snapshot,sourceFingerprint}=await freezeTranslationSource({source,store,reportJobs,collectReportFields});if(closing)throw new TranslationJobError('服务正在关闭，无法创建翻译任务。',503);
   const config=modelConfig.getPrivate(),model=modelConfigSnapshot(config),fingerprint=modelConfigFingerprint(model);
   if(jobs.has(id)){const old=find(id);if(old.sourceFingerprint!==sourceFingerprint||old.targetLang!==input.targetLang||old.modelConfigFingerprint!==fingerprint)throw new TranslationJobError('相同翻译任务标识对应不同来源、语种或模型设置，不能覆盖。',409);return summary(await visibleJob(old));}
   const createdAt=now(),job={schemaVersion:1,id,status:'running',source,concurrency:input.concurrency??concurrency,targetLang:input.targetLang,sourceFingerprint,createdAt,updatedAt:createdAt,modelConfig:model,modelConfigFingerprint:fingerprint,promptVersion:CONTENT_TRANSLATION_PROMPT_VERSION,units:plan(snapshot,input.targetLang,fingerprint).units,traceRunIds:[],round:1,resumeCount:0};
   await files.create(job,snapshot);jobs.set(id,job);snapshots.set(id,snapshot);if(closing){job.status='paused';job.stopReason='interrupted';await persist(job);}else kick();return summary(job);
  });},
  async list(source){if(source)source=translationSource(source);return Promise.all([...jobs.values()].filter(job=>!source||translationHash(job.source)===translationHash(source)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(async job=>summary(await visibleJob(job))));},
  async get(id){return summary(await visibleJob(find(id)));},
  async getResult(id){return resultOf(copy(find(id)));},
  async getNode(id,nodeId){const job=await visibleJob(find(id)),unit=job.units.find(item=>item.id===nodeId);if(!unit)throw new TranslationJobError('翻译节点不存在。',404);const attempts=[];for(const info of unit.history){const value=await files.attempt(job.id,unit.id,info.attempt);if(value)attempts.push(value);}return{node:summary(job).nodes.find(item=>item.id===nodeId),attempts,input:attempts.at(-1)?.input??null,output:attempts.at(-1)?.output??null,traceRunIds:[...job.traceRunIds]};},
  pause(id){return serial(async()=>{const job=find(id);if(active.has(job.id)){const work=active.get(job.id);work.paused=true;work.scheduler?.wake();}if(job.status==='running'){job.status='paused';job.stopReason='user_paused';await persist(job);}return summary(job);});},
  resume(id){return serial(async()=>{const job=find(id);if(closing)throw new TranslationJobError('服务正在关闭。',503);if(active.has(job.id))throw new TranslationJobError('翻译请求仍在收尾，请稍后继续。',409);if(job.status!=='paused')return summary(await visibleJob(job));await snapshotOf(job);savedConfig(job);adoptTranslationFailures(job,await visibleJob(job));await recover(job);job.status='running';delete job.stopReason;job.resumeCount++;await persist(job);kick();return summary(job);});},
  retry(id){return serial(async()=>{const job=find(id);if(closing)throw new TranslationJobError('服务正在关闭。',503);if(active.has(job.id))throw new TranslationJobError('翻译请求仍在执行。',409);await snapshotOf(job);savedConfig(job);adoptTranslationFailures(job,await visibleJob(job));await recover(job);if(!job.units.some(unit=>unit.status==='failed'))return summary(job);for(const unit of job.units)if(unit.status==='failed'){unit.status='pending';delete unit.error;delete unit.errorCode;}job.status='running';delete job.stopReason;job.round++;await persist(job);kick();return summary(job);});},
  isBusy(){return pendingOperations>0||active.size>0||[...jobs.values()].some(job=>job.status==='running');},
  async waitForIdle(){await serialTail;while(active.size||[...jobs.values()].some(job=>job.status==='running')){if(active.size)await Promise.all([...active.values()].map(work=>work.promise));else kick();await serialTail;}},
  close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{await serialTail;for(const work of active.values())work.controller.abort();await Promise.all([...active.values()].map(work=>work.promise));for(const job of jobs.values())if(job.status==='running'){job.status='paused';job.stopReason='interrupted';await persist(job);}await files.close();})();return closePromise;},
 };
}
