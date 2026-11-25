// Real durable workspace + browser + saved downloads. Every model response is scripted locally.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {readXlsx} from '../public/io.mjs';
import {nativeDisplayProjection} from '../server/native-delivery.mjs';
import {seedStage3Workspace,serveStage3Workspace,syntheticOriginals} from './native-language-stage3-workspace.mjs';

const out=path.resolve(process.env.R39_BROWSER_OUTPUT||'../outputs/service-r39-step3-20261125/browser');await fs.mkdir(out,{recursive:true});
const root=await fs.mkdtemp(path.join(out,'isolated-')),servers=[],pageErrors=[],externalRequests=[],translationPosts=[],results=[],checks=[],cjkFindings=[],allowedOriginalFindings=[];
await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'running',startedAt:new Date().toISOString(),syntheticOnly:true}));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',acceptDownloads:true});
context.on('page',page=>{
 page.on('pageerror',error=>pageErrors.push({url:page.url(),message:error.message}));
 page.on('request',request=>{
  if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:'))externalRequests.push(request.url());
  if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/translation-jobs')translationPosts.push(request.postDataJSON());
 });
});
async function scan(page,stage,frozenIdentifiers=[]){
 const entries=await page.evaluate(identifiers=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&!el.closest('[data-business-original],textarea,script,style')).flatMap(el=>[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE&&/[\u3400-\u9fff]/u.test(n.textContent)).map(n=>{
  const text=n.textContent.trim(),originalAudit=Boolean(el.closest('[data-original-ai-audit] tbody td:nth-child(2)'));
  const idOnly=Boolean(el.closest('.audit-reference'))&&!/[\u3400-\u9fff]/u.test(identifiers.reduce((value,id)=>value.replaceAll(id,''),text));
  return{text,selector:el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.trim().replaceAll(' ','.'):''),allowed:originalAudit?'frozen-original-audit-value':idOnly?'exact-frozen-identifier':null};
 })),frozenIdentifiers);
 const findings=entries.filter(e=>!e.allowed),allowed=entries.filter(e=>e.allowed);if(allowed.length)allowedOriginalFindings.push({stage,findings:allowed});
 if(findings.length)cjkFindings.push({stage,findings});return findings;
}
const tokens=new Map();
const read=async(origin,url)=>{const response=await fetch(origin+url,{headers:tokens.has(origin)?{'x-workspace-token':tokens.get(origin)}:{}});assert.equal(response.status,200,await response.clone().text());const value=await response.json();if(value.token)tokens.set(origin,value.token);return value;};
async function download(page,kind,file){const saved=page.waitForEvent('download');await page.locator('[data-act="business-download-'+kind+'"]').click();const item=await saved;assert.equal(await item.failure(),null);await item.saveAs(file);return file;}
async function shot(page,name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
try{
 for(const language of ['en','zh']){
  const dataDir=path.join(root,language),metadata=await seedStage3Workspace({dataDir,language}),requests=[];
  const running=await serveStage3Workspace({dataDir,requests});servers.push(running.server);let origin=running.origin,page=await context.newPage();
  let current=await read(origin,'/api/workspace');assert.equal(current.nativeLanguageStage,3);assert.equal(current.productVersion,'0.11.24');
  const originalTask=current.state.tasks.find(t=>t.id===metadata.taskId),originalSessions=current.state.sessions.filter(s=>s.taskId===metadata.taskId);
  const frozen=JSON.parse(await fs.readFile(path.join(dataDir,'language-materials',metadata.materialRef+'.json'),'utf8'));
  const projected=(await read(origin,`/api/tasks/${metadata.taskId}/native-material`)).material;assert.deepEqual(projected,nativeDisplayProjection(originalTask,frozen));
  assert.equal(metadata.promptVersion,'V1.2');checks.push(language+':exact-frozen-projection-and-v1.2-prompt');
  await page.goto(origin);await page.locator('[data-act="task-review"]').first().waitFor();
  await page.locator('[data-act="task-review"][data-id="'+metadata.taskId+'"]').click();
  await page.locator('[data-reason-status="native"]').first().waitFor();
  assert.equal(await page.locator('[data-act="ui-locale"]:enabled').count(),0);
  assert.equal(await page.locator('html').getAttribute('lang'),language==='zh'?'zh-CN':'en');
  await page.evaluate(lang=>localStorage.setItem('service-quality-workbench:locale',lang),language==='en'?'zh':'en');await page.reload();
  await page.locator('[data-reason-status="native"]').first().waitFor();assert.equal(await page.locator('html').getAttribute('lang'),language==='zh'?'zh-CN':'en');
  assert.ok((await page.locator('.conversation-pane').innerText()).includes(syntheticOriginals.customer));
  assert.ok((await page.locator('.conversation-pane').innerText()).includes(syntheticOriginals.agent));
  const card=page.locator('[data-rule-card="NP-SYNTHETIC"]');if(await card.locator('[data-act="toggle-rule"]').getAttribute('aria-expanded')!=='true')await card.locator('[data-act="toggle-rule"]').click();
  assert.ok((await card.innerText()).includes(originalSessions[0].aiResults[0].reason));assert.ok((await card.innerText()).includes(projected.rules[0].title));
  if(language==='en')await scan(page,'en-review');await shot(page,language+'-01-native-review');
  await card.locator('[data-act="rule-detail"]').click();await page.locator('[role="dialog"]').waitFor();
  assert.ok((await page.locator('[role="dialog"]').innerText()).includes(projected.rules[0].passCriteria));
  if(language==='en')await scan(page,'en-frozen-rule');await shot(page,language+'-02-frozen-rule');await page.keyboard.press('Escape');
  checks.push(language+':locked-language-native-reasons-originals-frozen-rule');
  for(const sessionId of metadata.sessionIds){
   await page.locator('[data-act="select-session"][data-id="'+sessionId+'"]').click();
   await page.locator('[data-act="confirm-review"]').click();await page.locator('[data-act="do-confirm-review"]').waitFor();
   if(language==='en')await scan(page,'en-confirm-dialog');await page.locator('[data-act="do-confirm-review"]').click();
   await page.waitForFunction(async id=>{const view=await(await fetch('/api/workspace')).json();return view.state.sessions.find(s=>s.id===id)?.review.status==='已确认';},sessionId);
  }
  current=await read(origin,'/api/workspace');for(const original of originalSessions){const updated=current.state.sessions.find(s=>s.id===original.id);assert.equal(updated.review.status,'已确认');assert.deepEqual(updated.turns,original.turns);assert.deepEqual(updated.aiResults,original.aiResults);}
  assert.deepEqual(current.state.tasks.find(t=>t.id===metadata.taskId).executionSnapshot,originalTask.executionSnapshot);checks.push(language+':browser-human-confirmation-preserves-ai-and-source');
  await page.locator('[data-act="nav"][data-page="exports"]').click();await page.locator('[data-act="business-generate"]').waitFor();
  for(const id of ['business-report-language','business-target-lang']){assert.equal(await page.locator('#'+id).inputValue(),language);assert.notEqual(await page.locator('#'+id+' option[value="'+(language==='en'?'zh':'en')+'"]').getAttribute('disabled'),null,id+' must disable the other language');}
  if(language==='en')await scan(page,'en-export-before');await shot(page,language+'-03-export-ready');
  const created=page.waitForResponse(response=>response.url()===origin+'/api/report-jobs'&&response.request().method()==='POST');await page.locator('[data-act="business-generate"]').click();
  const createdResponse=await created,body=await createdResponse.json();assert.equal(createdResponse.status(),202,JSON.stringify(body));const jobId=body.job.id;
  let result;const deadline=Date.now()+60000;do{result=await read(origin,'/api/report-jobs/'+jobId+'/result');if(['completed','completed_with_warnings','failed','paused'].includes(result.job.status))break;await delay(100);}while(Date.now()<deadline);
  assert.equal(result.job.status,'completed',JSON.stringify(result.job.nodes));assert.equal(result.job.nativeLanguage,language);
  await page.locator('[role="progressbar"][aria-valuenow="100"]').waitFor({timeout:15000});
  if(language==='en')await scan(page,'en-export-completed');await shot(page,language+'-04-export-complete');
  const htmlFile=await download(page,'html',path.join(out,'native-'+language+'.html')),xlsxFile=await download(page,'xlsx',path.join(out,'native-'+language+'.xlsx'));
  const html=await fs.readFile(htmlFile,'utf8'),tables=await readXlsx(await fs.readFile(xlsxFile)),all=JSON.stringify(tables);
  assert.match(html,new RegExp('<html lang="'+(language==='zh'?'zh-CN':'en')+'"'));assert.doesNotMatch(html,/Translation missing|Translation pending|\[Untranslated:/);
  for(const original of originalSessions)assert.ok(all.includes(original.aiResults[0].reason));assert.ok(all.includes(syntheticOriginals.customer));assert.ok(all.includes(syntheticOriginals.agent));
  assert.ok(all.includes(language==='en'?'The customer asks about a blue version.':'用户询问蓝色版本是否存在'));assert.ok(html.includes(projected.rules[0].title));
  const report=await context.newPage();await report.goto(pathToFileURL(htmlFile).href);if(language==='en')await scan(report,'en-report-html',[originalTask.executionSnapshot.configuration.id,originalTask.executionSnapshot.template.id]);await shot(report,language+'-05-report-html');await report.close();
  const callsBefore=requests.length;await page.reload();await page.locator('[role="progressbar"][aria-valuenow="100"]').waitFor({timeout:15000});
  assert.equal(requests.length,callsBefore);assert.deepEqual(await read(origin,'/api/report-jobs/'+jobId+'/result'),result);
  await page.locator('[data-act="nav"][data-page="review"]').click();await page.locator('[data-act="nav"][data-page="exports"]').click();await page.locator('[role="progressbar"][aria-valuenow="100"]').waitFor();assert.equal(requests.length,callsBefore);
  if(language==='en')await scan(page,'en-export-revisited');await shot(page,language+'-06-export-revisited');
  assert.ok(requests.some(r=>JSON.parse(r.messages[1].content).kind==='translation'));
  const generated=requests.map(r=>JSON.parse(r.messages[1].content)).filter(data=>data.contract==='native-report-v1');assert.ok(generated.length>=2);assert.ok(generated.every(data=>data.contentLanguage===language));
  checks.push(language+':native-report-generation-source-translation-html-xlsx-revisit');
  await page.close();await new Promise(resolve=>running.server.close(resolve));
  const reopened=await serveStage3Workspace({dataDir,requests});servers.push(reopened.server);origin=reopened.origin;
  await read(origin,'/api/workspace');assert.deepEqual(await read(origin,'/api/report-jobs/'+jobId+'/result'),result);assert.equal(requests.length,callsBefore);
  page=await context.newPage();await page.goto(origin);await page.locator('[data-act="nav"][data-page="exports"]').click();await page.locator('[role="progressbar"][aria-valuenow="100"]').waitFor({timeout:15000});assert.equal(requests.length,callsBefore);checks.push(language+':server-restart-retains-native-report-without-regeneration');
  results.push({language,taskId:metadata.taskId,jobId,materialRef:metadata.materialRef,promptVersion:metadata.promptVersion,scriptedInspectionCalls:metadata.scriptedModelCalls,scriptedReportCalls:requests.length,reportStatus:result.job.status,confirmedSessions:metadata.sessionIds.length,htmlFile,xlsxFile});
  await fs.writeFile(path.join(out,language+'-report-result.json'),JSON.stringify(result,null,2));await page.close();
 }
 assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(translationPosts.filter(p=>['session-display','report'].includes(p.source?.kind)),[]);assert.deepEqual(cjkFindings,[]);
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'passed',syntheticOnly:true,externalModelCalls:0,checks,results,pageErrors,externalRequests,translationPosts,cjkFindings,allowedOriginalFindings,scope:'Durable synthetic workspaces, local scripted model, real browser UI and downloaded files. Not real-model or business acceptance.'},null,2));
 console.log(JSON.stringify({status:'passed',checks:checks.length,out,results},null,2));
}catch(error){await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({status:'failed',error:error.stack,syntheticOnly:true,checks,results,pageErrors,externalRequests,translationPosts,cjkFindings,allowedOriginalFindings},null,2));for(const page of context.pages())try{await shot(page,'failure-'+context.pages().indexOf(page));await fs.writeFile(path.join(out,'failure-'+context.pages().indexOf(page)+'.txt'),await page.locator('body').innerText());}catch{}throw error;}
finally{await browser.close();for(const server of servers)await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(out+path.sep));await fs.rm(root,{recursive:true,force:true});}
