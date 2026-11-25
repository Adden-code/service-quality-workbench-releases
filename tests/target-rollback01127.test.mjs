import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildHotfixSeed,BASE_SCENE_SHA256,V2_SCENE_SHA256,HOTFIX_SEED_ID} from '../scripts/build-01127-seed.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {prepareAutomaticBuiltinUpgrade,upgradeBuiltinOnStartup,AUTHORIZED_TARGET_V2_ROLLBACK} from '../server/startup-builtin-upgrade.mjs';
import {latestSceneConfiguration,sceneBasisForTask} from '../public/scene-configuration.mjs';
import {createImportedTask} from '../public/domain.mjs';
import {SYSTEM_EC_HEADERS as EC_SYSTEM_HEADERS} from '../public/ecommerce-system-source.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {decodeWorkspaceArchive} from '../server/workspace-archive.mjs';
import {stable} from '../public/rule-calibration-policy.mjs';
const baseDir=process.env.HOTFIX_BASE_SEEDS,v2Dir=process.env.HOTFIX_V2_SEEDS,enabled=!!baseDir&&!!v2Dir;
const hash=x=>createHash('sha256').update(x).digest('hex'),ec=s=>s.packages.find(p=>p.configuration.engine==='ecommerce'),np=s=>s.packages.find(p=>p.configuration.engine==='conversation');
async function fixture(){const [b,v,c]=await Promise.all([fs.readFile(path.join(baseDir,'scene-seed.json')),fs.readFile(path.join(v2Dir,'scene-seed.json')),fs.readFile(path.join(baseDir,'catalog-seed.json'))]);assert.equal(hash(b),BASE_SCENE_SHA256);assert.equal(hash(v),V2_SCENE_SHA256);const base=JSON.parse(b),v2=JSON.parse(v),catalog=JSON.parse(c);return{base,v2,catalog,next:buildHotfixSeed(base,v2,catalog)};}
test('release rollback copies exact 0.11.22 v2 and leaves all other criteria byte-equivalent',{skip:!enabled},async()=>{
 const {base,v2,catalog,next}=await fixture();assert.equal(next.id,HOTFIX_SEED_ID);assert.equal(hash(stable(next)),AUTHORIZED_TARGET_V2_ROLLBACK.sha256);
 assert.deepEqual(np(next),np(base));assert.deepEqual(next.sources,base.sources);
 const a=ec(base),b=ec(next),old=ec(v2),target=b.configuration.basis.rules.find(r=>r.id==='EC-TARGET');
 for(const rule of b.configuration.basis.rules){const other=(rule.id==='EC-TARGET'?old:a).configuration.basis.rules.find(r=>r.id===rule.id);if(rule.id!=='EC-TARGET')assert.deepEqual(rule,other);else for(const key of ['summary','passCriteria','failCriteria','exceptionCriteria'])assert.equal(rule[key],other[key]);}
 for(const section of b.configuration.basis.policies[0].sections){const other=(section.id==='EC-TARGET-BUSINESS-1'?old:a).configuration.basis.policies[0].sections.find(s=>s.id===section.id);assert.deepEqual(section,other);}
 assert.equal(target.version,'V3.6');assert.equal(b.configuration.basis.businessProfile.targetPolicyVersion,'ec-target-calibration-v2');assert.equal(catalog.rules.length,17);
});
async function importSynthetic(store,label){
 const cells=EC_SYSTEM_HEADERS.map(name=>({'展示商品ID':'synthetic-product','订单编码':'synthetic-order-'+label,'SKU名称':'Synthetic item','运营商名称':'VMALL-MX-HWB2C','评论内容':'Synthetic review '+label,'回复内容':'Synthetic reply '+label,'评分':5,'管理员':'Synthetic reviewer','评论时间':'2026-11-20 10:00:00','首次回复时间':'2026-11-20 11:00:00','是否已回复':'是'}[name]??''));
 const bytes=Buffer.from(await workbook([{name:'Sheet1',headers:EC_SYSTEM_HEADERS,rows:[cells]}])),name=`synthetic-${label}.xlsx`,parsed=await parseEcommerceFile({name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,name),before=await store.read(),state=createImportedTask(before.state,{name:label,sessions:parsed.sessions,source,reviewer:'Synthetic reviewer',basisSnapshot:sceneBasisForTask(before.state,before.catalog,'电商评论回复','2026-11-25T00:00:00.000Z'),now:'2026-11-25T00:00:00.000Z'});
 const saved=await store.save({state,catalog:before.catalog,baseRevision:before.revision,mutationId:'hotfix-'+label});return saved.state.tasks.find(t=>t.name===label);
}
test('existing v3 workspace with desktop cache upgrades and backs up; old task v3 and new task v2',{skip:!enabled},async t=>{
 const f=await fixture(),parent=path.resolve('tests/artifacts/hotfix01127');await fs.mkdir(parent,{recursive:true});const box=await fs.mkdtemp(path.join(parent,'run-')),dataDir=path.join(box,'workspace');let store;
 t.after(async()=>{await store?.close();assert.ok(box.startsWith(parent+path.sep));await fs.rm(box,{recursive:true,force:true});});
 store=await createWorkspaceStore({dataDir,catalogSeed:f.catalog,sceneSeed:f.base,storageMode:'sharded'});const old=await importSynthetic(store,'before'),before=await store.read();
 await fs.mkdir(path.join(dataDir,'desktop-profile/EBWebView/Default'),{recursive:true});await fs.writeFile(path.join(dataDir,'desktop-profile/EBWebView/Default/cache'),'synthetic browser cache');
 const args={catalogSeed:f.catalog,sceneSeed:f.next,productVersion:'0.11.27'};
 for(const mutate of [s=>s.id+='-not-authorized',s=>ec(s).configuration.reason+=' changed']){const forged=structuredClone(f.next);mutate(forged);assert.equal(prepareAutomaticBuiltinUpgrade(before,{...args,sceneSeed:forged}),null);}
 const result=await upgradeBuiltinOnStartup({store,dataDir,...args});assert.equal(result.status,'upgraded',JSON.stringify(result));assert.deepEqual(result.scenes,['电商评论回复']);
 const archive=decodeWorkspaceArchive(await fs.readFile(result.backupPath));assert.ok(![...archive.files.keys()].some(k=>k.startsWith('desktop-profile/')));assert.equal(await fs.readFile(path.join(dataDir,'desktop-profile/EBWebView/Default/cache'),'utf8'),'synthetic browser cache');
 const after=await store.read();assert.deepEqual(after.state.tasks,before.state.tasks);assert.deepEqual(after.state.sessions,before.state.sessions);assert.deepEqual(after.catalog,before.catalog);assert.deepEqual(latestSceneConfiguration(after.state,'新品产品咨询'),latestSceneConfiguration(before.state,'新品产品咨询'));
 const event=after.state.sceneConfigurationEvents.at(-1);assert.equal(event.actor,'system-upgrade');assert.equal(event.seedId,HOTFIX_SEED_ID);assert.ok(event.diff.length);
 const fresh=await importSynthetic(store,'after');assert.equal(old.basisSnapshot.businessProfile.targetPolicyVersion,'ec-target-calibration-v3');assert.equal(fresh.basisSnapshot.businessProfile.targetPolicyVersion,'ec-target-calibration-v2');
 assert.deepEqual((await store.read()).state.tasks.find(t=>t.id===old.id),old);assert.equal((await upgradeBuiltinOnStartup({store,dataDir,...args})).status,'current');
});
