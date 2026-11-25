import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createAdminDraftStore} from '../server/admin-draft-store.mjs';
import {freezeTranslationSource,translationSource} from '../server/translation-source.mjs';
import {createTranslationJobs} from '../server/translation-jobs.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {rulePreparationFields,sceneDraftFields} from '../public/admin-draft-fields.mjs';
import {createAdminDraftTranslationController,adminDraftDescriptor,adminDraftTranslationPanel,clearAdminDraftTranslations} from '../public/admin-draft-translation.mjs';
import {setLocale} from '../public/i18n.mjs';
import {importDialog} from '../public/import-ui.mjs';
import {createImportManager} from '../public/import-manager.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {validateBackupPath} from '../server/workspace-archive.mjs';

const base=path.resolve('D:/Codex project/outputs/service01123-20261125/admin-draft/tests');
const input={text:'合成原文：回应客户咨询。',scene:'新品产品咨询',sourceName:'synthetic.txt'};
const result={candidates:[{title:'回应客户问题',category:'服务规范',scope:'Todas las consultas',passCriteria:'说明具体处理步骤',failCriteria:'No responde a la consulta',exceptionCriteria:'无需处理时不适用',sourceQuote:'回应客户咨询。',sourceLocator:{start:5,end:12},warnings:['请核对例外范围']}],modelId:'synthetic-draft-model',requestId:'synthetic-request',promptVersion:'synthetic-v1'};
const copy=x=>structuredClone(x),config={baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',authMode:'none',apiKey:'',configured:true};
async function folder(t){await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'case-'));t.after(async()=>{assert.ok(dir.startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});return dir;}
function dialog(saved){return{type:'rule-import',scene:input.scene,prepared:{...copy(saved.result),preparationId:saved.id},candidates:copy(saved.result.candidates)};}
function fakeClient(d,{fail=false,mismatch=false}={}){
 const descriptor=adminDraftDescriptor(d),calls=[],job={id:'translation-job',targetLang:'en',source:descriptor.source,status:fail?'completed_with_warnings':'completed',sourceFingerprint:'a'.repeat(64)};
 let failed=fail;
 const response=()=>({job:{...job,status:failed?'completed_with_warnings':'completed'},sourceFingerprint:job.sourceFingerprint,sourceSnapshot:{source:descriptor.source,fields:mismatch?[]:descriptor.fields},translations:descriptor.fields.map(f=>({...f,sourceText:f.text,text:failed?'':'English '+f.id,status:failed?'failed':'translated'}))});
 return{calls,list:async source=>{calls.push(['list',source]);return{jobs:[]};},create:async request=>{calls.push(['create',request]);return{job:{...job,status:failed?'completed_with_warnings':'completed'}};},result:async()=>response(),get:async()=>({job}),action:async(id,action)=>{calls.push(['action',id,action]);failed=false;job.status='completed';return{job};},complete(){failed=false;}};
}

test('rule preparation records preserve original result and source; failed/empty candidates leave no usable record',async t=>{
 const dir=await folder(t),store=await createAdminDraftStore({dataDir:dir}),before=copy(result),saved=await store.saveRulePreparation(input,result);
 assert.deepEqual(saved.result,before);assert.deepEqual(result,before);assert.deepEqual((await store.get(saved.id)).result,before);
 assert.equal(validateBackupPath('admin-drafts/'+saved.id+'.json'),'admin-drafts/'+saved.id+'.json');
 await assert.rejects(store.saveRulePreparation(input,{...result,candidates:[{...result.candidates[0],sourceQuote:'NOT IN THE SOURCE'}]}));
 assert.equal(await store.saveRulePreparation(input,{candidates:[]}),null);assert.equal((await fs.readdir(path.join(dir,'admin-drafts'))).length,1);
 await store.close();const reopened=await createAdminDraftStore({dataDir:dir});assert.deepEqual(await reopened.get(saved.id),saved);await reopened.close();
});

test('selectors reject arbitrary text, traversal, malformed IDs and stale scene revisions',async t=>{
 const dir=await folder(t),adminDrafts=await createAdminDraftStore({dataDir:dir}),saved=await adminDrafts.saveRulePreparation(input,result),source={kind:'rule-preparation',preparationId:saved.id};t.after(()=>adminDrafts.close());
 for(const bad of [{...source,text:'injected'},{...source,preparationId:'../workspace'},{kind:'scene-draft',draftId:'../../workspace',revision:'1'},{kind:'scene-draft',draftId:'SCD-'+crypto.randomUUID(),revision:'1/../../x'},{kind:'scene-draft',draftId:'SCD-'+crypto.randomUUID(),revision:1}])assert.throws(()=>translationSource(bad));
 const frozen=await freezeTranslationSource({source,adminDrafts});assert.deepEqual(frozen.snapshot.fields,rulePreparationFields(result));assert.doesNotMatch(JSON.stringify(frozen.snapshot),/合成原文|synthetic\.txt|sourceQuote|sourceLocator/);
 const draft={id:'SCD-'+crypto.randomUUID(),revision:2,sceneId:input.scene,preparation:{at:'2026-11-25',source:{source:{sha256:'b'.repeat(64)}},model:{modelId:'synthetic'}},package:{ruleCandidates:result.candidates,unmapped:[{reason:'需人工补充'}],taxonomy:{labels:[{label:'Consulta',definition:'产品问题'}],principles:['Check the source']},exceptions:[{entries:[{condition:'没有客户诉求',source:'DO_NOT_TRANSLATE_AUDIT'}]}],template:{title:'交付报告',columns:[{label:'客户意图',generator:'classification',enum:['咨询','投诉']}],sections:[],columnGroups:[]}}};
 const state={scenePackageDrafts:[draft]},before=copy(state),store={read:async()=>({revision:5,state})};
 await assert.rejects(freezeTranslationSource({source:{kind:'scene-draft',draftId:draft.id,revision:'1'},store}),e=>e.status===409);
 const valid=await freezeTranslationSource({source:{kind:'scene-draft',draftId:draft.id,revision:'2'},store});assert.deepEqual(valid.snapshot.fields,sceneDraftFields(draft));assert.doesNotMatch(JSON.stringify(valid.snapshot.fields),/DO_NOT_TRANSLATE_AUDIT/);assert.deepEqual(state,before);
 const file=path.join(dir,'admin-drafts',saved.id+'.json'),v=JSON.parse(await fs.readFile(file,'utf8'));v.value.result.candidates[0].title='tampered';await fs.writeFile(file,JSON.stringify(v));await assert.rejects(adminDrafts.get(saved.id),e=>e.code==='ADMIN_DRAFT_STORAGE');
});

test('drafts automatically request English even for Spanish/ASCII; preview never rewrites original fields',async()=>{
 clearAdminDraftTranslations();setLocale('en');const saved={id:'RPD-'+crypto.randomUUID(),result},d=dialog(saved),before=copy(d),client=fakeClient(d),controller=createAdminDraftTranslationController({client,autoPoll:false});
 try{
  const pending=adminDraftTranslationPanel(d);assert.match(pending,/English translation pending/);assert.doesNotMatch(pending,/客户|Todas|No responde/);
  await controller.ensure(d);assert.equal(client.calls.filter(c=>c[0]==='create').length,1);const sent=client.calls.find(c=>c[0]==='create')[1];assert.deepEqual(Object.keys(sent).sort(),['jobId','source','targetLang']);assert.deepEqual(sent.source,adminDraftDescriptor(d).source);
  assert.match(adminDraftTranslationPanel(d),/English rules.0.scope/);assert.doesNotMatch(adminDraftTranslationPanel(d),/客户|Todas|No responde/);assert.deepEqual(d,before);
  await controller.ensure(d);assert.equal(client.calls.filter(c=>c[0]==='create').length,1);
  d.candidates[0].scope='人工编辑';assert.match(adminDraftTranslationPanel(d),/unsaved edits/);assert.doesNotMatch(adminDraftTranslationPanel(d),/English rules.0.scope|人工编辑/);
 }finally{controller.stop();setLocale('zh');clearAdminDraftTranslations();}
});

test('program-assigned candidate metadata does not block automatic translation; changing the source invalidates the preview',async()=>{
 const prepared={...copy(result),preparationId:'RPD-'+crypto.randomUUID()};prepared.candidates[0].category='Modelo nuevo';
 const d={type:'rule-import',mode:'text',scene:input.scene,sourceText:input.text,sourceName:input.sourceName},catalog=createCatalog();
 const manager=createImportManager({getDialog:()=>d,getState:()=>({}),getCatalog:()=>catalog,prepareRules:async()=>prepared,renderDialog(){},toast(){}});
 await manager.action('rule-import-prepare');assert.equal(d.candidates[0].category,'');assert.equal(adminDraftDescriptor(d).dirty,false);
 const client=fakeClient(d),controller=createAdminDraftTranslationController({client,autoPoll:false});setLocale('en');clearAdminDraftTranslations();
 try{await controller.ensure(d);assert.equal(client.calls.filter(c=>c[0]==='create').length,1);assert.match(adminDraftTranslationPanel(d),/English display translations loaded/);
  manager.input({target:{id:'rule-import-text',dataset:{},value:'Replacement source',type:'text'}});assert.equal(adminDraftDescriptor(d),null);assert.equal(d.prepared,null);assert.deepEqual(d.candidates,[]);
 }finally{controller.stop();setLocale('zh');clearAdminDraftTranslations();}
});

test('draft failures expose English retry; mismatched snapshots cannot populate the display cache',async()=>{
 clearAdminDraftTranslations();setLocale('en');const d=dialog({id:'RPD-'+crypto.randomUUID(),result}),client=fakeClient(d,{fail:true}),controller=createAdminDraftTranslationController({client,autoPoll:false});
 try{
  await controller.ensure(d);assert.match(adminDraftTranslationPanel(d),/Translation unavailable/);assert.match(adminDraftTranslationPanel(d),/admin-draft-translation-retry/);assert.doesNotMatch(adminDraftTranslationPanel(d),/客户|Todas/);
  client.complete();await controller.ensure(d,{retry:true});assert.match(adminDraftTranslationPanel(d),/English display translations loaded/);
  clearAdminDraftTranslations();const wrong=createAdminDraftTranslationController({client:fakeClient(d,{mismatch:true}),autoPoll:false});await wrong.ensure(d);assert.match(adminDraftTranslationPanel(d),/Translation unavailable/);assert.doesNotMatch(adminDraftTranslationPanel(d),/English rules.0/);wrong.stop();
 }finally{controller.stop();setLocale('zh');clearAdminDraftTranslations();}
});

test('English rule editor keeps original model fields in a closed audit with leaf-only original markers',()=>{
 const d={...dialog({id:'RPD-'+crypto.randomUUID(),result}),sourceText:input.text,sourceName:input.sourceName},before=copy(d);setLocale('en');
 try{const html=importDialog(d,{scenarios:[]},{rules:[],policies:[]});assert.match(html,/data-admin-draft-preview/);assert.match(html,/<details[^>]*data-dialog-disclosure="admin-draft-original"[^>]*><summary>Original AI draft/);assert.doesNotMatch(html,/<details[^>]*data-dialog-disclosure="admin-draft-original"[^>]*\bopen\b/);assert.doesNotMatch(html,/<div data-business-original>/);assert.match(html,/value="回应客户问题"/);assert.deepEqual(d,before);}finally{setLocale('zh');}
});

test('persistent translation jobs restore after restart without a second model call and leave original candidates unchanged',async t=>{
 const dir=await folder(t),adminDrafts=await createAdminDraftStore({dataDir:dir}),saved=await adminDrafts.saveRulePreparation(input,result),source={kind:'rule-preparation',preparationId:saved.id};let calls=0;
 const options={dataDir:dir,adminDrafts,store:{read:async()=>({revision:0,state:{},catalog:{}})},modelConfig:{getPrivate:()=>config},client:{engine:'synthetic',async enrichBusinessReport({input}){calls++;return{items:input.items.map(i=>({id:i.id,translation:'English synthetic wording '+i.id,isTargetLanguage:false,detectedLanguage:/[\u3400-\u9fff]/.test(i.text)?'zh':'es'}))};}},maxAttempts:1};
 let jobs=await createTranslationJobs(options);t.after(async()=>{await jobs.close();await adminDrafts.close();});await jobs.create({jobId:'draft-one',source,targetLang:'en'});await jobs.waitForIdle();assert.equal((await jobs.get('draft-one')).status,'completed');const count=calls;assert.ok(count>0);const first=await jobs.getResult('draft-one');await jobs.close();jobs=await createTranslationJobs(options);
 const api={list:async s=>({jobs:await jobs.list(s)}),get:async id=>({job:await jobs.get(id)}),result:id=>jobs.getResult(id),create:async request=>({job:await jobs.create(request)})};
 clearAdminDraftTranslations();setLocale('en');const d=dialog(saved),before=copy(d),controller=createAdminDraftTranslationController({client:api,autoPoll:false});
 try{await controller.ensure(d);assert.match(adminDraftTranslationPanel(d),/English display translations loaded/);assert.equal(calls,count);assert.deepEqual(d,before);assert.deepEqual((await adminDrafts.get(saved.id)).result,result);assert.deepEqual(await jobs.getResult('draft-one'),first);}finally{controller.stop();clearAdminDraftTranslations();setLocale('zh');}
});

test('HTTP rule prepare returns only a server-created source ID and rejects invalid candidates without recording them',async t=>{
 const dir=await folder(t);let bad=false,preparations=0;
 const app=await createWorkbenchServer({dataDir:dir,catalogSeed:null,modelConfig:{getPrivate:()=>config,publicConfig:()=>({configured:true,model:'synthetic'})},arkClient:{async prepareRules(){preparations++;return bad?{candidates:[{title:'malformed'}]}:copy(result);}}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));
 const origin='http://127.0.0.1:'+app.address().port,workspace=await(await fetch(origin+'/api/workspace')).json(),headers={Origin:origin,'Content-Type':'application/json','X-Workspace-Token':workspace.token};
 const post=async(url,body)=>{const response=await fetch(origin+url,{method:'POST',headers,body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
 const ok=await post('/api/rules/prepare',input);assert.equal(ok.status,200,JSON.stringify(ok.body));assert.match(ok.body.preparationId,/^RPD-/);assert.deepEqual(ok.body.candidates,result.candidates);assert.equal((await(await fetch(origin+'/api/workspace')).json()).revision,workspace.revision);
 const forged=await post('/api/translation-jobs',{jobId:'forged',targetLang:'en',source:{kind:'rule-preparation',preparationId:ok.body.preparationId,text:'client override'}});assert.equal(forged.status,400);
 bad=true;assert.equal((await post('/api/rules/prepare',input)).status,502);assert.equal((await fs.readdir(path.join(dir,'admin-drafts'))).length,1);assert.equal(preparations,2);
});

test('scene draft automatically translates all three parts, retries the same persisted job, and requires new saved revisions after edits',async t=>{
 const dir=await folder(t),draft={id:'SCD-'+crypto.randomUUID(),revision:1,preparation:{at:'2026-11-25',model:{modelId:'synthetic'}},package:{ruleCandidates:result.candidates,unmapped:[{reason:'需核对来源'}],taxonomy:{labels:[{label:'Consulta',definition:'客户咨询'}],principles:['Seguir la fuente']},exceptions:[{entries:[{condition:'没有诉求时不检核'}]}],template:{title:'Informe de calidad',sections:[{title:'概况'}],columnGroups:[{label:'Detalle'}],columns:[{label:'结论',generator:'rule'}]}}};
 const original=copy(draft),store={read:async()=>({state:{scenePackageDrafts:[draft]},revision:0})};let fail=true,creates=0,calls=0;const actions=[];
 const jobs=await createTranslationJobs({dataDir:dir,store,modelConfig:{getPrivate:()=>config},maxAttempts:1,client:{engine:'synthetic',async enrichBusinessReport({input}){calls++;if(fail)throw Object.assign(new Error('synthetic failure'),{code:'PROVIDER_ERROR'});return{items:input.items.map(i=>({id:i.id,translation:'English scene '+i.id,isTargetLanguage:false,detectedLanguage:/[\u3400-\u9fff]/.test(i.text)?'zh':'es'}))};}}});
 t.after(()=>jobs.close());
 const api={list:async s=>({jobs:await jobs.list(s)}),get:async id=>({job:await jobs.get(id)}),result:id=>jobs.getResult(id),create:async request=>{creates++;await jobs.create(request);await jobs.waitForIdle();return{job:await jobs.get(request.jobId)};},action:async(id,action)=>{actions.push([id,action]);await jobs[action](id);await jobs.waitForIdle();return{job:await jobs.get(id)};}};
 const d={type:'scfg-edit',draft:copy(draft),package:copy(draft.package),tab:'rules',dirty:false},controller=createAdminDraftTranslationController({client:api,autoPoll:false});setLocale('en');clearAdminDraftTranslations();
 try{
  await controller.ensure(d);assert.match(adminDraftTranslationPanel(d),/Translation unavailable/);assert.equal(creates,1);
  fail=false;await controller.ensure(d,{retry:true});assert.equal(creates,1);assert.equal(actions.length,1);assert.equal(actions[0][1],'retry');assert.ok(calls>1);assert.match(adminDraftTranslationPanel(d),/English scene/);
  for(const tab of ['rules','auxiliary','delivery']){d.tab=tab;assert.match(adminDraftTranslationPanel(d),/English scene/);assert.doesNotMatch(adminDraftTranslationPanel(d),/客户|Consulta|Informe|Seguir/);}
  assert.deepEqual(draft,original);d.dirty=true;d.package.template.title='Nuevo informe';const beforeCalls=calls;await controller.ensure(d);assert.equal(calls,beforeCalls);assert.match(adminDraftTranslationPanel(d),/unsaved edits/);
  draft.revision++;draft.package=copy(d.package);d.draft=copy(draft);d.dirty=false;await controller.ensure(d);assert.equal(creates,2);assert.match(adminDraftTranslationPanel(d),/English scene/);
 }finally{controller.stop();setLocale('zh');clearAdminDraftTranslations();}
});
