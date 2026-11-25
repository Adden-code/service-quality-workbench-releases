import {workspacePatch} from './workspace-patch.mjs';
export function createWorkspaceDecoderCore({fetchImpl=globalThis.fetch}={}){
 const records=new Map(),documents=new Map(),bindings=new Map();
 async function decode(buffer,{baseRevision,deadline=Date.now()+30000}={}){
  const packet=JSON.parse(new TextDecoder().decode(buffer));
  if(!['records-v1','value-v1'].includes(packet.workspaceTransport))return packet;
  const used=new Set(),usedBindings=new Set();
  const inFlight=new Map(),readers=[];
  const record=ref=>{used.add(ref.hash);if(records.has(ref.hash))return Promise.resolve(records.get(ref.hash));if(!inFlight.has(ref.hash))inFlight.set(ref.hash,loadRecord(ref));return inFlight.get(ref.hash);};
  async function bound(ref,key){
   usedBindings.add(key);const raw=await record(ref),prior=bindings.get(key);
   if(prior?.hash===ref.hash)return prior.value;
   // Identical JSON at two logical paths is NOT one mutable object. Preserve
   // sharing across revisions only for the same entity/key, never across keys.
   const value=structuredClone(raw);bindings.set(key,{hash:ref.hash,value});return value;
  }
  async function loadRecord(ref){
   used.add(ref.hash);if(records.has(ref.hash))return records.get(ref.hash);
   if(!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>512*1024*1024||!Number.isSafeInteger(ref.parts)||ref.parts<1)throw new Error('工作区分页描述无效。');
   const buffer=new Uint8Array(ref.bytes);let offset=0;
   for(let i=0;i<ref.parts;i++){const r=await fetchImpl(`/api/workspace/parts/${packet.lease}/${ref.hash}/${i}`,{credentials:'same-origin',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});if(!r.ok)throw new Error('工作区同步分页过期或读取失败，请重新加载；编辑内容已保留。');const bytes=new Uint8Array(await r.arrayBuffer());if(offset+bytes.length>buffer.length)throw new Error('工作区分页大小不一致。');buffer.set(bytes,offset);offset+=bytes.length;}
   if(offset!==buffer.length)throw new Error('工作区分页不完整。');
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==ref.hash)throw new Error('工作区分页校验失败。');
   const value=JSON.parse(new TextDecoder().decode(buffer));records.set(ref.hash,value);return value;
  }
  try{
  if(packet.workspaceTransport==='value-v1'){const value=await record(packet.record);records.delete(packet.record.hash);return value;}
  const m=await record(packet.manifest);if(m.revision!==packet.revision)throw new Error('工作区分页版本不一致。');
  const load=async(refs,kind)=>{const values=Array(refs.length);let index=0;const jobs=Array.from({length:Math.min(6,refs.length)},async()=>{while(index<refs.length){const i=index++;values[i]=await bound(refs[i],kind+':'+refs[i].id);if(values[i].id!==refs[i].id)throw new Error('工作区分页记录标识不一致。');}});readers.push(...jobs);await Promise.all(jobs);return values;};
  const [meta,catalog,tasks,sessions]=await Promise.all([Promise.all(m.meta.map(async r=>[r.key,await bound(r,'meta:'+r.key)])).then(Object.fromEntries),bound(m.catalog,'catalog'),load(m.tasks,'task'),load(m.sessions,'session')]);
  const {meta:ignored,...header}=m,value={...header,state:{...meta,tasks,sessions},catalog};delete value.tasks;delete value.sessions;
  const before=documents.get(baseRevision);documents.set(value.revision,value);while(documents.size>4)documents.delete(documents.keys().next().value);
  // Object references in the decoder remain stable across unchanged shards.
  // Only changed records cross the Worker boundary after the first load.
  const result=before?{...value,state:undefined,catalog:undefined,baseRevision,patch:workspacePatch(before,value)}:value;
  // Keep current records; old document objects remain available for pending-write reconciliation.
  for(const hash of records.keys())if(!used.has(hash))records.delete(hash);
  for(const key of bindings.keys())if(!usedBindings.has(key))bindings.delete(key);
  return result;
  }finally{
   // Release only after every concurrent reader has settled, including errors.
   await Promise.allSettled(readers);await Promise.allSettled([...inFlight.values()]);
   try{await fetchImpl(`/api/workspace/parts/${packet.lease}/release`,{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(3000)});}catch{}
  }
 }
 return{decode};
}
