import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {EC_HEADERS,EC_RULE_IDS,ecommerceRecordId,ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';

test('report content routes enforce workspace token and same origin without a synchronous model request',async t=>{
 const base='D:/Codex project/outputs/service-business-delivery-20261104/api-tests';await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/api-');let calls=0;
 const server=await createWorkbenchServer({dataDir:dir,modelConfig:{publicConfig:()=>({configured:false}),getPrivate:()=>({configured:false,model:'fixture',authMode:'none',baseUrl:'http://127.0.0.1:1/v1'})},arkClient:{engine:'fixture',enrichBusinessReport:async()=>{calls++;throw new Error('must not run');}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+server.address().port,workspace=await(await fetch(origin+'/api/workspace')).json(),headers={'X-Workspace-Token':workspace.token};
 assert.equal((await fetch(origin+'/api/report-jobs')).status,403);
 assert.equal((await fetch(origin+'/api/report-jobs',{headers:{...headers,Origin:'https://elsewhere.invalid'}})).status,403);
 let response=await fetch(origin+'/api/report-jobs',{headers});assert.equal(response.status,200);assert.deepEqual((await response.json()).jobs,[]);
 response=await fetch(origin+'/api/report-jobs',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({jobId:'unavailable',taskId:'missing'})});assert.equal(response.status,400);
 assert.equal((await fetch(origin+'/api/report-jobs/missing/result',{headers})).status,404);assert.equal(calls,0);
});

test('HTTP job creation returns a frozen business result and persisted node evidence through real trace storage',async t=>{
 const base='D:/Codex project/outputs/service-business-delivery-20261104/api-tests';await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/positive-');const calls=[];
 const client={engine:'fixture',async enrichBusinessReport({kind,input}){calls.push(kind);if(kind==='translation')return{items:input.items.map(item=>({id:item.id,translation:'辅助译文',isTargetLanguage:false,detectedLanguage:'en'}))};if(kind==='caseHighlights')return{cases:input.candidates.slice(0,input.limit).map(row=>({id:row.id,score:4,commentary:'回应了顾客的实际体验',quote:row.reply.slice(0,8)}))};if(kind==='issueClusters')return{clusters:[{label:'回复校对',summary:'需要改善回复文本',memberIds:input.records.map(row=>row.id),action:'逐条校对并回应具体问题'}]};return{items:input.records.map(row=>({id:row.id,valid:true,scene:'产品质量',painPoint:'电池故障',reason:'评论有具体故障',evidenceQuote:row.comment.slice(0,8)}))};}};
 const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'fixture-report',authMode:'none',apiKey:null};
 const server=await createWorkbenchServer({dataDir:dir,arkClient:client,modelConfig:{publicConfig:()=>({configured:true}),getPrivate:()=>config}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});const origin='http://127.0.0.1:'+server.address().port;
 let doc=await(await fetch(origin+'/api/workspace')).json();const headers={'X-Workspace-Token':doc.token,Origin:origin,'Content-Type':'application/json'},source=await(await fetch(origin+'/api/sources',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'generated.xlsx'},body:'generated-source-only'})).json();
 const sessions=[3,7].map((row,index)=>{const raw=Array(22).fill('');raw[8]=index?'Excellent product quality.':'The battery is broken.';raw[9]=index?'Thank you for describing the useful feature.':'Please contact us for assistance.';raw[11]='Generated operator';raw[12]='2026-11-01 09:00:00';raw[13]='2026-11-01 10:00:00';raw[14]=index?'好评正向':'好评负向';for(let c=15;c<=20;c++)raw[c]='Pass';if(!index){raw[16]='Fail';raw[20]='Fail';raw[21]='Check spelling.';}const ecommerce={schemaVersion:1,sheet:'Sheet4',row,fileSha256:source.sha256,headers:[...EC_HEADERS],standards:Array(22).fill('生成标准'),raw,thresholdHours:24};return{id:ecommerceRecordId(ecommerce),...ecommerceSourceProjection(ecommerce),ecommerce};});
 const catalog=ensureEcommerceCatalog(createBusinessCatalog()),state=createImportedTask(createBusinessState(),{name:'Generated delivery API',reviewer:'Generated reviewer',source,sessions,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-04',ruleIds:EC_RULE_IDS})});
 let response=await fetch(origin+'/api/workspace',{method:'PUT',headers,body:JSON.stringify({state,catalog,baseRevision:0,mutationId:'report-positive-source'})});assert.equal(response.status,200,await response.clone().text());doc=await response.json();
 response=await fetch(origin+'/api/report-jobs',{method:'POST',headers,body:JSON.stringify({jobId:'http-positive-report',taskId:state.tasks[0].id,targetLang:'zh',conclusionMode:'combined'})});assert.equal(response.status,202);await server.waitForReportsIdle();
 response=await fetch(origin+'/api/report-jobs/http-positive-report/result',{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(result.job.status,'completed');assert.equal(result.snapshot.records.length,2);assert.deepEqual(result.snapshot.records.map(row=>row.sourceRow),[3,7]);assert.equal(result.snapshot.metrics.passed,1);assert.equal(result.snapshot.metrics.failed,1);assert.ok(result.job.traceRunIds.length);assert.ok(calls.includes('translation')&&calls.includes('voc')&&calls.includes('issueClusters')&&calls.includes('caseHighlights'));
 const first=result.job.nodes[0];response=await fetch(origin+`/api/report-jobs/http-positive-report/nodes/${first.id}`,{headers});const node=await response.json();assert.equal(node.attempts.length,1);assert.ok(node.input&&node.output);assert.equal((await fetch(origin+'/api/report-jobs/http-positive-report/result')).status,403);
});
