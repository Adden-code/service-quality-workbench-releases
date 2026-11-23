import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.VERIFY_APP_ROOT||'.');
const load=p=>import(pathToFileURL(path.join(root,p)));
const out=path.resolve(process.env.VERIFY_TIME_OUTPUT||'../outputs/service01120-20261123/time-browser');
await fs.mkdir(out,{recursive:true});
const {createWorkbenchServer}=await load('server.mjs');
const {workbook}=await load('public/io.mjs');
const {SYSTEM_EC_HEADERS}=await load('public/ecommerce-system-source.mjs');
const material='D:/Codex project/service-quality-internal-materials/';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const catalogSeed=await read(material+'20261119/catalog-seed.01112.json');
const oldSeed=await read(material+'20261120/scene-seed.01118.v1.json');
const newSeed=await read(material+'20261123/scene-seed.01120.v1.json');
const oldEC=oldSeed.packages.find(p=>p.configuration.engine==='ecommerce');
oldEC.configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors=2;
oldEC.configuration.basis.businessProfile.timing.defaultHours=48;
oldEC.configuration.basis.businessProfile.timing.sites=[{id:'synthetic-mx',label:'墨西哥',aliases:['MX']}];
oldEC.configuration.basis.businessProfile.timing.defaultSource='Synthetic local standard';
oldEC.template.groupBy='site';
const dataDir=await fs.mkdtemp(path.join(out,'workspace-'));
const record=Array(23).fill('');
Object.assign(record,{0:'SYN-21',3:'Synthetic product',4:'VMALL-MX-HWB2C',5:'Synthetic device arrived without its cable.',6:'Synthetic reply: We arranged a replacement cable for you.',7:'5',8:'Synthetic administrator',9:'2026-11-20 10:00:00',16:'2026-11-20 12:00:00'});
const input=path.join(out,'synthetic.xlsx');
await fs.writeFile(input,await workbook([{name:'Export',headers:SYSTEM_EC_HEADERS,rows:[record]}]));
let server,origin;
async function start(sceneSeed){server=await createWorkbenchServer({dataDir,catalogSeed,sceneSeed});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;}
async function stop(){await new Promise(r=>server.close(r));server=null;}
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
const state=async()=>await(await fetch(origin+'/api/workspace')).json();
async function task(name){
 await page.goto(origin+'/#tasks');await page.locator('[data-act="new-task"]').first().click();
 await page.locator('[data-act="task-scene"][data-scene="电商评论回复"]').click();
 await page.locator('#ec-file').setInputFiles(input);await page.locator('#import-preview-confirm').waitFor();
 await page.locator('#ec-name').fill(name);await page.locator('#ec-reviewer').fill('Synthetic reviewer');
 await page.locator('#import-preview-confirm').check();await page.locator('[data-act="ec-next"]').click();
 await page.locator('[data-act="ec-create"]').click();await page.locator('.modal').waitFor({state:'detached'});
 return(await state()).state.tasks.find(t=>t.name===name);
}
async function sceneList(){await page.goto(origin+'/#tasks');const back=page.getByText('返回任务列表',{exact:true});if(await back.isVisible())await back.click();await page.locator('[data-act="scenario-manage"]').click();await page.locator('[data-act="scfg-open"][data-id="电商评论回复"]').click();}
try{
 await start(oldSeed);const oldTask=await task('Synthetic historical policy');const before=await state();
 assert.equal(oldTask.basisSnapshot.businessProfile.timing.policyVersion,undefined);assert.equal(oldTask.basisSnapshot.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);await stop();
 await start(newSeed);await sceneList();await page.locator('[data-act="scfg-ec-policy-open"]').click();
 await page.locator('#scfg-actor').fill('Synthetic custodian');await page.locator('#scfg-reason').fill('Synthetic requirement 29 fixed24 upgrade');
 await page.screenshot({path:path.join(out,'upgrade-confirmation.png')});
 await page.locator('[data-act="scfg-ec-policy-install"]').click();
 await page.locator('[data-act="scfg-view-published"]').waitFor();
 const upgraded=await state();const ec=upgraded.state.sceneConfigurations.filter(c=>c.engine==='ecommerce').at(-1);
 assert.equal(ec.basis.businessProfile.semanticPolicy.version,'ec-human-aligned-v1');
 assert.equal(ec.basis.businessProfile.timing.defaultHours,24);assert.equal(ec.basis.businessProfile.timing.policyVersion,'ec-first-reply-fixed24-v1');assert.equal(ec.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
 assert.deepEqual(ec.basis.businessProfile.timing.sites,oldEC.configuration.basis.businessProfile.timing.sites);assert.deepEqual(ec.ruleDependencies['EC-TIME'],[]);assert.deepEqual(ec.ruleDependencies['EC-STEPS'],['ecommerceClassification']);
 assert.deepEqual(upgraded.catalog,before.catalog);
 assert.deepEqual(upgraded.state.sceneConfigurations.filter(c=>c.engine!=='ecommerce'),before.state.sceneConfigurations.filter(c=>c.engine!=='ecommerce'));
 assert.deepEqual(upgraded.state.tasks,before.state.tasks);assert.deepEqual(upgraded.state.sessions,before.state.sessions);
 assert.ok(upgraded.state.sceneConfigurationEvents.some(e=>e.actor==='Synthetic custodian'&&e.reason==='Synthetic requirement 29 fixed24 upgrade'&&e.diff.length));
 await page.locator('[data-act="close-modal"]').click();const fresh=await task('Synthetic calibrated policy');
 assert.equal(fresh.basisSnapshot.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);assert.equal(fresh.basisSnapshot.businessProfile.timing.policyVersion,'ec-first-reply-fixed24-v1');
 assert.equal(fresh.executionSnapshot.template.groupBy,'site');assert.equal(fresh.basisSnapshot.businessProfile.timing.defaultHours,24);
 await sceneList();await page.locator('[data-act="scfg-new"]').click();
 await page.getByText('首次回复时效 · 统一 24 小时',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-scfg-path="configuration.basis.businessProfile.timing.defaultHours"], [data-scfg-path*="timing.standards"], [data-scfg-dependency="EC-TIME"]').count(),0);
 assert.equal(await page.locator('[data-scfg-dependency="EC-STEPS"][data-key="ecommerceClassification"]').isChecked(),true);
 await page.getByText('首次回复时效 · 统一 24 小时',{exact:true}).scrollIntoViewIfNeeded();
 await page.locator('.toast').waitFor({state:'hidden',timeout:7000}).catch(()=>{});
 await page.screenshot({path:path.join(out,'fixed24-config.png')});
 await page.locator('[data-act="close-modal"]').click();
 const after=await state();assert.deepEqual(after.state.tasks.find(t=>t.id===oldTask.id),oldTask);assert.deepEqual(after.state.tasks.find(t=>t.id===fresh.id),fresh);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',root,externalModelCalls:0,oldTaskPreserved:true,NPUnchanged:true,catalogUnchanged:true,old48HourTaskPreserved:true,newFixed24:true,regionDictionaryRetained:true,siteGroupingRetained:true,semanticThreshold2Preserved:true,uiPublication:true,timingPolicy:ec.basis.businessProfile.timing.policyVersion},null,2));
 console.log('Installed fixed24 upgrade, frozen tasks, semantic threshold and region/group settings passed');
}catch(error){await page.screenshot({path:path.join(out,'failure.png')});await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText());throw error;}
finally{await browser.close();if(server)await stop();}
