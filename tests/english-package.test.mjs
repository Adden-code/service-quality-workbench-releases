import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildPortable} from '../packaging/build-portable.mjs';

test('business installer offers English and Chinese without changing application identity',async()=>{
 const source=await fs.readFile(new URL('../packaging/business-setup.iss',import.meta.url),'utf8');
 assert.match(source,/Name:\s*"english";\s*MessagesFile:\s*"compiler:Default\.isl"/);
 assert.match(source,/Name:\s*"chinesesimp"/);assert.match(source,/92F2894F-E647-4F16-9F59-CFB5A52C573C/);
 assert.match(source,/User Guide \(English\)\.txt/);
 assert.match(source,/english\.OpenWorkbench=Open Quality Workbench/);
 assert.match(source,/Description: "\{cm:CreateDesktopShortcut\}"/);
 assert.match(source,/Failure := CustomMessage\('IncompleteInstallation'\)/);
});
test('native English launcher receives actionable English runtime failures without exposing unknown errors',async()=>{
 const {getConfig,safeErrorMessage}=await import('../packaging/portable-runtime.mjs');
 let failure;try{getConfig({env:{DEMO_PORT:'bad'}});}catch(error){failure=error;}
 assert.ok(failure,'invalid port must fail before any service or model request');
 assert.match(safeErrorMessage(failure,'en'),/port.*1024.*65535/i);
 assert.doesNotMatch(safeErrorMessage(failure,'en'),/\p{Script=Han}/u);
 assert.match(safeErrorMessage(failure,'zh'),/端口/);
 assert.doesNotMatch(safeErrorMessage(new Error('DO_NOT_SHOW_SECRET'),'en'),/DO_NOT_SHOW_SECRET/);
 const source=await fs.readFile(new URL('../packaging/PortableLauncher.cs',import.meta.url),'utf8');
 assert.match(source,/EnvironmentVariables\["WORKBENCH_LAUNCHER_LANGUAGE"\]/);
});
test('portable package includes readable English guide and native English start and stop aliases',async t=>{
 const base='D:/Codex project/outputs/service-english-20261105/package-tests';await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/stage-');
 t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const javaRuntime=path.join(dir,'java');await fs.mkdir(path.join(javaRuntime,'bin'),{recursive:true});
 const nodeExe=path.join(dir,'node.exe'),nodeLicense=path.join(dir,'LICENSE.txt'),jarPath=path.join(dir,'worker.jar');
 for(const p of [nodeExe,nodeLicense,jarPath,path.join(javaRuntime,'bin/java.exe')])await fs.writeFile(p,'controlled runtime placeholder');
 const info=await buildPortable({outputDir:path.join(dir,'output'),nodeExe,nodeLicense,javaRuntime,jarPath,archive:false,split:false});
 const manifest=JSON.parse(await fs.readFile(path.join(info.root,'文件校验清单.json'),'utf8'));
 for(const name of ['User Guide (English).txt','Start Quality Workbench.exe','Stop Quality Workbench.exe'])assert.ok(manifest.files.some(file=>file.path===name),name);
 const english=await fs.readFile(path.join(info.root,'User Guide (English).txt'),'utf8');
 // Source-template labels are copyable evidence, while all instructions stay English.
 const rawSchema=english.match(/\[Raw template schema\]([\s\S]*?)\[\/Raw template schema\]/)?.[1];assert.ok(rawSchema);assert.match(rawSchema,/Headers: 会话ID, 轮次序号, 发言角色, 发言方标识, 发言时间, 原文内容/);
 assert.doesNotMatch(english.replace(/\[Raw template schema\][\s\S]*?\[\/Raw template schema\]/g,''),/\p{Script=Han}/u);assert.match(english,/English/);assert.match(english,/UTC\+08:00/);assert.match(english,/original/i);
});
