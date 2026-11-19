import {createHash,randomBytes} from 'node:crypto';
// Immutable record transport mirrors disk shards. Leases pin one revision so
// concurrent AI writes cannot mix versions during a paged initial load.
export const WORKSPACE_PAGE_BYTES=512*1024;
export function createWorkspaceTransport({pageBytes=WORKSPACE_PAGE_BYTES,now=Date.now}={}){
 const serialized=new WeakMap(),leases=new Map();
 const encode=value=>{let found=value&&typeof value==='object'&&serialized.get(value);if(found)return found;const bytes=Buffer.from(JSON.stringify(value));found={bytes,hash:createHash('sha256').update(bytes).digest('hex')};if(value&&typeof value==='object')serialized.set(value,found);return found;};
 function prepare(value){
  for(const [id,l]of leases)if(now()-l.at>120000)leases.delete(id);
  while(leases.size>=8)leases.delete(leases.keys().next().value);
  const id=randomBytes(16).toString('hex'),blobs=new Map();
  const record=v=>{const b=encode(v);blobs.set(b.hash,b.bytes);return{hash:b.hash,bytes:b.bytes.length,parts:Math.ceil(b.bytes.length/pageBytes)};};
  const {tasks,sessions,...meta}=value.state;
  const manifest={...value,state:undefined,catalog:record(value.catalog),meta:Object.entries(meta).map(([key,v])=>({key,...record(v)})),tasks:tasks.map(t=>({id:t.id,...record(t)})),sessions:sessions.map(s=>({id:s.id,...record(s)}))};
  const descriptor=record(manifest);leases.set(id,{at:now(),blobs});
  return{workspaceTransport:'records-v1',revision:value.revision,lease:id,manifest:descriptor};
 }
 function page(lease,hash,index){const l=leases.get(lease),b=l?.blobs.get(hash);if(!l||now()-l.at>120000||!b)throw Object.assign(new Error('同步分页已过期，请重新加载；未保存编辑保持不变。'),{status:410});if(!Number.isSafeInteger(index)||index<0||index*pageBytes>=b.length)throw Object.assign(new Error('同步分页不存在。'),{status:404});return b.subarray(index*pageBytes,Math.min(b.length,(index+1)*pageBytes));}
 function prepareValue(value){const id=randomBytes(16).toString('hex'),b=encode(value);for(const [key,l]of leases)if(now()-l.at>120000)leases.delete(key);while(leases.size>=8)leases.delete(leases.keys().next().value);leases.set(id,{at:now(),blobs:new Map([[b.hash,b.bytes]])});return{workspaceTransport:'value-v1',lease:id,record:{hash:b.hash,bytes:b.bytes.length,parts:Math.ceil(b.bytes.length/pageBytes)}};}
 return{prepare,prepareValue,page,clear:()=>leases.clear()};
}
