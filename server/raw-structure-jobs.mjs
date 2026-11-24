import {activeDesktopJobCount} from './desktop-activity.mjs';
// User-triggered derivative export only. These jobs never write sessions,
// inspection evidence, human reviews, or any optional result back to a task.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createReportJobStore,reportJobId,ReportJobError} from './report-job-store.mjs';
import {modelConfigSnapshot,modelConfigFingerprint} from './model-config.mjs';
import {loadConsultationOriginal} from './consultation-source.mjs';
import {parseCleaningResult,prepareCleaningPrompt,CLEANING_PROMPT_VERSION} from './conversation-cleaning.mjs';
import {validateCleaningSegments} from '../public/conversation-cleaning.mjs';
import {parseBusinessInput} from '../public/business-input.mjs';
import {workbook} from '../public/io.mjs';
import {validateRawReportRecord} from '../public/raw-report-evidence.mjs';

const clone=value=>structuredClone(value),now=()=>new Date().toISOString();
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=(message,status=400,code='RAW_STRUCTURE_INPUT')=>{throw new ReportJobError(message,status,code);};
const storage=()=>fail('结构化导出的来源、结果或快照指纹不一致，原文件已保留。',500,'REPORT_STORAGE');
const infoHeaders=['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'];
const turnHeaders=['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'];
const summary=job=>{
 const completed=job.units.filter(unit=>unit.status==='completed').length,failed=job.units.filter(unit=>unit.status==='failed').length;
 return{id:job.id,taskId:job.taskId,taskName:job.taskName,status:job.status,phase:job.phase,createdAt:job.createdAt,updatedAt:job.updatedAt,completedAt:job.completedAt,total:job.units.length,processed:completed+failed,completed,failed,pending:job.units.filter(unit=>unit.status==='pending').length,running:job.units.filter(unit=>unit.status==='running').length,...(job.stopReason?{stopReason:job.stopReason}:{}),nodes:job.units.map(unit=>({id:unit.id,recordId:unit.recordId,label:unit.label,status:unit.status,attempts:unit.attempts,durationMs:unit.durationMs,...(unit.errorCode?{errorCode:unit.errorCode,error:unit.error}:{})})),traceRunIds:clone(job.traceRunIds||[])};
};
function inputFor(snapshot,unit){
 const record=snapshot.records.find(record=>record.id===unit.recordId);if(!record)storage();
 const raw=record.rawTranscript;
 return{scene:snapshot.scene,sourceName:snapshot.source.name,sheet:raw.sheet,row:raw.row,sessionId:raw.raw[raw.columns.id-1],agent:raw.raw[raw.columns.agent-1],text:raw.text,timezone:raw.timePolicy.mode==='explicit'&&raw.timePolicy.timezone==='+08:00'?'+08:00':''};
}
// Reparse the normalized transport output through the exact-source parser.
// Injected/custom clients receive the same validation as the normal transport.
function checkedOutput(value,input){
 try{
  if(!value||!Array.isArray(value.segments))throw new Error();
  validateCleaningSegments(input.text,value.segments);
  const wire={segments:value.segments.filter(segment=>segment.kind!=='separator').map(segment=>({kind:segment.kind,sourceQuote:segment.sourceQuote,sourceLocator:segment.sourceLocator,textQuote:segment.text,role:segment.role,...(segment.fieldSources?.role?.kind==='exact'?{roleQuote:segment.fieldSources.role.quote}:{}),...(segment.fieldSources?.at?.kind==='exact'?{atQuote:segment.fieldSources.at.quote}:{}),warnings:segment.warnings})),warnings:value.warnings||[]};
  const reparsed=parseCleaningResult(JSON.stringify(wire),input);
  if(reparsed.segments.length!==value.segments.length||reparsed.segments.some((segment,index)=>['kind','sourceQuote','sourceLocator','text','role','at','fieldSources'].some(key=>JSON.stringify(segment[key])!==JSON.stringify(value.segments[index][key]))))throw new Error();
  return reparsed;
 }catch{fail('结构化片段未逐字对应本行原文；未解析部分已保留，未采用该输出。',502,'INVALID_OUTPUT');}
}
function bounded(value,secret){
 const sanitize=item=>typeof item==='string'?(secret?item.split(secret).join('[已隐藏密钥]'):item):Array.isArray(item)?item.map(sanitize):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).filter(([key])=>!['apikey','authorization','proxyauthorization'].includes(key.toLowerCase().replace(/[\s_-]/g,''))).map(([key,item])=>[key,sanitize(item)])):item??null;
 const safe=sanitize(value),text=JSON.stringify(safe);return Buffer.byteLength(text)<48000?safe:{truncated:true,bytes:Buffer.byteLength(text),sha256:hash(text),preview:text.slice(0,3000),reason:'完整原文和成功输出保留于本任务冻结来源及节点结果。'};
}
function problem(error){const code=String(error?.code||'PROVIDER_ERROR').toUpperCase();return{errorCode:code,error:code==='INVALID_OUTPUT'?'AI结构化输出未通过逐字来源校验。':code==='INPUT_TOO_LARGE'?'完整原文超过结构化输入预算，未截断。':['AUTH','UNAUTHORIZED','FORBIDDEN','NOT_CONFIGURED','CONNECTION_REQUIRED','INVALID_CONFIG'].includes(code)?'模型设置或权限需修复并测试后继续。':'结构化请求未完成，原文保留；可重试失败行。'};}
const fatal=code=>['AUTH','AUTHENTICATION','PERMISSION','REQUEST_REJECTED','UNAUTHORIZED','FORBIDDEN','NOT_CONFIGURED','CONNECTION_REQUIRED','INVALID_CONFIG'].includes(code);
const retryable=code=>!fatal(code)&&!['INPUT_TOO_LARGE','INVALID_INPUT'].includes(code);

export async function createRawStructureJobs({dataDir,store,modelConfig,client,traceStore,maxAttempts=2,retryDelayMs=500,onError=()=>{}}={}){
 if(typeof dataDir!=='string'||!store?.read||!store?.getSource||!modelConfig?.getPrivate||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw new TypeError('Invalid raw structure dependencies.');
 const root=path.join(path.resolve(dataDir),'raw-structure');
 const base=await fs.lstat(path.resolve(dataDir));if(!base.isDirectory()||base.isSymbolicLink())storage();
 try{const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())storage();}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(root);}
 const files=await createReportJobStore({dataDir:root}),jobs=new Map();let tail=Promise.resolve(),active=null,closing=false,closePromise,pendingOperations=0;
 const serial=operation=>{pendingOperations++;const next=tail.then(operation).finally(()=>{pendingOperations--;});tail=next.catch(()=>{});return next;};
 const persist=async job=>{job.updatedAt=now();await files.save(job);};
 const find=id=>{const job=jobs.get(reportJobId(id));if(!job)fail('结构化导出任务不存在。',404);return job;};
 for(const job of await files.list()){
  if(job.kind!=='raw-structure-v1'||!Array.isArray(job.units)||job.consent!==true||!['running','paused','completed','completed_with_warnings'].includes(job.status))storage();
  if(job.status==='running'||job.status==='paused'&&job.units.some(unit=>unit.status==='running')){job.status='paused';job.stopReason=job.stopReason||'interrupted';for(const unit of job.units)if(unit.status==='running'){
   const saved=await files.result(job.id,unit.id);if(saved&&hash(saved.value)===saved.sha256){unit.status='completed';unit.resultSha256=saved.sha256;}else if(saved)storage();else unit.status='pending';
  }await persist(job);}jobs.set(job.id,job);
 }
 async function snapshotOf(job){
  if(job.promptVersion!==CLEANING_PROMPT_VERSION||modelConfigFingerprint(job.modelConfig)!==job.modelConfigFingerprint)fail('结构化任务的提示词版本或冻结模型指纹不一致，请保留旧产物并新建导出。',500,'REPORT_STORAGE');
  const snapshot=await files.snapshot(job.id);if(hash(snapshot)!==job.snapshotFingerprint||snapshot.inputMode!=='raw-transcript-v1'||snapshot.taskId!==job.taskId||!Array.isArray(snapshot.records)||snapshot.records.length!==job.units.length)storage();
  for(const record of snapshot.records){if(hash(record.rawTranscript?.text)!==record.rawTranscript?.textSha256)storage();try{validateRawReportRecord(record,snapshot.original,snapshot.source);}catch{storage();}}
  if(new Set(job.units.map(unit=>unit.recordId)).size!==snapshot.records.length||job.units.some(unit=>!snapshot.records.some(record=>record.id===unit.recordId)))storage();return snapshot;
 }
 function configFor(job){
  const current=modelConfig.getPrivate();if(!current.configured||current.authMode!=='none'&&!current.apiKey||current.connectionTested!==true)fail('请先保存模型设置并完成当前配置的连接测试。',409,'CONNECTION_REQUIRED');
  if(job&&modelConfigFingerprint(current)!==job.modelConfigFingerprint)fail('模型配置与已同意的结构化任务不一致，请恢复原配置并测试，或新建导出任务。',409,'MODEL_CONFIG_CHANGED');return current;
 }
 async function outputOf(job,unit,snapshot){const saved=await files.result(job.id,unit.id);if(!saved||saved.sha256!==unit.resultSha256||hash(saved.value)!==saved.sha256)storage();return checkedOutput(saved.value,inputFor(snapshot,unit));}
 function launch(job,config){const work={job,config,controller:new AbortController(),paused:false,promise:null};active=work;work.promise=Promise.resolve().then(()=>execute(work));}
 async function execute(work){
  const {job}=work,canDispatch=()=>!closing&&!work.paused&&!work.controller.signal.aborted;
  try{
   const snapshot=await snapshotOf(job);job.phase='structure';
   for(const unit of job.units){if(!canDispatch())break;if(unit.status==='completed')continue;
    for(let attempt=1;attempt<=maxAttempts&&canDispatch();attempt++){
     unit.status='running';unit.attempts++;unit.startedAt=now();delete unit.error;delete unit.errorCode;await persist(job);
     const input=inputFor(snapshot,unit),started=Date.now();let output,error,runId;
     try{
      work.config=configFor(job);prepareCleaningPrompt(input); // Bound oversized input before any provider call.
      if(traceStore){runId=`${job.id}.${unit.id}.a${unit.attempts}`;await traceStore.begin({id:runId,taskId:job.id,kind:'raw-structure-export',engine:client.engine||'native-node',nodes:[{id:'execute',label:unit.label}],meta:{sourceTaskId:job.taskId,recordId:unit.recordId}});job.traceRunIds.push(runId);await persist(job);}
      const operation=async()=>{try{return checkedOutput(await client.prepareConversationCleaning({config:work.config,input,signal:work.controller.signal,...(traceStore?{trace:{step:async(node,data,operation)=>{await traceStore.appendNodes(runId,[{id:node,label:`${unit.label} · ${node}`}]);let value;await traceStore.step(runId,node,bounded(data,work.config.apiKey),async()=>{value=await operation();return bounded(value,work.config.apiKey);});return value;}}}:{})}),input);}catch(error){if(error.traceOutput!==undefined)error.traceOutput=bounded(error.traceOutput,work.config.apiKey);throw error;}};
      if(traceStore)await traceStore.step(runId,'execute',bounded(input,work.config.apiKey),async()=>{output=await operation();return bounded(output,work.config.apiKey);});else output=await operation();
     }catch(cause){if(cause?.code==='REPORT_STORAGE')throw cause;error=cause;}
     unit.durationMs+=Date.now()-started;const detail={attempt:unit.attempts,startedAt:unit.startedAt,completedAt:now(),durationMs:Date.now()-started,status:error?'failed':'completed',...(error?problem(error):{})};unit.history.push(detail);
     await files.saveAttempt(job.id,unit.id,unit.attempts,{...detail,input:bounded(input,work.config.apiKey),output:bounded(output??error?.traceOutput??null,work.config.apiKey)});
     if(!error){unit.resultSha256=await files.saveResult(job.id,unit.id,output);unit.status='completed';await persist(job);}
     else{Object.assign(unit,problem(error));unit.status=canDispatch()?'failed':'pending';await persist(job);}
     if(runId)await traceStore.finish(runId,{status:error?'partial':'completed',summary:{recordId:unit.recordId,status:unit.status}}).catch(onError);
     if(!error)break;
     if(error.code==='MODEL_CONFIG_CHANGED'||fatal(unit.errorCode)){work.paused=true;job.stopReason=unit.errorCode;break;}
     if(!canDispatch()||attempt>=maxAttempts||!retryable(unit.errorCode))break;
     try{await delay(retryDelayMs*2**(attempt-1),undefined,{signal:work.controller.signal});}catch{break;}
    }
   }
   job.status=canDispatch()?(job.units.every(unit=>unit.status==='completed')?'completed':'completed_with_warnings'):'paused';job.phase=job.status==='paused'?'structure':'ready';job.completedAt=job.status==='paused'?null:now();if(closing)job.stopReason='interrupted';await persist(job);
  }catch(error){onError(error);job.status='paused';job.stopReason='storage_error';for(const unit of job.units)if(unit.status==='running')unit.status='pending';await persist(job).catch(()=>{});}
  finally{if(active===work)active=null;}
 }
 async function artifactOf(job,snapshot){
  const infoRows=[],turnRows=[],missingInfo=[],unparsed=[],sourceRows=[];
  for(const unit of job.units){
   const record=snapshot.records.find(record=>record.id===unit.recordId),raw=record.rawTranscript,input=inputFor(snapshot,unit),output=unit.status==='completed'?await outputOf(job,unit,snapshot):null;
   const segments=output?.segments||[{kind:'unparsed',text:raw.text,sourceQuote:raw.text,sourceLocator:{start:0,end:raw.text.length},role:'',at:'',fieldSources:{}}],messages=segments.filter(segment=>segment.kind==='message'),timeAvailable=raw.timePolicy.mode==='explicit',startedAt=timeAvailable?messages[0]?.at||'':'',missing=[];
   if(!startedAt)missing.push('startedAt');if(!messages.length)missing.push('turns');
   if(messages.some(segment=>!segment.role||segment.fieldSources?.role?.kind!=='exact'))missing.push('role');
   if(segments.some(segment=>segment.kind==='unparsed'))missing.push('unparsed');
   if(missing.length)missingInfo.push({recordId:record.id,sourceRow:raw.row,fields:missing,reason:timeAvailable?'来源信息不足或存在未解析片段，保持缺失。':'未提供可靠来源时间；日期和时间保持为空，不补造。'});
   const product=raw.columns.product?raw.raw[raw.columns.product-1]:snapshot.rawImportOptions?.productDefault||'';
   infoRows.push([record.externalId,snapshot.scene,startedAt,'','',product,input.agent,'','部分缺失','AI生成未核验结构化草稿；完整原文仍是本次质检的唯一证据来源。'+(missing.length?'缺少：'+missing.join('、')+'。':'')]);
   messages.forEach((segment,index)=>turnRows.push([record.externalId,index+1,segment.fieldSources?.role?.kind==='exact'?segment.role:'','',timeAvailable?segment.at:'',segment.text]));
   for(const segment of segments)if(segment.kind==='unparsed')unparsed.push({recordId:record.id,sourceRow:raw.row,start:segment.sourceLocator.start,end:segment.sourceLocator.end,text:segment.sourceQuote});
   sourceRows.push([record.id,record.externalId,raw.sheet,raw.row,raw.textSha256,raw.text]);
  }
  const sheets=[{name:'会话信息',headers:infoHeaders,rows:infoRows},{name:'会话明细',headers:turnHeaders,rows:turnRows}];
  const bytes=await workbook(sheets),parsed=await parseBusinessInput({name:'AI-generated-structure.xlsx',size:bytes.length,arrayBuffer:async()=>bytes}),valid=parsed.valid&&unparsed.length===0&&missingInfo.length===0;
  const validation={valid,errors:[...parsed.errors,...(unparsed.length?['存在未解析原文，不能声称会话信息与逐条发言表已完成。']:[]),...(missingInfo.length&&!parsed.errors.length?['存在来源缺失信息，保持AI未核验草稿。']:[])],warnings:parsed.warnings||[]};
  const kind=valid?'standard-double-sheet':'ai-unverified-draft',label=valid?'会话信息与逐条发言表（AI生成，未核验）':'AI生成未核验结构化草稿';
  const warnings=['可选结构化产物独立于质检和人工审核；不得反向替换本次归档原文或证据。','角色建议、摘要和转换格式不构成业务事实核验；缺失时间不会自动补造。'];
  if(!valid)sheets.push({name:'转换说明',headers:['项目','说明'],rows:[['产物性质',label],['格式预检','未通过完整标准模板预检，不可标称已核验会话信息与逐条发言表。'],...warnings.map(warning=>['边界',warning]),...validation.errors.map(error=>['格式问题',error]),...missingInfo.map(item=>['缺失信息',JSON.stringify(item)])]},{name:'未解析原文',headers:['内部记录ID','源物理行','起始UTF-16','结束UTF-16','完整未解析原文'],rows:unparsed.map(item=>[item.recordId,item.sourceRow,item.start,item.end,item.text])},{name:'原文溯源',headers:['内部记录ID','原会话ID','源工作表','源物理行','原文SHA256','完整原文'],rows:sourceRows});
  return{kind,label,sheets,validation,missingInfo,unparsed,warnings};
 }
 return{
  create(input){return serial(async()=>{
   if(closing)fail('服务正在关闭。',503);if(!input||Object.keys(input).some(key=>!['jobId','taskId','consent'].includes(key))||input.consent!==true)fail('可选结构化会独立调用模型，请明确同意本次导出。',400,'CONSENT_REQUIRED');
   if(typeof client?.prepareConversationCleaning!=='function')fail('当前模型通道不支持可选结构化导出。',409,'STRUCTURE_UNAVAILABLE');
   const id=reportJobId(input.jobId),config=configFor();if(typeof input.taskId!=='string')fail('请选择原文直判任务。');
   const doc=await store.read(),task=doc.state.tasks.find(task=>task.id===input.taskId);if(task?.inputMode!=='raw-transcript-v1')fail('仅支持原文直判任务的独立结构化导出。');
   const original=await loadConsultationOriginal({state:doc.state,task,store}),records=doc.state.sessions.filter(session=>session.taskId===task.id).map(session=>({id:session.id,externalId:session.externalId,inputMode:'raw-transcript-v1',conversation:session.rawTranscript.text,rawTranscript:clone(session.rawTranscript)}));
   const snapshot={schemaVersion:1,inputMode:'raw-transcript-v1',taskId:task.id,taskName:task.name,scene:task.scene,source:clone(task.source),rawImportOptions:clone(task.rawImportOptions),original,records},signature=hash(snapshot);
   if(jobs.has(id)){const old=find(id);if(old.snapshotFingerprint!==signature)fail('相同导出标识对应不同冻结来源，不能覆盖。',409);return summary(old);}
   if(active)fail('已有结构化导出正在运行，请完成或暂停后再创建。',409);
   const createdAt=now(),job={schemaVersion:1,kind:'raw-structure-v1',id,taskId:task.id,taskName:task.name,consent:true,consentedAt:createdAt,createdAt,updatedAt:createdAt,completedAt:null,status:'running',phase:'snapshot',snapshotFingerprint:signature,sourceRevision:doc.revision??null,modelConfig:modelConfigSnapshot(config),modelConfigFingerprint:modelConfigFingerprint(config),promptVersion:CLEANING_PROMPT_VERSION,traceRunIds:[],units:records.map((record,index)=>({id:`n${index+1}`,recordId:record.id,label:`后台结构化 · ${record.externalId}`,status:'pending',attempts:0,durationMs:0,history:[]}))};
   await files.create(job,snapshot);jobs.set(id,job);launch(job,config);return summary(job);
  });},
  async get(id){return summary(find(id));},
  async list(taskId){return[...jobs.values()].filter(job=>!taskId||job.taskId===taskId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(summary);},
  async getResult(id){const job=clone(find(id)),snapshot=await snapshotOf(job),artifact=await artifactOf(job,snapshot);return{snapshot,job:summary(job),artifact,warnings:artifact.warnings};},
  async getNode(id,nodeId){const job=find(id),snapshot=await snapshotOf(job),unit=job.units.find(unit=>unit.id===nodeId);if(!unit)fail('结构化节点不存在。',404);const attempts=[];for(const entry of unit.history){const saved=await files.attempt(id,nodeId,entry.attempt);if(saved)attempts.push(saved);}return{node:summary(job).nodes.find(node=>node.id===nodeId),attempts,input:inputFor(snapshot,unit),output:unit.status==='completed'?await outputOf(job,unit,snapshot):null};},
  pause(id){return serial(async()=>{const job=find(id);if(active?.job.id===job.id)active.paused=true;if(job.status==='running'){job.status='paused';job.stopReason='user_paused';await persist(job);}return summary(job);});},
  resume(id){return serial(async()=>{if(closing)fail('服务正在关闭。',503);if(active)fail('已有结构化请求仍在收尾，请稍后继续。',409);const job=find(id);if(job.status!=='paused')return summary(job);await snapshotOf(job);const config=configFor(job);for(const unit of job.units)if(unit.status==='failed'&&fatal(unit.errorCode))unit.status='pending';job.status='running';delete job.stopReason;await persist(job);launch(job,config);return summary(job);});},
  retry(id){return serial(async()=>{if(closing)fail('服务正在关闭。',503);if(active)fail('已有结构化请求仍在执行。',409);const job=find(id);await snapshotOf(job);const config=configFor(job);if(!job.units.some(unit=>unit.status==='failed'))return summary(job);for(const unit of job.units)if(unit.status==='failed'){unit.status='pending';delete unit.errorCode;delete unit.error;}job.status='running';delete job.stopReason;await persist(job);launch(job,config);return summary(job);});},
  activityCount(){return activeDesktopJobCount({pendingOperations,activeIds:active?[active.job.id]:[],jobs:[...jobs.values()]});},
  isBusy(){return pendingOperations>0||active!==null;},
  async waitForIdle(){await tail;while(active){await active.promise;await tail;}},
  close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{await tail;if(active){active.controller.abort();await active.promise;}await files.close();})();return closePromise;}
 };
}
