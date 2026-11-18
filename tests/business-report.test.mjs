import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {reportFixture} from './business-report-fixtures.mjs';
const moduleUrl=new URL('../public/business-report.mjs',import.meta.url);
async function implementation(){assert.ok(existsSync(moduleUrl),'缺少业务六部分HTML报告');return import(moduleUrl);}

test('business HTML has six sections and frozen metrics including pending/unreplied denominator',async()=>{
  const {buildBusinessReportHtml}=await implementation(),{snapshot,enrichment}=reportFixture();
  const html=buildBusinessReportHtml(snapshot,enrichment,{environment:'本机独立工作台',job:{status:'completed_with_warnings'}});
  for(const text of ['质检数据概况','评价类型分布','五大检核项通过情况','典型案例','不合格原因聚类与改进建议','用户评价声量聚类','50%','待判定','未回复','质量分母','差评','业务原表.xlsx','11月1日—11月3日','合成大区','累计工作时间','V2.1-A（时效升级；其他四项V1）','原表历史人工结论','本机独立工作台'])assert.ok(html.includes(text),text);
  assert.ok(!/AI错误率[：:]\s*\d/.test(html));assert.ok(html.includes('本次复核')&&html.includes('历史覆盖'));assert.ok(html.includes('未核对'));
});
test('case content follows selected translation language and never masks failed translations as same',async()=>{
  const {buildBusinessReportHtml}=await implementation(),{snapshot,enrichment}=reportFixture();snapshot.targetLang='en';
  const html=buildBusinessReportHtml(snapshot,enrichment);
  for(const text of ['英文','Translation failed','尚未完成','缺失','原表行','4','少于10','少于5','感谢您的具体建议'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('历史人工认为回复缺少针对性。'));
  assert.ok(!html.includes('不得直接使用同语种文本字段'));
  assert.ok(!html.includes('全部人工确认完成'));
});
test('HTML escapes every source and model field and uses only inline offline rendering',async()=>{
  const {buildBusinessReportHtml}=await implementation(),{snapshot,enrichment}=reportFixture();
  snapshot.taskName='<script>alert(1)</script>';snapshot.source.name='原表<img src=x onerror=evil>.xlsx';snapshot.records[1].raw22[8]='<iframe src="https://evil.test"></iframe>';
  enrichment.excellentCases[0].commentary='<img src="https://evil.test" onerror="evil()">';enrichment.issueClusters[0].action='<script>evil()</script>';
  const before=JSON.stringify({snapshot,enrichment}),html=buildBusinessReportHtml(snapshot,enrichment);
  assert.ok(html.includes('&lt;script&gt;alert'));assert.ok(html.includes('&lt;iframe'));assert.ok(html.includes('&lt;img'));
  assert.ok(!/<(?:script|link|iframe|img)\b/i.test(html));assert.ok(!/\b(?:src|href)\s*=\s*["']?(?:https?:|\/\/)/i.test(html));assert.ok(!/@import|url\s*\(/i.test(html));assert.ok(html.includes('<style>'));assert.ok(!html.includes('<svg'));assert.ok(html.includes('class="rate-comparison"'));assert.ok(html.includes('@media print'));
  assert.equal(JSON.stringify({snapshot,enrichment}),before);
});
test('missing or partial model analysis remains explicit instead of manufacturing zero problems or examples',async()=>{
  const {buildBusinessReportHtml}=await implementation(),{snapshot}=reportFixture();
  const html=buildBusinessReportHtml(snapshot,{}, {job:{status:'running'}});
  for(const text of ['尚未完成','固定维度建议','暂无已完成的优秀案例点评','VOC分析尚未完成','缺失'])assert.ok(html.includes(text),text);
  assert.ok(!/>没有用户痛点[。<]/.test(html));assert.ok(!html.includes('整体通过率100%'));
});
test('VOC and cluster counts use known unique source members and exclude out-of-scope ratings',async()=>{
  const {buildBusinessReportHtml}=await implementation(),{snapshot,enrichment}=reportFixture();
  enrichment.issueClusters[0].memberIds=['case-bad','case-bad','unknown'];enrichment.issueClusters[0].count=999;
  enrichment.vocItems.push({id:'case-unreplied',valid:true,scene:'物流配送',painPoint:'不应混入差评VOC',reason:'',evidenceQuote:''},{id:'unknown',valid:true,scene:'价格',painPoint:'伪造记录',reason:'',evidenceQuote:''});
  const html=buildBusinessReportHtml(snapshot,enrichment);
  assert.ok(!html.includes('999'));assert.ok(!html.includes('不应混入差评VOC'));assert.ok(!html.includes('伪造记录'));
  for(const text of ['范围外','无效评价','只有情绪，没有具体问题。','客服响应'])assert.ok(html.includes(text),text);
});
test('zero quality denominator renders no percentage and AI-only mode discloses actual final policy',async()=>{
  const {buildBusinessReportHtml}=await implementation(),{snapshot}=reportFixture();
  snapshot.conclusionMode='ai';snapshot.records=snapshot.records.slice(3);snapshot.metrics={...snapshot.metrics,total:1,passed:0,failed:0,pending:0,unreplied:1,determinate:0,passRate:null,correctedRecords:0,confirmedCorrections:0,historicalCorrections:0,typeDistribution:[{type:'差评',label:'差评',count:1,percentage:100}],ruleStats:snapshot.metrics.ruleStats.map(row=>({...row,ai:{passed:0,failed:0,pending:0,denominator:0,passRate:null},final:{passed:0,failed:0,pending:0,denominator:0,passRate:null}}))};
  const html=buildBusinessReportHtml(snapshot,{});
  assert.ok(html.includes('AI初判'));assert.ok(html.includes('暂无可判定质量结论'));assert.ok(!html.includes('整体通过率：0%'));assert.ok(!html.includes('整体通过率：100%'));
});

test('structured time evidence prints one decimal hour and no raw elapsed milliseconds',async()=>{
  const {buildBusinessReportHtml}=await implementation(),{snapshot,enrichment}=reportFixture(),record=snapshot.records[1];
  const reason='累计7200001毫秒，超过阈值1小时。';record.ai[0]={...record.ai[0],verdict:'不通过',reason};record.final[0]={...record.ai[0]};record.timeFacts={elapsedMs:7200001,thresholdHours:1};record.time={elapsedMs:7200001,thresholdHours:1};
  const html=buildBusinessReportHtml(snapshot,enrichment);assert.ok(html.includes('本地时效：2.0小时'));assert.ok(!html.includes('7200001'));
});
