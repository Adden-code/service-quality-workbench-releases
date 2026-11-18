import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createInitialState,createImportedTask,acceptAI,confirmReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createEcommerceSample} from '../public/ecommerce-sample.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

async function fixture(t,{failFirst=false}={}){
  const base='D:/Codex project/outputs/service-ecommerce-implementation-20261030/',dir=await fs.mkdtemp(base+'service-'),store=await createWorkspaceStore({dataDir:dir});
  const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'完全虚构.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  assert.equal(parsed.valid,true);const source=await store.putSource(bytes,'完全虚构.xlsx'),catalog=ensureEcommerceCatalog(createCatalog());
  const state=createImportedTask(createInitialState(),{name:'EC虚构任务',reviewer:'虚构审核员',sessions:parsed.sessions,source,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS})});
  await store.save({state,catalog,baseRevision:0,mutationId:'initial'});const scopes=[];
  const client={inspectEcommerceRow:async({session:s})=>{
    scopes.push([s.id]);if(failFirst&&scopes.length===1)throw Object.assign(new Error('PRIVATE_PROVIDER_BODY'),{code:'rate_limit'});
    return{results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'确定性虚构语义核对',evidence:s.turns.map(t=>t.id),referenceIds:[]})),modelId:'fictional-model',promptVersion:'ec-row-ark-v1',usage:{total_tokens:72}};
  },compareEcommerceReplies:async({block})=>({similarPairs:[],checkedIds:block.representativeIds})};
  const ai=await createAiService({store,client,maxAttempts:1,modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fictional-mock-key',model:'glm-5.3-flash'})}});
  t.after(async()=>{await ai.close();await store.close();assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
  return{store,ai,scopes,taskId:state.tasks[0].id};
}
test('EC service runs each row separately, compares the complete batch and preserves references',async t=>{
  const f=await fixture(t);await f.ai.start(f.taskId,'ec-run');await f.ai.waitForIdle();let doc=await f.store.read();
  const task=doc.state.tasks[0],sessions=doc.state.sessions.filter(s=>s.taskId===task.id);
  assert.equal(task.aiStatus,'completed');assert.equal(f.scopes.length,18);assert.ok(f.scopes.every(scope=>scope.length===1));
  assert.equal(sessions.reduce((sum,s)=>sum+(s.aiExecution.usage?.total_tokens||0),0),18*72);
  assert.equal(new Set(sessions.map(s=>s.aiExecution.inputSha256)).size,18);
  for(const s of sessions){assert.equal(s.aiResults.length,5);assert.deepEqual(s.review.drafts,{});assert.equal(s.review.status,'待审核');}
  const repeated=sessions.find(s=>s.ecommerce.row===6);assert.equal(repeated.aiResults.find(r=>r.ruleId==='EC-TARGET').verdict,'不符合');
  assert.equal(repeated.aiResults.find(r=>r.ruleId==='EC-TARGET').batchEvidence[0].sessionIds.length,3);
  const noTime=sessions.find(s=>s.ecommerce.row===12);assert.equal(noTime.aiResults.find(r=>r.ruleId==='EC-TIME').verdict,'无法判定');
  const original=structuredClone(sessions[0].ecommerce);
  doc.state=acceptAI(doc.state,sessions[0].id);doc.state=confirmReview(doc.state,sessions[0].id);
  await f.store.save({...doc,baseRevision:doc.revision,mutationId:'human-confirm'});doc=await f.store.read();
  assert.equal(doc.state.sessions.find(s=>s.id===sessions[0].id).review.status,'已确认');assert.deepEqual(doc.state.sessions.find(s=>s.id===sessions[0].id).ecommerce,original);
});
test('EC provider failure affects its row and retry reuses successful rows and comparison blocks',async t=>{
  const f=await fixture(t,{failFirst:true});await f.ai.start(f.taskId,'failed-run');await f.ai.waitForIdle();let doc=await f.store.read();
  assert.equal(doc.state.tasks[0].aiStatus,'partial');const failed=doc.state.sessions.find(s=>s.taskId===f.taskId&&s.aiExecution.status==='failed');assert.deepEqual(failed.aiResults,[]);assert.equal(failed.aiExecution.errorCode,'rate_limit');assert.ok(!failed.aiExecution.error.includes('PRIVATE'));
  await f.ai.start(f.taskId,'retry-run');await f.ai.waitForIdle();doc=await f.store.read();assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.deepEqual(f.scopes[0],f.scopes[18]);
  await f.ai.start(f.taskId,'failed-run');await f.ai.waitForIdle();assert.equal(f.scopes.length,19);
});
