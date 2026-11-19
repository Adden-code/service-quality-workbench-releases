import {createWorkspaceDecoderCore} from './workspace-decode-core.mjs';
export function createWorkspaceDecoder({fetchImpl=globalThis.fetch,WorkerClass=globalThis.Worker}={}){
 if(!WorkerClass)return createWorkspaceDecoderCore({fetchImpl});
 const worker=new WorkerClass(new URL('./workspace-decode-worker.mjs',import.meta.url),{type:'module'}),pending=new Map();let next=0;
 worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.value);};
 worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('后台数据解析失败，请重新加载；编辑内容已保留。'));}pending.clear();};
 return{decode(buffer,context={}){return new Promise((resolve,reject)=>{const id=++next,deadline=context.deadline||Date.now()+30000,timer=setTimeout(()=>{pending.delete(id);reject(new Error('后台数据读取超时，请重试；编辑内容已保留。'));},Math.max(1,deadline-Date.now()));pending.set(id,{resolve,reject,timer});worker.postMessage({id,buffer,context:{...context,deadline}},[buffer]);});},close(){worker.terminate();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('数据解析已关闭。'));}pending.clear();}};
}
