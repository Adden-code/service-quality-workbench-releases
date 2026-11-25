import {chromium} from 'playwright';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createWorkbenchServer} from '../server.mjs';import {createWorkspaceClient} from '../public/workspace-client.mjs';import {largeWorkspace,writePerformanceSources} from './workspace-performance-fixture.mjs';
const out=path.resolve('../outputs/service01123-20261125/performance');await fs.mkdir(out,{recursive:true});
const data=await fs.mkdtemp(path.join(out,'synthetic-')),raw=largeWorkspace({count:430,megabytes:52});await fs.writeFile(path.join(data,'workspace.json'),JSON.stringify(raw));await writePerformanceSources(data);
const server=await createWorkbenchServer({dataDir:data,storageMode:'sharded'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'}),pages=await Promise.all([1,2,3].map(()=>browser.newPage({viewport:{width:1440,height:900}})));
const events=[],errors=[],workerUrls=[],writer=createWorkspaceClient({incrementalTransport:true,structuralSharing:true,fetchImpl:(url,o={})=>fetch(origin+url,{...o,headers:{Origin:origin,...o.headers}})});let writes;
try{
 await writer.load();let inject=true;
 await pages[0].route('**/api/workspace?*',async route=>{if(inject){inject=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic temporary read outage'})});}else await route.continue();});
 for(const [tab,page] of pages.entries()){page.setDefaultTimeout(180000);page.on('worker',worker=>workerUrls.push({tab,url:worker.url()}));page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(origin+'/api/'))events.push({url:r.url().slice(origin.length),status:r.status(),bytes:Number(r.headers()['x-response-bytes']||0)});});}
 const times=[];writes=(async()=>{for(let i=0;i<24;i++){const start=performance.now();await writer.reviewCommand({action:'accept',sessionId:raw.state.sessions[i].id,at:'2026-11-25T01:00:00Z'});times.push(performance.now()-start);await new Promise(r=>setTimeout(r,50));}})();
 const started=performance.now();await Promise.all(pages.map(p=>p.goto(origin+'/#review')));
 await Promise.all(pages.map(p=>p.locator('[data-act="accept-ai"]').first().waitFor()));
 await pages[0].waitForFunction(()=>!document.body.textContent.includes('正在自动重试')&&!document.body.textContent.includes('Retrying automatically'));
 const loadMs=performance.now()-started;await writes;
 await pages[0].screenshot({path:path.join(out,'recovered-three-tabs.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.ok(events.every(e=>e.bytes<2*1024*1024));assert.ok(events.filter(e=>e.url.startsWith('/api/workspace')&&!e.url.includes('/parts/')).every(e=>e.url.includes('?since=')));assert.ok(events.some(e=>e.status===503));
 assert.equal(new Set(workerUrls.filter(item=>item.url.includes('/workspace-decode-worker.mjs')).map(item=>item.tab)).size,3);
 const result={status:'passed',syntheticOnly:true,sourceBytes:Buffer.byteLength(JSON.stringify(raw)),sessions:430,activeBatchRows:180,tabs:3,continuousWrites:times.length,writeMs:times,loadMs,automaticRecovery:true,workerParsing:true,workerUrls,largestResponse:Math.max(...events.map(e=>e.bytes)),errors,network:events,externalModelCalls:0};await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,network:undefined}));
}finally{await writes?.catch(()=>{});writer.close();await browser.close();await new Promise(r=>server.close(r));}
