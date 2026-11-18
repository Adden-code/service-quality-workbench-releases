import {assertTaskWritable,isInactiveTask} from '../public/task-lifecycle.mjs';
import {isBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {WorkspaceError,canonical} from './workspace-validation.mjs';
import {mergeEcommerceResults} from './ecommerce-engine.mjs';
import {planEcommerceComparisons,mergeComparisonGroups} from './ecommerce-comparison.mjs';
import {comparisonRetryFeedback} from './ecommerce-comparison-wire.mjs';
import {validateEcommerceSource} from '../public/ecommerce-schema.mjs';
import {workflowInput,workflowDependencies} from './workflow-contract.mjs';
import {modelConfigSnapshot,modelConfigFingerprint} from './model-config.mjs';
import {applyAIDecisions,archiveFailedAIDecision} from '../public/ai-triage.mjs';
import {createTaskQueue,pendingTaskEntries as allPendingTaskEntries,taskQueueEntry,appendTaskEntry,syncTaskEntries,taskQueueRuntime as allTaskQueueRuntime} from './ai-task-scheduler.mjs';
import {computeEcommerceTimeFacts,isStageATimeBasis,TIME_EXECUTOR_VERSION,unrepliedSemanticResults} from '../public/ecommerce-time-results.mjs';
import {RAW_INPUT_MODE,isRawTranscriptSession,validateRawTranscript} from '../public/raw-transcript.mjs';
import {RAW_INSPECTION_PROMPT_VERSION,rawUnavailableResults,rawInspectionRetryFeedback} from './raw-inspection.mjs';
import {rawTimeRuleIds} from '../public/raw-evidence.mjs';

import {executeSceneCapabilities,enforceSceneResults,recordCapabilityOutcomes} from './scene-capabilities.mjs';
import {inspectionBasis} from '../public/scene-aggregate.mjs';

const copy=value=>structuredClone(value),now=()=>new Date().toISOString();
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const human=s=>s.review.status!=='待审核'||Object.keys(s.review.drafts).length>0||Boolean(s.review.notes?.trim())||Boolean(s.review.history?.length);
const failedRawFallback=s=>isRawTranscriptSession(s)&&s.aiExecution?.status==='failed'&&s.aiResults.length>0&&s.aiResults.every(result=>result.verdict==='无法判定'&&(result.rawValidation?.status==='program-fallback'||s.rawTranscript.timePolicy.mode==='unavailable'&&result.rawValidation?.status==='verified'&&result.rawValidation.reasonCodes?.includes('source_time_unavailable')&&result.confidence===0&&result.evidenceQuotes?.length===0));
const comparisonPending=s=>s.aiResults?.some(r=>r.comparisonAssessment?.status==='incomplete');
const eligible=s=>!human(s)&&((!s.aiResults.length||failedRawFallback(s))&&s.aiExecution?.status!=='completed'||comparisonPending(s));
const messages={capability_executor_missing:'辅助能力执行器缺失，已立即暂停。',capability_failure_rate:'辅助能力最终技术失败率超过配置上限，已暂停。',request_rejected:'模型服务拒绝当前请求，队列已停止派发；请核对模型设置与输入配置后继续。',rate_limit:'模型额度或请求频率受限，请稍后重试。',authentication:'模型密钥鉴权失败，请检查模型设置。',permission:'模型权限不足，请检查模型设置。',timeout:'模型响应超时，可继续其他行或重试本行。',invalid_output:'模型结果不完整或依据无效，本行未保存质检结论。',output_truncated:'模型输出长度不足，本行未保存AI结论。',input_too_large:'本行或依据超出模型输入上限，未截断原文。',network:'无法连接模型服务，请检查网络后重试。',provider_unavailable:'模型服务暂时不可用，请稍后重试。',interrupted:'服务已停止，可继续未完成的队列。',dependency_incomplete:'本行语义结果已缓存，等待完整业务批次相似比较完成。'};
function safeFailure(error,interrupted=false){const normalized=String(error?.code||'').toLowerCase(),errorCode=interrupted?'interrupted':Object.hasOwn(messages,normalized)?normalized:'provider_error';return{errorCode,error:messages[errorCode]||'模型执行失败，本行未形成质检结论。'};}
const stopsQueue=code=>['authentication','permission','request_rejected','capability_executor_missing'].includes(code);
const retryable=code=>['rate_limit','timeout','network','provider_unavailable','provider_error','invalid_output'].includes(code);
function requestConfig(current,snapshot=modelConfigSnapshot(current)){
 if(!current||current.configured===false||(snapshot.authMode==='bearer'&&!current.apiKey))throw new WorkspaceError('请先在模型设置中完成连接配置；Bearer认证需要保存密钥。');
 if(current.connectionTested!==true)throw new WorkspaceError('请先在模型设置中成功测试当前连接，再开始或继续AI质检。',409);
 return{...snapshot,apiKey:snapshot.authMode==='none'?null:current.apiKey};
}
function resumeConfig(current,run){
 // A pre-snapshot run was created under the fixed Ark contract. Never borrow a
 // newly configured gateway's key or options when recovering such a run.
 const frozen=run.modelConfig??modelConfigSnapshot({model:run.modelId}),selected=modelConfigSnapshot(current);
 if(modelConfigFingerprint(selected)!==modelConfigFingerprint(frozen))throw new WorkspaceError('当前模型设置与本次运行冻结配置不同。请恢复本次运行的模型设置并成功测试连接后继续，或使用当前设置开启新运行。',409);
 return requestConfig(current,frozen);
}
export function queueSettings(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['concurrency','batchSize','maxWorkBytes'].includes(k)))throw new WorkspaceError('AI调度设置字段无效。');
 const settings={concurrency:1,batchSize:20,maxWorkBytes:64000,...value};
 for(const [key,min,max] of [['concurrency',1,4],['batchSize',1,100],['maxWorkBytes',4096,250000]])if(!Number.isSafeInteger(settings[key])||settings[key]<min||settings[key]>max)throw new WorkspaceError('AI调度设置超出允许范围。');
 return settings;
}
function taskQueueSettings(task,patch){
 const inherited=task.aiQueue?.settings??task.executionSettings??{};
 // Validate patches before merging so null, arrays and unknown keys cannot hide
 // behind defaults. An omitted field inherits the user's frozen task choice.
 if(patch!==undefined)queueSettings(patch);
 return queueSettings({...(task.inputMode===RAW_INPUT_MODE?{concurrency:4}:{}),...inherited,...(patch??{})});
}
function refresh(task,state){
 const q=task.aiQueue;q.updatedAt=now();
 for(const batch of q.batches){const rows=q.rows.filter(r=>r.batchId===batch.id);batch.status=rows.some(r=>r.status==='running')?'running':rows.every(r=>['completed','protected'].includes(r.status))?'completed':rows.some(r=>r.status==='failed')?'partial':'pending';}
 const current=q.rows.filter(r=>r.runId===task.aiRun.id);
 task.aiRun.done=current.filter(r=>state.sessions.find(s=>s.id===r.sessionId)?.aiExecution?.status==='completed').length;
 task.aiRun.failed=current.filter(r=>r.status==='failed').length;
}
function createQueue(sessions,basis,settings,previous,runId,ecommerce,modelFingerprint,inspectionAt,rawImportOptions,executionSnapshot){
 const raw=sessions.every(isRawTranscriptSession),localOptions={basis,inspectionAt,...(raw?{rawImportOptions,promptVersion:RAW_INSPECTION_PROMPT_VERSION,modelConfigFingerprint:modelFingerprint}:{})},stageA=isStageATimeBasis(basis)||isBusinessEcommerceBasis(basis);
 const fingerprint=digest({version:raw?4:stageA?3:2,...(executionSnapshot?{executionSnapshot}:{}),basis,settings,modelConfigFingerprint:modelFingerprint,sessions:sessions.map(s=>workflowDependencies(s,localOptions)),...(raw?{promptVersion:RAW_INSPECTION_PROMPT_VERSION,inspectionAt}:stageA?{executorVersion:TIME_EXECUTOR_VERSION,inspectionAt}:{})}),reuse=previous?.fingerprint===fingerprint&&previous?.modelConfigFingerprint===modelFingerprint;
 const prior=new Map((reuse?previous.rows:[]).map(r=>[r.sessionId,r]));
 const batches=[];let batch;
 const rows=sessions.map(s=>{
  const bytes=Buffer.byteLength(JSON.stringify(workflowInput(s)));
  if(!batch||batch.sessionIds.length>=settings.batchSize||batch.workBytes+bytes>settings.maxWorkBytes){batch={id:`segment-${batches.length+1}`,index:batches.length+1,sessionIds:[],status:'pending',workBytes:0};batches.push(batch);}
  batch.sessionIds.push(s.id);batch.workBytes+=bytes;
  const old=prior.get(s.id),protectedRow=!eligible(s);
  return{...(old||{}),sessionId:s.id,sourceRow:s.rawTranscript?.row??s.ecommerce?.row??null,batchId:batch.id,status:protectedRow?(s.aiExecution?.status==='completed'?'completed':'protected'):old?.semanticResult?'completed':'pending',attempts:old?.attempts||0,startedAt:old?.startedAt??null,completedAt:old?.completedAt??null,durationMs:old?.durationMs||0,...(!protectedRow?{runId}:{}),inputSha256:digest(workflowDependencies(s,localOptions))};
 });
 let comparison=null;
 if(ecommerce){const plan=planEcommerceComparisons(sessions,{maxRecords:Math.max(2,Math.min(settings.batchSize,20)),maxWorkBytes:settings.maxWorkBytes,basis});const old=reuse&&previous.comparison?.fingerprint===plan.fingerprint?previous.comparison:null;comparison={...plan,status:plan.blocks.length?'pending':'completed',groups:plan.exactGroups,blocks:plan.blocks.map(b=>({...b,status:'pending',attempts:0,...(old?.blocks.find(p=>p.id===b.id)||{})}))};if(comparison.blocks.every(b=>b.status==='completed')){const merged=mergeComparisonGroups(comparison,comparison.blocks);if(merged.complete){comparison.groups=merged.groups;comparison.status='completed';}}}
 return{version:1,fingerprint,modelConfigFingerprint:modelFingerprint,status:'running',phase:'rows',settings,batches,rows,comparison,updatedAt:now(),resumeCount:0};
}

function publishEcommerceCheckpoints(state,task){
 const q=task.aiQueue;if(!q?.comparison)return;
 const comparison=mergeComparisonGroups(q.comparison,q.comparison.blocks),sessions=state.sessions.filter(s=>s.taskId===task.id);
 q.comparison.groups=comparison.groups;
 const merged=mergeEcommerceResults({sessions,semanticResults:q.rows.filter(r=>r.semanticResult).map(r=>({sessionId:r.sessionId,results:r.semanticResult.results})),duplicateGroups:comparison.groups,deterministic:{duplicateGroups:[]},allowPartial:true,basis:task.basisSnapshot,inspectionAt:task.aiRun.inspectionAt,runtime:task.executionSnapshot?.runtime,pendingComparisons:comparison.pendingBySession});
 for(const row of q.rows){const s=state.sessions.find(s=>s.id===row.sessionId),results=merged.get(row.sessionId);if(!results||human(s))continue;
  if(s.aiExecution?.status==='completed'&&canonical(s.aiResults)===canonical(results))continue;
  archiveFailedAIDecision(s);s.aiResults=copy(results);const result=row.semanticResult;
  s.aiExecution={status:'completed',runId:row.semanticRunId||row.runId||task.aiRun.id,modelId:result.modelId||task.aiRun.modelId,requestedModel:row.semanticRequestedModel||task.aiRun.modelId,startedAt:row.startedAt,completedAt:now(),inputSha256:row.inputSha256,basisSha256:digest(task.basisSnapshot),promptVersion:result.promptVersion==='ec-local-unreplied-v1'?result.promptVersion:isBusinessEcommerceBasis(task.basisSnapshot)?'ec-business-v1':isStageATimeBasis(task.basisSnapshot)?'ec-stage-a-time-v1-content-v1':'ec-row-hybrid-v2',...(result.requestId?{requestId:result.requestId}:{}),...(result.usage?{usage:copy(result.usage)}:{})};row.resultStatus='completed';
 }
 refresh(task,state);
}

export async function createAiService(options={}){
 const {store,modelConfig,client,traceStore,maxAttempts=2,comparisonMaxAttempts=options.maxAttempts??3,retryDelayMs=500,onError=()=>{}}=options;
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw new TypeError('Invalid maximum attempts.');
 if(!Number.isSafeInteger(comparisonMaxAttempts)||comparisonMaxAttempts<1||comparisonMaxAttempts>3)throw new TypeError('Invalid comparison maximum attempts.');
 let closing=false,startQueue=Promise.resolve(),writeError='',cachedState=null,pendingOperations=0;const active=new Map();
 const serialized=operation=>{pendingOperations++;const next=startQueue.then(operation).finally(()=>{pendingOperations--;});startQueue=next.catch(()=>{});return next;};
 const read=async()=>{const doc=await store.read();cachedState=doc.state;return doc;};
 const eligibleEntry=e=>!isInactiveTask(cachedState?.tasks.find(t=>t.id===e.taskId));
 const pendingTaskEntries=q=>allPendingTaskEntries(q).filter(eligibleEntry);
 const taskQueueRuntime=q=>allTaskQueueRuntime(q?{...q,entries:q.entries.filter(eligibleEntry)}:q);
 const writable=(state,task)=>{try{assertTaskWritable(state,task);}catch(error){throw new WorkspaceError(error.message,409);}};
 async function updateState(change){const saved=await store.updateAI(({state,catalog})=>{change(state);syncTaskEntries(state);return{state,catalog};});cachedState=saved.state;return saved;}
 async function update(taskId,change){return updateState(state=>{const task=state.tasks.find(t=>t.id===taskId);if(!task)throw new WorkspaceError('质检任务不存在。',404);change(state,task);});}
 const doc=await read();
 if(doc.initialized&&doc.state.tasks.some(t=>!isInactiveTask(t)&&t.aiQueue?.comparison&&doc.state.sessions.some(s=>s.taskId===t.id&&s.aiExecution?.errorCode==='dependency_incomplete')))await updateState(state=>{for(const t of state.tasks){if(isInactiveTask(t)||!t.aiQueue?.comparison)continue;publishEcommerceCheckpoints(state,t);if(['failed','partial'].includes(t.aiStatus)&&state.sessions.some(s=>s.taskId===t.id&&s.aiExecution?.status==='completed')){t.aiStatus='partial';t.aiQueue.status='partial';t.aiRun.status='partial';}applyAIDecisions(state,t);refresh(t,state);}});
 if(doc.initialized&&(pendingTaskEntries(doc.state.aiTaskQueue).length||doc.state.tasks.some(t=>t.mode==='manual'&&!isInactiveTask(t)&&t.aiStatus==='running')))await updateState(state=>{
  const scheduler=state.aiTaskQueue??=createTaskQueue();scheduler.status='paused';scheduler.pauseReason='interrupted';
  for(const task of state.tasks.filter(t=>t.mode==='manual'&&!isInactiveTask(t)&&t.aiStatus==='running')){
   if(task.aiQueue){task.aiQueue.status='paused';task.aiQueue.stopReason='interrupted';for(const r of task.aiQueue.rows)if(r.status==='running')r.status='pending';for(const b of task.aiQueue.comparison?.blocks||[])if(b.status==='running')b.status='pending';task.aiStatus='paused';task.aiRun.status='paused';task.aiRun.completedAt=null;refresh(task,state);if(!taskQueueEntry(scheduler,task.id,task.aiRun.id))appendTaskEntry(scheduler,task,task.aiRun.startedAt);}
   else{const cases=state.sessions.filter(s=>s.taskId===task.id);task.aiStatus=cases.some(s=>s.aiExecution?.status==='completed')?'partial':'failed';task.aiRun={...task.aiRun,status:task.aiStatus,completedAt:now()};}
   for(const s of state.sessions.filter(s=>s.taskId===task.id&&s.aiExecution?.status==='running'))s.aiExecution={...s.aiExecution,status:'failed',completedAt:now(),...safeFailure(null,true)};
  }
  for(const entry of pendingTaskEntries(scheduler))entry.blockedReason='interrupted';
 });
 function resetForResume(task,state){writable(state,task);
  const q=task.aiQueue;q.status='queued';delete q.stopReason;q.resumeCount=(q.resumeCount||0)+1;
  for(const row of q.rows)if(['failed','running','blocked'].includes(row.status)&&!row.semanticResult)row.status='pending';
  task.aiStatus='queued';task.aiRun.status='queued';task.aiRun.completedAt=null;refresh(task,state);
 }
 function configurationFailure(task){
  const current=modelConfig.getPrivate(),frozen=task.aiRun.modelConfig??modelConfigSnapshot({model:task.aiRun.modelId});
  if(modelConfigFingerprint(current)!==modelConfigFingerprint(frozen))return'config_changed';
  return current.configured===false||current.connectionTested!==true||(frozen.authMode==='bearer'&&!current.apiKey)?'connection_required':null;
 }
 async function dispatchNext(){
  if(closing||writeError||active.size)return;
  try{
  const doc=await read(),scheduler=doc.state?.aiTaskQueue;if(!scheduler||scheduler.status!=='ready')return;
  const head=pendingTaskEntries(scheduler)[0];if(!head)return;
  const task=doc.state.tasks.find(task=>task.id===head.taskId);
  const blockedReason=configurationFailure(task);
  if(blockedReason){await updateState(state=>{const queue=state.aiTaskQueue;queue.status='paused';queue.pauseReason=blockedReason;taskQueueEntry(queue,head.taskId,head.runId).blockedReason=blockedReason;});return;}
  await update(head.taskId,(state,t)=>{t.aiQueue.status='running';t.aiStatus='running';t.aiRun.status='running';t.aiRun.completedAt=null;taskQueueEntry(state.aiTaskQueue,head.taskId,head.runId).blockedReason=null;refresh(t,state);});
  // Read credentials only at dispatch. A queued item never owns a saved key.
  let config;try{writable(doc.state,task);config=resumeConfig(modelConfig.getPrivate(),task.aiRun);}catch(error){
   const reason=configurationFailure(task)||'connection_required';await update(head.taskId,(state,t)=>{t.aiQueue.status='queued';t.aiStatus='queued';t.aiRun.status='queued';const queue=state.aiTaskQueue;queue.status='paused';queue.pauseReason=reason;taskQueueEntry(queue,head.taskId,head.runId).blockedReason=reason;refresh(t,state);});return;
  }
  launch(head.taskId,head.runId,config,task.aiQueue.resumeCount?`${head.runId}.resume-${task.aiQueue.resumeCount}`:head.runId);
  }catch(error){
   onError(error);writeError='AI任务队列未能完整保存，请检查本机存储后重新启动工具；原有记录保留。';
   try{await updateState(state=>{const queue=state.aiTaskQueue;if(!queue)return;queue.status='paused';queue.pauseReason='storage_error';const head=pendingTaskEntries(queue)[0];if(head)head.blockedReason='storage_error';});}catch{}
  }
 }
 async function execute(job){
  let traceStarted=false;const traceParts=[];const {taskId}=job;
  try{
   let doc=await store.read(),task=doc.state.tasks.find(t=>t.id===taskId),q=task.aiQueue;const sessions=doc.state.sessions.filter(s=>s.taskId===taskId),ecommerce=sessions.some(s=>s.ecommerce),raw=task.inputMode===RAW_INPUT_MODE;
   const nodes=[{id:'source',label:'输入与完整业务批次核对'},{id:'basis',label:'冻结规则与资料版本'}];
   for(const [index,row] of q.rows.entries())if(row.runId===job.id&&!row.semanticResult&&row.status!=='protected')for(let attempt=1;attempt<=maxAttempts;attempt++)for(const node of ['model','validation','persist'])nodes.push({id:`r${index}-a${attempt}-${node}`,label:`${row.batchId} · 原表行${row.sourceRow??index+1} · ${node} · 尝试${attempt}`});
   for(const [index,b] of (q.comparison?.blocks||[]).entries())if(b.status!=='completed')for(let attempt=1;attempt<=comparisonMaxAttempts;attempt++)for(const node of ['model','validation','persist'])nodes.push({id:`c${index}-a${attempt}-${node}`,label:`全批次相似块${index+1} · ${node} · 尝试${attempt}`});
   nodes.push({id:'merge',label:'逐行合并程序结果与全批次证据'});
   const dynamicTrace=typeof traceStore?.appendNodes==='function',definitions=new Map(nodes.map(n=>[n.id,n])),nodeRuns=new Map();let traceAllocation=Promise.resolve(),partNodeCount=1;
   const traceMeta={queue:true,runId:job.id,parentRunId:job.traceId,targetSessionIds:q.rows.filter(r=>r.runId===job.id).map(r=>r.sessionId),comparisonCount:sessions.length,settings:q.settings,modelConfig:modelConfigSnapshot(job.config),modelConfigFingerprint:modelConfigFingerprint(job.config),...(raw?{inputMode:RAW_INPUT_MODE,promptVersion:RAW_INSPECTION_PROMPT_VERSION,inspectionAt:task.aiRun.inspectionAt,outputLanguage:task.rawImportOptions.outputLanguage}:isStageATimeBasis(task.basisSnapshot)?{executorVersion:TIME_EXECUTOR_VERSION,inspectionAt:task.aiRun.inspectionAt,ruleSet:copy(task.basisSnapshot.ruleSetSnapshot)}:{})};
   const beginPart=(id,part,definitions)=>traceStore.begin({id,taskId,engine:client.engine||'native-node',kind:raw?'raw-transcript-rows':ecommerce?'ecommerce-rows':'conversation-rows',nodes:definitions,meta:{...traceMeta,part}});
   if(traceStore){await beginPart(job.traceId,1,dynamicTrace?[nodes[0]]:nodes.slice(0,4096));traceParts.push(job.traceId);nodeRuns.set('source',job.traceId);traceStarted=true;}
   const redact=value=>typeof value==='string'?(job.config.apiKey?value.split(job.config.apiKey).join('[已隐藏密钥]'):value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['apikey','authorization','proxyauthorization'].includes(k.toLowerCase().replace(/[\s_-]/g,''))).map(([k,v])=>[k,redact(v)])):value??null;
   const bounded=(value,hints)=>{const safe=redact(value),json=JSON.stringify(safe),bytes=Buffer.byteLength(json);return bytes<=65536?JSON.parse(json):{truncated:true,bytes,limitBytes:65536,sha256:digest(safe),source:{sessionId:hints?.sessionId??null,sourceRow:hints?.sourceRow??null,segmentId:hints?.segmentId??null,blockId:hints?.blockId??null},reason:'快照超过64KiB；完整原文保留在原文件与行检查点，未截断模型输入。'};};
   const ensureNode=id=>{const allocation=traceAllocation.then(async()=>{if(nodeRuns.has(id))return nodeRuns.get(id);if(!dynamicTrace)return job.traceId;let runId=traceParts.at(-1);const definition=definitions.get(id)||{id,label:id};if(partNodeCount>=64){runId=`${job.traceId}.part-${traceParts.length+1}`;await beginPart(runId,traceParts.length+1,[definition]);traceParts.push(runId);partNodeCount=1;}else{await traceStore.appendNodes(runId,[definition]);partNodeCount++;}nodeRuns.set(id,runId);return runId;});traceAllocation=allocation.catch(()=>{});return allocation;};
   const step=async(id,input,operation)=>{if(!traceStore)return operation();const runId=await ensureNode(id);let output;await traceStore.step(runId,id,bounded(input,input),async()=>{try{output=await operation();return bounded(output,input);}catch(error){if(error?.traceOutput!==undefined)error.traceOutput=bounded(error.traceOutput,input);throw error;}});return output;};
   await step('source',{recordCount:sessions.length,sourceRows:sessions.map(s=>({sessionId:s.id,row:s.rawTranscript?.row??s.ecommerce?.row??null}))},()=>{if(ecommerce)for(const s of sessions)validateEcommerceSource(s);if(raw)for(const s of sessions)validateRawTranscript(s.rawTranscript);return{valid:true};});
   await step('basis',{basis:task.basisSnapshot},()=>({basisSha256:digest(task.basisSnapshot)}));
   const canDispatch=()=>!closing&&!job.paused&&!job.stopped;
   // Resume repairs auxiliary checkpoints before admitting new rows. Existing
   // rule/human judgments are immutable here: an old dependent unknown still
   // needs human review or a separate reinspection, never an automatic promotion.
   if(q.resumeCount&&task.executionSnapshot?.configuration.executionMode==='configured'){
    for(const [index,previousRow] of q.rows.entries()){
     if(!canDispatch())break;
     const prior=previousRow.sceneCapabilities;
     if(!prior||!Object.values(prior.outputs||{}).some(v=>v.status==='failed'))continue;
     const latest=await store.read(),current=latest.state.tasks.find(t=>t.id===taskId),session=latest.state.sessions.find(s=>s.id===previousRow.sessionId);
     if(human(session))continue;
     const source=isBusinessEcommerceBasis(current.basisSnapshot)?session:workflowInput(session);delete source.source;
     const trace={step:(node,input,op)=>step(`r${index}-recovery-${node}`,{sessionId:session.id,...input},op)};
     let repaired;
     try{
      repaired=await executeSceneCapabilities({session:source,snapshot:current.executionSnapshot,client,config:job.config,signal:job.controller.signal,trace,previous:prior,retryDelayMs});
      repaired=await executeSceneCapabilities({session:source,snapshot:current.executionSnapshot,client,config:job.config,signal:job.controller.signal,trace,previous:repaired,phase:'post',retryDelayMs});
     }catch(error){if(String(error?.code||'').toLowerCase().startsWith('trace_'))throw error;const failure=safeFailure(error,closing||job.controller.signal.aborted);job.paused=true;await update(taskId,(state,t)=>{t.aiQueue.stopReason=failure.errorCode;});break;}
     await step(`r${index}-recovery-persist`,{sessionId:session.id,outputs:repaired.outputs},async()=>{
      await update(taskId,(state,t)=>{const r=t.aiQueue.rows[index],s=state.sessions.find(s=>s.id===r.sessionId);if(human(s))return;
       const audit={at:now(),runId:job.id,before:Object.fromEntries(Object.entries(prior.outputs).map(([k,v])=>[k,v.status])),after:Object.fromEntries(Object.entries(repaired.outputs).map(([k,v])=>[k,v.status])),ruleResultsPreserved:true};
       r.capabilityRecovery=[...(r.capabilityRecovery||[]),audit];r.sceneCapabilities=copy(repaired);s.sceneCapabilities=copy(repaired);
       t.capabilityMonitor=recordCapabilityOutcomes(t.capabilityMonitor,s.id,repaired,t.executionSnapshot.configuration.failurePolicy);
       // Old failures remain in the window until repaired. Stop immediately if
       // a fresh exhausted failure confirms the breaker is still justified.
       if(Object.values(repaired.outputs).some(v=>v.status==='failed')&&Object.values(t.capabilityMonitor).some(m=>m.paused)){job.paused=true;t.aiQueue.stopReason='capability_failure_rate';}
      });return {saved:true,ruleResultsPreserved:true};
     });
    }
   }
   async function inspectRow(index){
    let initial=await store.read(),current=initial.state.tasks.find(t=>t.id===taskId),row=current.aiQueue.rows[index],session=initial.state.sessions.find(s=>s.id===row.sessionId);
    if(!canDispatch()||row.status==='protected'||session.aiExecution?.status==='completed'||human(session)||row.semanticResult)return;
    let rawRetryFeedback;
    for(let attempt=1;attempt<=maxAttempts&&canDispatch();attempt++){
     const startedAt=now();await update(taskId,(state,t)=>{const r=t.aiQueue.rows[index],s=state.sessions.find(s=>s.id===r.sessionId);if(human(s)){r.status='protected';return;}r.status='running';r.attempts++;r.startedAt=startedAt;r.completedAt=null;delete r.error;delete r.errorCode;archiveFailedAIDecision(s);if(raw)s.aiResults=[];s.aiExecution={status:'running',runId:job.id,modelId:job.config.model,requestedModel:job.config.model,startedAt,completedAt:null,inputSha256:r.inputSha256,basisSha256:digest(t.basisSnapshot)};refresh(t,state);});
     initial=await store.read();current=initial.state.tasks.find(t=>t.id===taskId);row=current.aiQueue.rows[index];session=initial.state.sessions.find(s=>s.id===row.sessionId);if(row.status==='protected')return;
     const checkBasis=inspectionBasis(current.basisSnapshot,current.executionSnapshot);
     const projected=workflowInput(session);delete projected.source;
     const scoped={step:(node,input,operation)=>step(`r${index}-a${attempt}-${node}`,{segmentId:row.batchId,sourceRow:row.sourceRow,attempt:row.attempts,...input},operation)};
     let result,failure,sceneCapabilities,localUnreplied=false,localRawOnly=false;try{
      sceneCapabilities=await executeSceneCapabilities({session:isBusinessEcommerceBasis(current.basisSnapshot)?session:projected,snapshot:current.executionSnapshot,client,config:job.config,signal:job.controller.signal,trace:scoped,previous:row.sceneCapabilities});
      scoped.sceneSnapshot=current.executionSnapshot;scoped.sceneCapabilities=sceneCapabilities;
      localUnreplied=ecommerce&&(isStageATimeBasis(current.basisSnapshot)||isBusinessEcommerceBasis(current.basisSnapshot))&&computeEcommerceTimeFacts(session,current.basisSnapshot,{inspectionAt:current.aiRun.inspectionAt,runtime:current.executionSnapshot?.runtime}).replyStatus==='unreplied';
      localRawOnly=raw&&session.rawTranscript.timePolicy.mode==='unavailable'&&rawTimeRuleIds(checkBasis).length===checkBasis.rules.length;
      result=raw?await client.inspectRaw({config:job.config,session:copy(projected),basis:copy(checkBasis),inspectionAt:current.aiRun.inspectionAt,outputLanguage:current.rawImportOptions.outputLanguage,allowDegraded:attempt===maxAttempts,...(rawRetryFeedback?{retryFeedback:rawRetryFeedback}:{}),signal:job.controller.signal,trace:scoped,sceneSnapshot:current.executionSnapshot,sceneCapabilities}):localUnreplied?{results:unrepliedSemanticResults(),modelId:'local-unreplied',promptVersion:'ec-local-unreplied-v1'}:ecommerce?await client.inspectEcommerceRow({config:job.config,session:copy(projected),basis:{...copy(current.basisSnapshot),rules:copy(current.basisSnapshot.rules.filter(r=>r.id!=='EC-TIME'))},signal:job.controller.signal,trace:scoped,sceneSnapshot:current.executionSnapshot,sceneCapabilities}):await client.inspect({config:job.config,session:copy(projected),basis:copy(checkBasis),signal:job.controller.signal,trace:scoped,sceneSnapshot:current.executionSnapshot,sceneCapabilities});
      if(sceneCapabilities){result.results=enforceSceneResults(result.results,current.executionSnapshot,sceneCapabilities,session);sceneCapabilities=await executeSceneCapabilities({session:isBusinessEcommerceBasis(current.basisSnapshot)?session:projected,snapshot:current.executionSnapshot,client,config:job.config,signal:job.controller.signal,trace:scoped,previous:sceneCapabilities,phase:'post'});}
     }catch(error){if(String(error?.code||'').toLowerCase().startsWith('trace_'))throw error;failure=safeFailure(error,closing||job.controller.signal.aborted);if(raw)rawRetryFeedback=rawInspectionRetryFeedback(error.diagnostic??error.traceOutput?.diagnostic,checkBasis);if(stopsQueue(failure.errorCode)){job.stopped=true;if(current.executionSnapshot?.configuration.executionMode==='configured')job.paused=true;}}
     const completedAt=now();
     const willRetry=failure&&retryable(failure.errorCode)&&attempt<maxAttempts&&canDispatch();
     await step(`r${index}-a${attempt}-persist`,{sessionId:session.id,sourceRow:row.sourceRow,segmentId:row.batchId,attempt:row.attempts,result:result??null,failure:failure??null},async()=>{await update(taskId,(state,t)=>{
      const r=t.aiQueue.rows[index],s=state.sessions.find(s=>s.id===r.sessionId);if(sceneCapabilities){r.sceneCapabilities=copy(sceneCapabilities);s.sceneCapabilities=copy(sceneCapabilities);t.capabilityMonitor=recordCapabilityOutcomes(t.capabilityMonitor,s.id,sceneCapabilities,t.executionSnapshot.configuration.failurePolicy);if(Object.values(t.capabilityMonitor).some(m=>m.paused)){job.paused=true;t.aiQueue.stopReason="capability_failure_rate";}}
      r.completedAt=completedAt;r.durationMs+=Date.parse(completedAt)-Date.parse(startedAt);
      if(raw)r.rawAttempts=localRawOnly?(r.rawAttempts||[]):[...(r.rawAttempts||[]),{attempt:r.attempts,at:completedAt,status:failure?'failed':'completed',...(failure?{errorCode:failure.errorCode,diagnostic:copy(rawRetryFeedback)}:{results:result.results.map(item=>({ruleId:item.ruleId,status:item.rawValidation.status,reasonCodes:copy(item.rawValidation.reasonCodes)}))})}];
      if(failure){
       r.status=closing?'pending':'failed';Object.assign(r,failure);s.aiExecution={...s.aiExecution,status:'failed',completedAt,...failure};
       if(raw){delete r.semanticResult;delete r.semanticRunId;delete r.semanticRequestedModel;if(!willRetry&&!closing&&!job.paused)s.aiResults=rawUnavailableResults(s,inspectionBasis(t.basisSnapshot,t.executionSnapshot),{outputLanguage:t.rawImportOptions.outputLanguage,errorCode:failure.errorCode,message:t.rawImportOptions.outputLanguage==='en'?'The model execution failed. Program-generated unable-to-determine placeholders require human review; no valid AI conclusion was produced.':'模型执行失败；程序生成无法判定占位，须人工核对，不是AI有效结论。'});}
      }else{
       r.status='completed';r.semanticResult=copy(result);r.semanticRunId=job.id;r.semanticRequestedModel=job.config.model;
       if((!ecommerce||localUnreplied)&&!human(s)){s.aiResults=localUnreplied?copy(mergeEcommerceResults({sessions:[s],semanticResults:[{sessionId:s.id,results:result.results}],duplicateGroups:[],basis:t.basisSnapshot,inspectionAt:t.aiRun.inspectionAt,runtime:t.executionSnapshot?.runtime}).get(s.id)):copy(result.results);s.aiExecution={...s.aiExecution,status:'completed',completedAt,modelId:result.modelId||job.config.model,promptVersion:result.promptVersion||(raw?RAW_INSPECTION_PROMPT_VERSION:'qa-ark-v2'),...(result.requestId?{requestId:result.requestId}:{}),...(result.usage?{usage:copy(result.usage)}:{})};}else if(ecommerce&&!human(s)){publishEcommerceCheckpoints(state,t);}
      }
      refresh(t,state);
     });return{sessionId:session.id,status:failure?'failed':'completed'};});
     if(!failure)return;if(stopsQueue(failure.errorCode)){job.stopped=true;await update(taskId,(state,t)=>{t.aiQueue.stopReason=failure.errorCode;refresh(t,state);});return;}
     if(!retryable(failure.errorCode)||attempt===maxAttempts||!canDispatch())return;
     try{await delay(retryDelayMs*2**(attempt-1),undefined,{signal:job.controller.signal});}catch{return;}
    }
   }
   let cursor=0;const workers=await Promise.allSettled(Array.from({length:q.settings.concurrency},async()=>{try{while(canDispatch()){const index=cursor++;if(index>=q.rows.length)return;await inspectRow(index);}}catch(error){job.stopped=true;throw error;}}));const workerFailure=workers.find(result=>result.status==='rejected');if(workerFailure)throw workerFailure.reason;
   doc=await store.read();task=doc.state.tasks.find(t=>t.id===taskId);q=task.aiQueue;
   if(ecommerce&&canDispatch()){
    await update(taskId,(state,t)=>{t.aiQueue.phase='comparison';if(t.aiQueue.comparison.status!=='completed')t.aiQueue.comparison.status='running';refresh(t,state);});
    for(let index=0;index<q.comparison.blocks.length&&canDispatch();index++){
     doc=await store.read();const plan=doc.state.tasks.find(t=>t.id===taskId).aiQueue.comparison,block=plan.blocks[index];if(block.status==='completed')continue;
     let retryFeedback;
     for(let attempt=1;attempt<=comparisonMaxAttempts&&canDispatch();attempt++){
      const startedAt=now();await update(taskId,(state,t)=>{const b=t.aiQueue.comparison.blocks[index];b.status='running';b.attempts++;b.startedAt=startedAt;b.completedAt=null;delete b.error;delete b.errorCode;refresh(t,state);});
      let result,failure;try{result=await client.compareEcommerceReplies({allowPartial:true,config:job.config,block:copy(block),plan:copy(plan),signal:job.controller.signal,...(retryFeedback?{retryFeedback}:{}),trace:{step:(node,input,operation)=>step(`c${index}-a${attempt}-${node}`,{blockId:block.id,attempt:block.attempts+attempt,...input},operation)}});if(result.complete===false){failure={errorCode:'invalid_output',error:'本块仅接受已校验的相似配对；未覆盖部分待重跑或人工，其他逐行判定保留。'};retryFeedback=result.diagnostic;}}catch(error){if(String(error?.code||'').toLowerCase().startsWith('trace_'))throw error;result=error.partialResult;failure=safeFailure(error,closing||job.controller.signal.aborted);retryFeedback=failure.errorCode==='invalid_output'?comparisonRetryFeedback(error.traceOutput?.diagnostic,block):undefined;}
      const willRetry=failure&&retryable(failure.errorCode)&&attempt<comparisonMaxAttempts&&canDispatch();
      await step(`c${index}-a${attempt}-persist`,{blockId:block.id,result:result??null,failure:failure??null},async()=>{await update(taskId,(state,t)=>{const b=t.aiQueue.comparison.blocks[index];b.completedAt=now();b.durationMs=(b.durationMs||0)+Math.max(0,Date.parse(b.completedAt)-Date.parse(startedAt));b.status=failure?(closing||job.paused||willRetry?'pending':'failed'):'completed';if(failure){Object.assign(b,failure);if(result?.complete===false)b.partialResult=copy(result);}else{b.result=copy(result);delete b.partialResult;delete b.error;delete b.errorCode;}publishEcommerceCheckpoints(state,t);refresh(t,state);});return{status:failure?(willRetry?'retrying':'failed'):'completed'};});
      if(!failure)break;if(stopsQueue(failure.errorCode)){job.stopped=true;await update(taskId,(state,t)=>{t.aiQueue.stopReason=failure.errorCode;refresh(t,state);});break;}if(!willRetry||!canDispatch())break;try{await delay(retryDelayMs*2**(attempt-1),undefined,{signal:job.controller.signal});}catch{break;}
     }
    }
    await update(taskId,(state,t)=>{const c=t.aiQueue.comparison,merged=mergeComparisonGroups(c,c.blocks);c.groups=merged.groups;c.status=merged.complete?'completed':job.paused||closing?'pending':'failed';refresh(t,state);});
   }
   if(ecommerce){
    doc=await store.read();task=doc.state.tasks.find(t=>t.id===taskId);q=task.aiQueue;
    await step('merge',{comparisonFingerprint:q.comparison.fingerprint,groupCount:q.comparison.groups.length},async()=>{await update(taskId,(state,t)=>publishEcommerceCheckpoints(state,t));return{persisted:q.rows.filter(r=>r.semanticResult).length,comparisonStatus:q.comparison.status};});
   }
    // Apply any run-wide post-processing before this single terminal checkpoint.
    await update(taskId,(state,t)=>{const q=t.aiQueue,unfinished=q.rows.some(r=>!['completed','protected'].includes(r.status))||(q.comparison&&q.comparison.status!=='completed');if(job.paused||closing){q.status='paused';t.aiStatus='paused';t.aiRun.completedAt=null;if(closing)q.stopReason='interrupted';if(!closing&&t.executionSnapshot?.configuration.executionMode==='configured'&&(q.stopReason==='capability_failure_rate'||job.stopped)){const reason=q.stopReason==='capability_failure_rate'?'capability_failure_rate':'capability_unavailable';state.aiTaskQueue.status='paused';state.aiTaskQueue.pauseReason=reason;const entry=taskQueueEntry(state.aiTaskQueue,taskId,job.id);if(entry)entry.blockedReason=reason;}}else{const success=state.sessions.some(s=>s.taskId===taskId&&s.aiExecution?.status==='completed');q.status=unfinished?(success?'partial':'failed'):'completed';t.aiStatus=q.status;t.aiRun.completedAt=now();if(!unfinished)q.phase='completed';applyAIDecisions(state,t,t.aiRun.completedAt);}t.aiRun.status=t.aiStatus;refresh(t,state);});
   if(traceStarted){const final=(await store.read()).state.tasks.find(t=>t.id===taskId),r=final.aiRun;for(const traceId of traceParts)await traceStore.finish(traceId,{status:final.aiStatus==='paused'?'interrupted':ecommerce&&final.aiStatus==='partial'?'partial':r.failed?(r.done?'partial':'failed'):r.done===r.total?'completed':r.done?'partial':'failed',summary:{done:r.done,failed:r.failed,total:r.total,queueStatus:final.aiQueue.status,phase:final.aiQueue.phase}});}
   }catch(error){onError(error);writeError='AI任务或运行记录未能完整保存，请检查本机存储后重新启动工具；原有记录保留。';job.stopped=true;try{await update(taskId,(state,t)=>{t.aiQueue.status='paused';t.aiQueue.stopReason='storage_error';t.aiStatus='paused';t.aiRun.status='paused';t.aiRun.completedAt=null;const queue=state.aiTaskQueue;if(queue){queue.status='paused';queue.pauseReason='storage_error';const entry=taskQueueEntry(queue,taskId,job.id);if(entry)entry.blockedReason='storage_error';}for(const r of t.aiQueue.rows)if(r.status==='running')r.status='pending';for(const s of state.sessions.filter(s=>s.taskId===taskId&&s.aiExecution?.status==='running'))s.aiExecution={...s.aiExecution,status:'failed',completedAt:now(),...safeFailure(null,true)};refresh(t,state);});}catch{}if(traceStarted)for(const traceId of traceParts)await traceStore.finish(traceId,{status:'interrupted',summary:{traceIncomplete:true},error:{code:'trace_storage'}}).catch(()=>{});
   }finally{active.delete(taskId);await serialized(dispatchNext);}
 }
 function launch(taskId,id,config,traceId){const job={id,taskId,config:copy(config),controller:new AbortController(),paused:false,stopped:false,traceId,promise:null};active.set(taskId,job);job.promise=Promise.resolve().then(()=>execute(job));return job;}
  function ensureOpen(){if(closing)throw new WorkspaceError('服务正在关闭，无法启动AI质检。',503);if(writeError)throw new WorkspaceError(writeError,503);}
  async function resumeQueueNow(){
   ensureOpen();if(active.size)throw new WorkspaceError('正在等待在途请求结束，请稍后继续。',409);
   const doc=await read(),head=pendingTaskEntries(doc.state?.aiTaskQueue)[0];
   if(head){const task=doc.state.tasks.find(task=>task.id===head.taskId);writable(doc.state,task);resumeConfig(modelConfig.getPrivate(),task.aiRun);}
   await updateState(state=>{const queue=state.aiTaskQueue??=createTaskQueue();queue.status='ready';queue.pauseReason=null;for(const entry of pendingTaskEntries(queue)){entry.blockedReason=null;if(entry.status==='paused'){const task=state.tasks.find(task=>task.id===entry.taskId);resetForResume(task,state);}}});
   await dispatchNext();return read();
  }
  const api={
   start(taskId,runId,settings){return serialized(async()=>{
    ensureOpen();if(typeof runId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(runId))throw new WorkspaceError('AI运行标识无效。');
    const doc=await read();if(!doc.initialized)throw new WorkspaceError('请先初始化工作区。');const task=doc.state.tasks.find(t=>t.id===taskId);if(!task||task.mode!=='manual')throw new WorkspaceError('请选择文件工作区中的任务。');
    writable(doc.state,task);
      if([task.aiRun,...(task.aiRunHistory||[])].some(r=>r?.id===runId))return{...doc,replayed:true};
    if(active.has(taskId)||pendingTaskEntries(doc.state.aiTaskQueue).some(entry=>entry.taskId===taskId))throw new WorkspaceError('该AI任务已经运行或排队，请完成、继续或取消排队后再开启新运行。',409);
    const config=requestConfig(modelConfig.getPrivate()),snapshot=modelConfigSnapshot(config),fingerprint=modelConfigFingerprint(snapshot),sessions=doc.state.sessions.filter(s=>s.taskId===taskId),targets=sessions.filter(eligible);
    if(!targets.length)throw new WorkspaceError('没有可运行的会话：已完成AI或已开始人工审核的会话不会重跑。');
    const selected=taskQueueSettings(task,settings),startedAt=now();
    if(sessions.some(s=>s.aiExecution?.status==='completed'&&comparisonPending(s))){const proposed=createQueue(sessions,task.basisSnapshot,selected,task.aiQueue,runId,true,fingerprint,isStageATimeBasis(task.basisSnapshot)||isBusinessEcommerceBasis(task.basisSnapshot)?startedAt:undefined,task.rawImportOptions,task.executionSnapshot);if(proposed.fingerprint!==task.aiQueue.fingerprint)throw new WorkspaceError('已有已保存的逐行判定，请继续原运行以重跑未完成相似块；更换模型、执行参数或检核截止点请新建重检任务。',409);}
    await update(taskId,(state,t)=>{const all=state.sessions.filter(s=>s.taskId===taskId),scheduler=state.aiTaskQueue??=createTaskQueue();if(!pendingTaskEntries(scheduler).length&&scheduler.status==='ready')scheduler.entries=[];
     const raw=t.inputMode===RAW_INPUT_MODE;if(t.aiRun)t.aiRunHistory=[...(t.aiRunHistory||[]),copy(t.aiRun)];t.aiQueue=createQueue(all,t.basisSnapshot,selected,t.aiQueue,runId,all.some(s=>s.ecommerce),fingerprint,raw||isStageATimeBasis(t.basisSnapshot)||isBusinessEcommerceBasis(t.basisSnapshot)?startedAt:undefined,t.rawImportOptions,t.executionSnapshot);t.aiQueue.status='queued';t.aiStatus='queued';
     t.aiRun={id:runId,modelId:config.model,modelConfig:snapshot,modelConfigFingerprint:fingerprint,status:'queued',total:targets.length,done:0,failed:0,startedAt,...(raw||isStageATimeBasis(t.basisSnapshot)||isBusinessEcommerceBasis(t.basisSnapshot)?{inspectionAt:startedAt}:{}),completedAt:null};refresh(t,state);appendTaskEntry(scheduler,t,startedAt);
    });await dispatchNext();return read();
   });},
   pause(taskId){return serialized(async()=>{
    ensureOpen();const doc=await read(),selected=doc.state.tasks.find(task=>task.id===taskId);if(!selected?.aiQueue)throw new WorkspaceError('任务没有可暂停的AI队列。',409);if(['completed','cancelled'].includes(selected.aiQueue.status))return doc;
    for(const job of active.values())job.paused=true;
    return updateState(state=>{const scheduler=state.aiTaskQueue??=createTaskQueue();scheduler.status='paused';scheduler.pauseReason='user';
     for(const task of state.tasks.filter(task=>active.has(task.id))){task.aiQueue.status='paused';task.aiStatus='paused';task.aiRun.status='paused';task.aiRun.completedAt=null;refresh(task,state);const entry=taskQueueEntry(scheduler,task.id,task.aiRun.id);if(entry)entry.blockedReason='user';}
     if(!pendingTaskEntries(scheduler).length){const task=state.tasks.find(task=>task.id===taskId);task.aiQueue.status='paused';task.aiStatus='paused';task.aiRun.status='paused';task.aiRun.completedAt=null;refresh(task,state);appendTaskEntry(scheduler,task,now()).blockedReason='user';}
    });
   });},
   resume(taskId){return serialized(async()=>{
    ensureOpen();const doc=await read(),task=doc.state.tasks.find(task=>task.id===taskId);if(!task?.aiQueue||['completed','cancelled'].includes(task.aiQueue.status))throw new WorkspaceError('没有可继续的AI队列。',409);
    if(active.has(taskId)||active.size&&doc.state.aiTaskQueue?.status==='paused')throw new WorkspaceError('正在等待在途请求结束，请稍后继续。',409);
    writable(doc.state,task);resumeConfig(modelConfig.getPrivate(),task.aiRun);
    const existingHead=pendingTaskEntries(doc.state.aiTaskQueue)[0];if(!active.size&&existingHead)resumeConfig(modelConfig.getPrivate(),doc.state.tasks.find(t=>t.id===existingHead.taskId).aiRun);
    if(!pendingTaskEntries(doc.state.aiTaskQueue).some(entry=>entry.taskId===taskId))await update(taskId,(state,t)=>{const scheduler=state.aiTaskQueue??=createTaskQueue();if(!pendingTaskEntries(scheduler).length&&scheduler.status==='ready')scheduler.entries=[];resetForResume(t,state);appendTaskEntry(scheduler,t,now());});
    if(active.size){await dispatchNext();return read();}
    return resumeQueueNow();
   });},
   resumeQueue(){return serialized(resumeQueueNow);},
   cancel(taskId){return serialized(async()=>{
    ensureOpen();const doc=await read(),task=doc.state.tasks.find(task=>task.id===taskId),entry=task&&taskQueueEntry(doc.state.aiTaskQueue,taskId,task.aiRun?.id);
    if(entry?.status==='cancelled'||task?.aiQueue?.status==='cancelled')return doc;
    if(active.has(taskId)||doc.state.sessions.some(session=>session.taskId===taskId&&session.aiExecution?.status==='running'))throw new WorkspaceError('等待当前请求结束后可取消本次运行。',409);
    if(!task?.aiQueue||!task.aiRun||!['queued','paused','interrupted'].includes(entry?.status||task.aiQueue.status))throw new WorkspaceError('只能取消排队、已暂停或已中断的AI任务。',409);
    await update(taskId,(state,t)=>{t.aiQueue.status='cancelled';t.aiStatus='cancelled';t.aiRun.status='cancelled';t.aiRun.completedAt=now();refresh(t,state);
     // Older paused runs may predate the task scheduler. Retain a terminal entry
     // so cancellation is traceable without changing their rows or saved results.
     const scheduler=state.aiTaskQueue??=createTaskQueue();if(!taskQueueEntry(scheduler,taskId,t.aiRun.id))appendTaskEntry(scheduler,t,t.aiRun.startedAt);
    });await dispatchNext();return read();
   });},
   isBusy(){return pendingOperations>0||active.size>0||cachedState?.aiTaskQueue?.status==='ready'&&pendingTaskEntries(cachedState.aiTaskQueue).length>0;},
   async waitForIdle(){for(;;){await startQueue;await Promise.all([...active.values()].map(job=>job.promise));await startQueue;if(active.size)continue;const queue=cachedState?.aiTaskQueue;if(closing||writeError||queue?.status!=='ready'||!pendingTaskEntries(queue).length)return;await serialized(dispatchNext);}},
   runtime(){const queue=taskQueueRuntime(cachedState?.aiTaskQueue);return{activeTasks:[...active.keys()],error:writeError,...queue,...(writeError?{queueStatus:'paused',queuePauseReason:'storage_error'}:{})};},
   async close(){if(closing){await startQueue;await Promise.all([...active.values()].map(job=>job.promise));return;}closing=true;await startQueue;
    if(cachedState&&pendingTaskEntries(cachedState.aiTaskQueue).length)try{await updateState(state=>{state.aiTaskQueue.status='paused';state.aiTaskQueue.pauseReason='interrupted';for(const entry of pendingTaskEntries(state.aiTaskQueue))entry.blockedReason='interrupted';});}catch(error){onError(error);}
    for(const job of active.values()){job.paused=true;job.controller.abort();}await Promise.all([...active.values()].map(job=>job.promise));
   },
  };return api;
}






