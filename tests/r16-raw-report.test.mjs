import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {workbook,readXlsx,XLSX_ROW_NUMBER,buildResultXlsx} from '../public/io.mjs';
import {consultationOriginalFromTables,loadConsultationOriginal} from '../server/consultation-source.mjs';
import {createConsultationDeliverySnapshot,buildConsultationDeliveryXlsx,consultationDeliveryHeaders} from '../public/consultation-delivery.mjs';
import {buildConsultationReportHtml} from '../public/consultation-report.mjs';
import {planConsultationReport,consultationInputFor} from '../server/consultation-report-plan.mjs';
import {prepareConsultationEnrichment,parseConsultationEnrichment} from '../server/consultation-enrichment.mjs';
import {prepareScenarioFields,parseScenarioFields} from '../server/scenario-fields.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export function rawReportFixture(){
 const text='  Customer: لا يعمل 😀\nAgent: A return is guaranteed.\nCustomer: لا يعمل 😀  ',headers=['会话ID','客服','消息详情','产品型号','扩展保留'],values=[' SYN-001 ','Synthetic agent',text,'Synthetic product','  original extension  '];
 const rawTranscript={schemaVersion:1,text,textSha256:sha(text),fileSha256:'a'.repeat(64),sheet:'原文业务',sheetIndex:1,headerRow:2,row:7,columns:{id:1,agent:2,text:3,product:4},headers,raw:values,timePolicy:{mode:'unavailable',timezone:'+08:00'}};
 const rules=[{id:'SYN-QUALITY',title:'合成承诺检查',category:'承诺规范',version:'V1',passCriteria:'承诺有据',failCriteria:'无据承诺'},{id:'SYN-TIME',title:'合成响应时效',category:'响应时效',version:'V1',passCriteria:'在限定时间内响应',failCriteria:'响应超时'}];
 const quote='A return is guaranteed.',start=text.indexOf(quote),result={ruleId:rules[0].id,verdict:'不符合',reason:'合成无条件承诺。',evidence:[],evidenceQuotes:[{quote,matches:[{start,end:start+quote.length}]}],turnRefs:['estimated reply'],referenceIds:[],confidence:0.96,conflictsWith:[],rawValidation:{schemaVersion:1,status:'verified',textSha256:sha(text),reasonCodes:[]}};
 const session={id:'synthetic-row-7',taskId:'synthetic-task',externalId:' SYN-001 ',scene:'新品产品咨询',inputMode:'raw-transcript-v1',rawTranscript,startedAt:'',completeness:'未核验',turns:[],expectedRuleIds:rules.map(r=>r.id),aiExecution:{status:'completed',runId:'synthetic-run'},aiResults:[result,{...result,ruleId:rules[1].id,verdict:'无法判定',reason:'未提供可靠来源时间。',evidenceQuotes:[]}],review:{status:'待审核',drafts:{}}};
 const task={id:session.taskId,name:'Synthetic raw report',mode:'manual',scene:session.scene,inputMode:'raw-transcript-v1',evidenceContractVersion:'raw-text-quote-v1',rawImportOptions:{timePolicy:rawTranscript.timePolicy,productDefault:''},source:{name:'synthetic.xlsx',sha256:rawTranscript.fileSha256,size:512},basisSnapshot:{rules,policies:[],capturedAt:'2026-11-12T00:00:00Z',effectiveDate:'2026-11-12'}};
 const header=[...headers],row=[...values];Object.defineProperty(header,XLSX_ROW_NUMBER,{value:2});Object.defineProperty(row,XLSX_ROW_NUMBER,{value:7});
 return{state:{schemaVersion:1,tasks:[task],sessions:[session],activity:[]},task,session,tables:{原文业务:[header,row]},text,quote};
}
function snapshot(f){const original=consultationOriginalFromTables(f.state,f.task,f.tables);return createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,now:'2026-11-12T02:00:00Z'});}
const analysisInput=f=>({record:{id:f.session.id,inputMode:'raw-transcript-v1',text:f.text},taxonomy:[]});
const analysisOutput=f=>({items:[{id:f.session.id,salesStage:'售后',salesSubstage:'退货咨询',intentLabel:'未配置分类体系',intentReferenceId:'',demandSummary:'会话提出无法使用的诉求，发言方待核验。',sentiment:'负向',negativeVoices:[{quote:'لا يعمل 😀'}],voc:{valid:true,scene:'产品质量',painPoint:'产品无法使用。',reason:'会话原文有具体诉求，角色归属未核验。',evidenceQuote:'لا يعمل 😀'}}]});

test('raw report reads exact archived physical cells and preserves all columns',()=>{
 const f=rawReportFixture(),original=consultationOriginalFromTables(f.state,f.task,f.tables);
 assert.equal(original.messageColumn,2);assert.deepEqual(original.rows[0].values,f.session.rawTranscript.raw);assert.equal(original.rows[0].sourceRow,7);
 const s=snapshot(f);assert.equal(s.inputMode,'raw-transcript-v1');assert.equal(s.records[0].conversation,f.text);assert.deepEqual(s.records[0].turns,[]);assert.equal(s.records[0].ai[0].evidenceQuotes[0].quote,f.quote);assert.equal(s.basis.conversationTimeRange.missing,1);assert.equal(s.basis.qualityEvaluation.status,'not-evaluated');
});
test('raw source and report reject tampered row text, all extension cells and quotation offsets',()=>{
 for(const mutate of [f=>f.tables.原文业务[1][2]+='changed',f=>f.tables.原文业务[1][4]='changed',f=>f.session.rawTranscript.row=8,f=>f.session.rawTranscript.fileSha256='b'.repeat(64),f=>f.session.aiResults[0].evidenceQuotes[0].matches[0].start++]){
  const f=rawReportFixture();mutate(f);assert.throws(()=>snapshot(f),/原文|来源|引文|摘要|归档|physical|source/i);
 }
});
test('raw business Excel uses quotations in trail while main original/dynamic column positions remain stable',async()=>{
 globalThis.JSZip=JSZip;const f=rawReportFixture(),s=snapshot(f),tables=await readXlsx(await buildConsultationDeliveryXlsx(s));
 assert.deepEqual(tables.检核明细[0],consultationDeliveryHeaders(s));assert.deepEqual(tables.检核明细[1].slice(0,5),f.session.rawTranscript.raw);assert.equal(tables.检核明细[1][XLSX_ROW_NUMBER],7);
 const trail=tables.判定留痕;assert.ok(trail[0].includes('证据引文'));assert.ok(!trail[0].includes('证据轮次'));assert.ok(trail.flat().includes(f.quote));assert.ok(tables.口径说明.flat().some(v=>String(v).includes('未进行金标准对照')));
 const english=await readXlsx(await buildConsultationDeliveryXlsx(s,{}, {language:'en'}));assert.ok(english['Judgment Trail'][0].includes('Evidence quotations'));assert.ok(english.Methodology.flat().some(v=>String(v).includes('Not evaluated')));
});
test('raw Chinese and English HTML show exact evidence, missing time and honest evaluation boundary',()=>{
 const f=rawReportFixture(),s=snapshot(f);
 for(const language of ['zh','en']){const html=buildConsultationReportHtml(s,{}, {language});assert.ok(html.includes(f.quote));assert.ok(html.includes(`<mark class="raw-quotation">${f.quote}</mark>`));assert.ok(!html.includes('Turn undefined'));assert.match(html,language==='en'?/Not evaluated|not evaluated/:/未进行金标准对照/);assert.match(html,language==='en'?/timestamps unavailable|reliable source time/i:/未提供可靠来源时间/);assert.match(html,language==='en'?/uncalibrated|not calibrated/i:/未标定/);assert.match(html,language==='en'?/Roles unverified/:/角色未核验/);assert.doesNotMatch(html,/修正源角色|Correct source roles/);}
});
test('raw report plan and auxiliary analysis never require fake turns and exact quotes locate every repeat',()=>{
 const f=rawReportFixture(),s=snapshot(f),plan=planConsultationReport(s,'synthetic-config'),unit=plan.units.find(u=>u.kind==='consultationAnalysis'),input=consultationInputFor(s,unit,plan);
 assert.equal(input.record.inputMode,'raw-transcript-v1');assert.equal(input.record.text,f.text);assert.equal(input.record.turns,undefined);
 const prepared=prepareConsultationEnrichment('consultationAnalysis',analysisInput(f));assert.match(prepared.promptVersion,/raw/);assert.match(prepared.messages[0].content,/角色未核验/);
 assert.doesNotMatch(prepared.messages[0].content,/保留输入原角色|本次用户显式选择/);
 const parsed=parseConsultationEnrichment(JSON.stringify(analysisOutput(f)),prepared);assert.equal(parsed.items[0].negativeVoices[0].matches.length,2);assert.equal(parsed.items[0].speakerAttribution,'unverified');
 const bad=analysisOutput(f);bad.items[0].negativeVoices[0].quote='translated complaint';assert.throws(()=>parseConsultationEnrichment(JSON.stringify(bad),prepared),error=>error.code==='INVALID_OUTPUT');
});
test('raw custom quote fields use original row quotes without attributing a customer or turn',()=>{
 const f=rawReportFixture(),input={record:analysisInput(f).record,fields:[{id:'concern',label:'合成会话诉求',type:'quote',instruction:'提取会话原句，发言方待核验。',options:[]}],policies:[],scenario:{id:'SCENE-Synthetic',version:1},source:f.task.source},p=prepareScenarioFields(input);
 const parsed=parseScenarioFields(JSON.stringify({recordId:f.session.id,fields:[{id:'concern',value:'لا يعمل 😀',missing:false,turnId:null}]}),p);assert.equal(parsed.fields[0].matches.length,2);assert.equal(parsed.fields[0].speakerAttribution,'unverified');
 const bad={recordId:f.session.id,fields:[{id:'concern',value:'made up',missing:false,turnId:null}]};assert.throws(()=>parseScenarioFields(JSON.stringify(bad),p),e=>e.code==='INVALID_OUTPUT');
});
test('ordinary trace export preserves raw full text, quotations and independent advisory turn references',async()=>{
 globalThis.JSZip=JSZip;const f=rawReportFixture(),tables=await readXlsx(await buildResultXlsx(f.state,{taskId:f.task.id,includePending:true}));
 const detail=tables.结果明细,headers=detail[0];assert.ok(headers.includes('证据引文'));assert.equal(detail[1][headers.indexOf('完整会话原文')],f.text);assert.equal(detail[1][headers.indexOf('证据引文')],f.quote);assert.ok(headers.includes('轮次参考（模型估计）'));assert.ok(tables.口径说明.flat().some(value=>String(value).includes('未进行金标准对照')));
});
test('technical execution failure retains program fallback diagnostics without counting AI success',()=>{
 const f=rawReportFixture();f.session.aiExecution.status='failed';for(const result of f.session.aiResults){result.verdict='无法判定';result.evidenceQuotes=[];result.rawValidation.status='program-fallback';result.rawValidation.reasonCodes=['network_exhausted'];}
 const s=snapshot(f);assert.equal(s.records[0].hasAI,false);assert.equal(s.records[0].executionStatus,'failed');assert.equal(s.records[0].ai[0].source,'program_fallback');assert.equal(s.records[0].ai[0].rawValidation.status,'program-fallback');assert.match(buildConsultationReportHtml(s),/技术执行失败/);
});
test('raw archived report retains wide sources and repeated extension headers positionally',async()=>{
 const f=rawReportFixture(),raw=f.session.rawTranscript;raw.headerRow=1;
 while(raw.headers.length<110){raw.headers.push('重复扩展列');raw.raw.push(`  exact extension ${raw.raw.length+1}  `);}
 const bytes=await workbook([{name:raw.sheet,headers:raw.headers,rows:[raw.raw],rowNumbers:[raw.row]}]);f.task.source={name:'synthetic-wide.xlsx',sha256:sha(bytes),size:bytes.length};raw.fileSha256=f.task.source.sha256;
 const original=await loadConsultationOriginal({state:f.state,task:f.task,store:{getSource:async()=>({...f.task.source,bytes})}});assert.equal(original.headers.length,110);assert.deepEqual(original.rows[0].values,raw.raw);const s=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,now:'2026-11-12T02:00:00Z'});const exported=await readXlsx(await buildConsultationDeliveryXlsx(s),{maxColumns:16384});assert.deepEqual(exported.检核明细[1].slice(0,110),raw.raw);
});
test('raw source preserves a nonempty extension cell beyond the final explicit header cell',async()=>{
 const f=rawReportFixture(),raw=f.session.rawTranscript;raw.headerRow=1;raw.headers.push('');raw.raw.push('unlabelled original extension');
 const zip=await JSZip.loadAsync(await workbook([{name:raw.sheet,headers:raw.headers,rows:[raw.raw],rowNumbers:[raw.row]}]));const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');zip.file('xl/worksheets/sheet1.xml',xml.replace(/<c r="F1"[^>]*>[\s\S]*?<\/c>/,''));const bytes=await zip.generateAsync({type:'uint8array'});f.task.source={name:'synthetic-unlabelled.xlsx',sha256:sha(bytes),size:bytes.length};raw.fileSha256=f.task.source.sha256;
 const original=await loadConsultationOriginal({state:f.state,task:f.task,store:{getSource:async()=>({...f.task.source,bytes})}});assert.equal(original.headers[5],'');assert.equal(original.rows[0].values[5],'unlabelled original extension');
});
test('a raw frozen report cannot silently lose its per-record source contract',async()=>{
 const s=snapshot(rawReportFixture());delete s.records[0].rawTranscript;delete s.records[0].inputMode;assert.throws(()=>buildConsultationReportHtml(s),/原文|来源/);await assert.rejects(buildConsultationDeliveryXlsx(s),/原文|来源/);
});
