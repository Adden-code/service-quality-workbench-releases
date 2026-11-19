import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createBusinessState,createImportedTask,saveReview,acceptAI,markPending,confirmReview,reopenReview,getDashboard} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {isProcessedUnknown,pendingResolutionEligibility,previewPendingResolution,resolvePendingReviews,reopenPendingReview,validatePendingResolution,validatePendingResolutionTransition} from '../public/pending-resolution.mjs';
import {isFinalSession,isReviewWorkComplete,requiresHumanReview} from '../public/ai-triage.mjs';
import {reviewCompletion,completionView} from '../public/review-flow.mjs';
import {reviewQueue,reviewView} from '../public/review-view.mjs';
import {applyTaskLifecycle,taskVoidBlockers} from '../public/task-lifecycle.mjs';
import {freezeReviewRouting,triageMetrics,pendingHumanResult,resultProvenanceSheet,triageReportNotice} from '../public/triage-export.mjs';
import {createConsultationDeliverySnapshot} from '../public/consultation-delivery.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {rawSession} from './raw-contract-r16-fixtures.mjs';
import {setLocale} from '../public/i18n.mjs';
import {pendingResolutionDialog} from '../public/pending-resolution-ui.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {publishedFixture,sourceRow} from './v21-runtime-fixtures.mjs';
import {createBusinessDeliverySnapshot} from '../public/business-delivery.mjs';
import {createPendingResolutionManager} from '../public/pending-resolution-manager.mjs';

const at='2026-11-15T09:00:00+08:00',later='2026-11-15T09:10:00+08:00',last='2026-11-15T09:20:00+08:00';
const actor='Synthetic operator',reason='合成资料缺少所需产品事实，已检查仍无法判定';
const source={name:'synthetic-pending.json',sha256:'a'.repeat(64),size:18};
const scratch=path.resolve('D:/Codex project/outputs/service0105-20261115/pending-tests');
function fixture({count=2,ruleIds=['R004'],storedSource=source,reviewPolicy}={}){
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{ruleIds,effectiveDate:'2026-11-15',now:at});
 let state=createImportedTask(createBusinessState(),{name:'Synthetic pending batch',...(reviewPolicy?{reviewPolicy}:{}),reviewer:actor,source:storedSource,basisSnapshot,now:at,sessions:Array.from({length:count},(_,i)=>({id:'PENDING-'+i,scene:'新品产品咨询',startedAt:at,topic:'合成颜色咨询',channel:'Synthetic',product:'Synthetic product',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'有哪些颜色？'},{id:2,role:'客服',text:'请查阅正式产品资料。'}]}))});
 return{catalog,state,taskId:state.tasks[0].id};
}
function pending(state,id=state.sessions[0].id,ruleId='R004',verdict='无法判定') {return saveReview(state,id,{ruleId,verdict,reason,evidence:[2],referenceIds:[]},at);}
function ready(options){let f=fixture(options);for(const s of f.state.sessions)for(const id of s.expectedRuleIds)f.state=pending(f.state,s.id,id);return f;}
function resolve(state,ids=state.sessions.map(s=>s.id),more={}){return resolvePendingReviews(state,{sessionIds:ids,preview:previewPendingResolution(state,{taskId:state.sessions.find(s=>s.id===ids[0]).taskId}),actor,reason,operationId:'resolve-one',now:later,...more});}
function reopen(state,id=state.sessions[0].id,more={}){return reopenPendingReview(state,{sessionId:id,actor,reason:'合成补充资料已到达，重新核对',operationId:'reopen-one',now:last,...more});}
const uiFor=state=>({dataMode:'manual',reviewTaskId:state.tasks[0].id,reviewStatus:'待确认',reviewQuery:'',selectedId:state.sessions[0].id,resultFilter:'全部',openRules:['R004'],highlightedTurns:[]});
async function save(store,state,id){const doc=await store.read();return store.save({baseRevision:doc.revision,mutationId:id,state,catalog:doc.catalog});}
async function persisted(t,{raw=false,onlyFirst=false,reviewPolicy}={}){
 await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'case-'));let store=await createWorkspaceStore({dataDir});const cleanups=[];
 t.after(async()=>{for(const cleanup of cleanups)await cleanup();await store.close();assert.ok(path.resolve(dataDir).startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 let f;
 if(raw){const bytes=await workbook([{name:'Synthetic raw',headers:['ID','客服','消息详情'],rows:[['RAW-PENDING','Synthetic agent','客户：有哪些颜色？\n客服：请查阅正式资料。']]}]);const original=await store.putSource(bytes,'synthetic-pending.xlsx'),parsed=await parseRawTranscriptFile({name:original.name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true);const catalog=createCatalog();const state=createImportedTask(createBusinessState(),{name:'Synthetic raw pending',reviewer:actor,source:original,sessions:parsed.sessions,basisSnapshot:createBasisSnapshot(catalog,{ruleIds:['R004'],effectiveDate:'2026-11-15',now:at}),rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'},outputLanguage:'zh'},now:at});f={catalog,state};}
 else{const original=await store.putSource(Buffer.from('Synthetic original'),'synthetic-pending.json');f=fixture({storedSource:original,reviewPolicy});}
 await store.save({baseRevision:0,mutationId:'initial',...f});
 let state=f.state;for(const s of onlyFirst?state.sessions.slice(0,1):state.sessions)state=saveReview(state,s.id,{ruleId:'R004',verdict:'无法判定',reason,evidence:raw?[]:[2],...(raw?{evidenceQuotes:[]}:{}),referenceIds:[]},at);await save(store,state,'pending');
 return{addCleanup:fn=>cleanups.push(fn),get store(){return store;},async restart(){await store.close();store=await createWorkspaceStore({dataDir});return store.read();}};
}

test('B2 resolves a task batch without changing any original conclusion or final quality denominator',()=>{
 const {state}=ready(),before=getDashboard(state,{period:'batch',taskId:state.tasks[0].id}),after=resolve(state),metrics=getDashboard(after,{period:'batch',taskId:state.tasks[0].id});
 assert.deepEqual(after.tasks,state.tasks);assert.equal(after.sessions.length,2);
 for(let i=0;i<2;i++){const row=after.sessions[i],old=state.sessions[i],{resolution,resolutionHistory,...review}=row.review;assert.deepEqual(review,old.review);assert.deepEqual(row.aiResults,old.aiResults);assert.equal(row.review.status,'待补充');assert.ok(isProcessedUnknown(row));assert.ok(isReviewWorkComplete(row));assert.equal(isFinalSession(row),false);assert.equal(requiresHumanReview(row),false);assert.deepEqual(resolution.unknownRuleIds,['R004']);assert.equal(resolutionHistory.length,1);assert.equal(validatePendingResolution(row,after.tasks[0],after),true);validatePendingResolutionTransition(old,row,state,after);}
 assert.equal(metrics.reviewedCount,before.reviewedCount);assert.equal(metrics.qualityReviewedCount,before.qualityReviewedCount);assert.equal(metrics.processedUnknownCount,2);assert.equal(metrics.workCompletedCount,2);assert.equal(metrics.pendingCount,0);assert.equal(after.activity.filter(e=>e.action==='待补充已处理，结论仍无法判定').length,2);
});

test('B2 independent human unknown checks are eligible without an AI execution; unexecuted and incomplete cases are not',()=>{
 const {state}=fixture({ruleIds:['R001','R004']});let next=pending(state,state.sessions[0].id);assert.equal(pendingResolutionEligibility(next,next.sessions[0]).eligible,false);
 next=pending(next,next.sessions[0].id,'R001');assert.equal(next.sessions[0].aiExecution,undefined);assert.equal(pendingResolutionEligibility(next,next.sessions[0]).eligible,true);assert.equal(pendingResolutionEligibility(next,next.sessions[1]).eligible,false);
 const fake=structuredClone(state);fake.sessions[0].review.status='待补充';assert.match(pendingResolutionEligibility(fake,fake.sessions[0]).reasons.join(' '),/尚未完整/);
});

test('B2 never batch-closes an unchecked AI failure; manual failure plus unknown remains explicit',()=>{
 const {state}=ready({count:1,ruleIds:['R001','R004']}),s=state.sessions[0];s.aiExecution={status:'completed',runId:'synthetic'};s.aiResults=s.expectedRuleIds.map(ruleId=>({ruleId,verdict:ruleId==='R001'?'不符合':'无法判定',reason,evidence:[2],referenceIds:[]}));delete s.review.drafts.R001;
 assert.match(pendingResolutionEligibility(state,s).reasons.join(' '),/未人工核对的不符合/);const checked=pending(state,s.id,'R001','不符合');assert.equal(pendingResolutionEligibility(checked,checked.sessions[0]).eligible,true);const after=resolve(checked);assert.equal(after.sessions[0].review.drafts.R001.verdict,'不符合');assert.equal(isFinalSession(after.sessions[0]),false);
});

test('B2 validates reason, actor, selection, running state and pending state before applying',()=>{
 const {state}=ready({count:1});for(const values of [{reason:''},{actor:''},{reason:'x'.repeat(2001)},{actor:'x'.repeat(81)},{now:'2026-11-14T09:00:00+08:00'}])assert.throws(()=>resolve(state,undefined,values));
 for(const status of ['待审核','已暂存','已确认']){const copy=structuredClone(state);copy.sessions[0].review.status=status;assert.equal(pendingResolutionEligibility(copy,copy.sessions[0]).eligible,false);}
 const running=structuredClone(state);running.sessions[0].aiExecution={status:'running'};assert.equal(pendingResolutionEligibility(running,running.sessions[0]).eligible,false);
 const voided=applyTaskLifecycle(state,state.tasks[0].id,'void',{actor,reason:'Synthetic',now:later});assert.equal(pendingResolutionEligibility(voided,voided.sessions[0]).eligible,false);
});

test('B2 stale preview rejects the entire selection after a draft, rule basis or lifecycle change',()=>{
 const {state}=ready(),preview=previewPendingResolution(state,{taskId:state.tasks[0].id});
 for(const change of [copy=>{copy.sessions[1].review.notes='Changed';},copy=>{copy.tasks[0].basisSnapshot.rules[0].name='Changed';},copy=>{copy.tasks[0].lifecycle={schemaVersion:1,events:[],deliverables:[],archivedAt:later};}]){const copy=structuredClone(state);change(copy);assert.throws(()=>resolve(copy,undefined,{preview}),/重新预览/);assert.equal(copy.sessions[0].review.resolution,undefined);}
});

test('B2 resolved rows are read-only; reopening preserves audit and restores work and permits audited void under the updated lifecycle policy',()=>{
 const {state}=ready({count:1}),after=resolve(state),id=after.sessions[0].id;
 for(const mutate of [s=>pending(s,id),s=>acceptAI(s,id),s=>markPending(s,id,'Reason'),s=>confirmReview(s,id),s=>reopenReview(s,id)])assert.throws(()=>mutate(after),/已处理.*只读/);
 assert.throws(()=>reopen(after,id,{reason:''}),/原因/);const reopened=reopen(after);assert.equal(isProcessedUnknown(reopened.sessions[0]),false);assert.equal(requiresHumanReview(reopened.sessions[0]),true);assert.equal(reopened.sessions[0].review.status,'待补充');assert.deepEqual(reopened.sessions[0].review.drafts,state.sessions[0].review.drafts);assert.equal(reopened.sessions[0].review.resolutionHistory.length,2);validatePendingResolutionTransition(after.sessions[0],reopened.sessions[0],after,reopened);assert.deepEqual(taskVoidBlockers(reopened,reopened.tasks[0]),[]);assert.doesNotThrow(()=>pending(reopened,id));
 const again=resolve(reopened,undefined,{operationId:'resolve-two',now:last});assert.equal(again.sessions[0].review.resolutionHistory.length,3);
});

test('B2 workspace persistence retains processing and reopening across restart; forged state and historical edits fail',async t=>{
 const f=await persisted(t),before=await f.store.read(),state=resolve(before.state);const saved=await save(f.store,state,'resolve');assert.deepEqual((await f.restart()).state,saved.state);
 const tamperers=[s=>{s.sessions[0].review.resolution.reason='Forged';},s=>{s.sessions[0].review.resolutionHistory[0].actor='Forged';},s=>{s.sessions[0].review.notes='Silent edit';},s=>{delete s.sessions[0].review.resolution;delete s.sessions[0].review.resolutionHistory;},s=>{s.activity=s.activity.filter(a=>a.action!=='待补充已处理，结论仍无法判定');}];
 for(const [i,change]of tamperers.entries()){const copy=structuredClone(state);change(copy);await assert.rejects(save(f.store,copy,'forge-'+i));}
 assert.deepEqual(taskVoidBlockers(state,state.tasks[0]),[]);
 const reopened=reopen(state);await save(f.store,reopened,'reopen');const erase=structuredClone(reopened);delete erase.sessions[0].review.resolutionHistory;await assert.rejects(save(f.store,erase,'erase-reopened'),/审计/);assert.deepEqual((await f.restart()).state,reopened);
});

test('B2 server requires the per-row audit and rejects resolve plus conclusion edits or AI-authored status transitions',()=>{
 const {state}=ready({count:1}),after=resolve(state);const missing=structuredClone(after);missing.activity=[];assert.throws(()=>validatePendingResolutionTransition(state.sessions[0],missing.sessions[0],state,missing),/逐条操作审计/);
 const changed=structuredClone(after);changed.sessions[0].review.drafts.R004.reason='Other';assert.throws(()=>validatePendingResolutionTransition(state.sessions[0],changed.sessions[0],state,changed),/同时改写/);
 assert.throws(()=>validatePendingResolutionTransition(state.sessions[0],after.sessions[0],state,after,{trustedAI:true}),/AI不能/);
});

test('B2 actual raw XLSX pending record persists and reopens without modifying original transcript or judgment',async t=>{
 const f=await persisted(t,{raw:true}),before=await f.store.read(),state=resolve(before.state);await save(f.store,state,'raw-resolve');let doc=await f.restart();assert.equal(isProcessedUnknown(doc.state.sessions[0]),true);assert.deepEqual(doc.state.sessions[0].rawTranscript,before.state.sessions[0].rawTranscript);assert.deepEqual(doc.state.sessions[0].review.drafts,before.state.sessions[0].review.drafts);
 const view=reviewView(doc.state,{...uiFor(doc.state),reviewStatus:'已处理待补充',showReviewRecords:true});assert.match(view,/data-act="pending-reopen"/);assert.doesNotMatch(view,/data-act="raw-(?:inline-verdict|inline-save|edit-result)"/);assert.doesNotMatch(view,/data-act="raw-confirm-next"/);assert.match(view,/data-act="raw-result-filter" data-value="人工改判">人工修改记录<\/button>/);
 doc=await save(f.store,reopen(doc.state),'raw-reopen');assert.equal(doc.state.sessions[0].review.resolution,undefined);assert.deepEqual((await f.restart()).state,doc.state);
});

test('B2 work completion and queue labels separate processed unknown from final quality confirmation',()=>{
 const {state}=ready(),ui=uiFor(state);assert.match(reviewView(state,ui),/data-act="pending-resolve-task"/);assert.match(reviewView(state,ui),/data-act="pending-resolve-one"/);
 const after=resolve(state),info=reviewCompletion(after,ui);assert.equal(info.complete,true);assert.equal(info.processedUnknown,2);assert.equal(info.confirmed,0);assert.equal(info.notRun,0);assert.equal(reviewQueue(after,ui).length,0);assert.equal(reviewQueue(after,{...ui,reviewStatus:'已处理待补充'}).length,2);assert.match(completionView(info),/本批次审核工作已处理/);assert.match(completionView(info),/不进入最终质量分母/);assert.doesNotMatch(completionView(info),/>全部审核完成</);
 const view=reviewView(after,{...ui,reviewStatus:'已处理待补充',showReviewRecords:true});assert.match(view,/data-act="pending-reopen"/);assert.match(view,/data-act="edit-result"[^>]+disabled/);assert.match(view,/data-act="result-filter" data-value="人工修改">人工修改记录<\/button>/);
});

test('B2 routing exports separate processing audit without changing result source enum or quality denominator',()=>{
 const {state}=ready({count:1}),after=resolve(state),session=after.sessions[0],task=after.tasks[0];const routing=freezeReviewRouting(session,task);assert.equal(routing.processedUnknown,true);assert.equal(routing.needsReview,false);assert.equal(routing.resultSource,null);assert.deepEqual(routing.resolutionAudit.current,session.review.resolution);
 const item=pendingHumanResult({verdict:'符合',reason:'AI initial'},routing);assert.equal(item.source,'pending_human');assert.equal(item.verdict,'待判定');assert.match(item.reason,/已处理.*无法判定/);
 const original={sheetName:'Synthetic',headerRow:1,headers:['ID','消息详情'],messageColumn:1,rows:[{sourceRow:2,values:[session.externalId,'客户：有哪些颜色？\n客服：请查阅正式资料。'],recordId:session.id}],productSources:{[session.id]:{value:'Synthetic',source:'任务默认'}}};
 const snapshot=createConsultationDeliverySnapshot(after,{taskId:task.id,original,now:last});assert.equal(snapshot.metrics.determinate,0);assert.equal(snapshot.metrics.processedUnknownCount,1);assert.equal(snapshot.metrics.pendingHumanCount,0);assert.equal(snapshot.records[0].finalOverall,'待判定');assert.equal(snapshot.records[0].final[0].source,'pending_human');assert.equal(snapshot.metrics.ruleStats[0].final.denominator,0);
 const sheet=resultProvenanceSheet(snapshot,'en');assert.ok(sheet.headers.includes('Processing audit'));assert.equal(sheet.rows[0].length,sheet.headers.length);assert.ok(sheet.rows[0].includes(reason));assert.match(triageReportNotice(snapshot,'en'),/Processed, still undetermined: 1/);assert.equal(triageMetrics(snapshot.records).humanConfirmedCount,0);
});

test('B2 manager preserves a stale preview and entered reason after rejection instead of partially committing',async()=>{
 let {state}=ready(),dialog=null;const ui=uiFor(state),elements=new Map();const root={querySelector:selector=>elements.get(selector),querySelectorAll:()=>dialog.selectedIds.map(value=>({value}))};
 const manager=createPendingResolutionManager({getState:()=>state,getUI:()=>ui,getDialog:()=>dialog,openDialog:d=>{dialog=d;},closeDialog:()=>{dialog=null;},renderDialog:()=>{},render:()=>{},selectSession:id=>{ui.selectedId=id;},getRoot:()=>root,newId:()=> 'ui-operation',now:()=>later,commit:async updater=>{state=updater(state);}});
 await manager.click('pending-resolve-task',{dataset:{id:state.tasks[0].id}});elements.set('#pending-resolution-actor',{value:actor});elements.set('#pending-resolution-reason',{value:reason});state.sessions[1].review.notes='Changed concurrently';await manager.click('pending-resolution-save');assert.ok(dialog);assert.match(dialog.error,/重新预览/);assert.equal(dialog.reason,reason);assert.ok(state.sessions.every(s=>!isProcessedUnknown(s)));
 await manager.click('pending-resolution-refresh');await manager.click('pending-resolution-save');assert.equal(dialog,null);assert.ok(state.sessions.every(isProcessedUnknown));
});

test('B2 a new submitted session cannot arrive with forged processing history',async t=>{
 await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'new-')),store=await createWorkspaceStore({dataDir:dir});t.after(async()=>{await store.close();assert.ok(path.resolve(dir).startsWith(scratch+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const original=await store.putSource(Buffer.from('Synthetic original'),'synthetic-pending.json'),f=ready({storedSource:original,count:1}),state=resolve(f.state);
 await assert.rejects(store.save({baseRevision:0,mutationId:'seed-processed',state,catalog:f.catalog}),/预置人工处理审计/);assert.equal((await store.read()).initialized,false);
});

test('B2 full AI unknowns are eligible while missing rules and program fallback are not silently closed',()=>{
 const f=fixture({count:1}),s=f.state.sessions[0];s.review.status='待补充';s.aiExecution={status:'completed',runId:'ai-unknown'};s.aiResults=[{ruleId:'R004',verdict:'无法判定',reason,evidence:[],referenceIds:[]}];assert.equal(pendingResolutionEligibility(f.state,s).eligible,true);assert.equal(resolve(f.state).sessions[0].review.resolution.runId,'ai-unknown');const raw=rawSession('Synthetic transcript',{...structuredClone(s)});raw.inputMode='raw-transcript-v1';raw.aiResults[0].rawValidation={status:'program-fallback'};assert.equal(pendingResolutionEligibility({...f.state,sessions:[raw]},raw).eligible,false);s.aiResults=[];assert.equal(pendingResolutionEligibility(f.state,s).eligible,false);
});

test('B2 ecommerce final delivery keeps processed unknown separate from historical pass and final quality',()=>{
 const f=publishedFixture([sourceRow()]);for(let i=15;i<=20;i++)f.state.sessions[0].ecommerce.raw[i]='Pass';
 const session=f.state.sessions[0];for(const ruleId of session.expectedRuleIds)f.state=saveReview(f.state,session.id,{ruleId,verdict:'无法判定',reason,evidence:[],referenceIds:[]},at);
 const state=resolve(f.state),snapshot=createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now:last});assert.equal(snapshot.records[0].historicalOverall,'通过');assert.equal(snapshot.records[0].finalOverall,'待判定');assert.equal(snapshot.metrics.determinate,0);assert.equal(snapshot.metrics.processedUnknownCount,1);assert.equal(snapshot.metrics.pendingHumanCount,0);assert.ok(snapshot.records[0].final.every(item=>item.source==='pending_human'&&/已处理/.test(item.reason)));
});

test('B2 AI service retries another row while retaining processed unknown row and its audit exactly',async t=>{
 const f=await persisted(t,{onlyFirst:true,reviewPolicy:{version:1,enabled:true,confidenceThreshold:0.9,calibrationStatus:'unvalidated'}});let doc=await f.store.read();const protectedId=doc.state.sessions[0].id,otherId=doc.state.sessions[1].id;
 doc=await save(f.store,resolve(doc.state,[protectedId]),'resolve-before-ai');const original=structuredClone(doc.state.sessions[0]),audit=structuredClone(doc.state.activity.filter(a=>a.sessionId===protectedId)),calls=[],errors=[];
 const ai=await createAiService({store:f.store,modelConfig:{getPrivate:()=>({configured:true,connectionTested:true,baseUrl:'http://127.0.0.1:9/v1',model:'synthetic-b2',authMode:'none',apiKey:null})},client:{inspect:async request=>{calls.push(request.session.id);if(calls.length===1)throw Object.assign(new Error('Synthetic retry'),{code:'timeout'});return{results:[{ruleId:'R004',verdict:'符合',reason:'Synthetic verified response',evidence:[2],evidenceQuotes:[{turnId:2,role:'客服',quote:'请查阅正式产品资料。'}],referenceIds:[],confidence:0.99,conflictsWith:[]}],modelId:'synthetic-b2',requestId:'synthetic-success',promptVersion:'qa-ark-v1'};}},maxAttempts:1,onError:error=>errors.push(error)});f.addCleanup(()=>ai.close());
 await ai.start(doc.state.tasks[0].id,'pending-run-one');await ai.waitForIdle();doc=await f.store.read();assert.equal(doc.state.sessions.find(s=>s.id===otherId).aiExecution.status,'failed');assert.deepEqual(doc.state.sessions.find(s=>s.id===protectedId),original);
 await ai.start(doc.state.tasks[0].id,'pending-run-retry');await ai.waitForIdle();doc=await f.store.read();assert.deepEqual(errors,[]);assert.deepEqual(calls,[otherId,otherId]);assert.deepEqual(doc.state.sessions.find(s=>s.id===protectedId),original);assert.deepEqual(doc.state.activity.filter(a=>a.sessionId===protectedId),audit);assert.equal(doc.state.sessions.find(s=>s.id===otherId).aiExecution.status,'completed');assert.equal(doc.state.tasks[0].aiQueue.rows.find(row=>row.sessionId===protectedId).status,'protected');
});

test('B2 English work status, preview, errors and completion labels are program-localized',()=>{
 const {state}=ready({count:1}),after=resolve(state),ui=uiFor(state);setLocale('en',{storage:null});
 try{const preview=previewPendingResolution(state,{taskId:state.tasks[0].id}),dialog=pendingResolutionDialog({type:'pending-resolution',preview,selectedIds:preview.map(row=>row.id),actor:'Synthetic',reason:'Synthetic reason',error:'预览后记录或依据已变化，请重新预览后再处理。'});assert.match(dialog,/Preview pending case processing/);assert.match(dialog,/Refresh the preview/);assert.match(dialog,/not an authenticated identity/);assert.match(dialog,/Keep 1 undetermined checks/);assert.match(completionView(reviewCompletion(after,ui)),/conclusions remain undetermined/);assert.match(reviewView(after,{...ui,reviewStatus:'已处理待补充',showReviewRecords:true}),/Processed; conclusion still undetermined/);}finally{setLocale('zh',{storage:null});}
});

test('B2 stale reopening can refresh the exact basis without losing inputs and disables a no-longer-processed case',async()=>{
 let state=resolve(ready({count:1}).state),dialog=null;const ui=uiFor(state),id=state.sessions[0].id,root={querySelector:selector=>({value:selector.includes('actor')?actor:reason}),querySelectorAll:()=>[]};
 const manager=createPendingResolutionManager({getState:()=>state,getUI:()=>ui,getDialog:()=>dialog,openDialog:d=>{dialog=d;},closeDialog:()=>{dialog=null;},renderDialog:()=>{},render:()=>{},selectSession:()=>{},getRoot:()=>root,newId:()=> 'ui-reopen',now:()=>last,commit:async updater=>{state=updater(state);}});
 await manager.click('pending-reopen',{dataset:{id}});const initialBasis=dialog.basis;state=applyTaskLifecycle(state,state.tasks[0].id,'archive',{actor,now:last});await manager.click('pending-resolution-save');assert.match(dialog.error,/重新预览/);await manager.click('pending-resolution-refresh');assert.notEqual(dialog.basis,initialBasis);state=applyTaskLifecycle(state,state.tasks[0].id,'restore',{actor,now:last});await manager.click('pending-resolution-refresh');assert.equal(dialog.actor,actor);assert.equal(dialog.reason,reason);await manager.click('pending-resolution-save');assert.equal(dialog,null);assert.equal(isProcessedUnknown(state.sessions[0]),false);
 state=resolve(state,undefined,{operationId:'next-resolution',now:last});await manager.click('pending-reopen',{dataset:{id}});state=reopen(state,id,{operationId:'other-reopen'});await manager.click('pending-resolution-refresh');assert.equal(dialog.blocked,true);assert.match(manager.dialog(dialog),/data-act="pending-resolution-save" disabled/);await manager.click('pending-resolution-save');assert.equal(state.sessions[0].review.resolutionHistory.length,4);
});
