import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';

for(const phase of ['before-model','after-model'])test(`Windows transient rename lock ${phase} retries only atomic persistence and never repeats model work`,{skip:process.platform!=='win32'},async t=>{
 const base=path.resolve('D:/Codex project/outputs/service-consultation-delivery-20261104/storage-retry');await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'trace-'));
 const store=await createWorkflowTraceStore({dataDir}),rename=fs.rename;let armed=phase==='before-model',failures=0,modelCalls=0;
 t.after(async()=>{fs.rename=rename;syncBuiltinESMExports();await store.close();assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 await store.begin({id:'transient-lock',taskId:'synthetic',engine:'local',kind:'test',nodes:['model']});
 fs.rename=async(from,to)=>{if(armed&&path.basename(String(to))==='transient-lock.json'&&failures++<4)throw Object.assign(new Error('Synthetic temporary Windows file lock'),{code:'EPERM',syscall:'rename',path:String(from),dest:String(to)});return rename(from,to);};
 syncBuiltinESMExports();
 const output=await store.step('transient-lock','model',{synthetic:true},async()=>{modelCalls++;armed=true;return{result:'saved once'};});
 assert.deepEqual(output,{result:'saved once'});assert.equal(modelCalls,1);assert.ok(failures>=5);assert.equal((await store.read('transient-lock')).nodes[0].status,'completed');
});
