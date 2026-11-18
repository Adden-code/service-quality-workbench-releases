import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createCatalog,createDraft} from '../public/catalog.mjs';
import {createWorkspaceBackupManager} from '../public/workspace-backup-ui.mjs';
import {decodeWorkspaceArchive} from '../server/workspace-archive.mjs';

test('backup UI controller completes real local HTTP export, preview and replacement, retaining the replaced data and requiring a new token',async t=>{
  const scratch=path.resolve('../outputs/service0106-20261115/ui-flow-tests');await fs.mkdir(scratch,{recursive:true});const directory=await fs.mkdtemp(path.join(scratch,'synthetic-')),dataDir=path.join(directory,'data');
  const server=await createWorkbenchServer({dataDir,catalogSeed:null});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await server.closeWorkspace();assert.ok(path.resolve(directory).startsWith(scratch+path.sep));await fs.rm(directory,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${server.address().port}`;let snapshot=await(await fetch(origin+'/api/workspace')).json();
  async function save(catalog){const response=await fetch(origin+'/api/workspace',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':snapshot.token},body:JSON.stringify({baseRevision:snapshot.revision,mutationId:'synthetic-'+crypto.randomUUID(),state:createBusinessState(),catalog})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));snapshot=value;}
  await save(createCatalog());const originalCount=snapshot.catalog.rules.length,originalToken=snapshot.token;let dialog,downloaded,reloads=0;
  const manager=createWorkspaceBackupManager({getDialog:()=>dialog,openDialog:value=>dialog=value,renderDialog(){},getToken:()=>snapshot.token,getStatus:()=>({revision:snapshot.revision}),fetchImpl:(url,options)=>fetch(origin+url,{...options,headers:{...options.headers,Origin:origin}}),download:(blob,name)=>downloaded={blob,name},reload:()=>reloads++});
  await manager.action('workspace-backup-open');await manager.action('workspace-backup-export');assert.equal(dialog.error,'');assert.ok(downloaded?.blob.size>0);assert.match(downloaded.name,/^workspace-.+\.sqwb$/);
  const exported=decodeWorkspaceArchive(new Uint8Array(await downloaded.blob.arrayBuffer()));assert.equal(exported.manifest.ruleCount,originalCount);
  await save(createDraft(snapshot.catalog,'rules','R001',{changeNote:'Synthetic newer rule draft'},new Date().toISOString()));assert.equal(snapshot.catalog.rules.length,originalCount+1);
  await manager.action('workspace-backup-tab-restore');manager.change({target:{id:'workspace-backup-file',files:[Object.assign(downloaded.blob,{name:downloaded.name})]}});await manager.action('workspace-backup-preview');assert.equal(dialog.error,'');assert.equal(dialog.preview.backup.ruleCount,originalCount);assert.equal(dialog.preview.current.ruleCount,originalCount+1);
  manager.change({target:{id:'workspace-backup-confirm',checked:true}});await manager.action('workspace-backup-restore');assert.equal(dialog.error,'');assert.equal(dialog.result.restored,true);assert.equal(dialog.result.restoredCounts.ruleCount,originalCount);assert.equal(manager.requiresReload,true);
  const fresh=await(await fetch(origin+'/api/workspace')).json();assert.equal(fresh.catalog.rules.length,originalCount);assert.notEqual(fresh.token,originalToken);assert.ok(fresh.revision>snapshot.revision);
  const retained=decodeWorkspaceArchive(await fs.readFile(dialog.result.retainedPath));assert.equal(retained.document.catalog.rules.length,originalCount+1);
  const stale=await fetch(origin+'/api/workspace-backup/export',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':originalToken},body:'{}'});assert.equal(stale.status,403);
  await manager.action('workspace-backup-reload');assert.equal(reloads,1);
});
