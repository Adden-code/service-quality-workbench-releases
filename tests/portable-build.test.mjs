import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const moduleUrl=new URL('../packaging/build-portable.mjs',import.meta.url);
test('portable allowlist includes only required runtime modules with no developer startup scripts',async()=>{
 assert.ok(existsSync(moduleUrl),'缺少便携打包模块');const{portableFiles,portableModules}=await import(moduleUrl);
 for(const name of ['server.mjs','server/ecommerce-engine.mjs','server/ecommerce-comparison.mjs','server/ecommerce-comparison-wire.mjs','server/workflow-traces.mjs','server/spring-ai-bridge.mjs','packaging/portable-runtime.mjs','packaging/portable-launch.mjs','packaging/version.mjs'])assert.ok(portableFiles.includes(name),`缺少运行模块 ${name}`);
 assert.ok(!portableFiles.some(p=>/data\/|\.secrets|\.env|node_modules|tests\/|docs\/|start-spring-ai\.ps1|launch-demo/.test(p)));
 assert.ok(portableModules.includes('java.se'));assert.ok(portableModules.includes('jdk.crypto.ec'));
});

test('business package product version is shared without changing the control schema',async()=>{
 const packageJson=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
 const {portableVersion}=await import(moduleUrl);
 assert.equal(packageJson.version,'0.11.19');assert.equal(portableVersion,packageJson.version);
 const versionUrl=new URL('../packaging/version.mjs',import.meta.url);
 assert.ok(existsSync(versionUrl),'产品版本应有共享来源');
 const {productVersion}=await import(versionUrl);assert.equal(productVersion,packageJson.version);
});

test('every local server dependency is in the portable allowlist',async()=>{
 const {portableFiles}=await import(moduleUrl);
 const project=fileURLToPath(new URL('..',import.meta.url));
 for(const rel of portableFiles.filter(value=>value.endsWith('.mjs'))){
  const source=await fs.readFile(path.join(project,rel),'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
   const target=path.relative(project,path.resolve(project,path.dirname(rel),match[1])).replaceAll('\\','/');
   assert.ok(target.startsWith('public/')||portableFiles.includes(target),`${rel} 缺少依赖 ${target}`);
  }
 }
});

test('stage-only build creates complete manifest without a ZIP or transfer parts',async t=>{
 const {buildPortable}=await import(moduleUrl);
 const base='D:/Codex project/outputs/service-installer-tests';await fs.mkdir(base,{recursive:true});
 const temporary=await fs.mkdtemp(path.join(base,'stage-'));const outputDir=path.join(temporary,'output');
 t.after(async()=>{assert.ok(path.resolve(temporary).startsWith(path.resolve(base)+path.sep));await fs.rm(temporary,{recursive:true,force:true});});
 const javaRuntime=path.join(temporary,'java');await fs.mkdir(path.join(javaRuntime,'bin'),{recursive:true});
 const nodeExe=path.join(temporary,'node.exe'),nodeLicense=path.join(temporary,'LICENSE.txt'),jarPath=path.join(temporary,'worker.jar');
 for(const file of [nodeExe,nodeLicense,jarPath,path.join(javaRuntime,'bin/java.exe')])await fs.writeFile(file,'fixture runtime only');
 const info=await buildPortable({outputDir,nodeExe,nodeLicense,javaRuntime,jarPath,archive:false,split:false});
 assert.equal(info.archive,null);assert.equal(info.parts,undefined);
 assert.deepEqual((await fs.readdir(outputDir)).sort(),['package-info.json','会话质检工作台'].sort());
 const metadata=JSON.parse(await fs.readFile(path.join(info.root,'portable-info.json'),'utf8'));
 assert.equal(metadata.version,'0.11.19');assert.equal(metadata.schemaVersion,1);assert.equal(metadata.sourceDataIncluded,false);assert.equal(metadata.credentialsIncluded,false);
 const manifest=JSON.parse(await fs.readFile(path.join(info.root,'文件校验清单.json'),'utf8'));
 assert.equal(manifest.version,'0.11.19');assert.equal(manifest.schemaVersion,1);
 const build=JSON.parse(await fs.readFile(path.join(info.root,'packaging/build-identity.json'),'utf8'));
 assert.equal(build.version,metadata.version);assert.match(build.buildId,/^0\.11\.19-[a-f0-9]{16}$/);assert.match(build.sourceCommit,/^[a-f0-9]{40}$/);
 assert.match(await fs.readFile(path.join(info.root,'public/build-identity.mjs'),'utf8'),new RegExp(build.buildId));
 assert.ok(manifest.files.some(file=>file.path==='packaging/build-identity.json'));
 assert.ok(manifest.files.some(file=>file.path==='server/ecommerce-comparison.mjs'));
 assert.ok(manifest.files.some(file=>file.path==='server/ecommerce-comparison-wire.mjs'));
 assert.ok(manifest.files.some(file=>file.path==='public/ecommerce-columns.mjs'));
 assert.ok(!manifest.files.some(file=>/^data\/|^tests\/|\.secrets|\.env|ecommerce-sample\.mjs/.test(file.path)));
 const guide=await fs.readFile(path.join(info.root,'使用说明.txt'),'utf8');
 assert.doesNotMatch(guide,/虚构|样例|演示|分卷/);
 for(const phrase of ['V2.1-A','时效升级','其他四项V1','日历','试算','核对','123','准确率','不含密钥','原任务'])assert.ok(guide.includes(phrase),`使用说明缺少 ${phrase}`);
 assert.match(metadata.rules,/V2.1-A/);
});
test('split and merge verify ordered parts, reject altered bytes and recover exact archive',async t=>{
 assert.ok(existsSync(moduleUrl),'缺少便携打包模块');const{splitArchive,mergeArchive}=await import(moduleUrl);
 const base='D:/Codex project/outputs/service-portable-20261031';const dir=await fs.mkdtemp(base+'/split-unit-');
 t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const content=crypto.randomBytes(301),file=path.join(dir,'虚构 archive.zip');await fs.writeFile(file,content);
 const info=await splitArchive(file,{outputDir:path.join(dir,'parts'),partBytes:100});assert.equal(info.parts.length,4);assert.ok(info.parts.every(p=>p.bytes<=100));
 const restored=path.join(dir,'restored.zip');await mergeArchive(info,{partsDir:path.join(dir,'parts'),output:restored});assert.deepEqual(await fs.readFile(restored),content);
 await fs.appendFile(path.join(dir,'parts',info.parts[0].name),'changed');await assert.rejects(mergeArchive(info,{partsDir:path.join(dir,'parts'),output:path.join(dir,'bad.zip')}),/校验|指纹|大小|hash/i);
 assert.equal(existsSync(path.join(dir,'bad.zip')),false);
});
