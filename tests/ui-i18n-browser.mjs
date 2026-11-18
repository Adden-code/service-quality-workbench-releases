import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog,createDraft,publishVersion} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {workbook} from '../public/io.mjs';
import {EC_HEADERS} from '../public/ecommerce-schema.mjs';

const output=await fs.mkdtemp('D:/Codex project/outputs/service-english-20261105/ui/browser-');
const now='2026-11-05T09:00:00+08:00';let modelCalls=0,inspectionCalls=0;
const config={configured:true,keyConfigured:false,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-ui-model',authMode:'none',timeoutMs:120000};
const client={engine:'synthetic-ui',async inspect(){inspectionCalls++;return{modelId:'synthetic-ui-model',promptVersion:'synthetic-ui-v1',results:[{ruleId:'EN-RULE',verdict:'符合',reason:'已明确说明订单页面的退货入口。',evidence:[2],referenceIds:['EN-POLICY@V1.0#EN-CLAUSE']}]};},async enrichBusinessReport({kind,input}){
  modelCalls++;assert.equal(kind,'translation');await new Promise(resolve=>setTimeout(resolve,25));
  return{items:input.items.map(item=>({id:item.id,isTargetLanguage:!/[\u3400-\u9fff]/u.test(item.text),detectedLanguage:/[\u3400-\u9fff]/u.test(item.text)?'zh':'en',translation:/[\u3400-\u9fff]/u.test(item.text)?'Synthetic English translation of the frozen business content.':item.text}))};
}};
const server=await createWorkbenchServer({dataDir:path.join(output,'workspace'),modelConfig:{publicConfig:()=>config,getPrivate:()=>config},arkClient:client});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let doc=await(await fetch(origin+'/api/workspace')).json();const headers={'Content-Type':'application/json',Origin:origin,'X-Workspace-Token':doc.token};
const source=await(await fetch(origin+'/api/sources',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':'synthetic-only.json'},body:'synthetic source placeholder, no real data'})).json();
const common={owner:'Synthetic owner',scope:'仅用于合成界面验证',effectiveAt:'2026-11-01',expiresAt:'',changeNote:'合成验证版本'};
let catalog=createDraft(createBusinessCatalog(),'policies','EN-POLICY',{...common,title:'合成退货政策',category:'测试政策',sections:[{id:'EN-CLAUSE',title:'退货渠道',text:'客服应解释订单页面的退货入口。'}]},now);
catalog=publishVersion(catalog,'policies','EN-POLICY','V1.0',{},now);
catalog=createDraft(catalog,'rules','EN-RULE',{...common,title:'说明退货渠道',category:'合成检查',policyIds:['EN-POLICY'],passCriteria:'明确说明退货入口。',failCriteria:'没有说明退货入口。',exceptionCriteria:'缺少相关原文时无法判定。'},now);
catalog=publishVersion(catalog,'rules','EN-RULE','V1.0',{},now);
const originalSession={id:'MEA-SYN-001',scene:'新品产品咨询',startedAt:now,topic:'Synthetic return request',channel:'Synthetic channel',product:'Synthetic device',agent:'Agent A',customer:'Customer A',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'Customer A',at:now,text:'产品有问题，我希望退货。'},{id:2,role:'客服',speaker:'Agent A',at:now,text:'Please use the return option on the order page.'}]};
const state=createImportedTask(createBusinessState(),{name:'MEA synthetic pilot',reviewer:'Synthetic reviewer',source,fileName:'synthetic-only.json',sessions:[originalSession],basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-05',ruleIds:['EN-RULE']}),now});
const task=state.tasks[0],session=state.sessions[0];
const save=await fetch(origin+'/api/workspace',{method:'PUT',headers,body:JSON.stringify({state,catalog,baseRevision:0,mutationId:'synthetic-ui-seed'})});assert.equal(save.status,200,await save.clone().text());
const originalSaved=(await save.json()).state;
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const context=await browser.newContext({locale:'en-KE',viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
const errors=[],untranslated=[];page.on('pageerror',error=>errors.push(error.message));
const act=name=>page.locator(`[data-act="${name}"]`);
async function screenshot(name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}
async function inspect(name){
  const found=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&!el.closest('.business-content,.business-original,.original-source,pre,textarea,script,style')).map(el=>({tag:el.tagName,text:([...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('')).trim(),aria:el.getAttribute('aria-label')})).filter(row=>(/[\u3400-\u9fff]/u.test(row.text)||/[\u3400-\u9fff]/u.test(row.aria||''))&&!row.text.includes('Original')&&row.text!=='中文'));
  untranslated.push({page:name,found});await screenshot(name);
}
try{
  await page.goto(origin);await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(modelCalls,0);
  const seedBefore=(await(await fetch(origin+'/api/workspace')).json()).state;
  await inspect('01-overview-en');
  for(const [id,title] of [['tasks','Quality inspection tasks'],['review','Human review'],['rules','Inspection rules'],['knowledge','Policies and knowledge'],['exports','Business reports']]){
    await page.locator(`.nav-link[data-page="${id}"]`).click();await page.locator('h1').first().waitFor();if(id!=='exports')assert.match(await page.locator('h1').first().innerText(),new RegExp(title));assert.equal(await page.locator('.page-error').count(),0);await inspect('02-nav-'+id);
  }
  assert.equal(modelCalls,0,'Navigation must not call the model');
  await act('model-settings').click();await page.locator('#model-base-url').waitFor();await inspect('03-model-settings');
  await page.locator('#model-base-url').fill('invalid URL');await act('model-save').click();await page.waitForFunction(()=>document.getElementById('model-error')?.textContent);assert.match(await page.locator('#model-error').innerText(),/[A-Za-z]/);await screenshot('04-model-error');await act('close-modal').first().click();
  await page.locator('.nav-link[data-page="tasks"]').click();await act('new-task').click();await inspect('05-task-scene');await page.locator('[data-act="task-scene"][data-scene="新品产品咨询"]').click();await inspect('06-task-upload');
  const imported={...structuredClone(originalSession),id:'MEA-SYN-NEW',topic:'New synthetic input'};
  await page.locator('#input-upload').setInputFiles({name:'new-synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'SERVICE_QUALITY_INPUT_V1',sessions:[imported]}))});await page.locator('#new-task-name').waitFor();
  await page.locator('#new-task-name').fill('Unsaved English input');await page.locator('#new-task-reviewer').fill('Reviewer Z');
  // Use the real header switch while a dialog is open: invoke its click through
  // the DOM because modal focus intentionally makes the background inert.
  await page.evaluate(()=>document.querySelector('[data-act="ui-locale"][data-locale="zh"]').click());
  assert.equal(await page.locator('#new-task-name').inputValue(),'Unsaved English input');
  await page.evaluate(()=>document.querySelector('[data-act="ui-locale"][data-locale="en"]').click());
  assert.equal(await page.locator('#new-task-reviewer').inputValue(),'Reviewer Z');await inspect('07-task-parse');
  await act('new-next').click();await page.locator('#basis-date').waitFor();await inspect('08-task-basis');await page.locator('[name="task-rule"][value="EN-RULE"]').check();await act('create-business-task').click();await page.locator('.task-detail-head').waitFor();await inspect('09-task-detail');
  let saved=(await(await fetch(origin+'/api/workspace')).json()).state;assert.equal(saved.tasks.find(t=>t.name==='Unsaved English input').scene,'新品产品咨询');assert.equal(saved.sessions.find(s=>s.taskId===saved.tasks[0].id).turns[0].role,'客户');
  await page.locator('.nav-link[data-page="tasks"]').click();await act('input-profiles').click();await act('input-import').click();await page.locator('#input-scene').waitFor();await inspect('10-mapping');await act('close-modal').first().click();
  await page.locator('.nav-link[data-page="rules"]').click();await act('rule-import-open').click();await inspect('11-rule-import');await act('close-modal').first().click();
  await page.locator('.nav-link[data-page="tasks"]').click();await act('new-task').click();await page.locator('[data-act="task-scene"][data-scene="电商评论回复"]').click();await inspect('11a-ecommerce-upload');
  const ecRaw=Array(22).fill('');ecRaw[8]='Synthetic product review';ecRaw[9]='Thank you for describing the product.';ecRaw[11]='Synthetic operator';ecRaw[12]='2026-11-05 08:00:00';ecRaw[13]='2026-11-05 09:00:00';ecRaw[14]='好评正向';for(let i=15;i<=20;i++)ecRaw[i]='Pass';ecRaw[21]='Original synthetic reference';
  const ecBytes=await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill('Original synthetic criteria'),ecRaw]}]);await page.locator('#ec-name').fill('MEA synthetic ecommerce');await page.locator('#ec-reviewer').fill('Synthetic reviewer');await page.locator('#ec-file').setInputFiles({name:'synthetic-sheet4.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(ecBytes)});await page.locator('.ecommerce-import .import-preview').waitFor();await inspect('11b-ecommerce-preview');await act('ec-next').click();await inspect('11c-ecommerce-basis');await page.locator('[data-dialog-disclosure="ec-settings"]').evaluate(el=>el.open=true);await inspect('11d-ecommerce-settings');await act('close-modal').first().click();
  await page.locator('.nav-link[data-page="rules"]').click();await act('ruleset-list').click();await act('ruleset-new').click();await inspect('11e-ruleset-editor');await act('close-modal').first().click();
  await page.locator('[data-act="catalog-open"][data-id="EN-RULE"]').click();await inspect('12-rule-detail');await act('close-modal').first().click();
  await page.locator('.nav-link[data-page="knowledge"]').click();await page.locator('[data-act="catalog-open"][data-id="EN-POLICY"]').click();await inspect('13-policy-detail');await act('close-modal').first().click();
  await page.locator('.nav-link[data-page="tasks"]').click();await act('scenario-manage').click();await act('scenario-new').click();await page.locator('#scenario-id').fill('SCENE-MEA-SYN');await page.locator('#scenario-name').fill('MEA synthetic scenario');
  for(let step=1;step<=6;step++){await inspect('14-scenario-step-'+step);if(step<6)await act('scenario-next').click();}
  await act('scenario-cancel').click();await act('close-modal').first().click();
  await page.locator(`.task-title[data-id="${task.id}"]`).click();await act('run-ai').click();await server.waitForAiIdle();await page.waitForFunction(()=>document.querySelector('.task-detail-metrics strong')?.textContent==='1');assert.equal(inspectionCalls,1);await act('workflow-open').click();await page.locator('.workflow-node').first().waitFor();await inspect('14a-workflow');await act('workflow-close').first().click();await act('task-review').first().click();await page.locator('.review-shell').waitFor();await inspect('15-review-original');assert.equal(modelCalls,0);
  assert.equal(await page.locator('[data-act="review-status"][data-value="全部"]').count(),1);assert.equal(await page.locator('[data-act="result-filter"][data-value="问题项"]').count(),1);
  await act('content-translation-start').click();await server.waitForTranslationsIdle();await page.waitForFunction(()=>document.querySelector('.translation-progress')?.textContent.includes('Translation complete'));assert.ok(modelCalls>0);await inspect('16-review-translated');
  const callsAfterTranslation=modelCalls;await page.evaluate(()=>document.querySelector('[data-act="ui-locale"][data-locale="zh"]').click());await page.evaluate(()=>document.querySelector('[data-act="ui-locale"][data-locale="en"]').click());assert.equal(modelCalls,callsAfterTranslation);
  await act('edit-result').first().click();assert.equal(await page.locator('#edit-verdict').inputValue(),'符合');assert.match(await page.locator('#edit-verdict').innerText(),/Pass/);assert.equal(await page.locator('#edit-reason').inputValue(),'已明确说明订单页面的退货入口。');
  await page.locator('#edit-reason').fill('The agent clearly explained the return option.');await act('save-result').click();await act('confirm-review').click();await inspect('17-confirm-review');await act('do-confirm-review').click();await page.locator('.review-completion').waitFor();await inspect('18-review-complete');
  saved=(await(await fetch(origin+'/api/workspace')).json()).state;const reviewed=saved.sessions.find(s=>s.id===session.id);assert.equal(reviewed.review.status,'已确认');assert.equal(reviewed.review.drafts['EN-RULE'].verdict,'符合');assert.equal(reviewed.aiResults[0].reason,'已明确说明订单页面的退货入口。');assert.equal(reviewed.turns[0].text,originalSaved.sessions[0].turns[0].text);
  await page.reload();await page.locator('.nav-link').first().waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(modelCalls,callsAfterTranslation);
  await page.setViewportSize({width:390,height:844});await page.locator('.nav-link[data-page="tasks"]').click();await inspect('19-narrow-tasks');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow page overflow');await act('new-task').click();await inspect('20-narrow-task-scene');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Narrow dialog overflow');
  await fs.writeFile(path.join(output,'untranslated-ui.json'),JSON.stringify(untranslated,null,2));await fs.writeFile(path.join(output,'result.json'),JSON.stringify({output,origin,modelCalls,pageErrors:errors,canonicalValuesPreserved:true,localePersistence:true,syntheticOnly:true},null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify({output,modelCalls,pageErrors:errors,untranslated:untranslated.flatMap(row=>row.found.map(item=>({page:row.page,...item})))},null,2));
}catch(error){await screenshot('failure');await fs.writeFile(path.join(output,'untranslated-ui.json'),JSON.stringify(untranslated,null,2));console.error(output);throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
