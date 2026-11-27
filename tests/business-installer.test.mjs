import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';

test('business installer is a separate per-user x64 product and preserves user data',async()=>{
 const url=new URL('../packaging/business-setup.iss',import.meta.url);assert.ok(existsSync(url),'缺少完整业务安装脚本');
 const source=await fs.readFile(url,'utf8');
 assert.match(source,/AppId=\{\{92F2894F-E647-4F16-9F59-CFB5A52C573C\}/);
 for(const contract of ['PrivilegesRequired=lowest','MinVersion=10.0','ArchitecturesAllowed=x64compatible','DiskSpanning=no','DisableDirPage=no','CloseApplications=no'])assert.ok(source.includes(contract),contract);
 assert.match(source,/D:\\MSSQualityWorkbench/);assert.match(source,/\{localappdata\}\\Programs\\MSSQualityWorkbench/);
 assert.match(source,/ResultCode\s*<>\s*0/);assert.match(source,/ewWaitUntilTerminated/);
 const uninstall=source.split('[UninstallRun]')[1].split('[Code]')[0];
 assert.match(uninstall,/runtime\\node\\node\.exe/);assert.match(uninstall,/portable-launch\.mjs/);assert.match(uninstall,/--stop/);
 assert.match(uninstall,/--stop-installation/);assert.match(source,/ScriptPath \+ '\" --stop-installation --home/);
 assert.doesNotMatch(uninstall,/停止会话质检工作台\.exe|MessageBox/);
 assert.doesNotMatch(source,/UninstallDelete|taskkill|powershell|ExecutionPolicy|演示版|BCC52644/i);
});

test('installer builder stages complete Spring AI payload directly and never invokes legacy installer',async()=>{
 const url=new URL('../packaging/build-installer.mjs',import.meta.url);assert.ok(existsSync(url),'缺少完整安装包构建入口');
 const source=await fs.readFile(url,'utf8');
 assert.match(source,/buildPortable/);assert.match(source,/archive:\s*false/);assert.match(source,/split:\s*false/);
 assert.match(source,/business-setup\.iss/);assert.match(source,/windowsHide:\s*true/);
 assert.match(source,/TEMP:\s*compilerTemp/);assert.match(source,/TMP:\s*compilerTemp/);
 assert.doesNotMatch(source,/from ['"]\.\/build\.mjs/);
});
