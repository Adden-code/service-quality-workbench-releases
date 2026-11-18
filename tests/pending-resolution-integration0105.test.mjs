import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState,createImportedTask,saveReview,confirmReview,getDashboard,recordRawReviewTime} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {resolvePendingReviews,previewPendingResolution,reopenPendingReview} from '../public/pending-resolution.mjs';
import {DEFAULT_REVIEW_POLICY,deriveAIDecision,isFinalSession} from '../public/ai-triage.mjs';
import {taskTable,overviewView,exportSessions,exportsView} from '../public/views.mjs';
import {setLocale} from '../public/i18n.mjs';
import {taskExecution,taskMatchesStatus,taskStage,taskDetailView,handleTaskReportAction} from '../public/task-workbench.mjs';
import {getManagementReport,buildManagementHtml} from '../public/management-report.mjs';
import {buildResultXlsx,readXlsx} from '../public/io.mjs';
import {createRawReviewTimer} from '../public/raw-review-timer.mjs';

const at='2026-11-15T09:00:00+08:00',later='2026-11-15T10:00:00+08:00',last='2026-11-15T11:00:00+08:00';
const actor='Synthetic processing operator',reason='Synthetic source still lacks the required evidence.';
function fixture({count=3,triage=false}={}){
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{ruleIds:['R004'],effectiveDate:'2026-11-15',now:at});
 return createImportedTask(createBusinessState(),{name:'Synthetic B2 integration',reviewer:'Synthetic reviewer',source:{name:'synthetic-integration.json',sha256:'a'.repeat(64),size:10},basisSnapshot,...(triage?{reviewPolicy:structuredClone(DEFAULT_REVIEW_POLICY)}:{}),now:at,sessions:Array.from({length:count},(_,i)=>({id:'B2-INTEGRATION-'+i,scene:'新品产品咨询',startedAt:at,topic:'Synthetic consultation',channel:'Synthetic channel',product:'Synthetic product',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'Which colors are available?'},{id:2,role:'客服',text:'I will check the official materials.'}]}))});
}
const review=(state,id,verdict)=>saveReview(state,id,{ruleId:'R004',verdict,reason:'Synthetic human judgment',evidence:[2],referenceIds:[]},at);
function process(state,ids){return resolvePendingReviews(state,{sessionIds:ids,preview:previewPendingResolution(state,{taskId:state.tasks[0].id}),reason,actor,operationId:'integration-resolve',now:later});}
const options=state=>({period:'batch',taskId:state.tasks[0].id,referenceDate:'2026-11-15'});
const ui=state=>({dataMode:'manual',period:'batch',dashboardTaskId:state.tasks[0].id,taskDetailId:state.tasks[0].id,modelConfig:{configured:false},taskStatus:'全部'});
const rowObject=(sheet,index=1)=>Object.fromEntries(sheet[0].map((header,column)=>[header,sheet[index]?.[column]]));

test('B2 integration separates completed work, pending work and final quality in mixed task and overview',()=>{
 let state=fixture();const [unknown,human,pending]=state.sessions.map(s=>s.id);state=review(state,unknown,'无法判定');state=confirmReview(review(state,human,'符合'),human,at);state=review(state,pending,'无法判定');const prior=structuredClone(state),before=getDashboard(state,options(state));state=process(state,[unknown]);
 const counts=taskExecution(state,state.tasks[0]),stats=getDashboard(state,options(state));assert.equal(counts.workCompleted,2);assert.equal(counts.finalized,1);assert.equal(counts.processedUnknown,1);assert.equal(counts.humanConfirmed,1);assert.equal(counts.pendingHuman,1);assert.equal(taskMatchesStatus(state,state.tasks[0],'审核工作已处理'),false);assert.equal(taskMatchesStatus(state,state.tasks[0],'待人工确认'),true);assert.equal(stats.reviewedCount,before.reviewedCount);assert.equal(stats.qualityReviewedCount,before.qualityReviewedCount);assert.equal(stats.problemSessions,before.problemSessions);
 const table=taskTable(state,state.tasks);assert.match(table,/2 \/ 3/);assert.match(table,/已处理，仍无法判定 1 条/);assert.match(table,/待人工审核 1 条/);assert.doesNotMatch(table,/等待AI结果/);
 const detail=taskDetailView(state,ui(state));assert.match(detail,/<strong>2 \/ 3<\/strong>/);assert.match(detail,/不计为通过或进入最终质量分母/);const overview=overviewView(state,ui(state));assert.match(overview,/已处理，仍无法判定 1 条/);assert.match(overview,/质量分母 1 条/);
 const model=getManagementReport(state,options(state));assert.equal(model.qualityReviewedCount,1);assert.equal(model.batches[0].processedUnknown,1);assert.equal(model.batches[0].pending,1);assert.ok(model.findings.some(text=>/结论仍无法判定/.test(text)));assert.ok(!model.findings.some(text=>/均已完成人工确认/.test(text)));assert.deepEqual(state.sessions.map(s=>s.aiResults),prior.sessions.map(s=>s.aiResults));assert.deepEqual(state.sessions.map(s=>s.review.drafts),prior.sessions.map(s=>s.review.drafts));
});

test('B2 integration all-processed task is work-complete without becoming human-confirmed or waiting for AI',()=>{
 let state=fixture({count:2});for(const s of state.sessions)state=review(state,s.id,'无法判定');state=process(state,state.sessions.map(s=>s.id));const counts=taskExecution(state,state.tasks[0]);assert.equal(counts.workCompleted,2);assert.equal(counts.finalized,0);assert.equal(counts.pendingHuman,0);assert.equal(counts.eligible,false);assert.equal(taskStage(state,state.tasks[0]),4);assert.equal(taskMatchesStatus(state,state.tasks[0],'审核工作已处理'),true);assert.equal(taskMatchesStatus(state,state.tasks[0],'审核已完成'),false);assert.equal(taskMatchesStatus(state,state.tasks[0],'人工已完成'),false);
 const table=taskTable(state,state.tasks);assert.match(table,/审核工作已处理/);assert.match(table,/2 \/ 2/);assert.doesNotMatch(table,/等待AI结果|待人工审核 [1-9]/);const detail=taskDetailView(state,ui(state));assert.match(detail,/<strong>2 \/ 2<\/strong>/);assert.match(detail,/条审核工作已处理/);
 const model=getManagementReport(state,options(state)),html=buildManagementHtml(state,options(state));assert.equal(model.qualityReviewedCount,0);assert.equal(model.stats.reviewedCount,0);assert.equal(model.stats.pendingCount,0);assert.equal(model.stats.processedUnknownCount,2);assert.doesNotMatch(html,/当前范围的会话均已完成人工确认/);assert.match(html,/不作为通过且不进入最终质量分母/);assert.match(html,/最终结论覆盖率 0%/);assert.match(html,/审核工作已处理 2 \/ 2 条/);const overview=overviewView(state,ui(state));assert.match(overview,/最终结论覆盖情况/);assert.match(overview,/审核工作已处理 2 \/ 2 条/);assert.match(overview,/已处理仍无法判定<b>2<\/b>/);assert.doesNotMatch(overview,/>审核完成率</);
});

test('B2 integration generic XLSX includes a separate processing audit only when unconfirmed scope is requested',async()=>{
 let state=fixture({count:2,triage:true});const [processed,human]=state.sessions.map(s=>s.id);state=review(state,processed,'无法判定');state=confirmReview(review(state,human,'符合'),human,at);state=process(state,[processed]);const original=structuredClone(state);
 const defaults=await readXlsx(await buildResultXlsx(state)),full=await readXlsx(await buildResultXlsx(state,{includePending:true}));assert.equal(defaults['已处理待补充'],undefined);assert.equal(defaults['会话汇总'].length,2);assert.equal(exportSessions(state,{includePending:false}).length,1);assert.equal(full['会话汇总'].length,3);
 const audit=rowObject(full['已处理待补充']);assert.equal(audit['会话ID'],processed);assert.equal(audit['处理状态'],'已处理，结论仍无法判定');assert.equal(audit['处理原因'],reason);assert.equal(audit['操作人标签（未认证）'],actor);assert.equal(audit['保留无法判定的规则'],'R004');assert.deepEqual(JSON.parse(audit['处理历史']),state.sessions[0].review.resolutionHistory);
 const detailIndex=full['结果明细'].findIndex((row,i)=>i&&row[2]===processed),detail=rowObject(full['结果明细'],detailIndex);assert.equal(detail['人工最终结论'],'');assert.equal(detail['最终结论'],'');assert.equal(detail['人工草稿'],'无法判定');assert.equal(detail['AI初判'],'');assert.equal(detail['完成时间'],'');assert.equal(detail['审核状态'],'待补充');assert.equal(detail['最终判定来源'],'已处理，结论仍无法判定');const processedSummary=rowObject(full['会话汇总'],full['会话汇总'].findIndex((row,i)=>i&&row[2]===processed));assert.equal(processedSummary['会话结论'],'已处理，结论仍无法判定');assert.equal(processedSummary['最终判定来源'],'已处理，结论仍无法判定');const batch=rowObject(full['批次统计']);assert.equal(batch['已形成最终结论会话数'],'1');assert.equal(batch['未确认会话数'],'1');assert.ok(full['口径说明'].some(row=>row[0]==='已处理待补充'&&/不计为通过/.test(row[1])));assert.deepEqual(state,original);
});

test('B2 integration reopened unknown returns to queue and current pending sheet disappears while history remains',async()=>{
 let state=fixture({count:1});state=review(state,state.sessions[0].id,'无法判定');state=process(state,[state.sessions[0].id]);const processed=state.sessions[0],reopened=reopenPendingReview(state,{sessionId:processed.id,actor,reason:'Synthetic new evidence arrived.',operationId:'integration-reopen',now:last});const counts=taskExecution(reopened,reopened.tasks[0]);assert.equal(counts.workCompleted,0);assert.equal(counts.processedUnknown,0);assert.equal(counts.pendingHuman,1);assert.equal(isFinalSession(reopened.sessions[0]),false);const full=await readXlsx(await buildResultXlsx(reopened,{includePending:true}));assert.equal(full['已处理待补充'],undefined);assert.deepEqual(reopened.sessions[0].review.resolutionHistory[0],processed.review.resolutionHistory[0]);assert.equal(reopened.sessions[0].review.resolutionHistory.length,2);
});

test('B2 integration AI-final plus processed unknown keeps AI source and denominator unchanged',()=>{
 let state=fixture({count:2,triage:true});const [unknown,ai]=state.sessions;state=review(state,unknown.id,'无法判定');const session=state.sessions.find(s=>s.id===ai.id);session.aiExecution={status:'completed',runId:'synthetic-ai-final'};session.aiResults=[{ruleId:'R004',verdict:'符合',reason:'Synthetic verified original',evidence:[2],evidenceQuotes:[{turnId:2,role:'客服',quote:'I will check the official materials.'}],referenceIds:[...state.tasks[0].basisSnapshot.rules[0].policyIds],confidence:0.99,conflictsWith:[]}];session.aiDecision=deriveAIDecision(session,session.reviewPolicy,{at,runId:'synthetic-ai-final',basis:state.tasks[0].basisSnapshot});const original=structuredClone(session),before=getDashboard(state,options(state));assert.equal(before.aiFinalCount,1);state=process(state,[unknown.id]);const stats=getDashboard(state,options(state));assert.equal(stats.aiFinalCount,1);assert.equal(stats.humanConfirmedCount,0);assert.equal(stats.qualityReviewedCount,before.qualityReviewedCount);assert.equal(stats.workCompletedCount,2);assert.equal(stats.pendingCount,0);assert.deepEqual(state.sessions.find(s=>s.id===ai.id),original);assert.doesNotMatch(buildManagementHtml(state,options(state)),/当前范围的会话均已完成人工确认/);
});

test('B2 integration raw timing flushes before processing, stays stopped while readonly, and resumes after reopening',async()=>{
 let clock=0,session={id:'RAW-TIMER',taskId:'RAW-TASK',rawTranscript:{schemaVersion:1},review:{status:'待补充',reviewer:actor}},state={tasks:[{id:'RAW-TASK',mode:'manual',createdAt:at}],sessions:[session]},packets=[];
 const timer=createRawReviewTimer({getSession:()=>state.sessions[0],isActive:()=>true,clock:()=>clock,now:()=>later,checkpointMs:0,save:async packet=>{packets.push(packet);state=recordRawReviewTime(state,packet);}});
 timer.sync();clock=1500;const release=timer.suspend();await timer.flush();state.sessions[0].review.resolution={version:1,kind:'processed-unknown'};release();clock=4500;timer.sync();timer.activity();await timer.flush();assert.equal(packets.length,1);assert.equal(state.sessions[0].review.activeTimeMs,1500);
 delete state.sessions[0].review.resolution;timer.sync();clock=5500;await timer.flush();assert.equal(packets.length,2);assert.equal(state.sessions[0].review.activeTimeMs,2500);assert.equal(timer.pendingCount,0);
});

test('B2 integration processed completion opens traceable export scope while final-only completion stays final-only',()=>{
 let state=fixture({count:1});const taskId=state.tasks[0].id,id=state.sessions[0].id;state=process(review(state,id,'无法判定'),[id]);const selections={},pages=[];assert.equal(handleTaskReportAction('completion-export',taskId,{state,ui:selections,navigate:page=>pages.push(page)}),true);assert.equal(selections.includePending,true);assert.equal(selections.exportTaskId,taskId);assert.equal(exportSessions(state,selections).length,1);assert.deepEqual(pages,['exports']);
 let final=fixture({count:1});final=confirmReview(review(final,final.sessions[0].id,'符合'),final.sessions[0].id,at);const onlyFinal={includePending:true};handleTaskReportAction('completion-export',final.tasks[0].id,{state:final,ui:onlyFinal,navigate:()=>{}});assert.equal(onlyFinal.includePending,false);assert.equal(exportSessions(final,onlyFinal).length,1);
 const legacy={includePending:true};handleTaskReportAction('completion-export',taskId,{ui:legacy,navigate:()=>{}});assert.equal(legacy.includePending,false,'Callers without state retain their prior strict scope.');
});

test('B2 integration overview uses English final coverage and independent processed-work labels',()=>{
 let state=fixture({count:1});state=process(review(state,state.sessions[0].id,'无法判定'),[state.sessions[0].id]);setLocale('en',{storage:null});try{const html=overviewView(state,ui(state));assert.match(html,/Final conclusion coverage/);assert.match(html,/Review work processed: 1 \/ 1/);assert.match(html,/Processed; still undetermined/);assert.doesNotMatch(html,/最终结论覆盖情况|审核工作已处理|工作完成与最终结论/);}finally{setLocale('zh',{storage:null});}
});

test('B2 integration advanced export preview and both metric cards disclose processed unknown separately',()=>{
 let state=fixture({count:4,triage:true});for(const session of state.sessions)state=review(state,session.id,'无法判定');state=process(state,state.sessions.slice(0,2).map(session=>session.id));const view=exportsView(state,{...ui(state),exportTaskId:state.tasks[0].id,includePending:true,reportPeriod:'batch',reportTaskId:state.tasks[0].id});
 assert.match(view,/data-export-metric="processed-unknown">2<\/strong><small>已处理仍无法判定/);assert.match(view,/data-export-metric="pending">2<\/strong>/);assert.match(view,/data-report-metric="total">4<\/strong>/);assert.match(view,/data-report-metric="reviewed">0<\/strong>/);assert.match(view,/data-report-metric="pending">2<\/strong>/);assert.match(view,/data-report-metric="processed-unknown">2<\/strong><small>已处理仍无法判定/);
 const preview=view.slice(view.indexOf('class="panel export-preview"'));assert.equal((preview.match(/已处理，结论仍无法判定/g)||[]).length,2);assert.equal((preview.match(/>待补充<\/span>/g)||[]).length,2,'Only the remaining unprocessed pending records keep the plain pending badge.');
 setLocale('en',{storage:null});try{const english=exportsView(state,{...ui(state),exportTaskId:state.tasks[0].id,includePending:true,reportPeriod:'batch',reportTaskId:state.tasks[0].id});assert.match(english,/Processed; still undetermined/);assert.match(english,/Processed; conclusion still undetermined/);}finally{setLocale('zh',{storage:null});}
});
