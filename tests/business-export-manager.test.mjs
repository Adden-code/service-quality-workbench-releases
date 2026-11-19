import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {businessUI,managerState,summaryFixture,reportFixture,emptyBusinessState} from './business-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
const managerUrl=new URL('../public/business-export-manager.mjs',import.meta.url),viewUrl=new URL('../public/business-export-view.mjs',import.meta.url);
async function implementation(){assert.ok(existsSync(managerUrl),'缺少业务导出异步管理器');assert.ok(existsSync(viewUrl),'缺少业务导出视图');return import(managerUrl);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const button=dataset=>({dataset});

test('delivery concurrency defaults to two, is configurable before generation, and stays frozen while running',async()=>{
 const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),requests=[];let job;
 const manager=createBusinessExportManager({api:async(path,options={})=>{if(options.method==='POST'){requests.push(options.body);job=summaryFixture({id:options.body.jobId,concurrency:options.body.concurrency??2,resultAvailable:false});return {job};}return {jobs:[]};},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000});
 try{manager.view(state,ui);assert.equal(ui.businessConcurrency,2);assert.match(manager.view(state,ui),/business-concurrency/);manager.handleChange('business-concurrency','3');await manager.handleAction('business-generate');assert.equal(requests.length,1);assert.equal(requests[0].concurrency,3);manager.handleChange('business-concurrency','4');assert.equal(ui.businessConcurrency,3);assert.match(manager.view(state,ui),/本次任务：3路/);}finally{manager.close();}
});

test('empty business view is useful without fictional examples or automatic model calls',async()=>{
  const {createBusinessExportManager}=await implementation();let calls=0;
  const manager=createBusinessExportManager({api:async()=>{calls++;return{jobs:[]};},getState:emptyBusinessState,getUI:businessUI,onRender:()=>{},download:()=>{},notify:()=>{}});
  const html=manager.view(emptyBusinessState(),businessUI());assert.ok(html.includes('还没有可导出的业务任务'));assert.ok(!html.includes('虚构'));assert.ok(!html.includes('下载标准模板'));
  manager.setActive(true);await tick();assert.equal(calls,0);manager.close();
});
test('active hydration is idempotent and recovers matching option jobs after refresh',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),calls=[];const job=summaryFixture();
  const manager=createBusinessExportManager({api:async(path,options={})=>{calls.push({path,options});if(path.includes('?taskId='))return{jobs:[summaryFixture({id:'wrong-en',options:{conclusionMode:'combined',targetLang:'en'}}),job]};if(path.endsWith('/result'))return{snapshot:reportFixture().snapshot,enrichment:{},job};return{job};},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000});
  manager.setActive(true);manager.setActive(true);await tick();await tick();
  assert.equal(calls.filter(call=>call.path.includes('?taskId=')).length,1);assert.ok(manager.view(state,ui).includes('report-test'));assert.ok(!manager.view(state,ui).includes('wrong-en'));
  manager.setActive(false);const count=calls.length;await tick();assert.equal(calls.length,count);assert.ok(!calls.some(call=>call.path.endsWith('/pause')));manager.close();
});
test('uncertain generation response is reconciled by job ID without a duplicate chargeable POST',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),calls=[],notes=[];let created;
  const manager=createBusinessExportManager({api:async(path,options={})=>{
    calls.push({path,options});if(path.includes('?taskId='))return{jobs:[]};
    if(options.method==='POST'&&path==='/api/report-jobs'){created=summaryFixture({id:options.body.jobId});throw new Error('connection interrupted after commit');}
    if(created&&path==='/api/report-jobs/'+created.id)return{job:created};
    if(path.endsWith('/result'))return{snapshot:reportFixture().snapshot,enrichment:{},job:created};throw new Error('unexpected '+path);
  },getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:(...args)=>notes.push(args),pollMs:100000});
  await manager.handleAction('business-generate');
  assert.equal(calls.filter(call=>call.options.method==='POST').length,1);assert.ok(calls.some(call=>call.path==='/api/report-jobs/'+created.id));assert.ok(manager.view(state,ui).includes('生成中'));assert.ok(!notes.some(row=>String(row[0]).includes('生成失败')));manager.close();
});
test('late list response after target-language change cannot restore the previous option job',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI();let resolveOld,lists=0;
  const manager=createBusinessExportManager({api:async path=>{if(path.includes('?taskId=')){lists++;if(lists===1)return await new Promise(resolve=>resolveOld=resolve);return{jobs:[]};}throw new Error('unexpected '+path);},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000});
  manager.setActive(true);await tick();assert.equal(manager.handleChange('business-target-lang','en'),true);await tick();resolveOld({jobs:[summaryFixture()]});await tick();
  assert.equal(ui.businessTargetLang,'en');assert.ok(!manager.view(state,ui).includes('report-test'));assert.equal(manager.handleChange('other-field','x'),false);manager.close();
});
test('both downloads request the same saved server result and permit explicitly incomplete content',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),downloads=[],calls=[];const {snapshot,enrichment}=reportFixture(),job=summaryFixture();let passedSnapshot;
  const manager=createBusinessExportManager({api:async path=>{calls.push(path);if(path.includes('?taskId='))return{jobs:[job]};if(path.endsWith('/result'))return{snapshot,enrichment,job};return{job};},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:(...args)=>downloads.push(args),notify:()=>{},pollMs:100000,buildXlsx:async(value,rich)=>{passedSnapshot=value;assert.equal(rich,enrichment);return new Uint8Array([80,75]);}});
  manager.setActive(true);await tick();await tick();await manager.handleAction('business-download-xlsx');await manager.handleAction('business-download-html');
  assert.equal(passedSnapshot,snapshot);assert.equal(downloads.length,2);assert.ok(downloads[0][0]instanceof Uint8Array);assert.ok(downloads[0][1].endsWith('.xlsx'));assert.ok(downloads[1][1].endsWith('.html'));assert.ok(downloads[1][0].includes('交付分析尚未完成'));assert.ok(calls.filter(path=>path.endsWith('/result')).length>=2);manager.close();
});
test('node detail and retry controls inspect persisted attempts without mixing model HTML into the page',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),calls=[];const job=summaryFixture({status:'completed_with_warnings',nodes:[{id:'translation-1',kind:'translation',label:'翻译',status:'failed',attempts:2,error:'<img src=x>',durationMs:1000}]});
  const manager=createBusinessExportManager({api:async(path,options={})=>{calls.push({path,options});if(path.includes('?taskId='))return{jobs:[job]};if(path.includes('/nodes/'))return{node:job.nodes[0],attempts:[{attempt:1,status:'failed'}],input:{text:'<script>alert(1)</script>'},output:{error:'<img src=x>'}};if(path.endsWith('/result'))return{...reportFixture(),job};if(path.endsWith('/retry'))return{job:{...job,status:'running'}};return{job};},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000});
  manager.setActive(true);await tick();await tick();await manager.handleAction('business-node',button({nodeId:'translation-1'}));
  const html=manager.view(state,ui);assert.ok(html.includes('节点执行详情'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!/<(?:script|img)\b/.test(html));assert.ok(html.includes('重试缺失项'));
  await manager.handleAction('business-retry');assert.equal(calls.filter(call=>call.path.endsWith('/retry')&&call.options.method==='POST').length,1);manager.close();
});
test('deactivating UI aborts its reads but never pauses or cancels the durable backend job',async()=>{
  const {createBusinessExportManager}=await implementation(),ui=businessUI(),state=managerState(),calls=[];
  const manager=createBusinessExportManager({api:async(path,options)=>{calls.push({path,options});return await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))));},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{}});
  manager.setActive(true);await tick();manager.setActive(false);await tick();assert.equal(calls.length,1);assert.equal(calls[0].options.signal.aborted,true);assert.ok(!calls.some(call=>call.options.method==='POST'));manager.close();
});

test('a second generation click resolves an earlier uncertain job ID before considering another POST',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),calls=[];let created,lookups=0;
  const manager=createBusinessExportManager({api:async(path,options={})=>{
    calls.push({path,options});
    if(options.method==='POST'){created=summaryFixture({id:options.body.jobId});throw new Error('response lost');}
    if(path.endsWith('/result'))return{...reportFixture(),job:created};
    if(created&&path==='/api/report-jobs/'+created.id){lookups++;if(lookups===1)throw Object.assign(new Error('not visible yet'),{status:404});return{job:created};}
    return{jobs:[]};
  },getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000});
  await manager.handleAction('business-generate');await manager.handleAction('business-generate');
  assert.equal(calls.filter(call=>call.options.method==='POST').length,1);assert.ok(lookups>=2);assert.ok(manager.view(state,ui).includes('生成中'));manager.close();
});
test('stale results are disclosed while downloads retain the saved snapshot, not live changed data',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),{snapshot,enrichment}=reportFixture(),job=summaryFixture({status:'completed'});let changed=false,downloaded;
  const manager=createBusinessExportManager({api:async path=>path.includes('?taskId=')?{jobs:[job]}:path.endsWith('/result')?{snapshot,enrichment,job}:{job},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:data=>{downloaded=data;},notify:()=>{},pollMs:100000,createSnapshot:()=>{const current=structuredClone(snapshot);if(changed)current.records[0].summary='修改后的工作区结果';return current;}});
  manager.setActive(true);await tick();await tick();assert.ok(!manager.view(state,ui).includes('工作区结果已变化'));changed=true;assert.ok(manager.view(state,ui).includes('工作区结果已变化'));
  await manager.handleAction('business-download-html');assert.ok(!downloaded.includes('修改后的工作区结果'));manager.close();
});
test('prototype-like change IDs are ignored without mutating application UI fields',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),before=JSON.stringify(ui);
  const manager=createBusinessExportManager({api:async()=>({jobs:[]}),getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{}});
  for(const id of ['constructor','__proto__','toString'])assert.equal(manager.handleChange(id,'injected'),false);
  assert.equal(JSON.stringify(ui),before);manager.close();
});

test('source worksheet, extensions and physical column maps participate in stale report identity',async()=>{
 const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),{snapshot,enrichment}=reportFixture(),job=summaryFixture({status:'completed'});let changed=null;
 const manager=createBusinessExportManager({api:async path=>path.includes('?taskId=')?{jobs:[job]}:path.endsWith('/result')?{snapshot,enrichment,job}:{job},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000,createSnapshot:()=>{const current=structuredClone(snapshot);changed?.(current);return current;}});
 try{manager.setActive(true);await tick();await tick();assert.ok(!manager.view(state,ui).includes('工作区结果已变化'));
  for(const change of [s=>s.sourceSheet={name:'另一表',index:2},s=>s.extensions={headers:['产品系列'],standards:['原标准']},s=>s.records[0].extensionValues=['ORIGINAL_CHANGED'],s=>s.sourceColumns={core:Array.from({length:22},(_,index)=>22-index),extensions:[]}]){changed=change;assert.ok(manager.view(state,ui).includes('工作区结果已变化'));}
 }finally{manager.close();}
});

test('a late partial download response cannot regress a newer completed progress state',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),{snapshot,enrichment}=reportFixture(),running=summaryFixture(),completed=summaryFixture({status:'completed',updatedAt:'2026-11-04T10:02:00+08:00',progress:{total:4,done:4,failed:0,pending:0,running:0,percent:100}});let resultCalls=0,resolveOld,serverComplete=false,completedObserved=false;
  const manager=createBusinessExportManager({api:async path=>{
    if(path.includes('?taskId='))return{jobs:[running]};
    if(path.endsWith('/result')){resultCalls++;if(resultCalls===2)return await new Promise(resolve=>resolveOld=resolve);return{snapshot,enrichment,job:serverComplete?completed:running};}
    if(serverComplete)completedObserved=true;return{job:serverComplete?completed:running};
  },getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:50,createSnapshot:()=>snapshot});
  manager.setActive(true);await tick();await tick();const downloading=manager.handleAction('business-download-html');await tick();serverComplete=true;
  const deadline=Date.now()+1200;while(!completedObserved&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(completedObserved,'progress poll observed completion');await tick();
  resolveOld({snapshot,enrichment,job:running});await downloading;
  assert.ok(manager.view(state,ui).includes('<h2>已完成</h2>'));assert.ok(!manager.view(state,ui).includes('<h2>生成中</h2>'));manager.close();
});

test('external application option changes cannot display an old job while the new selection hydrates',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),job=summaryFixture();let lists=0;
  const manager=createBusinessExportManager({api:async path=>{if(path.includes('?taskId=')){lists++;return{jobs:lists===1?[job]:[]};}return path.endsWith('/result')?{...reportFixture(),job}:{job};},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000});
  manager.setActive(true);await tick();await tick();assert.ok(manager.view(state,ui).includes('report-test'));
  ui.businessTargetLang='en';assert.ok(!manager.view(state,ui).includes('report-test'));manager.setActive(true);manager.setActive(true);await tick();await tick();assert.equal(lists,2);assert.ok(!manager.view(state,ui).includes('report-test'));manager.close();
});

test('each download completion reports failed translations and the actual affected record count',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),notes=[],{snapshot,enrichment}=reportFixture(),job=summaryFixture({status:'completed_with_warnings'});
  enrichment.translationStats={failedTexts:2,pendingTexts:0,affectedRecords:1,missingRecords:1,missingCells:3};
  const manager=createBusinessExportManager({api:async path=>path.includes('?taskId=')?{jobs:[job]}:{snapshot,enrichment,job},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:message=>notes.push(message),pollMs:100000,buildXlsx:async()=>new Uint8Array([80,75]),createSnapshot:()=>snapshot});
  try{
    manager.setActive(true);await tick();await tick();
    await manager.handleAction('business-download-xlsx');await manager.handleAction('business-download-html');
    assert.equal(notes.length,2);
    for(const message of notes){assert.ok(message.includes('翻译失败2段、涉及1条记录'),message);assert.ok(message.includes('未完成0段'),message);}
  }finally{manager.close();}
});

test('the export view shows translation missing counts even when no execution node is failed',async()=>{
  const {businessExportView}=await import(viewUrl),state=managerState(),ui=businessUI(),{snapshot,enrichment}=reportFixture(),job=summaryFixture({warningsCount:0,progress:{total:4,done:1,failed:0,pending:2,running:1,percent:25}});
  enrichment.translationStats={failedTexts:2,pendingTexts:3,affectedRecords:1,missingRecords:4,missingCells:6};
  const html=businessExportView(state,ui,{job,result:{snapshot,enrichment,job}});
  assert.ok(html.includes('翻译失败2段、涉及1条记录'));
  assert.ok(html.includes('另有未完成3段'));
  assert.ok(html.includes('缺译文共涉及4条记录（6处）'));
});

test('partial downloads keep unfinished translations separate from translation failures',async()=>{
  const {createBusinessExportManager}=await implementation(),state=managerState(),ui=businessUI(),notes=[],{snapshot,enrichment}=reportFixture(),job=summaryFixture({status:'paused',warningsCount:0});
  enrichment.translationStats={failedTexts:0,pendingTexts:3,affectedRecords:0,missingRecords:2,missingCells:3};
  const manager=createBusinessExportManager({api:async path=>path.includes('?taskId=')?{jobs:[job]}:{snapshot,enrichment,job},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:message=>notes.push(message),pollMs:100000,createSnapshot:()=>snapshot});
  try{
    manager.setActive(true);await tick();await tick();await manager.handleAction('business-download-html');
    const message=notes.at(-1);assert.ok(message.includes('当前已保存结果'),message);assert.ok(message.includes('翻译失败0段、涉及0条记录'),message);assert.ok(message.includes('另有未完成3段'),message);assert.ok(!message.includes('翻译失败3段'),message);
    const html=manager.view(state,ui);assert.ok(html.includes('另有未完成3段'));assert.ok(html.includes('缺译文共涉及2条记录（3处）'));
  }finally{manager.close();}
});

test('business task selection includes imported consultation tasks and shows their dynamic delivery shape',async()=>{
  const {businessExportView,businessTasks}=await import(viewUrl),{state,snapshot,enrichment}=consultationReportFixture(),ui={...businessUI(),businessTaskId:snapshot.taskId},job=summaryFixture({taskId:snapshot.taskId,taskName:snapshot.taskName,phase:'consultationIssues',options:{conclusionMode:snapshot.conclusionMode,targetLang:snapshot.targetLang}});ui.businessTargetLang=snapshot.targetLang;
  assert.deepEqual(businessTasks(state).map(task=>task.id),[snapshot.taskId]);
  const html=businessExportView(state,ui,{job,result:{snapshot,enrichment,job}});
  assert.ok(html.includes('共28列'));assert.ok(html.includes('17项动态检查'));assert.ok(html.includes('整会话译文'));assert.ok(html.includes('新品质检报告'));
  assert.ok(html.includes('原表历史人工结论映射未配置'));assert.ok(!html.includes('共43列'));assert.ok(!html.includes('电商评价管理质检报告'));assert.ok(!html.includes('五项通过情况'));assert.ok(!html.includes('AI时效规则'));
  assert.ok(!html.includes('product-name'));assert.ok(!html.includes('原表历史人工结论，最后AI初判'));
  assert.ok(!html.includes('consultationIssues'));
});

test('consultation manager downloads both files from one saved snapshot with the consultation Excel builder',async()=>{
  const {createBusinessExportManager}=await implementation(),{state,snapshot,enrichment}=consultationReportFixture(),ui={...businessUI(),businessTaskId:snapshot.taskId,businessTargetLang:snapshot.targetLang},job=summaryFixture({taskId:snapshot.taskId,options:{conclusionMode:snapshot.conclusionMode,targetLang:snapshot.targetLang}}),paths=[],downloads=[];let built=0,recomputed=0;
  const manager=createBusinessExportManager({api:async path=>{paths.push(path);return path.includes('?taskId=')?{jobs:[job]}:{snapshot,enrichment,job};},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:(...args)=>downloads.push(args),notify:()=>{},pollMs:100000,buildXlsx:async()=>{throw new Error('must not use the43-column ecommerce builder');},buildConsultationXlsx:async(value,rich)=>{built++;assert.equal(value,snapshot);assert.equal(rich,enrichment);return new Uint8Array([80,75]);},createSnapshot:()=>{throw new Error('must not use ecommerce staleness calculation');},createConsultationSnapshot:(_state,options)=>{recomputed++;assert.equal(options.original,snapshot.original);return snapshot;}});
  try{
    manager.setActive(true);await tick();await tick();await manager.handleAction('business-download-xlsx');await manager.handleAction('business-download-html');
    assert.equal(built,1);assert.equal(downloads.length,2);assert.ok(downloads[1][0].includes('新品质检报告'));assert.ok(downloads[1][1].endsWith('新品质检报告.html'));assert.ok(recomputed>0);assert.ok(paths.every(path=>path.startsWith('/api/report-jobs')));
  }finally{manager.close();}
});

test('consultation staleness reuses persisted original columns and reports changed current decisions without requesting source files',async()=>{
  const {createBusinessExportManager}=await implementation(),{state,snapshot,enrichment}=consultationReportFixture(),ui={...businessUI(),businessTaskId:snapshot.taskId,businessTargetLang:snapshot.targetLang},job=summaryFixture({taskId:snapshot.taskId,options:{conclusionMode:snapshot.conclusionMode,targetLang:snapshot.targetLang}}),paths=[];let changed=false;
  const manager=createBusinessExportManager({api:async path=>{paths.push(path);return path.includes('?taskId=')?{jobs:[job]}:{snapshot,enrichment,job};},getState:()=>state,getUI:()=>ui,onRender:()=>{},download:()=>{},notify:()=>{},pollMs:100000,createConsultationSnapshot:(_state,options)=>{assert.equal(options.original,snapshot.original);const latest=structuredClone(snapshot);if(changed)latest.records[0].final[0].reason='本次复核改动';return latest;}});
  try{
    manager.setActive(true);await tick();await tick();assert.ok(!manager.view(state,ui).includes('工作区结果已变化'));changed=true;assert.ok(manager.view(state,ui).includes('工作区结果已变化'));assert.ok(paths.every(path=>path.startsWith('/api/report-jobs')));
  }finally{manager.close();}
});
