import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {executeSceneCapabilities,recordCapabilityOutcomes,enforceSceneResults} from '../server/scene-capabilities.mjs';
import {nativeExecutionContext,nativeProgramResults,adaptNativeRuleOutput,nativeMessages} from '../server/native-language-execution.mjs';
import {checkNativeProse} from '../public/native-language-validation.mjs';
import {hasVerifiableAIEvidence} from '../public/evidence-status.mjs';
import {calibrationScope} from '../public/rule-calibration-policy.mjs';
import {fixture,config,modelEnvelope,capabilityBody,ruleBody,materialSet} from './native-language-stage2-fixture.mjs';
import {freezeNativeLanguage,freezeTaskLanguageContract} from '../server/native-language-materials.mjs';
import {nativePolicy} from './native-language-fixture.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';

for(const language of ['en','zh'])test(`R39 step2 ${language}: reviewed native rule/capability prompts, source bytes and original evidence survive`,async()=>{
 const f=fixture(language),requests=[];const client=createArkClient({fetchImpl:async(_url,options)=>{const request=JSON.parse(options.body),data=JSON.parse(request.messages[1].content);requests.push(request);return modelEnvelope(data.capability?capabilityBody(data,language):ruleBody(data,language));}});
 const caps=await executeSceneCapabilities({session:f.session,snapshot:f.snapshot,client,config,nativeContext:f.context,retryDelayMs:0});
 const result=await client.inspect({session:f.session,basis:f.basis,config,nativeContext:f.context,sceneSnapshot:f.snapshot,sceneCapabilities:caps});
 assert.equal(caps.outputs.demandSummary.languageValidation.status,'verified');assert.equal(caps.outputs.demandSummary.evidence[0].locatorRepair.method,'unique-exact');
 assert.equal(result.results[0].verdict,'符合');assert.equal(result.results[0].nativeContract.originalVerdict,'PASS');assert.equal(result.results[0].languageValidation.status,'verified');
 assert.deepEqual(JSON.parse(requests[1].messages[1].content).session.turns,f.session.turns);assert.equal(result.results[0].evidenceQuotes[0].quote,f.session.turns[1].text);
 if(language==='en')for(const r of requests)assert.doesNotMatch(r.messages[0].content,/\p{Script=Han}/u);
 assert.equal(requests.length,2,'no display-translation request');
});
test('R39 step2 wrong language retries within budget, preserves candidate after budget and excludes B6',async()=>{
 const f=fixture(),client=createArkClient({fetchImpl:async(_u,o)=>modelEnvelope(ruleBody(JSON.parse(JSON.parse(o.body).messages[1].content),'zh'))});
 for(const attempt of [1,2])await assert.rejects(client.inspect({session:f.session,basis:f.basis,config,nativeContext:{...f.context,attempt,maxAttempts:3}}),e=>e.code==='INVALID_OUTPUT'&&e.nativeLanguageFailure&&e.traceOutput.candidates[0].verdict==='符合');
 const answer=await client.inspect({session:f.session,basis:f.basis,config,nativeContext:{...f.context,attempt:3,maxAttempts:3}}),r=answer.results[0];
 assert.equal(r.verdict,'符合');assert.match(r.reason,/坐席/);assert.equal(r.languageValidation.status,'mismatch');assert.equal(hasVerifiableAIEvidence(r),false);
});
test('R39 step2 auxiliary wrong language retains value, does not trip technical breaker, propagates assurance',async()=>{
 const f=fixture();let calls=0;const client=createArkClient({fetchImpl:async(_u,o)=>{calls++;return modelEnvelope(capabilityBody(JSON.parse(JSON.parse(o.body).messages[1].content),'zh'));}});
 const caps=await executeSceneCapabilities({session:f.session,snapshot:f.snapshot,client,config,nativeContext:f.context,retryDelayMs:0});
 assert.equal(calls,3);assert.equal(caps.outputs.demandSummary.status,'completed');assert.equal(caps.outputs.demandSummary.languageValidation.status,'mismatch');
 let monitor={};for(let i=0;i<25;i++)monitor=recordCapabilityOutcomes(monitor,String(i),caps,{window:50,minimum:20,rate:.1});
 assert.equal(monitor.demandSummary.technicalFailures,0);assert.equal(monitor.demandSummary.languageUnverified,25);assert.equal(monitor.demandSummary.paused,false);
 const results=[{ruleId:'NP-SYNTHETIC',verdict:'符合',reason:'The agent answers the customer request.'}];const merged=nativeProgramResults(results,enforceSceneResults(results,f.snapshot,caps,f.session),f.context,f.snapshot,caps);
 assert.equal(merged[0].verdict,'符合');assert.equal(hasVerifiableAIEvidence(merged[0]),false);
});
test('R39 step2 language detector does not equate Latin with English; short names uncertain; quotes exempt',()=>{
 assert.equal(checkNativeProse('Gracias por su comentario, el producto es muy bueno.','en').status,'mismatch');
 assert.equal(checkNativeProse('Acme','en').status,'uncertain');
 assert.equal(checkNativeProse('The customer asks for this product: هل يوجد؟','en',{sourceQuotes:['هل يوجد؟']}).status,'verified');
 assert.equal(checkNativeProse('坐席已回答用户所询问的问题。','zh').status,'verified');
});
test('R39 step2 missing or edited source/material and EC remain blocked; legacy verdicts not accepted on native wire',()=>{
 const f=fixture(),task=structuredClone(f.task);task.basisSnapshot.rules[0].failCriteria+=' changed';assert.throws(()=>nativeExecutionContext(task,f.frozen),{code:'NATIVE_SOURCE_MISMATCH'});
 const changed=structuredClone(f.frozen);changed.selected[0].title+=' changed';assert.throws(()=>nativeExecutionContext(f.task,changed));
 assert.throws(()=>nativeExecutionContext({...f.task,scene:'电商评论回复'},f.frozen),{code:'EC_ARBITRATION_PENDING'});
 assert.throws(()=>adaptNativeRuleOutput(JSON.stringify({results:[{verdict:'符合'}]})),{code:'INVALID_OUTPUT'});
 const zh=fixture('zh');assert.notDeepEqual(calibrationScope(f.task),calibrationScope(zh.task));
});
test('R39 step2 program dependency explanations use frozen language and preserve business UNKNOWN',()=>{
 const f=fixture(),before=[{ruleId:'NP-SYNTHETIC',verdict:'符合',reason:'The agent responds to the customer request.'}],caps={outputs:{demandSummary:{status:'uncertain'}}};
 const [r]=nativeProgramResults(before,enforceSceneResults(before,f.snapshot,caps,f.session),f.context,f.snapshot,caps);
 assert.equal(r.verdict,'无法判定');assert.match(r.reason,/Required auxiliary facts/);assert.doesNotMatch(r.reason,/\p{Script=Han}/u);
});
test('R39 step2 raw Arabic/Spanish input uses native machine verdict and frozen English rationale, no translation',async()=>{
 const f=fixture(),text='Customer: هل توجد نسخة زرقاء؟\nAgent: Sí, existe una versión azul. 😀';
 const bytes=await workbook([{name:'Synthetic',headers:['ID','客服','消息详情'],rows:[['SYN-RAW','Synthetic agent',text]]}]);
 const parsed=await parseRawTranscriptFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,parsed.errors.join(';'));
 const session=parsed.sessions[0];let payload;
 const client=createArkClient({fetchImpl:async(_u,o)=>{payload=JSON.parse(o.body);return modelEnvelope(ruleBody(JSON.parse(payload.messages[1].content)));}});
 const answer=await client.inspectRaw({session,basis:f.basis,config,nativeContext:f.context,outputLanguage:'en'});
 assert.equal(JSON.parse(payload.messages[1].content).record.text,text);assert.equal(answer.results[0].verdict,'符合');assert.equal(answer.results[0].languageValidation.status,'verified');assert.equal(answer.results[0].rawValidation.status,'verified');assert.doesNotMatch(payload.messages[0].content,/\p{Script=Han}/u);
});

test('R39 step2 all six NP model capabilities select frozen English instructions with complete taxonomy and exception coverage',async()=>{
 const f=fixture(),snapshot=structuredClone(f.snapshot);
 delete snapshot.languageExecution;delete snapshot.languageMaterialRef;
 snapshot.taxonomy={id:'SYN-TAXONOMY',version:1,labels:[{id:'parent',label:'售前',definition:'购买前'},{id:'child',parentId:'parent',label:'功能',definition:'询问功能'}],principles:['选择主关切'],examples:[{labelId:'child',original:'What can this product do?',translated:'产品有什么功能？'}]};
 snapshot.exceptions=[{id:'SYN-EXCEPTION',version:1,entries:[{id:'case-1',condition:'已指定型号无比较',result:'不适用',requires:['intent'],priority:1}]}];
 const materials=materialSet(f.basis,snapshot),freeze=ms=>freezeNativeLanguage(nativePolicy('en'),{materials:ms,promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});
 const frozen=freeze(materials),task=freezeTaskLanguageContract({...f.task,executionSnapshot:snapshot},nativePolicy('en'),frozen),context=nativeExecutionContext(task,frozen),requests=[];
 const client=createArkClient({fetchImpl:async(_u,o)=>{const request=JSON.parse(o.body),input=JSON.parse(request.messages[1].content);requests.push(request);const value={site:{siteId:'SYN-SITE'},intent:{labelId:'child'},demandSummary:{text:'The customer asks for product information.'},negativeVoice:{hasNegative:false,text:'The customer does not express a negative concern.'},translation:{text:'The customer asks whether a blue version is available.',detectedLanguage:'other'},timing:{firstCustomer:null,firstAgent:null,queries:[],completeCoverage:true}}[input.capability];return modelEnvelope({...capabilityBody(input),value});}});
 for(const capability of ['site','intent','demandSummary','negativeVoice','translation','timing']){
  const input={capability,blocks:[{id:'source',text:f.session.turns[0].text}],sites:[{id:'SYN-SITE',label:'Synthetic site',aliases:[]}],taxonomy:snapshot.taxonomy,targetLanguage:'en',dependencies:{},timePolicy:{mode:'structured-source'}};
  const answer=await client.inspectSceneCapability({config,input,nativeContext:context});assert.equal(answer.languageValidation.status,'verified',capability);
 }
 assert.equal(requests.length,6);for(const r of requests)assert.doesNotMatch(r.messages[0].content,/\p{Script=Han}/u);
 const intent=JSON.parse(requests[1].messages[1].content).taxonomy;assert.equal(intent.labels[1].parentId,'parent');assert.equal(intent.instructions.length,2);assert.match(intent.labels[1].definition,/customer/);
 const raw=nativeMessages({input:{session:f.session}},f.basis,context,{snapshot:task.executionSnapshot,sceneCapabilities:{outputs:{}}});assert.equal(raw.input.sceneContext.exceptionTables[0].entries[0].result,'NA');assert.equal(raw.input.sceneContext.exceptionTables[0].entries[0].priority,1);
 const incomplete=materialSet(f.basis,{...snapshot,taxonomy:{...snapshot.taxonomy,examples:[]}});const bad=freeze(incomplete),badTask=freezeTaskLanguageContract({...f.task,executionSnapshot:snapshot},nativePolicy('en'),bad);assert.throws(()=>nativeExecutionContext(badTask,bad),/Unreviewed taxonomy|coverage|configuration has changed/);
});
