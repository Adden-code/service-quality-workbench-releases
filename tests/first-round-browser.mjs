import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkbenchServer} from '../server.mjs';

const output=await fs.mkdtemp('D:/Codex project/outputs/service-quality-first-round-20261029/browser-');
const dataDir=path.join(output,'workspace');
let server=await createWorkbenchServer({dataDir});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,url=`http://127.0.0.1:${port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_BROWSER_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:'reduce'});
let page=await context.newPage();
page.setDefaultTimeout(10000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const act=name=>name==='close-modal'?page.locator(`[data-act="${name}"]`).first():page.locator(`[data-act="${name}"]`);
const nav=async name=>page.locator('.nav-link').filter({hasText:name}).click();
const saved=async()=>{await page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');};
async function original(){return (await context.request.get(`${url}/api/workspace`)).json();}
const raw={format:'SERVICE_QUALITY_INPUT_V1',sessions:[{
  id:'UNSEEN-WATCH-001',scene:'新品产品咨询',startedAt:'2026-10-28T09:30:00+08:00',topic:'全新虚构手表颜色咨询',channel:'虚构商城',product:'澄光X2（虚构）',agent:'客服乙（虚构）',customer:'客户甲（虚构）',completeness:'完整',missingNote:'',
  turns:[{id:1,role:'客户',speaker:'客户甲（虚构）',at:'2026-10-28T09:30:01+08:00',text:'这款澄光X2有哪些颜色？'},{id:2,role:'客服',speaker:'客服乙（虚构）',at:'2026-10-28T09:30:10+08:00',text:'我先核对正式产品资料后向您说明。'}]
}]};
const bytes=Buffer.from(JSON.stringify(raw,null,2)),input=path.join(output,'新会话_虚构.json');await fs.writeFile(input,bytes);
async function importFile(file,name,rule='R004',expectFailure=false){
  await nav('质检任务');await act('new-task').click();await page.locator('#input-upload').setInputFiles(file);
  await page.locator('#new-task-name').waitFor();assert.match(await page.locator('.modal').innerText(),/UNSEEN-WATCH/);
  await page.locator('#new-task-name').fill(name);await page.locator('#new-task-reviewer').fill('试用审核员（虚构）');await act('new-next').click();
  for(const id of Array.isArray(rule)?rule:[rule])await page.locator(`[name="task-rule"][value="${id}"]`).check();await act('create-business-task').click();if(!expectFailure)await page.locator('.review-shell').waitFor();await saved();
}
try{
  await page.route('**/api/workspace',route=>route.request().method()==='PUT'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'隔离测试：首次初始化写入失败'})}):route.continue());
  await page.goto(url);await page.getByRole('heading',{name:'工作概览',exact:true}).waitFor();
  assert.equal((await original()).initialized,false);assert.match(await page.locator('#workspace-warning').innerText(),/首次初始化写入失败/);
  await page.unroute('**/api/workspace');await act('workspace-reload').click();await page.waitForFunction(()=>!document.getElementById('workspace-warning')?.textContent.trim());
  assert.equal((await original()).initialized,true);
  for(const title of ['质检任务','人工审核','质检规则','政策与知识','结果导出']){await nav(title);assert.equal(await page.locator('.page-error').count(),0);}
  await page.locator('#data-mode').selectOption('manual');await nav('质检任务');await act('new-task').click();
  const blankPromise=page.waitForEvent('download');await page.locator('.modal [data-act="download-business-template"]').click();const blank=await blankPromise;const blankPath=path.join(output,'空白模板.xlsx');await blank.saveAs(blankPath);assert.equal((await fs.readFile(blankPath)).subarray(0,2).toString(),'PK');
  const samplePromise=page.waitForEvent('download');await act('download-business-sample').click();const sample=await samplePromise;const samplePath=path.join(output,'业务样例.xlsx');await sample.saveAs(samplePath);
  await page.locator('#input-upload').setInputFiles(samplePath);await page.locator('#new-task-name').waitFor();assert.match(await page.locator('.modal').innerText(),/SAMPLE-EARBUD-001/);await act('close-modal').click();
  await importFile(input,'第一轮新文件验证');
  assert.match(await page.locator('.conversation-pane').innerText(),/全新虚构手表颜色咨询|澄光X2/);
  assert.equal(await act('accept-ai').count(),0);assert.match(await page.locator('.results-pane').innerText(),/AI未执行|待人工判断/);
  let doc=await original(),task=doc.state.tasks[0];
  assert.equal(task.mode,'manual');assert.equal(task.source.sha256,createHash('sha256').update(bytes).digest('hex'));
  const session=doc.state.sessions.find(s=>s.taskId===task.id);assert.deepEqual(session.aiResults,[]);assert.equal(session.externalId,'UNSEEN-WATCH-001');
  assert.deepEqual(task.basisSnapshot.rules.map(r=>r.id),['R004']);
  // Missing human judgments cannot be silently converted into a successful final review.
  await act('confirm-review').click();await act('do-confirm-review').click();
  assert.match(await page.locator('#form-error').innerText(),/逐项/);await act('close-modal').click();
  await page.locator('.review-dock [data-act="edit-result"]').click();
  await page.locator('#edit-verdict').selectOption('无法判定');await page.locator('#edit-reason').fill('材料没有颜色信息，需要补充；虚构验证。');
  await page.locator('#edit-evidence').fill('1;2');await act('save-result').click();await saved();await page.locator('.modal').waitFor({state:'hidden'});
  doc=await original();assert.equal(doc.state.sessions.find(s=>s.id===session.id).review.status,'待补充');
  await act('confirm-review').click();await act('do-confirm-review').click();assert.match(await page.locator('#form-error').innerText(),/无法判定/);await act('close-modal').click();
  // A failed save must leave the form and entered text intact, and the server unchanged.
  await page.locator('.review-dock [data-act="edit-result"]').click();await page.locator('#edit-verdict').selectOption('符合');
  await page.locator('#edit-reason').fill('客服先核实资料，未作夸大承诺。虚构人工判断。');
  await page.route('**/api/workspace',route=>route.request().method()==='PUT'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'隔离测试：写入失败'})}):route.continue());
  await act('save-result').click();await page.waitForFunction(()=>document.getElementById('form-error')?.textContent.includes('写入失败'));assert.match(await page.locator('#form-error').innerText(),/写入失败/);
  assert.match(await page.locator('#edit-reason').inputValue(),/客服先核实/);assert.equal((await original()).state.sessions.find(s=>s.id===session.id).review.status,'待补充');
  await page.unroute('**/api/workspace');await act('save-result').click();await saved();await page.locator('.modal').waitFor({state:'hidden'});
  await act('confirm-review').click();await act('do-confirm-review').click();await page.locator('.review-completion').waitFor();assert.match(await page.locator('.review-completion').innerText(),/全部审核完成/);
  doc=await original();assert.equal(doc.state.sessions.find(s=>s.id===session.id).review.history.length,2);
  await page.screenshot({path:path.join(output,'01-complete.png'),fullPage:true});
  await act('completion-export').click();
  const reportPromise=page.waitForEvent('download');await act('export-html').click();const report=await reportPromise;const reportPath=path.join(output,'质检明细报告.html');await report.saveAs(reportPath);
  const html=await fs.readFile(reportPath,'utf8');assert.match(html,/UNSEEN-WATCH-001/);assert.match(html,/AI未执行/);assert.match(html,/客服先核实/);
  await page.locator('#report-period').selectOption('batch');
  assert.equal(await page.locator('[data-report-metric="total"]').innerText(),'1');
  const managementPromise=page.waitForEvent('download');await act('export-management').click();const management=await managementPromise;const managementPath=path.join(output,'管理分析报告.html');await management.saveAs(managementPath);
  assert.doesNotMatch(await fs.readFile(managementPath,'utf8'),/这款澄光X2有哪些颜色/);
  // Publish changed reference text and a genuinely new rule through the visible UI.
  const oldBasis=structuredClone((await original()).state.tasks.find(t=>t.id===task.id).basisSnapshot);
  await nav('政策与知识');await page.locator('[data-act="catalog-open"][data-id="P004"]').click();await act('catalog-new-version').click();
  await page.locator('#cat-section-text-0').fill('虚构新版：沟通时先明确问题再核对资料，保留版本验证标记。');
  await page.locator('#cat-changeNote').fill('虚构新版引用冻结验证');await act('catalog-save').click();await act('catalog-publish').click();await page.locator('#catalog-close-previous').check();await act('catalog-do-publish').click();await act('close-modal').click();
  await nav('质检规则');await act('catalog-new-rule').click();
  for(const [key,value] of Object.entries({id:'QA-NEW',title:'核实颜色问题',category:'虚构产品说明',scope:'本轮虚构手表咨询',owner:'虚构规则维护员',policyIds:'P004',passCriteria:'先明确问题并核实资料。',failCriteria:'未理解问题就直接承诺。',exceptionCriteria:'缺少上下文时待补充。',changeNote:'虚构新增规则验证'}))await page.locator(`#cat-${key}`).fill(value);
  await act('catalog-save-new-rule').click();await act('catalog-publish').click();await act('catalog-do-publish').click();await act('close-modal').click();
  const raw2=structuredClone(raw);raw2.sessions[0].id='UNSEEN-WATCH-002';const input2=path.join(output,'新会话2_虚构.json');await fs.writeFile(input2,JSON.stringify(raw2));
  await importFile(input2,'新版依据与两项检查验证',['QA-NEW','R004']);
  doc=await original();const task2=doc.state.tasks[0];
  assert.deepEqual(doc.state.tasks.find(t=>t.id===task.id).basisSnapshot,oldBasis);
  assert.equal(task2.basisSnapshot.policies.find(p=>p.id==='P004').version,'V1.1');assert.equal(task2.basisSnapshot.rules.length,2);
  assert.match(await page.locator('.results-pane').innerText(),/核实颜色问题/);assert.match(await page.locator('.results-pane').innerText(),/2项检查/);
  await page.locator('.review-dock [data-act="edit-result"]').click();await page.locator('#edit-reason').fill('冲突后仍保留的虚构人工判断');
  const other=await context.newPage();await other.goto(`${url}/#review`);await other.locator('[data-act="pending"]').click();await other.locator('#pending-notes').fill('另一窗口补充资料（虚构）');await other.locator('[data-act="save-pending"]').click();await other.locator('.modal').waitFor({state:'hidden'});
  await act('save-result').click();await page.waitForFunction(()=>document.querySelector('#form-error [data-act="workspace-reload"]'));assert.match(await page.locator('#form-error').innerText(),/另一页面更新/);assert.match(await page.locator('#edit-reason').inputValue(),/冲突后仍保留/);
  await page.locator('#form-error [data-act="workspace-reload"]').click();assert.match(await page.locator('#edit-reason').inputValue(),/冲突后仍保留/);
  await act('save-result').click();await page.locator('.modal').waitFor({state:'hidden'});await other.close();
  // Reset preset cases cannot remove file tasks or their complete human history.
  await act('reset').click();await act('do-reset').click();await saved();await page.locator('.modal').waitFor({state:'hidden'});
  assert.equal((await original()).state.tasks.filter(t=>t.mode==='manual').length,2);
  await nav('质检任务');const sourcePromise=page.waitForEvent('download');await page.locator(`[data-act="download-source"][data-id="${task.id}"]`).click();const source=await sourcePromise;const sourcePath=path.join(output,'原文件.json');await source.saveAs(sourcePath);assert.deepEqual(await fs.readFile(sourcePath),bytes);
  await page.locator(`[data-act="task-review"][data-id="${task.id}"]`).click();await act('view-confirmed').click();await page.screenshot({path:path.join(output,'02-review.png'),fullPage:true});
  await page.setViewportSize({width:1146,height:704});await page.screenshot({path:path.join(output,'03-review-1146.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'审核页面不能横向溢出');
  // Restart server and use a fresh browser storage area: all records come from disk.
  const before=await original();await context.close();await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  server=await createWorkbenchServer({dataDir});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  const fresh=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});page=await fresh.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}/#tasks`);await page.getByRole('heading',{name:'质检任务',exact:true}).waitFor();
  assert.equal(await page.locator('#data-mode').inputValue(),'manual');assert.match(await page.locator('.content').innerText(),/第一轮新文件验证/);
  const after=await (await fresh.request.get(`${url}/api/workspace`)).json();assert.deepEqual(after.state,before.state);assert.deepEqual(after.catalog,before.catalog);
  assert.equal(await page.evaluate(()=>localStorage.length),0);
  // Duplicate original ids are rejected without creating another task or closing the dialog.
  await importFile(input,'不应创建的重复文件','R004',true);
  assert.match(await page.locator('#form-error').innerText(),/重复/);assert.equal((await (await fresh.request.get(`${url}/api/workspace`)).json()).state.tasks.filter(t=>t.mode==='manual').length,2);
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({passed:true,port,dataDir,checks:['bootstrap failure recovers','legacy navigation','XLSX template and sample download/parse','fresh original import','no preset AI','frozen basis','missing/unknown confirmation blocked','failed save retains form','human history','completion','two reports','source bytes','demo reset isolation','1146 viewport','disk restart in fresh browser','duplicate rejected','policy publication','custom rule creation','new task has new version','multi-window conflict preserves input'],errors},null,2));
  console.log(JSON.stringify({passed:true,output,port,checks:20}));
  await fresh.close();
}finally{await browser.close();if(server.listening)await new Promise(resolve=>server.close(resolve));}
