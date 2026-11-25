// Synthetic app navigation; no real workspace, model service or source edits.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {reviewFixture,standardPolicies} from './ui-i18n01124-fixture.mjs';
import {sessionDisplayFields} from '../public/session-display-fields.mjs';
import {clientBuild} from '../public/build-identity.mjs';

const root=path.resolve('public'),out=path.resolve(process.env.VERIFY_I18N_OUTPUT||'../outputs/service01124-20261125/i18n');
const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{
 const file=path.resolve(root,'.'+decodeURI(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))throw Error('outside');
 res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(file));
}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const reports=[],errors=[],unexpected=[];
const scan=()=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&!el.closest('[data-business-original],textarea,script,style')).flatMap(el=>{
 const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
 return [['text',text],...['aria-label','title','placeholder','alt'].map(a=>[a,el.getAttribute(a)||''])].filter(([,v])=>/[\u3400-\u9fff]/u.test(v)).map(([attribute,text])=>({tag:el.tagName,attribute,text}));
});
try{
 for(const engine of ['conversation','ecommerce','raw']){
  const fixture=reviewFixture(engine);fixture.catalog.policies.push(...standardPolicies());
  const before=JSON.stringify(fixture),jobs=new Map(),calls=[];let translationFails=true;
  const page=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1050}});page.setDefaultTimeout(12000);
  // Isolate display/navigation from the independent active-review timer. A
  // background raw review legitimately accrues no persisted human work time.
  if(engine==='raw')await page.addInitScript(()=>{document.hasFocus=()=>false;});
  page.on('pageerror',e=>errors.push({engine,message:e.message}));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),method=req.method();calls.push({method,path:url.pathname});let body,status=200;
   if(url.pathname==='/api/workspace')body={initialized:true,revision:1,token:'synthetic-local-token',productVersion:version,state:fixture.state,catalog:fixture.catalog};
   else if(url.pathname==='/api/build-info')body=clientBuild;
   else if(url.pathname==='/api/model/config')body={configured:true,keyConfigured:false,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-local-only',authMode:'none',timeoutMs:120000};
   else if(url.pathname==='/api/translation-jobs'&&method==='GET')body={jobs:[]};
   else if(url.pathname==='/api/translation-jobs'&&method==='POST'){
    if(translationFails){status=503;body={error:'Original error: 合成翻译失败'};}
    else{const input=req.postDataJSON(),s=fixture.state.sessions.find(s=>s.id===input.source.sessionId),fields=sessionDisplayFields(s,fixture.state.tasks[0]),job={...input,id:input.jobId,status:'completed',resultAvailable:true,sourceFingerprint:'a'.repeat(64)};
     jobs.set(job.id,{job,sourceFingerprint:job.sourceFingerprint,sourceSnapshot:{source:input.source,fields},translations:fields.map(f=>({...f,sourceText:f.text,status:'translated',text:'One-star rating and a described product defect.'}))});body={job};}
   }else if(url.pathname.startsWith('/api/translation-jobs/')){const entry=jobs.get(url.pathname.split('/')[3]);if(!entry){status=404;body={error:'Translation job not found'};}else body=url.pathname.endsWith('/result')?entry:{job:entry.job};}
   else if(url.pathname==='/api/import-drafts')body={items:[]};
   else if(url.pathname==='/api/report-jobs')body={jobs:[]};
   else if(url.pathname==='/api/tasks/T/execution')body={offset:0,total:1,rows:[{sessionId:'S-0',sourceRow:3,status:'failed',error:'Original error: 合成后端错误，未返回结果。'}]};
   else{unexpected.push({engine,method,path:url.pathname});status=501;body={error:'Unexpected synthetic API request'};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  async function inspect(name){const findings=await page.evaluate(scan);reports.push({engine,name,findings});assert.deepEqual(findings,[],engine+' '+name);}
  try{
   await page.goto(origin+'/index.html');await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
   await page.locator('.nav-link[data-page="tasks"]').click();await page.locator('[data-act="task-review"][data-id="T"]').click();
   if(engine==='raw'){
    await page.locator('#raw-review-session').waitFor();assert.equal(await page.locator('#raw-review-session option').count(),101);
    await page.locator('#raw-review-session').selectOption('S-50');await page.locator('#raw-original').waitFor();assert.equal(await page.locator('#raw-original').textContent(),'Synthetic original transcript');
    assert.equal(await page.locator('[data-act="raw-confirm-next"]').textContent(),'Save human judgments and continue');
   }else{
    await page.locator('.queue-pagination').waitFor();assert.equal(await page.locator('.session-queue-list .session-item').count(),50);
    await page.locator('.queue-pagination').getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.queue-pagination')?.textContent.includes('51–100'));
    assert.equal(await page.locator('.queue-pagination').getByRole('button',{name:'Previous',exact:true}).count(),1);
    await page.locator('.queue-pagination').getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.queue-pagination')?.textContent.includes('101–101'));
    assert.equal(await page.locator('.session-queue-list .session-item').count(),1);
    await page.locator('.queue-pagination').getByRole('button',{name:'Previous',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.queue-pagination')?.textContent.includes('51–100'));
   }
   if(engine==='ecommerce'){
    const reason=page.locator('.classification-ai-reason');await reason.getByText('[Translation unavailable — retry required]',{exact:true}).waitFor();
    assert.doesNotMatch(await reason.innerText(),/[\u3400-\u9fff]|Original error:/u);assert.equal(await reason.locator('.ai-original-audit').getAttribute('open'),null);
    assert.equal(await reason.locator('[data-business-original]').textContent(),'评分为一星且描述产品缺陷。');
    await inspect('failed-classification-English-fallback');translationFails=false;
    await page.locator('[data-act="reason-translation-retry"]').first().click();await reason.getByText('One-star rating and a described product defect.',{exact:true}).waitFor();
    await inspect('failed-classification-English-retry');
   }else await inspect('review-navigation');
   await page.screenshot({path:path.join(out,engine+'-review-pagination.png'),fullPage:true});
   await page.locator('.nav-link[data-page="knowledge"]').click();await page.locator('.managed-catalog').waitFor();
   const titles=await page.locator('.catalog-card h3').allTextContents();for(const title of titles)assert.doesNotMatch(title,/[\u3400-\u9fff]|English missing/u);
   await inspect('policy-standard-list');
   for(const policy of standardPolicies()){
    await page.locator(`[data-act="catalog-open"][data-id="${policy.id}"]`).click();await page.locator('#dialog-title').waitFor();
    assert.doesNotMatch(await page.locator('#dialog-title').textContent(),/[\u3400-\u9fff]|English missing/u);
    await inspect('policy-detail-'+policy.id);await page.locator('[data-act="close-modal"]').first().click();
   }
   if(engine==='conversation'){
    await page.locator('[data-act="ui-locale"][data-locale="zh"]').click();
    assert.equal(await page.title(),'会话质检工作台');assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.equal(await page.locator('.brand-mark').innerText(),'质');
    await page.reload();await page.locator('.sidebar .brand-mark').waitFor();
    assert.equal(await page.title(),'会话质检工作台');assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.equal(await page.locator('.brand-mark').innerText(),'质');
    await page.locator('[data-act="ui-locale"][data-locale="en"]').click();await inspect('runtime-English-after-Chinese-reload');
   }
   assert.equal(JSON.stringify(fixture),before);assert.deepEqual(calls.filter(c=>c.method!=='GET'&&c.path!=='/api/translation-jobs'),[]);
  }catch(error){await fs.writeFile(path.join(out,engine+'-failure.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,engine+'-failure.png'),fullPage:true});throw error;}finally{await page.close();}
 }
 async function assertEnglishStartup(page){
  assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.title(),'Quality Workbench');
  assert.equal(await page.locator('.boot .brand-mark').innerText(),'QA');assert.match(await page.locator('body').innerText(),/Opening Quality Workbench/);
  for(const value of [await page.locator('body').innerText(),await page.title(),await page.locator('meta[name="description"]').getAttribute('content')])assert.doesNotMatch(value,/[\u3400-\u9fff]/u);
  assert.deepEqual(await page.evaluate(scan),[]);
 }
 const coldBoot=await browser.newPage({locale:'en-GB'});let releaseModule;const moduleGate=new Promise(resolve=>releaseModule=resolve);
 await coldBoot.route('**/app.mjs',async route=>{await moduleGate;await route.abort();});
 try{await coldBoot.goto(origin+'/index.html',{waitUntil:'commit'});await coldBoot.locator('.boot').waitFor();await assertEnglishStartup(coldBoot);}
 finally{releaseModule();await coldBoot.close();}
 const noScript=await browser.newPage({javaScriptEnabled:false,locale:'en-GB'});await noScript.goto(origin+'/index.html');
 await assertEnglishStartup(noScript);assert.equal(await noScript.locator('noscript').innerText(),'Enable JavaScript to use the local Quality Workbench.');await noScript.close();
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 await fs.writeFile(path.join(out,'regression01124-verification.json'),JSON.stringify({status:'passed',externalModelCalls:0,syntheticApi:true,productionAppNavigation:true,coldBootEnglish:true,noJavaScriptEnglish:true,ChineseRuntimeRestored:true,workspaceUnmodified:true,reports,errors,unexpected},null,2));
 console.log(`0.11.24 i18n browser passed: ${reports.length} app states; no model calls or workspace mutations.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
