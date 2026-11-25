import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {authorizePilotMaterial,languageHash} from '../server/native-language-materials.mjs';
import {nativePilotPromptDraft} from '../server/native-language-prompt-draft.mjs';
const scratch=path.resolve('outputs/native-pilot-activation-browser');await fs.mkdir(scratch,{recursive:true});const root=await fs.mkdtemp(path.join(scratch,'synthetic-')),payload=path.join(root,'payload');
const authorization={actor:'SYNTHETIC bundle author',reason:'Synthetic browser fixture; business review pending',authorizationId:'synthetic-browser',at:'2026-11-25T01:00:00Z'},bundle={schemaVersion:1,id:'synthetic-browser',version:'1',authorization,materials:[authorizePilotMaterial(nativePilotPromptDraft(),authorization)]};
let server,browser;const observations=[];
try{
 await fs.mkdir(path.join(payload,'resources'),{recursive:true});await fs.mkdir(path.join(payload,'packaging'),{recursive:true});
 await Promise.all(['server','public'].map(dir=>fs.cp(path.resolve(dir),path.join(payload,dir),{recursive:true})));await fs.copyFile(path.resolve('server.mjs'),path.join(payload,'server.mjs'));await fs.copyFile(path.resolve('packaging/version.mjs'),path.join(payload,'packaging/version.mjs'));await fs.writeFile(path.join(payload,'resources/native-pilot-materials.json'),JSON.stringify(bundle));
 const {createWorkbenchServer}=await import(pathToFileURL(path.join(payload,'server.mjs')));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
 for(const language of ['en','zh']){
  const dataDir=path.join(root,'workspace-'+language),start=async()=>{server=await createWorkbenchServer({dataDir,nativeLanguageStage:4,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;};let origin=await start();
  const initial=await(await fetch(origin+'/api/workspace')).json();assert.equal(initial.nativePilotStatus.status,'inactive');assert.equal(initial.state.languageMaterials,undefined);assert.ok(!initial.state.languageAudit.some(e=>e.action==='install-pilot-materials'));
  await new Promise(resolve=>server.close(resolve));server=null;origin=await start();let view=await(await fetch(origin+'/api/workspace')).json();assert.equal(view.revision,initial.revision);assert.deepEqual(view.state,initial.state);
  const post=async(body,headers={})=>{const r=await fetch(origin+'/api/workspace-language/pilot/activate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':view.token,...headers},body:JSON.stringify(body)});return{status:r.status,value:await r.json()};};
  const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('[data-act="language-pick"][data-language="'+language+'"]').click();await page.locator('[data-act="language-confirm"]').click();await page.locator('[data-act="native-pilot-open"]').waitFor();
  view=await(await fetch(origin+'/api/workspace')).json();const input={baseRevision:view.revision,operationId:'api-'+language,actor:'SYNTHETIC operator',reason:'Synthetic HTTP trial',acknowledgeUnreviewed:true,bundleHash:view.nativePilotStatus.bundleHash};
  assert.equal((await post(input,{'X-Workspace-Token':''})).status,403);assert.equal((await post(input,{Origin:'http://invalid.example'})).status,403);
  for(const change of [{acknowledgeUnreviewed:false},{actor:' '},{reason:''},{baseRevision:0},{bundleHash:'0'.repeat(64)},{material:bundle.materials[0]}])assert.equal((await post({...input,...change})).status,409);
  assert.equal((await(await fetch(origin+'/api/workspace')).json()).revision,view.revision);
  await page.locator('[data-act="native-pilot-open"]').click();const dialog=page.getByRole('dialog');assert.match(await dialog.innerText(),language==='en'?/have not completed.*business review/:/尚未完成.*业务核对/);
  const activate=page.locator('[data-act="native-pilot-activate"]');assert.equal(await activate.isDisabled(),true);await page.locator('#native-pilot-actor').fill('SYNTHETIC browser operator');await page.locator('#native-pilot-reason').fill('Synthetic explicit browser activation');assert.equal(await activate.isDisabled(),true);await page.locator('#native-pilot-acknowledge').check();assert.equal(await activate.isEnabled(),true);
  await page.screenshot({path:path.join(scratch,'activation-'+language+'.png'),fullPage:true});await activate.click();await activate.waitFor({state:'detached'});assert.match(await dialog.innerText(),language==='en'?/activated for this workspace/:/试用材料已启用/);
  const saved=await(await fetch(origin+'/api/workspace')).json(),event=saved.state.languageAudit.at(-1);assert.equal(event.action,'activate-pilot-materials');assert.equal(event.actor,'SYNTHETIC browser operator');assert.equal(event.reason,'Synthetic explicit browser activation');assert.equal(event.after.bundleHash,languageHash(bundle));assert.equal(saved.nativePilotStatus.status,'active');assert.equal(saved.nativeLanguageReadiness.status,'blocked','One prompt cannot make either scene ready');assert.equal(saved.state.languageMaterials.releases.length,1);assert.deepEqual(errors,[]);
  await page.close();await new Promise(resolve=>server.close(resolve));server=null;origin=await start();const restarted=await(await fetch(origin+'/api/workspace')).json();assert.equal(restarted.revision,saved.revision);assert.deepEqual(restarted.state.languageAudit,saved.state.languageAudit);await new Promise(resolve=>server.close(resolve));server=null;
  observations.push({language,defaultInactive:true,noStartupRevisionChange:true,authOriginRevision:true,explicitCheckbox:true,bilingual:true,audit:true,restart:true,pageErrors:errors});
 }
 await fs.writeFile(path.join(scratch,'verification.json'),JSON.stringify({status:'passed',syntheticOnly:true,externalModelCalls:0,checks:observations},null,2));console.log(JSON.stringify(observations));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(scratch+path.sep));await fs.rm(root,{recursive:true,force:true});}
