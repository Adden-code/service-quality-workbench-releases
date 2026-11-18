import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRawInspectionResult} from '../server/raw-inspection.mjs';
import {rawSession,rawBasis,rawWire} from './raw-contract-r16-fixtures.mjs';
import {validateRawResultAssurance} from '../public/raw-evidence.mjs';
import {hasVerifiableAIEvidence} from '../public/evidence-status.mjs';
test('unverified raw quote retains verdict and reason, persists, but cannot calibrate',()=>{
 const session=rawSession(),basis=rawBasis(),wire=rawWire(session);wire.results[0].evidenceQuotes=[{quote:'Synthetic nonmatching quote'}];
 const results=parseRawInspectionResult(JSON.stringify(wire),{session,basis},{allowDegraded:true});
 assert.equal(results[0].verdict,'符合');assert.equal(results[0].reason,wire.results[0].reason);assert.equal(results[0].rawValidation.status,'unverified-quote');
 assert.equal(validateRawResultAssurance(results[0],session).valid,true);assert.equal(hasVerifiableAIEvidence(results[0],session),false);assert.equal(hasVerifiableAIEvidence(results[1],session),true);
 const corrupt=structuredClone(wire);corrupt.results[0].confidence='high';assert.throws(()=>parseRawInspectionResult(JSON.stringify(corrupt),{session,basis},{allowDegraded:true}));
});

import {evidenceStatusLabel,hasUnverifiedEvidence} from '../public/evidence-status.mjs';
import {sceneReviewEvidence} from '../public/scene-review-view.mjs';
import {freezeEvidenceAudit,appendEvidenceSheets,evidenceAuditHtml} from '../public/evidence-audit.mjs';
import {executeSceneCapabilities,enforceSceneResults,recordCapabilityOutcomes} from '../server/scene-capabilities.mjs';
import {defaultScenePackage,resolveSceneRuntime} from '../public/scene-configuration.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {readingLayout,saveReadingLayout} from '../public/raw-review-layout.mjs';
test('all quote-only defects retain valid auxiliary values after bounded retries; malformed value still fails',async()=>{
 const text='hello again. hello again.',pkg=defaultScenePackage({id:'S',name:'Synthetic',engine:'conversation'});pkg.configuration.executionMode='configured';pkg.configuration.capabilities=[{key:'demandSummary',phase:'pre',dependsOn:[]}];pkg.configuration.ruleDependencies={R:['demandSummary']};
 const snapshot={configuration:pkg.configuration,runtime:resolveSceneRuntime(pkg.configuration,{}),taxonomy:null},session={rawTranscript:{text,timePolicy:{mode:'unavailable'}}};
 for(const evidence of [[],[{blockId:'raw',quote:'absent',start:0,end:6}],[{blockId:'raw',quote:'hello',start:'bad',end:'bad'}],[{blockId:'unknown',quote:'hello',start:0,end:5}]]){
  let calls=0;const body={status:'completed',value:{text:'Synthetic request'},reason:'Synthetic reason',confidence:'0.85',evidence};const client=createArkClient({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(body)}}]}));}});
  const r=await executeSceneCapabilities({session,snapshot,client,config:{model:'synthetic',baseUrl:'http://127.0.0.1:1',authMode:'none'},retryDelayMs:0});const value=r.outputs.demandSummary;
  assert.equal(calls,3);assert.equal(value.status,'completed');assert.deepEqual(value.value,body.value);assert.equal(value.reason,body.reason);assert.equal(value.origin,'unverified');assert.deepEqual(value.evidenceValidation.rejectedQuotes.map(q=>q.quote),evidence.length?evidence.map(q=>q.quote):[null]);
  const final=enforceSceneResults([{ruleId:'R',verdict:'符合',reason:'Reason',confidence:.95}],snapshot,r,session)[0];assert.equal(final.verdict,'符合');assert.equal(final.reason,'Reason');assert.equal(hasUnverifiedEvidence(final),true);
  let monitor={};for(let i=0;i<34;i++)monitor=recordCapabilityOutcomes(monitor,String(i),r,{window:50,minimum:20,rate:.1});assert.equal(monitor.demandSummary.technicalFailures,0);assert.equal(monitor.demandSummary.unverifiedEvidence,34);assert.equal(monitor.demandSummary.paused,false);
 }
});
test('capability review shows business rows and timing labels without internal JSON or enum tokens',()=>{
 const session={sceneCapabilities:{outputs:{site:{status:'uncertain',origin:'configuration.pending',reason:'configuration.pending'},demandSummary:{status:'completed',origin:'unverified',reason:'Synthetic request'},timing:{status:'completed',metrics:[{metric:'firstResponseDuration',siteId:'Synthetic site',standard:{value:2,unit:'minutes'},actual:[{value:1}],timeSource:'source-turn-timestamp',verdict:'符合'}]}}}};
 const html=sceneReviewEvidence(session,'R');assert.match(html,/站点标准待维护/);assert.match(html,/首次响应时长/);assert.match(html,/依据未核验/);assert.doesNotMatch(html,/<pre|configuration[.]pending|firstResponseDuration|source-turn-timestamp|"status"/);
});
test('exports preserve AI evidence status after manual confirmation and include per-rule audit in both languages',()=>{
 const session=rawSession(),basis=rawBasis(),wire=rawWire(session);wire.results[0].evidenceQuotes=[{quote:'absent'}];session.aiResults=parseRawInspectionResult(JSON.stringify(wire),{session,basis},{allowDegraded:true});session.expectedRuleIds=session.aiResults.map(r=>r.ruleId);session.taskId='T';session.review={status:'已确认',drafts:{[session.expectedRuleIds[0]]:{...session.aiResults[0],source:'AI接受'},[session.expectedRuleIds[1]]:{...session.aiResults[1],source:'人工修改',evidenceQuotes:[]}}};
 const evidenceAudit=freezeEvidenceAudit({sessions:[session]},{id:'T'}),snapshot={records:[{id:session.id,sourceRow:7}],evidenceAudit};assert.deepEqual(evidenceAudit.map(r=>r.finalStatus),['未核验','人工提供']);
 for(const english of [false,true]){const sheets=appendEvidenceSheets([{name:'Main',headers:['Original'],rows:[['unchanged']]}],snapshot,english);assert.equal(sheets[0].rows[0][0],'unchanged');assert.equal(sheets[0].rows[0][1],english?'Unverified':'未核验');assert.equal(sheets[1].rows.length,2);assert.match(evidenceAuditHtml(snapshot,english),english?/Unverified/:/未核验/);}
 const grouped=appendEvidenceSheets([{name:'Main',headerDepth:2,headers:['Group'],rows:[['Name'],['Data']],rowNumbers:[null,7]}],snapshot);assert.equal(grouped[0].rows[1].at(-1),'未核验');assert.equal(evidenceStatusLabel(session.review.drafts[session.expectedRuleIds[0]],{human:true}),'未核验');
});
test('reading preferences are bounded, task-specific and tolerate unavailable storage',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};saveReadingLayout('A',{ratio:65,mode:'source',font:20},storage);assert.equal(readingLayout('A',storage).ratio,65);assert.equal(readingLayout('B',storage).font,16);assert.equal(saveReadingLayout('A',{ratio:999,mode:'bad',font:0},storage).ratio,75);assert.doesNotThrow(()=>readingLayout('A',{getItem(){throw Error('unavailable');}}));
});

test('known legacy quote-only failures stop poisoning breaker counts without rewriting old outcomes',()=>{
 const value={status:'failed',errorCode:'INVALID_OUTPUT',reason:'能力最终技术失败（已尝试3次），依赖项转人工。能力结果引文未在声明的原始文本块逐字命中。'},before=structuredClone(value);let m={};for(let i=0;i<25;i++)m=recordCapabilityOutcomes(m,String(i),{outputs:{intent:value}},{window:50,minimum:20,rate:.1});assert.equal(m.intent.technicalFailures,0);assert.equal(m.intent.paused,false);assert.equal(m.intent.unverifiedEvidence,25);assert.deepEqual(value,before);
});
