import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import * as domain from '../public/domain.mjs';
import * as catalogs from '../public/catalog.mjs';
import * as ec from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceClient} from '../public/workspace-client.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {migrateBusinessWorkspace} from '../public/business-state.mjs';
import {loadCatalog} from '../public/catalog-controller.mjs';

const response=value=>({ok:true,status:200,json:async()=>structuredClone(value)});
const fixtureRoot=path.resolve('outputs/service-business-upgrade-20261103/state-test-tmp');
async function fixtureDir(t){await fs.mkdir(fixtureRoot,{recursive:true});const dir=await fs.mkdtemp(path.join(fixtureRoot,'case-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

function oldBusinessFixture(){
  const catalog=catalogs.createCatalog(),state=domain.createInitialState();
  const basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:['R001'],now:'2026-10-30T10:00:00+08:00'});
  const source={name:'真实导入.json',size:8,sha256:'a'.repeat(64)};
  const manual=domain.createImportedTask(state,{name:'应保留的业务批次',source,basisSnapshot,reviewer:'业务审核人',now:'2026-10-30T10:00:00+08:00',sessions:[{id:'REAL-001',scene:'新品产品咨询',startedAt:'2026-10-30T09:00:00+08:00',completeness:'完整',turns:[{id:1,role:'客户',text:'真实导入原文'}],reference:{originalHumanColumns:['原人工参考应保留']}}]});
  manual.sessions.at(-1).review.drafts.R001={ruleId:'R001',verdict:'符合',reason:'已人工核对',evidence:[1],referenceIds:['P001-1']};
  const task=manual.tasks[0],session=manual.sessions.at(-1);task.aiStatus='completed';
  task.aiRun={id:'retained-run',modelId:'fixture-model',status:'completed',total:1,done:1,failed:0,startedAt:'2026-10-30T10:05:00+08:00',completedAt:'2026-10-30T10:06:00+08:00'};
  session.aiExecution={status:'completed',runId:'retained-run',modelId:'fixture-model',startedAt:task.aiRun.startedAt,completedAt:task.aiRun.completedAt};
  session.aiResults=[{ruleId:'R001',verdict:'无法判定',reason:'应保留的AI原结论',evidence:[1],referenceIds:['P001-1']}];
  return {state:manual,catalog};
}

test('business initializers are empty while explicit legacy fixtures remain available',()=>{
  assert.equal(typeof domain.createBusinessState,'function');assert.equal(typeof catalogs.createBusinessCatalog,'function');
  assert.deepEqual(domain.createBusinessState(),{schemaVersion:1,businessMigrationVersion:1,tasks:[],sessions:[],activity:[]});
  assert.deepEqual(catalogs.createBusinessCatalog(),{schemaVersion:1,rules:[],policies:[],events:[]});
  assert.ok(domain.createDemoState().sessions.length);assert.ok(catalogs.createDemoCatalog().rules.length);
});

test('first browser bootstrap contains no fictional task, policy or published rule',async()=>{
  let document={initialized:false,revision:0,state:null,catalog:null,token:'fixture-token'};
  const client=createWorkspaceClient({fetchImpl:async(url,options)=>{if(options?.method==='PUT'){const body=JSON.parse(options.body);document={...document,initialized:true,revision:1,state:body.state,catalog:body.catalog};}return response(document);}});
  const saved=await client.load();assert.deepEqual(saved.state.tasks,[]);assert.deepEqual(saved.state.sessions,[]);assert.deepEqual(saved.catalog.rules,[]);assert.deepEqual(saved.catalog.policies,[]);
});

test('browser legacy migration archives identifiable demos but preserves manual originals and frozen basis',async()=>{
  const before=oldBusinessFixture(),raw=JSON.stringify(before.state),catalogRaw=JSON.stringify(before.catalog);let stored;
  const client=createWorkspaceClient({storage:{getItem:key=>key.includes('catalog')?catalogRaw:raw},fetchImpl:async(url,options)=>{if(options?.method==='PUT'){const body=JSON.parse(options.body);stored=body;return response({initialized:true,revision:1,...body,token:'fixture-token'});}return response({initialized:false,revision:0,state:null,catalog:null,token:'fixture-token'});}});
  await client.load();const original=before.state.tasks.find(task=>task.mode==='manual');
  assert.deepEqual(stored.state.tasks,[original]);assert.deepEqual(stored.state.sessions,before.state.sessions.filter(session=>session.taskId===original.id));
  assert.equal(stored.state.legacyDemoArchive.sessions.length,32);assert.equal(stored.state.legacyDemoArchive.catalog.rules.length,7);
  assert.deepEqual(stored.catalog.rules,[]);assert.deepEqual(stored.catalog.policies,[]);
});

test('legacy fixture recognition compares record content independently of JSON property ordering',()=>{
  const catalog=catalogs.createDemoCatalog();
  catalog.rules=catalog.rules.map(record=>Object.fromEntries(Object.entries(record).reverse()));
  catalog.policies=catalog.policies.map(record=>Object.fromEntries(Object.entries(record).reverse()));
  const migrated=migrateBusinessWorkspace({state:domain.createDemoState(),catalog});assert.equal(migrated.catalog.rules.length,0);assert.equal(migrated.catalog.policies.length,0);
});
test('pre-scene legacy demo catalog is still archived and its original records are preserved',()=>{
  const catalog=catalogs.createDemoCatalog();
  for(const record of [...catalog.rules,...catalog.policies])delete record.sceneIds;
  const original=structuredClone(catalog),result=migrateBusinessWorkspace({state:domain.createDemoState(),catalog});
  assert.equal(result.catalog.rules.length,0);assert.equal(result.catalog.policies.length,0);
  assert.deepEqual(result.state.legacyDemoArchive.catalog,original);
});

test('load failures do not write or fall back to invented sample state',async()=>{
  let writes=0;const client=createWorkspaceClient({fetchImpl:async(url,options)=>{if(options?.method)writes++;throw new Error('无法读取本地工作区');}});
  await assert.rejects(client.load(),/无法读取/);assert.equal(client.snapshot,null);assert.equal(writes,0);
});

test('standalone catalog loading remains blank and recoverable when local records are absent or corrupt',()=>{
  const absent=loadCatalog({getItem:()=>null});assert.equal(absent.blocked,false);assert.deepEqual(absent.catalog.rules,[]);assert.deepEqual(absent.catalog.policies,[]);
  let writes=0;const broken=loadCatalog({getItem:()=>'{corrupt',setItem(){writes++;}});assert.equal(broken.blocked,true);assert.deepEqual(broken.catalog.rules,[]);assert.deepEqual(broken.catalog.policies,[]);assert.equal(writes,0);assert.match(broken.warning,/恢复|重新加载|检查/);
});

test('migration retains actual EC columns 16 to 22 and a manual task using a frozen EC basis',async()=>{
  const {createEcommerceSample}=await import('../public/ecommerce-sample.mjs'),{parseEcommerceFile}=await import('../public/ecommerce-input.mjs');
  const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'explicit-fixture.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  const catalog=ec.ensureEcommerceCatalog(catalogs.createDemoCatalog()),ruleIds=ec.listExecutableEcommerceVersions(catalog,{asOf:'2026-11-03'})[0].ruleIds;
  const basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-03',ruleIds}),state=domain.createImportedTask(domain.createDemoState(),{name:'已导入EC业务',sessions:parsed.sessions,source:{name:'explicit-fixture.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256},reviewer:'业务审核人',basisSnapshot});
  const originals=structuredClone(state.sessions.filter(session=>session.ecommerce)),migrated=migrateBusinessWorkspace({state,catalog});
  assert.deepEqual(migrated.state.sessions,originals);assert.deepEqual(migrated.state.tasks[0].basisSnapshot,basisSnapshot);
  assert.ok(originals.some(session=>session.ecommerce.raw.slice(15,22).some(Boolean)));
  assert.deepEqual(migrateBusinessWorkspace(migrated),{state:migrated.state,catalog:migrated.catalog,changed:false});
});

test('persisted legacy migration makes an exact unique backup before write and is idempotent',async t=>{
  const dataDir=await fixtureDir(t),before=oldBusinessFixture(),original=Buffer.from(`  ${JSON.stringify({schemaVersion:1,revision:7,...before,mutations:[]})}\r\n`),file=path.join(dataDir,'workspace.json');
  await fs.writeFile(file,original);await fs.mkdir(path.join(dataDir,'sources'));await fs.writeFile(path.join(dataDir,'sources','retained-original'),'source bytes');
  const store=await createWorkspaceStore({dataDir});const migrated=await store.read();await store.close();
  assert.equal(migrated.revision,8);assert.equal(migrated.state.tasks.length,1);assert.equal(migrated.state.tasks[0].mode,'manual');
  assert.deepEqual(migrated.state.tasks[0],before.state.tasks[0]);assert.deepEqual(migrated.state.sessions[0],before.state.sessions.at(-1));
  const backups=await fs.readdir(path.join(dataDir,'backups'));assert.equal(backups.length,1);assert.deepEqual(await fs.readFile(path.join(dataDir,'backups',backups[0])),original);
  const migratedBytes=await fs.readFile(file);const second=await createWorkspaceStore({dataDir});assert.equal((await second.read()).revision,8);await second.close();
  assert.deepEqual(await fs.readFile(file),migratedBytes);assert.deepEqual(await fs.readdir(path.join(dataDir,'backups')),backups);
  assert.equal(await fs.readFile(path.join(dataDir,'sources','retained-original'),'utf8'),'source bytes');
});

test('a failed pre-migration backup leaves the original workspace bytes intact',async t=>{
  const dataDir=await fixtureDir(t),before=oldBusinessFixture(),original=JSON.stringify({schemaVersion:1,revision:1,...before,mutations:[]}),file=path.join(dataDir,'workspace.json');await fs.writeFile(file,original);
  const fsOps={...fs,open:async(target,...args)=>{if(String(target).includes(`${path.sep}backups${path.sep}`))throw Error('backup cannot write');return fs.open(target,...args);}};
  await assert.rejects(createWorkspaceStore({dataDir,fsOps}),/备份|backup/);assert.equal(await fs.readFile(file,'utf8'),original);
});

test('EC catalog requires explicit Sheet4 confirmation before adding an executable version',()=>{
  assert.equal(typeof ec.confirmEcommerceCatalog,'function');assert.equal(typeof ec.listExecutableEcommerceVersions,'function');const blank=catalogs.createBusinessCatalog();
  assert.deepEqual(ec.listExecutableEcommerceVersions(blank),[]);assert.throws(()=>ec.confirmEcommerceCatalog(blank),/确认/);assert.throws(()=>ec.confirmEcommerceCatalog(blank,{confirmed:true,source:'猜测'}),/Sheet4/);
  assert.deepEqual(blank.rules,[]);const confirmed=ec.confirmEcommerceCatalog(blank,{confirmed:true,source:'Sheet4',owner:'业务审核人',now:'2026-11-03T10:00:00+08:00'});
  assert.equal(confirmed.rules.length,5);assert.equal(ec.listExecutableEcommerceVersions(confirmed,{asOf:'2026-11-03'})[0].version,'V1.0');
  assert.ok(confirmed.events.some(event=>event.action==='确认Sheet4口径'&&event.source==='Sheet4'&&event.confirmedBy==='业务审核人'));
  assert.ok(confirmed.rules.every(rule=>rule.title.includes('测试')));assert.deepEqual(ec.confirmEcommerceCatalog(confirmed,{confirmed:true,source:'Sheet4'}),confirmed);
  const modified=structuredClone(confirmed);modified.rules[0].passCriteria='任意修改';assert.deepEqual(ec.listExecutableEcommerceVersions(modified),[]);
});

test('EC executor rules cannot be applied to a plain product conversation',()=>{
  const catalog=ec.ensureEcommerceCatalog(catalogs.createBusinessCatalog()),ruleIds=ec.listExecutableEcommerceVersions(catalog,{asOf:'2026-11-03'})[0].ruleIds;
  const basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-03',ruleIds});
  const input={name:'产品咨询',source:{name:'真实导入.json',size:8,sha256:'a'.repeat(64)},basisSnapshot,reviewer:'审核人',sessions:[{id:'PRODUCT-001',scene:'新品产品咨询',startedAt:'2026-11-03T09:00:00+08:00',completeness:'完整',turns:[{id:1,role:'客户',text:'产品参数请说明'}]}]};
  assert.throws(()=>domain.createImportedTask(domain.createBusinessState(),input),/电商|Sheet4/);
});

test('dashboard never counts unknown or incomplete confirmed reviews as passed',()=>{
  const state=domain.createInitialState();const session=state.sessions[0];session.review.status='已确认';session.review.completedAt='2026-10-18T15:00:00+08:00';
  session.review.drafts=Object.fromEntries(session.aiResults.map(result=>[result.ruleId,{...result,verdict:'符合'}]));session.review.drafts.R001.verdict='无法判定';
  const stats=domain.getDashboard(state,{period:'batch',taskId:session.taskId});assert.equal(stats.passRate,0);assert.equal(stats.undeterminedCount,1);assert.equal(stats.unknownCount,1);
  delete session.review.drafts.R001;session.aiResults=session.aiResults.filter(result=>result.ruleId!=='R001');const missing=domain.getDashboard(state,{period:'batch',taskId:session.taskId});assert.equal(missing.passRate,0);assert.equal(missing.undeterminedCount,1);assert.equal(missing.unknownCount,1);
});
