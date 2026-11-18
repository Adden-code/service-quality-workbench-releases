import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createCatalog} from '../public/catalog.mjs';
import {workbook} from '../public/io.mjs';
const factory=await import('../packaging/factory-resources.mjs').catch(()=>({}));
const makeSeed=()=>{const source=createCatalog(),base={...source.rules[0]},policy={...source.policies[0]};delete base.sceneIds;delete policy.sceneIds;const common={...policy,effectiveAt:'2026-11-04'};return {schemaVersion:1,events:[],rules:[...Array.from({length:22},(_,i)=>({...base,id:`NP-R${String(i+1).padStart(2,'0')}`,effectiveAt:'2026-11-04',policyIds:['NP-POLICY']})),...['TIME','TEXT','TARGET','STEPS','PRIVACY'].map(id=>({...base,id:'EC-'+id,effectiveAt:'2020-01-01',policyIds:['EC-POLICY']}))],policies:[{...common,id:'NP-POLICY',sections:Array.from({length:23},(_,i)=>({id:`S${i+1}`,title:`Synthetic section ${i+1}`,text:'Synthetic policy fixture only.'}))},{...common,id:'EC-POLICY',effectiveAt:'2020-01-01',sections:Array.from({length:5},(_,i)=>({id:`E${i+1}`,title:`Synthetic section ${i+1}`,text:'Synthetic policy fixture only.'}))}]};};
async function example(){const sheets={'会话信息':[['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'],...Array.from({length:49},(_,i)=>[`SYNTH-${i+1}`,'新品产品咨询','2026-11-04T09:00:00+08:00','Synthetic fixture','Web','Synthetic product','Agent','Customer','完整',''])],'会话明细':[['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'],...Array.from({length:49},(_,i)=>Array.from({length:i<20?36:35},(_,j)=>[`SYNTH-${i+1}`,j+1,j%2?'客服':'客户','','',`Synthetic message ${j+1}`])).flat()]};return workbook(Object.entries(sheets).map(([name,[headers,...rows]])=>({name,headers,rows})));}
async function folder(t){const root=path.resolve('tests/.onboarding-scratch');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'factory-'));t.after(()=>{assert.ok(dir.startsWith(root+path.sep));return fs.rm(dir,{recursive:true,force:true});});return dir;}
test('factory resources must validate the complete catalog and 49/1735 standard workbook before staging',async t=>{
 assert.equal(typeof factory.prepareFactoryResources,'function','missing factory validation and staging');
 const dir=await folder(t),catalogSeedFile=path.join(dir,'seed.json'),sampleFile=path.join(dir,'sample.xlsx'),root=path.join(dir,'staged');await fs.writeFile(catalogSeedFile,JSON.stringify(makeSeed()));await fs.writeFile(sampleFile,await example());
 const info=await factory.prepareFactoryResources({root,catalogSeedFile,sampleFile,requireFactoryMaterials:true});assert.equal(info.catalogSeedIncluded,true);assert.equal(info.sampleIncluded,true);assert.equal(info.sample.sessions,49);assert.equal(info.sample.turns,1735);assert.equal(info.businessTaskDataIncluded,false);assert.equal(info.credentialsIncluded,false);assert.match(info.catalogInfo.sha256,/^[a-f0-9]{64}$/);assert.equal((await fs.readFile(path.join(root,'docs/samples/新品产品咨询_标准示例.xlsx'))).length,(await fs.stat(sampleFile)).size);
});
test('missing factory resources or wrong counts fail before any resources are copied',async t=>{
 assert.equal(typeof factory.prepareFactoryResources,'function');const dir=await folder(t),root=path.join(dir,'staged');await assert.rejects(factory.prepareFactoryResources({root,requireFactoryMaterials:true}),/种子|示例/);
 const catalogSeedFile=path.join(dir,'seed.json');const seed=makeSeed();seed.rules.pop();await fs.writeFile(catalogSeedFile,JSON.stringify(seed));await assert.rejects(factory.prepareFactoryResources({root,catalogSeedFile,requireFactoryMaterials:true}),/种子|示例|规则/);await assert.rejects(fs.stat(path.join(root,'resources/catalog-seed.json')),{code:'ENOENT'});
});
test('program-only builds disclose absence instead of claiming a ready seeded factory package',async t=>{
 assert.equal(typeof factory.prepareFactoryResources,'function');const dir=await folder(t),info=await factory.prepareFactoryResources({root:path.join(dir,'staged')});assert.equal(info.sourceDataIncluded,false);assert.equal(info.factoryReady,false);assert.equal(info.catalogSeedIncluded,false);
});
test('factory readiness requires positive scene ownership and currently effective rules and policies, not only matching counts',async t=>{
 const dir=await folder(t),sampleFile=path.join(dir,'sample.xlsx');await fs.writeFile(sampleFile,await example());
 const cases={unassigned:c=>{for(const r of c.rules)r.sceneIds=[];},wrongScene:c=>{for(const r of c.rules)r.sceneIds=[r.id.startsWith('NP-')?'电商评论回复':'新品产品咨询'];},future:c=>{for(const r of c.rules)r.effectiveAt='2099-01-01';},expired:c=>{for(const r of c.rules)r.expiresAt='2026-11-05';},policyUnassigned:c=>{for(const p of c.policies)p.sceneIds=[];}};
 for(const [label,mutate] of Object.entries(cases)){const seed=makeSeed();mutate(seed);const catalogSeedFile=path.join(dir,label+'.json'),root=path.join(dir,label);await fs.writeFile(catalogSeedFile,JSON.stringify(seed));await assert.rejects(factory.prepareFactoryResources({root,catalogSeedFile,sampleFile,requireFactoryMaterials:true}),/归属|可用|生效|场景/,label);await assert.rejects(fs.stat(path.join(root,'resources/catalog-seed.json')),{code:'ENOENT'});}
});
