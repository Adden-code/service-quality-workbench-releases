import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReportJobs} from '../server/report-jobs.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {createBusinessDeliverySnapshot} from '../public/business-delivery.mjs';
import {createConsultationDeliverySnapshot} from '../public/consultation-delivery.mjs';
import {createBusinessExportManager} from '../public/business-export-manager.mjs';
import {loadConsultationOriginal} from '../server/consultation-source.mjs';
import {workbook} from '../public/io.mjs';
import {setLocale} from '../public/i18n.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';
import {consultationRuntimeFixture,consultationReportAnswer} from './consultation-runtime-fixture.mjs';
import {scenarioRuntimeFixture,scenarioFieldAnswer} from './scenario-report-fixtures.mjs';
import {publishedFixture,sourceRow} from './v21-runtime-fixtures.mjs';

const mode='conversation_unverified',tick=()=>new Promise(resolve=>setImmediate(resolve));
const base=path.resolve('..','role-evidence-impl','runtime-tests');
async function roleFixture(count=2){
 const f=await consultationRuntimeFixture(count);f.task.basisSnapshot.policies=[];
 f.task.importMappingSnapshot.profile={sheet:'合成六列',headerRow:1,fields:{id:'会话ID',agent:'客服',role:'发言角色',text:'发言原文',at:'发言时间',startedAt:'会话开始时间'},defaults:{product:'合成设备'}};
 f.state.sessions.forEach((s,index)=>{s.turns=[{id:1,role:'客户',text:'Synthetic product menu'},{id:2,role:'客服',text:`Synthetic connection problem ${index}.`},{id:3,role:'客服',text:'Please share your model.'},{id:4,role:'系统',text:'Synthetic event'}];});
 f.bytes=await workbook([{name:'合成六列',headers:['会话ID','客服','发言角色','发言原文','发言时间','会话开始时间'],rows:f.state.sessions.flatMap(s=>s.turns.map(turn=>[s.externalId,'Synthetic agent',turn.role,turn.text,'2026-11-06T08:00:00Z','2026-11-06T08:00:00Z']))}]);
 f.task.source={name:'synthetic-roles.xlsx',sha256:createHash('sha256').update(f.bytes).digest('hex'),size:f.bytes.length};return f;
}
function reportAnswer(kind,input){
 if(kind!=='consultationAnalysis')return consultationReportAnswer(kind,input);
 const turn=input.record.turns[1];return{items:[{id:input.record.id,salesStage:'售前',salesSubstage:'连接问题',intentLabel:'未配置分类体系',intentReferenceId:'',demandSummary:'会话提出连接问题，发言方待核验。',sentiment:'负向',negativeVoices:[{turnId:'2',quote:turn.text}],voc:{valid:true,scene:'兼容性与功能',painPoint:'设备连接失败。',reason:'会话包含明确连接问题。',evidenceQuote:turn.text}}]};
}
async function setup(t,{count=2,hook,rawSuffix=''}={}){
 const f=await roleFixture(count);await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'roles-')),calls=[];
 const store={read:async()=>({state:structuredClone(f.state),revision:7}),getSource:async()=>({...f.task.source,bytes:f.bytes})},config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-only',authMode:'none',timeoutMs:10000,reasoningEffort:'low',maxTokens:null},modelConfig={getPrivate:()=>({...config})};
 const client={engine:'synthetic-only',enrichBusinessReport:async request=>{calls.push({kind:request.kind,input:structuredClone(request.input)});if(hook)await hook(request,calls);return parseReportEnrichment(JSON.stringify(reportAnswer(request.kind,request.input))+rawSuffix,prepareReportEnrichment(request.kind,request.input));}};
 let service=await createReportJobs({dataDir,store,modelConfig,client,retryDelayMs:1});t.after(async()=>{await service.close();assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return{...f,dataDir,calls,get service(){return service;},async restart(){await service.close();service=await createReportJobs({dataDir,store,modelConfig,client,retryDelayMs:1});}};
}

test('new report modes isolate jobs, frozen fingerprints, planner input and saved role diagnostics',async t=>{
 const f=await setup(t),before=JSON.stringify(f.state);await f.service.create({jobId:'strict-legacy-shape',taskId:f.task.id});await f.service.waitForIdle();const strict=await f.service.getResult('strict-legacy-shape');assert.equal(strict.job.status,'completed_with_warnings');assert.equal(strict.snapshot.roleEvidenceMode,undefined);assert.equal(strict.job.options.roleEvidenceMode,undefined);
 const node=strict.job.nodes.find(n=>n.kind==='consultationAnalysis'),detail=await f.service.getNode(strict.job.id,node.id);assert.equal(detail.output.diagnostic.code,'quote_matches_non_customer_turn');assert.deepEqual(detail.output.diagnostic.matchedTurnIds,[2]);assert.deepEqual(detail.output.diagnostic.roles,['客服']);
 await assert.rejects(f.service.create({jobId:strict.job.id,taskId:f.task.id,roleEvidenceMode:mode}),e=>e.status===409);
 await f.service.create({jobId:'conversation-mode',taskId:f.task.id,roleEvidenceMode:mode});await f.service.waitForIdle();const loose=await f.service.getResult('conversation-mode');assert.equal(loose.job.status,'completed');assert.equal(loose.snapshot.roleEvidenceMode,mode);assert.equal(loose.job.options.roleEvidenceMode,mode);assert.notEqual(loose.job.snapshotFingerprint,strict.job.snapshotFingerprint);assert.equal(loose.enrichment.roleEvidenceMode,mode);assert.equal(loose.enrichment.consultationAnalysis['S-0'].roleEvidenceMode,mode);assert.ok(loose.enrichment.warnings.some(w=>w.code==='conversation_roles_unverified'));
 assert.ok(f.calls.filter(c=>c.kind==='consultationAnalysis'&&c.input.roleEvidenceMode===mode).length===2);assert.deepEqual(loose.snapshot.records.map(r=>r.final),strict.snapshot.records.map(r=>r.final));assert.equal(JSON.stringify(f.state),before);
 const fields=collectReportTranslationFields(loose.snapshot,loose.enrichment);assert.ok(fields.some(field=>field.text==='Synthetic connection problem 0.'));
 const calls=f.calls.length;await f.restart();assert.deepEqual(await f.service.getResult('conversation-mode'),loose);assert.deepEqual(await f.service.getResult('strict-legacy-shape'),strict);assert.equal(f.calls.length,calls);
 await f.service.create({jobId:'strict-legacy-shape',taskId:f.task.id,roleEvidenceMode:'customer_only'});assert.equal(f.calls.length,calls);
});

test('conversation mode checkpoints survive pause/restart and do not relabel old quality results',async t=>{
 let release,arrived,once=true;const waiting=new Promise(resolve=>{arrived=resolve;}),hold=new Promise(resolve=>{release=resolve;});
 const f=await setup(t,{hook:async request=>{if(request.kind==='consultationAnalysis'&&once){once=false;arrived();await hold;}}}),before=JSON.stringify(f.state);
 await f.service.create({jobId:'roles-checkpoint',taskId:f.task.id,roleEvidenceMode:mode});await waiting;await f.service.pause('roles-checkpoint');release();await f.service.waitForIdle();const paused=await f.service.getResult('roles-checkpoint');assert.equal(paused.job.status,'paused');assert.equal(paused.enrichment.consultationAnalysis['S-0'].status,'completed');assert.equal(paused.enrichment.consultationAnalysis['S-1'].status,'pending');
 const beforeCalls=f.calls.length;await f.restart();const restored=await f.service.getResult('roles-checkpoint');assert.deepEqual(restored,paused);assert.equal(f.calls.length,beforeCalls);
 await f.service.resume('roles-checkpoint');await f.service.waitForIdle();const result=await f.service.getResult('roles-checkpoint');assert.equal(result.job.status,'completed');assert.equal(result.job.options.roleEvidenceMode,mode);assert.equal(f.calls.filter(c=>c.kind==='consultationAnalysis').length,2);assert.equal(JSON.stringify(f.state),before);
 await f.service.close();const jobFile=path.join(f.dataDir,'report-jobs',result.job.id,'job.json'),job=JSON.parse(await fs.readFile(jobFile,'utf8'));delete job.options.roleEvidenceMode;await fs.writeFile(jobFile,JSON.stringify(job));await f.restart();await assert.rejects(f.service.getResult(result.job.id),/口径|快照/);
});

test('bounded saved attempts keep safe field diagnostics even when raw output is summarized',async t=>{
 const f=await setup(t,{count:1,rawSuffix:' '.repeat(22000)});await f.service.create({jobId:'bounded-role-diagnostic',taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('bounded-role-diagnostic'),node=result.job.nodes.find(n=>n.kind==='consultationAnalysis'),detail=await f.service.getNode(result.job.id,node.id);
 assert.equal(detail.output.truncated,true);assert.ok(detail.output.diagnostic,'field diagnostic must survive raw trace summarization');assert.equal(detail.output.diagnostic.code,'quote_matches_non_customer_turn');assert.equal(detail.output.diagnostic.path,'items[0].negativeVoices[0].quote');assert.deepEqual(detail.output.diagnostic.matchedTurnIds,[2]);assert.ok(Buffer.byteLength(JSON.stringify(detail.output))<=16384);
});

test('temporary mode safely rejects ecommerce and configured customer-quote fields without changing the customer contract',async()=>{
 const ec=publishedFixture([sourceRow()]).state;assert.throws(()=>createBusinessDeliverySnapshot(ec,{taskId:ec.tasks[0].id,roleEvidenceMode:mode}),/电商|会话/);
 const f=await scenarioRuntimeFixture(1),original=await loadConsultationOriginal({state:f.state,task:f.task,store:{getSource:async()=>({...f.task.source,bytes:f.bytes})}});
 assert.throws(()=>createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,roleEvidenceMode:mode}),/自定义客户原声/);
 const strict=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original});assert.equal(strict.roleEvidenceMode,undefined);assert.equal(strict.scenarioSnapshot.customFields.find(field=>field.type==='quote').id,'request');
 f.task.scenarioSnapshot.customFields=[];const main=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,roleEvidenceMode:mode});assert.equal(main.roleEvidenceMode,mode);assert.equal(main.scene,'SCENE-AFTERSALES');
});

test('non-quote scenario field caches isolate role modes while omitted and explicit strict keep the legacy cache',async t=>{
 const f=await scenarioRuntimeFixture(1,{analysisFields:['demandSummary'],customFields:[{id:'resolution',label:'处理建议',type:'text',instruction:'概括处理建议。',options:[]},{id:'channel',label:'处理渠道',type:'enum',instruction:'选择实际处理渠道。',options:['线上','门店']}],report:{title:'合成缓存隔离',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']}});
 await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'scenario-cache-')),calls=[];let fieldCalls=0;
 const before=JSON.stringify(f.state),config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-cache-only',authMode:'none',timeoutMs:10000,reasoningEffort:'low',maxTokens:null};
 const store={read:async()=>({state:structuredClone(f.state),revision:1}),getSource:async()=>({...f.task.source,bytes:f.bytes})};
 const client={engine:'synthetic-cache-only',enrichBusinessReport:async request=>{
  calls.push({kind:request.kind,input:structuredClone(request.input)});let output;
  if(request.kind==='scenarioFields'){output=scenarioFieldAnswer(request.input);output.fields[0].value=`合成处理建议第${++fieldCalls}次`;}
  else if(request.kind==='consultationAnalysis')output={items:[{id:request.input.record.id,demandSummary:'合成会话诉求总结。'}]};
  else output=consultationReportAnswer(request.kind,request.input);
  return parseReportEnrichment(JSON.stringify(output),prepareReportEnrichment(request.kind,request.input));
 }};
 const service=await createReportJobs({dataDir,store,modelConfig:{getPrivate:()=>({...config})},client,retryDelayMs:1});t.after(async()=>{await service.close();assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const run=async(jobId,roleEvidenceMode)=>{await service.create({jobId,taskId:f.task.id,...(roleEvidenceMode===undefined?{}:{roleEvidenceMode})});await service.waitForIdle();const result=await service.getResult(jobId);assert.equal(result.job.status,'completed');const saved=JSON.parse(await fs.readFile(path.join(dataDir,'report-jobs',jobId,'job.json'),'utf8'));return{result,key:saved.units.find(unit=>unit.kind==='scenarioFields').cacheKey};};
 const strict=await run('scenario-strict-omitted');assert.equal(fieldCalls,1);assert.equal(strict.result.enrichment.scenarioFields['S-0'].fields[0].value,'合成处理建议第1次');
 const temporary=await run('scenario-temporary',mode);assert.equal(calls.filter(call=>call.kind==='consultationAnalysis').length,2);assert.equal(fieldCalls,2,'changing role mode must call scenario field extraction again, not reuse strict cached analysis');assert.notEqual(temporary.key,strict.key);assert.equal(temporary.result.enrichment.scenarioFields['S-0'].fields[0].value,'合成处理建议第2次');
 const explicit=await run('scenario-strict-explicit','customer_only');assert.equal(explicit.key,strict.key);assert.deepEqual(explicit.result.enrichment.scenarioFields,strict.result.enrichment.scenarioFields);assert.equal(fieldCalls,2);
 const again=await run('scenario-temporary-again',mode);assert.equal(again.key,temporary.key);assert.deepEqual(again.result.enrichment.scenarioFields,temporary.result.enrichment.scenarioFields);assert.equal(fieldCalls,2);
 assert.equal(calls.filter(call=>call.kind==='consultationAnalysis').length,4);assert.equal(calls.filter(call=>call.kind==='translation').length,1,'exact original-text translations may share their existing cache');assert.equal(JSON.stringify(f.state),before);
});

test('UI explicitly selects conversation mode, hydrates only matching results and never generates on change or download',async()=>{
 const f=await roleFixture(1),original=await loadConsultationOriginal({state:f.state,task:f.task,store:{getSource:async()=>({...f.task.source,bytes:f.bytes})}}),now='2026-11-06T08:00:00Z';
 const strict=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,now}),loose=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,now,roleEvidenceMode:mode});
 const job=(id,roleEvidenceMode,createdAt)=>({id,taskId:f.task.id,createdAt,updatedAt:createdAt,status:'completed',phase:'ready',resultAvailable:true,options:{targetLang:'zh',conclusionMode:'combined',...(roleEvidenceMode?{roleEvidenceMode}:{})},nodes:[],progress:{},warningsCount:0}),old=job('old-strict',undefined,now),temporary=job('new-unverified',mode,'2026-11-06T09:00:00Z');
 const ui={businessTaskId:f.task.id,businessConclusionMode:'combined',businessTargetLang:'zh',businessReportLanguage:'zh'},requests=[],downloads=[];
 const result=id=>({snapshot:id===old.id?strict:loose,enrichment:{},job:id===old.id?old:temporary});
 const manager=createBusinessExportManager({api:async(url,options={})=>{requests.push({url,options});if(url.includes('?taskId='))return{jobs:[temporary,old]};if(url.endsWith('/result'))return result(url.includes(old.id)?old.id:temporary.id);if(options.method==='POST')return{job:{...temporary,id:options.body.jobId}};throw new Error('Unexpected request '+url);},getState:()=>f.state,getUI:()=>ui,download:(...args)=>downloads.push(args),pollMs:100000,buildConsultationXlsx:async snapshot=>{assert.equal(snapshot.roleEvidenceMode,mode);return new Uint8Array([80,75]);}});
 try{manager.setActive(true);await tick();await tick();let html=manager.view(f.state,ui);assert.match(html,/business-role-evidence-mode/);assert.match(html,/old-strict/);assert.ok(!html.includes('new-unverified'));
  assert.equal(manager.handleChange('business-role-evidence-mode',mode),true);await tick();await tick();html=manager.view(f.state,ui);assert.match(html,/new-unverified/);assert.ok(!html.includes('old-strict'));assert.match(html,/角色未核验/);assert.match(html,/历史参考/);
  await manager.handleAction('business-download-xlsx');await manager.handleAction('business-download-html');assert.equal(downloads.length,2);assert.ok(!requests.some(r=>r.options.method==='POST'));
  await manager.handleAction('business-generate');assert.equal(requests.filter(r=>r.options.method==='POST').length,1);assert.equal(requests.find(r=>r.options.method==='POST').options.body.roleEvidenceMode,mode);
  setLocale('en',{storage:null});html=manager.view(f.state,ui);assert.match(html,/Roles unverified/);assert.match(html,/historical reference/);assert.match(html,/<p>Overview[^<]*conversation concern leads/);
  assert.equal(manager.handleChange('business-role-evidence-mode','guess'),false);
 }finally{setLocale('zh',{storage:null});manager.close();}
});

test('UI rejects a mismatched saved snapshot instead of applying the current mode label',async()=>{
 const f=await roleFixture(1),ui={businessTaskId:f.task.id,businessConclusionMode:'combined',businessTargetLang:'zh',businessReportLanguage:'zh',businessRoleEvidenceMode:mode};
 const original=await loadConsultationOriginal({state:f.state,task:f.task,store:{getSource:async()=>({...f.task.source,bytes:f.bytes})}}),strict=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original}),job={id:'bad-snapshot',taskId:f.task.id,status:'completed',resultAvailable:true,options:{targetLang:'zh',conclusionMode:'combined',roleEvidenceMode:mode}},downloads=[];
 const manager=createBusinessExportManager({api:async url=>url.includes('?taskId=')?{jobs:[job]}:{snapshot:strict,enrichment:{},job},getState:()=>f.state,getUI:()=>ui,download:value=>downloads.push(value),pollMs:100000});
 try{manager.setActive(true);await tick();await tick();assert.match(manager.view(f.state,ui),/不一致/);await manager.handleAction('business-download-html');assert.equal(downloads.length,0);}finally{manager.close();}
});
