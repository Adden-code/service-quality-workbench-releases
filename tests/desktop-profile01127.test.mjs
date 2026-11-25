import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture as syntheticFixture} from './ec-target01121-fixtures.mjs';
import {createImportedTask} from '../public/domain.mjs';
import {sceneBasisForTask} from '../public/scene-configuration.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createWorkspaceRestore} from '../server/workspace-restore.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {createDiagnosticBundle} from '../server/diagnostics.mjs';

const scratch=path.resolve('../outputs/service01127-desktop-profile-tests');
const at='2026-11-25T00:00:00Z',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function box(t,storageMode='single'){
 await fs.mkdir(scratch,{recursive:true});const container=await fs.mkdtemp(path.join(scratch,'case-')),dataDir=path.join(container,'data'),f=syntheticFixture(),closers=[];
 t.after(async()=>{for(const close of closers.reverse())await close();assert.ok(path.resolve(container).startsWith(scratch+path.sep));await fs.rm(container,{recursive:true,force:true});});
 const store=await createWorkspaceStore({dataDir,storageMode,catalogSeed:f.catalog,sceneSeed:f.newSeed});
 try{
  const before=await store.read(),source=await store.putSource(Buffer.from('Synthetic original business source; never browser cache.'),'synthetic-source.txt');
  const state=createImportedTask(before.state,{name:'Synthetic frozen task',reviewer:'Synthetic reviewer',source,now:at,basisSnapshot:sceneBasisForTask(before.state,before.catalog,'新品产品咨询',at),sessions:[{id:'SYNTHETIC',scene:'新品产品咨询',startedAt:at,topic:'Synthetic topic',channel:'Synthetic',product:'Synthetic',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'Synthetic question'},{id:2,role:'客服',text:'Synthetic answer'}]}]});
  await store.save({baseRevision:before.revision,mutationId:'synthetic-profile-fixture',state,catalog:f.catalog});
 }finally{await store.close();}
 return{container,dataDir,f,closers,storageMode};
}
async function legacyProfile(dataDir,name='desktop-profile'){
 const files=new Map([[`${name}/Default/Cache/cache.bin`,Buffer.from('SYNTHETIC_WEBVIEW_CACHE_ONLY')],[`${name}/Default/.creating-browser-owned`,Buffer.from('SYNTHETIC_BROWSER_TEMP_KEEP')]]);
 for(const [relative,bytes] of files){const file=path.join(dataDir,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
 return files;
}
async function unchanged(dataDir,files){for(const [relative,bytes] of files)assert.deepEqual(await fs.readFile(path.join(dataDir,relative)),bytes,relative);}
async function document(dataDir){const store=await createWorkspaceStore({dataDir});try{return await store.read();}finally{await store.close();}}
function repack(decoded,name,bytes){
 const entries=[...decoded.files,[name,bytes]],files=entries.map(([path,content])=>({path,size:content.length,sha256:sha(content)}));
 const manifest=Buffer.from(JSON.stringify({...decoded.manifest,files,fileCount:files.length,totalBytes:files.reduce((n,f)=>n+f.size,0)})),header=Buffer.alloc(12);header.write('SQWB0001');header.writeUInt32BE(manifest.length,8);
 return Buffer.concat([header,manifest,...entries.map(([,bytes])=>bytes)]);
}

for(const storageMode of ['single','sharded'])test(`backup of ${storageMode} workspace with legacy profile preserves frozen tasks, history and original source bytes`,async t=>{
 const b=await box(t,storageMode),before=await document(b.dataDir),original=decodeWorkspaceArchive((await encodeWorkspaceArchive(b.dataDir)).bytes),cache=await legacyProfile(b.dataDir);
 assert.equal(JSON.parse(await fs.readFile(path.join(b.dataDir,'workspace.json'),'utf8')).storageFormat==='task-records-v1',storageMode==='sharded');
 const {bytes,manifest}=await encodeWorkspaceArchive(b.dataDir),decoded=decodeWorkspaceArchive(bytes);
 assert.deepEqual(decoded.document.state,before.state);assert.deepEqual(decoded.document.catalog,before.catalog);assert.equal(decoded.document.revision,before.revision);assert.deepEqual(decoded.files,original.files);
 assert.ok(!manifest.files.some(f=>f.path.startsWith('desktop-profile/')));assert.equal(bytes.includes(Buffer.from('SYNTHETIC_WEBVIEW_CACHE_ONLY')),false);
 await unchanged(b.dataDir,cache);
});

test('old profile junction is skipped without following it; business links and unknown folders are still rejected',async t=>{
 const b=await box(t),outside=path.join(b.container,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'.creating-outside'),'SYNTHETIC_OUTSIDE_KEEP');
 await fs.symlink(outside,path.join(b.dataDir,'desktop-profile'),'junction');
 const backup=decodeWorkspaceArchive((await encodeWorkspaceArchive(b.dataDir)).bytes);assert.equal(backup.files.has('desktop-profile/.creating-outside'),false);
 assert.equal((await fs.lstat(path.join(b.dataDir,'desktop-profile'))).isSymbolicLink(),true);assert.equal(await fs.readFile(path.join(outside,'.creating-outside'),'utf8'),'SYNTHETIC_OUTSIDE_KEEP');
 const link=path.join(b.dataDir,'sources','unsafe');await fs.symlink(outside,link,'junction');await assert.rejects(encodeWorkspaceArchive(b.dataDir),/目录链接/);await fs.unlink(link);
 const unknown=path.join(b.dataDir,'desktop-profile-business');await fs.mkdir(unknown);await assert.rejects(encodeWorkspaceArchive(b.dataDir),/未支持的目录/);
});

test('a generated diagnostic bundle cannot block the next backup and is never restored as business data',async t=>{
 const b=await box(t),before=decodeWorkspaceArchive((await encodeWorkspaceArchive(b.dataDir)).bytes);
 const diagnostics=await createDiagnosticBundle({dataDir:b.dataDir,document:before.document,build:{version:'0.11.27'},includeTraces:true});
 const saved=await fs.readFile(diagnostics.savedPath),after=decodeWorkspaceArchive((await encodeWorkspaceArchive(b.dataDir)).bytes);
 assert.deepEqual(after.files,before.files);assert.deepEqual(await fs.readFile(diagnostics.savedPath),saved);
 for(const name of ['desktop-profile/Default/Cache/a','diagnostics/diagnostics.zip'])assert.throws(()=>decodeWorkspaceArchive(repack(after,name,Buffer.from('SYNTHETIC_INCOMING_CACHE'))),/不支持/);
});

test('restore into an old-profile workspace retains its cache and diagnostic output in place and preserves rollback business data',async t=>{
 const b=await box(t),before=await document(b.dataDir),incoming=decodeWorkspaceArchive((await encodeWorkspaceArchive(b.dataDir)).bytes),original=structuredClone(incoming.document),cache=await legacyProfile(b.dataDir);
 const report=await createDiagnosticBundle({dataDir:b.dataDir,document:before,build:{version:'0.11.27'}}),reportBytes=await fs.readFile(report.savedPath);
 incoming.document.state.tasks[0].name='Synthetic restored task';const revised=Buffer.from(JSON.stringify(incoming.document));incoming.files.set('workspace.json',revised);
 const manager=await createWorkspaceRestore({dataDir:b.dataDir});b.closers.push(()=>manager.close());let store=await createWorkspaceStore({dataDir:b.dataDir});b.closers.push(()=>store?.close());
 const staged=await manager.preflight(incoming),result=await manager.apply({staged,baseRevision:before.revision,closeServices:async()=>{await store.close();store=null;},openServices:async()=>{store=await createWorkspaceStore({dataDir:b.dataDir});}});
 assert.equal((await store.read()).state.tasks[0].name,'Synthetic restored task');await unchanged(b.dataDir,cache);assert.deepEqual(await fs.readFile(report.savedPath),reportBytes);
 const rollback=decodeWorkspaceArchive((await manager.readRetained(result.backupId)).bytes);assert.deepEqual(rollback.document,original);assert.ok([...rollback.files.keys()].every(name=>!name.startsWith('desktop-profile/')&&!name.startsWith('diagnostics/')));
});

for(const mode of ['directory','junction'])test(`startup with legacy profile ${mode} upgrades a changed seed without touching browser-owned entries`,async t=>{
 const b=await box(t),before=await document(b.dataDir),business=decodeWorkspaceArchive((await encodeWorkspaceArchive(b.dataDir)).bytes);let cache,outside;
 if(mode==='directory')cache=await legacyProfile(b.dataDir);
 else{outside=path.join(b.container,'external-profile');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'.creating-outside'),'SYNTHETIC_OUTSIDE_KEEP');await fs.symlink(outside,path.join(b.dataDir,'desktop-profile'),'junction');}
 const diagnostics=await createDiagnosticBundle({dataDir:b.dataDir,document:before,build:{version:'0.11.27'}}),diagnosticBytes=await fs.readFile(diagnostics.savedPath);
 const next=structuredClone(b.f.newSeed);next.id='synthetic-profile-upgrade';next.packages[1].template.sections[0].title='Synthetic changed bundled section';
 const server=await createWorkbenchServer({dataDir:b.dataDir,catalogSeed:b.f.catalog,sceneSeed:next,arkClient:{complete:async()=>{throw new Error('No model calls permitted in profile regression');}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));b.closers.push(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const snapshot=await(await fetch(`http://127.0.0.1:${server.address().port}/api/workspace`)).json(),upgrade=snapshot.builtinUpgrade;
 assert.equal(upgrade.status,'upgraded',JSON.stringify(upgrade));assert.equal(upgrade.recovery.status,'clean');assert.deepEqual(upgrade.recovery.cleaned,[]);assert.deepEqual(upgrade.recovery.refused,[]);
 const backup=decodeWorkspaceArchive(await fs.readFile(upgrade.backupPath));assert.deepEqual(backup.files,business.files);
 assert.deepEqual(snapshot.state.tasks,before.state.tasks);assert.deepEqual(snapshot.state.sessions,before.state.sessions);assert.deepEqual(snapshot.state.sceneConfigurationEvents.slice(0,before.state.sceneConfigurationEvents.length),before.state.sceneConfigurationEvents);
 assert.ok(snapshot.state.sceneConfigurationEvents.some(event=>event.action==='system-upgrade'&&event.seedId===next.id));
 if(cache)await unchanged(b.dataDir,cache);else{assert.equal(await fs.readFile(path.join(outside,'.creating-outside'),'utf8'),'SYNTHETIC_OUTSIDE_KEEP');assert.equal((await fs.lstat(path.join(b.dataDir,'desktop-profile'))).isSymbolicLink(),true);}
 assert.deepEqual(await fs.readFile(diagnostics.savedPath),diagnosticBytes);
});
