import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createModelConfig} from '../server/model-config.mjs';
import {createInitialState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

test('Windows data directory guard rejects a case variant of the public directory', {skip:process.platform!=='win32'},async()=>{
  const base='D:/Codex project/outputs/service-quality-ark-integration-20261029/';const dir=await fs.mkdtemp(base+'test-case-');let server;
  try{await fs.mkdir(path.join(dir,'public'));await assert.rejects(async()=>{server=await createWorkbenchServer({publicDir:path.join(dir,'public'),dataDir:path.join(dir,'PUBLIC')});},/public.*之外|数据目录/);}
  finally{await server?.closeWorkspace();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
async function fixture(t,{gate,entered}={}){
  const base='D:/Codex project/outputs/service-quality-ark-integration-20261029/';const dataDir=await fs.mkdtemp(base+'test-api-');
  let calls=0;const config=await createModelConfig({dataDir,env:{},protectSecret:async value=>'fixture-encrypted:'+Buffer.from(value).toString('base64'),unprotectSecret:async value=>Buffer.from(value.slice('fixture-encrypted:'.length),'base64').toString()});
  const arkClient={test:async()=>({text:'连接成功',modelId:'glm-5.3-flash'}),inspect:async ({basis})=>{calls++;if(gate&&calls===1){entered?.();await gate;}return {results:basis.rules.map(r=>({ruleId:r.id,verdict:'符合',reason:'虚构判断依据',evidence:[1],referenceIds:[]})),modelId:'glm-5.3-flash',requestId:'fake-request',promptVersion:'qa-ark-v1'};}};
  const server=await createWorkbenchServer({dataDir,modelConfig:config,arkClient});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=async (route,method='GET',body,headers={})=>{const response=await fetch(origin+route,{method,headers:{...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const initial=await request('/api/workspace'),headers={Origin:origin,'X-Workspace-Token':initial.body.token,'Content-Type':'application/json'};
  return {server,origin,headers,request,get calls(){return calls;}};
}
test('model config uses protected local API and never returns credentials',async t=>{
  const f=await fixture(t);let response=await f.request('/api/model/config');assert.equal(response.status,200);assert.equal(response.body.configured,false);
  assert.equal((await f.request('/api/model/config','PUT',{apiKey:'fixture-key'})).status,403);
  response=await f.request('/api/model/config','PUT',{apiKey:'fixture-private-key'},f.headers);assert.equal(response.status,200);assert.equal(response.body.configured,true);assert.doesNotMatch(JSON.stringify(response.body),/fixture-private-key|apiKey|ciphertext/);
  response=await f.request('/api/model/test','POST',{},f.headers);assert.equal(response.status,200);assert.equal(response.body.text,'连接成功');
  assert.equal((await f.request('/api/model/test','POST',{}, {...f.headers,Origin:'http://evil.invalid'})).status,403);
});

test('MaaS API saves all public options and allows keyless connection and rule preparation',async t=>{
 const base='D:/Codex project/outputs/service-quality-ark-integration-20261029/';const dataDir=await fs.mkdtemp(base+'test-maas-api-');let called;
 const modelConfig=await createModelConfig({dataDir,env:{},protectSecret:async value=>'encrypted:'+Buffer.from(value).toString('base64')});
 const server=await createWorkbenchServer({dataDir,modelConfig,arkClient:{test:async({config})=>{called=config;return {text:'连接成功'};},prepareRules:async({config})=>{called=config;return {candidates:[]};}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`,workspace=await(await fetch(origin+'/api/workspace')).json(),headers={Origin:origin,'X-Workspace-Token':workspace.token,'Content-Type':'application/json'};
 const options={baseUrl:'http://maas.internal/v1/chat/completions',model:'智谱-5.1',authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:65536};
 let res=await fetch(origin+'/api/model/config',{method:'PUT',headers,body:JSON.stringify(options)});assert.equal(res.status,200);const saved=await res.json();assert.equal(saved.configured,true);assert.equal(saved.keyConfigured,false);assert.equal(saved.baseUrl,'http://maas.internal/v1');assert.equal(saved.reasoningEffort,'low');
 res=await fetch(origin+'/api/model/test',{method:'POST',headers,body:'{}'});assert.equal(res.status,200);assert.equal(called.apiKey,null);assert.equal(called.timeoutMs,290000);
 res=await fetch(origin+'/api/rules/prepare',{method:'POST',headers,body:JSON.stringify({text:'虚构规则内容',scene:'电商评论回复',sourceName:'虚构规则'})});assert.equal(res.status,200);assert.equal(called.authMode,'none');
});
test('AI endpoint accepts only saved file tasks, persists trusted results and deduplicates run IDs',async t=>{
  const f=await fixture(t);await f.request('/api/model/config','PUT',{apiKey:'fixture-private-key'},f.headers);
  const catalog=createCatalog(),bytes=Buffer.from('API fictional input');
  const sourceResponse=await fetch(f.origin+'/api/sources',{method:'POST',headers:{...f.headers,'Content-Type':'application/octet-stream','X-File-Name':'fictional.json'},body:bytes}),source=await sourceResponse.json();assert.equal(sourceResponse.status,201);
  const state=createImportedTask(createInitialState(),{name:'接口虚构任务',fileName:'fictional.json',source,reviewer:'虚构审核员',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-29',ruleIds:['R004']}),sessions:[{id:'API-NEW-1',scene:'新品产品咨询',startedAt:'2026-10-01T09:00:00+08:00',topic:'虚构咨询',channel:'虚构',product:'虚构',agent:'虚构客服',customer:'虚构客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客服',speaker:'虚构客服',at:'',text:'我需要先核对正式资料。'}]}]});
  assert.equal((await f.request('/api/workspace','PUT',{baseRevision:0,mutationId:'initial',state,catalog},f.headers)).status,200);
  const route=`/api/ai/tasks/${state.tasks[0].id}`;
  assert.equal((await f.request(route,'POST',{runId:'http-run'})).status,403);
  assert.equal((await f.request(route,'POST',{runId:'http-before-test'},f.headers)).status,409);assert.equal(f.calls,0);
  const tested=await f.request('/api/model/test','POST',{},f.headers);assert.equal(tested.status,200);assert.equal(tested.body.config.connectionTested,true);
  assert.equal((await f.request(route,'POST',{runId:'http-run'},f.headers)).status,202);
  await f.server.waitForAiIdle();let doc=(await f.request('/api/workspace')).body;
  const task=doc.state.tasks[0],session=doc.state.sessions.find(s=>s.taskId===task.id);assert.equal(task.aiStatus,'completed');assert.equal(session.aiResults.length,1);assert.equal(session.review.status,'待审核');
  assert.equal((await f.request(route,'POST',{runId:'http-run'},f.headers)).status,202);await f.server.waitForAiIdle();assert.equal(f.calls,1);
  assert.equal((await f.request('/api/ai/tasks/TASK-20261018-001','POST',{runId:'wrong-demo'},f.headers)).status,400);
});

test('a slow connection-test body cannot start a chargeable request after server shutdown begins',async t=>{
  const base='D:/Codex project/outputs/service-quality-ark-integration-20261029/';const dataDir=await fs.mkdtemp(base+'test-close-');let calls=0;
  const config={publicConfig:()=>({configured:true}),getPrivate:()=>({apiKey:'fixture-private-key'})};
  const server=await createWorkbenchServer({dataDir,modelConfig:config,arkClient:{inspect:async()=>{},test:async()=>{calls++;return {text:'连接成功'};}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,doc=await(await fetch(origin+'/api/workspace')).json();
  const arrived=once(server,'request');let responsePromise;
  const req=http.request(origin+'/api/model/test',{method:'POST',headers:{Origin:origin,'X-Workspace-Token':doc.token,'Content-Type':'application/json','Content-Length':2}});
  responsePromise=new Promise((resolve,reject)=>{req.on('response',res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});
  req.flushHeaders();await arrived;const closed=new Promise(r=>server.close(r));req.end('{}');assert.equal(await responsePromise,503);await closed;assert.equal(calls,0);
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});
});

test('row queue HTTP start remains async, validates settings, and pause resume adopts persisted workspace',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),called=new Promise(r=>entered=r),f=await fixture(t,{gate,entered});
 t.after(()=>release());await f.request('/api/model/config','PUT',{apiKey:'fixture-private-key'},f.headers);
 const upload=await fetch(f.origin+'/api/sources',{method:'POST',headers:{...f.headers,'Content-Type':'application/octet-stream','X-File-Name':'fictional.json'},body:Buffer.from('API pause fixture')}),source=await upload.json(),catalog=createCatalog();
 const state=createImportedTask(createInitialState(),{name:'接口队列虚构任务',source,reviewer:'审核员',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-29',ruleIds:['R004']}),sessions:[1,2].map(n=>({id:`HTTP-ROW-${n}`,scene:'新品产品咨询',startedAt:'2026-10-01T09:00:00+08:00',topic:'虚构咨询',channel:'虚构',product:'虚构',agent:'虚构客服',customer:'虚构客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客服',text:'我先核对资料。'}]}))});
 assert.equal((await f.request('/api/workspace','PUT',{baseRevision:0,mutationId:'initial',state,catalog},f.headers)).status,200);
 const route=`/api/tasks/${state.tasks[0].id}/ai`;
 const tested=await f.request('/api/model/test','POST',{},f.headers);assert.equal(tested.status,200);assert.equal(tested.body.config.connectionTested,true);
 assert.equal((await f.request(route,'POST',{runId:'bad-settings',settings:{concurrency:5}},f.headers)).status,400);
 const started=await f.request(route,'POST',{runId:'http-queue',settings:{concurrency:1,batchSize:1,maxWorkBytes:4096}},f.headers);assert.equal(started.status,202);assert.equal(started.body.state.tasks[0].aiQueue.batches.length,2);await called;
 assert.equal((await f.request(route+'/pause','POST',{},f.headers)).body.state.tasks[0].aiQueue.status,'paused');release();await f.server.waitForAiIdle();assert.equal(f.calls,1);
 const resumed=await f.request(route+'/resume','POST',{},f.headers);assert.equal(resumed.status,200);assert.equal(resumed.body.state.tasks[0].aiQueue.settings.batchSize,1);await f.server.waitForAiIdle();assert.equal(f.calls,2);
 assert.equal((await f.request('/api/workspace')).body.state.tasks[0].aiQueue.status,'completed');
});
