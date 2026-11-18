import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createCatalog,createBusinessCatalog} from '../public/catalog.mjs';
const seed=()=>{const c=createCatalog();c.events=[];return c;};
async function folder(t){const base=path.resolve('tests/.onboarding-scratch');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'seed-'));t.after(()=>{assert.ok(dir.startsWith(base+path.sep));return fs.rm(dir,{recursive:true,force:true});});return dir;}
test('only absent workspace receives a validated directory seed with zero tasks and sessions',async t=>{
 const dataDir=await folder(t),catalogSeed=seed(),store=await createWorkspaceStore({dataDir,catalogSeed});
 try{const doc=await store.read();assert.equal(doc.initialized,true);assert.equal(doc.revision,1);assert.deepEqual(doc.state,createBusinessState());assert.equal(doc.catalog.rules.length,catalogSeed.rules.length);assert.equal(doc.catalog.policies.length,catalogSeed.policies.length);assert.deepEqual(doc.catalog.events,[]);assert.ok(!(await fs.readdir(dataDir)).includes('.secrets'));}finally{await store.close();}
});
test('restart never reapplies changed seed and preserves original versions, dates and workspace bytes',async t=>{
 const dataDir=await folder(t);let store=await createWorkspaceStore({dataDir,catalogSeed:seed()});await store.close();const before=await fs.readFile(path.join(dataDir,'workspace.json'));
 const changed=seed();changed.rules[0].title='different seed must not overwrite';store=await createWorkspaceStore({dataDir,catalogSeed:changed});await store.close();assert.deepEqual(await fs.readFile(path.join(dataDir,'workspace.json')),before);
});
test('an existing initialized empty catalog never receives a later bundled seed',async t=>{
 const dataDir=await folder(t);let store=await createWorkspaceStore({dataDir});await store.save({baseRevision:0,mutationId:'empty-user-workspace',state:createBusinessState(),catalog:createBusinessCatalog()});await store.close();const before=await fs.readFile(path.join(dataDir,'workspace.json'));
 store=await createWorkspaceStore({dataDir,catalogSeed:seed()});assert.deepEqual((await store.read()).catalog,createBusinessCatalog());await store.close();assert.deepEqual(await fs.readFile(path.join(dataDir,'workspace.json')),before);
});
test('invalid seed never writes workspace or leaves a lock and does not replace a corrupt workspace',async t=>{
 const dataDir=await folder(t);await assert.rejects(createWorkspaceStore({dataDir,catalogSeed:{...seed(),tasks:[{}]}}),/种子|seed/);
 await assert.rejects(fs.stat(path.join(dataDir,'workspace.json')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(dataDir,'.workspace.lock')),{code:'ENOENT'});
 await fs.writeFile(path.join(dataDir,'workspace.json'),'corrupt-original');await assert.rejects(createWorkspaceStore({dataDir,catalogSeed:seed()}),/损坏/);assert.equal(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8'),'corrupt-original');
});
test('drafts and provenance file dependencies are not acceptable factory seeds',async t=>{
 const dataDir=await folder(t),draft=seed();draft.rules[0].status='草稿';draft.rules[0].publishedAt='';await assert.rejects(createWorkspaceStore({dataDir,catalogSeed:draft}),/已发布|种子/);
});
