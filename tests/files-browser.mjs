import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {readXlsx} from '../public/io.mjs';

async function captureDownload(page,button){
  const [download]=await Promise.all([page.waitForEvent('download'),button.click()]);
  assert.equal(await download.failure(),null);
  return fs.readFile(await download.path());
}

export async function verifyFileWorkflow(page,artifactDir){
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.nav-link').filter({hasText:'质检任务'}).click();
  const input=await captureDownload(page,page.getByRole('button',{name:'下载演示材料',exact:true}));
  const inputZip=await JSZip.loadAsync(input);
  const workbook=await inputZip.file('xl/workbook.xml').async('string');
  for(const sheet of ['会话信息','会话明细','质检规则','参考资料','验证案例','人工耗时'])assert.ok(workbook.includes(sheet),sheet);
  await fs.writeFile(path.join(artifactDir,'演示输入_浏览器下载.xlsx'),input);

  await page.getByRole('button',{name:'新建质检任务',exact:true}).click();
  await page.locator('#input-upload').setInputFiles({name:'下载的演示材料.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:input});
  await page.locator('#new-task-name').waitFor();
  await page.locator('#new-task-name').fill('浏览器验收 · 文件往返');
  await page.getByRole('button',{name:'下一步：确认规则',exact:true}).click();
  await page.getByRole('button',{name:'创建并开始模拟',exact:true}).click();
  const taskRow=page.locator('tbody tr').filter({hasText:'浏览器验收 · 文件往返'});
  await taskRow.getByRole('button',{name:/继续审核/}).waitFor();
  let stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('mss-presales-qa-demo:v1')));
  const task=stored.tasks.find(t=>t.name==='浏览器验收 · 文件往返');
  assert.equal(task.progress,100);
  assert.equal(task.sessionIds.length,8);
  await taskRow.getByRole('button',{name:/继续审核/}).click();
  await page.getByRole('button',{name:'确认本会话',exact:true}).click();
  await page.getByRole('button',{name:'确认审核结果',exact:true}).click();
  await page.locator('.nav-link').filter({hasText:'工作概览'}).click();
  await page.locator('[data-act="period"][data-value="batch"]').click();
  await page.locator('#dashboard-task').selectOption(task.id);
  assert.equal((await page.locator('.stat-value').first().innerText()).replace(/\s/g,''),'8条');
  assert.equal((await page.locator('.stat-value').nth(1).innerText()).replace(/\s/g,''),'1条');

  await page.locator('.nav-link').filter({hasText:'结果导出'}).click();
  await page.locator('#export-task').selectOption(task.id);
  const result=await captureDownload(page,page.getByRole('button',{name:'下载明细 Excel',exact:true}));
  const outputZip=await JSZip.loadAsync(result);
  const resultWorkbook=await outputZip.file('xl/workbook.xml').async('string');
  for(const sheet of ['结果明细','会话汇总','批次统计','口径说明'])assert.ok(resultWorkbook.includes(sheet),sheet);
  const xml=await Promise.all(Object.values(outputZip.files).filter(f=>!f.dir&&/\.xml$/.test(f.name)).map(f=>f.async('string')));
  const joined=xml.join('\n');
  assert.ok(joined.includes('DEMO_PRE001'));
  assert.ok(joined.includes('不符合'));
  assert.ok(joined.includes('无线充电'));
  assert.ok(!joined.includes('DEMO_PRE002'),'默认结果只导出该批次已确认的会话');
  await fs.writeFile(path.join(artifactDir,'审核结果_浏览器下载.xlsx'),result);
  const report=await captureDownload(page,page.getByRole('button',{name:'下载质检明细报告',exact:true}));
  assert.ok(report.toString('utf8').includes('DEMO_PRE001'));
  assert.ok(report.toString('utf8').includes('虚构'));
  await fs.writeFile(path.join(artifactDir,'审核报告_浏览器下载.html'),report);
  const reportPage=await page.context().newPage();
  await reportPage.setContent(report.toString('utf8'));
  assert.equal(await reportPage.getByRole('heading',{name:'售前咨询质检明细报告',exact:true}).count(),1);
  assert.ok(await reportPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'离线报告不得造成整体横向溢出');
  await reportPage.screenshot({path:path.join(artifactDir,'export-report.png')});
  await reportPage.close();
  await page.locator('#report-period').selectOption('batch');
  await page.locator('#report-task').selectOption(task.id);
  const management=await captureDownload(page,page.getByRole('button',{name:'下载管理分析报告',exact:true}));
  const managementHtml=management.toString('utf8');
  for(const title of ['质量管理报告','会话审核趋势','批次汇总','管理关注事项'])assert.ok(managementHtml.includes(title),title);
  assert.ok(managementHtml.includes('浏览器验收 · 文件往返'));
  assert.ok(!managementHtml.includes('DEMO_PRE001'),'管理报告不输出逐条会话记录');
  await fs.writeFile(path.join(artifactDir,'管理分析报告_浏览器下载.html'),management);
  await page.locator('[name="export-status"][value="all"]').check();
  assert.equal(await page.locator('.mini-metrics strong').first().innerText(),'8');
  const pendingExport=await captureDownload(page,page.getByRole('button',{name:'下载明细 Excel',exact:true}));
  const pendingZip=await JSZip.loadAsync(pendingExport);
  const pendingXml=(await Promise.all(Object.values(pendingZip.files).filter(f=>!f.dir&&/\.xml$/.test(f.name)).map(f=>f.async('string')))).join('\n');
  assert.ok(pendingXml.includes('DEMO_PRE002'));
  assert.ok(pendingXml.includes('待审核'));

  await page.locator('.nav-link').filter({hasText:'政策与知识'}).click();
  await page.getByRole('button',{name:'导出资料',exact:true}).click();
  const policies=await captureDownload(page,page.getByRole('button',{name:'下载资料 Excel',exact:true}));
  const policyTables=await readXlsx(policies);
  assert.equal(policyTables['资料信息'].length,5);
  assert.ok(policyTables['条款内容'].length>1);
  await fs.writeFile(path.join(artifactDir,'知识资料_浏览器下载.xlsx'),policies);

  await page.locator('.nav-link').filter({hasText:'质检任务'}).click();
  await page.getByRole('button',{name:'新建质检任务',exact:true}).click();
  await page.locator('#input-upload').setInputFiles({name:'未知会话.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'SERVICE_QUALITY_DEMO_V1',sessions:[{id:'UNKNOWN',turns:[{id:1,role:'客户',text:'真实材料不应套用演示结果'}]}]}))});
  await page.waitForFunction(()=>document.getElementById('form-error')?.textContent.trim());
  assert.equal(await page.locator('#new-task-name').count(),0,'未知材料不能进入模拟质检');
  await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.evaluate(()=>{
    const original=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=async function(){
      if(this.name==='slow-valid.xlsx'){
        await new Promise(resolve=>{window.releaseSlowDemoRead=resolve;});
        const buffer=await original.call(this);
        File.prototype.arrayBuffer=original;window.slowDemoReadFinished=true;
        return buffer;
      }
      return original.call(this);
    };
  });
  await page.getByRole('button',{name:'新建质检任务',exact:true}).click();
  await page.locator('#input-upload').setInputFiles({name:'slow-valid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:input});
  await page.waitForFunction(()=>typeof window.releaseSlowDemoRead==='function');
  await page.locator('#input-upload').setInputFiles({name:'latest-invalid.json',mimeType:'application/json',buffer:Buffer.from('{')});
  await page.waitForFunction(()=>document.getElementById('form-error')?.textContent.trim());
  await page.evaluate(()=>window.releaseSlowDemoRead());
  await page.waitForFunction(()=>window.slowDemoReadFinished);
  await page.waitForTimeout(400); // Controlled delayed-read regression: the old parse must never replace the latest selection.
  assert.equal(await page.locator('#new-task-name').count(),0,'旧文件的迟到解析不得覆盖用户最新选择的错误文件');
  assert.ok((await page.locator('#form-error').innerText()).trim());
  await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('mss-presales-qa-demo:v1')));
  assert.equal(stored.tasks.length,5,'错误上传不得创建新任务');
  await page.screenshot({path:path.join(artifactDir,'tasks-imported.png'),fullPage:true});
  await page.getByRole('button',{name:'恢复演示数据',exact:true}).click();
  await page.getByRole('button',{name:'确认恢复',exact:true}).click();
}
