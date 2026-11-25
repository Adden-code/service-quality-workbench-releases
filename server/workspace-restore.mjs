import {prepareTaskDeletion} from './task-deletion.mjs';
import {isRecordIndex,readRecordDocument} from './workspace-records.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createWorkspaceStore} from './workspace-store.mjs';
import {suspendRestoredCalibrations} from './rule-calibration.mjs';
import {WorkspaceError} from './workspace-validation.mjs';
import {encodeWorkspaceArchive,validateBackupDocument,validateBackupPath,backupSummary} from './workspace-archive.mjs';

// Runtime identity, credentials and logs remain in the stable data directory.
export const WORKSPACE_BUSINESS_ENTRIES=Object.freeze(['workspace.json','workspace-records','sources','workflow-runs','report-jobs','raw-structure','content-translations','report-cache','translation-cache','import-drafts','backups']);
const allowed=new Set(WORKSPACE_BUSINESS_ENTRIES),identifier=/^[a-f0-9]{32}$/;
const issue=(message,status=409)=>new WorkspaceError(message,status);
const missing=error=>error?.code==='ENOENT';

/** The HTTP owner must reject/drain all other requests before apply, including
 * settings writes and connection-test completion. This lifetime lock precedes
 * opening the workspace store, so another process cannot enter between swaps. */
export async function createWorkspaceRestore({dataDir,fsOps=fs,failurePoint=async()=>{}}={}){
 if(typeof dataDir!=='string'||!dataDir.trim())throw issue('请指定恢复目标工作区。',400);
 const root=path.resolve(dataDir),parent=path.dirname(root),stem=path.basename(root);
 if(parent===root)throw issue('工作区不能是磁盘根目录。',400);
 await fsOps.mkdir(root,{recursive:true});
 async function directory(dir){const stat=await fsOps.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw issue('工作区恢复路径必须为本机普通目录。');}
 let ancestor=path.parse(root).root;for(const part of root.slice(ancestor.length).split(path.sep).filter(Boolean)){ancestor=path.join(ancestor,part);await directory(ancestor);}
 const lockPath=path.join(root,'.workspace-control.lock'),journalPath=path.join(root,'.workspace-restore.json');
 const nonce=randomBytes(16).toString('hex'),stages=new Map(),retained=new Map();let lock,closed=false,applying=false,poisoned=false;
 const paths=id=>({stage:path.join(parent,`.${stem}.sqwb-stage-${id}`),old:path.join(parent,`.${stem}.sqwb-retained-${id}`),backup:path.join(parent,`${stem}-before-restore-${id}.sqwb`)});
 async function stat(file){try{return await fsOps.lstat(file);}catch(error){if(missing(error))return null;throw error;}}
 async function plain(file){const value=await stat(file);if(value&&(value.isSymbolicLink()||!value.isFile()&&!value.isDirectory()))throw issue('恢复目录包含不支持的文件类型。');return value;}
 async function syncDirectory(dir){let handle;try{handle=await fsOps.open(dir,'r');await handle.sync();}catch(error){if(!['EPERM','EISDIR','EINVAL','ENOTSUP','EBADF','EACCES'].includes(error.code))throw error;}finally{await handle?.close();}}
 async function atomic(file,value){const temp=`${file}.${randomBytes(12).toString('hex')}.tmp`;let handle;try{handle=await fsOps.open(temp,'wx',0o600);await handle.writeFile(value);await handle.sync();await handle.close();handle=null;await fsOps.rename(temp,file);await syncDirectory(path.dirname(file));}catch(error){await handle?.close().catch(()=>{});await fsOps.unlink(temp).catch(()=>{});throw error;}}
 async function durableRename(from,to){await fsOps.rename(from,to);await syncDirectory(path.dirname(from));if(path.dirname(from)!==path.dirname(to))await syncDirectory(path.dirname(to));}
 async function readOwner(file){const value=await stat(file);if(!value||!value.isFile()||value.isSymbolicLink()||value.size>8192)throw issue('工作区恢复锁无法核验，请检查原有进程。');let owner;try{owner=JSON.parse(await fsOps.readFile(file,'utf8'));}catch{throw issue('工作区恢复锁无法核验，请检查原有进程。');}if(!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.nonce!=='string'||!owner.nonce)throw issue('工作区恢复锁无法核验，请检查原有进程。');return owner;}
 function dead(owner){try{process.kill(owner.pid,0);return false;}catch(error){return error.code==='ESRCH';}}
 async function acquire(){
  try{return await fsOps.open(lockPath,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;}
  const original=await readOwner(lockPath);if(!dead(original))throw issue('工作区已有运行进程，不能同时备份恢复。');
  const recoveryPath=lockPath+'.recovery';let recovery;
  try{recovery=await fsOps.open(recoveryPath,'wx',0o600);}catch{throw issue('工作区锁正在恢复或需要人工检查。');}
  try{const current=await readOwner(lockPath);if(JSON.stringify(current)!==JSON.stringify(original)||!dead(current))throw issue('工作区进程锁已改变，恢复已取消。');await fsOps.unlink(lockPath);return await fsOps.open(lockPath,'wx',0o600);}
  finally{await recovery.close();await fsOps.unlink(recoveryPath).catch(()=>{});}
 }
 async function release(){if(closed)return;closed=true;await lock?.close();if(lock){const owner=await readOwner(lockPath).catch(()=>null);if(owner?.nonce===nonce)await fsOps.unlink(lockPath);}}
 function validateJournal(value){
  if(!value||value.version!==1||value.target!==root||!identifier.test(value.id)||!['swapping','committed'].includes(value.phase)||!Array.isArray(value.oldNames)||!Array.isArray(value.newNames)||[value.oldNames,value.newNames].some(names=>new Set(names).size!==names.length||names.some(name=>!allowed.has(name))))throw issue('工作区恢复日志无法核验，已保留原文件，请人工检查。',500);
  return value;
 }
 async function removeJournal(){await fsOps.unlink(journalPath);await syncDirectory(root);}
 async function rollback(journal){
  const p=paths(journal.id);await directory(p.stage);await directory(p.old);
  // Infer each completed rename from its source/destination. The durable journal
  // precedes every rename, so a crash before a progress write loses no information.
  for(const name of WORKSPACE_BUSINESS_ENTRIES){
   const current=path.join(root,name),old=path.join(p.old,name),incoming=path.join(p.stage,name);
   let currentStat=await plain(current),oldStat=await plain(old),incomingStat=await plain(incoming);
   const hadOld=journal.oldNames.includes(name),hasNew=journal.newNames.includes(name);
   if(!hadOld&&oldStat||!hasNew&&incomingStat)throw issue('恢复文件状态与日志冲突，原件保留。',500);
   if(hasNew&&!incomingStat){
    if(!currentStat)throw issue('待回退的新工作区条目缺失，原件保留。',500);
    // If an original existed, it must still be in retained storage until this
    // incoming entry is moved out. Never mistake an already restored original.
    if(hadOld&&!oldStat)throw issue('恢复前原件缺失，不能安全回退。',500);
    await durableRename(current,incoming);currentStat=null;incomingStat=await plain(incoming);
   }
   if(hadOld&&oldStat){if(currentStat)throw issue('恢复目标被其他文件占用，停止回退并保留原件。',500);await durableRename(old,current);currentStat=await plain(current);oldStat=null;}
   if(hadOld&&!currentStat||!hadOld&&currentStat)throw issue('回退后的工作区条目不一致，原件保留。',500);
  }
  await removeJournal();
 }
 async function recover(){
  const info=await stat(journalPath);if(!info)return;
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw issue('工作区恢复日志无效，已保留原件。',500);
  let journal;try{journal=validateJournal(JSON.parse(await fsOps.readFile(journalPath,'utf8')));}catch(error){throw error instanceof WorkspaceError?error:issue('工作区恢复日志损坏，已保留原件。',500);}
  if(journal.phase==='committed')await removeJournal();else await rollback(journal);
 }
 async function cleanExpiredStages(){
  // Only our stamped, unused staging directories expire. Retained originals and
  // selectable rollback packages have no automatic cleanup policy.
  const prefix=`.${stem}.sqwb-stage-`;
  for(const entry of await fsOps.readdir(parent,{withFileTypes:true})){
   if(!entry.name.startsWith(prefix)||!identifier.test(entry.name.slice(prefix.length))||!entry.isDirectory()||entry.isSymbolicLink())continue;
   const dir=path.join(parent,entry.name),marker=path.join(dir,'.sqwb-stage-info.json');
   try{const info=await stat(marker);if(!info?.isFile()||info.isSymbolicLink()||info.size>8192)continue;const value=JSON.parse(await fsOps.readFile(marker,'utf8'));if(value?.version===1&&value.target===root&&value.id===entry.name.slice(prefix.length)&&Number.isSafeInteger(value.createdAt)&&value.createdAt<=Date.now()-24*60*60*1000)await fsOps.rm(dir,{recursive:true,force:true});}catch{/* Unrecognized or inaccessible directories remain untouched. */}
  }
 }
 try{lock=await acquire();await lock.writeFile(JSON.stringify({pid:process.pid,nonce}));await lock.sync();await recover();await cleanExpiredStages();}catch(error){await release().catch(()=>{});throw error;}
 const usable=()=>{if(closed||poisoned)throw issue('工作区恢复服务已关闭或需要重新启动。',503);if(applying)throw issue('另一次工作区恢复正在进行。');};
 function stagedRecord(staged){const record=stages.get(staged?.id);if(!record||record.public!==staged)throw issue('恢复预览已过期，请重新选择备份。');return record;}
 async function preflight(decoded){
  usable();if(!(decoded?.files instanceof Map)||!decoded.files.has('workspace.json'))throw issue('备份内容无效。',400);
  const id=randomBytes(16).toString('hex'),p=paths(id);await fsOps.mkdir(p.stage,{mode:0o700});let validator;
  try{
   await atomic(path.join(p.stage,'.sqwb-stage-info.json'),JSON.stringify({version:1,id,target:root,createdAt:Date.now()}));
   for(const [name,bytes] of decoded.files){validateBackupPath(name);const file=path.join(p.stage,...name.split('/'));await fsOps.mkdir(path.dirname(file),{recursive:true,mode:0o700});let handle;try{handle=await fsOps.open(file,'wx',0o600);await handle.writeFile(bytes);await handle.sync();}finally{await handle?.close();}}
   // Empty directories do not occupy archive entries. Declare every business
   // directory before the journal, including those a reopening module creates.
   for(const name of WORKSPACE_BUSINESS_ENTRIES.filter(name=>name!=='workspace.json'))await fsOps.mkdir(path.join(p.stage,name),{recursive:true,mode:0o700});
   validator=await createWorkspaceStore({dataDir:p.stage,fsOps});const document=await validator.validateIntegrity();await validator.close();validator=null;
   const publicValue=Object.freeze({id,directory:p.stage,manifest:structuredClone(decoded.manifest),summary:backupSummary(document)});
   stages.set(id,{public:publicValue});return publicValue;
  }catch(error){await validator?.close().catch(()=>{});await fsOps.rm(p.stage,{recursive:true,force:true}).catch(()=>{});throw error;}
 }
 async function discard(staged){usable();const record=stagedRecord(staged);stages.delete(record.public.id);await fsOps.rm(record.public.directory,{recursive:true,force:true});}
 async function apply({staged,baseRevision,closeServices,openServices,taskDeletion}={}){
  usable();stagedRecord(staged);if(!Number.isSafeInteger(baseRevision)||baseRevision<1||typeof closeServices!=='function'||typeof openServices!=='function')throw issue('恢复请求缺少有效版本或服务控制。',400);
  applying=true;const p=paths(staged.id);let servicesClosed=false,servicesOpened=false,journal=null,committed=false;
  try{
   servicesClosed=true;await closeServices();
   const disk=JSON.parse(await fsOps.readFile(path.join(root,'workspace.json'),'utf8'));const before=validateBackupDocument(Buffer.from(JSON.stringify(isRecordIndex(disk)?await readRecordDocument(root,disk,{fsOps}):disk)));if(before.revision!==baseRevision)throw issue('工作区已在预览后改变，请重新预览后恢复。');
   // The rollback package is complete before any business entry moves. It is a
   // normal selectable .sqwb archive, not a private recovery-only directory.
   const original=await encodeWorkspaceArchive(root);let backup;try{backup=await fsOps.open(p.backup,'wx',0o600);await backup.writeFile(original.bytes);await backup.sync();}finally{await backup?.close();}await syncDirectory(parent);
   retained.set(staged.id,{path:p.backup,name:path.basename(p.backup)});
   const incoming=taskDeletion?prepareTaskDeletion(before,taskDeletion,{backupPath:p.backup}):validateBackupDocument(await fsOps.readFile(path.join(p.stage,'workspace.json')));
   const revision=Math.max(before.revision,incoming.revision)+1;if(!Number.isSafeInteger(revision))throw issue('工作区版本超出允许范围。');
   await atomic(path.join(p.stage,'workspace.json'),JSON.stringify({...incoming,state:taskDeletion?incoming.state:suspendRestoredCalibrations(incoming.state),revision,mutations:[]}));
   // Recheck all original sources after staging, before closing the old data.
   let validator;try{validator=await createWorkspaceStore({dataDir:p.stage,fsOps});await validator.validateIntegrity();}finally{await validator?.close();}
   const oldNames=[],newNames=[];for(const name of WORKSPACE_BUSINESS_ENTRIES){if(await plain(path.join(root,name)))oldNames.push(name);if(await plain(path.join(p.stage,name)))newNames.push(name);}
   await fsOps.mkdir(p.old,{mode:0o700});await syncDirectory(parent);
   journal={version:1,id:staged.id,target:root,phase:'swapping',oldNames,newNames};await atomic(journalPath,JSON.stringify(journal));await failurePoint('journal-written',{id:staged.id});
   for(const name of oldNames){await durableRename(path.join(root,name),path.join(p.old,name));await failurePoint('old-moved',{name,id:staged.id});}
   for(const name of newNames){await durableRename(path.join(p.stage,name),path.join(root,name));await failurePoint('new-moved',{name,id:staged.id});}
   servicesOpened=true;await openServices();await failurePoint('services-opened',{id:staged.id});
   journal={...journal,phase:'committed'};await atomic(journalPath,JSON.stringify(journal));committed=true;await failurePoint('committed',{id:staged.id});
   await removeJournal();stages.delete(staged.id);await fsOps.rm(p.stage,{recursive:true,force:true}).catch(()=>{});
   return {revision,backupId:staged.id,backupName:path.basename(p.backup),backupPath:p.backup,retainedPath:p.backup,retainedDirectory:p.old};
  }catch(error){
   if(error?.simulateCrash){poisoned=true;throw error;}
   // A committed restore remains committed even if journal cleanup fails.
   if(committed){poisoned=true;error.fatal=true;throw error;}
   try{if(servicesOpened){await closeServices();servicesOpened=false;}if(journal&&await stat(journalPath))await rollback(journal);if(servicesClosed)await openServices();}
   catch(recoveryError){poisoned=true;const failure=issue('恢复失败且自动回退未完成；已保留恢复日志、原件和备份，请重新启动后检查。',500);failure.fatal=true;failure.cause=recoveryError;throw failure;}
   throw error;
  }finally{applying=false;}
 }
 return {preflight,discard,apply,lockIdentity:()=>({path:lockPath,pid:process.pid,nonce}),
  async readRetained(id){if(!identifier.test(id)||!retained.has(id))throw issue('恢复前备份不存在或不属于本次服务。',404);const item=retained.get(id),info=await stat(item.path);if(!info?.isFile()||info.isSymbolicLink())throw issue('恢复前备份无法安全读取。',500);return{name:item.name,bytes:await fsOps.readFile(item.path)};},
  async close(){if(applying)throw issue('工作区正在恢复，暂时不能关闭恢复服务。');if(!closed&&!poisoned){let journalId=null;try{const saved=await stat(journalPath);if(saved)journalId=validateJournal(JSON.parse(await fsOps.readFile(journalPath,'utf8'))).id;}catch{journalId='unknown';}for(const [id,record] of stages)if(journalId!=='unknown'&&id!==journalId){await fsOps.rm(record.public.directory,{recursive:true,force:true}).catch(()=>{});stages.delete(id);}}await release();},
 };
}
