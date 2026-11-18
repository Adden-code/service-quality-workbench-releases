import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog,createDraft,validateCatalog,validateRecord} from '../public/catalog.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';

const api=await import('../public/catalog-scenes.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const scene='SCENE-AFTER',now='2026-11-10T10:00:00+08:00';
const config=()=>({schemaVersion:1,id:scene,name:'售后',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:['AFTER-RULE'],analysisFields:['intent'],customFields:[],report:{title:'售后报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']},requiredCapabilities:['text-judgment'],createdAt:now,updatedAt:now});
function fixture(){
 const base=createCatalog(),rule=base.rules[0],policy=base.policies[0];
 const record=(id,policyId,extra={})=>({...structuredClone(rule),id,policyIds:[policyId],...extra});
 const doc=(id,extra={})=>({...structuredClone(policy),id,...extra});
 const catalog={schemaVersion:1,rules:[record('EC-TEXT','EC-DOC'),record('NP-TEXT','NP-DOC'),record('AFTER-RULE','SHARED'),record('UNKNOWN','OTHER'),record('MANUAL','SHARED',{sceneIds:[]})],policies:[doc('EC-DOC'),doc('NP-DOC'),doc('SHARED'),doc('OTHER')],events:[]};
 // A pre-migration fixture has no scene metadata, including on known demo source records.
 for(const item of [...catalog.rules,...catalog.policies])if(item.id!=='MANUAL')delete item.sceneIds;
 const state={...createBusinessState(),scenarios:[config()],tasks:[{id:'OLD',basisSnapshot:{rules:[structuredClone(catalog.rules[3])],policies:[structuredClone(catalog.policies[3])]}}]};
 return{state,catalog};
}
test('migration assigns legacy prefixes and registered custom references without touching state or content',()=>{
 assert.equal(typeof api.migrateCatalogScenes,'function','scene migration API is missing');
 const {state,catalog}=fixture(),before=structuredClone({state,catalog}),out=api.migrateCatalogScenes({state,catalog});
 assert.equal(out.changed,true);assert.deepEqual(out.state,before.state);assert.deepEqual({state,catalog},before);
 assert.deepEqual(out.catalog.rules.map(r=>r.sceneIds),[['电商评论回复'],['新品产品咨询'],[scene],[],[]]);
 assert.deepEqual(out.catalog.policies.map(r=>r.sceneIds),[['电商评论回复'],['新品产品咨询'],[scene],[]]);
 const withoutScenes=value=>{const copy=structuredClone(value);for(const record of [...copy.rules,...copy.policies])delete record.sceneIds;return copy;};
 assert.deepEqual(withoutScenes(out.catalog),withoutScenes(catalog),'versions, dates, statuses, text and events must remain unchanged');
 assert.deepEqual(api.migrateCatalogScenes(out),{...out,changed:false});
});
test('explicit metadata wins over inference and unknown records never become consultation rules',()=>{
 assert.equal(typeof api.catalogRecordMatchesScene,'function');
 const {state,catalog}=fixture();catalog.rules[1].sceneIds=[scene];catalog.policies[1].sceneIds=[];
 assert.equal(api.catalogRecordMatchesScene(catalog.rules[1],'新品产品咨询',{state,catalog,kind:'rules'}),false);
 assert.equal(api.catalogRecordMatchesScene(catalog.rules[3],'新品产品咨询',{state,catalog,kind:'rules'}),false);
 assert.equal(api.catalogRecordMatchesScene(catalog.rules[2],scene,{state,catalog,kind:'rules'}),true);
 assert.deepEqual(api.migrateCatalogScenes({state,catalog}).catalog.policies[1].sceneIds,[]);
});
test('optional scene metadata validates and draft updates preserve scene selection',()=>{
 const catalog=createCatalog(),rule=catalog.rules[0];
 for(const sceneIds of ['新品产品咨询',['SCENE-OK','SCENE-OK'],['unknown'],[''],null])assert.throws(()=>validateRecord({...rule,sceneIds},'rules'),/场景/);
 assert.doesNotThrow(()=>validateRecord({...rule,sceneIds:[]},'rules'));
 const next=createDraft(catalog,'rules',rule.id,{sceneIds:[scene]},now);assert.deepEqual(next.rules.at(-1).sceneIds,[scene]);
 assert.equal(validateCatalog(next),true);
});
test('scene eligibility requires assigned published rules and effective assigned policies, with actionable reasons',()=>{
 assert.equal(typeof api.sceneRuleAvailability,'function');
 const {state,catalog}=fixture(),options={state,catalog,scene:'新品产品咨询',effectiveDate:'2026-11-10'};
 assert.deepEqual(api.sceneRuleAvailability(options).rules.map(rule=>rule.id),['NP-TEXT']);
 catalog.rules[1].status='草稿';assert.equal(api.sceneRuleAvailability(options).reasons.unpublished,1);
 catalog.rules[1].status='已发布';catalog.rules[1].effectiveAt='2026-12-01';assert.equal(api.sceneRuleAvailability(options).reasons.future,1);
 catalog.rules[1].effectiveAt='2026-10-01';catalog.rules[1].expiresAt='2026-11-10';assert.equal(api.sceneRuleAvailability(options).reasons.expired,1);
 catalog.rules[1].expiresAt='';catalog.policies[1].sceneIds=[];assert.equal(api.sceneRuleAvailability(options).reasons.policyUnavailable,1);
 assert.equal(api.sceneRuleAvailability(options).reasons.unassigned,2);
 assert.equal(api.sceneRuleAvailability({...options,catalog:{...catalog,rules:[]}}).reasons.empty,true);
});
test('server rejects new tasks with foreign/unassigned bases while already saved snapshots remain valid',()=>{
 const catalog=createCatalog(),before=createBusinessState();
 catalog.rules[0].sceneIds=['新品产品咨询'];for(const policy of catalog.policies)policy.sceneIds=['新品产品咨询'];
 const state=createImportedTask(before,{name:'批次',reviewer:'审核员',source:{name:'in.json',size:20,sha256:'a'.repeat(64)},now,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-10',ruleIds:['R001'],now}),sessions:[{id:'s',scene:'新品产品咨询',startedAt:now,topic:'咨询',product:'产品',agent:'客服',customer:'客户',channel:'线上',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'客户',at:'',text:'如何操作？'}]}]});
 assert.equal(validateWorkspace(state,catalog,before,{authenticateNewSnapshots:true}),true);
 for(const sceneIds of [[],['电商评论回复']]){
  const changed=structuredClone(catalog);changed.rules[0].sceneIds=sceneIds;
  assert.throws(()=>validateWorkspace(state,changed,before,{authenticateNewSnapshots:true}),/场景|归属/);
  assert.equal(validateWorkspace(state,changed,state,{authenticateNewSnapshots:true}),true,'an old task must retain its original basis');
 }
 const changed=structuredClone(catalog);changed.policies[0].sceneIds=[];
 assert.throws(()=>validateWorkspace(state,changed,before,{authenticateNewSnapshots:true}),/场景|归属/);
});
test('published scene maintenance changes only metadata and cannot edit published content',async()=>{
 const {assignCatalogScenes}=await import('../public/catalog.mjs');assert.equal(typeof assignCatalogScenes,'function');
 const catalog=createCatalog(),before=structuredClone(catalog),next=assignCatalogScenes(catalog,'rules','R001','V1.0',[scene],now);
 const expected=structuredClone(before);expected.rules[0].sceneIds=[scene];expected.events.push({kind:'rules',id:'R001',version:'V1.0',action:'维护场景归属',at:now});
 assert.deepEqual(next,expected);assert.deepEqual(catalog,before);
 const {updateDraft}=await import('../public/catalog.mjs');assert.throws(()=>updateDraft(next,'rules','R001','V1.0',{title:'不得改写'},now),/草稿|新版本/);
});
test('server rejects nonexistent scene ownership and changed custom defaults with foreign rules',()=>{
 const {state,catalog}=fixture();state.tasks=[];
 const nonexistent=structuredClone(catalog);nonexistent.rules[0].sceneIds=['SCENE-NO-SUCH'];
 assert.throws(()=>validateWorkspace(state,nonexistent,null,{authenticateNewSnapshots:true}),/场景|注册/);
 catalog.rules.find(rule=>rule.id==='AFTER-RULE').sceneIds=['新品产品咨询'];
 assert.throws(()=>validateWorkspace(state,catalog,null,{authenticateNewSnapshots:true}),/场景|归属/);
});
test('custom scene choices and save guard only accept rules owned by that scene',async()=>{
 const {scenarioRuleChoices}=await import('../public/scenario-ui.mjs'),{createScenarioManager}=await import('../public/scenario-manager.mjs');
 const {state,catalog}=fixture();state.tasks=[];catalog.rules.find(rule=>rule.id==='AFTER-RULE').sceneIds=[scene];catalog.rules[1].sceneIds=['新品产品咨询'];
 assert.deepEqual(scenarioRuleChoices(catalog,{state,scene}).map(rule=>rule.id),['AFTER-RULE']);
 let dialog,commits=0;const manager=createScenarioManager({getState:()=>state,getCatalog:()=>catalog,getDialog:()=>dialog,openDialog:value=>{dialog=value;},render(){},renderDialog(){},toast(){},commitWorkspace:async updater=>{const next=updater({state,catalog});commits++;return next;}});
 await manager.action('scenario-edit',{dataset:{id:scene}});dialog.config.ruleIds=['NP-TEXT'];await manager.action('scenario-save');
 assert.equal(commits,0);assert.match(dialog.error,/归属|场景/);
});
test('server authenticates ecommerce scene ownership for both basis forms and preserves existing tasks',async()=>{
 const {publishedFixture}=await import('./v21-runtime-fixtures.mjs'),{EC_RULE_IDS}=await import('../public/ecommerce-schema.mjs');
 for(const stageA of [false,true]){
  const {state,catalog}=publishedFixture(),before=createBusinessState();
  if(!stageA)state.tasks[0].basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-03',ruleIds:EC_RULE_IDS,now:'2026-11-03T09:00:00+08:00'});
  assert.equal(validateWorkspace(state,catalog,before,{authenticateNewSnapshots:true}),true);
  const original=structuredClone(state);
  for(const kind of ['rules','policies'])for(const source of catalog[kind])for(const sceneIds of [[],['新品产品咨询']]){
   const reassigned=structuredClone(catalog);reassigned[kind].find(record=>record.id===source.id).sceneIds=sceneIds;
   assert.throws(()=>validateWorkspace(state,reassigned,before,{authenticateNewSnapshots:true}),/场景|归属/);
   assert.equal(validateWorkspace(state,reassigned,state,{authenticateNewSnapshots:true}),true);
   assert.deepEqual(state,original);
  }
 }
});

test('task default selection follows scenario, removes meta, and date is local calendar day',()=>{
 const {state,catalog}=api.migrateCatalogScenes(fixture());const selected=api.defaultSceneRuleIds({state,catalog,scene,effectiveDate:'2026-11-17'});assert.deepEqual(selected,['AFTER-RULE']);catalog.rules.find(r=>r.id==='AFTER-RULE').ruleKind='meta';assert.deepEqual(api.defaultSceneRuleIds({state,catalog,scene,effectiveDate:'2026-11-17'}),[]);assert.equal(api.localBasisDate(new Date(2026,10,17,23,30)),'2026-11-17');
});
test('bundled English stays with unchanged versions and is removed when source criteria change',()=>{
 const catalog=createCatalog(),r=catalog.rules[0];r.english={title:'Synthetic title',summary:'Synthetic summary',scope:'Synthetic scope'};const next=createDraft(catalog,'rules',r.id,{failCriteria:r.failCriteria+' Synthetic changed criterion'});assert.ok(next.rules.find(x=>x.id===r.id&&x.status==='已发布').english);assert.equal(next.rules.find(x=>x.id===r.id&&x.status==='草稿').english,undefined);
});
