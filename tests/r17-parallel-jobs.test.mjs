import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createTranslationJobs} from '../server/translation-jobs.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
import {consultationRuntimeFixture,consultationReportAnswer} from './consultation-runtime-fixture.mjs';

const base='D:/Codex project/outputs/service-r17-parallel-synthetic/tests';
const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-r17',authMode:'none',timeoutMs:120000};
const answer=input=>({items:input.items.map(item=>({id:item.id,translation:'Synthetic English translation for '+item.id,isTargetLanguage:false,detectedLanguage:'zh'}))});
const source=taskId=>({kind:'task',taskId});
async function until(predicate){const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw new Error('Synthetic gate timeout');await delay(5);}}
async function within(promise,milliseconds=5000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Synthetic completion timeout')),milliseconds);})]);}finally{clearTimeout(timer);}}
function gates(){const requests=[];let released=false;return{requests,hook(request){if(released)return Promise.resolve(answer(request.input));return new Promise((resolve,reject)=>{const done=value=>{request.signal.removeEventListener('abort',abort);resolve(value);},abort=()=>reject(Object.assign(new Error('interrupted'),{code:'INTERRUPTED'}));request.signal.addEventListener('abort',abort,{once:true});requests.push({...request,resolve:()=>done(answer(request.input)),reject});});},release(){released=true;for(const request of requests)request.resolve();}};}
async function translationFixture(t,{rows=80,hook,trace=false,maxAttempts=2}={}){
 await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/translations-');
 const state={tasks:['A','B'].map(id=>({id,basisSnapshot:{rules:[],policies:[]}})),sessions:['A','B'].map(taskId=>({id:'session-'+taskId,taskId,turns:Array.from({length:rows},(_,index)=>({id:index+1,text:`合成会话 ${taskId} 第 ${index+1} 条，请核查产品描述。`}))}))};
 const calls=[],traceStore=trace?await createWorkflowTraceStore({dataDir:dir}):undefined;
 const options={dataDir:dir,store:{read:async()=>({state:structuredClone(state),revision:1})},modelConfig:{getPrivate:()=>({...config})},client:{engine:'synthetic',async enrichBusinessReport(request){calls.push({input:structuredClone(request.input),at:Date.now()});return hook?hook(request):answer(request.input);}},traceStore,retryDelayMs:1,maxAttempts};
 let service=await createTranslationJobs(options);
 t.after(async()=>{await service.close();await traceStore?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return{calls,dir,traceStore,get service(){return service;},async restart(){await service.close();service=await createTranslationJobs(options);}};
}

test('R17 default 2 and configured 4 requests overlap within each independent task; pause drains without dispatching more',async t=>{
 const gate=gates(),f=await translationFixture(t,{hook:request=>gate.hook(request)});t.after(()=>gate.release());
 assert.equal((await f.service.create({jobId:'task-a',source:source('A'),targetLang:'en'})).concurrency,2);
 await until(()=>gate.requests.length===2);
 await f.service.create({jobId:'task-b',source:source('B'),targetLang:'en',concurrency:4});await until(()=>gate.requests.length===6);
 assert.equal(gate.requests.filter(r=>r.input.items[0].text.includes(' A ')).length,2);
 assert.equal(gate.requests.filter(r=>r.input.items[0].text.includes(' B ')).length,4);
 await f.service.pause('task-a');await f.service.pause('task-b');gate.release();await f.service.waitForIdle();assert.equal(f.calls.length,6);
 assert.equal((await f.service.get('task-a')).progress.done,2);assert.equal((await f.service.get('task-b')).progress.done,4);
 const sent=new Set(f.calls.flatMap(call=>call.input.items.map(item=>item.id))),before=f.calls.length;
 await f.restart();assert.equal(f.calls.length,before);await f.service.resume('task-a');await f.service.resume('task-b');await f.service.waitForIdle();
 assert.ok(f.calls.slice(before).every(call=>call.input.items.every(item=>!sent.has(item.id))));
 assert.equal((await f.service.getResult('task-a')).translations.length,80);assert.equal((await f.service.get('task-b')).status,'completed');
 const complete=f.calls.length;await f.service.create({jobId:'cached-copy',source:source('A'),targetLang:'en'});await f.service.waitForIdle();assert.equal(f.calls.length,complete);
 for(const value of [1,5,2.5,'2',null])await assert.rejects(f.service.create({jobId:'invalid',source:source('A'),targetLang:'en',concurrency:value}),error=>error.status===400);
});

test('R17 concurrent missing-only retry retains each partial batch across restart exactly once',async t=>{
 let partial=true;const accepted=new Set();const f=await translationFixture(t,{rows:32,maxAttempts:1,hook:async({input})=>{await delay(15);const value=answer(input);if(!partial)return value;accepted.add(value.items[0].id);return{items:value.items.slice(0,1)};}});
 await f.service.create({jobId:'partial',source:source('A'),targetLang:'en',concurrency:4});await f.service.waitForIdle();assert.equal((await f.service.getResult('partial')).translations.filter(item=>item.status==='translated').length,4);
 await f.restart();partial=false;const before=f.calls.length;await f.service.retry('partial');await f.service.waitForIdle();assert.equal((await f.service.get('partial')).status,'completed');
 const resent=f.calls.slice(before).flatMap(call=>call.input.items.map(item=>item.id));assert.equal(resent.length,28);assert.equal(new Set(resent).size,28);assert.ok(resent.every(id=>!accepted.has(id)));
 for(const node of (await f.service.get('partial')).nodes)assert.equal((await f.service.getNode('partial',node.id)).attempts.length,2);
});

test('R17 fatal error stops new dispatch and preserves a successful already-running sibling',async t=>{
 const gate=gates(),f=await translationFixture(t,{rows:40,hook:request=>gate.hook(request)});t.after(()=>gate.release());
 await f.service.create({jobId:'fatal',source:source('A'),targetLang:'en'});await until(()=>gate.requests.length===2);
 gate.requests[0].reject(Object.assign(new Error('synthetic forbidden'),{code:'AUTHENTICATION'}));await delay(30);gate.requests[1].resolve();await f.service.waitForIdle();
 const result=await f.service.getResult('fatal');assert.equal(f.calls.length,2);assert.equal(result.job.progress.done,1);assert.equal(result.translations.filter(item=>item.status==='translated').length,8);assert.equal(result.job.stopReason,'authentication');assert.equal(result.job.progress.pending,0);
});

test('R17 simultaneous rate limits back off and retry at one concurrent request without losing outputs',async t=>{
 let initial=0,active=0,peakAfter=0,limitedAt=0;const seen=new Map(),f=await translationFixture(t,{rows:32,hook:async({input})=>{
  const id=input.items[0].id;seen.set(id,(seen.get(id)||0)+1);
  if(initial++<2){await delay(15);limitedAt=Date.now();throw Object.assign(new Error('synthetic 429'),{code:'RATE_LIMIT',retryAfterMs:1000});}
  assert.ok(Date.now()-limitedAt>=950,'cooldown applies before retry or new provider dispatch');active++;peakAfter=Math.max(active,peakAfter);await delay(25);active--;return answer(input);
 }});
 await f.service.create({jobId:'limited',source:source('A'),targetLang:'en'});await f.service.waitForIdle();assert.equal(peakAfter,1);assert.equal(f.calls.length,6);assert.equal((await f.service.get('limited')).status,'completed');assert.deepEqual([...seen.values()].sort(),[1,1,2,2]);
});

test('R17 a 60-second cooldown in one task does not throttle another task and closing interrupts cooldown waits',async t=>{
 let retrying=false,limited=0,bActive=0,bPeak=0;const f=await translationFixture(t,{rows:32,hook:async({input})=>{
  if(input.items[0].text.includes(' A ')&&!retrying){limited++;throw Object.assign(new Error('synthetic 429'),{code:'RATE_LIMIT',retryAfterMs:60000});}
  if(input.items[0].text.includes(' B ')){bActive++;bPeak=Math.max(bPeak,bActive);await delay(25);bActive--;}
  return answer(input);
 }});
 await f.service.create({jobId:'cooling-a',source:source('A'),targetLang:'en'});await until(()=>limited>0);
 await f.service.create({jobId:'unaffected-b',source:source('B'),targetLang:'en'});
 await within((async()=>{while((await f.service.get('unaffected-b')).status==='running')await delay(5);})());
 assert.equal((await f.service.get('unaffected-b')).status,'completed');assert.equal(bPeak,2);assert.equal((await f.service.get('cooling-a')).status,'running');
 await within(f.service.close());assert.equal(f.service.isBusy(),false);assert.equal((await f.service.get('cooling-a')).status,'paused');
 retrying=true;await f.restart();const count=f.calls.length;await f.service.resume('cooling-a');await within(f.service.waitForIdle());assert.equal((await f.service.get('cooling-a')).status,'completed');assert.ok(f.calls.slice(count).every(call=>call.input.items.every(item=>item.text.includes(' A '))));
});

test('R17 fatal errors affect their own task while a second task continues with its full concurrency',async t=>{
 const gate=gates(),f=await translationFixture(t,{rows:32,hook:request=>gate.hook(request)});t.after(()=>gate.release());
 await f.service.create({jobId:'fatal-a',source:source('A'),targetLang:'en'});await f.service.create({jobId:'healthy-b',source:source('B'),targetLang:'en'});await until(()=>gate.requests.length===4);
 const a=gate.requests.filter(request=>request.input.items[0].text.includes(' A '));assert.equal(a.length,2);a[0].reject(Object.assign(new Error('synthetic denied'),{code:'PERMISSION'}));await delay(20);gate.release();await within(f.service.waitForIdle());
 assert.equal(f.calls.filter(call=>call.input.items[0].text.includes(' A ')).length,2);assert.equal(f.calls.filter(call=>call.input.items[0].text.includes(' B ')).length,4);
 assert.equal((await f.service.get('fatal-a')).stopReason,'permission');assert.equal((await f.service.get('healthy-b')).status,'completed');
});

test('R17 closing while a retry owns the reduced request slot also releases its waiting sibling without deadlock',async t=>{
 const gate=gates();let initial=0,retryMode=true;
 const f=await translationFixture(t,{rows:32,hook:async request=>{
  if(retryMode&&initial++<2){await delay(20);throw Object.assign(new Error('synthetic 429'),{code:'RATE_LIMIT'});}
  return retryMode?gate.hook(request):answer(request.input);
 }});t.after(()=>gate.release());
 await f.service.create({jobId:'slot-wait',source:source('A'),targetLang:'en'});await until(()=>gate.requests.length===1);await delay(30);
 assert.equal(f.calls.length,3,'one retry is active and the other waits for the reduced request slot');
 await within(f.service.close());assert.equal(f.service.isBusy(),false);assert.equal((await f.service.get('slot-wait')).status,'paused');
 retryMode=false;await f.restart();await f.service.resume('slot-wait');await within(f.service.waitForIdle());assert.equal((await f.service.get('slot-wait')).status,'completed');
});

test('R17 fatal sibling and soft pause wake long cooldown timers instead of delaying task settlement',async t=>{
 for(const action of ['fatal','pause']){
  const gate=gates(),f=await translationFixture(t,{rows:32,hook:request=>gate.hook(request)});t.after(()=>gate.release());
  await f.service.create({jobId:'wake-'+action,source:source('A'),targetLang:'en'});await until(()=>gate.requests.length===2);
  gate.requests[0].reject(Object.assign(new Error('synthetic 429'),{code:'RATE_LIMIT',retryAfterMs:60000}));await delay(30);
  if(action==='fatal')gate.requests[1].reject(Object.assign(new Error('synthetic auth'),{code:'AUTHENTICATION'}));
  else{await f.service.pause('wake-'+action);gate.requests[1].resolve();}
  await within(f.service.waitForIdle());assert.equal(f.calls.length,2);
  const job=await f.service.get('wake-'+action);assert.equal(job.status,action==='fatal'?'completed_with_warnings':'paused');assert.equal(job.stopReason,action==='fatal'?'authentication':'user_paused');
 }
});

test('R17 parallel trace registration splits at 64 nodes with complete unique provider evidence',async t=>{
 const f=await translationFixture(t,{rows:72,trace:true,hook:async({input,trace})=>{for(let n=0;n<8;n++)await trace.step('synthetic-'+n,{count:input.items.length},async()=>({ok:true}));return answer(input);}});
 await f.service.create({jobId:'trace-parallel',source:source('A'),targetLang:'en',concurrency:4});await f.service.waitForIdle();const job=await f.service.get('trace-parallel');assert.equal(job.status,'completed');assert.equal(job.traceRunIds.length,2);
 const nodes=[];for(const id of job.traceRunIds){const raw=JSON.parse(await fs.readFile(path.join(f.dir,'workflow-runs',id+'.json'),'utf8'));assert.ok(raw.nodes.length<=64);assert.ok(raw.nodes.every(node=>node.status==='completed'));nodes.push(...raw.nodes);}
 assert.equal(nodes.length,81);assert.equal(new Set(nodes.map(node=>node.id)).size,nodes.length);
});

test('R17 report translation and independent analysis overlap; another report starts while the first is active',async t=>{
 const data=await consultationRuntimeFixture(3);await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/reports-');
 const calls=[],pending=[];let released=false;
 const options={dataDir:dir,store:{read:async()=>({state:structuredClone(data.state),revision:1}),getSource:async()=>({...data.task.source,bytes:data.bytes})},modelConfig:{getPrivate:()=>({...config})},client:{engine:'synthetic',async enrichBusinessReport(request){calls.push(request);if(!released)await new Promise(resolve=>pending.push(resolve));return consultationReportAnswer(request.kind,request.input);}},retryDelayMs:1};
 const service=await createReportJobs(options);t.after(async()=>{released=true;pending.forEach(resolve=>resolve());await service.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 await service.create({jobId:'report-a',taskId:data.task.id});await until(()=>calls.length===2);assert.deepEqual(new Set(calls.map(call=>call.kind)),new Set(['translation','consultationAnalysis']));
 await service.create({jobId:'report-b',taskId:data.task.id});await until(()=>calls.length===4);await service.pause('report-a');await service.pause('report-b');released=true;pending.forEach(resolve=>resolve());await service.waitForIdle();assert.equal(calls.length,4);
 await service.resume('report-a');await service.resume('report-b');await service.waitForIdle();assert.equal((await service.get('report-a')).status,'completed');assert.equal((await service.get('report-b')).status,'completed');
});

test('R17 180-row identical uncached workload compares serialized provider with default 2 and configured 3',async t=>{
 const providerDelayMs=Number(process.env.SERVICE_R17_BENCHMARK_DELAY_MS??200);assert.ok(Number.isSafeInteger(providerDelayMs)&&providerDelayMs>=1&&providerDelayMs<=28000);
 const results=[];let baselineRequests;
 for(const concurrency of [1,2,3]){
  let tail=Promise.resolve(),active=0,peak=0;const work=async input=>{active++;peak=Math.max(peak,active);await delay(providerDelayMs);active--;return answer(input);};
  const f=await translationFixture(t,{rows:180,hook:({input})=>{if(concurrency!==1)return work(input);const next=tail.then(()=>work(input));tail=next.catch(()=>{});return next;}});
  const start=performance.now();await f.service.create({jobId:'benchmark',source:source('A'),targetLang:'en',concurrency:Math.max(2,concurrency)});await f.service.waitForIdle();const elapsedMs=Math.round(performance.now()-start);
  const requests=f.calls.map(call=>call.input.items.map(item=>item.id).join(',')).sort();baselineRequests??=requests;assert.deepEqual(requests,baselineRequests);assert.equal(f.calls.length,23);assert.equal((await f.service.getResult('benchmark')).translations.length,180);assert.equal((await f.service.get('benchmark')).status,'completed');assert.equal(peak,concurrency);
  results.push({concurrency,elapsedMs,calls:f.calls.length});
 }
 t.diagnostic(JSON.stringify({synthetic:true,providerDelayMs,rows:180,results,defaultRatio:results[1].elapsedMs/results[0].elapsedMs,configuredRatio:results[2].elapsedMs/results[0].elapsedMs,note:'23 batches require 12 waves at concurrency 2, so ideal ratio is 12/23 before checkpoint overhead; concurrency 3 uses 8 waves.'}));
 // Timing is diagnostic evidence, not a flaky CI assertion: machine load and
 // durable per-text cache writes contribute fixed overhead beyond provider time.
 t.diagnostic('Half-duration target at concurrency 3: '+(results[2].elapsedMs<=results[0].elapsedMs/2?'met':'not met; inspect checkpoint/CI overhead in the recorded measurements'));
});
