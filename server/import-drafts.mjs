import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {WorkspaceError} from './workspace-validation.mjs';

export const MAX_IMPORT_DRAFT_PAYLOAD_BYTES=8*1024*1024;
const MAX_RECORD_BYTES=16*1024*1024;
const MAX_DEPTH=40,MAX_NODES=250000;
const ID=/^(?:import-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const KINDS=new Set(['new-task','ecommerce-import','conversation-cleaning','input-mapping']);
const STATUSES=new Set(['draft','completed','discarded']);
const ACTIONS=new Set(['save','resume','discard','complete']);
const activeDirectories=new Set();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const input=(message,status=400)=>new WorkspaceError(message,status);
const storage=()=>input('导入草稿无法安全读取或保存，原有记录已保留。',500);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const exactKeys=(value,allowed,required=allowed)=>{
 if(!plain(value)||Object.getOwnPropertySymbols(value).length)return false;
 const descriptors=Object.getOwnPropertyDescriptors(value);
 return Object.keys(descriptors).every(key=>allowed.includes(key)&&own(descriptors[key],'value')&&descriptors[key].enumerable)&&required.every(key=>own(descriptors,key));
};
const time=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const keyName=key=>key.replace(/[^a-z0-9]/gi,'').toLowerCase();
const FORBIDDEN_KEYS=new Set([
 'apikey','apisecret','token','tokens','accesstoken','refreshtoken','idtoken','bearertoken','password','passwd','pwd','secret','secrets','credential','credentials','authorization','cookie','cookies',
 'config','modelconfig','providerconfig','connectionconfig','runtime','controller','abortcontroller','signal','promise','worker','file','filehandle','handle','returndialog','consentbinding','connectionconfirmedat',
 '__proto__','prototype','constructor',
]);

export function importDraftId(id){if(typeof id!=='string'||!ID.test(id))throw input('导入草稿标识须为安全 UUID。');return id;}
function baseRevision(value){if(!Number.isSafeInteger(value)||value<0)throw input('导入草稿保存版本无效。');return value;}
function safeName(value){if(typeof value!=='string'||!value.trim()||value.length>200||/[\\/\u0000-\u001f\u007f]/.test(value)||['.','..'].includes(value))throw input('导入草稿原文件名称无效。');return value;}
function sourceMetadata(value,{persisted=false}={}){
 if(!exactKeys(value,persisted?['sha256','name','size']:['sha256','name','size','createdAt'],['sha256','name','size'])||!HASH.test(value.sha256)||!Number.isSafeInteger(value.size)||value.size<1||value.size>8*1024*1024)throw input('导入草稿原文件引用无效。');
 return {sha256:value.sha256,name:safeName(value.name),size:value.size};
}

// Inspect descriptors before cloning: JSON.stringify must never execute accessors,
// toJSON methods, File handles, or other runtime objects while saving a draft.
function jsonSnapshot(value){
 const ancestors=new Set();let nodes=0;
 function visit(current,depth){
  if(depth>MAX_DEPTH||++nodes>MAX_NODES)throw input('导入草稿层级或节点数量超出限制。');
  if(current===null||typeof current==='string'||typeof current==='boolean')return;
  if(typeof current==='number'){if(!Number.isFinite(current))throw input('导入草稿包含非 JSON 数值。');return;}
  if(typeof current!=='object'||(Array.isArray(current)?Object.getPrototypeOf(current)!==Array.prototype:!plain(current))||ancestors.has(current))throw input('导入草稿仅可保存无循环的普通 JSON，不能包含文件或运行对象。');
  if(Object.getOwnPropertySymbols(current).length)throw input('导入草稿包含非 JSON 字段。');
  ancestors.add(current);
  const descriptors=Object.getOwnPropertyDescriptors(current),keys=Object.keys(descriptors);
  if(Array.isArray(current)){
   if(keys.length!==current.length+1)throw input('导入草稿数组包含空位或额外字段。');
   for(let index=0;index<current.length;index++){
    const descriptor=descriptors[index];if(!descriptor||!own(descriptor,'value')||!descriptor.enumerable)throw input('导入草稿数组不是普通 JSON。');visit(descriptor.value,depth+1);
   }
  }else for(const key of keys){
   const descriptor=descriptors[key],normalized=keyName(key);
   if(!own(descriptor,'value')||!descriptor.enumerable||FORBIDDEN_KEYS.has(key)||FORBIDDEN_KEYS.has(normalized)||(normalized==='consent'&&descriptor.value!==false&&descriptor.value!==null))throw input('导入草稿不能保存凭据、授权同意或运行配置字段。');
   visit(descriptor.value,depth+1);
  }
  ancestors.delete(current);
 }
 visit(value,0);const text=JSON.stringify(value);
 if(Buffer.byteLength(text)>MAX_IMPORT_DRAFT_PAYLOAD_BYTES)throw input('导入草稿快照超过8MB，请分批整理。',413);
 return JSON.parse(text);
}
const textSummary=(value,max=200)=>typeof value==='string'?value.slice(0,max):'';
const summary=draft=>({id:draft.id,revision:draft.revision,kind:draft.kind,sourceName:draft.source.name,scene:draft.scene,name:draft.name,status:draft.status,updatedAt:draft.updatedAt});

/**
 * One local import snapshot per <dataDir>/import-drafts/<UUID>.json, outside public.
 * The caller owns an open workspaceStore and closes this store before releasing its
 * workspace lock. Reads do not write; resume is an explicit revision-CAS mutation.
 *
 * Disk envelope: {schemaVersion:1,draft,sha256:SHA256(JSON.stringify(draft))}.
 * Draft: {schemaVersion:1,id,revision,kind,source:{sha256,name,size},payload,
 *   scene,name,status:'draft'|'completed'|'discarded',createdAt,updatedAt,
 *   taskId:null|string,audit:[{revision,action:'save'|'resume'|'discard'|'complete',at,taskId?}]}.
 * Audit and snapshot are replaced together; discard keeps metadata/audit and clears
 * payload. No method changes source bytes, creates a task, or calls a model.
 */
export async function createImportDraftStore({dataDir,workspaceStore,fsOps=fs}={}){
 if(typeof dataDir!=='string'||!dataDir.trim()||!workspaceStore||typeof workspaceStore.getSource!=='function'||typeof workspaceStore.read!=='function')throw input('请指定导入草稿数据目录及已打开的工作区。');
 const root=path.resolve(dataDir),directory=path.join(root,'import-drafts');
 const registryKey=process.platform==='win32'?root.toLowerCase():root;
 if(activeDirectories.has(registryKey))throw input('该工作区已有打开的导入草稿存储。',409);
 activeDirectories.add(registryKey);
 let closing=false,closePromise,tail=Promise.resolve();
 async function safeDirectory(dir,create=false){
  let stat;try{stat=await fsOps.lstat(dir);}catch(error){if(error.code!=='ENOENT'||!create)throw error;try{await fsOps.mkdir(dir,{mode:0o700});}catch(cause){if(cause.code!=='EEXIST')throw cause;}stat=await fsOps.lstat(dir);}
  if(!stat.isDirectory()||stat.isSymbolicLink())throw storage();
 }
 async function guard(){
  const drive=path.parse(root).root;let ancestor=drive;await safeDirectory(ancestor);
  for(const part of root.slice(drive.length).split(path.sep).filter(Boolean)){ancestor=path.join(ancestor,part);await safeDirectory(ancestor);}
  await safeDirectory(directory);
 }
 try{
  const drive=path.parse(root).root;let ancestor=drive;await safeDirectory(ancestor);
  for(const part of root.slice(drive.length).split(path.sep).filter(Boolean)){ancestor=path.join(ancestor,part);await safeDirectory(ancestor);}
  await safeDirectory(directory,true);
 }catch{activeDirectories.delete(registryKey);throw storage();}
 const serial=operation=>{
  if(closing)return Promise.reject(input('导入草稿存储正在关闭或已关闭。',503));
  const pending=tail.then(operation).catch(error=>{throw error instanceof WorkspaceError?error:storage();});tail=pending.catch(()=>{});return pending;
 };
 const fileFor=id=>path.join(directory,`${importDraftId(id)}.json`);
 async function verifiedSource(value,persisted=false){
  const expected=sourceMetadata(value,{persisted});let saved;
  // workspaceStore owns these content-addressed files; only inspect their slots
  // before using its public source reader so a link cannot escape the data root.
  const slots=[path.join(root,'sources',expected.sha256),path.join(root,'sources',`${expected.sha256}.json`)];let before;
  try{
   await guard();await safeDirectory(path.join(root,'sources'));before=await Promise.all(slots.map(file=>fsOps.lstat(file)));
   if(before.some((stat,index)=>!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>(index===0?8*1024*1024:64*1024)))throw storage();
  }catch(error){if(error.code==='ENOENT')throw input('导入草稿原文件尚未保存或已损坏。');throw storage();}
  try{saved=await workspaceStore.getSource(expected.sha256);}catch{throw input('导入草稿原文件尚未保存或已损坏。');}
  await guard();await safeDirectory(path.join(root,'sources'));const after=await Promise.all(slots.map(file=>fsOps.lstat(file)));
  if(after.some((stat,index)=>!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.dev!==before[index].dev||stat.ino!==before[index].ino||stat.size!==before[index].size))throw storage();
  if(!saved||saved.sha256!==expected.sha256||saved.name!==expected.name||saved.size!==expected.size)throw input('导入草稿原文件名称、大小或摘要与已保存原件不一致。');
  return expected;
 }
 function validateDraft(value,id){
  if(!exactKeys(value,['schemaVersion','id','revision','kind','source','payload','scene','name','status','createdAt','updatedAt','taskId','audit'])||value.schemaVersion!==1||value.id!==id||!Number.isSafeInteger(value.revision)||value.revision<1||!KINDS.has(value.kind)||!STATUSES.has(value.status)||!time(value.createdAt)||!time(value.updatedAt)||value.createdAt>value.updatedAt||typeof value.scene!=='string'||value.scene.length>200||typeof value.name!=='string'||value.name.length>200||!Array.isArray(value.audit)||value.audit.length!==value.revision)throw storage();
  sourceMetadata(value.source,{persisted:true});jsonSnapshot(value.payload);
  for(let index=0;index<value.audit.length;index++){
   const event=value.audit[index];
   if(!exactKeys(event,['revision','action','at','taskId'],['revision','action','at'])||event.revision!==index+1||!ACTIONS.has(event.action)||!time(event.at)||(index===0&&event.action!=='save')||(index>0&&event.at<value.audit[index-1].at)||(['discard','complete'].includes(event.action)&&index!==value.audit.length-1)||(event.action==='complete'?(typeof event.taskId!=='string'||!event.taskId.trim()||event.taskId.length>160):own(event,'taskId')))throw storage();
  }
  const first=value.audit[0],last=value.audit.at(-1);
  if(first.at!==value.createdAt||last.at!==value.updatedAt||(value.status==='discarded'?(last.action!=='discard'||value.payload!==null||value.taskId!==null):value.status==='completed'?(last.action!=='complete'||last.taskId!==value.taskId):(!['save','resume'].includes(last.action)||value.taskId!==null)))throw storage();
  return value;
 }
 async function read(id,{required=true}={}){
  const file=fileFor(id);await guard();let handle;
  try{
   const stat=await fsOps.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_RECORD_BYTES)throw storage();
   handle=await fsOps.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const opened=await handle.stat();
   if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size>MAX_RECORD_BYTES)throw storage();
   const bytes=await handle.readFile();await handle.close();handle=null;await guard();
   const after=await fsOps.lstat(file);if(after.isSymbolicLink()||after.dev!==stat.dev||after.ino!==stat.ino||after.size!==bytes.length||bytes.length>MAX_RECORD_BYTES)throw storage();
   const envelope=JSON.parse(bytes.toString('utf8'));
   if(!exactKeys(envelope,['schemaVersion','draft','sha256'])||envelope.schemaVersion!==1||typeof envelope.sha256!=='string'||!HASH.test(envelope.sha256)||hash(JSON.stringify(envelope.draft))!==envelope.sha256)throw storage();
   const draft=validateDraft(envelope.draft,id);await verifiedSource(draft.source,true);return draft;
  }catch(error){
   if(error.code==='ENOENT'&&!handle){if(!required)return null;throw input('导入草稿不存在。',404);}
   throw storage();
  }finally{await handle?.close().catch(()=>{});}
 }
 async function atomic(id,draft){
  const file=fileFor(id),envelope={schemaVersion:1,draft,sha256:hash(JSON.stringify(draft))},bytes=Buffer.from(JSON.stringify(envelope));
  if(bytes.length>MAX_RECORD_BYTES)throw input('导入草稿审计记录超出保存限制。',413);
  await guard();const previous=await fsOps.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(previous&&(!previous.isFile()||previous.isSymbolicLink()||previous.nlink!==1))throw storage();
  const temporary=path.join(directory,`.${id}.${randomBytes(12).toString('hex')}.tmp`);let handle;
  try{
   handle=await fsOps.open(temporary,'wx',0o600);await guard();await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await guard();
   const current=await fsOps.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(current&&(!current.isFile()||current.isSymbolicLink()||current.nlink!==1)||Boolean(current)!==Boolean(previous)||(current&&previous&&(current.dev!==previous.dev||current.ino!==previous.ino||current.size!==previous.size)))throw storage();
   await fsOps.rename(temporary,file);
  }catch{await handle?.close().catch(()=>{});await fsOps.unlink(temporary).catch(()=>{});throw storage();}
  return structuredClone(draft);
 }
 const checkRevision=(draft,expected)=>{baseRevision(expected);if(expected!==(draft?.revision||0))throw input('导入草稿已被另一页面更新，请保留当前内容后重新加载。',409);};
 const ensureActive=draft=>{if(draft.status!=='draft')throw input('该导入草稿已完成或已放弃，不能继续修改。',409);};
 const advance=(draft,action,extra={})=>{
  const at=new Date(Math.max(Date.now(),Date.parse(draft.updatedAt))).toISOString(),revision=draft.revision+1;
  if(!Number.isSafeInteger(revision))throw storage();
  return {...draft,revision,updatedAt:at,audit:[...draft.audit,{revision,action,at,...extra}]};
 };
 function mutation(id,value,allowed,required=allowed){importDraftId(id);if(!exactKeys(value,allowed,required))throw input('导入草稿操作参数无效。');baseRevision(value.baseRevision);return value;}
 function scheduleMutation(id,value,allowed,prepare,operation){
  if(closing)return Promise.reject(input('导入草稿存储正在关闭或已关闭。',503));
  let captured;try{captured=prepare({...mutation(id,value,allowed)});}catch(error){return Promise.reject(error instanceof WorkspaceError?error:input('导入草稿操作参数无效。'));}
  return serial(()=>operation(captured));
 }
 return {
  list(){return serial(async()=>{await guard();const result=[];for(const entry of await fsOps.readdir(directory,{withFileTypes:true})){
   if(/^\.(?:import-)?[a-f0-9-]+\.[a-f0-9]{24}\.tmp$/.test(entry.name)){const stat=await fsOps.lstat(path.join(directory,entry.name));if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw storage();continue;}
   if(entry.isSymbolicLink()||!entry.isFile()||!entry.name.endsWith('.json'))throw storage();
   const id=entry.name.slice(0,-5);if(!ID.test(id))throw storage();result.push(summary(await read(id)));
  }return result.sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt)||left.id.localeCompare(right.id));});},
  get(id){return serial(()=>read(id));},
  put(id,value){return scheduleMutation(id,value,['baseRevision','kind','source','payload'],request=>{
   if(!KINDS.has(request.kind))throw input('不支持该导入草稿类型。');return {...request,payload:jsonSnapshot(request.payload),source:sourceMetadata(request.source)};
  },async request=>{
   const {payload}=request,source=await verifiedSource(request.source),previous=await read(id,{required:false});checkRevision(previous,request.baseRevision);if(previous)ensureActive(previous);
   const scene=textSummary(payload?.scene||payload?.draft?.scene||payload?.origin?.scene),name=textSummary(payload?.name||payload?.taskName||payload?.origin?.name||source.name);
   if(previous){const next={...advance(previous,'save'),kind:request.kind,source,payload,scene,name};return atomic(id,next);}
   const at=new Date().toISOString(),draft={schemaVersion:1,id,revision:1,kind:request.kind,source,payload,scene,name,status:'draft',createdAt:at,updatedAt:at,taskId:null,audit:[{revision:1,action:'save',at}]};return atomic(id,draft);
  });},
  resume(id,value){return scheduleMutation(id,value,['baseRevision'],request=>request,async request=>{const previous=await read(id);checkRevision(previous,request.baseRevision);ensureActive(previous);return atomic(id,advance(previous,'resume'));});},
  complete(id,value){return scheduleMutation(id,value,['baseRevision','taskId'],request=>{if(typeof request.taskId!=='string'||!request.taskId.trim()||request.taskId.length>160)throw input('关联任务标识无效。');return request;},async request=>{
   const previous=await read(id);checkRevision(previous,request.baseRevision);ensureActive(previous);
   const workspace=await workspaceStore.read(),task=workspace?.state?.tasks?.find(task=>task.id===request.taskId);
   if(!task)throw input('关联的正式任务尚未保存。',404);if(task.source?.sha256!==previous.source.sha256)throw input('关联任务与导入草稿的原文件不一致。');
   return atomic(id,{...advance(previous,'complete',{taskId:request.taskId}),status:'completed',taskId:request.taskId});
  });},
  discard(id,value){return scheduleMutation(id,value,['baseRevision'],request=>request,async request=>{const previous=await read(id);checkRevision(previous,request.baseRevision);ensureActive(previous);return atomic(id,{...advance(previous,'discard'),status:'discarded',payload:null});});},
  close(){if(closePromise)return closePromise;closing=true;closePromise=tail.finally(()=>{activeDirectories.delete(registryKey);});return closePromise;},
 };
}
