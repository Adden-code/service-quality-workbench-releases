import {createWorkspaceDecoder} from './workspace-decoder.mjs';
import {mergeWorkspacePatch,workspacePatch} from './workspace-patch.mjs';
import {createBusinessState} from './domain.mjs';
import {createBusinessCatalog,validateCatalog} from './catalog.mjs';
import {migrateBusinessWorkspace} from './business-state.mjs';
import {modelRequestTimeLimit} from './model-settings.mjs';

const STATE_KEY='mss-presales-qa-demo:v1';
const CATALOG_KEY='mss-presales-qa-catalog:v1';
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function stateCheck(state){
  if(!object(state)||state.schemaVersion!==1||!Array.isArray(state.tasks)||!Array.isArray(state.sessions)||!Array.isArray(state.activity)||!state.sessions.every(s=>object(s)&&object(s.review)&&object(s.review.drafts)&&Array.isArray(s.turns)&&Array.isArray(s.aiResults)))throw new Error('旧记录或工作区格式不匹配，请保留原记录后检查。');
}
function documentCheck(value){
  if(!object(value)||typeof value.initialized!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.token!=='string'||!value.token)throw new Error('工作区响应格式不匹配，请检查本地服务版本。');
  if(value.initialized){stateCheck(value.state);validateCatalog(value.catalog);}
  else if(value.revision!==0||value.state!==null||value.catalog!==null)throw new Error('未初始化工作区的响应格式不匹配。');
}
function failure(message,status){const error=new Error(message);error.status=status;return error;}
function reviewBasis(document,sessionId){
  const session=document.state?.sessions.find(item=>item.id===sessionId);
  const task=document.state?.tasks.find(item=>item.id===session?.taskId);
  if(!session||!task)return null;
  return JSON.stringify({session,basis:task.basisSnapshot,policy:task.reviewPolicy,lifecycle:task.lifecycle,scenario:task.scenarioSnapshot,calibrations:document.state?.ruleCalibrations,catalog:document.catalog});
}

export function createWorkspaceClient({fetchImpl=globalThis.fetch,storage=null,timeoutMs=15000,onChange=null,structuralSharing=false,incrementalTransport=typeof globalThis.Worker==='function',setTimer=setTimeout,clearTimer=clearTimeout}={}){
  const decoder=incrementalTransport?createWorkspaceDecoder({fetchImpl}):null;
  let acknowledged=null,pending=null,conflicted=false,queue=Promise.resolve(),sequence=0,modelConfig=null;
  const mutationId=()=>globalThis.crypto?.randomUUID?.()||`mutation-${Date.now()}-${++sequence}`;
  const serial=operation=>{const next=queue.then(operation);queue=next.catch(()=>{});return next;};
  const view=value=>structuralSharing?freeze(value):clone(value);
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
  function adopt(value){
    if(value.unchanged){acknowledged={...acknowledged,...value};return view(acknowledged);}
    if(value.patch)value=mergeWorkspacePatch(acknowledged,value);
    documentCheck(value);acknowledged=view(value);
    // A rendering observer cannot turn a confirmed disk write into an unknown write.
    try{onChange?.(view(acknowledged));}catch(error){console.error('工作区已保存，但页面更新失败。',error);}
    return view(acknowledged);
  }
  async function request(url,options={},timeLimit=timeoutMs){
    const controller=new AbortController(),timer=setTimer(()=>controller.abort(),timeLimit);
    const outerSignal=options.signal,cancel=()=>controller.abort();if(outerSignal?.aborted)controller.abort();outerSignal?.addEventListener('abort',cancel,{once:true});
    try{
      const response=await fetchImpl(url,{...options,headers:{...options.headers,...(incrementalTransport?{'X-Workspace-Sync':'records-v1','X-Workspace-Revision':String(acknowledged?.revision??-1),'X-Workspace-Epoch':acknowledged?.token||''}:{})},signal:controller.signal,credentials:'same-origin'});
      let value;
      try{value=decoder?await decoder.decode(await response.arrayBuffer(),{baseRevision:acknowledged?.revision,deadline:Date.now()+timeLimit}):await response.json();}catch(error){throw failure(decoder&&/工作区|后台数据/.test(error.message)?error.message:'本地服务返回了无法识别的结果，请检查服务版本。',response.ok?undefined:response.status);}
      if(!response.ok)throw failure(value?.error||`工作区请求失败（${response.status}）`,response.status);
      return value;
    }finally{clearTimer(timer);outerSignal?.removeEventListener('abort',cancel);}
  }
  async function readCurrent(){
    const value=await request(incrementalTransport?'/api/workspace?since='+(acknowledged?.revision??0):'/api/workspace');
    return value.patch?mergeWorkspacePatch(acknowledged,value):value.unchanged?{...acknowledged,...value}:value;
  }
  async function sendPending(){
    const record=pending;
    if(!record)throw new Error('没有等待重试的保存。');
    try{
      const value=await request(record.url||'/api/workspace',{method:record.url?'POST':'PUT',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:record.body});
      if(!value.patch&&!value.unchanged)documentCheck(value);pending=null;conflicted=false;return adopt(value);
    }catch(error){
      if(error.status){pending=null;if(error.status===409)conflicted=true;throw error;}
      throw failure('本次保存结果未确认，请先重试保存；原编辑内容仍保留。');
    }
  }
  function ensureWritable(){
    if(!acknowledged)throw new Error('工作区尚未加载。');
    if(pending)throw new Error('上次保存结果未确认，请先重试保存。');
    if(conflicted)throw new Error('工作区版本冲突，请保留编辑内容后重新加载。');
  }
  function prepare(next){
    stateCheck(next?.state);validateCatalog(next.catalog);
    pending={body:JSON.stringify({baseRevision:acknowledged.revision,mutationId:mutationId(),...(incrementalTransport&&acknowledged.initialized?{patch:workspacePatch(acknowledged,next)}:{state:next.state,catalog:next.catalog})})};
  }
  function legacy(){
    try{
      const stateRaw=storage?.getItem(STATE_KEY),catalogRaw=storage?.getItem(CATALOG_KEY);
      const state=stateRaw==null?createBusinessState():JSON.parse(stateRaw);
      const catalog=catalogRaw==null?createBusinessCatalog():JSON.parse(catalogRaw);
      stateCheck(state);validateCatalog(catalog);
      const migrated=migrateBusinessWorkspace({state,catalog});return {state:migrated.state,catalog:migrated.catalog};
    }catch(error){throw new Error(`旧记录迁移失败，原浏览器记录保持不变。${error.message}`);}
  }
  return {
    close(){decoder?.close?.();},
    readExecution(taskId,offset=0){return request('/api/tasks/'+encodeURIComponent(taskId)+'/execution?offset='+offset+'&limit=25');},
    get snapshot(){return view(acknowledged);},
    get revision(){return acknowledged?.revision;},
    get token(){return acknowledged?.token;},
    get supportsReviewCommands(){return acknowledged?.reviewCommands===true;},
    reviewCommand(input){return serial(async()=>{ensureWritable();const session=acknowledged.state.sessions.find(s=>s.id===input.sessionId);if(!session)throw new Error('会话不存在。');pending={url:'/api/review',body:JSON.stringify({...input,mutationId:mutationId(),baseRevision:acknowledged.revision,expected:JSON.stringify(session.review),expectedAI:JSON.stringify({aiResults:session.aiResults,aiExecution:session.aiExecution,aiDecision:session.aiDecision,sceneCapabilities:session.sceneCapabilities})})};return sendPending();});},
    get hasPending(){return Boolean(pending);},
    get conflicted(){return conflicted;},
    readCalibration(){return request('/api/rule-calibration',{headers:{'X-Workspace-Token':acknowledged.token}});},
    calibrate(input){return serial(async()=>{ensureWritable();const value=await request('/api/rule-calibration',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify(input)});return input.action==='preview'?value:adopt(value);});},
    deleteRule(input){return serial(async()=>{ensureWritable();return adopt(await request('/api/rules/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify(input)}));});},
    deleteTask(input){return serial(async()=>{
      ensureWritable();try{return adopt(await request('/api/tasks/delete',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify(input)},120000));}
      catch(error){if(error.status)throw error;const value=await readCurrent();documentCheck(value);adopt(value);if(value.state.taskDeletionAudit?.some(a=>a.task.id===input.taskId))return clone(value);throw new Error('删除结果尚未确认，已重新加载；请检查任务与删除审计。');}
    });},
    taskLifecycle(taskIds,action,options={}){return serial(async()=>{
      ensureWritable();
      try{return adopt(await request('/api/task-lifecycle',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify({taskIds,action,...options})}));}
      catch(error){
        if(error.status)throw error;
        const value=await readCurrent();documentCheck(value);adopt(value);
        const applied=taskIds.every(id=>{const life=value.state.tasks.find(task=>task.id===id)?.lifecycle;return action==='deliverable'?life?.deliverables?.some(item=>item.id===options.deliveryId):action==='void'?life?.voidedAt&&life.voidReason===options.reason?.trim():action==='archive'?!!life?.archivedAt:life&&!life.archivedAt;});
        if(applied)return clone(value);
        throw new Error('任务操作结果未确认，已重新加载；请核对任务状态后重试。');
      }
    });},
    readModelConfig(){return serial(async()=>{const value=await request('/api/model/config');modelConfig=clone(value);return value;});},
    configureScene(input){return serial(async()=>{ensureWritable();return adopt(await request('/api/scene-config',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify(input)},60000));});},
    prepareScenePackage(input){return serial(async()=>{ensureWritable();const approved=Object.fromEntries(['baseUrl','model','authMode','timeoutMs','reasoningEffort','maxTokens','deploymentRevision','reasoningConfigVersion'].map(key=>[key,modelConfig?.[key]]));return adopt(await request('/api/scene-config/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify({...input,consent:true,modelConfig:approved})},modelRequestTimeLimit(modelConfig||{})));});},
    saveModelConfig(changes){return serial(async()=>{ensureWritable();const value=await request('/api/model/config',{method:'PUT',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify(changes)},30000);modelConfig=clone(value);return value;});},
    testModel(){return serial(async()=>{ensureWritable();return request('/api/model/test',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:'{}'},modelRequestTimeLimit(modelConfig||{}));});},
    prepareRules(input){return serial(async()=>{ensureWritable();return request('/api/rules/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify(input)},modelRequestTimeLimit(modelConfig||{}));});},
    prepareImportMapping(input){return serial(async()=>{ensureWritable();const approved=Object.fromEntries(['baseUrl','model','authMode','timeoutMs','reasoningEffort','maxTokens','deploymentRevision','reasoningConfigVersion'].map(key=>[key,modelConfig?.[key]]));return request('/api/imports/prepare-mapping',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify({input,consent:true,modelConfig:approved})},modelRequestTimeLimit(modelConfig||{}));});},
    prepareConversationCleaning(input,{signal}={}){return serial(async()=>{ensureWritable();const fields=['baseUrl','model','authMode','timeoutMs','reasoningEffort','maxTokens','deploymentRevision','reasoningConfigVersion'],approved=Object.fromEntries(fields.map(k=>[k,modelConfig?.[k]]));return request('/api/conversations/clean',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify({input,consent:true,modelConfig:approved}),signal},modelRequestTimeLimit(modelConfig||{}));});},
    cancelQueuedAI(taskId){return serial(async()=>{ensureWritable();return adopt(await request(`/api/tasks/${encodeURIComponent(taskId)}/ai/cancel`,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:'{}'}));});},
    resumeAIQueue(){return serial(async()=>{ensureWritable();return adopt(await request('/api/ai/queue/resume',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:'{}'}));});},
    refresh(canAdopt=()=>true){return serial(async()=>{ensureWritable();const value=await request('/api/workspace?since='+acknowledged.revision);if(!value.patch&&!value.unchanged)documentCheck(value);return canAdopt()?adopt(value):null;});},
    pauseAI(taskId){return serial(async()=>{ensureWritable();return adopt(await request(`/api/tasks/${encodeURIComponent(taskId)}/ai/pause`,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:'{}'}));});},
    retryDependencies(taskId,sessionId){return serial(async()=>{ensureWritable();try{return adopt(await request(`/api/tasks/${encodeURIComponent(taskId)}/ai/retry-dependencies`,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify({sessionId})},Math.max(120000,modelRequestTimeLimit(modelConfig||{})*4)));}catch(error){if(error.status)throw error;adopt(await readCurrent());throw new Error('依赖项重试结果暂未确认，已刷新保存状态；请检查本行提示与运行记录后再操作。');}});},
    resumeAI(taskId){return serial(async()=>{ensureWritable();return adopt(await request(`/api/tasks/${encodeURIComponent(taskId)}/ai/resume`,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:'{}'}));});},
    startAI(taskId,runId,settings){return serial(async()=>{
      ensureWritable();
      try{return adopt(await request(`/api/ai/tasks/${encodeURIComponent(taskId)}`,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':acknowledged.token},body:JSON.stringify({runId,...(settings?{settings}:{})})}));}
      catch(error){
        if(error.status)throw error;
        // A lost acceptance must be reconciled before a new chargeable run.
        const value=await readCurrent();documentCheck(value);adopt(value);
        if(value.state.tasks.some(task=>[task.aiRun,...(task.aiRunHistory||[])].some(run=>run?.id===runId)))return clone(value);
        throw new Error('AI任务启动结果未确认，请刷新核对任务状态后再运行。');
      }
    });},
    load(){return serial(async()=>{
      if(pending)throw new Error('上次保存结果未确认，请先重试保存。');
      const value=await readCurrent();documentCheck(value);acknowledged=view(value);
      if(value.initialized){conflicted=false;return adopt(value);}
      const next=legacy();prepare(next);
      try{return await sendPending();}
      catch(error){
        // Only bootstrap may safely adopt a winning browser's initialization.
        if(error.status!==409)throw error;
        const winner=await readCurrent();documentCheck(winner);
        if(!winner.initialized)throw error;
        conflicted=false;return adopt(winner);
      }
    });},
    reload(){return serial(async()=>{
      if(pending)throw new Error('上次保存结果未确认，请先重试保存。');
      const value=await readCurrent();documentCheck(value);
      if(!value.initialized)throw new Error('服务端工作区尚未初始化，不能丢弃当前记录。');
      conflicted=false;return adopt(value);
    });},
    transact(updater,{reviewSessionId,reviewSessionIds}={}){return serial(async()=>{
      ensureWritable();if(typeof updater!=='function')throw new Error('保存操作必须提供状态变更函数。');
      const ids=reviewSessionIds||[reviewSessionId].filter(Boolean);
      const basis=document=>ids.length&&ids.every(id=>reviewBasis(document,id))?JSON.stringify(ids.map(id=>reviewBasis(document,id))):null;
      const baseline=basis(acknowledged);
      const current=clone({state:acknowledged.state,catalog:acknowledged.catalog});
      const next=await updater(current);prepare(next);
      try{return await sendPending();}
      catch(error){
        if(error.status!==409||!baseline)throw error;
        const latest=await readCurrent();documentCheck(latest);
        if(!latest.initialized||latest.token!==acknowledged.token||basis(latest)!==baseline)throw error;
        // A rejected revision has no write to reconcile. Reapply this review
        // once only when its record, frozen basis and catalog are unchanged.
        conflicted=false;adopt(latest);
        const updated=await updater(clone({state:latest.state,catalog:latest.catalog}));
        prepare(updated);return sendPending();
      }
    });},
    retryPending(){return serial(async()=>{
      if(conflicted)throw new Error('工作区版本冲突，请保留编辑内容后重新加载。');
      // A restarted local service issues a new token. Keep the same body and mutation ID.
      const value=await readCurrent();documentCheck(value);acknowledged={...acknowledged,token:value.token};
      return sendPending();
    });},
    importDraftRequest(url,{method='GET',body}={}){ensureWritable();return request(url,{method,headers:{'X-Workspace-Token':acknowledged.token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})},30000);},
    async uploadSource(file){
      ensureWritable();if(!file||typeof file.arrayBuffer!=='function'||!file.name)throw new Error('请选择可读取的原文件。');
      if(file.size>8*1024*1024)throw new Error('原文件大小超过8MB。');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(!bytes.byteLength||bytes.byteLength>8*1024*1024)throw new Error('原文件为空或大小超过8MB。');
      return request('/api/sources',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Workspace-Token':acknowledged.token,'X-File-Name':encodeURIComponent(file.name)},body:bytes});
    },
  };
}
