import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createInitialState,createImportedTask,acceptAI,saveReview,confirmReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createEcommerceSample} from '../public/ecommerce-sample.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {EC_RULE_IDS,ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createSpringAiFetch} from '../server/spring-ai-bridge.mjs';

const base='D:/Codex project/outputs/service-business-upgrade-20261103';
const semantic=session=>({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'虚构逐行语义检查',evidence:session.turns.map(t=>t.id),referenceIds:[]})),modelId:'fixture'});
async function setup(t,inspect,count=3,commonAdmin=false,options={}){
 await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/row-queue-'),store=await createWorkspaceStore({dataDir:dir});
 const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'fixture.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
 if(commonAdmin)for(const s of parsed.sessions){s.ecommerce.raw[11]='同一虚构管理员';s.ecommerce.raw[9]+=' 虚构记录'+s.ecommerce.row;Object.assign(s,ecommerceSourceProjection(s.ecommerce));}
 const source=await store.putSource(bytes,'fixture.xlsx'),catalog=ensureEcommerceCatalog(createCatalog());
 // Checkpoint, pause and credential-recovery cases require undispatched rows;
 // keep this fixture explicitly serial rather than relying on new-task defaults.
 const state=createImportedTask(createInitialState(),{name:'虚构逐行队列',reviewer:'审核员',executionSettings:{concurrency:1},sessions:parsed.sessions.slice(0,count),source,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS})});
 await store.save({state,catalog,baseRevision:0,mutationId:'initial'});
 const calls=[],client={inspectEcommerceRow:async request=>{calls.push(request);return inspect?inspect(request,calls.length):semantic(request.session);},compareEcommerceReplies:async({block,plan})=>({similarPairs:[],checkedIds:block.representativeIds})};
 let privateConfig={connectionTested:true,apiKey:'fixture-never-network',model:'fixture',...options.config};
 const config={getPrivate:()=>structuredClone(privateConfig)};
 let ai=await createAiService({store,modelConfig:config,client,retryDelayMs:1,maxAttempts:1});
 t.after(async()=>{await ai.close();await store.close();await fs.rm(dir,{recursive:true,force:true});});
 return{store,taskId:state.tasks[0].id,calls,client,changeConfig(changes){privateConfig={...privateConfig,...changes};},get ai(){return ai;},async restart(){await ai.close();ai=await createAiService({store,modelConfig:config,client,retryDelayMs:1,maxAttempts:1});}};
}

const legacyBaseUrl='https://ark.cn-beijing.volces.com/api/plan/v3';
const maasSettings={baseUrl:'http://127.0.0.1:54321/v1',model:'GLM-测试模型',authMode:'none',timeoutMs:180000,reasoningEffort:'high',maxTokens:32000};
test('MaaS none-auth starts without a key and freezes only the safe complete model configuration',async t=>{
 const f=await setup(t,undefined,3,false,{config:{...maasSettings,apiKey:null,configured:true}});
 await f.ai.start(f.taskId,'maas-none');await f.ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(task.aiStatus,'completed');assert.deepEqual(task.aiRun.modelConfig,maasSettings);assert.match(task.aiRun.modelConfigFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(task.aiQueue.modelConfigFingerprint,task.aiRun.modelConfigFingerprint);
 for(const request of f.calls){assert.deepEqual(request.config,{...maasSettings,apiKey:null});assert.equal(request.session.review,undefined);}
 assert.doesNotMatch(JSON.stringify(task),/fixture-never-network|apiKey|authorization/i);
});
test('MaaS persisted run snapshots reject credentials, incomplete fields and mismatched fingerprints',async t=>{
 const f=await setup(t,undefined,1);await f.ai.start(f.taskId,'maas-snapshot-validation');await f.ai.waitForIdle();
 for(const corrupt of [task=>{task.aiRun.modelConfig.apiKey='must-never-save';},task=>{delete task.aiRun.modelConfig.timeoutMs;},task=>{task.aiRun.modelConfig.maxTokens=64000;},task=>{task.aiQueue.modelConfigFingerprint='0'.repeat(64);}]){
  await assert.rejects(f.store.updateAI(({state,catalog})=>{corrupt(state.tasks[0]);return{state,catalog};}),/配置|指纹/);
 }
 const task=(await f.store.read()).state.tasks[0];assert.equal(task.aiRun.modelConfig.timeoutMs,120000);assert.equal(task.aiRun.modelConfig.maxTokens,null);assert.doesNotMatch(JSON.stringify(task),/must-never-save/);
});
test('MaaS resume requires the frozen public parameters while accepting a rotated key',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),called=new Promise(r=>entered=r);
 const original={...maasSettings,authMode:'bearer'};
 const f=await setup(t,async(r,n)=>{if(n===1){entered();await gate;}return semantic(r.session);},3,false,{config:original});
 await f.ai.start(f.taskId,'maas-frozen');await called;await f.ai.pause(f.taskId);release();await f.ai.waitForIdle();
 f.changeConfig({model:'changed-model',timeoutMs:1000,reasoningEffort:'low',maxTokens:16,apiKey:'rotated-fixture-key'});
 await f.restart();await assert.rejects(f.ai.resume(f.taskId),/冻结配置/);assert.equal(f.calls.length,1);f.changeConfig({...original,apiKey:'rotated-fixture-key'});await f.ai.resume(f.taskId);await f.ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(task.aiStatus,'completed');assert.deepEqual(task.aiRun.modelConfig,original);
 assert.equal(f.calls.length,3);for(const request of f.calls.slice(1))assert.deepEqual(request.config,{...original,apiKey:'rotated-fixture-key'});
 assert.doesNotMatch(JSON.stringify(task),/rotated-fixture-key|fixture-never-network/);
});
test('MaaS none-auth resumes without forwarding a stale key and keeps its frozen options',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),called=new Promise(r=>entered=r);
 const f=await setup(t,async(r,n)=>{if(n===1){entered();await gate;}return semantic(r.session);},3,false,{config:{...maasSettings,apiKey:null}});
 await f.ai.start(f.taskId,'maas-none-resume');await called;await f.ai.pause(f.taskId);release();await f.ai.waitForIdle();
 f.changeConfig({apiKey:'stale-fixture-key',model:'changed-model',timeoutMs:1000});await assert.rejects(f.ai.resume(f.taskId),/冻结配置/);assert.equal(f.calls.length,1);f.changeConfig({...maasSettings,apiKey:'stale-fixture-key'});await f.ai.resume(f.taskId);await f.ai.waitForIdle();
 assert.equal((await f.store.read()).state.tasks[0].aiStatus,'completed');for(const request of f.calls)assert.deepEqual(request.config,{...maasSettings,apiKey:null});
});
test('MaaS Unicode model names honor the 160 codepoint contract in persisted runs',async t=>{
 const model='𝒜'.repeat(160),f=await setup(t,undefined,1,false,{config:{model}});
 await f.ai.start(f.taskId,'maas-unicode');await f.ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(task.aiStatus,'completed');assert.equal(task.aiRun.modelConfig.model,model);
});
for(const changes of [{baseUrl:'http://another-fixture.invalid/v1'},{authMode:'none',apiKey:null}])test(`MaaS resume blocks changed credential destination ${Object.keys(changes)[0]}`,async t=>{
 const f=await setup(t,()=>{throw Object.assign(new Error('fixture'),{code:'AUTHENTICATION'});},3,false,{config:{...maasSettings,authMode:'bearer'}});
 await f.ai.start(f.taskId,'maas-guard');await f.ai.waitForIdle();const before=(await f.store.read()).state.tasks[0];f.changeConfig(changes);
 await assert.rejects(f.ai.resume(f.taskId),/地址|认证|恢复原|新运行/);assert.equal(f.calls.length,1);assert.deepEqual((await f.store.read()).state.tasks[0],before);
});
for(const changes of [{baseUrl:'http://another-fixture.invalid/v1'},{model:'another-model'},{authMode:'none',apiKey:null},{timeoutMs:120001},{reasoningEffort:'low'},{maxTokens:64000}])test(`MaaS preserves published partial results and requires reinspection after ${Object.keys(changes)[0]} changes`,async t=>{
 const f=await setup(t,undefined,3,true,{config:{...maasSettings,authMode:'bearer'}});let comparisons=0;
 f.client.compareEcommerceReplies=async({block})=>{comparisons++;if(comparisons===2)throw Object.assign(new Error('fixture'),{code:'TIMEOUT'});return{similarPairs:[],checkedIds:block.representativeIds};};
 await f.ai.start(f.taskId,'maas-cache-first',{batchSize:1});await f.ai.waitForIdle();const first=(await f.store.read()).state.tasks[0];
 assert.equal(first.aiQueue.rows.filter(r=>r.semanticResult).length,3);assert.equal(first.aiQueue.comparison.blocks.filter(b=>b.status==='completed').length,2);
 f.changeConfig(changes);await assert.rejects(f.ai.start(f.taskId,'maas-cache-changed'),/继续原运行|重检/);const task=(await f.store.read()).state.tasks[0];
 assert.equal(task.aiStatus,'partial');assert.equal(f.calls.length,3);assert.equal(comparisons,3);assert.equal(task.aiQueue.fingerprint,first.aiQueue.fingerprint);assert.equal(task.aiRun.modelConfigFingerprint,first.aiRun.modelConfigFingerprint);
});
test('MaaS scheduling changes cannot discard published partial results',async t=>{
 const f=await setup(t,undefined,3,true);let comparisons=0;
 f.client.compareEcommerceReplies=async()=>{comparisons++;throw Object.assign(new Error('fixture'),{code:'TIMEOUT'});};
 await f.ai.start(f.taskId,'maas-settings-first',{batchSize:1});await f.ai.waitForIdle();const first=(await f.store.read()).state.tasks[0];
 f.client.compareEcommerceReplies=async({block})=>{comparisons++;return{similarPairs:[],checkedIds:block.representativeIds};};
 await assert.rejects(f.ai.start(f.taskId,'maas-settings-second',{batchSize:2}),/继续原运行|重检/);await f.ai.resume(f.taskId);await f.ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(f.calls.length,3);assert.equal(task.aiQueue.fingerprint,first.aiQueue.fingerprint);assert.equal(task.aiStatus,'completed');
});
test('MaaS unchanged safe configuration reuses partial rows and comparison blocks after key rotation',async t=>{
 const f=await setup(t,undefined,3,true,{config:{...maasSettings,authMode:'bearer'}});let comparisons=0;
 f.client.compareEcommerceReplies=async({block})=>{comparisons++;if(comparisons===2)throw Object.assign(new Error('fixture'),{code:'TIMEOUT'});return{similarPairs:[],checkedIds:block.representativeIds};};
 await f.ai.start(f.taskId,'maas-same-first',{batchSize:1});await f.ai.waitForIdle();const first=(await f.store.read()).state.tasks[0];
 f.changeConfig({apiKey:'rotated-fixture-key'});await f.ai.start(f.taskId,'maas-same-retry');await f.ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(task.aiStatus,'completed');assert.equal(f.calls.length,3);assert.equal(comparisons,4);assert.equal(task.aiQueue.fingerprint,first.aiQueue.fingerprint);assert.equal(task.aiRun.modelConfigFingerprint,first.aiRun.modelConfigFingerprint);
});
test('MaaS configuration changes preserve completed records and human drafts while retrying only eligible rows',async t=>{
 const f=await setup(t,(r,n)=>{if(n===2)throw Object.assign(new Error('fixture'),{code:'TIMEOUT'});return semantic(r.session);});
 let doc=await f.store.read();const protectedSession=doc.state.sessions.filter(s=>s.taskId===f.taskId)[2];
 doc.state=saveReview(doc.state,protectedSession.id,{ruleId:'EC-TIME',verdict:'符合',reason:'审核员核对原始时间。',evidence:[1],referenceIds:[]});await f.store.save({...doc,baseRevision:doc.revision,mutationId:'human-before-ai'});
 await f.ai.start(f.taskId,'maas-protect-first');await f.ai.waitForIdle();doc=await f.store.read();const completed=structuredClone(doc.state.sessions.find(s=>s.aiExecution?.status==='completed')),humanReview=structuredClone(doc.state.sessions.find(s=>s.id===protectedSession.id).review);
 f.changeConfig(maasSettings);await f.ai.start(f.taskId,'maas-protect-retry');await f.ai.waitForIdle();doc=await f.store.read();
 assert.equal(f.calls.length,3);assert.deepEqual(doc.state.sessions.find(s=>s.id===completed.id),completed);assert.deepEqual(doc.state.sessions.find(s=>s.id===protectedSession.id).review,humanReview);assert.ok(!f.calls.some(r=>r.session.id===protectedSession.id));
});
test('legacy no-snapshot resume stays on old Ark defaults and rejects a newly configured custom gateway',async t=>{
 const f=await setup(t,()=>{throw Object.assign(new Error('fixture'),{code:'AUTHENTICATION'});});
 await f.ai.start(f.taskId,'legacy-run');await f.ai.waitForIdle();await f.store.updateAI(({state,catalog})=>{const task=state.tasks[0];delete task.aiRun.modelConfig;delete task.aiRun.modelConfigFingerprint;delete task.aiQueue.modelConfigFingerprint;return{state,catalog};});
 f.changeConfig({baseUrl:'http://new-fixture.invalid/v1'});await assert.rejects(f.ai.resume(f.taskId),/地址|恢复原|新运行/);assert.equal(f.calls.length,1);
 f.changeConfig({baseUrl:legacyBaseUrl,timeoutMs:290000,reasoningEffort:'max',maxTokens:65536});f.client.inspectEcommerceRow=async request=>{f.calls.push(request);return semantic(request.session);};
 await assert.rejects(f.ai.resume(f.taskId),/冻结配置/);assert.equal(f.calls.length,1);f.changeConfig({timeoutMs:120000,reasoningEffort:null,maxTokens:null});
 await f.ai.resume(f.taskId);await f.ai.waitForIdle();for(const request of f.calls.slice(1))assert.deepEqual(request.config,{baseUrl:legacyBaseUrl,model:'fixture',authMode:'bearer',timeoutMs:120000,reasoningEffort:null,maxTokens:null,apiKey:'fixture-never-network'});
 assert.equal((await f.store.read()).state.tasks[0].aiStatus,'completed');
});
test('ecommerce dispatches a separately projected row, persists successes and retries only failed rows',async t=>{
 const f=await setup(t,(r,n)=>{if(n===2)throw Object.assign(new Error('private provider response'),{code:'TIMEOUT'});return semantic(r.session);});
 await f.ai.start(f.taskId,'row-first',{batchSize:1});await f.ai.waitForIdle();
 let doc=await f.store.read(),q=doc.state.tasks[0].aiQueue;
 assert.equal(f.calls.length,3);assert.equal(q.batches.length,3);assert.equal(q.rows.filter(r=>r.status==='failed').length,1);
 assert.equal(doc.state.tasks[0].aiRun.done,2);assert.equal(doc.state.tasks[0].aiRun.failed,1);
 for(const request of f.calls){assert.equal(request.sessions,undefined);assert.equal(request.session.ecommerce,undefined);assert.equal(request.session.review,undefined);assert.equal(request.basis.rules.length,4);}
 const ids=f.calls.map(r=>r.session.id);await f.ai.start(f.taskId,'row-retry');await f.ai.waitForIdle();
 assert.equal(f.calls.length,4);assert.equal(f.calls[3].session.id,ids[1]);
 doc=await f.store.read();assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.equal(doc.state.tasks[0].aiQueue.rows.length,3);
});
test('pause drains the in-flight row, persists the cursor and restart resume never repeats cached success',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),called=new Promise(r=>entered=r);
 const f=await setup(t,async(r,n)=>{if(n===1){entered();await gate;}return semantic(r.session);});
 await f.ai.start(f.taskId,'row-pause',{batchSize:1});await called;
 await f.ai.pause(f.taskId);release();await f.ai.waitForIdle();let doc=await f.store.read();
 assert.equal(f.calls.length,1);assert.equal(doc.state.tasks[0].aiQueue.status,'paused');assert.equal(doc.state.tasks[0].aiQueue.rows[0].status,'completed');
 await f.restart();assert.equal(f.calls.length,1);await f.ai.resume(f.taskId);await f.ai.waitForIdle();
 assert.equal(f.calls.length,3);doc=await f.store.read();assert.equal(doc.state.tasks[0].aiStatus,'completed');
});
test('authentication stops new dispatch and leaves unstarted rows pending rather than failed',async t=>{
 const f=await setup(t,()=>{throw Object.assign(new Error('PRIVATE'),{code:'AUTHENTICATION'});});
 await f.ai.start(f.taskId,'row-auth');await f.ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(f.calls.length,1);assert.equal(task.aiQueue.rows.filter(r=>r.status==='pending').length,2);assert.equal(task.aiRun.failed,1);assert.equal(task.aiQueue.stopReason,'authentication');
});
test('comparison failure keeps successful row cache and retry resumes only missing comparison work',async t=>{
 const f=await setup(t,undefined,18,true);let comparisons=0;
 f.client.compareEcommerceReplies=async({block})=>{comparisons++;throw Object.assign(new Error('PRIVATE'),{code:'TIMEOUT'});};
 await f.ai.start(f.taskId,'compare-failed');await f.ai.waitForIdle();let doc=await f.store.read();
 assert.equal(f.calls.length,18);assert.equal(doc.state.tasks[0].aiQueue.rows.filter(r=>r.semanticResult).length,18);assert.ok(comparisons>0);assert.equal(doc.state.tasks[0].aiQueue.comparison.status,'failed');
 assert.ok(doc.state.sessions.filter(s=>s.taskId===f.taskId).every(s=>s.aiResults.length===5));
 f.client.compareEcommerceReplies=async({block})=>({similarPairs:[],checkedIds:block.representativeIds});
 await f.ai.start(f.taskId,'compare-retry');await f.ai.waitForIdle();doc=await f.store.read();
 assert.equal(f.calls.length,18);assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.equal(doc.state.tasks[0].aiRun.done,18);
});
test('finite automatic backoff retries one transient row and does not retry completed rows',async t=>{
 const f=await setup(t);await f.ai.close();let attempt=0;
 const ai=await createAiService({store:f.store,client:{...f.client,inspectEcommerceRow:async request=>{attempt++;if(attempt<2)throw Object.assign(new Error('PRIVATE'),{code:'TIMEOUT'});return semantic(request.session);}},modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fixture-only',model:'fixture'})},maxAttempts:2,retryDelayMs:1});
 t.after(()=>ai.close());await ai.start(f.taskId,'finite-retry');await ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(attempt,4);assert.equal(task.aiStatus,'completed');assert.deepEqual(task.aiQueue.rows.map(r=>r.attempts),[2,1,1]);assert.equal(task.aiRun.failed,0);
});
test('successful comparison block checkpoints survive retry and only the missing block calls again',async t=>{
 const f=await setup(t,undefined,3,true);let comparisons=0;
 f.client.compareEcommerceReplies=async({block})=>{comparisons++;if(comparisons===2)throw Object.assign(new Error('PRIVATE'),{code:'TIMEOUT'});return{similarPairs:[],checkedIds:block.representativeIds};};
 await f.ai.start(f.taskId,'blocks-first',{batchSize:1});await f.ai.waitForIdle();const first=(await f.store.read()).state.tasks[0];
 assert.equal(first.aiQueue.comparison.blocks.length,3);assert.equal(comparisons,3);assert.equal(first.aiQueue.comparison.blocks.filter(b=>b.status==='completed').length,2);
 await f.ai.start(f.taskId,'blocks-retry');await f.ai.waitForIdle();const last=(await f.store.read()).state.tasks[0];
 assert.equal(f.calls.length,3);assert.equal(comparisons,4);assert.equal(last.aiStatus,'completed');assert.deepEqual(last.aiQueue.comparison.blocks.map(b=>b.attempts),[1,2,1]);
});
test('local storage failure stops dispatch without spending provider retry attempts or inventing business failure',async t=>{
 const f=await setup(t);await f.ai.close();let injected=false;
 // Inject at the semantic-result checkpoint rather than assuming a fixed number
 // of preparatory writes; task scheduling now has its own durable checkpoints.
 const wrapper={read:()=>f.store.read(),updateAI:operation=>f.store.updateAI(async doc=>{const next=await operation(doc);if(!injected&&f.calls.length===1&&next.state.tasks.find(task=>task.id===f.taskId)?.aiQueue?.rows.some(row=>row.semanticResult)){injected=true;throw Object.assign(new Error('fixture disk failure'),{code:'EIO'});}return next;})};
 const ai=await createAiService({store:wrapper,client:f.client,modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fixture-only',model:'fixture'})},maxAttempts:2,retryDelayMs:1});t.after(()=>ai.close());
 await ai.start(f.taskId,'disk-error');await ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(f.calls.length,1);assert.equal(task.aiQueue.status,'paused');assert.equal(task.aiQueue.stopReason,'storage_error');assert.equal(task.aiRun.failed,0);assert.match(ai.runtime().error,/存储/);
});
test('comparison dependency allows adoption of row results including unknown TARGET and rejects forged AI verdicts',async t=>{
 const f=await setup(t,undefined,3,true);f.client.compareEcommerceReplies=async()=>{throw Object.assign(new Error('PRIVATE'),{code:'TIMEOUT'});};
 await f.ai.start(f.taskId,'review-dependency');await f.ai.waitForIdle();let doc=await f.store.read();const session=doc.state.sessions.find(s=>s.taskId===f.taskId);
 assert.equal(session.aiExecution.status,'completed');const accepted=acceptAI(doc.state,session.id);assert.equal(accepted.sessions.find(s=>s.id===session.id).review.drafts['EC-TARGET'].verdict,'无法判定');
 const makeDraft=ruleId=>({ruleId,verdict:'符合',reason:'审核员独立核对原文及完整冻结依据。',evidence:session.turns.map(t=>t.id),referenceIds:[]});
 const forged=structuredClone(doc);const item=forged.state.sessions.find(s=>s.id===session.id);item.review.drafts=Object.fromEntries(session.expectedRuleIds.map(ruleId=>[ruleId,{...makeDraft(ruleId),source:'AI接受'}]));item.review.status='已暂存';
 await assert.rejects(f.store.save({...forged,baseRevision:doc.revision,mutationId:'forged-ai-adoption'}),/完整|接受AI/);
 for(const ruleId of session.expectedRuleIds)doc.state=saveReview(doc.state,session.id,makeDraft(ruleId));doc.state=confirmReview(doc.state,session.id);
 await f.store.save({...doc,baseRevision:doc.revision,mutationId:'explicit-independent-review'});doc=await f.store.read();
 assert.equal(doc.state.sessions.find(s=>s.id===session.id).review.status,'已确认');assert.ok(Object.values(doc.state.sessions.find(s=>s.id===session.id).review.drafts).every(d=>d.source==='人工修改'));
});

for(const engine of ['native-node','spring-ai'])for(const status of [400,404,422])test(`${engine} upstream ${status} stops a three-row queue after one call and preserves pending work`,async t=>{
 const f=await setup(t);await f.ai.close();let calls=0,rejected=true;
 const transport=async(url,options)=>{calls++;if(engine==='spring-ai')assert.match(url,/^http:\/\/127\.0\.0\.1:4192\/internal\/chat\/completions$/);if(rejected)return new Response('PRIVATE_PROVIDER_BODY_fixture-only-key',{status});const input=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:semantic(input.session).results})}}]}));};
 const client=createArkClient({fetchImpl:engine==='spring-ai'?createSpringAiFetch({bridgeToken:'x'.repeat(64),fetchImpl:transport}):transport});
 const ai=await createAiService({store:f.store,client,modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fixture-only-key',model:'fixture'})},retryDelayMs:1});t.after(()=>ai.close());
 await ai.start(f.taskId,`rejected-${engine}-${status}`);await ai.waitForIdle();let task=(await f.store.read()).state.tasks[0];
 assert.equal(calls,1);assert.equal(task.aiQueue.stopReason,'request_rejected');assert.deepEqual(task.aiQueue.rows.map(r=>r.status),['failed','pending','pending']);assert.deepEqual(task.aiQueue.rows.map(r=>r.attempts),[1,0,0]);assert.equal(task.aiRun.failed,1);assert.equal(task.aiQueue.rows[0].errorCode,'request_rejected');assert.doesNotMatch(task.aiQueue.rows[0].error,/PRIVATE_PROVIDER_BODY|fixture-only-key/);
 rejected=false;await ai.resume(f.taskId);await ai.waitForIdle();task=(await f.store.read()).state.tasks[0];assert.equal(task.aiStatus,'completed');assert.equal(calls,4);
});

test('non-transient comparison rejection stops later blocks while preserving successful row cache',async t=>{
 const f=await setup(t,undefined,3,true);await f.ai.close();let rowCalls=0,comparisonCalls=0;
 const client=createArkClient({fetchImpl:async(_,options)=>{const input=JSON.parse(JSON.parse(options.body).messages[1].content);if(input.session){rowCalls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:semantic(input.session).results})}}]}));}comparisonCalls++;return new Response('PRIVATE_REJECTION',{status:400});}});
 const ai=await createAiService({store:f.store,client,modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fixture-only-key',model:'fixture'})},retryDelayMs:1});t.after(()=>ai.close());
 await ai.start(f.taskId,'comparison-rejected',{batchSize:1});await ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(rowCalls,3);assert.equal(comparisonCalls,1);assert.equal(task.aiQueue.stopReason,'request_rejected');assert.deepEqual(task.aiQueue.comparison.blocks.map(b=>b.status),['failed','pending','pending']);assert.ok(task.aiQueue.rows.every(r=>r.semanticResult));assert.equal(task.aiRun.failed,0);
});

for(const status of [408,429,503])test(`transient upstream ${status} retries the affected row within the finite budget and continues`,async t=>{
 const f=await setup(t);await f.ai.close();let calls=0;
 const client=createArkClient({fetchImpl:async(_,options)=>{calls++;if(calls===1)return new Response('PRIVATE_TRANSIENT_BODY',{status});const input=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:semantic(input.session).results})}}]}));}});
 const ai=await createAiService({store:f.store,client,modelConfig:{getPrivate:()=>({connectionTested:true,apiKey:'fixture-only-key',model:'fixture'})},retryDelayMs:1});t.after(()=>ai.close());
 await ai.start(f.taskId,`transient-${status}`);await ai.waitForIdle();const task=(await f.store.read()).state.tasks[0];
 assert.equal(calls,4);assert.equal(task.aiStatus,'completed');assert.deepEqual(task.aiQueue.rows.map(r=>r.attempts),[2,1,1]);assert.equal(task.aiQueue.stopReason,undefined);assert.equal(task.aiRun.failed,0);
});
