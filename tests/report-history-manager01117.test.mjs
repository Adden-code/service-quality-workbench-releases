import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessExportManager} from '../public/business-export-manager.mjs';
import {reportHistoryView} from '../public/report-history-view.mjs';
import {reportNodeAuditView} from '../public/report-node-audit-view.mjs';
import {reportFixture,managerState,businessUI,summaryFixture} from './business-report-fixtures.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flush=async()=>{for(let i=0;i<8;i++)await tick();};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const mount=id=>({dataset:{jobId:id}});
function saved(id,options={},overrides={}){return summaryFixture({id,options:{conclusionMode:'combined',targetLang:'zh',reportLanguage:'zh',...options},...overrides});}
function result(job){const value=reportFixture();Object.assign(value.snapshot,{taskId:job.taskId,conclusionMode:job.options.conclusionMode,targetLang:job.options.targetLang,roleEvidenceMode:job.options.roleEvidenceMode});return{...value,job};}
function setup({jobs=[],api,ui=businessUI(),reentrant=false,translationClient}={}){
  const state=managerState(),requests=[],downloads=[],notes=[];let manager;
  const fallback=async(path,options={})=>{
    if(path.includes('?taskId='))return{jobs};
    const job=jobs.find(item=>path.startsWith('/api/report-jobs/'+item.id));
    if(job)return path.endsWith('/result')?result(job):{job};
    throw new Error('Unexpected '+path);
  };
  manager=createBusinessExportManager({api:async(path,options={})=>{requests.push({path,options});return api?api(path,options,fallback):fallback(path,options);},getState:()=>state,getUI:()=>ui,download:(...args)=>downloads.push(args),notify:(...args)=>notes.push(args),onRender:()=>{if(reentrant)manager?.setActive(true);},translationClient,pollMs:100000,buildXlsx:async()=>new Uint8Array([80,75])});
  return{manager,state,ui,requests,downloads,notes,html:()=>manager.view(state,ui)};
}

test('fresh manager restores the saved running job across mode and language with read-only requests',async()=>{
  const job=saved('running-en',{conclusionMode:'ai',targetLang:'en',reportLanguage:'en'}),other=saved('foreign-task',{}, {taskId:'another-task'}),f=setup({jobs:[other,job],reentrant:true});
  try{f.manager.setActive(true);await flush();assert.equal(f.ui.businessConclusionMode,'ai');assert.equal(f.ui.businessTargetLang,'en');assert.equal(f.ui.businessReportLanguage,'en');assert.match(f.html(),/data-job-id="running-en" aria-current="true"/);assert.doesNotMatch(f.html(),/foreign-task/);assert.equal(f.requests.filter(r=>r.path.includes('?taskId=')).length,1);assert.ok(f.requests.every(r=>!r.options.method||r.options.method==='GET'));assert.ok(f.requests.every(r=>!r.options.signal.aborted));}finally{f.manager.close();}
});

test('fresh restore honors stored report language even when base target and conclusion already match',async()=>{
  const job=saved('zh-base-en-report',{reportLanguage:'en'}),f=setup({jobs:[job]});
  try{f.manager.setActive(true);await flush();assert.equal(f.ui.businessTargetLang,'zh');assert.equal(f.ui.businessReportLanguage,'en');assert.match(f.html(),/data-job-id="zh-base-en-report" aria-current="true"/);}finally{f.manager.close();}
});

test('fresh activation recovers a running alternative before a completed default-language report',async()=>{
  const completed=saved('completed-default',{}, {status:'completed'}),running=saved('running-alternative',{conclusionMode:'ai',targetLang:'en',reportLanguage:'en'}),f=setup({jobs:[completed,running]});
  try{f.manager.setActive(true);await flush();assert.equal(f.ui.businessJobId,running.id);assert.equal(f.ui.businessTargetLang,'en');assert.equal(f.ui.businessConclusionMode,'ai');assert.ok(f.requests.every(r=>r.options.method!=='POST'));}finally{f.manager.close();}
});

test('leaving during history read and reentering starts one fresh request; an old response cannot replace it',async()=>{
  const old=deferred(),latest=saved('latest'),outdated=saved('outdated');let lists=0;
  const f=setup({jobs:[latest],reentrant:true,api:async(path,options,fallback)=>path.includes('?taskId=')&&++lists===1?old.promise:fallback(path,options)});
  try{f.manager.setActive(true);await tick();f.manager.setActive(false);assert.equal(f.requests[0].options.signal.aborted,true);f.manager.setActive(true);await flush();assert.equal(lists,2);old.resolve({jobs:[outdated]});await flush();assert.match(f.html(),/data-job-id="latest" aria-current="true"/);assert.doesNotMatch(f.html(),/outdated/);assert.equal(f.requests.filter(r=>r.options.method==='POST').length,0);}finally{old.resolve({jobs:[]});f.manager.close();}
});

test('mount switches all controls, clears stale node details, and downloads the selected historical snapshot',async()=>{
  const recent=saved('recent',{}, {status:'completed'}),older=saved('older-en',{conclusionMode:'ai',targetLang:'en',reportLanguage:'zh'},{createdAt:'2026-10-01T08:00:00Z',status:'completed_with_warnings'});
  const f=setup({jobs:[recent,older],reentrant:true,api:async(path,options,fallback)=>path.includes('/nodes/')?{node:{id:'old-node'},input:{secretMarker:'OLD_NODE_DETAILS'},output:{},attempts:[]}:fallback(path,options)});
  try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-node',{dataset:{nodeId:'old-node'}});assert.match(f.html(),/OLD_NODE_DETAILS/);await f.manager.handleAction('business-job-mount',mount(older.id));assert.equal(f.ui.businessConclusionMode,'ai');assert.equal(f.ui.businessTargetLang,'en');assert.equal(f.ui.businessReportLanguage,'zh');assert.doesNotMatch(f.html(),/OLD_NODE_DETAILS/);assert.match(f.html(),/data-job-id="older-en" aria-current="true"/);assert.match(f.html(),/business-retry/);assert.equal(f.requests.filter(r=>r.path.includes('?taskId=')).length,1);await f.manager.handleAction('business-download-html');assert.equal(f.downloads.length,1);assert.match(f.downloads[0][1],/AI初判_英文/);assert.ok(f.requests.every(r=>r.options.method!=='POST'));}finally{f.manager.close();}
});

test('mounting an English historical base never creates derived work, including after leaving an authorized generation',async()=>{
  const generated=saved('generated-en',{targetLang:'en',reportLanguage:'en'}),historical=saved('historical-en',{targetLang:'en',reportLanguage:'en'},{status:'completed'}),mutations=[];
  const translations={get:async()=>{throw Object.assign(new Error('Not found'),{status:404});},list:async()=>({jobs:[]}),create:async input=>{mutations.push(input);throw new Error('Unexpected external work');}};
  const f=setup({jobs:[generated,historical],ui:{...businessUI(),businessTargetLang:'en',businessReportLanguage:'en'},translationClient:translations,api:async(path,options,fallback)=>options.method==='POST'?{job:generated}:fallback(path,options)});
  try{await f.manager.handleAction('business-generate');f.manager.setActive(true);await flush();await f.manager.handleAction('business-job-mount',mount(historical.id));assert.match(f.html(),/business-generate-english/);await f.manager.handleAction('business-download-html');assert.equal(mutations.length,0);generated.status='completed';f.manager.setActive(false);f.manager.setActive(true);await flush();assert.equal(mutations.length,0);assert.equal(f.requests.filter(r=>r.options.method==='POST').length,1);}finally{f.manager.close();}
});

test('server duplicate reuse loads the existing job and reports recovery instead of claiming another run',async()=>{
  const existing=saved('existing',{reportLanguage:'zh'},{status:'completed'});let posts=0;
  const f=setup({jobs:[existing],api:async(path,options,fallback)=>options.method==='POST'?(posts++,{job:{...existing,reused:true}}):fallback(path,options)});
  try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-generate');await f.manager.handleAction('business-generate');assert.equal(posts,2,'each explicit click asks the server to deduplicate its current snapshot');assert.equal(f.ui.businessJobId,'existing');assert.match(f.html(),/相同冻结快照的已有交付/);assert.match(f.html(),/生成 \/ 更新交付/);assert.ok(f.notes.every(row=>!row[0].includes('已开始后台生成')));assert.equal((f.html().match(/data-job-id="existing"/g)||[]).length,1);for(const request of f.requests.filter(r=>r.options.method==='POST'))assert.equal(request.options.body.reportLanguage,'zh');}finally{f.manager.close();}
});

test('late result from a prior mount cannot replace the newly selected historical job',async()=>{
  const a=saved('a'),b=saved('b',{conclusionMode:'ai'}),c=saved('c',{targetLang:'en',reportLanguage:'zh'}),pending=deferred();
  const f=setup({jobs:[a,b,c],api:async(path,options,fallback)=>path==='/api/report-jobs/b/result'?pending.promise:fallback(path,options)});let mounting;
  try{f.manager.setActive(true);await flush();mounting=f.manager.handleAction('business-job-mount',mount('b'));await flush();await f.manager.handleAction('business-job-mount',mount('c'));pending.resolve(result(b));await mounting;assert.equal(f.ui.businessTargetLang,'en');assert.equal(f.ui.businessConclusionMode,'combined');assert.match(f.html(),/data-job-id="c" aria-current="true"/);assert.doesNotMatch(f.html(),/data-job-id="b" aria-current="true"/);await f.manager.handleAction('business-download-html');assert.match(f.downloads[0][1],/人工综合_英文/);}finally{pending.resolve(result(b));await mounting;f.manager.close();}
});

test('a late committed generation response cannot overwrite another selected task and reentry recovers its saved job',async()=>{
  const pending=deferred(),created=saved('committed-report',{}, {resultAvailable:false}),other=saved('other-report',{}, {taskId:'another-task',resultAvailable:false});let committed=false;
  const f=setup({jobs:[],api:async(path,options)=>{
    if(options.method==='POST'){committed=true;return pending.promise;}
    if(path.includes('?taskId='))return{jobs:path.endsWith('another-task')?[other]:committed?[created]:[]};
    throw new Error('Unexpected '+path);
  }});let generating;
  f.state.tasks.push({...f.state.tasks[0],id:other.taskId});f.state.sessions.push({...f.state.sessions[0],id:'other-row',taskId:other.taskId});
  try{f.manager.setActive(true);await flush();generating=f.manager.handleAction('business-generate');await tick();f.manager.handleChange('business-task',other.taskId);await flush();pending.resolve({job:created});await generating;assert.equal(f.ui.businessTaskId,other.taskId);assert.match(f.html(),/data-job-id="other-report" aria-current="true"/);assert.doesNotMatch(f.html(),/committed-report/);assert.equal(f.notes.length,0,'late completion does not show a toast for a different selection');f.manager.handleChange('business-task',created.taskId);await flush();assert.match(f.html(),/data-job-id="committed-report" aria-current="true"/);assert.equal(f.requests.filter(r=>r.options.method==='POST').length,1);}finally{pending.resolve({job:created});await generating;f.manager.close();}
});

test('failed mounting can be retried and never leaves a foreign result downloadable',async()=>{
  const old=saved('old',{}, {status:'completed'}),selected=saved('retry-selected',{conclusionMode:'ai'}, {status:'completed'});let failures=1;
  const f=setup({jobs:[old,selected],api:async(path,options,fallback)=>{if(path==='/api/report-jobs/retry-selected'&&failures-- >0)throw new Error('Saved job unavailable');return fallback(path,options);}});
  try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-job-mount',mount(selected.id));assert.match(f.html(),/Saved job unavailable/);assert.match(f.html(),/data-act="business-download-html" disabled/);assert.doesNotMatch(f.html(),/aria-current="true"/);await f.manager.handleAction('business-job-mount',mount(selected.id));assert.match(f.html(),/data-job-id="retry-selected" aria-current="true"/);assert.doesNotMatch(f.html(),/Saved job unavailable/);assert.equal(f.requests.filter(r=>r.options.method==='POST').length,0);}finally{f.manager.close();}
});

test('history refresh failures remain retryable without discarding the mounted job or selecting another task',async()=>{
  const initial=saved('initial'),newer=saved('newer',{}, {createdAt:'2026-11-07T10:00:00Z'});let lists=0;
  const f=setup({jobs:[initial,newer],api:async(path,options,fallback)=>{if(path.includes('?taskId=')){lists++;if(lists===2)throw new Error('History offline');return{jobs:lists===1?[initial]:[newer,initial]};}return fallback(path,options);}});
  try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-history-refresh');assert.match(f.html(),/History offline/);assert.match(f.html(),/data-job-id="initial" aria-current="true"/);assert.doesNotMatch(f.html(),/data-act="business-history-refresh" disabled/);await f.manager.handleAction('business-history-refresh');assert.doesNotMatch(f.html(),/History offline/);assert.match(f.html(),/data-job-id="newer"/);assert.match(f.html(),/data-job-id="initial" aria-current="true"/);assert.equal(lists,3);}finally{f.manager.close();}
});

test('history is task scoped, bilingual, escaped and discloses real retention without a delete action',()=>{
  const job=saved('saved<bad>',{}, {createdAt:'2026-11-01T12:30:00Z'}),model={historyTaskId:job.taskId,history:[job]};
  const zh=reportHistoryView(model,job.taskId),en=reportHistoryView(model,job.taskId,true);for(const label of ['生成时间','结论口径','翻译语种','报告语言','基础分析状态','自动备份'])assert.ok(zh.includes(label),label);for(const label of ['Created','Conclusion policy','Translation target','Report language','Base status','backup'])assert.ok(en.includes(label),label);assert.match(zh,/saved&lt;bad&gt;/);assert.doesNotMatch(zh,/<bad>|data-act="[^"]*delete/);assert.doesNotMatch(reportHistoryView(model,'other-task'),/saved&lt;bad&gt;/);
});

test('saved normalization audit distinguishes string/number and string/boolean, and displays NFC source validation',()=>{
  const detail={attempts:[{attempt:2,coercion:{version:1,changes:[{field:'cases[0].score',itemId:'row<1>',before:'5',after:5,reasonCode:'numeric_string_to_integer'},{field:'items[1].valid',itemId:'row2',before:'false',after:false,reasonCode:'boolean_string_to_boolean'}]},evidenceValidation:{version:1,matches:[{field:'cases[0].quote',itemId:'row<1>',normalization:'NFC',rawQuote:'Café <literal>'}]}}]};
  const zh=reportNodeAuditView(detail),en=reportNodeAuditView(detail,true);assert.match(zh,/类型归一记录/);assert.match(zh,/&quot;5&quot;/);assert.match(zh,/<code>5<\/code>/);assert.match(zh,/&quot;false&quot;/);assert.match(zh,/<code>false<\/code>/);assert.match(zh,/NFC 引文核验/);assert.match(zh,/row&lt;1&gt;/);assert.match(zh,/Café &lt;literal&gt;/);assert.match(en,/Type normalization records/);assert.match(en,/NFC quote validation/);assert.equal(reportNodeAuditView({attempts:[]}), '');
});
