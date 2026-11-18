import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../public/catalog.mjs';
import {createInitialState} from '../public/domain.mjs';
const basis = () => import('../public/task-basis.mjs');
const options = {effectiveDate:'2026-10-29',ruleIds:['R001'],now:'2026-10-29T10:00:00+08:00'};

test('basis keeps the complete selected records detached from the live catalog', async () => {
  const {createBasisSnapshot} = await basis(), catalog=createCatalog();
  catalog.rules[0].metadata={evidence:'规则来源'};catalog.policies[0].metadata={sourcePage:3};
  const before=structuredClone(catalog), snapshot=createBasisSnapshot(catalog,options);
  assert.deepEqual(catalog,before);assert.equal(snapshot.rules.length,1);assert.equal(snapshot.policies.length,1);
  assert.deepEqual(snapshot.rules[0],{...catalog.rules[0],name:catalog.rules[0].title});
  assert.deepEqual(snapshot.policies[0],{...catalog.policies[0],content:catalog.policies[0].sections.map(s=>`${s.id} ${s.title}\n${s.text}`).join('\n\n')});
  catalog.rules[0].metadata.evidence='新版本';catalog.policies[0].sections[0].text='目录已变更';
  assert.equal(snapshot.rules[0].metadata.evidence,'规则来源');assert.notEqual(snapshot.policies[0].sections[0].text,'目录已变更');
});
test('basis requires exactly one effective published version of every selected rule and policy',async()=>{
  const {createBasisSnapshot}=await basis(),catalog=createCatalog();
  for(const change of [c=>c.rules[0].status='草稿',c=>c.policies[0].effectiveAt='2026-11-01',c=>c.rules.push({...c.rules[0],version:'V1.1'}),c=>c.policies.push({...c.policies[0],version:'V1.1'})]){
    const changed=structuredClone(catalog);change(changed);assert.throws(()=>createBasisSnapshot(changed,options),/唯一|生效|发布/);
  }
  assert.throws(()=>createBasisSnapshot(catalog,{...options,ruleIds:['R001','R001']}),/重复/);
  assert.throws(()=>createBasisSnapshot(catalog,{...options,effectiveDate:'2026-02-30'}),/日期/);
  const old=structuredClone(catalog);old.rules[0].expiresAt='2026-10-29';assert.throws(()=>createBasisSnapshot(old,options),/唯一|生效/);
});
test('composite references disambiguate duplicated clause ids and legacy short ids resolve only globally unique',async()=>{
  const {referenceKey,resolveTaskReference,resolveTaskPolicy,getSessionRules,getTaskBasis}=await basis();
  const snapshot={rules:[{id:'CUSTOM',policyIds:['doc a','doc b']}],policies:[{id:'doc a',version:'V1.0',sections:[{id:'同名',text:'甲'}]},{id:'doc b',version:'V2.0',sections:[{id:'同名',text:'乙'}]}]};
  const task={id:'T',basisSnapshot:snapshot},session={taskId:'T'},state={tasks:[task]};
  assert.equal(resolveTaskReference(state,session,'同名'),null);
  assert.equal(resolveTaskReference(state,session,referenceKey(snapshot.policies[1],'同名')).section.text,'乙');
  assert.equal(resolveTaskReference(state,session,referenceKey(snapshot.policies[0])).section,null);
  assert.equal(resolveTaskPolicy(state,session,'doc a').id,'doc a');
  assert.equal(resolveTaskReference(state,session,'doc%20a@V9.0#'),null);
  assert.equal(getTaskBasis(state,task),snapshot);assert.equal(getSessionRules(state,session),snapshot.rules);
  assert.equal(getTaskBasis(createInitialState(),createInitialState().sessions[0]).rules.length,7);
});
