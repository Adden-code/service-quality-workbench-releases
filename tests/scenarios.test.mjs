import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../public/scenarios.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const now='2026-11-05T10:00:00+08:00',later='2026-11-05T11:00:00+08:00';
const config=(patch={})=>({schemaVersion:1,id:'SCENE-AFTERSALES',name:'售后咨询',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:['R004'],analysisFields:['intent','negativeVoice'],customFields:[{id:'resolution',label:'处理方案',type:'text',instruction:'概括已提供的处理方案。',options:[]}],report:{title:'售后报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','breakdown','voc']},requiredCapabilities:['text-judgment'],createdAt:now,updatedAt:now,...patch});
const empty=()=>({schemaVersion:1,tasks:[],sessions:[],activity:[]});
test('scenario module exposes the frozen configuration contract',()=>{for(const name of ['isSceneKey','validateScenarioConfig','listScenarios','findScenario','scenarioForTask','sceneLabel','saveScenarioConfig','freezeScenario','checkScenarioCapabilities'])assert.equal(typeof api[name],'function',name);});
test('scene syntax preserves legacy identifiers while accepting only safe custom IDs',()=>{
 assert.ok(api.isSceneKey('新品产品咨询'));assert.ok(api.isSceneKey('电商评论回复'));assert.ok(api.isSceneKey('SCENE-AFTERSALES'));
 assert.ok(api.isSceneKey('SCENE-'+ 'a'.repeat(58)));assert.equal(api.isSceneKey('SCENE-'+ 'a'.repeat(59)),false);
 for(const bad of ['',null,'售后咨询','SCENE-','SCENE-a b','SCENE-../x','SCENE-__proto__','SCENE-'+ 'a'.repeat(65)])assert.equal(api.isSceneKey(bad),false,String(bad));
});
test('builtin product-consultation report keeps its existing title contract',()=>{assert.equal(api.findScenario(empty(),'新品产品咨询').report.title,'新品质检报告');});
test('schema rejects array subclasses and inherited array behavior',()=>{
 class HiddenFields extends Array {}
 assert.throws(()=>api.validateScenarioConfig(config({analysisFields:HiddenFields.of('intent')})),/字段|数组|结构/);
 const options=[];Object.defineProperty(options,'0',{get:()=> '不应执行访问器',enumerable:true});options.length=2;
 assert.throws(()=>api.validateScenarioConfig(config({customFields:[{...config().customFields[0],type:'enum',options}]})),/字段|数组|结构|选项/);
});
test('configuration validation returns detached data and rejects unknown keys, duplicate fields and fake dates',()=>{
 const raw=config(),value=api.validateScenarioConfig(raw);value.customFields[0].label='changed';assert.equal(raw.customFields[0].label,'处理方案');
 for(const bad of [config({extra:true}),config({engine:'ecommerce'}),config({layout:'flow'}),config({analysisFields:['intent','intent']}),config({analysisFields:['invented']}),config({customFields:[...raw.customFields,...raw.customFields]}),config({createdAt:'2026-02-30T10:00:00+08:00'}),config({report:{...raw.report,sections:['voc']}}),config({requiredCapabilities:[]})])assert.throws(()=>api.validateScenarioConfig(bad),/场景|字段|日期|时间|报告|能力|模块|重复/);
 assert.throws(()=>api.validateScenarioConfig(Object.assign(Object.create({hidden:true}),raw)),/结构|场景/);
 assert.throws(()=>api.validateScenarioConfig(JSON.parse(JSON.stringify(raw).replace('"resolution"','"__proto__"'))),/字段|保留/);
 assert.throws(()=>api.validateScenarioConfig({...raw,customFields:[{...raw.customFields[0],unexpected:1}]}),/字段|结构/);
});
test('enum and quote field contracts prevent ambiguous schema or fabricated options',()=>{
 const field=config().customFields[0];
 assert.doesNotThrow(()=>api.validateScenarioConfig(config({customFields:[{...field,type:'enum',options:['已解决','未解决']}]})));
 for(const f of [{...field,type:'enum',options:['只有一个']},{...field,type:'enum',options:['重复','重复']},{...field,type:'quote',options:['虚构']},{...field,type:'other'},{...field,id:'intent'}])assert.throws(()=>api.validateScenarioConfig(config({customFields:[f]})),/字段|选项|类型|标识/);
});
test('custom instructions retain line breaks and tabs while blocking hidden controls',()=>{
 const field=config().customFields[0],instruction='第一步：核对原文。\n\t第二步：缺失明确标记。';
 assert.equal(api.validateScenarioConfig(config({customFields:[{...field,instruction}]})).customFields[0].instruction,instruction);
 assert.throws(()=>api.validateScenarioConfig(config({customFields:[{...field,instruction:'隐藏\u0000指令'}]})),/字段|文本/);
});
test('saving creates v1, requires exact edit version, increments and preserves original state',()=>{
 const state=empty(),raw=config();delete raw.createdAt;delete raw.updatedAt;
 const first=api.saveScenarioConfig(state,raw,{expectedVersion:0,now});assert.equal(state.scenarios,undefined);assert.equal(first.scenarios[0].version,1);assert.equal(first.scenarios[0].createdAt,now);
 const second=api.saveScenarioConfig(first,{...first.scenarios[0],name:'售后退货'},{expectedVersion:1,now:later});assert.equal(second.scenarios[0].version,2);assert.equal(second.scenarios[0].createdAt,now);assert.equal(second.scenarios[0].updatedAt,later);assert.equal(first.scenarios[0].name,'售后咨询');
 assert.throws(()=>api.saveScenarioConfig(second,first.scenarios[0],{expectedVersion:1,now:later}),/版本|冲突/);
 assert.throws(()=>api.saveScenarioConfig(first,{...first.scenarios[0],id:'SCENE-RENAMED'},{expectedVersion:1,now:later}),/版本|标识|冲突/);
 assert.throws(()=>api.saveScenarioConfig(first,config({id:'SCENE-OTHER'}),{expectedVersion:0,now:later}),/名称|重复/);
 assert.throws(()=>api.saveScenarioConfig(empty(),config({id:'新品产品咨询'}),{expectedVersion:0,now}),/内置|标识|场景/);
});
test('editing cannot move the current configuration timestamp backwards',()=>{
 const first=api.saveScenarioConfig(empty(),config(),{expectedVersion:0,now});
 const second=api.saveScenarioConfig(first,{...first.scenarios[0],name:'售后新版'},{expectedVersion:1,now:later});
 assert.throws(()=>api.saveScenarioConfig(second,{...second.scenarios[0],name:'时间回退'},{expectedVersion:2,now:'2026-11-05T10:30:00+08:00'}),/时间|日期|回退/);
});
test('builtins remain detached and immutable while disabled definitions stay available to history',()=>{
 let state=api.saveScenarioConfig(empty(),config(),{expectedVersion:0,now});const frozen=api.freezeScenario(state,'SCENE-AFTERSALES');
 assert.equal(api.listScenarios(state).length,3);assert.equal(api.findScenario(state,'新品产品咨询').builtin,true);
 state=api.saveScenarioConfig(state,{...state.scenarios[0],name:'后来名称',enabled:false},{expectedVersion:1,now:later});
 assert.equal(api.listScenarios(state).length,2);assert.equal(api.listScenarios(state,{includeDisabled:true}).length,3);assert.equal(api.findScenario(state,frozen.id,{includeDisabled:false}),null);
 const task={id:'T1',scene:frozen.id,scenarioSnapshot:frozen};assert.equal(api.scenarioForTask(task).name,'售后咨询');
 const view={...state,tasks:[task]};assert.equal(api.sceneLabel(view,{taskId:'T1',scene:frozen.id}),'售后咨询');assert.equal(api.sceneLabel(view,frozen.id),'后来名称');
 assert.equal(api.scenarioForTask({scene:'新品产品咨询'}).engine,'conversation');assert.equal(api.scenarioForTask({scene:frozen.id}),null);
 assert.throws(()=>api.freezeScenario(state,frozen.id),/停用|启用/);assert.throws(()=>api.freezeScenario(state,'SCENE-UNKNOWN'),/场景|注册/);
 const builtin=api.listScenarios(state)[0];builtin.name='坏名称';assert.equal(api.findScenario(state,'新品产品咨询').name,'新品产品咨询');
});
test('unsupported capabilities save only as disabled and EC rules cannot enter a generic engine',()=>{
 const unsupported=config({requiredCapabilities:['text-judgment','external-system']});
 assert.ok(api.checkScenarioCapabilities(unsupported).some(message=>message.includes('external-system')));
 assert.throws(()=>api.saveScenarioConfig(empty(),unsupported,{expectedVersion:0,now}),/能力|external-system/);
 assert.doesNotThrow(()=>api.saveScenarioConfig(empty(),{...unsupported,enabled:false},{expectedVersion:0,now}));
 for(const id of ['EC-TIME','EC-TARGET','EC-TEXT'])assert.ok(api.checkScenarioCapabilities(config(),[{id}]).some(message=>/电商|EC-/.test(message)));
 assert.throws(()=>api.saveScenarioConfig(empty(),config({ruleIds:['EC-TIME']}),{expectedVersion:0,now}),/电商|EC-/);
});
