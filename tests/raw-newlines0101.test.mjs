import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as evidence from '../public/raw-evidence.mjs';
import {parseRawInspectionResult,prepareRawInspection,RAW_INSPECTION_PROMPT_VERSION} from '../server/raw-inspection.mjs';
import {rawSession,rawBasis,rawWire,inspectionAt} from './raw-contract-r16-fixtures.mjs';
import {createBusinessState,createImportedTask,saveReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {highlightRawText} from '../public/raw-review-view.mjs';
import {applyAIDecisions} from '../public/ai-triage.mjs';
import {createArkClient} from '../server/ark-client.mjs';

const matching='crlf-lf-v1';
const now='2026-11-12T10:00:00+08:00';
const parse=(wire,session,basis=rawBasis(),options={})=>parseRawInspectionResult(JSON.stringify(wire),{session,basis,outputLanguage:'en'},options);
const method=name=>{assert.equal(typeof evidence[name],'function',`${name} must be available`);return evidence[name];};
function wireWithQuote(session,quote){const wire=rawWire(session);for(const item of wire.results)item.evidenceQuotes=[{quote}];return wire;}
function assuredResult(session,quote,matches,{mode=matching}={}){
 return {ruleId:'SYN-R1',verdict:'符合',reason:'Synthetic source check.',evidence:[],referenceIds:[],confidence:0.95,conflictsWith:[],turnRefs:[],evidenceQuotes:[{quote,matches}],rawValidation:{schemaVersion:1,status:'verified',textSha256:session.rawTranscript.textSha256,reasonCodes:[],...(mode===undefined?{}:{evidenceMatching:mode})}};
}

test('CRLF and LF compare equally while every span addresses the original UTF16 source',()=>{
 const text='😀 前缀 مرحبا\r\nAgent: A\r\nB 😀\nمرحبا\nAgent: A\nB 😀';
 const quote='مرحبا\nAgent: A\nB 😀',first=text.indexOf('مرحبا'),second=text.lastIndexOf('مرحبا');
 const original='مرحبا\r\nAgent: A\r\nB 😀';
 assert.deepEqual(evidence.matchRawQuote(text,quote),[{start:first,end:first+original.length},{start:second,end:text.length}]);
 assert.equal(method('sourceQuoteSlice')(text,quote),original);
 assert.equal(method('sourceQuoteSlice')('A\nB','A\r\nB'),'A\nB');
 assert.equal(text.slice(first,first+original.length),original);
 assert.equal(text.charCodeAt(0),0xd83d);
});

test('mixed newline occurrences and overlaps retain all original boundaries',()=>{
 const text='A\r\nA\nA\r\nA',quote='A\nA';
 assert.deepEqual(evidence.matchRawQuote(text,quote),[{start:0,end:4},{start:3,end:6},{start:5,end:9}]);
 assert.deepEqual(evidence.matchRawQuote(text,'A\r\nA'),evidence.matchRawQuote(text,quote));
 assert.deepEqual(evidence.matchRawQuote('aaaa','aaa'),[{start:0,end:3},{start:1,end:4}]);
});

test('only paired CRLF may differ; spaces, joins, case, punctuation, Unicode and lone CR stay strict',()=>{
 const text='Hello  world.\r\nCafe\u0301, colour.\rمرحبا';
 for(const quote of ['hello  world.','Hello world.','world.Cafe','world. Cafe','world.\nCafé','Cafe\u0301;','color.','colour.\nمرحبا','Hello…colour.','\ud83d']){
  assert.deepEqual(evidence.matchRawQuote(text,quote),[],JSON.stringify(quote));
  assert.equal(method('sourceQuoteSlice')(text,quote),null,JSON.stringify(quote));
 }
 assert.deepEqual(evidence.matchRawQuote('A\rB','A\nB'),[]);
 assert.deepEqual(evidence.matchRawQuote('A\r\nB','A\rB'),[]);
 assert.deepEqual(evidence.matchRawQuote('A\rB','A\rB'),[{start:0,end:3}]);
 assert.equal(method('sourceQuoteSlice')('Only row A','Only row B'),null);
 assert.equal(method('sourceQuoteSlice')('A\r\nB',''),null);
 assert.equal(method('sourceQuoteSlice')(null,'A'),null);
});

test('all-match budget remains strict while a first source slice never requires enumerating all hits',()=>{
 const text='A\r\n'.repeat(10001),quote='A\n';
 assert.throws(()=>evidence.matchRawQuote(text,quote),error=>error.code==='RAW_QUOTE_MATCH_BUDGET');
 assert.equal(method('sourceQuoteSlice')(text,quote),'A\r\n');
 assert.equal(evidence.matchRawQuote('A\r\n'.repeat(10000),quote).length,10000);
});

test('raw parser saves the first exact original slice, all offsets and one canonical duplicate',()=>{
 const session=rawSession('😀 مرحبا\r\nAgent: Check the policy.\nمرحبا\nAgent: Check the policy.');
 const before=structuredClone(session),wire=wireWithQuote(session,'مرحبا\nAgent: Check the policy.');
 wire.results[0].evidenceQuotes.push({quote:'مرحبا\r\nAgent: Check the policy.'});
 const originalWire=structuredClone(wire),results=parse(wire,session),result=results[0];
 assert.equal(result.evidenceQuotes.length,1);
 assert.equal(result.evidenceQuotes[0].quote,'مرحبا\r\nAgent: Check the policy.');
 assert.deepEqual(result.evidenceQuotes[0].matches,[{start:3,end:34},{start:35,end:65}]);
 assert.equal(result.rawValidation.evidenceMatching,matching);
 assert.equal(evidence.validateRawResultAssurance(result,session).valid,true);
 assert.deepEqual(session,before);assert.deepEqual(wire,originalWire);
 assert.equal(result.rawValidation.textSha256,session.rawTranscript.textSha256);
});

test('raw confidence is normalized only at model parsing and does not alter the model JSON',()=>{
 const session=rawSession(),wire=rawWire(session);wire.results[0].confidence='0.9';
 const content=JSON.stringify(wire),result=parseRawInspectionResult(content,{session,basis:rawBasis()})[0];
 assert.equal(result.confidence,0.9);assert.equal(JSON.parse(content).results[0].confidence,'0.9');
 assert.equal(evidence.validateRawResultAssurance(result,session).valid,true);
 assert.equal(evidence.validateRawResultAssurance({...result,confidence:'0.9'},session).valid,false);
});

test('canonical duplicate quotations count once against the per-rule resource budget',()=>{
 const session=rawSession('A\r\n'.repeat(6000)),wire=wireWithQuote(session,'A\n');
 wire.results[0].evidenceQuotes.push({quote:'A\r\n'});
 const result=parse(wire,session)[0];assert.equal(result.evidenceQuotes.length,1);assert.equal(result.evidenceQuotes[0].matches.length,6000);
 const excessive=rawSession('A\r\n'.repeat(10001)),tooMany=wireWithQuote(excessive,'A\n');
 assert.throws(()=>parse(tooMany,excessive),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('quote_match_budget'));
});

test('a newline-compatible model quote cannot exceed the saved original quote length contract',()=>{
 const session=rawSession('A\r\n'.repeat(7000)),wire=wireWithQuote(session,'A\n'.repeat(7000));
 assert.throws(()=>parse(wire,session),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('invalid_quote'));
 const result=parse(wire,session,rawBasis(),{allowDegraded:true})[0];
 assert.equal(result.verdict,'符合');assert.equal(result.rawValidation.status,'unverified-quote');assert.deepEqual(result.evidenceQuotes,[]);
});

test('synthetic transport trace retains the original LF model JSON after exact source slicing',async()=>{
 const session=rawSession('😀 A\r\nB'),wire=wireWithQuote(session,'A\nB');wire.results[0].confidence='0.9';
 const content=JSON.stringify(wire),inputs=[];let calls=0;
 const client=createArkClient({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}),{headers:{'content-type':'application/json'}});}});
 const trace={step:async(id,input,operation)=>{inputs.push({id,input:structuredClone(input)});return operation();}};
 const answer=await client.inspectRaw({config:{baseUrl:'http://127.0.0.1:18999/v1',model:'synthetic-model',authMode:'none',timeoutMs:1000},session,basis:rawBasis(),inspectionAt,trace});
 assert.equal(calls,1);assert.equal(inputs.find(item=>item.id==='validation').input.content,content);
 assert.equal(answer.results[0].evidenceQuotes[0].quote,'A\r\nB');assert.equal(answer.results[0].confidence,0.9);
 assert.equal(JSON.parse(inputs.find(item=>item.id==='validation').input.content).results[0].confidence,'0.9');
});

test('new saved evidence rejects rewritten quote, forged or omitted offsets, canonical duplicates and stale hashes',()=>{
 const session=rawSession('😀 A\r\nB / A\nB'),quote='A\r\nB';
 const result=assuredResult(session,quote,[{start:3,end:7},{start:10,end:13}]);
 assert.equal(evidence.validateRawResultAssurance(result,session).valid,true);
 const altered=structuredClone(result);altered.evidenceQuotes[0].quote='A\nB';
 assert.equal(evidence.validateRawResultAssurance(altered,session).valid,false);
 const partial=structuredClone(result);partial.evidenceQuotes[0].matches.pop();
 assert.equal(evidence.validateRawResultAssurance(partial,session).valid,false);
 const forged=structuredClone(result);forged.evidenceQuotes[0].matches[1].start--;
 assert.equal(evidence.validateRawResultAssurance(forged,session).valid,false);
 const duplicate=structuredClone(result);duplicate.evidenceQuotes.push({...duplicate.evidenceQuotes[0],quote:'A\nB'});
 assert.equal(evidence.validateRawResultAssurance(duplicate,session).valid,false);
 const hash=structuredClone(result);hash.rawValidation.textSha256='b'.repeat(64);
 assert.equal(evidence.validateRawResultAssurance(hash,session).valid,false);
 const unknown=structuredClone(result);unknown.rawValidation.evidenceMatching='permissive';
 assert.equal(evidence.validateRawResultAssurance(unknown,session).valid,false);
});

test('unmarked 0.10.0 evidence keeps literal matches when an earlier newline variant exists',()=>{
 const session=rawSession('A\nB / A\r\nB'),quote='A\r\nB';
 const legacy=assuredResult(session,quote,[{start:6,end:10}]);delete legacy.rawValidation.evidenceMatching;
 assert.equal(evidence.validateRawResultAssurance(legacy,session).valid,true);
 assert.deepEqual(method('matchLiteralRawQuote')(session.rawTranscript.text,quote),legacy.evidenceQuotes[0].matches);
 const firstVariant=structuredClone(legacy);firstVariant.evidenceQuotes[0].matches=[{start:0,end:3}];
 assert.equal(evidence.validateRawResultAssurance(firstVariant,session).valid,false);
 const rewrite=structuredClone(legacy);rewrite.evidenceQuotes[0].quote='A\nB';
 assert.equal(evidence.validateRawResultAssurance(rewrite,session).valid,false);
});

test('newline compatibility still rejects cross-row or stitched quotes and degrades only the invalid rule',()=>{
 const session=rawSession('A\r\nB\nCheck the policy.'),wire=rawWire(session);
 wire.results[0].evidenceQuotes=[{quote:'AB'}];
 assert.throws(()=>parse(wire,session),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.ruleIds.join()==='SYN-R1');
 assert.equal(parse(wire,session,rawBasis(),{allowDegraded:true})[1].verdict,'符合');
 wire.results[0].evidenceQuotes=[{quote:'A\nB\nOnly another source row'}];
 assert.throws(()=>parse(wire,session),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('quote_mismatch'));
});

test('unavailable pure timing ignores bogus quotes before retries while ordinary rules are still independently checked',()=>{
 const basis=rawBasis();basis.rules[1]={...basis.rules[1],category:'响应时效',title:'首次回复时长',passCriteria:'首次回复应在60秒内',failCriteria:'首次回复超过60秒'};
 const session=rawSession(undefined,{rawTranscript:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}}),wire=rawWire(session);
 wire.results[1].evidenceQuotes=[{quote:'2099-01-01 invented time'}];
 const results=parse(wire,session,basis);
 assert.equal(results[1].verdict,'无法判定');assert.deepEqual(results[1].evidenceQuotes,[]);assert.ok(results[1].rawValidation.reasonCodes.includes('source_time_unavailable'));
 assert.equal(results[0].verdict,'符合');
 wire.results[0].evidenceQuotes=[{quote:'separate fabricated quote'}];
 assert.throws(()=>parse(wire,session,basis),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.ruleIds.join()==='SYN-R1');
 const foreign=rawWire(session);foreign.results[1].referenceIds=['SYN%2FP1@V1#S%231'];
 assert.deepEqual(parse(foreign,session,basis)[1].referenceIds,[]);
 foreign.results[0].referenceIds=['SYN%2FP1@V0#S%231'];
 assert.throws(()=>parse(foreign,session,basis),error=>error.code==='INVALID_OUTPUT'&&error.diagnostic.reasonCodes.includes('invalid_reference'));
});

test('both prompts specify unquoted numeric confidence, newline-only equivalence and program-owned timing',()=>{
 for(const outputLanguage of ['zh','en']){
  const prepared=prepareRawInspection(rawSession(),rawBasis(),{inspectionAt,outputLanguage}),system=prepared.messages[0].content;
  assert.equal(prepared.promptVersion,'raw-direct-quote-v1');assert.equal(RAW_INSPECTION_PROMPT_VERSION,'raw-direct-quote-v1');
  assert.match(system,/CRLF/);assert.match(system,/LF/);assert.match(system,outputLanguage==='zh'?/由程序生成无法判定，不要输出/:/program constructs their unknown results; do not output/);
  assert.match(system,outputLanguage==='zh'?/confidence.{0,50}不带引号.{0,20}JSON数字/:/confidence.{0,50}unquoted JSON number/);
 }
});

async function persistentFixture(t,text){
 const parent=path.resolve('tests/.raw-newlines0101-scratch');await fs.mkdir(parent,{recursive:true});
 const dir=await fs.mkdtemp(path.join(parent,'case-'));let store=await createWorkspaceStore({dataDir:dir});
 t.after(async()=>{await store.close();assert.ok(path.resolve(dir).startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const bytes=await workbook([{name:'Synthetic raw',headers:['ID','客服','消息详情','preserve'],rows:[['SYN-NEWLINES','Synthetic agent',text,'  archived cell  ']]}]);
 const source=await store.putSource(bytes,'synthetic-newlines.xlsx'),parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes},{scene:'新品产品咨询'});
 assert.equal(parsed.valid,true,parsed.errors?.join(';'));assert.equal(parsed.sessions[0].rawTranscript.text,text);
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds:['R004'],now});
 const state=createImportedTask(createBusinessState(),{name:'Synthetic newlines',sessions:parsed.sessions,source,basisSnapshot,reviewer:'Reviewer',rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'}},now});
 return {catalog,state,get store(){return store;},async reopen(){await store.close();store=await createWorkspaceStore({dataDir:dir});}};
}

test('multiline human save and durable restart retain exact source cells, hashes and mapped offsets',async t=>{
 const text='😀 مرحبا\r\nAgent: A\r\nB 😀 / مرحبا\nAgent: A\nB 😀',f=await persistentFixture(t,text),session=f.state.sessions[0],before=structuredClone(session.rawTranscript);
 const draft={ruleId:'R004',verdict:'符合',reason:'Synthetic independent review.',evidence:[],referenceIds:['P004-2'],evidenceQuotes:[{quote:'مرحبا\nAgent: A\nB 😀'},{quote:'مرحبا\r\nAgent: A\r\nB 😀'}]};
 const state=saveReview(f.state,session.id,draft,now),saved=state.sessions[0].review.drafts.R004;
 assert.equal(saved.rawValidation.evidenceMatching,matching);assert.equal(saved.evidenceQuotes.length,1);assert.equal(saved.evidenceQuotes[0].quote,'مرحبا\r\nAgent: A\r\nB 😀');
 assert.deepEqual(saved.evidenceQuotes[0].matches,evidence.matchRawQuote(text,draft.evidenceQuotes[0].quote));
 assert.deepEqual(state.sessions[0].rawTranscript,before);
 await f.store.save({baseRevision:0,mutationId:'newlines-human',state,catalog:f.catalog});await f.reopen();
 const read=await f.store.read();assert.deepEqual(read.state.sessions[0].rawTranscript,before);assert.deepEqual(read.state.sessions[0].review.drafts.R004,saved);
 assert.equal(evidence.validateRawResultAssurance(read.state.sessions[0].review.drafts.R004,read.state.sessions[0]).valid,true);
 const forged=structuredClone(read.state);forged.sessions[0].review.drafts.R004.evidenceQuotes[0].matches[0].end--;
 await assert.rejects(f.store.save({baseRevision:read.revision,mutationId:'newlines-forged',state:forged,catalog:f.catalog}),/引文|原文|校验/);
});

test('unmarked old mixed-newline human evidence persists and restarts without migration',async t=>{
 const f=await persistentFixture(t,'A\nB / A\r\nB'),session=f.state.sessions[0],quote='A\r\nB';
 const old={ruleId:'R004',verdict:'符合',reason:'Legacy synthetic human review.',evidence:[],referenceIds:['P004-2'],source:'人工独立审核',evidenceQuotes:[{quote,matches:[{start:6,end:10}]}],turnRefs:[],rawValidation:{schemaVersion:1,status:'verified',textSha256:session.rawTranscript.textSha256,reasonCodes:[]}};
 const state=structuredClone(f.state);state.sessions[0].review.drafts.R004=structuredClone(old);state.sessions[0].review.status='已暂存';
 await f.store.save({baseRevision:0,mutationId:'legacy-newlines',state,catalog:f.catalog});await f.reopen();
 assert.deepEqual((await f.store.read()).state.sessions[0].review.drafts.R004,old);
});

test('unmarked old mixed-newline AI evidence persists and restarts with original late literal spans',async t=>{
 const f=await persistentFixture(t,'A\nB / A\r\nB');delete f.state.tasks[0].executionSettings;
 await f.store.save({baseRevision:0,mutationId:'legacy-ai-base',state:f.state,catalog:f.catalog});
 const old={ruleId:'R004',verdict:'符合',reason:'Legacy synthetic AI check.',evidence:[],referenceIds:['P004-2'],confidence:0.95,conflictsWith:[],turnRefs:[],evidenceQuotes:[{quote:'A\r\nB',matches:[{start:6,end:10}]}],rawValidation:{schemaVersion:1,status:'verified',textSha256:f.state.sessions[0].rawTranscript.textSha256,reasonCodes:[]}};
 await f.store.updateAI(({state,catalog})=>{
  const task=state.tasks[0],session=state.sessions[0];
  task.aiStatus='completed';task.aiRun={id:'SYN-OLD-NEWLINES',modelId:'synthetic',status:'completed',total:1,done:1,failed:0,startedAt:now,completedAt:now,inspectionAt:now};
  session.aiExecution={status:'completed',runId:task.aiRun.id,modelId:'synthetic',startedAt:now,completedAt:now};session.aiResults=[structuredClone(old)];
  applyAIDecisions(state,task,now);return {state,catalog};
 });
 await f.reopen();const read=await f.store.read();assert.deepEqual(read.state.sessions[0].aiResults,[old]);assert.equal(read.state.sessions[0].aiDecision.status,'PASS');
 assert.equal(read.state.tasks[0].executionSettings,undefined);
});

test('review highlights use original CRLF slices for LF quotations without supplied offsets',()=>{
 const html=highlightRawText('😀 A\r\nB / A\nB',[{quote:'A\nB',matches:[{start:999,end:1000}]}],{validation:{evidenceMatching:matching}});
 assert.equal((html.match(/<mark\b/g)||[]).length,2);assert.match(html,/>A\r\nB<\/mark>/);assert.match(html,/>A\nB<\/mark>/);
});
