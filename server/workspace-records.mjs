import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const validRef=r=>typeof r==='string'&&/^workspace-records\/(?:[a-f0-9]{64}\/)*[a-f0-9]{64}\.json$/.test(r);
export const isRecordIndex=value=>value?.storageFormat==='task-records-v1';
export async function readRecordDocument(directory,index,{fsOps=fs}={}){
 if(!isRecordIndex(index)||index.schemaVersion!==2||!Number.isSafeInteger(index.revision)||!Array.isArray(index.tasks)||!Array.isArray(index.sessions))throw new Error('分片工作区索引无效，原记录保留。');
 const root=await fsOps.realpath(directory);let total=0;
 async function read(ref){
  if(!validRef(ref))throw new Error('分片路径无效。');const file=path.join(directory,ref),stat=await fsOps.lstat(file),real=await fsOps.realpath(file);
  if(!stat.isFile()||stat.isSymbolicLink()||!real.startsWith(root+path.sep)||stat.size>64*1024*1024||(total+=stat.size)>512*1024*1024)throw new Error('分片文件类型或大小无效。');
  const bytes=await fsOps.readFile(file);if(hash(bytes)!==path.basename(ref,'.json'))throw new Error('分片校验失败，原件保留。');return JSON.parse(bytes);
 }
 const state=await read(index.state),catalog=await read(index.catalog),mutations=await read(index.mutations);state.tasks=[];state.sessions=[];
 for(const entry of index.tasks){const item=await read(entry.ref);if(item.id!==entry.id)throw new Error('分片任务标识不一致。');state.tasks.push(item);}
 for(const entry of index.sessions){const item=await read(entry.ref);if(item.id!==entry.id||item.taskId!==entry.taskId)throw new Error('分片会话标识不一致。');state.sessions.push(item);}
 return{schemaVersion:1,revision:index.revision,state,catalog,mutations};
}
export function createRecordWriter(directory,{fsOps=fs,atomicWrite}){
 const cached=new WeakMap(),written=new Set();let previous=null;const garbage=new Set();
 const refs=index=>new Set(index?[index.state,index.catalog,index.mutations,...index.tasks.map(x=>x.ref),...index.sessions.map(x=>x.ref)]:[]);
 async function record(value,scope){
  const old=value&&typeof value==='object'&&cached.get(value);if(old&&old.scope===scope&&written.has(old.ref))return old.ref;
  const bytes=JSON.stringify(value),ref=`workspace-records/${scope}/${hash(bytes)}.json`;if(Buffer.byteLength(bytes)>64*1024*1024)throw new Error('单个分片超过64MB。');
  if(!written.has(ref)){const target=path.join(directory,ref);await fsOps.mkdir(path.dirname(target),{recursive:true});await atomicWrite(target,bytes);written.add(ref);}
  if(value&&typeof value==='object')cached.set(value,{scope,ref});return ref;
 }
 return async document=>{
  if(previous===null){try{const value=JSON.parse(await fsOps.readFile(path.join(directory,'workspace.json'),'utf8'));if(isRecordIndex(value)){previous=value;for(const ref of refs(value))written.add(ref);}}catch(error){if(error.code!=='ENOENT')throw error;}}
  const {tasks,sessions,...meta}=document.state;
  const index={schemaVersion:2,storageFormat:'task-records-v1',revision:document.revision,state:await record(meta,hash('state')),catalog:await record(document.catalog,hash('catalog')),mutations:await record(document.mutations,hash('mutations')),tasks:[],sessions:[]};
  for(const task of tasks)index.tasks.push({id:task.id,ref:await record(task,hash('task:'+task.id))});
  for(const s of sessions)index.sessions.push({id:s.id,taskId:s.taskId,ref:await record(s,hash('task:'+s.taskId)+'/'+hash('session:'+s.id))});
  // The index is the sole commit point. Failed/crashed writes leave only unreferenced immutable shards.
  await atomicWrite(path.join(directory,'workspace.json'),JSON.stringify(index));
  // Retain only the committed generation. Historical judgments are stored in
  // each record's audit history; portable backups contain their own snapshots.
  const live=refs(index);for(const ref of new Set([...refs(previous),...written]))if(!live.has(ref))garbage.add(ref);previous=index;
  for(const ref of garbage){if(live.has(ref)){garbage.delete(ref);continue;}try{const target=path.resolve(directory,ref),root=await fsOps.realpath(directory),real=await fsOps.realpath(target),stat=await fsOps.lstat(target);if(!validRef(ref)||!real.startsWith(root+path.sep)||!stat.isFile()||stat.isSymbolicLink())continue;await fsOps.unlink(target);written.delete(ref);garbage.delete(ref);}catch(error){if(error.code==='ENOENT'){written.delete(ref);garbage.delete(ref);}}}
  return index;
 };
}
