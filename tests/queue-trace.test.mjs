import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
test('trace appends actual nodes and presents physical parts as one logical run',async t=>{
 const dir=await fs.mkdtemp('D:/Codex project/outputs/service-business-upgrade-20261103/trace-parts-'),store=await createWorkflowTraceStore({dataDir:dir});
 t.after(async()=>{await store.close();await fs.rm(dir,{recursive:true,force:true});});
 await store.begin({id:'logical',taskId:'task',engine:'fixture',kind:'rows',nodes:[{id:'row-1',label:'原表行3 · 尝试1'}],meta:{parentRunId:'logical',part:1}});
 assert.equal(typeof store.appendNodes,'function');await store.appendNodes('logical',[{id:'row-2',label:'原表行23 · 尝试1'}]);
 await store.step('logical','row-1',{},async()=>({saved:true}));await store.step('logical','row-2',{},async()=>({saved:true}));
 await store.begin({id:'logical.part-2',taskId:'task',engine:'fixture',kind:'rows',nodes:[{id:'row-3',label:'原表行43 · 尝试2'}],meta:{parentRunId:'logical',part:2}});await store.step('logical.part-2','row-3',{},async()=>({saved:true}));
 for(const id of ['logical','logical.part-2'])await store.finish(id,{status:'completed',summary:{done:3,failed:0,total:3}});
 const list=await store.list('task');assert.equal(list.length,1);assert.equal(list[0].id,'logical');assert.equal(list[0].nodes.length,3);
 const read=await store.read('logical');assert.deepEqual(read.meta.tracePartIds,['logical','logical.part-2']);assert.equal(read.nodes.find(n=>n.id==='row-3').label,'原表行43 · 尝试2');
});
