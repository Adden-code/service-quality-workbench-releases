import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessExportManager} from '../public/business-export-manager.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';
import {reportFixture,managerState,businessUI,summaryFixture} from './business-report-fixtures.mjs';
import {getLocale,setLocale} from '../public/i18n.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const flush=async()=>{for(let index=0;index<8;index++)await tick();};
function setup({failCreate=false,derivedStatus='completed',baseStatus='completed'}={}){
 const {snapshot,enrichment}=reportFixture();snapshot.targetLang='en';const state=managerState(),ui={...businessUI(),businessTargetLang:'en',businessReportLanguage:'en'},calls=[],downloads=[],built=[],notes=[];
 const base=summaryFixture({status:baseStatus,options:{conclusionMode:'combined',targetLang:'en'},warningsCount:0,progress:{total:2,done:2,failed:0,pending:0,running:0,percent:100}});
 let derived=null,createFailure=failCreate;
 const client={
  async create(input){calls.push(['create',input]);if(createFailure){createFailure=false;throw new Error('temporary unavailable');}derived={id:input.jobId,status:derivedStatus,source:input.source,targetLang:input.targetLang,progress:{total:2,done:1,failed:derivedStatus==='completed_with_warnings'?1:0,pending:0,running:0,percent:50},warningsCount:0,resultAvailable:true};return{job:derived};},
  async get(id){calls.push(['get',id]);if(!derived||derived.id!==id)throw Object.assign(new Error('not found'),{status:404});return{job:derived};},
  async result(id){calls.push(['result',id]);return{job:derived,sourceFingerprint:'report-source-fingerprint',sourceSnapshot:{source:derived.source,fields:collectReportTranslationFields(snapshot,enrichment),data:{report:{jobId:base.id,snapshotFingerprint:base.snapshotFingerprint}}},translations:collectReportTranslationFields(snapshot,enrichment).map(field=>({id:field.id,sourceText:field.text,text:`English ${field.id}`,status:'translated'})),warnings:[]};},
  async list(){return{jobs:derived?[derived]:[]};},
  async action(id,action){calls.push(['action',id,action]);derived={...derived,status:action==='pause'?'paused':action==='resume'?'running':'completed',warningsCount:0};return{job:derived};},
 };
 const manager=createBusinessExportManager({api:async(path,options={})=>{calls.push(['base',path,options]);return path.includes('?taskId=')?{jobs:[base]}:path.endsWith('/result')?{snapshot,enrichment,job:base}:{job:base};},translationClient:client,getState:()=>state,getUI:()=>ui,onRender:()=>{},download:(...args)=>downloads.push(args),notify:(...args)=>notes.push(args),buildXlsx:async(s,r,o)=>{built.push([s,r,o]);return new Uint8Array([80,75]);},createSnapshot:()=>snapshot,pollMs:100000});
 return{manager,snapshot,enrichment,base,ui,state,calls,downloads,built,notes,client};
}

test('explicit English generation reuses the completed base and shares exact source/map across downloads',async()=>{
 const f=setup();try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-generate-english');assert.equal(f.calls.filter(row=>row[0]==='create').length,1);assert.deepEqual(f.calls.find(row=>row[0]==='create')[1].source,{kind:'report',jobId:f.base.id});
 await f.manager.handleAction('business-download-xlsx');await f.manager.handleAction('business-download-html');assert.equal(f.downloads.length,2);assert.equal(f.built[0][0],f.snapshot);assert.equal(f.built[0][1],f.enrichment);assert.equal(f.built[0][2].language,'en');assert.ok(f.built[0][2].translationJob.id);assert.ok(f.downloads[1][0].includes(f.built[0][2].translationJob.id));assert.ok(f.downloads[1][0].includes('English record.case-bad.summary'));
 }finally{f.manager.close();}
});

test('base running never sends a report-source translation request',async()=>{const f=setup({baseStatus:'running'});try{f.manager.setActive(true);await flush();assert.equal(f.calls.filter(row=>row[0]==='create').length,0);await f.manager.handleAction('business-download-html');assert.ok(f.downloads[0][0].includes('not finished'));}finally{f.manager.close();}});

test('derived creation failure remains downloadable with explicit warning and retry recovers the same request ID',async()=>{
 const f=setup({failCreate:true});try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-generate-english');const first=f.calls.find(row=>row[0]==='create')?.[1];assert.ok(first);assert.match(f.manager.view(f.state,f.ui),/temporary unavailable/);await f.manager.handleAction('business-download-html');assert.ok(f.downloads[0][0].includes('Translation missing'));await f.manager.handleAction('business-retry',{dataset:{stage:'report'}});assert.equal(f.calls.filter(row=>row[0]==='create').length,2);assert.equal(f.calls.filter(row=>row[0]==='create')[1][1].jobId,first.jobId);await f.manager.handleAction('business-download-xlsx');assert.equal(f.built[0][2].translationJob.status,'completed');}finally{f.manager.close();}
});

test('derived pause/resume/retry controls route to translation jobs independently of base report controls',async()=>{
 const f=setup({derivedStatus:'running'});try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-generate-english');for(const action of ['pause','resume','retry'])await f.manager.handleAction(`business-${action}`,{dataset:{stage:'report'}});assert.deepEqual(f.calls.filter(row=>row[0]==='action').map(row=>row[2]),['pause','resume','retry']);assert.ok(!f.calls.some(row=>row[0]==='base'&&/\/(pause|resume|retry)$/.test(row[1])));}finally{f.manager.close();}
});

test('report language is independent, preserves explicit choice and synchronizes original translation target on selection',()=>{
 const f=setup();try{assert.ok(f.manager.view(f.state,f.ui).includes('business-report-language'));assert.equal(f.manager.handleChange('business-report-language','zh'),true);assert.equal(f.ui.businessReportLanguage,'zh');assert.equal(f.ui.businessTargetLang,'zh');assert.equal(f.manager.handleChange('business-report-language','en'),true);assert.equal(f.ui.businessReportLanguage,'en');assert.equal(f.ui.businessTargetLang,'en');}finally{f.manager.close();}
});

test('English export view localizes controls and dynamic counts while task names and form values remain Original',async()=>{
 const previous=getLocale();setLocale('en');const f=setup();try{f.manager.setActive(true);await flush();const html=f.manager.view(f.state,f.ui);for(const label of ['Business deliverables','Report language','Original text translation target','English report content translation','Combined business deliverable progress'])assert.ok(html.includes(label),label);assert.ok(html.includes(f.state.tasks[0].name));assert.ok(html.includes('value="combined"'));assert.ok(!html.includes('最终结论口径'));await f.manager.handleAction('business-download-html');assert.ok(f.notes.some(row=>String(row[0]).includes('Downloaded')));}finally{f.manager.close();setLocale(previous);}
});

test('legacy target language remains independent from report language and default report follows UI until explicitly selected',()=>{
 const previous=getLocale();setLocale('zh');const state=managerState(),ui={...businessUI(),businessTargetLang:'en'},manager=createBusinessExportManager({api:async()=>({jobs:[]}),getState:()=>state,getUI:()=>ui,download:()=>{}});try{manager.view(state,ui);assert.equal(ui.businessTargetLang,'en');assert.equal(ui.businessReportLanguage,'zh');setLocale('en');manager.view(state,ui);assert.equal(ui.businessReportLanguage,'en');manager.handleChange('business-report-language','zh');setLocale('zh');setLocale('en');manager.view(state,ui);assert.equal(ui.businessReportLanguage,'zh');}finally{manager.close();setLocale(previous);}
});

test('source changes reject a saved derived result and manual retry creates a new source-bound view',async()=>{
 const f=setup(),result=f.client.result;let stale=true;f.client.result=async id=>{const value=await result(id);if(stale)value.sourceSnapshot.fields[0]={...value.sourceSnapshot.fields[0],text:'OUTDATED SOURCE'};return value;};
 try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-generate-english');const first=f.calls.find(row=>row[0]==='create')[1].jobId;assert.ok(f.manager.view(f.state,f.ui).includes('source has changed'));await f.manager.handleAction('business-download-xlsx');assert.equal(f.built[0][2].translations.length,0);stale=false;await f.manager.handleAction('business-retry',{dataset:{stage:'report'}});assert.notEqual(f.calls.filter(row=>row[0]==='create').at(-1)[1].jobId,first);await f.manager.handleAction('business-download-xlsx');assert.ok(f.built[1][2].translations.length);}finally{f.manager.close();}
});

test('default translation client runs through authenticated api with no fetch/document browser stubs',async()=>{
 const f=setup(),fetchDescriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');let created;
 const manager=createBusinessExportManager({api:async(path,options={})=>{if(path.startsWith('/api/report-jobs'))return path.includes('?taskId=')?{jobs:[f.base]}:path.endsWith('/result')?{snapshot:f.snapshot,enrichment:f.enrichment,job:f.base}:{job:f.base};if(path==='/api/translation-jobs'&&options.method==='POST'){created={id:options.body.jobId,status:'completed',source:options.body.source,targetLang:'en',progress:{total:0,done:0,percent:100},resultAvailable:true};return{job:created};}if(!created)throw Object.assign(new Error('not found'),{status:404});if(path.endsWith('/result'))return{job:created,sourceSnapshot:{source:created.source,fields:collectReportTranslationFields(f.snapshot,f.enrichment)},translations:[]};return{job:created};},getState:()=>f.state,getUI:()=>f.ui,download:()=>{},createSnapshot:()=>f.snapshot,pollMs:100000});
 try{delete globalThis.fetch;manager.setActive(true);await flush();await manager.handleAction('business-generate-english');assert.ok(created);assert.ok(manager.view(f.state,f.ui).includes(created.id));}finally{manager.close();f.manager.close();if(fetchDescriptor)Object.defineProperty(globalThis,'fetch',fetchDescriptor);}
});

test('opening exports, locale changes and downloads never create a missing English report translation job',async()=>{
 const f=setup(),previous=getLocale();try{f.manager.setActive(true);await flush();assert.equal(f.calls.filter(row=>row[0]==='create').length,0);setLocale('en');f.manager.view(f.state,f.ui);f.manager.setActive(true);await flush();assert.equal(f.calls.filter(row=>row[0]==='create').length,0);await f.manager.handleAction('business-download-html');assert.equal(f.calls.filter(row=>row[0]==='create').length,0);assert.ok(f.manager.view(f.state,f.ui).includes('Generate English view'));await f.manager.handleAction('business-generate-english');assert.equal(f.calls.filter(row=>row[0]==='create').length,1);}finally{f.manager.close();setLocale(previous);}
});

test('an explicit English base generation authorizes its automatic second stage when the base later completes',async()=>{
 const f=setup({baseStatus:'running'});try{await f.manager.handleAction('business-generate');assert.equal(f.calls.filter(row=>row[0]==='create').length,0);f.base.status='completed';f.base.updatedAt='2026-11-05T12:00:00+08:00';f.manager.setActive(true);await flush();assert.equal(f.calls.filter(row=>row[0]==='create').length,1);}finally{f.manager.close();}
});

test('reopening a previously generated English view restores it with GETs and no further model job mutations',async()=>{
 const f=setup();let restored;try{f.manager.setActive(true);await flush();await f.manager.handleAction('business-generate-english');f.manager.close();const before=f.calls.filter(row=>row[0]==='create').length;restored=createBusinessExportManager({api:async path=>path.includes('?taskId=')?{jobs:[f.base]}:path.endsWith('/result')?{snapshot:f.snapshot,enrichment:f.enrichment,job:f.base}:{job:f.base},translationClient:f.client,getState:()=>f.state,getUI:()=>f.ui,download:()=>{},createSnapshot:()=>f.snapshot,pollMs:100000});restored.setActive(true);await flush();assert.equal(f.calls.filter(row=>row[0]==='create').length,before);assert.ok(restored.view(f.state,f.ui).includes(f.calls.find(row=>row[0]==='create')[1].jobId));}finally{restored?.close();f.manager.close();}
});

test('read-only recovery also finds a saved derived job whose ID changed after a prior configuration conflict',async()=>{
 const f=setup();try{await f.client.create({jobId:'report-en-prior-config-recovery',source:{kind:'report',jobId:f.base.id},targetLang:'en'});const before=f.calls.filter(row=>row[0]==='create').length;f.manager.setActive(true);await flush();assert.equal(f.calls.filter(row=>row[0]==='create').length,before);assert.ok(f.manager.view(f.state,f.ui).includes('report-en-prior-config-recovery'));}finally{f.manager.close();}
});

test('navigation interrupts a derived GET without retaining busy or clearing a newer request owner',async()=>{
 const previous=getLocale();setLocale('en');const f=setup(),get=f.client.get;let releaseOld,releaseNew,gets=0;const oldPending=new Promise(resolve=>releaseOld=resolve),newPending=new Promise(resolve=>releaseNew=resolve);
 f.client.get=async id=>{gets++;if(gets===1)await oldPending;else if(gets===2)await newPending;return get(id);};
 try{f.manager.setActive(true);await flush();assert.equal(gets,1);f.manager.setActive(false);f.manager.setActive(true);await flush();assert.equal(gets,2);releaseOld();await flush();assert.ok(/data-act="business-generate-english" disabled/.test(f.manager.view(f.state,f.ui)),'old request must not clear the new owner');releaseNew();await flush();assert.ok(!/data-act="business-generate-english" disabled/.test(f.manager.view(f.state,f.ui)));await f.manager.handleAction('business-generate-english');assert.equal(f.calls.filter(row=>row[0]==='create').length,1);await f.manager.handleAction('business-download-html');assert.equal(f.downloads.length,1);}finally{releaseOld();releaseNew();f.manager.close();setLocale(previous);}
});

test('navigation during a committed derived POST recovers the exact durable job without duplicate creation',async()=>{
 const previous=getLocale();setLocale('en');const f=setup(),create=f.client.create;let release;const pending=new Promise(resolve=>release=resolve);f.client.create=async input=>{const answer=await create(input);await pending;return answer;};let generating;
 try{f.manager.setActive(true);await flush();generating=f.manager.handleAction('business-generate-english');await flush();const input=f.calls.find(row=>row[0]==='create')[1];f.manager.setActive(false);f.manager.setActive(true);await flush();assert.ok(f.manager.view(f.state,f.ui).includes(input.jobId));assert.equal(f.calls.filter(row=>row[0]==='create').length,1);release();await generating;await f.manager.handleAction('business-download-html');assert.equal(f.downloads.length,1);assert.ok(f.downloads[0][0].includes(input.jobId));}finally{release();await generating;f.manager.close();setLocale(previous);}
});

test('default report-language changes clear an interrupted derived request before the English selection returns',async()=>{
 const previous=getLocale();setLocale('en');const f=setup(),get=f.client.get;delete f.ui.businessReportLanguage;let release,gets=0;const pending=new Promise(resolve=>release=resolve);f.client.get=async id=>{gets++;if(gets===1)await pending;return get(id);};
 try{f.manager.setActive(true);await flush();assert.equal(gets,1);setLocale('zh');f.manager.view(f.state,f.ui);f.manager.setActive(true);await flush();release();await flush();setLocale('en');f.manager.view(f.state,f.ui);f.manager.setActive(true);await flush();assert.ok(gets>=2);await f.manager.handleAction('business-generate-english');assert.equal(f.calls.filter(row=>row[0]==='create').length,1);}finally{release();f.manager.close();setLocale(previous);}
});
