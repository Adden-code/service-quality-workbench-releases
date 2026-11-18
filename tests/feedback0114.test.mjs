import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createInitialState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {workspacePatch,mergeWorkspacePatch} from '../public/workspace-patch.mjs';
import {createWorkspaceRestore} from '../server/workspace-restore.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive} from '../server/workspace-archive.mjs';

async function setup(t,extra={}){
 const root=path.resolve('tests/.onboarding-scratch');await fs.mkdir(root,{recursive:true});const dataDir=await fs.mkdtemp(path.join(root,'feedback0114-'));
 const store=await createWorkspaceStore({dataDir,...extra});t.after(async()=>{await store.close();await fs.rm(dataDir,{recursive:true,force:true});});
 const initial=await store.save({baseRevision:0,mutationId:'init',state:{...createInitialState(),businessMigrationVersion:1},catalog:createCatalog()});return{store,dataDir,initial};
}
test('0114 split persistence restarts consistently, keeps migration original and exports portable backups',async t=>{
 const {store,dataDir,initial}=await setup(t,{storageMode:'sharded'});const root=JSON.parse(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8'));
 assert.equal(root.storageFormat,'task-records-v1');assert.equal(typeof root.state,'string');await store.close();
 const restarted=await createWorkspaceStore({dataDir});t.after(()=>restarted.close());assert.deepEqual(await restarted.read(),initial);
 const {encodeWorkspaceArchive,decodeWorkspaceArchive}=await import('../server/workspace-archive.mjs');const archive=decodeWorkspaceArchive((await encodeWorkspaceArchive(dataDir)).bytes);assert.deepEqual(archive.document.state,initial.state);
});
test('0114 review command is idempotent, detects same-record conflicts and does not replace other reviews',async t=>{
 const {store,initial}=await setup(t);assert.equal(typeof store.reviewCommand,'function');
 const s=initial.state.sessions.find(s=>s.review.status!=='已确认');const input={mutationId:'review-1',sessionId:s.id,expected:JSON.stringify(s.review),action:'accept',at:'2026-11-17T08:00:00Z'};
 const result=await store.reviewCommand(input);assert.equal(result.state.sessions.find(x=>x.id===s.id).review.status,'已暂存');assert.equal((await store.reviewCommand(input)).revision,result.revision);
 await assert.rejects(store.reviewCommand({...input,mutationId:'review-2'}),/冲突|更新/);
 await assert.rejects(store.reviewCommand({...input,mutationId:'review-1',action:'confirm'}),/相同|标识/);
});
test('0114 unchanged refresh returns no complete transcripts and changed review returns a slice',async t=>{
 const {store,initial}=await setup(t);assert.equal(typeof store.changesSince,'function');
 const same=await store.changesSince(initial.revision);assert.equal(same.unchanged,true);assert.equal(same.state,undefined);
 const s=initial.state.sessions.find(s=>s.review.status!=='已确认');await store.reviewCommand({mutationId:'r',sessionId:s.id,expected:JSON.stringify(s.review),action:'accept',at:'2026-11-17T08:00:00Z'});
 const update=await store.changesSince(initial.revision);assert.equal(update.patch.sessions.length,1);assert.equal(update.patch.catalog,undefined);
});

test('0114 shard migration preserves exact old bytes; a failed index commit cannot lose a confirmed review',async t=>{
 const {store,dataDir,initial}=await setup(t);await store.close();const original=await fs.readFile(path.join(dataDir,'workspace.json'));let fail=false;
 const fsOps={...fs,rename:async(from,to)=>{if(fail&&to===path.join(dataDir,'workspace.json'))throw Object.assign(Error('Synthetic failed commit'),{code:'EIO'});return fs.rename(from,to);}};
 let split=await createWorkspaceStore({dataDir,storageMode:'sharded',fsOps});t.after(()=>split.close());
 const backups=await fs.readdir(path.join(dataDir,'backups'));assert.ok((await Promise.all(backups.map(n=>fs.readFile(path.join(dataDir,'backups',n))))).some(b=>b.equals(original)));
 const session=initial.state.sessions.find(s=>s.review.status!=='已确认'),input={mutationId:'failing',sessionId:session.id,expected:JSON.stringify(session.review),action:'accept',at:'2026-11-17T08:00:00Z'};
 fail=true;await assert.rejects(split.reviewCommand(input),/未保存/);assert.deepEqual(await split.read(),initial);await split.close();fail=false;
 split=await createWorkspaceStore({dataDir});assert.deepEqual(await split.read(),initial);const changed=await split.reviewCommand(input);await split.close();split=await createWorkspaceStore({dataDir});assert.deepEqual(await split.read(),changed);
});

test('0114 complete backup restores a split workspace and can roll back to the previous reviewed state',async t=>{
 const {store,dataDir,initial}=await setup(t,{storageMode:'sharded'});let current=store;
 const archived=decodeWorkspaceArchive((await encodeWorkspaceArchive(dataDir)).bytes),s=initial.state.sessions.find(s=>s.review.status!=='已确认');
 const saved=await current.reviewCommand({mutationId:'before-restore',sessionId:s.id,expected:JSON.stringify(s.review),action:'accept',at:'2026-11-17T08:00:00Z'});
 const manager=await createWorkspaceRestore({dataDir});t.after(async()=>{await current.close();await manager.close();});
 const staged=await manager.preflight(archived),result=await manager.apply({staged,baseRevision:saved.revision,closeServices:()=>current.close(),openServices:async()=>{current=await createWorkspaceStore({dataDir,storageMode:'sharded'});}});
 assert.deepEqual((await current.read()).state,initial.state);const previous=decodeWorkspaceArchive(await fs.readFile(result.backupPath));assert.deepEqual(previous.document.state,saved.state);
 assert.equal(JSON.parse(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8')).storageFormat,'task-records-v1');
 t.after(async()=>{for(const target of [result.backupPath,result.retainedDirectory]){assert.ok(path.resolve(target).startsWith(path.dirname(dataDir)+path.sep));await fs.rm(target,{recursive:true,force:true});}});
});

test('0114 incremental synchronization preserves insertion order and rejects a mismatched base',()=>{
 const before={revision:1,state:{tasks:[{id:'old'}],sessions:[{id:'s'}],activity:[]},catalog:{}};
 const after={revision:2,state:{tasks:[{id:'new'},{id:'old'}],sessions:[],activity:['event']},catalog:before.catalog};
 const packet={baseRevision:1,revision:2,patch:workspacePatch(before,after)},merged=mergeWorkspacePatch(before,packet);
 assert.deepEqual(merged.state,after.state);assert.throws(()=>mergeWorkspacePatch({...before,revision:3},packet),/版本/);
});

test('0114 review commands accept unrelated progress but reject concurrent edits and archived tasks',async t=>{
 const {store,initial}=await setup(t,{storageMode:'sharded'}),sessions=initial.state.sessions.filter(s=>s.review.status!=='已确认');
 const input=s=>({mutationId:'review-'+s.id,sessionId:s.id,expected:JSON.stringify(s.review),expectedAI:JSON.stringify({aiResults:s.aiResults,aiExecution:s.aiExecution,aiDecision:s.aiDecision,sceneCapabilities:s.sceneCapabilities}),action:'accept',at:'2026-11-17T08:00:00Z'});
 await store.reviewCommand(input(sessions[0]));await store.reviewCommand(input(sessions[1]));
 await store.updateTaskLifecycle([sessions[0].taskId],'archive',{actor:'Synthetic reviewer',now:'2026-11-17T08:00:00Z'});
 const latest=await store.read(),s=latest.state.sessions.find(x=>x.id===sessions[0].id);await assert.rejects(store.reviewCommand({...input(s),mutationId:'archived-edit'}),/归档|只读/);
});
