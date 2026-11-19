import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {sceneReportFixture} from './scene-report-fixtures.mjs';
const root=path.resolve(process.env.VERIFY_APP_ROOT||'.'),out=path.resolve('../outputs/service01115-20261119/report-browser');await fs.mkdir(out,{recursive:true});
const {buildSceneReportHtml,buildSceneDeliveryXlsx}=await import(pathToFileURL(path.join(root,'public/scene-delivery.mjs'))),{readXlsx}=await import(pathToFileURL(path.join(root,'public/io.mjs')));
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'}),results=[];
try{for(const engine of ['ecommerce','conversation'])for(const language of ['zh','en']){
 const {snapshot,enrichment,translations}=sceneReportFixture(engine,180,{largeFrozen:true}),html=buildSceneReportHtml(snapshot,enrichment,{language,translations}),bytes=Buffer.byteLength(html),name=engine+'-'+language;
 assert.ok(bytes<2*1024*1024);assert.ok(!html.includes('SYNTHETIC_FROZEN_ONLY_'));await fs.writeFile(path.join(out,name+'.html'),html);
 const xlsx=path.join(out,name+'.xlsx'),decoded=path.join(out,name+'-audit.json');await fs.writeFile(xlsx,await buildSceneDeliveryXlsx(snapshot,enrichment,{language,translations}));
 // Independent XML reader for our generated 10MB audit sheet; the application's
 // input-file limits intentionally remain unchanged.
 execFileSync('python',['-X','utf8','-c',`import sys,zipfile,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(sys.argv[1]);ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
book=E.fromstring(z.read('xl/workbook.xml'));sheets=book.findall('m:sheets/m:sheet',ns);index=next(i for i,s in enumerate(sheets) if s.attrib['name'] in ['冻结快照审计','Frozen snapshot audit'])
root=E.fromstring(z.read('xl/worksheets/sheet'+str(index+1)+'.xml'));parts=[]
for row in root.findall('m:sheetData/m:row',ns)[1:]:
 cells=[''.join(c.itertext()) for c in row.findall('m:c/m:is',ns)]
 if cells[0]=='deliverySnapshot':parts.append((int(cells[1]),cells[4]))
text=''.join(v for i,v in sorted(parts));json.loads(text);open(sys.argv[2],'w',encoding='utf8').write(text)
`,xlsx,decoded],{windowsHide:true});assert.deepEqual(JSON.parse(await fs.readFile(decoded,'utf8')),snapshot);
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(out,name+'.html')).href);assert.equal(await page.locator('.report-section').count(),engine==='ecommerce'?6:5);assert.ok(await page.locator('svg').count()>0);
 await page.evaluate(()=>{window.print=()=>window.printCalled=true;});await page.locator('.report-tools button').click();assert.equal(await page.evaluate(()=>window.printCalled),true);await page.screenshot({path:path.join(out,name+'-desktop.png')});await page.pdf({path:path.join(out,name+'.pdf'),format:'A4',printBackground:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.screenshot({path:path.join(out,name+'-mobile.png')});assert.deepEqual(errors,[]);await page.close();results.push({engine,language,bytes,sections:engine==='ecommerce'?6:5,fullSnapshotRestored:true,print:true,noOverflow:true});
}await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',testedRoot:root,syntheticRows:180,largeFrozen:true,results,externalModelCalls:0},null,2));console.log('Installed report rendering and audit reconstruction passed');}finally{await browser.close();}
