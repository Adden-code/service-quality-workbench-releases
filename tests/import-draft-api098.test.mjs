import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWorkbenchServer} from '../server.mjs';
import {createWorkspaceClient} from '../public/workspace-client.mjs';
import {createImportDraftManager,importDraftSnapshot,restoreImportDraft} from '../public/import-drafts-manager.mjs';
import {createConversationCleaningManager} from '../public/conversation-cleaning-manager.mjs';
import {createImportManager} from '../public/import-manager.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {workbook} from '../public/io.mjs';
import {updateCleaningField,confirmCleaningRow} from '../public/conversation-cleaning.mjs';

const evidenceRoot=path.resolve('../import-draft-store098');
const now='2026-11-11T10:00:00+08:00',scene='新品产品咨询';
const freshId=()=>`import-${randomUUID()}`;
const digest=bytes=>createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const sourceRequest=(source,payload,baseRevision=0,kind='new-task')=>({baseRevision,kind,source,payload});
const sessions=[{id:'SYN-API-001',scene,startedAt:now,completeness:'完整',agent:'Synthetic agent',turns:[{id:1,role:'客户',text:'Synthetic original text'}]}];
async function fixture(t){
 await fs.mkdir(evidenceRoot,{recursive:true});const dataDir=await fs.mkdtemp(path.join(evidenceRoot,'api-case-'));
 let server,origin,token,calls=0;const stopped=new Set();
 const forbidden=async()=>{calls++;throw new Error('Synthetic audit forbids model calls');};
 const arkClient={inspect:forbidden,test:forbidden,prepareRules:forbidden,prepareImportMapping:forbidden,prepareConversationCleaning:forbidden,translate:forbidden};
 async function stop(){if(!server||stopped.has(server))return;const current=server;await new Promise((resolve,reject)=>current.close(error=>error?reject(error):resolve()));stopped.add(current);}
 async function start(){server=await createWorkbenchServer({dataDir,arkClient,catalogSeed:null});server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;token=(await(await fetch(origin+'/api/workspace')).json()).token;}
 t.after(async()=>{await stop();assert.equal(calls,0);assert.ok(dataDir.startsWith(evidenceRoot+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 await start();
 async function request(route,{method='GET',body,headers={},raw}={}){
  const response=await fetch(origin+route,{method,headers:{Origin:origin,'X-Workspace-Token':token,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{}),...(raw!==undefined?{body:raw}:{})});
  const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,body:value,headers:response.headers};
 }
 async function api(route,options){const response=await request(route,options);if(response.status>=400){const error=new Error(response.body.error||`HTTP ${response.status}`);error.status=response.status;throw error;}return response.body;}
 async function uploadSource(file){const response=await fetch(origin+'/api/sources',{method:'POST',headers:{Origin:origin,'X-Workspace-Token':token,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:new Uint8Array(await file.arrayBuffer())});assert.equal(response.status,201);return response.json();}
 async function readSource(sha){const response=await fetch(origin+`/api/sources/${sha}`);assert.equal(response.status,200);return response.arrayBuffer();}
 return {dataDir,request,api,uploadSource,readSource,stop,restart:async()=>{await stop();await start();},get origin(){return origin;},get token(){return token;},get calls(){return calls;}};
}
async function xlsxFile(text='Synthetic customer message',name='synthetic-source.xlsx'){
 const bytes=await workbook([{name:'Synthetic',headers:['会话ID','客服','消息详情'],rows:[['SYN-API-001','Synthetic agent',text]]}]);return new File([bytes],name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function manager(f,initial){
 let current=initial;const toasts=[];
 const context={api:f.api,getDialog:()=>current,openDialog:value=>{current=value;},closeDialog:()=>{current=null;},renderDialog:()=>{},toast:message=>toasts.push(message),uploadSource:f.uploadSource,readSource:f.readSource,getRuleVersions:()=>[{id:'synthetic-version'}],prepareRestored:value=>value};
 return {drafts:createImportDraftManager(context),context,get current(){return current;},set current(value){current=value;},toasts};
}
async function cleaningFlow(f){
 const file=await xlsxFile(),parent={type:'new-task',mode:'manual',scene,step:1,name:'Synthetic parent',reviewer:'Synthetic reviewer',file};
 const m=manager(f,parent);await m.drafts.save(parent);
 const cleaning=createConversationCleaningManager({...m.context,getState:()=>createBusinessState(),getModelConfig:()=>({configured:false}),prepareConversationCleaning:async()=>{throw new Error('No model call allowed');}});
 await cleaning.action('cleaning-open');const child=m.current;assert.equal(child.type,'conversation-cleaning');assert.equal(child.error,'');
 const row=child.draft.rows[0].row;let draft=child.draft;
 for(const [index,field,value] of [[0,'kind','message'],[0,'role','客户'],[null,'startedAt',now],[null,'completeness','完整']])draft=updateCleaningField(draft,row,index,field,value,{reason:`Synthetic retained ${field} reason`,now});
 child.draft=confirmCleaningRow(draft,row,{reviewer:'Synthetic reviewer',now});await m.drafts.save(child);return {m,cleaning,parent,child};
}

test('HTTP source/archive/restart/resume/CAS/complete lifecycle keeps one source-bound task and zero model calls',async t=>{
 const f=await fixture(t),file=await xlsxFile(),source=await f.uploadSource(file),id=freshId(),payload={type:'new-task',scene,name:'Synthetic API draft',step:2,reviewer:'Synthetic reviewer',mapping:{columns:{id:'会话ID'}},draft:{rows:[{confirmed:true,manual:{reason:'Synthetic manual reason'}}]}};
 let response=await f.request(`/api/import-drafts/${id}`,{method:'PUT',body:sourceRequest(source,payload)});assert.equal(response.status,200);assert.equal(response.body.draft.revision,1);assert.equal(response.headers.get('cache-control'),'no-store');
 const oldToken=f.token;await f.restart();assert.notEqual(f.token,oldToken);
 response=await f.request(`/api/import-drafts/${id}`,{headers:{'X-Workspace-Token':oldToken}});assert.equal(response.status,403);
 const restored=(await f.api(`/api/import-drafts/${id}`)).draft;assert.equal(restored.revision,1);assert.deepEqual(restored.payload,payload);assert.deepEqual(Buffer.from(await f.readSource(source.sha256)),Buffer.from(await file.arrayBuffer()));
 const resumed=(await f.api(`/api/import-drafts/${id}/resume`,{method:'POST',body:{baseRevision:1}})).draft;assert.equal(resumed.revision,2);assert.deepEqual(resumed.audit.map(event=>event.action),['save','resume']);
 response=await f.request(`/api/import-drafts/${id}`,{method:'PUT',body:sourceRequest(source,{...payload,name:'Stale overwrite'},1)});assert.equal(response.status,409);assert.equal((await f.api(`/api/import-drafts/${id}`)).draft.payload.name,payload.name);
 const catalog=createCatalog(),state=createImportedTask(createBusinessState(),{name:'Synthetic actual imported task',source,reviewer:'Synthetic reviewer',sessions,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-11',ruleIds:['R001'],now}),now});
 response=await f.request('/api/workspace',{method:'PUT',body:{baseRevision:0,mutationId:'synthetic-http-task',state,catalog}});assert.equal(response.status,200,response.body.error);
 const taskId=state.tasks[0].id;const completed=(await f.api(`/api/import-drafts/${id}/complete`,{method:'POST',body:{baseRevision:2,taskId}})).draft;assert.equal(completed.status,'completed');assert.equal(completed.revision,3);assert.equal(completed.taskId,taskId);
 assert.deepEqual(completed.audit.map(event=>event.action),['save','resume','complete']);assert.equal((await f.api('/api/workspace')).state.tasks.length,1);
 await f.restart();assert.equal((await f.api(`/api/import-drafts/${id}`)).draft.status,'completed');assert.equal((await f.api('/api/workspace')).state.tasks.length,1);assert.equal(f.calls,0);
});

test('draft HTTP routes require current token and origin and never reveal snapshot text to rejected callers',async t=>{
 const f=await fixture(t),source=await f.uploadSource(new File(['Synthetic private original'],'synthetic-private.txt')),id=freshId();
 await f.api(`/api/import-drafts/${id}`,{method:'PUT',body:sourceRequest(source,{type:'new-task',name:'Synthetic private batch',secretRows:['Synthetic private body']})});
 for(const route of ['/api/import-drafts',`/api/import-drafts/${id}`])for(const headers of [{'X-Workspace-Token':''},{'X-Workspace-Token':'0'.repeat(64)},{Origin:'https://synthetic.invalid'}]){const response=await f.request(route,{headers});assert.equal(response.status,403);assert.ok(!JSON.stringify(response.body).includes('Synthetic private'));}
 for(const options of [{headers:{Origin:''}},{headers:{'X-Workspace-Token':'0'.repeat(64)}}])assert.equal((await f.request(`/api/import-drafts/${id}/resume`,{method:'POST',body:{baseRevision:1},...options})).status,403);
 assert.equal((await f.request(`/api/import-drafts/${id}/resume`,{method:'POST',body:{baseRevision:1},headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await f.request(`/api/import-drafts/${id}`,{method:'POST',body:{}})).status,405);
 const listed=(await f.api('/api/import-drafts')).drafts[0];assert.deepEqual(Object.keys(listed).sort(),['id','revision','kind','sourceName','scene','name','status','updatedAt'].sort());assert.ok(!JSON.stringify(listed).includes('Synthetic private body'));
});

test('HTTP payload secret rejection and discarded tombstones preserve prior accepted state',async t=>{
 const f=await fixture(t),source=await f.uploadSource(new File(['Synthetic source'],'synthetic.txt')),id=freshId();await f.api(`/api/import-drafts/${id}`,{method:'PUT',body:sourceRequest(source,{type:'input-mapping',name:'Synthetic preserved mapping',rows:['Synthetic content']},0,'input-mapping')});
 for(const payload of [{apiKey:'synthetic-secret'},{token:'synthetic-token'},{password:'synthetic-password'},{consent:true},{config:{baseUrl:'https://synthetic.invalid'}}]){const response=await f.request(`/api/import-drafts/${id}`,{method:'PUT',body:sourceRequest(source,payload,1,'input-mapping')});assert.equal(response.status,400);assert.ok(!JSON.stringify(response.body).includes('synthetic-secret'));}
 assert.equal((await f.api(`/api/import-drafts/${id}`)).draft.payload.name,'Synthetic preserved mapping');
 const discarded=(await f.api(`/api/import-drafts/${id}/discard`,{method:'POST',body:{baseRevision:1}})).draft;assert.equal(discarded.status,'discarded');assert.equal(discarded.payload,null);
 await f.restart();assert.equal((await f.api(`/api/import-drafts/${id}`)).draft.status,'discarded');assert.equal((await f.request(`/api/import-drafts/${id}/resume`,{method:'POST',body:{baseRevision:2}})).status,409);
});

test('workspace client draft requests bypass a slow model-request queue while retaining the workspace token',async t=>{
 let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),requests=[];
 t.after(()=>release());
 // A minimal initialized workspace response keeps this check independent of
 // workspace bootstrapping writes and exercises the actual client request paths.
 let bootstrapped=false;const docs={initialized:true,revision:1,state:createBusinessState(),catalog:createCatalog(),token:'a'.repeat(64)};
 const other=createWorkspaceClient({fetchImpl:async(url,options={})=>{requests.push({url,options});if(url==='/api/workspace'){bootstrapped=true;return Response.json(docs);}if(url==='/api/model/config'){entered();await gate;return Response.json({configured:false});}if(url==='/api/import-drafts')return Response.json({drafts:[]});throw new Error(`Unexpected route ${url}`);}});
 await other.load();assert.equal(bootstrapped,true);const slow=other.readModelConfig();await started;
 const fast=await Promise.race([other.importDraftRequest('/api/import-drafts'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('draft request was blocked behind model queue')),500))]);assert.deepEqual(fast,{drafts:[]});release();await slow;
 assert.equal(requests.find(request=>request.url==='/api/import-drafts').options.headers['X-Workspace-Token'],docs.token);
});

test('manager save and explicit resume restore source bytes, confirmations and shared parent revisions',async t=>{
 const f=await fixture(t),flow=await cleaningFlow(f),id=flow.child._importDraft.id;
 assert.equal(flow.parent._importDraft,flow.child._importDraft);assert.equal(flow.parent._importDraft.revision,2);
 const snapshot=importDraftSnapshot({...flow.child,consent:true,config:{apiKey:'synthetic-secret'},modelConfig:{apiKey:'synthetic-secret'},conversion:{consent:true,modelConfig:{apiKey:'synthetic-secret'}}});assert.ok(!JSON.stringify(snapshot).includes('synthetic-secret'));assert.equal(snapshot.consent,false);
 const plain=restoreImportDraft(snapshot,flow.child.file);assert.equal(plain.consent,false);assert.equal(plain.returnDialog.consent,false);
 await f.restart();flow.m.current={type:'import-drafts-list',items:[],error:''};await flow.m.drafts.action('import-draft-resume',{dataset:{id}});
 const restored=flow.m.current;assert.equal(restored.type,'conversation-cleaning');assert.equal(restored._importDraft,restored.returnDialog._importDraft);assert.equal(restored._importDraft.revision,3);assert.equal(restored.draft.rows[0].confirmed,true);assert.equal(restored.draft.rows[0].manual.startedAt.reason,'Synthetic retained startedAt reason');assert.deepEqual(Buffer.from(await restored.file.arrayBuffer()),Buffer.from(await flow.child.file.arrayBuffer()));assert.equal(f.calls,0);
});

test('a realistic 100-row synthetic cleaning snapshot round-trips through the HTTP size budget',async t=>{
 const f=await fixture(t),text='Synthetic customer message without model calls. '.repeat(40),bytes=await workbook([{name:'Synthetic',headers:['会话ID','客服','消息详情'],rows:Array.from({length:100},(_,index)=>[`SYN-${index}`,'Synthetic agent',text])}]);
 const file=new File([bytes],'synthetic-100-row.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),parent={type:'new-task',mode:'manual',scene,file,name:'Synthetic realistic snapshot',reviewer:'Synthetic reviewer'},m=manager(f,parent);
 await m.drafts.save(parent);const cleaning=createConversationCleaningManager({...m.context,getState:()=>createBusinessState(),getModelConfig:()=>({configured:false})});await cleaning.action('cleaning-open');const child=m.current;assert.equal(child.draft.rows.length,100);
 const payloadBytes=Buffer.byteLength(JSON.stringify(importDraftSnapshot(child))),started=performance.now(),saved=await m.drafts.save(child),saveMs=performance.now()-started;assert.ok(payloadBytes<8*1024*1024);
 await f.restart();const readStarted=performance.now(),restored=(await f.api(`/api/import-drafts/${saved.id}`)).draft,readMs=performance.now()-readStarted;assert.equal(restored.payload.draft.rows.length,100);assert.equal(digest(await f.readSource(restored.source.sha256)),digest(bytes));
 t.diagnostic(JSON.stringify({syntheticRows:100,sourceBytes:bytes.length,payloadBytes,saveMs:Math.round(saveMs),readAfterRestartMs:Math.round(readMs),modelCalls:f.calls}));
});

test('returning to the parent dialog must keep confirmed cleaning progress in the persisted import flow',async t=>{
 const f=await fixture(t),flow=await cleaningFlow(f),id=flow.child._importDraft.id;
 await flow.cleaning.action('cleaning-close');assert.equal(flow.m.current,flow.parent);await flow.m.drafts.save(flow.parent);
 const persisted=(await f.api(`/api/import-drafts/${id}`)).draft;assert.ok(JSON.stringify(persisted.payload).includes('Synthetic retained startedAt reason'),'parent autosave overwrote the only persisted confirmed cleaning snapshot');
});

test('parent recovery after restart can continue its retained conversion with the same source and manual confirmations',async t=>{
 const f=await fixture(t),flow=await cleaningFlow(f),id=flow.parent._importDraft.id;await flow.cleaning.action('cleaning-close');await flow.m.drafts.save(flow.parent);await f.restart();
 flow.m.current={type:'import-drafts-list',items:[],error:''};await flow.m.drafts.action('import-draft-resume',{dataset:{id}});const restoredParent=flow.m.current;assert.equal(restoredParent.type,'new-task');assert.ok(restoredParent.retainedConversion);
 // These exported restore operations are the same sequence used by app.mjs's
 // import-ai-convert branch; this is a Node lifecycle test, not browser UI QA.
 const conversion=restoreImportDraft(restoredParent.retainedConversion,restoredParent.file);conversion.returnDialog=restoredParent;conversion._importDraft=restoredParent._importDraft;flow.m.current=conversion;
 assert.equal(conversion.draft.rows[0].confirmed,true);assert.equal(conversion.draft.rows[0].manual.startedAt.reason,'Synthetic retained startedAt reason');assert.equal(conversion.consent,false);assert.equal(digest(await conversion.file.arrayBuffer()),digest(await flow.child.file.arrayBuffer()));
 const saved=await flow.m.drafts.save(conversion);assert.equal(saved.id,id);assert.equal(saved.kind,'conversation-cleaning');assert.equal(saved.source.sha256,flow.child._importDraft.source.sha256);assert.equal(f.calls,0);
});

test('starting a fresh cleaning file must bind its actual source bytes rather than reuse the former draft source',async t=>{
 const f=await fixture(t),flow=await cleaningFlow(f),previousId=flow.child._importDraft.id,newFile=await xlsxFile('Different synthetic message','different-synthetic.xlsx');
 await flow.cleaning.action('cleaning-new-draft');await flow.cleaning.change({target:{id:'cleaning-file',files:[newFile]}});const fresh=flow.m.current;assert.equal(fresh.file,newFile);assert.equal(fresh.error,'');
 const saved=await flow.m.drafts.save(fresh);assert.equal(digest(await f.readSource(saved.source.sha256)),digest(await newFile.arrayBuffer()),'new file progress was saved against old source bytes');assert.notEqual(saved.id,previousId,'new cleaning flow must retain the old confirmed draft independently');
});

test('returning from a fresh cleaning file cannot attach its conversion to the former file parent',async t=>{
 const f=await fixture(t),flow=await cleaningFlow(f),newFile=await xlsxFile('Different synthetic message','different-synthetic.xlsx');await flow.cleaning.action('cleaning-new-draft');await flow.cleaning.change({target:{id:'cleaning-file',files:[newFile]}});await flow.m.drafts.save(flow.m.current);await flow.cleaning.action('cleaning-close');
 const owner=flow.m.current;if(!owner)return;
 if(owner.retainedConversion){assert.equal(digest(await owner.file.arrayBuffer()),digest(await newFile.arrayBuffer()),'parent retains a conversion from the new file but restores it using the former file bytes');}
});

test('mapping-to-task handoff must retain its draft identity so completion cannot orphan a resumable mapping',async t=>{
 const f=await fixture(t),file=await xlsxFile(),dialog={type:'input-mapping',businessScene:scene,file,profile:{scene,ruleIds:['R001']},preview:{valid:true,sessions,importMappingSnapshot:{profile:{id:'Synthetic profile'}}}},m=manager(f,dialog);await m.drafts.save(dialog);let handoff;
 const importer=createImportManager({...m.context,getState:()=>createBusinessState(),getCatalog:()=>createCatalog(),beginMappedTask:value=>{handoff=value;}});assert.equal(await importer.action('input-begin'),true);assert.ok(handoff,'mapping did not hand off');assert.equal(handoff.importDraft?.id,dialog._importDraft.id,'mapping draft identity was dropped before the final task dialog');
});

test('a replacement input-mapping file cannot reuse metadata from the previously saved workbook',async t=>{
 const f=await fixture(t),file=await xlsxFile(),newFile=await xlsxFile('Different synthetic mapping source','different-mapping.xlsx'),dialog={type:'input-mapping',businessScene:scene,file,profile:{scene,ruleIds:['R001']},preview:null},m=manager(f,dialog);await m.drafts.save(dialog);const previousId=dialog._importDraft.id;
 let finished;const inspected=new Promise(resolve=>finished=resolve),importer=createImportManager({...m.context,getState:()=>createBusinessState(),getCatalog:()=>createCatalog(),renderDialog:()=>{if(dialog.file===newFile&&!dialog.loading)finished();}});
 let deadline;const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('synthetic mapping inspection did not finish')),10000);deadline.unref?.();});t.after(()=>clearTimeout(deadline));
 assert.equal(importer.change({target:{id:'input-file',files:[newFile]}}),true);await Promise.race([inspected,timeout]);clearTimeout(deadline);assert.equal(dialog.error,'');
 const saved=await m.drafts.save(dialog);assert.equal(digest(await f.readSource(saved.source.sha256)),digest(await newFile.arrayBuffer()),'replacement mapping progress was bound to the original workbook');assert.notEqual(saved.id,previousId,'old mapping draft must remain separately resumable');
});

test('mapping replacement reports an old-draft save failure while preserving its source and avoiding unhandled rejection',async()=>{
 // Isolate the unhandled-rejection observation from node:test's own worker; the
 // child is a plain local Node process and performs no model or network action.
 const moduleUrl=new URL('../public/import-manager.mjs',import.meta.url).href;
 const script=`import {createImportManager} from ${JSON.stringify(moduleUrl)};
 const oldFile=new File(['Synthetic original'],'synthetic-original.xlsx'),newFile=new File(['Synthetic replacement'],'synthetic-replacement.xlsx');
 const draft={type:'input-mapping',file:oldFile,profile:{scene:'新品产品咨询'},_importDraft:{id:'import-00000000-0000-4000-8000-000000000001',revision:1},error:''};let unhandled=null;
 process.on('unhandledRejection',error=>{unhandled=error.message;});
 const manager=createImportManager({getDialog:()=>draft,saveImportDraft:async()=>{throw new Error('Synthetic prior draft save failure');},renderDialog:()=>{}});
 manager.change({target:{id:'input-file',files:[newFile]}});
 await new Promise(resolve=>setTimeout(resolve,50));
 process.stdout.write(JSON.stringify({unhandled,error:draft.error,fileName:draft.file?.name}));`;
 const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{windowsHide:true,timeout:10000});assert.equal(result.stderr,'');const state=JSON.parse(result.stdout);
 assert.equal(state.unhandled,null,'failed source replacement escaped its UI error boundary');assert.match(state.error,/Synthetic prior draft save failure/);assert.equal(state.fileName,'synthetic-original.xlsx');
});
