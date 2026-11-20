import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createBusinessExportManager} from '../public/business-export-manager.mjs';
import {BUSINESS_CONCURRENCY_STORAGE_KEY,readBusinessConcurrencyPreference,writeBusinessConcurrencyPreference} from '../public/business-concurrency-preference.mjs';
import {taskStartSettings} from '../public/task-workbench.mjs';
import {normalizeExecutionSettings} from '../public/execution-settings.mjs';
import {queueSettings} from '../server/ai-service.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {createTranslationJobs} from '../server/translation-jobs.mjs';
import {businessUI,managerState,summaryFixture,reportFixture} from './business-report-fixtures.mjs';
import {consultationRuntimeFixture,consultationReportAnswer} from './consultation-runtime-fixture.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){const end=Date.now()+8000;while(!predicate()){if(Date.now()>end)throw new Error('Synthetic concurrency gate timeout');await delay(5);}}
function storage(initial){const values=new Map(initial===undefined?[]:[[BUSINESS_CONCURRENCY_STORAGE_KEY,initial]]);return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
function managerFixture(t,{saved,storageImpl=storage(saved),ui=businessUI(),api=async()=>({jobs:[]}),translationClient}={}){
 const state=managerState(),manager=createBusinessExportManager({api,getState:()=>state,getUI:()=>ui,download:()=>{},concurrencyStorage:storageImpl,translationClient,pollMs:100000});t.after(()=>manager.close());
 return{state,ui,manager,storage:storageImpl};
}

test('01119 delivery preference survives manager/page recreation for 2, 3 and 4 without sharing profiles',async t=>{
 for(const choice of [2,3,4]){
  const local=storage(),first=managerFixture(t,{storageImpl:local});first.manager.view(first.state,first.ui);assert.equal(first.ui.businessConcurrency,4);
  first.manager.handleChange('business-concurrency',String(choice));assert.equal(local.getItem(BUSINESS_CONCURRENCY_STORAGE_KEY),String(choice));first.manager.close();
  const refreshed=managerFixture(t,{storageImpl:local});refreshed.manager.view(refreshed.state,refreshed.ui);assert.equal(refreshed.ui.businessConcurrency,choice);
  const separateProfile=managerFixture(t);separateProfile.manager.view(separateProfile.state,separateProfile.ui);assert.equal(separateProfile.ui.businessConcurrency,4);
 }
});

test('01119 absent, corrupt and unavailable localStorage safely use four and writing is best effort',t=>{
 for(const value of [undefined,'','1','5','NaN','null','{}','2.5','02',' 3 '])assert.equal(readBusinessConcurrencyPreference(storage(value)),4);
 for(const value of ['2','3','4'])assert.equal(readBusinessConcurrencyPreference(storage(value)),Number(value));
 for(const local of [null,{getItem(){throw new Error('Storage blocked');},setItem(){throw new Error('Storage blocked');}}]){
  assert.equal(readBusinessConcurrencyPreference(local),4);assert.equal(writeBusinessConcurrencyPreference(2,local),false);
  const f=managerFixture(t,{storageImpl:local});assert.doesNotThrow(()=>f.manager.view(f.state,f.ui));assert.equal(f.ui.businessConcurrency,4);assert.doesNotThrow(()=>f.manager.handleChange('business-concurrency','2'));assert.equal(f.ui.businessConcurrency,2);
 }
 const local=storage('3');assert.equal(writeBusinessConcurrencyPreference(5,local),false);assert.equal(local.getItem(BUSINESS_CONCURRENCY_STORAGE_KEY),'3');
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Profile unavailable');}});assert.equal(readBusinessConcurrencyPreference(),4);assert.equal(writeBusinessConcurrencyPreference(2),false);}
 finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage;}
});

test('01119 an explicit two is sent for both the base report and the derived English report',async t=>{
 const {snapshot,enrichment}=reportFixture(),baseRequests=[],derivedRequests=[];let job;
 const f=managerFixture(t,{saved:'2',ui:{...businessUI(),businessReportLanguage:'en'},api:async(url,options={})=>{
  if(options.method==='POST'){baseRequests.push(options.body);job=summaryFixture({id:options.body.jobId,status:'completed',concurrency:options.body.concurrency,options:{conclusionMode:'combined',targetLang:'zh',reportLanguage:'en'}});return{job};}
  if(url.endsWith('/result'))return{job,snapshot,enrichment};return{jobs:[]};
 },translationClient:{get:async()=>{throw Object.assign(new Error('missing'),{status:404});},create:async input=>{derivedRequests.push(input);return{job:{id:input.jobId,source:input.source,targetLang:input.targetLang,concurrency:input.concurrency,status:'running',resultAvailable:false}};}}});
 await f.manager.handleAction('business-generate');assert.equal(baseRequests.length,1);assert.equal(baseRequests[0].concurrency,2);assert.equal(derivedRequests.length,1);assert.equal(derivedRequests[0].concurrency,2);
});

test('01119 mounting frozen history never overwrites the next-job local preference',async t=>{
 const local=storage('4'),job=summaryFixture({concurrency:2,status:'paused',resultAvailable:false});
 const f=managerFixture(t,{storageImpl:local,api:async url=>url.includes('?taskId=')?{jobs:[job]}:{job}});
 f.manager.setActive(true);await tick();await tick();assert.equal(f.ui.businessConcurrency,4);assert.equal(local.getItem(BUSINESS_CONCURRENCY_STORAGE_KEY),'4');
 assert.equal(f.manager.handleChange('business-concurrency','3'),true);assert.equal(local.getItem(BUSINESS_CONCURRENCY_STORAGE_KEY),'3');assert.equal(job.concurrency,2);
});

test('01119 new AI defaults are four while legacy and frozen task start settings retain their original limits',()=>{
 assert.equal(normalizeExecutionSettings().concurrency,4);
 assert.equal(taskStartSettings({id:'new',executionSettings:normalizeExecutionSettings()}).concurrency,4);
 assert.equal(taskStartSettings({id:'legacy'}).concurrency,1);assert.equal(queueSettings().concurrency,1);
 assert.equal(taskStartSettings({id:'legacy-raw',inputMode:'raw-transcript-v1'}).concurrency,4);
 for(const concurrency of [1,2,3,4]){
  const task={id:'frozen',inputMode:'raw-transcript-v1',executionSettings:{concurrency:4},aiQueue:{status:'completed',settings:{concurrency,batchSize:20,maxWorkBytes:64000}}},before=structuredClone(task);
  assert.equal(taskStartSettings(task,{rawStartConcurrency:{frozen:4}}).concurrency,concurrency);assert.deepEqual(task,before);
 }
 assert.equal(taskStartSettings({id:'legacy-queue',aiQueue:{status:'paused',settings:{batchSize:20}}}).concurrency,1);
});

const base=path.resolve('tests/.concurrency01119');
const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-01119',authMode:'none',timeoutMs:120000};
const translated=input=>({items:input.items.map(item=>({id:item.id,translation:'Synthetic English translation '+item.id,isTargetLanguage:false,detectedLanguage:'zh'}))});
function gate(){
 const requests=[];let open=false,active=0,peak=0;
 return{requests,get active(){return active;},get peak(){return peak;},hook(request,answer){
  active++;peak=Math.max(peak,active);const entry={request,startedAt:Date.now(),active};requests.push(entry);
  const pending=open?Promise.resolve():new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;request.signal.addEventListener('abort',()=>reject(Object.assign(new Error('interrupted'),{code:'INTERRUPTED'})),{once:true});});
  return pending.then(()=>answer(request)).finally(()=>active--);
 },release(){open=true;requests.forEach(entry=>entry.resolve?.());}};
}
async function jobFixture(t,kind,{hook,maxAttempts=2}={}){
 await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,kind+'-'));
 const data=kind==='report'?await consultationRuntimeFixture(12):{state:{tasks:[{id:'TASK',basisSnapshot:{rules:[],policies:[]}}],sessions:[{id:'SESSION',taskId:'TASK',turns:Array.from({length:80},(_,i)=>({id:i+1,text:'合成测试会话第 '+i+' 条，请核查产品描述。'}))}]}};
 const create=kind==='report'?createReportJobs:createTranslationJobs,answer=request=>kind==='report'?consultationReportAnswer(request.kind,request.input):translated(request.input),calls=[];
 const options={dataDir:dir,store:{read:async()=>({state:structuredClone(data.state),revision:1}),getSource:async()=>({...data.task.source,bytes:data.bytes})},modelConfig:{getPrivate:()=>({...config})},client:{engine:'synthetic',async enrichBusinessReport(request){calls.push(request);return hook?hook(request,answer):answer(request);}},retryDelayMs:1,maxAttempts};
 let service=await create(options);
 t.after(async()=>{await service.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return{dir,calls,kind,get service(){return service;},input:(jobId,extra={})=>({jobId,...(kind==='report'?{taskId:data.task.id}:{source:{kind:'task',taskId:'TASK'},targetLang:'en'}),...extra}),file:jobId=>path.join(dir,kind==='report'?'report-jobs':'content-translations',jobId,'job.json'),async restart(){await service.close();service=await create(options);}};
}

for(const kind of ['report','translation']){
 test(`01119 new ${kind} defaults to four in-flight requests and a 429 retries at one without failing the job`,async t=>{
  const gated=gate(),f=await jobFixture(t,kind,{hook:(request,answer)=>gated.hook(request,answer)});t.after(()=>gated.release());
  const created=await f.service.create(f.input('new-default'));assert.equal(created.concurrency,4);await until(()=>gated.requests.length===4);await delay(25);assert.equal(gated.active,4);assert.equal(gated.peak,4);
  const limitedAt=Date.now();gated.requests[0].reject(Object.assign(new Error('synthetic HTTP 429'),{code:'RATE_LIMIT',retryAfterMs:1000}));for(const entry of gated.requests.slice(1))entry.resolve();
  await until(()=>gated.requests.length===5);assert.ok(gated.requests[4].startedAt-limitedAt>=950,'429 cooldown must finish before another provider request');await delay(30);assert.equal(gated.requests.length,5);assert.equal(gated.active,1,'only one provider request may run after the rate limit');
  gated.release();await f.service.waitForIdle();const job=await f.service.get('new-default');assert.equal(job.status,'completed');assert.equal(job.concurrency,4,'adaptive slowdown does not rewrite the saved user setting');assert.equal(gated.peak,4);assert.ok(gated.requests.slice(4).every(entry=>entry.active===1));assert.ok(job.nodes.some(node=>node.attempts===2));
 });

 test(`01119 ${kind} selected 2 survives failed-node retry and persisted history across restart`,async t=>{
  let fail=true;const gated=gate(),f=await jobFixture(t,kind,{maxAttempts:1,hook:(request,answer)=>{if(fail)throw Object.assign(new Error('synthetic invalid output'),{code:'INVALID_OUTPUT'});return gated.hook(request,answer);}});t.after(()=>gated.release());
  await f.service.create(f.input('selected-two',{concurrency:2}));await f.service.waitForIdle();assert.equal((await f.service.get('selected-two')).status,'completed_with_warnings');assert.equal(JSON.parse(await fs.readFile(f.file('selected-two'),'utf8')).concurrency,2);
  await f.restart();assert.equal((await f.service.list())[0].concurrency,2);fail=false;await f.service.retry('selected-two');await until(()=>gated.requests.length===2);await delay(25);assert.equal(gated.active,2);gated.release();await f.service.waitForIdle();assert.equal((await f.service.get('selected-two')).status,'completed');assert.equal((await f.service.get('selected-two')).concurrency,2);
  const before=await fs.readFile(f.file('selected-two'),'utf8');await f.restart();await f.service.list();await f.service.getResult('selected-two');await f.service.retry('selected-two');assert.equal((await f.service.create(f.input('selected-two',{concurrency:4}))).concurrency,2);assert.equal(await fs.readFile(f.file('selected-two'),'utf8'),before,'completed history must not be rewritten');
 });

 test(`01119 legacy ${kind} without a concurrency field stays at two and keeps the missing historical field`,async t=>{
  let gated=gate();const f=await jobFixture(t,kind,{hook:(request,answer)=>gated.hook(request,answer)});t.after(()=>gated.release());
  await f.service.create(f.input('legacy',{concurrency:2}));await until(()=>gated.requests.length===2);await f.service.pause('legacy');gated.release();await f.service.waitForIdle();await f.service.close();
  const file=f.file('legacy'),saved=JSON.parse(await fs.readFile(file,'utf8'));delete saved.concurrency;await fs.writeFile(file,JSON.stringify(saved));const paused=await fs.readFile(file,'utf8');await f.restart();assert.equal((await f.service.get('legacy')).concurrency,2);assert.equal(await fs.readFile(file,'utf8'),paused);
  gated=gate();await f.service.resume('legacy');await until(()=>gated.requests.length===2);await delay(25);assert.equal(gated.active,2);gated.release();await f.service.waitForIdle();assert.equal((await f.service.get('legacy')).status,'completed');assert.equal((await f.service.get('legacy')).concurrency,2);assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(file,'utf8')),'concurrency'),false);
  const frozen=await fs.readFile(file,'utf8');await f.restart();await f.service.getResult('legacy');assert.equal(await fs.readFile(file,'utf8'),frozen);
 });
}
