import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
test('reference comparison is per rule, labels missing stay unknown, and detail export separates all three results',async()=>{
  const url=new URL('../public/ecommerce-results.mjs',import.meta.url);assert.ok(existsSync(url),'缺少原人工参考对照');
  const {ecommerceComparison,referenceVerdict}=await import(url);
  for(const invalid of ['constructor','__proto__','toString','unknown'])assert.equal(referenceVerdict(invalid),'');
  const {EC_RULE_IDS}=await import('../public/ecommerce-schema.mjs');
  const s={ecommerce:{raw:[...Array(15).fill(''),'Pass','Fail','','Pass','Fail','Fail','REFERENCE_EXPLANATION']},aiExecution:{status:'completed'},expectedRuleIds:EC_RULE_IDS,
    turns:[{id:1,role:'客户',text:'虚构原文'}],aiResults:EC_RULE_IDS.map(ruleId=>({ruleId,verdict:'符合',reason:'虚构初判',evidence:[1],referenceIds:[]})),review:{status:'待审核',drafts:{},notes:'',reviewer:'虚构人',completedAt:null}};
  let rows=ecommerceComparison(s);assert.equal(rows[0].agreement,'一致');assert.equal(rows[1].agreement,'不一致');assert.equal(rows[2].agreement,'无有效参考');assert.equal(rows[0].finalVerdict,'');
  s.review.drafts['EC-TEXT']={verdict:'不符合'};rows=ecommerceComparison(s);assert.equal(rows[1].finalVerdict,'');s.review.status='已确认';assert.equal(ecommerceComparison(s)[1].finalVerdict,'不符合');
});
test('missing comment dates do not crash exports or management; batch includes them and calendar scope counts exclusions',async()=>{
  const {createEcommerceSample}=await import('../public/ecommerce-sample.mjs'),{parseEcommerceFile}=await import('../public/ecommerce-input.mjs');
  const {createCatalog}=await import('../public/catalog.mjs'),{ensureEcommerceCatalog}=await import('../public/ecommerce-catalog.mjs'),{EC_RULE_IDS}=await import('../public/ecommerce-schema.mjs');
  const {createBasisSnapshot}=await import('../public/task-basis.mjs'),{createInitialState,createImportedTask,scopeState}=await import('../public/domain.mjs'),{exportsView}=await import('../public/views.mjs'),{getManagementReport}=await import('../public/management-report.mjs');
  const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'日期缺失虚构.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}),catalog=ensureEcommerceCatalog(createCatalog());
  const full=createImportedTask(createInitialState(),{name:'日期缺失边界',sessions:parsed.sessions,source:{name:'日期缺失虚构.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256},reviewer:'虚构人',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS})}),state=scopeState(full,'manual');
  assert.doesNotThrow(()=>exportsView(state,{dataMode:'manual',reportPeriod:'month',reportTaskId:state.tasks[0].id,includePending:true}));
  const calendar=getManagementReport(state,{period:'month',referenceDate:'2026-10-30'}),batch=getManagementReport(state,{period:'batch',taskId:state.tasks[0].id,referenceDate:'2026-10-30'});
  assert.equal(calendar.stats.totalSessions,16);assert.equal(calendar.scope.unknownDateCount,2);assert.equal(batch.stats.totalSessions,18);
  const {overviewView}=await import('../public/views.mjs');assert.match(overviewView(state,{dataMode:'manual',period:'month'}),/2条日期缺失/);
});
test('downloaded detail workbook and readable report retain original reference alongside AI and final columns',async()=>{
  const {createEcommerceSample}=await import('../public/ecommerce-sample.mjs'),{parseEcommerceFile}=await import('../public/ecommerce-input.mjs');
  const {createCatalog}=await import('../public/catalog.mjs'),{ensureEcommerceCatalog}=await import('../public/ecommerce-catalog.mjs'),{EC_RULE_IDS}=await import('../public/ecommerce-schema.mjs');
  const {createBasisSnapshot}=await import('../public/task-basis.mjs'),{createInitialState,createImportedTask}=await import('../public/domain.mjs');
  const {buildResultXlsx,readXlsx,buildHtmlReport}=await import('../public/io.mjs');
  const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'工程虚构.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  const catalog=ensureEcommerceCatalog(createCatalog()),state=createImportedTask(createInitialState(),{name:'工程对照',sessions:parsed.sessions.slice(0,1),source:{name:'工程虚构.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256},reviewer:'虚构人',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS})});
  const session=state.sessions.find(s=>s.ecommerce);session.aiExecution={status:'completed'};session.aiResults=EC_RULE_IDS.map(ruleId=>({ruleId,verdict:'不符合',reason:'故意制造工程分歧',evidence:[2],referenceIds:[]}));
  const tables=await readXlsx(await buildResultXlsx(state,{taskId:state.tasks[0].id,includePending:true})),rows=tables['结果明细'],header=rows[0],first=rows[1];
  assert.ok(header.includes('原人工参考结论'));assert.equal(first[header.indexOf('原人工参考结论')],'Pass');assert.equal(first[header.indexOf('原参考与AI对照')],'不一致');assert.equal(first[header.indexOf('人工最终结论')],'');
  const html=buildHtmlReport(state,{taskId:state.tasks[0].id,includePending:true});assert.match(html,/原人工参考结论/);assert.match(html,/工程假答案/);
});
