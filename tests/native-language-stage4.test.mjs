import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createWorkbenchServer} from '../server.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {migrateSceneConfigurations} from '../server/scene-configuration-service.mjs';
import {sceneBasisForTask,freezeSceneExecution} from '../public/scene-configuration.mjs';
import {languageAcceptanceScreen,nativeReadinessNotice,nativeTaskAvailability} from '../public/workspace-language-ui.mjs';
import {nativePolicy,syntheticMaterial} from './native-language-fixture.mjs';
import {materialSet,reviewed} from './native-language-stage2-fixture.mjs';
import {nativeReportPromptDraft} from '../server/native-language-prompt-draft.mjs';
import {languageHash,freezeNativeLanguage,freezeTaskLanguageContract} from '../server/native-language-materials.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
const scene='新品产品咨询',at='2026-11-25T01:00:00Z';
const scratch=path.resolve(process.env.R39_VERIFY_DIR||'outputs/r39-stage4-runtime-tests');
async function dir(t){await fs.mkdir(scratch,{recursive:true});const root=await fs.mkdtemp(path.join(scratch,'synthetic-'));t.after(async()=>{assert.ok(root.startsWith(scratch+path.sep));await fs.rm(root,{recursive:true,force:true});});return root;}
async function fixture(t,language='en',fsOps){
 const dataDir=await dir(t),store=await createWorkspaceStore({dataDir,nativeLanguageStage:4,...(fsOps?{fsOps}:{})});t.after(()=>store.close());
 const initial=migrateSceneConfigurations({state:createBusinessState(),catalog:createCatalog()},{now:at});
 const c=initial.state.sceneConfigurations.find(c=>c.sceneId===scene);c.executionMode='configured';c.capabilities=[{key:'demandSummary',phase:'pre',executorVersion:'scene-capability.v1',dependsOn:[]}];c.ruleDependencies=Object.fromEntries(c.ruleBindings.map(r=>[r.ruleId,[]]));
 await store.save({baseRevision:0,mutationId:'setup',...initial});await store.enableLanguageGovernance();let view=await store.read();await store.selectLanguage({baseRevision:view.revision,operationId:'select',actor:'SYNTHETIC TEST',language});
 const bytes=Buffer.from('Synthetic source only'),source=await store.putSource(bytes,'synthetic.txt');
 const sessions=[{id:'SYNTHETIC',scene,startedAt:at,agent:'Synthetic agent',customer:'Synthetic customer',product:'Synthetic product',topic:'Synthetic question',channel:'Synthetic channel',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'هل توجد نسخة زرقاء؟'},{id:2,role:'客服',text:'Sí, existe una versión azul.'}]}];
 const create=async()=>{const view=await store.read(),basis=sceneBasisForTask(view.state,view.catalog,scene,at);return {view,state:createImportedTask(view.state,{name:'SYNTHETIC TASK',source,sessions,basisSnapshot:basis,reviewer:'SYNTHETIC TEST',now:at})};};
 const publish=async({ambiguous=false}={})=>{const {state}=await create(),task=state.tasks[0],template=task.executionSnapshot.template,m=syntheticMaterial('template',template.id);m.sourceHash=languageHash(template);m.shared.parameterRefs=[];m.clauses=['title',...template.sections.map(s=>'section.'+s.key),...template.columnGroups.map(g=>'group.'+g.id),...template.columns.map(c=>'column.'+c.id)].map(clauseId=>({clauseId,kind:'instruction',locales:{zh:'合成标题',en:'Synthetic heading'}}));
  const materials=[...materialSet(task.basisSnapshot,task.executionSnapshot).map(m=>m.kind==='prompt'?reviewed(nativeReportPromptDraft()):m),reviewed(m)];
  if(ambiguous){const p=structuredClone(nativeReportPromptDraft());p.version='V999-SYNTHETIC';materials.push(reviewed(p));}
  for(const material of materials){const view=await store.read();await store.publishLanguageMaterial({baseRevision:view.revision,operationId:'publish-'+material.id+'-'+material.version,material});}return materials;
 };
 return{store,dataDir,create,publish,source,sessions};
}
test('stage 4 server requires fresh workspace language and reports missing reviewed materials',async t=>{
 const dataDir=await dir(t),server=await createWorkbenchServer({dataDir,nativeLanguageStage:4,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port;
 const view=await(await fetch(origin+'/api/workspace')).json();assert.equal(view.state.workspaceSettings.languagePolicy.mode,'pending-selection');assert.equal(view.nativeLanguageReadiness.status,'selection-required');
 assert.doesNotMatch(languageAcceptanceScreen(view.state,{stage:4}),/Stage 1|第1步|0\.11\.24/);
});
test('native task construction locks language without rewriting registered configuration',()=>{
 const d=migrateSceneConfigurations({state:createBusinessState(),catalog:createCatalog()},{now:at});d.state.workspaceSettings={languagePolicy:nativePolicy('en')};const original=structuredClone(d.state.sceneConfigurations),basis=sceneBasisForTask(d.state,d.catalog,scene,at),snapshot=freezeSceneExecution(d.state,scene,{basis});
 assert.equal(snapshot.configuration.inspectionLanguage,'en');assert.deepEqual(snapshot.runtime.values.outputLanguages,['en']);assert.deepEqual(d.state.sceneConfigurations,original);
 assert.throws(()=>freezeSceneExecution(d.state,scene,{basis,overrides:{outputLanguages:['zh']}}),e=>e.code==='LANGUAGE_PARAMETER_CONFLICT');
});
test('stage 4 ordinary task save freezes exact approved material atomically and preserves source',async t=>{
 const f=await fixture(t);await f.publish();const ready=await f.store.nativeReadiness();assert.equal(ready.scenes.find(x=>x.scene===scene).status,'ready');
 const {view,state}=await f.create(),before=structuredClone(state.sessions);assert.equal(state.tasks[0].executionSnapshot.languageExecution,undefined);
 const saved=await f.store.save({baseRevision:view.revision,mutationId:'create',state,catalog:view.catalog});const task=saved.state.tasks[0];assert.equal(task.executionSnapshot.schemaVersion,2);assert.equal(task.executionSnapshot.languageExecution.contentLanguage,'en');assert.equal(saved.state.languageMaterials.freezes.length,1);assert.equal(saved.state.languageAudit.at(-1).action,'freeze-material');assert.deepEqual(saved.state.sessions,before);assert.deepEqual(task.source,f.source);await f.store.readNativeMaterial(task);
 const replay=await f.store.save({baseRevision:view.revision,mutationId:'create',state,catalog:view.catalog});assert.equal(replay.revision,saved.revision);assert.equal(replay.state.languageAudit.length,saved.state.languageAudit.length);
});
test('missing and ambiguous reviewed materials reject direct creation without visible freeze',async t=>{
 const f=await fixture(t);let {view,state}=await f.create();await assert.rejects(f.store.save({baseRevision:view.revision,mutationId:'missing',state,catalog:view.catalog}),e=>e.code==='NATIVE_MATERIAL_NOT_READY');assert.equal((await f.store.read()).revision,view.revision);
 await f.publish({ambiguous:true});({view,state}=await f.create());await assert.rejects(f.store.save({baseRevision:view.revision,mutationId:'ambiguous',state,catalog:view.catalog}),e=>e.code==='NATIVE_MATERIAL_AMBIGUOUS');const after=await f.store.read();assert.equal(after.revision,view.revision);assert.equal(after.state.languageMaterials.freezes.length,0);assert.equal(after.state.tasks.length,0);
});
test('native readiness UI exposes bilingual actionable material gate and preserves legacy entry',()=>{
 const state={workspaceSettings:{languagePolicy:nativePolicy('en')}},readiness={status:'blocked',scenes:[{scene,status:'blocked',code:'NATIVE_MATERIAL_NOT_READY'},{scene:'电商评论回复',status:'blocked',code:'EC_ARBITRATION_PENDING'}]};
 assert.equal(nativeTaskAvailability(state,readiness,scene).allowed,false);assert.match(nativeReadinessNotice(state,readiness),/reviewed bilingual|review.*Chinese.*English/i);assert.doesNotMatch(nativeReadinessNotice(state,readiness),/Stage 1|第1步/);
 state.workspaceSettings.languagePolicy=nativePolicy('zh');assert.match(nativeReadinessNotice(state,readiness),/双语.*审核|审核.*双语/);assert.match(nativeTaskAvailability(state,readiness,'电商评论回复').message,/仲裁/);
 assert.equal(nativeTaskAvailability({},null,scene).allowed,true);assert.equal(nativeReadinessNotice({},null),'');
 readiness.scenes[0].status='ready';assert.equal(nativeTaskAvailability(state,readiness,scene).allowed,true);
});
test('failed atomic task write retains the original visible registry and can retry',async t=>{
 let fail=false;const fsOps={...fs,rename:async(from,to)=>{if(fail&&path.basename(to)==='workspace.json'){fail=false;throw new Error('SYNTHETIC atomic failure');}return fs.rename(from,to);}};
 const f=await fixture(t,'en',fsOps);await f.publish();const {view,state}=await f.create();fail=true;
 await assert.rejects(f.store.save({baseRevision:view.revision,mutationId:'atomic',state,catalog:view.catalog}),/SYNTHETIC atomic failure/);assert.deepEqual(await f.store.read(),view);
 const saved=await f.store.save({baseRevision:view.revision,mutationId:'atomic',state,catalog:view.catalog});assert.equal(saved.state.tasks.length,1);assert.equal(saved.state.languageMaterials.freezes.length,1);
});
test('changed source and conflicting client language cannot borrow reviewed hashes',async t=>{
 const f=await fixture(t);await f.publish();let {view,state}=await f.create();state.tasks[0].basisSnapshot.rules[0].passCriteria+=' changed';
 await assert.rejects(f.store.save({baseRevision:view.revision,mutationId:'changed',state,catalog:view.catalog}),e=>e.code==='NATIVE_MATERIAL_NOT_READY');
 ({view,state}=await f.create());state.tasks[0].executionSnapshot.configuration.inspectionLanguage='zh';
 await assert.rejects(f.store.save({baseRevision:view.revision,mutationId:'language-conflict',state,catalog:view.catalog}),e=>e.code==='LANGUAGE_PARAMETER_CONFLICT');assert.deepEqual(await f.store.read(),view);
});
test('HTTP full saves retain readiness metadata and reject missing material before task creation',async t=>{
 const f=await fixture(t);const {view,state}=await f.create();await f.store.close();
 const server=await createWorkbenchServer({dataDir:f.dataDir,nativeLanguageStage:4,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port,current=await(await fetch(origin+'/api/workspace')).json();
 const put=async next=>fetch(origin+'/api/workspace',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':current.token},body:JSON.stringify({baseRevision:current.revision,mutationId:crypto.randomUUID(),state:next,catalog:view.catalog})});
 let response=await put(state);assert.equal(response.status,409);assert.equal((await response.json()).code,'NATIVE_MATERIAL_NOT_READY');
 response=await put(view.state);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.nativeLanguageReadiness.status,'blocked');assert.equal(saved.nativeLanguageStage,4);
});
test('a caller-supplied frozen reference cannot bypass stage 4 report coverage',async t=>{
 const f=await fixture(t),materials=(await f.publish()).filter(m=>m.kind!=='template');let view=await f.store.read();
 await f.store.freezeLanguageMaterial({baseRevision:view.revision,operationId:'incomplete-freeze',materialHashes:materials.map(m=>m.contentHash),promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',actor:'SYNTHETIC TEST',reason:'Synthetic bypass regression'});
 const created=await f.create();view=created.view;const frozen=freezeNativeLanguage(view.state.workspaceSettings.languagePolicy,{materials,promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});created.state.tasks[0]=freezeTaskLanguageContract(created.state.tasks[0],view.state.workspaceSettings.languagePolicy,frozen);
 await assert.rejects(f.store.save({baseRevision:view.revision,mutationId:'incomplete-native-create',state:created.state,catalog:view.catalog}),e=>e.code==='NATIVE_REPORT_MATERIAL_INCOMPLETE');assert.deepEqual(await f.store.read(),view);
});
test('a dedicated audited freeze selects an exact approved release when versions are ambiguous',async t=>{
 const f=await fixture(t),materials=(await f.publish({ambiguous:true})).filter(m=>m.version!=='V999-SYNTHETIC');let view=await f.store.read();
 assert.equal((await f.store.nativeReadiness()).status,'blocked');
 await f.store.freezeLanguageMaterial({baseRevision:view.revision,operationId:'select-reviewed-release',materialHashes:materials.map(m=>m.contentHash),promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',actor:'SYNTHETIC TEST',reason:'Explicit synthetic approved release selection'});
 const ready=await f.store.nativeReadiness();assert.equal(ready.scenes.find(s=>s.scene===scene).status,'ready');
 const created=await f.create();view=created.view;const selected=view.state.languageMaterials.freezes[0].hash,saved=await f.store.save({baseRevision:view.revision,mutationId:'selected-create',state:created.state,catalog:view.catalog});assert.equal(saved.state.tasks[0].executionSnapshot.languageMaterialRef,selected);
});
test('actual 0.11.24 validator rejects newly frozen schema 2 while accepting the same legacy source',{skip:!process.env.R39_OLD_PAYLOAD},async t=>{
 const old=await import(pathToFileURL(path.join(process.env.R39_OLD_PAYLOAD,'server/workspace-validation.mjs')).href),f=await fixture(t);await f.publish();const {view,state}=await f.create(),saved=await f.store.save({baseRevision:view.revision,mutationId:'old-reader',state,catalog:view.catalog});
 const legacy=structuredClone(state);delete legacy.workspaceSettings.languagePolicy;delete legacy.languageAudit;delete legacy.languageMaterials;old.validateWorkspace(legacy,view.catalog);
 assert.throws(()=>old.validateWorkspace(saved.state,saved.catalog),/快照|snapshot|版本|version/i);
});
