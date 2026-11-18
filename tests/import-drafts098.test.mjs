import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {workbook} from '../public/io.mjs';
import {inspectConversationCleaningFile,updateCleaningField,confirmCleaningRow} from '../public/conversation-cleaning.mjs';

const moduleUrl=new URL('../server/import-drafts.mjs',import.meta.url);
const evidenceRoot=path.resolve('../import-draft-store098');
const now='2026-11-11T10:00:00+08:00';
const freshId=()=>`import-${randomUUID()}`;
async function api(){assert.ok(existsSync(moduleUrl),'persistent import draft store is missing');return import(moduleUrl);}
async function fixture(t,options={}){
 await fs.mkdir(evidenceRoot,{recursive:true});
 const dataDir=await fs.mkdtemp(path.join(evidenceRoot,'case-'));
 const workspaces=[],draftStores=[];
 t.after(async()=>{for(const store of draftStores)await store.close();for(const store of workspaces)await store.close();assert.ok(dataDir.startsWith(evidenceRoot+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const {createImportDraftStore}=await api();
 const workspace=await createWorkspaceStore({dataDir});workspaces.push(workspace);
 const store=await createImportDraftStore({dataDir,workspaceStore:workspace,...options});draftStores.push(store);
 const source=await workspace.putSource(Buffer.from('synthetic import source only'),'synthetic-import.txt');
 return {dataDir,workspace,store,source,workspaces,draftStores,createImportDraftStore};
}
const request=(source,payload={name:'Synthetic batch',scene:'新品产品咨询',step:2},baseRevision=0,kind='new-task')=>({baseRevision,kind,source,payload});
const fileFor=(f,id)=>path.join(f.dataDir,'import-drafts',`${id}.json`);
const errorStatus=status=>error=>error.status===status;

test('a complete source-bound snapshot survives a new store and an actual workspace restart',async t=>{
 const f=await fixture(t),id=freshId();
 const bytes=await workbook([{name:'Synthetic',headers:['会话ID','客服','消息详情'],rows:[['SYN-1','Synthetic agent','Synthetic customer message']]}]);
 const source=await f.workspace.putSource(bytes,'synthetic-cleaning.xlsx');
 const file={name:source.name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 const inspected=await inspectConversationCleaningFile(file,{scene:'新品产品咨询',timezone:'+08:00'});assert.equal(inspected.valid,true,inspected.errors.join(';'));
 let cleaningDraft=inspected.draft;const row=cleaningDraft.rows[0].row;
 for(const [index,field,value] of [[0,'kind','message'],[0,'role','客户'],[null,'startedAt',now],[null,'completeness','完整']])cleaningDraft=updateCleaningField(cleaningDraft,row,index,field,value,{reason:`Synthetic manual ${field} reason`,now});
 cleaningDraft=confirmCleaningRow(cleaningDraft,row,{reviewer:'Synthetic reviewer',now});
 const payload={name:'Synthetic batch',scene:cleaningDraft.scene,step:2,reviewPolicy:{confidenceThreshold:0.86},cleaningDraft,mapping:{sheet:'Synthetic',headerRow:1,columns:{id:'会话ID'}}};
 const saved=await f.store.put(id,request(source,payload,0,'conversation-cleaning'));
 assert.equal(saved.revision,1);assert.equal(saved.status,'draft');assert.deepEqual(saved.source,{sha256:source.sha256,name:source.name,size:source.size});
 assert.deepEqual(saved.payload,payload);assert.deepEqual(saved.audit.map(event=>event.action),['save']);
 await f.store.close();await f.workspace.close();
 const workspace=await createWorkspaceStore({dataDir:f.dataDir});f.workspaces.push(workspace);
 const restarted=await f.createImportDraftStore({dataDir:f.dataDir,workspaceStore:workspace});f.draftStores.push(restarted);
 const restored=await restarted.get(id);assert.equal(restored.revision,1);assert.deepEqual(restored.payload,payload);
 assert.equal(restored.payload.cleaningDraft.rows[0].confirmed,true);assert.equal(restored.payload.cleaningDraft.rows[0].manual.startedAt.reason,'Synthetic manual startedAt reason');
 assert.deepEqual((await workspace.getSource(restored.source.sha256)).bytes,Buffer.from(bytes));assert.equal((await workspace.read()).revision,0);
 const resumed=await restarted.resume(id,{baseRevision:1});assert.equal(resumed.revision,2);assert.deepEqual(resumed.audit.map(event=>event.action),['save','resume']);
 assert.ok(resumed.audit.every(event=>Number.isFinite(Date.parse(event.at))));assert.deepEqual(resumed.payload,payload);
});

test('get is read-only and list exposes only the documented safe summary fields',async t=>{
 const f=await fixture(t),id=freshId(),payload={name:'Synthetic draft',scene:'电商评论回复',privateRows:[{text:'Synthetic body'}]};
 await f.store.put(id,request(f.source,payload));const before=await fs.readFile(fileFor(f,id),'utf8');
 const read=await f.store.get(id);read.payload.privateRows[0].text='caller mutation';
 assert.equal((await f.store.get(id)).payload.privateRows[0].text,'Synthetic body');assert.equal(await fs.readFile(fileFor(f,id),'utf8'),before);
 const list=await f.store.list();assert.equal(list.length,1);
 assert.deepEqual(Object.keys(list[0]).sort(),['id','revision','kind','sourceName','scene','name','status','updatedAt'].sort());
 assert.equal(list[0].sourceName,f.source.name);assert.equal(list[0].name,payload.name);assert.equal(list[0].scene,payload.scene);assert.ok(!JSON.stringify(list).includes('Synthetic body'));
});

test('all supported import kinds persist without workspace or model operations',async t=>{
 const f=await fixture(t);let networkCalls=0;const previous=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw new Error('network forbidden');};t.after(()=>{globalThis.fetch=previous;});
 for(const kind of ['new-task','ecommerce-import','conversation-cleaning','input-mapping']){const id=freshId();assert.equal((await f.store.put(id,request(f.source,{name:`Synthetic ${kind}`},0,kind))).kind,kind);}
 assert.equal((await f.store.list()).length,4);assert.equal((await f.workspace.read()).revision,0);assert.equal(networkCalls,0);
});

test('competing saves use revision CAS and preserve the first snapshot',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));
 const results=await Promise.allSettled([f.store.put(id,request(f.source,{name:'Synthetic winner'},1)),f.store.put(id,request(f.source,{name:'Synthetic loser'},1))]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.status,409);
 const saved=await f.store.get(id);assert.equal(saved.revision,2);assert.equal(saved.payload.name,'Synthetic winner');assert.deepEqual(saved.audit.map(event=>event.revision),[1,2]);
 await assert.rejects(f.store.resume(id,{baseRevision:1}),errorStatus(409));await assert.rejects(f.store.discard(id,{baseRevision:1}),errorStatus(409));
});

test('source references must resolve to the exact already-saved file metadata',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));const before=await fs.readFile(fileFor(f,id));
 for(const source of [{...f.source,name:'wrong-name.txt'},{...f.source,size:f.source.size+1},{...f.source,sha256:'a'.repeat(64)},{...f.source,sha256:'../outside'},{...f.source,bytes:[1,2,3]}])await assert.rejects(f.store.put(id,request(source,{name:'bad source'},1)),errorStatus(400));
 assert.deepEqual(await fs.readFile(fileFor(f,id)),before);assert.equal((await f.workspace.read()).revision,0);
});

test('secret, consent and runtime fields are rejected while cleaning audit fields remain serializable',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));const before=await fs.readFile(fileFor(f,id));
 for(const payload of [{nested:{apiKey:'synthetic-secret'}},{token:'synthetic-token'},{access_token:'synthetic-token'},{password:'synthetic-password'},{credentials:{}},{authorization:'Bearer synthetic'},{config:{}},{modelConfig:{}},{runtime:{}},{controller:{}},{returnDialog:{}},{consentBinding:{}},{consent:true},{nested:{consent:true}}])await assert.rejects(f.store.put(id,request(f.source,payload,1)),errorStatus(400));
 assert.deepEqual(await fs.readFile(fileFor(f,id)),before);
 const valid={reviewPolicy:{confidenceThreshold:0.8},consent:false,history:[{operation:'confirm',reviewer:'Synthetic reviewer',at:now}],attempts:[{modelId:'synthetic-no-call',usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}}]};
 assert.deepEqual((await f.store.put(id,request(f.source,valid,1))).payload,valid);
});

test('only bounded plain JSON snapshots are accepted and failed validation preserves the preceding file',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));const before=await fs.readFile(fileFor(f,id));
 const cycle={};cycle.self=cycle;let deep={};for(let i=0;i<45;i++)deep={next:deep};
 const getter={};Object.defineProperty(getter,'value',{enumerable:true,get(){throw new Error('getter must never execute');}});
 for(const payload of [{file:new Blob(['synthetic'])},{when:new Date()},{map:new Map()}, {bytes:Buffer.from('synthetic')},{value:undefined},{value:()=>{}},{value:NaN},{value:Infinity},{value:1n},cycle,deep,getter,JSON.parse('{"__proto__":{"polluted":true}}')])await assert.rejects(f.store.put(id,request(f.source,payload,1)),errorStatus(400));
 await assert.rejects(f.store.put(id,request(f.source,{text:'中'.repeat(3*1024*1024)},1)),errorStatus(413));
 assert.deepEqual(await fs.readFile(fileFor(f,id)),before);
});

test('safe IDs, kinds and nonnegative integral base revisions are mandatory',async t=>{
 const f=await fixture(t);
 for(const id of ['../outside','CON','import-../../escape',randomUUID()+'/child','',null])await assert.rejects(f.store.put(id,request(f.source)),errorStatus(400));
 for(const baseRevision of [-1,0.5,null,'0'])await assert.rejects(f.store.put(freshId(),request(f.source,{},baseRevision)),errorStatus(400));
 await assert.rejects(f.store.put(freshId(),request(f.source,{},0,'other-dialog')),errorStatus(400));
 await assert.rejects(f.store.put(freshId(),{...request(f.source),runtime:{}}),errorStatus(400));
 assert.deepEqual(await f.store.list(),[]);
});

test('atomic replacement failure leaves the preceding snapshot and audit intact and can be retried',async t=>{
 let failRename=false;const fsOps={...fs,rename:async(...args)=>{if(failRename&&String(args[1]).endsWith('.json'))throw new Error('synthetic disk failure');return fs.rename(...args);}};
 const f=await fixture(t,{fsOps}),id=freshId();await f.store.put(id,request(f.source));const before=await fs.readFile(fileFor(f,id));
 failRename=true;await assert.rejects(f.store.put(id,request(f.source,{name:'Synthetic failed write'},1)),errorStatus(500));
 assert.deepEqual(await fs.readFile(fileFor(f,id)),before);assert.equal((await f.store.get(id)).revision,1);assert.deepEqual((await fs.readdir(path.dirname(fileFor(f,id)))).filter(name=>name.endsWith('.tmp')),[]);
 failRename=false;assert.equal((await f.store.put(id,request(f.source,{name:'Synthetic retried write'},1))).revision,2);
});

test('tampered checksums and malformed JSON cannot be read or overwritten',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));const original=await fs.readFile(fileFor(f,id),'utf8');
 for(const tampered of [original.replace('Synthetic batch','Tampered batch'),'{broken-json']){
  await fs.writeFile(fileFor(f,id),tampered);
  await assert.rejects(f.store.get(id),errorStatus(500));await assert.rejects(f.store.list(),errorStatus(500));await assert.rejects(f.store.put(id,request(f.source,{name:'do not overwrite'},1)),errorStatus(500));
  assert.equal(await fs.readFile(fileFor(f,id),'utf8'),tampered);
 }
});

test('a valid checksum cannot bypass persisted source or audit validation',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));const original=JSON.parse(await fs.readFile(fileFor(f,id),'utf8'));
 for(const mutate of [draft=>{draft.source.name='wrong-synthetic-source.txt';},draft=>{draft.audit[0].revision=9;},draft=>{draft.payload.token='synthetic-token';},draft=>{draft.id=freshId();}]){
  const value=structuredClone(original);mutate(value.draft);value.sha256=createHash('sha256').update(JSON.stringify(value.draft)).digest('hex');const tampered=JSON.stringify(value);await fs.writeFile(fileFor(f,id),tampered);
  await assert.rejects(f.store.get(id),errorStatus(500));await assert.rejects(f.store.put(id,request(f.source,{},1)),errorStatus(500));assert.equal(await fs.readFile(fileFor(f,id),'utf8'),tampered);
 }
});

test('a symlinked import-drafts directory is rejected without touching its external target',async t=>{
 const f=await fixture(t);await f.store.close();const drafts=path.join(f.dataDir,'import-drafts'),outside=path.join(f.dataDir,'outside-synthetic');await fs.mkdir(outside);await fs.rmdir(drafts);await fs.writeFile(path.join(outside,'keep.txt'),'synthetic keep');
 try{await fs.symlink(outside,drafts,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip(`directory symlink unavailable: ${error.code}`);return;}throw error;}
 await assert.rejects(f.createImportDraftStore({dataDir:f.dataDir,workspaceStore:f.workspace}),errorStatus(500));assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'synthetic keep');
 await fs.unlink(drafts);
});

test('runtime replacement of the data directory by a junction is rejected on the next operation',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));const drafts=path.join(f.dataDir,'import-drafts'),original=path.join(f.dataDir,'saved-synthetic-drafts'),outside=path.join(f.dataDir,'outside-synthetic');await fs.mkdir(outside);await fs.rename(drafts,original);
 try{await fs.symlink(outside,drafts,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){await fs.rename(original,drafts);t.skip(`directory symlink unavailable: ${error.code}`);return;}throw error;}
 await assert.rejects(f.store.list(),errorStatus(500));await assert.rejects(f.store.get(id),errorStatus(500));await assert.rejects(f.store.put(freshId(),request(f.source)),errorStatus(500));assert.deepEqual(await fs.readdir(outside),[]);
 await fs.unlink(drafts);await fs.rename(original,drafts);
});

test('completion requires a real saved task bound to the current source and never creates tasks',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source));
 await assert.rejects(f.store.complete(id,{baseRevision:1,taskId:'missing-synthetic-task'}),errorStatus(404));
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-11',ruleIds:['R001'],now});
 const sessions=[{id:'SYN-001',scene:'新品产品咨询',startedAt:now,agent:'Synthetic agent',completeness:'完整',turns:[{id:1,role:'客户',text:'Synthetic original request'}]}];
 const state=createImportedTask(createBusinessState(),{name:'Synthetic actual task',sessions,source:f.source,basisSnapshot,reviewer:'Synthetic reviewer',now});
 const saved=await f.workspace.save({baseRevision:0,mutationId:'synthetic-task-create',state,catalog}),taskId=saved.state.tasks[0].id;
 const otherSource=await f.workspace.putSource(Buffer.from('different synthetic file'),'other-synthetic.txt'),otherId=freshId();await f.store.put(otherId,request(otherSource));
 await assert.rejects(f.store.complete(otherId,{baseRevision:1,taskId}),errorStatus(400));
 const completed=await f.store.complete(id,{baseRevision:1,taskId});assert.equal(completed.revision,2);assert.equal(completed.status,'completed');assert.equal(completed.taskId,taskId);assert.equal(completed.audit.at(-1).action,'complete');assert.equal(completed.audit.at(-1).taskId,taskId);
 assert.equal((await f.workspace.read()).revision,saved.revision);assert.equal((await f.workspace.read()).state.tasks.length,1);assert.equal((await f.store.list()).find(draft=>draft.id===id).status,'completed');
 await assert.rejects(f.store.put(id,request(f.source,{},2)),errorStatus(409));await assert.rejects(f.store.resume(id,{baseRevision:2}),errorStatus(409));
});

test('discard clears payload, keeps source and audit, and cannot be silently resurrected',async t=>{
 const f=await fixture(t),id=freshId();await f.store.put(id,request(f.source,{name:'Synthetic discarded draft',privateRows:['synthetic private text']}));
 const discarded=await f.store.discard(id,{baseRevision:1});assert.equal(discarded.status,'discarded');assert.equal(discarded.revision,2);assert.equal(discarded.payload,null);assert.deepEqual(discarded.audit.map(event=>event.action),['save','discard']);
 const bytes=await fs.readFile(fileFor(f,id),'utf8');assert.ok(!bytes.includes('synthetic private text'));assert.equal((await f.store.list())[0].status,'discarded');assert.equal((await f.workspace.getSource(f.source.sha256)).name,f.source.name);
 await assert.rejects(f.store.put(id,request(f.source,{},2)),errorStatus(409));await assert.rejects(f.store.resume(id,{baseRevision:2}),errorStatus(409));
 await f.store.close();const restarted=await f.createImportDraftStore({dataDir:f.dataDir,workspaceStore:f.workspace});f.draftStores.push(restarted);assert.equal((await restarted.get(id)).status,'discarded');
});

test('closing drains accepted writes before rejecting all subsequent operations',async t=>{
 const f=await fixture(t),id=freshId(),accepted=f.store.put(id,request(f.source));const closing=f.store.close();assert.equal(closing,f.store.close());
 const rejected=Promise.allSettled([f.store.put(freshId(),request(f.source)),f.store.get(id),f.store.list(),f.store.resume(id,{baseRevision:1})]);
 assert.equal((await accepted).revision,1);await closing;assert.ok((await rejected).every(result=>result.status==='rejected'&&result.reason.status===503));
 const restarted=await f.createImportDraftStore({dataDir:f.dataDir,workspaceStore:f.workspace});f.draftStores.push(restarted);assert.equal((await restarted.get(id)).revision,1);
});

test('accepted operations capture their JSON arguments before callers can mutate them',async t=>{
 const f=await fixture(t),id=freshId(),value=request({...f.source},{name:'Synthetic captured name'});
 const accepted=f.store.put(id,value);value.payload.name='Later caller mutation';value.source.name='Later caller mutation.txt';value.baseRevision=9;
 const saved=await accepted;assert.equal(saved.payload.name,'Synthetic captured name');assert.equal(saved.source.name,f.source.name);
 const options={baseRevision:1},resuming=f.store.resume(id,options);options.baseRevision=0;assert.equal((await resuming).revision,2);
});

test('array subclasses cannot execute inherited serialization hooks',async t=>{
 const f=await fixture(t),id=freshId();let calls=0;
 class RuntimeArray extends Array{toJSON(){calls++;return ['synthetic serialization hook'];}}
 await assert.rejects(f.store.put(id,request(f.source,{rows:new RuntimeArray('synthetic')})),errorStatus(400));assert.equal(calls,0);assert.deepEqual(await f.store.list(),[]);
});

test('source files linked outside their content-addressed slot are refused before saving a draft',async t=>{
 const f=await fixture(t),id=freshId(),sourcePath=path.join(f.dataDir,'sources',f.source.sha256),outside=path.join(f.dataDir,'outside-synthetic-source');
 await fs.link(sourcePath,outside);
 await assert.rejects(f.store.put(id,request(f.source)),errorStatus(500));assert.deepEqual(await f.store.list(),[]);assert.equal(await fs.readFile(outside,'utf8'),'synthetic import source only');
});
