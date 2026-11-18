import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {workbook} from '../public/io.mjs';
import * as domain from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {DEFAULT_REVIEW_POLICY,deriveAIDecision,isAIFinal} from '../public/ai-triage.mjs';

const raw = await import('../public/raw-transcript.mjs').catch(()=>null);
const sha=value=>createHash('sha256').update(value).digest('hex');
const now='2026-11-12T10:00:00+08:00';
const asFile=bytes=>({name:'synthetic-raw.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes});
async function input({headers=['ID','客服','消息详情','产品型号','保留列'],rows=[['SYN-1','  Agent  ',' Customer: مرحبا 😀\nAgent: exact quote.  ','Source Product','  untouched  ']],rowNumbers}={}){
 const bytes=await workbook([{name:'Raw',headers,rows,...(rowNumbers?{rowNumbers}:{} )}]);
 const parsed=await raw.parseRawTranscriptFile(asFile(bytes),{scene:'新品产品咨询'});
 return {bytes,parsed,source:{name:'synthetic-raw.xlsx',sha256:sha(bytes),size:bytes.byteLength}};
}
function taskOf({parsed,source},options={}){
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds:['R004'],now});
 return {catalog,state:domain.createImportedTask(domain.createBusinessState(),{name:'Synthetic raw',sessions:parsed.sessions,source,basisSnapshot,reviewer:'Synthetic Reviewer',inputMode:raw.RAW_INPUT_MODE,evidenceContractVersion:raw.RAW_EVIDENCE_VERSION,rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'},productDefault:'Default Product'},now,...options})};
}
test('raw module has the fixed public import contract',()=>{
 assert.ok(raw,'raw transcript contract must exist');
 for(const key of ['RAW_INPUT_MODE','RAW_EVIDENCE_VERSION','isRawTranscriptSession','validateRawTranscript','rawTranscriptText','normalizeRawTimePolicy','parseRawTranscriptFile'])assert.ok(raw[key],key);
});
test('whole-cell source preserves literal cells, physical rows and unknown structure',async()=>{
 const f=await input({rowNumbers:[7]});assert.equal(f.parsed.valid,true,f.parsed.errors.join(';'));
 assert.equal(f.parsed.supported,true);assert.equal(f.parsed.rawDirect,true);assert.equal(f.parsed.turnCount,null);
 const s=f.parsed.sessions[0];assert.equal(s.rawTranscript.row,7);assert.equal(s.rawTranscript.headerRow,1);assert.equal(s.rawTranscript.sheetIndex,1);
 assert.equal(s.rawTranscript.raw[4],'  untouched  ');assert.equal(s.agent,'  Agent  ');assert.equal(s.rawTranscript.text,' Customer: مرحبا 😀\nAgent: exact quote.  ');
 assert.equal(s.rawTranscript.textSha256,sha(s.rawTranscript.text));assert.equal(s.rawTranscript.fileSha256,f.source.sha256);
 assert.deepEqual(s.turns,[]);assert.equal(s.startedAt,'');assert.equal(s.completeness,'未核验');assert.equal(s.product,'Source Product');
 assert.deepEqual(s.rawTranscript.columns,{id:1,agent:2,text:3,product:4});assert.equal(raw.validateRawTranscript(s.rawTranscript),true);
});
test('English aliases and non-first header rows retain all raw columns',async()=>{
 const bytes=await workbook([{name:'English',headers:['Synthetic source note','','',''],rows:[['Conversation ID','Agent','Message Details','extra'],['SYN-EN','A','exact\ntext',' value ']],rowNumbers:[4,9]}]);
 const result=await raw.parseRawTranscriptFile(asFile(bytes),{scene:'新品产品咨询'});assert.equal(result.valid,true,result.errors.join(';'));
 assert.equal(result.sessions[0].rawTranscript.headerRow,4);assert.equal(result.sessions[0].rawTranscript.row,9);assert.equal(result.sessions[0].rawTranscript.raw[3],' value ');
});
test('bad nonempty rows and duplicate identifiers fail atomically instead of disappearing',async()=>{
 for(const rows of [[['SYN-1','A','ok'],['','A','orphan']],[['SYN-1','A','ok'],['SYN-2','A','   ']],[['SYN-1','A','ok'],['SYN-1','B','more']]]){
  const {parsed}=await input({headers:['ID','客服','消息详情'],rows});assert.equal(parsed.valid,false);assert.deepEqual(parsed.sessions,[]);assert.ok(parsed.errors.some(message=>/行|重复/.test(message)));
 }
});
test('an absent source agent remains absent metadata while nonempty raw text is usable',async()=>{
 const {parsed}=await input({headers:['ID','客服','消息详情'],rows:[['SYN-NO-AGENT','','literal source']]});
 assert.equal(parsed.valid,true,parsed.errors.join(';'));assert.equal(parsed.sessions[0].agent,'');assert.deepEqual(parsed.sessions[0].turns,[]);
});
test('complete structured conversation templates explicitly continue the old parser',async()=>{
 const bytes=await workbook([{name:'会话信息',headers:['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'],rows:[]},{name:'会话明细',headers:['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'],rows:[]}]);
 const parsed=await raw.parseRawTranscriptFile(asFile(bytes));assert.equal(parsed.supported,false);assert.deepEqual(parsed.sessions,[]);
});
test('task source product wins over default, which wins over unavailable',async()=>{
 const full=await input(),a=taskOf(full);assert.equal(a.state.sessions[0].product,'Source Product');
 const empty=await input({headers:['ID','客服','消息详情'],rows:[['SYN-2','A','exact quote.']]});
 const b=taskOf(empty);assert.equal(b.state.sessions[0].product,'Default Product');assert.deepEqual(b.state.tasks[0].reviewPolicy,DEFAULT_REVIEW_POLICY);
 const c=taskOf(empty,{rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}});assert.equal(c.state.sessions[0].product,'未提供');
});
test('raw reinspection retains the explicit comparison lineage while repeated direct imports also work',async()=>{
 const f=await input(),{state,catalog}=taskOf(f),task=state.tasks[0];
 assert.equal(domain.createImportedTask(state,{name:'Duplicate',sessions:f.parsed.sessions,source:f.source,basisSnapshot:task.basisSnapshot,reviewer:'Reviewer',now}).tasks[0].importLineage.ordinal,2);
 const snapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds:['R001','R004'],now});
 const next=domain.createRawReinspectionTask(state,task.id,{name:'Synthetic new rules',basisSnapshot:snapshot,reviewer:'Reviewer',now:'2026-11-12T11:00:00+08:00'});
 assert.equal(next.tasks.length,2);assert.deepEqual(next.tasks[1],task);assert.deepEqual(next.sessions[0],state.sessions[0]);
 assert.equal(next.tasks[0].reinspectionOf,task.id);assert.deepEqual(next.tasks[0].source,task.source);
 const derived=next.sessions.find(s=>s.taskId===next.tasks[0].id);assert.deepEqual(derived.rawTranscript,state.sessions[0].rawTranscript);assert.deepEqual(derived.expectedRuleIds,['R001','R004']);assert.deepEqual(derived.aiResults,[]);
});
function resultFor(s,{verdict='符合',status='verified',quote='exact quote.'}={}){
 const start=s.rawTranscript.text.indexOf(quote);
 return {ruleId:'R004',verdict,reason:'Synthetic evidence reason.',evidence:[],referenceIds:['P004-2'],confidence:0.95,conflictsWith:[],turnRefs:[],evidenceQuotes:quote?[{quote,matches:[{start,end:start+quote.length}]}]:[],rawValidation:{schemaVersion:1,status,textSha256:s.rawTranscript.textSha256,reasonCodes:status==='verified'?[]:['synthetic_failure']}};
}
test('R11 raw quotations require no fake turn and reject a forged coordinate',async()=>{
 const {state}=taskOf(await input()),s=state.sessions[0],basis=state.tasks[0].basisSnapshot;s.aiExecution={status:'completed',runId:'SYN-RUN'};s.aiResults=[resultFor(s)];
 s.aiDecision=deriveAIDecision(s,s.reviewPolicy,{at:now,basis});assert.equal(s.aiDecision.status,'PASS');assert.equal(isAIFinal(s),true);assert.equal(domain.hasCompletedAI(s),true);
 s.aiResults[0].evidenceQuotes[0].matches[0].start++;s.aiDecision=deriveAIDecision(s,s.reviewPolicy,{at:now,basis});assert.equal(s.aiDecision.status,'UNCERTAIN');assert.equal(domain.hasCompletedAI(s),false);
});
test('unavailable source time cannot become an R11 timing PASS through a valid literal quote',async()=>{
 const {state}=taskOf(await input()),s=state.sessions[0],basis=structuredClone(state.tasks[0].basisSnapshot);
 basis.rules[0].category='响应时效';basis.rules[0].name='首次响应时间';s.aiExecution={status:'completed',runId:'SYN-TIME'};s.aiResults=[resultFor(s)];
 const decision=deriveAIDecision(s,s.reviewPolicy,{at:now,basis});assert.equal(decision.status,'UNCERTAIN');assert.ok(decision.reasonCodes.includes('source_time_unavailable'));
});
test('failed raw program fallback is visible for review without claiming AI completion',async()=>{
 const {state}=taskOf(await input()),s=state.sessions[0];s.aiExecution={status:'failed',runId:'SYN-FAILED'};s.aiResults=[resultFor(s,{verdict:'无法判定',status:'program-fallback',quote:''})];
 s.aiDecision=deriveAIDecision(s,s.reviewPolicy,{at:now,basis:state.tasks[0].basisSnapshot});assert.equal(s.aiDecision.status,'UNCERTAIN');assert.equal(domain.hasCompletedAI(s),false);
 const shown=domain.getSessionResults(s)[0];assert.equal(shown.verdict,'无法判定');assert.equal(shown.rawValidation.status,'program-fallback');assert.equal(shown.executionStatus,'执行失败');assert.equal(shown.final,null);
 assert.throws(()=>domain.acceptAI(state,s.id,now),/未运行|未完整|失败/);
});
test('human raw quotations are recomputed locally and do not masquerade as accepted AI fallback',async()=>{
 const {state}=taskOf(await input()),s=state.sessions[0],draft={ruleId:'R004',verdict:'符合',reason:'Human checked literal source.',evidence:[],referenceIds:['P004-2'],evidenceQuotes:[{quote:'exact quote.'}]};
 const changed=domain.saveReview(state,s.id,draft,now),saved=changed.sessions[0].review.drafts.R004;
 assert.equal(saved.source,'人工独立审核');assert.equal(saved.rawValidation.status,'verified');assert.ok(saved.evidenceQuotes[0].matches[0].start>0);
 assert.throws(()=>domain.saveReview(state,s.id,{...draft,evidenceQuotes:[{quote:'invented'}]},now),/引文|原文/);
 assert.equal(domain.saveReview(state,s.id,{...draft,evidenceQuotes:[]},now).sessions[0].review.drafts.R004.rawValidation.status,'manual-provided');
});
test('raw active-review segments are measured values, idempotent and protected from invalid durations',async()=>{
 const {state}=taskOf(await input()),sessionId=state.sessions[0].id,record={sessionId,elapsedMs:4500,reviewer:'Reviewer',now,segmentId:'SYN-TIMER-1'};
 const timed=domain.recordRawReviewTime(state,record);assert.equal(timed.sessions[0].review.activeTimeMs,4500);assert.equal(timed.sessions[0].review.timeSegments.length,1);
 assert.equal(domain.recordRawReviewTime(state,{...record,elapsedMs:0.5}).sessions[0].review.activeTimeMs,0.5);
 assert.deepEqual(domain.recordRawReviewTime(timed,record),timed);
 assert.throws(()=>domain.recordRawReviewTime(timed,{...record,elapsedMs:100}),/不能改写/);
 for(const elapsedMs of [-1,NaN,Infinity,4*60*60*1000+1])assert.throws(()=>domain.recordRawReviewTime(state,{...record,elapsedMs}),/时长|计时/);
});

test('AI-final raw records require suspicious-return audit before human drafts can change',async()=>{const {state}=taskOf(await input()),s=state.sessions[0];s.aiExecution={status:'completed',runId:'SYN-READONLY'};s.aiResults=[resultFor(s)];s.aiDecision=deriveAIDecision(s,s.reviewPolicy,{at:now,basis:state.tasks[0].basisSnapshot});const draft={ruleId:'R004',verdict:'不符合',reason:'Synthetic correction',evidence:[],referenceIds:['P004-2'],evidenceQuotes:[{quote:'exact quote.'}]};assert.equal(isAIFinal(s),true);assert.throws(()=>domain.saveReview(state,s.id,draft,now),/退回|只读/);const {validateReturnTransition}=await import('../server/triage-validation.mjs'),after=structuredClone(s);after.review.status='已暂存';assert.throws(()=>validateReturnTransition(s,after),/退回|只读/);const {returnToHumanReview}=await import('../public/ai-triage.mjs'),returned=returnToHumanReview(state,{sessionIds:[s.id],reason:'Synthetic suspicion',reviewer:'Reviewer',now});assert.doesNotThrow(()=>domain.saveReview(returned,s.id,draft,now));});
