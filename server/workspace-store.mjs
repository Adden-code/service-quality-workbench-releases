import {nativeExecutionContext} from './native-language-execution.mjs';
import {nativeDisplayProjection} from './native-delivery.mjs';
import {assertNativeReportCoverage} from './native-report-language.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {workspaceLanguage,languageError,assertNativeStageReady} from '../public/workspace-language.mjs';
import {initializeLanguageGovernance,selectWorkspaceLanguage,diskLanguageHistory,verifyLanguageFiles,resolveNativeTaskMaterial,nativeLanguageReadiness} from './workspace-language-service.mjs';
import {validateBilingualMaterial,assertMaterialReleaseAllowed,freezeNativeLanguage,languageHash,languageCanonical,languageDiff} from './native-language-materials.mjs';
import {encodeWorkspaceArchive} from './workspace-archive.mjs';
import {productVersion} from '../packaging/version.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {createRecordWriter,isRecordIndex,readRecordDocument} from './workspace-records.mjs';
import {applyReviewCommand} from '../public/review-command.mjs';
import {workspacePatch,mergeWorkspacePatch} from '../public/workspace-patch.mjs';
import {installBuiltinSceneUpgrade,installEcommercePolicyUpgrade} from './builtin-scene-upgrade.mjs';
import {prepareAutomaticBuiltinUpgrade} from './startup-builtin-upgrade.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {WorkspaceError,object,canonical,validateWorkspace} from './workspace-validation.mjs';
import {migrateBusinessWorkspace} from '../public/business-state.mjs';
import {validateRuleSetCatalogTransition} from '../public/ecommerce-rule-sets.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {validateCatalogSeed} from './catalog-seed.mjs';
import {installSceneSeed,sceneSeedSources} from './scene-seed.mjs';
import {validateCleaningSource} from './conversation-cleaning-source.mjs';
import {migrateCatalogScenes} from '../public/catalog-scenes.mjs';
import {RAW_INPUT_MODE} from '../public/raw-transcript.mjs';
import {validateRawSource} from './raw-source.mjs';
import {migrateRuleKinds} from '../public/rule-kind.mjs';
import {applyTaskLifecycle,migrateTaskLifecycleStatus} from '../public/task-lifecycle.mjs';
import {deleteRetiredRule} from '../public/rule-deletion.mjs';
import {calibrationPreview,recordCalibration,changeCalibration,monitorCalibrations,calibrationMonitoring} from './rule-calibration.mjs';
import {migrateSceneConfigurations,sceneConfigurationMutation} from './scene-configuration-service.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const equalCatalog=(left,right)=>canonical(left)===canonical(right);
const HASH=/^[a-f0-9]{64}$/;
export const MAX_SOURCE_BYTES=8*1024*1024;
const MAX_WORKSPACE_BYTES=64*1024*1024;
function safeName(name){
  if(typeof name!=='string'||!name.trim()||name.length>200||/[\\/\u0000-\u001f\u007f]/.test(name)||['.','..'].includes(name))throw new WorkspaceError('原文件名称无效，不可包含目录或控制字符。');
  return name;
}
async function acquireLock(fsOps,lockPath){
  const unavailable=()=>new WorkspaceError('数据目录已有进程锁，无法启动第二个写入进程。无法确认归属的遗留锁需要人工检查。',409);
  try{return await fsOps.open(lockPath,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;}
  // 只回收可确认进程已经退出的锁；回收锁使多个启动者不能同时移除旧锁。
  async function deadOwner(expected){
    let owner,raw;try{raw=await fsOps.readFile(lockPath,'utf8');owner=JSON.parse(raw);}catch{throw unavailable();}
    if(!object(owner)||!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.nonce!=='string'||!owner.nonce||(expected!==undefined&&raw!==expected))throw unavailable();
    try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return raw;}
    throw unavailable();
  }
  const original=await deadOwner();const recoveryPath=`${lockPath}.recovery`;let recovery;
  try{recovery=await fsOps.open(recoveryPath,'wx',0o600);}catch{throw unavailable();}
  try{await deadOwner(original);await fsOps.unlink(lockPath);return await fsOps.open(lockPath,'wx',0o600);}
  finally{await recovery.close();await fsOps.unlink(recoveryPath).catch(()=>{});}
}

export async function createWorkspaceStore({dataDir,fsOps=fs,catalogSeed=null,sceneSeed=null,storageMode='single',nativeLanguageStage=0}={}){
  if(typeof dataDir!=='string'||!dataDir.trim())throw new WorkspaceError('请指定工作区数据目录。');
  const directory=path.resolve(dataDir),file=path.join(directory,'workspace.json'),lockPath=path.join(directory,'.workspace.lock'),sources=path.join(directory,'sources');
  await fsOps.mkdir(directory,{recursive:true});
  const lock=await acquireLock(fsOps,lockPath);
  let closed=false,closing=false,closePromise,queue=Promise.resolve();
  const nonce=randomBytes(16).toString('hex');
  const validatedCleaningSources=new Set();
  const validatedRawSources=new Set();
  async function release(){if(closed)return;closed=true;await lock.close();await fsOps.unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  let document={schemaVersion:1,revision:0,state:null,catalog:null,mutations:[]};
  let workspaceExists=false,split=storageMode==='sharded';const changes=[];const writeRecords=createRecordWriter(directory,{fsOps,atomicWrite});
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,nonce}));await lock.sync();
    try{
      const stat=await fsOps.stat(file);workspaceExists=true;if(stat.size>MAX_WORKSPACE_BYTES)throw new Error('文件超出大小限制');
      const originalBytes=await fsOps.readFile(file),disk=JSON.parse(originalBytes.toString('utf8'));if(isRecordIndex(disk))split=true;const loaded=isRecordIndex(disk)?await readRecordDocument(directory,disk,{fsOps}):disk;
      if(!object(loaded)||loaded.schemaVersion!==1||!Number.isSafeInteger(loaded.revision)||loaded.revision<1||!Array.isArray(loaded.mutations)||new Set(loaded.mutations.map(item=>item.id)).size!==loaded.mutations.length||loaded.mutations.some(item=>!object(item)||typeof item.id!=='string'||!HASH.test(item.digest)))throw new Error('保存结构不匹配');
      validateWorkspace(loaded.state,loaded.catalog);
      await verifyLanguageFiles(loaded.state,name=>fsOps.readFile(path.join(directory,name),'utf8'));
      await checkRawSources(loaded.state);
      const business=migrateBusinessWorkspace({state:loaded.state,catalog:loaded.catalog});
      const scenes=migrateCatalogScenes({state:business.state,catalog:business.catalog});
      const kinds=migrateRuleKinds(scenes);
      const lifecycle=migrateTaskLifecycleStatus(kinds);
      const migrated={...lifecycle,changed:business.changed||scenes.changed||kinds.changed||lifecycle.changed};
      if(migrated.changed){
        validateWorkspace(migrated.state,migrated.catalog);
        // A new exclusive file preserves the exact pre-migration bytes, including whitespace.
        const backupDirectory=path.join(directory,'backups');await fsOps.mkdir(backupDirectory,{recursive:true});
        const backupFile=path.join(backupDirectory,`workspace-before-business-v1-${new Date().toISOString().replaceAll(':','-')}-${randomBytes(12).toString('hex')}.json`);let backup;
        try{backup=await fsOps.open(backupFile,'wx',0o600);await backup.writeFile(isRecordIndex(disk)?JSON.stringify(loaded):originalBytes);await backup.sync();await backup.close();backup=null;}
        catch(error){if(backup)await backup.close().catch(()=>{});throw new Error(`迁移前原字节备份失败，尚未修改原文件：${error.message}`);}
        const upgraded={...loaded,revision:loaded.revision+1,state:migrated.state,catalog:migrated.catalog};
        try{if(split)await writeRecords(upgraded);else await atomicWrite(file,JSON.stringify(upgraded));}catch(error){throw new Error(`已生成迁移前备份，但迁移写入失败，原文件保留：${error.message}`);}
        document=upgraded;
      }else document=loaded;
      if(split&&!isRecordIndex(disk)){
        const backupDirectory=path.join(directory,'backups');await fsOps.mkdir(backupDirectory,{recursive:true});
        const backup=await fsOps.open(path.join(backupDirectory,`workspace-before-records-${Date.now()}-${randomBytes(8).toString('hex')}.json`),'wx',0o600);
        try{await backup.writeFile(originalBytes);await backup.sync();}finally{await backup.close();}
        await writeRecords(document);
      }
    }catch(error){
      if(error.code!=='ENOENT'||workspaceExists)throw new WorkspaceError(`工作区记录读取失败或损坏，原文件保留：${error.message}`,500);
      const input=typeof catalogSeed==='function'?await catalogSeed():catalogSeed;
      const sceneInput=typeof sceneSeed==='function'?await sceneSeed():sceneSeed;
      if(sceneInput&&!input)throw new WorkspaceError('内置场景配置缺少配套目录种子，未创建不完整工作区。',500);
      if(input!==null&&input!==undefined){
        let catalog;try{catalog=validateCatalogSeed(input);}catch(error){throw new WorkspaceError(`预置目录种子无效：${error.message}`,500);}
        const seedState=createBusinessState(),assigned=migrateRuleKinds(migrateCatalogScenes({state:seedState,catalog}));
        const initial={schemaVersion:1,revision:1,state:sceneInput?installSceneSeed(seedState,assigned.catalog,sceneInput):seedState,catalog:assigned.catalog,mutations:[]};validateWorkspace(initial.state,initial.catalog);
        if(sceneInput)await ensureSceneSeedSources(sceneInput);
        if(split)await writeRecords(initial);else await atomicWrite(file,JSON.stringify(initial));document=initial;
      }
    }
    await fsOps.mkdir(sources,{recursive:true});
  }catch(error){await release();throw error;}
  function serial(operation){if(closing||closed)return Promise.reject(new WorkspaceError('工作区正在关闭或已关闭，无法接收新写入。',503));const next=queue.then(operation);queue=next.catch(()=>{});return next;}
  async function atomicWrite(target,bytes){
    const temporary=path.join(path.dirname(target),`.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`);let handle;
    try{handle=await fsOps.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await fsOps.rename(temporary,target);let parent;try{parent=await fsOps.open(path.dirname(target),'r');await parent.sync();}catch(error){if(!['EPERM','EISDIR','EINVAL','ENOTSUP','EBADF','EACCES'].includes(error.code))throw error;}finally{await parent?.close();}}
    catch(error){if(handle)await handle.close().catch(()=>{});await fsOps.unlink(temporary).catch(()=>{});throw error;}
  }
  const read=async()=>({initialized:document.revision>0,revision:document.revision,state:clone(document.state),catalog:clone(document.catalog)});
  async function writeLanguageArtifact(hash,value){
    const target=path.join(directory,'language-materials',hash+'.json'),bytes=languageCanonical(value);
    await fsOps.mkdir(path.dirname(target),{recursive:true});
    try{const old=await fsOps.readFile(target,'utf8');if(old!==bytes)languageError('LANGUAGE_MATERIAL_IMMUTABLE','Immutable execution material already exists with different bytes.');return;}catch(e){if(e.code!=='ENOENT')throw e;}
    await atomicWrite(target,bytes);
  }
  async function sourceRecord(sha256){
    if(typeof sha256!=='string'||!HASH.test(sha256))throw new WorkspaceError('原文件摘要格式无效。');
    try{
      const metadata=JSON.parse(await fsOps.readFile(path.join(sources,`${sha256}.json`),'utf8'));
      if(!object(metadata)||metadata.sha256!==sha256||!Number.isSafeInteger(metadata.size)||metadata.size<1||metadata.size>MAX_SOURCE_BYTES)throw new Error('元数据损坏');safeName(metadata.name);
      const bytes=await fsOps.readFile(path.join(sources,sha256));if(bytes.length!==metadata.size||digest(bytes)!==sha256)throw new Error('原文件校验失败');
      return {metadata:{sha256,name:metadata.name,size:metadata.size,createdAt:metadata.createdAt},bytes};
    }catch(error){if(error.code==='ENOENT')throw new WorkspaceError('原文件不存在。',404);if(error instanceof WorkspaceError)throw error;throw new WorkspaceError('原文件无法读取或校验失败。',500);}
  }
  async function ensureSceneSeedSources(seed){
    await fsOps.mkdir(sources,{recursive:true});
    for(const item of sceneSeedSources(seed)){
      let saved;try{saved=await sourceRecord(item.sha256);}catch(error){if(error.status!==404)throw error;}
      if(saved){if(saved.metadata.name!==item.name||saved.metadata.size!==item.size)throw new WorkspaceError('内置原文与既有归档名称或大小不一致，原件保留。');continue;}
      await atomicWrite(path.join(sources,item.sha256),item.bytes);
      await atomicWrite(path.join(sources,`${item.sha256}.json`),JSON.stringify({sha256:item.sha256,name:item.name,size:item.size,createdAt:new Date().toISOString()}));
    }
  }
  const nativeMaterialCache=new Map();
  const publishedMaterialCache=new Map();let readinessCache;
  async function publishedMaterials(){
    const values=[];for(const ref of document.state?.languageMaterials?.releases||[]){let material=publishedMaterialCache.get(ref.contentHash);if(!material){material=JSON.parse(await fsOps.readFile(path.join(directory,'language-materials',ref.contentHash+'.json'),'utf8'));validateBilingualMaterial(material);assertMaterialReleaseAllowed(material);if(material.contentHash!==ref.contentHash)languageError('BILINGUAL_HASH_MISMATCH','Published material reference differs from its bytes.');publishedMaterialCache.set(ref.contentHash,material);}values.push(material);}return values;
  }
  async function nativeReadiness(){
    if(readinessCache?.revision===document.revision)return clone(readinessCache.value);
    const value=nativeLanguageReadiness(document.state,document.catalog,await publishedMaterials(),await selectedNativeFreeze());readinessCache={revision:document.revision,value};return clone(value);
  }
  async function selectedNativeFreeze(){
    const selected=new Map();
    for(const selection of [...(document.state?.languageAudit||[])].reverse().filter(e=>e.action==='freeze-material'&&e.after?.hash&&!e.after.taskId)){
      const ref=document.state.languageMaterials?.freezes?.find(r=>r.hash===selection.after.hash);if(!ref)languageError('LANGUAGE_FREEZE_INVALID','The explicitly selected release is missing from the frozen registry.');
      const value=JSON.parse(await fsOps.readFile(path.join(directory,'language-materials',ref.hash+'.json'),'utf8'));if(languageHash(value)!==ref.hash)languageError('LANGUAGE_FREEZE_INVALID','The selected release bytes do not match their immutable reference.');
      const scene=value.paired?.[0]?.scene;if(scene&&value.paired.every(m=>m.scene===scene)&&!selected.has(scene))selected.set(scene,value);
    }
    return [...selected.values()];
  }
  async function readNativeMaterial(task){
    const hash=task?.executionSnapshot?.languageMaterialRef;
    if(!HASH.test(hash||''))languageError('NATIVE_MATERIAL_INVALID','Missing frozen material reference.');
    const frozen=nativeMaterialCache.get(hash)||JSON.parse(await fsOps.readFile(path.join(directory,'language-materials',hash+'.json'),'utf8'));
    nativeExecutionContext(task,frozen);nativeMaterialCache.set(hash,frozen);return clone(frozen);
  }
  async function checkSources(state,catalog){
    for(const task of state.tasks||[])if(task.executionSnapshot?.languageExecution){
      if(nativeLanguageStage<2)languageError('NATIVE_LANGUAGE_STAGE_PENDING','Use a stage 2 or later interpreter for native task data.');
      await readNativeMaterial(task);
    }
    const sceneSources=[...(state.sceneConfigurations||[]).flatMap(c=>c.sourceRefs||[]),...(state.scenePackageDrafts||[]).flatMap(d=>d.package?.configuration?.sourceRefs||[])];
    for(const expected of sceneSources){const saved=(await sourceRecord(expected.sha256)).metadata;if(saved.name!==expected.name||saved.size!==expected.size)throw new WorkspaceError('场景规则文档与归档原件不一致。');}
    for(const task of state.tasks)if(task.source){
      let source;try{source=(await sourceRecord(task.source.sha256)).metadata;}catch{throw new WorkspaceError('任务关联的原文件尚未保存或已损坏。');}
      if(task.source.size!==undefined&&task.source.size!==source.size)throw new WorkspaceError('任务原文件大小与已保存文件不一致。');
      if(task.source.name!==source.name)throw new WorkspaceError('任务原文件名称与已保存元数据不一致。');
      if(task.cleaningReportSnapshot){
        const cacheKey=task.source.sha256+':'+digest(Buffer.from(canonical(task.cleaningReportSnapshot)));
        if(!validatedCleaningSources.has(cacheKey)){
          try{await validateCleaningSource(task.cleaningReportSnapshot,(await sourceRecord(task.source.sha256)).bytes,source);}catch(error){throw new WorkspaceError(error.message);}
          validatedCleaningSources.add(cacheKey);
        }
      }
    }
    for(const rule of [...(catalog?.rules||[]),...(catalog?.deletedRules||[]).map(item=>item.snapshot)])if(rule.provenance?.source){
      const expected=rule.provenance.source;let saved;
      try{saved=(await sourceRecord(expected.sha256)).metadata;}catch{throw new WorkspaceError('规则关联的原文件尚未保存或已损坏。');}
      if(saved.size!==expected.size||saved.name!==expected.name)throw new WorkspaceError('规则来源与已保存原文件不一致。');
    }
    await checkRawSources(state);
  }
  async function checkRawSources(state){
    for(const task of state.tasks.filter(task=>task.inputMode===RAW_INPUT_MODE)){
      try{
        const saved=await sourceRecord(task.source.sha256);
        if(task.source.name!==saved.metadata.name||task.source.size!==saved.metadata.size)throw new Error('原文任务归档来源元数据不一致。');
        const rows=task.sessionIds.map(id=>state.sessions.find(session=>session.id===id));
        // The archive bytes are hashed above on every save. Cache only the full
        // already-verified cell snapshot; any row/mapping/policy change gets a new key.
        const cacheKey=task.source.sha256+':'+digest(canonical({source:task.source,options:task.rawImportOptions,rows:rows.map(session=>session.rawTranscript)}));
        if(!validatedRawSources.has(cacheKey)){
          await validateRawSource(task,rows,saved.bytes,saved.metadata);
          validatedRawSources.add(cacheKey);
        }
      }catch(error){throw new WorkspaceError(`原文来源校验失败，原件保留：${error.message}`,error.status??400);}
    }
  }
  async function persist(next,{snapshot=true}={}){
    const patch=workspacePatch(document,next),baseRevision=document.revision;
    // AI updaters receive defensive clones. Reuse equal committed records after
    // validation so disk and HTTP shard caches do not re-encode the whole batch.
    const shared={...next.state};
    for(const key of ['tasks','sessions']){
      const old=new Map((document.state?.[key]||[]).map(row=>[row.id,row])),changed=new Set(patch[key].map(row=>row.id));
      shared[key]=next.state[key].map(row=>!changed.has(row.id)&&old.has(row.id)?old.get(row.id):row);
    }
    next={...next,state:shared,catalog:patch.catalog?next.catalog:document.catalog};
    try{if(split)await writeRecords(next);else{const bytes=JSON.stringify(next);if(Buffer.byteLength(bytes)>MAX_WORKSPACE_BYTES)throw new WorkspaceError('工作区大小超出保存限制。',413);await atomicWrite(file,bytes);}}
    catch(error){throw new WorkspaceError(`工作区未保存，原记录保留：${error.message}`,500);}
    document=next;changes.push({baseRevision,revision:next.revision,patch});while(changes.length>32)changes.shift();return snapshot?read():{revision:next.revision};
  }
  async function changesSince(revision){
    if(revision===document.revision)return{initialized:document.revision>0,revision,unchanged:true};
    const first=changes.findIndex(c=>c.baseRevision===revision);if(first<0)return read();
    const selected=changes.slice(first),patch={tasks:[],sessions:[],removedTasks:[],removedSessions:[],state:{}},tasks=new Map(),sessions=new Map(),removedTasks=new Set(),removedSessions=new Set();
    for(const change of selected){const p=change.patch;for(const [key,map,removed]of [['tasks',tasks,removedTasks],['sessions',sessions,removedSessions]]){for(const id of p[key==='tasks'?'removedTasks':'removedSessions']){map.delete(id);removed.add(id);}for(const item of p[key]){removed.delete(item.id);map.set(item.id,item);}}Object.assign(patch.state,p.state);if(p.catalog)patch.catalog=p.catalog;for(const key of ['tasksOrder','sessionsOrder'])if(p[key])patch[key]=p[key];}
    patch.tasks=[...tasks.values()];patch.sessions=[...sessions.values()];patch.removedTasks=[...removedTasks];patch.removedSessions=[...removedSessions];
    return clone({initialized:true,baseRevision:revision,revision:document.revision,patch});
  }
  return {
    installNativePilotMaterials(bundle){return serial(async()=>{
      if(nativeLanguageStage<4)languageError('NATIVE_LANGUAGE_STAGE_PENDING','Pilot installation requires the complete native interpreter.');
      if(workspaceLanguage(document.state)?.mode==='legacy-display-v1')return read();
      if(!object(bundle)||bundle.schemaVersion!==1||!['id','version'].every(k=>typeof bundle[k]==='string'&&bundle[k].trim())||!Array.isArray(bundle.materials)||!bundle.materials.length||!object(bundle.authorization))languageError('BILINGUAL_INVALID','Invalid shipped pilot material bundle.');
      const fingerprint=languageHash(bundle),id=`install-pilot-${bundle.id}-${bundle.version}`,prior=document.state.languageAudit?.find(e=>e.id===id);
      if(prior){if(prior.after?.bundleHash!==fingerprint)languageError('LANGUAGE_OPERATION_CONFLICT','Installed pilot version bytes changed; issue a new bundle version.');return read();}
      const state=clone(document.state),registry=state.languageMaterials||{schemaVersion:1,releases:[],freezes:[]},seen=new Set();
      for(const m of bundle.materials){
        validateBilingualMaterial(m);assertMaterialReleaseAllowed(m);
        if(m.review.status!=='pilot-unreviewed'||m.review.authorizationId!==bundle.authorization.authorizationId||m.review.actor!==bundle.authorization.actor||m.review.reason!==bundle.authorization.reason)languageError('BILINGUAL_INVALID','Pilot material authorization must match the shipped bundle.');
        const key=m.scene+'::'+m.id+'@'+m.version;if(seen.has(key))languageError('BILINGUAL_INVALID','Duplicate pilot material version.');seen.add(key);
        const previous=registry.releases.find(r=>r.contentHash===m.contentHash);
        // Source rule versions stay exact. A new explicitly versioned pilot
        // bundle may append new paired text bytes, retaining every old hash.
        if(!previous)registry.releases.push({id:m.id,version:m.version,scene:m.scene,contentHash:m.contentHash});
      }
      state.languageMaterials=registry;state.languageAudit=[...(state.languageAudit||[]),{id,action:'install-pilot-materials',actor:bundle.authorization.actor,at:new Date().toISOString(),reason:bundle.authorization.reason,before:null,after:{id:bundle.id,version:bundle.version,bundleHash:fingerprint,materialStatus:'pilot-unreviewed',scenes:[...new Set(bundle.materials.map(m=>m.scene))],materialHashes:bundle.materials.map(m=>m.contentHash)}}];
      validateWorkspace(state,document.catalog,document.state,{trustedLanguage:true});
      for(const m of bundle.materials)if(registry.releases.some(r=>r.contentHash===m.contentHash))await writeLanguageArtifact(m.contentHash,m);
      return persist({...document,state,revision:document.revision+1});
    });},
    enableLanguageGovernance(){return serial(async()=>{
      if(workspaceLanguage(document.state))return read();
      const externalHistory=await diskLanguageHistory(directory),at=new Date().toISOString(),id=`language-bootstrap-${randomBytes(12).toString('hex')}`;
      const state=initializeLanguageGovernance(document.state||createBusinessState(),{externalHistory,at,operationId:id});
      let backupPath=null;
      if(document.revision>0){const backup=await encodeWorkspaceArchive(directory,{appVersion:productVersion});backupPath=`backups/workspace-before-native-language-${Date.now()}-${randomBytes(6).toString('hex')}.sqwb`;await fsOps.mkdir(path.join(directory,'backups'),{recursive:true});await atomicWrite(path.join(directory,backupPath),backup.bytes);}
      state.languageAudit[0].backupPath=backupPath;
      const catalog=document.catalog||createBusinessCatalog();validateWorkspace(state,catalog,document.state,{trustedLanguage:true});
      return persist({...document,state,catalog,revision:document.revision+1});
    });},
    selectLanguage(input){return serial(async()=>{
      if(!object(input)||Object.keys(input).some(k=>!['language','actor','operationId','baseRevision'].includes(k))||!Number.isSafeInteger(input.baseRevision)||typeof input.operationId!=='string'||!input.operationId.trim()||input.operationId.length>128)languageError('LANGUAGE_SELECTION_INVALID','Invalid language selection operation.');
      const fingerprint=digest(canonical(input)),replay=document.mutations.find(m=>m.id===input.operationId);
      if(replay){if(replay.digest!==fingerprint)languageError('LANGUAGE_OPERATION_CONFLICT','The operation identifier belongs to a different selection.');return read();}
      if(input.baseRevision!==document.revision)languageError('LANGUAGE_REVISION_CONFLICT','Another page changed this workspace. Reload to use the saved language.');
      const state=selectWorkspaceLanguage(document.state,input);validateWorkspace(state,document.catalog,document.state,{trustedLanguage:true});
      return persist({...document,state,revision:document.revision+1,mutations:[...document.mutations,{id:input.operationId,digest:fingerprint}]});
    });},
    publishLanguageMaterial(input){return serial(async()=>{
      if(!object(input)||Object.keys(input).some(k=>!['baseRevision','operationId','material'].includes(k))||typeof input.operationId!=='string'||!input.operationId.trim()||input.operationId.length>128)languageError('BILINGUAL_INVALID','Invalid bilingual publication request.');
      const fingerprint=digest(canonical(input)),replay=document.mutations.find(m=>m.id===input.operationId);if(replay){if(replay.digest!==fingerprint)languageError('LANGUAGE_OPERATION_CONFLICT','Publication identifier was already used.');return read();}
      if(input.baseRevision!==document.revision)languageError('LANGUAGE_REVISION_CONFLICT','Reload the current workspace before publishing.');
      if(!workspaceLanguage(document.state))languageError('LANGUAGE_SELECTION_REQUIRED','Language governance has not been initialized.');
      validateBilingualMaterial(input.material);assertMaterialReleaseAllowed(input.material);
      if(input.material.review.status!=='approved-pair')languageError('BILINGUAL_REVIEW_REQUIRED','Business publication requires approved-pair review. Pilot materials use the separate audited bundle installation.');
      const state=clone(document.state),m=clone(input.material),registry=state.languageMaterials||{schemaVersion:1,releases:[],freezes:[]};
      if(registry.releases.some(r=>r.scene===m.scene&&r.id===m.id&&r.version===m.version))languageError('BILINGUAL_VERSION_EXISTS','This material version is already published; create a new version.');
      const oldRef=registry.releases.filter(r=>r.scene===m.scene&&r.id===m.id).at(-1),before=oldRef?JSON.parse(await fsOps.readFile(path.join(directory,'language-materials',oldRef.contentHash+'.json'),'utf8')):null;
      registry.releases.push({id:m.id,version:m.version,scene:m.scene,contentHash:m.contentHash});state.languageMaterials=registry;
      state.languageAudit.push({id:input.operationId,action:'publish-material',actor:m.review.reviewer,at:new Date().toISOString(),reason:m.review.reason,before,after:m,diff:languageDiff(before,m)});
      validateWorkspace(state,document.catalog,document.state,{trustedLanguage:true});
      await fsOps.mkdir(path.join(directory,'language-materials'),{recursive:true});await writeLanguageArtifact(m.contentHash,m);
      return persist({...document,state,revision:document.revision+1,mutations:[...document.mutations,{id:input.operationId,digest:fingerprint}]});
    });},
    freezeLanguageMaterial(input){return serial(async()=>{
      if(!object(input)||Object.keys(input).some(k=>!['baseRevision','operationId','materialHashes','promptId','glossaryId','actor','reason'].includes(k))||!['operationId','actor','reason'].every(k=>typeof input[k]==='string'&&input[k].trim()&&input[k].length<=500)||!Array.isArray(input.materialHashes)||input.materialHashes.some(h=>!HASH.test(h)))languageError('LANGUAGE_FREEZE_INVALID','Invalid language freeze request.');
      const fingerprint=digest(canonical(input)),replay=document.mutations.find(m=>m.id===input.operationId);if(replay){if(replay.digest!==fingerprint)languageError('LANGUAGE_OPERATION_CONFLICT','Freeze identifier was already used.');return read();}
      if(input.baseRevision!==document.revision)languageError('LANGUAGE_REVISION_CONFLICT','Reload before freezing language materials.');
      const registry=clone(document.state.languageMaterials||{schemaVersion:1,releases:[],freezes:[]}),materials=[];
      for(const hash of input.materialHashes){if(!registry.releases.some(r=>r.contentHash===hash))languageError('LANGUAGE_MATERIAL_MISSING','Only published materials may enter an execution snapshot.');materials.push(JSON.parse(await fsOps.readFile(path.join(directory,'language-materials',hash+'.json'),'utf8')));}
      const frozen=freezeNativeLanguage(workspaceLanguage(document.state),{materials,promptId:input.promptId,glossaryId:input.glossaryId,...(nativeLanguageStage>=2?{languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR}:{})}),hash=languageHash(frozen),state=clone(document.state);
      if(!registry.freezes.some(r=>r.hash===hash))registry.freezes.push({hash,languageExecution:frozen.languageExecution});state.languageMaterials=registry;
      state.languageAudit.push({id:input.operationId,action:'freeze-material',actor:input.actor,at:new Date().toISOString(),reason:input.reason,before:null,after:{hash,languageExecution:frozen.languageExecution}});
      validateWorkspace(state,document.catalog,document.state,{trustedLanguage:true});await writeLanguageArtifact(hash,frozen);
      return persist({...document,state,revision:document.revision+1,mutations:[...document.mutations,{id:input.operationId,digest:fingerprint}]});
    });},
    lockIdentity:()=>({path:lockPath,pid:process.pid,nonce}),
    read,changesSince,readNativeMaterial,nativeReadiness,
    // Internal immutable view: callers must never mutate or expose it to plugins.
    transportSnapshot:()=>({initialized:document.revision>0,revision:document.revision,state:document.state,catalog:document.catalog}),
    reviewCommand(input,{snapshot=true}={}){const request=clone(input);return serial(async()=>{
      if(!object(request)||typeof request.mutationId!=='string'||!request.mutationId||request.mutationId.length>128)throw new WorkspaceError('审核操作标识无效。');
      const fingerprint=digest(canonical(request)),replay=document.mutations.find(x=>x.id===request.mutationId);
      if(replay){if(replay.digest!==fingerprint)throw new WorkspaceError('相同操作标识对应不同请求。',409);return snapshot?read():{revision:document.revision};}
      const session=document.state?.sessions.find(s=>s.id===request.sessionId);
      if(!session||typeof request.expected!=='string'||JSON.stringify(session.review)!==request.expected)throw new WorkspaceError('当前会话已被更新，编辑内容保留；请重新加载核对。',409);
      if(request.expectedAI!==undefined&&JSON.stringify({aiResults:session.aiResults,aiExecution:session.aiExecution,aiDecision:session.aiDecision,sceneCapabilities:session.sceneCapabilities})!==request.expectedAI)throw new WorkspaceError('当前AI结论已更新，请重新核对。',409);
      let state;try{state=applyReviewCommand(document.state,request);}catch(error){throw new WorkspaceError(error.message,400);}
      validateWorkspace(state,document.catalog,document.state,{trustedReview:true});
      if(state.ruleCalibrations?.records?.some(r=>r.enabled&&!r.invalidatedAt)){const monitored=monitorCalibrations(state);validateWorkspace(monitored,document.catalog,state,{trustedCalibration:true});state=monitored;}
      return persist({...document,state,revision:document.revision+1,mutations:[...document.mutations,{id:request.mutationId,digest:fingerprint}]},{snapshot});
    });},
    migrateScenes(input){return serial(async()=>{
      if(!document.state)throw new WorkspaceError('请先初始化工作区。',409);
      const next=migrateSceneConfigurations(document,input);if(canonical(next)===canonical(document))return read();
      validateWorkspace(next.state,next.catalog,document.state,{trustedScene:true});await checkSources(next.state,next.catalog);
      return persist({...next,revision:document.revision+1});
    });},
    installBuiltinScenes(input){return serial(async()=>{const next=installBuiltinSceneUpgrade(document,input);validateWorkspace(next.state,next.catalog,document.state,{trustedScene:true});await ensureSceneSeedSources(input.sceneSeed);await checkSources(next.state,next.catalog);return persist({...next,revision:document.revision+1});});},
    upgradeBuiltinAutomatically(input){return serial(async()=>{const plan=prepareAutomaticBuiltinUpgrade(document,input);if(!plan)return read();const next=plan.next;validateWorkspace(next.state,next.catalog,document.state,{trustedScene:true});await ensureSceneSeedSources(input.sceneSeed);await checkSources(next.state,next.catalog);return persist({...next,revision:document.revision+1});});},
    installEcommercePolicy(input){return serial(async()=>{const next=installEcommercePolicyUpgrade(document,input);validateWorkspace(next.state,next.catalog,document.state,{trustedScene:true});await checkSources(next.state,next.catalog);return persist({...next,revision:document.revision+1});});},
    configureScene(input){return serial(async()=>{
      assertNativeStageReady(document.state);
      const next=sceneConfigurationMutation(document,input);if(canonical(next)===canonical(document))return read();
      validateWorkspace(next.state,next.catalog,document.state,{trustedScene:true});await checkSources(next.state,next.catalog);
      return persist({...next,revision:document.revision+1});
    });},
    applyScenePreparation(input,preparation){return serial(async()=>{
      const next=sceneConfigurationMutation(document,{...input,action:'apply-preparation'},{preparation});
      validateWorkspace(next.state,next.catalog,document.state,{trustedScene:true});await checkSources(next.state,next.catalog);
      return persist({...next,revision:document.revision+1});
    });},
    calibrationPreview(input){return serial(async()=>calibrationPreview(document.state,input));},
    calibrationSummary(){return serial(async()=>({records:(document.state?.ruleCalibrations?.records||[]).map(record=>({...record,monitoring:calibrationMonitoring(document.state,record.id)})),events:document.state?.ruleCalibrations?.events||[]}));},
    calibrate(input){return serial(async()=>{
      let state;try{state=input.action==='calibrate'?recordCalibration(document.state,input):changeCalibration(document.state,input);}catch(error){throw new WorkspaceError(error.message,409);}
      validateWorkspace(state,document.catalog,document.state,{trustedCalibration:true});await checkSources(state,document.catalog);
      return persist({...document,revision:document.revision+1,state});
    });},
    validateIntegrity(){return serial(async()=>{if(document.revision===0)throw new WorkspaceError('工作区尚未初始化。',409);validateWorkspace(document.state,document.catalog);await checkSources(document.state,document.catalog);return read();});},
    deleteRule(input){return serial(async()=>{
      if(!object(input))throw new WorkspaceError('规则删除请求无效。');
      let catalog;try{catalog=deleteRetiredRule(document.catalog,document.state,input);}catch(error){throw new WorkspaceError(error.message,409);}
      if(equalCatalog(catalog,document.catalog))return read();
      validateWorkspace(document.state,catalog,document.state);await checkSources(document.state,catalog);
      return persist({...document,revision:document.revision+1,catalog});
    });},
    updateTaskLifecycle(taskIds,action,options={}){
      return serial(async()=>{
        if(!Array.isArray(taskIds)||!taskIds.length||taskIds.length>1000||new Set(taskIds).size!==taskIds.length)throw new WorkspaceError('任务范围无效。');
        let next=clone(document.state);
        try{for(const id of taskIds)next=applyTaskLifecycle(next,id,action,options);}catch(error){throw new WorkspaceError(error.message,409);}
        validateWorkspace(next,document.catalog,document.state,{trustedLifecycle:true});
        if(canonical(next)===canonical(document.state))return read();
        return persist({...document,revision:document.revision+1,state:next});
      });
    },
    updateAI(updater){
      return serial(async()=>{
        if(document.revision===0)throw new WorkspaceError('工作区尚未初始化，无法保存AI执行状态。',409);
        if(typeof updater!=='function')throw new WorkspaceError('AI更新须使用服务端回调。');
        const next=clone(await updater({state:clone(document.state),catalog:clone(document.catalog)}));
        if(!object(next)||!object(next.state)||!equalCatalog(next.catalog,document.catalog))throw new WorkspaceError('AI更新不可修改资料目录。');
        validateWorkspace(next.state,next.catalog,document.state,{trustedAI:true});
        await checkSources(next.state,next.catalog);
        return persist({...document,revision:document.revision+1,state:next.state,catalog:next.catalog});
      });
    },
    save(input,{snapshot=true}={}){
      const request=clone(input);
      return serial(async()=>{
        if(!object(request)||!Number.isSafeInteger(request.baseRevision)||request.baseRevision<0||typeof request.mutationId!=='string'||!request.mutationId.trim()||request.mutationId.length>128)throw new WorkspaceError('保存请求版本或 mutationId 无效。');
        const delta=Object.hasOwn(request,'patch');
        if(delta){const p=request.patch;if(Object.keys(request).some(k=>!['baseRevision','mutationId','patch'].includes(k))||!object(p)||Object.keys(p).some(k=>!['tasks','sessions','removedTasks','removedSessions','tasksOrder','sessionsOrder','state','catalog'].includes(k))||!object(p.state)||!['tasks','sessions','removedTasks','removedSessions'].every(k=>Array.isArray(p[k]))||['tasks','sessions'].some(k=>p[k].some(v=>!object(v)||typeof v.id!=='string')||new Set(p[k].map(v=>v.id)).size!==p[k].length)||['removedTasks','removedSessions'].some(k=>p[k].some(v=>typeof v!=='string'))||['tasksOrder','sessionsOrder'].some(k=>p[k]!==undefined&&(!Array.isArray(p[k])||p[k].some(v=>typeof v!=='string'))))throw new WorkspaceError('工作区变更切片格式无效。');}
        const fingerprint=digest(canonical(delta?{baseRevision:request.baseRevision,patch:request.patch}:{baseRevision:request.baseRevision,state:request.state,catalog:request.catalog}));
        const replay=document.mutations.find(item=>item.id===request.mutationId);
        if(replay){if(replay.digest!==fingerprint)throw new WorkspaceError('相同 mutationId 对应不同请求。',409);return {...(snapshot?await read():{initialized:true,revision:document.revision}),replayed:true};}
        if(request.baseRevision!==document.revision)throw new WorkspaceError('工作区已由另一页面更新，请保留编辑内容后重新加载。',409);
        if(delta){if(!document.state)throw new WorkspaceError('未初始化工作区不能使用增量保存。');let merged;try{merged=mergeWorkspacePatch(document,{baseRevision:request.baseRevision,revision:request.baseRevision+1,patch:request.patch});}catch(error){throw new WorkspaceError(error.message);}request.state=merged.state;request.catalog=merged.catalog;}
        if(canonical(request.state?.workspaceSettings?.languagePolicy)!==canonical(document.state?.workspaceSettings?.languagePolicy)||canonical(request.state?.languageMaterials)!==canonical(document.state?.languageMaterials)||canonical(request.state?.languageAudit)!==canonical(document.state?.languageAudit))languageError('LANGUAGE_LOCKED','Language settings and materials cannot be changed through general workspace saving.');
        if(workspaceLanguage(document.state)?.mode==='native-v1'&&canonical(request.catalog)!==canonical(document.catalog))languageError('BILINGUAL_REVIEW_REQUIRED','Native materials must use the paired-language publication workflow. Legacy catalog editing is not enabled in stage 1.');
        if(canonical(request.catalog?.deletedRules||[])!==canonical(document.catalog?.deletedRules||[]))throw new WorkspaceError('规则删除审计只能通过专用删除入口追加，历史内容不可改写。');
        const deletedEvents=catalog=>(catalog?.events||[]).filter(event=>(document.catalog?.deletedRules||[]).some(entry=>event.kind==='rules'&&entry.id===event.id&&entry.version===event.version));
        if(canonical(deletedEvents(request.catalog))!==canonical(deletedEvents(document.catalog)))throw new WorkspaceError('已删除规则的历史操作记录不可改写。');
        if((document.catalog?.rules||[]).some(old=>!request.catalog?.rules?.some(next=>next.id===old.id&&next.version===old.version)))throw new WorkspaceError('删除规则须使用专用入口并检查任务引用。');
        const newFreezes=[];
        if(nativeLanguageStage>=4&&workspaceLanguage(document.state)?.mode==='native-v1'){
          const oldIds=new Set(document.state.tasks.map(t=>t.id)),materials=await publishedMaterials(),selectedFreeze=await selectedNativeFreeze();
          for(let i=0;i<(request.state?.tasks||[]).length;i++){
            const task=request.state.tasks[i];if(oldIds.has(task.id))continue;
            if(task.executionSnapshot?.languageExecution){
              const frozen=await readNativeMaterial(task);assertNativeReportCoverage(nativeExecutionContext(task,frozen));nativeDisplayProjection(task,frozen,{delivery:true});task.executionSnapshot.schemaVersion=2;continue;
            }
            const prepared=resolveNativeTaskMaterial(document.state,task,materials,selectedFreeze);request.state.tasks[i]=prepared.task;
            const registry=request.state.languageMaterials||{schemaVersion:1,releases:[],freezes:[]};
            if(!registry.freezes.some(r=>r.hash===prepared.hash)){registry.freezes.push({hash:prepared.hash,languageExecution:prepared.frozen.languageExecution});newFreezes.push(prepared);}
            request.state.languageMaterials=registry;
            request.state.languageAudit.push({id:`freeze-task-${request.mutationId}-${i}`,action:'freeze-material',actor:'local-operator',at:new Date().toISOString(),reason:prepared.frozen.paired.some(m=>m.review.status==='pilot-unreviewed')?'Freeze exact authorized pilot materials; bilingual business review remains pending.':'Freeze exact previously reviewed material for the new task.',before:null,after:{taskId:task.id,hash:prepared.hash,languageExecution:prepared.frozen.languageExecution}});
          }
        }
        validateWorkspace(request.state,request.catalog,document.state,{authenticateNewSnapshots:true,allowNativeTaskCreation:nativeLanguageStage>=2,trustedLanguage:nativeLanguageStage>=4});
        try{validateRuleSetCatalogTransition(document.catalog,request.catalog);}catch(error){throw new WorkspaceError(error.message);}
        for(const prepared of newFreezes)await writeLanguageArtifact(prepared.hash,prepared.frozen);
        await checkSources(request.state,request.catalog);
        const monitored=monitorCalibrations(request.state);
        validateWorkspace(monitored,request.catalog,request.state,{trustedCalibration:true});
        const next={schemaVersion:1,revision:document.revision+1,state:monitored,catalog:request.catalog,mutations:[...document.mutations,{id:request.mutationId,digest:fingerprint}]};
        return persist(next,{snapshot});
      });
    },
    putSource(bytes,name){
      const copy=Buffer.from(bytes);
      return serial(async()=>{
        safeName(name);if(!copy.length)throw new WorkspaceError('原文件不能为空。');if(copy.length>MAX_SOURCE_BYTES)throw new WorkspaceError('原文件大小超过8MB。',413);
        const sha256=digest(copy);let existing;
        try{existing=await sourceRecord(sha256);}catch(error){if(error.status!==404)throw error;}
        if(existing)return existing.metadata;
        const metadata={sha256,name,size:copy.length,createdAt:new Date().toISOString()};
        try{await atomicWrite(path.join(sources,sha256),copy);await atomicWrite(path.join(sources,`${sha256}.json`),JSON.stringify(metadata));}
        catch(error){throw new WorkspaceError(`原文件未保存，请重试：${error.message}`,500);}
        return clone(metadata);
      });
    },
    async getSource(sha256){const {metadata,bytes}=await sourceRecord(sha256);return {...metadata,bytes};},
    close(){if(closePromise)return closePromise;closing=true;closePromise=queue.then(release);return closePromise;},
  };
}
