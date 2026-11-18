import test from 'node:test';
import {normalizeRuleKind} from '../public/rule-kind.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';
import {workbook} from '../public/io.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {loadBundledCatalogSeed,validateCatalogSeed} from '../server/catalog-seed.mjs';
import {prepareFactoryResources} from '../packaging/factory-resources.mjs';
import * as factoryBuild from '../packaging/factory-resources.mjs';
import {buildPortable} from '../packaging/build-portable.mjs';
import * as sourceBuild from '../packaging/build.mjs';
import * as installerBuild from '../packaging/build-installer.mjs';

const evidenceRoot=fileURLToPath(new URL('../../catalog-build098/',import.meta.url));
const fixtureFile=path.join(evidenceRoot,'fixtures/catalog-seed.json');
function makeSyntheticSeed(){
 const common={version:'V1.0',category:'SYNTHETIC TEST ONLY',scope:'SYNTHETIC pipeline fixture only; not approved business standards.',owner:'SYNTHETIC TEST ONLY',changeNote:'SYNTHETIC pipeline fixture. Contains no real policy.',sceneIds:['新品产品咨询'],effectiveAt:'2026-01-01',expiresAt:'',status:'已发布',createdAt:'2026-01-01T00:00:00Z',publishedAt:'2026-01-01T00:00:00Z'};
 return {schemaVersion:1,rules:Array.from({length:22},(_,i)=>({...common,id:`NP-R${String(i+1).padStart(2,'0')}`,title:`SYNTHETIC rule ${i+1} - pipeline test only`,passCriteria:'SYNTHETIC placeholder pass condition; not a business criterion.',failCriteria:'SYNTHETIC placeholder fail condition; not a business criterion.',exceptionCriteria:'SYNTHETIC placeholder exception; not a business criterion.',policyIds:['NP-POLICY']})),policies:[{...common,id:'NP-POLICY',title:'SYNTHETIC policy - pipeline test only',source:'SYNTHETIC generated test fixture, no real policy source.',sections:Array.from({length:23},(_,i)=>({id:`SYNTHETIC-S${String(i+1).padStart(2,'0')}`,title:`SYNTHETIC section ${i+1}`,text:'SYNTHETIC placeholder only. No real policy text. Not approved for business use.'}))}],events:[]};
}
async function ensureSyntheticFixture(){
 try{return await fs.readFile(fixtureFile);}catch(error){if(error.code!=='ENOENT')throw error;}
 const bytes=Buffer.from(JSON.stringify(makeSyntheticSeed(),null,2)+'\n');await fs.mkdir(path.dirname(fixtureFile),{recursive:true});
 try{await fs.writeFile(fixtureFile,bytes,{flag:'wx'});return bytes;}catch(error){if(error.code!=='EEXIST')throw error;return fs.readFile(fixtureFile);}
}
const fixtureBytes=await ensureSyntheticFixture();
const seed=()=>JSON.parse(fixtureBytes.toString('utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const scratchRoot=path.join(evidenceRoot,'temp');
async function folder(t){await fs.mkdir(scratchRoot,{recursive:true});const result=await fs.mkdtemp(path.join(scratchRoot,'test-'));t.after(async()=>{assert.ok(path.resolve(result).startsWith(path.resolve(scratchRoot)+path.sep));await fs.rm(result,{recursive:true,force:true});});return result;}
async function writeSeed(dir,value=seed()){await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'catalog-seed.json');await fs.writeFile(file,JSON.stringify(value));return file;}
async function runtimeInputs(dir){const javaRuntime=path.join(dir,'java');await fs.mkdir(path.join(javaRuntime,'bin'),{recursive:true});const nodeExe=path.join(dir,'node.exe'),nodeLicense=path.join(dir,'LICENSE.txt'),jarPath=path.join(dir,'worker.jar');for(const file of [nodeExe,nodeLicense,jarPath,path.join(javaRuntime,'bin/java.exe')])await fs.writeFile(file,'SYNTHETIC fixture runtime only; do not launch');return {nodeExe,nodeLicense,javaRuntime,jarPath};}
async function sampleFile(dir){
 const sheets=[{name:'会话信息',headers:['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'],rows:Array.from({length:49},(_,i)=>[`SYNTHETIC-${i+1}`,'新品产品咨询','2026-01-01T09:00:00+08:00','SYNTHETIC fixture only','Web','SYNTHETIC product','SYNTHETIC agent','SYNTHETIC customer','完整',''])},{name:'会话明细',headers:['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'],rows:Array.from({length:49},(_,i)=>Array.from({length:i<20?36:35},(_,j)=>[`SYNTHETIC-${i+1}`,j+1,j%2?'客服':'客户','','',`SYNTHETIC message ${j+1}; not real business content.`])).flat()}];
 const file=path.join(dir,'synthetic-standard.xlsx');await fs.writeFile(file,await workbook(sheets));return file;
}

test('the retained seed fixture is explicitly SYNTHETIC and separate from source resources',()=>{
 assert.deepEqual(seed(),makeSyntheticSeed());
 assert.equal(seed().rules.length,22);assert.equal(seed().policies.length,1);assert.equal(seed().policies[0].sections.length,23);
 assert.ok(!fixtureFile.startsWith(fileURLToPath(new URL('../resources/',import.meta.url))));
 for(const record of [...seed().rules,...seed().policies]){assert.match(record.title,/SYNTHETIC/);assert.match(record.scope,/SYNTHETIC/);}
 for(const section of seed().policies[0].sections)assert.match(section.text,/SYNTHETIC.*No real policy text/);
});

test('an explicit new-product seed stages unchanged bytes and exposes a relative path plus detailed metadata',async t=>{
 const dir=await folder(t),root=path.join(dir,'staged');
 const info=await prepareFactoryResources({root,catalogSeedFile:fixtureFile,factoryProfile:'new-product',materialsKind:'synthetic'});
 assert.equal(info.catalogSeedIncluded,true);assert.equal(info.catalog,'resources/catalog-seed.json');
 assert.equal(info.catalogInfo.sha256,digest(fixtureBytes));assert.equal(info.catalogInfo.rules,22);assert.equal(info.catalogInfo.policies,1);assert.equal(info.catalogInfo.newProductRules,22);assert.equal(info.catalogInfo.ecommerceRules,0);
 assert.equal(info.factoryProfile,'new-product');assert.equal(info.materialsKind,'synthetic');assert.equal(info.factoryReady,false);assert.equal(info.businessTaskDataIncluded,false);assert.equal(info.credentialsIncluded,false);
 assert.deepEqual(await fs.readFile(path.join(root,info.catalog)),fixtureBytes);
});

test('default discovery uses sourceDir/resources only and never user workspace directories',async t=>{
 const dir=await folder(t),sourceDir=path.join(dir,'source'),root=path.join(dir,'staged');
 await writeSeed(path.join(sourceDir,'data','resources'));await writeSeed(path.join(root,'data','resources'));
 const empty=await prepareFactoryResources({root,sourceDir,factoryProfile:'new-product'});assert.equal(empty.catalogSeedIncluded,false);assert.equal(empty.catalog,null);assert.equal(empty.catalogInfo,null);assert.equal(empty.materialsKind,'none');
 await writeSeed(path.join(sourceDir,'resources'));
 const info=await prepareFactoryResources({root,sourceDir,factoryProfile:'new-product'});assert.equal(info.catalogSeedIncluded,true);assert.equal(info.catalog,'resources/catalog-seed.json');assert.equal(info.materialsKind,'synthetic');
 assert.deepEqual(await fs.readFile(path.join(root,'resources/catalog-seed.json')),await fs.readFile(path.join(sourceDir,'resources/catalog-seed.json')));
});

test('explicit selection overrides discovery and missing, directory, oversized or linked seed inputs fail before staging',async t=>{
 const dir=await folder(t),sourceDir=path.join(dir,'source');await writeSeed(path.join(sourceDir,'resources'));
 const selected=seed();selected.rules[0].title='SYNTHETIC explicitly selected file';const catalogSeedFile=await writeSeed(path.join(dir,'selected'),selected),root=path.join(dir,'selected-stage');
 await prepareFactoryResources({root,sourceDir,catalogSeedFile,factoryProfile:'new-product'});assert.equal(JSON.parse(await fs.readFile(path.join(root,'resources/catalog-seed.json'),'utf8')).rules[0].title,selected.rules[0].title);
 const oversized=path.join(dir,'oversized.json');await fs.writeFile(oversized,Buffer.alloc(8*1024*1024+1));
 for(const [label,file] of [['missing',path.join(dir,'missing.json')],['directory',sourceDir],['oversized',oversized]]){
  const target=path.join(dir,label+'-stage');await assert.rejects(prepareFactoryResources({root:target,sourceDir,catalogSeedFile:file,factoryProfile:'new-product'}),/ENOENT|普通文件|8MB/);await assert.rejects(fs.stat(path.join(target,'resources/catalog-seed.json')),{code:'ENOENT'});
 }
 const linkedSource=path.join(dir,'linked-source');await fs.mkdir(linkedSource);await fs.symlink(path.join(sourceDir,'resources'),path.join(linkedSource,'resources'),'junction');
 await assert.rejects(prepareFactoryResources({root:path.join(dir,'linked-stage'),sourceDir:linkedSource,factoryProfile:'new-product'}),/链接|普通目录/);
});

test('new-product profile accepts exactly NP-R01..NP-R22 and one 23-section NP-POLICY',async t=>{
 const dir=await folder(t),cases={missingRule:c=>c.rules.pop(),extraRule:c=>c.rules.push({...c.rules[0],id:'EC-OTHER'}),extraPolicy:c=>c.policies.push({...c.policies[0],id:'OTHER-POLICY'}),missingSection:c=>c.policies[0].sections.pop(),ruleSets:c=>{c.ruleSets=[];},wrongScene:c=>{c.rules[0].sceneIds=['电商评论回复'];},future:c=>{c.rules[0].effectiveAt='2099-01-01';},expired:c=>{c.policies[0].expiresAt='2026-01-02';}};
 for(const [label,mutate] of Object.entries(cases)){
  const value=seed();mutate(value);const catalogSeedFile=await writeSeed(path.join(dir,label),value),root=path.join(dir,label+'-stage');
  await assert.rejects(prepareFactoryResources({root,catalogSeedFile,factoryProfile:'new-product'}),/新品|NP-|23|规则集|归属|生效|可用/,label);await assert.rejects(fs.stat(path.join(root,'resources/catalog-seed.json')),{code:'ENOENT'});
 }
});

test('the existing all-scenes factory profile still requires its five ecommerce rules and both policies',async t=>{
 const dir=await folder(t);await assert.rejects(prepareFactoryResources({root:path.join(dir,'stage'),catalogSeedFile:fixtureFile,sampleFile:await sampleFile(dir),requireFactoryMaterials:true}),/电商|五项/);
});

test('published-only, empty-events and no task, credential or provenance restrictions apply before copying',async t=>{
 const dir=await folder(t),cases={draft:c=>{c.rules[0].status='草稿';c.rules[0].publishedAt='';},event:c=>c.events.push({kind:'rules',id:'NP-R01',version:'V1.0',action:'SYNTHETIC event',at:'2026-01-01T00:00:00Z'}),tasks:c=>{c.tasks=[];},credentials:c=>{c.rules[0].credentials={apiKey:'SYNTHETIC forbidden placeholder'};},provenance:c=>{c.policies[0].provenance={note:'SYNTHETIC forbidden metadata'};}};
 for(const [label,mutate] of Object.entries(cases)){const value=seed();mutate(value);const catalogSeedFile=await writeSeed(path.join(dir,label),value),root=path.join(dir,label+'-stage');await assert.rejects(prepareFactoryResources({root,catalogSeedFile,factoryProfile:'new-product'}),/已发布|events|空事件|种子|任务|凭据|provenance|来源/,label);await assert.rejects(fs.stat(path.join(root,'resources/catalog-seed.json')),{code:'ENOENT'});}
});

test('a structurally complete synthetic standard never becomes approved factory-ready material',async t=>{
 const dir=await folder(t),sample=await sampleFile(dir);
 const info=await prepareFactoryResources({root:path.join(dir,'synthetic'),catalogSeedFile:fixtureFile,sampleFile:sample,factoryProfile:'new-product',requireFactoryMaterials:true});
 assert.equal(info.sample.sessions,49);assert.equal(info.sample.turns,1735);assert.equal(info.materialsKind,'synthetic');assert.equal(info.factoryReady,false);
 await assert.rejects(prepareFactoryResources({root:path.join(dir,'false-approval'),catalogSeedFile:fixtureFile,sampleFile:sample,factoryProfile:'new-product',materialsKind:'approved',requireFactoryMaterials:true}),/synthetic|SYNTHETIC|合成|虚构/);
 await assert.rejects(prepareFactoryResources({root:path.join(dir,'unknown-kind'),catalogSeedFile:fixtureFile,factoryProfile:'new-product',materialsKind:'auto-approved'}),/materialsKind|材料类型/);
 const unverified=JSON.parse(JSON.stringify(seed()).replaceAll('SYNTHETIC','UNVERIFIED'));unverified.rules[0].failCriteria='UNVERIFIED fixture prohibition example: 不应虚构答案。';
 const unverifiedFile=await writeSeed(path.join(dir,'unverified-source'),unverified);
 const unverifiedInfo=await prepareFactoryResources({root:path.join(dir,'unverified-stage'),catalogSeedFile:unverifiedFile,factoryProfile:'new-product'});assert.equal(unverifiedInfo.materialsKind,'unverified');assert.equal(unverifiedInfo.factoryReady,false);
});

test('all build CLIs share explicit seed, source discovery, profile and material-kind options',()=>{
 assert.equal(typeof factoryBuild.parseFactoryBuildArgs,'function');
 assert.deepEqual(factoryBuild.parseFactoryBuildArgs(['--catalog-seed',fixtureFile,'--source-dir',evidenceRoot,'--factory-profile','new-product','--materials-kind','synthetic','--sample','SYNTHETIC.xlsx','--require-factory-materials']),{catalogSeedFile:fixtureFile,sourceDir:evidenceRoot,factoryProfile:'new-product',materialsKind:'synthetic',sampleFile:'SYNTHETIC.xlsx',requireFactoryMaterials:true});
 assert.throws(()=>factoryBuild.parseFactoryBuildArgs(['--catalog-seed']),/参数|路径|值/);assert.throws(()=>factoryBuild.parseFactoryBuildArgs(['--catalog-seed',fixtureFile,'--catalog-seed',fixtureFile]),/重复/);assert.throws(()=>factoryBuild.parseFactoryBuildArgs(['--unknown']),/参数/);
});

test('the source payload staging path packages an explicit seed with manifest SHA without building an installer',async t=>{
 assert.equal(typeof sourceBuild.stagePayload,'function','source packaging needs a separately testable staging operation');
 const dir=await folder(t),inputs=await runtimeInputs(dir),payload=path.join(dir,'payload');
 const staged=await sourceBuild.stagePayload({root:payload,nodeRuntime:inputs.nodeExe,nodeLicense:inputs.nodeLicense,catalogSeedFile:fixtureFile,factoryProfile:'new-product',materialsKind:'synthetic'});
 assert.equal(staged.factory.catalog,'resources/catalog-seed.json');assert.equal(staged.factory.materialsKind,'synthetic');
 const manifest=JSON.parse(await fs.readFile(path.join(payload,'文件校验清单.json'),'utf8')),entry=manifest.files.find(file=>file.path==='resources/catalog-seed.json');assert.ok(entry);assert.equal(entry.sha256,digest(fixtureBytes));
});

test('portable build defaults to source resources and records the seed and hash in every package metadata file',async t=>{
 const dir=await folder(t),sourceDir=path.join(dir,'source');await writeSeed(path.join(sourceDir,'resources'));const inputs=await runtimeInputs(dir);
 const staged=await buildPortable({outputDir:path.join(dir,'portable'),...inputs,sourceDir,factoryProfile:'new-product',archive:false,split:false});
 const metadata=JSON.parse(await fs.readFile(path.join(staged.root,'portable-info.json'),'utf8')),outer=JSON.parse(await fs.readFile(path.join(dir,'portable','package-info.json'),'utf8'));
 const actual=await fs.readFile(path.join(staged.root,'resources/catalog-seed.json'));
 for(const info of [metadata,outer]){assert.equal(info.catalogSeedIncluded,true);assert.equal(info.catalog,'resources/catalog-seed.json');assert.equal(info.catalogInfo.sha256,digest(actual));assert.equal(info.materialsKind,'synthetic');assert.equal(info.factoryReady,false);}
 const manifest=JSON.parse(await fs.readFile(path.join(staged.root,'文件校验清单.json'),'utf8')),entry=manifest.files.find(file=>file.path==='resources/catalog-seed.json');assert.ok(entry);assert.equal(entry.sha256,digest(actual));assert.equal(entry.bytes,actual.length);
 assert.ok(!manifest.files.some(file=>/^data\/|^tests\/|\.secrets|\.env/.test(file.path)));
});

test('the portable CLI builds an actual ZIP from an explicit synthetic seed and preserves its archive metadata and bytes',async t=>{
 const dir=await folder(t),inputs=await runtimeInputs(dir),outputDir=path.join(dir,'portable-cli');
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../packaging/build-portable.mjs',import.meta.url)),outputDir,inputs.nodeExe,inputs.nodeLicense,inputs.javaRuntime,inputs.jarPath,'--catalog-seed',fixtureFile,'--factory-profile','new-product','--materials-kind','synthetic'],{windowsHide:true,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
 const info=JSON.parse(await fs.readFile(path.join(outputDir,'package-info.json'),'utf8'));assert.equal(info.catalogSeedIncluded,true);assert.equal(info.catalog,'resources/catalog-seed.json');assert.equal(info.catalogInfo.sha256,digest(fixtureBytes));assert.equal(info.materialsKind,'synthetic');assert.equal(info.factoryReady,false);
 const zip=await JSZip.loadAsync(await fs.readFile(info.archive));assert.deepEqual(await zip.file('resources/catalog-seed.json').async('nodebuffer'),fixtureBytes);
 const metadata=JSON.parse(await zip.file('portable-info.json').async('string'));assert.equal(metadata.catalog,'resources/catalog-seed.json');assert.equal(metadata.catalogInfo.sha256,digest(fixtureBytes));
 const manifest=JSON.parse(await zip.file('文件校验清单.json').async('string')),entry=manifest.files.find(file=>file.path==='resources/catalog-seed.json');assert.equal(entry.sha256,digest(fixtureBytes));assert.equal(entry.bytes,fixtureBytes.length);
});

test('the installer staging path forwards explicit and default catalog selection without compiling a final installer',async t=>{
 assert.equal(typeof installerBuild.stageInstallerPayload,'function','installer packaging needs a separately testable staging operation');
 const dir=await folder(t),sourceDir=path.join(dir,'source');await writeSeed(path.join(sourceDir,'resources'));const inputs=await runtimeInputs(dir);
 for(const explicit of [false,true]){
  const outputDir=path.join(dir,explicit?'explicit':'default'),staged=await installerBuild.stageInstallerPayload({outputDir,...inputs,sourceDir,...(explicit?{catalogSeedFile:fixtureFile}:{}),factoryProfile:'new-product',materialsKind:'synthetic'});
  const metadata=JSON.parse(await fs.readFile(path.join(staged.root,'portable-info.json'),'utf8'));assert.equal(metadata.catalogSeedIncluded,true);assert.equal(metadata.catalog,'resources/catalog-seed.json');assert.equal(metadata.factoryProfile,'new-product');assert.equal(metadata.materialsKind,'synthetic');
  assert.ok(!(await fs.readdir(outputDir)).some(name=>name.endsWith('_完整安装包.exe')));
 }
});

test('bundled loading rejects linked resources and validates the exact seed bytes used by fresh/restarted/existing workspaces',async t=>{
 const dir=await folder(t),resources=path.join(dir,'resources');await writeSeed(resources);const catalogSeed=await loadBundledCatalogSeed(resources);assert.deepEqual(catalogSeed,validateCatalogSeed(seed()));
 const absentDataDir=path.join(dir,'absent-workspace');await assert.rejects(fs.stat(absentDataDir),{code:'ENOENT'});let store=await createWorkspaceStore({dataDir:absentDataDir,catalogSeed});
 try{const doc=await store.read();assert.equal(doc.revision,1);assert.deepEqual(doc.state,createBusinessState());assert.deepEqual(doc.catalog,{...catalogSeed,rules:catalogSeed.rules.map(normalizeRuleKind)});}finally{await store.close();}
 const original=await fs.readFile(path.join(absentDataDir,'workspace.json')),changed=seed();changed.rules[0].title='SYNTHETIC changed seed must not reapply';store=await createWorkspaceStore({dataDir:absentDataDir,catalogSeed:changed});await store.close();assert.deepEqual(await fs.readFile(path.join(absentDataDir,'workspace.json')),original);
 const existingDataDir=path.join(dir,'existing-empty-workspace');store=await createWorkspaceStore({dataDir:existingDataDir});await store.save({baseRevision:0,mutationId:'synthetic-empty-workspace',state:createBusinessState(),catalog:createBusinessCatalog()});await store.close();const before=await fs.readFile(path.join(existingDataDir,'workspace.json'));
 store=await createWorkspaceStore({dataDir:existingDataDir,catalogSeed});try{assert.deepEqual((await store.read()).catalog,createBusinessCatalog());}finally{await store.close();}assert.deepEqual(await fs.readFile(path.join(existingDataDir,'workspace.json')),before);
 const linked=path.join(dir,'linked-resources');await fs.symlink(resources,linked,'junction');await assert.rejects(loadBundledCatalogSeed(linked),/链接|普通目录/);
});
