import test from 'node:test';import assert from 'node:assert/strict';
import {createWorkspaceTransport} from '../server/workspace-transport.mjs';
import {createWorkspaceDecoderCore} from '../public/workspace-decode-core.mjs';
import {workspaceReadBudget,workspaceRecoveryDelay} from '../public/workspace-read-budget.mjs';
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).buffer;
test('active paged snapshots survive other tabs, release frees capacity, expiry follows activity',()=>{
 let now=0;const t=createWorkspaceTransport({now:()=>now,maxLeases:12});
 const first=t.prepareValue({text:'first'});
 for(let i=0;i<11;i++)t.prepareValue({i});
 assert.throws(()=>t.prepareValue({overflow:true}),e=>e.status===503);
 assert.ok(t.page(first.lease,first.record.hash,0));
 now=110000;t.page(first.lease,first.record.hash,0);now=220000;
 assert.ok(t.page(first.lease,first.record.hash,0),'active stream renews idle lease');
 t.release(first.lease);assert.throws(()=>t.page(first.lease,first.record.hash,0),e=>e.status===410);
 assert.ok(t.prepareValue({new:true}));
});
test('decoder de-duplicates identical in-flight records and releases pinned revision',async()=>{
 const t=createWorkspaceTransport();const packet=t.prepare({initialized:true,revision:1,token:'t',state:{tasks:[],sessions:[],one:[],two:[]},catalog:{}});let released=0;const fetched=new Map();
 const d=createWorkspaceDecoderCore({fetchImpl:async(url,options)=>{
  if(url.endsWith('/release')){assert.equal(options.method,'POST');released++;t.release(packet.lease);return new Response(null,{status:204});}
  const [,lease,hash,index]=url.match(/parts\/([^/]+)\/([^/]+)\/(\d+)$/);fetched.set(hash,(fetched.get(hash)||0)+1);await new Promise(r=>setTimeout(r,1));return new Response(t.page(lease,hash,+index));
 }});
 const value=await d.decode(bytes(packet));assert.equal(value.revision,1);assert.equal(released,1);assert.ok([...fetched.values()].every(n=>n===1));
 assert.notEqual(value.state.one,value.state.two,'equal content at separate keys must not alias');
 const editable=structuredClone(value);editable.state.one.push('only this list');assert.deepEqual(editable.state.two,[]);
});
test('invalid page hash never advances revision and still releases snapshot',async()=>{
 const t=createWorkspaceTransport(),packet=t.prepareValue({text:'original'});let released=false;
 const d=createWorkspaceDecoderCore({fetchImpl:async url=>url.endsWith('/release')?(released=true,new Response(null,{status:204})):new Response(Buffer.alloc(packet.record.bytes,32))});
 await assert.rejects(d.decode(bytes(packet)),/校验失败/);assert.equal(released,true);
});
test('read budgets grow with payload but remain bounded; recovery backoff does not spin',()=>{
 assert.equal(workspaceReadBudget(0),30000);assert.equal(workspaceReadBudget(50*1048576),105000);
 assert.equal(workspaceReadBudget(1024*1048576),180000);assert.equal(workspaceReadBudget('bad'),30000);
 assert.deepEqual([0,1,2,3,4,5,6].map(workspaceRecoveryDelay),[1500,3000,6000,12000,24000,30000,30000]);
});
test('failed shard waits for surviving reader loops before release and causes no extra 410s',async()=>{
 const t=createWorkspaceTransport(),sessions=Array.from({length:17},(_,i)=>({id:'synthetic-'+i,text:'distinct record '+i}));
 const packet=t.prepare({initialized:true,revision:1,token:'synthetic',state:{tasks:[],sessions},catalog:{}});
 const manifest=JSON.parse(t.page(packet.lease,packet.manifest.hash,0).toString()),failedHash=manifest.sessions[0].hash,sessionHashes=new Set(manifest.sessions.map(r=>r.hash));
 let active=0,released=0,activeAtRelease=-1;const completed=new Set(),extraFailures=[],requestedAfterRelease=[];
 const decoder=createWorkspaceDecoderCore({fetchImpl:async(url,options)=>{
  if(url.endsWith('/release')){assert.equal(options.method,'POST');activeAtRelease=active;released++;t.release(packet.lease);return new Response(null,{status:204});}
  const [,lease,hash,index]=url.match(/parts\/([^/]+)\/([^/]+)\/(\d+)$/);
  if(released)requestedAfterRelease.push(hash);
  if(hash===failedHash)return new Response(null,{status:500});
  active++;
  try{
   // Six parallel readers initially launch; successful ones must continue into
   // later records after their peer fails. Releasing at the first wave is early.
   if(sessionHashes.has(hash))await new Promise(resolve=>setTimeout(resolve,5));
   try{const value=t.page(lease,hash,+index);if(sessionHashes.has(hash))completed.add(hash);return new Response(value);}
   catch(error){extraFailures.push(error.status);return new Response(null,{status:error.status||500});}
  }finally{active--;}
 }});
 await assert.rejects(decoder.decode(bytes(packet)),/分页过期或读取失败/);
 assert.equal(released,1);assert.equal(activeAtRelease,0);assert.equal(completed.size,sessions.length-1);
 assert.deepEqual(extraFailures,[]);assert.deepEqual(requestedAfterRelease,[]);
});
