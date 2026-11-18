import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
const url=new URL('../public/consultation-report.mjs',import.meta.url);
async function implementation(){assert.ok(existsSync(url),'缺少新品咨询HTML交付报告');return import(url);}

test('consultation HTML uses six required sections and dynamic frozen dimensions without excellent cases',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot,enrichment}=consultationReportFixture(),html=buildConsultationReportHtml(snapshot,enrichment);
  for(const id of ['quality-overview','product-quality','dimension-results','typical-cases','issue-clusters','voice-of-customer'])assert.ok(html.includes(`id="${id}"`),id);
  assert.equal((html.match(/class="report-section"/g)||[]).length,6);
  for(const category of ['沟通规范','需求承接','公开合规'])assert.ok(html.includes(category));
  assert.ok(html.includes('原表历史人工结论映射未配置'));assert.ok(html.includes('NA 1条'));assert.ok(html.includes('待判定2条'));assert.ok(html.includes('质量分母 2条'));
  assert.ok(html.includes('任务默认产品'));assert.ok(html.includes('原表列'));assert.ok(html.includes('未提供'));
  assert.ok(!html.includes('优秀案例'));assert.ok(!html.includes('五大检核项'));assert.ok(!html.includes('连续自然小时'));
});
test('consultation HTML dispatch preserves legacy reports while rendering consultation cases as source excerpts',async()=>{
  const {buildBusinessReportHtml}=await import('../public/business-report.mjs'),{snapshot,enrichment}=consultationReportFixture();const original=snapshot.records[0].turns.find(turn=>turn.id===21).text;enrichment.translations['new-bad']['excerpt-21']={status:'same',text:original,detectedLanguage:'en'};const html=buildBusinessReportHtml(snapshot,enrichment);
  assert.ok(html.includes('新品质检报告'));assert.ok(html.includes('原表行 3、4'));
  assert.ok(html.includes('Is &lt;img src=x&gt; compatible'));assert.ok(html.includes('Please contact the store directly.'));
  assert.ok(html.includes('关键原文选摘翻译（英文）'));assert.ok(html.includes('译文缺失（翻译失败）'));assert.ok(html.includes(`<p class="translation" data-translation-status="same"><span class="translation-label">译：</span>${original}</p>`));
  assert.ok(!html.includes('FULL CONVERSATION TRANSLATION'));assert.ok(!html.includes('整会话仅Excel保留'));assert.ok(!html.includes('不会入选的背景问候'));assert.ok(!html.includes('不会入选的结束问候'));
  assert.ok(html.includes('先核对兼容资料，直接回应用户问题。'));assert.ok(!html.includes('999'));
});
test('consultation analysis missingness stays visible and never becomes zero negative voices or zero VOC',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot}=consultationReportFixture(),html=buildConsultationReportHtml(snapshot,{});
  assert.ok(html.includes('会话分析尚未完成5条'));assert.ok(html.includes('VOC范围尚有5条待分析确认'));
  assert.ok(html.includes('改进方向尚未生成'));assert.ok(!html.includes('暂无负面原声'));assert.ok(!html.includes('没有用户痛点'));
  assert.ok(!html.includes('极端超时'));assert.ok(!html.includes('优秀案例'));
});
test('consultation VOC trusts only completed in-scope analysis and counts distinct real record IDs',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot,enrichment}=consultationReportFixture();
  enrichment.consultationAnalysis['new-missing']={status:'pending',sentiment:'负向',voc:{valid:true,scene:'PENDING-NOT-VALID',painPoint:'未完成输出不得采用'}};
  const html=buildConsultationReportHtml(snapshot,enrichment);
  assert.ok(html.includes('负向与中性范围2条'));assert.ok(html.includes('范围外1条'));assert.ok(html.includes('VOC范围尚有2条待分析确认'));
  assert.ok(!html.includes('SCOPE-EXCLUDED'));assert.ok(!html.includes('PENDING-NOT-VALID'));assert.ok(html.includes('未表达具体痛点。'));
  assert.ok(!html.includes('<td>999</td>'));assert.ok(html.includes('compatible with this product?'));
});
test('consultation report escapes source and model text and requires no external resources',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot,enrichment}=consultationReportFixture();
  snapshot.taskName='<script>source</script>';snapshot.records[0].product='<img src=x>';enrichment.issueClusters[0].action='<svg onload=alert(1)>';
  const html=buildConsultationReportHtml(snapshot,enrichment);
  assert.ok(html.includes('&lt;script&gt;source&lt;/script&gt;'));assert.ok(html.includes('&lt;svg onload=alert(1)&gt;'));
  assert.ok(!/<(?:script|link|img|iframe)\b/i.test(html));assert.ok(!/\b(?:src|href)\s*=\s*["']https?:/i.test(html));assert.ok(!/url\s*\(/i.test(html));
});
test('consultation zero denominator displays NA and pending without inventing a rate',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot}=consultationReportFixture();snapshot.metrics={...snapshot.metrics,passed:0,failed:0,na:2,pending:3,determinate:0,passRate:null};
  const html=buildConsultationReportHtml(snapshot,{});
  assert.ok(html.includes('暂无可判定质量结论'));assert.ok(html.includes('NA 2条'));assert.ok(html.includes('待判定3条'));assert.ok(!html.includes('整体通过率100%'));
});

test('consultation case reasons format duration units without changing reference IDs or inventing an extreme-time ranking',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot}=consultationReportFixture();
  snapshot.records[0].final[1].reason='延迟elapsedMs=7200000.0000001；订单9876543210123456789需保留。';
  const html=buildConsultationReportHtml(snapshot,{});
  assert.ok(html.includes('2.0小时'));assert.ok(html.includes('9876543210123456789'));assert.ok(!html.includes('7200000.0000001'));assert.ok(!html.includes('极端超时'));
});

test('consultation metadata separates conversation time from generation date and discloses actual frozen rule/taxonomy/product sources',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot}=consultationReportFixture();
  snapshot.basis.conversationTimeRange={from:'2026-10-31T08:15:00+08:00',to:'2026-11-03T16:00:00+08:00',provided:4,missing:1};
  snapshot.basis.rules[0].version='V2.0';
  snapshot.basis.policies=[{id:'TAX<1>',version:'V3.1',title:'用户意图分类体系',category:'分类体系',sections:[]},{id:'OTHER-POLICY',version:'V9.0',title:'产品参数',category:'产品信息',sections:[]}];
  const html=buildConsultationReportHtml(snapshot,{}),header=html.match(/<header>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header.includes('会话开始时间范围'));assert.ok(header.includes('2026-10-31T08:15:00+08:00 至 2026-11-03T16:00:00+08:00'));assert.ok(header.includes('已提供4条，缺失1条'));
  assert.ok(header.includes('V2.0：1项'));assert.ok(header.includes('业务冻结版：16项'));assert.ok(html.includes('<td>CUSTOM-1</td>'));assert.ok(html.includes('<td>V2.0</td>'));
  assert.ok(header.includes('分类体系依据'));assert.ok(header.includes('TAX&lt;1&gt;@V3.1'));assert.ok(!header.includes('OTHER-POLICY'));
  assert.ok(header.includes('原表列3条 / 任务默认1条 / 未提供1条'));
  assert.ok(html.includes('整体判定原则仍参与整体结论'));assert.ok(html.includes('不会因其他检查项的人工改判自动重算'));
});

test('missing conversation times and classification taxonomy are explicit rather than replaced by generation date',async()=>{
  const {buildConsultationReportHtml}=await implementation(),{snapshot}=consultationReportFixture(),html=buildConsultationReportHtml(snapshot,{}),header=html.match(/<header>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header.includes('会话开始时间范围'));assert.ok(header.includes('未提供（缺失5条）'));assert.ok(header.includes('未配置分类体系'));
  const timeCell=header.match(/<dt>会话开始时间范围<\/dt><dd>(.*?)<\/dd>/)?.[1];assert.ok(timeCell);assert.ok(!timeCell.includes(snapshot.createdAt));
});
