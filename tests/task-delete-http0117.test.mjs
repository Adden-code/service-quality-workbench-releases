import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {fixture} from './import-repeat0117.test.mjs';
const root=path.resolve('../outputs/service0117-20261117/http-tests');
async function setup(t){
 await fs.mkdir(root,{recursive:true});const container=await fs.mkdtemp(path.join(root,'case-')),dataDir=path.join(container,'workspace');let server;
 async function start(){server=await createWorkbenchServer({dataDir,catalogSeed:null,sceneSeed:null,storageMode:'sharded'});server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
 let origin=await start(),doc=await(await fetch(origin+'/api/workspace')).json();
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(container.startsWith(root+path.sep));await fs.rm(container,{recursive:true,force:true});});
 const headers=()=>({Origin:origin,'X-Workspace-Token':doc.token,'Content-Type':'application/json'});
 async function request(url,value,method='POST'){const res=await fetch(origin+url,{method,headers:headers(),body:JSON.stringify(value)});const body=await res.json();if(res.ok&&body.state)doc=body;return{status:res.status,body};}
 const source=await(await fetch(origin+'/api/sources',{method:'POST',headers:{...headers(),'Content-Type':'application/octet-stream','X-File-Name':'synthetic.txt'},body:'Synthetic original'})).json();
 const {catalog,input}=fixture();let state=createImportedTask(createBusinessState(),{...input,source});state=createImportedTask(state,{...input,source});
 const init=await request('/api/workspace',{baseRevision:0,mutationId:'init',state,catalog},'PUT');assert.equal(init.status,200,JSON.stringify(init.body));

 return {request,dataDir,source,get doc(){return doc;},get server(){return server;},async restart(){await new Promise(resolve=>server.close(resolve));origin=await start();doc=await(await fetch(origin+'/api/workspace')).json();return doc;}};
}
test('0117 HTTP archive -> administrator void -> double-confirmed backed-up deletion survives restart',async t=>{
 const f=await setup(t),id=f.doc.state.tasks[0].id,other=structuredClone(f.doc.state.tasks[1]),rows=structuredClone(f.doc.state.sessions.filter(s=>s.taskId===other.id));
 const opts={actor:'Synthetic admin',reason:'Synthetic clean up',administratorConfirmed:true};
 const lifecycle=action=>f.request('/api/task-lifecycle',{taskIds:[id],action,...opts});
 await f.server.traces.begin({id:'synthetic-deletion-trace',taskId:id,engine:'synthetic',kind:'local-test',nodes:[{id:'check',label:'Synthetic'}]});await f.server.traces.step('synthetic-deletion-trace','check',{},async()=>({synthetic:true}));await f.server.traces.finish('synthetic-deletion-trace',{status:'completed'});
 assert.equal((await lifecycle('archive')).status,200);
 assert.equal((await f.request('/api/task-lifecycle',{taskIds:[id],action:'void',actor:opts.actor,reason:opts.reason})).status,400);
 assert.equal((await lifecycle('void')).status,200);const before=structuredClone(f.doc);
 assert.equal((await f.request('/api/tasks/delete',{...opts,taskId:id,confirmTaskId:'wrong'})).status,409);assert.deepEqual(f.doc,before);
 const deleted=await f.request('/api/tasks/delete',{...opts,taskId:id,confirmTaskId:id});assert.equal(deleted.status,200,JSON.stringify(deleted.body));
 assert.deepEqual(f.doc.state.tasks,[other]);assert.deepEqual(f.doc.state.sessions,rows);
 const audit=f.doc.state.taskDeletionAudit[0],backup=decodeWorkspaceArchive(await fs.readFile(audit.backupPath));assert.deepEqual(backup.document.state,before.state);assert.ok(backup.files.has('workflow-runs/synthetic-deletion-trace.json'));
 await assert.rejects(fs.stat(path.join(f.dataDir,'workflow-runs/synthetic-deletion-trace.json')),/ENOENT/);
 assert.ok((await fs.stat(path.join(f.dataDir,'sources',f.source.sha256))).isFile(),'shared source retained');
 const expected=structuredClone(f.doc.state),restarted=await f.restart();assert.deepEqual(restarted.state,expected);assert.deepEqual(restarted.state.tasks,[other]);
 const repeated=await f.request('/api/tasks/delete',{...opts,taskId:id,confirmTaskId:id});assert.equal(repeated.status,409);
 const last=other.id;await f.request('/api/task-lifecycle',{taskIds:[last],action:'void',...opts});assert.equal((await f.request('/api/tasks/delete',{...opts,taskId:last,confirmTaskId:last})).status,200);
 await assert.rejects(fs.stat(path.join(f.dataDir,'sources',f.source.sha256)),/ENOENT/);
});
