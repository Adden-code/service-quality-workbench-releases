import {createHash,randomBytes} from 'node:crypto';
// Immutable record transport mirrors disk shards. Leases pin one revision so
// concurrent AI writes cannot mix versions during a paged initial load.
export const WORKSPACE_PAGE_BYTES=512*1024;
export function createWorkspaceTransport({pageBytes=WORKSPACE_PAGE_BYTES,now=Date.now,maxLeases=64,leaseMs=120000}={}){
 const serialized=new WeakMap(),leases=new Map();
 const prune=()=>{for(const [id,l]of leases)if(now()-l.at>leaseMs)leases.delete(id);};
 function allocate(blobs){prune();if(leases.size>=maxLeases)throw Object.assign(new Error('工作区同步繁忙，请稍后重试；已保存记录和编辑内容保留。'),{status:503});const id=randomBytes(16).toString('hex');leases.set(id,{at:now(),blobs});return id;}
 const encode=value=>{let found=value&&typeof value==='object'&&serialized.get(value);if(found)return found;const bytes=Buffer.from(JSON.stringify(value));found={bytes,hash:createHash('sha256').update(bytes).digest('hex')};if(value&&typeof value==='object')serialized.set(value,found);return found;};
 function prepare(value){
  const blobs=new Map();
  const record=v=>{const b=encode(v);blobs.set(b.hash,b.bytes);return{hash:b.hash,bytes:b.bytes.length,parts:Math.ceil(b.bytes.length/pageBytes)};};
  const {tasks,sessions,...meta}=value.state;
  const manifest={...value,state:undefined,catalog:record(value.catalog),meta:Object.entries(meta).map(([key,v])=>({key,...record(v)})),tasks:tasks.map(t=>({id:t.id,...record(t)})),sessions:sessions.map(s=>({id:s.id,...record(s)}))};
  const descriptor=record(manifest),id=allocate(blobs);
  return{workspaceTransport:'records-v1',revision:value.revision,lease:id,manifest:descriptor,totalBytes:[...blobs.values()].reduce((n,b)=>n+b.length,0)};
 }
 function page(lease,hash,index){const l=leases.get(lease),b=l?.blobs.get(hash);if(!l||now()-l.at>leaseMs||!b)throw Object.assign(new Error('同步分页已过期，请重新加载；未保存编辑保持不变。'),{status:410});if(!Number.isSafeInteger(index)||index<0||index*pageBytes>=b.length)throw Object.assign(new Error('同步分页不存在。'),{status:404});l.at=now();return b.subarray(index*pageBytes,Math.min(b.length,(index+1)*pageBytes));}
 function prepareValue(value){const b=encode(value),id=allocate(new Map([[b.hash,b.bytes]]));return{workspaceTransport:'value-v1',lease:id,record:{hash:b.hash,bytes:b.bytes.length,parts:Math.ceil(b.bytes.length/pageBytes)},totalBytes:b.bytes.length};}
 return{prepare,prepareValue,page,release:id=>leases.delete(id),clear:()=>leases.clear()};
}
