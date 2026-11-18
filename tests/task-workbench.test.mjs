import test from 'node:test';
import assert from 'node:assert/strict';
import {tasksView} from '../public/views.mjs';
import {dialogView} from '../public/dialogs.mjs';
import {createEcommerceManager} from '../public/ecommerce-manager.mjs';
import {createEcommerceSample} from '../public/ecommerce-sample.mjs';
import {readXlsx} from '../public/io.mjs';
import {workflowView} from '../public/workflow-view.mjs';
import * as workbench from '../public/task-workbench.mjs';
import {createImportManager} from '../public/import-manager.mjs';
import {createImportedTask,createBusinessState} from '../public/domain.mjs';
import {createRuleSetSeed} from '../public/ecommerce-rule-sets.mjs';
import {catalogPage} from '../public/catalog-view.mjs';

const task={id:'business-1',name:'实际业务批次',mode:'manual',status:'待审核',aiStatus:'running',sessionIds:['s1','s2','s3'],basisSnapshot:{effectiveDate:'2026-11-03',rules:[],policies:[]},aiQueue:{status:'paused',phase:'rows',batches:[{id:'b1',index:1,sessionIds:['s1','s2','s3']}],rows:[{sessionId:'s1',sourceRow:3,batchId:'b1',status:'completed',attempts:1,durationMs:1500},{sessionId:'s2',sourceRow:4,batchId:'b1',status:'failed',attempts:2,errorCode:'MODEL_TIMEOUT',error:'请求超时'},{sessionId:'s3',sourceRow:5,batchId:'b1',status:'pending',attempts:0}]}};
const sessions=['s1','s2','s3'].map((id,index)=>({id,taskId:task.id,turns:[],aiResults:[],review:{status:index===0?'已确认':'待审核',drafts:{}}}));
const state={tasks:[task],sessions,activity:[]};
const ui={dataMode:'manual',taskStatus:'全部',taskQuery:''};
function confirmPreview(manager,dialog){
  assert.equal(dialog.parsed?.valid,true);assert.match(manager.dialog(dialog),/id="import-preview-confirm"/);
  assert.equal(manager.change({target:{id:'import-preview-confirm',checked:true}}),true);assert.equal(dialog.previewConfirmed,true);
}

test('task list has one primary creation entry, secondary mapping and separate execution counts',()=>{
  const html=tasksView(state,ui);
  assert.equal((html.match(/data-act="new-task"/g)||[]).length,1);
  assert.match(html,/新建质检任务/);
  assert.doesNotMatch(html,/data-act="ec-open"|data-act="input-import"|data-act="download-business-template"/);
  assert.match(html,/字段映射方案/);assert.match(html,/AI完成/);assert.match(html,/失败/);assert.match(html,/未处理/);assert.match(html,/人工已确认/);
  assert.match(html,/data-act="task-detail" data-id="business-1"/);
});

test('creation begins by selecting a supported scene before any upload',()=>{
  const html=dialogView({type:'task-scene'},state,ui);
  assert.match(html,/选择质检场景/);assert.match(html,/电商评论回复/);assert.match(html,/产品咨询/);
  assert.doesNotMatch(html,/type="file"|虚构|一键体验/);
});

test('detail aggregates paused queue, physical rows, attempts, review and task-scoped reports',async()=>{
  const module=await import('../public/task-workbench.mjs').catch(()=>null);
  assert.ok(module,'task detail renderer is required');
  const html=module.taskDetailView(state,{...ui,taskDetailId:task.id});
  assert.match(html,/材料与依据/);assert.match(html,/AI执行/);assert.match(html,/人工审核/);assert.match(html,/双报告/);
  assert.match(html,/data-act="resume-ai"/);assert.doesNotMatch(html,/data-act="pause-ai"/);
  assert.match(html,/第1段 · 尝试 2/);assert.doesNotMatch(html,/第2段 · 尝试/);
  assert.match(html,/第4行/);assert.match(html,/尝试 2/);assert.match(html,/请求超时/);assert.match(html,/未完成/);
  assert.match(html,/task-detail-export/);assert.match(html,/task-detail-report/);
});

test('AI status filtering reads queue state rather than human review status',()=>{
  const html=tasksView(state,{...ui,taskStatus:'AI已暂停'});
  assert.match(html,/实际业务批次/);
  assert.doesNotMatch(tasksView(state,{...ui,taskStatus:'AI已完成'}),/实际业务批次/);
});

test('ecommerce requires explicit rule confirmation and version selection before creation',async()=>{
  let dialog,confirmed=0,created=0;
  const ctx={getDialog:()=>dialog,openDialog:d=>{dialog=d},renderDialog(){},toast(){},getRuleVersions:()=>confirmed?[{version:'V1.0',title:'Sheet4口径',ruleIds:[]}]:[],confirmRules:async()=>{confirmed++},createTask:async()=>{created++},getWorkspaceStatus:()=>({})};
  const manager=createEcommerceManager(ctx);await manager.action('ec-open');
  assert.doesNotMatch(manager.dialog(dialog),/一键体验|虚构Excel/);
  assert.equal(await manager.action('ec-use-sample'),false);
  manager.input({target:{id:'ec-name',value:'真实任务'}});manager.input({target:{id:'ec-reviewer',value:'审核员'}});
  manager.change({target:{id:'ec-file',files:[new File([await createEcommerceSample()],'原表.xlsx')]}});
  for(let i=0;i<100&&dialog.loading;i++)await new Promise(r=>setTimeout(r,2));
  await manager.action('ec-next');assert.equal(dialog.step,1);assert.match(dialog.error,/确认.*预览|预览.*确认/);assert.equal(created,0);
  confirmPreview(manager,dialog);await manager.action('ec-next');assert.equal(dialog.step,2);
  await manager.action('ec-confirm');assert.equal(confirmed,0);
  manager.change({target:{id:'ec-confirm-rules',checked:true}});await manager.action('ec-confirm');assert.equal(confirmed,1);
  await manager.action('ec-create');assert.equal(created,0,'registering a rule must not silently select its version');
  manager.change({target:{id:'ec-basis-version',value:'V1.0'}});await manager.action('ec-create');assert.equal(created,1);
});

test('ecommerce template has headers plus rule row and no customer records',async()=>{
  const module=await import('../public/ecommerce-template.mjs').catch(()=>null);assert.ok(module,'empty Sheet4 template is required');
  const bytes=await module.createEcommerceTemplate();
  const sheets=await readXlsx(bytes);
  assert.deepEqual(Object.keys(sheets),['Sheet4']);assert.equal(sheets.Sheet4.length,2);assert.equal(sheets.Sheet4[0].length,22);
  assert.match(sheets.Sheet4[1][15],/24/);
});

test('workflow keeps raw JSON collapsed while showing actual row node errors',()=>{
  const run={id:'run-1',status:'partial',nodes:[{id:'row-4-attempt-2',label:'第1段 · 原表第4行 · 尝试2',status:'failed',durationMs:1200,error:'单条请求超时',input:{comment:'业务原文'},output:{errorCode:'TIMEOUT'}}]};
  const html=workflowView({active:true,taskId:task.id,runs:[run],run,runId:run.id});
  assert.match(html,/第1段 · 原表第4行 · 尝试2/);assert.match(html,/单条请求超时/);
  assert.match(html,/<details[^>]*class="workflow-snapshot"/);assert.doesNotMatch(html,/<details[^>]*class="workflow-snapshot"[^>]*open/);
});

test('task detail never offers another AI write for a task protected by human drafts',async()=>{
  const {taskDetailView}=await import('../public/task-workbench.mjs');
  const row={id:'draft-row',taskId:'draft-task',turns:[],aiResults:[],review:{status:'待审核',drafts:{r1:{verdict:'符合'}}}};
  const ownTask={id:'draft-task',name:'人工已处理',mode:'manual',aiStatus:'partial',basisSnapshot:{rules:[],policies:[]}};
  const html=taskDetailView({tasks:[ownTask],sessions:[row]},{taskDetailId:ownTask.id});
  assert.match(html,/data-act="run-ai"[^>]*disabled/);
});

test('product consultation cannot select ecommerce-specific rules from the shared catalog',()=>{
  const catalog={rules:[{id:'EC-TIME',title:'电商时效',status:'已发布',version:'V1.0',effectiveAt:'2020-01-01'},{id:'PRODUCT-QA',sceneIds:['新品产品咨询'],title:'核对产品回答',status:'已发布',version:'V1.0',effectiveAt:'2020-01-01'}],policies:[]};
  const html=dialogView({type:'new-task',mode:'manual',step:3,effectiveDate:'2026-11-03',catalog,ruleIds:[],parsed:{sessions:[]}},state,ui);
  assert.match(html,/value="PRODUCT-QA"/);assert.doesNotMatch(html,/value="EC-TIME"/);
});

test('each detail report event resets both report scopes before navigation',()=>{
  assert.equal(typeof workbench.handleTaskReportAction,'function');
  const current={exportTaskId:'old-export',reportTaskId:'old-report',reportPeriod:'month',includePending:false},navigations=[];
  const options={ui:current,navigate:page=>navigations.push({page,...current})};
  assert.equal(workbench.handleTaskReportAction('task-detail-export','task-A',options),true);
  assert.deepEqual(navigations[0],{page:'exports',exportTaskId:'task-A',reportTaskId:'task-A',businessTaskId:'task-A',reportPeriod:'batch',includePending:true});
  current.reportPeriod='month';current.exportTaskId='task-Z';
  assert.equal(workbench.handleTaskReportAction('task-detail-report','task-B',options),true);
  assert.equal(navigations[1].exportTaskId,'task-B');assert.equal(navigations[1].reportTaskId,'task-B');assert.equal(navigations[1].reportPeriod,'batch');
});

test('consultation acceptance blocks ecommerce or mixed scenes before advancing the wizard',()=>{
  assert.equal(typeof workbench.assertConsultationInput,'function');
  assert.throws(()=>workbench.assertConsultationInput({valid:true,sessions:[{scene:'电商评论回复'}]}),/电商评论.*选择/);
  assert.throws(()=>workbench.assertConsultationInput({valid:true,sessions:[{scene:'新品产品咨询'},{scene:'其他业务'}]}),/产品咨询.*场景/);
  assert.doesNotThrow(()=>workbench.assertConsultationInput({valid:true,sessions:[{scene:'新品产品咨询'}]}));
});

test('a consultation mapping draft provides internal metadata and rejects switching or handing off ecommerce',async()=>{
  let current={type:'new-task',mode:'manual'},began=0;
  const ecProfile={id:'old-ec',name:'历史电商方案',scene:'电商评论回复'};
  const manager=createImportManager({getDialog:()=>current,openDialog:d=>{current=d},getState:()=>({inputProfiles:[ecProfile]}),getCatalog:()=>({rules:[],policies:[]}),renderDialog(){},toast(){},beginMappedTask:async()=>{began++}});
  await manager.action('input-import');
  assert.equal(current.businessScene,'新品产品咨询');assert.ok(current.profile.id);assert.ok(current.profile.name);
  manager.change({target:{id:'input-scene',value:'电商评论回复'}});assert.equal(current.profile.scene,'新品产品咨询');
  manager.change({target:{id:'input-profile-select',value:'old-ec'}});assert.equal(current.profile.scene,'新品产品咨询');
  current.file={name:'原表.xlsx'};current.preview={valid:true,sessions:[{scene:'电商评论回复'}]};
  await manager.action('input-begin');assert.equal(began,0);assert.match(current.error,/电商评论.*选择/);
});

test('ecommerce precheck explains missing required labels and clears the reason as fields become valid',async()=>{
  let current;
  const manager=createEcommerceManager({getDialog:()=>current,openDialog:d=>{current=d},renderDialog(){},toast(){},getRuleVersions:()=>[]});
  await manager.action('ec-open');manager.change({target:{id:'ec-file',files:[new File([await createEcommerceSample()],'原表.xlsx')]}});
  for(let i=0;i<100&&current.loading;i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(current.name,'');assert.equal(current.reviewer,'本机操作人');
  assert.match(manager.dialog(current),/placeholder="请填写：批次名-日期"/);
  assert.match(manager.dialog(current),/id="ec-required-hint"[^>]*>[^<]*请填写任务名称/);
  manager.input({target:{id:'ec-name',value:'合成预检批次-20261115'}});manager.input({target:{id:'ec-reviewer',value:'   '}});
  let html=manager.dialog(current);assert.match(html,/审核人标签（必填）/);assert.match(html,/id="ec-reviewer"[^>]*required/);assert.match(html,/id="ec-reviewer"[^>]*aria-required="true"/);assert.match(html,/id="ec-reviewer"[^>]*aria-describedby="ec-required-hint"/);assert.match(html,/id="ec-required-hint"[^>]*>[^<]*请填写审核人标签/);assert.match(html,/data-act="ec-next"[^>]*disabled/);
  manager.input({target:{id:'ec-reviewer',value:'复核员'}});html=manager.dialog(current);
  assert.equal(current.reviewer,'复核员');assert.doesNotMatch(html,/id="ec-required-hint"[^>]*>[^<]*请填写/);assert.match(html,/data-act="ec-next"[^>]*disabled/);
  confirmPreview(manager,current);assert.doesNotMatch(manager.dialog(current),/data-act="ec-next"[^>]*disabled/);
});

test('ecommerce execution settings and changed threshold reach creation after reparsing original input',async()=>{
  let current,payload;
  const manager=createEcommerceManager({getDialog:()=>current,openDialog:d=>{current=d},renderDialog(){},toast(){},getRuleVersions:()=>[{version:'V1.0'}],createTask:async p=>{payload=p}});
  await manager.action('ec-open');manager.input({target:{id:'ec-name',value:'合成设置批次-20261115'}});manager.input({target:{id:'ec-reviewer',value:'审核员'}});
  manager.change({target:{id:'ec-file',files:[new File([await createEcommerceSample()],'原表.xlsx')]}});
  for(let i=0;i<100&&current.loading;i++)await new Promise(r=>setTimeout(r,2));
  confirmPreview(manager,current);await manager.action('ec-next');assert.equal(current.step,2);manager.change({target:{id:'ec-threshold',value:'36'}});
  for(let i=0;i<100&&current.loading;i++)await new Promise(r=>setTimeout(r,2));
  manager.change({target:{id:'ec-concurrency',value:'2'}});manager.change({target:{id:'ec-batch-size',value:'10'}});manager.change({target:{id:'ec-basis-version',value:'V1.0'}});
  await manager.action('ec-create');assert.ok(payload);assert.equal(payload.thresholdHours,36);assert.equal(payload.parsed.sessions[0].ecommerce.thresholdHours,36);
  assert.deepEqual(payload.executionSettings,{concurrency:2,batchSize:10,maxWorkBytes:64000});
  payload=null;manager.change({target:{id:'ec-threshold',value:'0'}});await manager.action('ec-create');assert.equal(payload,null,'invalid current threshold cannot silently reuse a previous value');
});

test('task creation freezes bounded execution settings instead of retaining a mutable UI reference',()=>{
  const settings={concurrency:2,batchSize:10,maxWorkBytes:64000};
  const input={name:'产品批次',reviewer:'审核员',fileName:'原文.json',source:{name:'原文.json',sha256:'a'.repeat(64),size:100},basisSnapshot:{rules:[{id:'P-QA'}],policies:[]},sessions:[{id:'original-1',scene:'新品产品咨询',startedAt:'2026-11-03T10:00:00+08:00',completeness:'完整',turns:[{id:1,role:'客户',text:'咨询原文'}]}],executionSettings:settings};
  const created=createImportedTask(createBusinessState(),input);settings.concurrency=4;
  assert.equal(created.tasks[0].executionSettings?.concurrency,2);
  assert.throws(()=>createImportedTask(createBusinessState(),{...input,executionSettings:{concurrency:5,batchSize:20,maxWorkBytes:64000}}),/并发|同时|1.*4/);
});

test('semantic rows awaiting comparison are not presented as execution failures',()=>{
  const row={id:'compare-row',taskId:'compare-task',turns:[],aiResults:[],aiExecution:{status:'failed',errorCode:'dependency_incomplete'},review:{status:'待审核',drafts:{}}};
  const ownTask={id:'compare-task',aiStatus:'running',aiQueue:{status:'running',phase:'comparison',rows:[{sessionId:row.id,status:'completed'}],comparison:{status:'running'}}};
  const current={tasks:[ownTask],sessions:[row]};
  assert.equal(workbench.taskExecution(current,ownTask).failed,0);
  ownTask.aiQueue.status='paused';ownTask.aiQueue.comparison.status='pending';assert.equal(workbench.taskExecution(current,ownTask).failed,0);
  ownTask.aiQueue.status='failed';ownTask.aiQueue.comparison.status='failed';assert.equal(workbench.taskExecution(current,ownTask).failed,1);
});

test('rules page exposes one secondary structured check-basis manager',()=>{
 const html=catalogPage({rules:[],policies:[]},'rules',{});
 assert.equal((html.match(/data-act="ruleset-list"/g)||[]).length,1);assert.match(html,/检核口径/);
 assert.doesNotMatch(catalogPage({rules:[],policies:[]},'policies',{}),/ruleset-list/);
});

test('stage A task selection distinguishes equal version strings and freezes configured hours rather than legacy threshold',async()=>{
 const r=createRuleSetSeed({now:'2026-11-03T08:00:00+08:00'});
 const versions=[{...r,ruleSetId:'EC-FIRST'},{...r,ruleSetId:'EC-SECOND'}];let current,payload;
 const manager=createEcommerceManager({getDialog:()=>current,openDialog:d=>{current=d;},renderDialog(){},toast(){},getRuleVersions:()=>versions,createTask:async input=>{payload=input;}});
 await manager.action('ec-open');manager.input({target:{id:'ec-name',value:'合成时效批次-20261115'}});manager.input({target:{id:'ec-reviewer',value:'审核员'}});
 manager.change({target:{id:'ec-file',files:[new File([await createEcommerceSample()],'原表.xlsx')]}});
 for(let i=0;i<100&&current.loading;i++)await new Promise(resolve=>setTimeout(resolve,2));confirmPreview(manager,current);await manager.action('ec-next');assert.equal(current.step,2);
 let html=manager.dialog(current);assert.match(html,/value="ruleset:EC-FIRST@V2.1-A"/);assert.match(html,/value="ruleset:EC-SECOND@V2.1-A"/);
 manager.change({target:{id:'ec-basis-version',value:'ruleset:EC-SECOND@V2.1-A'}});
 html=manager.dialog(current);assert.match(html,/其他四项V1/);assert.match(html,/好评正向 72H/);assert.match(html,/日历未核对/);assert.match(html,/id="ec-threshold"[^>]*disabled/);
 manager.change({target:{id:'ec-threshold',value:'48'}});assert.equal(current.thresholdHours,24);
 await manager.action('ec-create');assert.equal(payload.basisVersion,'ruleset:EC-SECOND@V2.1-A');
});

test('task detail shows actual frozen stage A calendar and classified thresholds without old row fallback',()=>{
 const ownTask={...task,scene:'电商评论回复',basisSnapshot:{rules:[],policies:[],ruleSetSnapshot:createRuleSetSeed({now:'2026-11-03T08:00:00+08:00'})}};
 const html=workbench.taskDetailView({...state,tasks:[ownTask]},{taskDetailId:ownTask.id});
 assert.match(html,/其他四项V1/);assert.match(html,/好评正向 72H/);assert.match(html,/日历未核对/);assert.doesNotMatch(html,/回复时效阈值：24小时/);
});
