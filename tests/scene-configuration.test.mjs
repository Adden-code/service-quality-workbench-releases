import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {migrateSceneConfigurations,sceneConfigurationMutation} from '../server/scene-configuration-service.mjs';
import {validateScenePackage,validateSceneRegistry,resolveSceneRuntime,defaultTimingPolicy,validateTimingPolicy,latestSceneConfiguration,freezeSceneExecution,sceneBasisForTask,sceneDraftExpired} from '../public/scene-configuration.mjs';
import {ruleVersionReferences,deleteRetiredRule} from '../public/rule-deletion.mjs';
const at='2026-11-16T00:00:00Z',sceneId='新品产品咨询';let seq=0;
const fixture=()=>migrateSceneConfigurations({state:createBusinessState(),catalog:createCatalog()},{now:at});
const mutate=(d,input)=>sceneConfigurationMutation(d,{operationId:`synthetic-${++seq}`,actor:'合成测试',reason:'仅用于合成回归',...input},{now:at});
const create=d=>mutate(d,{action:'create',sceneId});
const last=d=>d.state.scenePackageDrafts.at(-1);
const action=(d,act,more={})=>mutate(d,{action:act,draftId:last(d).id,expectedRevision:last(d).revision,...more});
function ready(d){for(const tab of ['rules','auxiliary','delivery'])d=action(d,'confirm',{tab});return d;}
test('migration is idempotent and retains exact old tasks, rule bodies and audit defaults',()=>{
 const original={state:createBusinessState(),catalog:createCatalog()},saved=structuredClone(original);const d=migrateSceneConfigurations(original,{now:at});
 assert.deepEqual(original,saved);assert.deepEqual(d.state.tasks,saved.state.tasks);assert.deepEqual(d.catalog,saved.catalog);assert.deepEqual(migrateSceneConfigurations(d),d);
 assert.equal(d.state.sceneConfigurations.length,2);assert.equal(d.state.sceneConfigurationEvents.length,2);assert.ok(d.state.sceneConfigurations.every(c=>c.executionMode==='legacy'));
 assert.equal(d.state.sceneConfigurations[0].runtimeFields[0].default,'rule-calibrated');validateSceneRegistry(d.state);
});
test('publish requires three current confirmations and is atomic with unchanged prior config',()=>{
 let d=create(fixture());const old=latestSceneConfiguration(d.state,sceneId),pkg=structuredClone(last(d).package);pkg.template.title='合成新标题';d=action(d,'save',{package:pkg});
 assert.throws(()=>action(d,'publish'),/三个Tab/);const prior=structuredClone(d);d=ready(d);d=action(d,'publish');
 assert.equal(latestSceneConfiguration(d.state,sceneId).version,2);assert.deepEqual(d.state.sceneConfigurations[0],old);assert.equal(last(prior).status,'draft');
 assert.ok(d.state.sceneConfigurationEvents.at(-1).diff.length);assert.equal(d.state.sceneConfigurationEvents.at(-1).actor,'合成测试');
});
test('editing delivery invalidates only that confirmation; rule changes invalidate all',()=>{
 let d=ready(create(fixture())),pkg=structuredClone(last(d).package);pkg.template.title='改变标题';d=action(d,'save',{package:pkg});assert.ok(last(d).confirmations.rules);assert.ok(last(d).confirmations.auxiliary);assert.equal(last(d).confirmations.delivery,undefined);
 pkg=structuredClone(last(d).package);pkg.configuration.basis.rules[0].passCriteria+=' 合成修改';d=action(d,'save',{package:pkg});assert.deepEqual(last(d).confirmations,{});
});
test('concurrent workspace updates preserve drafts; same draft revision and stale publishing baseline conflict',()=>{
 let d=create(fixture()),first=last(d);d=create(d);const second=last(d);assert.equal(d.state.scenePackageDrafts.length,2);
 for(const tab of ['rules','auxiliary','delivery'])d=mutate(d,{action:'confirm',draftId:first.id,expectedRevision:d.state.scenePackageDrafts[0].revision,tab});
 d=mutate(d,{action:'publish',draftId:first.id,expectedRevision:d.state.scenePackageDrafts[0].revision});
 assert.throws(()=>mutate(d,{action:'save',draftId:first.id,expectedRevision:first.revision,package:first.package}),/另一页面/);
 d=ready(d);assert.equal(last(d).id,second.id);assert.throws(()=>action(d,'publish'),/基线过期/);
});
test('published and archived draft versions protect rule deletion',()=>{
 let d=create(fixture());d=action(d,'archive');const rule=d.catalog.rules[0];assert.ok(ruleVersionReferences(d.state,rule).some(r=>r.kind==='scene'));assert.ok(ruleVersionReferences(d.state,rule).some(r=>r.kind==='draft'));
 const cat=structuredClone(d.catalog);cat.rules[0].status='已停用';assert.throws(()=>deleteRetiredRule(cat,d.state,{id:rule.id,version:rule.version,reason:'测试',actor:'测试',operationId:'del'}),/引用/);
 d=action(d,'restore');assert.equal(last(d).status,'draft');assert.equal(sceneDraftExpired(last(d),Date.parse(at)+31*86400000),true);
});
test('complete registry cannot be forged or removed via ordinary workspace saves',()=>{
 const d=fixture(),changed=structuredClone(d.state);changed.sceneConfigurations[0].reason='改写';assert.throws(()=>validateSceneRegistry(changed,d.state),/事务/);
 const removed=structuredClone(d.state);for(const k of Object.keys(removed))if(k.startsWith('scene')||['deliveryTemplates','classificationTaxonomies','ruleExceptionTables'].includes(k))delete removed[k];assert.throws(()=>validateSceneRegistry(removed,d.state),/不能移除/);
});
test('timing tables are manual, site specific, complete and strictly typed',()=>{
 const p=defaultTimingPolicy();p.enabled=true;p.sites=[{id:'synthetic-a',label:'合成站点A',aliases:['SYNTH-A']}];assert.throws(()=>validateTimingPolicy(p),/缺少/);
 p.standards=['firstResponseDuration','queryWaitDuration','queryCount'].map((metric,i)=>({siteId:'synthetic-a',metric,value:i===2?2:60,unit:i===2?'count':'seconds',operator:'>',source:'合成依据',authoring:'manual'}));validateTimingPolicy(p);
 const ai=structuredClone(p);ai.standards[0].authoring='ai';assert.throws(()=>validateTimingPolicy(ai),/手工/);
 const fractional=structuredClone(p);fractional.standards[2].value=1.5;assert.throws(()=>validateTimingPolicy(fractional),/整数/);
 const changed=structuredClone(p);changed.definitions.queryWaitDuration='sum';assert.throws(()=>validateTimingPolicy(changed),/逐次/);
});
test('runtime mode is exclusive, B6 default does not use legacy confidence, no per-row override',()=>{
 const c=fixture().state.sceneConfigurations[0];assert.equal(resolveSceneRuntime(c).values.reviewMode,'rule-calibrated');assert.equal(resolveSceneRuntime(c,{reviewMode:'confidence',legacyConfidenceThreshold:0.7}).values.legacyConfidenceThreshold,0.7);
 assert.throws(()=>resolveSceneRuntime(c,{sessionThresholds:{x:1}}),/不支持/);assert.throws(()=>resolveSceneRuntime(c,{regionConfidenceThreshold:0.1}),/不允许/);
 assert.throws(()=>resolveSceneRuntime(c,{timingStandards:[]},'测试'),/不允许/);
});
test('template maps exact rule version independently from groups, preserving unknown and audit appendix',()=>{
 const p=last(create(fixture())).package;p.template.columnGroups=[{id:'other',label:'与规则类别无关的列组',parentId:''}];p.template.columns.find(c=>c.generator==='rule').groupId='other';validateScenePackage(p);
 const bad=structuredClone(p);bad.template.columns.find(c=>c.generator==='rule').enum=['符合','不符合','不适用'];assert.throws(()=>validateScenePackage(bad),/无法判定和未执行/);
 const dup=structuredClone(p);dup.template.columns.push({...dup.template.columns.find(c=>c.generator==='rule'),id:'duplicate'});assert.throws(()=>validateScenePackage(dup),/不能重复/);
 const hide=structuredClone(p);hide.template.auditMode='none';assert.throws(()=>validateScenePackage(hide),/审计/);
});
test('new task reads published frozen rule versions and refuses retired basis',()=>{
 const d=fixture(),basis=sceneBasisForTask(d.state,d.catalog,sceneId,at),s=freezeSceneExecution(d.state,sceneId,{basis});assert.deepEqual(s.basis,basis);
 const upgraded=structuredClone(d.catalog);upgraded.rules.push({...upgraded.rules[0],version:'V99.0'});assert.deepEqual(sceneBasisForTask(d.state,upgraded,sceneId,at),basis);
 assert.throws(()=>freezeSceneExecution(d.state,sceneId,{basis,expectedVersion:9}),/填写期间/);
 upgraded.rules[0].status='已停用';assert.throws(()=>sceneBasisForTask(d.state,upgraded,sceneId,at),/停用/);
});
test('operation replay is idempotent and rejects changed body',()=>{
 const base=fixture(),input={action:'create',sceneId,operationId:'stable-op',actor:'合成',reason:'合成'};const d=sceneConfigurationMutation(base,input,{now:at});assert.deepEqual(sceneConfigurationMutation(d,input,{now:at}),d);assert.throws(()=>sceneConfigurationMutation(d,{...input,reason:'other'},{now:at}),/同一/);
});

test('three-way draft replay merges disjoint fields and blocks ambiguous list edits',async()=>{const{mergeSceneDraft}=await import('../public/scene-configuration.mjs');const base={a:1,b:2,list:[1,2]},local={...base,a:3},remote={...base,b:4};assert.deepEqual(mergeSceneDraft(base,local,remote),{package:{a:3,b:4,list:[1,2]},conflicts:[]});assert.deepEqual(mergeSceneDraft(base,{...base,list:[2,1]},{...base,list:[1,2,3]}).conflicts,['list']);});
