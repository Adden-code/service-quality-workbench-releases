// Opt-in native smoke: isolated synthetic host, no business workspace/model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {buildDesktopShell,WEBVIEW2_SDK} from '../packaging/build-desktop.mjs';
const execute=promisify(execFile),project=fileURLToPath(new URL('..',import.meta.url));
const base=path.resolve(process.env.VERIFY_DESKTOP_SHELL_OUTPUT||path.join(project,'..','outputs','service01122-desktop-20261124'));
await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'native-smoke-'));
const data=path.join(root,'synthetic-data'),other=path.join(root,'other-data'),calls=path.join(root,'host-calls.jsonl');
const sdkDir=process.env.WEBVIEW2_SDK_DIR||path.resolve(project,'..','.tools','webview2-sdk',WEBVIEW2_SDK.version);
const built=await buildDesktopShell({root,sdkDir});await fs.mkdir(path.join(root,'runtime','node'),{recursive:true});await fs.copyFile(process.execPath,path.join(root,'runtime','node','node.exe'));
await fs.writeFile(path.join(root,'desktop-language.ini'),'[Desktop]\r\nLanguage=english\r\n');
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><title>Synthetic native desktop verification</title><h1>Synthetic native desktop verification</h1><p id="language"></p><input id="file" type="file"><button id="download">Download fixture</button><button id="popup">Open printable report</button><script>document.querySelector('#language').textContent=navigator.language;document.querySelector('#download').onclick=()=>{const a=document.createElement('a');a.download='synthetic-native.txt';a.href=URL.createObjectURL(new Blob(['synthetic native download'],{type:'text/plain'}));a.click()};document.querySelector('#popup').onclick=()=>window.open(URL.createObjectURL(new Blob(['<!doctype html><title>Synthetic printable report</title><h1>Synthetic printable report</h1><button onclick="window.print()">Print</button>'],{type:'text/html'})));</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const debugPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
await fs.writeFile(path.join(root,'packaging','desktop-host.mjs'),`import fs from 'node:fs';const cmd=process.argv[2];fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({cmd,dataDir:process.env.DEMO_DATA_DIR})+'\\n');const stopped=cmd==='--stop';console.log(JSON.stringify({ok:true,state:stopped?'stopped':'ready',dataDir:process.env.DEMO_DATA_DIR,rootId:'synthetic-root',url:${JSON.stringify(origin)},staleLock:{present:!stopped,recoverable:false,reason:'owner-alive'},activity:{busy:false,unknown:false,counts:{ai:0,report:0,translation:0,structured:0}}}));`);
// The template above deliberately creates literal JavaScript newline escaping.
const stub=path.join(root,'packaging','desktop-host.mjs');await fs.writeFile(stub,(await fs.readFile(stub,'utf8')).replace("+'\\\\n'","+'\\n'"));
const env={...process.env,DEMO_DATA_DIR:data,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`};
let child,browser,popupBrowser,closed=false;const errors=[];
const waitFor=async(fn,label)=>{const until=Date.now()+45000;while(Date.now()<until){try{const value=await fn();if(value)return value;}catch{}await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Timed out: '+label);};
try{
 const diagnostics=path.join(root,'diagnostics.json');await execute(built.executable,['--diagnostics',diagnostics],{env,windowsHide:true});const info=JSON.parse(await fs.readFile(diagnostics,'utf8'));assert.equal(info.runtimeAvailable,true);
 child=spawn(built.executable,[],{env,windowsHide:true,stdio:'ignore'});const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 await waitFor(async()=>{const response=await fetch(`http://127.0.0.1:${debugPort}/json/version`);return response.ok;},'native WebView2 CDP');
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
 const page=await waitFor(()=>browser.contexts().flatMap(x=>x.pages()).find(x=>x.url().startsWith(origin)),'native workbench page');page.on('pageerror',error=>errors.push(error.message));
 await page.locator('h1').waitFor();assert.equal(await page.evaluate(()=>navigator.language),'en-US');
 const upload=path.join(root,'synthetic-upload.txt');await fs.writeFile(upload,'Synthetic fixture only');await page.locator('#file').setInputFiles(upload);assert.equal(await page.locator('#file').evaluate(x=>x.files[0].name),'synthetic-upload.txt');
 const download=page.waitForEvent('download');await page.locator('#download').click();await(await download).saveAs(path.join(root,'native-download.txt'));assert.equal(await fs.readFile(path.join(root,'native-download.txt'),'utf8'),'synthetic native download');
 await page.screenshot({path:path.join(root,'native-workbench.png')});
 await page.locator('#popup').click();
 // WebView2 transfers NewWindow to a new native controller. Its replacement
 // target is not always attached to Playwright's initial CDP connection.
 await waitFor(async()=>{const targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();return targets.find(x=>x.title==='Synthetic printable report');},'native blob report target');
 popupBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
 const popup=await waitFor(async()=>{for(const candidate of popupBrowser.contexts().flatMap(x=>x.pages())){if(!candidate.isClosed()&&await candidate.title()==='Synthetic printable report')return candidate;}},'native blob report popup');await popup.locator('h1').waitFor();await popup.screenshot({path:path.join(root,'native-report-popup.png')});
 const before=await fs.readFile(calls,'utf8');await execute(built.executable,[],{env:{...env,DEMO_DATA_DIR:other},windowsHide:true});assert.equal(await fs.readFile(calls,'utf8'),before,'second different-data launch only activates existing window');
 await execute(built.executable,['--exit-for-install'],{env:{...env,DEMO_DATA_DIR:other},windowsHide:true,timeout:90000});assert.deepEqual(await exit,{code:0,signal:null});closed=true;
 const log=(await fs.readFile(calls,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(log.map(x=>x.cmd),['--inspect','--start','--inspect','--stop']);assert.ok(log.every(x=>x.dataDir===data));
 assert.equal(await fs.stat(other).then(()=>true,()=>false),false);assert.equal(await fs.stat(path.join(data,'desktop-profile')).then(()=>true,()=>false),true);assert.deepEqual(errors,[]);
 const verification={status:'passed',runtimeVersion:info.runtimeVersion,sdkVersion:WEBVIEW2_SDK.version,root,syntheticOnly:true,externalModelCalls:0,steps:['native-WebView2-ready','installer-English-navigator','file-input','blob-download','blob-report-popup','different-data-second-launch-activation','different-data-installer-close','WebView2-dispose-and-exit'],bridgeCalls:log,errors};
 await fs.writeFile(path.join(root,'verification.json'),JSON.stringify(verification,null,2));console.log(JSON.stringify(verification,null,2));
}finally{
 if(!closed&&child&&child.exitCode===null)await execute(built.executable,['--exit-for-install'],{env,windowsHide:true,timeout:90000}).catch(()=>{});
 if(popupBrowser)await popupBrowser.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));
}
