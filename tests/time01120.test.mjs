import test from 'node:test';
import assert from 'node:assert/strict';
import {basis,row,fixture,now,sceneId} from './time01120-fixtures.mjs';
import {EC_FIXED24_TIMING_POLICY_VERSION as VERSION,upgradeEcommerceTimingBasis,classificationDependentRuleIds} from '../public/ecommerce-timing-policy.mjs';
import {validateBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';
import {enforceSceneResults} from '../server/scene-capabilities.mjs';
import {ecommerceTimeDependencies} from '../public/ecommerce-time-results.mjs';
import {classificationBlockedRuleIds} from '../public/scene-dependency-staleness.mjs';
import {saveClassificationReview,classificationNeedsJudgment} from '../public/ecommerce-classification-review.mjs';
import {defaultScenePackage,resolveSceneRuntime,validateSceneConfiguration,latestSceneConfiguration,sceneEntity,sceneBasisForTask} from '../public/scene-configuration.mjs';
import {ecommerceBusinessSettings} from '../public/ecommerce-business-settings.mjs';
import {sceneRuntimeForm} from '../public/scene-configuration-ui.mjs';
import {installEcommercePolicyUpgrade} from '../server/builtin-scene-upgrade.mjs';
import {createImportedTask} from '../public/domain.mjs';
import {workbook} from '../public/io.mjs';
import {SYSTEM_EC_HEADERS} from '../public/ecommerce-system-source.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';

test('fixed 24 continuous hours is independent of failed/uncertain classification, site and runtime thresholds',()=>{
 const b=upgradeEcommerceTimingBasis(basis());assert.ok(validateBusinessEcommerceBasis(b));
 for(const status of ['failed','uncertain','completed'])for(const [replyAt,expected] of [['2026-11-22 09:59:59','符合'],['2026-11-22 10:00:00','符合'],['2026-11-22 10:00:01','不符合']]){
  const s=row({status,replyAt});s.contextFields=[{key:'国家',value:'Conflicting site',source:{column:4}}];if(status==='completed')s.sceneCapabilities.outputs.ecommerceClassification.value={evaluationType:'无效评价',vocKind:'none'};
  const r=timeJudgment(s,{basis:b,runtime:{timingStandards:[{siteId:'s',evaluationType:'差评',hours:10000}]}});assert.equal(r.verdict,expected);assert.equal(r.timeFacts.thresholdHours,24);assert.equal(r.timeFacts.timingPolicyVersion,VERSION);assert.equal(r.timeFacts.endTimeSource,'firstReplyTime');assert.equal(r.timeFacts.evaluationType,null);
 }
 assert.equal(ecommerceTimeDependencies(row(),b,now).executorVersion,VERSION);
});
test('missing, malformed, reversed or conflicting timestamps are undetermined; unreplied uses only frozen cutoff',()=>{
 const b=upgradeEcommerceTimingBasis(basis());for(const change of [{replyAt:''},{replyAt:'invalid'},{commentAt:''},{commentAt:'invalid'},{replyAt:'2026-11-21 09:59:59'},{reply:''}])assert.equal(timeJudgment(row(change),{basis:b}).verdict,'无法判定',JSON.stringify(change));
 const s=row({reply:'',replyAt:''});for(const [inspectionAt,expected] of [['2026-11-22T10:00:00+08:00','符合'],['2026-11-22T10:00:01+08:00','不符合'],[undefined,'无法判定']]){const r=timeJudgment(s,{basis:b,inspectionAt});assert.equal(r.verdict,expected);assert.equal(r.timeFacts.replyStatus,'unreplied');assert.equal(r.timeFacts.endTimeSource,'frozen-inspection-time');}
});
test('business source first reply is used even when latest and last reply disagree',async()=>{
 const raw=Array(23).fill('');Object.assign(raw,{0:'Synthetic-id',3:'Synthetic device',4:'VMALL-MX-HWB2C',5:'Synthetic review',6:'Synthetic reply',7:'5',8:'Synthetic agent',9:'2026-11-21 10:00:00',10:'2026-11-23 10:00:00',16:'2026-11-22 10:00:00',17:'2026-11-25 10:00:00'});
 const bytes=Buffer.from(await workbook([{name:'Export',headers:[...SYSTEM_EC_HEADERS],rows:[raw]}])),parsed=await parseEcommerceFile({name:'synthetic-system.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const r=timeJudgment(parsed.sessions[0],{basis:upgradeEcommerceTimingBasis(basis())});assert.equal(r.verdict,'符合');assert.equal(r.timeFacts.elapsedMs,86400000);assert.equal(r.timeFacts.endAt,'2026-11-22T10:00:00+08:00');
});
test('fixed policy is strict and read-only; old site/type editor and snapshots retain original behavior',()=>{
 const old=basis(),fresh=upgradeEcommerceTimingBasis(old);assert.equal(old.businessProfile.timing.policyVersion,undefined);assert.deepEqual(upgradeEcommerceTimingBasis(fresh),fresh);
 for(const change of [{policyVersion:'unknown'},{defaultHours:48},{status:'pending'},{mode:'workingHours'},{standards:[...old.businessProfile.timing.standards]}])assert.throws(()=>validateBusinessEcommerceBasis({...fresh,businessProfile:{...fresh.businessProfile,timing:{...fresh.businessProfile.timing,...change}}}),/固定时效口径/);
 const c=defaultScenePackage({id:sceneId,name:'Synthetic',engine:'ecommerce'},fresh).configuration;c.ruleDependencies={'EC-TIME':[]};assert.ok(validateSceneConfiguration(c));
 assert.throws(()=>resolveSceneRuntime(c,{timingStandards:[]},'Synthetic override'),/统一 24/);
 const wrong=structuredClone(c);wrong.capabilities=[{key:'ecommerceClassification',phase:'pre',dependsOn:[],executorVersion:'scene-capability.v1'}];wrong.ruleDependencies['EC-TIME']=['ecommerceClassification'];assert.throws(()=>validateSceneConfiguration(wrong),/前置分类依赖/);
 const html=ecommerceBusinessSettings(c)+sceneRuntimeForm(c);assert.match(html,/统一 24/);assert.doesNotMatch(html,/data-scfg-path="[^"]*timing\.(defaultHours|standards)|data-scene-standard/);assert.match(ecommerceBusinessSettings({basis:old}),/timing.defaultHours/);
 const s=row({rating:'1',replyAt:'2026-11-23 09:00:00'});assert.equal(timeJudgment(s,{basis:old}).verdict,'符合');assert.equal(timeJudgment(s,{basis:fresh}).verdict,'不符合');assert.equal(timeJudgment(row(),{basis:old}).verdict,'无法判定');
});
test('only STEPS depends on classification under new timing; human reclassification keeps TIME result and draft',()=>{
 const b=upgradeEcommerceTimingBasis(basis()),s=row();s.aiResults=[timeJudgment(s,{basis:b}),{ruleId:'EC-STEPS',verdict:'符合',reason:'Synthetic model result',evidence:[2],referenceIds:[]}];const c=defaultScenePackage({id:sceneId,name:'Synthetic',engine:'ecommerce'},b).configuration;c.ruleDependencies={'EC-TIME':[],'EC-STEPS':['ecommerceClassification']};
 s.aiResults=enforceSceneResults(s.aiResults,{configuration:c},s.sceneCapabilities,s);assert.equal(s.aiResults[0].verdict,'符合');assert.equal(s.aiResults[1].verdict,'无法判定');assert.deepEqual(classificationBlockedRuleIds(s),['EC-STEPS']);assert.deepEqual(classificationDependentRuleIds(s),['EC-STEPS']);
 s.review.drafts={'EC-TIME':{source:'人工修改',verdict:'符合',reason:'Synthetic time reviewed'},'EC-STEPS':{source:'AI接受'}};const before=structuredClone(s),changed=saveClassificationReview({sessions:[s]},s.id,{evaluationType:'好评负向',vocKind:'substantive',reason:'Synthetic classification review'},now).sessions[0];
 assert.deepEqual(changed.aiResults,before.aiResults);assert.deepEqual(changed.review.drafts['EC-TIME'],before.review.drafts['EC-TIME']);assert.equal(changed.review.drafts['EC-STEPS'],undefined);assert.equal(classificationNeedsJudgment(changed,'EC-TIME'),false);assert.equal(classificationNeedsJudgment(changed,'EC-STEPS'),true);
});
test('explicit upgrade preserves existing semantic threshold, other four rules, NP, region dictionary and old tasks',async()=>{
 const f=fixture(),raw=row().ecommerce.raw,bytes=Buffer.from(await workbook([{name:'Sheet4',headers:row().ecommerce.headers,rows:[Array(22).fill(''),raw]}])),parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source={name:'synthetic.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256};f.document.state=createImportedTask(f.document.state,{name:'Synthetic old task',sessions:parsed.sessions,source,basisSnapshot:sceneBasisForTask(f.document.state,f.catalog,sceneId,now),reviewer:'Synthetic reviewer',now});
 const before=structuredClone(f.document),next=installEcommercePolicyUpgrade(f.document,f.input),old=latestSceneConfiguration(before.state,sceneId),current=latestSceneConfiguration(next.state,sceneId);
 assert.deepEqual(f.document,before);assert.deepEqual(next.catalog,before.catalog);assert.deepEqual(next.state.tasks,before.state.tasks);assert.deepEqual(next.state.sessions,before.state.sessions);assert.deepEqual(next.state.sceneConfigurations.filter(c=>c.engine==='conversation'),before.state.sceneConfigurations.filter(c=>c.engine==='conversation'));assert.deepEqual(current.basis.businessProfile.semanticPolicy,old.basis.businessProfile.semanticPolicy);assert.equal(current.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);assert.deepEqual(current.basis.rules.filter(r=>r.id!=='EC-TIME'),old.basis.rules.filter(r=>r.id!=='EC-TIME'));
 assert.deepEqual(current.basis.businessProfile.timing.sites,old.basis.businessProfile.timing.sites);assert.equal(current.basis.businessProfile.timing.defaultHours,24);assert.deepEqual(current.basis.businessProfile.timing.standards,[]);assert.deepEqual(current.ruleDependencies['EC-STEPS'],old.ruleDependencies['EC-STEPS']);assert.deepEqual(current.ruleDependencies['EC-TIME'],[]);assert.equal(sceneEntity(next.state,'deliveryTemplates',current.templateRef).groupBy,'site');assert.equal(current.timingPolicy.allowBatchOverride,false);
 const newState=createImportedTask(next.state,{name:'Synthetic new task',sessions:parsed.sessions,source,basisSnapshot:sceneBasisForTask(next.state,f.catalog,sceneId,now),reviewer:'Synthetic reviewer',now});assert.equal(newState.tasks[0].basisSnapshot.businessProfile.timing.policyVersion,VERSION);assert.equal(newState.tasks[0].executionSnapshot.configuration.basis.businessProfile.timing.policyVersion,VERSION);assert.deepEqual(newState.tasks.at(-1),before.state.tasks[0]);assert.ok(next.state.sceneConfigurationEvents.at(-1).diff.some(d=>d.path==='configuration.basis.businessProfile.timing'));assert.throws(()=>installEcommercePolicyUpgrade(next,{...f.input,expectedVersion:2,operationId:'second'}),/已装载/);
});
