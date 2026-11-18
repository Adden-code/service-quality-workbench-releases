import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRawInspection,parseRawInspectionResult,rawUnavailableResults,RAW_INSPECTION_PROMPT_VERSION} from '../server/raw-inspection.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {validateRawResultAssurance,rawTimeRuleIds,RAW_QUOTE_MATCHING_VERSION} from '../public/raw-evidence.mjs';
import {rawSession,rawBasis,rawWire,inspectionAt} from './raw-contract-r16-fixtures.mjs';

const config={baseUrl:'http://127.0.0.1:18999/v1',model:'synthetic-model',authMode:'none',timeoutMs:1000};
const nonTimeIds=['SYN-R1','SYN-R2'],timeIds=['SYN-TIME-1','SYN-TIME-2'];
function mixedBasis(){
 const basis=rawBasis(),timing={...basis.rules[1],category:'响应时效',title:'首次回复时长',passCriteria:'首次回复应在60秒内',failCriteria:'首次回复超过60秒'};
 basis.rules=[{...timing,id:timeIds[0]},basis.rules[0],{...timing,id:timeIds[1],category:'timing'},basis.rules[1]];
 return basis;
}
const unavailableSession=()=>rawSession('Customer: Return?\r\nAgent: Check the policy.\r\nمرحبا 😀\r\nRepeat. Repeat.',{rawTranscript:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}});
const parse=(wire,session=unavailableSession(),basis=mixedBasis(),options={})=>parseRawInspectionResult(typeof wire==='string'?wire:JSON.stringify(wire),{session,basis,outputLanguage:options.outputLanguage??'zh'},{allowDegraded:options.allowDegraded??false});
const respond=wire=>new Response(JSON.stringify({id:'synthetic-request',model:'synthetic-model',usage:{total_tokens:50},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]}),{headers:{'content-type':'application/json'}});
function assertProgramResult(result,session,language='zh'){
 assert.deepEqual(result,{ruleId:result.ruleId,verdict:'无法判定',reason:language==='en'?'Reliable source timestamps were not provided.':'未提供可靠来源时间',evidence:[],referenceIds:[],confidence:0,conflictsWith:[],turnRefs:[],evidenceQuotes:[],rawValidation:{schemaVersion:1,status:'verified',textSha256:session.rawTranscript.textSha256,evidenceMatching:RAW_QUOTE_MATCHING_VERSION,reasonCodes:['source_time_unavailable','missing_quote']}});
 assert.equal(validateRawResultAssurance(result,session).valid,true);
}

test('unavailable timing rules are excluded only from the model rule projection',()=>{
 const session=unavailableSession(),basis=mixedBasis(),beforeSession=structuredClone(session),beforeBasis=structuredClone(basis);
 const prepared=prepareRawInspection(session,basis,{inspectionAt});
 assert.deepEqual(prepared.input.basis.rules.map(rule=>rule.id),nonTimeIds);
 assert.deepEqual(prepared.input.timeRuleIds,timeIds);
 assert.equal(prepared.input.record.text,session.rawTranscript.text);assert.equal(prepared.input.record.source.textSha256,session.rawTranscript.textSha256);
 assert.deepEqual(prepared.input.basis.policies,prepareRawInspection(rawSession(),basis,{inspectionAt}).input.basis.policies);
 assert.deepEqual(session,beforeSession);assert.deepEqual(basis,beforeBasis);
 assert.equal(prepared.promptVersion,'raw-direct-quote-v1');assert.equal(RAW_INSPECTION_PROMPT_VERSION,'raw-direct-quote-v1');
});

test('timing categories preserve historical exact boundaries without new whitespace or width normalization',()=>{
 const basis=rawBasis(),template=basis.rules[1];
 basis.rules=[{...template,id:'SYN-CATEGORY-PADDED',category:' 服务时效 '},{...template,id:'SYN-CATEGORY-FULLWIDTH',category:'　ｒｅｓｐｏｎｓｅ　ｔｉｍｅ　'},{...template,id:'SYN-CATEGORY-EXACT',category:'服务时效'},{...template,id:'SYN-MIXED',category:'服务体验',title:'及时礼貌回复并准确说明条件',passCriteria:'及时回复并避免未经确认承诺',failCriteria:'回复不礼貌或未经确认承诺'}];
 assert.deepEqual(rawTimeRuleIds(basis),['SYN-CATEGORY-EXACT']);
 const prepared=prepareRawInspection(unavailableSession(),basis,{inspectionAt});
 assert.deepEqual(prepared.input.basis.rules.map(rule=>rule.id),['SYN-CATEGORY-PADDED','SYN-CATEGORY-FULLWIDTH','SYN-MIXED']);
 assert.deepEqual(prepared.input.timeRuleIds,['SYN-CATEGORY-EXACT']);
});

test('omitted program timing results are reconstructed in the complete frozen basis order',async t=>{
 for(const outputLanguage of ['zh','en'])await t.test(outputLanguage,()=>{
  const session=unavailableSession(),basis=mixedBasis(),wire=rawWire(session),beforeSession=structuredClone(session),beforeBasis=structuredClone(basis);
  wire.results[0].evidenceQuotes=[{quote:'Customer: Return?\nAgent: Check the policy.'}];wire.results.reverse();
  const results=parse(wire,session,basis,{outputLanguage});
  assert.deepEqual(results.map(result=>result.ruleId),basis.rules.map(rule=>rule.id));
  for(const result of results.filter(result=>timeIds.includes(result.ruleId)))assertProgramResult(result,session,outputLanguage);
  const nonTime=results.filter(result=>nonTimeIds.includes(result.ruleId));assert.deepEqual(nonTime.map(result=>result.verdict),['符合','符合']);
  assert.equal(nonTime[0].evidenceQuotes[0].quote,'Customer: Return?\r\nAgent: Check the policy.');
  assert.deepEqual(session,beforeSession);assert.deepEqual(basis,beforeBasis);
 });
});

test('known program timing objects ignore missing and malicious business fields, including duplicates',async t=>{
 const malicious=[{}, {verdict:'Pass'}, {reason:null}, {referenceIds:['FOREIGN','FOREIGN']}, {confidence:2}, {conflictsWith:['FOREIGN']}, {evidenceQuotes:[{quote:'fabricated time'}]}, {evidenceQuotes:'invalid'}, {turnRefs:{invalid:true}}, {verdict:'invalid',reason:3,confidence:'wrong',referenceIds:null,evidenceQuotes:null,conflictsWith:true}];
 for(const [index,fields] of malicious.entries())await t.test(String(index),()=>{
  const session=unavailableSession(),wire=rawWire(session);
  wire.results=[{ruleId:timeIds[0],...fields},...wire.results,{ruleId:timeIds[0],...fields},{ruleId:timeIds[1],...fields}];
  const results=parse(wire,session);
  for(const result of results.filter(result=>timeIds.includes(result.ruleId)))assertProgramResult(result,session);
 });
});

test('unknown rule IDs and invalid objects still fail when program timing items are optional',async t=>{
 const cases={unknown:wire=>wire.results.push({ruleId:'FOREIGN'}),impreciseTimeId:wire=>wire.results.push({ruleId:timeIds[0]+' '}),nullItem:wire=>wire.results.push(null),arrayItem:wire=>wire.results.push([]),missingId:wire=>wire.results.push({verdict:'无法判定'})};
 for(const [name,change] of Object.entries(cases))await t.test(name,()=>{
  const session=unavailableSession(),wire=rawWire(session);change(wire);
  assert.throws(()=>parse(wire,session,mixedBasis(),{allowDegraded:true}),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('invalid_rule_set'));
 });
});

test('non-time rule coverage and business fields remain strict after timing omission',async t=>{
 const cases={missing:wire=>wire.results.pop(),duplicate:wire=>wire.results.push(wire.results[0]),verdict:wire=>{wire.results[0].verdict='Pass';},reason:wire=>{wire.results[0].reason='';},reference:wire=>{wire.results[0].referenceIds=['FOREIGN'];},confidence:wire=>{wire.results[0].confidence=2;},conflicts:wire=>{wire.results[0].conflictsWith=['FOREIGN'];}};
 for(const [name,change] of Object.entries(cases))await t.test(name,()=>{
  const session=unavailableSession(),wire=rawWire(session);change(wire);
  assert.throws(()=>parse(wire,session,mixedBasis(),{allowDegraded:true}),error=>error.code==='INVALID_OUTPUT');
 });
});

test('non-time quote failures still retry and degrade only the invalid non-time result',()=>{
 const session=unavailableSession(),wire=rawWire(session);wire.results[0].evidenceQuotes=[{quote:'fabricated non-time evidence'}];
 assert.throws(()=>parse(wire,session),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('quote_mismatch')&&error.diagnostic.ruleIds.join()==='SYN-R1');
 const results=parse(wire,session,mixedBasis(),{allowDegraded:true});
 assert.equal(results[1].rawValidation.status,'unverified-quote');assert.equal(results[1].rawValidation.originalReason,wire.results[0].reason);assert.equal(results[3].verdict,'符合');
 for(const result of results.filter(result=>timeIds.includes(result.ruleId)))assertProgramResult(result,session);
});

test('record identity, JSON envelope and immutable source hash stay strict with only program timing rules',async t=>{
 const session=unavailableSession(),basis=mixedBasis();basis.rules=basis.rules.filter(rule=>timeIds.includes(rule.id));
 for(const wire of ['{',[],{recordId:'FOREIGN',results:[]},{recordId:session.id,results:[],unexpected:true},{recordId:session.id,results:{}}])await t.test(JSON.stringify(wire),()=>{
  assert.throws(()=>parse(wire,session,basis,{allowDegraded:true}),error=>error.code==='INVALID_OUTPUT');
 });
 const changed=structuredClone(session);changed.rawTranscript.text+=' changed';
 assert.throws(()=>parse({recordId:session.id,results:[]},changed,basis),error=>error.code==='INVALID_INPUT');
});

test('both prompts request only projected basis rules and leave timing construction to the program',()=>{
 for(const outputLanguage of ['zh','en']){
  const prepared=prepareRawInspection(unavailableSession(),mixedBasis(),{inspectionAt,outputLanguage}),system=prepared.messages[0].content;
  assert.match(system,outputLanguage==='zh'?/只.{0,12}basis\.rules/:/only.{0,30}basis\.rules/i);
  assert.match(system,outputLanguage==='zh'?/timeRuleIds.{0,60}程序.{0,60}不.{0,8}输出/:/timeRuleIds.{0,100}program.{0,100}do not output/i);
  assert.doesNotMatch(system,/timeRuleIds中的实际规则id|exact rule id from timeRuleIds/);
  assert.match(system,/CRLF/);assert.match(system,/LF/);
  assert.match(system,outputLanguage==='zh'?/不得访问网页、调用工具/:/Do not browse, call tools/);
  assert.match(system,outputLanguage==='zh'?/不能为免审抬高/:/never increase it to bypass human review/);
 }
});

test('one mixed-rule model response with malicious timing fields is accepted without a repair attempt',async()=>{
 const session=unavailableSession(),wire=rawWire(session),steps=[];let calls=0,sent;
 wire.results.push({ruleId:timeIds[0],verdict:'invalid',reason:null,evidenceQuotes:'bad',referenceIds:null,confidence:9,conflictsWith:true});
 const client=createArkClient({fetchImpl:async(url,options)=>{calls++;sent=JSON.parse(JSON.parse(options.body).messages[1].content);return respond(wire);}});
 const trace={step:async(id,input,operation)=>{steps.push(id);return operation();}};
 const answer=await client.inspectRaw({config,session,basis:mixedBasis(),inspectionAt,trace});
 assert.equal(calls,1);assert.deepEqual(steps,['model','validation']);assert.deepEqual(sent.basis.rules.map(rule=>rule.id),nonTimeIds);
 assert.equal(answer.results.length,4);assert.equal(answer.modelId,'synthetic-model');assert.equal(answer.requestId,'synthetic-request');
 for(const result of answer.results.filter(result=>timeIds.includes(result.ruleId)))assertProgramResult(result,session);
});

test('all timing rules run locally with a validation trace and no HTTP or model step',async()=>{
 const session=unavailableSession(),basis=mixedBasis(),steps=[];let calls=0;
 basis.rules=basis.rules.filter(rule=>timeIds.includes(rule.id));
 const client=createArkClient({fetchImpl:async()=>{calls++;return respond({recordId:session.id,results:[]});}}),trace={step:async(id,input,operation)=>{steps.push({id,input});return operation();}};
 const answer=await client.inspectRaw({session,basis,inspectionAt,outputLanguage:'en',trace});
 assert.equal(calls,0);assert.deepEqual(steps.map(step=>step.id),['validation']);assert.equal(steps[0].input.kind,'rawSourceTime');
 assert.equal(answer.modelId,'local-source-time');assert.equal(Object.hasOwn(answer,'requestId'),false);assert.equal(Object.hasOwn(answer,'usage'),false);assert.equal(answer.promptVersion,'raw-direct-quote-v1');
 assert.deepEqual(answer.results.map(result=>result.ruleId),timeIds);for(const result of answer.results)assertProgramResult(result,session,'en');
 assert.equal(Object.hasOwn(steps[0].input,'content'),false);
});

test('all-time local processing still refuses invalid source and inspection time before any HTTP',async()=>{
 const session=unavailableSession(),basis=mixedBasis();basis.rules=basis.rules.filter(rule=>timeIds.includes(rule.id));let calls=0;
 const client=createArkClient({fetchImpl:async()=>{calls++;throw new Error('unexpected transport');}});
 await assert.rejects(client.inspectRaw({session,basis,inspectionAt:'2026-11-12'}),error=>error.code==='INVALID_INPUT');
 session.rawTranscript.text+=' changed';
 await assert.rejects(client.inspectRaw({session,basis,inspectionAt}),error=>error.code==='INVALID_INPUT');assert.equal(calls,0);
});

test('all-time local processing respects an already canceled run without validation or HTTP',async()=>{
 const session=unavailableSession(),basis=mixedBasis(),steps=[];basis.rules=basis.rules.filter(rule=>timeIds.includes(rule.id));let calls=0;
 const client=createArkClient({fetchImpl:async()=>{calls++;throw new Error('unexpected transport');}}),trace={step:async(id,input,operation)=>{steps.push(id);return operation();}};
 await assert.rejects(client.inspectRaw({session,basis,inspectionAt,signal:AbortSignal.abort(),trace}),error=>error.code==='ABORTED');
 assert.equal(calls,0);assert.deepEqual(steps,[]);
});

test('explicit source timing keeps the full model rule set and strict timing fields',async()=>{
 const session=rawSession(),basis=mixedBasis(),prepared=prepareRawInspection(session,basis,{inspectionAt}),wire=rawWire(session);let calls=0;
 wire.results=[{...wire.results[1],ruleId:timeIds[0]},wire.results[0],{...wire.results[1],ruleId:timeIds[1]},wire.results[1]];
 assert.deepEqual(prepared.input.basis.rules.map(rule=>rule.id),basis.rules.map(rule=>rule.id));assert.deepEqual(prepared.input.timeRuleIds,[]);
 const client=createArkClient({fetchImpl:async()=>{calls++;return respond(wire);}}),answer=await client.inspectRaw({config,session,basis,inspectionAt});
 assert.equal(calls,1);assert.ok(answer.results.every(result=>result.verdict==='符合'));assert.ok(answer.results.every(result=>!result.rawValidation.reasonCodes.includes('source_time_unavailable')));
 wire.results[0].confidence=2;assert.throws(()=>parse(wire,session,basis,{allowDegraded:true}),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('invalid_confidence'));
 wire.results.shift();assert.throws(()=>parse(wire,session,basis),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('invalid_rule_set'));
 const reordered=rawWire(session);reordered.results=[{...reordered.results[1],ruleId:timeIds[0]},reordered.results[0],{...reordered.results[1],ruleId:timeIds[1]},reordered.results[1]].reverse();
 assert.deepEqual(parse(reordered,session,basis).map(result=>result.ruleId),reordered.results.map(result=>result.ruleId));
});

test('historical full unavailable-time model outputs remain accepted without retaining model time claims',()=>{
 const session=unavailableSession(),wire=rawWire(session),basis=mixedBasis();
 wire.results=[{...wire.results[1],ruleId:timeIds[0]},wire.results[0],{...wire.results[1],ruleId:timeIds[1]},wire.results[1]];
 const results=parse(wire,session,basis);
 assert.deepEqual(results.map(result=>result.ruleId),basis.rules.map(rule=>rule.id));for(const result of results.filter(result=>timeIds.includes(result.ruleId)))assertProgramResult(result,session);
});

test('final mixed-rule model failure retains verified program timing and only non-time technical placeholders',async t=>{
 for(const outputLanguage of ['zh','en'])await t.test(outputLanguage,()=>{
  const session=unavailableSession(),basis=mixedBasis(),beforeSession=structuredClone(session),beforeBasis=structuredClone(basis),message='Synthetic model execution failed.';
  const results=rawUnavailableResults(session,basis,{errorCode:'NETWORK',message,outputLanguage}),parsed=parse(rawWire(session),session,basis,{outputLanguage});
  assert.deepEqual(results.map(result=>result.ruleId),basis.rules.map(rule=>rule.id));
  for(const result of results){
   if(timeIds.includes(result.ruleId)){
    assertProgramResult(result,session,outputLanguage);assert.deepEqual(result,parsed.find(value=>value.ruleId===result.ruleId));
   }else{
    assert.deepEqual(result,{ruleId:result.ruleId,verdict:'无法判定',reason:message,evidence:[],referenceIds:[],confidence:0,conflictsWith:[],evidenceQuotes:[],turnRefs:[],rawValidation:{schemaVersion:1,status:'program-fallback',textSha256:session.rawTranscript.textSha256,reasonCodes:['NETWORK','missing_quote']}});
    assert.equal(validateRawResultAssurance(result,session).valid,true);
   }
  }
  assert.deepEqual(session,beforeSession);assert.deepEqual(basis,beforeBasis);assert.equal(RAW_INSPECTION_PROMPT_VERSION,'raw-direct-quote-v1');
 });
});

test('all timing failure fallback remains the same program-owned source-time result',()=>{
 const session=unavailableSession(),basis=mixedBasis();basis.rules=basis.rules.filter(rule=>timeIds.includes(rule.id));
 const results=rawUnavailableResults(session,basis,{errorCode:'TIMEOUT',message:'Synthetic timeout.'});
 assert.deepEqual(results.map(result=>result.ruleId),timeIds);for(const result of results)assertProgramResult(result,session);
});

test('explicit source timing failure keeps every result as a technical fallback',()=>{
 const session=rawSession(),basis=mixedBasis(),message='Synthetic explicit-time failure.';
 const results=rawUnavailableResults(session,basis,{errorCode:'NETWORK',message,outputLanguage:'en'});
 assert.deepEqual(results.map(result=>result.ruleId),basis.rules.map(rule=>rule.id));
 for(const result of results){assert.equal(result.rawValidation.status,'program-fallback');assert.equal(result.reason,message);assert.deepEqual(result.rawValidation.reasonCodes,['NETWORK','missing_quote']);}
});

test('failure fallback rejects unsupported output language before constructing program results',()=>{
 assert.throws(()=>rawUnavailableResults(unavailableSession(),mixedBasis(),{outputLanguage:'foreign'}),error=>error.code==='INVALID_INPUT');
});
