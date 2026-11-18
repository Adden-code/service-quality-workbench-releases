import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {validateInputProfile,parseMappedInput} from '../public/input-profiles.mjs';
import {parseBusinessInput} from '../public/business-input.mjs';
import {validateRuleProvenance} from '../public/context-fields.mjs';
import {prepareRulePrompt} from '../server/rule-preparation.mjs';
import {workbook} from '../public/io.mjs';
const api=await import('../public/scenarios.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const now='2026-11-05T10:00:00+08:00',later='2026-11-05T11:00:00+08:00',scene='SCENE-AFTERSALES';
const config=(patch={})=>({schemaVersion:1,id:scene,name:'售后咨询',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:['R004'],analysisFields:['intent'],customFields:[],report:{title:'售后报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']},requiredCapabilities:['text-judgment'],createdAt:now,updatedAt:now,...patch});
const raw=()=>({id:'S1',scene,startedAt:now,topic:'退货',product:'耳机',agent:'客服甲',customer:'客户甲',channel:'售后',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'客户甲',at:'',text:'如何申请退货？'},{id:2,role:'客服',speaker:'客服甲',at:'',text:'请提供订单号。'}]});
function input(){const catalog=createCatalog();return {name:'售后批次',sessions:[raw()],reviewer:'审核人',source:{name:'after-sales.json',size:100,sha256:'a'.repeat(64)},basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-05',ruleIds:['R004'],now}),now};}
const file=(name,bytes)=>({name,size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
function fixture(){const catalog=createCatalog();catalog.rules.find(rule=>rule.id==='R004').sceneIds=[scene];for(const policy of catalog.policies)policy.sceneIds=[scene];const before={...createBusinessState(),scenarios:[config()]},state=createImportedTask(before,input());return {catalog,before,state,task:state.tasks[0]};}
test('custom raw JSON parsing accepts scene syntax without inventing registry authorization',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({format:'SERVICE_QUALITY_INPUT_V1',sessions:[raw()]}));const parsed=await parseBusinessInput(file('after-sales.json',bytes));assert.equal(parsed.valid,true,parsed.errors.join('\n'));assert.equal(parsed.sessions[0].scene,scene);
});
test('custom task creation freezes full active configuration and rejects unknown or disabled scenes',()=>{
 const {state,before,task}=fixture();assert.deepEqual(task.scenarioSnapshot,config());assert.equal(task.scene,scene);assert.ok(state.sessions.every(s=>s.scene===scene));
 state.scenarios[0].name='new';assert.equal(task.scenarioSnapshot.name,'售后咨询');assert.equal(before.tasks.length,0);
 assert.throws(()=>createImportedTask(createBusinessState(),input()),/注册|场景/);
 assert.throws(()=>createImportedTask({...before,scenarios:[config({enabled:false})]},input()),/启用|停用/);
 assert.throws(()=>createImportedTask(before,{...input(),scenarioSnapshot:config({name:'伪造快照'})}),/快照|一致/);
});
test('an equivalent caller snapshot is authenticated independently of JSON property order',()=>{
 const before={...createBusinessState(),scenarios:[config()]},snapshot=Object.fromEntries(Object.entries(config()).reverse());snapshot.report=Object.fromEntries(Object.entries(snapshot.report).reverse());
 assert.doesNotThrow(()=>createImportedTask(before,{...input(),scenarioSnapshot:snapshot}));
});
test('server authenticates new scenario snapshots and exact task-session scene association',()=>{
 const {state,before,catalog}=fixture();assert.equal(validateWorkspace(state,catalog,before,{authenticateNewSnapshots:true}),true);
 for(const change of [s=>{s.tasks[0].scenarioSnapshot.name='伪造名称';},s=>{delete s.tasks[0].scenarioSnapshot;},s=>{s.tasks[0].scene='SCENE-UNKNOWN';},s=>{s.sessions[0].scene='新品产品咨询';},s=>{s.scenarios[0].enabled=false;}]){const forged=structuredClone(state);change(forged);assert.throws(()=>validateWorkspace(forged,catalog,before,{authenticateNewSnapshots:true}),/场景|快照|启用|停用|版本/);}
});
test('registry transitions cannot skip versions, delete definitions, or change during a trusted AI update',()=>{
 const {state,catalog}=fixture();const changed=structuredClone(state);changed.scenarios[0]={...config({name:'售后新版',version:2,updatedAt:later}),enabled:false};assert.equal(validateWorkspace(changed,catalog,state,{authenticateNewSnapshots:true}),true);
 assert.equal(changed.tasks[0].scenarioSnapshot.name,'售后咨询');
 for(const mutation of [s=>{s.scenarios[0].name='无版本修改';},s=>{s.scenarios[0].version=3;},s=>{s.scenarios=[];},s=>{s.tasks[0].scenarioSnapshot.version=2;}]){const bad=structuredClone(state);mutation(bad);assert.throws(()=>validateWorkspace(bad,catalog,state,{authenticateNewSnapshots:true}),/版本|删除|快照|场景/);}
 assert.throws(()=>validateWorkspace(changed,catalog,state,{trustedAI:true}),/AI更新|场景/);
});
test('custom profile layouts map turns and pair data through the generic engine with source extras',async()=>{
 for(const layout of ['turns','pair']){
  const profile={id:'IP-AFTER',name:'售后原表',version:1,scene,layout,sheet:'记录',headerRow:1,fields:{id:'编号',startedAt:'时间',...(layout==='turns'?{role:'角色',text:'原文'}:{customerText:'原文',agentText:'回复'})},roleMap:{},dateFormat:'iso',defaults:{completeness:'完整'},extras:[{key:'region',label:'区域',column:'区域',type:'text',purpose:'retain',required:false}],ruleIds:['R004']};
  assert.equal(validateInputProfile(profile).scene,scene);
  const headers=['编号','时间','角色','原文','回复','区域'],rows=layout==='turns'?[['S1',now,'客户','如何退货？','','华南'],['S1',now,'客服','提供订单号','','华南']]:[['S1',now,'','如何退货？','提供订单号','华南']];
  const bytes=await workbook([{name:'记录',headers,rows}]),parsed=await parseMappedInput(file('after-sales.xlsx',bytes),profile);assert.equal(parsed.valid,true,parsed.errors.join('\n'));assert.equal(parsed.sessions[0].turns.length,2);assert.equal(parsed.sessions[0].ecommerce,undefined);
  const state=createImportedTask({...createBusinessState(),scenarios:[config({layout,inputProfileId:profile.id,report:{title:'区域报告',groupBy:'context',groupField:'region',groupLabel:'区域',sections:['overview']}})],inputProfiles:[profile]},{...input(),sessions:parsed.sessions,importMappingSnapshot:parsed.importMappingSnapshot});assert.equal(state.tasks[0].scenarioSnapshot.layout,layout);
 }
});
test('profile references and explicit context group keys are checked without guessing columns',()=>{
 const {before,catalog}=fixture(),profile={id:'IP-AFTER',name:'原表',version:1,scene,layout:'turns',sheet:'记录',headerRow:1,fields:{id:'编号',startedAt:'时间',role:'角色',text:'原文'},roleMap:{},dateFormat:'iso',defaults:{completeness:'完整'},extras:[],ruleIds:[]};
 assert.throws(()=>validateWorkspace({...before,scenarios:[config({inputProfileId:'MISSING'})]},catalog),/映射|配置|不存在/);
 assert.throws(()=>validateWorkspace({...before,scenarios:[config({inputProfileId:profile.id})],inputProfiles:[{...profile,scene:'新品产品咨询'}]},catalog),/场景|映射/);
 assert.throws(()=>createImportedTask({...before,scenarios:[config({report:{title:'区域',groupBy:'context',groupField:'region',groupLabel:'区域',sections:['overview']}})]},{...input(),importMappingSnapshot:{profile}}),/分组|region|扩展/);
});
test('custom rule preparation and provenance retain legal scene ids',()=>{
 const prepared=prepareRulePrompt({text:'提供退货流程。',sourceName:'售后规范',scene});assert.equal(prepared.input.scene,scene);
 assert.doesNotThrow(()=>validateRuleProvenance({source:{name:'售后.txt',sha256:'a'.repeat(64),size:1},quote:'提供退货流程。',locator:'字符0-8',scene,preparedBy:{modelId:'test',promptVersion:'test',at:now}}));
});
