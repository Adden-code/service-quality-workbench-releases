import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {reportFixture} from './business-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {scenarioConfig} from './scenario-report-fixtures.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';

const translateAll=(snapshot,enrichment)=>collectReportTranslationFields(snapshot,enrichment).map(field=>({id:field.id,sourceText:field.text,status:'translated',text:`English ${field.id}`}));

test('explicit English ecommerce output keeps43 columns, source values and sparse physical rows',async()=>{
 const {snapshot,enrichment}=reportFixture(),before=JSON.stringify({snapshot,enrichment});
 const bytes=await buildBusinessDeliveryXlsx(snapshot,enrichment,{language:'en'}),tables=await readXlsx(bytes),main=tables['Inspection Details'];
 assert.ok(main,'English sheet names must be explicit export options');
 assert.equal(main[0].length,43);assert.deepEqual(main[0].slice(0,22),snapshot.headers22);assert.deepEqual(main[1].slice(0,22),snapshot.standards22);
 for(const record of snapshot.records){const row=main.find(row=>row[XLSX_ROW_NUMBER]===record.sourceRow);assert.deepEqual(row.slice(0,22),record.raw22);}
 assert.equal(main[2][24],'Pass');assert.equal(main[3][41],'Fail');assert.equal(main[3][42],snapshot.records[1].summary+' [Untranslated: English translation unavailable]');
 assert.ok(tables['Field Guide']);assert.equal(tables['Field Guide'].length,23);assert.ok(tables.Methodology);
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.deepEqual([...xml.matchAll(/<row r="(\d+)"/g)].map(m=>Number(m[1])),[1,2,3,4,7,9]);
 assert.equal(JSON.stringify({snapshot,enrichment}),before);
});

test('a complete source-bound English map renders human reasons, analysis and Original evidence in both formats',async()=>{
 const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';
 const translations=translateAll(snapshot,enrichment),options={language:'en',translations,translationJob:{id:'derived-EN',targetLang:'en',status:'completed'}},before=JSON.stringify({snapshot,enrichment});
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options)),html=buildBusinessReportHtml(snapshot,enrichment,options);
 const bySource=text=>translations.find(entry=>entry.sourceText===text)?.text;
 for(const text of [snapshot.records[0].final[1].reason,enrichment.consultationAnalysis['new-bad'].intentLabel,enrichment.issueClusters[0].action,enrichment.consultationAnalysis['new-bad'].voc.painPoint]){assert.ok(html.includes(bySource(text)),text);assert.ok(Object.values(tables).some(rows=>rows.flat().some(value=>value.includes(bySource(text)))),text);}
 assert.ok(html.includes('compatible with this product?'));assert.ok(html.includes('English translation'));assert.ok(!/\[Original — Translation|\[Translation missing\]/.test(html));assert.equal(JSON.stringify({snapshot,enrichment}),before);
});

test('custom English report respects selected modules and fields and keeps canonical categories for counts',async()=>{
 const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';snapshot.scenarioSnapshot=scenarioConfig({analysisFields:['intent'],customFields:[],report:{title:'售后服务报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']}});snapshot.scene=snapshot.scenarioSnapshot.id;
 enrichment.issueClusters[0].action='DISABLED-IMPROVEMENT';enrichment.consultationAnalysis['new-bad'].voc.painPoint='DISABLED-VOC';
 const fields=collectReportTranslationFields(snapshot,enrichment),options={language:'en',translations:translateAll(snapshot,enrichment)},html=buildBusinessReportHtml(snapshot,enrichment,options),tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options));
 assert.equal((html.match(/class="report-section"/g)||[]).length,1);assert.ok(!fields.some(field=>['DISABLED-VOC','DISABLED-IMPROVEMENT'].includes(field.text)));
 assert.ok(!html.includes('DISABLED-VOC'));assert.ok(!Object.values(tables).some(rows=>rows.flat().some(value=>value.includes('DISABLED-VOC'))));assert.ok(!Object.values(tables).some(rows=>rows.flat().some(value=>value.includes('DISABLED-IMPROVEMENT'))));
 assert.equal(tables['Inspection Details'][0].length,snapshot.original.headers.length+snapshot.basis.rules.length+4);assert.deepEqual(snapshot.basis.dimensions.map(item=>item.key),['沟通规范','需求承接','公开合规']);
});

test('wrong-language and changed-source report translations fall back explicitly without borrowing base text',async()=>{
 const {snapshot,enrichment}=reportFixture(),translations=translateAll(snapshot,enrichment),html=buildBusinessReportHtml(snapshot,enrichment,{language:'en',translations,translationJob:{targetLang:'zh'}});
 assert.ok(html.includes('Translation missing'));assert.ok(!html.includes(translations[0].text));
 const stale=structuredClone(snapshot);stale.records[1].summary='新的人工理由';const tables=await readXlsx(await buildBusinessDeliveryXlsx(stale,enrichment,{language:'en',translations}));assert.equal(tables['Inspection Details'][3][42],stale.records[1].summary+' [Untranslated: English translation unavailable]');assert.equal(stale.records[1].summary,'新的人工理由');assert.deepEqual(tables['Inspection Details'][3].slice(0,22),stale.records[1].raw22);
});

test('English long text remains complete in an English continuation sheet with intact source columns',async()=>{
 const {snapshot,enrichment}=reportFixture(),translations=translateAll(snapshot,enrichment),field=translations.find(entry=>entry.sourceText===snapshot.records[0].raw22[8]),long='Complete English source-backed translation 🙂 '.repeat(1500);field.text=long;
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,{language:'en',translations})),main=tables['Inspection Details'],ref=main[2][22].match(/TEXT-\d+/)?.[0];
 assert.ok(ref);assert.ok(tables['Long Text']);assert.equal(tables['Long Text'].slice(1).filter(row=>row[0]===ref).map(row=>row[3]).join(''),long);assert.deepEqual(main[2].slice(0,22),snapshot.records[0].raw22);
});

test('retained Original extra worksheets keep rows and values and get separate English header aliases',async()=>{
 const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';snapshot.original.additionalSheets=[{sheetName:'附表',headerRow:4,headers:['辅助业务字段'],rows:[{sourceRow:7,values:['ORIGINAL-UNTRANSLATED-CELL']}]}];
 const options={language:'en',translations:translateAll(snapshot,enrichment)},tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options)),extra=tables['Original_附表'];
 assert.deepEqual(extra[0],['辅助业务字段']);assert.deepEqual(extra[1],['ORIGINAL-UNTRANSLATED-CELL']);assert.equal(extra[1][XLSX_ROW_NUMBER],7);assert.ok(tables['Field Guide'].some(row=>row[1]==='辅助业务字段'&&row[2].startsWith('English ')));
});

test('Original evidence containing the English translation display delimiter remains complete and separate',()=>{
 const {snapshot,enrichment}=reportFixture(),original='First Original line\nEnglish translation: quoted text inside the customer message';snapshot.records[1].raw22[8]=original;
 const translations=translateAll(snapshot,enrichment),entry=translations.find(entry=>entry.sourceText===original);entry.text='Complete translated customer message.';
 const html=buildBusinessReportHtml(snapshot,enrichment,{language:'en',translations});
 assert.ok(html.includes(`<p class="original">${original}</p><h4>English translation</h4><p class="translation"><span class="translation-label">Translation: </span>Complete translated customer message.</p>`));
});

test('legacy Chinese-only base cache is retranslated or marked missing in both English files',async()=>{
 const {snapshot,enrichment}=reportFixture();snapshot.targetLang='en';const source=snapshot.records[0].raw22[8],bad='这是一份中文内容且不是英文译文。';
 const accepted={id:'legacy',translation:bad,isTargetLanguage:false,detectedLanguage:'zh'};
 assert.throws(()=>parseReportEnrichment(JSON.stringify({items:[accepted]}),prepareReportEnrichment('translation',{targetLang:'en',items:[{id:'legacy',text:source}]})),error=>error.code==='INVALID_OUTPUT');
 enrichment.translations['case-good'].comment={status:'translated',text:accepted.translation,detectedLanguage:accepted.detectedLanguage};
 const translations=translateAll(snapshot,enrichment).filter(entry=>entry.id!=='record.case-good.comment'),options={language:'en',translations},tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options)),html=buildBusinessReportHtml(snapshot,enrichment,options);
 assert.equal(tables['Inspection Details'][2][22],snapshot.records[0].raw22[8]+' [Untranslated: English translation unavailable]');assert.ok(!tables['Inspection Details'][2][22].includes(bad));assert.ok(html.includes(' [Untranslated: English translation unavailable]</p>'));assert.ok(!html.includes(`<p class="translation"><span class="translation-label">Translation: </span>${bad}</p>`));assert.ok(!html.includes('0 failed; 0 pending; 0 missing'));
 const field=collectReportTranslationFields(snapshot,enrichment).find(field=>field.id==='record.case-good.comment');options.translations.push({id:field.id,sourceText:field.text,status:'translated',text:'Derived English customer review.'});const fixed=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options));assert.equal(fixed['Inspection Details'][2][22],'Derived English customer review.');
});

test('English HTML exposes English templates, all missing translations and numeric facts independently of modules',()=>{
 const {snapshot,enrichment}=reportFixture(),html=buildBusinessReportHtml(snapshot,enrichment,{language:'en'});
 assert.match(html,/<html lang="en">/);assert.match(html,/Overall quality/);assert.match(html,/50%/);assert.match(html,/Translation missing/);assert.match(html,/Original/);assert.ok(!html.includes('不得直接使用同语种文本字段'));
 assert.ok(!/<(?:script|iframe)\b/.test(html));
});

test('English consultation output preserves dynamic N+R columns, repeated rows and NA semantics',async()=>{
 const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';const before=JSON.stringify(snapshot);
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,{language:'en'})),main=tables['Inspection Details'];
 assert.ok(main);assert.equal(main[0].length,snapshot.original.headers.length+snapshot.basis.rules.length+8);assert.deepEqual(main[0].slice(0,3),snapshot.original.headers);
 for(const source of snapshot.original.rows){const row=main.find(row=>row[XLSX_ROW_NUMBER]===source.sourceRow);assert.deepEqual(row.slice(0,3),source.values);}
 assert.ok(main.some(row=>row.at(-2)==='NA'));assert.ok(main.some(row=>row.at(-2)==='Pending'));
 const html=buildBusinessReportHtml(snapshot,enrichment,{language:'en'});assert.match(html,/Not applicable/);assert.match(html,/VOC/);assert.match(html,/Original/);assert.ok(!html.includes('FULL CONVERSATION TRANSLATION NEVER IN HTML'));
 assert.equal(JSON.stringify(snapshot),before);
});
