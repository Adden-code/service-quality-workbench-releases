import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {scenarioConfig,scenarioFieldAnswer} from './scenario-report-fixtures.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
const input=()=>({record:{id:'row1',conversation:'客户：我想换货。\n客服：请去门店。',turns:[{id:1,role:'客户',text:'我想换货。'},{id:2,role:'客服',text:'请去门店。'}]},fields:scenarioConfig().customFields,policies:[{id:'REF',version:'1',title:'参考资料',category:'普通资料',sections:[{id:'x',title:'说明',text:'换货须先核验。'}]}],scenario:{id:'SCENE-AFTERSALES',version:1},source:{name:'合成.xlsx',sha256:'a'.repeat(64),size:10}});
test('scenarioFields independent single-conversation prompt freezes full configuration and validates exact IDs/enums/customer quote turns',async()=>{
 assert.ok(existsSync(new URL('../server/scenario-fields.mjs',import.meta.url)),'scenario field node is required');
 const i=input(),prepared=prepareReportEnrichment('scenarioFields',i),valid=scenarioFieldAnswer(i);assert.equal(prepared.kind,'scenarioFields');assert.ok(prepared.messages[1].content.includes('换货须先核验'));assert.deepEqual(parseReportEnrichment(JSON.stringify(valid),prepared),valid);
 i.fields[0].instruction='changed';assert.notEqual(prepared.input.fields[0].instruction,i.fields[0].instruction);
 for(const change of [r=>r.fields.pop(),r=>r.fields.push({...r.fields[0]}),r=>r.fields[1].value='未知选项',r=>r.fields[2].value='伪造客户的话',r=>{r.fields[2].value='请去门店。';r.fields[2].turnId=2;},r=>r.recordId='other',r=>r.fields[0].extra='hidden',r=>{r.fields[2].value='';r.fields[2].missing=false;r.fields[2].turnId=null;}]){const bad=structuredClone(valid);change(bad);assert.throws(()=>parseReportEnrichment(JSON.stringify(bad),prepared),error=>error.code==='INVALID_OUTPUT');}
 valid.fields[2]={id:'request',value:'',missing:true,turnId:null};assert.equal(parseReportEnrichment(JSON.stringify(valid),prepared).fields[2].missing,true);
});
test('selected consultation analysis excludes disabled fields from prompt/output and still grounds enabled negative voices',()=>{
 const i={record:input().record,taxonomy:[],analysisFields:['demandSummary'],includeVoc:false},p=prepareReportEnrichment('consultationAnalysis',i);
 const result={items:[{id:'row1',demandSummary:'用户提出换货诉求。'}]};assert.deepEqual(parseReportEnrichment(JSON.stringify(result),p),result);assert.ok(!p.messages[0].content.includes('salesStage'));assert.ok(!p.messages[0].content.includes('negativeVoices'));
 result.items[0].sentiment='负向';assert.throws(()=>parseReportEnrichment(JSON.stringify(result),p),error=>error.code==='INVALID_OUTPUT');
});

test('selected intent uses only frozen taxonomy while VOC-only requests retain customer evidence validation',()=>{
 const taxonomy=[{id:'TAX',version:'1',title:'意图分类体系',category:'分类体系',sections:[{id:'return',title:'退换货咨询',text:'客户咨询如何退换货。'}]}],i={record:input().record,taxonomy,analysisFields:['intent'],includeVoc:false},p=prepareReportEnrichment('consultationAnalysis',i),value={items:[{id:'row1',intentLabel:'退换货咨询',intentReferenceId:'TAX@1#return'}]};assert.deepEqual(parseReportEnrichment(JSON.stringify(value),p),value);
 value.items[0].intentReferenceId='TAX@2#return';assert.throws(()=>parseReportEnrichment(JSON.stringify(value),p),error=>error.code==='INVALID_OUTPUT');
 const q=prepareReportEnrichment('consultationAnalysis',{record:input().record,taxonomy:[],analysisFields:[],includeVoc:true}),voc={items:[{id:'row1',sentiment:'负向',negativeVoices:[{turnId:1,quote:'我想换货。'}],voc:{valid:true,scene:'售后/退换货',painPoint:'客户希望换货',reason:'客户明确提出换货诉求',evidenceQuote:'我想换货。'}}]};assert.deepEqual(parseReportEnrichment(JSON.stringify(voc),q),voc);voc.items[0].negativeVoices[0]={turnId:2,quote:'请去门店。'};assert.throws(()=>parseReportEnrichment(JSON.stringify(voc),q),error=>error.code==='INVALID_OUTPUT');
});
