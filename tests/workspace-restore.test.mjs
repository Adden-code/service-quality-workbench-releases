import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createWorkspaceRestore,WORKSPACE_BUSINESS_ENTRIES} from '../server/workspace-restore.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

const scratch=path.resolve('D:/Codex project/outputs/service0106-20261115/restore-tests');
const at='2026-11-15T10:00:00+08:00';
async function seed(directory,label){
 const store=await createWorkspaceStore({dataDir:directory});
 try{
  const catalog=createCatalog(),source=await store.putSource(Buffer.from(`Synthetic source ${label}`),`synthetic-${label}.txt`);
  const state=createImportedTask(createBusinessState(),{name:`Synthetic ${label}`,reviewer:'Synthetic reviewer',source,now:at,basisSnapshot:createBasisSnapshot(catalog,{ruleIds:['R004'],effectiveDate:'2026-11-15',now:at}),sessions:[{id:`SOURCE-${label}`,scene:'新品产品咨询',startedAt:at,topic:'Synthetic topic',channel:'Synthetic',product:'Synthetic',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'Synthetic question'},{id:2,role:'客服',text:'Synthetic answer'}]}]});
  await store.save({baseRevision:0,mutationId:`seed-${label}`,state,catalog});
 }finally{await store.close();}
}
async function fixture(t,options={}){
 await fs.mkdir(scratch,{recursive:true});const base=await fs.mkdtemp(path.join(scratch,'case-')),dataDir=path.join(base,'data'),sourceDir=path.join(base,'incoming');
 await seed(dataDir,'old');await seed(sourceDir,'new');
 const archive=await encodeWorkspaceArchive(sourceDir),decoded=decodeWorkspaceArchive(archive.bytes);
 let manager=await createWorkspaceRestore({dataDir,...options}),store=await createWorkspaceStore({dataDir});
 const initial=await store.read(),original=await fs.readFile(path.join(dataDir,'workspace.json'));
 t.after(async()=>{await store?.close().catch(()=>{});await manager?.close().catch(()=>{});assert.ok(path.resolve(base).startsWith(scratch+path.sep));await fs.rm(base,{recursive:true,force:true});});
 return {base,dataDir,sourceDir,decoded,initial,original,get manager(){return manager;},get store(){return store;},
  closeServices:async()=>{await store?.close();store=null;},openServices:async()=>{store=await createWorkspaceStore({dataDir});},
  async restart(){await store?.close();store=null;await manager.close();manager=await createWorkspaceRestore({dataDir});store=await createWorkspaceStore({dataDir});return store.read();},
  async apply(staged,extra={}){return manager.apply({staged,baseRevision:initial.revision,closeServices:this.closeServices,openServices:this.openServices,...extra});},
 };
}

test('restore preserves local credentials and runtime identity; returned .sqwb can restore the previous business state',async t=>{
 const f=await fixture(t),local={'.secrets/model.json':'LOCAL SECRET PLACEHOLDER','.portable-instance.json':'SYNTHETIC CONTROL','.portable-instance.lock':'SYNTHETIC LOCK','logs/test.log':'SYNTHETIC LOG'};
 for(const [name,text] of Object.entries(local)){await fs.mkdir(path.dirname(path.join(f.dataDir,name)),{recursive:true});await fs.writeFile(path.join(f.dataDir,name),text);}
 const preview=await f.manager.preflight(f.decoded);assert.equal(preview.summary.taskCount,1);
 const result=await f.apply(preview),after=await f.store.read();
 assert.equal(after.state.tasks[0].name,'Synthetic new');assert.equal(after.revision,Math.max(f.initial.revision,f.decoded.document.revision)+1);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dataDir,'workspace.json'),'utf8')).mutations,[]);
 for(const [name,text] of Object.entries(local))assert.equal(await fs.readFile(path.join(f.dataDir,name),'utf8'),text);
 assert.deepEqual(await fs.readFile(path.join(result.retainedDirectory,'workspace.json')),f.original);
 assert.equal(result.retainedPath,result.backupPath);assert.equal(path.extname(result.backupPath),'.sqwb');
 const backup=await f.manager.readRetained(result.backupId),old=decodeWorkspaceArchive(backup.bytes);
 assert.equal(old.document.state.tasks[0].name,'Synthetic old');assert.deepEqual(old.files.get('workspace.json'),f.original);
 assert.ok([...old.files.keys()].every(name=>!name.startsWith('.')&&!name.startsWith('logs/')));
 const backPreview=await f.manager.preflight(old);await f.apply(backPreview,{baseRevision:after.revision});
 assert.equal((await f.store.read()).state.tasks[0].name,'Synthetic old');assert.ok((await f.store.read()).revision>after.revision);
 await assert.rejects(f.manager.readRetained('../workspace'),/不存在/);await assert.rejects(f.manager.readRetained('0'.repeat(32)),/不存在/);
});

test('restore preflight validates structured original-source references, not only raw transcript sources',async t=>{
 const f=await fixture(t),broken={...f.decoded,files:new Map(f.decoded.files)},source=f.decoded.document.state.tasks[0].source;
 broken.files.delete(`sources/${source.sha256}`);
 await assert.rejects(f.manager.preflight(broken),/原文件|来源/);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);
 assert.deepEqual((await f.store.read()).state,f.initial.state);
});

test('a changed revision invalidates restore preview and safely reopens unchanged current services',async t=>{
 const f=await fixture(t),preview=await f.manager.preflight(f.decoded);
 await f.store.save({baseRevision:f.initial.revision,mutationId:'another-page',state:f.initial.state,catalog:f.initial.catalog});
 const before=await fs.readFile(path.join(f.dataDir,'workspace.json'));
 await assert.rejects(f.apply(preview),/预览后改变/);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),before);assert.equal((await f.store.read()).revision,f.initial.revision+1);
});

test('tampering with a staged source is rejected before any original entry moves',async t=>{
 const f=await fixture(t),preview=await f.manager.preflight(f.decoded),source=f.decoded.document.state.tasks[0].source;
 await fs.writeFile(path.join(preview.directory,'sources',source.sha256),'changed');
 await assert.rejects(f.apply(preview),/原文件|来源/);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);assert.equal((await f.store.read()).state.tasks[0].name,'Synthetic old');
});

test('lifetime control lock blocks a second manager while services are closed',async t=>{
 const f=await fixture(t);await f.closeServices();await assert.rejects(createWorkspaceRestore({dataDir:f.dataDir}),/已有运行进程/);await f.openServices();
 const lock=JSON.parse(await fs.readFile(path.join(f.dataDir,'.workspace-control.lock'),'utf8'));assert.equal(lock.pid,process.pid);
});

test('discarded or fabricated staged paths cannot be applied',async t=>{
 const f=await fixture(t),preview=await f.manager.preflight(f.decoded);await f.manager.discard(preview);
 await assert.rejects(f.apply(preview),/预览已过期/);await assert.rejects(f.apply({id:'a'.repeat(32),directory:f.dataDir}),/预览已过期/);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);
});

for(const scenario of [{point:'journal-written'},{point:'old-moved',name:'workspace.json'},{point:'old-moved',name:'sources'},{point:'new-moved',name:'workspace.json'},{point:'new-moved',name:'sources'},{point:'services-opened'}]){
 test(`ordinary failure at ${scenario.point}/${scenario.name||'all'} rolls back exact original bytes and reopens services`,async t=>{
  let triggered=false;const f=await fixture(t,{failurePoint:async(point,info)=>{if(!triggered&&point===scenario.point&&(!scenario.name||info.name===scenario.name)){triggered=true;throw new Error('Injected failure');}}});
  const preview=await f.manager.preflight(f.decoded);await assert.rejects(f.apply(preview),/Injected failure/);assert.equal(triggered,true);
  assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);assert.deepEqual((await f.store.read()).state,f.initial.state);await assert.rejects(fs.stat(path.join(f.dataDir,'.workspace-restore.json')),{code:'ENOENT'});
  const saved=await f.store.getSource(f.initial.state.tasks[0].source.sha256);assert.equal(saved.bytes.toString(),'Synthetic source old');
 });
}

for(const scenario of [{point:'journal-written'},{point:'old-moved',name:'workspace.json'},{point:'old-moved',name:'sources'},{point:'new-moved',name:'workspace.json'},{point:'new-moved',name:'sources'},{point:'services-opened'},{point:'committed'}]){
 test(`restart recovers crash after ${scenario.point}/${scenario.name||'all'} without trusting progress writes`,async t=>{
  let triggered=false;const f=await fixture(t,{failurePoint:async(point,info)=>{if(!triggered&&point===scenario.point&&(!scenario.name||info.name===scenario.name)){triggered=true;throw Object.assign(new Error('Simulated crash'),{simulateCrash:true});}}});
  const preview=await f.manager.preflight(f.decoded);await assert.rejects(f.apply(preview),/Simulated crash/);assert.equal(triggered,true);
  const recovered=await f.restart();assert.equal(recovered.state.tasks[0].name,scenario.point==='committed'?'Synthetic new':'Synthetic old');
  if(scenario.point!=='committed')assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);
  await assert.rejects(fs.stat(path.join(f.dataDir,'.workspace-restore.json')),{code:'ENOENT'});await f.store.validateIntegrity();
 });
}

test('failure to open incoming services rolls back, while a second open failure is marked fatal',async t=>{
 const f=await fixture(t),preview=await f.manager.preflight(f.decoded);let attempts=0;
 await assert.rejects(f.apply(preview,{openServices:async()=>{if(++attempts===1)throw new Error('Incoming modules failed');await f.openServices();}}),/Incoming modules failed/);
 assert.equal(attempts,2);assert.equal((await f.store.read()).state.tasks[0].name,'Synthetic old');
 const again=await f.manager.preflight(f.decoded);
 await assert.rejects(f.apply(again,{openServices:async()=>{throw new Error('Storage unavailable');}}),error=>error.fatal===true);
 assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);
});

test('empty module directories created during partially failed service opening are rolled back safely',async t=>{
 const f=await fixture(t),preview=await f.manager.preflight(f.decoded);let attempts=0;
 for(const name of WORKSPACE_BUSINESS_ENTRIES.filter(name=>name!=='workspace.json'))assert.equal((await fs.stat(path.join(preview.directory,name))).isDirectory(),true);
 await assert.rejects(f.apply(preview,{openServices:async()=>{await f.openServices();if(++attempts===1){for(const name of WORKSPACE_BUSINESS_ENTRIES.filter(name=>name!=='workspace.json'))await fs.mkdir(path.join(f.dataDir,name),{recursive:true});throw new Error('Partial opening failed');}}}),/Partial opening failed/);
 assert.equal(attempts,2);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);assert.equal((await f.store.read()).state.tasks[0].name,'Synthetic old');
});

test('partial close failure reopens the old workspace without starting the swap',async t=>{
 const f=await fixture(t),preview=await f.manager.preflight(f.decoded);
 await assert.rejects(f.apply(preview,{closeServices:async()=>{await f.closeServices();throw new Error('Partial close failed');}}),/Partial close failed/);
 assert.equal((await f.store.read()).state.tasks[0].name,'Synthetic old');assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);
});

test('closing a manager removes unused preflight directories while a committed archive remains selectable',async t=>{
 const f=await fixture(t),unused=await f.manager.preflight(f.decoded),used=await f.manager.preflight(f.decoded),result=await f.apply(used);
 await assert.rejects(fs.stat(used.directory),{code:'ENOENT'});await f.manager.close();await assert.rejects(fs.stat(unused.directory),{code:'ENOENT'});assert.equal((await fs.stat(result.retainedPath)).isFile(),true);
});

test('a genuinely killed process with reopened workspace and workflow locks recovers the original state at startup',async t=>{
 const f=await fixture(t);await f.closeServices();await f.manager.close();
 const script=`import {createWorkspaceRestore} from './server/workspace-restore.mjs';import {createWorkspaceStore} from './server/workspace-store.mjs';import {createWorkflowTraceStore} from './server/workflow-traces.mjs';import {encodeWorkspaceArchive,decodeWorkspaceArchive} from './server/workspace-archive.mjs';const [dataDir,sourceDir]=process.argv.slice(1);let store,traces;const manager=await createWorkspaceRestore({dataDir,failurePoint:async(point)=>{if(point==='services-opened'){setInterval(()=>{},1000);process.stdout.write('READY\\n');await new Promise(()=>{});}}});store=await createWorkspaceStore({dataDir});traces=await createWorkflowTraceStore({dataDir});const preview=await manager.preflight(decodeWorkspaceArchive((await encodeWorkspaceArchive(sourceDir)).bytes));await manager.apply({staged:preview,baseRevision:(await store.read()).revision,closeServices:async()=>{await traces.close();await store.close();},openServices:async()=>{store=await createWorkspaceStore({dataDir});traces=await createWorkflowTraceStore({dataDir});}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,f.dataDir,f.sourceDir],{cwd:path.resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(new Error('Child restore setup timed out: '+stderr)),10000);child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Child exited before restore crash point: '+stderr));});child.stdout.on('data',bytes=>{output+=bytes;if(output.includes('READY\n')){clearTimeout(timeout);resolve();}});});
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 assert.equal((await f.restart()).state.tasks[0].name,'Synthetic old');assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);await f.store.validateIntegrity();const traces=await createWorkflowTraceStore({dataDir:f.dataDir});await traces.close();
});

test('startup expires only stamped old staging directories, retaining unstamped folders and rollback archives',async t=>{
 const f=await fixture(t);await f.closeServices();await f.manager.close();const id='c'.repeat(32),owned=path.join(f.base,`.data.sqwb-stage-${id}`),unknown=path.join(f.base,`.data.sqwb-stage-${'d'.repeat(32)}`),retained=path.join(f.base,`.data.sqwb-retained-${id}`);
 await fs.mkdir(owned);await fs.mkdir(unknown);await fs.mkdir(retained);await fs.writeFile(path.join(owned,'.sqwb-stage-info.json'),JSON.stringify({version:1,id,target:f.dataDir,createdAt:Date.now()-25*60*60*1000}));await fs.writeFile(path.join(retained,'original'),'Synthetic retained original');
 await f.restart();await assert.rejects(fs.stat(owned),{code:'ENOENT'});assert.equal((await fs.stat(unknown)).isDirectory(),true);assert.equal(await fs.readFile(path.join(retained,'original'),'utf8'),'Synthetic retained original');
});

test('replacement removes business entries absent in backup but retains them in the selectable rollback package',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.dataDir,'backups'));await fs.writeFile(path.join(f.dataDir,'backups','prior.json'),'prior synthetic bytes');
 const preview=await f.manager.preflight(f.decoded),result=await f.apply(preview);await assert.rejects(fs.stat(path.join(f.dataDir,'backups','prior.json')),{code:'ENOENT'});
 const original=decodeWorkspaceArchive((await f.manager.readRetained(result.backupId)).bytes);assert.equal(original.files.get('backups/prior.json').toString(),'prior synthetic bytes');
});

test('all business entries are explicit, and unknown or malicious recovery journals never target external paths',async t=>{
 assert.deepEqual(WORKSPACE_BUSINESS_ENTRIES,['workspace.json','workspace-records','sources','workflow-runs','report-jobs','raw-structure','content-translations','report-cache','translation-cache','import-drafts','backups','language-materials']);
 const f=await fixture(t);await f.closeServices();await f.manager.close();
 await fs.writeFile(path.join(f.dataDir,'.workspace-restore.json'),JSON.stringify({version:1,id:'b'.repeat(32),target:f.dataDir,phase:'swapping',oldNames:['../outside'],newNames:[]}));
 await assert.rejects(createWorkspaceRestore({dataDir:f.dataDir}),/日志无法核验/);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),f.original);
});
