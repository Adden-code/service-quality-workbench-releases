import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {parseSceneCapability,executeSceneCapabilities,recordCapabilityOutcomes,reconcileCapabilityOutcomes,enforceSceneResults} from '../server/scene-capabilities.mjs';
import {defaultScenePackage,resolveSceneRuntime} from '../public/scene-configuration.mjs';
const quote='Hi synthetic customer',text=`${quote}. I need a device.\n${quote}. Battery issue.`;
const input={capability:'demandSummary',blocks:[{id:'raw',text}]};
const body=(q=quote)=>({status:'completed',value:{text:'Synthetic request'},confidence:'0.9',reason:'Synthetic reason',evidence:[{blockId:'raw',quote:q,start:'95',end:'121'}]});
const config={model:'synthetic',baseUrl:'http://127.0.0.1:1',authMode:'none'};
function fixture(){const p=defaultScenePackage({id:'Synthetic',name:'Synthetic',engine:'conversation'});p.configuration.executionMode='configured';p.configuration.capabilities=[{key:'demandSummary',phase:'pre',dependsOn:[]}];p.configuration.ruleDependencies={R:['demandSummary']};return {session:{rawTranscript:{text,timePolicy:{mode:'unavailable'}}},snapshot:{configuration:p.configuration,runtime:resolveSceneRuntime(p.configuration,{}),taxonomy:null},config,retryDelayMs:0};}
function client(output){const requests=[];return {requests,...createArkClient({fetchImpl:async(_,options)=>{const req=JSON.parse(options.body);requests.push(req);const content=output(requests.length);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]}));}})};}
test('ambiguous literal location has a typed validation reason without accepting model content',()=>{
 assert.throws(()=>parseSceneCapability(JSON.stringify(body()),input),e=>e.code==='INVALID_OUTPUT'&&e.validationReason==='evidence_ambiguous');
 const invalid=body();invalid.value={wrong:'field'};assert.throws(()=>parseSceneCapability(JSON.stringify(invalid),input),e=>e.code==='INVALID_OUTPUT'&&!e.validationReason);
 const mixed=body();mixed.evidence.push({blockId:'raw',quote:'invented',start:0,end:3});assert.throws(()=>parseSceneCapability(JSON.stringify(mixed),input),e=>e.code==='INVALID_OUTPUT'&&e.validationReason==='evidence_unverified');
});
test('correction extends a repeated quote and recovers unique-exact on attempt two',async()=>{
 const c=client(n=>body(n===1?quote:`${quote}. Battery issue.`)),r=await executeSceneCapabilities({...fixture(),client:c});
 assert.equal(c.requests.length,2);assert.match(c.requests[1].messages[0].content,/唯一命中.*扩展引文长度.*前后文/s);assert.equal(r.outputs.demandSummary.status,'completed');assert.equal(r.outputs.demandSummary.attempts,2);assert.equal(r.outputs.demandSummary.evidence[0].locatorRepair.method,'unique-exact');
});
test('exhausted ambiguity retains the candidate with an annotation and is cached across resume',async()=>{
 const c=client(()=>body()),args={...fixture(),client:c},r=await executeSceneCapabilities(args),v=r.outputs.demandSummary;
 assert.equal(c.requests.length,3);assert.equal(v.status,'completed');assert.equal(v.origin,'unverified');assert.deepEqual(v.value,{text:'Synthetic request'});assert.deepEqual(v.evidence,[]);assert.equal(v.confidence,.9);assert.equal(v.reason,'Synthetic reason');assert.equal(v.evidenceValidation.status,'unverified');
 const final=enforceSceneResults([{ruleId:'R',verdict:'符合',reason:'Synthetic',confidence:.9},{ruleId:'independent',verdict:'符合',reason:'Synthetic',confidence:.9}],args.snapshot,r,args.session);assert.equal(final[0].verdict,'符合');assert.equal(final[0].evidenceValidation.status,'unverified');assert.equal(final[1].verdict,'符合');
 assert.deepEqual(await executeSceneCapabilities({...args,previous:r}),r);assert.equal(c.requests.length,3);
 let monitor={};for(let i=0;i<34;i++)monitor=recordCapabilityOutcomes(monitor,String(i),r,{window:50,minimum:20,rate:.1});assert.equal(monitor.demandSummary.technicalFailures,0);assert.equal(monitor.demandSummary.unverifiedEvidence,34);assert.equal(monitor.demandSummary.businessUncertain,0);assert.equal(monitor.demandSummary.paused,false);
});
test('unrelated invalid output and mixed retry failures still count as technical failures',async()=>{
 for(const make of [()=>({...body(),confidence:'high'}),()=>({...body(),value:{wrong:1}}),n=>n===3?({...body(),confidence:'high'}):body()]){
  const c=client(make),r=await executeSceneCapabilities({...fixture(),client:c});assert.equal(r.outputs.demandSummary.status,'failed');let m={};for(let i=0;i<20;i++)m=recordCapabilityOutcomes(m,String(i),r,{window:50,minimum:20,rate:.1});assert.equal(m.demandSummary.technicalFailures,20);assert.equal(m.demandSummary.paused,true);
 }
});

test('legacy ambiguity is reclassified in its rolling order without rewriting protected outcomes or hiding other failures',()=>{
 const reason='能力最终技术失败（已尝试3次），依赖项转人工。能力结果引文在声明文本块内多处命中，无法唯一修复偏移；请人工核对。',policy={window:50,minimum:20,rate:.1};
 const sessions=Array.from({length:20},(_,i)=>({id:String(i),review:{status:'已确认'},sceneCapabilities:{outputs:{intent:{status:i<6?'failed':'completed',errorCode:i<3?'INVALID_OUTPUT':'NETWORK',reason}}}})),before=structuredClone(sessions),monitor={intent:{rows:sessions.map(s=>({sessionId:s.id,status:s.sceneCapabilities.outputs.intent.status})),total:20,technicalFailures:6,businessUncertain:0,rate:.3,paused:true}};
 const fixed=reconcileCapabilityOutcomes(monitor,sessions,policy);assert.deepEqual(sessions,before);assert.deepEqual(fixed.intent.rows.map(r=>r.sessionId),monitor.intent.rows.map(r=>r.sessionId));assert.equal(fixed.intent.evidenceAmbiguities,3);assert.equal(fixed.intent.technicalFailures,3);assert.equal(fixed.intent.paused,true);
 for(let i=3;i<6;i++)sessions[i].sceneCapabilities.outputs.intent.status='completed';const clear=reconcileCapabilityOutcomes(fixed,sessions,policy);assert.equal(clear.intent.technicalFailures,0);assert.equal(clear.intent.paused,false);
 const spoof=recordCapabilityOutcomes({},'spoof',{outputs:{intent:{status:'failed',errorCode:'INVALID_OUTPUT',reason:'provider error 多处命中'}}},policy);assert.equal(spoof.intent.technicalFailures,1);
});

test('monitor and diagnostic summary distinguish ambiguous evidence in both languages',async()=>{
 const {sceneCapabilityMonitor}=await import('../public/scene-review-view.mjs'),{taskProblemSummary}=await import('../public/task-diagnostics.mjs'),{setLocale}=await import('../public/i18n.mjs');
 const task={id:'Synthetic',capabilityMonitor:{demandSummary:{rows:[],total:34,technicalFailures:0,businessUncertain:6,evidenceAmbiguities:6,rate:0,paused:false}}};
 try{setLocale('zh');assert.match(sceneCapabilityMonitor(task),/其中引文歧义.*6/);setLocale('en');assert.match(sceneCapabilityMonitor(task),/ambiguous quotes.*6/);assert.equal(JSON.parse(taskProblemSummary(task)).capabilities[0].evidenceAmbiguities,6);}finally{setLocale('zh');}
});
