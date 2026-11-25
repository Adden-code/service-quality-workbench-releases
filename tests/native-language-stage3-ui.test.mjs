import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture} from './native-language-stage2-fixture.mjs';
import {nativeDisplayProjection} from '../server/native-delivery.mjs';
import {nativeAssurance} from '../server/native-language-execution.mjs';
import {setLocale,getLocale} from '../public/i18n.mjs';
import {applyBusinessTranslations,clearBusinessTranslations,ruleDisplayName} from '../public/content-translation-ui.mjs';
import {applyNativeReviewMaterial,clearNativeReviewMaterials,createNativeReviewMaterialController,getReviewTaskBasis,nativeReviewMaterial,resolveReviewTaskReference} from '../public/native-review-language.mjs';
import {reasonContent,reasonText,reasonTranslationNotice,createReasonTranslationController,clearReasonTranslations} from '../public/reason-translation.mjs';
import {sessionDisplayFields} from '../public/session-display-fields.mjs';
import {rawReviewView} from '../public/raw-review-view.mjs';
import {manualResultCard} from '../public/business-review.mjs';
import {sceneReviewEvidence} from '../public/scene-review-view.mjs';
import {taskHistoryView} from '../public/task-history-view.mjs';
import {businessDialog} from '../public/business-dialogs.mjs';
import {languageAcceptanceScreen} from '../public/workspace-language-ui.mjs';
import {nativePolicy} from './native-language-fixture.mjs';

function reviewFixture(language='en'){
 const f=fixture(language),text='Customer: هل توجد نسخة زرقاء؟\nAgent: Sí, existe una versión azul.';
 Object.assign(f.task,{mode:'manual',name:'Synthetic native review',status:'待审核',inputMode:'raw-transcript-v1',source:{name:'synthetic.xlsx'}});
 const reason=language==='en'?'The agent provides the information requested by the customer.':'坐席提供了用户所询问的具体信息。';
 const result={ruleId:'NP-SYNTHETIC',verdict:'符合',reason,confidence:0.96,evidence:[],evidenceQuotes:[],referenceIds:[],conflictsWith:[]};result.languageValidation=nativeAssurance(result,f.context);
 Object.assign(f.session,{taskId:f.task.id,externalId:'SOURCE-1',expectedRuleIds:['NP-SYNTHETIC'],agent:'Synthetic agent',rawTranscript:{schemaVersion:1,text,row:2,timePolicy:{mode:'unavailable',timezone:'+08:00'},textSha256:createHash('sha256').update(text).digest('hex')},turns:[],aiExecution:{status:'completed',runId:'SYNTHETIC-RUN'},aiDecision:{status:'UNCERTAIN',reasonCodes:[]},aiResults:[result],review:{status:'待审核',reviewer:'Synthetic operator',drafts:{},notes:'',history:[]}});
 const quote='Sí, existe una versión azul.',start=text.indexOf(quote);result.evidenceQuotes=[{quote,matches:[{start,end:start+quote.length}]}];result.turnRefs=[];result.rawValidation={schemaVersion:1,status:'verified',textSha256:f.session.rawTranscript.textSha256,reasonCodes:[]};
 f.state={tasks:[f.task],sessions:[f.session]};f.ui={openRules:['NP-SYNTHETIC'],rawSelectedSession:f.session.id,rawResultFilter:'全部规则',rawActiveRule:'NP-SYNTHETIC',historySessionFilter:f.session.id};f.material=nativeDisplayProjection(f.task,f.frozen);return f;
}
test.beforeEach(()=>{setLocale('en',{storage:null});clearReasonTranslations();clearBusinessTranslations();clearNativeReviewMaterials();});
test.afterEach(()=>setLocale('zh',{storage:null}));

test('native English and Chinese prose bypass all display translations and preserve original sources',async()=>{
 for(const language of ['en','zh']){
  const f=reviewFixture(language),before=JSON.stringify(f.state),result=f.session.aiResults[0];setLocale(language==='en'?'zh':'en',{storage:null});
  const calls=[];const controller=createReasonTranslationController({client:new Proxy({},{get:(_,key)=>async()=>{calls.push(key);throw new Error('Unexpected translation request');}}),autoPoll:false});
  applyBusinessTranslations({translations:[{sourceText:result.reason,text:'A cached translation must never replace native prose.',status:'translated'}]});
  await controller.ensure(f.session,{task:f.task,lang:language==='en'?'zh':'en'});
  assert.deepEqual(calls,[]);assert.equal(reasonText(result.reason,getLocale(),{task:f.task,result}),result.reason);
  const html=reasonContent(result.reason,{task:f.task,result});assert.match(html,/data-reason-status="native"/);assert.ok(html.includes(result.reason));assert.doesNotMatch(html,/Translation pending|cached translation/);
  assert.equal(JSON.stringify(f.state),before);controller.stop();
 }
});

test('wrong native language has a localized notice, escaped original audit and an explicit retry',async()=>{
 const f=reviewFixture(),result=f.session.aiResults[0];result.reason='El agente no explica los siguientes pasos. <script>bad()</script>';result.languageValidation=nativeAssurance(result,f.context);
 const html=reasonContent(result.reason,{task:f.task,result});assert.match(html,/AI output language needs review/);assert.match(html,/<details[^>]*>[\s\S]*&lt;script&gt;bad/);assert.doesNotMatch(html,/<script>|Translation pending/);
 assert.match(reasonTranslationNotice(f.session,f.task),/data-act="native-language-retry"/);
 f.session.review.drafts.R={reason:'A human note'};assert.doesNotMatch(reasonTranslationNotice(f.session,f.task),/native-language-retry/);
});

test('display material is task and hash bound, read-only, and never falls back to live catalog text',async()=>{
 const f=reviewFixture(),before=JSON.stringify(f.state),wrong={...f.material,materialRef:'0'.repeat(64)};
 assert.throws(()=>applyNativeReviewMaterial(f.task,wrong),/does not match/);
 assert.match(getReviewTaskBasis(f.state,f.task).rules[0].title,/Frozen material unavailable/);
 let calls=0;const controller=createNativeReviewMaterialController({api:async url=>{calls++;assert.equal(url,`/api/tasks/${f.task.id}/native-material`);return{material:f.material};}});
 await Promise.all([controller.ensure(f.task),controller.ensure(f.task)]);await controller.ensure(f.task);assert.equal(calls,1);
 const projected=getReviewTaskBasis(f.state,f.task);assert.equal(projected.rules[0].title,f.material.rules[0].title);assert.equal(projected.rules[0].passCriteria,f.material.rules[0].passCriteria);assert.equal(ruleDisplayName(projected.rules[0]),f.material.rules[0].title);
 const ref=resolveReviewTaskReference(f.state,f.session,'source');assert.equal(ref.section.text,f.material.policies[0].sections[0].text);
 assert.equal(JSON.stringify(f.state),before);const other={...f.task,id:'OTHER'};assert.equal(nativeReviewMaterial(other),undefined);controller.stop();
});

test('raw, structured, historical and rule drawers show the task frozen native text',()=>{
 const f=reviewFixture();applyNativeReviewMaterial(f.task,f.material);const before=JSON.stringify(f.state);
 const raw=rawReviewView(f.state,f.ui,{session:f.session,queue:[f.session]});assert.ok(raw.includes(f.session.aiResults[0].reason));assert.ok(raw.includes(f.material.rules[0].title));assert.ok(raw.includes(f.material.rules[0].passCriteria));assert.match(raw,/هل توجد نسخة زرقاء/);assert.match(raw,/Sí, existe una versión azul/);assert.doesNotMatch(raw,/Translation pending|Original · English missing/);
 const card=manualResultCard(f.state,f.session,f.session.aiResults[0],f.ui,false);assert.ok(card.includes(f.session.aiResults[0].reason));assert.ok(card.includes(f.material.rules[0].title));
 const history=taskHistoryView(f.state,f.task,f.ui);assert.ok(history.includes(f.session.aiResults[0].reason));assert.doesNotMatch(history,/Translation pending/);
 const drawer=businessDialog({type:'rule',id:'NP-SYNTHETIC'},f.state,{selectedId:f.session.id}).body;assert.ok(drawer.includes(f.material.rules[0].failCriteria));assert.doesNotMatch(drawer,/Original · English missing/);assert.equal(JSON.stringify(f.state),before);
});

test('auxiliary native prose displays directly and mismatches retain an original audit',()=>{
 const f=reviewFixture(),value={status:'completed',reason:'The customer asks for specific product information.',value:{text:'The customer requests information about the product.'}};
 value.languageValidation=nativeAssurance(value,f.context,{capability:'demandSummary'});f.session.sceneCapabilities={outputs:{demandSummary:value}};
 let html=sceneReviewEvidence(f.session,'NP-SYNTHETIC',undefined,f.task);assert.ok(html.includes(value.reason));assert.ok(html.includes(value.value.text));assert.doesNotMatch(html,/Translation pending/);
 value.value.text='El cliente pregunta por el producto.';value.languageValidation=nativeAssurance(value,f.context,{capability:'demandSummary'});html=sceneReviewEvidence(f.session,'NP-SYNTHETIC',undefined,f.task);assert.match(html,/AI output language needs review/);assert.match(html,/<details[^>]*>[\s\S]*El cliente/);
});

test('stage 3 opens native UI only after selection and always restores the locked locale',()=>{
 const state={workspaceSettings:{languagePolicy:nativePolicy('en')}};setLocale('zh',{storage:null});assert.equal(languageAcceptanceScreen(state,{stage:3}),null);assert.equal(getLocale(),'en');assert.match(languageAcceptanceScreen(state,{stage:2}),/data-language-stage="1"/);
 const pending={workspaceSettings:{languagePolicy:{mode:'pending-selection'}}};assert.match(languageAcceptanceScreen(pending,{stage:3}),/Choose workspace language/);
});

function savedApi(session,{status='paused',stopReason='interrupted',completeOnAction=true}={}){
 const fields=sessionDisplayFields(session),source={kind:'session-display',taskId:session.taskId,sessionId:session.id},actions=[];let job={id:'SAVED-REASON',source,targetLang:'en',status,stopReason};
 const result=()=>({job,sourceSnapshot:{fields},translations:fields.map(f=>({id:f.id,sourceText:f.text,text:job.status==='completed'?'The agent provides the requested information.':'',status:job.status==='completed'?'translated':'pending'}))});
 return{actions,client:{list:async()=>({jobs:[job]}),get:async()=>({job}),result:async()=>result(),create:async()=>{throw new Error('Saved job must be reused');},action:async(id,name)=>{actions.push(name);job={...job,status:completeOnAction?'completed':'completed_with_warnings',stopReason:undefined};return{job};}}};
}
test('legacy interrupted jobs resume automatically after reconstruction; explicit user pause stays paused',async()=>{
 const row={id:'LEGACY-1',taskId:'LEGACY-TASK',aiResults:[{ruleId:'R',reason:'客服提供信息。'}]};
 for(const stopReason of ['interrupted','user_paused']){clearReasonTranslations();const api=savedApi(row,{stopReason}),controller=createReasonTranslationController({client:api.client,autoPoll:false});await controller.ensure(row,{lang:'en'});await controller.ensure(row,{lang:'en'});assert.deepEqual(api.actions,stopReason==='interrupted'?['resume']:[]);controller.stop();}
});
test('legacy missing translations retry once and background restoration remains serial',async()=>{
 const row={id:'LEGACY-2',taskId:'LEGACY-TASK',aiResults:[{ruleId:'R',reason:'客服仍未说明。'}]},api=savedApi(row,{status:'completed_with_warnings',stopReason:undefined,completeOnAction:false}),controller=createReasonTranslationController({client:api.client,autoPoll:false});
 await controller.ensure(row,{lang:'en'});for(let i=0;i<5;i++)await controller.ensure(row,{lang:'en'});assert.deepEqual(api.actions,['retry']);controller.stop();clearReasonTranslations();
 let release,calls=0;const queued=createReasonTranslationController({autoPoll:false,client:{list:async()=>({jobs:[]}),create:async input=>{calls++;await new Promise(resolve=>{release=resolve;});return{job:{...input,id:input.jobId,status:'running'}};},result:async()=>({job:{status:'running',targetLang:'en'},sourceSnapshot:{fields:sessionDisplayFields(row)},translations:[]})}});
 const first=queued.ensure(row,{lang:'en'});await new Promise(resolve=>setImmediate(resolve));queued.ensureNext([{...row,id:'OTHER'}]);assert.equal(calls,1);release();await first;queued.ensureNext([{...row,id:'OTHER'}]);assert.equal(calls,1);queued.stop();
});

test('a newly completed legacy job with missing text can recover on the next visit without another create',async()=>{
 const row={id:'NEW-LEGACY',taskId:'LEGACY-TASK',aiResults:[{ruleId:'R',reason:'客服遗漏信息。'}]},fields=sessionDisplayFields(row);let job,creates=0,retries=0;
 const client={list:async()=>({jobs:job?[job]:[]}),create:async input=>{creates++;job={...input,id:input.jobId,status:'completed_with_warnings'};return{job};},get:async()=>({job}),result:async()=>({job,sourceSnapshot:{fields},translations:fields.map(f=>({id:f.id,sourceText:f.text,status:job.status==='completed'?'translated':'failed',text:job.status==='completed'?'The agent did not provide the requested information.':''}))}),action:async(_id,name)=>{assert.equal(name,'retry');retries++;job={...job,status:'completed'};return{job};}};
 const controller=createReasonTranslationController({client,autoPoll:false});await controller.ensure(row,{lang:'en'});await controller.ensure(row,{lang:'en'});assert.equal(creates,1);assert.equal(retries,1);assert.match(reasonText(row.aiResults[0].reason,'en'),/^The agent/);controller.stop();
});

test('background restoration visits every queued record and retries a partial result once',async()=>{
 const rows=Array.from({length:12},(_,i)=>({id:'BG-'+i,taskId:'LEGACY',aiResults:[{ruleId:'R',reason:`客服遗漏第${i}项信息。`}]})),jobs=new Map();let creates=0,retries=0;
 const client={list:async source=>({jobs:[...jobs.values()].filter(j=>j.source.sessionId===source.sessionId)}),create:async input=>{creates++;const job={...input,id:input.jobId,status:input.source.sessionId==='BG-0'?'completed_with_warnings':'completed'};jobs.set(job.id,job);return{job};},get:async id=>({job:jobs.get(id)}),result:async id=>{const job=jobs.get(id),fields=sessionDisplayFields(rows.find(r=>r.id===job.source.sessionId));return{job,sourceSnapshot:{fields},translations:fields.map(f=>({id:f.id,sourceText:f.text,status:job.status==='completed'?'translated':'failed',text:job.status==='completed'?'The agent should provide the requested information.':''}))};},action:async(id,name)=>{assert.equal(name,'retry');retries++;const job={...jobs.get(id),status:'completed'};jobs.set(id,job);return{job};}};
 const controller=createReasonTranslationController({client,autoPoll:false});for(let i=0;i<16;i++)await controller.ensureNext(rows,{lang:'en'});assert.equal(creates,12);assert.equal(retries,1);assert.ok(rows.every(r=>reasonText(r.aiResults[0].reason,'en').startsWith('The agent')));controller.stop();
});

test('successful model reconfiguration reopens only the bounded missing-translation budget',async()=>{
 const row={id:'CONFIG-RECOVERY',taskId:'LEGACY',aiResults:[{ruleId:'R',reason:'客服缺少解释。'}]};let available=false,calls=0,job;
 const controller=createReasonTranslationController({autoPoll:false,client:{list:async()=>{calls++;if(!available)throw new Error('model unavailable');return{jobs:[]};},create:async input=>({job:job={...input,id:input.jobId,status:'completed'}}),result:async()=>({job,sourceSnapshot:{fields:sessionDisplayFields(row)},translations:sessionDisplayFields(row).map(f=>({id:f.id,sourceText:f.text,text:'The agent did not explain the request.',status:'translated'}))})}});
 await controller.ensure(row,{lang:'en'});await controller.ensure(row,{lang:'en'});assert.equal(calls,1);available=true;controller.configurationRecovered();await controller.ensureNext([row],{lang:'en'});assert.equal(calls,2);assert.match(reasonText(row.aiResults[0].reason,'en'),/^The agent/);controller.stop();
});

test('native frozen sales-stage labels are not mistaken for uncertain generated prose',()=>{
 const f=reviewFixture(),value={status:'completed',value:{label:'Pre-sales'},languageValidation:nativeAssurance({reason:'The customer requests product information.'},f.context,{capability:'intent'})};f.session.sceneCapabilities={outputs:{salesStage:value}};
 assert.equal(reasonTranslationNotice(f.session,f.task),'');assert.ok(sessionDisplayFields(f.session).some(v=>v.text==='Pre-sales'),'legacy still translates the label');
});

test('restoring tested model settings resumes configuration pauses but never user pauses',async()=>{
 for(const stopReason of ['configuration_changed','user_paused']){
  clearReasonTranslations();const row={id:'RESTORED',taskId:'LEGACY',aiResults:[{ruleId:'R',reason:'客服需要补充说明。'}]},api=savedApi(row,{stopReason}),controller=createReasonTranslationController({client:api.client,autoPoll:false});await controller.ensure(row,{lang:'en'});assert.deepEqual(api.actions,[]);controller.configurationRecovered();await controller.ensureNext([row],{lang:'en'});assert.deepEqual(api.actions,stopReason==='configuration_changed'?['resume']:[]);controller.stop();
 }
});

test('native historical manual overrides retain the original AI reason audit',()=>{
 const f=reviewFixture(),r=f.session.aiResults[0];applyNativeReviewMaterial(f.task,f.material);r.reason='El agente no responde a la pregunta del cliente.';r.languageValidation=nativeAssurance(r,f.context);f.session.review.status='已确认';f.session.review.drafts[r.ruleId]={...r,source:'manual',reason:'The reviewer confirmed the response.',verdict:'符合'};
 const html=taskHistoryView(f.state,f.task,f.ui);assert.ok(html.includes(r.reason));assert.ok(html.includes('The reviewer confirmed'));assert.match(html,/Original AI output/);
});
