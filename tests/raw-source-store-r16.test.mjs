import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {workbook} from '../public/io.mjs';
import {createBusinessState,createImportedTask,recordRawReviewTime,createRawReinspectionTask,saveReview,confirmReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {rawUnavailableResults} from '../server/raw-inspection.mjs';
import {applyAIDecisions} from '../public/ai-triage.mjs';
const raw=await import('../public/raw-transcript.mjs').catch(()=>null);
const hash=value=>createHash('sha256').update(value).digest('hex');
const now='2026-11-12T10:00:00+08:00';
async function fixture(t){
 const parent=path.resolve('tests/.raw-source-r16-scratch');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'case-'));let store=await createWorkspaceStore({dataDir:dir});
 t.after(async()=>{await store.close();assert.ok(dir.startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const bytes=await workbook([{name:'Raw',headers:['ID','客服','消息详情','other'],rows:[['SYN-1','Agent','literal quote','preserve']]}]);
 const source=await store.putSource(bytes,'synthetic.xlsx'),parsed=await raw.parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes},{scene:'新品产品咨询'});
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds:['R004'],now});
 const state=createImportedTask(createBusinessState(),{name:'Synthetic raw',sessions:parsed.sessions,source,basisSnapshot,reviewer:'Reviewer',rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'}},now});
 return {dir,bytes,source,catalog,state,get store(){return store;},async reopen(){await store.close();store=await createWorkspaceStore({dataDir:dir});return store;}};
}
test('archived raw cells are verified on real save and restart',async t=>{
 assert.ok(raw,'raw import exists');const f=await fixture(t);await f.store.save({baseRevision:0,mutationId:'save',state:f.state,catalog:f.catalog});await f.reopen();const read=await f.store.read();assert.deepEqual(read.state.sessions[0].rawTranscript,f.state.sessions[0].rawTranscript);
});
test('internally consistent forged raw text, unused cell, mapping and omitted rows fail archive verification',async t=>{
 assert.ok(raw,'raw import exists');const f=await fixture(t);
 for(const mutate of [s=>{s.rawTranscript.text='forged';s.rawTranscript.raw[2]='forged';s.rawTranscript.textSha256=hash('forged');},s=>{s.rawTranscript.raw[3]='lost';},s=>{s.rawTranscript.columns.agent=4;s.agent='preserve';}]){
  const state=structuredClone(f.state);mutate(state.sessions[0]);await assert.rejects(f.store.save({baseRevision:0,mutationId:`forged-${Math.random()}`,state,catalog:f.catalog}),/原文|原件|单元格|来源|映射/);
 }
 assert.equal((await f.store.read()).revision,0);
});
test('source time declaration and raw input mode are immutable for ordinary saves',async t=>{
 assert.ok(raw,'raw import exists');const f=await fixture(t);await f.store.save({baseRevision:0,mutationId:'save',state:f.state,catalog:f.catalog});
 for(const mutate of [s=>{s.tasks[0].rawImportOptions.timePolicy.mode='explicit';s.sessions[0].rawTranscript.timePolicy.mode='explicit';},s=>{delete s.tasks[0].inputMode;},s=>{s.tasks[0].rawImportOptions.productDefault='Other';}]){
  const state=structuredClone(f.state);mutate(state);await assert.rejects(f.store.save({baseRevision:1,mutationId:`tamper-${Math.random()}`,state,catalog:f.catalog}),/不可|来源|原文|模式|声明/);
 }
});
test('restart rechecks archived source bytes instead of trusting workspace self-consistency',async t=>{
 assert.ok(raw,'raw import exists');const f=await fixture(t);await f.store.save({baseRevision:0,mutationId:'save',state:f.state,catalog:f.catalog});await f.store.close();
 const filename=path.join(f.dir,'workspace.json'),doc=JSON.parse(await fs.readFile(filename,'utf8')),s=doc.state.sessions[0];s.rawTranscript.text='forged';s.rawTranscript.raw[2]='forged';s.rawTranscript.textSha256=hash('forged');await fs.writeFile(filename,JSON.stringify(doc));
 await assert.rejects(createWorkspaceStore({dataDir:f.dir}),/原文|原件|单元格|来源/);
});
test('raw active-review time stays append-only across a real workspace save',async t=>{
 const f=await fixture(t),sessionId=f.state.sessions[0].id,record={sessionId,elapsedMs:4500,reviewer:'Reviewer',now,segmentId:'SYN-TIMER-1'};
 const timed=recordRawReviewTime(f.state,record);await f.store.save({baseRevision:0,mutationId:'timer-first',state:timed,catalog:f.catalog});
 const changed=structuredClone(timed);changed.sessions[0].review.timeSegments[0].elapsedMs=9000;changed.sessions[0].review.activeTimeMs=9000;
 await assert.rejects(f.store.save({baseRevision:1,mutationId:'timer-tamper',state:changed,catalog:f.catalog}),/计时|不可/);
 const next=recordRawReviewTime(timed,{...record,segmentId:'SYN-TIMER-2',now:'2026-11-12T10:01:00+08:00',elapsedMs:1500});
 await f.store.save({baseRevision:1,mutationId:'timer-second',state:next,catalog:f.catalog});assert.equal((await f.store.read()).state.sessions[0].review.activeTimeMs,6000);
});
test('explicit raw reinspection persists independent rule task without relaxing ordinary duplicate saves',async t=>{
 const f=await fixture(t);await f.store.save({baseRevision:0,mutationId:'first',state:f.state,catalog:f.catalog});
 const basisSnapshot=createBasisSnapshot(f.catalog,{effectiveDate:'2026-11-12',ruleIds:['R001','R004'],now});
 const next=createRawReinspectionTask(f.state,f.state.tasks[0].id,{name:'New rules',basisSnapshot,reviewer:'Reviewer',rawImportOptions:{outputLanguage:'en'},now:'2026-11-12T11:00:00+08:00'});
 await f.store.save({baseRevision:1,mutationId:'reinspect',state:next,catalog:f.catalog});await f.reopen();assert.equal((await f.store.read()).state.tasks[0].rawImportOptions.outputLanguage,'en');
 const forged=structuredClone(next);delete forged.tasks[0].reinspectionOf;
 await assert.rejects(f.store.save({baseRevision:2,mutationId:'erase-parent',state:forged,catalog:f.catalog}),/重复|不可|重检/);
});
test('human direct review and exact quotes persist before any model run',async t=>{
 const f=await fixture(t),sessionId=f.state.sessions[0].id;
 const draft=saveReview(f.state,sessionId,{ruleId:'R004',verdict:'符合',reason:'Synthetic independent check',evidence:[],referenceIds:['P004-2'],evidenceQuotes:[{quote:'literal quote'}]},now),state=confirmReview(draft,sessionId,now);
 await f.store.save({baseRevision:0,mutationId:'manual',state,catalog:f.catalog});assert.equal((await f.store.read()).state.sessions[0].review.status,'已确认');
});
test('trusted raw technical failure persists complete uncertain placeholders while status remains failed',async t=>{
 const f=await fixture(t);await f.store.save({baseRevision:0,mutationId:'first',state:f.state,catalog:f.catalog});
 await f.store.updateAI(({state,catalog})=>{
  const task=state.tasks[0],s=state.sessions[0];task.aiStatus='failed';task.aiRun={id:'SYN-RUN',modelId:'synthetic',status:'failed',total:1,done:0,failed:1,startedAt:now,completedAt:now,inspectionAt:now};
  s.aiExecution={status:'failed',runId:'SYN-RUN',modelId:'synthetic',startedAt:now,completedAt:now,errorCode:'INVALID_OUTPUT',error:'Synthetic contract failure'};
  s.aiResults=rawUnavailableResults(s,task.basisSnapshot,{errorCode:'INVALID_OUTPUT'});applyAIDecisions(state,task,now);return {state,catalog};
 });
 await f.reopen();const doc=await f.store.read(),s=doc.state.sessions[0];assert.equal(s.aiExecution.status,'failed');assert.equal(s.aiDecision.status,'UNCERTAIN');assert.equal(s.aiResults[0].rawValidation.status,'program-fallback');
 const fabricated=structuredClone(doc.state);fabricated.sessions[0].aiResults[0].verdict='符合';await assert.rejects(f.store.save({baseRevision:doc.revision,mutationId:'fake-fallback',state:fabricated,catalog:f.catalog}),/引文|原文|校验|不可/);
});
test('removing a real archived nonempty row is rejected even with self-consistent task links',async t=>{
 const f=await fixture(t),bytes=await workbook([{name:'Two Rows',headers:['ID','客服','消息详情'],rows:[['SYN-1','Agent','one'],['SYN-2','Agent','two']]}]),source=await f.store.putSource(bytes,'two-rows.xlsx');
 const parsed=await raw.parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes});
 const state=createImportedTask(createBusinessState(),{name:'Omitted source row',sessions:parsed.sessions.slice(0,1),source,basisSnapshot:f.state.tasks[0].basisSnapshot,reviewer:'Reviewer',now});
 await assert.rejects(f.store.save({baseRevision:0,mutationId:'omitted',state,catalog:f.catalog}),/行数|来源|原件/);
});
