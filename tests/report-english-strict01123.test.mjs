import test from 'node:test';import assert from 'node:assert/strict';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {buildSceneDeliveryXlsx,buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {readXlsx} from '../public/io.mjs';
import {createReportLocale,collectReportTranslationFields} from '../public/report-locale.mjs';
import {englishDisplayText} from '../public/translation-language.mjs';
import {sceneReportLocale} from '../public/scene-delivery-locale.mjs';
import {freezeTranslationSource} from '../server/translation-source.mjs';
import {englishBusinessExportView} from '../public/report-export-view.mjs';
import {reportFixture,managerState,businessUI,summaryFixture} from './business-report-fixtures.mjs';
import {sceneReportFixture} from './scene-report-fixtures.mjs';
const reason='模型中文理由甲',summary='模型中文摘要乙',commentary='模型中文点评丙',action='模型中文建议丁';
const mainHtml=html=>html.replace(/<details class="original-ai-audit"[\s\S]*?<\/details>/g,'');
const forged=(s,e)=>collectReportTranslationFields(s,e).map(field=>({id:field.id,sourceText:field.text,status:'translated',text:field.text}));
test('English HTML and Excel reject forged translated AI text, show English status and retain originals only in audit/source fields',async()=>{
 const {snapshot,enrichment}=reportFixture();snapshot.records[1].summary=summary;
 for(const group of ['ai','historical','confirmed','final'])for(const r of snapshot.records[1][group]||[])r.reason=reason;
 enrichment.excellentCases[0].commentary=commentary;enrichment.issueClusters[0].action=action;
 const before=JSON.stringify({snapshot,enrichment}),options={language:'en',translations:forged(snapshot,enrichment)};
 const locale=createReportLocale(snapshot,enrichment,options);for(const source of [reason,summary,commentary,action]){assert.match(locale.display(source),/^\[Untranslated:/);assert.ok(englishDisplayText(locale.display(source)));}
 assert.ok(locale.counts.missing>0);const html=buildBusinessReportHtml(snapshot,enrichment,options),tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options));
 for(const source of [reason,summary,commentary,action]){assert.ok(html.includes(source));assert.ok(!mainHtml(html).includes(source));assert.ok(tables['Original AI Audit'].some(row=>row[1]===source));}
 assert.doesNotMatch(html,/<details class="original-ai-audit"[^>]*\bopen\b/);
 assert.ok(tables['Inspection Details'].slice(2).every(row=>!row.at(-1).includes(summary)));
 for(const row of tables['Business Analysis']?.slice(1)||[])assert.ok(![reason,summary,commentary,action].some(text=>row[3]?.includes(text)));
 assert.deepEqual(tables['Inspection Details'][3].slice(0,22),snapshot.records[1].raw22);assert.equal(JSON.stringify({snapshot,enrichment}),before);
});
test('configured consultation reports collect excellent commentary and keep non-English cache text out of primary report cells',async()=>{
 const {snapshot,enrichment}=sceneReportFixture('consultation',5);
 enrichment.excellentCases[0].commentary=commentary;enrichment.issueClusters[0].action=action;
 for(const row of snapshot.sceneAudit)for(const item of row.ai)item.reason=reason;
 for(const row of snapshot.sceneAudit)for(const item of Object.values(row.review.drafts))item.reason=reason;
 for(const row of snapshot.records)for(const item of row.final)item.reason=reason;
 const fields=collectReportTranslationFields(snapshot,enrichment);assert.ok(fields.some(f=>f.text===commentary));
 const frozen=await freezeTranslationSource({source:{kind:'report',jobId:'synthetic-report'},reportJobs:{getResult:async()=>({snapshot,enrichment,job:{status:'completed',sourceRevision:1}})}});assert.ok(frozen.snapshot.fields.some(f=>f.text===commentary));
 const options={language:'en',translations:forged(snapshot,enrichment)},html=buildSceneReportHtml(snapshot,enrichment,options),tables=await readXlsx(await buildSceneDeliveryXlsx(snapshot,enrichment,options));
 for(const source of [reason,commentary,action]){assert.ok(!mainHtml(html).includes(source));assert.ok(tables['Original AI Audit'].some(row=>row[1].includes(source)));}
 assert.ok(tables['All business columns'].every(row=>row.every(value=>![reason,commentary,action].some(source=>String(value).includes(source)))));
});
test('English node errors use English messages and original AI execution records stay closed by default',()=>{
 const state=managerState(),ui={...businessUI(),businessReportLanguage:'en'},job=summaryFixture({status:'completed_with_warnings',nodes:[{id:'n1',status:'failed',error:'模型输出无法解析',attempts:1}]}),model={job,error:'请求失败请重试',notice:'报告已更新',translationError:'翻译失败',nodeDetail:{node:{id:'n1'},attempts:[{output:{reason}}],output:{reason}}};
 const html=englishBusinessExportView(state,ui,model,state.tasks),primary=html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
 for(const text of ['模型输出无法解析','请求失败请重试','报告已更新','翻译失败',reason])assert.ok(!primary.includes(text));
 assert.ok(html.includes('Original AI output'));assert.ok(html.includes(reason));assert.doesNotMatch(html,/<details[^>]*data-disclosure="bd-node-[^>]*\bopen\b/);
});

test('configured AI grouping and unplanned non-Latin text use English status instead of an Original inline fallback',()=>{
 const {snapshot,enrichment}=sceneReportFixture('consultation',5),label='模型中文销售阶段';
 snapshot.executionSnapshot.template.groupBy='salesStage';
 for(const row of snapshot.sceneAudit)row.capabilities.outputs.salesStage.value.label=label;
 const options={language:'en',translations:forged(snapshot,enrichment)},html=buildSceneReportHtml(snapshot,enrichment,options);
 assert.ok(html.includes(label));assert.ok(!mainHtml(html).includes(label));
 assert.match(sceneReportLocale(snapshot,enrichment,options).text('نص النموذج'),/^\[Untranslated:/);
});

test('Latin-script AI reasons and summaries require source-bound English results in HTML and Excel',async()=>{
 const spanishReason='El agente no explica los pasos para resolver el problema.',spanishSummary='El cliente solicita una respuesta y no recibe ayuda.',englishReason='The agent does not explain the steps to resolve the issue.',englishSummary='The customer asks for a response and receives no help.';
 for(const configured of [false,true]){
  const {snapshot,enrichment}=configured?sceneReportFixture('consultation',5):reportFixture();
  for(const record of snapshot.records){record.summary=spanishSummary;for(const phase of ['ai','historical','confirmed','final'])for(const item of record[phase]||[])item.reason=spanishReason;}
  for(const row of snapshot.sceneAudit||[]){for(const item of row.ai)item.reason=spanishReason;for(const item of Object.values(row.review.drafts))item.reason=spanishReason;}
  const before=JSON.stringify({snapshot,enrichment}),render=options=>configured?buildSceneReportHtml(snapshot,enrichment,options):buildBusinessReportHtml(snapshot,enrichment,options),exportXlsx=options=>configured?buildSceneDeliveryXlsx(snapshot,enrichment,options):buildBusinessDeliveryXlsx(snapshot,enrichment,options);
  const missing={language:'en'},locale=createReportLocale(snapshot,enrichment,missing);
  assert.ok(englishDisplayText(spanishReason));assert.match(locale.display(spanishReason),/^\[Untranslated:/);assert.match(locale.display(spanishSummary),/^\[Untranslated:/);
  const untranslated=mainHtml(render(missing)),missingTables=await readXlsx(await exportXlsx(missing));
  for(const source of [spanishReason,spanishSummary]){assert.ok(!untranslated.includes(source));assert.ok(missingTables['Original AI Audit'].flat().some(value=>String(value).includes(source)));}
  const translations=collectReportTranslationFields(snapshot,enrichment).filter(field=>field.text.includes(spanishReason)||field.text===spanishSummary).map(field=>({id:field.id,sourceText:field.text,status:'translated',detectedLanguage:'es',text:field.text===spanishSummary?englishSummary:englishReason}));
  const translated={language:'en',translations},displayed=mainHtml(render(translated)),tables=await readXlsx(await exportXlsx(translated)),main=tables[configured?'All business columns':'Inspection Details'];
  assert.ok(displayed.includes(englishReason));assert.ok(!displayed.includes(spanishReason));assert.ok(main.flat().includes(configured?englishReason:englishSummary));assert.equal(JSON.stringify({snapshot,enrichment}),before);
  const wrongSource=translations.map(entry=>({...entry,sourceText:'different source'}));assert.match(createReportLocale(snapshot,enrichment,{language:'en',translations:wrongSource}).display(spanishReason),/^\[Untranslated:/);
 }
});

test('unknown Latin-script provider errors and notices are not assumed to be English',()=>{
 const state=managerState(),job=summaryFixture({status:'failed',nodes:[{id:'n1',status:'failed',error:'La solicitud del modelo ha fallado.',attempts:1}]}),model={job,error:'La solicitud del modelo ha fallado.',notice:'Le rapport est disponible.',translationError:'La traduction a échoué.'};
 const html=englishBusinessExportView(state,{...businessUI(),businessReportLanguage:'en'},model,state.tasks);
 for(const source of ['La solicitud del modelo ha fallado.','Le rapport est disponible.','La traduction a échoué.'])assert.ok(!html.includes(source));
 assert.match(html,/The operation could not be completed/);
});
