import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.VERIFY_APP_ROOT||'.'),load=p=>import(pathToFileURL(path.join(root,p)));
const out=path.resolve(process.env.VERIFY_EC_METADATA_OUTPUT||'../outputs/service01119-20261120/metadata-browser');await fs.mkdir(out,{recursive:true});
const {createWorkbenchServer}=await load('server.mjs'),{workbook}=await load('public/io.mjs'),{SYSTEM_EC_HEADERS}=await load('public/ecommerce-system-source.mjs');
const {createBusinessDeliverySnapshot}=await load('public/business-delivery.mjs'),{buildBusinessReportHtml}=await load('public/business-report.mjs');
const material='D:/Codex project/service-quality-internal-materials/',read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const catalogSeed=await read(material+'20261119/catalog-seed.01112.json'),sceneSeed=await read(material+'20261120/scene-seed.01118.v1.json');
const dataDir=await fs.mkdtemp(path.join(out,'workspace-'));
const row=(operator,index)=>{const r=Array(23).fill('');Object.assign(r,{0:`SYN-META-${index}`,3:'Synthetic device',4:operator,5:'Synthetic battery lasts through my work day.',6:'Synthetic reply: The battery supports the long work day you described.',7:'5',8:'Synthetic administrator',9:'2026-11-01 10:00:00',16:'2026-11-01 11:00:00'});return r;};
const input=path.join(out,'synthetic-multiple-countries.xlsx'),missingInput=path.join(out,'synthetic-unrecognized.xlsx');
await fs.writeFile(input,await workbook([{name:'Export',headers:SYSTEM_EC_HEADERS,rows:['VMALL-MX-HWB2C','VMALL-SA-HWB2C','VMALL-MX-HWB2C','UNKNOWN'].map(row)}]));
await fs.writeFile(missingInput,await workbook([{name:'Export',headers:SYSTEM_EC_HEADERS,rows:[row('UNKNOWN',0)]}]));
const server=await createWorkbenchServer({dataDir,catalogSeed,sceneSeed});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'}),page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'}),errors=[];
page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>localStorage.setItem('service-quality-workbench:locale','zh'));
const document=async()=>await(await fetch(origin+'/api/workspace')).json();
async function wizard(name,file=input,{samplingPeriod='',reportRegion='',batchSite=''}={}){
 await page.goto(origin+'/#tasks');const back=page.getByText('返回任务列表',{exact:true});if(await back.isVisible())await back.click();
 await page.locator('[data-act="new-task"]').first().click();await page.locator('[data-act="task-scene"][data-scene="电商评论回复"]').click();
 await page.locator('#ec-file').setInputFiles(file);await page.locator('#import-preview-confirm').waitFor();
 if(batchSite){await page.locator('#ec-batch-site').fill(batchSite);await page.locator('#ec-batch-site').press('Tab');await page.waitForFunction(()=>document.querySelector('.ecommerce-import')?.getAttribute('aria-busy')==='false');}
 await page.locator('#ec-name').fill(name);await page.locator('#ec-reviewer').fill('Synthetic reviewer');await page.locator('#import-preview-confirm').check();
 await page.locator('#ec-sampling-period').fill(samplingPeriod);await page.locator('#ec-report-region').fill(reportRegion);
}
async function create(name){if(await page.locator('[data-act="ec-next"]').isVisible())await page.locator('[data-act="ec-next"]').click();await page.locator('[data-act="ec-create"]').click();await page.locator('.ecommerce-import').waitFor({state:'detached'});return(await document()).state.tasks.find(task=>task.name===name);}
async function report(task,name){const state=(await document()).state,snapshot=createBusinessDeliverySnapshot(state,{taskId:task.id,now:'2026-11-20T10:00:00+08:00'}),html=buildBusinessReportHtml(snapshot);await fs.writeFile(path.join(out,`${name}.html`),html);await fs.writeFile(path.join(out,`${name}.snapshot.json`),JSON.stringify(snapshot,null,2));const view=await browser.newPage({viewport:{width:1440,height:1000}});await view.setContent(html);const banner=await view.locator('header').innerText();await view.screenshot({path:path.join(out,`${name}.png`)});await view.close();return{snapshot,banner,html};}
try{
 const name='Synthetic manual region';await wizard(name,input,{samplingPeriod:'2026-11 第一周',reportRegion:'Synthetic report region',batchSite:'Synthetic fallback site'});
 await page.screenshot({path:path.join(out,'step2-metadata.png')});await page.locator('[data-act="import-save-close"]').click();await page.locator('.ecommerce-import').waitFor({state:'detached'});
 await page.reload();const back=page.getByText('返回任务列表',{exact:true});if(await back.isVisible())await back.click();await page.locator('[data-act="import-drafts-list"]').click();await page.locator('[data-act="import-draft-resume"]').first().click();
 assert.equal(await page.locator('#ec-sampling-period').inputValue(),'2026-11 第一周');assert.equal(await page.locator('#ec-report-region').inputValue(),'Synthetic report region');
 const manual=await create(name),manualReport=await report(manual,'manual-region');
 assert.deepEqual(manual.ecReportMetadata,{schemaVersion:1,samplingPeriod:'2026-11 第一周',reportRegion:'Synthetic report region'});assert.deepEqual(manual.executionSnapshot.ecReportMetadata,manual.ecReportMetadata);assert.deepEqual(manualReport.snapshot.ecReportMetadata,manual.ecReportMetadata);
 assert.match(manualReport.banner,/2026-11 第一周/);assert.match(manualReport.banner,/Synthetic report region/);assert.doesNotMatch(manualReport.banner,/墨西哥|沙特|Synthetic fallback site/);
 assert.deepEqual(manualReport.snapshot.records.map(r=>r.raw22[3]),['墨西哥','沙特','墨西哥','Synthetic fallback site']);assert.match(manualReport.html,/批次手工覆盖（仅报告地区）/);
 await wizard('Synthetic automatic countries');const automatic=await create('Synthetic automatic countries'),autoReport=await report(automatic,'automatic-countries');
 assert.deepEqual(autoReport.snapshot.basis.reportRegions,['墨西哥','沙特']);assert.match(autoReport.banner,/墨西哥 · 沙特/);assert.match(autoReport.banner,/未提供；不以生成时间替代/);
 await wizard('Synthetic missing metadata',missingInput);const missing=await create('Synthetic missing metadata'),missingReport=await report(missing,'missing-metadata');assert.deepEqual(missingReport.snapshot.basis.reportRegions,[]);assert.match(missingReport.banner,/未提供；不以生成时间替代/);
 assert.deepEqual((await document()).state.tasks.find(task=>task.id===manual.id),manual);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',root,dataDir,externalModelCalls:0,browserImport:true,draftSavedAndRestored:true,taskAndExecutionAndReportFrozen:true,manualRegionWinsBanner:true,matchedCountriesPreserved:true,unrecognizedBatchSitePreserved:true,distinctCountries:true,missingPeriodNotGenerationDate:true,priorTaskUnchanged:true,records:4},null,2));
 console.log('EC batch metadata: real UI import, saved draft restore, task freeze and report banners passed.');
}catch(error){await page.screenshot({path:path.join(out,'failure.png')});await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText());throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
