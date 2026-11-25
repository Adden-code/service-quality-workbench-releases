import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {createWorkbenchServer} from '../server.mjs';
const out=path.resolve(process.env.R39_BROWSER_OUTPUT||'../outputs/service-r39-step1-20261125/browser');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'running',startedAt:new Date().toISOString()}));
const root=await fs.mkdtemp(path.join(out,'isolated-')),servers=[],errors=[],network=[];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
async function app(name){const server=await createWorkbenchServer({dataDir:path.join(root,name),nativeLanguageStage:1,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});server.listen(0,'127.0.0.1');await once(server,'listening');servers.push(server);return`http://127.0.0.1:${server.address().port}`;}
const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US'});
context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))network.push(r.url());});});
const scan=page=>page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&!el.closest('[data-business-original],textarea,script,style')).flatMap(el=>[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&/[\u3400-\u9fff]/u.test(n.textContent)).map(n=>n.textContent.trim())));
try{
 const origin=await app('english'),page=await context.newPage();await page.goto(origin);await page.locator('[data-language-mode="pending-selection"]').waitFor();
 assert.equal(await page.locator('[data-act="language-confirm"]').isDisabled(),true);assert.equal(await page.locator('[data-act="language-pick"][aria-pressed="true"]').count(),0);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-language-mode="pending-selection"]').count(),1);await page.screenshot({path:path.join(out,'01-no-default-choice.png'),fullPage:true});
 await page.locator('[data-language="en"]').click();await page.locator('[data-act="language-confirm"]').click();await page.locator('[data-language-mode="native-v1"]').waitFor();assert.deepEqual(await scan(page),[]);
 assert.equal(await page.locator('[data-act="ui-locale"]').count(),0);await page.screenshot({path:path.join(out,'02-english-locked.png'),fullPage:true});
 await page.evaluate(()=>localStorage.setItem('service-quality-workbench:locale','zh'));await page.reload();await page.locator('[data-language-mode="native-v1"][lang="en"]').waitFor();assert.deepEqual(await scan(page),[]);
 await page.locator('[data-act="model-settings"]').click();await page.locator('[role="dialog"]').waitFor();assert.deepEqual(await scan(page),[]);await page.keyboard.press('Escape');
 await page.locator('[data-act="workspace-backup-open"]').click();await page.locator('[role="dialog"]').waitFor();assert.deepEqual(await scan(page),[]);await page.screenshot({path:path.join(out,'03-backup-available.png'),fullPage:true});await page.keyboard.press('Escape');
 const raceOrigin=await app('race'),a=await context.newPage(),b=await context.newPage();await Promise.all([a.goto(raceOrigin),b.goto(raceOrigin)]);await Promise.all([a.locator('[data-language-mode="pending-selection"]').waitFor(),b.locator('[data-language-mode="pending-selection"]').waitFor()]);
 await a.locator('[data-language="en"]').click();await b.locator('[data-language="zh"]').click();
 // The losing tab may already adopt the winner through normal refresh before
 // Playwright's actionability wait finishes. Fire the real button handlers in
 // both pages without waiting on layout animation; HTTP race is separately tested.
 await Promise.all([a,b].map(p=>p.evaluate(()=>document.querySelector('[data-act="language-confirm"]')?.click())));await Promise.all([a.locator('[data-language-mode="native-v1"]').waitFor(),b.locator('[data-language-mode="native-v1"]').waitFor()]);
 assert.equal(await a.locator('[data-language-mode]').getAttribute('lang'),await b.locator('[data-language-mode]').getAttribute('lang'));
 await a.screenshot({path:path.join(out,'04-concurrent-selection.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',checks:['no-default','mandatory-selection','english-screen-no-CJK','language-lock-reload','localStorage-cannot-switch','model-settings','backup-dialog','two-tabs-same-winner'],pageErrors:errors,externalRequests:network,scope:'Synthetic isolated workspaces only; no model calls or production data.'},null,2));
 console.log('R39 stage 1 browser: 8 checks passed.');
}catch(error){await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'failed',error:error.message,pageErrors:errors,externalRequests:network},null,2));throw error;}
finally{await browser.close();for(const server of servers)await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(out+path.sep));await fs.rm(root,{recursive:true,force:true});}
