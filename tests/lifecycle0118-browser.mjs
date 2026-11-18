import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const appRoot=process.env.VERIFY_APP_ROOT||path.resolve('.');
const mod=rel=>import(pathToFileURL(path.join(appRoot,rel)));
const {createWorkbenchServer}=await mod('server.mjs');
const {createBusinessState}=await mod('public/domain.mjs');
const {createCatalog}=await mod('public/catalog.mjs');
const out=path.resolve('../outputs/service0118-20261118/browser');await fs.mkdir(out,{recursive:true});const dataDir=await fs.mkdtemp(path.join(out,'workspace-'));
const server=await createWorkbenchServer({dataDir,catalogSeed:null,sceneSeed:null,storageMode:'sharded'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const initial=await(await fetch(origin+'/api/workspace')).json();const init=await fetch(origin+'/api/workspace',{method:'PUT',headers:{Origin:origin,'X-Workspace-Token':initial.token,'Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,mutationId:'synthetic-init',state:createBusinessState(),catalog:createCatalog()})});assert.equal(init.status,200);
const raw={format:'SERVICE_QUALITY_INPUT_V1',sessions:[{id:'SYNTHETIC-REPEAT',scene:'新品产品咨询',startedAt:'2026-11-17T09:00:00+08:00',topic:'Synthetic',channel:'Synthetic',product:'Synthetic',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'Synthetic customer',at:'',text:'Synthetic question'},{id:2,role:'客服',speaker:'Synthetic agent',at:'',text:'Synthetic answer'}]}]};const file=path.join(out,'synthetic-repeat.json');await fs.writeFile(file,JSON.stringify(raw));
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const act=(s)=>page.locator(`[data-act="${s}"]`).first();const nav=async()=>{await page.locator('.nav-link').filter({hasText:'质检任务'}).click();await page.locator('#task-folder-filter').waitFor();};const workspace=()=>fetch(origin+'/api/workspace').then(r=>r.json());
try{
 await page.goto(origin+'/#tasks');await page.locator('#task-folder-filter').waitFor();
 for(let i=1;i<=3;i++){
  await act('new-task').click();await page.locator('[data-act="task-scene"]').filter({hasText:'新品产品咨询'}).click();await page.locator('#input-upload').setInputFiles(file);await page.locator('#import-preview-confirm').waitFor();await page.locator('#new-task-name').fill('Synthetic repeat '+i);await page.locator('#new-task-reviewer').fill('Synthetic reviewer');await page.locator('#import-preview-confirm').check();await act('new-next').click();
  await page.locator('[name="task-rule"][value="R004"]').check();await act('create-business-task').click();await page.waitForFunction(()=>!document.querySelector('.modal'));
  const state=(await workspace()).state;assert.equal(state.tasks.length,i);assert.equal(state.tasks[0].importLineage.ordinal,i);await nav();
 }
 assert.match(await page.locator('main').innerText(),/第3次/);const before=(await workspace()).state,id=before.tasks[0].id;
 await page.locator(`[data-act="task-detail"][data-id="${id}"]`).first().click();await page.locator(`[data-act="task-detail"][data-id="${before.tasks[2].id}"]`).waitFor();await nav();
 await page.screenshot({path:path.join(out,'repeat-imports.png'),fullPage:true});
 await page.locator(`[data-act="task-archive"][data-id="${id}"]`).click();await act('task-lifecycle-save').click();await page.waitForFunction(()=>!document.querySelector('.modal'));await page.locator('#task-folder-filter').selectOption('archived');
 await page.locator(`[data-act="task-void"][data-id="${id}"]`).click();await page.locator('#lifecycle-reason').fill('Synthetic discarded batch');await page.locator('#lifecycle-administrator').check();await act('task-lifecycle-save').click();await page.waitForFunction(()=>!document.querySelector('.modal'));await page.locator('#task-folder-filter').selectOption('voided');
 await page.locator(`[data-act="task-review"][data-id="${id}"]`).click();await page.locator('#history-verdict-filter').selectOption('未执行');assert.match(await page.locator('.history-review').innerText(),/SYNTHETIC-REPEAT/);assert.equal(await page.locator('.history-review button').count(),0);await page.screenshot({path:path.join(out,'readonly-history.png'),fullPage:true});await nav();await page.locator('#task-folder-filter').selectOption('voided');
 await page.locator(`[data-act="task-delete"][data-id="${id}"]`).click();await page.locator('#lifecycle-reason').fill('Synthetic permanent cleanup');await page.locator('#lifecycle-administrator').check();await page.locator('#lifecycle-confirm-id').fill('wrong');await act('task-lifecycle-save').click();await page.waitForFunction(()=>document.querySelector('#form-error')?.textContent.includes('完整任务编号'));assert.ok((await workspace()).state.tasks.some(t=>t.id===id));
 await page.locator('#lifecycle-confirm-id').fill(id);await act('task-lifecycle-save').click();await page.waitForFunction(()=>!document.querySelector('.modal'));const after=(await workspace()).state;assert.equal(after.tasks.length,2);assert.equal(after.taskDeletionAudit[0].task.id,id);assert.ok((await fs.stat(after.taskDeletionAudit[0].backupPath)).size>0);await page.locator('summary').filter({hasText:'任务删除审计'}).click();await page.screenshot({path:path.join(out,'deletion-audit.png'),fullPage:true});
 assert.deepEqual(after.tasks,before.tasks.slice(1));assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',repeatedWizardImports:3,administratorVoid:true,doubleConfirmation:true,backup:true,readonlyFilters:true,otherTasksUnchanged:true,pageErrors:errors,realModelCalls:0},null,2));console.log('browser lifecycle and three repeated imports passed');
}catch(e){await fs.writeFile(path.join(out,'failure.txt'),(await page.locator('body').innerText()).slice(0,18000));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
