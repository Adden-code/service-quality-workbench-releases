import test from 'node:test';
import assert from 'node:assert/strict';
import {scenarioRuntimeFixture,scenarioConfig} from './scenario-report-fixtures.mjs';
import {readXlsx} from '../public/io.mjs';
import {consultationOriginalFromTables} from '../server/consultation-source.mjs';
import {createBusinessDeliverySnapshot} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';

async function snapshot(options={}){
 const f=await scenarioRuntimeFixture(2,options),original=consultationOriginalFromTables(f.state,f.task,await readXlsx(f.bytes));return createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original});
}
const translated=()=>({translationStats:{failedTexts:0,pendingTexts:0,missingRecords:0}});

test('overview-only report discloses failed custom field generation even when translation is complete',async()=>{
 const s=await snapshot({analysisFields:[],report:{...scenarioConfig().report,sections:['overview']}}),before=structuredClone(s);
 const enrichment={...translated(),status:'completed_with_warnings',scenarioFields:Object.fromEntries(s.records.map(row=>[row.id,{status:'failed'}])),warnings:s.records.map(row=>({kind:'scenarioFields',recordIds:[row.id],code:'INVALID_OUTPUT'}))};
 const html=buildBusinessReportHtml(s,enrichment);assert.match(html,/<aside class="notice">[^<]*自定义字段[^<]*失败2条/);assert.equal((html.match(/<section\b/g)||[]).length,1);assert.deepEqual(s,before);
});
test('selected analysis failures and pending records remain visible with cases and VOC disabled',async()=>{
 const s=await snapshot({analysisFields:['demandSummary'],customFields:[],report:{...scenarioConfig().report,sections:['overview']}});
 const enrichment={...translated(),consultationAnalysis:{[s.records[0].id]:{status:'failed'},[s.records[1].id]:{status:'pending'}}};
 assert.match(buildBusinessReportHtml(s,enrichment),/<aside class="notice">[^<]*会话分析[^<]*失败1条[^<]*未完成1条/);
});
test('failed issue-cluster nodes are disclosed independently of translation and case selection',async()=>{
 const s=await snapshot({analysisFields:[],customFields:[],report:{...scenarioConfig().report,sections:['overview','improvements']}});
 const html=buildBusinessReportHtml(s,{...translated(),status:'completed_with_warnings',warnings:[{kind:'consultationIssues',recordIds:[s.records[0].id],code:'INVALID_OUTPUT'}]});
 assert.match(html,/<aside class="notice">[^<]*原因归纳[^<]*失败1个节点/);
});
