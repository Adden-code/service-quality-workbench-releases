import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {consultationRuntimeFixture,consultationReportAnswer} from './consultation-runtime-fixture.mjs';
import {scenarioConfig,scenarioRuntimeFixture,scenarioFieldAnswer} from './scenario-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {planConsultationReport,consultationInputFor} from '../server/consultation-report-plan.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {consultationRetryFeedback} from '../server/consultation-enrichment.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';

const clone=value=>structuredClone(value);
const base=fileURLToPath(new URL('../../report-contract098/runtime/',import.meta.url));
const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-contract098',authMode:'none',timeoutMs:10000,reasoningEffort:'low',maxTokens:null};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function fullPolicies(){
 return [{id:'TAX',version:'V3',title:'合成测试分类体系',category:'分类体系',scope:'合成场景',owner:'合成维护人',status:'已发布',effectiveAt:'2026-11-01',expiresAt:'',createdAt:'2026-11-01T00:00:00Z',publishedAt:'2026-11-01T00:00:00Z',changeNote:'合成冻结依据',source:'合成来源',content:'原始资料保留',sceneIds:['新品产品咨询'],provenance:{origin:'synthetic-only',revision:7},extraFrozenMetadata:{reviewed:false},sections:[{id:'T1',title:'兼容性咨询',text:'用户希望了解与已有设备的兼容性。',policyId:'TAX',version:'V3',provenance:{row:2},extraFrozenMetadata:'合成扩展条款元数据'}]},
 {id:'REF',version:'V1',title:'合成处理说明',category:'普通参考',sceneIds:['新品产品咨询'],provenance:{origin:'synthetic-only'},sections:[{id:'R1',title:'处理渠道',text:'客服可说明线上或门店处理渠道。',sourcePage:3}]}];
}
const dto=policies=>policies.map(({id,version,title,category,sections})=>({id,version,title,category,sections:sections.map(({id,title,text})=>({id,title,text}))}));
function snapshot({custom=false}={}){
 const {snapshot:s}=consultationReportFixture();s.targetLang='zh';s.records=s.records.slice(0,1);s.basis.policies=fullPolicies();
 for(const record of s.records)record.conversation=record.turns.map(turn=>`${turn.role}：${turn.text}`).join('\n');
 if(custom)s.scenarioSnapshot=scenarioConfig();return freeze(s);
}
function nativeClient(calls,hook){return createArkClient({fetchImpl:async(_url,options)=>{
 const body=JSON.parse(options.body),request=JSON.parse(body.messages[1].content);calls.push(clone(request));
 const answer=hook?hook(request):request.kind==='scenarioFields'?scenarioFieldAnswer(request.input):consultationReportAnswer(request.kind,request.input);
 return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]}));
}});}
async function setup(t,{custom=false,invalidCore=false,hook,maxAttempts=2,count=2}={}){
 const data=custom?await scenarioRuntimeFixture(count,{analysisFields:['salesStage','intent','demandSummary','negativeVoice'],report:{title:'合成契约检查',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','voc']}}):await consultationRuntimeFixture(count);
 data.task.basisSnapshot.policies=fullPolicies();if(invalidCore)data.task.basisSnapshot.policies[0].sections[0].text='';
 await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'isolated-')),calls=[];
 const options={dataDir,store:{read:async()=>({state:clone(data.state),revision:98}),getSource:async()=>({...data.task.source,bytes:data.bytes})},modelConfig:{getPrivate:()=>({...config})},client:nativeClient(calls,hook),maxAttempts,retryDelayMs:1};
 let service=await createReportJobs(options);
 t.after(async()=>{await service.close();assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return {...data,calls,dataDir,get service(){return service;},async restart(){await service.close();service=await createReportJobs(options);}};
}

test('existing taxonomy contract already accepts sceneIds while unrelated full-policy metadata is rejected',()=>{
 const s=snapshot(),input={record:{id:'synthetic-only',turns:[{id:1,role:'客户',text:'请核对兼容性。'}],conversation:'客户：请核对兼容性。'},taxonomy:dto(s.basis.policies)};
 input.taxonomy[0].sceneIds=['新品产品咨询'];assert.doesNotThrow(()=>prepareReportEnrichment('consultationAnalysis',input));
 input.taxonomy[0].provenance={origin:'synthetic-only'};assert.throws(()=>prepareReportEnrichment('consultationAnalysis',input),error=>error.code==='INVALID_INPUT');
});

test('analysis plan projects full frozen policy and section metadata into the model DTO without touching originals',()=>{
 const s=snapshot(),before=clone(s),plan=planConsultationReport(s,'synthetic-model'),unit=plan.units.find(unit=>unit.kind==='consultationAnalysis'),input=consultationInputFor(s,unit,plan);
 assert.deepEqual(input.taxonomy,dto(s.basis.policies));assert.doesNotThrow(()=>prepareReportEnrichment(unit.kind,input));
 input.taxonomy[0].sections[0].text='本地修改';assert.deepEqual(s,before);assert.ok(s.basis.policies[0].provenance);
});

test('custom scenario plan projects all policy references for scenario-fields preparation and retains relevant ordinary references',()=>{
 const s=snapshot({custom:true}),before=clone(s),plan=planConsultationReport(s,'synthetic-model'),unit=plan.units.find(unit=>unit.kind==='scenarioFields'),input=consultationInputFor(s,unit,plan);
 assert.deepEqual(input.policies,dto(s.basis.policies));assert.equal(input.policies[1].category,'普通参考');
 assert.doesNotThrow(()=>prepareReportEnrichment(unit.kind,input));assert.deepEqual(s,before);
});

test('projected full-policy inputs reach the actual Ark preparation boundary with synthetic fetch only',async()=>{
 const s=snapshot({custom:true}),plan=planConsultationReport(s,'synthetic-model'),calls=[],client=nativeClient(calls,request=>{
  if(request.kind==='scenarioFields')return scenarioFieldAnswer(request.input);
  const result=consultationReportAnswer(request.kind,request.input);result.items[0]={id:request.input.record.id,intentLabel:'兼容性咨询',intentReferenceId:'TAX@V3#T1',sentiment:'负向',negativeVoices:[{turnId:21,quote:request.input.record.turns.find(turn=>turn.id===21).text}]};return result;
 });
 for(const unit of plan.units.filter(unit=>['consultationAnalysis','scenarioFields'].includes(unit.kind))){const output=await client.enrichBusinessReport({config,kind:unit.kind,input:consultationInputFor(s,unit,plan)});assert.ok(output);}
 assert.deepEqual(calls.map(call=>call.kind),['consultationAnalysis','scenarioFields']);
 assert.ok(calls.every(call=>!JSON.stringify(call.input).includes('provenance')));
});

for(const custom of [false,true])test(`${custom?'custom scenario':'builtin consultation'} report completes with full frozen policy metadata and preserves all quality verdicts`,async t=>{
 const f=await setup(t,{custom}),before=clone(f.state),jobId=custom?'metadata-scenario':'metadata-builtin';
 await f.service.create({jobId,taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult(jobId);
 assert.equal(result.job.status,'completed');assert.equal(result.enrichment.analysisStats.completed,2);assert.ok(result.job.nodes.every(node=>node.attempts===1));
 assert.deepEqual(result.snapshot.basis.policies,before.tasks[0].basisSnapshot.policies);assert.deepEqual(f.state,before);
 assert.deepEqual(result.snapshot.records[0].final.map(item=>item.verdict),before.sessions[0].aiResults.map(item=>item.verdict==='符合'?'Pass':item.verdict==='不适用'?'NA':'Fail'));
 assert.equal(f.calls.filter(call=>call.kind==='consultationAnalysis').length,2);if(custom)assert.equal(f.calls.filter(call=>call.kind==='scenarioFields').length,2);
 for(const call of f.calls.filter(call=>['consultationAnalysis','scenarioFields'].includes(call.kind)))assert.ok(!JSON.stringify(call.input).includes('extraFrozenMetadata'));
 const calls=f.calls.length;await f.restart();assert.deepEqual((await f.service.getResult(jobId)).snapshot,result.snapshot);assert.equal(f.calls.length,calls);
});

test('malformed core policy data is invalid_input once per requested round, never provider_error or a model request',async t=>{
 const f=await setup(t,{custom:true,invalidCore:true,maxAttempts:3,count:1});
 await f.service.create({jobId:'invalid-core',taskId:f.task.id});await f.service.waitForIdle();const first=await f.service.getResult('invalid-core');
 assert.equal(first.job.status,'completed_with_warnings');const failed=first.job.nodes.filter(node=>node.status==='failed');assert.equal(failed.length,2);
 for(const node of failed){assert.equal(node.errorCode,'invalid_input');assert.equal(node.attempts,1);assert.match(node.error,/输入|配置|冻结/);assert.doesNotMatch(node.error,/模型生成失败/);}
 assert.ok(first.enrichment.warnings.filter(warning=>['consultationAnalysis','scenarioFields'].includes(warning.kind)).every(warning=>warning.code==='invalid_input'));
 assert.ok(f.calls.every(call=>call.kind==='translation'));assert.equal(first.enrichment.analysisStats.failed,1);assert.equal(first.enrichment.consultationAnalysis['S-0'].status,'failed');assert.equal(first.enrichment.scenarioFields['S-0'].status,'failed');
 const successful=first.job.nodes.filter(node=>node.status==='completed'),saved=await Promise.all(successful.map(node=>f.service.getNode('invalid-core',node.id))),count=f.calls.length;
 await f.restart();await f.service.retry('invalid-core');await f.service.waitForIdle();const second=await f.service.getResult('invalid-core');
 assert.equal(second.job.status,'completed_with_warnings');assert.equal(f.calls.length,count);
 for(const node of second.job.nodes.filter(node=>node.status==='failed')){assert.equal(node.errorCode,'invalid_input');assert.equal(node.attempts,2);const detail=await f.service.getNode('invalid-core',node.id);assert.ok(detail.attempts.every(attempt=>attempt.errorCode==='invalid_input'));}
 assert.deepEqual(await Promise.all(successful.map(node=>f.service.getNode('invalid-core',node.id))),saved);assert.deepEqual(second.snapshot,first.snapshot);
});

test('prompt and closed retry guidance state the unconditional invalid-VOC scene rule with a concrete counterexample',()=>{
 const s=snapshot(),plan=planConsultationReport(s,'synthetic-model'),unit=plan.units.find(unit=>unit.kind==='consultationAnalysis'),input=consultationInputFor(s,unit,plan);
 // Use the supported DTO so this independently tests prompt and feedback wording.
 input.taxonomy=dto(s.basis.policies);const prepared=prepareReportEnrichment(unit.kind,input),feedback=consultationRetryFeedback({code:'invalid_voc_scope',path:'items[0].voc'},input);
 for(const content of [prepared.messages[0].content,feedback.guidance]){
  assert.match(content,/无论.*sentiment.*voc\.valid=false.*scene.*其他/);assert.ok(content.includes('{"valid":false,"scene":"售后/退换货"}'));assert.match(content,/反例|禁止示例/);
 }
});

test('invalid=false with a concrete scene remains strict invalid_output and exhausts only the configured output retry budget',async t=>{
 const f=await setup(t,{count:1,maxAttempts:2,hook:request=>{
  const result=consultationReportAnswer(request.kind,request.input);if(request.kind==='consultationAnalysis')Object.assign(result.items[0].voc,{valid:false,scene:'售后/退换货',painPoint:''});return result;
 }});
 await f.service.create({jobId:'invalid-voc-scene',taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('invalid-voc-scene'),node=result.job.nodes.find(node=>node.kind==='consultationAnalysis');
 assert.equal(node.status,'failed');assert.equal(node.errorCode,'invalid_output');assert.equal(node.attempts,2);assert.equal(result.enrichment.vocItems.length,0);assert.equal(result.enrichment.consultationAnalysis['S-0'].status,'failed');
 const attempts=f.calls.filter(call=>call.kind==='consultationAnalysis');assert.equal(attempts.length,2);assert.equal(attempts[1].validationFeedback.code,'invalid_voc_scope');
 assert.deepEqual(attempts[1].input,attempts[0].input);assert.ok(!Object.hasOwn(attempts[0],'validationFeedback'));const detail=await f.service.getNode('invalid-voc-scene',node.id);assert.ok(detail.attempts.every(attempt=>attempt.output.diagnostic.code==='invalid_voc_scope'));
});

test('a model can correct invalid=false concrete scene after feedback without programmatically changing its conclusion',async t=>{
 const f=await setup(t,{count:1,hook:request=>{
  const result=consultationReportAnswer(request.kind,request.input);if(request.kind==='consultationAnalysis')Object.assign(result.items[0].voc,{valid:false,scene:request.validationFeedback?'其他':'售后/退换货',painPoint:''});return result;
 }});
 await f.service.create({jobId:'model-corrects-scene',taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('model-corrects-scene');
 assert.equal(result.job.status,'completed');assert.equal(result.enrichment.consultationAnalysis['S-0'].voc.valid,false);assert.equal(result.enrichment.consultationAnalysis['S-0'].voc.scene,'其他');assert.equal(result.enrichment.consultationAnalysis['S-0'].sentiment,'负向');assert.equal(result.enrichment.consultationAnalysis['S-0'].negativeVoices.length,1);
});

test('projection and feedback do not relax taxonomy references, record IDs, role evidence, scenario enums or output verdict contracts',()=>{
 const s=snapshot(),plan=planConsultationReport(s,'synthetic-model'),unit=plan.units.find(unit=>unit.kind==='consultationAnalysis'),input=consultationInputFor(s,unit,plan);input.taxonomy=dto(s.basis.policies);
 const prepared=prepareReportEnrichment(unit.kind,input),quote=input.record.turns.find(turn=>turn.role==='客户').text;
 const good=()=>({items:[{id:input.record.id,salesStage:'售前',salesSubstage:'兼容咨询',intentLabel:'兼容性咨询',intentReferenceId:'TAX@V3#T1',demandSummary:'用户需要核对兼容性。',sentiment:'负向',negativeVoices:[{turnId:1,quote}],voc:{valid:true,scene:'兼容性与功能',painPoint:'兼容性有疑问。',reason:'原文提出兼容问题。',evidenceQuote:quote}}]});
 assert.doesNotThrow(()=>parseReportEnrichment(JSON.stringify(good()),prepared));
 for(const change of [item=>item.id='foreign',item=>item.intentReferenceId='TAX@V3#missing',item=>item.negativeVoices[0]={turnId:20,quote:input.record.turns.find(turn=>turn.id===20).text},item=>item.voc.evidenceQuote='伪造的客户原文',item=>item.verdict='Pass']){const output=good();change(output.items[0]);assert.throws(()=>parseReportEnrichment(JSON.stringify(output),prepared),error=>error.code==='INVALID_OUTPUT');}
 const custom=snapshot({custom:true}),customPlan=planConsultationReport(custom,'synthetic-model'),fieldUnit=customPlan.units.find(unit=>unit.kind==='scenarioFields'),fieldInput=consultationInputFor(custom,fieldUnit,customPlan);fieldInput.policies=dto(custom.basis.policies);const fieldPrepared=prepareReportEnrichment('scenarioFields',fieldInput);
 for(const change of [value=>value.fields[1].value='未授权枚举',value=>value.recordId='foreign',value=>{value.fields[2].turnId=20;value.fields[2].value=fieldInput.record.turns.find(turn=>turn.id===20).text;}]){const output=scenarioFieldAnswer(fieldInput);change(output);assert.throws(()=>parseReportEnrichment(JSON.stringify(output),fieldPrepared),error=>error.code==='INVALID_OUTPUT');}
});

