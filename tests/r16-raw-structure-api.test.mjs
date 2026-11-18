import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkbenchServer} from '../server.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {parseCleaningResult} from '../server/conversation-cleaning.mjs';
const base=path.resolve('../reports-r16/http-data');
async function fixture(t,{hook}={}){
 await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'structure-')),calls=[],config={baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-structure-http',authMode:'none',configured:true,connectionTested:true,timeoutMs:1000,reasoningEffort:null,maxTokens:null};
 const client={engine:'synthetic-injected',prepareConversationCleaning:async request=>{calls.push({row:request.input.row,text:request.input.text});if(hook)await hook(request);return parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:request.input.text,sourceLocator:{start:0,end:request.input.text.length},textQuote:request.input.text,role:'客户',roleQuote:'客户',warnings:[]}],warnings:[]}),request.input);}};
 const options={dataDir,arkClient:client,catalogSeed:async()=>null,modelConfig:{publicConfig:()=>({...config}),getPrivate:()=>({...config})}};let server,origin,headers;
 async function start(){server=await createWorkbenchServer(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;assert.notEqual(server.address().port,14987);const workspace=await(await fetch(origin+'/api/workspace')).json();headers={'X-Workspace-Token':workspace.token,Origin:origin,'Content-Type':'application/json'};}
 await start();t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const get=(url,overrides={})=>fetch(origin+url,{headers:{...headers,...overrides}}),post=(url,value,overrides={})=>fetch(origin+url,{method:'POST',headers:{...headers,...overrides},body:JSON.stringify(value)});
 async function source(){
  const bytes=await workbook([{name:'Synthetic raw',headers:['会话ID','客服','消息详情','保留列'],rows:[['SYN-HTTP-1','Synthetic agent','客户：合成问题一。','  exact extension one  '],['SYN-HTTP-2','Synthetic agent','客户：合成问题二。','  exact extension two  ']]}]);
  const response=await fetch(origin+'/api/sources',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'synthetic-raw-http.xlsx'},body:bytes});assert.equal(response.status,201);const archived=await response.json(),parsed=await parseRawTranscriptFile({name:archived.name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,parsed.errors.join(';'));
  const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds:['R004'],now:'2026-11-12T00:00:00Z'}),state=createImportedTask(createBusinessState(),{name:'Synthetic optional structure HTTP',sessions:parsed.sessions,source:archived,basisSnapshot,reviewer:'Synthetic reviewer',now:'2026-11-12T00:00:00Z'});
  const saved=await fetch(origin+'/api/workspace',{method:'PUT',headers,body:JSON.stringify({baseRevision:0,mutationId:'synthetic-raw-http',state,catalog})});assert.equal(saved.status,200,await saved.clone().text());return(await saved.json()).state;
 }
 return{config,calls,get,post,source,get origin(){return origin;},get headers(){return headers;},get server(){return server;},async restart(){await new Promise(resolve=>server.close(resolve));await start();}};
}
test('raw structure HTTP rejects absent or bad tokens, foreign origins, unsupported methods, missing consent and untested models',async t=>{
 const f=await fixture(t),route='/api/raw-structure-jobs';
 for(const url of [route,route+'/missing',route+'/missing/result',route+'/missing/nodes/n1'])assert.equal((await fetch(f.origin+url)).status,403);
 assert.equal((await f.get(route,{'X-Workspace-Token':'a'.repeat(64)})).status,403);assert.equal((await f.get(route,{Origin:'https://synthetic-foreign.invalid'})).status,403);
 for(const overrides of [{'X-Workspace-Token':'wrong'},{Origin:'https://synthetic-foreign.invalid'},{Origin:''}])assert.equal((await f.post(route,{jobId:'synthetic-denied',taskId:'missing',consent:true},overrides)).status,403);
 assert.equal((await f.post(route,{}, {'Content-Type':'text/plain'})).status,415);assert.equal((await fetch(f.origin+route,{method:'PATCH',headers:f.headers})).status,405);assert.equal((await f.post(route,{jobId:'synthetic-no-consent',taskId:'missing'})).status,400);
 f.config.connectionTested=false;assert.equal((await f.post(route,{jobId:'synthetic-untested',taskId:'missing',consent:true})).status,409);assert.equal(f.calls.length,0);assert.deepEqual((await(await f.get(route)).json()).jobs,[]);
});
test('raw structure HTTP create/list/get/result/nodes/pause/resume/retry and server restart preserve independent progress',async t=>{
 let arrived,release,hold=true,failSecond=true;const started=new Promise(resolve=>{arrived=resolve;});
 const f=await fixture(t,{hook:async({input,signal})=>{if(input.row===2&&hold){hold=false;arrived();await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Object.assign(new Error('synthetic abort'),{code:'ABORTED'})),{once:true});});}if(input.row===3&&failSecond)throw Object.assign(new Error('synthetic validation failure'),{code:'INVALID_OUTPUT'});}}),state=await f.source(),taskId=state.tasks[0].id,route='/api/raw-structure-jobs',id='synthetic-http-structure';
 let response=await f.post(route,{jobId:id,taskId,consent:true});assert.equal(response.status,202,await response.clone().text());await started;const created=(await response.json()).job;assert.equal(created.total,2);
 assert.equal((await f.post(`${route}/${id}/pause`,{unexpected:true})).status,400);assert.equal((await f.post(`${route}/${id}/cancel`,{})).status,404);response=await f.post(`${route}/${id}/pause`,{});assert.equal(response.status,200);assert.equal((await response.json()).job.status,'paused');release();await f.server.waitForRawStructureIdle();
 const paused=(await(await f.get(`${route}/${id}`)).json()).job;assert.equal(paused.status,'paused');assert.equal(paused.completed,1);assert.equal(paused.pending,1);assert.equal((await(await f.get(`${route}?taskId=${taskId}`)).json()).jobs[0].id,id);assert.deepEqual((await(await f.get(`${route}?taskId=other`)).json()).jobs,[]);
 const partial=await(await f.get(`${route}/${id}/result`)).json();assert.equal(partial.artifact.kind,'ai-unverified-draft');const node=await(await f.get(`${route}/${id}/nodes/n1`)).json();assert.equal(node.attempts.length,1);assert.equal(node.input.row,2);assert.ok(node.output.segments.length);assert.ok(partial.job.traceRunIds.length,'Real trace store records independent structure executions.');
 assert.equal((await f.post(`${route}/${id}/resume`,{})).status,200);await f.server.waitForRawStructureIdle();const failed=(await(await f.get(`${route}/${id}`)).json()).job;assert.equal(failed.status,'completed_with_warnings');assert.equal(failed.failed,1);assert.equal(f.calls.filter(call=>call.row===2).length,1);
 failSecond=false;assert.equal((await f.post(`${route}/${id}/retry`,{})).status,200);await f.server.waitForRawStructureIdle();const complete=(await(await f.get(`${route}/${id}`)).json()).job;assert.equal(complete.status,'completed');assert.equal(complete.completed,2);assert.equal(f.calls.filter(call=>call.row===2).length,1);assert.equal(f.calls.filter(call=>call.row===3).length,3);
 assert.equal((await f.get(`${route}/${id}/nodes/unknown`)).status,404);assert.equal((await f.get(`${route}/${id}/result/extra`)).status,404);const workspace=await(await f.get('/api/workspace')).json();assert.deepEqual(workspace.state,state,'Optional jobs must not replace raw evidence, task state or reviews.');
 const calls=f.calls.length;await f.restart();const restored=await(await f.get(`${route}/${id}/result`)).json();assert.equal(restored.job.status,'completed');assert.equal(restored.artifact.kind,'ai-unverified-draft');assert.equal(f.calls.length,calls);assert.equal((await f.get('/')).status,200);
});
