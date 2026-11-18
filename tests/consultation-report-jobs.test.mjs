import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {consultationRuntimeFixture,consultationReportAnswer} from './consultation-runtime-fixture.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';

const base='D:/Codex project/outputs/service-consultation-delivery-20261104/jobs-tests';
async function setup(t,{count=3,hook}={}){
 const data=await consultationRuntimeFixture(count);await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/consult-');
 const calls=[],store={read:async()=>({state:structuredClone(data.state),revision:9}),getSource:async sha=>{assert.equal(sha,data.task.source.sha256);return{...data.task.source,bytes:data.bytes};}};
 const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'local-substitute',authMode:'none',timeoutMs:120000,reasoningEffort:'low',maxTokens:null};
 const modelConfig={getPrivate:()=>({...config})},client={engine:'local-substitute',enrichBusinessReport:async request=>{calls.push(structuredClone({kind:request.kind,input:request.input}));return hook?hook(request,calls):consultationReportAnswer(request.kind,request.input);}};
 let service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs:1});
 t.after(async()=>{await service.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return{...data,dir,calls,store,get service(){return service;},async restart(){await service.close();service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs:1});}};
}

test('49 consultation sessions create frozen 28-column Excel and six-section HTML without EC rule IDs',async t=>{
 const f=await setup(t,{count:49}),before=JSON.stringify(f.state);await f.service.create({jobId:'consultation-49',taskId:f.task.id});await f.service.waitForIdle();
 const result=await f.service.getResult('consultation-49');assert.equal(result.job.status,'completed');assert.equal(result.snapshot.deliveryType,'consultation-v1');assert.equal(result.snapshot.records.length,49);
 assert.equal(result.snapshot.basis.rules.length,17);assert.equal(result.snapshot.basis.dimensions.length,3);assert.equal(result.enrichment.analysisStats.completed,49);assert.equal(result.enrichment.vocItems.length,49);
 assert.ok(f.calls.filter(c=>c.kind==='translation').every(c=>c.input.items.length===1));assert.equal(f.calls.filter(c=>c.kind==='consultationAnalysis').length,49);assert.ok(f.calls.filter(c=>c.kind==='consultationAnalysis').every(c=>!Object.hasOwn(c.input,'records')));
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment)),main=tables['检核明细'];assert.equal(main[0].length,29);assert.equal(main.length,50);assert.equal(main[1][0],'0000');assert.equal(main[1][XLSX_ROW_NUMBER],2);
 assert.deepEqual(main[0].slice(3,9),['会话详情翻译（中文）','销售环节（一级/二级）','用户意图','用户诉求总结','是否涉及负面声音','用户负面原声']);assert.equal(main[1][7],'是');
 const html=buildBusinessReportHtml(result.snapshot,result.enrichment);assert.ok(html.includes('新品质检报告'),'Uses the required business report title.');assert.equal((html.match(/<section\b/g)||[]).length,6);assert.ok(!/https?:\/\/|<script|<link\b/.test(html));assert.equal(JSON.stringify(f.state),before);
});

test('analysis invalid output retries automatically; persistent analysis failure remains missing without changing final checks',async t=>{
 let analyses=0;const f=await setup(t,{count:1,hook:request=>{if(request.kind==='consultationAnalysis'&&++analyses===1)throw Object.assign(new Error('one invalid result'),{code:'INVALID_OUTPUT'});return consultationReportAnswer(request.kind,request.input);}});
 await f.service.create({jobId:'analysis-retry',taskId:f.task.id});await f.service.waitForIdle();const done=await f.service.getResult('analysis-retry');assert.equal(done.job.status,'completed');assert.equal(analyses,2);assert.equal(done.enrichment.consultationAnalysis['S-0'].status,'completed');
 const g=await setup(t,{count:1,hook:request=>{if(request.kind==='consultationAnalysis')throw Object.assign(new Error('invalid'),{code:'INVALID_OUTPUT'});return consultationReportAnswer(request.kind,request.input);}});
 await g.service.create({jobId:'analysis-missing',taskId:g.task.id});await g.service.waitForIdle();const partial=await g.service.getResult('analysis-missing');assert.equal(partial.job.status,'completed_with_warnings');assert.equal(partial.enrichment.analysisStats.failed,1);assert.equal(partial.enrichment.consultationAnalysis['S-0'].status,'failed');assert.equal(partial.snapshot.records[0].finalOverall,'不通过');assert.equal(partial.enrichment.vocItems.length,0);
 assert.ok((await buildBusinessDeliveryXlsx(partial.snapshot,partial.enrichment)).byteLength>0);assert.match(buildBusinessReportHtml(partial.snapshot,partial.enrichment),/缺失|失败|未完成/);
});

test('source corruption prevents generation, while completed snapshots survive rule changes and restart without network',async t=>{
 const f=await setup(t,{count:1});await f.service.create({jobId:'immutable-consult',taskId:f.task.id});await f.service.waitForIdle();const before=await f.service.getResult('immutable-consult'),calls=f.calls.length;
 f.state.tasks[0].basisSnapshot.rules[0].title='新的规则名称';await f.restart();const restored=await f.service.getResult('immutable-consult');assert.deepEqual(restored.snapshot,before.snapshot);assert.equal(f.calls.length,calls);
 f.store.getSource=async()=>({...f.task.source,bytes:new Uint8Array([1])});await assert.rejects(f.service.create({jobId:'bad-source',taskId:f.task.id}),/指纹|摘要|不一致/);assert.equal(f.calls.length,calls);
});

test('oversized analysis becomes a bounded failed node instead of pausing the whole report as a storage failure',async t=>{
 const f=await setup(t,{count:1});f.state.sessions[0].turns[0].text='x'.repeat(20001);
 await f.service.create({jobId:'large-consult',taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('large-consult');
 assert.equal(result.job.status,'completed_with_warnings');const node=result.job.nodes.find(n=>n.kind==='consultationAnalysis');assert.equal(node.errorCode,'input_too_large');assert.equal(node.attempts,1);assert.equal(f.calls.filter(c=>c.kind==='consultationAnalysis').length,0);
});

test('consultation plan version is frozen and an unknown saved version is never interpreted as the current plan',async t=>{
 const f=await setup(t,{count:1});await f.service.create({jobId:'version-guard',taskId:f.task.id});await f.service.waitForIdle();await f.service.close();
 const meta=path.join(f.dir,'report-jobs','version-guard','job.json'),job=JSON.parse(await fs.readFile(meta,'utf8'));assert.equal(job.planVersion,'consultation-report-plan-v1');job.planVersion='different-plan';job.status='paused';job.units[0].status='failed';await fs.writeFile(meta,JSON.stringify(job));
 const calls=f.calls.length;await f.restart();await assert.rejects(f.service.getResult('version-guard'),/计划版本/);await assert.rejects(f.service.resume('version-guard'),/计划版本/);await assert.rejects(f.service.retry('version-guard'),/计划版本/);assert.equal((await f.service.get('version-guard')).status,'paused');assert.equal(f.calls.length,calls);
});
