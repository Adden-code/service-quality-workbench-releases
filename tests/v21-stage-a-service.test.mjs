import test from 'node:test';
import assert from 'node:assert/strict';
import {EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {confirmUnrepliedReview,canConfirmUnreplied,saveReview} from '../public/domain.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {workflowInput,workflowDependencies} from '../server/workflow-contract.mjs';
import {serviceFixture,sourceRow,publishedFixture,basis,cutoff} from './v21-runtime-fixtures.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

const semantic=session=>({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'虚构四项V1检查',evidence:session.turns.map(t=>t.id),referenceIds:[]})),modelId:'fixture'});
test('stage A local facts complete without any model call and server authenticates explicit fact confirmation',async t=>{
 const f=await serviceFixture(t,{sessions:[sourceRow({reply:'',replyAt:''})],inspect:()=>{throw new Error('must never call model');}});
 await f.ai.start(f.taskId,'stage-a-local');await f.ai.waitForIdle();let doc=await f.store.read();const task=doc.state.tasks[0],s=doc.state.sessions[0];
 assert.equal(task.aiStatus,'completed');assert.equal(task.aiRun.inspectionAt,task.aiRun.startedAt);assert.equal(f.calls.length,0);assert.equal(s.aiResults[0].timeFacts.replyStatus,'unreplied');assert.equal(s.aiResults[0].timeFacts.inspectionAt,task.aiRun.inspectionAt);assert.ok(s.aiResults.every(r=>r.verdict==='无法判定'));assert.equal(s.aiExecution.promptVersion,'ec-local-unreplied-v1');
 assert.equal(canConfirmUnreplied(doc.state,s),true);doc.state=confirmUnrepliedReview(doc.state,s.id,'事实审核员');await f.store.save({...doc,baseRevision:doc.revision,mutationId:'unreplied-fact'});doc=await f.store.read();assert.equal(doc.state.sessions[0].review.disposition,'unreplied');
 const forged=structuredClone(doc.state);forged.sessions[0].aiResults[0].timeFacts.elapsedMs=1;assert.throws(()=>validateWorkspace(forged,doc.catalog),/时效|事实|重算/);
});
test('stage A cutoff is frozen through pause/resume and source O plus cutoff affect only local dependencies',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),called=new Promise(r=>entered=r);
 const f=await serviceFixture(t,{sessions:[sourceRow({row:3}),sourceRow({row:4,reply:'第二个虚构回复'})],inspect:async({session},n)=>{if(n===1){entered();await gate;}return semantic(session);}});
 await f.ai.start(f.taskId,'stage-a-frozen');await called;await f.ai.pause(f.taskId);release();await f.ai.waitForIdle();const first=(await f.store.read()).state.tasks[0];assert.ok(first.aiRun.inspectionAt);
 await f.ai.resume(f.taskId);await f.ai.waitForIdle();const doc=await f.store.read(),task=doc.state.tasks[0];assert.equal(task.aiRun.inspectionAt,first.aiRun.inspectionAt);assert.equal(task.aiQueue.fingerprint,first.aiQueue.fingerprint);
 for(const request of f.calls){assert.equal(request.session.ecommerce,undefined);assert.equal(request.session.source,undefined);assert.doesNotMatch(JSON.stringify(request.session),/OLD-HUMAN|OLD-DETAIL|source-column-O|evaluationType|差评/);}
 const row=sourceRow(),dep=workflowDependencies(row,{basis,inspectionAt:cutoff});assert.equal(dep.localTime.source.evaluationType,'差评');assert.equal(workflowInput(row).localTime,undefined);assert.notDeepEqual(dep,workflowDependencies(row,{basis,inspectionAt:'2026-11-03T12:00:00.001+08:00'}));
});
test('stage A preserves published cutoff and requires resume or a new reinspection task',async t=>{
 let comparisons=0;const sessions=[sourceRow({row:3,reply:'虚构回复一'}),sourceRow({row:4,reply:'虚构回复二'})];
 const f=await serviceFixture(t,{sessions,inspect:({session})=>semantic(session),compare:async({block})=>{comparisons++;if(comparisons===1)throw Object.assign(new Error('fixture'),{code:'TIMEOUT'});return{similarPairs:[],checkedIds:block.representativeIds};}});
 await f.ai.start(f.taskId,'stage-a-first');await f.ai.waitForIdle();const first=(await f.store.read()).state.tasks[0];assert.equal(first.aiQueue.rows.filter(r=>r.semanticResult).length,2);
 await new Promise(resolve=>setTimeout(resolve,2));await assert.rejects(f.ai.start(f.taskId,'stage-a-next'),/继续原运行|重检/);await f.ai.resume(f.taskId);await f.ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];assert.equal(task.aiRun.inspectionAt,first.aiRun.inspectionAt);assert.equal(task.aiQueue.fingerprint,first.aiQueue.fingerprint);assert.equal(f.calls.length,2);assert.equal(task.aiStatus,'completed');
});
test('workspace rejects unreplied disposition on legacy/replied/missing-time sources',()=>{
 for(const raw of [sourceRow(),sourceRow({replyAt:''})]){
  const {state,catalog}=publishedFixture([raw]),s=state.sessions[0];s.review.disposition='unreplied';s.review.status='已确认';s.review.completedAt='2026-11-03T13:00:00+08:00';
  assert.throws(()=>validateWorkspace(state,catalog),/未回复|事实/);
 }
 const {state,catalog}=publishedFixture([sourceRow({reply:'',replyAt:''})]);state.tasks[0].basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-03',ruleIds:EC_RULE_IDS});
 state.sessions[0].review={...state.sessions[0].review,disposition:'unreplied',status:'已确认',completedAt:'2026-11-03T13:00:00+08:00'};assert.throws(()=>validateWorkspace(state,catalog),/未回复|事实/);
});
test('stage A missing-time rows still run V1 content checks while keeping time undetermined',async t=>{
 const f=await serviceFixture(t,{sessions:[sourceRow({replyAt:''})],inspect:({session})=>semantic(session)});await f.ai.start(f.taskId,'stage-a-missing-time');await f.ai.waitForIdle();const doc=await f.store.read(),s=doc.state.sessions[0];
 assert.equal(f.calls.length,1);assert.equal(s.aiResults[0].timeFacts.replyStatus,'missing-time');assert.equal(s.aiResults[0].verdict,'无法判定');assert.ok(s.aiResults.slice(1).every(r=>r.verdict==='符合'));assert.equal(canConfirmUnreplied(doc.state,s),false);
});
test('disabled unreplied duration and invalid source time persist as fact-only confirmations',async t=>{
 for(const mode of ['disabled','invalid-start']){
  const f=await serviceFixture(t,{sessions:[sourceRow({reply:'',replyAt:'',...(mode==='invalid-start'?{commentAt:'invalid'}:{})})],ruleSetChanges:mode==='disabled'?{timeRule:{...structuredClone(basis.ruleSetSnapshot.timeRule),unrepliedRule:false}}:{},inspect:()=>{throw new Error('must never call');}});
  await f.ai.start(f.taskId,`stage-a-${mode}`);await f.ai.waitForIdle();let doc=await f.store.read(),s=doc.state.sessions[0];assert.equal(s.aiResults[0].timeFacts.elapsedMs,null);assert.equal(canConfirmUnreplied(doc.state,s),true);
  doc.state=confirmUnrepliedReview(doc.state,s.id,'事实审核员');await f.store.save({...doc,baseRevision:doc.revision,mutationId:`fact-${mode}`});doc=await f.store.read();assert.equal(doc.state.sessions[0].review.disposition,'unreplied');assert.equal(f.calls.length,0);
 }
});
test('server rejects forged cutoff, local policy references and conflicting human fact dispositions',async t=>{
 const f=await serviceFixture(t,{sessions:[sourceRow({reply:'',replyAt:''})],inspect:()=>{throw new Error('must never call');}});await f.ai.start(f.taskId,'stage-a-forge');await f.ai.waitForIdle();const doc=await f.store.read(),s=doc.state.sessions[0];
 await assert.rejects(f.store.updateAI(({state,catalog})=>{state.tasks[0].aiRun.inspectionAt='2026-11-03T10:00:00+08:00';return{state,catalog};}),/截止点|冻结/);
 for(const corrupt of [r=>{r.timeFacts.inspectionAt='2026-11-03T10:00:00+08:00';},r=>{r.referenceIds=['EC-POLICY'];}]){
  const forged=structuredClone(doc.state);corrupt(forged.sessions[0].aiResults[0]);assert.throws(()=>validateWorkspace(forged,doc.catalog),/时效|事实|重算|依据/);
 }
 const forged=confirmUnrepliedReview(doc.state,s.id,'事实审核员');forged.sessions[0].review.drafts['EC-TEXT']={ruleId:'EC-TEXT',verdict:'不符合',reason:'旧人工作业',evidence:[],referenceIds:[],source:'人工修改'};assert.throws(()=>validateWorkspace(forged,doc.catalog),/事实|未回复/);
});
test('new stage A run preserves confirmed facts and existing human drafts while retrying only eligible rows',async t=>{
 const f=await serviceFixture(t,{sessions:[sourceRow({reply:'',replyAt:'',row:3}),sourceRow({row:4}),sourceRow({row:5,reply:'人工保护回复'})],inspect:({session},n)=>{if(n===1)throw Object.assign(new Error('fixture'),{code:'TIMEOUT'});return semantic(session);}});
 let doc=await f.store.read();const protectedId=doc.state.sessions.find(s=>s.ecommerce.row===5).id;doc.state=saveReview(doc.state,protectedId,{ruleId:'EC-TEXT',verdict:'不符合',reason:'已有独立人工审核，不能覆盖。',evidence:[],referenceIds:[]});await f.store.save({...doc,baseRevision:doc.revision,mutationId:'protect-human'});
 await f.ai.start(f.taskId,'stage-a-protected-first');await f.ai.waitForIdle();doc=await f.store.read();const factId=doc.state.sessions.find(s=>s.ecommerce.row===3).id;
 doc.state=confirmUnrepliedReview(doc.state,factId,'事实确认员');await f.store.save({...doc,baseRevision:doc.revision,mutationId:'protect-fact'});doc=await f.store.read();const fact=structuredClone(doc.state.sessions.find(s=>s.id===factId)),human=structuredClone(doc.state.sessions.find(s=>s.id===protectedId));
 await f.ai.start(f.taskId,'stage-a-protected-retry');await f.ai.waitForIdle();doc=await f.store.read();assert.deepEqual(doc.state.sessions.find(s=>s.id===factId),fact);assert.deepEqual(doc.state.sessions.find(s=>s.id===protectedId),human);assert.equal(f.calls.length,2);assert.ok(f.calls.every(call=>call.session.id!==protectedId));
});
test('unreplied local facts remain independently confirmable when unrelated reply comparison fails',async t=>{
 const f=await serviceFixture(t,{sessions:[sourceRow({row:3,reply:'',replyAt:''}),sourceRow({row:4,reply:'虚构回复一'}),sourceRow({row:5,reply:'虚构回复二'})],inspect:({session})=>semantic(session),compare:()=>{throw Object.assign(new Error('fixture'),{code:'TIMEOUT'});}});
 await f.ai.start(f.taskId,'stage-a-independent-fact');await f.ai.waitForIdle();const doc=await f.store.read(),s=doc.state.sessions.find(s=>s.ecommerce.row===3);
 assert.equal(doc.state.tasks[0].aiStatus,'partial');assert.equal(s.aiExecution.status,'completed');assert.equal(s.aiExecution.errorCode,undefined);assert.equal(canConfirmUnreplied(doc.state,s),true);assert.equal(s.aiResults[0].timeFacts.replyStatus,'unreplied');
});
