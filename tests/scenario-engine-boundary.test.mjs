import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {freezeScenario,saveScenarioConfig} from '../public/scenarios.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';

const now='2026-11-05T09:00:00+08:00';
function fixture(scene='新品产品咨询'){
 const catalog=createCatalog(),state=createBusinessState();
 const session={id:'ORIGINAL-1',scene,startedAt:now,topic:'合成问答',channel:'',product:'测试产品',agent:'客服',customer:'客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'请介绍办理方法。'},{id:2,role:'客服',text:'请先提交申请。'}]};
 const input={name:'引擎边界验证',reviewer:'隔离审核',source:{name:'普通会话.json',sha256:'e'.repeat(64),size:100},sessions:[session],basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-05',ruleIds:['R004'],now}),now};
 return{catalog,state,session,input};
}
test('new ecommerce scene cannot bypass Sheet4 by supplying ordinary JSON and generic rules',()=>{
 const f=fixture('电商评论回复');assert.throws(()=>createImportedTask(f.state,f.input),/Sheet4|电商来源|专用/);
});
test('server new-task authentication rejects forged ecommerce scene without Sheet4 provenance',()=>{
 const f=fixture(),state=createImportedTask(f.state,f.input);state.tasks[0].scene='电商评论回复';state.tasks[0].scenarioSnapshot=structuredClone(freezeScenario(f.state,'电商评论回复'));state.sessions[0].scene='电商评论回复';
 assert.throws(()=>validateWorkspace(state,f.catalog,f.state,{authenticateNewSnapshots:true}),/Sheet4|电商来源|专用/);
});
test('custom pair scenes continue to use generic text rules and independent conversation execution',()=>{
 const f=fixture('SCENE-GENERIC-PAIR');f.catalog.rules.find(rule=>rule.id==='R004').sceneIds=[f.session.scene];for(const policy of f.catalog.policies)policy.sceneIds=[f.session.scene];
 const config={schemaVersion:1,id:f.session.scene,name:'普通单行问答',version:1,enabled:true,engine:'conversation',layout:'pair',inputProfileId:'',ruleIds:['R004'],analysisFields:[],customFields:[],report:{title:'单行问答报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']},requiredCapabilities:['text-judgment'],createdAt:now,updatedAt:now};
 const registered=saveScenarioConfig(f.state,config,{expectedVersion:0,now}),created=createImportedTask(registered,f.input);
 assert.equal(created.tasks[0].scenarioSnapshot.engine,'conversation');assert.equal(validateWorkspace(created,f.catalog,registered,{authenticateNewSnapshots:true}),true);
});
test('new builtin manual task must carry its full scenario snapshot; legacy saved task remains readable',()=>{
 const f=fixture(),created=createImportedTask(f.state,f.input);delete created.tasks[0].scenarioSnapshot;
 assert.throws(()=>validateWorkspace(created,f.catalog,f.state,{authenticateNewSnapshots:true}),/场景|快照/);
 assert.equal(validateWorkspace(created,f.catalog),true,'Legacy on-disk tasks are read without new-task authentication.');
 assert.equal(validateWorkspace(structuredClone(created),f.catalog,created,{authenticateNewSnapshots:true}),true,'Existing saved task remains compatible.');
});
test('new manual task cannot remove both task and session scene keys to evade registration',()=>{
 const f=fixture(),created=createImportedTask(f.state,f.input);delete created.tasks[0].scenarioSnapshot;delete created.tasks[0].scene;delete created.sessions[0].scene;
 assert.throws(()=>validateWorkspace(created,f.catalog,f.state,{authenticateNewSnapshots:true}),/场景|快照/);
});
