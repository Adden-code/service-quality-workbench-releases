import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createCatalog} from '../public/catalog.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {migrateRuleKinds} from '../public/rule-kind.mjs';
import {migrateCatalogScenes} from '../public/catalog-scenes.mjs';
import {BUILTIN_SCENARIOS} from '../public/scenarios.mjs';
import {defaultScenePackage,validateTimingPolicy,defaultTimingPolicy,resolveSceneRuntime} from '../public/scene-configuration.mjs';
import {installSceneSeed,validateSceneSeed,loadBundledSceneSeed} from '../server/scene-seed.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {prepareFactoryResources} from '../packaging/factory-resources.mjs';
import {catalogPage} from '../public/catalog-view.mjs';
import {createSceneConfigurationManager,sceneRuntimeForm} from '../public/scene-configuration-ui.mjs';
import {executeSceneCapabilities,recordCapabilityOutcomes} from '../server/scene-capabilities.mjs';
import {acceptanceChecklist} from '../packaging/self-service-guide.mjs';
import {installBuiltinSceneUpgrade} from '../server/builtin-scene-upgrade.mjs';
import {createHash} from 'node:crypto';
const now='2026-11-16T00:00:00Z';
function fixture(){
 let catalog=createCatalog();const base=catalog.rules[0];catalog.rules=Array.from({length:17},(_,i)=>({...structuredClone(base),id:`NP-R${String(i+1).padStart(2,'0')}`,title:`SYNTHETIC rule ${i+1}`,category:i===0?'整体判定':i<12?'服务礼仪':i<14?'探需':'导购'}));
 const all=migrateRuleKinds(migrateCatalogScenes({state:createBusinessState(),catalog:ensureEcommerceCatalog(catalog,{now})})).catalog;
 const packages=BUILTIN_SCENARIOS.map(scene=>{const basis=createBasisSnapshot(all,{ruleIds:all.rules.filter(r=>r.id.startsWith(scene.engine==='conversation'?'NP-':'EC-')).map(r=>r.id),effectiveDate:'2026-11-16',now});const pkg=defaultScenePackage(scene,basis);pkg.configuration.status='published';pkg.configuration.executionMode='configured';pkg.template.renderMode='configured';return pkg;});
 // EC tests authenticate against its engine-owned frozen definition; no EC rules in the directory seed.
 const seedCatalog={...catalog,events:[]};return{catalog:seedCatalog,sceneSeed:{schemaVersion:1,id:'synthetic-seed-v1',packages}};
}
async function folder(t){const base=path.resolve('tests/.onboarding-scratch');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'scene-seed-'));t.after(async()=>{assert.ok(dir.startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});return dir;}

test('first boot atomically installs 17 synthetic directory rules and both complete configuration entities without user records',async t=>{
 const dataDir=await folder(t),{catalog,sceneSeed}=fixture();let store=await createWorkspaceStore({dataDir,catalogSeed:catalog,sceneSeed});
 const doc=await store.read();assert.equal(doc.catalog.rules.length,17);assert.equal(doc.state.tasks.length,0);assert.equal(doc.state.sessions.length,0);assert.equal(doc.state.sceneConfigurations.length,2);assert.equal(doc.state.deliveryTemplates.length,2);assert.equal(doc.state.sceneConfigurationEvents.length,2);assert.equal(doc.state.scenePackageDrafts.length,0);await store.close();
 const original=await fs.readFile(path.join(dataDir,'workspace.json'));
 // Existing workspaces must not even read later seeds: unavailable or corrupt resources cannot override data.
 store=await createWorkspaceStore({dataDir,catalogSeed:()=>{throw Error('must not read catalog');},sceneSeed:()=>{throw Error('must not read scene');}});await store.close();assert.deepEqual(await fs.readFile(path.join(dataDir,'workspace.json')),original);
});
test('invalid second scene or orphan scene seed leaves no partial workspace, with lock released',async t=>{
 const dataDir=await folder(t),{catalog,sceneSeed}=fixture();sceneSeed.packages[1].template.sections=[];
 await assert.rejects(createWorkspaceStore({dataDir,catalogSeed:catalog,sceneSeed}),/概况/);await assert.rejects(fs.stat(path.join(dataDir,'workspace.json')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(dataDir,'.workspace.lock')),{code:'ENOENT'});
 await assert.rejects(createWorkspaceStore({dataDir,sceneSeed:fixture().sceneSeed}),/目录种子/);
});
test('scene seed rejects changed frozen body, legacy placeholders, embedded credentials and attempts to reapply',()=>{
 const {catalog,sceneSeed}=fixture();validateSceneSeed(sceneSeed,catalog);
 for(const change of [s=>s.packages[0].configuration.basis.rules[0].failCriteria+=' changed',s=>s.packages[1].template.renderMode='legacy',s=>s.packages[0].configuration.basis.apiKey='synthetic-secret']){const altered=structuredClone(sceneSeed);change(altered);assert.throws(()=>validateSceneSeed(altered,catalog));}
 const state=installSceneSeed(createBusinessState(),catalog,sceneSeed,{now});assert.throws(()=>installSceneSeed(state,catalog,sceneSeed),/全新空工作区/);
});
test('staging validates paired seeds before copying; synthetic scene packages never claim factory readiness',async t=>{
 const dir=await folder(t),{catalog,sceneSeed}=fixture(),catalogSeedFile=path.join(dir,'catalog.json'),sceneSeedFile=path.join(dir,'scenes.json'),root=path.join(dir,'stage');await fs.writeFile(catalogSeedFile,JSON.stringify(catalog));await fs.writeFile(sceneSeedFile,JSON.stringify(sceneSeed));
 const info=await prepareFactoryResources({root,catalogSeedFile,sceneSeedFile,materialsKind:'synthetic'});assert.equal(info.sceneSeedIncluded,true);assert.equal(info.sceneSeedInfo.scenes.length,2);assert.equal(info.sampleIncluded,false);assert.equal(info.factoryReady,false);assert.deepEqual(await loadBundledSceneSeed(path.join(root,'resources')),sceneSeed);
 sceneSeed.packages.pop();await fs.writeFile(sceneSeedFile,JSON.stringify(sceneSeed));const badRoot=path.join(dir,'bad');await assert.rejects(prepareFactoryResources({root:badRoot,catalogSeedFile,sceneSeedFile}),/两个/);await assert.rejects(fs.stat(path.join(badRoot,'resources')),{code:'ENOENT'});
});
test('pending manual standards neither infer defaults nor call AI; independent capabilities continue and uncertainty is not a technical failure',async()=>{
 const {sceneSeed}=fixture(),c=sceneSeed.packages[0].configuration;c.capabilities=[{key:'site',phase:'pre',dependsOn:[],executorVersion:'scene-capability.v1'},{key:'timing',phase:'pre',dependsOn:['site'],executorVersion:'scene-capability.v1'},{key:'demandSummary',phase:'pre',dependsOn:[],executorVersion:'scene-capability.v1'}];c.timingPolicy={...defaultTimingPolicy(),enabled:true,standardsStatus:'pending'};validateTimingPolicy(c.timingPolicy);
 const snapshot={configuration:c,runtime:resolveSceneRuntime(c),taxonomy:null},called=[];const result=await executeSceneCapabilities({session:{id:'s',turns:[{id:1,role:'客户',text:'合成咨询'}]},snapshot,config:{model:'synthetic'},client:{inspectSceneCapability:async({input})=>{called.push(input.capability);return{status:'completed',value:{text:'合成诉求'},confidence:.9,evidence:[]};}}});
 assert.deepEqual(called,['demandSummary']);assert.equal(result.outputs.timing.origin,'configuration-pending');assert.equal(result.outputs.site.status,'uncertain');assert.equal(result.outputs.demandSummary.status,'completed');assert.equal(recordCapabilityOutcomes({},'s',result,c.failurePolicy).timing.technicalFailures,0);
 assert.match(sceneRuntimeForm(c),/时效项将显示无法判定/);const guessed=structuredClone(c.timingPolicy);guessed.standards=[{value:180}];assert.throws(()=>validateTimingPolicy(guessed),/必须留空/);
 const ready=structuredClone(c.timingPolicy);ready.standardsStatus='ready';assert.throws(()=>validateTimingPolicy(ready),/手工维护站点/);
});
test('published configuration is viewable without creating drafts; built-in frontline rule page hides AI import',async()=>{
 const {catalog,sceneSeed}=fixture(),state=installSceneSeed(createBusinessState(),catalog,sceneSeed,{now}),saved=structuredClone(state);let dialog={type:'scfg-list',sceneId:'新品产品咨询'};const manager=createSceneConfigurationManager({getState:()=>state,getDialog:()=>dialog,openDialog:d=>dialog=d,renderDialog:()=>{},mutate:()=>{throw Error('view must not mutate');}});
 assert.match(manager.dialog(dialog),/查看已发布配置/);await manager.action('scfg-view-published');assert.equal(dialog.type,'scfg-published');assert.match(manager.dialog(dialog),/已发布配置（只读）/);assert.match(manager.dialog(dialog),/<fieldset disabled>/);await manager.action('scfg-tab',{dataset:{tab:'delivery'}});assert.match(manager.dialog(dialog),/报告标题/);assert.deepEqual(state,saved);
 assert.doesNotMatch(catalogPage(catalog,'rules',{},'',state),/data-act="rule-import-open"/);assert.match(catalogPage(catalog,'rules',{},'',createBusinessState()),/data-act="rule-import-open"/);
});
test('two-scene release gate requires real configuration completeness, not the historical 22-rule/sample profile',async t=>{
 const dir=await folder(t),{catalog,sceneSeed}=fixture(),catalogSeedFile=path.join(dir,'catalog.json'),sceneSeedFile=path.join(dir,'scenes.json'),root=path.join(dir,'stage');await fs.writeFile(catalogSeedFile,JSON.stringify(catalog));await fs.writeFile(sceneSeedFile,JSON.stringify(sceneSeed));
 // This synthetic fixture intentionally does not contain the full business taxonomy and standards setup.
 await assert.rejects(prepareFactoryResources({root,catalogSeedFile,sceneSeedFile,factoryProfile:'builtin-two-scenes',requireFactoryMaterials:true}),/NP-R01须映射/);await assert.rejects(fs.stat(path.join(root,'resources')),{code:'ENOENT'});
 const checklist=acceptanceChecklist('zh',{factoryProfile:'builtin-two-scenes'});assert.match(checklist,/尚未满足完整出厂条件/);assert.match(checklist,/17条/);assert.doesNotMatch(checklist,/49会话|22条/);
});

test('bundled scene upgrade appends versions, preserves old frozen entities and never deletes old rules',()=>{const f=fixture(),state=installSceneSeed(createBusinessState(),f.catalog,f.sceneSeed,{now}),before=structuredClone(state.sceneConfigurations),catalogBefore=structuredClone(f.catalog);const next=installBuiltinSceneUpgrade({state,catalog:f.catalog},{catalogSeed:f.catalog,sceneSeed:f.sceneSeed,actor:'Synthetic maintainer',reason:'Synthetic upgrade',operationId:'upgrade-1',now:'2026-11-17T00:00:00Z'});assert.deepEqual(state.sceneConfigurations,before);assert.deepEqual(f.catalog,catalogBefore);assert.deepEqual(next.state.sceneConfigurations.slice(0,2),before);assert.equal(next.state.sceneConfigurations.length,4);assert.equal(next.catalog.rules.length,34);assert.equal(next.catalog.rules.filter(r=>r.status==='已停用').length,17);assert.ok(next.state.sceneConfigurations.at(-2).ruleBindings.every(r=>r.ruleVersion==='V1.1'));assert.equal(next.state.sceneConfigurationEvents.filter(e=>e.action==='builtin-upgrade').length,2);assert.throws(()=>installBuiltinSceneUpgrade(next,{catalogSeed:f.catalog,sceneSeed:f.sceneSeed,actor:'Synthetic',reason:'repeat',operationId:'upgrade-2'}),/已装载/);});

test('HTTP bundled upgrade makes a complete archive before changing published scenes',async t=>{const {createWorkbenchServer}=await import('../server.mjs'),{decodeWorkspaceArchive}=await import('../server/workspace-archive.mjs');const dataDir=await folder(t),f=fixture(),app=await createWorkbenchServer({dataDir,catalogSeed:f.catalog,sceneSeed:f.sceneSeed});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));let backupPath;t.after(async()=>{await new Promise(resolve=>app.close(resolve));if(backupPath){assert.ok(backupPath.startsWith(dataDir+'.before-builtin-'));await fs.unlink(backupPath);}});const origin=`http://127.0.0.1:${app.address().port}`,before=await(await fetch(origin+'/api/workspace')).json(),response=await fetch(origin+'/api/scene-config',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':before.token},body:JSON.stringify({action:'install-builtin',confirmed:true,actor:'Synthetic maintainer',reason:'Synthetic API regression',operationId:'http-builtin-upgrade'})}),after=await response.json();assert.equal(response.status,200,JSON.stringify(after));backupPath=after.backupPath;assert.ok(backupPath);const backup=decodeWorkspaceArchive(await fs.readFile(backupPath));assert.deepEqual(backup.document.state,before.state);assert.deepEqual(after.state.tasks,before.state.tasks);assert.deepEqual(after.state.sessions,before.state.sessions);assert.equal(after.state.sceneConfigurations.length,4);});

 test('bundled literal source archives are mandatory, hash checked, saved on first boot and included in integrity checks',async t=>{const f=fixture(),bytes=Buffer.from('Synthetic exact source\r\nline two'),sha256=createHash('sha256').update(bytes).digest('hex'),ref={name:'Synthetic approved source.txt',sha256,size:bytes.length};f.sceneSeed.packages[0].configuration.sourceRefs=[ref];assert.throws(()=>validateSceneSeed(f.sceneSeed,f.catalog),/随包原件/);f.sceneSeed.sources=[{...ref,bytesBase64:bytes.toString('base64')}];const bad=structuredClone(f.sceneSeed);bad.sources[0].bytesBase64=Buffer.from('changed').toString('base64');assert.throws(()=>validateSceneSeed(bad,f.catalog),/摘要/);const store=await createWorkspaceStore({dataDir:await folder(t),catalogSeed:f.catalog,sceneSeed:f.sceneSeed});t.after(()=>store.close());assert.deepEqual((await store.getSource(sha256)).bytes,bytes);await store.validateIntegrity();const before=await store.read();await store.installBuiltinScenes({catalogSeed:f.catalog,sceneSeed:f.sceneSeed,actor:'Synthetic',reason:'Synthetic upgrade',operationId:'source-upgrade'});assert.deepEqual((await store.getSource(sha256)).bytes,bytes);assert.deepEqual((await store.read()).state.tasks,before.state.tasks);await store.validateIntegrity();});

test('0115 duplicate bundled install returns an actionable 409 without altering versions or audits',async t=>{
 const {createWorkbenchServer}=await import('../server.mjs');const dataDir=await folder(t),f=fixture(),app=await createWorkbenchServer({dataDir,catalogSeed:f.catalog,sceneSeed:f.sceneSeed,storageMode:'sharded'});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.close(r));for(const name of await fs.readdir(path.dirname(dataDir))){const target=path.join(path.dirname(dataDir),name);if(target.startsWith(dataDir+'.before-builtin-')&&target.endsWith('.sqwb'))await fs.unlink(target);}});
 const origin=`http://127.0.0.1:${app.address().port}`,initial=await(await fetch(origin+'/api/workspace')).json(),headers={Origin:origin,'Content-Type':'application/json','X-Workspace-Token':initial.token};
 const input={action:'install-builtin',confirmed:true,actor:'Synthetic custodian',reason:'Synthetic initial install',operationId:'synthetic-first'};
 const first=await fetch(origin+'/api/scene-config',{method:'POST',headers,body:JSON.stringify(input)}),saved=await first.json();assert.equal(first.status,200,JSON.stringify(saved));
 const beforeBytes=await fs.readFile(path.join(dataDir,'workspace.json'));
 for(const [changes,message] of [[{operationId:'synthetic-repeat'},'本安装包内置场景已装载，可在场景管理查看或维护。'],[{reason:'Synthetic changed intent'},'相同操作标识的内容不一致。']]){
  const response=await fetch(origin+'/api/scene-config',{method:'POST',headers,body:JSON.stringify({...input,...changes})}),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,message);assert.notEqual(body.error,'Resource unavailable');
  const after=await(await fetch(origin+'/api/workspace')).json();assert.equal(after.revision,saved.revision);assert.deepEqual(after.catalog,saved.catalog);assert.deepEqual(after.state,saved.state);assert.deepEqual(await fs.readFile(path.join(dataDir,'workspace.json')),beforeBytes);
 }
});

test('0115 builtin preconditions identify input and state errors explicitly',()=>{
 const f=fixture(),plain={state:createBusinessState(),catalog:f.catalog};
 assert.throws(()=>installBuiltinSceneUpgrade(plain,{catalogSeed:f.catalog,sceneSeed:f.sceneSeed,actor:'',reason:'Synthetic',operationId:'op'}),e=>e.status===400&&/维护人/.test(e.message));
 assert.throws(()=>installBuiltinSceneUpgrade(plain,{catalogSeed:f.catalog,sceneSeed:f.sceneSeed,actor:'Synthetic',reason:'Synthetic',operationId:'op'}),e=>e.status===409&&/迁移场景/.test(e.message));
});
