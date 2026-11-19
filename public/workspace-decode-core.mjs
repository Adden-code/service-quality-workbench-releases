import {workspacePatch} from './workspace-patch.mjs';
export function createWorkspaceDecoderCore({fetchImpl=globalThis.fetch}={}){
 const records=new Map(),documents=new Map();
 async function decode(buffer,{baseRevision,deadline=Date.now()+30000}={}){
  const packet=JSON.parse(new TextDecoder().decode(buffer));
  if(!['records-v1','value-v1'].includes(packet.workspaceTransport))return packet;
  const used=new Set();
  async function record(ref){
   used.add(ref.hash);if(records.has(ref.hash))return records.get(ref.hash);
   if(!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>512*1024*1024||!Number.isSafeInteger(ref.parts)||ref.parts<1)throw new Error('工作区分页描述无效。');
   const buffer=new Uint8Array(ref.bytes);let offset=0;
   for(let i=0;i<ref.parts;i++){const r=await fetchImpl(`/api/workspace/parts/${packet.lease}/${ref.hash}/${i}`,{credentials:'same-origin',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});if(!r.ok)throw new Error('工作区同步分页过期或读取失败，请重新加载；编辑内容已保留。');const bytes=new Uint8Array(await r.arrayBuffer());if(offset+bytes.length>buffer.length)throw new Error('工作区分页大小不一致。');buffer.set(bytes,offset);offset+=bytes.length;}
   if(offset!==buffer.length)throw new Error('工作区分页不完整。');
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==ref.hash)throw new Error('工作区分页校验失败。');
   const value=JSON.parse(new TextDecoder().decode(buffer));records.set(ref.hash,value);return value;
  }
  if(packet.workspaceTransport==='value-v1'){const value=await record(packet.record);records.delete(packet.record.hash);return value;}
  const m=await record(packet.manifest);if(m.revision!==packet.revision)throw new Error('工作区分页版本不一致。');
  const load=async refs=>{const values=Array(refs.length);let index=0;await Promise.all(Array.from({length:Math.min(6,refs.length)},async()=>{while(index<refs.length){const i=index++;values[i]=await record(refs[i]);if(values[i].id!==refs[i].id)throw new Error('工作区分页记录标识不一致。');}}));return values;};
  const [meta,catalog,tasks,sessions]=await Promise.all([Promise.all(m.meta.map(async r=>[r.key,await record(r)])).then(Object.fromEntries),record(m.catalog),load(m.tasks),load(m.sessions)]);
  const {meta:ignored,...header}=m,value={...header,state:{...meta,tasks,sessions},catalog};delete value.tasks;delete value.sessions;
  const before=documents.get(baseRevision);documents.set(value.revision,value);while(documents.size>4)documents.delete(documents.keys().next().value);
  // Object references in the decoder remain stable across unchanged shards.
  // Only changed records cross the Worker boundary after the first load.
  const result=before?{...value,state:undefined,catalog:undefined,baseRevision,patch:workspacePatch(before,value)}:value;
  // Keep current records; old document objects remain available for pending-write reconciliation.
  for(const hash of records.keys())if(!used.has(hash))records.delete(hash);
  return result;
 }
 return{decode};
}
