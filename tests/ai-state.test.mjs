import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as domain from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {buildHtmlReport,buildResultXlsx,readXlsx} from '../public/io.mjs';
import {getManagementReport} from '../public/management-report.mjs';

const now='2026-10-29T10:00:00+08:00',later='2026-10-29T10:01:00+08:00';
const empty=()=>({schemaVersion:1,businessMigrationVersion:1,tasks:[],sessions:[],activity:[]});
function fixture(source={sha256:'a'.repeat(64),name:'业务.json',size:12}){
  const catalog=createCatalog();
  const state=domain.createImportedTask(empty(),{name:'真实AI审核',fileName:source.name,source,reviewer:'审核员',now,
    basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-29',ruleIds:['R001','R002'],now}),
    sessions:[{id:'原始-1',scene:'新品产品咨询',startedAt:'2026-10-29T09:00:00+08:00',topic:'价格核验',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'价格和参数是什么？'}]}]});
  return {state,catalog};
}
const judgment=(ruleId,verdict='符合')=>({ruleId,verdict,reason:'按所选冻结规则和原文核对。',evidence:[1],referenceIds:[]});
function ai(doc,status='completed',verdict='符合',runId='run-1'){
  const task=doc.state.tasks[0],s=doc.state.sessions[0];
  task.aiStatus=status;task.aiRun={id:runId,modelId:'glm-5.3-flash',status,total:1,done:status==='completed'?1:0,failed:status==='failed'?1:0,startedAt:now,completedAt:status==='running'?null:later};
  s.aiExecution={status,runId,modelId:'glm-5.3-flash-202610',requestedModel:'glm-5.3-flash',startedAt:now,completedAt:status==='running'?null:later,requestId:'request-1',promptVersion:'quality-v1',usage:{prompt_tokens:12,completion_tokens:24,total_tokens:36}};
  s.aiResults=status==='completed'?s.expectedRuleIds.map(id=>judgment(id,verdict)):[];
  return doc;
}
async function storeFixture(t,options={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-ai-state-'));
  const store=await createWorkspaceStore({dataDir,...options});
  t.after(async()=>{await store.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const source=await store.putSource(Buffer.from('业务原文fixture'),'业务.json');
  const doc=fixture(source),first={...doc,baseRevision:0,mutationId:'initial'};
  return {store,dataDir,doc,first};
}

test('trusted AI transitions persist atomically and restart without reauthenticating historical snapshots',async t=>{
  const {store,dataDir,doc,first}=await storeFixture(t);await store.save(first);
  assert.equal(typeof store.updateAI,'function');
  const running=await store.updateAI(current=>ai(current,'running'));
  assert.equal(running.revision,2);assert.equal(running.state.tasks[0].progress,0);
  const completed=await store.updateAI(current=>ai(current));
  assert.equal(completed.revision,3);assert.deepEqual(completed.state.tasks[0].basisSnapshot,doc.state.tasks[0].basisSnapshot);
  const persisted=JSON.parse(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8'));
  assert.equal(persisted.mutations.length,1);assert.equal(persisted.state.sessions[0].aiExecution.status,'completed');
  await store.close();const reopened=await createWorkspaceStore({dataDir});t.after(()=>reopened.close());
  assert.deepEqual((await reopened.read()).state,completed.state);
  assert.equal((await reopened.save(first)).revision,3);
});

test('AI updates require initialized state and cannot alter catalog, review, original data or human progress',async t=>{
  const {store,first}=await storeFixture(t);
  assert.equal(typeof store.updateAI,'function');await assert.rejects(store.updateAI(current=>current),/初始化|工作区/);
  await store.save(first);
  for(const mutate of [d=>d.catalog.rules[0].title='改目录',d=>d.state.sessions[0].review.notes='AI改人工',d=>d.state.sessions[0].turns[0].text='改原文',d=>d.state.tasks[0].source.name='改文件',d=>d.state.tasks[0].basisSnapshot.rules[0].name='改依据',d=>d.state.tasks[0].progress=100,d=>d.state.tasks[0].status='已完成',d=>d.state.activity.push({id:'AI-injection',at:now,action:'改活动'})]){
    await assert.rejects(store.updateAI(current=>{mutate(current);return current;}),error=>error.status===400);
    assert.equal((await store.read()).revision,1);
  }
});

test('client cannot inject or alter AI metadata or results before or after a real run',async t=>{
  const {store,first}=await storeFixture(t);
  for(const mutate of [d=>ai(d),d=>d.state.tasks[0].aiRunHistory=[],d=>d.state.sessions[0].aiExecution={status:'failed',runId:'f',modelId:'x',startedAt:now,completedAt:later}]){
    const forged=structuredClone(first);mutate(forged);await assert.rejects(store.save(forged),error=>error.status===400);
  }
  await store.save(first);assert.equal(typeof store.updateAI,'function');const current=await store.updateAI(d=>ai(d));
  for(const mutate of [d=>d.state.tasks[0].aiStatus='not_run',d=>d.state.tasks[0].aiRun.modelId='forged',d=>d.state.tasks[0].aiRunHistory=[],d=>d.state.sessions[0].aiExecution.requestId='forged',d=>d.state.sessions[0].aiResults[0].reason='forged']){
    const forged={state:structuredClone(current.state),catalog:current.catalog,baseRevision:current.revision,mutationId:crypto.randomUUID()};mutate(forged);await assert.rejects(store.save(forged),error=>error.status===400);
  }
  const reviewed=domain.saveReview(current.state,current.state.sessions[0].id,judgment('R001','不符合'),later);
  assert.equal((await store.save({state:reviewed,catalog:current.catalog,baseRevision:current.revision,mutationId:'human'})).revision,3);
});

test('AI state validates exact coverage, evidence, execution linkage, timestamps, safe metadata and counters',()=>{
  for(const mutate of [d=>d.state.sessions[0].aiResults.pop(),d=>d.state.sessions[0].aiResults[0].evidence=[99],d=>d.state.sessions[0].aiResults[0].referenceIds=['P003-1'],d=>d.state.sessions[0].aiExecution.runId='unknown',d=>d.state.sessions[0].aiExecution.completedAt=null,d=>d.state.sessions[0].aiExecution.startedAt='2026-02-30T10:00:00Z',d=>d.state.tasks[0].aiRun.done=3,d=>d.state.sessions[0].aiExecution.error='Bearer sk-secret',d=>d.state.sessions[0].aiExecution.extra='raw response']){
    const d=ai(fixture());mutate(d);assert.throws(()=>validateWorkspace(d.state,d.catalog),error=>error.status===400);
  }
  const failed=ai(fixture(),'failed');failed.state.sessions[0].aiResults=[judgment('R001')];assert.throws(()=>validateWorkspace(failed.state,failed.catalog),/AI|结果/);
  const good=ai(fixture());assert.equal(validateWorkspace(good.state,good.catalog),true);
  const newer=structuredClone(good);newer.state.tasks[0].aiRunHistory=[newer.state.tasks[0].aiRun];newer.state.tasks[0].aiRun={...newer.state.tasks[0].aiRun,id:'run-2'};
  assert.equal(validateWorkspace(newer.state,newer.catalog),true);
});

test('a client cannot repurpose existing demo identifiers to bypass new file AI restrictions',async t=>{
  const {store,doc}=await storeFixture(t);
  const initial=domain.createInitialState();await store.save({state:initial,catalog:doc.catalog,baseRevision:0,mutationId:'demo-first'});
  const forged=ai(structuredClone(doc)),task=forged.state.tasks[0],s=forged.state.sessions[0];
  const taskId=initial.tasks[0].id,sessionId=initial.sessions.find(s=>s.taskId===taskId).id;
  task.id=taskId;task.sessionIds=[sessionId];s.id=sessionId;s.taskId=taskId;
  forged.state.activity=[];
  await assert.rejects(store.save({...forged,baseRevision:1,mutationId:'converted-demo'}),error=>error.status===400);
});

test('failed atomic AI write preserves preceding revision, baseline and mutation history',async t=>{
  let failRename=false;const fsOps={...fs,rename:async(...args)=>{if(failRename&&String(args[1]).endsWith('workspace.json'))throw new Error('disk unavailable');return fs.rename(...args);}};
  const {store,dataDir,first}=await storeFixture(t,{fsOps});await store.save(first);assert.equal(typeof store.updateAI,'function');
  const original=await fs.readFile(path.join(dataDir,'workspace.json'),'utf8');failRename=true;
  await assert.rejects(store.updateAI(d=>ai(d)),/保存/);assert.equal((await store.read()).revision,1);assert.equal(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8'),original);
  failRename=false;assert.equal((await store.updateAI(d=>ai(d))).revision,2);
});

test('real AI acceptance fills only missing drafts and records true human history without changing AI baseline',()=>{
  const d=ai(fixture()),original=structuredClone(d.state.sessions[0].aiResults),id=d.state.sessions[0].id;
  let state=domain.saveReview(d.state,id,judgment('R001','不符合'),later);
  assert.equal(state.sessions[0].review.drafts.R001.source,'人工补充');
  state=domain.acceptAI(state,id,later);const s=state.sessions[0];
  assert.equal(s.review.drafts.R001.verdict,'不符合');assert.equal(s.review.drafts.R002.source,'AI接受');assert.equal(s.review.history.length,2);
  assert.equal(s.review.history[0].before,null);assert.equal(s.review.history[1].before,null);assert.equal(s.review.history[1].after.ruleId,'R002');
  assert.deepEqual(s.aiResults,original);assert.equal(state.tasks[0].progress,0);
  state=domain.confirmReview(state,id,later);assert.equal(state.tasks[0].progress,100);
  const stats=domain.getDashboard(state,{period:'all'});assert.equal(stats.aiProcessed,1);assert.equal(stats.aiProcessedCount,1);assert.equal(stats.changedCount,1);assert.equal(stats.changeRate,100);
  const noAI=fixture();noAI.state.sessions[0].externalId='原始-2';noAI.state.sessions[0].id='manual-2';noAI.state.tasks[0].id='manual-task-2';noAI.state.tasks[0].sessionIds=['manual-2'];noAI.state.sessions[0].taskId='manual-task-2';
  noAI.state.sessions[0].review={...noAI.state.sessions[0].review,status:'已确认',completedAt:later,drafts:Object.fromEntries(['R001','R002'].map(id=>[id,judgment(id)]))};
  state.tasks.push(...noAI.state.tasks);state.sessions.push(...noAI.state.sessions);
  assert.equal(domain.getDashboard(state,{period:'all'}).changeRate,100);
});

test('AI unknown stays pending, forged presence is not AI, and running executions freeze human edits',async t=>{
  const unknown=ai(fixture(),'completed','无法判定'),id=unknown.state.sessions[0].id;
  assert.throws(()=>domain.confirmReview(unknown.state,id,later),/无法判定|待补充/);
  assert.equal(domain.acceptAI(unknown.state,id,later).sessions[0].review.status,'待补充');
  const forged=fixture();forged.state.sessions[0].aiResults=['R001','R002'].map(id=>judgment(id));
  assert.equal(domain.getSessionResults(forged.state.sessions[0])[0].verdict,null);assert.throws(()=>domain.acceptAI(forged.state,id,later),/AI|未运行/);
  const running=ai(fixture(),'running');
  for(const change of [s=>domain.saveReview(s,id,judgment('R001'),later),s=>domain.acceptAI(s,id,later),s=>domain.confirmReview(s,id,later),s=>domain.markPending(s,id,'等材料',later),s=>domain.reopenReview(s,id,later)])assert.throws(()=>change(running.state),/运行|执行/);
  const {store,first}=await storeFixture(t);await store.save(first);assert.equal(typeof store.updateAI,'function');const saved=await store.updateAI(d=>ai(d,'running'));
  saved.state.sessions[0].review.notes='并发人工改动';await assert.rejects(store.save({...saved,baseRevision:saved.revision,mutationId:'while-running'}),/运行|执行/);
});

test('real AI detail exports preserve provider and run metadata, pending drafts are never final',async()=>{
  const d=ai(fixture()),id=d.state.sessions[0].id;d.state=domain.acceptAI(d.state,id,later);
  const options={taskId:d.state.tasks[0].id,includePending:true};
  const sheets=await readXlsx(await buildResultXlsx(d.state,options)),[headers,row]=sheets['结果明细'];
  assert.equal(row[headers.indexOf('AI初判')],'符合');assert.equal(row[headers.indexOf('AI执行状态')],'已执行');assert.equal(row[headers.indexOf('人工最终结论')],'');
  assert.equal(row[headers.indexOf('AI模型ID')],'glm-5.3-flash-202610');assert.equal(row[headers.indexOf('AI运行ID')],'run-1');assert.equal(row[headers.indexOf('AI运行状态')],'completed');
  assert.doesNotMatch(buildHtmlReport(d.state,options),/采用人工独立审核，AI未执行/);
  assert.doesNotMatch(getManagementReport(d.state,{period:'all'}).materialNotice,/AI未执行/);
  assert.equal(getManagementReport(d.state,{period:'all'}).stats.reviewedCount,0);
});

for(const [status,label] of [['failed','失败'],['running','运行中'],['not_run','未执行']])test(`detail and summary exports consistently show ${status} without an AI judgment`,async()=>{
  const d=status==='not_run'?fixture():ai(fixture(),status),options={taskId:d.state.tasks[0].id,includePending:true};
  const tables=await readXlsx(await buildResultXlsx(d.state,options));
  for(const sheet of ['结果明细','会话汇总']){
    const [headers,...rows]=tables[sheet];
    assert.ok(rows.length>0);
    for(const row of rows){
      assert.equal(row[headers.indexOf('AI执行状态')],label,`${sheet} should match the actual session execution`);
      assert.equal(row[headers.indexOf('AI运行状态')],status==='not_run'?'':status);
      if(sheet==='结果明细')assert.equal(row[headers.indexOf('AI初判')],'');
    }
  }
  const html=buildHtmlReport(d.state,options),summaries=[...html.matchAll(/<details open><summary>(.*?)<\/summary>/g)].map(match=>match[1]);
  assert.equal(summaries.length,2);
  for(const summary of summaries){assert.ok(summary.includes(`AI执行状态：${label}`));assert.ok(!summary.includes('AI初判：'));}
  assert.match(html,new RegExp(`<td>AI执行状态<\\/td><td>${label}<\\/td>`));
});
