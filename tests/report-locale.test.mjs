import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {reportFixture} from './business-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {scenarioConfig} from './scenario-report-fixtures.mjs';
const moduleUrl=new URL('../public/report-locale.mjs',import.meta.url);
async function implementation(){assert.ok(existsSync(moduleUrl),'source-backed report translation collector is missing');return import(moduleUrl);}

test('collector explicitly covers report reasons, header aliases and analysis without private or hidden columns',async()=>{
 const {collectReportTranslationFields}=await implementation(),{snapshot,enrichment}=reportFixture();
 snapshot.records[0].raw22[0]='HIDDEN-SOURCE-CELL';snapshot.private={apiKey:'PRIVATE-KEY'};enrichment.trace={text:'PRIVATE-TRACE'};enrichment.modelConfig={token:'SECRET-TOKEN'};
 const before=JSON.stringify({snapshot,enrichment}),fields=collectReportTranslationFields(snapshot,enrichment),texts=fields.map(field=>field.text);
 assert.equal(fields.length,new Set(fields.map(field=>field.id)).size);assert.ok(fields.every(field=>typeof field.text==='string'&&field.text.trim()));
 for(const text of [snapshot.headers22[0],snapshot.records[1].final[1].reason,snapshot.records[1].summary,enrichment.excellentCases[0].commentary,enrichment.issueClusters[0].action,enrichment.vocItems[1].reason])assert.ok(texts.includes(text),text);
 for(const text of ['PRIVATE-KEY','PRIVATE-TRACE','SECRET-TOKEN','HIDDEN-SOURCE-CELL',snapshot.taskId,'EC-TIME'])assert.ok(!texts.includes(text),text);
 assert.deepEqual(collectReportTranslationFields(snapshot,enrichment),fields);assert.equal(JSON.stringify({snapshot,enrichment}),before);
});

test('verified English original translations are reused from the frozen base without re-sending full text',async()=>{
 const {collectReportTranslationFields,createReportLocale}=await implementation(),{snapshot,enrichment}=consultationReportFixture();
 const source=snapshot.records[0].conversation;snapshot.targetLang='en';enrichment.translations['new-bad'].conversation={status:'translated',text:'Reusable full English conversation'};
 const fields=collectReportTranslationFields(snapshot,enrichment);assert.ok(!fields.some(field=>field.text===source));
 const locale=createReportLocale(snapshot,enrichment,{language:'en'});assert.equal(locale.display(source),'Reusable full English conversation');
 snapshot.targetLang='zh';assert.ok(collectReportTranslationFields(snapshot,enrichment).some(field=>field.text===source));assert.match(createReportLocale(snapshot,enrichment,{language:'en'}).display(source),/Untranslated: English translation unavailable/);
});

test('consultation collector includes selected human labels, analysis and grounded original evidence',async()=>{
 const {collectReportTranslationFields}=await implementation(),{snapshot,enrichment}=consultationReportFixture(),texts=collectReportTranslationFields(snapshot,enrichment).map(field=>field.text);
 for(const text of [snapshot.basis.rules[0].title,snapshot.basis.rules[0].category,snapshot.records[0].product,enrichment.consultationAnalysis['new-bad'].intentLabel,enrichment.consultationAnalysis['new-bad'].negativeVoices[0].quote,enrichment.consultationAnalysis['new-bad'].voc.painPoint])assert.ok(texts.includes(text),text);
 assert.ok(!texts.includes('INTENT-2'));assert.ok(!texts.includes('FULL CONVERSATION TRANSLATION NEVER IN HTML'));
});

test('report locale matches stable IDs AND sourceText, never reuses stale or failed translations',async()=>{
 const {createReportLocale,collectReportTranslationFields}=await implementation(),{snapshot,enrichment}=reportFixture(),fields=collectReportTranslationFields(snapshot,enrichment),field=fields.find(value=>value.text===snapshot.records[1].summary);
 const locale=createReportLocale(snapshot,enrichment,{language:'en',translations:[{id:field.id,sourceText:field.text,text:'Verified English summary',status:'translated'}]});
 assert.equal(locale.text(field.id,field.text),'Verified English summary');assert.match(locale.text(field.id,'changed source'),/Untranslated: English translation unavailable/);
 const failed=createReportLocale(snapshot,enrichment,{language:'en',translations:[{id:field.id,sourceText:field.text,text:'MUST NOT USE',status:'failed'}]});assert.match(failed.text(field.id,field.text),/Untranslated: translation failed/);assert.ok(!failed.text(field.id,field.text).includes('MUST NOT USE'));
 assert.equal(createReportLocale(snapshot,enrichment).text(field.id,field.text),field.text);
});

test('long source identifiers and categories produce bounded unique IDs accepted by the translation service',async()=>{
 const {collectReportTranslationFields}=await implementation(),{snapshot,enrichment}=consultationReportFixture();snapshot.records[0].id='record-'+('标识'.repeat(100));snapshot.basis.dimensions[0].key='很长的分类名称'.repeat(50);
 const fields=collectReportTranslationFields(snapshot,enrichment);assert.ok(fields.every(field=>field.id.length<=200));assert.equal(fields.length,new Set(fields.map(field=>field.id)).size);
});

test('positive and unknown consultation VOC fields are never collected while selected negative voice remains visible',async()=>{
 const {collectReportTranslationFields}=await implementation(),{snapshot,enrichment}=consultationReportFixture();
 for(const [id,sentiment]of[['new-good','正向'],['new-na','待判定']])enrichment.consultationAnalysis[id]={status:'completed',sentiment,negativeVoices:[],voc:{valid:false,scene:`UNUSED-SCENE-${id}`,painPoint:`UNUSED-PAIN-${id}`,reason:`UNUSED-REASON-${id}`,evidenceQuote:'compatible with this product?'}};
 const record=snapshot.records.find(record=>record.id==='new-good');enrichment.consultationAnalysis['new-good'].negativeVoices=[{turnId:19,quote:'compatible with this product?'}];
 let fields=collectReportTranslationFields(snapshot,enrichment);
 assert.ok(!fields.some(field=>/^record\.(?:new-good|new-na)\.analysis\.voc\./.test(field.id)));
 assert.ok(fields.some(field=>field.id==='record.new-good.analysis.negativeVoice.0'&&field.text===enrichment.consultationAnalysis['new-good'].negativeVoices[0].quote));
 snapshot.scenarioSnapshot=scenarioConfig({analysisFields:['intent'],customFields:[],report:{title:'合成报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','voc']}});snapshot.scene=snapshot.scenarioSnapshot.id;
 fields=collectReportTranslationFields(snapshot,enrichment);assert.ok(!fields.some(field=>field.id==='record.new-good.analysis.negativeVoice.0'));assert.ok(fields.some(field=>field.id==='record.new-bad.analysis.negativeVoice.0'));
});

test('Chinese-only, product-code padded, und and forged same base translations stay in the derived collector',async()=>{
 const {collectReportTranslationFields,createReportLocale}=await implementation();
 for(const [source,entry]of[
  ['用户需要中文产品信息。',{status:'translated',text:'这是一份中文内容且不是英文译文。',detectedLanguage:'zh'}],
  ['华为 P70手机已准备好。',{status:'translated',text:'华为 P70手机已准备好。',detectedLanguage:'zh'}],
  ['用户需要中文产品信息。',{status:'translated',text:'用户需要中文产品信息。',detectedLanguage:'und'}],
  ['用户需要中文产品信息。',{status:'translated',text:'The customer needs product information.',detectedLanguage:'und'}],
  ['中文问题',{status:'same',text:'中文问题',detectedLanguage:'en'}],
  ['The customer needs product information.',{status:'same',text:'DIFFERENT SOURCE',detectedLanguage:'en'}],
  ['The customer needs product information.',{status:'same',text:'The customer needs product information.',detectedLanguage:'zh'}],
  ['产品已准备好。',{status:'translated',text:'The Apple phone by Иван is ready.',detectedLanguage:'zh'}],
 ]){
  const {snapshot,enrichment}=reportFixture();snapshot.targetLang='en';snapshot.records[0].raw22[8]=source;enrichment.translations['case-good'].comment=entry;
  assert.ok(collectReportTranslationFields(snapshot,enrichment).some(field=>field.id==='record.case-good.comment'&&field.text===source),JSON.stringify(entry));
  assert.match(createReportLocale(snapshot,enrichment,{language:'en'}).display(source),/Untranslated: English translation unavailable/);
 }
});

test('English base reuse accepts grounded retained brand names, verified exact English and und literals',async()=>{
 const {collectReportTranslationFields,createReportLocale}=await implementation();
 for(const[source,entry]of[
  ['华为 P70屏幕清晰，支持无线充电。',{status:'translated',text:'The 华为 P70 has a clear display and supports wireless charging.',detectedLanguage:'zh'}],
  ['The customer needs product information.',{status:'same',text:'The customer needs product information.',detectedLanguage:'en'}],
  ['12345',{status:'translated',text:'12345',detectedLanguage:'und'}],
 ]){const {snapshot,enrichment}=reportFixture();snapshot.targetLang='en';snapshot.records[0].raw22[8]=source;enrichment.translations['case-good'].comment=entry;assert.ok(!collectReportTranslationFields(snapshot,enrichment).some(field=>field.id==='record.case-good.comment'));assert.equal(createReportLocale(snapshot,enrichment,{language:'en'}).display(source),entry.text);}
});
