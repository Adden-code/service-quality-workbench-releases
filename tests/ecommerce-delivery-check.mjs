import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import {chromium} from 'playwright';
import {createModelConfig} from '../server/model-config.mjs';
const base='D:/Codex project/outputs/service-ecommerce-implementation-20261030',original='data/workspace.json';
const hash=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
const before=await hash(original),browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:4186/#tasks');await page.locator('[data-act="ec-open"]').click();await page.locator('#ec-file').waitFor();
  if(errors.length)throw Error('Local UI errors');await page.locator('#overlay-root [data-act="close-modal"]').first().click();
}finally{await browser.close();}
const after=await hash(original);if(before!==after)throw Error('Existing workspace changed');
const config=await createModelConfig({dataDir:path.resolve('data')}),key=config.getPrivate().apiKey;
if(!key)throw Error('Configured credential unavailable for nonprinting package check');
const zip=await JSZip.loadAsync(await fs.readFile(base+'/电商评论首轮测试包_全虚构.zip'));
for(const item of Object.values(zip.files)){
  if(item.dir)continue;if((await item.async('nodebuffer')).includes(Buffer.from(key)))throw Error('Credential found in delivery package');
}
const result={localUrl:'http://127.0.0.1:4186/#tasks',uiEntryVerified:true,existingWorkspaceBefore:before,existingWorkspaceAfter:after,pageErrors:errors,packageActiveCredentialAbsent:true};
await fs.writeFile(base+'/local-and-package-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
