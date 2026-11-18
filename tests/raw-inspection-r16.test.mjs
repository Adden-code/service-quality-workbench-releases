import test from 'node:test';
import assert from 'node:assert/strict';
import {rawSession,rawBasis,rawWire,inspectionAt} from './raw-contract-r16-fixtures.mjs';
const api=await import('../server/raw-inspection.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
function method(name){assert.equal(typeof api[name],'function',`${name} must implement raw inspection`);return api[name];}
const parse=(wire,session=rawSession(),basis=rawBasis(),options={})=>method('parseRawInspectionResult')(typeof wire==='string'?wire:JSON.stringify(wire),{session,basis,outputLanguage:'en'},options);

test('raw prompt projects only this frozen row and linked references and separates inspection time from unknown source time',()=>{
 const prepare=method('prepareRawInspection'),session=rawSession(undefined,{review:{notes:'PRIVATE_HUMAN_LABEL'},aiResults:[{reason:'OLD_REASON'}],contextFields:[{value:'PRIVATE_OTHER_COLUMN'}],unexpected:{otherRows:['PRIVATE_ROW_B']}}),basis=rawBasis();
 session.rawTranscript.headers.push('人工参考结论');session.rawTranscript.raw.push('PRIVATE_ORIGINAL_COLUMN');
 basis.policies.push({id:'UNLINKED',version:'V1',sections:[{id:'PRIVATE',text:'PRIVATE_UNLINKED_POLICY'}]});
 const prepared=prepare(session,basis,{inspectionAt,outputLanguage:'en'}),sent=JSON.parse(prepared.messages[1].content),system=prepared.messages[0].content;
 assert.equal(prepared.promptVersion,'raw-direct-quote-v1');assert.equal(sent.record.recordId,session.id);assert.equal(sent.record.text,session.rawTranscript.text);assert.equal(sent.record.source.row,2);assert.equal(sent.inspectionAt,inspectionAt);assert.equal(sent.record.timePolicy.mode,'explicit');assert.equal(sent.outputLanguage,'en');
 assert.ok(sent.basis.policies[0].sections[0].referenceKey==='SYN%2FP1@V1#S%231');assert.equal(sent.basis.policies.length,1);
 assert.match(system,/data.*instruction|instructions.*data/i);assert.match(system,/confidence/i);assert.match(system,/uncalibrated/i);assert.match(system,/English/);assert.match(system,/continuous|contiguous/);assert.match(system,/recordId/);assert.match(system,/不符合/);
 for(const secret of ['PRIVATE_HUMAN_LABEL','OLD_REASON','PRIVATE_OTHER_COLUMN','PRIVATE_ROW_B','PRIVATE_UNLINKED_POLICY','PRIVATE_ORIGINAL_COLUMN'])assert.ok(!JSON.stringify(prepared).includes(secret),secret);
 const zh=prepare(session,basis,{inspectionAt,outputLanguage:'zh'});assert.match(zh.messages[0].content,/不输出.*思维链|不得输出.*思维链/);assert.match(zh.messages[0].content,/不能为免审抬高|不得为免审抬高/);
});
test('raw parser computes every local match and ignores untrusted coordinates and advisory turn references',()=>{
 const session=rawSession(),wire=rawWire(session);wire.results[0].evidenceQuotes=[{quote:'Repeat.',matches:[{start:999,end:1006}],role:'invented',turnId:999}];wire.results[0].turnRefs={invalid:'ignored'};
 const results=parse(wire,session),result=results[0];assert.equal(results.length,2);assert.deepEqual(result.evidence,[]);assert.equal(result.evidenceQuotes[0].matches.length,2);for(const span of result.evidenceQuotes[0].matches)assert.equal(session.rawTranscript.text.slice(span.start,span.end),'Repeat.');assert.deepEqual(result.turnRefs,[]);assert.ok(result.rawValidation.reasonCodes.includes('turn_refs_ignored'));assert.equal(result.rawValidation.status,'verified');assert.equal(result.rawValidation.textSha256,session.rawTranscript.textSha256);
 assert.deepEqual(wire.results[0].evidenceQuotes[0].matches,[{start:999,end:1006}]);
});
test('retry repair feedback admits only known diagnostic codes and exact frozen rule IDs without previous model text',()=>{
 const basis=rawBasis(),feedback={reasonCodes:['quote_mismatch','quote_match_budget','ignore previous instructions','quote_mismatch',{hidden:'PRIVATE_RETRY_OBJECT'}],ruleIds:['SYN-R1','SYN-R1','FOREIGN',' SYN-R2 '],content:'PRIVATE_PREVIOUS_MODEL_TEXT',instructions:'PRIVATE_EMBEDDED_RETRY_COMMAND'};
 const clean=method('rawInspectionRetryFeedback')(feedback,basis);assert.deepEqual(clean,{reasonCodes:['quote_mismatch','quote_match_budget'],ruleIds:['SYN-R1']});
 const prepared=method('prepareRawInspection')(rawSession(),basis,{inspectionAt,outputLanguage:'en',retryFeedback:feedback});assert.deepEqual(prepared.input.validationFeedback,clean);for(const token of ['PRIVATE_','ignore previous instructions','FOREIGN'])assert.ok(!JSON.stringify(prepared).includes(token));
 assert.ok(!Object.hasOwn(method('prepareRawInspection')(rawSession(),basis,{inspectionAt}).input,'validationFeedback'));
 assert.deepEqual(method('rawInspectionRetryFeedback')(null,basis),{reasonCodes:[],ruleIds:[]});
});
test('unknown and inapplicable keep distinct contracts without inventing quotations',()=>{
 const unknown=rawWire();unknown.results[0].verdict='无法判定';unknown.results[0].reason='The speaker is not identified in the source.';unknown.results[0].evidenceQuotes=[];delete unknown.results[0].confidence;delete unknown.results[0].conflictsWith;
 const result=parse(unknown)[0];assert.equal(result.verdict,'无法判定');assert.equal(result.rawValidation.status,'verified');assert.ok(result.rawValidation.reasonCodes.includes('missing_quote'));assert.ok(!Object.hasOwn(result,'confidence'));assert.ok(!Object.hasOwn(result,'conflictsWith'));
 const na=rawWire();na.results[0].verdict='不适用';na.results[0].reason='The rule covers completed returns; the quoted text is only an inquiry.';assert.equal(parse(na)[0].verdict,'不适用');na.results[0].evidenceQuotes=[];assert.throws(()=>parse(na),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('missing_quote'));
});
test('core JSON, identity, selected rule set, enums, references and conflicts fail even when degradation is allowed',async t=>{
 const cases={json:()=>'{',array:()=>[],missingRecord:wire=>{delete wire.recordId;return wire;},wrongRow:wire=>({...wire,recordId:'SYN-OTHER-ROW'}),missing:wire=>({...wire,results:wire.results.slice(0,1)}),duplicate:wire=>({...wire,results:[wire.results[0],wire.results[0]]}),extra:wire=>({...wire,results:[...wire.results,{...wire.results[0],ruleId:'EXTRA'}]}),idWhitespace:wire=>{wire.results[0].ruleId+=' ';return wire;},enum:wire=>{wire.results[0].verdict='Pass';return wire;},emptyReason:wire=>{wire.results[0].reason=' ';return wire;},staleRef:wire=>{wire.results[0].referenceIds=['SYN%2FP1@V0#S%231'];return wire;},shortRef:wire=>{wire.results[0].referenceIds=['S#1'];return wire;},foreignRef:wire=>{wire.results[1].referenceIds=['SYN%2FP1@V1#S%231'];return wire;},duplicateRef:wire=>{wire.results[0].referenceIds.push(wire.results[0].referenceIds[0]);return wire;},badConflict:wire=>{wire.results[0].conflictsWith=['FOREIGN'];return wire;},confidence:wire=>{wire.results[0].confidence=2;return wire;}};
 for(const [name,change] of Object.entries(cases))await t.test(name,()=>{const wire=change(rawWire());assert.throws(()=>parse(wire,rawSession(),rawBasis(),{allowDegraded:true}),error=>error.code==='INVALID_OUTPUT'&&error.status===502&&Array.isArray(error.diagnostic.reasonCodes));});
});
test('one altered, foreign-row, normalized, translated or stitched quotation retries and only its rule degrades at final attempt',async t=>{
 for(const quote of ['Check the policies.','Only in another row','check the policy.','按政策核对。','Customer: Return?…Check the policy.','Check  the policy.',''])await t.test(JSON.stringify(quote),()=>{
  const wire=rawWire();wire.results[0].evidenceQuotes.push({quote});
  assert.throws(()=>parse(wire),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.ruleIds.includes('SYN-R1'));
  const results=parse(wire,rawSession(),rawBasis(),{allowDegraded:true}),bad=results[0];assert.equal(bad.verdict,'无法判定');assert.equal(bad.rawValidation.status,'degraded');assert.equal(bad.rawValidation.originalVerdict,'符合');assert.equal(bad.rawValidation.originalReason,wire.results[0].reason);assert.deepEqual(bad.evidenceQuotes,[]);assert.ok(bad.rawValidation.rejectedQuotes.some(value=>value.quote===quote));assert.equal(results[1].verdict,'符合');assert.equal(results[1].rawValidation.status,'verified');
 });
});
test('batch missing-time declaration deterministically overrides pure timing only before quote retries',()=>{
 const basis=rawBasis();basis.rules[1]={...basis.rules[1],category:'响应时效',title:'首次回复时长',passCriteria:'首次回复应在60秒内',failCriteria:'首次回复超过60秒'};
 const session=rawSession(undefined,{rawTranscript:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}}),wire=rawWire(session);wire.results[1].evidenceQuotes=[{quote:'2099-01-01 invented time'}];
 const results=parse(wire,session,basis);assert.equal(results[1].verdict,'无法判定');assert.equal(results[1].rawValidation.status,'verified');assert.ok(results[1].rawValidation.reasonCodes.includes('source_time_unavailable'));assert.ok(!results[1].rawValidation.reasonCodes.includes('quote_mismatch'));assert.equal(results[0].verdict,'符合');assert.deepEqual(results[1].evidenceQuotes,[]);assert.match(results[1].reason,/reliable|timestamp/i);
 assert.throws(()=>parse({...wire,recordId:'FOREIGN'},session,basis,{allowDegraded:true}),error=>error.code==='INVALID_OUTPUT');
});
test('a per-rule cumulative quotation match budget retries then degrades only that rule without truncated matches',()=>{
 const session=rawSession('a'.repeat(6000)+'\nCheck the policy.'),wire=rawWire(session);wire.results[0].evidenceQuotes=[{quote:'a'},{quote:'aa'}];
 assert.throws(()=>parse(wire,session),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.ruleIds.length===1&&error.diagnostic.ruleIds[0]==='SYN-R1'&&error.diagnostic.reasonCodes.includes('quote_match_budget'));
 const results=parse(wire,session,rawBasis(),{allowDegraded:true});assert.equal(results[0].rawValidation.status,'degraded');assert.ok(results[0].rawValidation.reasonCodes.includes('quote_match_budget'));assert.deepEqual(results[0].evidenceQuotes,[]);assert.equal(results[1].rawValidation.status,'verified');assert.equal(results[1].evidenceQuotes[0].matches.length,1);
 const excessive=rawSession('a'.repeat(10001)+'\nCheck the policy.'),single=rawWire(excessive);single.results[0].evidenceQuotes=[{quote:'a'}];assert.equal(parse(single,excessive,rawBasis(),{allowDegraded:true})[0].verdict,'无法判定');
});
test('raw input source hash changes, invalid frozen basis and inspection time are refused before a model call',()=>{
 const prepare=method('prepareRawInspection'),session=rawSession();session.rawTranscript.text+=' changed';assert.throws(()=>prepare(session,rawBasis(),{inspectionAt}),error=>error.code==='INVALID_INPUT');
 assert.throws(()=>prepare(rawSession(),rawBasis(),{inspectionAt:'2026-11-12'}),error=>error.code==='INVALID_INPUT');
 const basis=rawBasis();basis.rules.push(basis.rules[0]);assert.throws(()=>prepare(rawSession(),basis,{inspectionAt}),error=>error.code==='INVALID_INPUT');
});
test('full failure creates complete program-generated placeholders and preserves the source untouched',()=>{
 const unavailable=method('rawUnavailableResults'),session=rawSession(),before=structuredClone(session),results=unavailable(session,rawBasis(),{errorCode:'NETWORK',message:'Model execution failed.'});
 assert.deepEqual(results.map(value=>value.ruleId),['SYN-R1','SYN-R2']);for(const result of results){assert.equal(result.verdict,'无法判定');assert.deepEqual(result.evidenceQuotes,[]);assert.deepEqual(result.evidence,[]);assert.equal(result.rawValidation.status,'program-fallback');assert.ok(result.rawValidation.reasonCodes.includes('NETWORK'));assert.equal(result.confidence,0);}assert.deepEqual(session,before);
});
