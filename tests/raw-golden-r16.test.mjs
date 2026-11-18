import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../public/raw-golden.mjs').catch(()=>({}));
const item=(ruleId,verdict,status='verified',codes=[])=>({ruleId,verdict,reason:'Synthetic',referenceIds:[],evidence:[],evidenceQuotes:[],confidence:0.99,conflictsWith:[],rawValidation:{schemaVersion:1,status,textSha256:'b'.repeat(64),reasonCodes:codes}});
function fixture(){
 const task={id:'TASK-SYN-RAW',inputMode:'raw-transcript-v1',scene:'新品产品咨询',source:{sha256:'a'.repeat(64),name:'synthetic.xlsx'},basisSnapshot:{rules:[{id:'SYN-R1',version:'V1.0',title:'Synthetic rule1'},{id:'SYN-R2',version:'V1.0',title:'Synthetic rule2'}]},reviewPolicy:{enabled:true,confidenceThreshold:0.9}};
 const pairs=[['符合','符合'],['不符合','无法判定'],['无法判定','符合'],['无法判定','无法判定']];
 const sessions=pairs.map((vs,i)=>({id:'S'+i,externalId:'EX'+i,taskId:task.id,rawTranscript:{schemaVersion:1,row:i+2,text:'Synthetic original '+i},aiResults:vs.map((v,j)=>item('SYN-R'+(j+1),v,i===3?'program-fallback':i===2&&j===0?'degraded':'verified',i===1&&j===1?['source_time_unavailable']:i===3?['invalid_output']:i===2&&j===0?['quote_mismatch']:[])),aiExecution:{status:i===3?'failed':'completed'},aiDecision:{status:i===0?'PASS':i===1?'FAIL':'UNCERTAIN'},review:{status:i===0?'已确认':'待审核',activeTimeMs:i===0?23456:0},reviewPolicy:task.reviewPolicy}));
 const state={tasks:[task],sessions};
 const goldPairs=[['符合','不符合'],['不符合','无法判定'],['无法判定','符合'],['无法判定','无法判定']];
 const golden={schemaVersion:1,taskId:task.id,sourceSha256:task.source.sha256,records:goldPairs.flatMap((vs,i)=>vs.map((verdict,j)=>({sourceRow:i+2,conversationId:'EX'+i,ruleId:'SYN-R'+(j+1),ruleVersion:'V1.0',verdict})))};
 return{task,state,golden};
}
test('raw golden evaluation reports full matrix accuracy, uncertainty, fail recall and original exempt-pass mistakes together',()=>{
 assert.equal(typeof api.evaluateRawGolden,'function');const f=fixture(),m=api.evaluateRawGolden(f.state,f.task.id,f.golden);
 assert.deepEqual(m.accuracy,{correct:4,total:8,rate:0.5});assert.deepEqual(m.uncertainty,{count:4,total:8,rate:0.5});assert.deepEqual(m.failRecall,{recalled:1,total:2,rate:0.5});assert.equal(m.wrongAIFinalPass.count,1);assert.equal(m.humanReviewTimeMs,23456);assert.equal(m.acceptance.passesAccuracyTarget,false);
});

test('model request counts exclude program-only timing executions and keep legacy recorded attempts',()=>{
 const f=fixture();f.task.aiQueue={rows:[{attempts:1,rawAttempts:[]},{attempts:2,rawAttempts:[{attempt:1},{attempt:2}]},{attempts:3}]};
 assert.equal(api.evaluateRawGolden(f.state,f.task.id,f.golden).reviewRouting.modelRequestAttempts,5);
});
test('a program downgrade cannot earn correctness for matching an unknown golden label, but declared missing-time uncertainty can',()=>{
 const f=fixture(),m=api.evaluateRawGolden(f.state,f.task.id,f.golden);assert.equal(m.counts.unansweredChecks,3);assert.equal(m.counts.technicalFailedRows,1);assert.equal(m.counts.sourceTimeUnavailableChecks,1);
});
test('incomplete golden coverage retains the full denominator and cannot claim a passed acceptance',()=>{
 const f=fixture();f.golden.records.pop();const m=api.evaluateRawGolden(f.state,f.task.id,f.golden);assert.equal(m.accuracy.total,8);assert.equal(m.counts.missingGolden,1);assert.equal(m.acceptance.goldenComplete,false);assert.equal(m.acceptance.passesAccuracyTarget,false);
});
test('wrong task, source, rule/version, row and duplicate golden cells are rejected rather than silently realigned',()=>{
 for(const change of [g=>g.taskId='other',g=>g.sourceSha256='c'.repeat(64),g=>g.records[0].ruleId='other',g=>g.records[0].ruleVersion='V2',g=>g.records[0].sourceRow=99,g=>g.records.push({...g.records[0]})]){const f=fixture();change(f.golden);assert.throws(()=>api.evaluateRawGolden(f.state,f.task.id,f.golden));}
});
test('no positive golden cases produces an unevaluated fail recall, not a fabricated zero or one',()=>{
 const f=fixture();for(const r of f.golden.records)r.verdict='符合';const m=api.evaluateRawGolden(f.state,f.task.id,f.golden);assert.deepEqual(m.failRecall,{recalled:0,total:0,rate:null});
});
test('a generated localized template round-trips source row, exact rule versions and blank answers without model calls',async()=>{
 const f=fixture();for(const language of ['zh','en']){const bytes=await api.buildRawGoldenTemplate(f.state,f.task.id,{language}),file={name:'synthetic-gold.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},gold=await api.parseRawGoldenFile(file,f.state,f.task.id);assert.equal(gold.records.length,0);assert.equal(gold.sourceSha256,f.task.source.sha256);}
});
test('acceptance HTML is standalone, escapes source facts, and distinguishes0.90 confidence from90 percent accuracy',()=>{
 const f=fixture(),m=api.evaluateRawGolden(f.state,f.task.id,f.golden);m.taskName='<script>alert(1)</script>';for(const language of ['zh','en']){const html=api.buildRawGoldenHtml(m,{language});assert.ok(html.startsWith('<!doctype html>'));assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);assert.doesNotMatch(html,/<(?:link|script)\b[^>]*(?:src|href)=/i);assert.match(html,/0\.90/);assert.match(html,/90%/);}
});

test('missing golden labels never fabricate an evaluated zero accuracy and fractional review time remains visible',()=>{const f=fixture();f.golden.records=[];f.state.sessions[0].review.activeTimeMs=1234.5;const m=api.evaluateRawGolden(f.state,f.task.id,f.golden);assert.equal(m.accuracy.rate,null);assert.equal(m.humanReviewTimeMs,1234.5);assert.equal(m.acceptance.evaluated,false);const html=api.buildRawGoldenHtml(m,{language:'en'});assert.match(html,/Not evaluated/);assert.doesNotMatch(html,/>符合<|>不符合<|>无法判定</);});

test('wrong exempt PASS includes a golden unknown or an entirely inapplicable row',()=>{for(const answer of ['无法判定','不适用']){const f=fixture();f.golden.records.filter(g=>g.sourceRow===2).forEach(g=>g.verdict=answer);const m=api.evaluateRawGolden(f.state,f.task.id,f.golden);assert.equal(m.wrongAIFinalPass.count,1);}});

test('English raw methodology uses frozen source timezone or explicitly unknown source time',async()=>{const {englishMethodologyRows}=await import('../public/report-english-delivery.mjs');for(const mode of ['explicit','unavailable']){const snapshot={deliveryType:'consultation-v1',inputMode:'raw-transcript-v1',taskName:'Synthetic',source:{},createdAt:'2026-11-12T00:00:00Z',rawImportOptions:{timePolicy:{mode,timezone:'Z'}},basis:{rules:[]},metrics:{determinate:0},records:[],original:{sheetName:'Synthetic',headerRow:1}};const rows=englishMethodologyRows(snapshot,{}, {display:x=>x,counts:{}},{}),basis=rows.find(r=>r[0]==='Time basis')[1];assert.doesNotMatch(basis,/UTC\+08|Beijing/);assert.match(basis,mode==='explicit'?/interpretation: Z/:/No reliable source timestamps/);}});
