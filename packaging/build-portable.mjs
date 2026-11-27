import {writeBuildIdentity} from './build-identity.mjs';
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import JSZip from 'jszip';
import {payloadFiles} from './build.mjs';
import {productVersion} from './version.mjs';
import {businessUsageGuide} from './business-guide.mjs';
import {englishUsageGuide} from './english-guide.mjs';
import {acceptanceChecklist} from './self-service-guide.mjs';
import {builtinUsageGuide} from './builtin-guide.mjs';
import {prepareFactoryResources,parseFactoryBuildArgs} from './factory-resources.mjs';
import {buildDesktopShell} from './build-desktop.mjs';
import {startupRecoveryGuide} from './startup-guide.mjs';
import {validateNativeReleasePayload,nativeReleaseGuide,nativePilotReleaseGuide,validateNativePilotBundle} from './native-release-gate.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const portableVersion=productVersion;
export const portableFiles=Object.freeze([...payloadFiles.filter(p=>p!=='launch-demo.mjs'),'packaging/portable-runtime.mjs','packaging/portable-launch.mjs','packaging/desktop-host.mjs','packaging/version.mjs','packaging/startup-diagnostics.mjs']);
export const portableModules=Object.freeze(['java.se','jdk.crypto.ec','jdk.crypto.mscapi','jdk.unsupported','jdk.charsets','jdk.localedata','jdk.zipfs']);
const partName=/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const shaPattern=/^[a-f0-9]{64}$/;
const hashFile=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const run=(exe,args)=>{const result=spawnSync(exe,args,{windowsHide:true,stdio:'inherit'});if(result.error||result.status!==0)throw new Error('构建命令失败：'+path.basename(exe));};
async function walk(root,relative=''){
 const found=[];for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
  const rel=path.join(relative,entry.name),file=path.join(root,rel);
  if(entry.isSymbolicLink())throw new Error('交付目录不能含目录链接：'+rel);
  if(entry.isDirectory())found.push(...await walk(root,rel));else if(entry.isFile())found.push({file,relative:rel.replaceAll('\\','/'),bytes:(await fs.stat(file)).size});else throw new Error('不支持的交付文件类型');
 }return found;
}
export async function splitArchive(file,{outputDir,partBytes=40_000_000}={}){
 if(!Number.isSafeInteger(partBytes)||partBytes<1||partBytes>40_000_000)throw new Error('分卷大小须在1至40000000字节之间。');
 const stat=await fs.stat(file);if(!stat.isFile()||stat.size<1)throw new Error('启动包文件无效。');
 await fs.mkdir(outputDir,{recursive:true});const parts=[];
 for(let start=0,index=1;start<stat.size;start+=partBytes,index++){
  const name=`startup.part${String(index).padStart(3,'0')}`,target=path.join(outputDir,name),end=Math.min(start+partBytes,stat.size)-1;
  await pipeline(createReadStream(file,{start,end}),createWriteStream(target,{flags:'wx'}));
  parts.push({name,bytes:end-start+1,sha256:await hashFile(target)});
 }
 const info={schemaVersion:1,fileName:path.basename(file),bytes:stat.size,sha256:await hashFile(file),parts};
 await fs.writeFile(path.join(outputDir,'parts-manifest.json'),JSON.stringify(info,null,2),{flag:'wx'});return info;
}
export async function mergeArchive(info,{partsDir,output}={}){
 if(info?.schemaVersion!==1||!Number.isSafeInteger(info.bytes)||info.bytes<1||!shaPattern.test(info.sha256)||!Array.isArray(info.parts)||!info.parts.length||info.parts.length>10000||new Set(info.parts.map(p=>p.name)).size!==info.parts.length||info.parts.some(p=>!partName.test(p.name)||!Number.isSafeInteger(p.bytes)||p.bytes<1||!shaPattern.test(p.sha256))||info.parts.reduce((sum,p)=>sum+p.bytes,0)!==info.bytes)throw new Error('分卷清单结构或大小无效。');
 try{await fs.access(output);throw new Error('目标文件已存在，未覆盖。');}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const p of info.parts){const file=path.join(partsDir,p.name),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==p.bytes||await hashFile(file)!==p.sha256)throw new Error('分卷大小或SHA校验失败：'+p.name);}
 const temporary=path.resolve(output)+'.partial-'+randomUUID();
 try{
  for(let i=0;i<info.parts.length;i++)await pipeline(createReadStream(path.join(partsDir,info.parts[i].name)),createWriteStream(temporary,{flags:i?'a':'wx'}));
  if((await fs.stat(temporary)).size!==info.bytes||await hashFile(temporary)!==info.sha256)throw new Error('合并后的启动包SHA校验失败。');
  await fs.link(temporary,path.resolve(output));await fs.unlink(temporary);return output;
 }catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
}
const mergeScript=String.raw`$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$info = Get-Content -LiteralPath (Join-Path $root 'parts-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($info.schemaVersion -ne 1 -or $info.bytes -lt 1 -or $info.sha256 -notmatch '^[a-f0-9]{64}$' -or !$info.parts -or $info.parts.Count -gt 10000) { throw 'Invalid parts manifest.' }
if ([IO.Path]::GetFileName($info.fileName) -ne $info.fileName -or $info.fileName -match '[/\\:]' -or !$info.fileName.EndsWith('.zip')) { throw 'Invalid archive filename.' }
$destination = Join-Path $root $info.fileName
if (Test-Path -LiteralPath $destination) {
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $info.sha256) { Write-Host 'Archive already restored and verified.'; exit 0 }
  throw 'An existing output differs. Rename it before retrying.'
}
$names = @{}
[long]$total = 0
foreach ($part in $info.parts) {
  if ($part.name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$' -or $names.ContainsKey($part.name) -or $part.bytes -lt 1 -or $part.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid part metadata.' }
  $names[$part.name] = $true
  $file = Join-Path $root $part.name
  $item = Get-Item -LiteralPath $file
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -ne $part.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $part.sha256) { throw ('Part checksum failed: ' + $part.name) }
  $total += $part.bytes
}
if ($total -ne $info.bytes) { throw 'Total bytes mismatch.' }
$temporary = $destination + '.partial-' + [Guid]::NewGuid().ToString('N')
try {
  $output = [IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { foreach ($part in $info.parts) { $inputFile = [IO.File]::OpenRead((Join-Path $root $part.name)); try { $inputFile.CopyTo($output) } finally { $inputFile.Dispose() } } } finally { $output.Dispose() }
  if ((Get-Item -LiteralPath $temporary).Length -ne $info.bytes -or (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $info.sha256) { throw 'Merged archive checksum failed.' }
  [IO.File]::Move($temporary,$destination)
  Write-Host ('Verified archive: ' + $destination)
} finally {
  if (([IO.Path]::GetFullPath($temporary)).StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary }
}
`;
function guide(){return businessUsageGuide(portableVersion);}
export async function buildPortable({outputDir,nodeExe,nodeLicense,javaRuntime,jarPath,catalogSeedFile,sceneSeedFile,nativePilotMaterialsFile,sourceDir=project,sampleFile,requireFactoryMaterials=false,factoryProfile='all-scenes',materialsKind='unverified',desktopShell=false,webViewSdkDir=process.env.WEBVIEW2_SDK_DIR,archive:makeArchive=true,split:makeSplit=true}={}){
 for(const item of [nodeExe,nodeLicense,jarPath])if(!(await fs.stat(item)).isFile())throw new Error('构建输入不是文件。');
 if(!(await fs.stat(path.join(javaRuntime,'bin/java.exe'))).isFile())throw new Error('Java运行环境缺失。');
 const output=path.resolve(outputDir);await fs.mkdir(output,{recursive:false});
 const root=path.join(output,'会话质检工作台');await fs.mkdir(root);
 const factory=await prepareFactoryResources({root,catalogSeedFile,sceneSeedFile,sourceDir,sampleFile,requireFactoryMaterials,factoryProfile,materialsKind});
 if(nativePilotMaterialsFile){const bytes=await fs.readFile(nativePilotMaterialsFile);validateNativePilotBundle(JSON.parse(bytes.toString('utf8')));await fs.mkdir(path.join(root,'resources'),{recursive:true});await fs.writeFile(path.join(root,'resources/native-pilot-materials.json'),bytes);}
 const languageGuide=nativePilotMaterialsFile?nativePilotReleaseGuide:nativeReleaseGuide;
 for(const rel of portableFiles){const target=path.join(root,rel);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(project,rel),target);}
 await walk(path.join(project,'public'));await fs.cp(path.join(project,'public'),path.join(root,'public'),{recursive:true,filter:source=>path.basename(source)!=='ecommerce-sample.mjs'});
 await fs.mkdir(path.join(root,'runtime/node'),{recursive:true});await fs.copyFile(nodeExe,path.join(root,'runtime/node/node.exe'));await fs.copyFile(nodeLicense,path.join(root,'runtime/node/LICENSE.txt'));
 await fs.cp(javaRuntime,path.join(root,'runtime/java'),{recursive:true,dereference:true});
 await fs.mkdir(path.join(root,'service'));await fs.copyFile(jarPath,path.join(root,'service/spring-ai-worker.jar'));
 const zhGuide=startupRecoveryGuide('zh')+languageGuide('zh')+(factoryProfile==='builtin-two-scenes'?builtinUsageGuide(portableVersion):guide()),enGuide=startupRecoveryGuide('en')+languageGuide('en')+(factoryProfile==='builtin-two-scenes'?builtinUsageGuide(portableVersion,'en'):englishUsageGuide(portableVersion));
 await fs.writeFile(path.join(root,'使用说明.txt'),'\uFEFF'+zhGuide,'utf8');
 await fs.writeFile(path.join(root,'User Guide (English).txt'),'\uFEFF'+enGuide,'utf8');
 await fs.writeFile(path.join(root,'Read Me First.txt'),'\uFEFF'+enGuide+'\n---\n\n'+zhGuide,'utf8');
 await fs.writeFile(path.join(root,'验收自检清单.txt'),'\uFEFF'+languageGuide('zh')+acceptanceChecklist('zh',factory),'utf8');
 await fs.writeFile(path.join(root,'Acceptance Checklist.txt'),'\uFEFF'+languageGuide('en')+acceptanceChecklist('en',factory),'utf8');
 const csc=path.join(process.env.SystemRoot||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 for(const [name,stop] of [['启动会话质检工作台.exe',false],['停止会话质检工作台.exe',true]])run(csc,['/nologo','/target:winexe','/platform:anycpu','/optimize+','/codepage:65001','/reference:System.Windows.Forms.dll',...(stop?['/define:STOP_BUILD']:[]),'/out:'+path.join(root,name),path.join(project,'packaging/PortableLauncher.cs')]);
 await fs.copyFile(path.join(root,'启动会话质检工作台.exe'),path.join(root,'Start Quality Workbench.exe'));
 await fs.copyFile(path.join(root,'停止会话质检工作台.exe'),path.join(root,'Stop Quality Workbench.exe'));
 const desktop=desktopShell?await buildDesktopShell({root,sdkDir:webViewSdkDir}):null;
 await fs.writeFile(path.join(root,'portable-info.json'),JSON.stringify({schemaVersion:1,version:portableVersion,engine:'spring-ai',modelProvider:'openai-compatible',platform:'windows-x64',rules:factoryProfile==='builtin-two-scenes'?'NP 17 entities / 16 checks + derived overall; EC criteria follow versioned scene seed and frozen task snapshot; current bundle fixed24 + same administrator >=3 at 85%; historical tasks frozen':'Sheet4 V1; V2.1-A time upgrade / four other checks V1 / configured workingHours or continuous / same agent >=3',modules:portableModules,...factory,desktop,manifestExcludes:['文件校验清单.json']},null,2));
 await writeBuildIdentity({root,sourceDir:project,version:portableVersion});
 const nativeRelease=await validateNativeReleasePayload(root,{requireLegacyCompatibility:factoryProfile==='builtin-two-scenes'&&materialsKind==='approved',requirePilot:Boolean(nativePilotMaterialsFile)});
 await fs.writeFile(path.join(root,'Native Language Release.json'),JSON.stringify(nativeRelease,null,2)+'\n');
 const files=(await walk(root)).sort((a,b)=>a.relative.localeCompare(b.relative));
 const manifest=[];for(const file of files)manifest.push({path:file.relative,bytes:file.bytes,sha256:await hashFile(file.file)});
 await fs.writeFile(path.join(root,'文件校验清单.json'),JSON.stringify({schemaVersion:1,version:portableVersion,files:manifest},null,2));
 const staged={root,archive:null,unpackedBytes:manifest.reduce((sum,f)=>sum+f.bytes,0),files:manifest.length+1,...factory,desktop};
 if(!makeArchive){await fs.writeFile(path.join(output,'package-info.json'),JSON.stringify({...staged,root:path.basename(root),version:portableVersion},null,2));return staged;}
 const archive=path.join(output,`会话质检工作台_SpringAI_${portableVersion}_完整便携包.zip`),zip=new JSZip();
 for(const file of await walk(root))zip.file(file.relative,createReadStream(file.file));
 await pipeline(zip.generateNodeStream({type:'nodebuffer',streamFiles:true,compression:'DEFLATE',compressionOptions:{level:9}}),createWriteStream(archive,{flags:'wx'}));
 const info={root,archive,bytes:(await fs.stat(archive)).size,sha256:await hashFile(archive),unpackedBytes:manifest.reduce((sum,f)=>sum+f.bytes,0),files:manifest.length+1,...factory};
 if(makeSplit&&info.bytes>49_000_000){const partsDir=path.join(output,'分卷传输');const split=await splitArchive(archive,{outputDir:partsDir});await fs.writeFile(path.join(partsDir,'merge-parts.ps1'),'\uFEFF'+mergeScript,'utf8');await fs.writeFile(path.join(partsDir,'合并分卷.cmd'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0merge-parts.ps1"\r\npause\r\n','ascii');await fs.writeFile(path.join(partsDir,'分卷说明.txt'),'\uFEFF将本目录所有文件放在同一文件夹，双击“合并分卷.cmd”。程序逐卷和整体校验SHA256后生成完整ZIP，再解压启动；分卷不能各自解压。每卷最多40000000字节。合并进程使用临时执行策略参数，不修改系统策略；企业组策略仍适用。\r\n','utf8');info.parts={directory:partsDir,count:split.parts.length,maxBytes:40_000_000};}
 await fs.writeFile(path.join(output,'package-info.json'),JSON.stringify(info,null,2));await fs.writeFile(path.join(output,'SHA256.txt'),info.sha256+'  '+path.basename(archive)+'\n');return info;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [outputDir,nodeExe,nodeLicense,javaRuntime,jarPath,...resourceArgs]=process.argv.slice(2);if(!jarPath)throw new Error('Usage: build-portable.mjs OUTPUT NODE LICENSE JAVA_RUNTIME JAR [--catalog-seed FILE] [--factory-profile new-product] [--materials-kind synthetic|unverified|approved]');
 console.log(JSON.stringify(await buildPortable({outputDir,nodeExe,nodeLicense,javaRuntime,jarPath,...parseFactoryBuildArgs(resourceArgs)}),null,2));
}
