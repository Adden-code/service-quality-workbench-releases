import test from 'node:test';
import assert from 'node:assert/strict';

async function api(){const module=await import('../public/scenario-manager.mjs').catch(()=>null);assert.equal(typeof module?.createScenarioManager,'function','需要独立场景配置管理器');return module;}
const now='2026-11-05T09:00:00+08:00';
const config=(extra={})=>({schemaVersion:1,id:'SCENE-AFTERSALES',name:'售后退换货',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:['AFTER-01'],analysisFields:['intent'],customFields:[],report:{title:'售后质检报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','cases']},requiredCapabilities:['text-judgment'],createdAt:now,updatedAt:now,...extra});
const profile=()=>({id:'P-BASE',name:'已有原表映射',version:3,scene:'新品产品咨询',layout:'turns',sheet:'服务原表',headerRow:2,fields:{id:'会话号',startedAt:'开始时间',role:'角色',text:'内容'},roleMap:{访客:'客户',坐席:'客服'},dateFormat:'beijing',defaults:{completeness:'完整'},extras:[{key:'region',label:'区域',column:'业务区域',type:'text',purpose:'retain',required:false}],ruleIds:['AFTER-01']});
function harness(initial={}){
  let state={schemaVersion:1,tasks:[],sessions:[],activity:[],...initial},dialog=null,commits=0,renders=0,toasts=[];
  const catalog={rules:[{id:'AFTER-01',title:'处理说明',sceneIds:['SCENE-AFTERSALES'],status:'已发布',version:'V1.0'}],policies:[]};
  const ctx={getState:()=>state,getCatalog:()=>catalog,getDialog:()=>dialog,openDialog:d=>{dialog=d;},closeDialog:()=>{dialog=null;},render:()=>{renders++;},renderDialog:()=>{renders++;},toast:message=>toasts.push(message),now:()=>now,commitWorkspace:async updater=>{commits++;const next=await updater({state:structuredClone(state),catalog});state=next.state;return next;}};
  return{ctx,get state(){return state;},get dialog(){return dialog;},get commits(){return commits;},get toasts(){return toasts;},replace(value){state=value;}};
}
const event=(id,value,extra={})=>({target:{id,value,dataset:{},...extra}});
const button=id=>({dataset:{id}});

test('cancelling a new scenario preserves the registry without creating business data',async()=>{
  const {createScenarioManager}=await api(),h=harness(),manager=createScenarioManager(h.ctx);
  await manager.action('scenario-new');manager.input(event('scenario-name','暂未保存的场景'));await manager.action('scenario-cancel');
  assert.equal(h.commits,0);assert.equal(h.state.scenarios,undefined);assert.deepEqual(h.state.tasks,[]);assert.deepEqual(h.state.sessions,[]);
});

test('six-step configuration saves selected analysis fields, custom contracts, report modules and capability declarations',async()=>{
  const {createScenarioManager}=await api(),h=harness(),manager=createScenarioManager(h.ctx);
  await manager.action('scenario-new');manager.input(event('scenario-id','SCENE-AFTERSALES'));manager.input(event('scenario-name','售后退换货'));
  for(let i=1;i<6;i++){await manager.action('scenario-next');assert.equal(h.dialog.step,i+1);}
  manager.input(event('',true,{type:'checkbox',checked:false,dataset:{scenarioAnalysis:'salesStage'}}));
  manager.input(event('',true,{type:'checkbox',checked:false,dataset:{scenarioAnalysis:'demandSummary'}}));
  await manager.action('scenario-custom-add');manager.input(event('', 'resolution',{dataset:{scenarioCustomIndex:'0',scenarioCustomKey:'id'}}));manager.input(event('', '处理方案',{dataset:{scenarioCustomIndex:'0',scenarioCustomKey:'label'}}));manager.change(event('', 'enum',{dataset:{scenarioCustomIndex:'0',scenarioCustomKey:'type'}}));manager.input(event('', '按实际处理方式选择',{dataset:{scenarioCustomIndex:'0',scenarioCustomKey:'instruction'}}));manager.input(event('', '退货\n换货',{dataset:{scenarioCustomIndex:'0',scenarioCustomKey:'options'}}));
  manager.input(event('scenario-report-title','退换货服务报告'));manager.change(event('scenario-report-group-by','agent'));
  for(const section of ['breakdown','dimensions','improvements','voc'])manager.input(event('', '',{type:'checkbox',checked:false,dataset:{scenarioSection:section}}));
  await manager.action('scenario-save');assert.equal(h.commits,1);const saved=h.state.scenarios[0];
  assert.equal(saved.id,'SCENE-AFTERSALES');assert.equal(saved.version,1);assert.deepEqual(saved.analysisFields,['intent','negativeVoice']);
  assert.deepEqual(saved.customFields,[{id:'resolution',label:'处理方案',type:'enum',instruction:'按实际处理方式选择',options:['退货','换货']}]);
  assert.equal(saved.report.title,'退换货服务报告');assert.equal(saved.report.groupBy,'agent');assert.equal(saved.report.groupLabel,'客服');assert.deepEqual(saved.report.sections,['overview','cases']);assert.deepEqual(saved.requiredCapabilities,['text-judgment']);
  assert.deepEqual(h.state.tasks,[]);assert.deepEqual(h.state.sessions,[]);
});

test('editing and disabling advances versions while existing task snapshots remain untouched',async()=>{
  const {createScenarioManager}=await api(),snapshot=config(),h=harness({scenarios:[config()],tasks:[{id:'T',scene:snapshot.id,scenarioSnapshot:snapshot}]}),manager=createScenarioManager(h.ctx);
  await manager.action('scenario-edit',button(snapshot.id));manager.input(event('scenario-name','新名称'));await manager.action('scenario-save');
  assert.equal(h.state.scenarios[0].version,2);assert.equal(h.state.tasks[0].scenarioSnapshot.name,'售后退换货');
  await manager.action('scenario-toggle',{dataset:{id:snapshot.id,version:'2'}});assert.equal(h.state.scenarios[0].enabled,false);assert.equal(h.state.scenarios[0].version,3);assert.equal(h.state.tasks[0].scenarioSnapshot.enabled,true);
});

test('builtin editors are readonly and stale edits retain unsaved input after version conflict',async()=>{
  const {createScenarioManager}=await api(),h=harness({scenarios:[config()]}),manager=createScenarioManager(h.ctx);
  await manager.action('scenario-inspect',button('新品产品咨询'));manager.input(event('scenario-name','不能修改'));await manager.action('scenario-save');assert.equal(h.commits,0);assert.equal(h.dialog.readOnly,true);
  await manager.action('scenario-edit',button('SCENE-AFTERSALES'));manager.input(event('scenario-name','本窗口修改'));
  h.replace({...h.state,scenarios:[config({name:'其他窗口修改',version:2})]});await manager.action('scenario-save');
  assert.match(h.dialog.error,/版本|冲突/);assert.equal(h.dialog.config.name,'本窗口修改');assert.equal(h.state.scenarios[0].name,'其他窗口修改');
});

test('reusing a compatible foreign mapping saves a separate scenario-specific copy atomically',async()=>{
  const {createScenarioManager}=await api(),original=profile(),h=harness({inputProfiles:[original]}),manager=createScenarioManager(h.ctx);
  await manager.action('scenario-new');Object.assign(h.dialog,{config:config()});manager.change(event('scenario-input-profile','P-BASE'));manager.change(event('scenario-report-group-by','context'));manager.input(event('scenario-report-group-field','region'));manager.input(event('scenario-report-group-label','服务区域'));
  await manager.action('scenario-save');assert.equal(h.commits,1);const saved=h.state.scenarios[0],copied=h.state.inputProfiles.find(p=>p.id===saved.inputProfileId);
  assert.notEqual(copied.id,'P-BASE');assert.equal(copied.scene,saved.id);assert.equal(copied.version,1);assert.deepEqual(copied.fields,original.fields);assert.deepEqual(copied.defaults,original.defaults);assert.deepEqual(copied.extras,original.extras);assert.deepEqual(h.state.inputProfiles.find(p=>p.id==='P-BASE'),original);
  assert.equal(saved.report.groupField,'region');assert.equal(saved.report.groupLabel,'服务区域');
});

test('unsupported capabilities cannot enable a scenario but can be retained in an explicitly disabled configuration',async()=>{
  const {createScenarioManager}=await api(),h=harness(),manager=createScenarioManager(h.ctx);await manager.action('scenario-new');h.dialog.config=config({requiredCapabilities:['text-judgment','external-system']});
  await manager.action('scenario-save');assert.match(h.dialog.error,/不支持|尚未支持|缺少/);assert.equal(h.state.scenarios,undefined);
  manager.input(event('scenario-enabled','',{type:'checkbox',checked:false}));await manager.action('scenario-save');assert.equal(h.state.scenarios[0].enabled,false);assert.deepEqual(h.state.scenarios[0].requiredCapabilities,['text-judgment','external-system']);
  await manager.action('scenario-toggle',{dataset:{id:'SCENE-AFTERSALES',version:'1'}});assert.equal(h.state.scenarios[0].enabled,false);
});

test('selecting an active custom scene opens its preferred mapping with the selected template and rule defaults',async()=>{
  const {createImportManager}=await import('../public/import-manager.mjs'),own={...profile(),id:'P-CUSTOM',scene:'SCENE-AFTERSALES',layout:'pair',fields:{id:'会话号',startedAt:'开始时间',customerText:'问题',agentText:'回复'}},h=harness({scenarios:[config({layout:'pair',inputProfileId:own.id})],inputProfiles:[own]});
  h.ctx.openDialog({type:'new-task',mode:'manual',scene:'SCENE-AFTERSALES'});const manager=createImportManager(h.ctx);await manager.action('input-import');
  assert.equal(h.dialog.businessScene,'SCENE-AFTERSALES');assert.equal(h.dialog.profile.layout,'pair');assert.equal(h.dialog.profile.id,'P-CUSTOM');assert.deepEqual(h.dialog.profile.ruleIds,['AFTER-01']);
  h.dialog.preview={valid:true,sessions:[{id:'P1',scene:'SCENE-AFTERSALES',turns:[]}],importMappingSnapshot:{profile:own}};h.dialog.file={name:'真实来源.xlsx'};let handoff;
  const complete=createImportManager({...h.ctx,beginMappedTask:input=>{handoff=input;}});await complete.action('input-begin');assert.equal(handoff.scene,'SCENE-AFTERSALES');assert.deepEqual(handoff.ruleIds,['AFTER-01']);
});

test('an explicitly empty custom rule preference does not silently restore defaults from a reused mapping',async()=>{
  const {createImportManager}=await import('../public/import-manager.mjs'),own={...profile(),id:'P-CUSTOM',scene:'SCENE-AFTERSALES'},h=harness({scenarios:[config({inputProfileId:own.id,ruleIds:[]})],inputProfiles:[own]});
  h.ctx.openDialog({type:'new-task',mode:'manual',scene:'SCENE-AFTERSALES'});const manager=createImportManager(h.ctx);await manager.action('input-import');assert.deepEqual(h.dialog.profile.ruleIds,[]);
});

test('a custom scene rejects selecting a same-scene mapping with the wrong template',async()=>{
  const {createImportManager}=await import('../public/import-manager.mjs'),own={...profile(),id:'P-CUSTOM',scene:'SCENE-AFTERSALES'},wrong={...own,id:'P-WRONG',layout:'pair'},h=harness({scenarios:[config({inputProfileId:own.id})],inputProfiles:[own,wrong]});
  h.ctx.openDialog({type:'new-task',mode:'manual',scene:'SCENE-AFTERSALES'});const manager=createImportManager(h.ctx);await manager.action('input-import');manager.change(event('input-profile-select','P-WRONG'));assert.equal(h.dialog.profile.id,'P-CUSTOM');assert.match(h.dialog.error,/模板|布局/);
});

test('enabling a disabled configuration rechecks capabilities required by its preferred rules',async()=>{
  const {createScenarioManager}=await api(),h=harness({scenarios:[config({enabled:false})]}),manager=createScenarioManager({...h.ctx,getCatalog:()=>({rules:[{id:'AFTER-01',status:'已发布',requiredCapabilities:['external-system']}]})});
  await manager.action('scenario-manage');await manager.action('scenario-toggle',{dataset:{id:'SCENE-AFTERSALES',version:'1'}});assert.equal(h.state.scenarios[0].enabled,false);assert.match(h.dialog.error,/不支持/);
});

test('a lost save acknowledgement preserves the scene editor until exact saved configuration is recovered',async()=>{
  const {createScenarioManager}=await api(),h=harness(),status={hasPending:false,conflicted:false};let disk,calls=0;
  const manager=createScenarioManager({...h.ctx,getWorkspaceStatus:()=>status,commitWorkspace:async updater=>{calls++;disk=await updater({state:h.state,catalog:h.ctx.getCatalog()});status.hasPending=true;throw new Error('保存结果未确认');}});
  await manager.action('scenario-new');h.dialog.config=config();await manager.action('scenario-save');const original=h.dialog;
  assert.match(original.error,/未确认/);manager.input(event('scenario-name','保存未确认期间的新输入'));assert.equal(original.config.name,'售后退换货');await manager.action('scenario-cancel');assert.equal(h.dialog,original);assert.equal(calls,1);
  h.replace(disk.state);status.hasPending=false;assert.equal(manager.reconcile(),'saved');assert.equal(h.dialog.type,'scenario-list');assert.equal(h.state.scenarios.length,1);assert.equal(h.state.scenarios[0].version,1);assert.equal(calls,1);
});

test('same-version different scene content after recovery is a conflict and cannot create another version',async()=>{
  const {createScenarioManager}=await api(),h=harness(),status={hasPending:false,conflicted:false};let disk,calls=0;
  const manager=createScenarioManager({...h.ctx,getWorkspaceStatus:()=>status,commitWorkspace:async updater=>{calls++;disk=await updater({state:h.state,catalog:h.ctx.getCatalog()});status.hasPending=true;throw new Error('保存结果未确认');}});
  await manager.action('scenario-new');h.dialog.config=config();await manager.action('scenario-save');const edited=structuredClone(disk.state);edited.scenarios[0].report.title='其他窗口的报告标题';h.replace(edited);status.hasPending=false;
  assert.equal(manager.reconcile(),'conflict');await manager.action('scenario-save');assert.equal(calls,1);assert.match(h.dialog.error,/冲突|不同/);assert.equal(h.state.scenarios[0].version,1);
});
