import {copyFile,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
export const WEBVIEW2_SDK=Object.freeze({
 version:'1.0.4370.26',
 packageUrl:'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4370.26/microsoft.web.webview2.1.0.4370.26.nupkg',
 packageSha256:'1c0dacac84b70109b3fd42f90c53a0ba942abc3a87590d7a4e0ccd86e4a06cf4',
 files:Object.freeze([
  {source:'lib/net462/Microsoft.Web.WebView2.Core.dll',target:'Microsoft.Web.WebView2.Core.dll',sha256:'43319abb99f77a74cc7e05c987e8e3dc9029bfd95bb2bbb9eef61c4976998313'},
  {source:'lib/net462/Microsoft.Web.WebView2.WinForms.dll',target:'Microsoft.Web.WebView2.WinForms.dll',sha256:'ad7fa76950f997368c17e8cc83cbaa2e75f8f9b4e66ad793ced7db82cb66caec'},
  {source:'runtimes/win-x64/native/WebView2Loader.dll',target:'WebView2Loader.dll',sha256:'37996d81f0f3a13e93549f74f722fce25d70b00e93e4a470c34b75d7231bfd1d'},
  {source:'LICENSE.txt',target:'Microsoft.Web.WebView2.LICENSE.txt',sha256:'0af8f1b807512aae39c2ac1aa4d0cae65cabecb6fd554b8439a5162a0d6eca55'},
  {source:'NOTICE.txt',target:'Microsoft.Web.WebView2.NOTICE.txt',sha256:'106423785c5b7eba0a8e61d1837f2132e9c828e20ad530f565d981c1df60dd90'},
 ])
});
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function defaultCompiler(){return path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');}

/** Compile the x64 .NET Framework 4.6.2+ desktop host into a staged package.
 * sdkDir is the extracted, pinned NuGet package root, never a global install.
 * Does not download, launch the host, start services, or change business data.
 */
export async function buildDesktopShell({root,sdkDir=process.env.WEBVIEW2_SDK_DIR,csc=defaultCompiler()}={}){
 if(!root)throw new Error('Desktop build requires root (the staged package directory).');
 if(!sdkDir)throw new Error('Desktop build requires sdkDir or WEBVIEW2_SDK_DIR pointing to the extracted pinned WebView2 SDK.');
 root=path.resolve(root);sdkDir=path.resolve(sdkDir);
 // Validate every redistributable before writing into the staged package.
 const checked=[];
 for(const entry of WEBVIEW2_SDK.files){
  let bytes;try{bytes=await readFile(path.join(sdkDir,entry.source));}catch(error){throw new Error(`Missing WebView2 ${WEBVIEW2_SDK.version} SDK file: ${entry.source}`,{cause:error});}
  if(sha256(bytes)!==entry.sha256)throw new Error(`WebView2 SDK hash mismatch: ${entry.source}. Use the pinned official NuGet package.`);
  checked.push({...entry,bytes});
 }
 await stat(csc);
 await mkdir(path.join(root,'packaging'),{recursive:true});
 const source=path.join(here,'WorkbenchDesktop.cs'),shippedSource=path.join(root,'packaging','WorkbenchDesktop.cs');
 if(path.resolve(source)!==path.resolve(shippedSource))await copyFile(source,shippedSource);
 for(const entry of checked)await writeFile(path.join(root,entry.target),entry.bytes);
 const exe=path.join(root,'QualityWorkbench.exe');
 const manifest=path.join(root,'packaging','WorkbenchDesktop.manifest');
 await writeFile(manifest,'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><assemblyIdentity version="1.0.0.0" name="MSSQualityWorkbench.Desktop"/><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo><application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware></windowsSettings></application></assembly>\r\n');
 const args=['/nologo','/target:winexe','/platform:x64','/optimize+','/langversion:5','/utf8output',`/win32manifest:${manifest}`,`/out:${exe}`,...['System.dll','System.Core.dll','System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','System.Security.dll',...checked.filter(x=>x.target.endsWith('.dll')&&!x.target.includes('Loader')).map(x=>path.join(root,x.target))].map(value=>`/reference:${value}`),shippedSource];
 try{await execute(csc,args,{windowsHide:true,maxBuffer:1024*1024});}catch(error){throw new Error(`Desktop C# compilation failed:\n${error.stdout||''}${error.stderr||error.message}`,{cause:error});}
 await writeFile(`${exe}.config`,'<?xml version="1.0" encoding="utf-8"?>\r\n<configuration><startup useLegacyV2RuntimeActivationPolicy="true"><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.6.2"/></startup></configuration>\r\n');
 await writeFile(path.join(root,'desktop-language.ini'),'[Desktop]\r\nLanguage=auto\r\n');
 const files=['QualityWorkbench.exe','QualityWorkbench.exe.config','desktop-language.ini','packaging/WorkbenchDesktop.cs','packaging/WorkbenchDesktop.manifest',...checked.map(x=>x.target)];
 const outputs=await Promise.all(files.map(async file=>{const bytes=await readFile(path.join(root,file));return {file,size:bytes.length,sha256:sha256(bytes)};}));
 const result={executable:exe,architecture:'x64',framework:'4.6.2',sdk:{version:WEBVIEW2_SDK.version,packageUrl:WEBVIEW2_SDK.packageUrl,packageSha256:WEBVIEW2_SDK.packageSha256},files:outputs};
 await writeFile(path.join(root,'desktop-shell-manifest.json'),JSON.stringify(result,null,2)+'\n');
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){if(args[i]==='--root')options.root=args[++i];else if(args[i]==='--sdk-dir')options.sdkDir=args[++i];else throw new Error(`Unknown desktop build argument: ${args[i]}`);}
 console.log(JSON.stringify(await buildDesktopShell(options),null,2));
}
