import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWorkbenchServer} from '../server.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createSpringAiFetch} from '../server/spring-ai-bridge.mjs';
import {createModelConfig} from '../server/model-config.mjs';
import {createEcommerceSample} from '../public/ecommerce-sample.mjs';
import {EC_HEADERS,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {readXlsx,workbook} from '../public/io.mjs';

const live=process.argv.includes('--live');
const single=process.argv.includes('--single');
const selectedRows=single?[3]:[3,6,7,8];
const base='D:/Codex project/outputs/service-workflow-20261030';
const output=await fs.mkdtemp(path.join(base,live?'spring-live-':'browser-')),dataDir=path.join(output,'workspace');
const table=(await readXlsx(await createEcommerceSample())).Sheet4;
const bytes=await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[table[1],...selectedRows.map(row=>table[row-1])]}]);
const file=path.join(output,`${selectedRows.length}条完全虚构.xlsx`);await fs.writeFile(file,bytes);
const token=randomBytes(32).toString('hex');let worker,workerLog,server,browser,calls=0,release;
const gate=new Promise(r=>release=r);let held=true;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const modelConfig=live?await createModelConfig({dataDir:path.resolve('data')}):{publicConfig:()=>({configured:true,keyConfigured:true,model:'glm-5.3-flash'}),getPrivate:()=>({apiKey:'fictional-browser-test',model:'glm-5.3-flash'})};
async function setupWorker(){
  const logFile=await fs.open(path.join(output,'java-startup.log'),'wx');workerLog=logFile;
  worker=spawn('D:/Codex project/.tools/java-demo/jdk-21.0.12.1+1/bin/java.exe',['-jar',path.resolve('spring-ai-worker/target/spring-ai-worker-1.0.0.jar')],{cwd:path.resolve('spring-ai-worker'),env:{...process.env,WORKBENCH_BRIDGE_TOKEN:token},windowsHide:true,stdio:['ignore',logFile.fd,logFile.fd]});
  let ready=false;for(let i=0;i<100;i++){if(worker.exitCode!==null)throw Error('Spring worker failed startup');try{const r=await fetch('http://127.0.0.1:4192/internal/health',{headers:{'X-Bridge-Token':token},signal:AbortSignal.timeout(800)});if(r.ok){const h=await r.json();assert.equal(h.engine,'spring-ai');ready=true;break;}}catch{}await pause(150);}
  assert.ok(ready,'Spring worker startup timeout');
}
const upstream=live?createSpringAiFetch({bridgeToken:token}):async(_url,options)=>{
  const data=JSON.parse(JSON.parse(options.body).messages[1].content);
  const content=calls===1?'not-json':JSON.stringify({records:data.sessions.map(s=>({sessionId:s.id,results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'完全虚构的确定性浏览器测试结果。',evidence:s.turns.map(t=>t.id),referenceIds:[]}))})),checkedSessionIds:data.sessions.map(s=>s.id),duplicateGroups:[]});
  return new Response(JSON.stringify({id:`fixture-${calls}`,model:'fixture-model',choices:[{finish_reason:'stop',message:{content}}],usage:{total_tokens:30}}));
};
const transport=async(url,options)=>{calls++;assert.doesNotMatch(options.body,/工程假答案|SAMPLE-NORMAL|SAMPLE-PRIVACY/);if(held)await gate;return upstream(url,options);};transport.engine=live?'spring-ai':'native-node';
const arkClient=createArkClient({fetchImpl:transport});
const start=async()=>{server=await createWorkbenchServer({dataDir,modelConfig,arkClient});await new Promise(r=>server.listen(0,'127.0.0.1',r));return`http://127.0.0.1:${server.address().port}`;};
try{
  if(live)await setupWorker();let url=await start();
  browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  const act=name=>page.locator(`[data-act="${name}"]`),doc=async()=>{const r=await context.request.get(url+'/api/workspace');return r.json();};
  await page.goto(url+'/#tasks');await act('ec-open').click();await page.locator('#ec-file').setInputFiles(file);await page.locator('.ecommerce-import .import-preview').waitFor();
  await page.locator('#ec-name').fill(live?'Spring AI虚构链路验证':'节点失败与重试虚构验证');await page.locator('#ec-reviewer').fill('虚构审核员');await act('ec-create').click();await page.locator('.review-shell').waitFor();
  let state=await doc(),task=state.state.tasks[0];const original=structuredClone(state.state.sessions.filter(s=>s.taskId===task.id).map(s=>s.ecommerce));
  await page.locator('.nav-link').filter({hasText:'质检任务'}).click();
  await page.locator(`[data-act="run-ai"][data-id="${task.id}"]`).click();
  await page.locator(`[data-act="workflow-open"][data-id="${task.id}"]`).click();
  await page.waitForFunction(()=>document.querySelector('[data-act="workflow-node"][data-id="model"]')?.textContent.includes('执行中'));
  await page.locator('[data-act="workflow-node"][data-id="model"]').click();
  await page.screenshot({path:path.join(output,'01-running.png'),fullPage:true});held=false;release();
  const deadline=Date.now()+150000;do{await pause(300);state=await doc();task=state.state.tasks.find(t=>t.id===task.id);}while(task.aiStatus==='running'&&Date.now()<deadline);
  assert.equal(task.aiStatus,live?'completed':'failed');
  await page.waitForFunction(expected=>document.querySelector('.workflow-run-summary')?.textContent.includes(expected),live?'已完成':'运行失败');
  await page.locator(`[data-act="workflow-node"][data-id="${live?'merge':'validation'}"]`).click();
  if(!live)assert.match(await page.locator('.workflow-detail').innerText(),/not-json/);
  await page.screenshot({path:path.join(output,'02-result.png'),fullPage:true});
  const pending=page.waitForEvent('download');await act('workflow-export').click();const item=await pending;const exported=path.join(output,'运行记录.json');await item.saveAs(exported);const firstRun=JSON.parse(await fs.readFile(exported,'utf8'));
  assert.equal(firstRun.nodes.length,7);assert.equal(firstRun.engine,live?'spring-ai':'native-node');assert.equal(firstRun.nodes.find(n=>n.id==='validation').status,live?'completed':'failed');
  if(live)assert.ok(firstRun.nodes.every(n=>n.status==='completed'));
  await page.locator('[data-act="workflow-close"]').first().click();
  if(!live){
    await page.locator(`[data-act="run-ai"][data-id="${task.id}"]`).click();
    await server.waitForAiIdle();state=await doc();assert.equal(state.state.tasks.find(t=>t.id===task.id).aiStatus,'completed');
    await page.locator(`[data-act="workflow-open"][data-id="${task.id}"]`).click();await page.waitForFunction(()=>document.querySelectorAll('#workflow-run option').length===2);
    await page.locator('#workflow-run').selectOption(firstRun.id);await page.waitForFunction(()=>document.querySelector('.workflow-run-summary')?.textContent.includes('运行失败'));
    await page.screenshot({path:path.join(output,'03-history.png'),fullPage:true});await page.locator('[data-act="workflow-close"]').first().click();
  }
  state=await doc();assert.deepEqual(state.state.sessions.filter(s=>s.taskId===task.id).map(s=>s.ecommerce),original);
  const runs=await server.traces.list(task.id),before=await fs.readFile(path.join(dataDir,'workflow-runs',firstRun.id+'.json'));
  await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server=null;url=await start();
  const restored=await server.traces.read(firstRun.id),after=await fs.readFile(path.join(dataDir,'workflow-runs',firstRun.id+'.json'));
  assert.equal(digest(before),digest(after));assert.equal(restored.status,firstRun.status);assert.equal(errors.length,0,errors.join('\n'));
  const privateKey=modelConfig.getPrivate().apiKey;assert.ok(!JSON.stringify(restored).includes(privateKey));
  const liveFinal=await server.traces.read(runs[0].id),model=liveFinal.nodes.find(n=>n.id==='model').output;
  const result={mode:live?'real-spring-ai-glm':'deterministic-mock',output,engine:firstRun.engine,records:selectedRows.length,calls,runCount:runs.length,allNodes:live?firstRun.nodes.map(n=>({id:n.id,status:n.status,durationMs:n.durationMs})):null,firstFailure:live?null:'validation',model:live?model?.modelId:'fixture-model',usage:live?model?.usage:{},runtimeObserved:true,historyRetained:true,restartTraceUnchanged:true,originalReferenceUnchanged:true,credentialAbsent:true,pageErrors:errors};
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
  held=false;release();await browser?.close();if(server)await new Promise(r=>server.close(()=>r()));
  if(worker&&worker.exitCode===null){worker.kill();await new Promise(r=>worker.once('exit',r));}await workerLog?.close();
}
