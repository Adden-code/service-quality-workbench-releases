import test from 'node:test';
import assert from 'node:assert/strict';
import {groupEvidenceQuotes,evidenceDisplayText} from '../public/evidence-display.mjs';
import {collectReportTranslationFields,createReportLocale} from '../public/report-locale.mjs';
import {sceneDeliverySheets,buildSceneDeliveryXlsx,buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {triageReportNotice} from '../public/triage-export.mjs';
import {readXlsx} from '../public/io.mjs';
import {sceneReportFixture} from './scene-report-fixtures.mjs';

const record=(comment,reply)=>({raw22:[...Array(8).fill(''),comment,reply,...Array(12).fill('')]});
const quote=(ruleId,value,extra={})=>({ruleId,evidenceQuotes:[{quote:value,...extra}]});
test('same-field exact, contained and overlapping quotes merge with every rule and immutable originals',()=>{
 const source=record('Customer question','abcdefghijk'),results=[quote('R1','abcdef',{turnId:2}),quote('R2','abcdef',{turnId:2}),quote('R3','cde',{turnId:2}),quote('R4','efghij',{turnId:2})],before=structuredClone({source,results});
 const groups=groupEvidenceQuotes(source,results);assert.equal(groups.length,1);assert.equal(groups[0].quote,'abcdefghij');assert.equal(groups[0].label,'回复');assert.deepEqual(groups[0].ruleIds,['R1','R2','R3','R4']);assert.equal(groups[0].evidenceOriginals.length,4);assert.deepEqual([groups[0].start,groups[0].end],[0,10]);assert.deepEqual({source,results},before);
 assert.match(evidenceDisplayText(source,results),/覆盖规则：R1、R2、R3、R4/);
});
test('identical text in different source fields stays separate and ambiguity never invents attribution or location',()=>{
 const source=record('same text','same text'),groups=groupEvidenceQuotes(source,[quote('R1','same text',{turnId:1}),quote('R2','same text',{turnId:2}),quote('R3','same text'),quote('R4','invented'),quote('R5','same text',{blockId:'unknown'})]);
 assert.equal(groups.length,5);assert.deepEqual(groups.slice(0,2).map(group=>group.label),['评价','回复']);for(const group of groups.slice(2)){assert.equal(group.fieldKey,null);assert.equal(group.start,null);assert.equal(group.end,null);assert.equal(group.status,'unverified');assert.equal(group.label,'引文（来源未核实）');}
 const flagged=quote('R6','same text',{turnId:2});flagged.evidenceValidation={status:'unverified'};assert.equal(groupEvidenceQuotes(source,[flagged])[0].fieldKey,null);
});
test('adjacent quotes and repeated occurrences stay distinct; valid UTF-16 offsets identify the occurrence',()=>{
 const source=record('','😀abcabc'),results=[quote('R1','abc',{turnId:1,start:2,end:5}),quote('R2','abc',{turnId:1,start:5,end:8})];
 assert.equal(groupEvidenceQuotes(source,results).length,2);assert.equal(groupEvidenceQuotes(source,[quote('R3','abc',{turnId:1})])[0].status,'unverified');
 assert.equal(groupEvidenceQuotes(source,[{ruleId:'R4',evidence:[1]}])[0].label,'回复');
 const raw=groupEvidenceQuotes({inputMode:'raw-transcript-v1',conversation:'customer label is unverified'},[quote('R5','customer label')])[0];assert.equal(raw.label,'原文（角色未核实）');
});
test('identical unverified quotes deduplicate only within the same declared source and retain every original without inferred locations',()=>{
 const source=record('repeated repeated','repeated repeated'),results=[quote('R1','repeated'),quote('R2','repeated'),quote('R3','repeated',{turnId:1}),quote('R4','repeated',{turnId:1}),quote('R5','repeated',{turnId:2}),quote('R6','repeat')],before=structuredClone(results),groups=groupEvidenceQuotes(source,results);
 assert.equal(groups.length,4);assert.deepEqual(groups.map(group=>group.ruleIds),[['R1','R2'],['R3','R4'],['R5'],['R6']]);assert.equal(groups.reduce((total,group)=>total+group.evidenceOriginals.length,0),6);assert.ok(groups.every(group=>group.status==='unverified'&&group.fieldKey===null&&group.start===null&&group.end===null));assert.deepEqual(results,before);
});

function translatedFixture(){
 const {snapshot,enrichment}=sceneReportFixture('ecommerce',2),record=snapshot.records[0],audit=snapshot.sceneAudit[0];
 record.final[0].reason='未回答用户关于保修的具体问题。';audit.ai[0].reason=record.final[0].reason;audit.review.drafts[record.final[0].id].reason=record.final[0].reason;
 audit.classificationReason='评价包含负向售后体验。';audit.capabilities.outputs.demandSummary={status:'completed',value:{text:'用户咨询保修流程。'},reason:'原评价明确提到保修问题。'};
 enrichment.issueClusters[0].action='补充保修期限和办理步骤。';
 const fields=collectReportTranslationFields(snapshot,enrichment),translations=fields.map((field,index)=>({id:field.id,sourceText:field.text,text:`Synthetic English field ${index}`,status:'translated',detectedLanguage:'zh'}));
 return{snapshot,enrichment,fields,translations};
}
test('configured English workbook plans exact composed summaries, translates sibling columns, retains original audit and source',async()=>{
 const fixture=translatedFixture(),{snapshot,enrichment,fields,translations}=fixture,before=structuredClone({snapshot,enrichment}),sourceSheets=sceneDeliverySheets(snapshot,enrichment),all=sourceSheets.find(sheet=>sheet.name==='全部业务列');
 const summaryIndex=all.headers.findIndex(header=>/不合格|不符合|原因/.test(header)),summary=all.rows[0][summaryIndex];assert.match(summary,/未回答用户/);assert.match(summary,/补充保修/);assert.ok(fields.some(field=>field.text===summary));
 const translated=text=>translations.find(entry=>entry.sourceText===text)?.text;
 const tables=await readXlsx(await buildSceneDeliveryXlsx(snapshot,enrichment,{language:'en',translations}));
 assert.equal(tables['All business columns'][1][summaryIndex],translated(summary));assert.ok(tables['Inspection details'].flat().includes(translated(summary)));
 const audit=tables['Full audit trail'];assert.ok(audit[1].includes(snapshot.sceneAudit[0].ai[0].reason));assert.ok(audit[1].includes(translated(snapshot.sceneAudit[0].ai[0].reason)));assert.ok(audit[1].includes(translated(snapshot.sceneAudit[0].classificationReason)));
 assert.ok(tables['Capability audit'].flat().includes(translated(snapshot.sceneAudit[0].capabilities.outputs.demandSummary.reason)));
 assert.ok(tables['Original data 1'].flat().includes(snapshot.records[0].conversation));assert.deepEqual({snapshot,enrichment},before);assert.ok(!Object.values(tables).flat(2).some(value=>String(value).includes('[Translation missing]')));
});
test('missing, failed and stale English translations show English status and preserve source in audit',async()=>{
 const {snapshot,enrichment,fields}=translatedFixture(),locale=createReportLocale(snapshot,enrichment,{language:'en',translations:[{id:fields[0].id,sourceText:fields[0].text,status:'failed',text:'DO NOT USE'}]});
 assert.equal(locale.display(fields[0].text),'[Untranslated: translation failed]');assert.equal(locale.text(fields[0].id,'updated source'),'[Untranslated: English translation unavailable]');
 const tables=await readXlsx(await buildSceneDeliveryXlsx(snapshot,enrichment,{language:'en'})),all=tables['All business columns'],summary=all[1].find(value=>value.includes('Untranslated: English translation unavailable'));assert.ok(summary);assert.ok(!all.flat().some(value=>value.includes('未回答用户关于保修')));assert.ok(tables['Original AI Audit'].flat().some(value=>value.includes('未回答用户关于保修')));assert.ok(!summary.includes('[Translation missing]'));
});
test('report cases show one merged reply quotation, covered rules and references, while audit quotes remain intact',()=>{
 const {snapshot,enrichment}=sceneReportFixture('ecommerce',1),record=snapshot.records[0],audit=snapshot.sceneAudit[0];record.raw22[9]='abcdefghijk';
 for(const [index,value]of ['abcdef','cde','efghij'].entries()){record.final[index].verdict='不符合';audit.ai[index].evidenceQuotes=[{turnId:2,quote:value}];}
 const before=structuredClone(snapshot),html=buildSceneReportHtml(snapshot,enrichment);assert.match(html,/引文 1 · 回复：abcdefghij/);assert.match(html,/覆盖规则：/);assert.equal((html.match(/回复：abcdefghij/g)||[]).length,1);assert.match(html,/引文 1 \(回复\)/);assert.deepEqual(snapshot,before);
});
test('AI-final report definition explains zero without equating pending work with human confirmation',()=>{
 const snapshot={reviewPolicy:{enabled:false,confidenceThreshold:.9},records:[{routing:{aiFinal:false,needsReview:true}},{routing:{aiFinal:false,resultSource:'human'}}]};
 const zh=triageReportNotice(snapshot),en=triageReportNotice(snapshot,'en');assert.match(zh,/直接采用AI结果形成最终结论/);assert.match(zh,/不能据此认定全部会话已人工确认/);assert.match(zh,/仍有 1 条待人工/);assert.match(en,/does not mean every conversation was human-confirmed/);assert.match(en,/1 conversations still await human review/);
 snapshot.reviewPolicy={version:2,enabled:true,calibrationStatus:'per-rule',rules:[{ruleId:'R1',calibrationId:'SYNTHETIC'}]};const calibrated=triageReportNotice(snapshot);assert.match(calibrated,/本批已有冻结的逐规则标定/);assert.match(calibrated,/部分规则免审不等于整个会话免审/);assert.doesNotMatch(calibrated,/尚未.*标定/);
});
