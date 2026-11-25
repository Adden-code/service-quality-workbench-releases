import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomInt} from 'node:crypto';
import {fixture as syntheticFixture} from './ec-target01121-fixtures.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {upgradeBuiltinOnStartup} from '../server/startup-builtin-upgrade.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {startupAuditPath,startupMaintenanceEvents} from '../server/startup-maintenance.mjs';
const root=path.resolve('../outputs/service01124-20261125/upgrade/fixtures'),clone=x=>structuredClone(x);
function seeds(){const f=syntheticFixture();return{catalogSeed:f.catalog,sceneSeed:f.newSeed};}
function updated(seed,n){const next=clone(seed);next.id=`synthetic-maintenance-${n}`;next.packages[1].template.sections[0].title=`Synthetic section revision ${n}`;return next;}
async function sandbox(t){
 await fs.mkdir(root,{recursive:true});const container=await fs.mkdtemp(path.join(root,'case-')),dataDir=path.join(container,'data');
 const close=[];t.after(async()=>{for(const fn of close.reverse())await fn();assert.ok(path.resolve(container).startsWith(root+path.sep));await fs.rm(container,{recursive:true,force:true});});
 const f=seeds(),store=await createWorkspaceStore({dataDir,...f});await store.close();return{container,dataDir,f,close};
}
async function openServer(box,options={}){
 const server=await createWorkbenchServer({dataDir:box.dataDir,...box.f,...options});
 box.close.push(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 // Windows ephemeral allocation may select a Fetch-blocked port (e.g. 10080).
 // These HTTP tests need a safe port, not a change to the product's fixed 4186.
 for(let attempt=0;;attempt++){
  try{await new Promise((resolve,reject)=>{const failed=error=>reject(error);server.once('error',failed);server.listen(randomInt(20000,60000),'127.0.0.1',()=>{server.off('error',failed);resolve();});});break;}
  catch(error){if(error.code!=='EADDRINUSE'||attempt>=20)throw error;}
 }
 const origin=`http://127.0.0.1:${server.address().port}`;return{server,origin,snapshot:await(await fetch(origin+'/api/workspace')).json()};
}
async function readAudit(box){return(await fs.readFile(startupAuditPath(box.dataDir),'utf8')).trim().split('\n').map(line=>JSON.parse(line));}
async function backups(box){return(await fs.readdir(box.container)).filter(name=>name.startsWith('data.before-auto-builtin-')&&name.endsWith('.sqwb')).sort();}
async function childReady(t,box,mode){
 const script=`import fs from 'node:fs/promises';import path from 'node:path';import {createWorkspaceRestore} from './server/workspace-restore.mjs';import {createWorkspaceStore} from './server/workspace-store.mjs';import {createWorkflowTraceStore} from './server/workflow-traces.mjs';import {createTranslationJobStore} from './server/translation-job-store.mjs';import {upgradeBuiltinOnStartup} from './server/startup-builtin-upgrade.mjs';import {startupAuditPath} from './server/startup-maintenance.mjs';import {fixture} from './tests/ec-target01121-fixtures.mjs';
 const dataDir=process.argv[1],mode=process.argv[2];
 const hang=async()=>{process.stdout.write('READY\\n');setInterval(()=>{},1000);await new Promise(()=>{});};
 if(mode.startsWith('upgrade-')){
  const f=fixture(),seed=structuredClone(f.newSeed);seed.id='synthetic-maintenance-9';seed.packages[1].template.sections[0].title='Synthetic section revision 9';const store=await createWorkspaceStore({dataDir});
  if(mode==='upgrade-commit'){const commit=store.upgradeBuiltinAutomatically;store.upgradeBuiltinAutomatically=async input=>{await commit(input);await hang();};}
  else{const open=fs.open.bind(fs);fs.open=async(file,...args)=>{const handle=await open(file,...args);if(file!==startupAuditPath(dataDir))return handle;let action;return{stat:()=>handle.stat(),writeFile:async bytes=>{action=JSON.parse(String(bytes)).action;return handle.writeFile(bytes);},sync:async()=>{await handle.sync();if(action==='upgrade-succeeded')await hang();},close:()=>handle.close()};};}
  await upgradeBuiltinOnStartup({dataDir,store,catalogSeed:f.catalog,sceneSeed:seed,productVersion:'0.11.24'});
 }
 else if(mode==='workflow'){await createWorkflowTraceStore({dataDir});await fs.writeFile(path.join(dataDir,'.creating-active'),'Synthetic active writer');}
 else if(mode==='portable'){await fs.writeFile(path.join(dataDir,'.portable-instance.lock'),JSON.stringify({pid:process.pid,nonce:'synthetic-live-portable',dataDir}));await fs.writeFile(path.join(dataDir,'.creating-active'),'Synthetic active writer');}
 else{await createWorkspaceRestore({dataDir});await createWorkspaceStore({dataDir});await createWorkflowTraceStore({dataDir});
 if(mode==='stage'){const fsOps={...fs,rename:async(from,to)=>{const value=await fs.rename(from,to);if(path.basename(to)==='snapshot.json'){process.stdout.write('READY\\n');setInterval(()=>{},1000);await new Promise(()=>{});}return value;}};const jobs=await createTranslationJobStore({dataDir,fsOps});await jobs.create({schemaVersion:1,id:'UI-REASON-Synthetic',units:[]},{schemaVersion:1,fields:[{id:'Synthetic',text:'Synthetic interrupted translation'}]});}
 else await fs.writeFile(path.join(dataDir,'.creating-active'),'Synthetic active writer');}
 process.stdout.write('READY\\n');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,box.dataDir,mode],{cwd:path.resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
 const stopped=once(child,'exit');let exited=false;stopped.then(()=>exited=true);const stop=async()=>{if(!exited){child.kill('SIGKILL');await stopped;}};box.close.push(stop);
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error(`Child did not become ready: ${stderr}`)),15000);child.stdout.on('data',b=>{output+=b;if(output.includes('READY')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);if(!output.includes('READY'))reject(Error(`Child exited ${code}: ${stderr}`));});});
 return{child,stop};
}

test('killing the real translation store mid-create quarantines its staging directory before auto-upgrade backup and exposes bounded audit',async t=>{
 const box=await sandbox(t),writer=await childReady(t,box,'stage'),names=await fs.readdir(path.join(box.dataDir,'content-translations'));assert.equal(names.length,1);assert.match(names[0],/^\.creating-UI-REASON-Synthetic-/);const original=await fs.readFile(path.join(box.dataDir,'content-translations',names[0],'snapshot.json'));
 await writer.stop();const {snapshot}=await openServer(box,{sceneSeed:updated(box.f.sceneSeed,1)}),result=snapshot.builtinUpgrade;
 assert.equal(result.status,'upgraded',JSON.stringify(result));assert.equal(result.recovery.status,'recovered');assert.deepEqual(result.recovery.cleaned,[`content-translations/${names[0]}`]);assert.equal(result.recovery.quarantined.length,1);assert.deepEqual(await fs.readFile(path.join(result.recovery.quarantined[0].quarantinePath,'snapshot.json')),original);assert.ok(path.resolve(result.recovery.quarantined[0].quarantinePath).startsWith(box.dataDir+'.startup-recovery-'));
 assert.deepEqual(await fs.readdir(path.join(box.dataDir,'content-translations')),[]);assert.ok(decodeWorkspaceArchive(await fs.readFile(result.backupPath)).document.state);assert.match(result.message,/自动清理或隔离/);
 const events=await readAudit(box),cleanup=events.findIndex(e=>e.action==='cleanup-quarantined'),backup=events.findIndex(e=>e.action==='backup-created');assert.ok(cleanup>=0&&backup>cleanup);assert.ok(result.maintenanceEvents.some(e=>e.action==='cleanup-quarantined'&&e.path.startsWith('content-translations/')));assert.ok(result.maintenanceEvents.length<=30);assert.doesNotMatch(JSON.stringify(result.maintenanceEvents),/interrupted translation|fields|schemaVersion/);
 await fs.writeFile(path.join(path.dirname(root),'kill-recovery-evidence.json'),JSON.stringify({syntheticOnly:true,scenario:'Real createTranslationJobStore killed after snapshot atomic rename; restart quarantined stage before backup and upgrade',originalBytesPreserved:true,fixtureRemovedAfterTest:true,result,audit:events},null,2));
});

test('killed process regular creating file is removed once, leaves sources unchanged and is not removed by a second live instance',async t=>{
 const box=await sandbox(t),original=await fs.readFile(path.join(box.dataDir,'workspace.json')),writer=await childReady(t,box,'regular');
 await assert.rejects(createWorkbenchServer({dataDir:box.dataDir,...box.f}),/运行进程/);assert.equal(await fs.readFile(path.join(box.dataDir,'.creating-active'),'utf8'),'Synthetic active writer');assert.deepEqual(await fs.readFile(path.join(box.dataDir,'workspace.json')),original);
 await writer.stop();const {snapshot}=await openServer(box);assert.equal(snapshot.builtinUpgrade.status,'current');assert.deepEqual(snapshot.builtinUpgrade.recovery.cleaned,['.creating-active']);await assert.rejects(fs.stat(path.join(box.dataDir,'.creating-active')),{code:'ENOENT'});assert.ok((await readAudit(box)).some(e=>e.action==='startup-refused'));assert.ok((await readAudit(box)).some(e=>e.action==='cleanup-removed'&&e.path==='.creating-active'));
});

for(const mode of ['workflow','portable'])test(`real live ${mode} lock protects existing creating files`,async t=>{
 const box=await sandbox(t),writer=await childReady(t,box,mode);await assert.rejects(createWorkbenchServer({dataDir:box.dataDir,...box.f}),/写入进程|运行实例/);assert.equal(await fs.readFile(path.join(box.dataDir,'.creating-active'),'utf8'),'Synthetic active writer');await writer.stop();assert.ok((await readAudit(box)).some(e=>e.action==='startup-refused'));
});

for(const name of ['.workspace-control.lock','.workspace.lock','workflow-runs/.workflow.lock','.portable-instance.lock'])test(`unverifiable ${name} blocks recovery and preserves temp`,async t=>{
 const box=await sandbox(t);await fs.mkdir(path.dirname(path.join(box.dataDir,name)),{recursive:true});await fs.writeFile(path.join(box.dataDir,name),'Synthetic corrupt owner');await fs.writeFile(path.join(box.dataDir,'.creating-retained'),'Synthetic temp');
 await assert.rejects(createWorkbenchServer({dataDir:box.dataDir,...box.f}),/锁|写入进程/);assert.equal(await fs.readFile(path.join(box.dataDir,'.creating-retained'),'utf8'),'Synthetic temp');assert.equal(await fs.readFile(path.join(box.dataDir,name),'utf8'),'Synthetic corrupt owner');assert.ok((await readAudit(box)).some(e=>e.action==='startup-refused'));
});

test('unknown staging entries and corrupt final JSON remain intact and show actionable exact paths',async t=>{
 const box=await sandbox(t),a='report-jobs/.creating-Synthetic-a1b2c3d4a1b2c3d4',b='content-translations/.creating-Synthetic-b1b2c3d4a1b2c3d4';
 await fs.mkdir(path.join(box.dataDir,a),{recursive:true});await fs.writeFile(path.join(box.dataDir,a,'original.txt'),'Synthetic user original');await fs.mkdir(path.join(box.dataDir,b),{recursive:true});await fs.writeFile(path.join(box.dataDir,b,'snapshot.json'),'{corrupt');
 const {snapshot}=await openServer(box,{sceneSeed:updated(box.f.sceneSeed,2)}),upgrade=snapshot.builtinUpgrade;assert.equal(upgrade.status,'failed');assert.equal(upgrade.recovery.refused.length,2);assert.equal((await backups(box)).length,0);assert.ok(upgrade.message.includes(a));assert.ok(upgrade.message.includes(b));assert.match(upgrade.message,/维护人|移出工作区/);assert.equal(await fs.readFile(path.join(box.dataDir,a,'original.txt'),'utf8'),'Synthetic user original');assert.equal(await fs.readFile(path.join(box.dataDir,b,'snapshot.json'),'utf8'),'{corrupt');
});

test('staging directory with a valid snapshot and interrupted partial temp is quarantined with byte preservation',async t=>{
 const box=await sandbox(t),relative='report-jobs/.creating-Synthetic-aabbccddaabbccdd',folder=path.join(box.dataDir,relative);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'snapshot.json'),JSON.stringify({synthetic:true}));await fs.writeFile(path.join(folder,'job.json.aabbccddaabbccdd.tmp'),'{partial');
 const {snapshot}=await openServer(box),recovery=snapshot.builtinUpgrade.recovery;assert.deepEqual(recovery.cleaned,[relative]);assert.equal(await fs.readFile(path.join(recovery.quarantined[0].quarantinePath,'job.json.aabbccddaabbccdd.tmp'),'utf8'),'{partial');
});

test('junctions, hard links and unknown creating directories are preserved without traversing outside dataDir',async t=>{
 const box=await sandbox(t),outside=path.join(box.container,'outside'),unknown=path.join(box.dataDir,'.creating-unknown');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'.creating-outside'),'Synthetic outside');await fs.symlink(outside,path.join(box.dataDir,'.creating-junction'),'junction');await fs.link(path.join(outside,'.creating-outside'),path.join(box.dataDir,'.creating-hardlink'));await fs.mkdir(unknown);await fs.writeFile(path.join(unknown,'original'),'Synthetic unknown');
 const {snapshot}=await openServer(box,{sceneSeed:updated(box.f.sceneSeed,3)}),r=snapshot.builtinUpgrade.recovery;assert.equal(snapshot.builtinUpgrade.status,'failed');assert.equal(r.cleaned.length,0);assert.equal(r.refused.length,3);assert.equal(await fs.readFile(path.join(outside,'.creating-outside'),'utf8'),'Synthetic outside');assert.equal(await fs.readFile(path.join(unknown,'original'),'utf8'),'Synthetic unknown');assert.equal((await fs.lstat(path.join(box.dataDir,'.creating-junction'))).isSymbolicLink(),true);
});

test('staging child junction is never followed or quarantined',async t=>{
 const box=await sandbox(t),outside=path.join(box.container,'outside'),folder=path.join(box.dataDir,'content-translations','.creating-Synthetic-aabbccddaabbccdd');await fs.mkdir(outside);await fs.mkdir(folder,{recursive:true});await fs.symlink(outside,path.join(folder,'snapshot.json'),'junction');
 const {snapshot}=await openServer(box,{sceneSeed:updated(box.f.sceneSeed,4)});assert.equal(snapshot.builtinUpgrade.status,'failed');assert.equal(snapshot.builtinUpgrade.recovery.quarantined.length,0);assert.equal((await fs.lstat(path.join(folder,'snapshot.json'))).isSymbolicLink(),true);
});

test('damaged workspace and unsafe audit target never trigger temp deletion',async t=>{
 const broken=await sandbox(t);await fs.writeFile(path.join(broken.dataDir,'workspace.json'),'{Synthetic damaged');await fs.writeFile(path.join(broken.dataDir,'.creating-keep'),'Synthetic temp');await assert.rejects(createWorkbenchServer({dataDir:broken.dataDir,...broken.f}),/损坏/);assert.equal(await fs.readFile(path.join(broken.dataDir,'.creating-keep'),'utf8'),'Synthetic temp');assert.equal(await fs.readFile(path.join(broken.dataDir,'workspace.json'),'utf8'),'{Synthetic damaged');
 const unsafe=await sandbox(t),outside=path.join(unsafe.container,'audit-original');await fs.writeFile(outside,'Synthetic outside audit');await fs.mkdir(path.dirname(startupAuditPath(unsafe.dataDir)),{recursive:true});await fs.link(outside,startupAuditPath(unsafe.dataDir));await fs.writeFile(path.join(unsafe.dataDir,'.creating-keep'),'Synthetic temp');const {snapshot}=await openServer(unsafe);assert.equal(snapshot.builtinUpgrade.status,'current');assert.equal(snapshot.builtinUpgrade.recovery.status,'attention');assert.equal(await fs.readFile(path.join(unsafe.dataDir,'.creating-keep'),'utf8'),'Synthetic temp');assert.equal(await fs.readFile(outside,'utf8'),'Synthetic outside audit');
});

test('four successful upgrades retain newest two auto snapshots and preserve every manually named backup',async t=>{
 const box=await sandbox(t),store=await createWorkspaceStore({dataDir:box.dataDir});box.close.push(()=>store.close());const bytes=(await encodeWorkspaceArchive(box.dataDir)).bytes,manuals=['manual.sqwb','data.before-builtin-user.sqwb','data-before-restore-Synthetic.sqwb','other.before-auto-builtin-2026-01-01T00-00-00-000Z-aabbccdd.sqwb'];for(const name of manuals)await fs.writeFile(path.join(box.container,name),bytes);
 const results=[];for(let i=1;i<=4;i++){const result=await upgradeBuiltinOnStartup({dataDir:box.dataDir,store,catalogSeed:box.f.catalogSeed,sceneSeed:updated(box.f.sceneSeed,i),productVersion:`0.11.${23+i}`});assert.equal(result.status,'upgraded',JSON.stringify(result));results.push(result);}
 assert.deepEqual((await backups(box)).sort(),results.slice(-2).map(r=>path.basename(r.backupPath)).sort());assert.equal(results.at(-1).retention.pruned.length,1);for(const name of manuals)assert.deepEqual(await fs.readFile(path.join(box.container,name)),bytes);assert.equal((await readAudit(box)).filter(e=>e.action==='backup-pruned').length,2);
});

test('successful upgrade adopts valid 0.11.23-style snapshots with same immutable workspace history and prunes to two',async t=>{
 const box=await sandbox(t),store=await createWorkspaceStore({dataDir:box.dataDir});box.close.push(()=>store.close());const legacy=[];
 for(let n=1;n<=3;n++){const {bytes,manifest}=await encodeWorkspaceArchive(box.dataDir,{appVersion:'0.11.23'}),name=`${box.dataDir}.before-auto-builtin-${manifest.createdAt.replace(/[:.]/g,'-')}-${String(n).padStart(8,'0')}.sqwb`;await fs.writeFile(name,bytes);legacy.push(name);}
 const result=await upgradeBuiltinOnStartup({dataDir:box.dataDir,store,catalogSeed:box.f.catalogSeed,sceneSeed:updated(box.f.sceneSeed,5),productVersion:'0.11.24'});assert.equal(result.status,'upgraded',JSON.stringify(result));assert.equal(result.retention.adopted.length,3,JSON.stringify(result.retention));assert.equal(result.retention.pruned.length,2);assert.equal((await backups(box)).length,2);assert.ok((await readAudit(box)).some(e=>e.action==='backup-legacy-adopted'));
});

test('failed upgrade preserves all snapshots; subsequent success can retire its old automatic safety copy',async t=>{
 const box=await sandbox(t),store=await createWorkspaceStore({dataDir:box.dataDir});box.close.push(()=>store.close());const call=(n,other={})=>upgradeBuiltinOnStartup({dataDir:box.dataDir,store,catalogSeed:box.f.catalogSeed,sceneSeed:updated(box.f.sceneSeed,n),productVersion:`0.11.${30+n}`,...other});
 await call(1);await call(2);const failStore={...store,upgradeBuiltinAutomatically:async()=>{throw Error('Synthetic failed commit');}},failed=await call(3,{store:failStore});assert.equal(failed.status,'failed');assert.equal((await backups(box)).length,3);assert.ok(decodeWorkspaceArchive(await fs.readFile(failed.backupPath)).document);assert.equal((await readAudit(box)).filter(e=>e.action==='backup-pruned').length,0);
 await call(3);assert.equal((await backups(box)).length,2);await call(4);assert.equal((await backups(box)).length,2);await assert.rejects(fs.stat(failed.backupPath),{code:'ENOENT'});
});

test('corrupt archives, linked archives and unrelated workspace ancestry remain outside retention with explicit warnings',async t=>{
 const box=await sandbox(t),other=await sandbox(t),store=await createWorkspaceStore({dataDir:box.dataDir});box.close.push(()=>store.close());const otherStore=await createWorkspaceStore({dataDir:other.dataDir});await otherStore.close();const foreign=await encodeWorkspaceArchive(other.dataDir),stamp=foreign.manifest.createdAt.replace(/[:.]/g,'-'),corrupt=box.dataDir+`.before-auto-builtin-${stamp}-00000001.sqwb`,unrelated=box.dataDir+`.before-auto-builtin-${stamp}-00000002.sqwb`,linked=box.dataDir+`.before-auto-builtin-${stamp}-00000003.sqwb`;
 const foreignRegular=box.dataDir+`.before-auto-builtin-${stamp}-00000004.sqwb`;await fs.writeFile(corrupt,'Synthetic corrupt archive');await fs.writeFile(unrelated,foreign.bytes);await fs.link(unrelated,linked);await fs.writeFile(foreignRegular,foreign.bytes);
 for(let n=1;n<=3;n++){const result=await upgradeBuiltinOnStartup({dataDir:box.dataDir,store,catalogSeed:box.f.catalogSeed,sceneSeed:updated(box.f.sceneSeed,n),productVersion:`0.12.${n}`});assert.equal(result.status,'upgraded');assert.equal(result.retention.preserved.length,4);assert.ok(result.retention.preserved.some(item=>item.path===foreignRegular&&/历史确认来源/.test(item.reason)));assert.match(result.retention.warning,/额外保留/);}
 assert.equal(await fs.readFile(corrupt,'utf8'),'Synthetic corrupt archive');assert.deepEqual(await fs.readFile(unrelated),foreign.bytes);assert.deepEqual(await fs.readFile(linked),foreign.bytes);assert.deepEqual(await fs.readFile(foreignRegular),foreign.bytes);assert.ok((await startupMaintenanceEvents(box.dataDir)).some(e=>e.action==='backup-prune-refused'));
});

test('writable dataDir starts with read-only parent; audit is local and a denied sibling backup only fails upgrade',async t=>{
 const current=await sandbox(t),changing=await sandbox(t),open=fs.open.bind(fs),write=fs.writeFile.bind(fs);let denied=0;
 const parentTarget=file=>typeof file==='string'&&[current.container,changing.container].includes(path.dirname(file));
 t.mock.method(fs,'open',async(file,...args)=>{if(parentTarget(file)&&args[0]!=='r'){denied++;throw Object.assign(Error('Synthetic parent ACL read-only'),{code:'EACCES'});}return open(file,...args);});
 t.mock.method(fs,'writeFile',async(file,...args)=>{if(parentTarget(file)){denied++;throw Object.assign(Error('Synthetic parent ACL read-only'),{code:'EACCES'});}return write(file,...args);});
 await write(path.join(current.dataDir,'.creating-Synthetic'),'Synthetic interrupted file');const a=await openServer(current);assert.equal(a.snapshot.builtinUpgrade.status,'current');assert.deepEqual(a.snapshot.builtinUpgrade.recovery.cleaned,['.creating-Synthetic']);assert.equal(a.snapshot.builtinUpgrade.auditPath,path.join(current.dataDir,'logs','startup-maintenance.jsonl'));assert.ok((await readAudit(current)).some(event=>event.action==='cleanup-removed'));
 const b=await openServer(changing,{sceneSeed:updated(changing.f.sceneSeed,10)});assert.equal(b.snapshot.builtinUpgrade.status,'failed');assert.match(b.snapshot.builtinUpgrade.detail,/parent ACL/);assert.equal((await fetch(b.origin+'/api/workspace')).status,200);assert.equal(denied,1);assert.equal((await backups(changing)).length,0);
});

test('audit EACCES keeps no-op startup usable and refuses temp mutation without deleting the original',async t=>{
 const box=await sandbox(t),open=fs.open.bind(fs);await fs.writeFile(path.join(box.dataDir,'.creating-retain'),'Synthetic original');
 t.mock.method(fs,'open',async(file,...args)=>{if(file===startupAuditPath(box.dataDir))throw Object.assign(Error('Synthetic audit EACCES'),{code:'EACCES'});return open(file,...args);});
 const {origin,snapshot}=await openServer(box);assert.equal(snapshot.builtinUpgrade.status,'current');assert.equal(snapshot.builtinUpgrade.recovery.status,'attention');assert.ok(snapshot.builtinUpgrade.recovery.refused.some(item=>item.path==='logs/startup-maintenance.jsonl'));assert.equal(await fs.readFile(path.join(box.dataDir,'.creating-retain'),'utf8'),'Synthetic original');assert.equal((await fetch(origin+'/api/workspace')).status,200);assert.equal((await backups(box)).length,0);
});

async function oldSnapshots(box,count=3){
 for(let n=1;n<=count;n++){const {bytes,manifest}=await encodeWorkspaceArchive(box.dataDir,{appVersion:'0.11.23'});await fs.writeFile(`${box.dataDir}.before-auto-builtin-${manifest.createdAt.replace(/[:.]/g,'-')}-${String(n).padStart(8,'0')}.sqwb`,bytes);}
}
for(const mode of ['upgrade-success','upgrade-commit'])test(`kill at ${mode} resumes pending retention on same-seed startup without another upgrade`,async t=>{
 const box=await sandbox(t);await oldSnapshots(box);const writer=await childReady(t,box,mode);await writer.stop();assert.equal((await backups(box)).length,4);const before=JSON.parse(await fs.readFile(path.join(box.dataDir,'workspace.json'),'utf8'));const firstAudit=await readAudit(box);assert.equal(firstAudit.some(event=>event.action==='upgrade-succeeded'),mode==='upgrade-success');assert.equal(firstAudit.some(event=>event.action==='retention-completed'),false);
 const {server,snapshot}=await openServer(box,{sceneSeed:updated(box.f.sceneSeed,9)}),result=snapshot.builtinUpgrade;assert.equal(result.status,'current',JSON.stringify(result));assert.equal(result.retention.resumed,true);assert.equal(result.retention.pruned.length,2);assert.equal((await backups(box)).length,2);assert.equal(snapshot.revision,before.revision);const audit=await readAudit(box);assert.ok(audit.some(event=>event.action==='retention-resumed'));assert.ok(audit.some(event=>event.action==='retention-completed'));if(mode==='upgrade-commit')assert.ok(audit.some(event=>event.action==='upgrade-success-recovered'));
 await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));box.close.pop();const again=await openServer(box,{sceneSeed:updated(box.f.sceneSeed,9)});assert.equal(again.snapshot.builtinUpgrade.status,'current');assert.equal(again.snapshot.builtinUpgrade.retention,undefined);assert.equal((await backups(box)).length,2);
});

test('failed commit proof never permits retention during an otherwise current startup',async t=>{
 const box=await sandbox(t);await oldSnapshots(box);const store=await createWorkspaceStore({dataDir:box.dataDir});box.close.push(()=>store.close());const failedStore={...store,upgradeBuiltinAutomatically:async()=>{throw Error('Synthetic commit was not applied');}};
 const failed=await upgradeBuiltinOnStartup({dataDir:box.dataDir,store:failedStore,catalogSeed:box.f.catalogSeed,sceneSeed:updated(box.f.sceneSeed,9),productVersion:'0.11.24'});assert.equal(failed.status,'failed');assert.equal((await backups(box)).length,4);const current=await upgradeBuiltinOnStartup({dataDir:box.dataDir,store,...box.f,productVersion:'0.11.24'});assert.equal(current.status,'current');assert.equal(current.retention,undefined);assert.equal((await backups(box)).length,4);assert.equal((await readAudit(box)).some(event=>event.action==='retention-resumed'||event.action==='backup-pruned'),false);
});

