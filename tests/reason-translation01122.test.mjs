import test from 'node:test';
import assert from 'node:assert/strict';
import {createReasonTranslationController,reasonText,clearReasonTranslations} from '../public/reason-translation.mjs';
import {sessionDisplayFields} from '../public/session-display-fields.mjs';
import {freezeTranslationSource} from '../server/translation-source.mjs';
import {createTranslationJobs} from '../server/translation-jobs.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const session={id:'S',taskId:'T',turns:[{text:'PRIVATE SOURCE'}],aiResults:[{ruleId:'EC-TEXT',reason:'客服已说明。'}],review:{drafts:{R:{reason:'PRIVATE HUMAN'}}},sceneCapabilities:{outputs:{ecommerceClassification:{reason:'评价表达负面态度。',value:{polarity:'negative'},evidence:[{quote:'PRIVATE QUOTE'}]}}}};
test('display source freezes only AI reasons and never source, human or audit text',async()=>{
 const doc={revision:7,state:{tasks:[{id:'T'}],sessions:[session]},catalog:{}};
 const result=await freezeTranslationSource({source:{kind:'session-display',taskId:'T',sessionId:'S'},store:{read:async()=>doc}});
 assert.deepEqual(result.snapshot.fields,sessionDisplayFields(session));assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);assert.equal(result.snapshot.sourceRevision,7);
});
test('display translation caches by language and exact frozen fields; locale switches do not write or inspect',async()=>{
 clearReasonTranslations();const jobs=[],results=new Map(),before=JSON.stringify(session);let calls=0;
 const api={list:async()=>({jobs}),result:async id=>results.get(id),create:async input=>{calls++;const fields=sessionDisplayFields(session),job={id:input.jobId,source:input.source,targetLang:input.targetLang,status:'completed'},result={job,sourceSnapshot:{fields},translations:fields.map(f=>({...f,sourceText:f.text,text:input.targetLang==='en'?'The agent gave a specific answer.':'客服已具体回应。',status:'translated'}))};jobs.unshift(job);results.set(job.id,result);return{job};}};
 const controller=createReasonTranslationController({client:api,autoPoll:false});const waiting=controller.ensure(session,{lang:'en'});assert.match(reasonText(session.aiResults[0].reason,'en'),/translating/i);await waiting;
 assert.equal(reasonText(session.aiResults[0].reason,'en'),'The agent gave a specific answer.');await controller.ensure(session,{lang:'zh'});await controller.ensure(session,{lang:'en'});assert.equal(calls,1);assert.equal(JSON.stringify(session),before);
 controller.stop();clearReasonTranslations();const restored=createReasonTranslationController({client:api,autoPoll:false});await restored.ensure(session,{lang:'en'});assert.equal(calls,1);assert.equal(reasonText(session.aiResults[0].reason,'en'),'The agent gave a specific answer.');
 session.aiResults[0].reason='The agent answered in English.';await restored.ensure(session,{lang:'zh'});assert.equal(calls,2);assert.equal(reasonText(session.aiResults[0].reason,'zh'),'客服已具体回应。');
 session.aiResults[0].reason='已变更理由。';await restored.ensure(session,{lang:'en'});assert.equal(calls,3);restored.stop();
});
test('lost display-job acknowledgement is recovered and paused work requires explicit resume',async()=>{
 clearReasonTranslations();const row={...session,aiResults:[{ruleId:'R',reason:'待翻译理由。'}]},fields=sessionDisplayFields(row);let job,creates=0,resumes=0;
 const result=()=>({job,sourceSnapshot:{fields},translations:fields.map(f=>({...f,sourceText:f.text,text:job.status==='completed'?'The source was checked.':'',status:job.status==='completed'?'translated':'pending'}))});
 const api={list:async()=>({jobs:job?[job]:[]}),get:async()=>({job}),result:async()=>result(),create:async input=>{creates++;job={...input,id:input.jobId,status:'paused'};throw new Error('Lost acknowledgement');},action:async(id,action)=>{assert.equal(action,'resume');resumes++;job={...job,status:'completed'};return{job};}};
 const controller=createReasonTranslationController({client:api,autoPoll:false});await controller.ensure(row,{lang:'en'});assert.match(reasonText(row.aiResults[0].reason,'en'),/unavailable/);
 await controller.ensure(row,{lang:'en',retry:true});assert.equal(creates,1);assert.equal(resumes,1);assert.equal(reasonText(row.aiResults[0].reason,'en'),'The source was checked.');controller.stop();
});
test('real translation service supports Chinese display, persisted English cache and immutable workspace revision',async t=>{
 const base=path.resolve('../outputs/service01122-20261124/reason-translation-tests');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'case-'));
 const row={...structuredClone(session),aiResults:[{ruleId:'R',reason:'The agent offered specific advice.'}]},doc={revision:19,state:{tasks:[{id:'T'}],sessions:[row]},catalog:{}},before=JSON.stringify(doc);let calls=0;
 const options={dataDir:dir,store:{read:async()=>structuredClone(doc)},modelConfig:{getPrivate:()=>({baseUrl:'http://127.0.0.1:1',model:'synthetic-local-only',authMode:'none',configured:true})},client:{async enrichBusinessReport({input}){calls++;return{items:input.items.map(item=>{const zh=/[\u3400-\u9fff]/u.test(item.text),same=input.targetLang===(zh?'zh':'en');return{id:item.id,isTargetLanguage:same,detectedLanguage:zh?'zh':'en',translation:same?item.text:input.targetLang==='zh'?'客服提供了具体建议。':'The classification states a negative concern.'};})};}},maxAttempts:1,retryDelayMs:0};
 let service=await createTranslationJobs(options);t.after(async()=>{await service.close();});const source={kind:'session-display',taskId:'T',sessionId:'S'};
 await service.create({jobId:'zh-display',source,targetLang:'zh'});await service.waitForIdle();assert.equal((await service.getResult('zh-display')).translations[0].text,'客服提供了具体建议。');
 await service.create({jobId:'en-display',source,targetLang:'en'});await service.waitForIdle();const prior=calls;await service.close();service=await createTranslationJobs(options);await service.create({jobId:'en-display-cached',source,targetLang:'en'});await service.waitForIdle();assert.equal(calls,prior);assert.equal(JSON.stringify(doc),before);
});

test('Latin-script AI prose waits for English verification and Spanish is translated by the persisted pipeline',async t=>{
 clearReasonTranslations();
 const base=path.resolve('../outputs/service01123-20261125/i18n/translation-tests');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'latin-'));
 const row={id:'S-LATIN',taskId:'T-LATIN',aiResults:[{ruleId:'R1',reason:'El agente no explica los siguientes pasos.'},{ruleId:'R2',reason:'The agent gave a specific answer.'}]},doc={revision:23,state:{tasks:[{id:row.taskId}],sessions:[row]},catalog:{}},before=JSON.stringify(doc),requests=[];
 const service=await createTranslationJobs({dataDir:dir,store:{read:async()=>structuredClone(doc)},modelConfig:{getPrivate:()=>({baseUrl:'http://127.0.0.1:1',model:'synthetic-local-only',authMode:'none',configured:true})},client:{async enrichBusinessReport({input}){requests.push(input);return{items:input.items.map(item=>({id:item.id,isTargetLanguage:item.text.startsWith('The '),detectedLanguage:item.text.startsWith('The ')?'en':'es',translation:item.text.startsWith('The ')?item.text:'The agent does not explain the next steps.'}))};}},maxAttempts:1,retryDelayMs:0});
 const api={list:async()=>({jobs:[]}),create:async input=>{await service.create(input);await service.waitForIdle();return{job:await service.get(input.jobId)};},result:async id=>service.getResult(id)};
 const controller=createReasonTranslationController({client:api,autoPoll:false});t.after(async()=>{controller.stop();clearReasonTranslations();await service.close();});
 for(const result of row.aiResults)assert.equal(reasonText(result.reason,'en'),'[Translation pending]');
 await controller.ensure(row,{lang:'en'});
 assert.equal(requests.length,1);assert.equal(requests[0].targetLang,'en');assert.equal(reasonText(row.aiResults[0].reason,'en'),'The agent does not explain the next steps.');assert.equal(reasonText(row.aiResults[1].reason,'en'),row.aiResults[1].reason);assert.equal(JSON.stringify(doc),before);
});
