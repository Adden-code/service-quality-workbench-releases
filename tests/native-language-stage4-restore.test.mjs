import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {seedStage3Workspace} from './native-language-stage3-workspace.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createWorkspaceRestore} from '../server/workspace-restore.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {createImportedTask} from '../public/domain.mjs';

for(const language of ['zh','en'])test('native '+language+' full backup restores through HTTP preview/apply and survives restart',async t=>{
 const parent=path.resolve('../outputs/service-r39-stage4-20261125/restore-tests');await fs.mkdir(parent,{recursive:true});
 const base=await fs.mkdtemp(path.join(parent,'case-')),source=path.join(base,'source'),target=path.join(base,'target');
 let server,readStore;
 t.after(async()=>{await readStore?.close();if(server)await new Promise(r=>server.close(r));assert.ok(base.startsWith(parent+path.sep));await fs.rm(base,{recursive:true,force:true});});
 await seedStage3Workspace({dataDir:source,language});await fs.unlink(path.join(source,'synthetic-stage3.json'));
 const stage4=await createWorkspaceStore({dataDir:source,nativeLanguageStage:4});
 try{
  const before=await stage4.read(),prior=before.state.tasks[0];
  const sessions=before.state.sessions.map(s=>Object.fromEntries(['id','scene','startedAt','agent','customer','product','topic','channel','completeness','missingNote','turns'].map(k=>[k,s[k]])));
  const state=createImportedTask(before.state,{name:'SYNTHETIC STAGE4 RESTORE',source:prior.source,sessions,basisSnapshot:prior.basisSnapshot,reviewer:'SYNTHETIC TEST',now:'2026-11-25T02:00:00Z'});
  const saved=await stage4.save({baseRevision:before.revision,mutationId:'create-stage4-before-backup',state,catalog:before.catalog});
  assert.equal(saved.state.tasks.find(task=>task.name==='SYNTHETIC STAGE4 RESTORE').executionSnapshot.schemaVersion,2);assert.deepEqual(saved.state.tasks.find(task=>task.id===prior.id),prior);
 }finally{await stage4.close();}
 const archive=await encodeWorkspaceArchive(source),decoded=decodeWorkspaceArchive(archive.bytes);
 server=await createWorkbenchServer({dataDir:target,nativeLanguageStage:4,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const view=await(await fetch(origin+'/api/workspace')).json(),headers={Origin:origin,'X-Workspace-Token':view.token};
 const previewResponse=await fetch(origin+'/api/workspace-backup/preview',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:archive.bytes});
 const preview=await previewResponse.json();assert.equal(previewResponse.status,200,JSON.stringify(preview));
 const applyResponse=await fetch(origin+'/api/workspace-backup/restore',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({previewId:preview.previewId,baseRevision:preview.baseRevision})});
 assert.equal(applyResponse.status,200,await applyResponse.text());
 const after=await(await fetch(origin+'/api/workspace')).json();
 assert.equal(after.state.workspaceSettings.languagePolicy.contentLanguage,language);
 assert.deepEqual(after.state.tasks,decoded.document.state.tasks);assert.deepEqual(after.state.sessions,decoded.document.state.sessions);
 assert.deepEqual(after.state.languageMaterials,decoded.document.state.languageMaterials);
 await new Promise(r=>server.close(r));server=null;
 readStore=await createWorkspaceStore({dataDir:target,nativeLanguageStage:4});await readStore.validateIntegrity();
 assert.deepEqual((await readStore.read()).state.tasks,decoded.document.state.tasks);
 for(const entry of [...after.state.languageMaterials.releases,...after.state.languageMaterials.freezes]){
  const name=entry.contentHash||entry.hash;assert.deepEqual(await fs.readFile(path.join(target,'language-materials',name+'.json')),await fs.readFile(path.join(source,'language-materials',name+'.json')));
 }
});

test('compatibility-only restore refuses native task archive before changing destination',async t=>{
 const parent=path.resolve('../outputs/service-r39-stage4-20261125/restore-tests');await fs.mkdir(parent,{recursive:true});
 const base=await fs.mkdtemp(path.join(parent,'legacy-')),source=path.join(base,'source'),target=path.join(base,'target');let manager;
 t.after(async()=>{await manager?.close();await fs.rm(base,{recursive:true,force:true});});
 await seedStage3Workspace({dataDir:source,language:'en'});await fs.unlink(path.join(source,'synthetic-stage3.json'));const decoded=decodeWorkspaceArchive((await encodeWorkspaceArchive(source)).bytes);
 manager=await createWorkspaceRestore({dataDir:target});
 await assert.rejects(manager.preflight(decoded),{code:'NATIVE_LANGUAGE_STAGE_PENDING'});
 assert.equal(await fs.stat(path.join(target,'workspace.json')).then(()=>true,()=>false),false);
});
