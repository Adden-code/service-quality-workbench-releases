import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {issueCount,humanChanged} from '../public/ui.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
const now='2026-10-29T10:00:00+08:00';
const session=()=>({id:'真实-1',scene:'新品产品咨询',startedAt:'2026-10-29T09:00:00+08:00',topic:'新型号适配',channel:'真实渠道',product:'新型号',agent:'客服甲',customer:'客户甲',completeness:'完整',missingNote:'',turns:[{id:8,role:'客户',speaker:'客户甲',at:'',text:'这是一段全新的业务原文。'}]});
async function setup(ruleIds=['R001']){const {createBasisSnapshot}=await import('../public/task-basis.mjs');const catalog=createCatalog();return {catalog,options:{name:'业务材料',fileName:'新材料.json',sessions:[session()],source:{sha256:'a'.repeat(64),name:'新材料.json',size:100},basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-29',ruleIds,now}),reviewer:'审核人甲',now}};}
const item=state=>state.sessions.find(s=>s.taskId===state.tasks[0].id);
const draft=(verdict='符合')=>({ruleId:'R001',verdict,reason:'已对照原文及所选版本逐项检查。',evidence:[8],referenceIds:['P001-1']});

test('import creates fresh manual task with no AI and keeps uploaded source and all original metadata',async()=>{
  const {options,catalog}=await setup(),before=d.createInitialState(),original=structuredClone(before);
  const after=d.createImportedTask(before,options),s=item(after),task=after.tasks[0];
  assert.deepEqual(before,original);assert.equal(task.mode,'manual');assert.equal(task.aiStatus,'not_run');assert.equal(task.progress,0);assert.equal(task.status,'待审核');
  assert.equal(s.externalId,'真实-1');assert.notEqual(s.id,s.externalId);assert.deepEqual(s.turns,options.sessions[0].turns);assert.deepEqual(s.aiResults,[]);assert.deepEqual(s.expectedRuleIds,['R001']);
  const results=d.getSessionResults(s);assert.equal(results.length,1);assert.equal(results[0].verdict,null);assert.equal(results[0].executionStatus,'未执行');assert.equal(results[0].changed,false);assert.equal(results[0].final,null);
  assert.equal(validateWorkspace(after,catalog,before,{authenticateNewSnapshots:true}),true);
  assert.equal(d.createImportedTask(after,options).tasks[0].importLineage.ordinal,2);assert.throws(()=>d.createImportedTask(before,{...options,source:null}),/原文件|上传/);
  assert.throws(()=>d.createImportedTask(before,{...options,reviewer:' '}),/审核人/);
});
test('manual independent review validates task scope, evidence, preserves history and excludes AI corrections',async()=>{
  const {options}=await setup();let state=d.createImportedTask(d.createInitialState(),options),s=item(state);
  assert.throws(()=>d.acceptAI(state,s.id,now),/人工|未运行/);assert.throws(()=>d.setTaskProgress(state,s.taskId,100),/人工/);
  assert.throws(()=>d.saveReview(state,s.id,{...draft(),ruleId:'R002'},now),/规则/);assert.throws(()=>d.saveReview(state,s.id,{...draft(),evidence:[1]},now),/证据/);
  assert.throws(()=>d.saveReview(state,s.id,{...draft(),referenceIds:['P003-1']},now),/依据/);
  state=d.saveReview(state,s.id,draft(),now);state=d.saveReview(state,s.id,draft('不符合'),'2026-10-29T10:01:00+08:00');s=item(state);
  assert.equal(s.review.drafts.R001.source,'人工独立审核');assert.equal(s.review.history.length,2);assert.equal(s.review.history[1].before.verdict,'符合');assert.equal(s.review.history[1].after.verdict,'不符合');
  assert.equal(d.getSessionResults(s)[0].final.verdict,'不符合');assert.equal(d.getSessionResults(s)[0].changed,false);assert.equal(issueCount(s),1);assert.equal(humanChanged(s),false);
});
test('manual confirmation refuses missing items, unknown judgment, reviewer and invalid actual time',async()=>{
  const {options}=await setup(['R001','R002']);let state=d.createImportedTask(d.createInitialState(),options),s=item(state);
  assert.throws(()=>d.confirmReview(state,s.id,now),/逐项|缺少|完成/);
  state=d.saveReview(state,s.id,draft(),now);assert.throws(()=>d.confirmReview(state,s.id,now),/逐项|缺少|完成/);
  state=d.saveReview(state,s.id,{...draft('无法判定'),ruleId:'R002',referenceIds:[]},now);assert.equal(item(state).review.status,'待补充');
  assert.throws(()=>d.confirmReview(state,s.id,now),/无法判定|待补充/);
  state=d.saveReview(state,s.id,{...draft(),ruleId:'R002',referenceIds:[]},now);
  assert.throws(()=>d.confirmReview(state,s.id,'2026-02-30T10:00:00+08:00'),/时间|日期/);
  const missing=structuredClone(state);item(missing).review.reviewer=' ';assert.throws(()=>d.confirmReview(missing,s.id,now),/审核人/);
  state=d.confirmReview(state,s.id,now);assert.equal(item(state).review.status,'已确认');assert.equal(state.tasks[0].status,'已完成');assert.equal(state.tasks[0].progress,100);assert.equal(state.tasks[0].aiStatus,'not_run');
  const stats=d.getDashboard(state,{period:'batch',taskId:s.taskId});assert.equal(stats.aiProcessed,0);assert.equal(stats.changedCount,0);assert.equal(stats.reviewedCount,1);
});
test('custom snapshot rule statistics remain stable after directory changes; reset keeps manual activity with unique ids',async()=>{
  const {options}=await setup();options.basisSnapshot.rules[0].id='OWN';options.basisSnapshot.rules[0].name='自定义规则';options.basisSnapshot.rules[0].category='新类别';
  let state=d.createImportedTask(d.createInitialState(),options),s=item(state);state=d.saveReview(state,s.id,{...draft('不符合'),ruleId:'OWN'},now);state=d.confirmReview(state,s.id,now);
  const stats=d.getDashboard(state,{period:'batch',taskId:s.taskId});assert.equal(stats.issueCount,1);assert.equal(stats.problemSessions,1);assert.equal(stats.ruleCounts.find(r=>r.ruleId==='OWN').count,1);assert.equal(stats.distribution.find(c=>c.label==='新类别').count,1);
  const manual=d.scopeState(state,'manual');assert.equal(manual.tasks.length,1);assert.equal(manual.sessions.length,1);assert.equal(manual.activity.length,3);
  const reset=d.resetDemoState(state);assert.equal(reset.tasks.filter(t=>t.mode==='manual').length,1);assert.deepEqual(item(reset),item(state));assert.equal(reset.activity.filter(e=>e.taskId===s.taskId).length,3);
  const next=d.markPending(reset,s.id,'等待补充',now);assert.equal(new Set(next.activity.map(e=>e.id)).size,next.activity.length);assert.equal(d.scopeState(next,'demo').sessions.length,32);
});
test('categories come from each task snapshot even when an existing rule changes category between batches',async()=>{
  const {options}=await setup();let state=d.createImportedTask(d.createInitialState(),options),first=item(state);
  state=d.saveReview(state,first.id,draft('不符合'),now);state=d.confirmReview(state,first.id,now);
  const second=structuredClone(options);second.sessions[0].id='真实-2';second.basisSnapshot.rules[0].category='第二类别';
  state=d.createImportedTask(state,second);const current=item(state);state=d.saveReview(state,current.id,draft('不符合'),now);state=d.confirmReview(state,current.id,now);
  const stats=d.getDashboard(d.scopeState(state,'manual'),{period:'all',repeatImports:'include'});
  assert.equal(stats.distribution.reduce((sum,c)=>sum+c.count,0),2);assert.equal(stats.distribution.find(c=>c.label==='第二类别').count,1);assert.equal(stats.distribution.find(c=>c.label==='产品信息').count,1);
});
test('business state is deeply detached and internal task/session/activity ids survive restored state collisions',async()=>{
  const {options}=await setup(),before=d.createInitialState();before.activity=[{id:'ACT-2',action:'保留活动',at:now}];
  before.sessions.push({...structuredClone(before.sessions[0]),id:'TASK-IMPORT-20261029-1-S1'});
  options.sessions.push({...session(),id:'真实-2'});
  const state=d.createImportedTask(before,options),task=state.tasks[0];
  assert.equal(new Set(state.sessions.map(s=>s.id)).size,state.sessions.length);assert.equal(new Set(state.activity.map(e=>e.id)).size,state.activity.length);
  options.sessions[0].turns[0].text='外部修改';options.basisSnapshot.policies[0].sections[0].text='外部目录修改';options.source.name='外部修改.json';
  assert.equal(state.sessions.find(s=>s.taskId===task.id).turns[0].text,'这是一段全新的业务原文。');assert.equal(task.source.name,'新材料.json');assert.notEqual(task.basisSnapshot.policies[0].sections[0].text,'外部目录修改');
});
test('manual confirmations do not dilute the existing AI correction rate in a mixed state',async()=>{
  const {options}=await setup(),initial=d.createInitialState(),baseline=d.getDashboard(initial,{period:'all'});
  let state=d.createImportedTask(initial,options);const s=item(state);state=d.saveReview(state,s.id,draft(),now);state=d.confirmReview(state,s.id,now);
  const mixed=d.getDashboard(state,{period:'all'});assert.equal(mixed.changedCount,baseline.changedCount);assert.equal(mixed.changeRate,baseline.changeRate);assert.equal(mixed.aiProcessed,baseline.aiProcessed);
});
test('import accepts parser timestamps with microseconds while preserving their original precision',async()=>{
  const {options}=await setup();options.sessions[0].startedAt='2026-10-29T09:00:00.123456Z';options.sessions[0].turns[0].at='2026-10-29T09:00:01.123456789Z';
  const state=d.createImportedTask(d.createInitialState(),options);assert.equal(item(state).startedAt,options.sessions[0].startedAt);assert.equal(item(state).turns[0].at,options.sessions[0].turns[0].at);
});
test('domain rejects source identifiers and human reasons that the backend cannot persist',async()=>{
  const {options}=await setup(),state=d.createInitialState();
  assert.throws(()=>d.createImportedTask(state,{...options,sessions:[{...session(),id:'I'.repeat(161)}]}),/160|标识/);
  assert.throws(()=>d.createImportedTask(state,{...options,name:'名'.repeat(1001)}),/1000|名称/);
  const added=d.createImportedTask(state,options),s=item(added);assert.throws(()=>d.saveReview(added,s.id,{...draft(),reason:'理'.repeat(20001)},now),/20000|理由/);
});
test('UTC completion timestamps group on the actual Beijing completion date',async()=>{
  const {options}=await setup();let state=d.createImportedTask(d.createInitialState(),options);const s=item(state);
  state=d.saveReview(state,s.id,draft('不符合'),now);state=d.confirmReview(state,s.id,'2026-10-29T17:30:00Z');
  const stats=d.getDashboard(state,{period:'batch',taskId:s.taskId});
  assert.deepEqual(stats.trend,[{label:'2026-10-30',reviewed:1,issues:1,problems:1}]);
});
for(const ruleId of ['constructor','__proto__','toString'])test(`manual rule id ${ruleId} survives empty projection, save, JSON reload, final confirmation and export`,async()=>{
  const {createBasisSnapshot}=await import('../public/task-basis.mjs'),io=await import('../public/io.mjs');
  const catalog=createCatalog();catalog.rules[0].id=ruleId;
  const {options}=await setup();options.basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-10-29',ruleIds:[ruleId],now});
  const before=d.createInitialState();let state=d.createImportedTask(before,options);const s=item(state);
  assert.equal(d.getSessionResults(s)[0].final,null);assert.equal(d.getSessionResults(s)[0].reviewed,false);
  assert.throws(()=>d.confirmReview(state,s.id,now),/逐项|完成/);
  state=d.saveReview(state,s.id,{...draft(),ruleId},now);
  assert.equal(Object.hasOwn(item(state).review.drafts,ruleId),true);assert.equal(item(state).review.history[0].before,null);
  state=JSON.parse(JSON.stringify(state));assert.equal(item(state).review.drafts[ruleId].verdict,'符合');
  state=d.confirmReview(state,s.id,now);assert.equal(item(state).review.status,'已确认');
  assert.equal(validateWorkspace(state,catalog,before,{authenticateNewSnapshots:true}),true);
  const tables=await io.readXlsx(await io.buildResultXlsx(state,{taskId:s.taskId})),[headers,row]=tables['结果明细'];
  assert.equal(row[headers.indexOf('规则标识')],ruleId);assert.equal(row[headers.indexOf('人工最终结论')],'符合');assert.equal(row[headers.indexOf('AI初判')],'');
});
