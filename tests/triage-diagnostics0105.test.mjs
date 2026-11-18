import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTriageDiagnostics,triageDiagnosticsDialog} from '../public/triage-diagnostics.mjs';
const record=(id,codes=[],extra={})=>({id,taskId:'t',reviewPolicy:{version:1,enabled:true},aiExecution:{status:'completed',runId:'r'},aiDecision:{status:'UNCERTAIN',runId:'r',reasonCodes:codes},aiResults:[],review:{status:'待审核',drafts:{},notes:'',history:[]},...extra});
test('blocker counts deduplicate within a session and preserve overlapping causes',()=>{
 const state={tasks:[{id:'t',name:'合成任务'}],sessions:[record('a',['low_confidence','low_confidence']),record('b',['low_confidence','indeterminate']),record('c',[],{aiDecision:{status:'PASS',runId:'r',reasonCodes:[]}})]};
 const before=JSON.stringify(state),r=buildTriageDiagnostics(state);assert.equal(r.total,3);assert.equal(r.aiFinal,1);assert.equal(r.notAiFinal,2);assert.equal(r.onlyConfidence,1);assert.equal(r.reasons.find(r=>r.code==='low_confidence').count,2);assert.equal(r.reasons.find(r=>r.code==='indeterminate').count,1);assert.equal(JSON.stringify(state),before);
 assert.match(triageDiagnosticsDialog({type:'triage-diagnostics'},state),/不能相加当作会话总数/);
});
test('FAIL, manual work, disabled policy and no decision are not attributed only to threshold',()=>{
 const state={tasks:[{id:'t'}],sessions:[record('a',['low_confidence'],{aiResults:[{verdict:'不符合'}]}),record('b',['low_confidence'],{review:{status:'待补充',drafts:{}}}),record('c',['low_confidence'],{reviewPolicy:{version:1,enabled:false}}),record('d',[],{aiDecision:null})]};
 const r=buildTriageDiagnostics(state);assert.equal(r.onlyConfidence,0);assert.ok(r.reasons.find(x=>x.code==='has_fail'));assert.ok(r.reasons.find(x=>x.code==='manual_work'));assert.ok(r.reasons.find(x=>x.code==='policy_disabled'));assert.ok(r.reasons.find(x=>x.code==='no_decision'));
});
test('diagnostics honor task scope and exclude void tasks while retaining archived history',()=>{
 const state={tasks:[{id:'t',lifecycle:{archivedAt:'2026-11-15T00:00:00Z'}},{id:'void',lifecycle:{voidedAt:'2026-11-15T00:00:00Z'}}],sessions:[record('a',['indeterminate']),record('b',[],{taskId:'void'})]};
 assert.equal(buildTriageDiagnostics(state).total,1);assert.equal(buildTriageDiagnostics(state,{taskId:'void'}).total,0);assert.equal(buildTriageDiagnostics(state,{taskId:'missing'}).total,0);
});
test('saved program timing reasons remain visible even when the routing decision reports generic unknown',()=>{
 const state={tasks:[{id:'t'}],sessions:[record('a',['indeterminate'],{aiResults:[{verdict:'无法判定',rawValidation:{reasonCodes:['source_time_unavailable']}},{verdict:'无法判定',rawValidation:{reasonCodes:['source_time_unavailable']}}]})]};
 const original=structuredClone(state),result=buildTriageDiagnostics(state);
 assert.equal(result.reasons.find(row=>row.code==='source_time_unavailable').count,1);assert.deepEqual(state,original);
});
