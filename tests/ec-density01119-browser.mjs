import {chromium} from 'playwright';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.VERIFY_APP_ROOT||'.'),load=r=>import(pathToFileURL(path.join(root,r))),out=path.resolve(process.env.VERIFY_DENSITY_OUTPUT||'../outputs/service01119-20261120/ec-density-browser');await fs.mkdir(out,{recursive:true});
const {createWorkbenchServer}=await load('server.mjs'),{workbook,readXlsx}=await load('public/io.mjs'),{SYSTEM_EC_HEADERS}=await load('public/ecommerce-system-source.mjs'),{parseSceneCapability}=await load('server/scene-capabilities.mjs'),{createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx}=await load('public/business-delivery.mjs'),{buildBusinessReportHtml}=await load('public/business-report.mjs');
const materials='D:/Codex project/service-quality-internal-materials/20261119/',catalogSeed=JSON.parse(await fs.readFile(materials+'catalog-seed.01112.json','utf8')),sceneSeed=JSON.parse(await fs.readFile(materials+'scene-seed.01112.v1.json','utf8'));
const rows=Array.from({length:3},(_,i)=>{const r=Array(23).fill('');Object.assign(r,{0:'000'+i,4:i?'UNRECOGNIZED':'VMALL-MX-HWB2C',5:'Synthetic product review '+i,6:'Synthetic response '+i,7:'5',8:'Synthetic operator '+i,9:'2026-11-18 10:00:00',13:'PRIVATE-SENTIMENT-ONLY',14:'Preserved followup '+i,16:'2026-11-18 12:00:00'});return r;});const bytes=await workbook([{name:'Export',headers:[...SYSTEM_EC_HEADERS,'Custom'],rows:rows.map(r=>[...r,'001'])}]),input=path.join(out,'synthetic.xlsx');await fs.writeFile(input,bytes);
let calls=0;const client={inspectSceneCapability:async({input})=>{calls++;const b=input.blocks[0];if(b.text.endsWith('1'))throw Object.assign(Error('Synthetic capability failure'),{code:'INVALID_OUTPUT'});return parseSceneCapability(JSON.stringify({status:'completed',value:{polarity:'positive',vocKind:'none'},confidence:.95,reason:'Synthetic classifier',evidence:[{blockId:b.id,quote:b.text,start:0,end:b.text.length}]}),input);},inspectEcommerceRow:async({session,ruleIds})=>{calls++;if(!session.turns[0].text.endsWith('2'))throw Object.assign(Error('Synthetic rule failure'),{code:'INVALID_OUTPUT'});return{modelId:'synthetic-density',promptVersion:'synthetic-v1',results:(ruleIds||['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY']).map(ruleId=>({ruleId,verdict:ruleId==='EC-TEXT'?'不符合':'符合',reason:'Synthetic source checked',evidence:[2],referenceIds:[],confidence:.95,conflictsWith:[]}))};}};
const modelConfig={publicConfig:()=>({configured:true,connectionTested:true,model:'synthetic',executionEngine:'native-node'}),getPrivate:()=>({configured:true,connectionTested:true,authMode:'none',model:'synthetic',baseUrl:'http://127.0.0.1:1'})};const server=await createWorkbenchServer({dataDir:await fs.mkdtemp(path.join(out,'workspace-')),catalogSeed,sceneSeed,modelConfig,arkClient:client});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'}),page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let token;
const api=async(route,body)=>{const res=await fetch(origin+route,{method:body?'POST':'GET',headers:{Origin:origin,...(token?{'X-Workspace-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();assert.ok(res.ok,JSON.stringify(value));token=value.token||token;return value;};
try{
 await page.goto(origin+'/#tasks');await page.locator('[data-act="new-task"]').first().click();await page.locator('[data-act="task-scene"][data-scene="电商评论回复"]').click();await page.locator('#ec-file').setInputFiles(input);await page.locator('#import-preview-confirm').waitFor();assert.equal(calls,0);assert.equal(await page.locator('[data-act="import-ai-convert"]').count(),0);await page.locator('#ec-batch-site').fill('Synthetic fallback site');await page.locator('#ec-batch-site').blur();await page.locator('#import-preview-confirm').waitFor();await page.locator('#ec-name').fill('Synthetic 23-column batch');await page.locator('#ec-reviewer').fill('Synthetic reviewer');await page.locator('#import-preview-confirm').check();await page.locator('[data-act="ec-next"]').click();await page.locator('[data-act="ec-create"]').click();await page.locator('.modal').waitFor({state:'detached'});
 let doc=await api('/api/workspace'),task=doc.state.tasks[0];assert.equal(task.scene,'电商评论回复');assert.equal(doc.state.sessions.length,3);assert.deepEqual(doc.state.sessions.map(s=>s.ecommerce.raw[3]),['墨西哥','Synthetic fallback site','Synthetic fallback site']);assert.ok(doc.state.sessions.every(s=>s.ecommerce.schemaVersion===6));
 await api('/api/tasks/'+task.id+'/ai',{runId:crypto.randomUUID()});for(let i=0;i<300;i++){doc=await api('/api/workspace');task=doc.state.tasks[0];if(['completed','failed','paused','partial'].includes(task.aiStatus))break;await new Promise(r=>setTimeout(r,100));}assert.ok(['failed','partial'].includes(task.aiStatus));assert.equal(doc.state.sessions.filter(s=>s.aiExecution.status==='failed').length,2);assert.equal(doc.state.sessions[2].aiExecution.status,'completed');const ids=doc.state.sessions.map(s=>s.id);
 await page.reload();await page.locator('.nav-link[data-page="review"]').click();
 await page.locator('[data-act="ec-inline-confirm"]').waitFor({state:'visible'});

 const measurements=[];
 const originalAI=new Map(doc.state.sessions.map(s=>[s.id,structuredClone(s.aiResults)]));
 for(const viewport of [{width:1366,height:768},{width:1440,height:900}]){
  await page.setViewportSize(viewport);
  const size=await page.evaluate(()=>{const pane=document.querySelector('.results-pane'),list=pane.querySelector('.result-list'),footer=pane.querySelector('.results-footer'),top=document.querySelector('.review-topbar');const box=el=>el.getBoundingClientRect();return {viewport:innerHeight,appHeader:box(top).height,panelHeader:box(list).top-box(pane).top,footer:box(footer).height,buttonBox:box(footer.querySelector('button:last-child')).toJSON(),footerBox:box(footer).toJSON(),content:box(list).height,completeCards:[...document.querySelectorAll('.ec-inline-row')].filter(el=>box(el).top>=box(list).top&&box(el).bottom<=box(list).bottom).length};});
  size.fixedHeight=size.appHeader+size.panelHeader+size.footer;size.fixedRatio=size.fixedHeight/viewport.height;measurements.push({...viewport,...size});
  await page.screenshot({path:path.join(out,`density-${viewport.width}x${viewport.height}.png`)});
 }
 await fs.writeFile(path.join(out,'measurements.json'),JSON.stringify(measurements,null,2));
 for(const size of measurements){assert.ok(size.fixedRatio<=.15,JSON.stringify(size));assert.ok(size.completeCards>=2,JSON.stringify(size));}
 // The compact summary is a real keyboard-accessible disclosure; retry/history stay outside it.
 await page.locator('[data-act="select-session"][data-id="'+ids[2]+'"]').click();
 assert.match(await page.locator('.ec-review-context>summary').innerText(),/待人工确认/);
 assert.equal(await page.locator('.results-pane .result-summary').count(),0);
 assert.equal(await page.locator('.ec-review-context .ai-execution').isVisible(),false);
 await page.locator('.ec-review-context>summary').click();assert.match(await page.locator('.ec-review-context-body').innerText(),/synthetic-density/);
 await page.locator('.ai-audit>summary').click();assert.ok((await page.locator('.ai-audit').innerText()).includes(doc.state.sessions[2].aiExecution.promptVersion));
 await page.screenshot({path:path.join(out,'completed-ai-details.png')});
 await page.locator('[data-act="select-session"][data-id="'+ids[0]+'"]').click();
 assert.equal(await page.locator('.ec-review-context').getAttribute('open'),null);
 assert.equal(await page.locator('.results-pane .review-routing-summary').count(),0);
 assert.equal(await page.locator('.ec-review-summary [data-act="task-detail"]').isVisible(),true);
 assert.doesNotMatch(await page.locator('.results-footer').innerText(),/保存草稿不会/);
 assert.match(await page.locator('[data-act="ec-inline-confirm"]').getAttribute('title'),/评价分类复核/);
 await page.locator('.ec-review-context>summary').click();assert.equal(await page.locator('.ec-review-context .ai-execution').isVisible(),true);
 await page.locator('.ec-review-context>summary').click();
 // Drag to the expanded limit, then reload and change sessions without losing the task preference.
 const divider=page.locator('.ec-review-split [data-reading-divider]'),split=await page.locator('.ec-review-split').boundingBox(),bar=await divider.boundingBox();
 await page.mouse.move(bar.x+bar.width/2,bar.y+100);await page.mouse.down();await page.mouse.move(split.x+split.width*.95,bar.y+100,{steps:8});await page.mouse.up();
 assert.equal(await divider.getAttribute('aria-valuenow'),'85');
 assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('qa-reading:'+id)).ratio,task.id),85);
 await page.reload();assert.equal(await divider.getAttribute('aria-valuenow'),'85');
 await page.locator('[data-act="select-session"][data-id="'+ids[1]+'"]').click();assert.equal(await divider.getAttribute('aria-valuenow'),'85');
 await divider.focus();await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'25');
 for(let i=0;i<10;i++)await page.keyboard.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'55');
 const keyboardVerdicts=[];
 for(const id of ids){
  await page.locator('[data-act="select-session"][data-id="'+id+'"]').click();
  if(id===ids[0]){
   for(const [key,verdict]of [['1','符合'],['2','不符合'],['3','无法判定'],['4','不适用']]){
    await page.locator('[data-inline-rule="EC-TEXT"]').focus();await page.keyboard.press(key);
    assert.equal(await page.locator('[data-inline-rule="EC-TEXT"] [data-verdict="'+verdict+'"]').getAttribute('aria-pressed'),'true');
    if(['2','3'].includes(key))assert.equal(await page.locator('label[for="inline-reason-EC-TEXT"]').innerText(),'判定理由（必填）');keyboardVerdicts.push(verdict);
   }
   await page.locator('#inline-reason-EC-TEXT').fill('1234');assert.equal(await page.locator('[data-inline-rule="EC-TEXT"] [data-verdict="不适用"]').getAttribute('aria-pressed'),'true');
  }
  await page.locator('#ec-review-type').selectOption({label:'好评正向'});await page.locator('#ec-review-voc').selectOption('none');await page.locator('#ec-review-reason').fill('Synthetic independent manual classification');
  if(id!==ids[2])assert.match(await page.locator('.classification-failed-row').innerText(),/人工（行失败）/);
  for(const rule of ['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'])await page.locator('[data-act="ec-inline-verdict"][data-rule="'+rule+'"][data-verdict="符合"]').click();
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/review')&&r.request().method()==='POST');await page.locator('#ec-review-reason').focus();await page.keyboard.press('Control+Enter');assert.equal((await savedResponse).status(),200);await page.waitForFunction(()=>document.getElementById('toast-root').textContent.includes('五项已确认'));
  doc=await api('/api/workspace');const saved=doc.state.sessions.find(s=>s.id===id);assert.equal(saved.review.status,'已确认');if(id!==ids[2]){assert.equal(saved.review.classification.origin,'manual-row-failed');assert.ok(Object.values(saved.review.drafts).every(x=>x.source==='人工独立审核'));assert.equal(saved.aiExecution.status,'failed');}assert.deepEqual(saved.aiResults,originalAI.get(id));
 }
 // Confirmed records and their editing history remain reachable after compact review.
 await page.locator('[data-act="view-review-records"]').click();
 await page.locator('[data-act="review-status"][data-value="已确认"]').click();
 await page.locator('[data-act="select-session"][data-id="'+ids[0]+'"]').click();
 assert.equal(await page.locator('[data-act="reopen-review"]').isVisible(),true);
 await page.locator('[data-act="result-filter"][data-value="人工修改"]').click();assert.equal(await page.locator('.ec-inline-row').count(),5);
 await page.locator('.ec-review-summary [data-act="task-detail"]').click();await page.locator('.task-detail-grid').waitFor();assert.equal(await page.getByRole('button',{name:'运行过程',exact:true}).isVisible(),true);
 assert.equal(doc.state.tasks[0].progress,100);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'failed-rows-confirmed.png'),fullPage:true});
 const snapshot=createBusinessDeliverySnapshot(doc.state,{taskId:task.id,conclusionMode:'combined'});assert.ok(snapshot.records.every(r=>r.evaluationType==='好评正向'));
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',testedRoot:root,rows:3,completedAIMetadataDisclosure:true,failedWithOutputConfirmed:true,failedWithoutOutputConfirmed:true,aiFailurePreserved:true,humanOriginAudited:true,progress:100,classificationIncludedInStatistics:true,measurements,keyboardVerdicts,ctrlEnterConfirmed:true,splitDragMax:85,splitReloadPersisted:true,splitSessionPersisted:true,historyAvailable:true,pageErrors:errors,externalModelCalls:0},null,2));console.log('0.11.19 EC density and review browser passed');
}catch(error){await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
