import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {isAIFinal} from '../public/ai-triage.mjs';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createBusinessState,createImportedTask,saveReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {migrateSceneConfigurations,sceneConfigurationMutation} from '../server/scene-configuration-service.mjs';
import {sceneBasisForTask} from '../public/scene-configuration.mjs';
import {freezeNativeLanguage,freezeTaskLanguageContract} from '../server/native-language-materials.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {nativePolicy} from './native-language-fixture.mjs';
import {materialSet,config,modelEnvelope,capabilityBody,ruleBody} from './native-language-stage2-fixture.mjs';
const at='2026-11-25T01:00:00Z',scratch=path.resolve(process.env.R39_VERIFY_DIR||'../outputs/service-r39-step2-20261125/test-workspaces');
export async function setup(t,{language='en',wrongFirst=false,count=2,forcedLanguage,capLanguage,dependencies=true}={}){
 await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'native-run-'));let store=await createWorkspaceStore({dataDir:dir,nativeLanguageStage:2}),ai;const traceStore=await createWorkflowTraceStore({dataDir:dir});let hook=null,privateConfig=config;
 t.after(async()=>{await ai?.close();await traceStore.close();await store.close();assert.ok(dir.startsWith(scratch+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 let d=migrateSceneConfigurations({state:createBusinessState(),catalog:createCatalog()},{now:at});
 // Synthetic source fixture, not a production scene publication or NP criterion set.
 const c=d.state.sceneConfigurations.find(c=>c.sceneId==='新品产品咨询');c.executionMode='configured';
 c.capabilities=[{key:'demandSummary',phase:'pre',executorVersion:'scene-capability.v1',dependsOn:[]}];
 c.ruleDependencies=Object.fromEntries(c.ruleBindings.map(r=>[r.ruleId,dependencies?['demandSummary']:[]]));
 await store.save({baseRevision:0,mutationId:'initial',...d});await store.enableLanguageGovernance();let view=await store.read();await store.selectLanguage({baseRevision:view.revision,operationId:'select',actor:'synthetic',language});
 view=await store.read();const source=await store.putSource(Buffer.from('Synthetic unchanged source file'),'synthetic.json'),basis=sceneBasisForTask(view.state,view.catalog,'新品产品咨询',at);
 const sessions=Array.from({length:count},(_,i)=>({id:'SYN-'+i,scene:'新品产品咨询',startedAt:at,topic:'Synthetic request',channel:'Synthetic channel',product:'Synthetic phone',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'Synthetic customer',at:'',text:'هل توجد نسخة زرقاء؟'},{id:2,role:'客服',speaker:'Synthetic agent',at:'',text:'Sí, existe una versión azul.'}]}));
 const state=createImportedTask(view.state,{name:'Synthetic native pipeline',source,sessions,basisSnapshot:basis,reviewer:'Synthetic reviewer',sceneRuntime:{outputLanguages:[language]},sceneOverrideReason:'Synthetic native language',now:at});
 let task=state.tasks.at(-1);task.executionSnapshot.configuration.inspectionLanguage=language;
 const materials=materialSet(basis,task.executionSnapshot),frozen=freezeNativeLanguage(nativePolicy(language),{materials,promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});
 for(const material of materials){view=await store.read();await store.publishLanguageMaterial({baseRevision:view.revision,operationId:'publish-'+material.id,material});}
 view=await store.read();await store.freezeLanguageMaterial({baseRevision:view.revision,operationId:'freeze',materialHashes:materials.map(m=>m.contentHash),promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',actor:'synthetic',reason:'Synthetic native task freeze'});
 view=await store.read();for(const key of ['languageMaterials','languageAudit'])state[key]=view.state[key];task=freezeTaskLanguageContract(task,view.state.workspaceSettings.languagePolicy,frozen);state.tasks[state.tasks.length-1]=task;
 await store.save({baseRevision:view.revision,mutationId:'create-native-task',state,catalog:view.catalog});
 const requests=[],attempts=new Map();const client=createArkClient({fetchImpl:async(_u,o)=>{const request=JSON.parse(o.body),data=JSON.parse(request.messages[1].content);requests.push(request);const id=data.session?.id||'cap-'+requests.length,n=(attempts.get(id)||0)+1;attempts.set(id,n);if(hook){const fn=hook;hook=null;await fn();}return modelEnvelope(data.capability?capabilityBody(data,capLanguage||forcedLanguage||language):ruleBody(data,forcedLanguage||(wrongFirst&&n===1?(language==='en'?'zh':'en'):language)));}});
 const modelConfig={getPrivate:()=>privateConfig};ai=await createAiService({store,modelConfig,client,traceStore,maxAttempts:2,retryDelayMs:0});
 return{store,ai,task,requests,dir,traceStore,setHook(value){hook=value;},setConfig(value){privateConfig=value;},setOutputLanguage(value){forcedLanguage=value;},setCapabilityLanguage(value){capLanguage=value;},async reopen(){await ai.close();await store.close();store=await createWorkspaceStore({dataDir:dir,nativeLanguageStage:2});return store;}};
}
test('R39 step2 persisted native batch retries wrong language and reopens exact frozen scope',async t=>{
 const f=await setup(t,{wrongFirst:true});await f.ai.start(f.task.id,'synthetic-run');await f.ai.waitForIdle();
 const view=await f.store.read(),task=view.state.tasks.find(t=>t.id===f.task.id),rows=view.state.sessions.filter(s=>s.taskId===f.task.id);
 assert.equal(task.aiStatus,'completed');assert.equal(rows.length,2);
 for(const row of rows){assert.equal(row.aiExecution.status,'completed');assert.ok(row.aiResults.every(r=>r.languageValidation.status==='verified'));assert.equal(isAIFinal(row),false);assert.equal(row.turns[0].text,'هل توجد نسخة زرقاء؟');}
 assert.equal(f.requests.filter(r=>JSON.parse(r.messages[1].content).basis).length,4);
 assert.ok(f.requests.some(r=>r.messages[0].content.includes('previous output failed')));
 const reopened=await f.reopen(),old=await reopened.readNativeMaterial(task);assert.equal(old.languageExecution.contentLanguage,'en');assert.deepEqual((await reopened.read()).state.sessions,view.state.sessions);
});
test('R39 step2 explicit row language retry preserves prior candidates and never changes other rows or source',async t=>{
 const f=await setup(t,{forcedLanguage:'zh'});await f.ai.start(f.task.id,'synthetic-wrong-language');await f.ai.waitForIdle();
 const before=await f.store.read(),rows=before.state.sessions.filter(s=>s.taskId===f.task.id);assert.ok(rows[0].aiResults.every(r=>r.languageValidation.status==='mismatch'));
 assert.equal(before.state.tasks.find(t=>t.id===f.task.id).capabilityMonitor.demandSummary.technicalFailures,0);
 f.setOutputLanguage('en');await f.ai.retryNativeLanguage(f.task.id,rows[0].id);
 const after=await f.store.read(),changed=after.state.sessions.find(s=>s.id===rows[0].id);
 assert.ok(changed.aiResults.every(r=>r.languageValidation.status==='verified'));assert.deepEqual(changed.aiDecisionHistory.at(-1),rows[0].aiDecision);assert.notEqual(changed.aiDecision.decidedAt,rows[0].aiDecision.decidedAt);assert.deepEqual(changed.nativeLanguageRetryHistory[0].beforeResults,rows[0].aiResults);assert.deepEqual(changed.turns,rows[0].turns);
 const trace=await f.traceStore.read(changed.nativeLanguageRetryHistory[0].traceId);assert.equal(trace.status,'completed');assert.equal(trace.meta.originalRunId,'synthetic-wrong-language');assert.equal(trace.meta.languageExecution.contentLanguage,'en');assert.ok(trace.nodes.every(n=>n.status==='completed'));
 f.setConfig({...config,model:'changed-model'});await assert.rejects(f.ai.retryNativeLanguage(f.task.id,rows[1].id),/模型或参数已变化/);
 assert.deepEqual(after.state.sessions.find(s=>s.id===rows[1].id),rows[1]);assert.deepEqual(after.state.tasks.find(t=>t.id===f.task.id).executionSnapshot,f.task.executionSnapshot);
 const forged=structuredClone(after.state);forged.sessions.find(s=>s.id===rows[0].id).nativeLanguageRetryHistory=[];await assert.rejects(f.store.save({baseRevision:after.revision,mutationId:'forged-audit',state:forged,catalog:after.catalog}),/server-owned/);
});

test('R39 step2 concurrent human edit protects the row and retains retry only as an audited candidate',async t=>{
 const f=await setup(t,{forcedLanguage:'zh',count:1});await f.ai.start(f.task.id,'synthetic-human-race');await f.ai.waitForIdle();
 const before=await f.store.read(),old=before.state.sessions.find(s=>s.taskId===f.task.id);f.setOutputLanguage('en');let humanRow;
 f.setHook(async()=>{const doc=await f.store.read(),state=saveReview(doc.state,old.id,{ruleId:old.aiResults[0].ruleId,verdict:'不符合',reason:'Synthetic human review takes precedence.',evidence:[2]},new Date().toISOString());await f.store.save({state,catalog:doc.catalog,baseRevision:doc.revision,mutationId:'concurrent-human'});humanRow=state.sessions.find(s=>s.id===old.id);});
 await f.ai.retryNativeLanguage(f.task.id,old.id);const after=(await f.store.read()).state.sessions.find(s=>s.id===old.id);
 assert.deepEqual(after.review,humanRow.review);assert.deepEqual(after.aiResults,old.aiResults);assert.equal(after.nativeLanguageRetryHistory[0].protected,true);assert.ok(after.nativeLanguageRetryHistory[0].afterResults.every(r=>r.languageValidation.status==='verified'));
 await assert.rejects(f.ai.retryNativeLanguage(f.task.id,old.id),/unreviewed/);
});

test('R39 step2 auxiliary-only language findings can be retried even when rule reasons are already native',async t=>{
 const f=await setup(t,{count:1,capLanguage:'zh',dependencies:false});await f.ai.start(f.task.id,'synthetic-cap-only');await f.ai.waitForIdle();
 const row=(await f.store.read()).state.sessions.find(s=>s.taskId===f.task.id);assert.ok(row.aiResults.every(r=>r.languageValidation.status==='verified'));assert.equal(row.sceneCapabilities.outputs.demandSummary.languageValidation.status,'mismatch');
 f.setCapabilityLanguage('en');await f.ai.retryNativeLanguage(f.task.id,row.id);const after=(await f.store.read()).state.sessions.find(s=>s.id===row.id);assert.equal(after.sceneCapabilities.outputs.demandSummary.languageValidation.status,'verified');assert.deepEqual(after.nativeLanguageRetryHistory[0].beforeCapabilities,row.sceneCapabilities);
});
