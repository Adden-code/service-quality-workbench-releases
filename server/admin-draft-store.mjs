import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {parseRuleCandidates,RulePreparationError} from './rule-preparation.mjs';

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const storageError=()=>Object.assign(new Error('规则起草结果无法安全读取或保存，原稿保持不变。'),{status:500,code:'ADMIN_DRAFT_STORAGE'});
export function rulePreparationId(id){if(typeof id!=='string'||!/^RPD-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw Object.assign(new Error('规则起草来源标识无效。'),{status:400});return id;}
/** Append-only, server-created model results. No arbitrary text write API. */
export async function createAdminDraftStore({dataDir,fsOps=fs}){
 const root=path.resolve(dataDir),dir=path.join(root,'admin-drafts');let tail=Promise.resolve(),closed=false;
 async function directory(name,create=false){let st;try{st=await fsOps.lstat(name);}catch(error){if(error.code!=='ENOENT'||!create)throw error;await fsOps.mkdir(name,{mode:0o700});st=await fsOps.lstat(name);}if(!st.isDirectory()||st.isSymbolicLink())throw storageError();}
 let parent=path.parse(root).root;for(const part of root.slice(parent.length).split(path.sep).filter(Boolean)){parent=path.join(parent,part);await directory(parent);}await directory(dir,true);
 async function safeDir(){await directory(root);await directory(dir);}
 return{
  saveRulePreparation(input,result){
   // Revalidate the complete result before assigning an ID or touching storage.
   let checked;try{checked=parseRuleCandidates(JSON.stringify({candidates:result?.candidates}),input);}catch(error){return Promise.reject(error);}
   if(!checked.length)return Promise.resolve(null);
   const value={schemaVersion:1,id:'RPD-'+randomUUID(),createdAt:new Date().toISOString(),source:{scene:input.scene,name:input.sourceName,text:input.text,sha256:digest(input.text)},result:structuredClone(result)};
   if(closed)return Promise.reject(storageError());
   const save=tail.then(async()=>{
    await safeDir();const file=path.join(dir,value.id+'.json'),temp=path.join(dir,'.'+value.id+'.tmp'),bytes=Buffer.from(JSON.stringify({value,sha256:digest(value)}));
    if(bytes.length>4*1024*1024)throw new RulePreparationError('INVALID_OUTPUT','规则起草结果超出保存范围。',502);
    let handle;try{handle=await fsOps.open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await fsOps.rename(temp,file);return structuredClone(value);}catch{await handle?.close().catch(()=>{});await fsOps.unlink(temp).catch(()=>{});throw storageError();}
   });tail=save.catch(()=>{});return save;
  },
  async get(id){
   const file=path.join(dir,rulePreparationId(id)+'.json');await safeDir();let st;
   try{st=await fsOps.lstat(file);}catch(error){if(error.code==='ENOENT')throw Object.assign(new Error('规则起草来源不存在。'),{status:404});throw storageError();}
   if(!st.isFile()||st.isSymbolicLink()||st.nlink>1||st.size>4*1024*1024)throw storageError();
   try{const envelope=JSON.parse(await fsOps.readFile(file,'utf8')),v=envelope.value;if(v?.schemaVersion!==1||v.id!==id||digest(v)!==envelope.sha256||digest(v.source.text)!==v.source.sha256)throw storageError();parseRuleCandidates(JSON.stringify({candidates:v.result.candidates}),{text:v.source.text,scene:v.source.scene,sourceName:v.source.name});return v;}catch{throw storageError();}
  },
  async close(){closed=true;await tail;},
 };
}
