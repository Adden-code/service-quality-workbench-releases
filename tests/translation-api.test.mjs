import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkbenchServer} from '../server.mjs';

const base='D:/Codex project/outputs/service-english-20261105/translation/http-tests';
async function fixture(t){await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/api-'),calls=[];const server=await createWorkbenchServer({dataDir:dir,modelConfig:{publicConfig:()=>({configured:true}),getPrivate:()=>({configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'fixture',authMode:'none'})},arkClient:{engine:'synthetic',async enrichBusinessReport({kind,input}){calls.push({kind,input});return{items:input.items.map(item=>({id:item.id,translation:'Customer service report',isTargetLanguage:false,detectedLanguage:'zh'}))};}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port,workspace=await(await fetch(origin+'/api/workspace')).json();return{server,origin,calls,headers:{'X-Workspace-Token':workspace.token}};}
test('all translation reads require the workspace token and reject cross-origin requests',async t=>{
 const f=await fixture(t);for(const suffix of ['', '/missing','/missing/result','/missing/nodes/n1']){assert.equal((await fetch(f.origin+'/api/translation-jobs'+suffix)).status,403);assert.equal((await fetch(f.origin+'/api/translation-jobs'+suffix,{headers:{...f.headers,Origin:'https://untrusted.invalid'}})).status,403);}
 const response=await fetch(f.origin+'/api/translation-jobs',{headers:f.headers});assert.equal(response.status,200);assert.deepEqual(await response.json(),{jobs:[]});assert.equal(f.calls.length,0);
});
test('HTTP creates only allowed sources and persists asynchronous node evidence',async t=>{
 const f=await fixture(t),url=f.origin+'/api/translation-jobs',input={jobId:'http-job',source:{kind:'scenario',id:'新品产品咨询'},targetLang:'en'},mutation={method:'POST',headers:{...f.headers,'Content-Type':'application/json'},body:JSON.stringify(input)};
 assert.equal((await fetch(url,mutation)).status,403);assert.equal((await fetch(url,{...mutation,headers:{...mutation.headers,Origin:f.origin},body:JSON.stringify({...input,text:'arbitrary private text'})})).status,400);
 const response=await fetch(url,{...mutation,headers:{...mutation.headers,Origin:f.origin}});assert.equal(response.status,202);assert.equal(typeof f.server.waitForTranslationsIdle,'function');await f.server.waitForTranslationsIdle();
 const result=await(await fetch(url+'/http-job/result',{headers:f.headers})).json();assert.equal(result.job.status,'completed');assert.ok(result.translations.every(item=>item.status==='translated'));assert.ok(result.job.traceRunIds.length);const node=await(await fetch(url+'/http-job/nodes/'+result.job.nodes[0].id,{headers:f.headers})).json();assert.ok(node.input.items.length);assert.ok(node.output.items.length);assert.equal(node.attempts.length,1);
 assert.equal((await fetch(url+'/http-job/pause',{method:'POST',headers:{...f.headers,Origin:f.origin,'Content-Type':'application/json'},body:'{"text":"arbitrary"}'})).status,400);
 const list=await(await fetch(url+'?source='+encodeURIComponent(JSON.stringify(input.source)),{headers:f.headers})).json();assert.equal(list.jobs.length,1);assert.ok(f.calls.every(call=>call.kind==='translation'));
});
test('shared browser client sends the current token for every read and only explicit mutations',async()=>{
 const module=await import('../public/content-translation-client.mjs').catch(()=>({}));assert.equal(typeof module.createTranslationClient,'function','shared translation client must exist');let token='token-one';const calls=[];
 const client=module.createTranslationClient({getToken:()=>token,fetchImpl:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({job:{id:'job'}})};}});assert.equal(calls.length,0);const input={jobId:'job',source:{kind:'task',taskId:'TASK-1'},targetLang:'en'};assert.deepEqual(await client.create(input),{job:{id:'job'}});await client.get('job');token='token-two';await client.result('job');await client.list(input.source);await client.action('job','pause');
 assert.equal(calls.length,5);assert.ok(calls.every(call=>call.options.credentials==='same-origin'));assert.equal(calls[1].options.headers['X-Workspace-Token'],'token-one');assert.equal(calls[2].options.headers['X-Workspace-Token'],'token-two');assert.deepEqual(JSON.parse(calls[0].options.body),input);assert.equal(calls[4].options.body,'{}');await assert.rejects(client.action('job','delete'),/action|操作/i);assert.equal(calls.length,5);
});
