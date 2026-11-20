import {chromium} from 'playwright';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.VERIFY_APP_ROOT||'.'),load=r=>import(pathToFileURL(path.join(root,r))),out=path.resolve(process.env.VERIFY_CONCURRENCY_OUTPUT||'../outputs/service01119-20261120/concurrency-browser');await fs.mkdir(out,{recursive:true});
const {createWorkbenchServer}=await load('server.mjs'),{createBusinessState,createImportedTask}=await load('public/domain.mjs'),{createBusinessCatalog}=await load('public/catalog.mjs'),{ensureEcommerceCatalog}=await load('public/ecommerce-catalog.mjs'),{createBasisSnapshot}=await load('public/task-basis.mjs'),{EC_HEADERS,EC_RULE_IDS,ecommerceRecordId,ecommerceSourceProjection}=await load('public/ecommerce-schema.mjs'),{prepareReportEnrichment,parseReportEnrichment}=await load('server/report-enrichment.mjs');
let release;const gate=new Promise(r=>release=r),calls=[],inputs=[];let allowVoc=false;
const client={engine:'synthetic-report-parser',async enrichBusinessReport({kind,input,retryFeedback}){
 calls.push(kind);inputs.push({kind,retryFeedback});await gate;
 let value;if(kind==='translation')value={items:input.items.map(i=>({id:i.id,translation:'合成译文，仅测试流程。',isTargetLanguage:false,detectedLanguage:'en'}))};
 else if(kind==='caseHighlights')value={cases:input.candidates.slice(0,input.limit).map(i=>({id:i.id,score:'5',commentary:'引用回复中的具体解释，说明后续处理路径。',quote:i.reply.normalize('NFC')}))};
 else if(kind==='issueClusters')value={clusters:[{label:'回复需校对',summary:'合成记录中的表达存在遗漏。',memberIds:input.records.map(i=>i.id),action:'检查回复内容并补充解释。'}]};
 else {if(!allowVoc)throw Object.assign(Error('Synthetic unavailable content'),{code:'INVALID_OUTPUT'});value={items:input.records.map(i=>({id:i.id,valid:'true',scene:'产品质量',painPoint:'合成故障影响使用',reason:'评论包含具体故障',evidenceQuote:i.comment.normalize('NFC')}))};}
 return parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment(kind,input,retryFeedback),{allowPartial:true});
}};
const config={configured:true,connectionTested:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-only',authMode:'none',apiKey:null};
const server=await createWorkbenchServer({dataDir:await fs.mkdtemp(path.join(out,'workspace-')),catalogSeed:null,sceneSeed:null,arkClient:client,modelConfig:{publicConfig:()=>({...config,executionEngine:'native-node'}),getPrivate:()=>config}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let token;const api=async(route,body,method=body?'POST':'GET')=>{const r=await fetch(origin+route,{method,headers:{Origin:origin,...(token?{'X-Workspace-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));token=v.token||token;return v;};
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'}),context=await browser.newContext(),page=await context.newPage();await page.setViewportSize({width:1440,height:1000});page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await api('/api/workspace');const sourceResponse=await fetch(origin+'/api/sources',{method:'POST',headers:{Origin:origin,'X-Workspace-Token':token,'Content-Type':'application/octet-stream','X-File-Name':'synthetic-report.xlsx'},body:'SYNTHETIC REPORT SOURCE ONLY'});assert.ok(sourceResponse.ok);const source=await sourceResponse.json();
 const sessions=Array.from({length:2},(_,i)=>{const raw=Array(22).fill('');raw[8]=`SYNTHETIC и\u0306 review ${i}`;raw[9]=`SYNTHETIC Cafe\u0301 response ${i}`;raw[11]='Synthetic operator';raw[12]='2026-11-18 09:00:00';raw[13]='2026-11-18 10:00:00';raw[14]=i<60?'好评负向':'好评正向';for(let c=15;c<=20;c++)raw[c]='Pass';if(i<60){raw[16]='Fail';raw[20]='Fail';raw[21]='Synthetic spelling issue';}const ecommerce={schemaVersion:1,sheet:'Sheet4',row:i+3,fileSha256:source.sha256,headers:[...EC_HEADERS],standards:Array(22).fill('Synthetic standard'),raw,thresholdHours:24};return{id:ecommerceRecordId(ecommerce),...ecommerceSourceProjection(ecommerce),ecommerce};});
 const catalog=ensureEcommerceCatalog(createBusinessCatalog()),state=createImportedTask(createBusinessState(),{name:'Synthetic concurrency preference',reviewer:'Synthetic reviewer',source,sessions,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-19',ruleIds:EC_RULE_IDS})});await api('/api/workspace',{state,catalog,baseRevision:0,mutationId:'concurrency01119-fixture'},'PUT');const taskId=state.tasks[0].id;
 await page.goto(origin+'/#exports');
 const check=async(p,value)=>{await p.locator('#business-concurrency').waitFor();assert.equal(await p.locator('#business-concurrency').inputValue(),String(value));};
 await check(page,4);await page.locator('#business-concurrency').selectOption('2');await check(page,2);
 assert.equal(await page.evaluate(()=>localStorage.getItem('service-quality.business-concurrency.v1')),'2');
 await page.reload();await check(page,2);
 await page.locator('[data-page="tasks"]').click();await page.locator('[data-page="exports"]').click();await check(page,2);
 const tab=await page.context().newPage();await tab.goto(origin+'/#exports');await check(tab,2);await tab.close();
 await page.locator('#business-concurrency').selectOption('3');await page.reload();await check(page,3);
 await page.locator('#business-concurrency').selectOption('4');await page.reload();await check(page,4);
 const clean=await browser.newContext(),fresh=await clean.newPage();await fresh.goto(origin+'/#exports');await check(fresh,4);await clean.close();
 await page.locator('#business-concurrency').selectOption('2');
 const request=page.waitForRequest(r=>r.url().endsWith('/api/report-jobs')&&r.method()==='POST');
 await page.locator('[data-act="business-generate"]').click();const body=(await request).postDataJSON();assert.equal(body.concurrency,2);
 await page.locator('.bd-run').waitFor();let jobs=(await api('/api/report-jobs?taskId='+taskId)).jobs;assert.equal(jobs.length,1);assert.equal(jobs[0].concurrency,2);
 await page.evaluate(()=>localStorage.setItem('service-quality.business-concurrency.v1','4'));await page.reload();await page.locator('.bd-run').waitFor();await check(page,4);
 assert.equal(await page.evaluate(()=>localStorage.getItem('service-quality.business-concurrency.v1')),'4');assert.match(await page.locator('.bd-options').innerText(),/本次任务：2路/);
 allowVoc=true;release();await server.waitForReportsIdle();assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(out,'concurrency-persisted.png'),fullPage:true});
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',testedRoot:root,default:4,choicesPersisted:[2,3,4],refresh:true,navigation:true,newTab:true,freshProfileDefault:4,explicitRequestConcurrency:2,persistedJobConcurrency:2,mountDoesNotOverwritePreference:true,externalModelCalls:0,pageErrors:errors},null,2));console.log('Concurrency preference browser passed');
}finally{release();await server.waitForReportsIdle();await browser.close();await new Promise(r=>server.close(r));}

