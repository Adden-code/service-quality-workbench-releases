import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {modelConfigSnapshot} from '../server/model-config.mjs';
async function fixture(t){
 const parent=path.resolve('tests/.onboarding-scratch');await fs.mkdir(parent,{recursive:true});const dataDir=await fs.mkdtemp(path.join(parent,'cleaning-api-'));
 let configured={...modelConfigSnapshot({baseUrl:'http://127.0.0.1:10080/v1',model:'synthetic',authMode:'none'}),configured:true,connectionTested:true},calls=0;
 const modelConfig={getPrivate:()=>({...configured,apiKey:null}),publicConfig:()=>structuredClone(configured)};
 const arkClient={prepareConversationCleaning:async({input,config})=>{calls++;assert.equal(config.model,'synthetic');return {segments:[],warnings:[],sourceRow:input.row};}};
 const server=await createWorkbenchServer({dataDir,modelConfig,arkClient,catalogSeed:null});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 const initial=await(await fetch(origin+'/api/workspace')).json(),token=initial.token;
 const request=(route,value,options={})=>fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':token,...options},body:JSON.stringify(value)});
 const initialized=await fetch(origin+'/api/workspace',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify({baseRevision:0,mutationId:'initial',state:createBusinessState(),catalog:createBusinessCatalog()})});assert.equal(initialized.status,200);
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(dataDir.startsWith(parent+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const input={scene:'新品产品咨询',sourceName:'synthetic.xlsx',sheet:'Raw',row:2,sessionId:'S1',agent:'Agent',text:'Synthetic conversation',timezone:''};
 return{request,input,get model(){return modelConfigSnapshot(configured);},setConfig:changes=>configured={...configured,...changes},get calls(){return calls;}};
}
test('cleaning API uses only the explicit approved and successfully tested config in no-key mode',async t=>{
 const f=await fixture(t),response=await f.request('/api/conversations/clean',{input:f.input,consent:true,modelConfig:f.model});assert.equal(response.status,200);assert.equal(f.calls,1);
});
test('missing consent, missing successful test or changed endpoint never dispatches original text',async t=>{
 const f=await fixture(t);let response=await f.request('/api/conversations/clean',{input:f.input,consent:false,modelConfig:f.model});assert.equal(response.status,400);
 const approved=f.model;f.setConfig({connectionTested:false});response=await f.request('/api/conversations/clean',{input:f.input,consent:true,modelConfig:approved});assert.equal(response.status,409);
 f.setConfig({connectionTested:true,baseUrl:'http://127.0.0.1:10081/v1'});response=await f.request('/api/conversations/clean',{input:f.input,consent:true,modelConfig:approved});assert.equal(response.status,409);assert.equal(f.calls,0);
});
test('cleaning API retains same-origin token and registered-scene guards',async t=>{
 const f=await fixture(t);let response=await f.request('/api/conversations/clean',{input:f.input,consent:true,modelConfig:f.model},{'X-Workspace-Token':'0'.repeat(64)});assert.equal(response.status,403);
 response=await f.request('/api/conversations/clean',{input:{...f.input,scene:'电商评论回复'},consent:true,modelConfig:f.model});assert.equal(response.status,400);assert.equal(f.calls,0);
});
