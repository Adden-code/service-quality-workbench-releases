import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../public/catalog.mjs';
import {taskTable,tasksView,overviewView,exportsView} from '../public/views.mjs';
import {reviewView} from '../public/review-view.mjs';
import {manualResultCard,manualHumanFooter} from '../public/business-review.mjs';
import {taskDetailView} from '../public/task-workbench.mjs';
import {businessDialog,businessTaskDialog} from '../public/business-dialogs.mjs';

function fixture(status='completed'){
  const catalog=createCatalog(),rule={...catalog.rules[3],id:'QA-AI',name:'检查颜色回答',title:'检查颜色回答',policyIds:['DOC-AI']};
  const policy={...catalog.policies[0],id:'DOC-AI',title:'冻结的产品资料',sections:[{id:'color',title:'颜色范围',text:'仅有月白和松青。'}]};
  const ai={ruleId:rule.id,verdict:'不符合',reason:'客服没有回答客户的颜色问题。',evidence:[1],referenceIds:['DOC-AI@V1.0#color']};
  const session={id:'S-AI',externalId:'UPLOAD-001',taskId:'T-AI',scene:'新品产品咨询',topic:'颜色咨询',product:'澄光X2',startedAt:'2026-10-29T09:00:00+08:00',expectedRuleIds:[rule.id],aiResults:status==='completed'?[ai]:[],turns:[{id:1,role:'客户',text:'有哪些颜色？'}],review:{status:'待审核',reviewer:'审核员甲',completedAt:null,drafts:{},notes:''}};
  if(status!=='not_run')session.aiExecution={status,runId:'RUN-1',modelId:'glm-5.3-flash',startedAt:'2026-10-29T10:01:00+08:00',...(status==='completed'?{completedAt:'2026-10-29T10:02:00+08:00',requestId:'req-example',promptVersion:'quality-v1'}:{})};
  const task={id:'T-AI',name:'文件质检任务',mode:'manual',aiStatus:status,status:'待审核',progress:0,createdAt:'2026-10-29T10:00:00+08:00',sessionIds:[session.id],basisSnapshot:{capturedAt:'2026-10-29T10:00:00+08:00',effectiveDate:'2026-10-29',rules:[rule],policies:[policy]},source:{name:'新会话.json',sha256:'a'.repeat(64),size:100}};
  if(status!=='not_run')task.aiRun={id:'RUN-1',modelId:'glm-5.3-flash',status,total:1,done:status==='completed'?1:0,failed:status==='failed'?1:0};
  const state={schemaVersion:1,tasks:[task],sessions:[session],activity:[]};
  const ui={dataMode:'manual',selectedId:session.id,reviewTaskId:task.id,reviewStatus:'全部',reviewQuery:'',openRules:[rule.id],highlightedTurns:[],resultFilter:'全部',taskStatus:'全部',taskQuery:'',period:'batch',dashboardTaskId:task.id,exportTaskId:task.id,includePending:true,reportPeriod:'batch',reportTaskId:task.id};
  return{state,ui,task,session,ai,rule};
}

test('model settings has a blank password field and an editable model without echoing saved secrets',async()=>{
  const module=await import('../public/model-ui.mjs').catch(()=>null);
  assert.ok(module?.modelDialog,'model settings must have a renderable dialog');
  const {body,typeClass}=module.modelDialog({config:{configured:true,keyConfigured:true,model:'glm-5.3-flash',baseUrl:'https://ark.cn-beijing.volces.com/api/plan/v3',apiKey:'NEVER-RENDER-SECRET'}});
  assert.equal(typeClass,'model-settings');assert.match(body,/id="model-api-key"[^>]*type="password"[^>]*value=""[^>]*autocomplete="off"/);
  assert.match(body,/id="model-id"[^>]*value="glm-5.3-flash"/);assert.doesNotMatch(body,/NEVER-RENDER-SECRET/);
  assert.match(body,/https:\/\/ark\.cn-beijing\.volces\.com\/api\/plan\/v3/);assert.match(body,/留空保留现有密钥；只保存在本机后台/);
  assert.match(body,/data-act="model-save"/);assert.match(body,/data-act="model-test"/);assert.match(body,/id="model-error"/);assert.match(body,/id="model-feedback"/);
  assert.match(body,/OpenAI兼容/);assert.doesNotMatch(body,/Coding Plan/);
});

test('an unrun file task offers real AI alongside review and original download',()=>{
  const {state,task,ui}=fixture('not_run'),html=taskDetailView(state,{...ui,taskDetailId:task.id});
  assert.match(html,/data-act="run-ai"[^>]*data-id="T-AI"[^>]*>.*AI质检/s);assert.match(html,/data-act="task-review"/);assert.match(html,/data-act="download-source"/);assert.match(html,/未开始/);
});

test('a running task shows actual batch counts and cannot start another run',()=>{
  const {state,task}=fixture('running');task.aiRun.total=3;task.aiRun.done=1;
  const html=taskDetailView(state,{taskDetailId:task.id});
  assert.match(html,/data-act="pause-ai"/);assert.doesNotMatch(html,/data-act="run-ai"|AI未执行/);
});

test('partial tasks offer retry and show failure count; reviewed drafts are never batch candidates',()=>{
  const {state,task,session}=fixture('failed');task.aiStatus='partial';
  let html=taskDetailView(state,{taskDetailId:task.id});assert.match(html,/重试失败项/);assert.match(html,/失败 \/ 未完成/);
  session.review.drafts['QA-AI']={ruleId:'QA-AI',verdict:'符合',reason:'已人工检查',evidence:[1],referenceIds:[]};
  html=taskDetailView(state,{taskDetailId:task.id});assert.match(html,/data-act="run-ai"[^>]*disabled/);
});

test('a completed batch identifies the real model and never offers rerunning successful sessions',()=>{
  const {state,task}=fixture(),html=taskTable(state,[task]);
  assert.match(html,/AI完成 <b>1<\/b>/);assert.match(html,/AI已完成/);assert.doesNotMatch(html,/AI未执行|data-act="run-ai"/);
});

test('AI result cards show original model judgment, evidence and frozen references before human drafts',()=>{
  const {state,session,ai,ui}=fixture(),final={ruleId:'QA-AI',verdict:'符合',reason:'人工核对后另有补充。',evidence:[],referenceIds:[],source:'人工修改'};
  const html=manualResultCard(state,session,{...ai,final},ui,false);
  assert.match(html,/AI初判 · 不符合/);assert.match(html,/客服没有回答客户的颜色问题/);assert.match(html,/定位第1轮/);assert.match(html,/颜色范围/);assert.match(html,/仅有月白和松青/);
  assert.match(html,/人工草稿 · 符合/);assert.match(html,/人工核对后另有补充/);assert.doesNotMatch(html,/AI未执行/);
});

test('completed file review offers AI adoption and displays provenance instead of unexecuted copy',()=>{
  const {state,session,ui}=fixture(),html=reviewView(state,ui),footer=manualHumanFooter(session,'',ui);
  assert.match(html,/AI初判 · 不符合/);assert.match(html,/glm-5.3-flash/);assert.match(footer,/data-act="accept-ai"/);
  assert.match(footer,/其余采用AI结论/);assert.doesNotMatch(html,/AI未执行|AI尚未执行|虚构预置结果/);assert.match(html,/req-example/);
});

test('running review shows waiting status and disables human mutation actions',()=>{
  const {state,session,ui}=fixture('running'),html=reviewView(state,ui);
  assert.match(html,/AI质检进行中/);
  for(const action of ['edit-result','pending','save-draft','confirm-review'])assert.match(html,new RegExp(`<button[^>]*data-act="${action}"[^>]*disabled`));
  assert.doesNotMatch(html,/AI初判 ·|AI未执行/);assert.doesNotMatch(manualHumanFooter(session,'',ui),/data-act="accept-ai"/);
});

test('failed review displays the safe error without presenting a model judgment',()=>{
  const {state,session,ui}=fixture('failed');session.aiExecution.error='模型连接超时，请重试。';
  const html=reviewView(state,ui);assert.match(html,/AI质检失败/);assert.match(html,/模型连接超时，请重试/);assert.doesNotMatch(html,/AI初判 ·|data-act="accept-ai"|AI未执行/);
});

test('human edit starts from successful AI and keeps snapshot reference options',()=>{
  const {state,ui}=fixture(),{body}=businessDialog({type:'edit-result',ruleId:'QA-AI'},state,ui);
  assert.match(body,/<option value="不符合" selected/);assert.match(body,/客服没有回答客户的颜色问题/);assert.match(body,/DOC-AI@V1.0#color/);assert.match(body,/AI原判保留/);assert.doesNotMatch(body,/AI未执行/);
});

test('confirming a completed AI session explains adoption and unknown results remain pending',()=>{
  const {state,ui,session}=fixture(),{body}=businessDialog({type:'confirm-review'},state,ui);
  assert.match(body,/其余.*采用AI初判/);assert.match(body,/无法判定.*待补充/);assert.doesNotMatch(body,/不能采用默认AI结论/);
  session.aiResults[0].verdict='无法判定';const unknown=businessDialog({type:'confirm-review'},state,ui).body;assert.match(unknown,/1 项无法判定/);
});

test('wizard separates local upload preflight from optional conversion and explicit AI execution choices',()=>{
  const {state,session,ui}=fixture('not_run'),upload=businessTaskDialog({step:2}).body,third=businessTaskDialog({step:3}).body,help=businessDialog({type:'help'},state,ui).body;
  assert.match(upload,/aria-current="step"><span class="step-number">2<\/span>上传核对/);assert.match(upload,/上传后先做本地预检，不会自动调用模型/);
  const standard=businessTaskDialog({step:2,file:{name:'合成标准文件.xlsx'},parsed:{valid:true,sessions:[session],turnCount:1},previewConfirmed:true}).body;
  assert.match(standard,/import-precheck success/);assert.match(standard,/id="import-preview-confirm" checked/);assert.match(standard,/<button[^>]*data-act="new-next"(?![^>]*disabled)[^>]*>/);assert.doesNotMatch(standard,/data-act="import-ai-convert"/);
  assert.match(third,/模型设置/);assert.match(third,/data-act="create-business-task"[^>]*>仅创建，稍后质检/);assert.match(third,/data-act="create-business-task-start"[^>]*>创建并开始AI质检/);
  assert.match(help,/AI质检/);assert.doesNotMatch(upload+third+help,/当前工具未执行AI质检|AI未执行，不会生成预置答案/);
});

test('business overview, task explanation and exports reflect completed AI count',()=>{
  const {state,ui}=fixture(),overview=overviewView(state,ui),tasks=tasksView(state,ui),exports=exportsView(state,ui);
  assert.match(overview,/AI已处理 1 条/);assert.doesNotMatch(overview+tasks,/AI尚未执行|AI未执行，当前/);
  assert.match(exports,/不符合/);assert.doesNotMatch(exports,/AI未执行/);
});

test('failed and running exports preserve actual execution status instead of saying AI never ran',()=>{
  for(const status of ['running','failed']){
    const {state,ui}=fixture(status),html=exportsView(state,ui);
    assert.match(html,status==='running'?/AI质检(?:进行)?中/:/AI质检失败/);assert.doesNotMatch(html,/AI未执行/);
  }
});

test('stale human mutation dialogs cannot submit while the selected session AI is running',()=>{
  const {state,ui}=fixture('running');
  for(const type of ['edit-result','confirm-review','pending']){
    const {body}=businessDialog({type,ruleId:'QA-AI'},state,ui);
    assert.match(body,/AI质检进行中/);assert.doesNotMatch(body,/data-act="save-result"|data-act="do-confirm-review"|data-act="save-pending"/);
  }
});

test('an incomplete successful-looking response never appears as an AI conclusion',()=>{
  const {state,session,ui}=fixture();session.aiResults=[];
  const html=reviewView(state,ui);assert.match(html,/AI质检失败/);assert.doesNotMatch(html,/AI初判 ·|data-act="accept-ai"/);
});
