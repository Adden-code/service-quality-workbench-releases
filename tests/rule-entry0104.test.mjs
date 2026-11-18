import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog,createDraft,abandonDraft,assignRuleKind} from '../public/catalog.mjs';
import {nextRuleIds,ruleCategoryOptions,prepareRuleCandidates,ruleCandidateErrors} from '../public/rule-entry.mjs';
import {createImportManager} from '../public/import-manager.mjs';
import {catalogPage} from '../public/catalog-view.mjs';
import {catalogDialog} from '../public/catalog-dialogs.mjs';
import {businessTaskDialog} from '../public/business-dialogs.mjs';
import {handleTaskRuleSelectionAction} from '../public/task-rule-selection-ui.mjs';
import {setLocale} from '../public/i18n.mjs';

const scene='新品产品咨询';
const partial=(id,category='产品信息',sceneIds=[scene])=>({id,category,sceneIds});
const candidate=()=>({id:'LOCAL-NEW',title:'颜色检查',category:'产品信息',scope:'合成咨询',passCriteria:'回应颜色问题',failCriteria:'没有回应颜色问题',exceptionCriteria:'不涉及颜色不适用',sourceQuote:'回应颜色问题',sourceLocator:{start:0,end:6},included:true,confirmed:true});
const dialog=()=>({type:'rule-import',mode:'text',scene,owner:'合成维护人',sourceName:'合成原文.txt',sourceText:'回应颜色问题',effectiveAt:'2026-11-15',policyIds:['P001'],prepared:{modelId:'synthetic',promptVersion:'rule-preparation-ark-v1'},candidates:[candidate()]});
function harness(d=dialog()){
  let current=d,catalog=createCatalog(),uploads=0,commits=0;const state={tasks:[],sessions:[],activity:[]};
  const ctx={getState:()=>state,getCatalog:()=>catalog,getDialog:()=>current,openDialog:value=>{current=value;},closeDialog:()=>{current=null;},render(){},renderDialog(){},toast(){},uploadSource:async()=>{uploads++;return{name:'合成原文.txt',size:18,sha256:'a'.repeat(64)};},commitWorkspace:async updater=>{const next=updater({state,catalog});commits++;catalog=next.catalog;},prepareRules:async()=>({modelId:'synthetic',promptVersion:'rule-preparation-ark-v1',candidates:[{...candidate(),id:'MODEL-CANNOT-OWN-ID'}]})};
  return{manager:createImportManager(ctx),get dialog(){return current;},get catalog(){return catalog;},get uploads(){return uploads;},get commits(){return commits;}};
}

test('IDs follow a scene catalog prefix, skip every existing ID and preserve padding',()=>{
  const catalog={rules:[partial('NP-R21'),partial('NP-R22'),partial('NP-R23','产品信息',['电商评论回复']),partial('EC-R99','电商评论测试',['电商评论回复'])]};
  assert.deepEqual(nextRuleIds(catalog,scene,3),['NP-R24','NP-R25','NP-R26']);
  assert.deepEqual(nextRuleIds({rules:[partial('R007')]},scene,2),['R008','R009']);
  assert.deepEqual(nextRuleIds({rules:[]},scene,2),['NP-R1','NP-R2']);
});

test('model ID is ignored and noncatalog category stays unselected until human choice',()=>{
  const prepared=prepareRuleCandidates([{...candidate(),id:'MODEL-ID',category:'服务时效阈值设置'},{...candidate(),title:'Html报告结构要求'}],createCatalog(),scene);
  assert.deepEqual(prepared.map(item=>item.id),['R008','R009']);assert.equal(prepared[0].category,'');assert.equal(prepared[0].confirmed,false);assert.equal(prepared[1].ruleKind,'meta');
});

test('category choices are scene scoped and first import has a closed starter list',()=>{
  assert.deepEqual(ruleCategoryOptions({rules:[partial('NP-R1','参数'),partial('EC-R1','电商',['电商评论回复'])]},[scene]),['参数']);
  assert.ok(ruleCategoryOptions({rules:[]},[scene]).includes('服务时效'));
});

test('all candidate and batch omissions are reported before uploading or saving',async()=>{
  const d=dialog();Object.assign(d,{owner:'',effectiveAt:'',policyIds:[]});Object.assign(d.candidates[0],{id:'',category:'',scope:'',passCriteria:'',confirmed:false});
  const h=harness(d);await h.manager.action('rule-import-save');
  for(const label of ['维护人','生效日期','关联参考资料','规则标识','类别','适用范围','符合口径','我已对照原文'])assert.match(h.dialog.error,new RegExp(label));
  assert.equal(h.uploads,0);assert.equal(h.commits,0);
});

test('duplicate and existing IDs plus invalid category are detected together',()=>{
  const d=dialog();d.candidates=[{...candidate(),id:'R001',category:'任意自由文本'},{...candidate(),id:'R001'}];
  const errors=ruleCandidateErrors(d,createCatalog()).join('\n');assert.match(errors,/标识已存在/);assert.match(errors,/不能重复/);assert.match(errors,/现有分类/);
});

test('prepare assigns IDs locally and renders a category select plus scope choice',async()=>{
  const h=harness();await h.manager.action('rule-import-prepare');assert.equal(h.dialog.candidates[0].id,'R008');
  const html=h.manager.dialog(h.dialog);assert.match(html,/<select[^>]*id="rule-import-candidate-0-category"/);assert.match(html,/data-candidate-key="ruleKind"/);assert.doesNotMatch(html,/<input[^>]*id="rule-import-candidate-0-category"/);
});

test('metadata edits preserve content confirmation while criteria and scope changes visibly invalidate it',()=>{
  const h=harness();const change=(key,value)=>h.manager.input({target:{dataset:{candidateIndex:'0',candidateKey:key},value,type:'text'}});
  change('id','LOCAL-OTHER');change('category','沟通规范');assert.equal(h.dialog.candidates[0].confirmed,true);
  change('ruleKind','meta');assert.equal(h.dialog.candidates[0].confirmed,false);assert.match(h.manager.dialog(h.dialog),/本项口径或作用域已修改/);
});

test('meta candidate scope persists to draft and does not publish it',async()=>{
  const d=dialog();Object.assign(d.candidates[0],{title:'报告结构要求',ruleKind:'meta'});const h=harness(d);await h.manager.action('rule-import-save');
  assert.equal(h.commits,1);assert.equal(h.catalog.rules.at(-1).ruleKind,'meta');assert.equal(h.catalog.rules.at(-1).status,'草稿');
});

test('abandoned draft leaves default cards but remains in filter and immutable event history',()=>{
  let catalog=createDraft(createCatalog(),'rules','TEMP-1',{...candidate(),id:'TEMP-1',effectiveAt:'2026-11-15',expiresAt:'',owner:'合成维护人',changeNote:'合成测试',policyIds:['P001'],sceneIds:[scene]});
  catalog=abandonDraft(catalog,'rules','TEMP-1','V1.0');
  assert.equal(catalog.rules.at(-1).status,'已弃用');assert.equal(catalog.events.at(-1).action,'弃用草稿');
  assert.doesNotMatch(catalogPage(catalog,'rules',{}),/data-id="TEMP-1"/);assert.match(catalogPage(catalog,'rules',{catalogStatus:'已弃用'}),/data-id="TEMP-1"/);
  assert.match(catalogDialog({type:'catalog-detail',kind:'rules',id:'TEMP-1',version:'V1.0'},catalog),/已弃用/);
});

test('catalog separates scope groups and exposes audited classification controls',()=>{
  const catalog=assignRuleKind(createCatalog(),'R001','V1.0','meta');
  assert.match(catalogPage(catalog,'rules',{}),/catalog-scope-heading">交付物要求/);
  assert.match(catalogDialog({type:'catalog-detail',kind:'rules',id:'R001',version:'V1.0'},catalog),/data-act="catalog-rule-kind"/);
});

test('task picker hides meta by default and shows disabled unchecked rows on demand',()=>{
  const catalog=assignRuleKind(createCatalog(),'R001','V1.0','meta'),d={type:'new-task',mode:'manual',step:3,effectiveDate:'2026-11-15',ruleIds:['R001','R002'],catalog,scene};
  let html=businessTaskDialog(d).body;assert.doesNotMatch(html,/name="task-rule" value="R001"/);assert.match(html,/task-show-all-rules/);
  html=businessTaskDialog({...d,showAllTaskRules:true}).body;assert.match(html,/name="task-rule" value="R001" disabled/);assert.doesNotMatch(html,/name="task-rule" value="R001"[^>]*checked/);
  const inputs=[{value:'R001',checked:true,disabled:true},{value:'R002',checked:false,disabled:false}],root={querySelector(){return null;},querySelectorAll:()=>inputs};
  handleTaskRuleSelectionAction('select-all-task-rules',{dialog:d,root,refreshBasis(){}});assert.deepEqual(d.ruleIds,['R002']);assert.equal(inputs[0].checked,false);
});

test('new scope and import controls are understandable in English without business translation calls',()=>{
  setLocale('en');try{const d=dialog();d.candidates[0].title='Html报告结构要求';d.candidates[0].ruleKind='meta';const h=harness(d),html=h.manager.dialog(d);assert.match(html,/Rule scope type/);assert.match(html,/Deliverable requirements/);assert.match(html,/Select a category/);assert.match(html,/Rule IDs are assigned by the app/);}finally{setLocale('zh');}
});
