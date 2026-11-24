import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {fixture as targetFixture,row,now,sceneId} from './ec-target01121-fixtures.mjs';
import {upgradeEcommerceTargetBasis,upgradeEcommerceTargetCalibrationBasis,EC_TARGET_POLICY_VERSION,EC_TARGET_CALIBRATION_POLICY_VERSION} from '../public/ecommerce-semantic-policy.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {prepareAutomaticBuiltinUpgrade,upgradeBuiltinOnStartup} from '../server/startup-builtin-upgrade.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {latestSceneConfiguration,sceneBasisForTask,sceneEntity} from '../public/scene-configuration.mjs';
import {createImportedTask} from '../public/domain.mjs';
import {EC_HEADERS} from '../public/ecommerce-schema.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {createWorkspaceDecoder} from '../public/workspace-decoder.mjs';
const clone=x=>structuredClone(x),NP='新品产品咨询',root=path.resolve('tests/artifacts/startup-builtin01122'),closers=new Map();
function seeds(){
 const f=targetFixture(),old=clone(f.newSeed);old.id='synthetic-startup-01121';const p=old.packages[1];p.configuration.basis=upgradeEcommerceTargetBasis(p.configuration.basis);sync(p);
 const next=clone(old);next.id='synthetic-startup-01122';next.packages[1].configuration.basis=upgradeEcommerceTargetCalibrationBasis(next.packages[1].configuration.basis);sync(next.packages[1]);
 return{catalogSeed:f.catalog,oldSeed:old,sceneSeed:next,productVersion:'0.11.22'};
}
function sync(p){p.configuration.ruleBindings=p.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));for(const col of p.template.columns)if(col.ruleId)col.ruleVersion=p.configuration.ruleBindings.find(r=>r.ruleId===col.ruleId).ruleVersion;}
async function sandbox(t){
 await fs.mkdir(root,{recursive:true});const container=await fs.mkdtemp(path.join(root,'run-')),dataDir=path.join(container,'workspace');
 closers.set(dataDir,[]);t.after(async()=>{for(const close of closers.get(dataDir).reverse())await close();closers.delete(dataDir);assert.ok(path.resolve(container).startsWith(root+path.sep));await fs.rm(container,{recursive:true,force:true});});return{container,dataDir};
}
async function withStore(t,dataDir,options={}){const store=await createWorkspaceStore({dataDir,...options});closers.get(dataDir).push(()=>store.close());return store;}
async function publishSettings(store,scene,mutate){
 let n=0;const common={actor:'Synthetic maintainer',reason:'Synthetic local settings'};
 let result=await store.configureScene({...common,action:'create',sceneId:scene,operationId:`settings-${scene}-${n++}`}),draft=result.state.scenePackageDrafts.at(-1);
 const pkg=clone(draft.package);mutate(pkg);
 result=await store.configureScene({...common,action:'save',draftId:draft.id,expectedRevision:draft.revision,package:pkg,operationId:`settings-${scene}-${n++}`});draft=result.state.scenePackageDrafts.at(-1);
 for(const tab of ['rules','auxiliary','delivery']){result=await store.configureScene({...common,action:'confirm',tab,draftId:draft.id,expectedRevision:draft.revision,operationId:`settings-${scene}-${n++}`});draft=result.state.scenePackageDrafts.at(-1);}
 return store.configureScene({...common,action:'publish',draftId:draft.id,expectedRevision:draft.revision,operationId:`settings-${scene}-${n++}`});
}
async function localSettings(store){
 await publishSettings(store,NP,p=>{
  p.configuration.timingPolicy={...p.configuration.timingPolicy,siteField:'国家',sites:[{id:'local-np',label:'Synthetic NP local site',aliases:['NP local']}],standards:['firstResponseDuration','queryWaitDuration','queryCount'].map((metric,i)=>({siteId:'local-np',metric,value:[123,456,7][i],unit:metric==='queryCount'?'count':'seconds',operator:'>',source:'Synthetic manual local standard',authoring:'manual'}))};
  p.template.groupBy='agent';p.template.title='Synthetic NP local report';
 });
 await publishSettings(store,sceneId,p=>{
  const b=p.configuration.basis.businessProfile;b.semanticPolicy.text.minimumSignificantErrors=2;b.timing.sites=[{id:'local-ec',label:'Synthetic EC local site',aliases:['EC local']}];b.structure.closingWaiver={zh:333,en:444};
  p.configuration.runtimeFields.find(f=>f.key==='outputLanguages').default=['en'];p.configuration.failurePolicy={window:40,minimum:25,rate:.2};p.template.groupBy='agent';p.template.title='Synthetic EC local report';p.template.sections.reverse();p.template.sections[0].title='Synthetic local section';p.template.columns[0].visible=false;
 });
}
async function importedTask(store,label){
 const r=row().ecommerce.raw;r[8]+=` ${label}`;r[11]='Synthetic administrator';
 const bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),r]}])),name=`synthetic-${label}.xlsx`,parsed=await parseEcommerceFile({name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,name),before=await store.read(),state=createImportedTask(before.state,{name:`Synthetic task ${label}`,sessions:parsed.sessions,source,reviewer:'Synthetic reviewer',basisSnapshot:sceneBasisForTask(before.state,before.catalog,sceneId,now),now});
 const result=await store.save({state,catalog:before.catalog,baseRevision:before.revision,mutationId:`import-${label}`});return result.state.tasks.find(t=>t.name===`Synthetic task ${label}`);
}
const backups=async container=>(await fs.readdir(container)).filter(n=>n.includes('.before-auto-builtin-')&&n.endsWith('.sqwb'));
const startup=(store,dataDir,f,extra={})=>upgradeBuiltinOnStartup({store,dataDir,catalogSeed:f.catalogSeed,sceneSeed:f.sceneSeed,productVersion:f.productVersion,...extra});
test('old workspace upgrades only changed EC, retains local settings and old task snapshots, new tasks freeze v2',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed});await localSettings(store);const oldTask=await importedTask(store,'before'),before=await store.read(),originalBytes=await fs.readFile(path.join(box.dataDir,'workspace.json'));
 const result=await startup(store,box.dataDir,f);assert.equal(result.status,'upgraded',JSON.stringify(result));assert.deepEqual(result.scenes,[sceneId]);assert.equal((await backups(box.container)).length,1);
 const after=await store.read(),oldEC=latestSceneConfiguration(before.state,sceneId),ec=latestSceneConfiguration(after.state,sceneId);
 assert.deepEqual(after.state.tasks,before.state.tasks);assert.deepEqual(after.state.sessions,before.state.sessions);assert.deepEqual(after.catalog,before.catalog);assert.deepEqual(latestSceneConfiguration(after.state,NP),latestSceneConfiguration(before.state,NP));
 assert.equal(ec.version,oldEC.version+1);assert.equal(ec.basis.businessProfile.targetPolicyVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);assert.equal(ec.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);assert.deepEqual(ec.basis.businessProfile.timing.sites,oldEC.basis.businessProfile.timing.sites);assert.deepEqual(ec.basis.businessProfile.structure,oldEC.basis.businessProfile.structure);assert.deepEqual(ec.runtimeFields,oldEC.runtimeFields);assert.deepEqual(ec.failurePolicy,oldEC.failurePolicy);
 const oldTemplate=sceneEntity(before.state,'deliveryTemplates',oldEC.templateRef),template=sceneEntity(after.state,'deliveryTemplates',ec.templateRef);for(const key of ['title','groupBy','sections'])assert.deepEqual(template[key],oldTemplate[key]);assert.equal(template.columns[0].visible,false);
 const archive=decodeWorkspaceArchive(await fs.readFile(result.backupPath));assert.deepEqual(archive.files.get('workspace.json'),originalBytes);
 const created=await importedTask(store,'after');assert.equal(created.basisSnapshot.businessProfile.targetPolicyVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);assert.equal(oldTask.basisSnapshot.businessProfile.targetPolicyVersion,EC_TARGET_POLICY_VERSION);assert.deepEqual((await store.read()).state.tasks.find(v=>v.id===oldTask.id),oldTask);
});
test('fresh install and subsequent startup do not publish or back up a second copy',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.sceneSeed}),before=await store.read();
 assert.equal((await startup(store,box.dataDir,f)).status,'current');assert.deepEqual(await store.read(),before);assert.deepEqual(await backups(box.container),[]);
});
test('repeat startup, process restart and lower package version are idempotent without extra backups',async t=>{
 const box=await sandbox(t),f=seeds();let store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed});assert.equal((await startup(store,box.dataDir,f)).status,'upgraded');const before=await store.read(),saved=await fs.readFile(path.join(box.dataDir,'workspace.json'));
 assert.equal((await startup(store,box.dataDir,f)).status,'current');assert.deepEqual(await store.read(),before);await store.close();store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.sceneSeed});
 assert.equal((await startup(store,box.dataDir,f)).status,'current');assert.equal((await startup(store,box.dataDir,f,{sceneSeed:f.oldSeed,productVersion:'0.11.21'})).status,'current');assert.deepEqual(await store.read(),before);assert.deepEqual(await fs.readFile(path.join(box.dataDir,'workspace.json')),saved);assert.equal((await backups(box.container)).length,1);
});
test('metadata-only repack of already represented content does not add versions or backup',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed});assert.equal((await startup(store,box.dataDir,f)).status,'upgraded');const before=await store.read(),repacked=clone(f.sceneSeed);repacked.id='synthetic-identical-repack';for(const p of repacked.packages){p.configuration.actor='Synthetic new package author';p.configuration.reason='Synthetic metadata';}
 assert.equal((await startup(store,box.dataDir,f,{sceneSeed:repacked,productVersion:'0.11.23'})).status,'current');assert.deepEqual(await store.read(),before);assert.equal((await backups(box.container)).length,1);
});
test('changed NP package retains manually maintained site standards and local report grouping',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed});await localSettings(store);const before=await store.read(),changed=clone(f.sceneSeed);changed.id='synthetic-np-update';changed.packages[0].template.sections[0].title='Synthetic updated bundle section';
 const result=await startup(store,box.dataDir,f,{sceneSeed:changed});assert.equal(result.status,'upgraded',JSON.stringify(result));assert.deepEqual(new Set(result.scenes),new Set([NP,sceneId]));const after=await store.read(),np=latestSceneConfiguration(after.state,NP),old=latestSceneConfiguration(before.state,NP);assert.equal(np.version,old.version+1);assert.deepEqual(np.timingPolicy,old.timingPolicy);assert.equal(sceneEntity(after.state,'deliveryTemplates',np.templateRef).groupBy,'agent');
});
for(const failure of ['archive','backup-write','invalid-seed','seed-loader'])test(`${failure} failure reports failed without changing workspace bytes or in-memory state`,async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed}),before=await store.read(),bytes=await fs.readFile(path.join(box.dataDir,'workspace.json'));let writes=0;
 const extra=failure==='archive'?{archive:async()=>{throw Error('Synthetic archive failure');}}:failure==='backup-write'?{writeFile:async()=>{writes++;throw Error('Synthetic backup write failure');}}:failure==='invalid-seed'?{sceneSeed:{schemaVersion:1,id:'synthetic-invalid',packages:[]}}:{sceneSeed:async()=>{throw Error('Synthetic seed loader failure');}};
 const result=await startup(store,box.dataDir,f,extra);assert.equal(result.status,'failed');assert.match(result.message,/原工作区已保留/);assert.deepEqual(await store.read(),before);assert.deepEqual(await fs.readFile(path.join(box.dataDir,'workspace.json')),bytes);assert.deepEqual(await backups(box.container),[]);assert.equal(writes,failure==='backup-write'?1:0);
});
test('workspace persistence failure keeps the original readable workspace and a valid prior backup',async t=>{
 const box=await sandbox(t),f=seeds();let rejectWrite=false;const fsOps={...fs,rename:async(from,to)=>{if(rejectWrite&&to===path.join(box.dataDir,'workspace.json'))throw Error('Synthetic atomic replace failure');return fs.rename(from,to);}},store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed,fsOps}),before=await store.read(),bytes=await fs.readFile(path.join(box.dataDir,'workspace.json'));rejectWrite=true;
 const result=await startup(store,box.dataDir,f);assert.equal(result.status,'failed');assert.deepEqual(await store.read(),before);assert.deepEqual(await fs.readFile(path.join(box.dataDir,'workspace.json')),bytes);assert.equal((await backups(box.container)).length,1);assert.deepEqual(decodeWorkspaceArchive(await fs.readFile(result.backupPath)).files.get('workspace.json'),bytes);
});
async function serverAt(t,dataDir,f,extra={}){
 const server=await createWorkbenchServer({dataDir,catalogSeed:f.catalogSeed,sceneSeed:f.sceneSeed,...extra});server.listen(0,'127.0.0.1');await once(server,'listening');closers.get(dataDir).push(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 return{server,origin:`http://127.0.0.1:${server.address().port}`};
}
test('server startup exposes upgrade metadata in normal and record transport, and manual repeated policy install stays 409',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed});await store.close();const {origin}=await serverAt(t,box.dataDir,f),snapshot=await(await fetch(origin+'/api/workspace')).json();assert.equal(snapshot.builtinUpgrade.status,'upgraded',JSON.stringify(snapshot.builtinUpgrade));assert.equal(snapshot.builtinUpgrade.seedId,f.sceneSeed.id);
 const decoder=createWorkspaceDecoder({fetchImpl:(url,options)=>fetch(origin+url,options),WorkerClass:null}),records=await decoder.decode(await(await fetch(origin+'/api/workspace',{headers:{'X-Workspace-Sync':'records-v1'}})).arrayBuffer());decoder.close?.();assert.equal(records.builtinUpgrade.status,'upgraded');
 const response=await fetch(origin+'/api/scene-config',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':snapshot.token},body:JSON.stringify({action:'install-ec-policy',confirmed:true,actor:'Synthetic maintainer',reason:'Synthetic repeat',operationId:'synthetic-repeat',expectedVersion:latestSceneConfiguration(snapshot.state,sceneId).version})});assert.equal(response.status,409,await response.text());
 assert.equal((await backups(box.container)).length,1);
});
test('manual full builtin install after successful automatic upgrade is rejected instead of publishing duplicates',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed});assert.equal((await startup(store,box.dataDir,f)).status,'upgraded');const before=await store.read();
 await assert.rejects(store.installBuiltinScenes({catalogSeed:f.catalogSeed,sceneSeed:f.sceneSeed,actor:'Synthetic maintainer',reason:'Synthetic repeated bundle',operationId:'synthetic-repeat-full'}),error=>error.status===409);assert.deepEqual(await store.read(),before);
});
test('invalid seed at server startup remains available with failed upgrade metadata and unchanged workspace',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed}),before=await store.read(),bytes=await fs.readFile(path.join(box.dataDir,'workspace.json'));await store.close();const {origin}=await serverAt(t,box.dataDir,f,{sceneSeed:{schemaVersion:1,id:'synthetic-invalid',packages:[]}}),snapshot=await(await fetch(origin+'/api/workspace')).json();
 assert.equal(snapshot.builtinUpgrade.status,'failed');assert.deepEqual(snapshot.state,before.state);assert.equal(snapshot.revision,before.revision);assert.deepEqual(await fs.readFile(path.join(box.dataDir,'workspace.json')),bytes);
});
test('prepare plan is pure and cannot silently downgrade a workspace initialized with the newer seed',async t=>{
 const box=await sandbox(t),f=seeds(),store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.sceneSeed}),before=await store.read(),copy=clone(before);
 assert.ok(prepareAutomaticBuiltinUpgrade(before,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed,productVersion:'0.11.21'})===null,'A freshly installed v2 workspace must not receive a v1 downgrade plan');assert.deepEqual(before,copy);
});
test('sharded workspace upgrades and reopens with original task and configuration references intact',async t=>{
 const box=await sandbox(t),f=seeds();let store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.oldSeed,storageMode:'sharded'});const task=await importedTask(store,'sharded-before'),before=await store.read(),result=await startup(store,box.dataDir,f);
 assert.equal(result.status,'upgraded',JSON.stringify(result));const upgraded=await store.read();assert.deepEqual(upgraded.state.tasks,before.state.tasks);assert.equal(latestSceneConfiguration(upgraded.state,sceneId).basis.businessProfile.targetPolicyVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);
 const archive=decodeWorkspaceArchive(await fs.readFile(result.backupPath));assert.ok(archive.files.has('workspace.json'));assert.ok([...archive.files.keys()].some(p=>p.startsWith('sources/')));
 await store.close();store=await withStore(t,box.dataDir,{catalogSeed:f.catalogSeed,sceneSeed:f.sceneSeed,storageMode:'sharded'});assert.equal((await startup(store,box.dataDir,f)).status,'current');const after=await store.read();assert.deepEqual(after,upgraded);assert.deepEqual(after.state.tasks.find(t=>t.id===task.id),task);assert.equal((await backups(box.container)).length,1);
});
