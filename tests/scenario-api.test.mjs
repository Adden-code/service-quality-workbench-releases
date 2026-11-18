import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';

const base='D:/Codex project/outputs/service-scenario-config-20261105/api-tests';
const now='2026-11-05T09:00:00+08:00';
const config=()=>({schemaVersion:1,id:'SCENE-API',name:'接口场景验证',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:[],analysisFields:['demandSummary'],customFields:[],report:{title:'接口质检报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','dimensions']},requiredCapabilities:['text-judgment'],createdAt:now,updatedAt:now});

// OS-assigned test ports can occasionally be on Fetch's forbidden-port list.
// This API test exercises HTTP, including Host/Origin/token checks, on any local port.
function localRequest(url,{method='GET',headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const request=http.request(url,{method,headers},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
      response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
    });
    request.on('error',reject);request.setTimeout(10000,()=>request.destroy(new Error('Local synthetic HTTP request timed out.')));request.end(body);
  });
}

async function setup(t,{enabled=true}={}){
  await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'api-')),calls=[];
  const settings={baseUrl:'http://127.0.0.1:1/v1',model:'local-api-test',authMode:'none',timeoutMs:120000,reasoningEffort:'low',maxTokens:null};
  const server=await createWorkbenchServer({dataDir,modelConfig:{getPrivate:()=>({...settings}),publicConfig:()=>({...settings,configured:true})},arkClient:{engine:'local-substitute',prepareRules:async request=>{calls.push(request.input);return{candidates:[],modelId:'local-api-test',promptVersion:'test'};}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await server.closeWorkspace();assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const initial=await(await localRequest(origin+'/api/workspace')).json(),headers={'Content-Type':'application/json',Origin:origin,'X-Workspace-Token':initial.token};
  const state={...createBusinessState(),scenarios:[{...config(),enabled}]},catalog=createBusinessCatalog();
  const saved=await localRequest(origin+'/api/workspace',{method:'PUT',headers,body:JSON.stringify({baseRevision:0,mutationId:'initial',state,catalog})});assert.equal(saved.status,200,await saved.text());
  return{origin,headers,calls};
}

test('registered custom scene can prepare rule candidates through authenticated HTTP',async t=>{
  const f=await setup(t);const response=await localRequest(f.origin+'/api/rules/prepare',{method:'POST',headers:f.headers,body:JSON.stringify({text:'客服应说明退货条件。',scene:'SCENE-API',sourceName:'本地测试规则'})});
  assert.equal(response.status,200,await response.text());assert.equal(f.calls.length,1);assert.equal(f.calls[0].scene,'SCENE-API');
});

test('unknown and disabled scenes are rejected before any rule model call',async t=>{
  const f=await setup(t,{enabled:false});
  for(const scene of ['SCENE-UNKNOWN','SCENE-API','任意未登记场景']){
    const response=await localRequest(f.origin+'/api/rules/prepare',{method:'POST',headers:f.headers,body:JSON.stringify({text:'客服应说明退货条件。',scene,sourceName:'本地测试规则'})});assert.equal(response.status,400);
  }
  assert.equal(f.calls.length,0);
});
