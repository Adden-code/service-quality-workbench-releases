import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import '../public/vendor/jszip.min.js';

export const MAX_DIAGNOSTIC_BYTES=10*1024*1024;
const READ_BUDGET=64*1024*1024,TRACE_LIMIT=32*1024*1024;
const states=new Set(['pending','queued','running','paused','completed','partial','failed','skipped','cancelled','interrupted','idle','not_run']);
const errors=new Set(['rate_limit','authentication','permission','request_rejected','timeout','invalid_output','output_truncated','input_too_large','network','provider_unavailable','provider_error','interrupted','validation_failed','trace_storage','trace_snapshot']);
const events=new Set(['APP_CLOSE_FAILED','WORKER_CLOSE_FAILED','CONTROL_CLOSE_FAILED','STOPPED','CONTROL_ERROR','STARTING','WORKER_SPAWN_FAILED','WORKER_EXIT','WORKER_HEALTHY','APP_ERROR','READY','START_FAILED','START_TIMEOUT','APP_START_FAILED','PORT_IN_USE']);
const capabilities=['intent','demandSummary','negativeVoice','ecommerceClassification','site','translation','timing'];
const status=v=>states.has(v)?v:'other';
const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
const opaque=v=>typeof v==='string'?createHash('sha256').update(v).digest('hex').slice(0,16):null;
const runId=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)?v:opaque(v);
const histogram=items=>{const counts={};for(const item of items)counts[status(item)]=(counts[status(item)]||0)+1;return counts;};
export function safeModelConfiguration(config={}){
 const containsSecret=value=>typeof config.apiKey==='string'&&config.apiKey.length>0&&(String(value).includes(config.apiKey)||String(value).includes(encodeURIComponent(config.apiKey)));
 let baseUrl=null;try{const u=new URL(config.baseUrl);if(['https:','http:'].includes(u.protocol)){u.username='';u.password='';u.search='';u.hash='';if(containsSecret(u.pathname))u.pathname='/[credential-path-omitted]';baseUrl=u.toString().slice(0,4096);}}catch{}
 return {baseUrl,model:typeof config.model==='string'&&!containsSecret(config.model)&&/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u.test(config.model)?config.model:null,authMode:['none','bearer'].includes(config.authMode)?config.authMode:null};
}
export function diagnosticMetadata(document={},build={}){
 const state=document.state||{},tasks=state.tasks||[],sessions=state.sessions||[],queue=state.aiTaskQueue||{};
 return {format:'quality-workbench-diagnostics-v1',createdAt:new Date().toISOString(),product:{version:/^\d+\.\d+\.\d+$/.test(build.version||build.productVersion)?build.version||build.productVersion:null,buildId:/^[\d.]+-[a-f0-9]{8,64}$/.test(build.buildId||'')?build.buildId:'development'},workspace:{revision:integer(document.revision),taskCount:tasks.length,sessionCount:sessions.length,queueStatus:status(queue.status),queueEntries:histogram((queue.entries||[]).map(e=>e.status)),taskRuns:histogram(tasks.map(t=>t.aiRun?.status)),sessionExecution:histogram(sessions.map(s=>s.aiExecution?.status))},privacy:{businessContentIncluded:false,rawLogsIncluded:false,modelResponsesIncluded:false,keysIncluded:false}};
}
export function projectDiagnosticTrace(run={}){
 return {runId:runId(run.id),taskRef:opaque(run.taskId),status:status(run.status),startedAt:timestamp(run.startedAt),completedAt:timestamp(run.completedAt),nodes:(Array.isArray(run.nodes)?run.nodes:[]).slice(0,4096).map((node,index)=>({index,nodeRef:opaque(node.id),stage:['source','basis','deterministic','model','validation','merge','persist'].find(s=>String(node.id||'').endsWith('-'+s)||node.id===s)||'other',capability:capabilities.find(c=>String(node.id||'').includes('-'+c+'-'))||null,status:status(node.status),durationMs:integer(node.durationMs),startedAt:timestamp(node.startedAt),completedAt:timestamp(node.completedAt),errorCode:errors.has(node.error?.code)?node.error.code:node.error?'other':null}))};
}
export function projectStartupLog(text){
 const lines=String(text).split(/\r?\n/),entries=[];let omitted=0;
 for(const line of lines){if(!line.trim())continue;const m=line.match(/^(\S+) ([A-Z_]+)(?: app=(\d{1,5}) worker=(\d{1,5}))?$/);if(m&&timestamp(m[1])&&events.has(m[2]))entries.push({at:m[1],event:m[2]});else omitted++;}
 return {entries,omittedLines:omitted};
}
async function safeDirectory(directory){
 const absolute=path.resolve(directory),root=path.parse(absolute).root;let current=root;
 for(const part of absolute.slice(root.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('unsafe diagnostic directory');}
 return absolute;
}
async function readBounded(file,limit){
 await safeDirectory(path.dirname(file));const info=await fs.lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>limit)throw new Error('diagnostic file skipped');
 const handle=await fs.open(file,'r');try{const stat=await handle.stat();if(stat.dev!==info.dev||stat.ino!==info.ino||stat.size>limit)throw new Error('diagnostic file changed');const bytes=Buffer.alloc(Math.min(stat.size,limit)+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>limit)throw new Error('diagnostic file grew');return bytes.subarray(0,bytesRead);}finally{await handle.close();}
}
/** Only allowlisted metadata enters the archive. Never serialize the source object. */
export async function createDiagnosticBundle({dataDir,document,build,modelConfig,includeTraces=false}){
 await safeDirectory(dataDir);const zip=new globalThis.JSZip(),notes=[],meta=diagnosticMetadata(document,build);let used=0;
 const add=(name,value)=>{const bytes=Buffer.from(JSON.stringify(value,null,2));if(used+bytes.length>8*1024*1024)return false;zip.file(name,bytes);used+=bytes.length;return true;};
 add('metadata.json',meta);add('model-configuration.json',safeModelConfiguration(modelConfig));
 try{const log=await readBounded(path.join(dataDir,'logs','portable-startup.log'),1024*1024);add('logs/portable-startup.events.json',projectStartupLog(log.toString('utf8')));}catch{notes.push('startup_log_missing_large_or_unsafe');}
 let selected=0,skipped=0,totalRead=0;
 if(includeTraces){
  try{
   const dir=await safeDirectory(path.join(dataDir,'workflow-runs')),files=[];
   for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(!entry.isFile()||!entry.name.endsWith('.json'))continue;const info=await fs.lstat(path.join(dir,entry.name));files.push({name:entry.name,size:info.size,mtime:info.mtimeMs});}
   files.sort((a,b)=>b.mtime-a.mtime);
   for(const file of files){if(selected>=64||file.size>TRACE_LIMIT||totalRead+file.size>READ_BUDGET){skipped++;continue;}
    try{const bytes=await readBounded(path.join(dir,file.name),TRACE_LIMIT);totalRead+=bytes.length;const projected=projectDiagnosticTrace(JSON.parse(bytes.toString('utf8')));if(add(`workflow-runs/run-${selected+1}.json`,projected))selected++;else skipped++;}catch{skipped++;}
   }
  }catch{notes.push('workflow_traces_missing_or_unsafe');}
 }
 add('coverage.json',{includeTraces,traceFilesIncluded:selected,traceFilesSkipped:skipped,notes});
 zip.file('README.txt','诊断包仅含版本、数量、队列状态、模型地址/名称/认证方式、启动事件及可选节点状态/耗时/错误码。\n不含源文件、会话、任务名称、提示词、模型返回、引文、密钥、完整日志或文件路径。未知日志行及错误正文均省略。\n轨迹默认不选；选中时仅保留最近最多64个可安全读取文件的元信息，读取预算64MiB，输出预算8MiB。coverage.json说明缺失和截断。\n运行ID仅保留UUID，其余标识使用稳定哈希，供节点间关联。文件缺失/截断不代表运行成功。\n本包无业务资料选项；需要业务资料时须另行获得明确授权。\n');
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});if(bytes.length>MAX_DIAGNOSTIC_BYTES)throw new Error('诊断包超过10MiB，请关闭轨迹选项重试。');
 const directory=path.join(dataDir,'diagnostics');await fs.mkdir(directory,{recursive:true});await safeDirectory(directory);
 const name=`diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.zip`,savedPath=path.join(directory,name),handle=await fs.open(savedPath,'wx',0o600);try{await handle.writeFile(bytes);}finally{await handle.close();}
 return {bytes,name,savedPath,traceFilesSkipped:skipped};
}
