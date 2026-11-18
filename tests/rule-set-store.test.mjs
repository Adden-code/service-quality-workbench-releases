import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {createRuleSetDraft,publishRuleSet,retireRuleSet} from '../public/ecommerce-rule-sets.mjs';
const now='2026-11-03T12:00:00+08:00';
test('workspace persistence enforces draft then publish and rejects immutable rule-set tampering',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'ruleset-store-')),store=await createWorkspaceStore({dataDir:folder});
 t.after(async()=>{await store.close();await fs.rm(folder,{recursive:true,force:true});});
 const state=createBusinessState(),draft=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',{version:'V2.1-A',owner:'维护人甲'},now),published=publishRuleSet(draft,'EC-REVIEW','V2.1-A',now);
 await assert.rejects(store.save({baseRevision:0,mutationId:'cannot-boot-published',state,catalog:published}),/草稿|发布|口径/);
 let doc=await store.save({baseRevision:0,mutationId:'draft',state,catalog:draft});
 doc=await store.save({baseRevision:doc.revision,mutationId:'publish',state,catalog:published});
 const frozenBytes=await fs.readFile(path.join(folder,'workspace.json'));
 for(const [name,change] of [['edit-threshold',c=>{c.ruleSets[0].timeRule.thresholds.default=999;}],['delete-published',c=>{c.ruleSets=[];}],['rename-published',c=>{c.ruleSets[0].ruleSetId='MOVED';}]]){
  const modified=structuredClone(published);change(modified);
  await assert.rejects(store.save({baseRevision:doc.revision,mutationId:name,state,catalog:modified}),/规则集|口径|发布|删除|草稿/);
  assert.deepEqual(await fs.readFile(path.join(folder,'workspace.json')),frozenBytes);
 }
 const retired=retireRuleSet(published,'EC-REVIEW','V2.1-A',now);
 doc=await store.save({baseRevision:doc.revision,mutationId:'retire',state,catalog:retired});
 assert.equal(doc.catalog.ruleSets[0].status,'已停用');
 await store.close();const reloaded=await createWorkspaceStore({dataDir:folder});t.after(()=>reloaded.close());
 assert.equal((await reloaded.read()).catalog.ruleSets[0].status,'已停用');
});
