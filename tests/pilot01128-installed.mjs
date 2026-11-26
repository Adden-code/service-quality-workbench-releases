// Installed-payload acceptance. Uses synthetic records, no external model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const [installedArg,oldArg,outArg]=process.argv.slice(2);
assert.ok(installedArg&&oldArg&&outArg,'Usage: node tests/pilot01128-installed.mjs INSTALLED OLD_01127_PAYLOAD OUTPUT');
const root=path.resolve(installedArg),oldRoot=path.resolve(oldArg),out=path.resolve(outArg),sha=b=>createHash('sha256').update(b).digest('hex');
assert.ok(out.startsWith(path.resolve('outputs')+path.sep));await fs.mkdir(out,{recursive:true});
const mod=(base,rel)=>import(pathToFileURL(path.join(base,rel))),node=path.join(root,'runtime/node/node.exe'),script=path.join(root,'packaging/portable-launch.mjs');
const report={status:'running',syntheticOnly:true,externalModelCalls:0,checks:[],root};
const command=(arg,env)=>new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(node,[script,arg],{cwd:root,env,windowsHide:true});child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>{if(code)return reject(Error(arg+': '+stderr+stdout));try{resolve(JSON.parse(stdout.trim()));}catch{reject(Error(stdout));}});});
const oldCatalog=JSON.parse(await fs.readFile(path.join(oldRoot,'resources/catalog-seed.json'))),oldSeed=JSON.parse(await fs.readFile(path.join(oldRoot,'resources/scene-seed.json'))),bundle=JSON.parse(await fs.readFile(path.join(oldRoot,'resources/native-pilot-materials.json')));
async function oldWorkspace(dataDir,native){
 const {createWorkspaceStore}=await mod(oldRoot,'server/workspace-store.mjs'),{createImportedTask}=await mod(oldRoot,'public/domain.mjs'),{sceneBasisForTask}=await mod(oldRoot,'public/scene-configuration.mjs');
 const store=await createWorkspaceStore({dataDir,catalogSeed:oldCatalog,sceneSeed:oldSeed,storageMode:'sharded',nativeLanguageStage:native?4:0}),at='2026-11-25T01:00:00.000Z';
 try{
  if(native){await store.enableLanguageGovernance();let v=await store.read();await store.selectLanguage({baseRevision:v.revision,operationId:'synthetic-language',language:'en',actor:'Synthetic upgrade test'});await store.installNativePilotMaterials(bundle);const before=await store.read();const {languageHash}=await mod(oldRoot,'server/native-language-materials.mjs');await store.activateNativePilotMaterials(bundle,{baseRevision:before.revision,operationId:'old-confirmation',actor:'Synthetic maintainer',reason:'Old bundle explicitly activated for fixture',acknowledgeUnreviewed:true,bundleHash:languageHash(bundle)});}
  const source=await store.putSource(Buffer.from('Synthetic old source only.'),'synthetic-upgrade.txt'),view=await store.read(),scene='新品产品咨询';
  const sessions=[{id:'OLD-SYNTHETIC-1',scene,startedAt:at,topic:'Synthetic question',channel:'Synthetic',product:'Synthetic item',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'هل توجد نسخة زرقاء؟'},{id:2,role:'客服',text:'Sí, existe una versión azul.'}]}];
  const state=createImportedTask(view.state,{name:'Synthetic old '+(native?'native':'legacy'),source,sessions,basisSnapshot:sceneBasisForTask(view.state,view.catalog,scene,at),reviewer:'Synthetic reviewer',now:at});
  return await store.save({baseRevision:view.revision,mutationId:'synthetic-task',state,catalog:view.catalog});
 }finally{await store.close();}
}
const {decodeWorkspaceArchive}=await mod(root,'server/workspace-archive.mjs');
for(const kind of ['fresh-en','fresh-zh','old-legacy','old-native']){
 const data=await fs.mkdtemp(path.join(out,kind+'-')),env={...process.env,LOCALAPPDATA:path.join(out,'localappdata'),DEMO_DATA_DIR:data,DEMO_PORT:'15170',WORKBENCH_WORKER_PORT:'15171',PORTABLE_STARTUP_TIMEOUT_MS:'90000'};delete env.WORKBENCH_NATIVE_LANGUAGE_STAGE;
 const previous=kind.startsWith('old-')?await oldWorkspace(data,kind==='old-native'):null;
 if(previous){await fs.mkdir(path.join(data,'desktop-profile/EBWebView/Default'),{recursive:true});await fs.writeFile(path.join(data,'desktop-profile/EBWebView/Default/.creating-browser-owned'),'synthetic browser-owned content');}
 let token,started=false,browser,page;const origin='http://127.0.0.1:15170';
 const api=async(route,body,expected=200)=>{const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{Origin:origin,...(token?{'X-Workspace-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const v=await response.json();assert.equal(response.status,expected,JSON.stringify(v));if(v.token)token=v.token;return v;};
 try{
  try{await fetch(origin,{signal:AbortSignal.timeout(400)});throw Error('Test port occupied');}catch(e){if(e.message==='Test port occupied')throw e;}
  assert.equal((await command('--no-open',env)).productVersion,'0.11.28');started=true;
  assert.equal((await api('/api/build-info')).version,'0.11.28');let view=await api('/api/workspace');
  assert.equal(view.catalog.rules.length,17);
  if(previous){
   assert.deepEqual(view.state.tasks,previous.state.tasks);assert.deepEqual(view.state.sessions,previous.state.sessions);assert.notEqual(view.builtinUpgrade.status,'failed',JSON.stringify(view.builtinUpgrade));
   assert.equal(await fs.readFile(path.join(data,'desktop-profile/EBWebView/Default/.creating-browser-owned'),'utf8'),'synthetic browser-owned content');

   if(kind==='old-native'){assert.equal(view.state.languageMaterials.releases.length,52);assert.notEqual(view.nativeLanguageReadiness.scenes.find(s=>s.sceneId==='电商评论回复'||s.scene==='电商评论回复')?.status,'ready');assert.equal(view.state.languageAudit.filter(e=>e.action==='activate-pilot-materials').length,1);}
   else assert.equal(view.state.workspaceSettings.languagePolicy.mode,'legacy-display-v1');
   report.checks.push({id:kind+'-upgrade',oldTasksFrozen:true,backupPassed:true,oldCacheUnchanged:true});
  }else{
   assert.equal(view.state.workspaceSettings.languagePolicy.mode,'pending-selection');assert.equal(view.state.languageMaterials?.releases?.length||0,0);assert.ok(!view.state.languageAudit.some(e=>e.action==='install-pilot-materials'));
   const language=kind.endsWith('en')?'en':'zh';
   if(language==='en'){
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(origin);await page.locator('[data-act="language-pick"][data-language="en"]').click();await page.locator('[data-act="language-confirm"]').click();await page.locator('[data-act="native-pilot-open"]').waitFor();view=await api('/api/workspace');
   }else view=await api('/api/workspace-language/select',{baseRevision:view.revision,operationId:'synthetic-select-'+language,actor:'Synthetic tester',language});
   assert.ok(view.nativeLanguageReadiness.scenes.every(s=>s.status!=='ready'));
   report.checks.push({id:kind+'-no-default-injection',status:'passed'});
  }
  if(kind!=='old-legacy'){
   const input={baseRevision:view.revision,operationId:'explicit-pilot-'+kind,actor:'Synthetic maintainer',reason:'Synthetic acceptance of unreviewed pilot materials',acknowledgeUnreviewed:true,bundleHash:view.nativePilotStatus.bundleHash};
   await api('/api/workspace-language/pilot/activate',{...input,acknowledgeUnreviewed:false},409);
   if(page){
    await page.locator('[data-act="native-pilot-open"]').click();await page.locator('#native-pilot-actor').fill(input.actor);await page.locator('#native-pilot-reason').fill(input.reason);assert.equal(await page.locator('[data-act="native-pilot-activate"]').isDisabled(),true);await page.locator('#native-pilot-acknowledge').check();await page.locator('[data-act="native-pilot-activate"]').click();await page.locator('[data-act="native-pilot-activate"]').waitFor({state:'detached'});view=await api('/api/workspace');await page.screenshot({path:path.join(out,'fresh-english-activated.png'),fullPage:true});
   }else view=await api('/api/workspace-language/pilot/activate',input);
   assert.ok(view.state.languageMaterials.releases.length>=52);
   const np=view.nativeLanguageReadiness.scenes.find(s=>s.sceneId==='新品产品咨询'||s.scene==='新品产品咨询'),ec=view.nativeLanguageReadiness.scenes.find(s=>s.sceneId==='电商评论回复'||s.scene==='电商评论回复');
   assert.equal(np?.status,'ready',JSON.stringify(view.nativeLanguageReadiness));assert.equal(ec?.status,'ready',JSON.stringify(view.nativeLanguageReadiness));
   assert.ok(view.state.languageAudit.some(e=>e.action==='activate-pilot-materials'&&e.actor===input.actor&&e.reason===input.reason));report.checks.push({id:kind+'-explicit-activation',npReady:true,ecReady:true});
  }
  const r=await fetch(origin+'/api/workspace-backup/export',{method:'POST',headers:{Origin:origin,'X-Workspace-Token':token,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200,await(r.ok?Promise.resolve(''):r.text()));const backup=decodeWorkspaceArchive(Buffer.from(await r.arrayBuffer()));assert.ok(backup.files.has('workspace.json'));assert.ok(![...backup.files.keys()].some(p=>p.startsWith('desktop-profile/')));assert.deepEqual(backup.document.state.tasks,view.state.tasks);
  const current=view;await command('--stop',env);started=false;token=null;await command('--no-open',env);started=true;view=await api('/api/workspace');assert.deepEqual(view.state.tasks,current.state.tasks);assert.deepEqual(view.state.languageAudit,current.state.languageAudit);report.checks.push({id:kind+'-backup-restart',status:'passed'});
  await fs.writeFile(path.join(out,kind+'-after.json'),JSON.stringify(view));
 }finally{if(browser)await browser.close();if(started)assert.equal((await command('--stop',env)).state,'stopped');}
 if(kind==='old-native'){
  const {createWorkspaceStore}=await mod(root,'server/workspace-store.mjs'),store=await createWorkspaceStore({dataDir:data,nativeLanguageStage:4});try{for(const task of previous.state.tasks)await store.readNativeMaterial(task);}finally{await store.close();}report.checks.push({id:'old-native-frozen-material-read',status:'passed'});
 }
}
for(const name of ['scene-seed.json','catalog-seed.json'])assert.equal(sha(await fs.readFile(path.join(root,'resources',name))),sha(await fs.readFile(path.join(oldRoot,'resources',name))));assert.notEqual(sha(await fs.readFile(path.join(root,'resources/native-pilot-materials.json'))),sha(await fs.readFile(path.join(oldRoot,'resources/native-pilot-materials.json'))));
report.status='passed';await fs.writeFile(path.join(out,'installed-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
