import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {TranslationJobError,translationJobId,translationHash} from './translation-source.mjs';

export const translationStorageError=()=>new TranslationJobError('翻译任务文件无法安全读取或保存，原有文件已保留。',500,'TRANSLATION_STORAGE');
export async function createTranslationJobStore({dataDir,fsOps=fs}){
 const root=path.resolve(dataDir),jobs=path.join(root,'content-translations'),cache=path.join(root,'translation-cache');let closing=false,tail=Promise.resolve();
 async function directory(dir,create=false){let stat;try{stat=await fsOps.lstat(dir);}catch(error){if(error.code!=='ENOENT'||!create)throw error;await fsOps.mkdir(dir,{mode:0o700});stat=await fsOps.lstat(dir);}if(!stat.isDirectory()||stat.isSymbolicLink())throw translationStorageError();}
 // Reject symlinks at every ancestor, including existing parent directories.
 const drive=path.parse(root).root;let parent=drive;for(const part of root.slice(drive.length).split(path.sep).filter(Boolean)){parent=path.join(parent,part);await directory(parent);}
 await directory(jobs,true);await directory(cache,true);
 const folder=id=>path.join(jobs,translationJobId(id));
 const serial=operation=>{if(closing)return Promise.reject(translationStorageError());const next=tail.then(operation).catch(error=>{throw error instanceof TranslationJobError?error:translationStorageError();});tail=next.catch(()=>{});return next;};
 async function read(file,max=64*1024*1024){try{await directory(path.dirname(file));const stat=await fsOps.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw translationStorageError();const bytes=await fsOps.readFile(file);return JSON.parse(bytes.toString('utf8'));}catch(error){if(error.code==='ENOENT')return null;throw translationStorageError();}}
 async function atomic(file,value,max=64*1024*1024){const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>max)throw translationStorageError();await directory(path.dirname(file));const old=await fsOps.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(old&&(!old.isFile()||old.isSymbolicLink()))throw translationStorageError();const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';let handle;try{handle=await fsOps.open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await fsOps.rename(temp,file);}catch{await handle?.close().catch(()=>{});await fsOps.unlink(temp).catch(()=>{});throw translationStorageError();}}
 const node=id=>{if(typeof id!=='string'||!/^n[1-9]\d*$/.test(id))throw translationStorageError();return id;};
 const cacheKey=key=>{if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw translationStorageError();return key;};
 return{
  async list(){const values=[];for(const item of await fsOps.readdir(jobs,{withFileTypes:true})){if(item.isSymbolicLink()||!item.isDirectory())throw translationStorageError();if(/^\.creating-[A-Za-z0-9_-]+-[a-f0-9]+$/.test(item.name))continue;const value=await read(path.join(folder(item.name),'job.json'),8*1024*1024);if(!value||value.id!==item.name||value.schemaVersion!==1||!Array.isArray(value.units))throw translationStorageError();values.push(value);}return values;},
  create(job,snapshot){job=structuredClone(job);snapshot=structuredClone(snapshot);return serial(async()=>{const dir=folder(job.id);await directory(jobs);const exists=await fsOps.lstat(dir).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(exists)throw new TranslationJobError('翻译任务标识已存在。',409);const staged=path.join(jobs,`.creating-${job.id}-${randomBytes(8).toString('hex')}`);await fsOps.mkdir(staged,{mode:0o700});await atomic(path.join(staged,'snapshot.json'),snapshot);await atomic(path.join(staged,'job.json'),job,8*1024*1024);await fsOps.rename(staged,dir);});},
  save(job){const saved=structuredClone(job);return serial(()=>atomic(path.join(folder(saved.id),'job.json'),saved,8*1024*1024));},
  async snapshot(id){const value=await read(path.join(folder(id),'snapshot.json'));if(!value)throw translationStorageError();return value;},
  async result(id,nodeId){const value=await read(path.join(folder(id),node(nodeId)+'.json'),2*1024*1024);if(value&&translationHash(value.value)!==value.sha256)throw translationStorageError();return value;},
  saveResult(id,nodeId,value){const envelope={value:structuredClone(value),sha256:translationHash(value)};return serial(async()=>{await atomic(path.join(folder(id),node(nodeId)+'.json'),envelope,2*1024*1024);return envelope.sha256;});},
  saveAttempt(id,nodeId,attempt,value){value=structuredClone(value);return serial(()=>{if(!Number.isSafeInteger(attempt)||attempt<1)throw translationStorageError();return atomic(path.join(folder(id),`${node(nodeId)}-a${attempt}.json`),value,2*1024*1024);});},
  async attempt(id,nodeId,attempt){if(!Number.isSafeInteger(attempt)||attempt<1)throw translationStorageError();return read(path.join(folder(id),`${node(nodeId)}-a${attempt}.json`),2*1024*1024);},
  async cache(key){const value=await read(path.join(cache,cacheKey(key)+'.json'),1024*1024);if(!value)return null;if(value.key!==key||translationHash(value.value)!==value.sha256)throw translationStorageError();return value.value;},
  putCache(key,value){value=structuredClone(value);return serial(async()=>{const file=path.join(cache,cacheKey(key)+'.json');if(await read(file,1024*1024))return;await atomic(file,{key,value,sha256:translationHash(value)},1024*1024);});},
  async close(){closing=true;await tail;},
 };
}
