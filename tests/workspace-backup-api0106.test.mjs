import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {decodeWorkspaceArchive} from '../server/workspace-archive.mjs';

const scratch=path.resolve('..','outputs','service0106-20261115','test-backup-api');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonHeaders=f=>({...f.headers,'Content-Type':'application/json'});
const snapshot=f=>fetch(f.origin+'/api/workspace').then(response=>response.json());
async function jsonRequest(f,url,body={},method='POST'){
 const response=await fetch(f.origin+url,{method,headers:jsonHeaders(f),body:JSON.stringify(body)});
 return{status:response.status,value:await response.json()};
}
async function upload(f,text='synthetic original',name='synthetic.txt'){
 const response=await fetch(f.origin+'/api/sources',{method:'POST',headers:{...f.headers,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)},body:text});
 assert.equal(response.status,201);return response.json();
}
async function exportBackup(f){
 const response=await fetch(f.origin+'/api/workspace-backup/export',{method:'POST',headers:jsonHeaders(f),body:'{}'});
 assert.equal(response.status,200,await (response.status!==200?response.text():Promise.resolve('')));
 assert.match(response.headers.get('content-disposition'),/\.sqwb/);assert.equal(response.headers.get('cache-control'),'no-store');
 return Buffer.from(await response.arrayBuffer());
}
async function previewBackup(f,bytes){
 const response=await fetch(f.origin+'/api/workspace-backup/preview',{method:'POST',headers:{...f.headers,'Content-Type':'application/octet-stream'},body:bytes});
 const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}
async function fixture(t,{fsOps,arkClient}={}){
 await fs.mkdir(scratch,{recursive:true});const container=await fs.mkdtemp(path.join(scratch,'case-')),dataDir=path.join(container,'workspace');
 const server=await createWorkbenchServer({dataDir,catalogSeed:null,...(fsOps?{fsOps}:{}),...(arkClient?{arkClient}:{})});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));assert.ok(path.resolve(container).startsWith(scratch+path.sep));await fs.rm(container,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`,initial=await(await fetch(origin+'/api/workspace')).json(),f={container,dataDir,server,origin,headers:{Origin:origin,'X-Workspace-Token':initial.token}};
 const source=await upload(f),catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-15',ruleIds:['R004']});
 const session={id:'SYN-BACKUP-1',scene:'新品产品咨询',startedAt:'2026-11-15T09:00:00+08:00',topic:'合成备份验证',channel:'合成渠道',product:'合成产品',agent:'合成客服',customer:'合成客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'合成客户',at:'',text:'请提供正式产品资料。'},{id:2,role:'客服',speaker:'合成客服',at:'',text:'我先核对正式资料。'}]};
 const state=createImportedTask(createBusinessState(),{name:'合成备份任务',fileName:source.name,sessions:[session],source,basisSnapshot,reviewer:'合成审核员'});
 const initialized=await jsonRequest(f,'/api/workspace',{baseRevision:0,mutationId:'synthetic-initial',state,catalog},'PUT');assert.equal(initialized.status,200,JSON.stringify(initialized.value));
 f.source=source;f.taskId=state.tasks[0].id;return f;
}
async function heldBody(f,url,{method='POST',type='application/octet-stream',first=Buffer.from('x'),extraHeaders={}}={}){
 let arrive;const arrived=new Promise(resolve=>arrive=resolve),observe=req=>{if(req.url===url){f.server.off('request',observe);arrive();}};f.server.on('request',observe);
 let req;const done=new Promise((resolve,reject)=>{
  req=httpRequest(f.origin+url,{method,headers:{...f.headers,'Content-Type':type,'Transfer-Encoding':'chunked',...extraHeaders}},res=>{const parts=[];res.on('data',chunk=>parts.push(chunk));res.once('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(parts)}));});req.once('error',reject);req.write(first);
 });
 await arrived;return{req,done};
}

test('backup HTTP round trip retains a complete restorable predecessor and leaves local model/control settings intact',async t=>{
 const f=await fixture(t),draftId=randomUUID();
 assert.equal((await jsonRequest(f,'/api/model/config',{baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-local-model',authMode:'none'},'PUT')).status,200);
 const draft=await jsonRequest(f,'/api/import-drafts/'+draftId,{baseRevision:0,kind:'new-task',source:f.source,payload:{scene:'新品产品咨询',name:'合成草稿',rows:['synthetic draft']}},'PUT');assert.equal(draft.status,200,JSON.stringify(draft.value));
 await f.server.traces.begin({id:'synthetic-backup-trace',taskId:f.taskId,engine:'synthetic',kind:'local-test',nodes:[{id:'verify',label:'合成验证'}]});
 await f.server.traces.step('synthetic-backup-trace','verify',{source:'synthetic'},async()=>({ok:true}));await f.server.traces.finish('synthetic-backup-trace',{status:'completed'});
 const sidecars={'.portable-instance.json':'{"controlToken":"synthetic-runtime-token","pid":999999}', '.portable-instance.lock':'synthetic-owned-lock','logs/portable-startup.log':'synthetic startup log'};
 for(const [name,bytes]of Object.entries(sidecars)){await fs.mkdir(path.dirname(path.join(f.dataDir,name)),{recursive:true});await fs.writeFile(path.join(f.dataDir,name),bytes);}
 const settings=await fs.readFile(path.join(f.dataDir,'.secrets','ark-model.json')),before=await snapshot(f),originalBytes=await exportBackup(f),original=decodeWorkspaceArchive(originalBytes);
 assert.ok(original.files.has('sources/'+f.source.sha256));assert.ok(original.files.has('import-drafts/'+draftId+'.json'));assert.ok(original.files.has('workflow-runs/synthetic-backup-trace.json'));
 assert.ok(![...original.files.keys()].some(name=>name.startsWith('.secrets/')||name.includes('.lock')||name.startsWith('logs/')||name.startsWith('.portable')));
 assert.equal((await jsonRequest(f,'/api/task-lifecycle',{taskIds:[f.taskId],action:'archive',actor:'合成测试'})).status,200);
 const laterSource=await upload(f,'synthetic second source','later.txt'),old=await snapshot(f),oldToken=f.headers['X-Workspace-Token'],preview=await previewBackup(f,originalBytes);
 const restored=await jsonRequest(f,'/api/workspace-backup/restore',{previewId:preview.previewId,baseRevision:preview.baseRevision});assert.equal(restored.status,200,JSON.stringify(restored.value));assert.equal(restored.value.restored,true);
 assert.ok(path.resolve(restored.value.retainedPath).startsWith(f.container+path.sep));assert.match(restored.value.retainedPath,/\.sqwb$/);
 const retainedBytes=await fs.readFile(restored.value.retainedPath),retained=decodeWorkspaceArchive(retainedBytes);
 assert.equal(retained.document.revision,old.revision);assert.deepEqual(retained.document.state,old.state);assert.ok(retained.files.has('sources/'+laterSource.sha256));assert.equal(sha(retained.files.get('sources/'+laterSource.sha256)),laterSource.sha256);
 let current=await snapshot(f);assert.notEqual(current.token,oldToken);assert.ok(current.revision>old.revision);assert.deepEqual(current.state,before.state);assert.deepEqual(current.catalog,before.catalog);
 assert.equal((await fetch(f.origin+'/api/sources/'+laterSource.sha256)).status,404);
 assert.equal((await jsonRequest(f,'/api/workspace',{baseRevision:old.revision,mutationId:'stale-old-token',state:old.state,catalog:old.catalog},'PUT')).status,403);
 f.headers['X-Workspace-Token']=current.token;
 assert.equal((await jsonRequest(f,'/api/workspace',{baseRevision:old.revision,mutationId:'stale-old-revision',state:old.state,catalog:old.catalog},'PUT')).status,409);
 for(const [name,bytes]of Object.entries(sidecars))assert.equal(await fs.readFile(path.join(f.dataDir,name),'utf8'),bytes);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'.secrets','ark-model.json')),settings);
 const back=await previewBackup(f,retainedBytes),rolledBack=await jsonRequest(f,'/api/workspace-backup/restore',{previewId:back.previewId,baseRevision:back.baseRevision});assert.equal(rolledBack.status,200,JSON.stringify(rolledBack.value));
 current=await snapshot(f);assert.deepEqual(current.state,old.state);assert.equal((await fetch(f.origin+'/api/sources/'+laterSource.sha256)).status,200);assert.deepEqual(await fs.readFile(restored.value.retainedPath),retainedBytes);
 for(const [name,bytes]of Object.entries(sidecars))assert.equal(await fs.readFile(path.join(f.dataDir,name),'utf8'),bytes);assert.deepEqual(await fs.readFile(path.join(f.dataDir,'.secrets','ark-model.json')),settings);
});

test('preview rejects later workspace revisions and requires a fresh preview before restore',async t=>{
 const f=await fixture(t),bytes=await exportBackup(f),preview=await previewBackup(f,bytes);
 assert.equal((await jsonRequest(f,'/api/task-lifecycle',{taskIds:[f.taskId],action:'archive',actor:'合成测试'})).status,200);
 const old=await snapshot(f),result=await jsonRequest(f,'/api/workspace-backup/restore',{previewId:preview.previewId,baseRevision:preview.baseRevision});assert.equal(result.status,409);assert.equal(result.value.code,'REVISION_CONFLICT');assert.deepEqual((await snapshot(f)).state,old.state);
 const fresh=await previewBackup(f,bytes),restored=await jsonRequest(f,'/api/workspace-backup/restore',{previewId:fresh.previewId,baseRevision:fresh.baseRevision});assert.equal(restored.status,200,JSON.stringify(restored.value));
});

test('preview also rejects source and import-draft writes that do not advance workspace revision',async t=>{
 const f=await fixture(t),bytes=await exportBackup(f),before=await snapshot(f);let preview=await previewBackup(f,bytes);
 const source=await upload(f,'synthetic post-preview content','post-preview.txt');assert.equal((await snapshot(f)).revision,before.revision);
 let result=await jsonRequest(f,'/api/workspace-backup/restore',{previewId:preview.previewId,baseRevision:preview.baseRevision});assert.equal(result.status,409,'new sources must not be silently overwritten');assert.equal((await fetch(f.origin+'/api/sources/'+source.sha256)).status,200);
 preview=await previewBackup(f,bytes);const draftId=randomUUID(),draft=await jsonRequest(f,'/api/import-drafts/'+draftId,{baseRevision:0,kind:'new-task',source,payload:{scene:'新品产品咨询',name:'预检后合成草稿',rows:['post-preview draft']}},'PUT');assert.equal(draft.status,200,JSON.stringify(draft.value));assert.equal((await snapshot(f)).revision,before.revision);
 result=await jsonRequest(f,'/api/workspace-backup/restore',{previewId:preview.previewId,baseRevision:preview.baseRevision});assert.equal(result.status,409,'new drafts must invalidate preview even with the same workspace revision');
 assert.equal((await fetch(f.origin+'/api/import-drafts/'+draftId,{headers:f.headers})).status,200);
});

test('an admitted incomplete source body blocks backup before any source write starts',async t=>{
 const f=await fixture(t),held=await heldBody(f,'/api/sources',{extraHeaders:{'X-File-Name':'synthetic-slow.txt'},first:Buffer.from('synthetic ')});
 try{const busy=await jsonRequest(f,'/api/workspace-backup/export');assert.equal(busy.status,409);assert.equal(busy.value.code,'BUSY');}
 finally{held.req.end('source');}
 assert.equal((await held.done).status,201);await exportBackup(f);
});

test('background translation blocks backup after its HTTP request ends and through a soft pause',async t=>{
 let enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 const arkClient={engine:'synthetic',async enrichBusinessReport({input}){enter();await gate;return{items:input.items.map(item=>({id:item.id,translation:'Synthetic translation '+item.id,isTargetLanguage:false,detectedLanguage:'zh'}))};}};
 const f=await fixture(t,{arkClient});
 try{
  assert.equal((await jsonRequest(f,'/api/model/config',{baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-translation',authMode:'none'},'PUT')).status,200);
  const created=await jsonRequest(f,'/api/translation-jobs',{jobId:'backup-active-translation',source:{kind:'task',taskId:f.taskId},targetLang:'en'});assert.equal(created.status,202,JSON.stringify(created.value));await entered;
  assert.equal((await jsonRequest(f,'/api/workspace-backup/export')).status,409);
  const paused=await jsonRequest(f,'/api/translation-jobs/backup-active-translation/pause');assert.equal(paused.status,200);assert.equal(paused.value.job.status,'paused');
  assert.equal((await jsonRequest(f,'/api/workspace-backup/export')).status,409,'paused status does not mean the model request has settled');
  release();await f.server.waitForTranslationsIdle();const bytes=await exportBackup(f),archive=decodeWorkspaceArchive(bytes);assert.ok(archive.files.has('content-translations/backup-active-translation/job.json'));
 }finally{release();}
});

test('maintenance excludes all other API calls while receiving a backup and while reopening restored stores',async t=>{
 let gateEnabled=false,enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 const fsOps={...fs,async readFile(file,...args){if(gateEnabled&&path.basename(String(file))==='workspace.json'){gateEnabled=false;enter();await gate;}return fs.readFile(file,...args);}};
 const f=await fixture(t,{fsOps}),bytes=await exportBackup(f),held=await heldBody(f,'/api/workspace-backup/preview',{first:bytes.subarray(0,12)});
 try{
  for(const endpoint of ['/api/workspace','/api/model/config','/api/import-drafts','/api/workspace-usage','/api/report-jobs','/api/translation-jobs','/api/raw-structure-jobs'])assert.equal((await fetch(f.origin+endpoint,{headers:f.headers})).status,503,endpoint);
  assert.equal((await jsonRequest(f,'/api/workspace-backup/export')).status,503);assert.equal((await fetch(f.origin+'/')).status,200,'static page can still explain maintenance');
 }finally{held.req.end(bytes.subarray(12));}
 const response=await held.done;assert.equal(response.status,200,response.bytes.toString());const preview=JSON.parse(response.bytes);
 gateEnabled=true;const restoring=jsonRequest(f,'/api/workspace-backup/restore',{previewId:preview.previewId,baseRevision:preview.baseRevision});
 try{await entered;assert.equal((await fetch(f.origin+'/api/workspace')).status,503);assert.equal((await jsonRequest(f,'/api/model/config',{model:'must-not-write'},'PUT')).status,503);}
 finally{release();}
 const restored=await restoring;assert.equal(restored.status,200,JSON.stringify(restored.value));assert.equal((await fetch(f.origin+'/api/workspace')).status,200);
});

test('backup routes require exact origin and token, reject other methods and malformed archives without mutation',async t=>{
 const f=await fixture(t),before=await fs.readFile(path.join(f.dataDir,'workspace.json'));
 for(const endpoint of ['export','preview','restore']){
  const url=f.origin+'/api/workspace-backup/'+endpoint,type=endpoint==='preview'?'application/octet-stream':'application/json';
  for(const method of ['GET','HEAD','PUT','DELETE','OPTIONS'])assert.equal((await fetch(url,{method,headers:{...f.headers,'Content-Type':type}})).status,405,endpoint+' '+method);
  for(const override of [{'X-Workspace-Token':'0'.repeat(64)},{'X-Workspace-Token':'bad'},{Origin:'https://foreign.invalid'},{Origin:'null'},{Origin:''}]){
   const response=await fetch(url,{method:'POST',headers:{...f.headers,'Content-Type':type,...override},body:'{}'});assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  assert.equal((await fetch(url,{method:'POST',headers:{...f.headers,'Content-Type':'text/plain'},body:'{}'})).status,415);
 }
 const hostile=await new Promise((resolve,reject)=>{const req=httpRequest(f.origin+'/api/workspace-backup/export',{method:'POST',headers:{...jsonHeaders(f),Host:'foreign.invalid'}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);req.end('{}');});assert.equal(hostile,403);
 const malformed=await fetch(f.origin+'/api/workspace-backup/preview',{method:'POST',headers:{...f.headers,'Content-Type':'application/octet-stream'},body:'synthetic invalid archive'});assert.equal(malformed.status,400);
 const missing=await jsonRequest(f,'/api/workspace-backup/restore',{previewId:'missing',baseRevision:1});assert.equal(missing.status,409);
 assert.deepEqual(await fs.readFile(path.join(f.dataDir,'workspace.json')),before);assert.equal((await fetch(f.origin+'/api/workspace')).status,200);
});
