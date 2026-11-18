import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInitialState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {freezeScenario} from '../public/scenarios.mjs';

const moduleUrl=new URL('../server/workspace-store.mjs',import.meta.url);
async function api(){assert.ok(existsSync(moduleUrl),'缺少工作区原子持久化模块');return import(moduleUrl);}
async function fixture(t,options={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-store-'));
  const {createWorkspaceStore}=await api();const store=await createWorkspaceStore({dataDir,...options});
  t.after(async()=>{await store.close();await fs.rm(dataDir,{recursive:true,force:true});});
  return {store,dataDir,createWorkspaceStore};
}
function payload(baseRevision=0,mutationId='save-1') {return {baseRevision,mutationId,state:{...createInitialState(),businessMigrationVersion:1},catalog:createCatalog()};}
function normalizedSnapshot(catalog){return {capturedAt:'2026-10-29T10:00:00+08:00',effectiveDate:'2026-10-29',rules:catalog.rules.map(record=>({...structuredClone(record),name:record.title})),policies:catalog.policies.map(record=>({...structuredClone(record),content:record.sections.map(section=>`${section.id} ${section.title}\n${section.text}`).join('\n\n')}))};}
async function manual(store,input=payload()){
  const state=input.state,catalog=input.catalog;
  const basisSnapshot=normalizedSnapshot(catalog),source=await store.putSource(Buffer.from('fixture business original'),'business-fixture.json');
  const id='MANUAL-001',sessionId='MANUAL-001-S1';
  state.tasks.unshift({id,name:'自有原文',createdAt:'2026-10-29T10:00:00+08:00',status:'待人工审核',progress:0,mode:'manual',scene:'新品产品咨询',scenarioSnapshot:structuredClone(freezeScenario(state,'新品产品咨询')),aiStatus:'not_run',basisSnapshot,source,sessionIds:[sessionId]});
  state.sessions.push({id:sessionId,externalId:'BUSINESS-001',taskId:id,scene:'新品产品咨询',turns:[{id:1,role:'客户',text:'请说明售后服务范围'}],expectedRuleIds:catalog.rules.map(r=>r.id),aiResults:[],review:{status:'待审核',reviewer:'人工审核员',completedAt:null,drafts:{},notes:''}});
  return input;
}

test('workspace begins empty and survives close/restart with one atomic document',async t=>{
  const {store,dataDir,createWorkspaceStore}=await fixture(t);
  assert.deepEqual(await store.read(),{initialized:false,revision:0,state:null,catalog:null});
  const first=payload();assert.equal((await store.save(first)).revision,1);await store.close();
  const reopened=await createWorkspaceStore({dataDir});t.after(()=>reopened.close());
  const saved=await reopened.read();assert.equal(saved.revision,1);assert.deepEqual(saved.state,first.state);assert.deepEqual(saved.catalog,first.catalog);
});

test('one directory has one live writer and failed lock acquisition keeps owner lock',async t=>{
  const {store,dataDir,createWorkspaceStore}=await fixture(t);
  await assert.rejects(createWorkspaceStore({dataDir}),/锁|使用|lock/i);
  await assert.rejects(createWorkspaceStore({dataDir}),/锁|使用|lock/i);
  await store.close();const next=await createWorkspaceStore({dataDir});await next.close();
});

test('a dead process lock is recovered while an unrecognized lock remains protected',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-stale-lock-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));const {createWorkspaceStore}=await api();
  const lockPath=path.join(dataDir,'.workspace.lock');await fs.writeFile(lockPath,JSON.stringify({pid:999999999,nonce:'dead-process'}));
  const store=await createWorkspaceStore({dataDir});await store.close();
  await fs.writeFile(lockPath,'unrecognized owner');await assert.rejects(createWorkspaceStore({dataDir}),/锁|lock/i);assert.equal(await fs.readFile(lockPath,'utf8'),'unrecognized owner');
});

test('an actual killed owner can restart without removing the lock of a living process',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-process-lock-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));const {createWorkspaceStore}=await api();
  const code=`import {createWorkspaceStore} from ${JSON.stringify(moduleUrl.href)}; await createWorkspaceStore({dataDir:${JSON.stringify(dataDir)}}); process.stdout.write('locked\\n'); setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`lock child exited early: ${code}`)));});
  const owner=await fs.readFile(path.join(dataDir,'.workspace.lock'),'utf8');await assert.rejects(createWorkspaceStore({dataDir}),/锁/);assert.equal(await fs.readFile(path.join(dataDir,'.workspace.lock'),'utf8'),owner);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const restarted=await createWorkspaceStore({dataDir});await restarted.close();
});

test('stale lock recovery rereads and compares the nonce before unlinking',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-lock-nonce-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));const {createWorkspaceStore}=await api();
  const lockPath=path.join(dataDir,'.workspace.lock');await fs.writeFile(lockPath,JSON.stringify({pid:999999999,nonce:'old'}));let changed=false;
  const fsOps={...fs,open:async(target,...args)=>{const handle=await fs.open(target,...args);if(String(target).endsWith('.recovery')&&!changed){changed=true;await fs.writeFile(lockPath,JSON.stringify({pid:999999999,nonce:'replaced'}));}return handle;}};
  await assert.rejects(createWorkspaceStore({dataDir,fsOps}),/锁|lock/i);assert.equal(JSON.parse(await fs.readFile(lockPath,'utf8')).nonce,'replaced');
});

test('corrupt persisted JSON stays byte-for-byte intact and cannot be overwritten',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-corrupt-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dataDir,'workspace.json'),'{unrecoverable');const {createWorkspaceStore}=await api();
  await assert.rejects(createWorkspaceStore({dataDir}),/损坏|读取|格式/);
  assert.equal(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8'),'{unrecoverable');
});

test('serialized competing writes reject the stale revision without data loss',async t=>{
  const {store}=await fixture(t);const first=payload(),second=payload(0,'save-2');second.state.tasks[0].name='不能覆盖';
  const results=await Promise.allSettled([store.save(first),store.save(second)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results[1].reason.status,409);
  assert.equal((await store.read()).state.tasks[0].name,first.state.tasks[0].name);
});

test('mutation IDs replay safely after later writes and restart, but reject different content',async t=>{
  const {store,dataDir,createWorkspaceStore}=await fixture(t);const first=payload();await store.save(first);
  const second=payload(1,'save-2');second.state.tasks[0].name='后续保存';await store.save(second);
  assert.equal((await store.save(first)).revision,2);await store.close();const next=await createWorkspaceStore({dataDir});t.after(()=>next.close());
  assert.equal((await next.save(first)).revision,2);
  const collision=structuredClone(first);collision.state.tasks[0].name='重复ID不同请求';
  await assert.rejects(next.save(collision),error=>error.status===409);
});

test('idempotency remains valid beyond 256 later saves',async t=>{
  const {store}=await fixture(t),empty={schemaVersion:1,tasks:[],sessions:[],activity:[]};
  const first={baseRevision:0,mutationId:'old-first',state:empty,catalog:createCatalog()};await store.save(first);
  for(let revision=1;revision<258;revision++)await store.save({...first,baseRevision:revision,mutationId:`later-${revision}`});
  assert.equal((await store.save(first)).revision,258);
  await assert.rejects(store.save({...first,baseRevision:258}),error=>error.status===409);
});

test('rename failure leaves disk and memory at the preceding revision and allows retry',async t=>{
  let failRename=false;const operations={...fs,rename:async(...args)=>{if(failRename&&String(args[1]).endsWith('workspace.json'))throw new Error('simulated disk failure');return fs.rename(...args);}};
  const {store,dataDir}=await fixture(t,{fsOps:operations});await store.save(payload());const original=await fs.readFile(path.join(dataDir,'workspace.json'),'utf8');
  failRename=true;const next=payload(1,'save-2');next.state.tasks[0].name='保存失败';await assert.rejects(store.save(next),/保存|failure/);
  assert.equal((await store.read()).revision,1);assert.equal(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8'),original);
  failRename=false;assert.equal((await store.save(next)).revision,2);
});

test('state and catalog validation rejects duplicate IDs, broken joins and malformed review',async t=>{
  const {store}=await fixture(t);
  for(const mutate of [p=>p.state.tasks.push(p.state.tasks[0]),p=>p.state.sessions[0].taskId='missing',p=>p.state.tasks[0].sessionIds=[],p=>p.state.sessions[0].review.drafts=[],p=>p.catalog.rules[0].policyIds=['missing'],p=>p.state.activity.push({id:'bad'})]){
    const p=payload();mutate(p);await assert.rejects(store.save(p),error=>error.status===400);assert.equal((await store.read()).revision,0);
  }
});

test('manual task snapshot, original IDs and turns are frozen while human review can change',async t=>{
  const {store}=await fixture(t);const first=await manual(store);await store.save(first);
  for(const mutate of [p=>p.state.tasks[0].basisSnapshot.policies[0].sections[0].text='改写依据',p=>p.state.sessions.at(-1).turns[0].text='改写原文',p=>p.state.sessions.at(-1).externalId='other',p=>p.state.tasks[0].mode='demo',p=>{p.state.tasks.shift();p.state.sessions.pop();}]){
    const p=structuredClone(first);p.baseRevision=1;p.mutationId=crypto.randomUUID();mutate(p);await assert.rejects(store.save(p),error=>error.status===400);
  }
  const updated=structuredClone(first);updated.baseRevision=1;updated.mutationId='review-change';updated.state.sessions.at(-1).review.notes='待业务确认';assert.equal((await store.save(updated)).revision,2);
});

test('manual confirmation rejects first-empty and partial judgments but keeps them editable',async t=>{
  const {store}=await fixture(t);
  for(const partial of [false,true]){
    const first=await manual(store),session=first.state.sessions.at(-1);session.review.status='已确认';session.review.reviewer='本地审核员';session.review.completedAt='2026-10-29T16:30:00+08:00';
    if(partial)session.review.drafts.R001={ruleId:'R001',verdict:'符合',reason:'逐项人工核验',evidence:[1],referenceIds:[]};
    await assert.rejects(store.save(first),error=>error.status===400);assert.equal((await store.read()).revision,0);
  }
});

test('manual unknown judgments cannot become final confirmation',async t=>{
  const {store}=await fixture(t),first=await manual(store),session=first.state.sessions.at(-1);
  for(const ruleId of session.expectedRuleIds)session.review.drafts[ruleId]={ruleId,verdict:'无法判定',reason:'缺少必要材料',evidence:[],referenceIds:[]};
  session.review.status='已确认';session.review.reviewer='本地审核员';session.review.completedAt='2026-10-29T16:30:00+08:00';
  await assert.rejects(store.save(first),error=>error.status===400);
  session.review.status='待补充';session.review.completedAt=null;assert.equal((await store.save(first)).revision,1);
});

test('manual confirmation requires a real zoned completion time and a nonempty reviewer',async t=>{
  const {store}=await fixture(t);
  for(const invalid of [null,'not-a-date','2026-10-29T16:30:00','2026-02-30T16:30:00+08:00','2026-10-29T25:30:00+08:00','2026-10-29T16:30:00+15:00']){
    const first=await manual(store),session=first.state.sessions.at(-1);
    for(const ruleId of session.expectedRuleIds)session.review.drafts[ruleId]={ruleId,verdict:'符合',reason:'已按冻结依据人工核验',evidence:[1],referenceIds:[]};
    session.review.status='已确认';session.review.completedAt=invalid;await assert.rejects(store.save(first),error=>error.status===400);
  }
  const first=await manual(store),session=first.state.sessions.at(-1);for(const ruleId of session.expectedRuleIds)session.review.drafts[ruleId]={ruleId,verdict:'符合',reason:'人工核验',evidence:[1],referenceIds:[]};
  session.review.status='已确认';session.review.completedAt='2026-10-29T16:30:00+08:00';session.review.reviewer='  ';await assert.rejects(store.save(first),error=>error.status===400);
});

test('complete manual review saves and nonfinal records require null completedAt while demo compatibility remains',async t=>{
  const {store}=await fixture(t),first=await manual(store),session=first.state.sessions.at(-1);
  for(const ruleId of session.expectedRuleIds)session.review.drafts[ruleId]={ruleId,verdict:'符合',reason:'已按冻结依据人工核验',evidence:[1],referenceIds:[]};
  session.review.status='已确认';session.review.completedAt='2026-10-29T16:30:00+08:00';session.review.reviewer='本地审核员';
  assert.equal((await store.save(first)).revision,1);
  const nonfinal=structuredClone(first);nonfinal.baseRevision=1;nonfinal.mutationId='nonfinal';nonfinal.state.sessions.at(-1).review.status='已暂存';await assert.rejects(store.save(nonfinal),error=>error.status===400);
  nonfinal.state.sessions.at(-1).review.completedAt=null;assert.equal((await store.save(nonfinal)).revision,2);
  const oldDemo=structuredClone(nonfinal);oldDemo.baseRevision=2;oldDemo.mutationId='demo-compatibility';oldDemo.state.sessions[0].review={status:'已确认',reviewer:'',completedAt:null,drafts:{},notes:''};
  assert.equal((await store.save(oldDemo)).revision,3);
});

test('closing refuses new writes before releasing its lock and never leaves an old writer behind',async t=>{
  let entered,unblock;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>unblock=resolve);let delayed=false;
  const operations={...fs,rename:async(...args)=>{if(!delayed&&String(args[1]).endsWith('workspace.json')){delayed=true;entered();await gate;}return fs.rename(...args);}};
  const {store,dataDir,createWorkspaceStore}=await fixture(t,{fsOps:operations});t.after(()=>unblock());
  const accepted=store.save(payload());await started;const closing=store.close(),repeated=store.close(),sharedClosePromise=closing===repeated;
  const late=store.save(payload(1,'late-save')),lateSource=store.putSource(Buffer.from('late source'),'late.json');
  // Attach rejection handlers before unblocking so a regression cannot become an unhandled rejection.
  const outcomes=Promise.allSettled([late,lateSource]);
  await assert.rejects(createWorkspaceStore({dataDir}),/锁/);
  unblock();await accepted;await closing;await repeated;
  const results=await outcomes;assert.ok(results.every(result=>result.status==='rejected'&&result.reason.status===503));assert.equal(sharedClosePromise,true);
  const restarted=await createWorkspaceStore({dataDir});t.after(()=>restarted.close());const current=await restarted.read();assert.equal(current.revision,1);
  const next=payload(1,'new-owner-save');next.state.tasks[0].name='新写入进程';await restarted.save(next);assert.equal((await restarted.read()).state.tasks[0].name,'新写入进程');
});

test('new arbitrary text cannot masquerade as demo or manufacture AI results',async t=>{
  const {store}=await fixture(t);
  for(const mutate of [p=>p.state.tasks[0].mode='demo',p=>delete p.state.tasks[0].mode,p=>p.state.tasks[0].aiStatus='done',p=>p.state.sessions.at(-1).aiResults.push({ruleId:'R001',verdict:'符合',reason:'伪造',evidence:[],referenceIds:[]}),p=>p.state.sessions.at(-1).expectedRuleIds=[]]){
    const p=await manual(store);mutate(p);await assert.rejects(store.save(p),error=>error.status===400);
  }
});

test('version-qualified human references work and ambiguous or unrelated short IDs are rejected',async t=>{
  const {store}=await fixture(t),first=await manual(store),task=first.state.tasks[0],session=first.state.sessions.at(-1);
  first.catalog.policies[1].sections[0].id='P001-1';task.basisSnapshot=normalizedSnapshot(first.catalog);
  const ref=`${encodeURIComponent('P001')}@V1.0#${encodeURIComponent('P001-1')}`;
  session.review.drafts.R001={ruleId:'R001',verdict:'符合',reason:'按冻结资料人工核验',evidence:[1],referenceIds:[ref],source:'人工修改'};
  assert.equal((await store.save(first)).revision,1);
  for(const reference of ['P001-1','P002-2','P001@V9.0#P001-1']){
    const next=structuredClone(first);next.baseRevision=1;next.mutationId=crypto.randomUUID();next.state.sessions.at(-1).review.drafts.R001.referenceIds=[reference];await assert.rejects(store.save(next),error=>error.status===400);
  }
});

test('source bytes and metadata persist by digest and a task cannot reference a missing file',async t=>{
  const {store}=await fixture(t),bytes=Buffer.from('真实文件字节');const source=await store.putSource(bytes,'业务输入.xlsx');
  assert.match(source.sha256,/^[a-f0-9]{64}$/);assert.equal(source.size,bytes.length);assert.equal(source.name,'业务输入.xlsx');
  assert.deepEqual((await store.getSource(source.sha256)).bytes,bytes);
  const first=await manual(store);first.state.tasks[0].source=source;assert.equal((await store.save(first)).revision,1);
  const missing=await manual(store,payload(1,'missing-source'));missing.state.tasks[0].source={sha256:'a'.repeat(64),name:'unknown.xlsx',size:1};await assert.rejects(store.save(missing),error=>error.status===400);
  await assert.rejects(store.putSource(bytes,'../escape.xlsx'),error=>error.status===400);
  await assert.rejects(store.getSource('../escape'),error=>error.status===400);
});

test('every manual task requires a saved source with valid name and size',async t=>{
  const {store}=await fixture(t);
  for(const mutate of [task=>delete task.source,task=>delete task.source.size,task=>task.source.size=-1,task=>delete task.source.name,task=>task.source.size++,task=>task.source.sha256='b'.repeat(64)]){
    const first=await manual(store);mutate(first.state.tasks[0]);await assert.rejects(store.save(first),error=>error.status===400);assert.equal((await store.read()).revision,0);
  }
});

test('task source metadata must retain the server-returned original filename',async t=>{
  const {store}=await fixture(t),first=await manual(store);
  const source=await store.putSource(Buffer.from('actual source file bytes'),'actual-input.json');first.state.tasks[0].source={...source,name:'forged-input.xlsx'};
  await assert.rejects(store.save(first),error=>error.status===400);assert.equal((await store.read()).revision,0);
  first.state.tasks[0].source=source;
  first.state.tasks[0].fileName='本次导入显示名.xlsx';assert.equal((await store.save(first)).revision,1);
});

test('new manual snapshots must come from the unique published catalog versions effective that day',async t=>{
  const {store}=await fixture(t);
  for(const mutate of [
    p=>p.state.tasks[0].basisSnapshot.rules[0].passCriteria='自造通过标准',
    p=>p.state.tasks[0].basisSnapshot.rules[0].name='自造规则名称',
    p=>p.state.tasks[0].basisSnapshot.policies[0].sections[0].text='自造资料正文',
    p=>p.state.tasks[0].basisSnapshot.policies[0].content='伪造合成正文',
    p=>p.state.tasks[0].basisSnapshot.rules[0].version='V9.0',
    p=>{p.catalog.rules[0].status='草稿';p.catalog.rules[0].publishedAt='';},
    p=>p.catalog.policies[0].status='已停用',
    p=>p.state.tasks[0].basisSnapshot.effectiveDate='2026-09-30',
  ]){
    const first=await manual(store);mutate(first);await assert.rejects(store.save(first),error=>error.status===400);assert.equal((await store.read()).revision,0);
  }
});

test('catalog retirement and closing old dates do not reauthenticate historical snapshots on save or restart',async t=>{
  const {store,dataDir,createWorkspaceStore}=await fixture(t),first=await manual(store);await store.save(first);
  const later=structuredClone(first);later.baseRevision=1;later.mutationId='catalog-lifecycle';
  for(const record of [...later.catalog.rules,...later.catalog.policies]){record.status='已停用';record.expiresAt='2026-10-20';}
  later.state.sessions.at(-1).review.notes='继续复核历史依据';assert.equal((await store.save(later)).revision,2);await store.close();
  const reopened=await createWorkspaceStore({dataDir});t.after(()=>reopened.close());assert.deepEqual((await reopened.read()).state.tasks[0].basisSnapshot,first.state.tasks[0].basisSnapshot);
});

test('source originals survive restart and corrupted bytes cannot be silently replaced',async t=>{
  const {store,dataDir,createWorkspaceStore}=await fixture(t),bytes=Buffer.from('original source');
  const first=await store.putSource(bytes,'source.json');assert.deepEqual(await store.putSource(bytes,'another-name.json'),first);await store.close();
  const restarted=await createWorkspaceStore({dataDir});t.after(()=>restarted.close());assert.deepEqual((await restarted.getSource(first.sha256)).bytes,bytes);
  const storedPath=path.join(dataDir,'sources',first.sha256);await fs.writeFile(storedPath,'damaged');
  await assert.rejects(restarted.getSource(first.sha256),error=>error.status===500);await assert.rejects(restarted.putSource(bytes,'source.json'),error=>error.status===500);
  assert.equal(await fs.readFile(storedPath,'utf8'),'damaged');
});
