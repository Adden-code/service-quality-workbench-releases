import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {stage3Fixture,nativeReportAnswer,modelEnvelope} from './native-language-stage3-fixture.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {nativeDisplayProjection} from '../server/native-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {readXlsx} from '../public/io.mjs';
import {freezeTranslationSource} from '../server/translation-source.mjs';
import {combinedReportProgress,combinedReportStatus} from '../public/delivery-progress.mjs';
const scratch=path.resolve(process.env.R39_VERIFY_DIR||'../outputs/service-r39-step3-20261125/test-workspaces');
async function setup(t,language='en',{wrongLanguage=false,partialHighlights=false,splitHighlights=false}={}){
 const f=await stage3Fixture(language);await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'report-')),requests=[];
 let highlightAttempts=0;const client=createArkClient({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body),data=JSON.parse(body.messages[1].content);requests.push(body);const kind=data.kind,source=data.input||data,answer=nativeReportAnswer(kind,source,wrongLanguage&&kind!=='translation'?(language==='en'?'zh':'en'):language);if(partialHighlights&&kind==='caseHighlights')answer.cases=[answer.cases[0],{...answer.cases[0],id:'UNKNOWN-SYNTHETIC'}];if(splitHighlights&&kind==='caseHighlights')answer.cases=[answer.cases[highlightAttempts++%2]];return modelEnvelope(answer);}});
 const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-report',authMode:'none',timeoutMs:30000,reasoningEffort:'low'},modelConfig={getPrivate:()=>config},store={read:async()=>({revision:1,state:structuredClone(f.state)}),getSource:async()=>({...f.task.source,bytes:f.bytes}),readNativeMaterial:async()=>structuredClone(f.frozen)};
 let service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs:1});t.after(async()=>{await service.close();assert.ok(dir.startsWith(scratch+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return{...f,dir,store,requests,get service(){return service;},async reopen(){await service.close();service=await createReportJobs({dataDir:dir,store,modelConfig,client,retryDelayMs:1});}};
}
for(const language of ['zh','en'])test(`Stage3 ${language} confirmed native results generate native HTML and Excel with automatic source translation`,async t=>{
 const f=await setup(t,language),before=JSON.stringify(f.state);await f.service.create({jobId:'native-'+language,taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('native-'+language);
 assert.equal(result.job.status,'completed',JSON.stringify(result.job.nodes));assert.equal(result.job.nativeLanguage,language);assert.equal(result.enrichment.analysisComplete,true);assert.equal(JSON.stringify(f.state),before);
 const analysis=f.requests.filter(r=>JSON.parse(r.messages[1].content).contract==='native-report-v1');assert.ok(analysis.length>=2);for(const r of analysis){assert.equal(JSON.parse(r.messages[1].content).contentLanguage,language);if(language==='en')assert.doesNotMatch(r.messages[0].content,/\p{Script=Han}/u);}
 assert.ok(f.requests.some(r=>JSON.parse(r.messages[1].content).kind==='translation'));assert.equal(result.enrichment.translations['SYNTHETIC-0'].conversation.status,'translated');
 const html=buildBusinessReportHtml(result.snapshot,result.enrichment,{language:language==='en'?'zh':'en',job:result.job});assert.match(html,new RegExp(`<html lang="${language==='en'?'en':'zh-CN'}"`));assert.doesNotMatch(html,/Translation missing|Translation pending|\[Untranslated:/);
 await fs.writeFile(path.join(scratch,`native-${language}.html`),html);await fs.writeFile(path.join(scratch,`native-${language}-result.json`),JSON.stringify(result,null,2));
 const reason=language==='en'?'The agent does not address the specific customer request.':'坐席未回应用户提出的具体问题。';assert.ok(html.includes(reason));
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment,{language:language==='en'?'zh':'en'})),all=JSON.stringify(tables);assert.ok(all.includes(reason));assert.ok(all.includes('هل توجد نسخة زرقاء؟'));assert.ok(all.includes(language==='en'?'The customer asks about a blue version.':'用户询问蓝色版本是否存在'));assert.doesNotMatch(all,/\[Translation missing\]|\[Untranslated:/);
 assert.equal(combinedReportProgress({job:result.job,result},'en').percent,100);assert.equal(combinedReportStatus({job:result.job,result},'en'),'completed');
 const count=f.requests.length;await f.reopen();assert.deepEqual(await f.service.getResult(result.job.id),result);assert.equal(f.requests.length,count);const duplicate=await f.service.create({jobId:'duplicate-native',taskId:f.task.id});assert.equal(duplicate.reused,true);assert.equal(duplicate.id,result.job.id);
 await assert.rejects(f.service.create({jobId:'wrong-lang',taskId:f.task.id,targetLang:language==='en'?'zh':'en'}),{code:'NATIVE_LANGUAGE_LOCKED'});
});

test('native partial highlights preserve rejected IDs and valid score coercion across restart',async t=>{
 const f=await setup(t,'en',{partialHighlights:true});for(const s of f.state.sessions){s.aiResults[0].verdict='符合';s.review.drafts['NP-SYNTHETIC'].verdict='符合';}
 await f.service.create({jobId:'partial-native',taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('partial-native');assert.equal(result.job.status,'completed_with_warnings');assert.equal(result.enrichment.excellentCases.length,1);
 const node=result.job.nodes.find(n=>n.kind==='caseHighlights'),detail=await f.service.getNode(result.job.id,node.id);assert.ok(JSON.stringify(detail).includes('UNKNOWN-SYNTHETIC'));assert.ok(JSON.stringify(detail).includes('numeric_string_to_integer'));
 const count=f.requests.length;await f.reopen();assert.deepEqual(await f.service.getResult(result.job.id),result);assert.equal(f.requests.length,count);
});

test('native partial highlights from different attempts rebuild complete language audit after merging',async t=>{
 for(const count of [2,3]){
  const f=await setup(t,'en',{splitHighlights:true});if(count===3){const s=structuredClone(f.sessions[1]);s.id='SYNTHETIC-2';s.externalId='S2';f.state.sessions.push(s);}
  for(const s of f.state.sessions){s.aiResults[0].verdict='符合';s.review.drafts['NP-SYNTHETIC'].verdict='符合';}
  if(count===3){const {workbook}=await import('../public/io.mjs'),{createHash}=await import('node:crypto');const bytes=await workbook([{name:'Source',headers:['ID','Agent','Conversation'],rows:f.state.sessions.map(s=>[s.externalId,'Synthetic agent',s.turns.map(t=>t.text).join('\n')])}]);f.task.source={...f.task.source,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};f.store.getSource=async()=>({...f.task.source,bytes});}
  const id='merge-native-'+count;await f.service.create({jobId:id,taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult(id);assert.equal(result.job.status,count===2?'completed':'completed_with_warnings');assert.equal(result.enrichment.excellentCases.length,2);
  await f.reopen();assert.deepEqual(await f.service.getResult(id),result);
 }
});
test('Stage3 language failures retain candidates and finish partial without changing inspection decisions',async t=>{
 const f=await setup(t,'en',{wrongLanguage:true}),before=JSON.stringify(f.state);await f.service.create({jobId:'wrong-native',taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('wrong-native');assert.equal(result.job.status,'completed_with_warnings');
 const failed=result.job.nodes.filter(n=>n.kind!=='translation');assert.ok(failed.length);for(const n of failed){assert.equal(n.status,'failed');assert.equal(n.attempts,2);const detail=await f.service.getNode(result.job.id,n.id);assert.ok(detail.attempts.every(a=>a.nativeCandidate.languageValidation.status==='mismatch'));}
 assert.equal(JSON.stringify(f.state),before);assert.equal(result.enrichment.excellentCases.length,0);await f.reopen();assert.equal((await f.service.getResult(result.job.id)).job.status,'completed_with_warnings');
});
test('Stage3 display projection is exact frozen selected material, and display translations reject native generated prose',async t=>{
 const f=await setup(t),projection=nativeDisplayProjection(f.task,f.frozen,{delivery:true});assert.equal(projection.rules[0].title,'Synthetic acceptance material');assert.ok(projection.template.title);assert.equal(JSON.stringify(projection).includes('report.context'),false);
 await assert.rejects(freezeTranslationSource({source:{kind:'session-display',taskId:f.task.id,sessionId:f.sessions[0].id},store:f.store}),/not applicable/);
 const explicit=await freezeTranslationSource({source:{kind:'session',taskId:f.task.id,sessionId:f.sessions[0].id},store:f.store});assert.equal(explicit.snapshot.fields.length,2);assert.ok(explicit.snapshot.fields.every(x=>x.id.includes('.turns.')));
 const old=structuredClone(f.frozen);old.selected.find(m=>m.kind==='rule').title='Unreviewed title';assert.throws(()=>nativeDisplayProjection(f.task,old));
 f.store.readNativeMaterial=async()=>old;await assert.rejects(f.service.create({jobId:'bad-package',taskId:f.task.id}));assert.equal(f.requests.length,0);
});
