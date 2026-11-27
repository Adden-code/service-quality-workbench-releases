import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildPortable} from './build-portable.mjs';
import {productVersion,businessAppId} from './version.mjs';
import {parseFactoryBuildArgs} from './factory-resources.mjs';
import {requireEnglishReleaseGate} from './english-release-gate.mjs';
import {writeInstallerIntegrity} from './installer-integrity.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hashFile=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};

export async function stageInstallerPayload(options={}){return buildPortable({...options,archive:false,split:false});}

export async function buildInstaller({outputDir,compiler,nodeExe,nodeLicense,javaRuntime,jarPath,catalogSeedFile,sceneSeedFile,nativePilotMaterialsFile,sourceDir=project,sampleFile,requireFactoryMaterials=false,factoryProfile='all-scenes',materialsKind='unverified',webViewSdkDir=process.env.WEBVIEW2_SDK_DIR}={}){
 const englishAcceptance=await requireEnglishReleaseGate({projectRoot:project,version:productVersion});
 if(!(await fs.stat(compiler)).isFile())throw new Error('Inno Setup编译器不存在。');
 const output=path.resolve(outputDir);await fs.mkdir(output,{recursive:false});
 const staged=await stageInstallerPayload({outputDir:path.join(output,'_stage'),nodeExe,nodeLicense,javaRuntime,jarPath,catalogSeedFile,sceneSeedFile,nativePilotMaterialsFile,sourceDir,sampleFile,requireFactoryMaterials,factoryProfile,materialsKind,desktopShell:true,webViewSdkDir});
 const factory=JSON.parse(await fs.readFile(path.join(staged.root,'portable-info.json'),'utf8'));
 const integrityInclude=path.join(output,'payload-integrity.iss'),installationIntegrity=await writeInstallerIntegrity(staged.root,integrityInclude);
 const compilerTemp=path.join(output,'_compiler-temp');await fs.mkdir(compilerTemp);
 let compiled;
 try{compiled=spawnSync(compiler,['/Q',`/DPayloadDir=${staged.root}`,`/DPackageOutput=${output}`,`/DProductVersion=${productVersion}`,`/DIntegrityInclude=${integrityInclude}`,path.join(project,'packaging/business-setup.iss')],{windowsHide:true,encoding:'utf8',env:{...process.env,TEMP:compilerTemp,TMP:compilerTemp}});}
 finally{await fs.rm(compilerTemp,{recursive:true,force:true});}
 if(compiled.error||compiled.status!==0)throw new Error('安装程序构建失败：'+(compiled.stderr||compiled.stdout||compiled.error?.message||compiled.status));
 const installerName=`会话质检工作台_${productVersion}_Windows_x64_完整安装包.exe`,installer=path.join(output,installerName);
 const bytes=(await fs.stat(installer)).size,sha256=await hashFile(installer);
 const info={schemaVersion:1,version:productVersion,appId:businessAppId,platform:'windows-x64',engine:'spring-ai',installer:installerName,payloadRoot:path.relative(output,staged.root).replaceAll('\\','/'),bytes,sha256,payloadBytes:staged.unpackedBytes,files:staged.files,sourceDataIncluded:false,credentialsIncluded:false,runtimes:{node:'24',java:'21'},jarSha256:await hashFile(jarPath),signed:false,language:'multilingual',languages:['en','zh-CN'],languageSource:'Inno Setup Default.isl; jrsoftware/issrc is-6_7_3 Files/Languages/Unofficial/ChineseSimplified.isl'};
 Object.assign(info,Object.fromEntries(['desktop','sourceDataIncluded','catalogSeedIncluded','sceneSeedIncluded','sceneSeedInfo','sampleIncluded','businessTaskDataIncluded','credentialsIncluded','factoryReady','factoryProfile','materialsKind','catalog','catalogInfo','sample'].map(key=>[key,factory[key]])));
 info.englishAcceptance=englishAcceptance;
 info.installationIntegrity=installationIntegrity;
 await fs.writeFile(path.join(output,'package-info.json'),JSON.stringify(info,null,2)+'\n');
 await fs.writeFile(path.join(output,'SHA256.txt'),sha256+'  '+installerName+'\n');
 await fs.copyFile(path.join(staged.root,'使用说明.txt'),path.join(output,'使用说明.txt'));
 await fs.copyFile(path.join(staged.root,'User Guide (English).txt'),path.join(output,'User Guide (English).txt'));
 await fs.copyFile(path.join(staged.root,'验收自检清单.txt'),path.join(output,'验收自检清单.txt'));
 await fs.copyFile(path.join(staged.root,'Acceptance Checklist.txt'),path.join(output,'Acceptance Checklist.txt'));
 return info;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const [outputDir,compiler,nodeExe,nodeLicense,javaRuntime,jarPath,...resourceArgs]=process.argv.slice(2);
 if(!jarPath)throw new Error('Usage: build-installer.mjs OUTPUT ISCC NODE LICENSE JAVA_RUNTIME JAR [--catalog-seed FILE] [--factory-profile new-product] [--materials-kind synthetic|unverified|approved]');
 console.log(JSON.stringify(await buildInstaller({outputDir,compiler,nodeExe,nodeLicense,javaRuntime,jarPath,...parseFactoryBuildArgs(resourceArgs)}),null,2));
}
