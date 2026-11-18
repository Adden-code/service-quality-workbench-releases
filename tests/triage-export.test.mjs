import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {publishedFixture,sourceRow,cutoff} from './v21-runtime-fixtures.mjs';
import {deriveAIDecision,DEFAULT_REVIEW_POLICY} from '../public/ai-triage.mjs';
import {createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx,businessDeliveryHeaders} from '../public/business-delivery.mjs';
import {createConsultationDeliverySnapshot,buildConsultationDeliveryXlsx,consultationDeliveryHeaders} from '../public/consultation-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {buildConsultationReportHtml} from '../public/consultation-report.mjs';
import {readXlsx,buildResultXlsx,buildHtmlReport} from '../public/io.mjs';
import {getManagementReport,buildManagementHtml} from '../public/management-report.mjs';
import {exportSessions,overviewView,exportsView,taskTable} from '../public/views.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';

const now='2026-11-11T11:00:00+08:00',clone=structuredClone;
function enable(state,statuses=['PASS']){
  for(const task of state.tasks)task.reviewPolicy=clone(DEFAULT_REVIEW_POLICY);
  state.sessions.forEach((session,index)=>{
    const task=state.tasks.find(task=>task.id===session.taskId),requested=statuses[index]||'PASS',turn=session.turns[0];session.reviewPolicy=clone(DEFAULT_REVIEW_POLICY);
    session.aiExecution={status:'completed',runId:`triage-run-${index}`,modelId:'synthetic'};
    session.aiResults=task.basisSnapshot.rules.map((rule,position)=>({ruleId:rule.id,verdict:requested==='FAIL'&&position===Math.min(1,task.basisSnapshot.rules.length-1)?'不符合':'符合',reason:'逐字核对合成原文与冻结依据。',evidence:[turn.id],referenceIds:[...(rule.policyIds||[])],confidence:requested==='UNCERTAIN'?0.5:0.99,conflictsWith:[],evidenceQuotes:[{turnId:turn.id,role:turn.role,quote:turn.text}]}));
    session.aiDecision=deriveAIDecision(session,task.reviewPolicy,{at:now,basis:task.basisSnapshot});
    if(requested==='RETURNED')session.review.returned={at:now,reviewer:'Synthetic',reason:'合成退回审计',runId:session.aiExecution.runId,scope:'session'};
    if(requested==='HUMAN'){session.review.status='已确认';session.review.completedAt=now;session.review.drafts=Object.fromEntries(session.aiResults.map(item=>[item.ruleId,{...clone(item),verdict:'不符合',reason:'本轮人工确认的问题。',source:'人工修改'}]));}
  });return state;
}
function ecommerce(statuses=['PASS']){const {state}=publishedFixture(statuses.map((_,index)=>sourceRow({row:index+3})));state.tasks[0].aiRun={id:'triage-run-0',inspectionAt:cutoff};return enable(state,statuses);}
function consultation(statuses=['PASS']){
  const rule={id:'C-1',name:'合成检查',title:'合成检查',category:'服务规范',version:'V1',passCriteria:'有依据',failCriteria:'缺少依据',exceptionCriteria:'不适用',policyIds:[]};
  const sessions=statuses.map((_,index)=>({id:`s-${index}`,externalId:`raw-${index}`,taskId:'task-c',scene:'新品产品咨询',startedAt:now,topic:'合成咨询',agent:'合成客服',customer:'合成客户',channel:'合成渠道',product:'合成产品',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:`合成问题${index}`},{id:2,role:'客服',text:'我先核对正式资料。'}],expectedRuleIds:['C-1'],aiResults:[],review:{status:'待审核',reviewer:'Synthetic reviewer',drafts:{},notes:'',history:[],completedAt:null}}));
  const task={id:'task-c',name:'合成分级审核',mode:'manual',status:'待审核',progress:0,createdAt:now,scene:'新品产品咨询',sessionIds:sessions.map(session=>session.id),source:{name:'synthetic.xlsx',size:123,sha256:'a'.repeat(64)},basisSnapshot:{capturedAt:now,effectiveDate:'2026-11-11',rules:[rule],policies:[]}};
  const original={sheetName:'Synthetic source',headerRow:1,headers:['记录号','消息详情'],messageColumn:1,rows:sessions.map((session,index)=>({sourceRow:index+2,values:[session.externalId,session.turns.map(turn=>turn.text).join('\n')],recordId:session.id})),productSources:Object.fromEntries(sessions.map(session=>[session.id,{value:'合成产品',source:'任务默认'}]))};
  return{state:enable({schemaVersion:1,tasks:[task],sessions,activity:[]},statuses),original};
}
const ecSnapshot=(state,options={})=>createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now,...options});
const cSnapshot=(fixture,options={})=>createConsultationDeliverySnapshot(fixture.state,{taskId:'task-c',original:fixture.original,now,...options});

test('combined ecommerce final admits proved AI PASS and current human confirmation while routing other AI results to pending',()=>{
  const state=ecommerce(['PASS','FAIL','UNCERTAIN','RETURNED','HUMAN']),snapshot=ecSnapshot(state);
  assert.deepEqual(snapshot.records.map(record=>record.finalOverall),['通过','待判定','待判定','待判定','不通过']);assert.deepEqual(snapshot.records.map(record=>record.routing.resultSource),['ai',null,null,null,'human']);
  assert.ok(snapshot.records[0].final.every(item=>item.source==='ai_final'));assert.ok(snapshot.records[1].final.every(item=>item.source==='pending_human'));assert.ok(snapshot.records[4].final.every(item=>item.source==='confirmed'));
  assert.equal(snapshot.metrics.determinate,2);assert.equal(snapshot.metrics.passRate,50);assert.equal(snapshot.metrics.aiFinalCount,1);assert.equal(snapshot.metrics.humanConfirmedCount,1);assert.equal(snapshot.metrics.pendingHumanCount,3);assert.equal(state.sessions[0].review.status,'待审核');
});

test('new policy retains historical ecommerce answers as reference without using them as current human confirmation',()=>{
  const state=ecommerce(['FAIL']);for(let index=15;index<=20;index++)state.sessions[0].ecommerce.raw[index]='Pass';
  const snapshot=ecSnapshot(state);assert.equal(snapshot.records[0].finalOverall,'待判定');assert.equal(snapshot.records[0].historicalOverall,'通过');assert.equal(snapshot.records[0].routing.needsReview,true);assert.equal(snapshot.metrics.determinate,0);
});

test('consultation combined conclusions and dynamic metrics use the same routing as ecommerce',()=>{
  const f=consultation(['PASS','FAIL','UNCERTAIN','RETURNED','HUMAN']),snapshot=cSnapshot(f);
  assert.deepEqual(snapshot.records.map(record=>record.finalOverall),['通过','待判定','待判定','待判定','不通过']);assert.equal(snapshot.metrics.determinate,2);assert.equal(snapshot.metrics.ruleStats[0].final.denominator,2);assert.equal(snapshot.metrics.dimensionStats[0].final.denominator,2);
  assert.equal(snapshot.reviewPolicy.confidenceThreshold,0.9);assert.equal(snapshot.records[3].routing.returnAudit.current.reason,'合成退回审计');const frozen=JSON.stringify(snapshot);f.state.sessions[0].aiDecision.status='FAIL';f.state.tasks[0].reviewPolicy.confidenceThreshold=0;assert.equal(JSON.stringify(snapshot),frozen);
});

test('AI-only exports preserve initial judgments but identify the scope as non-final performance data',()=>{
  const ec=ecSnapshot(ecommerce(['FAIL']),{conclusionMode:'ai'}),consult=cSnapshot(consultation(['FAIL']),{conclusionMode:'ai'});
  for(const snapshot of [ec,consult]){assert.equal(snapshot.records[0].finalOverall,'不通过');assert.equal(snapshot.resultScope,'initial');assert.match(snapshot.basis.finalPolicy,/初判.*非.*最终|初判.*不.*绩效/);assert.equal(snapshot.records[0].routing.resultSource,null);}
});

test('a forged PASS with invalid evidence cannot become an AI final through the export route',()=>{
  const f=consultation();f.state.sessions[0].aiResults[0].evidenceQuotes[0].quote='不在原文中的句子';
  const snapshot=cSnapshot(f);assert.equal(snapshot.records[0].finalOverall,'待判定');assert.equal(snapshot.records[0].routing.aiFinal,false);assert.equal(snapshot.records[0].routing.status,'UNCERTAIN');
  f.original.rows[0].recordId='not-a-real-session';assert.throws(()=>cSnapshot(f),/关联|原始|来源/);
});

test('new routing audit worksheets preserve the fixed 43 ecommerce columns in Chinese and English',async()=>{
  const state=ecommerce(['PASS','FAIL']),snapshot=ecSnapshot(state);assert.equal(businessDeliveryHeaders(snapshot).length,43);
  for(const language of ['zh','en']){const sheets=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,{}, {language})),main=sheets[language==='en'?'Inspection Details':'检核明细'],trail=sheets[language==='en'?'Result provenance':'判定来源与分流'];assert.equal(main[0].length,44);assert.ok(trail);assert.ok(trail.flat().some(value=>String(value).includes('unvalidated')||String(value).includes('未标定')));assert.ok(trail.flat().some(value=>String(value).includes('AI终判')||String(value).includes('AI final')));}
});

test('consultation provenance is an additional worksheet while original and dynamic main columns remain unchanged',async()=>{
  const f=consultation(['PASS','RETURNED']),snapshot=cSnapshot(f),headers=consultationDeliveryHeaders(snapshot);
  for(const language of ['zh','en']){const sheets=await readXlsx(await buildConsultationDeliveryXlsx(snapshot,{}, {language}));assert.equal(sheets[language==='en'?'Inspection Details':'检核明细'][0].length,headers.length+1);assert.ok(sheets[language==='en'?'Result provenance':'判定来源与分流']);}
});

test('old tasks and old snapshots keep their original historical priority, column count and lack of routing metadata',async()=>{
  const state=ecommerce(['PASS']);delete state.tasks[0].reviewPolicy;delete state.sessions[0].reviewPolicy;delete state.sessions[0].aiDecision;for(let index=15;index<=20;index++)state.sessions[0].ecommerce.raw[index]='Fail';
  const snapshot=ecSnapshot(state);assert.equal(snapshot.records[0].finalOverall,'不通过');assert.equal(snapshot.reviewPolicy,undefined);assert.equal(snapshot.records[0].routing,undefined);assert.equal(businessDeliveryHeaders(snapshot).length,43);const sheets=await readXlsx(await buildBusinessDeliveryXlsx(snapshot));assert.equal(sheets['判定来源与分流'],undefined);
});

test('a disabled new policy requires current human confirmation instead of legacy AI fallback in both scenes',()=>{
  const state=ecommerce(['FAIL']);state.tasks[0].reviewPolicy.enabled=false;state.sessions[0].reviewPolicy.enabled=false;const snapshot=ecSnapshot(state);assert.deepEqual(snapshot.reviewPolicy,{...DEFAULT_REVIEW_POLICY,enabled:false});assert.equal(snapshot.records[0].finalOverall,'待判定');assert.equal(snapshot.records[0].routing.needsReview,true);assert.equal(snapshot.metrics.determinate,0);
  const f=consultation(['FAIL']);f.state.tasks[0].reviewPolicy.enabled=false;f.state.sessions[0].reviewPolicy.enabled=false;const consultationSnapshot=cSnapshot(f);assert.equal(consultationSnapshot.reviewPolicy.enabled,false);assert.equal(consultationSnapshot.records[0].finalOverall,'待判定');assert.equal(consultationSnapshot.metrics.determinate,0);
});

for(const scene of ['ecommerce','consultation'])test(`${scene} disabled policy keeps all AI statuses pending until this run is human confirmed`,()=>{
  const f=scene==='ecommerce'?{state:ecommerce(['PASS','FAIL','UNCERTAIN','RETURNED','HUMAN'])}:consultation(['PASS','FAIL','UNCERTAIN','RETURNED','HUMAN']);for(const task of f.state.tasks)task.reviewPolicy.enabled=false;for(const session of f.state.sessions)session.reviewPolicy.enabled=false;
  f.state.sessions[0].aiDecisionHistory=[clone(f.state.sessions[0].aiDecision)];const snapshot=scene==='ecommerce'?ecSnapshot(f.state):cSnapshot(f);assert.deepEqual(snapshot.records.map(record=>record.finalOverall),['待判定','待判定','待判定','待判定','不通过']);assert.equal(snapshot.metrics.determinate,1);assert.equal(snapshot.metrics.aiFinalCount,0);assert.equal(snapshot.metrics.humanConfirmedCount,1);assert.equal(snapshot.metrics.pendingHumanCount,4);assert.ok(snapshot.records.slice(0,4).every(record=>record.final.every(item=>item.source==='pending_human')));assert.deepEqual(snapshot.records[0].routing.decisionHistory,f.state.sessions[0].aiDecisionHistory);
  const model=getManagementReport(f.state,{period:'batch',taskId:f.state.tasks[0].id,referenceDate:'2026-11-11'});assert.equal(model.qualityReviewedCount,1);assert.equal(model.stats.problemSessions,1);assert.equal(model.stats.pendingCount,4);assert.equal(model.hasTriage,true);
});

test('disabled policies without an AI decision still disclose routing in both report languages and keep AI-only exports non-final',async()=>{
  for(const scene of ['ecommerce','consultation']){
    const f=scene==='ecommerce'?{state:ecommerce(['FAIL'])}:consultation(['FAIL']);f.state.tasks[0].reviewPolicy.enabled=false;f.state.sessions[0].reviewPolicy.enabled=false;delete f.state.sessions[0].aiDecision;
    const make=options=>scene==='ecommerce'?ecSnapshot(f.state,options):cSnapshot(f,options),snapshot=make();assert.equal(snapshot.records[0].routing.resultSource,null);assert.equal(snapshot.records[0].routing.aiFinal,false);assert.equal(snapshot.records[0].routing.needsReview,true);assert.equal(snapshot.metrics.determinate,0);assert.equal(snapshot.resultScope,'final');
    for(const language of ['zh','en']){const sheets=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,{}, {language}));assert.ok(sheets[language==='en'?'Result provenance':'判定来源与分流']);const html=buildBusinessReportHtml(snapshot,{}, {language});assert.match(html,language==='en'?/Pending human: 1/:/待人工 1 条/);assert.match(html,language==='en'?/disabled|manual review only/i:/免审.*关闭|未启用.*免审/);}
    const initial=make({conclusionMode:'ai'});assert.equal(initial.records[0].finalOverall,'不通过');assert.equal(initial.resultScope,'initial');assert.match(initial.basis.finalPolicy,/初判.*不.*最终/);
    const generic=await readXlsx(await buildResultXlsx(f.state,{includePending:true})),details=generic['结果明细'];assert.ok(generic['判定来源与分流']);assert.equal(details[1][details[0].indexOf('最终结论')],'');assert.equal(details[1][details[0].indexOf('最终判定来源')],'待人工');assert.equal((await readXlsx(await buildResultXlsx(f.state)))['会话汇总'].length,1);
  }
});

test('the task table shows a queued task position through the shared scheduler badge',()=>{
  const f=consultation(),first=f.state.tasks[0],second={...clone(first),id:'task-next',name:'Synthetic queued task',aiStatus:'queued',aiRun:{id:'next-run',status:'queued'},sessionIds:[]};first.aiStatus='running';first.aiRun={id:'first-run',status:'running'};f.state.tasks.push(second);f.state.aiTaskQueue={version:1,status:'ready',pauseReason:null,nextSequence:3,entries:[{taskId:first.id,runId:'first-run',status:'running',sequence:1},{taskId:second.id,runId:'next-run',status:'queued',sequence:2}]};const html=taskTable(f.state,f.state.tasks);assert.match(html,/data-task-queue-status="queued"/);assert.match(html,/队列第2位/);
});

test('generic default exports include AI-final PASS with explicit source while human final columns remain empty',async()=>{
  const f=consultation(['PASS','FAIL','HUMAN']),sheets=await readXlsx(await buildResultXlsx(f.state));assert.equal(sheets['会话汇总'].length,3);assert.equal(exportSessions(f.state,{includePending:false}).length,2);
  const details=sheets['结果明细'],ai=details.find(row=>row[2]==='s-0');assert.equal(ai[details[0].indexOf('人工最终结论')],'');assert.equal(ai[details[0].indexOf('最终判定来源')],'AI终判');assert.equal(ai[details[0].indexOf('最终结论')],'符合');assert.ok(sheets['判定来源与分流']);
  const html=buildHtmlReport(f.state);assert.match(html,/AI终判/);assert.match(html,/人工确认/);assert.doesNotMatch(html,/最终质量统计仅覆盖人工已确认会话/);
});

test('both business report languages distinguish AI final, human confirmation and pending human review',()=>{
  const snapshots=[ecSnapshot(ecommerce(['PASS','FAIL','HUMAN'])),cSnapshot(consultation(['PASS','FAIL','HUMAN']))];
  for(const snapshot of snapshots)for(const language of ['zh','en']){const html=buildBusinessReportHtml(snapshot,{}, {language});if(language==='en'){assert.match(html,/AI final/);assert.match(html,/Human confirmed/);assert.match(html,/Pending human/);assert.match(html,/unvalidated|not calibrated/i);}else{assert.match(html,/AI终判/);assert.match(html,/人工确认/);assert.match(html,/待人工/);assert.match(html,/未标定/);}assert.doesNotMatch(html,/<script\b[^>]*\bsrc=|https?:\/\/[^\s"<>]+\.css/i);}
  assert.match(buildConsultationReportHtml(snapshots[1]),/AI终判/);
});

test('management and overview separate AI finals from human confirmations and exclude pending FAIL from final denominators',()=>{
  const f=consultation(['PASS','FAIL','UNCERTAIN','RETURNED','HUMAN']),model=getManagementReport(f.state,{period:'batch',taskId:'task-c',referenceDate:'2026-11-11'});
  assert.equal(model.qualityReviewedCount,2);assert.equal(model.stats.aiFinalCount,1);assert.equal(model.stats.humanConfirmedCount,1);assert.equal(model.quality.reduce((sum,row)=>sum+row.count,0),2);assert.equal(model.stats.problemSessions,1);
  const html=buildManagementHtml(f.state,{period:'batch',taskId:'task-c',referenceDate:'2026-11-11'});assert.match(html,/AI终判/);assert.match(html,/人工已确认/);assert.doesNotMatch(html,/质量结果仅覆盖人工已确认质量会话/);
  const ui={period:'batch',taskId:'task-c',reportPeriod:'batch',reportTaskId:'task-c',exportTaskId:'task-c',includePending:false};const overview=overviewView(f.state,ui),exports=exportsView(f.state,ui);assert.match(overview,/AI终判/);assert.doesNotMatch(overview,/人工确认后才形成最终结果/);assert.match(exports,/AI终判/);
});

for(const enabled of [true,false])test(`report jobs freeze ${enabled?'enabled':'disabled'} routing and policy and reject a tampered routing fingerprint on restart`,async t=>{
  const scratch=path.resolve('tests/.triage-export-scratch');await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'job-')),state=ecommerce(['PASS','FAIL']);let service,calls=0;
  state.tasks[0].reviewPolicy.enabled=enabled;for(const session of state.sessions)session.reviewPolicy.enabled=enabled;
  const store={read:async()=>({state:clone(state),revision:1,initialized:true})},modelConfig={getPrivate:()=>({configured:true,connectionTested:true,baseUrl:'http://synthetic.invalid/v1',model:'synthetic-export',authMode:'none'})},client={enrichBusinessReport:async({kind,input})=>{calls++;assert.equal(kind,'translation');return{items:input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'en',translation:'合成译文：'+item.text}))};}};
  const open=()=>createReportJobs({dataDir,store,modelConfig,client,retryDelayMs:1});service=await open();t.after(async()=>{await service.close();assert.ok(dataDir.startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  await service.create({jobId:'triage-snapshot',taskId:state.tasks[0].id});await service.waitForIdle();const result=await service.getResult('triage-snapshot'),frozen=JSON.stringify(result.snapshot),count=calls;assert.equal(result.snapshot.records[0].routing.aiFinal,enabled);assert.equal(result.snapshot.reviewPolicy.confidenceThreshold,0.9);assert.equal(result.snapshot.metrics.determinate,enabled?1:0);
  const sheets=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment));assert.ok(sheets['判定来源与分流']);assert.match(buildBusinessReportHtml(result.snapshot,result.enrichment),new RegExp(`AI终判 ${enabled?1:0} 条`));
  state.sessions[0].review.returned={reason:'生成后退回',at:now,reviewer:'Synthetic',runId:state.sessions[0].aiExecution.runId,scope:'session'};await assert.rejects(service.create({jobId:'triage-snapshot',taskId:state.tasks[0].id}),/来源|口径|冲突|不同/);await service.close();service=await open();assert.equal(JSON.stringify((await service.getResult('triage-snapshot')).snapshot),frozen);assert.equal(calls,count);
  await service.close();const file=path.join(dataDir,'report-jobs','triage-snapshot','snapshot.json'),changed=JSON.parse(await fs.readFile(file,'utf8'));changed.records[0].routing.resultSource='human';await fs.writeFile(file,JSON.stringify(changed));service=await open();await assert.rejects(service.getResult('triage-snapshot'),/指纹/);
});
