import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildDesktopShell,WEBVIEW2_SDK,defaultCompiler,sha256} from '../packaging/build-desktop.mjs';
const execute=promisify(execFile),project=fileURLToPath(new URL('..',import.meta.url));
const sdkDir=process.env.WEBVIEW2_SDK_DIR||path.resolve(project,'..','.tools','webview2-sdk',WEBVIEW2_SDK.version);
const canCompile=process.platform==='win32'&&existsSync(defaultCompiler())&&existsSync(path.join(sdkDir,WEBVIEW2_SDK.files[0].source));
const base=path.resolve(project,'..','outputs','service01122-desktop-tests');
let root,built,harness;
before(async()=>{
 if(!canCompile)return;
 await fs.mkdir(base,{recursive:true});root=await fs.mkdtemp(path.join(base,'shell 中文 & '));
 built=await buildDesktopShell({root,sdkDir});
 const source=path.join(root,'PolicyHarness.cs');harness=path.join(root,'PolicyHarness.exe');
 await fs.writeFile(source,`using System;using System.IO;using System.Collections.Generic;using System.Web.Script.Serialization;
class PolicyHarness {static int Main(string[] args){Console.OutputEncoding=new System.Text.UTF8Encoding(false);var json=new JavaScriptSerializer();try {object result=null;
 if(args[0]=="language")result=DesktopPolicy.Language(args[1],args[2]);
 else if(args[0]=="identity")result=DesktopPolicy.InstanceKey(args[1],args[2]);
 else if(args[0]=="profile"){var method=typeof(DesktopPolicy).GetMethod("ProfileDirectory");if(method==null)throw new MissingMethodException("ProfileDirectory");result=method.Invoke(null,new object[]{args[1]});}
 else if(args[0]=="internal")result=DesktopPolicy.InternalNavigation(args[1],DesktopPolicy.WorkbenchUri(args[2]));
 else if(args[0]=="workbench")result=DesktopPolicy.WorkbenchUri(args[1]).AbsoluteUri;
 else if(args[0]=="close")result=DesktopPolicy.NeedsCloseConfirmation(json.DeserializeObject(args[1]) as Dictionary<string,object>);
 else if(args[0]=="bridge")result=new DesktopBridge(args[1],"en").Call(args[2]);
 else if(args[0]=="missing")result=DesktopPolicy.MissingStartupFiles(args[1]);
 else if(args[0]=="installer")result=DesktopPolicy.InstallerMatches(args[1],args[2]);
 Console.WriteLine(json.Serialize(new {ok=true,value=result}));return 0;
 }catch(Exception e){var host=e as DesktopHostException;Console.WriteLine(json.Serialize(new {ok=false,code=host==null?e.GetType().Name:host.Code}));return 0;}}}`);
 await execute(defaultCompiler(),['/nologo','/target:exe','/platform:x64',`/out:${harness}`,`/reference:${built.executable}`,'/reference:System.Web.Extensions.dll',source],{windowsHide:true});
});
after(async()=>{if(root){assert.ok(path.resolve(root).startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});}});
async function invoke(...args){return JSON.parse((await execute(harness,args,{windowsHide:true})).stdout.trim());}
const native={skip:!canCompile?'Windows compiler and pinned WebView2 SDK required':false};

test('desktop builder requires explicit SDK and rejects tampered binaries before writing package',async t=>{
 await assert.rejects(buildDesktopShell({root:'unused',sdkDir:''}),/sdkDir/);
 if(!canCompile)return;
 const tampered=path.join(root,'tampered-sdk');await fs.mkdir(path.join(tampered,'lib','net462'),{recursive:true});
 await fs.writeFile(path.join(tampered,WEBVIEW2_SDK.files[0].source),'not the official DLL');
 const output=path.join(root,'tampered-output');await assert.rejects(buildDesktopShell({root:output,sdkDir:tampered}),/hash mismatch/);assert.equal(existsSync(output),false);
});

test('desktop builds a real x64 executable with pinned small SDK redistribution, source and managed language config',native,async()=>{
 assert.equal((await fs.readFile(built.executable)).subarray(0,2).toString(),'MZ');assert.equal(built.sdk.version,WEBVIEW2_SDK.version);
 for(const file of built.files)assert.equal(sha256(await fs.readFile(path.join(root,file.file))),file.sha256,file.file);
 assert.equal(await fs.readFile(path.join(root,'desktop-language.ini'),'utf8'),'[Desktop]\r\nLanguage=auto\r\n');
 assert.equal(await fs.readFile(path.join(root,'packaging','WorkbenchDesktop.cs'),'utf8'),await fs.readFile(path.join(project,'packaging','WorkbenchDesktop.cs'),'utf8'));
 assert.ok(built.files.filter(x=>x.file.endsWith('.dll')).reduce((a,x)=>a+x.size,0)<2*1024*1024);
 assert.equal(built.files.some(x=>/msedge|chrome|chromium/i.test(x.file)),false);
 assert.ok(built.files.some(x=>x.file==='Microsoft.Web.WebView2.LICENSE.txt'));
});

test('installer language overrides the opposite OS language; auto and invalid use Chinese OS or English fallback',native,async()=>{
 const ini=path.join(root,'desktop-language.ini');
 for(const [value,os,expected] of [['chinesesimp','en','zh'],['english','zh','en'],['auto','zh-CN','zh'],['auto','en','en'],['auto','es','en'],['auto','ar','en'],['unknown','fr','en']]){
  await fs.writeFile(ini,`[Desktop]\r\nLanguage=${value}\r\n`);assert.equal((await invoke('language',root,os)).value,expected,`${value}/${os}`);
 }
 await fs.writeFile(ini,'[Other]\nLanguage=chinesesimp\n');assert.equal((await invoke('language',root,'en')).value,'en');
 await fs.writeFile(ini,'[Desktop]\r\nLanguage=auto\r\n');
});

test('same installation identity is independent of data-directory environment and isolated by user/root',native,async()=>{
 const one=(await invoke('identity',root,'S-1-5-test')).value;
 const two=JSON.parse((await execute(harness,['identity',root.toUpperCase()+path.sep,'S-1-5-test'],{windowsHide:true,env:{...process.env,DEMO_DATA_DIR:path.join(root,'other-data')}})).stdout).value;
 assert.equal(one,two);assert.notEqual(one,(await invoke('identity',root,'S-1-5-other')).value);assert.notEqual(one,(await invoke('identity',path.join(root,'other-install'),'S-1-5-test')).value);
});

test('native navigation retains only the verified loopback origin and its blob popups',native,async()=>{
 const origin='http://127.0.0.1:4186/#tasks';
 for(const url of ['http://127.0.0.1:4186/#review','blob:http://127.0.0.1:4186/fixture','about:blank'])assert.equal((await invoke('internal',url,origin)).value,true,url);
 for(const url of ['https://example.com/','http://127.0.0.1:4187/','http://localhost:4186/','file:///D:/test.html','javascript:alert(1)','http://user@127.0.0.1:4186/'])assert.equal((await invoke('internal',url,origin)).value,false,url);
 for(const url of ['https://127.0.0.1:4186/','http://example.com:4186/','http://127.0.0.1:80/'])assert.equal((await invoke('workbench',url)).ok,false,url);
});

test('desktop WebView2 profile is outside business data and stable per normalized workspace path',native,async()=>{
 const dataDir=path.join(root,'Synthetic business data'),local=path.join(root,'Synthetic local app data');
 async function profile(value){const result=JSON.parse((await execute(harness,['profile',value],{windowsHide:true,env:{...process.env,LOCALAPPDATA:local}})).stdout);assert.equal(result.ok,true,JSON.stringify(result));return result.value;}
 const one=await profile(dataDir),again=await profile(dataDir.toUpperCase()+path.sep),other=await profile(path.join(root,'Other workspace'));
 assert.equal(one,again);assert.notEqual(one,other);assert.ok(one.toLowerCase().startsWith((path.join(local,'MSSQualityWorkbench-shell','profile')+path.sep).toLowerCase()),one);assert.equal(one.toLowerCase().startsWith((dataDir+path.sep).toLowerCase()),false);
 assert.equal(existsSync(dataDir),false);assert.equal(existsSync(one),false);
 for(const customData of [path.join(local,'MSSQualityWorkbench-shell'),local]){
  const external=await profile(customData),relative=path.relative(customData,external);
  assert.ok(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),`${external} must stay outside ${customData}`);
  assert.equal(existsSync(external),false);
 }
 const source=await fs.readFile(path.join(root,'packaging','WorkbenchDesktop.cs'),'utf8');assert.match(source,/CreateAsync\(null,\s*DesktopPolicy\.ProfileDirectory\(dataDir\),\s*options\)/);assert.doesNotMatch(source,/Path\.Combine\(dataDir,\s*"desktop-profile"\)/);
});

test('close confirmation is conservative for busy, unknown, blocked or incomplete activity',native,async()=>{
 const activity={busy:false,unknown:false,counts:{ai:0,report:0,translation:0,structured:0}};
 assert.equal((await invoke('close',JSON.stringify({state:'ready',activity}))).value,false);
 for(const value of [{state:'ready',activity:{...activity,busy:true}},{state:'ready',activity:{...activity,unknown:true}},{state:'blocked',activity},{state:'ready'},{activity:{busy:false}}])assert.equal((await invoke('close',JSON.stringify(value))).value,true);
});

test('bridge uses bundled node with literal Unicode/spaced paths and strict JSON errors',native,async()=>{
 await fs.mkdir(path.join(root,'runtime','node'),{recursive:true});await fs.copyFile(process.execPath,path.join(root,'runtime','node','node.exe'));
 const stub=path.join(root,'packaging','desktop-host.mjs'),log=path.join(root,'bridge-calls.json');
 await fs.writeFile(stub,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),language:process.env.WORKBENCH_LAUNCHER_LANGUAGE}));console.log(JSON.stringify({ok:true,state:'stopped',dataDir:'synthetic'}));`);
 assert.equal((await invoke('bridge',root,'--inspect')).value.state,'stopped');
 const call=JSON.parse(await fs.readFile(log,'utf8'));assert.deepEqual(call.args,['--inspect','--home',root]);assert.equal(call.cwd,root);assert.equal(call.language,'en');
 await fs.writeFile(stub,`console.log(JSON.stringify({ok:false,error:{code:'INSTANCE_UNVERIFIED',message:'synthetic only'}}));process.exitCode=1;`);
 assert.equal((await invoke('bridge',root,'--stop')).code,'INSTANCE_UNVERIFIED');
 await fs.writeFile(stub,`console.log('unexpected log');console.log(JSON.stringify({ok:true}));`);
 assert.equal((await invoke('bridge',root,'--inspect')).code,'INVALID_HOST_RESPONSE');
});

test('installer no-instance exit and diagnostics never call the host or create a service',native,async()=>{
 const log=path.join(root,'forbidden-host.log');await fs.writeFile(path.join(root,'packaging','desktop-host.mjs'),`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(log)},'unexpected command');`);
 const env={...process.env,DEMO_DATA_DIR:path.join(root,'never-created-business-data')};
 await execute(built.executable,['--exit-for-install'],{windowsHide:true,env});
 await execute(built.executable,['--exit-for-install','--home',path.join(root,'old incomplete installation')],{windowsHide:true,env});
 const diagnostic=path.join(root,'diagnostics.json');await execute(built.executable,['--diagnostics',diagnostic],{windowsHide:true,env});
 const value=JSON.parse(await fs.readFile(diagnostic,'utf8'));assert.equal(value.architecture,'x64');assert.equal(value.dataDir,env.DEMO_DATA_DIR);assert.equal(typeof value.runtimeAvailable,'boolean');
 assert.equal(existsSync(log),false);assert.equal(existsSync(env.DEMO_DATA_DIR),false);
 await assert.rejects(execute(built.executable,['--invalid'],{windowsHide:true,env}),error=>error.code===5);
});

test('R41 desktop missing-core detection works without Java or Node; repair accepts only exact installer hash',native,async()=>{
 const incomplete=path.join(root,'incomplete'),missing=(await invoke('missing',incomplete)).value;
 for(const file of ['runtime/java/bin/server/jvm.dll','runtime/java/lib/modules','runtime/node/node.exe'])assert.ok(missing.includes(file));
 const exe=path.join(root,'synthetic-installer.exe');await fs.writeFile(exe,'synthetic executable bytes');const hash=sha256(await fs.readFile(exe));
 assert.equal((await invoke('installer',exe,hash)).value,true);await fs.appendFile(exe,'changed');assert.equal((await invoke('installer',exe,hash)).value,false);
});
