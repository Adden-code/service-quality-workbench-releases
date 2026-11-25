// Run against actual installed files. All data is synthetic and kept under an explicit output directory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const [installedArg,oldArg,outArg,mode]=process.argv.slice(2);
assert.ok(installedArg&&oldArg&&outArg,'Usage: node tests/native-language-stage4-installed.mjs INSTALLED OLD_PAYLOAD OUTPUT');
const root=path.resolve(installedArg),oldRoot=path.resolve(oldArg),out=path.resolve(outArg);
assert.ok(out.startsWith(path.resolve('../outputs')+path.sep),'An isolated project output directory is required.');
await fs.mkdir(out,{recursive:true});
const mod=(base,rel)=>import(pathToFileURL(path.join(base,rel))),node=path.join(root,'runtime/node/node.exe'),script=path.join(root,'packaging/portable-launch.mjs');
const report={status:'running',syntheticOnly:true,externalModelCalls:0,checks:[],root};
const sha=b=>createHash('sha256').update(b).digest('hex');
const command=(arg,env)=>new Promise((resolve,reject)=>{
 let stdout='',stderr='';const child=spawn(node,[script,arg],{cwd:root,env,windowsHide:true});
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
 child.on('close',code=>{if(code)return reject(new Error(arg+': '+stderr+stdout));try{resolve(JSON.parse(stdout.trim()));}catch{reject(new Error('Launcher did not return JSON: '+stdout));}});
});
async function legacyFixture(dataDir){
 const {createWorkspaceStore}=await mod(oldRoot,'server/workspace-store.mjs');
 const {createBusinessState,createImportedTask}=await mod(oldRoot,'public/domain.mjs');
 const {createCatalog}=await mod(oldRoot,'public/catalog.mjs');
 const {migrateSceneConfigurations}=await mod(oldRoot,'server/scene-configuration-service.mjs');
 const {sceneBasisForTask}=await mod(oldRoot,'public/scene-configuration.mjs');
 const store=await createWorkspaceStore({dataDir,catalogSeed:null,sceneSeed:null,storageMode:'sharded'});
 try{
  const at='2026-11-25T01:00:00Z';
  let d=migrateSceneConfigurations({state:createBusinessState(),catalog:createCatalog()},{now:at,actor:'SYNTHETIC UPGRADE'});
  await store.save({baseRevision:0,mutationId:'synthetic-initial',...d});
  let view=await store.read();const source=await store.putSource(Buffer.from('SYNTHETIC ORIGINAL BYTES Arabic: مرحبا; Spanish: hola.'),'synthetic-upgrade.txt');
  const basis=sceneBasisForTask(view.state,view.catalog,'新品产品咨询',at);
  const sessions=[{id:'UPGRADE-SYN-1',scene:'新品产品咨询',startedAt:at,topic:'Synthetic request',channel:'Synthetic',product:'Synthetic phone',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'Synthetic customer',at:'',text:'هل توجد نسخة زرقاء؟'},{id:2,role:'客服',speaker:'Synthetic agent',at:'',text:'Sí, existe una versión azul.'}]}];
  const state=createImportedTask(view.state,{name:'Synthetic legacy upgrade',source,sessions,basisSnapshot:basis,reviewer:'Synthetic reviewer',now:at});
  await store.save({baseRevision:view.revision,mutationId:'synthetic-task',state,catalog:view.catalog});
  return await store.read();
 }finally{await store.close();}
}
if(mode==='--prepare-legacy'){
 const data=await fs.mkdtemp(path.join(out,'legacy-before-install-')),before=await legacyFixture(data);
 const env={...process.env,LOCALAPPDATA:path.join(out,'localappdata'),DEMO_DATA_DIR:data,DEMO_PORT:'15140',WORKBENCH_WORKER_PORT:'15141',PORTABLE_STARTUP_TIMEOUT_MS:'90000'};delete env.WORKBENCH_NATIVE_LANGUAGE_STAGE;
 try{
  const started=await command('--no-open',env);assert.equal(started.productVersion,'0.11.24');
  const r=await fetch('http://127.0.0.1:15140/api/workspace');assert.equal(r.status,200);const view=await r.json();
  assert.equal(view.state.workspaceSettings?.languagePolicy,undefined);assert.deepEqual(view.state.tasks,before.state.tasks);
  await fs.writeFile(path.join(out,'prepared-legacy.json'),JSON.stringify({data,document:view,oldInstalledVersion:started.productVersion}));
 }finally{await command('--stop',env);}
 console.log('Actual 0.11.24 installation created and reopened the synthetic legacy workspace.');process.exit(0);
}
const {decodeWorkspaceArchive}=await mod(root,'server/workspace-archive.mjs');
const prepared=await fs.readFile(path.join(out,'prepared-legacy.json'),'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return null;throw error;});
for(const kind of ['fresh-en','fresh-zh','legacy']){
 const data=kind==='legacy'&&prepared?prepared.data:await fs.mkdtemp(path.join(out,kind+'-')),env={...process.env,LOCALAPPDATA:path.join(out,'localappdata'),DEMO_DATA_DIR:data,DEMO_PORT:'15140',WORKBENCH_WORKER_PORT:'15141',PORTABLE_STARTUP_TIMEOUT_MS:'90000'};
 delete env.WORKBENCH_NATIVE_LANGUAGE_STAGE;
 let token,started=false;const origin='http://127.0.0.1:15140';
 const api=async(route,body,expected=200)=>{const r=await fetch(origin+route,{method:body?'POST':'GET',headers:{Origin:origin,...(token?{'X-Workspace-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const v=await r.json();assert.equal(r.status,expected,JSON.stringify(v));if(v.token)token=v.token;return v;};
 const previous=kind==='legacy'?(prepared?.document||await legacyFixture(data)):null;
 if(previous)await fs.writeFile(path.join(out,'legacy-before.json'),JSON.stringify(previous));
 try{
  try{await fetch(origin,{signal:AbortSignal.timeout(500)});throw new Error('Test port already occupied.');}catch(error){if(error.message==='Test port already occupied.')throw error;}
  const launched=await command('--no-open',env);started=true;assert.equal(launched.state,'ready');assert.equal(launched.productVersion,'0.11.26');
  const build=await api('/api/build-info');assert.equal(build.version,'0.11.26');
  const view=await api('/api/workspace');assert.equal(view.nativeLanguageStage,4);
  if(previous){
   assert.equal(view.state.workspaceSettings.languagePolicy.mode,'legacy-display-v1');
   assert.deepEqual(view.state.tasks,previous.state.tasks);assert.deepEqual(view.state.sessions,previous.state.sessions);
   assert.deepEqual(view.state.aiTaskQueue,previous.state.aiTaskQueue);
   assert.ok(view.state.languageAudit.some(e=>e.action==='classify'&&e.actor==='system-upgrade'));
   const files=await fs.readdir(path.dirname(data));const backups=files.filter(n=>n.startsWith(path.basename(data))&&n.endsWith('.sqwb'));
   assert.ok(backups.length,'A verified pre-language-upgrade backup is required.');
   let oldBackup=false;
   for(const name of backups){const archive=decodeWorkspaceArchive(await fs.readFile(path.join(path.dirname(data),name)));if(!archive.document.state.workspaceSettings?.languagePolicy){assert.deepEqual(archive.document.state.tasks,previous.state.tasks);oldBackup=true;}}
   assert.ok(oldBackup,'At least one backup must preserve the old language-free document.');
   report.checks.push({id:'installed-legacy-upgrade',tasks:view.state.tasks.length,sessions:view.state.sessions.length,oldSnapshotsUnchanged:true,preUpgradeBackup:true});
  }else{
   assert.equal(view.state.workspaceSettings.languagePolicy.mode,'pending-selection');assert.equal(view.state.tasks.length,0);
   assert.equal(view.catalog.rules.length,17);assert.equal(view.state.sceneConfigurations.length,2);
   const language=kind.endsWith('en')?'en':'zh';
   const selected=await api('/api/workspace-language/select',{baseRevision:view.revision,operationId:'installed-select-'+language,actor:'SYNTHETIC INSTALL TEST',language});
   assert.equal(selected.state.workspaceSettings.languagePolicy.contentLanguage,language);
   const blocked=await api('/api/workspace-language/select',{baseRevision:selected.revision,operationId:'installed-reselect-'+language,actor:'SYNTHETIC INSTALL TEST',language:language==='en'?'zh':'en'},409);
   assert.ok(blocked.error);
   assert.equal((await fs.readdir(data)).includes('language-materials'),true);
   assert.equal(selected.nativeLanguageReadiness.scenes.length,2);
   assert.ok(selected.nativeLanguageReadiness.scenes.every(s=>s.status==='ready'&&s.materialStatus==='pilot-unreviewed'),JSON.stringify(selected.nativeLanguageReadiness));
   assert.equal(selected.state.languageMaterials.releases.length,52);
   assert.equal(selected.state.languageAudit.filter(e=>e.action==='install-pilot-materials').length,1);
   report.checks.push({id:'installed-'+kind,explicitSelection:true,languageLocked:true,legacyRules:17,scenes:2,pilotMaterials:52,bothScenesReady:true});
  }
  const beforeRestart=await api('/api/workspace');await command('--stop',env);started=false;token=null;
  await command('--no-open',env);started=true;const afterRestart=await api('/api/workspace');
  assert.deepEqual(afterRestart.state.workspaceSettings,beforeRestart.state.workspaceSettings);assert.deepEqual(afterRestart.state.tasks,beforeRestart.state.tasks);assert.deepEqual(afterRestart.state.languageAudit,beforeRestart.state.languageAudit);
  report.checks.push({id:kind+'-restart-idempotent',status:'passed'});
  await fs.writeFile(path.join(out,kind+'-after.json'),JSON.stringify(afterRestart));
 }finally{if(started)assert.equal((await command('--stop',env)).state,'stopped');}
}
for(const name of ['catalog-seed.json','scene-seed.json'])assert.equal(sha(await fs.readFile(path.join(root,'resources',name))),sha(await fs.readFile(path.join(oldRoot,'resources',name))),'Legacy seed changed: '+name);
assert.equal(await fs.stat(path.join(root,'server/native-language-prompt-draft.mjs')).then(()=>true,()=>false),false);
const gate=JSON.parse(await fs.readFile(path.join(root,'Native Language Release.json')));assert.equal(gate.nativeBusinessMaterialCount,52);
report.checks.push({id:'legacy-seeds-identical-with-authorized-pilot',status:'passed'});
report.status='passed';report.verifiedAt=new Date().toISOString();await fs.writeFile(path.join(out,'installed-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
