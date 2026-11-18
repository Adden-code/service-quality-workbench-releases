import test from 'node:test';
import assert from 'node:assert/strict';
import {tasksView} from '../public/views.mjs';

async function api(){const module=await import('../public/scenario-ui.mjs').catch(()=>null);assert.equal(typeof module?.scenarioDialog,'function','需要可用的场景管理界面');return module;}
const config=(extra={})=>({schemaVersion:1,id:'SCENE-AFTERSALES',name:'售后退换货',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'P-AFTERSALES',ruleIds:['AFTER-01'],analysisFields:['intent','negativeVoice'],customFields:[],report:{title:'售后质检报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','cases']},requiredCapabilities:['text-judgment'],createdAt:'2026-11-05T09:00:00+08:00',updatedAt:'2026-11-05T09:00:00+08:00',...extra});
const state=()=>({tasks:[],sessions:[],activity:[],scenarios:[config(),config({id:'SCENE-DISABLED',name:'停用的场景',enabled:false,inputProfileId:''})],inputProfiles:[{id:'P-AFTERSALES',name:'售后原表',version:1,scene:'SCENE-AFTERSALES',layout:'turns',extras:[{key:'region',label:'服务区域',column:'业务区域'}]}]});
const catalog={rules:[{id:'AFTER-01',title:'处理说明',status:'已发布',version:'V1.0'}],policies:[]};

test('task list exposes scenario management as a secondary action beside task creation',()=>{
  const html=tasksView(state(),{dataMode:'manual',taskStatus:'全部',taskQuery:''});
  assert.match(html,/class="btn primary"[^>]*data-act="new-task"/);
  assert.match(html,/class="btn"[^>]*data-act="scenario-manage"[^>]*>[^<]*场景管理/);
});

test('scenario management lists readonly builtins and editable current custom versions including disabled entries',async()=>{
  const {scenarioDialog}=await api(),html=scenarioDialog({type:'scenario-list'},state(),catalog);
  assert.match(html,/新品产品咨询/);assert.match(html,/电商评论回复/);assert.match(html,/内置.*只读/);
  assert.match(html,/售后退换货/);assert.match(html,/SCENE-AFTERSALES/);assert.match(html,/停用的场景/);
  assert.match(html,/data-act="scfg-new-subject"/);assert.match(html,/data-act="scenario-edit"[^>]*data-id="SCENE-AFTERSALES"/);
  assert.doesNotMatch(html,/data-act="scenario-toggle"[^>]*data-id="新品产品咨询"/);
});

test('six-step editor uses explicit labels and exposes supported templates, analysis contracts and custom field types',async()=>{
  const {scenarioDialog}=await api(),d={type:'scenario-edit',step:1,config:config(),selectedProfileId:'P-AFTERSALES'};
  const one=scenarioDialog(d,state(),catalog);for(const text of ['场景与模板','字段映射','规则偏好','分析字段','报告配置','能力与确认','多轮会话','单行问答'])assert.match(one,new RegExp(text));
  assert.match(one,/aria-current="step"/);assert.match(one,/for="scenario-name"/);
  d.step=4;d.config.customFields=[{id:'resolution',label:'处理方案',type:'enum',instruction:'概括处理方案',options:['退货','换货']}];
  const four=scenarioDialog(d,state(),catalog);for(const text of ['销售阶段','客户意图','客户诉求总结','负面声音','文本','枚举','原声提取','退货','换货'])assert.match(four,new RegExp(text));
  assert.match(four,/data-scenario-analysis="negativeVoice"[^>]*checked/);assert.match(four,/data-scenario-custom-key="options"/);
});

test('context grouping uses an explicit extras key and required group label while overview stays selected',async()=>{
  const {scenarioDialog}=await api(),html=scenarioDialog({type:'scenario-edit',step:5,selectedProfileId:'P-AFTERSALES',config:config({report:{title:'服务报告',groupBy:'context',groupField:'region',groupLabel:'区域',sections:['overview','voc']}})},state(),catalog);
  assert.match(html,/服务区域.*region/);assert.match(html,/id="scenario-report-group-field"/);assert.match(html,/for="scenario-report-group-label"/);
  assert.match(html,/data-scenario-section="overview"[^>]*checked[^>]*disabled/);
  for(const section of ['overview','breakdown','dimensions','cases','improvements','voc'])assert.match(html,new RegExp(`data-scenario-section="${section}"`));
});

test('unsupported capabilities are visible with an explicit save-disabled option and builtin configuration is readonly',async()=>{
  const {scenarioDialog}=await api(),d={type:'scenario-edit',step:6,config:config({enabled:false,requiredCapabilities:['text-judgment','business-calendar']})};
  const html=scenarioDialog(d,state(),catalog);assert.match(html,/业务日历/);assert.match(html,/不支持|尚未支持|缺少/);assert.match(html,/id="scenario-enabled"/);assert.match(html,/停用/);
  const readonly=scenarioDialog({...d,readOnly:true},state(),catalog);assert.doesNotMatch(readonly,/data-act="scenario-save"/);assert.match(readonly,/只读/);assert.match(readonly,/fieldset[^>]*disabled/);
});

test('configuration text is escaped and never rendered as executable markup',async()=>{
  const {scenarioDialog}=await api(),html=scenarioDialog({type:'scenario-edit',step:1,config:config({name:'<img src=x onerror=bad>'})},state(),catalog);
  assert.match(html,/&lt;img src=x onerror=bad&gt;/);assert.doesNotMatch(html,/<img src=x/);
});

test('scene picker and task detail display registered names and preserve frozen names after rename',async()=>{
  const {taskSceneDialog,taskDetailView,assertConsultationInput}=await import('../public/task-workbench.mjs');
  const registry=state(),picker=taskSceneDialog(registry).body;assert.match(picker,/售后退换货/);assert.doesNotMatch(picker,/停用的场景/);
  assert.match(picker,/data-scene="SCENE-AFTERSALES"/);
  const task={id:'T-OLD',name:'历史任务',scene:'SCENE-AFTERSALES',scenarioSnapshot:config({name:'创建时的售后场景'}),createdAt:'2026-11-05T09:00:00+08:00',basisSnapshot:{rules:[],policies:[]}};
  const row={id:'S1',taskId:task.id,scene:task.scene,turns:[],review:{status:'待审核',drafts:{}},aiResults:[]};
  assert.match(taskDetailView({...registry,tasks:[task],sessions:[row]},{taskDetailId:task.id}),/创建时的售后场景/);
  assert.equal(assertConsultationInput({sessions:[row]},registry,task.scene).sessions[0],row);
  assert.throws(()=>assertConsultationInput({sessions:[{...row,scene:'电商评论回复'}]},registry,task.scene),/Sheet4/);
  assert.throws(()=>assertConsultationInput({sessions:[{...row,scene:'SCENE-UNKNOWN'}]},registry,'SCENE-UNKNOWN'),/场景/);
});

test('rule import includes enabled registered scene names and the task wizard uses its frozen scene label',async()=>{
  const {importDialog}=await import('../public/import-ui.mjs'),registry=state(),rules=importDialog({type:'rule-import',scene:'SCENE-AFTERSALES',mode:'text',sourceText:'',sourceName:'',candidates:[]},registry,catalog);
  assert.match(rules,/value="SCENE-AFTERSALES"[^>]*selected[^>]*>售后退换货/);assert.doesNotMatch(rules,/停用的场景/);
  const {businessTaskDialog}=await import('../public/business-dialogs.mjs'),dialog=businessTaskDialog({type:'new-task',scene:'SCENE-AFTERSALES',mode:'manual',step:2,file:{name:'原表.xlsx'},fileName:'原表.xlsx',scenarioSnapshot:config({name:'创建时的售后场景'}),parsed:{valid:true,sessions:[{scene:'SCENE-AFTERSALES',turns:[]}],turnCount:0}},registry).body;
  assert.match(dialog,/<header class="modal-head">[\s\S]*?<h2 id="dialog-title">新建质检任务 · 创建时的售后场景<\/h2>/);assert.doesNotMatch(dialog,/<h2[^>]*>新建质检任务 · 售后退换货/);
  assert.match(dialog,/id="new-task-name"[^>]*value=""[^>]*placeholder="请填写：批次名-日期"/);assert.match(dialog,/import-precheck success/);assert.doesNotMatch(dialog,/data-act="import-ai-convert"/);
});
