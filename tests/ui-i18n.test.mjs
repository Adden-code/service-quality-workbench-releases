import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const moduleUrl=new URL('../public/i18n.mjs',import.meta.url);

test('offline UI locale module exists',()=>assert.ok(fs.existsSync(moduleUrl),'English UI module is missing'));

test('locale preference is local, browser-sensitive, and Node defaults to Chinese',async()=>{
  if(!fs.existsSync(moduleUrl))return;
  const {resolveInitialLocale,setLocale,getLocale,LOCALE_STORAGE_KEY}=await import(moduleUrl);
  assert.equal(resolveInitialLocale({document:undefined}), 'zh');
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  assert.equal(resolveInitialLocale({document:{},navigator:{language:'zh-HK'},storage}), 'zh');
  assert.equal(resolveInitialLocale({document:{},navigator:{language:'en-KE'},storage}), 'en');
  values.set(LOCALE_STORAGE_KEY,'en');
  assert.equal(resolveInitialLocale({document:{},navigator:{language:'zh-CN'},storage}), 'en');
  assert.equal(resolveInitialLocale({document:{},navigator:{language:'fr-FR'},storage:{getItem(){throw Error('blocked');}}}), 'en');
  setLocale('en',{storage});assert.equal(getLocale(),'en');assert.equal(values.get(LOCALE_STORAGE_KEY),'en');
  setLocale('zh',{storage});assert.equal(getLocale(),'zh');
});

test('English static templates preserve raw interpolation and canonical option values',async()=>{
  if(!fs.existsSync(moduleUrl))return;
  const {setLocale,t,html,translateError}=await import(moduleUrl),{e}=await import('../public/ui.mjs');
  const raw='原始业务事实：符合，客户原话 <script>';
  setLocale('en');
  try{
    assert.equal(t('工作概览'),'Overview');
    const result=html`<label title="人工结论">人工结论<select><option value="符合">符合</option></select>${e(raw)}</label>`;
    assert.match(result,/Human verdict/);assert.match(result,/value="符合"/);assert.match(result,/>Pass<\/option>/);
    assert.ok(result.includes(e(raw)));assert.equal(e(raw),'原始业务事实：符合，客户原话 &lt;script&gt;');
    assert.equal(translateError(''),'');assert.doesNotMatch(translateError(new Error('未知内部中文错误')),/[\u3400-\u9fff]/u);assert.doesNotMatch(translateError(new Error('未知内部中文错误')),/^未知/);
  }finally{setLocale('zh');}
});

test('English principal views, dialogs, and import helpers retain canonical state',async()=>{
  if(!fs.existsSync(moduleUrl))return;
  const {setLocale}=await import(moduleUrl),{createBusinessState}=await import('../public/domain.mjs'),{createBusinessCatalog}=await import('../public/catalog.mjs');
  const {tasksView,overviewView}=await import('../public/views.mjs'),{modelDialog}=await import('../public/model-ui.mjs'),{taskSceneDialog,creationSteps}=await import('../public/task-workbench.mjs'),{importDialog}=await import('../public/import-ui.mjs'),{createInputProfile}=await import('../public/input-profiles.mjs');
  const state=createBusinessState(),catalog=createBusinessCatalog(),before=JSON.stringify({state,catalog});
  const ui={dataMode:'manual',period:'month',taskStatus:'全部',taskQuery:'',catalogQuery:''};
  setLocale('en');
  try{
    assert.match(tasksView(state,ui),/Quality inspection tasks/);assert.doesNotMatch(tasksView(state,ui),/>新建质检任务/);
    assert.match(overviewView(state,ui),/Overview/);
    assert.match(modelDialog({}).body,/Model settings/);assert.match(modelDialog({}).body,/value="bearer"/);
    assert.match(taskSceneDialog(state).body,/Choose a business scenario/);
    const steps=creationSteps(2);assert.match(steps,/Upload and verify/);assert.match(steps,/Task details/);
    assert.equal(JSON.stringify({state,catalog}),before);
  }finally{setLocale('zh');}
  assert.match(tasksView(state,ui),/质检任务/);assert.equal(JSON.stringify({state,catalog}),before);
});

test('mapping source columns and review control values stay original in English',async()=>{
  const {setLocale,formatDateTime}=await import(moduleUrl),{importDialog}=await import('../public/import-ui.mjs'),{createBusinessCatalog}=await import('../public/catalog.mjs'),{createBusinessState}=await import('../public/domain.mjs');
  const state=createBusinessState(),catalog=createBusinessCatalog(),profile={id:'P1',name:'Original profile',version:1,scene:'新品产品咨询',layout:'turns',sheet:'概览',headerRow:1,fields:{id:'会话标识',startedAt:'时间',role:'角色',text:'原文',topic:'主题'},defaults:{completeness:'完整'},roleMap:{客户:'客户',客服:'客服'},dateFormat:'beijing',extras:[],ruleIds:[]};
  const dialog={type:'input-mapping',profile,inspected:{sheets:[{name:'概览',rows:[{row:1,values:['会话标识','时间','角色','原文','主题']}]}]}},before=JSON.stringify(dialog);
  setLocale('en');try{
    const html=importDialog(dialog,state,catalog);assert.match(html,/value="主题"[^>]*>Original: 主题<\/option>/);assert.match(html,/value="概览"[^>]*>Original: 概览<\/option>/);assert.match(html,/value="完整"[^>]*>Complete<\/option>/);assert.match(formatDateTime('2026-11-05T00:05:00Z'),/08:05/);assert.equal(JSON.stringify(dialog),before);
  }finally{setLocale('zh');}
});

test('ecommerce original reference and reply cells never use status translations',async()=>{
  const {setLocale}=await import(moduleUrl),{ecommerceReferenceView,ecommerceBatchEvidence}=await import('../public/ecommerce-ui.mjs');
  const raw=Array(22).fill('');raw[9]='符合';raw[11]='已确认';raw[15]='不符合';raw[20]='Pass';raw[21]='待审核';
  const session={id:'S1',ecommerce:{raw,sheet:'Sheet4',row:3},review:{status:'待审核',drafts:{}},aiResults:[]},peers=Array.from({length:3},(_,i)=>({...structuredClone(session),id:'S'+(i+1),ecommerce:{...structuredClone(session.ecommerce),row:i+3}})),before=JSON.stringify(peers);
  setLocale('en');try{
    const view=ecommerceReferenceView(session,{tasks:[]}),evidence=ecommerceBatchEvidence({sessions:peers},{batchEvidence:[{kind:'exact',sessionIds:peers.map(s=>s.id),reason:'合成重复理由'}]});
    assert.match(view,/>不符合/);assert.match(view,/>待审核/);assert.match(evidence,/>符合<\/td>/);assert.match(evidence,/>已确认<\/td>/);assert.equal(JSON.stringify(peers),before);
  }finally{setLocale('zh');}
});

test('pending-information and reopen-review dialogs translate their cancel controls',async()=>{
  const {setLocale}=await import(moduleUrl),{createInitialState}=await import('../public/domain.mjs'),{dialogView}=await import('../public/dialogs.mjs');
  const state=createInitialState();state.tasks[0].mode='manual';const ui={selectedId:state.sessions[0].id,dataMode:'manual'},before=JSON.stringify(state);
  setLocale('en');try{
    for(const type of ['pending','reopen']){const html=dialogView({type},state,ui);assert.match(html,/data-act="close-modal">Cancel<\/button>/);assert.doesNotMatch(html,/>取消<\/button>/);}
    assert.equal(JSON.stringify(state),before);
  }finally{setLocale('zh');}
});
