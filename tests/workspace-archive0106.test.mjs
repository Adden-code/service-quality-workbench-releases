import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive,validateBackupPath} from '../server/workspace-archive.mjs';

const scratch=path.resolve('../outputs/service0106-20261115/archive-tests');
async function fixture(t){await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'case-')),store=await createWorkspaceStore({dataDir});t.after(async()=>{await store.close();assert.ok(dataDir.startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});await store.save({baseRevision:0,mutationId:'archive-fixture',state:createBusinessState(),catalog:createCatalog()});return {dataDir,store};}
function archive(manifest,contents){const json=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(12);header.write('SQWB0001');header.writeUInt32BE(json.length,8);return Buffer.concat([header,json,...contents]);}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('archive round trip preserves business files and excludes computer-bound controls and credentials',async t=>{
 const {dataDir}=await fixture(t);
 for(const directory of ['workflow-runs','report-jobs','raw-structure','content-translations','report-cache','translation-cache','import-drafts','backups']){await fs.mkdir(path.join(dataDir,directory),{recursive:true});await fs.writeFile(path.join(dataDir,directory,'fixture.json'),JSON.stringify({synthetic:directory}));}
 await fs.mkdir(path.join(dataDir,'.secrets'));await fs.writeFile(path.join(dataDir,'.secrets','ark-model.json'),'SYNTHETIC_SECRET_DO_NOT_EXPORT');
 await fs.mkdir(path.join(dataDir,'logs'));await fs.writeFile(path.join(dataDir,'logs','portable-startup.log'),'runtime-log');
 for(const name of ['.portable-instance.json','.portable-instance.lock','.workspace-control.lock'])await fs.writeFile(path.join(dataDir,name),'runtime-control');
 const {bytes,manifest}=await encodeWorkspaceArchive(dataDir),decoded=decodeWorkspaceArchive(bytes);
 assert.equal(manifest.fileCount,9);assert.equal(decoded.files.size,9);assert.deepEqual(decoded.files.get('workspace.json'),await fs.readFile(path.join(dataDir,'workspace.json')));assert.ok(decoded.files.has('raw-structure/fixture.json'));assert.equal(bytes.includes(Buffer.from('SYNTHETIC_SECRET_DO_NOT_EXPORT')),false);assert.equal(bytes.includes(Buffer.from('runtime-control')),false);
 for(const entry of manifest.files)assert.deepEqual(decoded.files.get(entry.path),await fs.readFile(path.join(dataDir,entry.path)));
});
test('archive rejects truncation, extra bytes, corrupted file content and malformed manifest without extraction',async t=>{
 const {dataDir}=await fixture(t),{bytes}=await encodeWorkspaceArchive(dataDir);
 for(const invalid of [bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from('extra')]),Buffer.from('not an archive')])assert.throws(()=>decodeWorkspaceArchive(invalid));
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;assert.throws(()=>decodeWorkspaceArchive(corrupt),/校验/);
 const badHeader=Buffer.from(bytes);badHeader.writeUInt32BE(0xffffffff,8);assert.throws(()=>decodeWorkspaceArchive(badHeader),/目录长度/);
});
test('archive paths reject traversal, Windows aliases, credentials, lock files and case collisions',async t=>{
 for(const name of ['../outside','sources/../../x','/absolute','sources\\x','sources/a:stream','sources/CON.txt','sources/foo.','sources/foo ','sources//a','.secrets/ark-model.json','workspace.json/a','sources/.workspace.lock'])assert.throws(()=>validateBackupPath(name),name);
 const {dataDir}=await fixture(t),{bytes}=await encodeWorkspaceArchive(dataDir),decoded=decodeWorkspaceArchive(bytes),content=decoded.files.get('workspace.json');
 const duplicate={...decoded.manifest,files:[{path:'workspace.json',size:content.length,sha256:hash(content)},{path:'sources/ABC',size:0,sha256:hash('')},{path:'sources/abc',size:0,sha256:hash('')}],fileCount:3};
 assert.throws(()=>decodeWorkspaceArchive(archive(duplicate,[content,Buffer.alloc(0),Buffer.alloc(0)])),/重复/);
 const prefix={...duplicate,files:[duplicate.files[0],{path:'sources/a',size:0,sha256:hash('')},{path:'sources/a/b',size:0,sha256:hash('')}]};
 assert.throws(()=>decodeWorkspaceArchive(archive(prefix,[content])),/路径冲突/);
});
test('archive refuses oversized declared files, invalid workspace semantics and unsupported formats',async t=>{
 const {dataDir}=await fixture(t),{bytes}=await encodeWorkspaceArchive(dataDir),decoded=decodeWorkspaceArchive(bytes),content=decoded.files.get('workspace.json');
 assert.throws(()=>decodeWorkspaceArchive(archive({...decoded.manifest,version:99},[content])),/版本/);
 const tooLarge={...decoded.manifest,files:[{...decoded.manifest.files[0],size:65*1024*1024}]};assert.throws(()=>decodeWorkspaceArchive(archive(tooLarge,[content])),/大小/);
 const invalid=Buffer.from(JSON.stringify({...decoded.document,revision:-1}));const manifest={...decoded.manifest,totalBytes:invalid.length,files:[{path:'workspace.json',size:invalid.length,sha256:hash(invalid)}]};assert.throws(()=>decodeWorkspaceArchive(archive(manifest,[invalid])),/格式/);
});
test('archive refuses unknown durable paths and linked files instead of silently producing an incomplete copy',async t=>{
 const {dataDir}=await fixture(t);await fs.writeFile(path.join(dataDir,'unknown.data'),'business-data');await assert.rejects(encodeWorkspaceArchive(dataDir),/不支持/);await fs.unlink(path.join(dataDir,'unknown.data'));
 const original=path.join(dataDir,'sources','original');await fs.writeFile(original,'synthetic');await fs.link(original,path.join(dataDir,'sources','linked'));await assert.rejects(encodeWorkspaceArchive(dataDir),/硬链接/);
});
