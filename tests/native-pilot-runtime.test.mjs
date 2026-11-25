import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {sceneBasisForTask,freezeSceneExecution} from '../public/scene-configuration.mjs';
import {installSceneSeed} from '../server/scene-seed.mjs';
import {fixture as sceneFixture,row,now,sceneId} from './time01120-fixtures.mjs';
import {materialSet,modelEnvelope,config,ruleBody} from './native-language-stage2-fixture.mjs';
import {syntheticMaterial} from './native-language-fixture.mjs';
import {authorizePilotMaterial,validateBilingualMaterial,languageHash} from '../server/native-language-materials.mjs';
import {nativePilotPromptDraft} from '../server/native-language-prompt-draft.mjs';
import {nativeExecutionContext,nativeSourceConfiguration} from '../server/native-language-execution.mjs';
import {nativeEcommerceProgramResults,nativeEcommerceBatchFacts} from '../server/native-ecommerce-execution.mjs';
import {upgradeEcommerceTargetLimitedBasis} from '../public/ecommerce-semantic-policy.mjs';
import {mergeEcommerceResults} from '../server/ecommerce-engine.mjs';
import {nativeReadinessNotice,nativePilotMaintenanceDialog} from '../public/workspace-language-ui.mjs';
import {workbook} from '../public/io.mjs';
import {EC_HEADERS} from '../public/ecommerce-schema.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {createWorkspaceRestore} from '../server/workspace-restore.mjs';
import {resolveNativeTaskMaterial} from '../server/workspace-language-service.mjs';
import {freezeNativeLanguage} from '../server/native-language-materials.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
const auth={actor:'SYNTHETIC USER AUTHORIZATION',reason:'Synthetic pilot only; business review pending.',authorizationId:'synthetic-pilot',at:now};
const scratch=path.resolve('outputs/native-pilot-runtime-tests');
async function setup(t,language='en',{calibrated=false,activate=true,install=true,fsOps}={}){
 await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'synthetic-')),f=sceneFixture();
 if(calibrated){const p=f.newSeed.packages[1];p.configuration.basis=upgradeEcommerceTargetLimitedBasis(p.configuration.basis);p.configuration.ruleBindings=p.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));for(const col of p.template.columns)if(col.ruleId)col.ruleVersion=p.configuration.ruleBindings.find(r=>r.ruleId===col.ruleId).ruleVersion;}
 let store=await createWorkspaceStore({dataDir:dir,nativeLanguageStage:4,...(fsOps?{fsOps}:{})});let ai;
 t.after(async()=>{await ai?.close();await store.close();assert.ok(dir.startsWith(scratch+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 await store.save({baseRevision:0,mutationId:'setup',state:installSceneSeed(createBusinessState(),f.catalog,f.newSeed,{now}),catalog:f.catalog});
 await store.enableLanguageGovernance();let view=await store.read();await store.selectLanguage({baseRevision:view.revision,operationId:'language',language,actor:auth.actor});
 const bundle={schemaVersion:1,id:'synthetic-pilot',version:'1',authorization:auth,materials:[]};
 view=await store.read();for(const scene of ['新品产品咨询',sceneId]){
  const basis=sceneBasisForTask(view.state,view.catalog,scene,now),snapshot=freezeSceneExecution(view.state,scene,{basis}),template=snapshot.template;
  const rawMaterial=(kind,id,source,ids)=>({...syntheticMaterial(kind,id),version:source?.version||'V1.0',scene,...(source?{sourceHash:languageHash(source)}:{}),shared:{applicabilityIds:[],exceptionIds:[],dependencyIds:[],parameterRefs:[]},clauses:ids.map(clauseId=>({clauseId,kind:'instruction',locales:{zh:'合成依据仅用于测试。',en:'Synthetic source evidence is used for this test.'}}))});
  const base=scene===sceneId?[rawMaterial('glossary','EC-GLOSSARY',null,['terms']),rawMaterial('policy','NATIVE-CONFIG',nativeSourceConfiguration(snapshot),['configuration']),...basis.rules.map(r=>rawMaterial('rule',r.id,r,['pass','fail','exception'])),...basis.policies.map(p=>rawMaterial('policy',p.id,p,p.sections.map(s=>s.id)))]:materialSet(basis,snapshot).filter(m=>m.kind!=='prompt'),heading=syntheticMaterial('template',template.id);heading.sourceHash=languageHash(template);heading.shared.parameterRefs=[];heading.clauses=['title',...template.sections.map(s=>'section.'+s.key),...template.columnGroups.map(g=>'group.'+g.id),...template.columns.map(c=>'column.'+c.id)].map(clauseId=>({clauseId,kind:'instruction',locales:{zh:'合成试用标题',en:'Synthetic pilot heading'}}));
  bundle.materials.push(...[...base,heading,nativePilotPromptDraft(scene)].map(m=>authorizePilotMaterial({...m,scene},auth)));
 }
 if(install)await store.installNativePilotMaterials(bundle);
 if(activate){const current=await store.read();await store.activateNativePilotMaterials(bundle,{baseRevision:current.revision,operationId:'activate-synthetic-pilot',actor:auth.actor,reason:auth.reason,acknowledgeUnreviewed:true,bundleHash:languageHash(bundle)});}
 const create=async(scene=sceneId,{unreplied=false,count=1,administrator='',frozenSnapshot}={})=>{
  const rows=Array.from({length:count},(_,i)=>{const raw=row({reply:unreplied?'':'The agent gives specific battery troubleshooting steps.',replyAt:unreplied?'':'2026-11-22 10:00:00'}).ecommerce.raw;raw[0]='SYNTHETIC-'+i;raw[11]=administrator;return raw;});
  const bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),...rows]}])),parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
  const source=await store.putSource(bytes,'synthetic.xlsx'),view=await store.read(),sessions=scene===sceneId?parsed.sessions:[{id:'NP-synthetic',scene,startedAt:now,agent:'Synthetic agent',customer:'Synthetic customer',product:'Synthetic product',topic:'Synthetic question',channel:'Synthetic channel',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'هل توجد نسخة زرقاء؟'},{id:2,role:'客服',text:'Sí, existe una versión azul.'}]}];
  const state=createImportedTask(view.state,{name:'Synthetic '+scene,source,sessions,basisSnapshot:sceneBasisForTask(view.state,view.catalog,scene,now),reviewer:auth.actor,now,executionSettings:{concurrency:1}});
  if(frozenSnapshot)state.tasks.find(t=>!view.state.tasks.some(old=>old.id===t.id)).executionSnapshot=structuredClone(frozenSnapshot);
  const saved=await store.save({baseRevision:view.revision,mutationId:crypto.randomUUID(),state,catalog:view.catalog});return saved.state.tasks.find(t=>!view.state.tasks.some(old=>old.id===t.id));
 };
 return{bundle,dir,create,get store(){return store;},async reopen(){await store.close();store=await createWorkspaceStore({dataDir:dir,nativeLanguageStage:4});},async service(client){ai=await createAiService({store,client,modelConfig:{getPrivate:()=>config},maxAttempts:2,retryDelayMs:0});return ai;}};
}
test('historical installation alone cannot authorize new native tasks or selected freezes',async t=>{
 const f=await setup(t,'en',{activate:false}),view=await f.store.read(),materials=f.bundle.materials.filter(m=>m.scene==='新品产品咨询');
 assert.equal((await f.store.nativeReadiness()).status,'blocked');
 await assert.rejects(f.create('新品产品咨询'),{code:'NATIVE_PILOT_ACTIVATION_REQUIRED'});
 await assert.rejects(f.store.freezeLanguageMaterial({baseRevision:view.revision,operationId:'bypass-freeze',materialHashes:materials.map(m=>m.contentHash),promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',actor:auth.actor,reason:'Synthetic bypass attempt'}),{code:'NATIVE_PILOT_ACTIVATION_REQUIRED'});
 const basis=sceneBasisForTask(view.state,view.catalog,'新品产品咨询',now),task={scene:'新品产品咨询',basisSnapshot:basis,executionSnapshot:freezeSceneExecution(view.state,'新品产品咨询',{basis})},frozen=freezeNativeLanguage(view.state.workspaceSettings.languagePolicy,{materials,promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});
 assert.throws(()=>resolveNativeTaskMaterial(view.state,task,materials,frozen),{code:'NATIVE_PILOT_ACTIVATION_REQUIRED'});
 assert.deepEqual(await f.store.read(),view);
});
test('local activation requires explicit confirmation and binds exact bytes with replay and restart safety',async t=>{
 const f=await setup(t,'en',{activate:false,install:false}),view=await f.store.read(),input={baseRevision:view.revision,operationId:'local-explicit-activation',actor:'SYNTHETIC local maintainer',reason:'Synthetic trial with business review pending',acknowledgeUnreviewed:true,bundleHash:languageHash(f.bundle)};
 assert.equal(view.state.languageMaterials,undefined);
 for(const change of [{acknowledgeUnreviewed:false},{actor:' '},{reason:''},{bundleHash:'0'.repeat(64)},{materials:f.bundle.materials}])await assert.rejects(f.store.activateNativePilotMaterials(f.bundle,{...input,...change}));
 assert.deepEqual(await f.store.read(),view);
 const saved=await f.store.activateNativePilotMaterials(f.bundle,input),audit=saved.state.languageAudit.at(-1);assert.equal(saved.revision,view.revision+1);assert.equal(audit.action,'activate-pilot-materials');assert.equal(audit.actor,input.actor);assert.equal(audit.reason,input.reason);assert.equal(audit.after.bundleHash,input.bundleHash);assert.deepEqual(audit.after.materialHashes,f.bundle.materials.map(m=>m.contentHash));assert.equal(audit.after.materialStatus,'pilot-unreviewed');
 assert.deepEqual(await f.store.activateNativePilotMaterials(f.bundle,input),saved);await f.reopen();assert.deepEqual(await f.store.activateNativePilotMaterials(f.bundle,input),saved);
 await assert.rejects(f.store.activateNativePilotMaterials(f.bundle,{...input,reason:'Changed'}),{code:'LANGUAGE_OPERATION_CONFLICT'});
 await f.create('新品产品咨询');assert.equal((await f.store.nativeReadiness()).status,'ready');
});
test('pilot maintenance is discoverable in both native languages without claiming both scenes ready',async t=>{
 const f=await setup(t,'en',{activate:false}),view=await f.store.read(),status=f.store.nativePilotStatus(f.bundle),readiness=await f.store.nativeReadiness();
 assert.equal(status.status,'inactive');assert.equal(status.bundleHash,languageHash(f.bundle));
 for(const language of ['en','zh']){const state=structuredClone(view.state);state.workspaceSettings.languagePolicy.contentLanguage=language;const html=nativeReadinessNotice(state,readiness,status);assert.match(html,/data-act="native-pilot-open"/);assert.match(html,language==='en'?/Pilot material maintenance/:/试用材料维护/);const dialog=nativePilotMaintenanceDialog(state,status,readiness);assert.match(dialog,/id="native-pilot-actor"/);assert.match(dialog,/id="native-pilot-reason"/);assert.match(dialog,/id="native-pilot-acknowledge" type="checkbox"/);assert.match(dialog,/data-act="native-pilot-activate" disabled/);assert.match(dialog,language==='en'?/have not completed.*business review/:/尚未完成.*业务核对/);assert.match(dialog,language==='en'?/does not make every scene ready/:/不保证所有场景可用/);}
});
test('0.11.26 installed frozen tasks remain readable while every new task path requires local activation',async t=>{
 const f=await setup(t),np=await f.create('新品产品咨询'),ec=await f.create(),npFrozen=await f.store.readNativeMaterial(np),ecFrozen=await f.store.readNativeMaterial(ec);
 await f.store.close();const file=path.join(f.dir,'workspace.json'),disk=JSON.parse(await fs.readFile(file,'utf8'));disk.state.languageAudit=disk.state.languageAudit.filter(e=>e.action!=='activate-pilot-materials');disk.mutations=disk.mutations.filter(m=>m.id!=='activate-synthetic-pilot');await fs.writeFile(file,JSON.stringify(disk));await f.reopen();
 assert.deepEqual(await f.store.readNativeMaterial(np),npFrozen);assert.deepEqual(await f.store.readNativeMaterial(ec),ecFrozen);
 assert.equal((await f.store.nativeReadiness()).status,'blocked');
 await assert.rejects(f.create('新品产品咨询'),{code:'NATIVE_PILOT_ACTIVATION_REQUIRED'});await assert.rejects(f.create('新品产品咨询',{frozenSnapshot:np.executionSnapshot}),{code:'NATIVE_PILOT_ACTIVATION_REQUIRED'});
 const view=await f.store.read();await f.store.save({baseRevision:view.revision,mutationId:'save-historical-tasks',state:view.state,catalog:view.catalog});assert.deepEqual(await f.store.readNativeMaterial(ec),ecFrozen);
});
test('failed activation leaves visible state unchanged and retries exact bytes atomically',async t=>{
 let fail=false;const fsOps={...fs,rename:async(from,to)=>{if(fail&&path.basename(to)==='workspace.json'){fail=false;throw Error('SYNTHETIC activation write failure');}return fs.rename(from,to);}};
 const f=await setup(t,'en',{activate:false,install:false,fsOps}),view=await f.store.read(),input={baseRevision:view.revision,operationId:'atomic-activation',actor:auth.actor,reason:auth.reason,acknowledgeUnreviewed:true,bundleHash:languageHash(f.bundle)};
 fail=true;await assert.rejects(f.store.activateNativePilotMaterials(f.bundle,input),/SYNTHETIC activation write failure/);assert.deepEqual(await f.store.read(),view);assert.equal(f.store.nativePilotStatus(f.bundle).status,'inactive');
 const saved=await f.store.activateNativePilotMaterials(f.bundle,input);assert.equal(saved.revision,view.revision+1);assert.equal(f.store.nativePilotStatus(f.bundle).status,'active');await f.reopen();await f.create('新品产品咨询');
});
test('pilot authorization binds both languages and does not masquerade as approved publication',()=>{
 const m=authorizePilotMaterial(nativePilotPromptDraft(),auth);assert.equal(m.review.status,'pilot-unreviewed');assert.equal(m.review.reviewer,undefined);assert.equal(m.review.reviewedAt,undefined);validateBilingualMaterial(m);
 for(const change of [x=>x.clauses[0].locales.en+=' changed',x=>x.clauses[0].locales.zh+='更改',x=>x.shared.dependencyIds.push('changed')]){const bad=structuredClone(m);change(bad);assert.throws(()=>validateBilingualMaterial(bad),{code:'BILINGUAL_REVIEW_STALE'});}
});
for(const language of ['zh','en'])test(`pilot ${language} installs both scenes, freezes ordinary tasks, preserves hashes through restart`,async t=>{
 const f=await setup(t,language),ready=await f.store.nativeReadiness();assert.ok(ready.scenes.every(s=>s.status==='ready'),JSON.stringify(ready));assert.ok(ready.scenes.every(s=>s.materialStatus==='pilot-unreviewed'));
 assert.match(nativeReadinessNotice((await f.store.read()).state,ready),language==='en'?/business review.*pending/:/业务核对.*尚未完成/);
 const before=await f.store.read();await f.store.installNativePilotMaterials(f.bundle);assert.deepEqual(await f.store.read(),before);
 await assert.rejects(f.store.publishLanguageMaterial({baseRevision:before.revision,operationId:'wrong-publication',material:f.bundle.materials[0]}),{code:'BILINGUAL_REVIEW_REQUIRED'});
 const npMaterials=f.bundle.materials.filter(m=>m.scene==='新品产品咨询');let selected=await f.store.read();await f.store.freezeLanguageMaterial({baseRevision:selected.revision,operationId:'select-NP-only',materialHashes:npMaterials.map(m=>m.contentHash),promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',actor:auth.actor,reason:'Synthetic NP release choice'});
 const np=await f.create('新品产品咨询'),ec=await f.create(sceneId),frozen=await f.store.readNativeMaterial(ec);assert.equal(nativeExecutionContext(ec,frozen).scene,sceneId);assert.notEqual(ec.executionSnapshot.languageMaterialRef,np.executionSnapshot.languageMaterialRef);
 const snapshot=await f.store.read();await f.reopen();assert.deepEqual(await f.store.read(),snapshot);await f.store.readNativeMaterial(np);await f.store.readNativeMaterial(ec);
 const next=structuredClone(f.bundle);next.version='2';next.materials=next.materials.map(m=>authorizePilotMaterial({...m,semanticRevision:m.semanticRevision+'-second'},auth));await f.store.installNativePilotMaterials(next);
 assert.equal((await f.store.read()).state.tasks.find(t=>t.id===np.id).executionSnapshot.languageMaterialRef,np.executionSnapshot.languageMaterialRef);assert.deepEqual(await f.store.readNativeMaterial(ec),frozen);
 await assert.rejects(f.store.installNativePilotMaterials({...next,version:'2',id:next.id,authorization:{...auth,reason:'different'}}),{code:'LANGUAGE_OPERATION_CONFLICT'});
});
test('pilot frozen NP and EC bytes survive actual archive restore without the installed bundle',async t=>{
 const f=await setup(t),np=await f.create('新品产品咨询'),ec=await f.create(),before=await f.store.read(),decoded=decodeWorkspaceArchive((await encodeWorkspaceArchive(f.dir,{appVersion:'0.11.26'})).bytes);
 const target=await fs.mkdtemp(path.join(scratch,'restored-')),manager=await createWorkspaceRestore({dataDir:target,nativeLanguageStage:4});let restored=await createWorkspaceStore({dataDir:target,nativeLanguageStage:4});
 t.after(async()=>{await restored.close();await manager.close();assert.ok(target.startsWith(scratch+path.sep));await fs.rm(target,{recursive:true,force:true});});
 await restored.enableLanguageGovernance();const current=await restored.read(),staged=await manager.preflight(decoded);await manager.apply({staged,baseRevision:current.revision,closeServices:()=>restored.close(),openServices:async()=>{restored=await createWorkspaceStore({dataDir:target,nativeLanguageStage:4});}});
 const after=await restored.read();assert.deepEqual(after.state.languageMaterials,before.state.languageMaterials);assert.deepEqual(after.state.languageAudit,before.state.languageAudit);assert.deepEqual(await restored.readNativeMaterial(np),await f.store.readNativeMaterial(np));assert.deepEqual(await restored.readNativeMaterial(ec),await f.store.readNativeMaterial(ec));
});
test('removing frozen pilot bytes rejects reopen and backup instead of falling back to installed text',async t=>{
 const f=await setup(t),task=await f.create();await f.store.close();await fs.unlink(path.join(f.dir,'language-materials',task.executionSnapshot.languageMaterialRef+'.json'));
 await assert.rejects(encodeWorkspaceArchive(f.dir),{code:'LANGUAGE_MATERIAL_MISSING'});await assert.rejects(createWorkspaceStore({dataDir:f.dir,nativeLanguageStage:4}),/读取失败|损坏/);
});
test('pilot EC dependency recovery retains TIME and frozen material while producing native targeted STEPS',async t=>{
 const f=await setup(t),task=await f.create();let unavailable=true;const targeted=[];
 const client=createArkClient({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body),data=JSON.parse(body.messages[1].content);assert.doesNotMatch(body.messages[0].content,/\p{Script=Han}/u);if(data.capability==='ecommerceClassification'){if(unavailable)throw Error('Synthetic disconnected classification');const b=data.blocks[0];return modelEnvelope({status:'completed',value:{polarity:'negative',vocKind:'substantive'},reason:'The customer describes a specific battery issue.',confidence:.95,evidence:[{blockId:b.id,quote:b.text,start:0,end:b.text.length}]});}if(data.basis.rules.length===1)targeted.push(data.basis.rules[0].id);return modelEnvelope(ruleBody(data));}}),ai=await f.service(client);
 await ai.start(task.id,'synthetic-recovery-run');await ai.waitForIdle();const before=await f.store.read(),s=before.state.sessions.find(s=>s.taskId===task.id);assert.equal(s.aiResults.find(r=>r.ruleId==='EC-STEPS').verdict,'无法判定');unavailable=false;
 await ai.retryDependencies(task.id,s.id);const after=await f.store.read(),updated=after.state.sessions.find(r=>r.id===s.id);assert.deepEqual(targeted,['EC-STEPS']);assert.deepEqual(updated.aiResults.find(r=>r.ruleId==='EC-TIME'),s.aiResults.find(r=>r.ruleId==='EC-TIME'));assert.equal(updated.aiResults.find(r=>r.ruleId==='EC-STEPS').languageValidation.status,'verified');assert.deepEqual(after.state.tasks.find(t=>t.id===task.id).executionSnapshot,task.executionSnapshot);
});
test('native EC duplicate rationale retains the model PASS audit when the program changes final verdict to FAIL',async t=>{
 const f=await setup(t),task=await f.create(),context=nativeExecutionContext(task,await f.store.readNativeMaterial(task)),s=(await f.store.read()).state.sessions[0],other=structuredClone(s);other.id+='-other-source';other.ecommerce.row++;const sessions=[s,other];
 const semanticResults=sessions.map(session=>({sessionId:session.id,results:['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'].map(ruleId=>({ruleId,verdict:'符合',reason:'The agent provides the information requested by the customer.',evidence:[2],referenceIds:[],nativeContract:{version:'native-language-v1',adapterVersion:'native-verdict-map-v1',originalVerdict:'PASS',materialHash:context.execution.selectedMaterialHash}}))}));
 const merged=mergeEcommerceResults({sessions,semanticResults,duplicateGroups:[],basis:task.basisSnapshot,inspectionAt:now,runtime:task.executionSnapshot.runtime}),results=nativeEcommerceProgramResults(s,merged.get(s.id),context,task.basisSnapshot,sessions),target=results.find(r=>r.ruleId==='EC-TARGET');
 assert.equal(target.verdict,'不符合');assert.equal(target.nativeContract.originalVerdict,'PASS');assert.equal(target.nativeContract.programExecutor,'native-ec-program-v1');assert.equal(target.languageValidation.status,'verified');assert.doesNotMatch(target.reason,/\p{Script=Han}/u);assert.ok(target.batchEvidence.every(g=>! /\p{Script=Han}/u.test(g.reason)));
});
for(const language of ['zh','en'])test(`pilot EC ${language} model wire, retry, program TIME/TARGET and unreplied use frozen native language`,async t=>{
 const f=await setup(t,language),task=await f.create(),unreplied=await f.create(sceneId,{unreplied:true}),requests=[];let ruleAttempts=0;
 const client=createArkClient({fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body),data=JSON.parse(body.messages[1].content);requests.push(body);
  if(language==='en')assert.doesNotMatch(body.messages[0].content,/\p{Script=Han}/u);
  if(data.capability==='ecommerceClassification'){const b=data.blocks[0];return modelEnvelope({status:'completed',value:{polarity:'negative',vocKind:'substantive'},reason:language==='en'?'The customer describes a specific battery issue.':'用户描述了具体电池问题。',confidence:.95,evidence:[{blockId:b.id,quote:b.text,start:0,end:b.text.length}]});}
  ruleAttempts++;return modelEnvelope(ruleBody(data,ruleAttempts===1?(language==='en'?'zh':'en'):language));
 }}),ai=await f.service(client);
 await ai.start(task.id,'synthetic-pilot-run');await ai.waitForIdle();let view=await f.store.read(),saved=view.state.tasks.find(t=>t.id===task.id);assert.equal(saved.aiStatus,'completed',JSON.stringify(saved.aiQueue));assert.equal(ruleAttempts,2);
 for(const s of view.state.sessions.filter(s=>s.taskId===task.id))for(const r of s.aiResults){assert.equal(r.languageValidation.status,'verified',JSON.stringify(r));assert.equal(r.languageValidation.language,language);if(language==='en')assert.doesNotMatch(r.reason,/\p{Script=Han}/u);}
 const count=ruleAttempts;await ai.start(unreplied.id,'synthetic-unreplied-run');await ai.waitForIdle();view=await f.store.read();assert.equal(view.state.tasks.find(t=>t.id===unreplied.id).aiStatus,'completed');assert.equal(ruleAttempts,count);
 const local=view.state.sessions.find(s=>s.taskId===unreplied.id);assert.ok(local.aiResults.filter(r=>r.ruleId!=='EC-TIME').every(r=>r.verdict==='无法判定'&&r.languageValidation.status==='verified'));
 assert.ok(requests.some(r=>JSON.parse(r.messages[1].content).validationFeedback?.reasonCode==='language_unverified'));
});

for(const language of ['zh','en'])test(`pilot EC ${language} explicit language retry retains program TIME and batch duplicate evidence`,async t=>{
 const f=await setup(t,language,{calibrated:true}),task=await f.create(sceneId,{count:3,administrator:'SYNTHETIC ADMIN'}),requests=[];let outputLanguage=language==='en'?'zh':'en';
 const client=createArkClient({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body),data=JSON.parse(body.messages[1].content);requests.push(data);
  if(data.capability==='ecommerceClassification'){const b=data.blocks[0];return modelEnvelope({status:'completed',value:{polarity:'negative',vocKind:'substantive'},reason:language==='en'?'The customer describes a specific battery issue.':'用户描述了具体电池问题。',confidence:.95,evidence:[{blockId:b.id,quote:b.text,start:0,end:b.text.length}]});}
  return modelEnvelope(ruleBody(data,outputLanguage));
 }}),ai=await f.service(client);
 await ai.start(task.id,'synthetic-explicit-language-retry');await ai.waitForIdle();const before=await f.store.read(),rows=before.state.sessions.filter(s=>s.taskId===task.id),s=rows[0];
 assert.equal(before.state.tasks.find(t=>t.id===task.id).aiStatus,'completed');assert.equal(s.aiResults.find(r=>r.ruleId==='EC-TARGET').verdict,'不符合');assert.ok(s.aiResults.some(r=>r.languageValidation.status==='mismatch'));
 const at=requests.length;outputLanguage=language;await ai.retryNativeLanguage(task.id,s.id);const after=await f.store.read(),updated=after.state.sessions.find(r=>r.id===s.id),changedTask=after.state.tasks.find(t=>t.id===task.id),calls=requests.slice(at).filter(r=>r.basis);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].basis.rules.map(r=>r.id).sort(),['EC-PRIVACY','EC-STEPS','EC-TARGET','EC-TEXT']);assert.equal(calls[0].contract,'native-language-v1');
 assert.deepEqual(updated.aiResults.find(r=>r.ruleId==='EC-TIME'),s.aiResults.find(r=>r.ruleId==='EC-TIME'));
 assert.equal(updated.aiResults.find(r=>r.ruleId==='EC-TARGET').verdict,'不符合');assert.deepEqual(updated.aiResults.find(r=>r.ruleId==='EC-TARGET').batchEvidence,s.aiResults.find(r=>r.ruleId==='EC-TARGET').batchEvidence);assert.ok(updated.aiResults.every(r=>r.languageValidation.status==='verified'));
 assert.deepEqual(updated.aiExecution,s.aiExecution);assert.deepEqual(updated.turns,s.turns);assert.deepEqual(updated.nativeLanguageRetryHistory[0].beforeResults,s.aiResults);assert.deepEqual(updated.nativeLanguageRetryHistory[0].afterResults,updated.aiResults);
 assert.equal(changedTask.aiQueue.rows.find(r=>r.sessionId===s.id).semanticResult.results.length,4);assert.deepEqual(changedTask.executionSnapshot,task.executionSnapshot);for(const other of rows.slice(1))assert.deepEqual(after.state.sessions.find(r=>r.id===other.id),other);
 await f.reopen();assert.deepEqual((await f.store.read()).state.sessions,after.state.sessions);
});

test('native 180-row EC rendering reuses one full-batch assessment and cached group facts without changing evidence',async t=>{
 const f=await setup(t,'en',{calibrated:true}),task=await f.create(),context=nativeExecutionContext(task,await f.store.readNativeMaterial(task)),s=(await f.store.read()).state.sessions[0];let administratorReads=0;
 const sessions=Array.from({length:180},(_,i)=>{const copy=structuredClone(s);copy.id='SYNTHETIC-PERF-'+i;copy.ecommerce.row=3+i;copy.ecommerce.raw[11]='SYNTHETIC ADMIN';copy.ecommerce.raw=new Proxy(copy.ecommerce.raw,{get(raw,key){if(key==='11')administratorReads++;return Reflect.get(raw,key);}});return copy;});
 const batch=nativeEcommerceBatchFacts(sessions,task.basisSnapshot),preparedReads=administratorReads;assert.ok(preparedReads>0);assert.ok(batch.assessment.duplicateGroups.length>0);
 const results=[{ruleId:'EC-TARGET',verdict:'不符合',reason:'The agent gives a specific answer to the customer request.',comparisonAssessment:{status:'completed',semanticReason:'The agent gives a specific answer to the customer request.'},batchEvidence:batch.assessment.duplicateGroups}];
 const baseline=nativeEcommerceProgramResults(sessions[0],results,context,task.basisSnapshot,sessions,batch);for(const session of sessions)assert.deepEqual(nativeEcommerceProgramResults(session,results,context,task.basisSnapshot,sessions,batch),baseline);
 assert.equal(administratorReads,preparedReads,'Rendering 180 rows must not rescan administrators or recompute full-batch duplicate assessment');assert.equal(batch.groupFacts.size,batch.assessment.duplicateGroups.length);
 assert.deepEqual(baseline[0].batchEvidence.map(g=>({sessionIds:g.sessionIds,kind:g.kind})),batch.assessment.duplicateGroups.map(g=>({sessionIds:g.sessionIds,kind:g.kind})));
});
