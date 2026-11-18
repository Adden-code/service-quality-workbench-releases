import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import path from 'node:path';
import {createModelConfig} from '../server/model-config.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';

async function setup(t){const root=path.resolve('tests/.onboarding-scratch');await fs.mkdir(root,{recursive:true});const dataDir=await fs.mkdtemp(path.join(root,'model-'));t.after(()=>{assert.ok(dataDir.startsWith(root+path.sep));return fs.rm(dataDir,{recursive:true,force:true});});const options={dataDir,env:{},protectSecret:async key=>'opaque:'+Buffer.from(key).toString('base64'),unprotectSecret:async value=>Buffer.from(value.slice(7),'base64').toString()};return {options,config:await createModelConfig(options)};}
test('configured keyless gateway remains blocked until a successful saved-configuration test',async t=>{
 const {config}=await setup(t);await config.update({baseUrl:'http://gateway.internal/v1',authMode:'none'});
 assert.equal(config.publicConfig().connectionTested,false);
 const pending=await config.beginConnectionTest();assert.equal(pending.config.apiKey,null);
 await config.finishConnectionTest(pending.token,true);assert.equal(config.publicConfig().connectionTested,true);
 assert.ok(config.publicConfig().connectionTestedAt);
});
test('test success persists across restart while config or credentials change invalidates it',async t=>{
 const {config,options}=await setup(t);await config.update({authMode:'none'});const run=await config.beginConnectionTest();await config.finishConnectionTest(run.token,true);
 const reopened=await createModelConfig(options);assert.equal(reopened.publicConfig().connectionTested,true);
 await reopened.update({authMode:'none'});assert.equal(reopened.publicConfig().connectionTested,true);
 await reopened.update({model:'外部模型-GLM-V5.3-Flash-1M'});assert.equal(reopened.publicConfig().connectionTested,false);
 const tested=await reopened.beginConnectionTest();await reopened.finishConnectionTest(tested.token,true);
 await reopened.update({authMode:'bearer',apiKey:'synthetic-secret-123'});assert.equal(reopened.publicConfig().connectionTested,false);
 assert.doesNotMatch(JSON.stringify(reopened.publicConfig()),/synthetic-secret|opaque:/);
});
test('stale test cannot certify a changed configuration',async t=>{
 const {config}=await setup(t);await config.update({authMode:'none'});const old=await config.beginConnectionTest();await config.update({baseUrl:'http://another.internal/v1'});await config.finishConnectionTest(old.token,true);assert.equal(config.publicConfig().connectionTested,false);
});
test('failed or aborted retest revokes previous success and older concurrent result cannot override latest',async t=>{
 const {config,options}=await setup(t);await config.update({authMode:'none'});const first=await config.beginConnectionTest();await config.finishConnectionTest(first.token,true);
 const second=await config.beginConnectionTest();assert.equal((await createModelConfig(options)).publicConfig().connectionTested,false);await config.finishConnectionTest(second.token,false);assert.equal(config.publicConfig().connectionTested,false);
 const older=await config.beginConnectionTest(),latest=await config.beginConnectionTest();await config.finishConnectionTest(older.token,true);assert.equal(config.publicConfig().connectionTested,false);await config.finishConnectionTest(latest.token,true);assert.equal(config.publicConfig().connectionTested,true);
});
test('HTTP AI start is blocked before a real config test and permitted after a keyless test; changed settings revoke it',async t=>{
 const {config,options}=await setup(t);let inspections=0;
 const client={test:async()=>({text:'Connected',modelId:'test-model'}),inspect:async({basis})=>{inspections++;return {results:basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic deterministic fixture',evidence:[1],referenceIds:[]})),modelId:'test-model',requestId:'synthetic',promptVersion:'synthetic'};}};
 const server=await createWorkbenchServer({dataDir:options.dataDir,modelConfig:config,arkClient:client});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`,initial=await (await fetch(origin+'/api/workspace')).json(),headers={Origin:origin,'Content-Type':'application/json','X-Workspace-Token':initial.token};
 const request=(route,method,body)=>fetch(origin+route,{method,headers,body:JSON.stringify(body)});
 await request('/api/model/config','PUT',{authMode:'none',baseUrl:'http://controlled.invalid/v1'});
 const upload=await fetch(origin+'/api/sources',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'synthetic.json'},body:Buffer.from('synthetic source for gate test')}),source=await upload.json(),catalog=createCatalog();
 const state=createImportedTask(createBusinessState(),{name:'Synthetic gate task',fileName:source.name,source,reviewer:'Synthetic reviewer',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-10',ruleIds:['R004']}),sessions:[{id:'SYNTH-GATE-1',scene:'新品产品咨询',startedAt:'2026-11-04T09:00:00+08:00',topic:'Fixture',channel:'Web',product:'Fixture',agent:'Agent',customer:'Customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客服',text:'Synthetic response for fixture.'}]}]});
 const saved=await request('/api/workspace','PUT',{baseRevision:initial.revision,mutationId:'synthetic-gate',state,catalog});assert.equal(saved.status,200,await saved.text());
 const route=`/api/tasks/${state.tasks[0].id}/ai`;const blocked=await request(route,'POST',{runId:'before-test'});assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/测试/);assert.equal(inspections,0);
 const tested=await request('/api/model/test','POST',{});assert.equal(tested.status,200);assert.equal((await tested.json()).config.connectionTested,true);
 assert.equal((await request(route,'POST',{runId:'after-test'})).status,202);await server.waitForAiIdle();assert.equal(inspections,1);
 await request('/api/model/config','PUT',{reasoningEffort:'low'});assert.equal((await(await fetch(origin+'/api/model/config')).json()).connectionTested,false);
});
test('resume cannot borrow a successful test of model B to execute frozen model A',async t=>{
 const {config,options}=await setup(t),store=await createWorkspaceStore({dataDir:options.dataDir});let ai,calls=0;
 try{
  const original={authMode:'none',baseUrl:'http://controlled.invalid/v1',model:'model-A'};await config.update(original);let run=await config.beginConnectionTest();await config.finishConnectionTest(run.token,true);
  const source=await store.putSource(Buffer.from('synthetic resume source'),'synthetic.json'),catalog=createCatalog(),state=createImportedTask(createBusinessState(),{name:'Synthetic resume task',source,reviewer:'Synthetic reviewer',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-10',ruleIds:['R004']}),sessions:[{id:'SYNTH-RESUME',scene:'新品产品咨询',startedAt:'2026-11-04T09:00:00+08:00',topic:'Fixture',channel:'Web',product:'Fixture',agent:'Agent',customer:'Customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客服',text:'Synthetic response.'}]}]});await store.save({baseRevision:0,mutationId:'resume-fixture',state,catalog});
  const client={inspect:async({basis})=>{if(++calls===1)throw Object.assign(new Error('synthetic timeout'),{code:'timeout'});return {results:basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic fixture',evidence:[1],referenceIds:[]})),modelId:'model-A',promptVersion:'synthetic'};}};
  ai=await createAiService({store,modelConfig:config,client,maxAttempts:1});const taskId=state.tasks[0].id;await ai.start(taskId,'frozen-A');await ai.waitForIdle();assert.equal(calls,1);
  await config.update({model:'model-B'});run=await config.beginConnectionTest();await config.finishConnectionTest(run.token,true);
  await assert.rejects(ai.resume(taskId),/冻结|恢复|设置/);assert.equal(calls,1);
  await config.update(original);await assert.rejects(ai.resume(taskId),/测试/);run=await config.beginConnectionTest();await config.finishConnectionTest(run.token,true);
  await ai.resume(taskId);await ai.waitForIdle();assert.equal(calls,2);assert.equal((await store.read()).state.tasks[0].aiStatus,'completed');
 }finally{await ai?.close();await store.close();}
});
