import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {writeBuildIdentity} from '../packaging/build-identity.mjs';
test('installer chooses bilingual desktop by default, stores initial language and closes its shell before its service',async()=>{
 const text=await fs.readFile(new URL('../packaging/business-setup.iss',import.meta.url),'utf8');
 assert.match(text,/ShowLanguageDialog=yes/);assert.match(text,/LanguageDetectionMethod=uilanguage/);
 assert.match(text,/desktop-language\.ini.*Language.*\{language\}/);assert.match(text,/\[Run\][\s\S]*?QualityWorkbench\.exe/);
 const stop=text.slice(text.indexOf('function StopOwnRuntime'),text.indexOf('function PrepareToInstall'));assert.ok(stop.indexOf('--exit-for-install')<stop.indexOf('--stop-installation'));assert.match(stop,/ResultCode <> 0/);
 assert.match(text,/Browser start \(fallback\)/);assert.match(text,/Stop Quality Workbench\.exe/);assert.doesNotMatch(text,/taskkill|UninstallDelete|powershell/i);
 const build=await fs.readFile(new URL('../packaging/build-installer.mjs',import.meta.url),'utf8');assert.match(build,/desktopShell:true/);
});
test('desktop and lifecycle payload changes alter the build fingerprint while regeneration stays stable',async t=>{
 const base=path.resolve('../outputs/service01122-20261124/build-identity-tests');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'fixture-'));
 t.after(async()=>{assert.ok(root.startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});});
 for(const dir of ['public','packaging'])await fs.mkdir(path.join(root,dir));
 await fs.writeFile(path.join(root,'QualityWorkbench.exe'),'synthetic binary 1');await fs.writeFile(path.join(root,'packaging/desktop-host.mjs'),'synthetic bridge 1');
 const options={root,sourceDir:path.resolve('.'),version:'0.11.22'},a=await writeBuildIdentity(options),same=await writeBuildIdentity(options);assert.deepEqual(a,same);
 await fs.writeFile(path.join(root,'QualityWorkbench.exe'),'synthetic binary 2');const b=await writeBuildIdentity(options);assert.notEqual(b.buildId,a.buildId);
 await fs.writeFile(path.join(root,'packaging/desktop-host.mjs'),'synthetic bridge 2');const c=await writeBuildIdentity(options);assert.notEqual(c.buildId,b.buildId);assert.equal(c.resourceFingerprint,a.resourceFingerprint);
});
