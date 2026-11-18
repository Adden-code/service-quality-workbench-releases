import test from 'node:test';
import assert from 'node:assert/strict';
import {rawSession,rawBasis} from './raw-contract-r16-fixtures.mjs';
const api=await import('../public/raw-evidence.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
function method(name){assert.equal(typeof api[name],'function',`${name} must implement the raw evidence contract`);return api[name];}

test('raw quote positions use literal UTF16 spans including every repeated or overlapping occurrence',()=>{
 const match=method('matchRawQuote'),text='😀 مرحبا\r\nRepeat. Repeat. aaaa';
 assert.deepEqual(match(text,'😀'),[{start:0,end:2}]);
 const arabic=text.indexOf('مرحبا');assert.deepEqual(match(text,'مرحبا\r\n'),[{start:arabic,end:arabic+7}]);
 assert.deepEqual(match(text,'Repeat.'),[{start:text.indexOf('Repeat.'),end:text.indexOf('Repeat.')+7},{start:text.lastIndexOf('Repeat.'),end:text.lastIndexOf('Repeat.')+7}]);
 const start=text.indexOf('aaaa');assert.deepEqual(match(text,'aaa'),[{start,end:start+3},{start:start+1,end:start+4}]);
 for(const span of match(text,'Repeat.'))assert.equal(text.slice(span.start,span.end),'Repeat.');
});
test('raw matching never normalizes case, whitespace, Unicode, spelling, translations or stitched fragments',()=>{
 const match=method('matchRawQuote'),text='Hello  world.\r\nCafe\u0301, colour. مرحبا';
 for(const quote of ['', ' \r\n ', 'hello  world.', 'Hello world.', 'Café', 'color', '你好', 'Hello…colour.', 'world.Cafe'])assert.deepEqual(match(text,quote),[],JSON.stringify(quote));
 assert.deepEqual(match(text,'world.\nCafe'),[{start:7,end:19}]);
 assert.deepEqual(match('Only row A','Only row B'),[]);
 assert.deepEqual(match(null,'x'),[]);assert.deepEqual(match('x',null),[]);
});
test('repetitive quotation expansion has an explicit actionable budget and never returns partial hits',()=>{
 const match=method('matchRawQuote');assert.equal(api.MAX_RAW_MATCHES_PER_RULE,10000);
 assert.equal(match('a'.repeat(10000),'a').length,10000);
 assert.throws(()=>match('a'.repeat(10001),'a'),error=>error.code==='RAW_QUOTE_MATCH_BUDGET'&&error.status===400&&/更长/.test(error.message));
 const session=rawSession('a'.repeat(10001)),result={ruleId:'SYN-R1',verdict:'符合',reason:'Synthetic reason',evidence:[],referenceIds:[],conflictsWith:[],evidenceQuotes:[{quote:'a',matches:[{start:0,end:1}]}],turnRefs:[],rawValidation:{schemaVersion:1,status:'verified',textSha256:session.rawTranscript.textSha256,reasonCodes:[]}};
 const assurance=method('validateRawResultAssurance')(result,session);assert.equal(assurance.valid,false);assert.ok(assurance.reasonCodes.includes('quote_match_budget'));
 const combinedSession=rawSession('a'.repeat(6000)),combined={...result,rawValidation:{...result.rawValidation,textSha256:combinedSession.rawTranscript.textSha256},evidenceQuotes:[{quote:'a',matches:match(combinedSession.rawTranscript.text,'a')},{quote:'aa',matches:match(combinedSession.rawTranscript.text,'aa')}]};
 const cumulative=method('validateRawResultAssurance')(combined,combinedSession);assert.equal(cumulative.valid,false);assert.ok(cumulative.reasonCodes.includes('quote_match_budget'));
});
test('assurance rejects stale source hashes, partial match lists, surrogate splitting and forged locations',()=>{
 const validate=method('validateRawResultAssurance'),match=method('matchRawQuote'),session=rawSession('😀 Repeat. Repeat.');
 const result={ruleId:'SYN-R1',verdict:'符合',reason:'Synthetic reason',evidence:[],referenceIds:[],confidence:0.95,conflictsWith:[],evidenceQuotes:[{quote:'Repeat.',matches:match(session.rawTranscript.text,'Repeat.')}],turnRefs:[],rawValidation:{schemaVersion:1,status:'verified',textSha256:session.rawTranscript.textSha256,reasonCodes:[]}};
 assert.equal(validate(result,session).valid,true);
 const badHash=structuredClone(result);badHash.rawValidation.textSha256='b'.repeat(64);assert.equal(validate(badHash,session).valid,false);
 const partial=structuredClone(result);partial.evidenceQuotes[0].matches.pop();assert.equal(validate(partial,session).valid,false);
 const forged=structuredClone(result);forged.evidenceQuotes[0].matches[0].start=0;assert.equal(validate(forged,session).valid,false);
 const split=structuredClone(result);split.evidenceQuotes=[{quote:'\ud83d',matches:[{start:0,end:1}]}];assert.equal(validate(split,session).valid,false);
 const missingMeta=structuredClone(result);delete missingMeta.rawValidation;assert.equal(validate(missingMeta,session).valid,false);
 const contradictory=structuredClone(result);contradictory.rawValidation.reasonCodes=['quote_mismatch'];assert.equal(validate(contradictory,session).valid,false);
 const discarded=structuredClone(result);discarded.rawValidation.rejectedQuotes=[{quote:'foreign row',reasonCode:'quote_mismatch'}];assert.equal(validate(discarded,session).valid,false);
 const forgedTime=structuredClone(result);forgedTime.rawValidation.reasonCodes=['source_time_unavailable'];assert.equal(validate(forgedTime,session).valid,false);
});
test('normal unknown without quotations is valid evidence state while fallback cannot carry a determinate verdict',()=>{
 const validate=method('validateRawResultAssurance'),session=rawSession(),unknown={ruleId:'SYN-R1',verdict:'无法判定',reason:'Speaker attribution is not known.',evidence:[],referenceIds:[],conflictsWith:[],evidenceQuotes:[],turnRefs:[],rawValidation:{schemaVersion:1,status:'verified',textSha256:session.rawTranscript.textSha256,reasonCodes:['missing_quote']}};
 assert.equal(validate(unknown,session).valid,true);assert.ok(validate(unknown,session).reasonCodes.includes('missing_quote'));
 assert.equal(validate({...unknown,verdict:'符合'},session).valid,false);
 assert.equal(validate({...unknown,rawValidation:{...unknown.rawValidation,status:'program-fallback',reasonCodes:['NETWORK']}},session).valid,true);
 assert.equal(validate({...unknown,verdict:'符合',rawValidation:{...unknown.rawValidation,status:'degraded',reasonCodes:['quote_mismatch']}},session).valid,false);
 for(const reasonCodes of [{},'missing_quote',42,null])assert.doesNotThrow(()=>assert.equal(validate({...unknown,rawValidation:{...unknown.rawValidation,reasonCodes}},session).valid,false));
});
test('time-only detection uses frozen meaning and avoids generic timely polite language or NP identifiers',()=>{
 const ids=method('rawTimeRuleIds'),basis=rawBasis();
 basis.rules.push({...basis.rules[1],id:'ANY-R33',category:'响应时效',title:'首次回复时长',passCriteria:'首次回复应在60秒内',failCriteria:'首次回复超过60秒'}, {...basis.rules[1],id:'R-TIME-EN',category:'Timing',title:'Response time',passCriteria:'Respond within 5 minutes',failCriteria:'Response exceeds 5 minutes'}, {...basis.rules[1],id:'NP-R01',title:'礼貌表达',passCriteria:'及时、礼貌地说明处理流程',failCriteria:'冷漠或不礼貌'});
 assert.deepEqual(ids(basis),['ANY-R33','R-TIME-EN']);
 basis.rules.push({...basis.rules[1],id:'FIRST-CONTENT',title:'Initial response content',passCriteria:'A timely and polite answer states the next steps',failCriteria:'The answer omits useful content'});assert.deepEqual(ids(basis),['ANY-R33','R-TIME-EN']);
 basis.rules.push({...basis.rules[1],id:'CRITERIA-TIME',title:'Service threshold',passCriteria:'Respond within 5 minutes',failCriteria:'Reply in 6 minutes'});assert.deepEqual(ids(basis),['ANY-R33','R-TIME-EN','CRITERIA-TIME']);
 const notice=method('rawTimeNotice');assert.match(notice(rawSession('',{rawTranscript:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}})),/未提供|缺少/);assert.match(notice(rawSession('',{rawTranscript:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}}),'en'),/reliable.*time|timestamps/i);assert.equal(notice(rawSession()),'');
});
