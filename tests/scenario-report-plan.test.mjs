import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioConfig} from './scenario-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {planConsultationReport,consultationInputFor,mergeConsultationReport} from '../server/consultation-report-plan.mjs';

test('disabled analysis/VOC/case/issues modules do not create dedicated model nodes or excerpt translations',()=>{
 const {snapshot:s}=consultationReportFixture();s.scenarioSnapshot=scenarioConfig({analysisFields:[],customFields:[]});let p=planConsultationReport(s,'model');assert.ok(!p.units.some(u=>u.kind!=='translation'));assert.ok([...p.translations.values()].every(t=>t.refs.every(r=>r.field==='conversation')));
 const j={status:'completed',updatedAt:'2026-11-05T10:00:00Z',units:p.units.map(u=>({...u,status:'completed'}))},o=new Map(j.units.map(u=>[u.id,{items:u.itemIds.map(id=>({id,translation:'译文',isTargetLanguage:false,detectedLanguage:'en'}))}]));
 const e=mergeConsultationReport(s,j,p,o);assert.equal(e.analysisStats.total,0);assert.deepEqual(e.consultationAnalysis,{});assert.deepEqual(e.vocItems,[]);
 s.scenarioSnapshot.customFields=scenarioConfig().customFields;p=planConsultationReport(s,'model');assert.equal(p.units.filter(u=>u.kind==='scenarioFields').length,s.records.length);assert.equal(p.units.filter(u=>u.kind==='consultationAnalysis').length,0);
});
test('selected builtins and custom fields are independent frozen inputs and cache identity includes source/policies/config/prompt',()=>{
 const {snapshot:s}=consultationReportFixture();s.scenarioSnapshot=scenarioConfig({analysisFields:['demandSummary']});let p=planConsultationReport(s,'model'),u=p.units.find(u=>u.kind==='scenarioFields'),a=p.units.find(u=>u.kind==='consultationAnalysis');assert.ok(u);assert.match(u.cacheKey,/^[a-f0-9]{64}$/);
 assert.equal(u.recordIds.length,1);const input=consultationInputFor(s,u,p);assert.deepEqual(input.fields,s.scenarioSnapshot.customFields);assert.deepEqual(input.policies,s.basis.policies);assert.deepEqual(consultationInputFor(s,a,p).analysisFields,['demandSummary']);assert.equal(consultationInputFor(s,a,p).includeVoc,false);
 const same=planConsultationReport(structuredClone(s),'model').units.find(v=>v.kind==='scenarioFields');assert.equal(u.cacheKey,same.cacheKey);
 for(const change of [v=>v.source.sha256='c'.repeat(64),v=>v.basis.policies.push({id:'new',version:'1',title:'资料',category:'参考',sections:[{id:'x',title:'说明',text:'资料内容'}]}),v=>v.scenarioSnapshot.customFields[0].instruction+='新约束']){const other=structuredClone(s);change(other);assert.notEqual(planConsultationReport(other,'model').units.find(v=>v.kind==='scenarioFields').cacheKey,u.cacheKey);}
 assert.notEqual(planConsultationReport(s,'other-model').units.find(v=>v.kind==='scenarioFields').cacheKey,u.cacheKey);
 s.records[0].turns[0].text='x'.repeat(20001);p=planConsultationReport(s,'model');u=p.units.find(u=>u.kind==='scenarioFields');assert.equal(u.inputError.code,'INPUT_TOO_LARGE');assert.throws(()=>consultationInputFor(s,u,p),error=>error.code==='INPUT_TOO_LARGE');
});

test('oversized frozen references are a nonretryable scenario field preflight error',()=>{
 const {snapshot:s}=consultationReportFixture();s.scenarioSnapshot=scenarioConfig({analysisFields:[]});s.basis.policies=Array.from({length:51},(_,index)=>({id:'ref'+index,version:'1',title:'资料',category:'普通参考',sections:[{id:'s',title:'说明',text:'受控资料正文。'}]}));
 const p=planConsultationReport(s,'model'),u=p.units.find(unit=>unit.kind==='scenarioFields');assert.equal(u.inputError?.code,'INPUT_TOO_LARGE');assert.throws(()=>consultationInputFor(s,u,p),error=>error.code==='INPUT_TOO_LARGE');
});
