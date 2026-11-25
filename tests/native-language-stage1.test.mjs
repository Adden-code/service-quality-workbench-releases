import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {createWorkspaceRestore} from '../server/workspace-restore.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog,createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {taskLanguage,workspaceLanguage,validateLanguagePolicy} from '../public/workspace-language.mjs';
import {classifyLanguageHistory} from '../server/workspace-language-service.mjs';
import {validateBilingualMaterial,bilingualHashes,reviewBilingualMaterial,freezeNativeLanguage,validateFrozenLanguageMaterial,freezeTaskLanguageContract,languageHash} from '../server/native-language-materials.mjs';
import {calibrationScope,calibratedReviewPolicy,mandatorySampleCount} from '../public/rule-calibration-policy.mjs';
import {approvedMaterial,syntheticMaterial,syntheticMaterials,nativePolicy} from './native-language-fixture.mjs';
const scratch=path.resolve(process.env.R39_VERIFY_DIR||'../outputs/service-r39-step1-20261125/test-workspaces');
async function directory(t){await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'case-'));t.after(async()=>{assert.ok(path.resolve(dir).startsWith(scratch+path.sep));await fs.rm(dir,{force:true,recursive:true});});return dir;}
async function storeFixture(t,options={}){const dataDir=await directory(t),store=await createWorkspaceStore({dataDir,...options});t.after(()=>store.close());return{store,dataDir};}
async function select(store,language='en'){const view=await store.enableLanguageGovernance();return store.selectLanguage({language,actor:'synthetic-operator',operationId:'select-'+language,baseRevision:view.revision});}
async function publishSet(store){for(const material of syntheticMaterials()){const view=await store.read();await store.publishLanguageMaterial({material,baseRevision:view.revision,operationId:'publish-'+material.id});}const view=await store.read();return store.freezeLanguageMaterial({baseRevision:view.revision,operationId:'freeze',materialHashes:view.state.languageMaterials.releases.map(r=>r.contentHash),promptId:'SYNTHETIC-prompt',glossaryId:'SYNTHETIC-glossary',actor:'synthetic-operator',reason:'Synthetic task-free freeze acceptance.'});}

test('R39 fresh state requires explicit choice; seeded revision and drafts do not choose a language',async t=>{
 const {store}=await storeFixture(t);await store.save({baseRevision:0,mutationId:'empty-seeded',state:createBusinessState(),catalog:createBusinessCatalog()});
 const view=await store.enableLanguageGovernance();assert.equal(workspaceLanguage(view.state).mode,'pending-selection');assert.equal(workspaceLanguage(view.state).contentLanguage,null);assert.ok(view.revision>1);assert.ok(view.state.languageAudit[0].backupPath);
});
test('R39 concurrent opposite choices: exactly one winner; no later overwrite; replay survives restart',async t=>{
 const {store,dataDir}=await storeFixture(t),initial=await store.enableLanguageGovernance();
 const request={language:'en',actor:'synthetic-operator',operationId:'winner',baseRevision:initial.revision};
 const results=await Promise.allSettled([store.selectLanguage(request),store.selectLanguage({...request,language:'zh',operationId:'loser'})]);assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(results[1].reason.code,'LANGUAGE_REVISION_CONFLICT');
 assert.equal(workspaceLanguage((await store.read()).state).contentLanguage,'en');await store.close();const reopened=await createWorkspaceStore({dataDir});t.after(()=>reopened.close());
 assert.equal(workspaceLanguage((await reopened.selectLanguage(request)).state).contentLanguage,'en');await assert.rejects(reopened.selectLanguage({...request,language:'zh'}),{code:'LANGUAGE_OPERATION_CONFLICT'});
});
test('R39 failed atomic selection keeps the pending state and can retry safely',async t=>{
 let fail=false;const {store,dataDir}=await storeFixture(t,{fsOps:{...fs,rename:async(a,b)=>{if(fail&&path.basename(b)==='workspace.json')throw new Error('synthetic write failure');return fs.rename(a,b);}}});const view=await store.enableLanguageGovernance(),bytes=await fs.readFile(path.join(dataDir,'workspace.json'));fail=true;
 const request={language:'en',actor:'synthetic-operator',operationId:'retry-selection',baseRevision:view.revision};await assert.rejects(store.selectLanguage(request),/未保存/);assert.deepEqual(await fs.readFile(path.join(dataDir,'workspace.json')),bytes);assert.equal(workspaceLanguage((await store.read()).state).mode,'pending-selection');fail=false;await store.selectLanguage(request);
});
test('R39 general saves cannot remove or switch the language lock, erase audit or forge a release',async t=>{
 const {store}=await storeFixture(t);const view=await select(store);
 for(const change of [s=>delete s.workspaceSettings,s=>s.workspaceSettings.languagePolicy.contentLanguage='zh',s=>s.languageAudit=[],s=>s.languageMaterials={schemaVersion:1,releases:[],freezes:[]}]){const state=structuredClone(view.state);change(state);await assert.rejects(store.save({baseRevision:view.revision,mutationId:crypto.randomUUID(),state,catalog:view.catalog}),{code:'LANGUAGE_LOCKED'});}
});
test('R39 deleting all historical tasks is not new: deletion/run/activity evidence retains legacy mode',async t=>{
 for(const state of [{tasks:[{lifecycle:{archivedAt:'x'}}]},{tasks:[{lifecycle:{voidedAt:'x'}}]},{taskDeletionAudit:[{}]},{activity:[{taskId:'old'}]}])assert.equal(classifyLanguageHistory(state).legacy,true);
 const {store,dataDir}=await storeFixture(t);await fs.mkdir(path.join(dataDir,'report-jobs'));await fs.writeFile(path.join(dataDir,'report-jobs','old-report.json'),'{}');const view=await store.enableLanguageGovernance();assert.equal(workspaceLanguage(view.state).mode,'legacy-display-v1');await assert.rejects(store.selectLanguage({language:'en',actor:'operator',operationId:'wrong',baseRevision:view.revision}),{code:'LANGUAGE_LOCKED'});
});
test('R39 compatibility interpreter never mutates frozen old tasks and respects existing English output',()=>{
 for(const task of [{id:'old-zh',basisSnapshot:{rules:[{id:'R'}]}},{id:'old-en',rawImportOptions:{outputLanguage:'en'}}]){const before=JSON.stringify(task),scope=JSON.stringify(calibrationScope(task));const result=taskLanguage(task);assert.equal(result.mode,'legacy-display-v1');assert.equal(result.contentLanguage,task.id==='old-en'?'en':'zh');assert.equal(JSON.stringify(task),before);assert.equal(JSON.stringify(calibrationScope(task)),scope);assert.equal('languageExecution' in calibrationScope(task),false);}
});
test('R39 bilingual publication rejects one-language change, missing text, parameter drift and stale review',()=>{
 const original=approvedMaterial();validateBilingualMaterial(original);
 for(const edit of [m=>m.clauses[0].locales.en+=' changed',m=>m.locales.zh.scope='',m=>m.clauses[0].locales.en='{{different}}',m=>m.shared.applicabilityIds.push('new-condition'),m=>m.semanticRevision='next']){const m=structuredClone(original);edit(m);assert.throws(()=>validateBilingualMaterial(m));}
 const m=syntheticMaterial();assert.throws(()=>reviewBilingualMaterial(m,{reviewer:'operator',reason:'only one',confirmedLanguages:['en'],expectedHashes:bilingualHashes(m)}),{code:'BILINGUAL_REVIEW_REQUIRED'});
});
test('R39 EC English publication has no caller override before arbitration; NP synthetic pair may publish',async t=>{
 const {store}=await storeFixture(t);await select(store);const np=approvedMaterial();let view=await store.read();await store.publishLanguageMaterial({material:np,baseRevision:view.revision,operationId:'np'});
 const ec=syntheticMaterial();ec.scene='电商评论回复';ec.id='EC-SYNTHETIC';assert.throws(()=>reviewBilingualMaterial(ec,{reviewer:'operator',reason:'not arbitration',confirmedLanguages:['zh','en'],expectedHashes:bilingualHashes(ec)}),{code:'EC_ARBITRATION_PENDING'});
 // Even a forged review payload cannot bypass the publication endpoint.
 ec.review={...np.review,...bilingualHashes(ec)};ec.contentHash=languageHash(ec);view=await store.read();await assert.rejects(store.publishLanguageMaterial({material:ec,baseRevision:view.revision,operationId:'ec'}),{code:'EC_ARBITRATION_PENDING'});
});
test('R39 freezing retains exact paired text, selected prompt bytes and automatic original translation policy',()=>{
 const materials=syntheticMaterials(),frozen=freezeNativeLanguage(nativePolicy('en'),{materials,promptId:'SYNTHETIC-prompt',glossaryId:'SYNTHETIC-glossary'});validateFrozenLanguageMaterial(frozen);materials[0].clauses[0].locales.en='later edit';
 assert.notEqual(frozen.paired[0].clauses[0].locales.en,'later edit');assert.equal(frozen.languageExecution.originalTranslationPolicy,'automatic-at-delivery');assert.equal(frozen.selected[0].clauses[0].text.includes('合成'),false);frozen.selected[0].clauses[0].text='tampered';assert.throws(()=>validateFrozenLanguageMaterial(frozen),{code:'LANGUAGE_FREEZE_INVALID'});
});
test('R39 English tasks cannot borrow old Chinese B6; new scope preserves 80/30 and 5 percent/minimum 5',()=>{
 const old={scene:'新品产品咨询'},record={id:'old-calibration',enabled:true,pairCount:30,correctCount:24,scope:calibrationScope(old),ruleId:'SYNTHETIC-rule',ruleVersion:'V1.0',modelFingerprint:'model',promptVersion:'old'};
 const state={ruleCalibrations:{records:[record]}},frozen=freezeNativeLanguage(nativePolicy('en'),{materials:syntheticMaterials(),promptId:'SYNTHETIC-prompt',glossaryId:'SYNTHETIC-glossary'});
 // Other fields match exactly, isolating the execution-language scope boundary.
 const task={...old,executionSnapshot:{languageExecution:frozen.languageExecution,configuration:{executionMode:'synthetic'},runtime:{values:{}}}};
 assert.equal(calibratedReviewPolicy(state,old).rules.length,1);assert.equal(calibratedReviewPolicy(state,task).rules.length,0);
 const scoped={...record,scope:calibrationScope(task)};assert.equal(calibratedReviewPolicy({ruleCalibrations:{records:[scoped]}},task).rules.length,1);assert.equal(calibratedReviewPolicy({ruleCalibrations:{records:[{...scoped,pairCount:29}]}},task).rules.length,0);assert.equal(calibratedReviewPolicy({ruleCalibrations:{records:[{...scoped,correctCount:23}]}},task).rules.length,0);assert.equal(mandatorySampleCount(180),9);assert.equal(mandatorySampleCount(30),5);
});
test('R39 archive includes immutable materials; restore preserves language and frozen hashes',async t=>{
 const {store,dataDir}=await storeFixture(t,{storageMode:'sharded'});await select(store);const before=await publishSet(store),archive=await encodeWorkspaceArchive(dataDir),decoded=decodeWorkspaceArchive(archive.bytes);assert.equal([...decoded.files.keys()].filter(k=>k.startsWith('language-materials/')).length,4);
 const target=await directory(t),manager=await createWorkspaceRestore({dataDir:target});t.after(()=>manager.close());let restored=await createWorkspaceStore({dataDir:target});t.after(()=>restored?.close());await restored.enableLanguageGovernance();const current=await restored.read(),staged=await manager.preflight(decoded);
 await manager.apply({staged,baseRevision:current.revision,closeServices:()=>restored.close(),openServices:async()=>{restored=await createWorkspaceStore({dataDir:target});await restored.enableLanguageGovernance();}});
 const after=await restored.read();assert.deepEqual(after.state.workspaceSettings,before.state.workspaceSettings);assert.deepEqual(after.state.languageMaterials,before.state.languageMaterials);assert.deepEqual(after.state.languageAudit,before.state.languageAudit);
});
test('R39 missing material refuses backup and reopening instead of using current installation texts',async t=>{
 const {store,dataDir}=await storeFixture(t);await select(store);const view=await publishSet(store);await store.close();await fs.unlink(path.join(dataDir,'language-materials',view.state.languageMaterials.freezes[0].hash+'.json'));
 await assert.rejects(encodeWorkspaceArchive(dataDir),{code:'LANGUAGE_MATERIAL_MISSING'});await assert.rejects(createWorkspaceStore({dataDir}),/读取失败|损坏/);
});
test('R39 old format backup remains readable without injecting task language or changing task hashes',async t=>{
 const {store,dataDir}=await storeFixture(t);await store.save({baseRevision:0,mutationId:'old',state:createBusinessState(),catalog:createBusinessCatalog()});const old=decodeWorkspaceArchive((await encodeWorkspaceArchive(dataDir)).bytes);assert.equal(workspaceLanguage(old.document.state),null);const before=JSON.stringify(old.document.state);await store.enableLanguageGovernance();assert.equal(JSON.stringify(old.document.state),before);
});
test('R39 HTTP protects selection, publishes through dedicated routes, and blocks incomplete native AI paths',async t=>{
 const dataDir=await directory(t),server=await createWorkbenchServer({dataDir,nativeLanguageStage:1,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const origin=`http://127.0.0.1:${server.address().port}`,initial=await(await fetch(origin+'/api/workspace')).json();
 const headers={'Content-Type':'application/json','Origin':origin,'X-Workspace-Token':initial.token},body={language:'en',actor:'operator',operationId:'http-select',baseRevision:initial.revision};
 assert.equal((await fetch(origin+'/api/workspace-language/select',{method:'POST',headers:{...headers,'X-Workspace-Token':'wrong'},body:JSON.stringify(body)})).status,403);
 const response=await fetch(origin+'/api/workspace-language/select',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);assert.equal(workspaceLanguage((await response.json()).state).contentLanguage,'en');
 for(const url of ['/api/ai/tasks/synthetic','/api/tasks/synthetic/ai/resume','/api/report-jobs','/api/translation-jobs','/api/raw-structure-jobs','/api/scene-config/prepare']){const r=await fetch(origin+url,{method:'POST',headers,body:'{}'});assert.equal(r.status,409,url);assert.equal((await r.json()).code,'NATIVE_LANGUAGE_STAGE_PENDING');}
 assert.equal((await fetch(origin+'/api/model/config')).status,200);assert.equal((await fetch(origin+'/api/workspace')).status,200);
});
test('R39 policy rejects extra fields and contradictory modes',()=>{for(const p of [{...nativePolicy('en'),uiLanguagePolicy:'legacy-switchable'},{...nativePolicy('en'),contentLanguage:'ar'},{...nativePolicy('en'),unlocked:true}])assert.throws(()=>validateLanguagePolicy(p));});

test('R39 legacy populated workspace migrates once with exact task/session bytes and a complete pre-upgrade backup',async t=>{
 const {store,dataDir}=await storeFixture(t),catalog=createCatalog(),source=await store.putSource(Buffer.from('SYNTHETIC retained source'),'synthetic.txt'),at='2026-11-25T01:00:00Z';
 const state=createImportedTask(createBusinessState(),{name:'Synthetic legacy',reviewer:'operator',source,now:at,basisSnapshot:createBasisSnapshot(catalog,{ruleIds:['R004'],effectiveDate:'2026-11-25',now:at}),sessions:[{id:'SYNTHETIC-S1',scene:'新品产品咨询',startedAt:at,topic:'Synthetic topic',channel:'Synthetic',product:'Synthetic',agent:'Synthetic',customer:'Synthetic',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'Synthetic question'},{id:2,role:'客服',text:'Synthetic response'}]}]});
 await store.save({baseRevision:0,mutationId:'legacy',state,catalog});const before=await store.read(),after=await store.enableLanguageGovernance();assert.equal(workspaceLanguage(after.state).mode,'legacy-display-v1');assert.deepEqual(after.state.tasks,before.state.tasks);assert.deepEqual(after.state.sessions,before.state.sessions);assert.deepEqual(calibrationScope(after.state.tasks[0]),calibrationScope(before.state.tasks[0]));
 const backup=decodeWorkspaceArchive(await fs.readFile(path.join(dataDir,after.state.languageAudit[0].backupPath)));assert.deepEqual(backup.document.state,before.state);assert.equal((await store.enableLanguageGovernance()).revision,after.revision);
 // A new row remains allowed by the legacy language guard; an unrelated
 // validation error may still reject malformed business data.
 const changed=structuredClone(after.state);changed.activity.unshift({id:'SYNTHETIC-ACT',taskId:changed.tasks[0].id,action:'Synthetic note',at,reviewer:'operator'});await store.save({baseRevision:after.revision,mutationId:'legacy-write',state:changed,catalog:after.catalog});
});
test('R39 native task freeze enforces all three language parameters without mutating the source task',()=>{
 const policy=nativePolicy('en'),frozen=freezeNativeLanguage(policy,{materials:syntheticMaterials(),promptId:'SYNTHETIC-prompt',glossaryId:'SYNTHETIC-glossary'}),task={id:'SYNTHETIC',rawImportOptions:{outputLanguage:'en'},executionSnapshot:{configuration:{inspectionLanguage:'en'},runtime:{values:{outputLanguages:['en']}}}};
 const result=freezeTaskLanguageContract(task,policy,frozen);assert.equal(result.executionSnapshot.languageExecution.contentLanguage,'en');assert.equal(result.executionSnapshot.languageMaterialRef,languageHash(frozen));assert.equal(task.executionSnapshot.languageExecution,undefined);
 for(const edit of [t=>t.rawImportOptions.outputLanguage='zh',t=>t.executionSnapshot.configuration.inspectionLanguage='zh',t=>t.executionSnapshot.runtime.values.outputLanguages=['zh','en']]){const bad=structuredClone(task);edit(bad);assert.throws(()=>freezeTaskLanguageContract(bad,policy,frozen),{code:'LANGUAGE_PARAMETER_CONFLICT'});}
 assert.throws(()=>freezeTaskLanguageContract(result,policy,frozen),{code:'LANGUAGE_FROZEN'});
});
test('R39 HTTP publication enforces stale bilingual review and one version, retaining immutable audit',async t=>{
 const dataDir=await directory(t),server=await createWorkbenchServer({dataDir,nativeLanguageStage:1,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const origin=`http://127.0.0.1:${server.address().port}`,view=await(await fetch(origin+'/api/workspace')).json(),headers={'Content-Type':'application/json','Origin':origin,'X-Workspace-Token':view.token};
 const post=(route,input)=>fetch(origin+route,{method:'POST',headers,body:JSON.stringify(input)}),material=approvedMaterial();
 const broken=structuredClone(material);broken.clauses[0].locales.en+=' changed';let r=await post('/api/workspace-language/material/publish',{material:broken,baseRevision:view.revision,operationId:'bad'});assert.equal(r.status,409);assert.equal((await r.json()).code,'BILINGUAL_REVIEW_STALE');
 r=await post('/api/workspace-language/material/publish',{material,baseRevision:view.revision,operationId:'good'});assert.equal(r.status,200);const saved=await r.json();assert.equal(saved.state.languageAudit.at(-1).after.contentHash,material.contentHash);assert.ok(saved.state.languageAudit.at(-1).diff.length);
 r=await post('/api/workspace-language/material/publish',{material,baseRevision:saved.revision,operationId:'duplicate'});assert.equal(r.status,409);assert.equal((await r.json()).code,'BILINGUAL_VERSION_EXISTS');
});
test('R39 pending/native workspace cannot create a task through full or delta saves',async t=>{
 const {store}=await storeFixture(t);let view=await store.enableLanguageGovernance();
 const attempt=async code=>{const state=structuredClone(view.state);state.tasks.push({id:'SYNTHETIC-BYPASS'});await assert.rejects(store.save({baseRevision:view.revision,mutationId:crypto.randomUUID(),state,catalog:view.catalog}),{code});};
 await attempt('LANGUAGE_SELECTION_REQUIRED');view=await store.selectLanguage({language:'zh',actor:'operator',operationId:'zh',baseRevision:view.revision});await attempt('NATIVE_LANGUAGE_STAGE_PENDING');
 await assert.rejects(store.save({baseRevision:view.revision,mutationId:'patch-bypass',patch:{tasks:[{id:'SYNTHETIC-BYPASS'}],sessions:[],removedTasks:[],removedSessions:[],state:{}}}),{code:'NATIVE_LANGUAGE_STAGE_PENDING'});
});
