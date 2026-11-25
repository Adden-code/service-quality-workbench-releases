import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {decodeWorkspaceArchive,MAX_BACKUP_BYTES,isLocalWorkspaceOutput} from './workspace-archive.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const folded=value=>process.platform==='win32'?value.toLowerCase():value;
const inside=(root,file)=>folded(file).startsWith(folded(root)+path.sep);
const same=(a,b)=>a.ino===b.ino&&a.dev===b.dev&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
const absent=error=>error.code==='ENOENT';
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
const issue=(message,details={})=>Object.assign(new Error(message),{code:'STARTUP_MAINTENANCE',...details});
export const startupAuditPath=dataDir=>path.join(path.resolve(dataDir),'logs','startup-maintenance.jsonl');
const auditFiles=dataDir=>[path.resolve(dataDir)+'.startup-maintenance.jsonl',startupAuditPath(dataDir)];
async function plainAncestors(directory){
 const root=path.parse(directory).root;let current=root;
 for(const part of directory.slice(root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);const stat=await fs.lstat(current);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw issue(`目录链接或非普通目录已保留：${current}。请维护人检查路径归属。`);
 }
}
async function stat(file){try{return await fs.lstat(file);}catch(error){if(absent(error))return null;throw error;}}
export async function appendStartupAudit(dataDir,event){
 const root=path.resolve(dataDir),file=startupAuditPath(root),logs=path.dirname(file);await plainAncestors(root);
 try{await fs.mkdir(logs,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 await plainAncestors(logs);
 const previous=await stat(file);if(previous&&(!previous.isFile()||previous.isSymbolicLink()||previous.nlink!==1))throw issue(`审计文件不能安全写入：${file}。请维护人检查，原件已保留。`);
 let handle;
 try{
  handle=await fs.open(file,constants.O_APPEND|constants.O_CREAT|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
  const opened=await handle.stat(),current=await fs.lstat(file);
  if(!opened.isFile()||opened.nlink!==1||current.isSymbolicLink()||opened.ino!==current.ino||opened.dev!==current.dev)throw issue(`审计文件路径发生变化：${file}`);
  await handle.writeFile(JSON.stringify({schemaVersion:1,at:new Date().toISOString(),dataDir:root,...event})+'\n');await handle.sync();
 }finally{await handle?.close();}
 return file;
}
async function readStartupAudit(dataDir){
 const root=path.resolve(dataDir),events=[];
 for(const file of auditFiles(root)){
  const info=await stat(file);if(!info)continue;await plainAncestors(path.dirname(file));
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>32*1024*1024)throw issue(`自动备份审计不能安全核验：${file}；未清理备份。`);
  for(const line of (await fs.readFile(file,'utf8')).split('\n')){let event;try{event=JSON.parse(line);}catch{continue;}if(event?.schemaVersion===1&&event.dataDir===root)events.push(event);}
 }
 return events;
}
export async function auditStartupRefusal(dataDir,error){
 try{await appendStartupAudit(dataDir,{action:'startup-refused',path:error.path||'.',detail:String(error.message),code:error.code||null});}
 catch(auditError){error.message+=`；审计写入失败：${auditError.message}`;}
 return error;
}
export async function startupMaintenanceEvents(dataDir){
 const events=[];
 for(const file of auditFiles(dataDir)){let handle;try{
  const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)continue;await plainAncestors(path.dirname(file));
  handle=await fs.open(file,'r');const length=Math.min(info.size,64*1024),bytes=Buffer.alloc(length);await handle.read(bytes,0,length,info.size-length);
  events.push(...bytes.toString('utf8').split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(event=>event?.schemaVersion===1&&event.dataDir===path.resolve(dataDir)));
 }catch{/* Missing or unsafe audit paths never prevent a read-only startup. */}finally{await handle?.close();}}
 return events.slice(-30).map(event=>({at:event.at,action:event.action,path:event.path||(event.backupPath?path.basename(event.backupPath):''),status:/refused|failed/.test(event.action)?'attention':/intent/.test(event.action)?'pending':'completed'}));
}

/** Called only after all writer locks have been acquired, before job services
 * start. Nonce checks also reject another owner in this same Node process. */
export async function recoverStartupCreatingFiles({dataDir,ownedLocks=[]}){
 const root=path.resolve(dataDir),auditPath=startupAuditPath(root),runId=randomBytes(16).toString('hex'),cleaned=[],refused=[],quarantined=[];
 const expected=new Map(ownedLocks.map(owner=>[relative(root,owner.path),owner]));
 async function locks(){
  await plainAncestors(root);
  for(const name of ['.workspace-control.lock','.workspace.lock','workflow-runs/.workflow.lock']){
   const own=expected.get(name),file=path.join(root,...name.split('/')),info=await stat(file);
   if(!own||own.pid!==process.pid||!info?.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>8192)throw issue(`无法核验写入锁 ${name}，未清理任何后续临时文件。请关闭占用此数据目录的实例并联系维护人检查该锁。`,{path:name});
   const value=JSON.parse(await fs.readFile(file,'utf8'));
   if(value.pid!==own.pid||value.nonce!==own.nonce)throw issue(`写入锁 ${name} 的归属已改变，已停止清理。请关闭占用实例后检查。`,{path:name});
  }
  const name='.portable-instance.lock',file=path.join(root,name),info=await stat(file);
  if(info){
   if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>8192)throw issue(`实例锁 ${name} 无法核验，未清理临时文件。`,{path:name});
   let value;try{value=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw issue(`实例锁 ${name} 损坏，未清理临时文件。请维护人核对实例状态。`,{path:name});}
   if(!Number.isSafeInteger(value.pid)||value.pid<1||typeof value.nonce!=='string'||!value.nonce)throw issue(`实例锁 ${name} 无法核验，未清理临时文件。`,{path:name});
   let dead=false;try{process.kill(value.pid,0);}catch(error){dead=error.code==='ESRCH';}
   if(!dead&&(value.pid!==process.pid||typeof value.dataDir!=='string'||folded(path.resolve(value.dataDir))!==folded(root)))throw issue(`实例锁 ${name} 仍由其他运行实例持有，未清理临时文件。请先关闭该实例。`,{path:name});
  }
 }
 let auditWarning;
 async function record(action,entry,{required=false}={}){
  try{await appendStartupAudit(root,{runId,action,...entry});}
  catch(error){auditWarning=`审计无法安全写入，未执行需要审计的后续清理：${error.message}`;if(!refused.some(item=>item.path==='logs/startup-maintenance.jsonl'))refused.push({path:'logs/startup-maintenance.jsonl',reason:auditWarning});if(required)throw error;}
 }
 try{await locks();}catch(error){await record('cleanup-refused',{path:error.path||'.',reason:error.message});throw error;}
 const real=await fs.realpath(root),candidates=[];
 async function stagedDirectory(file,name){
  const parts=name.split('/'),match=/^\.creating-([A-Za-z0-9][A-Za-z0-9_-]{0,79})-([a-f0-9]{16})$/.exec(parts[1]||'');
  if(parts.length!==2||!['report-jobs','content-translations'].includes(parts[0])||!match)throw issue('不是程序可确认的交付或翻译暂存目录。');
  const files=[];
  for(const entry of await fs.readdir(file,{withFileTypes:true})){
   if(!/^(snapshot|job)\.json(?:\.[a-f0-9]{16}\.tmp)?$/.test(entry.name))throw issue(`暂存目录含未知条目 ${entry.name}。`);
   const full=path.join(file,entry.name),info=await fs.lstat(full);
   if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>64*1024*1024||!inside(real,await fs.realpath(full)))throw issue(`暂存条目 ${entry.name} 不是安全的普通文件。`);
   if(entry.name.endsWith('.json')){
    let value;try{value=JSON.parse(await fs.readFile(full,'utf8'));}catch{throw issue(`暂存条目 ${entry.name} 的完整 JSON 损坏。`);}
    if(!value||typeof value!=='object'||Array.isArray(value))throw issue(`暂存条目 ${entry.name} 的结构异常。`);
    if(entry.name==='job.json'&&(value.id!==match[1]||value.schemaVersion!==1||!Array.isArray(value.units)))throw issue('暂存任务身份与目录不一致。');
   }
   files.push({name:entry.name,info});
  }
  return files;
 }
 async function refuse(name,reason){const item={path:name,reason};refused.push(item);await record('cleanup-refused',item);}
 async function walk(dir,depth=0){
  if(depth>32){await refuse(relative(root,dir),'目录超过 32 层，保留并请维护人检查。');return;}
  await plainAncestors(dir);
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   // Browser caches and exported diagnostics have their own lifecycle. Never
   // inspect or clean their contents, including legacy .creating-* and links.
   if(depth===0&&isLocalWorkspaceOutput(entry.name))continue;
   const file=path.join(dir,entry.name),name=relative(root,file),info=await fs.lstat(file),temporary=entry.name.startsWith('.creating-');
   if(info.isSymbolicLink()){await refuse(name,'符号链接或目录联接，未跟随、未清理。');continue;}
   if(!inside(real,await fs.realpath(file))){await refuse(name,'解析后的路径超出工作区，未清理。');continue;}
   if(temporary){
    if(info.isDirectory()){
     try{candidates.push({file,name,info,staged:await stagedDirectory(file,name)});}catch(error){await refuse(name,`${error.message} 原件已保留，请维护人核对后移出工作区再启动。`);}
     continue;
    }
    if(!/^\.creating-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)||!info.isFile()||info.nlink!==1){await refuse(name,'不是可确认的普通临时文件（目录、硬链接或名称异常），原件保留。请关闭工作台后由维护人核对并移至工作区外再启动。');continue;}
    candidates.push({file,name,info});
   }else if(info.isDirectory())await walk(file,depth+1);
  }
 }
 await walk(root);
 for(const {file,name,info,staged} of candidates){
  try{
   await locks();await plainAncestors(path.dirname(file));const current=await fs.lstat(file);
   if(current.isSymbolicLink()||!same(info,current)||!inside(real,await fs.realpath(file)))throw issue('路径或文件在检查后改变，原件保留。');
   if(staged){
    if(!current.isDirectory())throw issue('暂存目录类型改变。');
    const again=await stagedDirectory(file,name);
    if(again.length!==staged.length||again.some(item=>!staged.some(old=>old.name===item.name&&same(old.info,item.info))))throw issue('暂存目录内容在检查后改变，原件保留。');
    // Preserve the interrupted write outside the backup scan. Never recursively
    // delete directory contents; the quarantine remains available for diagnosis.
    const quarantine=root+'.startup-recovery-'+randomBytes(8).toString('hex'),destination=path.join(quarantine,path.basename(file));
    await record('cleanup-quarantine-intent',{path:name,quarantinePath:destination},{required:true});await fs.mkdir(quarantine,{mode:0o700});await fs.rename(file,destination);cleaned.push(name);quarantined.push({path:name,quarantinePath:destination});await record('cleanup-quarantined',{path:name,quarantinePath:destination});
   }else{
    if(!current.isFile()||current.nlink!==1)throw issue('临时文件不是单链接普通文件。');
    await record('cleanup-intent',{path:name},{required:true});await fs.unlink(file);cleaned.push(name);await record('cleanup-removed',{path:name});
   }
  }catch(error){await refuse(name,error.message);}
 }
 const result={status:refused.length?'attention':cleaned.length?'recovered':'clean',cleaned,refused,quarantined,auditPath};
 if(candidates.length||refused.length)await record('cleanup-completed',{...result,auditPath:undefined});
 if(auditWarning){result.status='attention';result.warning=auditWarning;}return result;
}

/** Run only after the current upgrade commits. Legacy automatic archives need
 * exact filename, archive integrity and immutable scene-history ancestry;
 * their filename alone never authorizes removal. A failed current attempt
 * cannot prune anything. A later success may retire its older safety copy. */
export async function pruneSuccessfulBuiltinBackups(dataDir,{limit=2,operationId,document}={}){
 const root=path.resolve(dataDir),parent=path.dirname(root),result={limit,retained:[],pruned:[],preserved:[],adopted:[]};
 await plainAncestors(parent);
 const entries=await readStartupAudit(root),created=new Map(),successful=new Set();
 for(const event of entries){
  if(event?.schemaVersion!==1||event.dataDir!==root||typeof event.operationId!=='string')continue;
  if(['backup-created','backup-legacy-adopted'].includes(event.action))created.set(event.backupPath,event);
  if(['upgrade-succeeded','upgrade-success-recovered'].includes(event.action))successful.add(event.operationId);
 }
 if(!operationId||!successful.has(operationId)||!document?.state)throw issue('本次内置升级尚无成功提交证明，未清理任何备份。');
 const history=new Set((document.state.sceneConfigurationEvents||[]).map(event=>sha(JSON.stringify(event)))),prefix=path.basename(root)+'.before-auto-builtin-';
 const candidates=(await fs.readdir(parent)).filter(name=>name.startsWith(prefix)&&/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}\.sqwb$/.test(name.slice(prefix.length))).sort().reverse();
 // The just-created safety copy is newest by operation order even when a local
 // clock correction makes its filename sort before an older snapshot.
 const currentBackup=[...created.values()].find(event=>event.operationId===operationId)?.backupPath,currentAt=candidates.indexOf(path.basename(currentBackup||''));
 if(currentAt>0)candidates.unshift(...candidates.splice(currentAt,1));
 for(const base of candidates){
  const backup=path.join(parent,base),record=created.get(backup);let event=record||{operationId:`legacy-${sha(base).slice(0,32)}`,backupPath:backup};
  const before=await stat(backup);if(!before)continue;
  try{
   if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>MAX_BACKUP_BYTES)throw issue('非普通备份文件或大小异常。');
   await plainAncestors(path.dirname(backup));const bytes=await fs.readFile(backup),after=await fs.lstat(backup);
   const fingerprint=sha(bytes);if(!same(before,after)||record&&fingerprint!==record.sha256)throw issue('备份已改变或摘要不匹配。');
   const decoded=decodeWorkspaceArchive(bytes);
   if(!record){
    const oldEvents=decoded.document.state.sceneConfigurationEvents||[],stamp=base.slice(prefix.length,-14).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,'T$1:$2:$3.$4Z');
    if(!Number.isFinite(Date.parse(stamp))||Math.abs(Date.parse(stamp)-Date.parse(decoded.manifest.createdAt))>120000||decoded.document.revision>document.revision||!oldEvents.some(e=>e.action==='builtin-install'&&Number.isFinite(Date.parse(e.at)))||oldEvents.some(e=>!history.has(sha(JSON.stringify(e)))))throw issue('旧自动快照无法通过创建时间、版本或工作区不可变场景历史确认来源，已保留。');
    event={...event,sha256:fingerprint};await appendStartupAudit(root,{...event,action:'backup-legacy-adopted',proof:'exact-name+valid-archive+immutable-scene-history'});result.adopted.push(backup);
   }
   if(result.retained.length<limit){result.retained.push(backup);continue;}
   await appendStartupAudit(root,{action:'backup-prune-intent',operationId:event.operationId,backupPath:backup,sha256:event.sha256});
   const final=await fs.lstat(backup);if(!same(after,final)||final.isSymbolicLink()||final.nlink!==1)throw issue('备份路径在清理前改变。');
   await fs.unlink(backup);result.pruned.push(backup);
   await appendStartupAudit(root,{action:'backup-pruned',operationId:event.operationId,backupPath:backup});
  }catch(error){result.preserved.push({path:backup,reason:error.message});await appendStartupAudit(root,{action:'backup-prune-refused',operationId:event.operationId,backupPath:backup,reason:error.message});}
 }
 if(result.preserved.length)result.warning=`${result.preserved.length} 份自动备份未能安全核验，已额外保留；请维护人查看审计。`;
 await appendStartupAudit(root,{action:'retention-completed',operationId,retained:result.retained,pruned:result.pruned,preservedCount:result.preserved.length});
 return result;
}

/** Resume only a durable successful commit. An interrupted pre-commit attempt
 * has neither a success record nor its expected immutable system events. */
export async function resumeBuiltinBackupRetention(dataDir,{document}={}){
 const events=await readStartupAudit(dataDir),completed=new Set(events.filter(e=>e.action==='retention-completed').map(e=>e.operationId)),created=events.filter(e=>e.action==='backup-created');
 let success=[...events].reverse().find(e=>['upgrade-succeeded','upgrade-success-recovered'].includes(e.action)&&!completed.has(e.operationId));
 if(!success){
  const saved=(document?.state?.sceneConfigurationEvents||[]);
  const pending=[...created].reverse().find(event=>{
   const proof=event.commitProof;if(completed.has(event.operationId)||!proof||!Number.isSafeInteger(proof.beforeRevision)||document?.revision<=proof.beforeRevision||!Array.isArray(proof.events)||!proof.events.length)return false;
   return proof.events.every(expected=>saved.some(actual=>actual.action==='system-upgrade'&&actual.id===expected.id&&actual.operationId===expected.operationId&&actual.seedHash===expected.seedHash&&actual.productVersion===expected.productVersion));
  });
  if(!pending)return null;
  success={action:'upgrade-success-recovered',operationId:pending.operationId,backupPath:pending.backupPath,seedId:pending.seedId,proof:'persisted-system-upgrade-events'};
  await appendStartupAudit(dataDir,success);
 }
 await appendStartupAudit(dataDir,{action:'retention-resumed',operationId:success.operationId,backupPath:success.backupPath});
 return {...await pruneSuccessfulBuiltinBackups(dataDir,{operationId:success.operationId,document}),resumed:true};
}
