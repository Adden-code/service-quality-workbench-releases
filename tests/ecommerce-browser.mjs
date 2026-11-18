import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkbenchServer} from '../server.mjs';
import {createModelConfig} from '../server/model-config.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createEcommerceSample} from '../public/ecommerce-sample.mjs';
import {EC_RULE_IDS,EC_HEADERS} from '../public/ecommerce-schema.mjs';
import {readXlsx,workbook} from '../public/io.mjs';

const live=process.argv.includes('--live'),base='D:/Codex project/outputs/service-ecommerce-implementation-20261030';
const output=await fs.mkdtemp(path.join(base,live?'live-':'browser-')),dataDir=path.join(output,'workspace');
let bytes=await createEcommerceSample();
if(live){
  const table=(await readXlsx(bytes)).Sheet4,selected=[3,5,6,7,8,14,16,17,18].map(row=>[...table[row-1]]);
  const similar=['谢谢您认可虚构云杉耳机的音质，祝您使用愉快。','感谢您对虚构云杉耳机音质的认可，祝您使用愉快！','感谢您认可虚构云杉耳机的音质，祝您使用愉快。'];
  for(let i=0;i<3;i++)selected[2+i][9]=similar[i];
  bytes=await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[table[1],...selected]}]);
}
const input=path.join(output,live?'九条真实模型调用用例_完全虚构.xlsx':'十八条功能用例_完全虚构.xlsx');await fs.writeFile(input,bytes);
const scopes=[],payloadChecks=[];
const mock={inspectEcommerce:async({sessions})=>{
  scopes.push(sessions.map(s=>s.id));
  return{records:sessions.map(s=>{const reply=s.turns.find(t=>t.role==='客服')?.text||'',comment=s.turns.find(t=>t.role==='客户')?.text||'';
    return{sessionId:s.id,results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>{
      const bad=ruleId==='EC-TEXT'?reply.includes('We is'):ruleId==='EC-TARGET'?reply.includes('番茄炒蛋'):ruleId==='EC-STEPS'?reply.includes('请先打开手机蓝牙。'):ruleId==='EC-PRIVACY'?reply.includes('@example.com'):false;
      return{ruleId,verdict:!reply||(!comment&&ruleId==='EC-TARGET')?'无法判定':bad?'不符合':'符合',reason:'确定性虚构浏览器检查；语义结论来自测试替身，不代表真实模型效果。',evidence:s.turns.map(t=>t.id),referenceIds:[]};
    })};}),duplicateGroups:[],modelId:'deterministic-browser-fixture',usage:{total_tokens:100},promptVersion:'ec-batch-fixture-v1'};
}};
const modelConfig=live?await createModelConfig({dataDir:path.resolve('data')}):{publicConfig:()=>({configured:true,keyConfigured:true,model:'glm-5.3-flash'}),getPrivate:()=>({apiKey:'fictional-browser-test',model:'glm-5.3-flash'})};
const arkClient=live?createArkClient({fetchImpl:async(url,options)=>{
  // Never log body/headers. Only record the bounded checks and actual request count.
  const body=options.body;for(const forbidden of ['工程假答案','SAMPLE-NORMAL','SAMPLE-PRIVACY'])assert.ok(!body.includes(forbidden),'原人工标签或参考说明进入模型请求');
  const data=JSON.parse(JSON.parse(body).messages[1].content);assert.equal(data.sessions.length,9);payloadChecks.push({referenceLabelsAbsent:true,records:9});
  return fetch(url,options);
}}):mock;
let server=await createWorkbenchServer({dataDir,modelConfig,arkClient});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage();
page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const act=name=>page.locator(`[data-act="${name}"]`),nav=async name=>page.locator('.nav-link').filter({hasText:name}).click();
const doc=async()=>{const r=await context.request.get(url+'/api/workspace');return r.json();};
const download=async(action,file)=>{const pending=page.waitForEvent('download');await act(action).click();const item=await pending;await item.saveAs(path.join(output,file));return path.join(output,file);};
let result;
try{
  await page.goto(url+'/#tasks');await act('ec-open').waitFor();await act('ec-open').click();
  await page.locator('#ec-file').setInputFiles(input);await page.locator('.ecommerce-import .import-preview').waitFor();
  assert.match(await page.locator('.ecommerce-import').innerText(),/Sheet4/);await page.screenshot({path:path.join(output,'01-import.png'),fullPage:true});
  if(!live){
    const invalid=path.join(output,'invalid.txt');await fs.writeFile(invalid,'invalid fictional file');await page.locator('#ec-file').setInputFiles(invalid);await page.waitForFunction(()=>!document.querySelector('.ecommerce-import .import-preview'));assert.ok(await act('ec-create').isDisabled());
    await page.locator('#ec-file').setInputFiles(input);await page.locator('.ecommerce-import .import-preview').waitFor();
  }
  await page.locator('#ec-name').fill(live?'GLM九条虚构验证':'十八条确定性功能验证');await page.locator('#ec-reviewer').fill('虚构验证审核员');
  if(!live){
    let dropped=false;
    await page.route('**/api/workspace',async route=>{if(route.request().method()==='PUT'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
    await act('ec-create').click();await page.locator('#overlay-root [data-act="workspace-retry"]').waitFor();
    await page.locator('#overlay-root [data-act="close-modal"]').first().click();assert.equal(await page.locator('.ecommerce-import').count(),1,'未确认ACK时必须保留恢复所需输入');
    await page.unroute('**/api/workspace');await page.locator('#overlay-root [data-act="workspace-retry"]').click();
  }else await act('ec-create').click();
  await page.locator('.review-shell').waitFor();
  let current=await doc(),task=current.state.tasks[0],sessions=current.state.sessions.filter(s=>s.taskId===task.id);assert.equal(sessions.length,live?9:18);assert.equal(task.aiStatus,'not_run');assert.equal(scopes.length,0);assert.equal(payloadChecks.length,0);
  assert.ok(sessions.every(s=>s.review.status==='待审核'&&s.aiResults.length===0));
  await nav('质检任务');await page.locator(`[data-act="run-ai"][data-id="${task.id}"]`).click();
  // Model confirmation dialog, if present, explicitly authorize this fictional task.
  const confirm=page.locator('[data-act="model-run-confirm"], [data-act="do-ai-run"], [data-act="ai-confirm-run"]');if(await confirm.count())await confirm.first().click();
  const deadline=Date.now()+(live?160000:20000);
  do{await new Promise(r=>setTimeout(r,live?1500:200));current=await doc();task=current.state.tasks.find(t=>t.id===task.id);}while(task.aiStatus==='running'&&Date.now()<deadline);
  assert.equal(task.aiStatus,'completed',JSON.stringify({status:task.aiStatus,runtime:current.aiRuntime,errors:current.state.sessions.filter(s=>s.taskId===task.id).map(s=>s.aiExecution?.error)}));
  sessions=current.state.sessions.filter(s=>s.taskId===task.id);assert.ok(sessions.every(s=>s.aiResults.length===5&&s.review.status==='待审核'));
  await page.locator(`[data-act="task-review"][data-id="${task.id}"]`).click();await page.locator('.review-shell').waitFor();
  await page.locator('.ecommerce-reference summary').click();assert.match(await page.locator('.ecommerce-reference').innerText(),/原人工参考/);assert.match(await page.locator('.ecommerce-reference [data-column="final"]').first().innerText(),/未确认/);
  await page.screenshot({path:path.join(output,'02-reference.png'),fullPage:true});
  const duplicate=sessions.find(s=>s.aiResults.some(r=>r.batchEvidence?.length));
  if(duplicate){
    await page.locator(`[data-act="select-session"][data-id="${duplicate.id}"]`).click();
    const toggle=page.locator('[data-act="toggle-rule"][data-id="EC-TARGET"]');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
    await page.locator('.ecommerce-batch-evidence summary').first().click();assert.match(await page.locator('.ecommerce-batch-evidence').first().innerText(),/3条实际记录/);
    await page.screenshot({path:path.join(output,'02b-batch-evidence.png'),fullPage:true});
    await page.locator(`[data-act="select-session"][data-id="${sessions[0].id}"]`).click();
  }
  // Confirm only the first normal synthetic record; incomplete records remain open.
  await act('accept-ai').click();await act('confirm-review').click();await act('do-confirm-review').click();await page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');
  current=await doc();assert.equal(current.state.sessions.find(s=>s.id===sessions[0].id).review.status,'已确认');
  await nav('结果导出');await page.locator('#export-task').selectOption(task.id);await page.locator('input[name="export-status"][value="all"]').check();
  const xlsx=await download('export-xlsx','质检明细.xlsx'),html=await download('export-html','质检明细.html');
  const tables=await readXlsx(new Uint8Array(await fs.readFile(xlsx))),header=tables['结果明细'][0];assert.ok(header.includes('原人工参考结论'));assert.ok(header.includes('AI跨记录证据'));
  const detail=await fs.readFile(html,'utf8');assert.ok(detail.includes('原人工参考结论'));assert.ok(detail.includes('工程假答案'));
  await page.locator('#report-period').selectOption('batch');await page.locator('#report-task').selectOption(task.id);await download('export-management','管理分析.html');
  const management=await fs.readFile(path.join(output,'管理分析.html'),'utf8');assert.ok(!management.includes('工程假答案'));
  await page.screenshot({path:path.join(output,'03-exports.png'),fullPage:true});
  const snapshot=await fs.readFile(path.join(dataDir,'workspace.json')),beforeHash=createHash('sha256').update(snapshot).digest('hex');
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  server=await createWorkbenchServer({dataDir,modelConfig,arkClient});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
  const afterHash=createHash('sha256').update(await fs.readFile(path.join(dataDir,'workspace.json'))).digest('hex');assert.equal(beforeHash,afterHash);
  assert.equal(errors.length,0,errors.join('\n'));
  result={mode:live?'live':'deterministic-mock',output,records:sessions.length,models:[...new Set(sessions.map(s=>s.aiExecution.modelId))],providerRequests:live?payloadChecks.length:scopes.length,payloadChecks,
    usage:sessions.reduce((a,s)=>a+(s.aiExecution.usage?.total_tokens||0),0),sourceSha256:task.source.sha256,restartBytesUnchanged:true,confirmed:1,
    results:sessions.map(s=>({sourceRow:s.ecommerce.row,verdicts:s.aiResults.map(r=>({ruleId:r.ruleId,verdict:r.verdict,reason:r.reason,peers:r.batchEvidence?.map(g=>({kind:g.kind,count:g.sessionIds.length}))||[]}))})),pageErrors:errors};
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({mode:result.mode,output,records:result.records,models:result.models,requests:result.providerRequests,usage:result.usage,restartBytesUnchanged:true}));
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(output,'failure.txt'),String(error.stack));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(()=>resolve()));}
