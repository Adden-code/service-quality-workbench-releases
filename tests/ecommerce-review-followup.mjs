// Continue only the explicitly named, completely fictional QA workspace. No model calls.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkbenchServer} from '../server.mjs';
import {getManagementReport} from '../public/management-report.mjs';
const output=path.resolve(process.argv[2]||'');
assert.ok(output.startsWith(path.resolve('D:/Codex project/outputs/service-ecommerce-implementation-20261030')+path.sep));
const dataDir=path.join(output,'workspace');let calls=0;
const modelConfig={publicConfig:()=>({configured:true,keyConfigured:true,model:'glm-5.3-flash'}),getPrivate:()=>({apiKey:null,model:'glm-5.3-flash'})};
let server=await createWorkbenchServer({dataDir,modelConfig,arkClient:{inspectEcommerce:async()=>{calls++;throw new Error('QA followup must not call a model');}}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'}),context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage();
page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const get=async()=>{const response=await context.request.get(url+'/api/workspace');return response.json();};
try{
  await page.goto(url+'/#review');let doc=await get();const task=doc.state.tasks[0],rows=doc.state.sessions.filter(s=>s.taskId===task.id),target=rows.find(s=>s.review.status!=='已确认'&&Date.parse(s.startedAt)<=Date.now()&&s.aiResults.some(r=>r.ruleId==='EC-TARGET'&&r.verdict==='不符合'));
  assert.ok(target);const originalAI=structuredClone(target.aiResults),originalSource=structuredClone(target.ecommerce);
  await page.locator(`[data-act="select-session"][data-id="${target.id}"]`).click();await page.locator('[data-act="accept-ai"]').click();
  const toggle=page.locator('[data-act="toggle-rule"][data-id="EC-TARGET"]');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await page.locator('.result-card [data-act="edit-result"][data-rule="EC-TARGET"]').click();
  await page.locator('#edit-reason').fill('人工核对本批次同一管理员的三条虚构回复及原文，确认高度相似，保留不符合结论。工程验证，不代表真实业务效果。');
  await page.locator('[data-act="save-result"]').click();await page.locator('[data-act="confirm-review"]').click();await page.locator('[data-act="do-confirm-review"]').click();
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');doc=await get();const saved=doc.state.sessions.find(s=>s.id===target.id);
  assert.equal(saved.review.status,'已确认');assert.deepEqual(saved.aiResults,originalAI);assert.deepEqual(saved.ecommerce,originalSource);assert.match(saved.review.drafts['EC-TARGET'].reason,/人工核对/);
  await page.screenshot({path:path.join(output,'02c-human-override.png'),fullPage:true});
  const report=getManagementReport(doc.state,{period:'batch',taskId:task.id,referenceDate:'2026-10-30'});assert.equal(report.stats.reviewedCount,2);assert.equal(report.stats.problemSessions,1);assert.equal(report.problemRate,50);
  await page.locator('.nav-link').filter({hasText:'结果导出'}).click();await page.locator('#export-task').selectOption(task.id);await page.locator('input[name="export-status"][value="all"]').check();
  for(const[action,file]of [['export-xlsx','质检明细_两条人工确认.xlsx'],['export-html','质检明细_两条人工确认.html']]){const p=page.waitForEvent('download');await page.locator(`[data-act="${action}"]`).click();await(await p).saveAs(path.join(output,file));}
  await page.locator('#report-period').selectOption('batch');await page.locator('#report-task').selectOption(task.id);const pending=page.waitForEvent('download');await page.locator('[data-act="export-management"]').click();await(await pending).saveAs(path.join(output,'管理分析_两条人工确认.html'));
  assert.equal(calls,0);assert.deepEqual(errors,[]);
  const before=createHash('sha256').update(await fs.readFile(path.join(dataDir,'workspace.json'))).digest('hex');await new Promise(r=>server.close(r));server=await createWorkbenchServer({dataDir,modelConfig});await new Promise(r=>server.listen(0,'127.0.0.1',r));const after=createHash('sha256').update(await fs.readFile(path.join(dataDir,'workspace.json'))).digest('hex');assert.equal(before,after);
  const result={additionalModelCalls:calls,confirmed:2,problemSessions:1,problemRate:50,referenceAndAIUnchanged:true,humanReasonEdited:true,restartBytesUnchanged:true,workspaceSha256:after,pageErrors:errors};
  await fs.writeFile(path.join(output,'additional-review-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}
