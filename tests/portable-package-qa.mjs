import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {chromium} from 'playwright';
import {mergeArchive} from '../packaging/build-portable.mjs';

const info=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const base='D:/Codex project/outputs/service-portable-20261031';
const scratch=await fs.mkdtemp(base+'/便携验收 中文 空格-'),root=path.join(scratch,'应用 移动目录'),dataDir=path.join(scratch,'独立数据');
await fs.mkdir(root);const zip=await JSZip.loadAsync(await fs.readFile(info.archive));
for(const item of Object.values(zip.files)){
 if(item.dir)continue;const target=path.resolve(root,item.name);assert.ok(target.startsWith(path.resolve(root)+path.sep),'ZIP路径越界');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,await item.async('nodebuffer'),{flag:'wx'});
}
const hash=data=>createHash('sha256').update(data).digest('hex'),fileHash=async file=>hash(await fs.readFile(file));
const manifest=JSON.parse(await fs.readFile(path.join(root,'文件校验清单.json'),'utf8'));
for(const file of manifest.files){const p=path.join(root,file.path);assert.equal((await fs.stat(p)).size,file.bytes);assert.equal(await fileHash(p),file.sha256);}
const paths=Object.keys(zip.files).filter(p=>!zip.files[p].dir);
assert.ok(!paths.some(p=>/(^|\/)(data|\.secrets|node_modules|tests|docs|m2)(\/|$)|\.env|\.lock$|workspace\.json$/.test(p)));
const original='D:/Codex project/service-quality-workbench-demo/data/workspace.json',before=await fileHash(original);
const cleanEnv={...process.env};for(const key of Object.keys(cleanEnv))if(['path','java_home','jdk_home','classpath','node_path','node_options','ark_api_key','ark_model_id','workbench_bridge_token'].includes(key.toLowerCase()))delete cleanEnv[key];
const win=process.env.SystemRoot||'C:/Windows';cleanEnv.Path=[path.join(win,'System32'),win,path.join(win,'System32/WindowsPowerShell/v1.0')].join(';');
Object.assign(cleanEnv,{DEMO_DATA_DIR:dataDir,DEMO_PORT:'14886',WORKBENCH_WORKER_PORT:'14892',PORTABLE_STARTUP_TIMEOUT_MS:'45000'});
const node=path.join(root,'runtime/node/node.exe'),launcher=path.join(root,'packaging/portable-launch.mjs');
function command(args,env=cleanEnv){const r=spawnSync(node,[launcher,...args],{cwd:scratch,env,windowsHide:true,encoding:'utf8',timeout:65000});if(r.error||r.status!==0)throw Error('便携命令失败：'+(r.stderr||r.error?.message||r.status));return JSON.parse(r.stdout.trim());}
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,started=false,result;
try{
 const first=command(['--no-open']);started=true;assert.equal(first.engine,'spring-ai');assert.equal(first.appPort,14886);assert.equal(first.workerPort,14892);assert.equal(first.started,true);
 const duplicate=command(['--no-open']);assert.equal(duplicate.instanceId,first.instanceId);assert.equal(duplicate.started,false);
 const native=spawnSync(path.join(root,'启动会话质检工作台.exe'),['--no-open'],{cwd:scratch,env:cleanEnv,windowsHide:true,timeout:30000});assert.equal(native.status,0,'原生启动入口失败');assert.equal(command(['--status']).instanceId,first.instanceId);
 const url=first.url.replace(/\/#.*$/,'');
 let cfg=await(await fetch(url+'/api/model/config')).json();assert.equal(cfg.executionEngine,'spring-ai');assert.equal(cfg.configured,false);
 browser=await chromium.launch({headless:true,executablePath:'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 const act=name=>page.locator(`[data-act="${name}"]`);
 await page.goto(url+'/#tasks');await act('ec-open').click();await act('ec-use-sample').click();await page.locator('.ecommerce-import .import-preview').waitFor();
 await page.locator('#ec-name').fill('便携包完全虚构持久化验证');await page.locator('#ec-reviewer').fill('虚构测试审核员');await act('ec-create').click();await page.locator('.review-shell').waitFor();
 await page.locator('.nav-link').filter({hasText:'质检任务'}).click();
 let doc=await(await fetch(url+'/api/workspace')).json();const task=doc.state.tasks.find(t=>t.name==='便携包完全虚构持久化验证');assert.ok(task);assert.equal(doc.state.sessions.filter(s=>s.taskId===task.id).length,18);
 await page.locator(`[data-act="workflow-open"][data-id="${task.id}"]`).click();await page.getByRole('heading',{name:'暂无运行记录'}).waitFor();await page.screenshot({path:path.join(scratch,'01-portable-ui.png'),fullPage:true});await page.locator('[data-act="workflow-close"]').first().click();
 // A synthetic invalid key checks Windows DPAPI, bundled JRE TLS and Ark routing, never a model inference or real secret.
 const mutation=async(route,payload)=>fetch(url+route,{method:route.endsWith('/config')?'PUT':'POST',headers:{Origin:url,'X-Workspace-Token':doc.token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const save=await mutation('/api/model/config',{apiKey:'fictional-portable-qa-invalid-key',model:'glm-5.3-flash'});assert.equal(save.status,200);cfg=await save.json();assert.equal(cfg.configured,true);
 const connectivity=await mutation('/api/model/test',{});const connectionBody=await connectivity.json();assert.ok([401,403].includes(connectivity.status),'期望虚构密钥鉴权失败而非TLS/依赖错误：'+JSON.stringify({status:connectivity.status,error:connectionBody.error}));
 assert.doesNotMatch(JSON.stringify(connectionBody),/fictional-portable-qa-invalid-key/);
 await mutation('/api/model/config',{clearKey:true});assert.equal(errors.length,0,errors.join('\n'));
 const savedHash=await fileHash(path.join(dataDir,'workspace.json'));await browser.close();browser=null;
 const stopped=command(['--stop']);assert.equal(stopped.state,'stopped');started=false;
 for(let i=0;i<30;i++){if(command(['--status']).state==='stopped')break;await pause(100);}
 const restarted=command(['--no-open']);started=true;assert.notEqual(restarted.instanceId,first.instanceId);assert.equal(await fileHash(path.join(dataDir,'workspace.json')),savedHash);
 doc=await(await fetch(url+'/api/workspace')).json();assert.ok(doc.state.tasks.some(t=>t.id===task.id));
 const nativeStop=spawnSync(path.join(root,'停止会话质检工作台.exe'),[],{cwd:scratch,env:cleanEnv,windowsHide:true,timeout:30000});assert.equal(nativeStop.status,0);started=false;
 for(let i=0;i<30;i++){if(command(['--status']).state==='stopped')break;await pause(100);}
 assert.equal(command(['--status']).state,'stopped');assert.equal(await fileHash(original),before);
 let partsRestored=false;if(info.parts){const manifestPath=path.join(info.parts.directory,'parts-manifest.json'),parts=JSON.parse(await fs.readFile(manifestPath,'utf8')),restored=path.join(scratch,'完整还原.zip');await mergeArchive(parts,{partsDir:info.parts.directory,output:restored});assert.equal(await fileHash(restored),info.sha256);partsRestored=true;}
 result={scratch,archive:info.archive,archiveSha256:info.sha256,filesVerified:manifest.files.length,cleanPath:true,bundledNode:true,bundledJre:true,javaAndAppReady:true,engine:'spring-ai',noBundledCredentials:true,nativeStartVerified:true,duplicateInstanceReused:true,virtualRecords:18,persistenceAfterRestart:true,nativeStopVerified:true,arkTlsAndRouting:'synthetic invalid key rejected with '+connectivity.status,realModelInferences:0,originalWorkspaceUnchanged:true,partsRestored,pageErrors:errors};
 await fs.writeFile(path.join(scratch,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();if(started)try{command(['--stop']);}catch{}}
