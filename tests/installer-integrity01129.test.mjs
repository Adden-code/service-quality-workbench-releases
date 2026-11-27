import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeInstallerIntegrity} from '../packaging/installer-integrity.mjs';
import {boundedOutput,saveStartupFailure,readStartupFailure} from '../packaging/startup-diagnostics.mjs';
const base=path.resolve('outputs/service01129-20261127/unit');
async function fixture(t){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'integrity-'));t.after(async()=>{assert.ok(root.startsWith(base+path.sep));await fs.rm(root,{recursive:true,force:true});});return root;}
test('installer verifier covers manifest and every payload file; only language is validated by value',async t=>{
 const root=await fixture(t),files=[{path:'runtime/java/lib/modules',sha256:'a'.repeat(64)},{path:'desktop-language.ini',sha256:'b'.repeat(64)},{path:"docs/owner's guide.txt",sha256:'c'.repeat(64)}];
 const content=JSON.stringify({schemaVersion:1,files});await fs.writeFile(path.join(root,'文件校验清单.json'),content);
 const out=path.join(root,'check.iss'),info=await writeInstallerIntegrity(root,out),code=await fs.readFile(out,'utf8');
 assert.equal(info.files,4);assert.equal((code.match(/CheckInstalledFile\(/g)||[]).length,3);assert.match(code,/CheckInstalledLanguage;/);assert.match(code,/owner''s guide/);assert.ok(code.includes(createHash('sha256').update(content).digest('hex')));
});
test('installer rejects path traversal and duplicate expectations',async t=>{
 const root=await fixture(t);for(const files of [[{path:'../secret',sha256:'a'.repeat(64)}],[{path:'one',sha256:'a'.repeat(64)},{path:'ONE',sha256:'a'.repeat(64)}]]){
  await fs.writeFile(path.join(root,'文件校验清单.json'),JSON.stringify({schemaVersion:1,files}));await assert.rejects(writeInstallerIntegrity(root,path.join(root,'out.iss')),/Unsafe|duplicate/);
 }
});
test('startup diagnostics are attempt-scoped and never consume a different attempt',async t=>{
 const root=await fixture(t),config={logsDir:root,rootDir:root,appPort:4186,workerPort:4192},a='a'.repeat(32),b='b'.repeat(32);
 await saveStartupFailure(config,a,{code:'WORKER_EXIT',message:'Java exited',details:{exitCode:7}});
 assert.equal(await readStartupFailure(config,b),null);const result=await readStartupFailure(config,a);assert.equal(result.details.exitCode,7);assert.equal(await readStartupFailure(config,a),null);
});
test('startup output is bounded and strips known secrets and credential assignments',()=>{
 const sink=boundedOutput({MODEL_PASSWORD:'synthetic-password',WORKBENCH_BRIDGE_TOKEN:'my-bridge-token'});
 sink.append('x'.repeat(50000));sink.append('\nMissing jvm.dll synthetic-password my-bridge-token\napi_key=synthetic-key Authorization: Bearer abc-secret\n');
 const value=sink.value();assert.ok(value.length<=4096);assert.match(value,/Missing jvm.dll/);assert.doesNotMatch(value,/synthetic-password|my-bridge-token|synthetic-key|abc-secret/);
});
