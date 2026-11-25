import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export const WORKFLOW_NODES=Object.freeze([
  ['source','输入核对'],['basis','规则与版本'],['deterministic','结构计算'],['model','模型语义'],
  ['validation','结构与证据校验'],['merge','合并结论'],['persist','保存结果'],
].map(([id,label])=>Object.freeze({id,label})));
export const MAX_TRACE_SNAPSHOT_BYTES=1024*1024;
const MAX_RUN_BYTES=32*1024*1024;
const MAX_NODES=4096;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const NODE_STATUSES=new Set(['pending','running','completed','failed','skipped']);
const FINAL_STATUSES=new Set(['completed','partial','failed','interrupted']);
const SAFE_FAILURES=Object.freeze({
  rate_limit:'模型额度或请求频率受限。',authentication:'模型密钥鉴权失败。',permission:'模型请求权限不足。',
  request_rejected:'模型服务拒绝当前请求，请核对模型设置与输入配置。',
  timeout:'模型响应超时。',invalid_output:'模型结果不完整或依据无效。',output_truncated:'模型输出长度不足。',
  input_too_large:'本次输入超出模型上限。',network:'无法连接模型服务。',provider_unavailable:'模型服务暂时不可用。',
  provider_error:'模型执行或结果保存失败。',interrupted:'服务停止，本次运行未完成。',
  validation_failed:'结构或证据校验失败。',trace_storage:'运行记录保存失败。',trace_snapshot:'运行快照无法保存。',
});
const PRIVATE_KEYS=new Set(['apikey','authorization','proxyauthorization','accesstoken','refreshtoken','bridgetoken',
  'workspacetoken','password','secret','credentials','credential','reasoningcontent','humanreference',
  'referenceanswer','referenceanswers','humananswer','humanconclusion','人工参考结论','参考答案']);
const copy=value=>structuredClone(value);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));

export class WorkflowTraceError extends Error {
  constructor(code,message,status=400){super(message);this.name='WorkflowTraceError';this.code=code;this.status=status;}
}
const traceError=(code,message,status)=>new WorkflowTraceError(code,message,status);
function checkId(value){if(typeof value!=='string'||!ID.test(value))throw traceError('trace_id','运行或任务标识无效。');return value;}
function safeFailure(error){
  const candidate=typeof error?.code==='string'?error.code.toLowerCase():'';
  const code=Object.hasOwn(SAFE_FAILURES,candidate)?candidate:'provider_error';
  return {code,reason:SAFE_FAILURES[code]};
}
// Callers project business fields explicitly; this second barrier removes sensitive key names.
// Non-JSON values are rejected rather than pretending a Map or Error was an empty object.
function snapshot(value){
  const ancestors=new Set();
  function project(item,depth=0){
    if(depth>100)throw traceError('trace_snapshot','运行快照嵌套过深。');
    if(item===undefined)return null;
    if(item===null||typeof item==='string'||typeof item==='boolean')return item;
    if(typeof item==='number'){if(Number.isFinite(item))return item;throw traceError('trace_snapshot','运行快照包含非有限数值。');}
    if(typeof item!=='object'||(!Array.isArray(item)&&!plain(item)))throw traceError('trace_snapshot','运行快照须为可序列化业务数据。');
    if(ancestors.has(item))throw traceError('trace_snapshot','运行快照包含循环引用。');
    ancestors.add(item);
    const result=Array.isArray(item)?item.map(child=>project(child,depth+1)):Object.fromEntries(Object.entries(item)
      .filter(([key])=>!PRIVATE_KEYS.has(key.toLowerCase().replace(/[\s_-]/g,'')))
      .map(([key,child])=>[key,project(child,depth+1)]));
    ancestors.delete(item);return result;
  }
  const result=project(value),json=JSON.stringify(result),bytes=Buffer.byteLength(json);
  return bytes<=MAX_TRACE_SNAPSHOT_BYTES?result:{truncated:true,bytes,limitBytes:MAX_TRACE_SNAPSHOT_BYTES,sha256:sha256(json),reason:'快照超过大小限制，完整内容未留存。'};
}
function summary(run){
  return {id:run.id,taskId:run.taskId,engine:run.engine,status:run.status,startedAt:run.startedAt,completedAt:run.completedAt,
    nodes:run.nodes.map(({id,label,status,durationMs})=>({id,label,status,durationMs})),
    ...(run.meta?.parentRunId?{parentRunId:run.meta.parentRunId,tracePartIds:run.meta.tracePartIds??[run.id]}:{}),
    ...(run.error?{error:copy(run.error)}:{}),...(run.summary!==undefined?{summary:copy(run.summary)}:{})};
}

async function directoryWithoutLinks(directory,create=false){
  const absolute=path.resolve(directory),root=path.parse(absolute).root;
  let current=root;
  for(const part of absolute.slice(root.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);let stat;
    try{stat=await fs.lstat(current);}catch(error){
      if(error.code!=='ENOENT'||!create)throw error;
      try{await fs.mkdir(current,{mode:0o700});}catch(mkdirError){if(mkdirError.code!=='EEXIST')throw mkdirError;}
      stat=await fs.lstat(current);
    }
    if(stat.isSymbolicLink()||!stat.isDirectory())throw traceError('trace_path','追踪目录不可使用符号链接或非目录路径。',500);
  }
}
async function regularFile(file,{optional=false}={}){
  try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())throw traceError('trace_path','追踪文件不可使用符号链接或非普通文件。',500);return stat;}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
}
async function readFileWithoutLinks(file){
  await regularFile(file);let handle;
  try{
    handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const stat=await handle.stat();
    if(!stat.isFile()||stat.size>MAX_RUN_BYTES)throw traceError('trace_storage','运行记录文件超出大小限制或结构无效。',500);
    return await handle.readFile('utf8');
  }finally{await handle?.close();}
}

export async function createWorkflowTraceStore({dataDir,clock=()=>new Date(),beforeLoad}={}){
  if(typeof dataDir!=='string'||!dataDir.trim()||typeof clock!=='function')throw traceError('trace_path','请指定追踪数据目录和有效时钟。');
  const directory=path.join(path.resolve(dataDir),'workflow-runs'),lockPath=path.join(directory,'.workflow.lock');
  await directoryWithoutLinks(directory,true);
  let lock;
  const locked=()=>traceError('trace_lock','追踪目录已有写入进程，无法启动第二个写入进程。',409);
  async function acquireLock(){
    await regularFile(lockPath,{optional:true});
    try{return await fs.open(lockPath,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;}
    async function deadOwner(expected){
      let raw,owner;try{raw=await readFileWithoutLinks(lockPath);owner=JSON.parse(raw);}catch{throw locked();}
      if(!plain(owner)||!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.nonce!=='string'||!owner.nonce||(expected!==undefined&&raw!==expected))throw locked();
      try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return raw;}
      throw locked();
    }
    const original=await deadOwner(),recoveryPath=lockPath+'.recovery';let recovery;
    try{recovery=await fs.open(recoveryPath,'wx',0o600);}catch{throw locked();}
    try{await deadOwner(original);await fs.unlink(lockPath);return await fs.open(lockPath,'wx',0o600);}
    finally{await recovery.close();await fs.unlink(recoveryPath).catch(()=>{});}
  }
  lock=await acquireLock();
  let closed=false,closing=false,closePromise,queue=Promise.resolve();
  const records=new Map(),nonce=randomBytes(16).toString('hex');
  const now=()=>{const value=new Date(clock());if(!Number.isFinite(value.getTime()))throw traceError('trace_clock','追踪时钟无效。');return value.toISOString();};
  const elapsed=(start,end)=>start?Math.max(0,new Date(end).getTime()-new Date(start).getTime()):null;
  function serial(operation){if(closing||closed)return Promise.reject(traceError('trace_storage','追踪存储正在关闭或已关闭。',503));const next=queue.then(operation);queue=next.catch(()=>{});return next;}
  const filename=id=>path.join(directory,checkId(id)+'.json');
  const requireRun=id=>{checkId(id);const run=records.get(id);if(!run)throw traceError('trace_missing','运行记录不存在。',404);return copy(run);};
  function requireRunning(id){const run=requireRun(id);if(run.status!=='running')throw traceError('trace_state','运行已结束，不能再修改节点。',409);return run;}
  function requireNode(run,nodeId){const node=run.nodes.find(n=>n.id===nodeId);if(!node)throw traceError('trace_node','运行节点不存在。');return node;}
  function validateLoaded(run,id){
    if(!plain(run)||run.schemaVersion!==1||run.id!==id||!ID.test(run.taskId)||typeof run.engine!=='string'||typeof run.kind!=='string'||!['running',...FINAL_STATUSES].includes(run.status)||!Array.isArray(run.nodes)||!run.nodes.length||run.nodes.length>MAX_NODES||new Set(run.nodes.map(n=>n.id)).size!==run.nodes.length||!Number.isFinite(Date.parse(run.startedAt))||run.nodes.some(n=>!plain(n)||!ID.test(n.id)||typeof n.label!=='string'||!NODE_STATUSES.has(n.status)))throw traceError('trace_storage','运行记录结构损坏，原文件已保留。',500);
    return run;
  }
  async function persist(run,{fresh=false}={}){
    const target=filename(run.id),temporary=path.join(directory,`.${run.id}.${randomBytes(12).toString('hex')}.tmp`);
    const bytes=JSON.stringify(run);if(Buffer.byteLength(bytes)>MAX_RUN_BYTES)throw traceError('trace_storage','运行记录超过保存大小限制。',500);
    await directoryWithoutLinks(directory);await regularFile(target,{optional:true});let handle;
    try{
      handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
      await directoryWithoutLinks(directory);await regularFile(target,{optional:true});
      // Windows file scanners can hold a just-closed file briefly; retry only the
      // atomic filesystem operation, never the model call or business mutation.
      const atomic=()=>fresh?fs.link(temporary,target):fs.rename(temporary,target);
      // A scanner can retain a closed file longer than 175ms; allow up to 3.175s,
      // retrying this same rename/link only, without rerunning a model operation.
      for(let attempt=0;;attempt++){try{await atomic();break;}catch(error){if(process.platform!=='win32'||!['EPERM','EBUSY'].includes(error.code)||attempt>=7)throw error;await delay(25*2**attempt);}}
      if(fresh)await fs.unlink(temporary);
    }catch(error){
      await handle?.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});
      if(error instanceof WorkflowTraceError)throw error;
      if(fresh&&error.code==='EEXIST')throw traceError('trace_exists','运行标识已存在，请使用新的运行标识。',409);
      const failure=traceError('trace_storage','运行记录保存失败，原记录已保留。',500);failure.cause=error;throw failure;
    }
    records.set(run.id,copy(run));return copy(run);
  }
  function settlePending(run,reason){for(const node of run.nodes)if(node.status==='pending'){node.status='skipped';node.completedAt=run.completedAt;node.durationMs=null;node.output={reason};}}
  function logicalRun(run){
    if(run.meta?.parentRunId!==run.id)return run;
    const parts=[...records.values()].filter(item=>item.taskId===run.taskId&&item.meta?.parentRunId===run.id).sort((a,b)=>(a.meta.part||1)-(b.meta.part||1));
    if(parts.length<2)return{...copy(run),meta:{...copy(run.meta),tracePartIds:[run.id]}};
    const combined=copy(run);combined.nodes=parts.flatMap(part=>copy(part.nodes));combined.meta.tracePartIds=parts.map(part=>part.id);
    combined.status=parts.some(p=>p.status==='running')?'running':parts.every(p=>p.status==='completed')?'completed':parts.some(p=>p.status==='interrupted')?'interrupted':parts.some(p=>p.status==='partial'||p.status==='completed')?'partial':'failed';
    combined.completedAt=combined.status==='running'?null:parts.map(p=>p.completedAt).filter(Boolean).sort().at(-1)??null;
    return combined;
  }
  async function recover(){return serial(async()=>{
    for(const stored of records.values())if(stored.status==='running'){
      const run=copy(stored);run.status='interrupted';run.completedAt=now();run.error=safeFailure({code:'interrupted'});
      for(const node of run.nodes)if(node.status==='running'){node.status='failed';node.completedAt=run.completedAt;node.durationMs=elapsed(node.startedAt,node.completedAt);node.error=safeFailure({code:'interrupted'});}
      settlePending(run,'服务停止，节点未执行。');await persist(run);
    }
  });}
  async function release(){if(closed)return;closed=true;await lock.close();await directoryWithoutLinks(directory);const owner=JSON.parse(await readFileWithoutLinks(lockPath));if(owner.nonce!==nonce)throw locked();await fs.unlink(lockPath);}
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,nonce}));await lock.sync();
    if(beforeLoad)await beforeLoad({path:lockPath,pid:process.pid,nonce});
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw traceError('trace_path','追踪目录中存在符号链接，拒绝读取。',500);
      if(!entry.name.endsWith('.json'))continue;
      const id=checkId(entry.name.slice(0,-5));let run;
      try{run=JSON.parse(await readFileWithoutLinks(filename(id)));}catch(error){if(error instanceof WorkflowTraceError)throw error;throw traceError('trace_storage','运行记录无法读取，原文件已保留。',500);}
      records.set(id,validateLoaded(run,id));
    }
    await recover();
  }catch(error){await release().catch(()=>{});throw error;}
  function pagedRun(id,{offset=0,limit=50,nodeId}={}){
    checkId(id);const run=records.get(id);if(!run)return null;
    const parts=run.meta?.parentRunId===run.id?[...records.values()].filter(p=>p.taskId===run.taskId&&p.meta?.parentRunId===run.id).sort((a,b)=>(a.meta.part||1)-(b.meta.part||1)):[run],nodes=parts.flatMap(p=>p.nodes);
    if(nodeId){checkId(nodeId);const node=nodes.find(n=>n.id===nodeId);if(!node)throw traceError('trace_node','运行节点不存在。',404);return copy(node);}
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw traceError('trace_page','运行记录分页无效。');
    const result=copy({...run,nodes:[]});if(parts.length>1){result.status=parts.some(p=>p.status==='running')?'running':parts.every(p=>p.status==='completed')?'completed':parts.some(p=>p.status==='interrupted')?'interrupted':parts.some(p=>p.status==='partial'||p.status==='completed')?'partial':'failed';result.completedAt=result.status==='running'?null:parts.map(p=>p.completedAt).filter(Boolean).sort().at(-1)??null;}
    result.nodes=nodes.slice(offset,offset+limit).map(({input,output,...node})=>({...copy(node),input:null,output:null,snapshotDeferred:true}));return{...result,metadataOnly:true,offset,totalNodes:nodes.length,completedNodes:nodes.filter(n=>n.status==='completed').length};
  }
  return {
    begin(input){return serial(async()=>{
      if(!plain(input))throw traceError('trace_input','运行输入无效。');
      const {id,taskId,engine,kind,nodes=WORKFLOW_NODES,meta}=input;checkId(id);checkId(taskId);
      if(records.has(id))throw traceError('trace_exists','运行标识已存在，请使用新的运行标识。',409);
      if(typeof engine!=='string'||!engine.trim()||engine.length>80||typeof kind!=='string'||!kind.trim()||kind.length>80||!Array.isArray(nodes)||!nodes.length||nodes.length>MAX_NODES)throw traceError('trace_input','运行引擎、类型或节点定义无效。');
      const nodeList=nodes.map(def=>{const item=typeof def==='string'?(WORKFLOW_NODES.find(n=>n.id===def)||{id:def,label:def}):def;
        if(!plain(item))throw traceError('trace_node','节点定义无效。');checkId(item.id);if(typeof item.label!=='string'||!item.label.trim()||item.label.length>100)throw traceError('trace_node','节点名称无效。');
        return {id:item.id,label:item.label,status:'pending',startedAt:null,completedAt:null,durationMs:null,input:null,output:null,error:null};});
      if(new Set(nodeList.map(n=>n.id)).size!==nodeList.length)throw traceError('trace_node','节点标识不可重复。');
      const run={schemaVersion:1,id,taskId,engine,kind,status:'running',startedAt:now(),completedAt:null,nodes:nodeList,...(meta!==undefined?{meta:snapshot(meta)}:{})};
      return persist(run,{fresh:true});
    });},
    appendNodes(id,definitions){return serial(async()=>{
      const run=requireRunning(id);
      if(!Array.isArray(definitions)||!definitions.length||run.nodes.length+definitions.length>MAX_NODES)throw traceError('trace_node','新增运行节点超出范围。');
      const ids=new Set(run.nodes.map(n=>n.id));
      for(const item of definitions){if(!plain(item))throw traceError('trace_node','节点定义无效。');checkId(item.id);if(ids.has(item.id)||typeof item.label!=='string'||!item.label.trim()||item.label.length>100)throw traceError('trace_node','节点名称或标识无效。');ids.add(item.id);run.nodes.push({id:item.id,label:item.label,status:'pending',startedAt:null,completedAt:null,durationMs:null,input:null,output:null,error:null});}
      return persist(run);
    });},
    async step(id,nodeId,input,operation){
      if(typeof operation!=='function')throw traceError('trace_input','节点操作须为服务端函数。');
      await serial(async()=>{const run=requireRunning(id),node=requireNode(run,nodeId);if(node.status!=='pending')throw traceError('trace_state','节点已经执行或跳过。',409);
        node.input=snapshot(input);node.status='running';node.startedAt=now();await persist(run);});
      let output;
      try{
        output=await operation();
        await serial(async()=>{const run=requireRunning(id),node=requireNode(run,nodeId);if(node.status!=='running')throw traceError('trace_state','节点状态已变化。',409);
          node.output=snapshot(output);node.status='completed';node.completedAt=now();node.durationMs=elapsed(node.startedAt,node.completedAt);await persist(run);});
      }
      catch(error){
        try{await serial(async()=>{const run=requireRunning(id),node=requireNode(run,nodeId);if(node.status!=='running')throw traceError('trace_state','节点状态已变化。',409);node.status='failed';node.completedAt=now();node.durationMs=elapsed(node.startedAt,node.completedAt);node.error=safeFailure(error);if(error?.traceOutput!==undefined)node.output=snapshot(error.traceOutput);await persist(run);});}
        catch(traceFailure){throw traceError('trace_storage','节点执行失败且运行记录未能保存。',500);}
        throw error;
      }
      return output;
    },
    skip(id,nodeId,reason){return serial(async()=>{const run=requireRunning(id),node=requireNode(run,nodeId);if(node.status!=='pending')throw traceError('trace_state','只能跳过尚未执行的节点。',409);
      if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw traceError('trace_input','请提供有效的跳过原因。');
      node.status='skipped';node.completedAt=now();node.output={reason};await persist(run);return copy(node);});},
    finish(id,{status,summary:result,error}={}){return serial(async()=>{const run=requireRunning(id);if(!FINAL_STATUSES.has(status))throw traceError('trace_state','运行结束状态无效。');
      if(run.nodes.some(n=>n.status==='running'))throw traceError('trace_state','仍有执行中的节点，不能结束运行。',409);
      run.status=status;run.completedAt=now();if(result!==undefined)run.summary=snapshot(result);if(error)run.error=safeFailure(error);
      settlePending(run,'本次运行未执行此节点。');return persist(run);});},
    readPage(id,options){return serial(async()=>pagedRun(id,options));},
    read(id){return serial(async()=>{checkId(id);await directoryWithoutLinks(directory);const stat=await regularFile(filename(id),{optional:true});if(!stat)return null;const run=records.get(id)||validateLoaded(JSON.parse(await readFileWithoutLinks(filename(id))),id);const logical=logicalRun(run);for(const part of logical.meta?.tracePartIds||[])await regularFile(filename(part));return copy(logical);});},
    list(taskId,{compact=false}={}){return serial(async()=>{checkId(taskId);await directoryWithoutLinks(directory);return [...records.values()].filter(run=>run.taskId===taskId&&(!run.meta?.parentRunId||run.meta.parentRunId===run.id)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.id.localeCompare(a.id)).map(run=>compact?summary({...pagedRun(run.id,{limit:1}),nodes:[]}):summary(logicalRun(run)));});},
    recover,
    close(){if(closePromise)return closePromise;closing=true;closePromise=queue.then(release);return closePromise;},
  };
}
