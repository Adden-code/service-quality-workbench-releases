import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioRuntimeFixture,scenarioConfig} from './scenario-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {consultationOriginalFromTables} from '../server/consultation-source.mjs';
import {createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {consultationDeliveryHeaders} from '../public/consultation-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {businessTasks,businessExportView} from '../public/business-export-view.mjs';
import {BUILTIN_SCENARIOS} from '../public/scenarios.mjs';
import {consultationRuntimeFixture} from './consultation-runtime-fixture.mjs';
import {planConsultationReport,consultationReportPlanVersion,consultationInputFor} from '../server/consultation-report-plan.mjs';

test('registered conversation delivery freezes config, preserves source and chooses only selected ordered columns',async()=>{
 const f=await scenarioRuntimeFixture(),original=consultationOriginalFromTables(f.state,f.task,await readXlsx(f.bytes)),before=structuredClone(f.task.scenarioSnapshot);
 const s=createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original});
 assert.deepEqual(s.scenarioSnapshot,before);assert.deepEqual(s.metrics.byGroup.map(row=>row.value),['华北','华南']);
 assert.deepEqual(consultationDeliveryHeaders(s).slice(5,12),['会话详情翻译（中文）','用户意图','是否涉及负面声音','用户负面原声','处理方案','处理渠道','客户诉求原文']);
 f.state.scenarios[0].name='新名字';f.task.scenarioSnapshot.customFields[0].label='新字段名';assert.deepEqual(s.scenarioSnapshot,before);
 const e={scenarioFields:Object.fromEntries(s.records.map(r=>[r.id,{status:'completed',fields:before.customFields.map(field=>({id:field.id,value:field.type==='quote'?r.turns[0].text:field.type==='enum'?'线上':'已提供处理方案',missing:false,turnId:field.type==='quote'?1:null}))}]))};
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(s,e));assert.equal(tables['检核明细'][1][4],'0000');assert.equal(tables['检核明细'][1][XLSX_ROW_NUMBER],2);assert.match(tables['检核明细'][1][11],/第1轮/);assert.equal(tables['检核明细'][0].at(-2),'整体通过');
 assert.ok(tables['口径说明'].some(row=>row[0]==='场景配置'&&row[1].includes('SCENE-AFTERSALES')));
 assert.equal(businessTasks(f.state).length,1);
 const html=buildBusinessReportHtml(s,e);assert.match(html,/<h1>售后服务质检报告<\/h1>/);assert.match(html,/按区域质检概况/);assert.match(html,/华北/);assert.equal((html.match(/<section\b/g)||[]).length,2);assert.ok(!/id="(?:dimension-results|typical-cases|issue-clusters|voice-of-customer)"/.test(html));
 assert.match(businessExportView(f.state,{},{}),/售后服务质检报告/);
});

test('context grouping accepts retain or inspect extras, marks missing and rejects conflicting original values',async()=>{
 const f=await scenarioRuntimeFixture(),tables=await readXlsx(f.bytes);f.task.importMappingSnapshot.profile.extras[0].purpose='inspect';
 tables['业务原表'][1][3]='';let original=consultationOriginalFromTables(f.state,f.task,tables);let s=createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original});assert.ok(s.metrics.byGroup.some(row=>row.value==='未提供'));
 const duplicate=[...tables['业务原表'][2]];duplicate[0]=tables['业务原表'][1][0];duplicate[3]='冲突区域';Object.defineProperty(duplicate,XLSX_ROW_NUMBER,{value:4});tables['业务原表'][1][3]='原区域';tables['业务原表'].push(duplicate);
 assert.throws(()=>{original=consultationOriginalFromTables(f.state,f.task,tables);createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original});},/冲突/);
 f.task.importMappingSnapshot.profile.extras=[];assert.throws(()=>consultationOriginalFromTables(f.state,f.task,tables),/映射|扩展/);
});

test('agent and product grouping use frozen sources while no-config legacy columns and sections stay unchanged',async()=>{
 for(const groupBy of ['agent','product']){const f=await scenarioRuntimeFixture(2,{report:{...scenarioConfig().report,groupBy,groupField:'',groupLabel:groupBy==='agent'?'坐席':'产品'}}),original=consultationOriginalFromTables(f.state,f.task,await readXlsx(f.bytes)),s=createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original});assert.equal(s.basis.grouping.groupBy,groupBy);assert.match(buildBusinessReportHtml(s),new RegExp('按'+s.basis.grouping.label+'质检概况'));}
 const {snapshot}=consultationReportFixture();assert.equal(consultationDeliveryHeaders(snapshot).length,28);assert.equal((buildBusinessReportHtml(snapshot).match(/<section\b/g)||[]).length,6);
});

test('new builtin frozen tasks retain the original title, columns and v1 model contract',async()=>{
 const f=await consultationRuntimeFixture(1);f.task.scenarioSnapshot=structuredClone(BUILTIN_SCENARIOS.find(s=>s.id==='新品产品咨询'));
 const original=consultationOriginalFromTables(f.state,f.task,await readXlsx(f.bytes)),s=createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original});
 assert.deepEqual(s.scenarioSnapshot,f.task.scenarioSnapshot);assert.equal(consultationDeliveryHeaders(s).length,28);assert.match(buildBusinessReportHtml(s),/<h1>新品质检报告<\/h1>/);assert.equal(consultationReportPlanVersion(s),'consultation-report-plan-v1');
 const p=planConsultationReport(s,'controlled'),unit=p.units.find(unit=>unit.kind==='consultationAnalysis');assert.ok(!Object.hasOwn(consultationInputFor(s,unit,p),'analysisFields'));assert.equal((buildBusinessReportHtml(s).match(/<section\b/g)||[]).length,6);
});

test('agent grouping in the standard two-sheet format reads its defined original agent column',async()=>{
 const f=await scenarioRuntimeFixture(1,{report:{...scenarioConfig().report,groupBy:'agent',groupField:'',groupLabel:'坐席'}});delete f.task.importMappingSnapshot;
 const row=(number,values)=>{Object.defineProperty(values,XLSX_ROW_NUMBER,{value:number});return values;},tables={'会话信息':[row(1,['会话ID','产品型号','客服标识']),row(2,[f.state.sessions[0].externalId,'原产品','原表坐席甲'])],'会话明细':[row(1,['会话ID','原文内容']),row(2,[f.state.sessions[0].externalId,'原始发言'])]};
 const original=consultationOriginalFromTables(f.state,f.task,tables),s=createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original});assert.equal(s.metrics.byGroup[0].value,'原表坐席甲');assert.equal(s.records[0].groupColumn,'客服标识');
});
