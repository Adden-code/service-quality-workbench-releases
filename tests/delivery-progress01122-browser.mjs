// Offline, synthetic rendering of the actual business export components.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {businessExportView} from '../public/business-export-view.mjs';
import {setLocale} from '../public/i18n.mjs';
import {managerState,businessUI,reportFixture,summaryFixture} from './business-report-fixtures.mjs';
const output=path.resolve(process.argv[2]||'../outputs/service01122-delivery-progress-20261124');await fs.mkdir(output,{recursive:true});
const css=(await Promise.all(['styles.css','porcelain.css','business-export.css','i18n.css'].map(name=>fs.readFile(new URL('../public/'+name,import.meta.url),'utf8')))).join('\n');
const state=managerState(),ui={...businessUI(),businessReportLanguage:'en',businessTargetLang:'en'},base=summaryFixture({status:'completed',phase:'completed',warningsCount:0,options:{conclusionMode:'combined',targetLang:'en'},progress:{total:2,done:2,skipped:1,failed:0,pending:0,running:0,percent:100},nodes:[{id:'base1',kind:'translation',label:'Original text translation',status:'completed',notApplicable:true},{id:'base2',kind:'issueClusters',label:'Issue clustering',status:'completed'}]}),scenarios=[
 ['awaiting',null,'awaiting',67],
 ['pending',{id:'translation-pending',status:'running',nodes:[{id:'report1',status:'pending'},{id:'report2',status:'pending'}]},'pending',50],
 ['same-language',{id:'translation-same',status:'completed',nodes:[{id:'report1',status:'completed',notApplicable:true},{id:'report2',status:'completed',notApplicable:true}]},'completed',100],
 ['missing-checkpoint',{id:'translation-warning',status:'completed_with_warnings',nodes:[{id:'report1',status:'failed',errorCode:'incomplete_checkpoint',error:'Saved checkpoint is incomplete. Retry missing items.'},{id:'report2',status:'completed'}]},'warning',100],
];
const browser=await chromium.launch({headless:true,channel:process.env.REPORT_BROWSER_CHANNEL||'msedge'}),results=[];
try{for(const language of ['zh','en']){setLocale(language);for(const [name,translationJob,status,percent]of scenarios){const model={job:base,translationJob,result:reportFixture()},html=`<!doctype html><html lang="${language}"><meta charset="utf-8"><style>${css}\nbody{margin:0;padding:24px;background:#f5f6f8}.business-delivery{max-width:1100px;margin:auto}.page-head,.bd-options,.bd-history,.bd-file-grid{display:none} @media(max-width:500px){body{padding:10px}}</style><body>${businessExportView(state,ui,model)}</body></html>`,file=path.join(output,`${language}-${name}.html`);await fs.writeFile(file,html);
 const page=await browser.newPage({viewport:{width:1180,height:1000}}),requests=[],errors=[];page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});page.on('pageerror',error=>errors.push(error.message));await page.goto(pathToFileURL(file).href);const panel=page.locator('.bd-run').first(),heading=await panel.locator('h2').innerText(),caption=await panel.locator('.bd-progress-caption').innerText(),value=await panel.getByRole('progressbar').getAttribute('aria-valuenow');assert.equal(value,String(percent));if(['awaiting','pending'].includes(status))assert.doesNotMatch(heading,/· Completed$|业务交付 · 已完成$/);if(status==='completed')assert.match(caption,language==='en'?/Not applicable 3.*Failed 0.*Pending 0.*100%/:/不适用 3.*失败 0.*等待 0.*100%/);if(status==='warning')assert.match(caption,language==='en'?/Failed 1.*Pending 0.*100%/:/失败 1.*等待 0.*100%/);
 const desktop=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1}));assert.equal(desktop.overflow,false);await page.locator('.business-delivery').screenshot({path:path.join(output,`${language}-${name}-desktop.png`)});await page.setViewportSize({width:390,height:844});const mobile=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1}));assert.equal(mobile.overflow,false);await page.locator('.business-delivery').screenshot({path:path.join(output,`${language}-${name}-mobile.png`)});assert.equal(requests.length,0);assert.deepEqual(errors,[]);results.push({language,scenario:name,heading,caption,percent,desktop,mobile,externalRequests:requests.length,pageErrors:errors});await page.close();}}
}finally{await browser.close();setLocale('zh');}
await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({syntheticOnly:true,modelCalls:0,results},null,2));console.log(JSON.stringify({output,results},null,2));
