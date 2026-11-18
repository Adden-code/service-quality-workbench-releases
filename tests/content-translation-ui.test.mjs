import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setLocale} from '../public/i18n.mjs';
const url=new URL('../public/content-translation-ui.mjs',import.meta.url);
test('business translation controls exist as an explicit frontend controller',()=>assert.ok(fs.existsSync(url),'Explicit translation controller is missing'));
test('constructing, rendering, and changing locale do not request translations',async()=>{
  if(!fs.existsSync(url))return;
  const {createContentTranslationController,translationControls,clearBusinessTranslations}=await import(url);clearBusinessTranslations();let requests=0;
  const api={create:async()=>{requests++;return{job:{id:'J1',status:'running',progress:{done:0,total:1}}};}};
  const controller=createContentTranslationController({client:api,autoPoll:false});
  const source={kind:'session',taskId:'TASK-1',sessionId:'S1'};
  setLocale('en');assert.match(translationControls(source),/Translate business content/);setLocale('zh');setLocale('en');assert.equal(requests,0);
  await controller.start(source);assert.equal(requests,1);controller.stop();setLocale('zh');
});
test('a frozen source selector is sent and derived translations never overwrite original values',async()=>{
  if(!fs.existsSync(url))return;
  const {createContentTranslationController,d,businessContent,clearBusinessTranslations}=await import(url);clearBusinessTranslations();
  const original={id:'R1',reason:'客户未获回复 <script>'},before=JSON.stringify(original),source={kind:'rule',id:'R1',version:'V1.0'};let sent;
  const job={id:'J2',status:'completed_with_warnings',progress:{done:1,total:2,failed:1,pending:0,percent:100},resultAvailable:true};
  const controller=createContentTranslationController({autoPoll:false,client:{create:async input=>{sent=input;return{job};},result:async()=>({job,sourceSnapshot:{fields:[{id:'reason',text:original.reason}]},translations:[{id:'reason',sourceText:original.reason,text:'The customer received no reply.',status:'translated'},{id:'other',sourceText:'另一条原文',text:'',status:'failed'}]})}});
  setLocale('en');assert.match(d(original.reason),/Original.*English missing/);await controller.start(source);
  assert.deepEqual(sent.source,source);assert.equal(sent.targetLang,'en');assert.deepEqual(Object.keys(sent).sort(),['jobId','source','targetLang']);
  assert.equal(d(original.reason),'The customer received no reply.');assert.match(businessContent(original.reason),/Original/);assert.match(businessContent(original.reason),/&lt;script&gt;/);assert.match(d('另一条原文'),/English missing/);assert.equal(JSON.stringify(original),before);
  setLocale('zh');assert.equal(d(original.reason),original.reason);controller.stop();
});
test('uncertain creation is recovered by its original job ID without a second model job',async()=>{
  const {createContentTranslationController,clearBusinessTranslations}=await import(url);clearBusinessTranslations();let creates=0,reads=0,sentId;
  const source={kind:'task',taskId:'T1'},job={id:'',source,targetLang:'en',status:'running',progress:{done:0,total:1}};
  const controller=createContentTranslationController({autoPoll:false,client:{create:async input=>{creates++;sentId=input.jobId;throw new Error('Lost acknowledgement');},get:async id=>{reads++;assert.equal(id,sentId);return{job:{...job,id}};}}});
  await assert.rejects(controller.start(source),/Lost/);await controller.start(source);assert.equal(creates,1);assert.equal(reads,1);controller.stop();
});
test('arbitrary browser text is rejected before a request and explicit pause is not lost behind polling',async()=>{
  const {createContentTranslationController,clearBusinessTranslations}=await import(url);clearBusinessTranslations();let requests=0,resolveGet;const events=[],source={kind:'rule',id:'R1',version:'V1.0'};
  const job={id:'J3',source,targetLang:'en',status:'running',progress:{done:0,total:1}};
  const controller=createContentTranslationController({autoPoll:false,client:{create:async()=>{requests++;return{job};},get:async()=>{events.push('get');return new Promise(resolve=>{resolveGet=()=>resolve({job});});},action:async(id,name)=>{events.push(name);return{job:{...job,status:'paused'}};}}});
  await assert.rejects(controller.start({...source,text:'Private caller text'}),/Text cannot/);assert.equal(requests,0);
  await controller.start(source);const refresh=controller.refresh(source,'J3'),pause=controller.action(source,'J3','pause');resolveGet();await Promise.all([refresh,pause]);assert.deepEqual(events,['get','pause']);controller.stop();
});
