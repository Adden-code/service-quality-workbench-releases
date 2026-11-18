import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWorkbenchServer} from '../server.mjs';
import {createWorkspaceClient} from '../public/workspace-client.mjs';
const config={publicConfig:()=>({configured:true,model:'glm-5.3-flash'}),getPrivate:()=>({apiKey:'unit-private',model:'glm-5.3-flash'})};
async function setup(client){
 const dir=await fs.mkdtemp('D:/Codex project/outputs/service-quality-import-adaptation-20261029/api-');
 const server=await createWorkbenchServer({dataDir:dir,modelConfig:config,arkClient:client});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`,workspace=await(await fetch(origin+'/api/workspace')).json();
 return{server,origin,headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':workspace.token},close:()=>new Promise(r=>server.close(r))};
}
test('rule preparation requires same origin/token and returns candidates without changing workspace',async()=>{
 let calls=0;const f=await setup({prepareRules:async({input,config})=>{calls++;assert.equal(config.apiKey,'unit-private');assert.equal(input.text,'虚构规则原文');return{candidates:[],modelId:'unit-model'};}});
 try{
  let response=await fetch(f.origin+'/api/rules/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);assert.equal(calls,0);
  response=await fetch(f.origin+'/api/rules/prepare',{method:'POST',headers:f.headers,body:JSON.stringify({text:'虚构规则原文',scene:'新品产品咨询',sourceName:'规则.txt'})});assert.equal(response.status,200);assert.equal(calls,1);
  const value=await response.json();assert.equal(value.modelId,'unit-model');assert(!JSON.stringify(value).includes('unit-private'));
  assert.equal((await(await fetch(f.origin+'/api/workspace')).json()).revision,0);
 }finally{await f.close();}
});
test('invalid rule request does not reach provider and close cancels active preparation',async()=>{
 let called,aborted;const started=new Promise(r=>called=r),stopped=new Promise(r=>aborted=r);
 const f=await setup({prepareRules:async({signal})=>{called();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(Object.assign(new Error('已取消'),{status:400}));},{once:true}));}});
 const response=await fetch(f.origin+'/api/rules/prepare',{method:'POST',headers:f.headers,body:JSON.stringify({text:'x',scene:'新品产品咨询',sourceName:'x.txt',apiKey:'forbidden'})});assert.equal(response.status,400);
 const pending=fetch(f.origin+'/api/rules/prepare',{method:'POST',headers:f.headers,body:JSON.stringify({text:'虚构规则',scene:'新品产品咨询',sourceName:'x.txt'})});await started;
 const closing=f.close();await stopped;await pending;await closing;
});
test('frontend rule preparation uses the local token and does not merge candidates into workspace',async()=>{
 const requests=[];let rev=1;
 const {createInitialState}=await import('../public/domain.mjs'),{createCatalog}=await import('../public/catalog.mjs');
 const document={initialized:true,revision:rev,token:'a'.repeat(64),state:createInitialState(),catalog:createCatalog()};
 const client=createWorkspaceClient({fetchImpl:async(url,options={})=>{requests.push({url,options});return{ok:true,json:async()=>url==='/api/workspace'?document:{candidates:[],modelId:'unit-model'}};}});
 await client.load();const before=client.snapshot;assert.equal(typeof client.prepareRules,'function');await client.prepareRules({text:'虚构',scene:'新品产品咨询',sourceName:'规则.txt'});
 assert.equal(requests.at(-1).options.headers['X-Workspace-Token'],document.token);assert.deepEqual(client.snapshot,before);
});
