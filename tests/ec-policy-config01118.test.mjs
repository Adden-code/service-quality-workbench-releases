import test from 'node:test';
import assert from 'node:assert/strict';
import {EC_SEMANTIC_POLICY_VERSION,validateEcommerceSemanticPolicy,upgradeEcommerceSemanticBasis} from '../public/ecommerce-semantic-policy.mjs';
import {validateBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
import {ecommerceBusinessSettings} from '../public/ecommerce-business-settings.mjs';
import {calibrationScope,calibratedReviewPolicy,stable} from '../public/rule-calibration-policy.mjs';
import {defaultScenePackage,freezeSceneExecution} from '../public/scene-configuration.mjs';
import {createSceneConfigurationManager} from '../public/scene-configuration-ui.mjs';

const IDS=['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];
// Shape mirrors the approved frozen business basis; all strings and records are
// synthetic. No imported business records, external models or network calls.
function fixture(){
 const rules=IDS.map(id=>({id,version:'V3.1',title:`Synthetic ${id}`,name:`Synthetic ${id}`,ruleKind:'session-check',scope:'Synthetic',category:'Synthetic',policyIds:['EC-BUSINESS-POLICY'],passCriteria:`OLD ${id} pass`,failCriteria:`OLD ${id} fail`,exceptionCriteria:`OLD ${id} unknown`,summary:`OLD ${id} summary`,english:{title:`Synthetic ${id}`,scope:'Synthetic',summary:`OLD ${id} summary`},changeNote:'Synthetic prior change'}));
 const sections=rules.map(rule=>({id:`${rule.id}-BUSINESS-1`,title:rule.title,text:`OLD ${rule.id} policy`}));
 return {executionProfile:'ec-business-v1',capturedAt:'2026-11-19T00:00:00Z',effectiveDate:'2026-11-19',rules,policies:[{id:'EC-BUSINESS-POLICY',version:'V3.1',sections,content:sections.map(section=>section.text).join('\n')},{id:'SYNTHETIC-REFERENCE',version:'V1.0',sections:[{id:'archive',title:'Synthetic original',text:'Original reference stays frozen.'}],content:'Original reference stays frozen.'}],businessProfile:{schemaVersion:1,similarity:{method:'normalized-bigram-dice-v1',threshold:.85,minimumRecords:2,scope:'batch'},structure:{minimumSteps:3,counting:'grapheme-with-spaces-v1',closingWaiver:{zh:200,en:240}},privacy:{maskedAllowed:false},timing:{mode:'elapsed',status:'ready',defaultHours:24,defaultSource:'Synthetic approved default',siteField:'国家',sites:[{id:'synthetic',label:'合成站点',aliases:['test-site']}],standards:[{siteId:'synthetic',evaluationType:'差评',hours:48,authoring:'manual',source:'Synthetic manual source'}]}}};
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('old published basis remains valid and rendering it does not opt into new semantics',()=>{
 const old=freeze(fixture()),before=JSON.stringify(old);
 assert.equal(validateBusinessEcommerceBasis(old),true);
 const html=ecommerceBusinessSettings({basis:old});
 assert.match(html,/沿用旧冻结口径/);
 assert.doesNotMatch(html,/data-scfg-path="[^"]*semanticPolicy/);
 assert.equal(JSON.stringify(old),before);
 assert.equal(Object.hasOwn(old.businessProfile,'semanticPolicy'),false);
});

test('semantic policy has a strict version, field set and numeric enum with no silent defaults',()=>{
 for(const minimumSignificantErrors of [1,2])assert.equal(validateEcommerceSemanticPolicy({version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors}}),true);
 const invalid=[null,undefined,[],{}, {version:'next',text:{minimumSignificantErrors:1}},{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:'1'}},{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:0}},{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:3}},{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:1.5}},{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:1},enabled:true},{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:1,allowMinorErrors:true}},{version:EC_SEMANTIC_POLICY_VERSION,text:{}}];
 for(const policy of invalid){assert.throws(()=>validateEcommerceSemanticPolicy(policy),/电商语义口径/);const basis=fixture();basis.businessProfile.semanticPolicy=policy;assert.throws(()=>validateBusinessEcommerceBasis(basis),/电商语义口径/);}
});

test('explicit upgrade clones and freezes policy at default 1 while preserving timing, similarity and EC-TIME',()=>{
 const old=freeze(fixture()),before=JSON.stringify(old),next=upgradeEcommerceSemanticBasis(old);
 assert.deepEqual(next.businessProfile.semanticPolicy,{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:1}});
 for(const key of ['timing','similarity','structure','privacy'])assert.deepEqual(next.businessProfile[key],old.businessProfile[key]);
 assert.deepEqual(next.rules.find(rule=>rule.id==='EC-TIME'),old.rules.find(rule=>rule.id==='EC-TIME'));
 assert.deepEqual(next.policies[0].sections[0],old.policies[0].sections[0]);
 assert.deepEqual(next.policies[1],old.policies[1]);
 assert.equal(next.capturedAt,old.capturedAt);assert.equal(next.effectiveDate,old.effectiveDate);
 assert.equal(validateBusinessEcommerceBasis(next),true);assert.equal(JSON.stringify(old),before);
 assert.notEqual(next.businessProfile.timing,old.businessProfile.timing);
});

test('all four operational rules and matching policy sections move together without conflicting archived text',()=>{
 const next=upgradeEcommerceSemanticBasis(fixture()),policy=next.policies[0];
 assert.equal(policy.version,'V3.2');assert.equal(policy.sections.length,5);
 for(const id of IDS.slice(1)){
  const rule=next.rules.find(item=>item.id===id),section=policy.sections.find(item=>item.id===`${id}-BUSINESS-1`);
  assert.equal(rule.version,'V3.2');assert.match(rule.changeNote,/V3\.1 → V3\.2/);assert.match(rule.changeNote,/ec-human-aligned-v1/);
  assert.doesNotMatch(rule.summary,/OLD/);assert.doesNotMatch(rule.english.summary,/OLD/);
  for(const key of ['passCriteria','failCriteria','exceptionCriteria'])assert.ok(section.text.includes(rule[key]),`${id} ${key}`);
  assert.ok(policy.content.includes(section.text));assert.ok(!policy.content.includes(`OLD ${id}`));
 }
 assert.match(next.rules.find(rule=>rule.id==='EC-STEPS').passCriteria,/仅作写作建议/);
 assert.match(next.rules.find(rule=>rule.id==='EC-STEPS').failCriteria,/至少 3 步/);
 assert.match(next.rules.find(rule=>rule.id==='EC-STEPS').exceptionCriteria,/中差评仍沿用/);
 assert.match(next.rules.find(rule=>rule.id==='EC-PRIVACY').passCriteria,/Hi Sara/);
 assert.match(next.rules.find(rule=>rule.id==='EC-PRIVACY').failCriteria,/掩码个人信息同样不允许/);
 assert.match(next.rules.find(rule=>rule.id==='EC-TARGET').failCriteria,/相同关键词/);
 assert.match(next.rules.find(rule=>rule.id==='EC-TEXT').exceptionCriteria,/重音符号/);
});

test('upgrade is idempotent and never silently resets an explicitly selected threshold of 2',()=>{
 const next=upgradeEcommerceSemanticBasis(fixture(),{minimumSignificantErrors:2});
 assert.deepEqual(upgradeEcommerceSemanticBasis(next),next);
 const reset=upgradeEcommerceSemanticBasis(next,{minimumSignificantErrors:1});
 assert.equal(reset.businessProfile.semanticPolicy.text.minimumSignificantErrors,1);
 assert.deepEqual(reset.rules,next.rules);assert.deepEqual(reset.policies,next.policies);
 assert.equal(next.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
 assert.throws(()=>upgradeEcommerceSemanticBasis(fixture(),{minimumSignificantErrors:'2'}),/电商语义口径/);
 assert.throws(()=>upgradeEcommerceSemanticBasis(fixture(),{extra:true}),/升级选项/);
});

test('higher customized rule versions are advanced, never downgraded',()=>{
 const old=fixture();old.rules.find(rule=>rule.id==='EC-TEXT').version='V7.8';old.policies[0].version='V4.0';
 const next=upgradeEcommerceSemanticBasis(old);
 assert.equal(next.rules.find(rule=>rule.id==='EC-TEXT').version,'V7.9');assert.equal(next.policies[0].version,'V4.1');
});

test('non-business EC and NP bases are cloned without opt-in or rule changes',()=>{
 for(const basis of [{rules:[{id:'NP-R01',version:'V1.2'}],policies:[]},{executionProfile:'legacy-ecommerce',rules:[{id:'EC-TEXT',version:'V1.0'}],policies:[]}]){
  const old=freeze(basis),next=upgradeEcommerceSemanticBasis(old);assert.deepEqual(next,old);assert.notEqual(next,old);
 }
});

test('admin UI exposes exactly 1/2 with an explicit numeric scene field and explanation',()=>{
 for(const count of [1,2]){
  const html=ecommerceBusinessSettings({basis:upgradeEcommerceSemanticBasis(fixture(),{minimumSignificantErrors:count})});
  assert.match(html,/data-scfg-path="configuration\.basis\.businessProfile\.semanticPolicy\.text\.minimumSignificantErrors" data-scfg-number="true"/);
  assert.match(html,new RegExp(`<option value="${count}" selected>`));
  assert.match(html,/1 处显著错误（默认）/);assert.match(html,/2 处显著错误（管理员选用）/);
  assert.match(html,/单处显著错误只作建议/);assert.match(html,/旧任务与旧标定范围保持冻结/);
 }
});

test('admin select edits only the draft using a number and keeps already frozen basis unchanged',()=>{
 const frozen=freeze(upgradeEcommerceSemanticBasis(fixture()));
 const pkg=defaultScenePackage({id:'电商评论回复',name:'Synthetic',engine:'ecommerce'},frozen);
 const dialog={type:'scfg-edit',draft:{status:'draft'},package:pkg,dirty:false};
 const manager=createSceneConfigurationManager({getDialog:()=>dialog,getState:()=>({}),renderDialog:()=>{}});
 assert.equal(manager.input({target:{dataset:{scfgPath:'configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors',scfgNumber:'true'},type:'select-one',value:'2'}}),true);
 assert.equal(pkg.configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
 assert.equal(frozen.businessProfile.semanticPolicy.text.minimumSignificantErrors,1);
 assert.equal(dialog.dirty,true);assert.equal(validateBusinessEcommerceBasis(pkg.configuration.basis),true);
});

test('B6 calibration scope excludes prior approvals when policy or frozen threshold changes',()=>{
 const task={scene:'电商评论回复',basisSnapshot:fixture()};
 const record={id:'synthetic-calibration',ruleId:'EC-TEXT',ruleVersion:'V3.1',modelFingerprint:'synthetic-model',promptVersion:'synthetic-prompt',enabled:true,pairCount:30,correctCount:30,scope:structuredClone(calibrationScope(task))};
 const state={ruleCalibrations:{records:[record]}};
 assert.equal(calibratedReviewPolicy(state,task).rules.length,1);
 const nextTask={...task,basisSnapshot:upgradeEcommerceSemanticBasis(task.basisSnapshot)};
 assert.notEqual(stable(calibrationScope(task)),stable(calibrationScope(nextTask)));
 assert.equal(calibratedReviewPolicy(state,nextTask).rules.length,0);
 const nextRecord={...record,ruleVersion:'V3.2',scope:structuredClone(calibrationScope(nextTask))};
 assert.equal(calibratedReviewPolicy({ruleCalibrations:{records:[nextRecord]}},nextTask).rules.length,1);
 const two={...nextTask,basisSnapshot:upgradeEcommerceSemanticBasis(nextTask.basisSnapshot,{minimumSignificantErrors:2})};
 assert.equal(calibratedReviewPolicy({ruleCalibrations:{records:[nextRecord]}},two).rules.length,0);
 assert.equal(record.enabled,true);assert.equal(calibratedReviewPolicy(state,task).rules.length,1);
});

test('new task snapshot freezes selected semantics independently of later scene changes',()=>{
 const basis=upgradeEcommerceSemanticBasis(fixture(),{minimumSignificantErrors:2});
 const pkg=defaultScenePackage({id:'电商评论回复',name:'Synthetic',engine:'ecommerce'},basis);
 pkg.configuration.status='published';
 const state={sceneConfigurations:[pkg.configuration],deliveryTemplates:[pkg.template],classificationTaxonomies:[],ruleExceptionTables:[]};
 const execution=freezeSceneExecution(state,'电商评论回复',{basis});
 assert.equal(execution.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
 pkg.configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors=1;
 assert.equal(execution.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
 assert.equal(execution.configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
});
