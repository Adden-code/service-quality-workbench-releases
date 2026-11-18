import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWorkbenchServer} from '../server.mjs';

const base=path.resolve('D:/Codex project/outputs/service-workflow-20261030');
async function fixture(t,options={}){
  await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'trace-test-'));
  const stores=[];
  t.after(async()=>{for(const store of stores.reverse())await store.close();assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const {createWorkflowTraceStore,WORKFLOW_NODES}=await import('../server/workflow-traces.mjs');
  const open=async(extra={})=>{const store=await createWorkflowTraceStore({dataDir,...options,...extra});stores.push(store);return store;};
  return {dataDir,open,store:await open(),WORKFLOW_NODES};
}

test('trace store records actual pending/running/completed transitions with immutable snapshots',async t=>{
  let time=Date.parse('2026-10-30T01:00:00Z');
  const {store,dataDir,WORKFLOW_NODES}=await fixture(t,{clock:()=>new Date(time)});
  assert.deepEqual(WORKFLOW_NODES.map(n=>n.id),['source','basis','deterministic','model','validation','merge','persist']);
  const run=await store.begin({id:'run-1',taskId:'TASK-1',engine:'spring-ai',kind:'ecommerce'});
  assert.equal(run.status,'running');assert.ok(run.nodes.every(n=>n.status==='pending'));
  let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const input={records:[{id:'fixture-1',text:'虚构输入'}]},output={accepted:['fixture-1']};
  const operation=store.step(run.id,'source',input,async()=>{entered();await gate;return output;});
  await ready;input.records[0].text='changed';
  const running=await store.read(run.id);assert.equal(running.nodes[0].status,'running');assert.equal(running.nodes[0].input.records[0].text,'虚构输入');
  time+=27;release();assert.equal(await operation,output);output.accepted.push('changed');
  const completed=await store.read(run.id);assert.equal(completed.nodes[0].status,'completed');assert.equal(completed.nodes[0].durationMs,27);assert.deepEqual(completed.nodes[0].output,{accepted:['fixture-1']});
  const raw=JSON.parse(await fs.readFile(path.join(dataDir,'workflow-runs','run-1.json'),'utf8'));assert.deepEqual(raw,completed);
  assert.equal((await fs.readdir(dataDir)).includes('workspace.json'),false);
});

test('operation errors retain only allowlisted safe failure and preserve the original thrown object',async t=>{
  const {store}=await fixture(t);await store.begin({id:'run-error',taskId:'TASK-1',engine:'native',kind:'ecommerce'});
  const error=Object.assign(new Error('Bearer sk-fixture-secret\nprovider stack detail'),{code:'timeout'});
  await assert.rejects(store.step('run-error','model',{messages:[{role:'user',content:'虚构原文'}]},async()=>{throw error;}),actual=>actual===error);
  const run=await store.read('run-error'),node=run.nodes.find(n=>n.id==='model');assert.equal(node.status,'failed');assert.equal(node.error.code,'timeout');
  assert.doesNotMatch(JSON.stringify(run),/sk-fixture|provider stack|Bearer/);
  await store.finish(run.id,{status:'failed',error:{code:'arbitrary-secret-code',message:'private-detail'}});
  const finished=await store.read(run.id);assert.equal(finished.error.code,'provider_error');assert.ok(finished.nodes.filter(n=>n.id!=='model').every(n=>n.status==='skipped'));assert.doesNotMatch(JSON.stringify(finished),/arbitrary-secret-code|private-detail/);
});

test('failed model operations retain only the explicit redacted diagnostic output and never accept it as a result',async t=>{
  const {store}=await fixture(t);await store.begin({id:'partial-model',taskId:'TASK-diagnostic',engine:'native',kind:'ecommerce'});
  const error=Object.assign(new Error('private provider exception'),{code:'OUTPUT_TRUNCATED',traceOutput:{content:'safe partial',model:'fixture-model',requestId:'fixture-request',usage:{outputTokens:32},finishReason:'length',reasoning_content:'hidden',authorization:'secret'},providerBody:{private:'raw response secret'}});
  await assert.rejects(store.step('partial-model','model',{messages:[{role:'user',content:'虚构输入'}]},async()=>{throw error;}),actual=>actual===error);
  const run=await store.read('partial-model'),node=run.nodes.find(n=>n.id==='model');assert.equal(node.status,'failed');assert.equal(node.error.code,'output_truncated');assert.equal(node.output.content,'safe partial');assert.equal(node.output.requestId,'fixture-request');assert.deepEqual(node.output.usage,{outputTokens:32});assert.equal(node.output.finishReason,'length');
  assert.doesNotMatch(JSON.stringify(run),/hidden|secret|private provider exception|reasoning_content|authorization|providerBody/);
  assert.ok(run.nodes.filter(n=>['validation','merge','persist'].includes(n.id)).every(n=>n.status==='pending'));
});

test('history never overwrites run IDs and summaries exclude full business snapshots',async t=>{
  const {store}=await fixture(t);await store.begin({id:'retry-1',taskId:'TASK-2',engine:'native',kind:'session',nodes:['source','persist']});
  await store.step('retry-1','source',{text:'原文不应出现在列表'},async()=>({ok:true}));
  await store.skip('retry-1','persist','无待写入结果');await store.finish('retry-1',{status:'partial',summary:{done:0,failed:1}});
  await assert.rejects(store.begin({id:'retry-1',taskId:'TASK-2',engine:'native',kind:'session'}),error=>error.status===409);
  await store.begin({id:'retry-2',taskId:'TASK-2',engine:'native',kind:'session'});
  const list=await store.list('TASK-2');assert.deepEqual(new Set(list.map(r=>r.id)),new Set(['retry-1','retry-2']));assert.doesNotMatch(JSON.stringify(list),/原文不应出现在列表|"input"|"output"/);
  const partial=list.find(r=>r.id==='retry-1');assert.deepEqual(partial.summary,{done:0,failed:1});assert.equal(partial.nodes[1].status,'skipped');assert.ok(partial.completedAt);
  assert.deepEqual(await store.list('TASK-empty'),[]);assert.equal(await store.read('no-record'),null);
});

test('per-session conversation nodes support a multi-record batch and remain readable after restart',async t=>{
  const {store,open}=await fixture(t),nodes=Array.from({length:40},(_,index)=>({id:`model-${index}`,label:`模型检查第${index+1}条`}));
  await store.begin({id:'many-nodes',taskId:'TASK-many',engine:'native',kind:'conversation',nodes});
  await store.step('many-nodes','model-39',{sessionId:'fixture-40'},async()=>({accepted:true}));await store.finish('many-nodes',{status:'completed'});await store.close();
  const reopened=await open(),run=await reopened.read('many-nodes');assert.equal(run.nodes.length,40);assert.equal(run.nodes[39].status,'completed');
});

test('concurrent writes serialize without dropping independent nodes and completed runs cannot mutate',async t=>{
  const {store}=await fixture(t);await store.begin({id:'parallel',taskId:'TASK-3',engine:'native',kind:'session'});
  await Promise.all(['source','basis','deterministic'].map(id=>store.step('parallel',id,{id},async()=>({result:id}))));
  await store.finish('parallel',{status:'completed',summary:{done:3}});
  const saved=await store.read('parallel');assert.ok(saved.nodes.slice(0,3).every(n=>n.status==='completed'));
  await assert.rejects(store.step('parallel','model',{},async()=>({})),error=>error.status===409);
  await assert.rejects(store.skip('parallel','source','skip'),error=>error.status===409);
  await assert.rejects(store.finish('parallel',{status:'failed'}),error=>error.status===409);
  assert.deepEqual(await store.read('parallel'),saved);
});

test('startup recovery marks abandoned running nodes interrupted and pending nodes skipped',async t=>{
  let time=Date.parse('2026-10-30T01:00:00Z');const {store,open,dataDir}=await fixture(t,{clock:()=>time});
  await store.begin({id:'abandoned',taskId:'TASK-4',engine:'native',kind:'ecommerce'});
  await store.step('abandoned','source',{},async()=>({count:1}));await store.close();
  const file=path.join(dataDir,'workflow-runs','abandoned.json'),run=JSON.parse(await fs.readFile(file,'utf8'));
  run.nodes[1]={...run.nodes[1],status:'running',startedAt:new Date(time).toISOString(),input:{ruleIds:['R1']}};
  await fs.writeFile(file,JSON.stringify(run));time+=500;
  const reopened=await open();const recovered=await reopened.read('abandoned');
  assert.equal(recovered.status,'interrupted');assert.equal(recovered.error.code,'interrupted');assert.equal(recovered.nodes[0].status,'completed');assert.equal(recovered.nodes[1].status,'failed');assert.equal(recovered.nodes[1].durationMs,500);assert.ok(recovered.nodes.slice(2).every(n=>n.status==='skipped'));
  await reopened.recover();assert.deepEqual(await reopened.read('abandoned'),recovered);
});

test('snapshot limits explicitly replace oversized values by their byte count and digest without changing business output',async t=>{
  const {store}=await fixture(t);await store.begin({id:'large',taskId:'TASK-5',engine:'native',kind:'ecommerce'});
  const output={text:'大'.repeat(400000)};assert.equal(await store.step('large','model',{safe:true},async()=>output),output);
  const snapshot=(await store.read('large')).nodes.find(n=>n.id==='model').output;
  assert.equal(snapshot.truncated,true);assert.equal(snapshot.bytes,Buffer.byteLength(JSON.stringify(output)));assert.equal(snapshot.sha256,createHash('sha256').update(JSON.stringify(output)).digest('hex'));assert.ok(snapshot.bytes>snapshot.limitBytes);assert.equal(Object.hasOwn(snapshot,'text'),false);
});

test('trace snapshots redact private credentials, reasoning and human reference fields recursively',async t=>{
  const {store}=await fixture(t);await store.begin({id:'redacted',taskId:'TASK-6',engine:'native',kind:'ecommerce',meta:{apiKey:'private-key',source:'fixture'}});
  await store.step('redacted','model',{nested:{Authorization:'Bearer private-auth',api_key:'private-key',humanReference:'private-answer',referenceAnswer:'private-answer',reasoning_content:'hidden-thought',messages:[{role:'user',content:'可见虚构原文'}]}},async()=>({content:'可见业务结论',reasoning_content:'hidden-thought'}));
  const run=await store.read('redacted'),raw=JSON.stringify(run);assert.doesNotMatch(raw,/private-key|private-auth|private-answer|hidden-thought/);assert.match(raw,/可见虚构原文|可见业务结论/);
});

test('invalid identifiers, nonserializable snapshots and invalid transitions fail without invoking business operations',async t=>{
  const {store}=await fixture(t);for(const id of ['../escape','a/b','a\\b','.','..','%2fescape','bad\u0000id'])await assert.rejects(store.begin({id,taskId:'TASK-7',engine:'native',kind:'session'}),error=>error.status===400);
  await assert.rejects(store.begin({id:'valid',taskId:'../escape',engine:'native',kind:'session'}),error=>error.status===400);
  await store.begin({id:'valid',taskId:'TASK-7',engine:'native',kind:'session'});let called=false;const circular={};circular.self=circular;
  await assert.rejects(store.step('valid','source',circular,async()=>{called=true;}),error=>error.code==='trace_snapshot');assert.equal(called,false);
  await assert.rejects(store.step('valid','unknown',{},async()=>{called=true;}),error=>error.status===400);
  await store.step('valid','source',{},async()=>({}));await assert.rejects(store.step('valid','source',{},async()=>({})),error=>error.status===409);
});

test('exclusive writer lock prevents a second store from recovering a live run',async t=>{
  const {store,open}=await fixture(t);await store.begin({id:'live',taskId:'TASK-8',engine:'native',kind:'session'});
  await assert.rejects(open(),error=>error.status===409);assert.equal((await store.read('live')).status,'running');
  await store.close();const reopened=await open();assert.equal((await reopened.read('live')).status,'interrupted');
});

test('a nonserializable operation result explicitly fails its actual node before the run is finished',async t=>{
  const {store}=await fixture(t);await store.begin({id:'bad-output',taskId:'TASK-9',engine:'native',kind:'session'});
  await assert.rejects(store.step('bad-output','validation',{expected:['fixture']},async()=>new Map([['fixture',{ok:true}]])),error=>error.code==='trace_snapshot');
  const run=await store.read('bad-output'),node=run.nodes.find(n=>n.id==='validation');assert.equal(node.status,'failed');assert.equal(node.error.code,'trace_snapshot');
  await store.finish('bad-output',{status:'failed',error:{code:'trace_snapshot'}});assert.equal((await store.read('bad-output')).status,'failed');
});

test('trace storage refuses symlinked workflow directories and never writes their target',async t=>{
  await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'trace-symlink-')),outside=await fs.mkdtemp(path.join(base,'trace-target-'));
  t.after(async()=>{for(const dir of [dataDir,outside]){assert.ok(dir.startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});}});
  await fs.symlink(outside,path.join(dataDir,'workflow-runs'),process.platform==='win32'?'junction':'dir');
  const {createWorkflowTraceStore}=await import('../server/workflow-traces.mjs');await assert.rejects(createWorkflowTraceStore({dataDir}),error=>error.code==='trace_path');assert.deepEqual(await fs.readdir(outside),[]);
});

test('an actual exited writer leaves a recoverable lock and its unfinished run is interrupted',async t=>{
  await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'trace-crash-'));
  let reopened;t.after(async()=>{await reopened?.close();assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const moduleUrl=new URL('../server/workflow-traces.mjs',import.meta.url).href;
  const source=`import {createWorkflowTraceStore} from ${JSON.stringify(moduleUrl)}; const store=await createWorkflowTraceStore({dataDir:${JSON.stringify(dataDir)}}); await store.begin({id:'crashed',taskId:'TASK-crash',engine:'native',kind:'session'}); process.exit(0);`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','ignore','pipe'],windowsHide:true});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const [code]=await once(child,'exit');assert.equal(code,0,stderr);
  const {createWorkflowTraceStore}=await import('../server/workflow-traces.mjs');reopened=await createWorkflowTraceStore({dataDir});assert.equal((await reopened.read('crashed')).status,'interrupted');
});

test('replacing a live trace directory with a symlink is rejected before any operation or target write',{skip:process.platform==='win32'?'Windows 文件锁会直接阻止替换仍在使用的目录':false},async t=>{
  const {store,dataDir}=await fixture(t);await store.begin({id:'safe-live',taskId:'TASK-safe',engine:'native',kind:'session'});
  const directory=path.join(dataDir,'workflow-runs'),saved=path.join(dataDir,'saved-runs'),target=path.join(dataDir,'external');await fs.mkdir(target);await fs.rename(directory,saved);
  try{
    await fs.symlink(target,directory,process.platform==='win32'?'junction':'dir');
    await assert.rejects(store.read('safe-live'),error=>error.code==='trace_path');let called=false;
    await assert.rejects(store.step('safe-live','source',{},async()=>{called=true;}),error=>error.code==='trace_path');assert.equal(called,false);assert.deepEqual(await fs.readdir(target),[]);
  }finally{await fs.unlink(directory);await fs.rename(saved,directory);}
});

test('trace write failure is explicit and does not start a business operation or replace the old record',async t=>{
  const {store,dataDir}=await fixture(t);await store.begin({id:'write-failure',taskId:'TASK-write',engine:'native',kind:'session'});
  const file=path.join(dataDir,'workflow-runs','write-failure.json'),saved=path.join(dataDir,'saved-run.json');await fs.rename(file,saved);await fs.mkdir(file);let called=false;
  try{await assert.rejects(store.step('write-failure','source',{input:'fixture'},async()=>{called=true;}),error=>error.code==='trace_path');assert.equal(called,false);assert.equal(JSON.parse(await fs.readFile(saved,'utf8')).nodes[0].status,'pending');}
  finally{await fs.rmdir(file);await fs.rename(saved,file);}
});

test('read-only workflow APIs require valid token, same host and same origin when provided',async t=>{
  await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'trace-api-'));
  const server=await createWorkbenchServer({dataDir,modelConfig:{publicConfig:()=>({configured:false}),getPrivate:()=>({})}});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await server.closeWorkspace();assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`,initial=await(await fetch(origin+'/api/workspace')).json(),headers={'X-Workspace-Token':initial.token};
  assert.ok(server.traces,'server must expose the server-owned trace store');
  await server.traces.begin({id:'api-run',taskId:'TASK-api',engine:'native',kind:'ecommerce'});await server.traces.step('api-run','source',{text:'虚构 API 原文'},async()=>({count:1}));
  const listRoute=origin+'/api/workflow/runs?taskId=TASK-api',detailRoute=origin+'/api/workflow/runs/api-run';
  for(const route of [listRoute,detailRoute]){
    assert.equal((await fetch(route)).status,403);assert.equal((await fetch(route,{headers:{...headers,Origin:'http://evil.invalid'}})).status,403);assert.equal((await fetch(route,{headers:{'X-Workspace-Token':'é'.repeat(64)}})).status,403);
    assert.equal((await fetch(route,{headers:{...headers,Origin:origin}})).status,200);assert.equal((await fetch(route,{method:'POST',headers})).status,405);
  }
  const list=await(await fetch(listRoute,{headers})).json();assert.equal(list.runs[0].id,'api-run');assert.doesNotMatch(JSON.stringify(list),/虚构 API 原文/);
  assert.equal((await(await fetch(detailRoute,{headers})).json()).nodes[0].input.text,'虚构 API 原文');
  assert.equal((await fetch(origin+'/api/workflow/runs/missing',{headers})).status,404);assert.equal((await fetch(origin+'/api/workflow/runs?taskId=..%2fescape',{headers})).status,400);assert.equal((await fetch(origin+'/api/workflow/runs/a%2fb',{headers})).status,400);
  const hostile=await new Promise((resolve,reject)=>{const req=http.request(listRoute,{headers:{...headers,Host:'evil.invalid'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(hostile,403);
});
