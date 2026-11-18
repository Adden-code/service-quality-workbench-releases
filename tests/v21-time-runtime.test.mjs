import test from 'node:test';
import assert from 'node:assert/strict';
import {timeJudgment,mergeEcommerceResults} from '../server/ecommerce-engine.mjs';
import {EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {sourceRow,basis,cutoff} from './v21-runtime-fixtures.mjs';
test('stage A computes exact configured working time and type threshold without row-level override',()=>{
 const result=timeJudgment(sourceRow(),{basis,inspectionAt:cutoff});
 assert.equal(result.verdict,'符合');assert.equal(result.timeFacts?.elapsedMs,2*3600000);assert.equal(result.timeFacts.thresholdHours,24);assert.equal(result.timeFacts.thresholdSource,'byType');
 const positive=timeJudgment(sourceRow({type:' 好评正向 '}),{basis,inspectionAt:cutoff});assert.equal(positive.timeFacts.thresholdHours,72);
 for(const [type,hours] of [['中评',48],['好评负向',24],['差评',24]])assert.equal(timeJudgment(sourceRow({type}),{basis,inspectionAt:cutoff}).timeFacts.thresholdHours,hours);
 for(const type of ['', '未知类型']){const value=timeJudgment(sourceRow({type}),{basis,inspectionAt:cutoff});assert.equal(value.timeFacts.thresholdHours,24);assert.equal(value.timeFacts.thresholdSource,'default');assert.match(value.reason,/默认/);}
 assert.deepEqual(result.referenceIds,['EC-TIME-EC-STAGE-A-TEST@V2.1#']);
});
test('stage A working-hours engine uses exact 24h and 72h edges rather than displayed rounded hours',()=>{
 for(const [commentAt,replyAt,type,elapsedMs,verdict] of [
  ['2026-10-26T09:00:00+08:00','2026-10-28T15:00:00+08:00','差评',24*3600000,'符合'],
  ['2026-10-26T09:00:00+08:00','2026-10-28T15:00:00.001+08:00','差评',24*3600000+1,'不符合'],
  ['2026-10-19T09:00:00+08:00','2026-10-28T18:00:00+08:00','好评正向',72*3600000,'符合'],
 ]){
  const result=timeJudgment(sourceRow({commentAt,replyAt,type}),{basis,inspectionAt:cutoff});assert.equal(result.timeFacts.elapsedMs,elapsedMs);assert.equal(result.verdict,verdict);
 }
});
test('stage A continuous timing honors exact 24h boundary and retains calendar trial warning',()=>{
 const continuous=structuredClone(basis);continuous.ruleSetSnapshot.timeRule.mode='continuous';
 for(const [replyAt,verdict] of [['2026-10-31T17:00:00+08:00','符合'],['2026-10-31T17:00:00.001+08:00','不符合']]){
  const result=timeJudgment(sourceRow({replyAt}),{basis:continuous,inspectionAt:cutoff});assert.equal(result.verdict,verdict);assert.equal(result.timeFacts.calendarConfirmed,false);
 }
 assert.equal(timeJudgment(sourceRow(),{basis:continuous,inspectionAt:cutoff}).verdict,'不符合');
});
test('stage A keeps unreplied business fact separate from missing-time and conflict',()=>{
 const unreply=timeJudgment(sourceRow({reply:' ',replyAt:' '}),{basis,inspectionAt:cutoff});assert.equal(unreply.verdict,'无法判定');assert.equal(unreply.timeFacts?.replyStatus,'unreplied');assert.equal(unreply.timeFacts.outcome,'unreplied');assert.equal(unreply.timeFacts.endAt,cutoff);
 const missing=timeJudgment(sourceRow({replyAt:''}),{basis,inspectionAt:cutoff});assert.equal(missing.timeFacts.replyStatus,'missing-time');assert.equal(missing.timeFacts.elapsedMs,null);
 const conflict=timeJudgment(sourceRow({reply:'',replyAt:'2026-11-02T10:00:00+08:00'}),{basis,inspectionAt:cutoff});assert.equal(conflict.timeFacts.replyStatus,'conflict');assert.equal(conflict.verdict,'无法判定');
 const invalid=timeJudgment(sourceRow({commentAt:'not-a-time'}),{basis,inspectionAt:cutoff});assert.equal(invalid.timeFacts.elapsedMs,null);assert.equal(invalid.verdict,'无法判定');
});
test('stage A merge cannot turn unreplied semantic not-applicable into quality passes',()=>{
 const s=sourceRow({reply:'',replyAt:''}),semanticResults=[{sessionId:s.id,results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'不适用',reason:'没有实际回复',evidence:[],referenceIds:[]}))}];
 const merged=mergeEcommerceResults({sessions:[s],semanticResults,duplicateGroups:[],basis,inspectionAt:cutoff}).get(s.id);
 assert.equal(merged[0].timeFacts?.replyStatus,'unreplied');assert.ok(merged.every(r=>r.verdict==='无法判定'));
 const legacy=timeJudgment(sourceRow());assert.equal(legacy.timeFacts,undefined);assert.equal(legacy.verdict,'不符合');
});
test('stage A caps unknown-type explanation without changing exact source fact or default threshold',()=>{
 const type='未知'.repeat(10000),result=timeJudgment(sourceRow({type}),{basis,inspectionAt:cutoff});
 assert.ok(result.reason.length<20000);assert.equal(result.timeFacts.evaluationType,type);assert.equal(result.timeFacts.thresholdSource,'default');
});
