import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessCatalog,createDraft} from '../public/catalog.mjs';
import {buildKnowledgeXlsx} from '../public/catalog-io.mjs';
import {buildRuleTemplateXlsx} from '../public/rule-template-io.mjs';

const reportRoot=path.resolve('../implementation-scenes');
await fs.mkdir(reportRoot,{recursive:true});
const output=await fs.mkdtemp(path.join(reportRoot,'browser-'));
const now='2026-11-10T10:00:00+08:00';
const common={scope:'合成本地功能验证',owner:'合成维护人',changeNote:'合成验证资料',effectiveAt:'2026-10-01',expiresAt:'',sceneIds:['新品产品咨询']};
let catalog=createDraft(createBusinessCatalog(),'policies','NP-WALK-DOC',{...common,title:'合成产品说明',category:'产品',sections:[{id:'NP-WALK-1',title:'操作步骤',text:'客服应根据说明回答操作步骤。'}]},now);
catalog=createDraft(catalog,'rules','NP-WALK-RULE',{...common,title:'合成操作指导',category:'服务',policyIds:['NP-WALK-DOC'],passCriteria:'说明步骤与资料一致。',failCriteria:'答复与资料冲突。',exceptionCriteria:'资料缺失则无法判定。'},now);
const policyFile=path.join(output,'synthetic-policies.xlsx'),ruleFile=path.join(output,'synthetic-rules.xlsx'),inputFile=path.join(output,'synthetic-input.json');
await fs.writeFile(policyFile,await buildKnowledgeXlsx(catalog.policies));
await fs.writeFile(ruleFile,await buildRuleTemplateXlsx(catalog.rules));
const raw={format:'SERVICE_QUALITY_INPUT_V1',sessions:[{id:'SYNTHETIC-WALK',scene:'新品产品咨询',startedAt:now,topic:'操作咨询（合成）',product:'合成产品',agent:'合成客服',customer:'合成客户',channel:'合成渠道',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'合成客户',at:'',text:'请问如何操作？'},{id:2,role:'客服',speaker:'合成客服',at:'',text:'我会核对说明后向您解释。'}]}]};
await fs.writeFile(inputFile,JSON.stringify(raw));
const server=await createWorkbenchServer({dataDir:path.join(output,'workspace'),catalogSeed:null});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_BROWSER_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:'reduce',locale:'zh-CN'}),page=await context.newPage();
page.setDefaultTimeout(12000);
const errors=[],unexpected=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{
  const request=route.request();
  if(!request.url().startsWith(url+'/')||/\/api\/(?:ai\/|model\/test|rules\/prepare)/.test(request.url())){unexpected.push(request.url());return route.abort();}
  return route.continue();
});
const act=name=>page.locator(`[data-act="${name}"]`).first();
const nav=pageId=>page.locator(`.nav-link[data-page="${pageId}"]`).click();
const close=()=>page.locator('.modal .icon-btn[data-act="close-modal"]').click();
const saved=()=>page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');
async function publish(){await act('catalog-publish').click();await act('catalog-do-publish').click();await saved();await page.locator('[data-act="catalog-retire"]').waitFor();await close();}
let outcome;
try{
  await page.goto(url);await page.locator('[data-page="overview"].layout').waitFor();
  await nav('tasks');await act('new-task').click();await page.locator('[data-act="task-scene"][data-scene="新品产品咨询"]').click();
  await page.locator('#input-upload').setInputFiles(inputFile);await page.locator('#new-task-name').fill('保留草稿合成批次');await page.locator('#new-task-reviewer').fill('合成审核员');await act('new-next').click();
  assert.match(await page.locator('.modal').innerText(),/规则目录为空/);assert.equal(await act('create-business-task').isDisabled(),true);
  await page.screenshot({path:path.join(output,'no-rules-zh.png'),fullPage:true});
  await act('new-manage-rules').click();
  await page.locator('[data-act="ui-locale"][data-locale="en"]').click();
  await act('new-resume-draft').click();
  assert.match(await page.locator('.modal').innerText(),/No rules in the catalog/);await page.screenshot({path:path.join(output,'no-rules-en.png'),fullPage:true});
  await act('new-manage-rules').click();assert.equal(await page.locator('#catalog-scene').inputValue(),'新品产品咨询');
  const downloadPromise=page.waitForEvent('download');await act('catalog-rule-template').click();const download=await downloadPromise;await download.saveAs(path.join(output,'downloaded-blank-rule-template.xlsx'));
  await nav('knowledge');await act('catalog-import').click();await page.locator('#catalog-upload').setInputFiles(policyFile);await act('catalog-confirm-import').waitFor();await act('catalog-confirm-import').click();await saved();
  await act('catalog-open').click();await publish();
  await nav('rules');await act('catalog-rule-import').click();await page.locator('#catalog-upload').setInputFiles(ruleFile);await act('catalog-confirm-rule-import').waitFor();await act('catalog-confirm-rule-import').click();await saved();
  await act('catalog-open').click();await publish();await page.screenshot({path:path.join(output,'published-scene-rules-en.png'),fullPage:true});
  await act('new-resume-draft').click();
  assert.match(await page.locator('.modal').innerText(),/保留草稿合成批次/);assert.match(await page.locator('.modal').innerText(),/合成审核员/);
  await page.locator('#basis-date').fill('2026-11-10');await page.locator('#basis-date').dispatchEvent('change');
  await page.locator('[name="task-rule"][value="NP-WALK-RULE"]').check();assert.equal(await act('create-business-task').isEnabled(),true);
  await act('create-business-task').click();await saved();await page.locator('.task-detail-grid').waitFor();
  const doc=await(await context.request.get(url+'/api/workspace')).json();
  assert.equal(doc.state.tasks.length,1);assert.equal(doc.state.tasks[0].name,'保留草稿合成批次');assert.deepEqual(doc.state.tasks[0].basisSnapshot.rules.map(rule=>rule.id),['NP-WALK-RULE']);assert.equal(doc.state.tasks[0].source.name,'synthetic-input.json');assert.equal(doc.state.sessions[0].externalId,'SYNTHETIC-WALK');
  await act('run-ai').click();await page.locator('#model-id').waitFor();assert.equal(unexpected.length,0);assert.equal(errors.length,0,errors.join('\n'));
  outcome={status:'passed',output,checks:['Chinese and English no-rule explanation','uploaded JSON and form preserved through catalog navigation','real blank rule template download','local policy and manual rule template import and publication','scene filter and positive rule selection','task source and exact rule snapshot persisted','unconfigured AI opens settings without a model call'],pageErrors:errors,externalOrModelRequests:unexpected};
  console.log(JSON.stringify(outcome,null,2));
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});outcome={status:'failed',output,message:error.message,stack:error.stack,pageErrors:errors,externalOrModelRequests:unexpected};throw error;}
finally{
  await fs.writeFile(path.join(reportRoot,'browser-result.json'),JSON.stringify(outcome,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));
}

