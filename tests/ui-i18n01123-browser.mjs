// Synthetic legacy workspace only. Renders the production view functions in a
// real Chromium DOM. A thrown render, missing view or browser error fails QA.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {sessionDisplayFields} from '../public/session-display-fields.mjs';
import {rulePreparationFields} from '../public/admin-draft-fields.mjs';
const releaseVersion=JSON.parse(await fs.readFile('package.json','utf8')).version;
const root=path.resolve('public'),out=path.resolve('../outputs/service01123-20261125/i18n');
await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURI(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))throw Error('outside');res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
const page=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1050}}),errors=[],reports=[];
const scan=()=>{
 const original=el=>el.closest('[data-business-original],textarea,script,style');
 return [...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&!original(el)).flatMap(el=>{
  const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();return [['text',text],...['aria-label','title','placeholder','alt'].map(a=>[a,el.getAttribute(a)||''])].filter(([,v])=>/[\u3400-\u9fff]/u.test(v)).map(([attribute,text])=>({tag:el.tagName,attribute,text}));
 });
};
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.route('**/probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/i18n.css"></head><body><main id="probe"></main></body></html>'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/probe`);
 const names=await page.evaluate(async()=>{
  const modules=Object.fromEntries(await Promise.all(['i18n','domain','catalog','ecommerce-catalog','task-basis','views','review-view','task-workbench','task-execution-page','catalog-view','catalog-dialogs','model-ui','business-export-view','scene-configuration','scene-configuration-ui','scenarios','scenario-ui','import-drafts-manager','content-translation-ui','reason-translation','session-display-fields','import-ui','dialogs','rule-set-ui','raw-review-view','scene-review-view','dependency-recovery-ui','workflow-view','admin-draft-translation'].map(async name=>[name,await import('/'+name+'.mjs')])));
  modules.i18n.setLocale('en');const state=modules.domain.createBusinessState(),catalog=modules['ecommerce-catalog'].ensureEcommerceCatalog(modules.catalog.createBusinessCatalog(),{owner:'Synthetic maintainer'});
  const basis=modules['task-basis'].createBasisSnapshot(catalog,{ruleIds:['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'],effectiveDate:'2026-11-25'});
  // Catalog owner/scope are synthetic user data; Chinese standard names are real
  // labels from the built-in catalog and MUST be covered by offline translation.
  const raw=Array(22).fill('');raw[8]='SYNTHETIC customer issue';raw[9]='SYNTHETIC agent reply';raw[10]='1';raw[12]='2026-11-24 09:00:00';raw[13]='2026-11-24 10:00:00';
  const sourceSession={id:'SYN-1',externalId:'SYN-1',scene:'电商评论回复',startedAt:'2026-11-24T09:00:00+08:00',topic:'Synthetic topic',agent:'Synthetic agent',customer:'Synthetic customer',product:'Synthetic product',channel:'Synthetic channel',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'Customer',at:'09:00',text:raw[8]},{id:2,role:'客服',speaker:'Agent',at:'10:00',text:raw[9]}],ecommerce:{raw,sheet:'Sheet4',row:3,fileSha256:'a'.repeat(64),thresholdHours:24}};
  Object.assign(sourceSession.ecommerce,{schemaVersion:1,headers:(await import('/ecommerce-schema.mjs')).EC_HEADERS,standards:Array(22).fill('')});
  const schema=await import('/ecommerce-schema.mjs');Object.assign(sourceSession,schema.ecommerceSourceProjection(sourceSession.ecommerce));sourceSession.id=sourceSession.externalId=schema.ecommerceRecordId(sourceSession.ecommerce);
  let current=modules.domain.createImportedTask(state,{id:'SYN-T1',name:'Synthetic old task',sessions:[sourceSession],reviewer:'Synthetic reviewer',basisSnapshot:basis,source:{name:'synthetic.xlsx',size:10,sha256:'a'.repeat(64)},fileName:'synthetic.xlsx',now:'2026-11-24T12:00:00+08:00',reviewPolicy:{enabled:false}});
  current=modules.domain.createImportedTask(current,{id:'SYN-T2',name:'Synthetic repeated task',sessions:[structuredClone(sourceSession)],reviewer:'Synthetic reviewer',basisSnapshot:basis,source:{name:'synthetic.xlsx',size:10,sha256:'a'.repeat(64)},fileName:'synthetic.xlsx',now:'2026-11-25T12:00:00+08:00',reviewPolicy:{enabled:false}});
  const task=current.tasks[0],row=current.sessions.find(s=>s.taskId===task.id);task.aiStatus='failed';task.aiRun={id:'synthetic-run',modelId:'synthetic',status:'failed',total:1,done:0,failed:1,startedAt:'2026-11-25T12:00:00Z',completedAt:'2026-11-25T12:01:00Z'};
  row.aiExecution={status:'failed',runId:'synthetic-run',modelId:'synthetic',error:'未取得完整AI结果，可在任务详情中继续处理。',errorCode:'invalid_output'};row.sceneCapabilities={outputs:{ecommerceClassification:{status:'completed',reason:'评分为一星且描述产品缺陷。',value:{evaluationType:'差评',vocKind:'substantive'},confidence:.9}}};
  task.aiQueue={id:'synthetic-run',status:'failed',phase:'semantic',settings:{concurrency:2,batchSize:25},rows:[{sessionId:row.id,status:'failed',error:row.aiExecution.error}],segments:[]};
  const ui={dataMode:'manual',period:'all',taskStatus:'全部',taskQuery:'',catalogQuery:'',reviewTaskId:task.id,reviewStatus:'AI失败',reviewQuery:'',selectedId:row.id,resultFilter:'全部',openRules:['EC-TIME'],highlightedTurns:[],taskDetailId:task.id,showReviewRecords:true,executionPages:{[task.id]:{offset:0,total:1,rows:[{sessionId:row.id,sourceRow:3,status:'failed',error:row.aiExecution.error}]}},businessTaskId:task.id,businessConclusionMode:'combined',businessReportLanguage:'en',businessTargetLang:'en',businessConcurrency:2,exportTaskId:task.id,includePending:true};
  const pkg=modules['scene-configuration'].defaultScenePackage(modules.scenarios.BUILTIN_SCENARIOS.find(s=>s.id==='电商评论回复'),basis);pkg.configuration.status='published';current.sceneConfigurations=[pkg.configuration];current.analysisSchemas=[pkg.schema];current.reportTemplates=[pkg.template];
  const titles=['整体判定原则','及时响应与负向回应','负面情绪安抚','结束会话前确认与告知','查询等待与重复查询','完整解答与先答后促','跨平台下单引导','个人信息收集边界','产品政策与员工评价','品牌与商家形象维护','权益保护与维修政策表述','沟通内容合规','主动探需','卖点与需求匹配','主动优惠引导','主动卖点说明','异议处理与挽留'];
  const npRules=titles.map((title,i)=>({...structuredClone(catalog.rules[0]),id:`NP-R${String(i+1).padStart(2,'0')}`,title,name:title,category:i===0?'整体判定':i<12?'服务礼仪':i===12?'探需':'导购',sceneIds:['新品产品咨询'],scope:'Synthetic legacy scope',passCriteria:'Synthetic pass criterion',failCriteria:'Synthetic failure criterion',exceptionCriteria:'Synthetic exception'}));catalog.rules.push(...npRules.map(({name,...r})=>r));
  const npTask={...structuredClone(task),id:'NP-SYNTHETIC-TASK',name:'Synthetic legacy NP task',scene:'新品产品咨询',basisSnapshot:{...structuredClone(basis),rules:npRules}},npRow={...structuredClone(row),id:'NP-SYNTHETIC-ROW',externalId:'NP-SYNTHETIC-ROW',taskId:'NP-SYNTHETIC-TASK',scene:'新品产品咨询',expectedRuleIds:npRules.map(r=>r.id),topic:'Synthetic product consultation',turns:[{id:1,role:'客户',at:'09:00',text:'SYNTHETIC customer question.'},{id:2,role:'客服',at:'09:01',text:'SYNTHETIC answer.'}]};delete npTask.aiQueue;delete npRow.ecommerce;delete npRow.sceneCapabilities;current.tasks.push(npTask);current.sessions.push(npRow);
  const npUi={...ui,taskDetailId:npTask.id,reviewTaskId:npTask.id,selectedId:npRow.id,openRules:['NP-R02'],catalogScene:'新品产品咨询'};
  const scfg=modules['scene-configuration-ui'].createSceneConfigurationManager({getState:()=>current,getDialog:()=>null});
  const drafts=modules['import-drafts-manager'].createImportDraftManager();
  modules['content-translation-ui'].applyBundledRuleEnglish(catalog,current);
  const history=await import('/task-history-view.mjs');
  const completed=structuredClone(row);completed.aiExecution.status='completed';completed.aiResults=basis.rules.map((r,i)=>({ruleId:r.id,verdict:i%2?'不符合':'无法判定',reason:i%2?'El agente no explica los siguientes pasos.':'模型认为说明不充分。',evidence:[],referenceIds:[],turnRefs:['模型估计：客服第2轮'],confidence:.8}));
  completed.sceneCapabilities.outputs.demandSummary={status:'completed',reason:'用户要求更换配件。',value:{text:'Le client demande un remplacement.'}};completed.sceneCapabilities.outputs.negativeVoice={status:'completed',reason:'O cliente reclama do atraso.',value:{text:'用户抱怨处理慢。'}};
  const completedState={...current,sessions:current.sessions.map(s=>s.id===completed.id?completed:s)};
  const rawRow={...structuredClone(npRow),aiExecution:{status:'completed',runId:'R'},rawTranscript:{schemaVersion:1,text:'Synthetic original transcript.',row:2,timePolicy:{mode:'unavailable',timezone:'+08:00'}},aiResults:[{ruleId:'NP-R02',verdict:'不符合',reason:'客服未具体解释。',turnRefs:['模型估计：客服第2轮'],evidence:[],referenceIds:[],confidence:.8}],review:{status:'待审核',reviewer:'Synthetic reviewer',drafts:{},history:[],notes:''}};
  const rawState={...current,sessions:[rawRow]},rawUi={...npUi,rawSelectedSession:rawRow.id,rawResultFilter:'全部规则',openRules:['NP-R02']};
  const candidates=[{id:'NP-R18',title:'候选检查项',category:'服务礼仪',scope:'Atencion al cliente',passCriteria:'明确说明具体处理步骤。',failCriteria:'No explica los siguientes pasos.',exceptionCriteria:'无相关诉求时不适用。',sourceQuote:'Synthetic source quotation',sourceLocator:{start:0,end:26},warnings:['需要对照原文核实。'],included:true}];
  const ruleDraft={type:'rule-import',scene:'新品产品咨询',mode:'text',sourceName:'synthetic-rules.txt',sourceText:'Synthetic source quotation',policyIds:[],prepared:{preparationId:'RPD-synthetic',modelId:'synthetic',candidates:structuredClone(candidates)},candidates:structuredClone(candidates)};
  const draftPkg=structuredClone(pkg);draftPkg.ruleCandidates=structuredClone(candidates);draftPkg.unmapped=['应人工核对例外口径。'];
  const sceneDraft={type:'scfg-edit',sceneId:'电商评论回复',package:draftPkg,draft:{id:'SCD-synthetic',status:'draft',revision:1,imported:true,preparation:{},confirmations:{},package:structuredClone(draftPkg)},tab:'rules',actor:'Synthetic maintainer',reason:'Synthetic change'};
  const renderers={
   'completed-ai-inline-review':()=>modules['review-view'].reviewView(completedState,{...ui,reviewStatus:'全部'}),
   'raw-np-ai-review-open-rule':()=>modules['raw-review-view'].rawReviewView(rawState,rawUi,{session:rawRow,queue:[rawRow]}),
   'auxiliary-ai-explanations':()=>modules['scene-review-view'].sceneReviewEvidence(completed,'NP-R02'),
   'workflow-original-ai-output':()=>modules['workflow-view'].workflowView({active:true,taskId:task.id,runs:[{id:'RUN',status:'completed'}],run:{id:'RUN',status:'completed',engine:'native',nodes:[{id:'model',status:'completed',input:{source:'Synthetic source'},output:{reason:'模型生成原始理由。'}}]}}),
   'rule-import-ai-draft':()=>modules['import-ui'].importDialog(ruleDraft,current,catalog),
   'configuration-ai-draft':()=>scfg.dialog(sceneDraft),
   overview:()=>modules.views.overviewView(current,ui),tasks:()=>modules.views.tasksView(current,ui),'task-detail-execution':()=>modules['task-workbench'].taskDetailView(current,ui),'review-failed':()=>modules['review-view'].reviewHeader(current,ui)+modules['review-view'].reviewView(current,ui),
   rules:()=>modules['catalog-view'].catalogPage(catalog,'rules',ui,'',current),policies:()=>modules['catalog-view'].catalogPage(catalog,'policies',ui,'',current),
   'rule-dialog':()=>modules['catalog-dialogs'].catalogDialog({type:'catalog-detail',kind:'rules',id:'EC-TEXT',version:'V1.0'},catalog,current),'policy-dialog':()=>modules['catalog-dialogs'].catalogDialog({type:'catalog-detail',kind:'policies',id:'EC-POLICY',version:'V1.0'},catalog,current),
   'model-settings':()=>modules['model-ui'].modelDialog({error:'请选择分类、填写依据及审核人标签。'}).body,'task-scene':()=>modules['task-workbench'].taskSceneDialog(current).body,
   'import-drafts-empty':()=>drafts.dialog({type:'import-drafts-list',items:[]}), 'import-drafts-existing':()=>drafts.dialog({type:'import-drafts-list',items:[{id:'D1',name:'Synthetic import draft',sourceName:'synthetic.xlsx',updatedAt:'2026-11-25T00:00:00Z'}],error:'读取导入草稿失败。'}),
   'business-export':()=>modules['business-export-view'].businessExportView(current,ui,{}),'audit-export':()=>modules.views.exportsView(current,ui),
   'configuration-list':()=>scfg.dialog({type:'scfg-list',sceneId:'电商评论回复'}),
   'np-legacy-rules':()=>modules['catalog-view'].catalogPage(catalog,'rules',npUi,'',current),'np-legacy-task-detail':()=>modules['task-workbench'].taskDetailView(current,npUi),'np-legacy-review':()=>modules['review-view'].reviewHeader(current,npUi)+modules['review-view'].reviewView(current,npUi),
   'archived-task-history':()=>history.taskHistoryView(current,npTask,npUi),
   ...Object.fromEntries(['rules','auxiliary','delivery'].map(tab=>['configuration-'+tab,()=>scfg.dialog({type:'scfg-edit',sceneId:'电商评论回复',package:pkg,draft:{id:'D1',status:'draft',revision:1,imported:true,confirmations:{}},tab,actor:'Synthetic maintainer',reason:'Synthetic change'})]))
  };
  window.qa={modules,state:current,catalog,ui,renderers,adminDialogs:[ruleDraft,sceneDraft],original:JSON.stringify({current,catalog})};return Object.keys(renderers);
 });
 for(const name of names){
  await page.evaluate(name=>{const html=qa.renderers[name]();if(typeof html!=='string'||html.length<50)throw Error('Missing rendered view: '+name);document.querySelector('#probe').innerHTML=html;},name);
  if(['completed-ai-inline-review','raw-np-ai-review-open-rule','rule-import-ai-draft','configuration-ai-draft','workflow-original-ai-output'].includes(name)){
   const main=await page.locator('#probe').innerText();assert.doesNotMatch(main,/模型认为|客服未具体解释|模型估计|El agente|Atencion al cliente|No explica|模型生成原始理由|候选检查项|需要对照原文核实/u,name+' must keep raw AI prose in folded audit');
   for(const el of await page.locator('.ai-original-audit').all())assert.equal(await el.getAttribute('open'),null);
  }
  await page.evaluate(()=>{for(const d of document.querySelectorAll('details'))d.open=true;});
  const result=await page.evaluate(()=>{
   const original=el=>el.closest('[data-business-original],textarea,script,style');
   const rows=[...document.querySelectorAll('#probe *')].filter(el=>el.getClientRects().length&&!original(el)).flatMap(el=>{
    const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();return [['text',text],...['aria-label','title','placeholder','alt'].map(a=>[a,el.getAttribute(a)||''])].filter(([,v])=>/[\u3400-\u9fff]/u.test(v)).map(([attribute,text])=>({tag:el.tagName,attribute,text}));
   });const builtinTitles=[...document.querySelectorAll('.context-field strong,.context-field small,[data-rule-card] .result-title-left strong,.ec-inline-row-heading h3,.task-basis-list strong,.managed-catalog .catalog-card h3')].map(el=>el.textContent);for(const title of builtinTitles)if(/[\u3400-\u9fff]|English missing/u.test(title))rows.push({tag:'BUILTIN_TITLE',attribute:'text',text:title});return {findings:rows,builtinTitles,headings:[...document.querySelectorAll('h1,h2,h3')].map(h=>h.textContent),elements:document.querySelectorAll('#probe *').length};
  });
  reports.push({name,...result});if(process.env.I18N_SCREENSHOTS==='1')await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
 }
 const adminProof=await page.evaluate(async()=>{
  const api=qa.modules['admin-draft-translation'],before=JSON.stringify(qa.adminDialogs),calls=[];let result;
  const client={list:async()=>({jobs:[]}),create:async input=>{calls.push(input);const dialog=qa.adminDialogs.find(d=>JSON.stringify(api.adminDraftDescriptor(d).source)===JSON.stringify(input.source)),descriptor=api.adminDraftDescriptor(dialog),job={...input,id:input.jobId,status:'completed',sourceFingerprint:'a'.repeat(64)};result={job,sourceFingerprint:'a'.repeat(64),sourceSnapshot:{source:descriptor.source,fields:descriptor.fields},translations:descriptor.fields.map(f=>({...f,sourceText:f.text,status:'translated',text:'Review the specific requirement against the source.'}))};return{job};},result:async()=>result};
  const controller=api.createAdminDraftTranslationController({client,autoPoll:false});for(const dialog of qa.adminDialogs)await controller.ensure(dialog);controller.stop();
  return{calls,unchanged:before===JSON.stringify(qa.adminDialogs),panels:qa.adminDialogs.map(d=>api.adminDraftTranslationPanel(d))};
 });
 assert.equal(adminProof.calls.length,2);assert.equal(adminProof.unchanged,true);for(const panel of adminProof.panels){assert.match(panel,/English display translations loaded/);assert.doesNotMatch(panel,/[\u3400-\u9fff]|Atencion|No explica/u);}
 assert.deepEqual(errors,[],'Browser render errors');
 await fs.writeFile(path.join(out,'render-scan.json'),JSON.stringify({pages:reports.length,errors,reports},null,2));
 const findings=reports.flatMap(r=>r.findings.map(f=>({page:r.name,...f})));
 console.log(JSON.stringify({pages:reports.length,findings},null,2));assert.deepEqual(findings,[],'Untranslated visible UI');
 // Complete application navigation exercises event handlers and auto-translation.
 // Only local synthetic API fixtures are routed; no customer data/model calls.
 const preparedDraft=await page.evaluate(()=>qa.adminDialogs[0].prepared);
 const fixture=await page.evaluate(()=>({state:qa.state,catalog:qa.catalog})),before=JSON.stringify(fixture),apiCalls=[],unexpected=[],appErrors=[],toasts=[],jobs=new Map();let failTranslation=false,badTranslation=false;
 const app=await browser.newPage({locale:'en-GB',viewport:{width:1440,height:1050}});app.setDefaultTimeout(12000);app.on('pageerror',e=>appErrors.push(e.message));app.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))appErrors.push(m.text());});
 await app.addInitScript(()=>{window.qaToasts=[];new MutationObserver(()=>{const text=document.querySelector('.toast')?.textContent;if(text&&!window.qaToasts.includes(text))window.qaToasts.push(text);}).observe(document,{childList:true,subtree:true,characterData:true});});
 const build=await page.evaluate(async()=>(await import('/build-identity.mjs')).clientBuild);
 await app.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),method=req.method();apiCalls.push({method,path:url.pathname});let body,status=200;
  if(url.pathname==='/api/workspace')body={initialized:true,revision:7,token:'synthetic-local-token',productVersion:releaseVersion,...fixture};
  else if(url.pathname==='/api/build-info')body=build;
  else if(url.pathname==='/api/model/config')body={configured:true,keyConfigured:false,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-local-only',authMode:'none',timeoutMs:120000};
  else if(url.pathname==='/api/rules/prepare'&&method==='POST')body=preparedDraft;
  else if(url.pathname==='/api/translation-jobs'&&method==='GET')body={jobs:[]};
  else if(url.pathname==='/api/translation-jobs'&&method==='POST'){
   if(failTranslation){status=503;body={error:'Synthetic translation service unavailable'};}
   else{const input=req.postDataJSON(),s=fixture.state.sessions.find(s=>s.id===input.source.sessionId),task=fixture.state.tasks.find(t=>t.id===s?.taskId),fields=input.source.kind==='rule-preparation'?rulePreparationFields(preparedDraft):sessionDisplayFields(s,task),job={...input,id:input.jobId,status:'completed',resultAvailable:true,sourceFingerprint:'a'.repeat(64)};jobs.set(job.id,{job,sourceFingerprint:job.sourceFingerprint,sourceSnapshot:{source:input.source,fields},translations:fields.map(f=>({...f,sourceText:f.text,status:'translated',text:badTranslation?'One-star rating 仍有中文。':'One-star rating and a described product defect.'}))});body={job};}
  }else if(url.pathname.startsWith('/api/translation-jobs/')){const id=url.pathname.split('/')[3],entry=jobs.get(id);if(!entry){status=404;body={error:'Translation job not found'};}else body=url.pathname.endsWith('/result')?entry:{job:entry.job};}
  else if(url.pathname==='/api/import-drafts')body={items:[]};
  else if(url.pathname==='/api/report-jobs')body={jobs:[]};
  else if(/^\/api\/tasks\/[^/]+\/execution$/.test(url.pathname))body={offset:0,total:1,rows:[{sessionId:fixture.state.sessions[0].id,sourceRow:3,status:'failed',error:'模型结果不完整或依据无效，本行未保存质检结论。'}]};
  else{unexpected.push({method,path:url.pathname});status=501;body={error:'Unexpected synthetic API request'};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 const appReports=[];async function inspectApp(name){assert.equal(await app.locator('.page-error').count(),0,'Rendered error page: '+name);const found=await app.evaluate(scan);appReports.push({name,findings:found});assert.deepEqual(found,[],name);toasts.push(...await app.evaluate(()=>window.qaToasts));}
 await app.goto(`http://127.0.0.1:${server.address().port}/index.html`);await app.getByRole('heading',{name:'Overview',exact:true}).waitFor();await inspectApp('app-overview');
 assert.equal(await app.locator('[data-act="ui-locale"][data-locale="zh"]').innerText(),'Chinese');
 assert.equal(await app.locator('.brand-mark').innerText(),'QA');assert.equal(await app.locator('.build-identity summary').innerText(),releaseVersion);
 for(const [id,title] of [['tasks','Quality inspection tasks'],['rules','Inspection rules'],['knowledge','Policies and knowledge'],['exports','Business deliverables']]){
  await app.locator(`.nav-link[data-page="${id}"]`).click();await app.getByRole('heading',{name:title,exact:true}).first().waitFor();await inspectApp('app-'+id);
 }
 await app.locator('.nav-link[data-page="tasks"]').click();await app.locator(`[data-act="task-review"][data-id="${fixture.state.tasks[0].id}"]`).click();await app.locator('.ec-inline-review').waitFor();await app.getByText('One-star rating and a described product defect.',{exact:true}).first().waitFor();await inspectApp('app-review-failed-translated');
 await fs.mkdir(path.join(out,'browser'),{recursive:true});await app.screenshot({path:path.join(out,'browser','failed-row-translated.png'),fullPage:true});
 await app.locator('[data-act="model-settings"]').click();await app.locator('#model-base-url').waitFor();await inspectApp('app-model-settings');await app.locator('[data-act="close-modal"]').first().click();
 await app.locator('.nav-link[data-page="tasks"]').click();await app.locator(`[data-act="task-detail"][data-id="${fixture.state.tasks[0].id}"]`).first().click();await app.locator('.task-detail-head').waitFor();await app.locator('[data-act="execution-page"]').first().click();await app.getByText(/No inspection verdict was saved for this row/).waitFor();await inspectApp('app-execution-errors');
 failTranslation=true;await app.reload();await app.locator('.nav-link[data-page="tasks"]').waitFor();await app.locator('.nav-link[data-page="tasks"]').click();const back=app.locator('[data-act="task-list"]');if(await back.count())await back.click();await app.locator(`[data-act="task-review"][data-id="${fixture.state.tasks[0].id}"]`).click();await app.getByText('[Translation unavailable — retry required]',{exact:true}).first().waitFor();await inspectApp('app-review-failed-translation-unavailable');
 assert.doesNotMatch(await app.locator('.classification-ai-reason').innerText(),/[\u3400-\u9fff]/u);assert.equal(await app.locator('.classification-ai-reason .ai-original-audit').getAttribute('open'),null);assert.equal(await app.locator('.classification-ai-reason [data-business-original]').textContent(),'评分为一星且描述产品缺陷。');await app.screenshot({path:path.join(out,'browser','failed-row-translation-unavailable.png'),fullPage:true});
 failTranslation=false;badTranslation=true;await app.locator('[data-act="reason-translation-retry"]').first().click();await app.getByText('[Translation unavailable — retry required]',{exact:true}).first().waitFor();await inspectApp('app-review-rejects-mixed-language-translation');assert.doesNotMatch(await app.locator('.classification-ai-reason').innerText(),/[\u3400-\u9fff]/u);
 badTranslation=false;await app.locator('[data-act="reason-translation-retry"]').first().click();await app.getByText('One-star rating and a described product defect.',{exact:true}).first().waitFor();await inspectApp('app-review-translation-retry-recovers');
 failTranslation=true;await app.locator('.nav-link[data-page="rules"]').click();await app.locator('[data-act="rule-import-open"]').click();await app.locator('#rule-import-source-name').fill('synthetic-rule-source.txt');await app.locator('#rule-import-text').fill('Synthetic source quotation');await app.locator('[data-act="rule-import-prepare"]').click();await app.locator('[data-admin-draft-preview]').getByText('Translation unavailable.',{exact:false}).waitFor();await inspectApp('app-admin-draft-automatic-translation-failure');
 assert.equal(await app.locator('[data-dialog-disclosure="admin-draft-original"]').getAttribute('open'),null);const candidateTitle=await app.locator('[data-candidate-key="title"]').inputValue();assert.equal(candidateTitle,'候选检查项');
 failTranslation=false;await app.locator('[data-act="admin-draft-translation-retry"]').click();await app.locator('[data-admin-draft-preview]').getByText('English display translations loaded.',{exact:false}).waitFor();await inspectApp('app-admin-draft-retry-recovers');assert.equal(await app.locator('[data-candidate-key="title"]').inputValue(),candidateTitle);assert.doesNotMatch(await app.locator('[data-admin-draft-preview]').innerText(),/[\u3400-\u9fff]|Atencion|No explica/u);await app.screenshot({path:path.join(out,'browser','admin-draft-translated.png'),fullPage:true});
 assert.equal(JSON.stringify(fixture),before);assert.deepEqual(appErrors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(toasts,[],'Event handlers must not hide failures in a toast');assert.equal(apiCalls.filter(c=>c.method!=='GET'&&!['/api/translation-jobs','/api/rules/prepare'].includes(c.path)).length,0);
  await fs.writeFile(path.join(out,'browser','verification.json'),JSON.stringify({status:'passed',externalModelCalls:0,syntheticApi:true,productionAppNavigation:true,pages:reports.length+appReports.length,renderViews:reports,appReports,appErrors,toasts,unexpected,apiCalls,failedRowEnglishTranslation:true,strictEnglishMainView:true,adminDraftTranslation:adminProof,adminDraftAutomaticRequest:true,adminDraftRetryRecovers:true,latinAIRequiresTranslation:true,standardSourceLabelsEnglish:true,originalAIOnlyInCollapsedAudit:true,mixedScriptTranslationRejected:true,retryRecovers:true,workspaceUnmodified:true},null,2));console.log(`Passed ${reports.length} production views/dialogs and ${appReports.length} full-app states; no render errors, unexpected toasts or external model calls.`);await app.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
