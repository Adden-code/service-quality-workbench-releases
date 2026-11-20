import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(process.env.VERIFY_APP_ROOT||'.');
const out=path.resolve(process.env.VERIFY_MODAL_OUTPUT||'../outputs/service01118-20261120/modal-drag-browser');
await fs.mkdir(out,{recursive:true});
const {createWorkbenchServer}=await import(pathToFileURL(path.join(root,'server.mjs')));
const dataDir=await fs.mkdtemp(path.join(out,'workspace-'));
const server=await createWorkbenchServer({dataDir,catalogSeed:null,sceneSeed:null});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.DEMO_BROWSER_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
page.setDefaultTimeout(12000);
const errors=[],unexpected=[],results=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{
  const request=route.request(),url=request.url();
  if(!url.startsWith(origin+'/')||(/\/api\/(?:ai\/|model\/test|rules\/prepare)/.test(url))){unexpected.push(url);return route.abort();}
  return route.continue();
});
await page.addInitScript(()=>{
  window.modalPointerEvents=[];
  for(const type of ['pointerdown','pointerup','pointercancel','click'])document.addEventListener(type,event=>{
    window.modalPointerEvents.push({type,target:event.target.id||event.target.tagName,backdrop:event.target.matches?.('[data-backdrop]')||false,pointerId:event.pointerId,button:event.button});
  },{capture:true});
});
const act=name=>page.locator(`[data-act="${name}"]`).first();
const closed=()=>page.locator('.modal').waitFor({state:'detached'});
async function openModel(){await act('model-settings').click();await page.waitForFunction(()=>document.querySelector('#model-id')&&!document.querySelector('#model-id').disabled);}
async function openScene(){await act('scenario-manage').click();await act('scfg-new-subject').click();await page.locator('[data-subject-field="name"]').waitFor();}
async function drag(from,to){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:14});await page.mouse.up();}
async function regression(name,selector,open){
  await open();
  const input=page.locator(selector),value=`Synthetic ${name} unsaved text ABCDEFGHIJKLMNOPQRSTUVWXYZ`;
  await input.fill(value);await input.scrollIntoViewIfNeeded();
  const box=await input.boundingBox(),inside={x:box.x+Math.min(box.width-12,420),y:box.y+box.height/2},outside={x:8,y:inside.y};
  assert.ok(box.x>outside.x+20,`${name}: left point must be outside dialog`);
  assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.matches('[data-backdrop]'),outside),true);
  await page.evaluate(()=>{window.modalPointerEvents=[];});
  await drag(inside,outside);
  const sequence=await page.evaluate(()=>window.modalPointerEvents);
  assert.equal(sequence.find(event=>event.type==='pointerdown')?.backdrop,false);
  assert.equal(sequence.find(event=>event.type==='pointerup')?.backdrop,true);
  assert.equal(sequence.find(event=>event.type==='click')?.backdrop,true,`${name}: browser must reproduce common-ancestor backdrop click`);
  assert.equal(await input.count(),1,`${name}: drag selection must keep dialog open`);
  assert.equal(await input.inputValue(),value,`${name}: unsaved text must remain`);
  const selected=await input.evaluate(element=>element.selectionEnd-element.selectionStart);
  assert.ok(selected>0,`${name}: actual mouse drag must select text`);
  await page.screenshot({path:path.join(out,`${name}-selection-preserved.png`)});
  await drag(outside,inside);
  assert.equal(await input.count(),1,`${name}: press on backdrop and release inside must not close`);
  assert.equal(await input.inputValue(),value);
  await page.mouse.click(outside.x,outside.y,{button:'right'});
  assert.equal(await input.count(),1,`${name}: right click must not close`);
  await page.mouse.move(outside.x,outside.y);await page.mouse.down();
  await page.locator('[data-backdrop]').dispatchEvent('pointercancel',{pointerId:1,isPrimary:true,bubbles:true});
  await page.mouse.up();
  assert.equal(await input.count(),1,`${name}: cancelled gesture must not close`);
  await page.mouse.click(outside.x,outside.y);await closed();
  await open();await page.keyboard.press('Escape');await closed();
  await open();await page.locator('.modal [data-act="close-modal"]').first().click();await closed();
  await open();await page.locator('.modal [data-act="close-modal"]').first().focus();await page.keyboard.press('Enter');await closed();
  results.push({dialog:name,dragToBackdropPreservesInput:true,selectedCharacters:selected,backdropToInputPreservesDialog:true,rightClickPreservesDialog:true,cancelledGesturePreservesDialog:true,normalBackdropCloses:true,escapeCloses:true,closeButtonCloses:true,keyboardCloseButtonCloses:true,dragEvents:sequence});
}
let outcome;
try{
  await page.goto(origin+'/#tasks');await act('model-settings').waitFor();
  await regression('model-settings','#model-id',openModel);
  await regression('scene-configuration','[data-subject-field="name"]',openScene);
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  outcome={status:'passed',root,dataDir,externalModelCalls:0,syntheticWorkspace:true,results,pageErrors:errors,unexpectedRequests:unexpected};
  console.log(JSON.stringify(outcome,null,2));
}catch(error){
  await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
  await fs.writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText()).catch(()=>{});
  outcome={status:'failed',root,dataDir,message:error.message,stack:error.stack,results,pageErrors:errors,unexpectedRequests:unexpected};throw error;
}finally{
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(outcome,null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
