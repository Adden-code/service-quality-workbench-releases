import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessCatalog,validateRecord} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {createRuleSetDraft,publishRuleSet,retireRuleSet} from '../public/ecommerce-rule-sets.mjs';
import * as ec from '../public/ecommerce-catalog.mjs';
import {assertTaskCatalogScene} from '../public/catalog-scenes.mjs';
const now='2026-11-03T09:00:00+08:00';
const opts={ruleSetId:'EC-REVIEW',version:'V2.1-A',effectiveDate:'2026-11-03',now};
const clone=value=>structuredClone(value);
function fixture(){let catalog=ec.ensureEcommerceCatalog(createBusinessCatalog(),{now});catalog=createRuleSetDraft(catalog,'EC-REVIEW',{owner:'维护人',changeNote:'已确认阶段A',effectiveAt:opts.effectiveDate},now);return publishRuleSet(catalog,'EC-REVIEW','V2.1-A',now);}

test('ruleSet basis compiles a self-consistent time rule and policy while keeping four V1 bodies and references intact',()=>{
  assert.equal(typeof ec.createEcommerceRuleSetBasis,'function');
  const catalog=fixture(),before=clone(catalog),legacy=createBasisSnapshot(catalog,{...opts,ruleIds:EC_RULE_IDS});
  const basis=ec.createEcommerceRuleSetBasis(catalog,opts),time=basis.rules.find(r=>r.id==='EC-TIME');
  assert.deepEqual(catalog,before);assert.deepEqual(basis.ruleSetSnapshot,catalog.ruleSets[0]);assert.equal(basis.ruleSetSnapshot.status,'已发布');
  assert.deepEqual(basis.rules.filter(r=>r.id!=='EC-TIME'),legacy.rules.filter(r=>r.id!=='EC-TIME'));
  assert.deepEqual(basis.policies.find(p=>p.id==='EC-POLICY'),legacy.policies[0]);
  assert.deepEqual(time.policyIds,['EC-TIME-EC-REVIEW']);assert.equal(time.version,'V2.1');assert.match(time.passCriteria,/工作|72|48/);assert.doesNotMatch(time.passCriteria,/连续自然时间/);
  const policy=basis.policies.find(p=>p.id===time.policyIds[0]);assert.match(policy.content,/好评正向.*72|72.*好评正向/);assert.match(policy.content,/09:00|18:00|UTC\+08:00/);
  assert.equal(ec.validateEcommerceBasis(basis),true);assert.equal(ec.authenticateEcommerceRuleSetBasis(catalog,basis),true);
  catalog.ruleSets[0].timeRule.thresholds.byType['好评正向']=12;assert.equal(basis.ruleSetSnapshot.timeRule.thresholds.byType['好评正向'],72);
});

test('self-authentication rejects tampered or unsupported frozen config, stale derived bodies and V1 edits',()=>{
  assert.equal(typeof ec.createEcommerceRuleSetBasis,'function');const catalog=fixture(),basis=ec.createEcommerceRuleSetBasis(catalog,opts);
  for(const mutate of [b=>b.ruleSetSnapshot.timeRule.thresholds.default=50,b=>b.rules[0].passCriteria+='任意改写',b=>b.policies[1].sections[0].text+='任意改写',b=>b.rules[1].version='V1.1',b=>b.policies[0].sections[0].text+='改写',b=>b.ruleSetSnapshot.textRule={},b=>b.policies.push(clone(b.policies[1]))]){
    const changed=clone(basis);mutate(changed);assert.equal(ec.isEcommerceBasis(changed),false);assert.throws(()=>ec.validateEcommerceBasis(changed));
  }
  const forged=clone(catalog);forged.ruleSets[0].timeRule.thresholds.default=50;
  const coherentForged=ec.createEcommerceRuleSetBasis(forged,opts);assert.equal(ec.isEcommerceBasis(coherentForged),true);assert.throws(()=>ec.authenticateEcommerceRuleSetBasis(catalog,coherentForged),/目录|发布|匹配/);
});

test('publication authentication is required for new tasks and retirement preserves existing frozen execution',()=>{
  assert.equal(typeof ec.createEcommerceRuleSetBasis,'function');const catalog=fixture(),basis=ec.createEcommerceRuleSetBasis(catalog,opts),retired=retireRuleSet(catalog,'EC-REVIEW','V2.1-A',now);
  assert.throws(()=>ec.createEcommerceRuleSetBasis(retired,opts),/发布/);assert.throws(()=>ec.authenticateEcommerceRuleSetBasis(retired,basis),/发布/);
  assert.equal(ec.validateEcommerceBasis(basis),true);assert.equal(ec.authenticateEcommerceRuleSetBasis(retired,basis,{requirePublished:false}),true);
  assert.throws(()=>ec.createEcommerceRuleSetBasis(catalog,{...opts,effectiveDate:'2026-11-02'}),/生效|发布/);
  const executable=ec.listExecutableEcommerceVersions(catalog,{asOf:opts.effectiveDate});
  assert.ok(executable.some(v=>v.version==='V1.0'));assert.ok(executable.some(v=>v.version==='V2.1-A'&&v.ruleSetId==='EC-REVIEW'&&v.executionProfile==='v21-time-v1-content'));
  assert.equal(executable.find(v=>v.version==='V2.1-A').title,'V2.1-A（时效升级；其他四项V1）');
  const retiredList=ec.listExecutableEcommerceVersions(retired,{asOf:opts.effectiveDate});assert.equal(retiredList.length,1);assert.equal(retiredList[0].version,'V1.0');
});

test('continuous mode materializes continuous timing text without changing working-hour defaults by inference',()=>{
  assert.equal(typeof ec.createEcommerceRuleSetBasis,'function');const catalog=fixture();catalog.ruleSets[0].timeRule.mode='continuous';
  const basis=ec.createEcommerceRuleSetBasis(catalog,opts);assert.match(basis.rules[0].passCriteria,/连续自然/);assert.equal(basis.ruleSetSnapshot.timeRule.thresholds.byType['好评正向'],72);
  assert.equal(ec.isEcommerceBasis(basis),true);
});

test('supported long holiday lists and titles compile into bounded valid version records with exact calendar evidence',()=>{
  const catalog=fixture(),r=catalog.ruleSets[0];r.title='测'.repeat(120);
  r.timeRule.calendar.holidays=Array.from({length:3660},(_,i)=>new Date(Date.UTC(2027,0,1+i)).toISOString().slice(0,10));
  const basis=ec.createEcommerceRuleSetBasis(catalog,opts),time=basis.rules[0],policy=basis.policies[1];
  assert.equal(validateRecord(time,'rules'),true);assert.equal(validateRecord(policy,'policies'),true);
  assert.match(policy.content,/2037-01-07/);assert.deepEqual(basis.ruleSetSnapshot.timeRule.calendar.holidays,r.timeRule.calendar.holidays);
});
test('ecommerce availability and new bases respect explicit scene ownership of all source rules and policies',()=>{
  const original=fixture(),basis=ec.createEcommerceRuleSetBasis(original,opts);
  assert.equal(ec.listExecutableEcommerceVersions(original,{asOf:opts.effectiveDate}).length,2,'legacy missing metadata remains compatible');
  for(const kind of ['rules','policies'])for(const record of original[kind])for(const sceneIds of [[],['新品产品咨询']]){
    const catalog=clone(original);catalog[kind].find(item=>item.id===record.id).sceneIds=sceneIds;
    assert.deepEqual(ec.listExecutableEcommerceVersions(catalog,{asOf:opts.effectiveDate}),[],`${kind}/${record.id} cannot be selected outside ecommerce ownership`);
    assert.throws(()=>ec.createEcommerceRuleSetBasis(catalog,opts),/场景|归属/);
    assert.throws(()=>ec.authenticateEcommerceRuleSetBasis(catalog,basis),/场景|归属/);
    assert.throws(()=>assertTaskCatalogScene({catalog,scene:'电商评论回复',basisSnapshot:basis}),/场景|归属/);
    const legacy=createBasisSnapshot(catalog,{...opts,ruleIds:EC_RULE_IDS});
    assert.throws(()=>assertTaskCatalogScene({catalog,scene:'电商评论回复',basisSnapshot:legacy}),/场景|归属/);
  }
});
test('scene reassignment does not invalidate a previously frozen ecommerce basis or historical authentication',()=>{
  const catalog=fixture(),basis=ec.createEcommerceRuleSetBasis(catalog,opts);
  for(const record of [...catalog.rules,...catalog.policies])record.sceneIds=[];
  assert.equal(ec.validateEcommerceBasis(basis),true);
  assert.equal(ec.authenticateEcommerceRuleSetBasis(catalog,basis,{requirePublished:false}),true);
});
