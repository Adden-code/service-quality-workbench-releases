import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {scenarioRuntimeFixture,scenarioFieldAnswer} from './scenario-report-fixtures.mjs';
import {consultationReportAnswer} from './consultation-runtime-fixture.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {readXlsx} from '../public/io.mjs';
const base='D:/Codex project/outputs/service-scenario-config-20261105/report/jobs';
async function setup(t,{count=2,hook}={}){
 const f=await scenarioRuntimeFixture(count,{analysisFields:[],report:{title:'受控字段报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']}});await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'isolated-'));
 const calls=[],store={read:async()=>({state:structuredClone(f.state),revision:1}),getSource:async()=>({...f.task.source,bytes:f.bytes})},config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'isolated-controlled',authMode:'none',timeoutMs:120000,reasoningEffort:'low',maxTokens:32768},modelConfig={getPrivate:()=>({...config})};
 const client={engine:'isolated-controlled',enrichBusinessReport:async request=>{calls.push(structuredClone({kind:request.kind,input:request.input}));const output=hook?await hook(request,calls):request.kind==='scenarioFields'?scenarioFieldAnswer(request.input):consultationReportAnswer(request.kind,request.input);return parseReportEnrichment(JSON.stringify(output),prepareReportEnrichment(request.kind,request.input));}};
 let service=await createReportJobs({dataDir,store,modelConfig,client,retryDelayMs:1});t.after(async()=>{await service.close();assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return{...f,dataDir,calls,get service(){return service;},async restart(){await service.close();service=await createReportJobs({dataDir,store,modelConfig,client,retryDelayMs:1});}};
}
test('custom field invalid enum retries once and completed cache isolates field configuration and source',async t=>{
 let injected=false;const f=await setup(t,{hook:request=>{if(request.kind!=='scenarioFields')return consultationReportAnswer(request.kind,request.input);const result=scenarioFieldAnswer(request.input);if(!injected){injected=true;result.fields[1].value='不在选项';}return result;}});
 await f.service.create({jobId:'fields-retry',taskId:f.task.id});await f.service.waitForIdle();const first=await f.service.getResult('fields-retry');assert.equal(first.job.status,'completed');assert.equal(f.calls.filter(c=>c.kind==='scenarioFields').length,3);assert.ok(first.job.nodes.filter(n=>n.kind==='scenarioFields').some(n=>n.attempts===2));assert.ok(!f.calls.some(c=>['consultationAnalysis','consultationIssues'].includes(c.kind)));
 const count=f.calls.length,cached=await f.service.create({jobId:'fields-cached',taskId:f.task.id});await f.service.waitForIdle();assert.equal(cached.reused,true);assert.equal((await f.service.getResult(cached.id)).job.status,'completed');assert.equal(f.calls.length,count);
 f.task.scenarioSnapshot.customFields[0].instruction+='额外约束';await f.service.create({jobId:'fields-new-config',taskId:f.task.id});await f.service.waitForIdle();assert.equal(f.calls.filter(c=>c.kind==='scenarioFields').length,5);
 const before=await f.service.getResult('fields-retry');f.state.scenarios[0].enabled=false;f.state.scenarios[0].customFields=[];await f.restart();assert.deepEqual((await f.service.getResult('fields-retry')).snapshot,before.snapshot);
});
test('persistent forged quote records failed fields and retry only restores missing nodes without changing quality',async t=>{
 let fail=true;const f=await setup(t,{count:1,hook:request=>{if(request.kind!=='scenarioFields')return consultationReportAnswer(request.kind,request.input);const result=scenarioFieldAnswer(request.input);if(fail)result.fields[2].value='从未出现的客户引用';return result;}});
 await f.service.create({jobId:'fields-failed',taskId:f.task.id});await f.service.waitForIdle();let result=await f.service.getResult('fields-failed');assert.equal(result.job.status,'completed_with_warnings');assert.equal(result.enrichment.scenarioFields['S-0'].status,'failed');assert.equal(result.snapshot.records[0].finalOverall,'不通过');assert.ok(result.job.nodes.find(n=>n.kind==='scenarioFields').attempts===2);
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment));assert.equal(tables['检核明细'][1][tables['检核明细'][0].indexOf('客户诉求原文')],'AI字段分析失败');
 const translations=f.calls.filter(c=>c.kind==='translation').length;fail=false;await f.service.retry('fields-failed');await f.service.waitForIdle();result=await f.service.getResult('fields-failed');assert.equal(result.job.status,'completed');assert.equal(result.enrichment.scenarioFields['S-0'].status,'completed');assert.equal(f.calls.filter(c=>c.kind==='translation').length,translations);
});
test('custom field checkpoints survive pause/restart and snapshot/plan tampering blocks continuation',async t=>{
 let release,arrived;const waiting=new Promise(resolve=>{arrived=resolve;}),hold=new Promise(resolve=>{release=resolve;});let once=true;
 const f=await setup(t,{hook:async request=>{if(request.kind!=='scenarioFields')return consultationReportAnswer(request.kind,request.input);if(once){once=false;arrived();await hold;}return scenarioFieldAnswer(request.input);}});
 await f.service.create({jobId:'fields-pause',taskId:f.task.id});await waiting;await f.service.pause('fields-pause');release();await f.service.waitForIdle();let result=await f.service.getResult('fields-pause');assert.equal(result.job.status,'paused');assert.equal(result.enrichment.scenarioFields['S-0'].status,'completed');assert.equal(result.enrichment.scenarioFields['S-1'].status,'pending');
 await f.restart();await f.service.resume('fields-pause');await f.service.waitForIdle();result=await f.service.getResult('fields-pause');assert.equal(result.job.status,'completed');assert.equal(f.calls.filter(c=>c.kind==='scenarioFields').length,2);
 await f.service.close();const file=path.join(f.dataDir,'report-jobs','fields-pause','job.json'),job=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(job.planVersion,'consultation-report-plan-v2-scenarios');job.planVersion='consultation-report-plan-v1';job.status='paused';await fs.writeFile(file,JSON.stringify(job));await f.restart();await assert.rejects(f.service.getResult('fields-pause'),/计划版本/);await assert.rejects(f.service.resume('fields-pause'),/计划版本/);
 await f.service.close();job.planVersion='consultation-report-plan-v2-scenarios';await fs.writeFile(file,JSON.stringify(job));const snapshotFile=path.join(f.dataDir,'report-jobs','fields-pause','snapshot.json'),snapshot=JSON.parse(await fs.readFile(snapshotFile,'utf8'));snapshot.scenarioSnapshot.report.title='改写已保存配置';await fs.writeFile(snapshotFile,JSON.stringify(snapshot));await f.restart();await assert.rejects(f.service.getResult('fields-pause'),/指纹/);await assert.rejects(f.service.resume('fields-pause'),/指纹/);
});
