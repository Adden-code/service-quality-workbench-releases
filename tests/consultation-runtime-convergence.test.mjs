import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {consultationRuntimeFixture,consultationReportAnswer} from './consultation-runtime-fixture.mjs';

const record={id:'synthetic-no-taxonomy',conversation:'客户：电池续航很差，希望改善。\n客服：请说明使用情况。',turns:[{id:1,role:'客户',text:'电池续航很差，希望改善。'},{id:2,role:'客服',text:'请说明使用情况。'}]};
const item={id:record.id,salesStage:'售前',salesSubstage:'产品功能咨询',intentLabel:'编造标签',intentReferenceId:'编造资料@1#条款',demandSummary:'希望改善电池续航。',sentiment:'负向',negativeVoices:[{turnId:1,quote:'电池续航很差'}],voc:{valid:true,scene:'产品质量',painPoint:'用户对续航不满。',reason:'客户表达了具体问题。',evidenceQuote:'电池续航很差'}};
const mutations=[
 ['invented reference',value=>{}],
 ['label only',value=>delete value.intentReferenceId],
 ['reference only',value=>delete value.intentLabel],
 ['both omitted',value=>{delete value.intentLabel;delete value.intentReferenceId;}],
 ['object and null',value=>{value.intentLabel={invented:true};value.intentReferenceId=null;}],
 ['array and number',value=>{value.intentLabel=[];value.intentReferenceId=7;}],
 ['oversized intent metadata',value=>{value.intentLabel='x'.repeat(201);value.intentReferenceId='y'.repeat(601);}],
];
const prepared=(input={record,taxonomy:[]})=>prepareReportEnrichment('consultationAnalysis',input);
const parse=(value,input)=>parseReportEnrichment(JSON.stringify(value),prepared(input));

test('absent taxonomy owns both intent slots before closed keys and intent types are checked',async t=>{
 for(const[name,change]of mutations)await t.test(name,()=>{
  const value=structuredClone(item);change(value);const before=structuredClone(value),result=parse({items:[value]});
  assert.deepEqual(result.items,[{...item,intentLabel:'未配置分类体系',intentReferenceId:''}]);assert.deepEqual(value,before,'parsing leaves provider data unchanged');
 });
});

test('absent taxonomy preserves all independent shape, selection, enum and grounded evidence guards',async t=>{
 const invalid=error=>error.code==='INVALID_OUTPUT';
 const changes=[['unknown key',value=>value.extra='unknown'],['wrong id',value=>value.id='unknown'],['stage enum',value=>value.salesStage='其他'],['missing summary',value=>delete value.demandSummary],['sentiment enum',value=>value.sentiment='混合'],['unknown customer turn',value=>value.negativeVoices[0].turnId=99],['agent quote',value=>value.negativeVoices=[{turnId:2,quote:'请说明'}]],['invented quote',value=>value.negativeVoices[0].quote='凭空内容'],['invented VOC quote',value=>value.voc.evidenceQuote='凭空内容'],['VOC enum',value=>value.voc.scene='其他场景']];
 for(const[name,change]of changes)await t.test(name,()=>{const value=structuredClone(item);value.intentLabel=null;value.intentReferenceId={};change(value);assert.throws(()=>parse({items:[value]}),invalid);});
 for(const value of [null,[],1,'text'])assert.throws(()=>parse({items:[value]}),invalid);
 const input={record,taxonomy:[],analysisFields:['demandSummary'],includeVoc:false};
 assert.throws(()=>parse({items:[{id:record.id,demandSummary:'希望改善续航。',intentLabel:null,intentReferenceId:{}}]},input),invalid);
 assert.deepEqual(parse({items:[{id:record.id,demandSummary:'希望改善续航。'}]},input),{items:[{id:record.id,demandSummary:'希望改善续航。'}]});
 const taxonomy=[{id:'TAX',version:'1',title:'分类体系',category:'分类体系',sections:[{id:'a',title:'续航咨询',text:'咨询续航。'}]}];
 for(const[name,change]of mutations)await t.test('configured taxonomy '+name,()=>{const value=structuredClone(item);change(value);assert.throws(()=>parse({items:[value]},{record,taxonomy}),invalid);});
});

test('actual client discards deeply nested known intent slots before any deep clone',async t=>{
 const deep='['.repeat(3000)+'0'+']'.repeat(3000),intentOnly={record,taxonomy:[],analysisFields:['intent'],includeVoc:false},full={record,taxonomy:[]};
 const cases=[['selected label',intentOnly,`{"id":"${record.id}","intentLabel":${deep},"intentReferenceId":null}`],['selected reference',intentOnly,`{"id":"${record.id}","intentLabel":null,"intentReferenceId":${deep}}`],['both selected slots',intentOnly,`{"id":"${record.id}","intentLabel":${deep},"intentReferenceId":${deep}}`],['full analysis',full,JSON.stringify({...item,intentLabel:'DEEP_LABEL',intentReferenceId:null}).replace('"DEEP_LABEL"',deep)]];
 for(const[name,input,wireItem]of cases)await t.test(name,async()=>{
  const before=JSON.stringify(input),content='{"items":['+wireItem+']}',client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))});
  const result=await client.enrichBusinessReport({config:{baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-deep-intent',authMode:'none'},kind:'consultationAnalysis',input});
  assert.deepEqual(result.items,[input===full?{...item,intentLabel:'未配置分类体系',intentReferenceId:''}:{id:record.id,intentLabel:'未配置分类体系',intentReferenceId:''}]);assert.equal(JSON.stringify(input),before);
 });
});

test('actual client rejects other deeply nested invalid fields and configured intent slots with INVALID_OUTPUT',async t=>{
 const deep='['.repeat(3000)+'0'+']'.repeat(3000),full={record,taxonomy:[]},taxonomy=[{id:'TAX',version:'1',title:'分类体系',category:'分类体系',sections:[{id:'a',title:'续航咨询',text:'咨询续航。'}]}],configured={record,taxonomy,analysisFields:['intent'],includeVoc:false},intent={id:record.id,intentLabel:'续航咨询',intentReferenceId:'TAX@1#a'};
 const cases=[['unknown key',full,item,'extra'],['summary type',full,item,'demandSummary'],['negative voice type',full,item,'negativeVoices'],['VOC type',full,item,'voc'],['configured label',configured,intent,'intentLabel'],['configured reference',configured,intent,'intentReferenceId'],['disabled intent',{record,taxonomy:[],analysisFields:['demandSummary'],includeVoc:false},{id:record.id,demandSummary:'希望改善续航。'},'intentLabel']];
 for(const[name,input,value,key]of cases)await t.test(name,async()=>{
  const content=JSON.stringify({items:[{...value,[key]:'DEEP_INVALID_VALUE'}]}).replace('"DEEP_INVALID_VALUE"',deep),client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))});
  await assert.rejects(client.enrichBusinessReport({config:{baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-deep-intent',authMode:'none'},kind:'consultationAnalysis',input}),error=>error.code==='INVALID_OUTPUT');
 });
});

test('49 absent-taxonomy conversations complete through the actual client and asynchronous report job without invented intent',async t=>{
 const data=await consultationRuntimeFixture(49);data.task.basisSnapshot.policies=[];
 const base=path.resolve('D:/Codex project/outputs/service-retest-20261106/task2-test-work');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'no-taxonomy-'));
 const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-no-taxonomy',authMode:'none'},calls=[];
 const client=createArkClient({fetchImpl:async(_url,options)=>{
  const {kind,input}=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push({kind,input:structuredClone(input)});
  const answer=consultationReportAnswer(kind,input);if(kind==='consultationAnalysis'){assert.deepEqual(input.taxonomy,[]);const index=Number(input.record.id.slice(2));mutations[index%mutations.length][1](answer.items[0]);}
  return new Response(JSON.stringify({model:config.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]}));
 }});
 const store={read:async()=>({state:structuredClone(data.state),revision:1}),getSource:async sha=>{assert.equal(sha,data.task.source.sha256);return{...data.task.source,bytes:data.bytes};}};
 let service=await createReportJobs({dataDir:dir,store,modelConfig:{getPrivate:()=>({...config})},client,retryDelayMs:1});
 t.after(async()=>{await service.close();assert.ok(dir.startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const before=structuredClone(data.state);await service.create({jobId:'no-taxonomy-49',taskId:data.task.id});await service.waitForIdle();const result=await service.getResult('no-taxonomy-49');
 assert.equal(result.job.status,'completed');assert.equal(result.enrichment.analysisStats.completed,49);assert.equal(result.enrichment.analysisStats.failed,0);
 const analysisCalls=calls.filter(call=>call.kind==='consultationAnalysis');assert.equal(analysisCalls.length,49);assert.ok(result.job.nodes.filter(unit=>unit.kind==='consultationAnalysis').every(unit=>unit.attempts===1));
 for(const value of Object.values(result.enrichment.consultationAnalysis)){assert.equal(value.status,'completed');assert.equal(value.intentLabel,'未配置分类体系');assert.equal(value.intentReferenceId,'');assert.equal(value.sentiment,'负向');assert.ok(value.negativeVoices[0].quote);}
 assert.deepEqual(data.state,before);const count=calls.length;await service.close();service=await createReportJobs({dataDir:dir,store,modelConfig:{getPrivate:()=>({...config})},client,retryDelayMs:1});
 assert.deepEqual((await service.getResult('no-taxonomy-49')).enrichment,result.enrichment);assert.equal(calls.length,count,'restart reuses only saved validated outputs');
 t.diagnostic(JSON.stringify({syntheticConversations:49,analysisProviderCalls:analysisCalls.length,totalProviderCalls:count,realModelCalls:0}));
});
