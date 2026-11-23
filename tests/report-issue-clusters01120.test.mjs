import test from 'node:test';
import assert from 'node:assert/strict';
import {REPORT_CLUSTER_POLICY,normalizeIssueLabel,buildReportIssueClusters,reportIssueHierarchyHtml,reportClusterView} from '../public/report-issue-clusters.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {prepareConsultationEnrichment,parseConsultationEnrichment} from '../server/consultation-enrichment.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {reportFixture} from './business-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {sceneReportFixture} from './scene-report-fixtures.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {readXlsx} from '../public/io.mjs';

const row=(id,ruleId='EC-TEXT',category)=>({id,sourceRow:Number(id.replace(/\D/g,''))+2,final:[{ruleId,verdict:'不符合',...(category?{category}:{})}]});
const cluster=(label,memberIds,ruleId='EC-TEXT',other={})=>({label,memberIds,ruleId,summary:'合成原因概括',action:'核对合成原文',...other});
const snapshot=records=>({reportClusterPolicy:REPORT_CLUSTER_POLICY,records,basis:{}});

test('01120 exact typography variants and curated same-rule synonyms union real members and retain raw provenance',()=>{
 const s=snapshot(['r1','r2','r3','r4'].map(id=>row(id))),raw=[cluster(' 拼写　错误。',['r1','r2','r1'],'EC-TEXT',{sourceUnitId:'n1'}),cluster('单词拼写错误',['r2','r3'],'EC-TEXT',{summary:'另一个原始概括',sourceUnitId:'n2'}),cluster('拼写错误',['r4'],'EC-TEXT',{action:'另一个原始建议',sourceUnitId:'n3'})],before=structuredClone({s,raw}),view=buildReportIssueClusters(s,raw);
 assert.equal(view.issueClusters.length,1);assert.equal(view.issueClusters[0].label,'拼写错误');assert.deepEqual(view.issueClusters[0].memberIds,['r1','r2','r3','r4']);assert.deepEqual(view.issueClustersRaw,raw);assert.deepEqual(view.issueClusters[0].originalLabels,raw.map(c=>c.label));assert.deepEqual(view.issueClusterAudit.merges[0].sourceIndexes,[0,1,2]);assert.deepEqual(view.issueClusterAudit.merges[0].sourceMemberCounts,[3,2,1]);assert.match(view.issueClusters[0].summary,/另一个原始概括/);assert.match(view.issueClusters[0].action,/另一个原始建议/);assert.equal(view.issueClusterAudit.fuzzyMatching,false);assert.deepEqual({s,raw},before);
 assert.equal(normalizeIssueLabel(' ＡＢＣ：错误！ '),normalizeIssueLabel('abc错误'));
});

test('01120 opposing, different-specificity, numeric and uncurated near labels never fuzzy-merge',()=>{
 const labels=['已回复','未回复','操作步骤缺失','操作步骤顺序错误','回复超时','未回复超时','回复≤24小时','回复≥24小时','回复未回应需求','回复已回应需求','A-B错误','AB错误','超时1.5小时','超时15小时','超时1,5小时','超时1:5小时'];
 const s=snapshot(labels.map((_,i)=>row(`r${i}`))),view=buildReportIssueClusters(s,labels.map((label,i)=>cluster(label,[`r${i}`])));
 assert.equal(view.issueClusters.length,labels.length);
});

test('01120 same labels in distinct rules stay distinct, and invalid or passing members do not inflate counts',()=>{
 const s=snapshot([row('r1','EC-TEXT'),row('r2','EC-TARGET'),{id:'r3',final:[{ruleId:'EC-TEXT',verdict:'通过'}]}]),view=buildReportIssueClusters(s,[cluster('回复不规范',['r1','foreign','r3']),cluster('回复不规范',['r2'],'EC-TARGET')]);
 assert.equal(view.issueClusters.length,2);assert.deepEqual(view.issueClusters.map(c=>c.memberIds),[['r1'],['r2']]);assert.deepEqual(view.issueClusterAudit.excluded[0].memberIds,['foreign','r3']);
});

test('01120 first level is capped at 8 while preserving all five EC dimensions, secondary labels and members',()=>{
 const ec=['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'],custom=Array.from({length:8},(_,i)=>`CUSTOM-${i}`),ids=[...ec,...custom];
 const s=snapshot(ids.map((id,i)=>row(`r${i}`,id)));s.basis.rules=custom.map(id=>({id,title:`冻结检查${id}`,category:`冻结类别${id}`}));
 const raw=ids.map((id,i)=>cluster(`具体原因${i}`,[`r${i}`],id)),view=buildReportIssueClusters(s,raw);
 assert.equal(view.issueClusterHierarchy.length,8);assert.ok(ec.every(id=>view.issueClusterHierarchy.some(p=>p.key===id)));assert.equal(view.issueClusterHierarchy.flatMap(p=>p.clusters).length,13);assert.equal(new Set(view.issueClusterHierarchy.flatMap(p=>p.memberIds)).size,13);assert.ok(view.issueClusterHierarchy.at(-1).originalDimensions.length>1);
 const html=reportIssueHierarchyHtml(s,view);assert.equal((html.match(/data-cluster-primary=/g)||[]).length,8);for(const rawCluster of raw)assert.ok(html.includes(rawCluster.label));assert.match(html,/原检核维度/);
});

test('01120 arbitrary novel labels remain specific under verified categories or explicit unclassified fallback',()=>{
 const s=snapshot([row('r1','CUSTOM-1','业务已冻类别'),row('r2','UNKNOWN')]);s.basis.dimensions=[{key:'业务已冻类别',label:'需求承接'}];
 const view=buildReportIssueClusters(s,[cluster('全新且未收录的具体问题',['r1'],'业务已冻类别',{category:'业务已冻类别'}),cluster('无法从名称猜测类别的问题',['r2'],'UNKNOWN')]);
 assert.equal(view.issueClusterHierarchy.find(p=>p.key==='category:业务已冻类别').label,'需求承接');assert.equal(view.issueClusterHierarchy.find(p=>p.key==='unclassified').label,'其他（归属待核实）');assert.equal(view.issueClusters.length,2);
});

test('01120 EC and consultation prompts provide 3 granularity examples without requiring new model fields',()=>{
 const input={ruleId:'EC-TEXT',records:[{id:'r1',reason:'拼写错误',comment:'合成评价',reply:'合成回复'}]},prepared=prepareReportEnrichment('issueClusters',input),output={clusters:[{label:'拼写错误',summary:'合成原因',memberIds:['r1'],action:'核对文字'}]};
 for(const marker of ['示例1','示例2','示例3','无需增加JSON字段','仅供参考'])assert.ok(prepared.messages[0].content.includes(marker));assert.match(prepared.promptVersion,/granularity-v2/);assert.deepEqual(parseReportEnrichment(JSON.stringify(output),prepared),output);
 const consultation=prepareConsultationEnrichment('consultationIssues',{category:'规范',records:[{id:'r1',reason:'拼写错误',conversation:'合成会话'}]});
 assert.match(consultation.messages[0].content,/示例3/);assert.deepEqual(parseConsultationEnrichment(JSON.stringify(output),consultation),output);
});

test('01120 unmarked old and unknown-version snapshots use legacy rendering and are never upgraded by reading',()=>{
 const {snapshot:s,enrichment}=reportFixture(),before=JSON.stringify({s,enrichment}),old=buildBusinessReportHtml(s,enrichment);
 assert.equal(reportClusterView(s,enrichment),null);assert.equal(reportIssueHierarchyHtml(s,enrichment),'');assert.doesNotMatch(old,/data-cluster-policy/);assert.equal(JSON.stringify({s,enrichment}),before);
 s.reportClusterPolicy='future-unrecognized';assert.equal(reportClusterView(s,enrichment),null);assert.equal(buildBusinessReportHtml(s,enrichment),old);
});

test('01120 v2 hierarchy renders real membership, safely escapes labels and preserves legacy EC report sections',()=>{
 const {snapshot:s,enrichment}=reportFixture();s.reportClusterPolicy=REPORT_CLUSTER_POLICY;enrichment.issueClusters=[cluster('拼写错误',['case-bad']),cluster('单词拼写错误',['case-bad'],'EC-TEXT',{summary:'<script>unsafe</script>'})];const before=JSON.stringify({s,enrichment}),html=buildBusinessReportHtml(s,enrichment);
 assert.match(html,/data-cluster-policy="issue-clusters-v2-0.11.20"/);assert.equal((html.match(/data-cluster-secondary=/g)||[]).length,1);assert.match(html,/成员记录（原表行号 \/ 会话ID）：4/);assert.match(html,/仅供参考/);assert.match(html,/&lt;script&gt;unsafe/);assert.doesNotMatch(html,/<script>unsafe/);assert.equal((html.match(/<section class="report-section"/g)||[]).length,6);assert.equal(JSON.stringify({s,enrichment}),before);
 const english=buildBusinessReportHtml(s,enrichment,{language:'en'});assert.match(english,/Model-assisted clusters are for reference/);assert.match(english,/Source rows \/ IDs: 4/);assert.match(english,/Text quality/);
});

test('01120 consultation raw Fail verdicts and configured scene reports also render the two-level view',()=>{
 const f=consultationReportFixture();f.snapshot.reportClusterPolicy=REPORT_CLUSTER_POLICY;
 for(const options of [{},{language:'en'}]){const html=buildBusinessReportHtml(f.snapshot,f.enrichment,options);assert.match(html,/data-cluster-primary=/);assert.match(html,/3、4/);assert.equal((html.match(/data-cluster-secondary=/g)||[]).length,1);}
 const scene=sceneReportFixture();scene.snapshot.reportClusterPolicy=REPORT_CLUSTER_POLICY;const before=JSON.stringify(scene.snapshot);
 for(const options of [{},{language:'en'}]){const html=buildSceneReportHtml(scene.snapshot,scene.enrichment,options);assert.match(html,/data-cluster-policy=/);assert.match(html,/Top 3/);assert.equal((html.match(/data-cluster-secondary=/g)||[]).length,1);}
 assert.equal(JSON.stringify(scene.snapshot),before);
});

test('01120 merged English causes and Top3 translate each original summary/action before joining',async()=>{
 const translated=new Map([['第一条独立概括','First source summary.'],['第二条独立概括','Second source summary.'],['第一条独立建议','First source action.'],['第二条独立建议','Second source action.']]);
 for(const configured of [false,true]){
  const f=configured?sceneReportFixture('ecommerce',18):reportFixture(),s=f.snapshot;s.reportClusterPolicy=REPORT_CLUSTER_POLICY;
  const members=configured?['SYN-1','SYN-16']:['case-bad','case-bad'],ruleId=configured?'EC-TIME':'EC-TEXT',labels=configured?['回复不及时','回复超时']:['拼写错误','单词拼写错误'];
  const raw=members.map((id,index)=>cluster(labels[index],[id],ruleId,{summary:index?'第二条独立概括':'第一条独立概括',action:index?'第二条独立建议':'第一条独立建议'}));
  // Exercise raw model clusters and the merged result returned by saved jobs.
  for(const assembled of [false,true]){
   const enrichment={...f.enrichment,...(assembled?buildReportIssueClusters(s,raw):{issueClusters:raw})},before=JSON.stringify({s,enrichment}),fields=collectReportTranslationFields(s,enrichment);
   for(const source of translated.keys())assert.ok(fields.some(field=>field.text===source),`Missing original translation field: ${source} (${configured}/${assembled})`);
   const translations=fields.filter(field=>!field.text.includes('；')).map(field=>({id:field.id,sourceText:field.text,status:'translated',text:translated.get(field.text)||`English ${field.id}`}));
   const html=(configured?buildSceneReportHtml:buildBusinessReportHtml)(s,enrichment,{language:'en',translations}),hierarchy=html.slice(html.indexOf('<div class="issue-hierarchy"'),html.indexOf('</div>',html.indexOf('<div class="issue-hierarchy"')));
   for(const value of translated.values())assert.ok(hierarchy.includes(value),`Missing translated original: ${value} (${configured}/${assembled})`);
   assert.doesNotMatch(hierarchy,/\[Translation (?:missing|failed|pending)\]/);assert.match(hierarchy,/Original labels and merge audit/);assert.match(hierarchy,/Source rows \/ IDs:/);assert.equal(JSON.stringify({s,enrichment}),before);
   if(!configured&&assembled){const sheets=await readXlsx(await buildBusinessDeliveryXlsx(s,enrichment,{language:'en',translations})),clusterRows=Object.values(sheets).flatMap(rows=>rows).filter(row=>row[0]==='Issue cluster');for(const value of translated.values())assert.ok(clusterRows.some(row=>String(row[3]).includes(value)),`Missing Excel translated original: ${value}`);}
  }
 }
});
