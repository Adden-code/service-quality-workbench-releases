import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {migrateSceneConfigurations,sceneConfigurationMutation} from '../server/scene-configuration-service.mjs';
import {extractSceneDocument,parseScenePackage} from '../server/scene-package-preparation.mjs';
import {sceneBasisForTask} from '../public/scene-configuration.mjs';
const now='2026-11-16T08:00:00Z',actor='合成操作人',reason='合成验证',model={modelId:'synthetic-model',promptVersion:'scene-package-draft.v4',modelFingerprint:'a'.repeat(64)};
let sequence=0;
const change=(doc,input,extra)=>sceneConfigurationMutation(doc,{actor,reason,operationId:`synthetic-${++sequence}`,...input},{now,...extra});
async function prepared(){
 let doc=migrateSceneConfigurations({state:createBusinessState(),catalog:createCatalog()},{now});doc=change(doc,{action:'create-subject',name:'合成科目',allowedRuleCategories:['合成类别']});let draft=doc.state.scenePackageDrafts.at(-1);const text='合成礼仪：有问候为符合，辱骂为不符合，缺原文无法判定。交付概况与检核列。用户诉求先行提取。';const bytes=Buffer.from(text);const source=await extractSceneDocument({bytes,name:'synthetic.txt',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});const evidence=[{blockId:'document',quote:text,start:0,end:text.length}];
 const output={rules:[{title:'合成礼仪',category:'合成类别',scope:'合成',passCriteria:'问候',failCriteria:'辱骂',exceptionCriteria:'原文缺失无法判定',exceptionTable:[],dependencies:['demandSummary'],evidence}],auxiliary:[{capability:'demandSummary',phase:'pre',dependsOn:[],taxonomy:null,evidence}],delivery:{title:'合成模板报告',groupBy:'product',sections:[{key:'overview',title:'合成概况',evidence},{key:'dimensions',title:'合成检核',evidence}],groups:[{key:'g',label:'独立业务列组',parentKey:'',evidence}],columns:[{candidateIndex:0,label:'合成检核列',generator:'rule',field:'',groupKey:'g',condition:null,evidence}],evidence},timingStandards:[],unmappedBlocks:[],warnings:[]};
 const result=parseScenePackage(JSON.stringify(output),{...source,allowedRuleCategories:['合成类别']});doc=change(doc,{action:'apply-preparation',draftId:draft.id,expectedRevision:draft.revision},{preparation:{result,document:source,model}});draft=doc.state.scenePackageDrafts.at(-1);
 for(const tab of ['rules','auxiliary','delivery']){doc=change(doc,{action:'confirm',draftId:draft.id,expectedRevision:draft.revision,tab});draft=doc.state.scenePackageDrafts.at(-1);}
 doc=change(doc,{action:'publish',draftId:draft.id,expectedRevision:draft.revision});return{doc,source,bytes,scene:draft.sceneId};
}

for(const mode of ['failure-rate','executor-unavailable','authentication'])test(`01120 ${mode} preserves the affected task while using the correct pause scope`,async t=>{
 const f=await prepared(),root=path.resolve('tests/.scheduler-scratch');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'scope-')),store=await createWorkspaceStore({dataDir:dir});let ai,release,entered,capCalls=0,healthy=false;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),inspected=[];
 t.after(async()=>{release();await ai?.close();await store.close();assert.ok(dir.startsWith(root+path.sep));await fs.rm(dir,{recursive:true,force:true});});await store.putSource(f.bytes,'synthetic.txt');const source=await store.putSource(Buffer.from('Synthetic task-specific breaker scope'),'synthetic.json');
 const sessions=(prefix,count,scene)=>Array.from({length:count},(_,i)=>({id:`${prefix}-${i}`,scene,startedAt:now,topic:'Synthetic',product:'Synthetic',agent:'Synthetic',channel:'Synthetic',customer:'Synthetic',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'Synthetic question'},{id:2,role:'客服',text:'Synthetic answer'}]}));
 let state=createImportedTask(f.doc.state,{name:'Synthetic affected task',sessions:sessions('A',25,f.scene),source,basisSnapshot:sceneBasisForTask(f.doc.state,f.doc.catalog,f.scene,now),reviewer:actor,executionSettings:{concurrency:1},now});const a=state.tasks[0].id;
 const ordinaryBasis=sceneBasisForTask(f.doc.state,f.doc.catalog,'新品产品咨询',now),ids=[];for(const key of ['B','C']){state=createImportedTask(state,{name:'Synthetic unaffected '+key,sessions:sessions(key,1,'新品产品咨询'),source,basisSnapshot:ordinaryBasis,reviewer:actor,now});ids.push(state.tasks[0].id);}
 await store.save({state,catalog:f.doc.catalog,baseRevision:0,mutationId:'initial'});
 const client={inspect:async req=>{inspected.push(req.session.externalId);return{results:req.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic valid result',evidence:[2],referenceIds:[]})),modelId:'synthetic-model'};}};
 if(mode!=='executor-unavailable')client.inspectSceneCapability=async()=>{capCalls++;if(capCalls===1){entered();await gate;}if(!healthy&&(mode==='authentication'||capCalls<=9))throw Object.assign(Error('Synthetic capability failure'),{code:mode==='authentication'?'AUTHENTICATION':'NETWORK'});return{status:'uncertain',reason:'Synthetic missing business evidence',confidence:0,evidence:[]};};
 ai=await createAiService({store,modelConfig:{getPrivate:()=>({model:'synthetic-model',authMode:'none',baseUrl:'http://127.0.0.1:1',configured:true,connectionTested:true})},client,maxAttempts:1,retryDelayMs:0});await ai.start(a,'scope-A');if(mode!=='executor-unavailable')await started;await ai.start(ids[0],'scope-B');release();await ai.waitForIdle();
 let saved=await store.read(),affected=saved.state.tasks.find(t=>t.id===a);assert.equal(affected.aiStatus,'paused');assert.equal(affected.aiQueue.rows.filter(r=>r.status==='pending').length,mode==='failure-rate'?5:24);
 if(mode==='authentication'){
  assert.equal(ai.runtime().queueStatus,'paused');assert.equal(ai.runtime().queuePauseReason,'capability_unavailable');assert.equal(inspected.length,0);await ai.start(ids[1],'scope-C');await ai.waitForIdle();assert.equal(inspected.length,0);healthy=true;await ai.resumeQueue();await ai.waitForIdle();assert.ok(inspected.includes('B-0')&&inspected.includes('C-0'));
 }else{
  assert.equal(ai.runtime().queueStatus,'ready');assert.ok(inspected.includes('B-0'));await ai.start(ids[1],'scope-C');await ai.waitForIdle();assert.ok(inspected.includes('C-0'));assert.equal((await store.read()).state.tasks.find(t=>t.id===a).aiStatus,'paused');
  const before=capCalls;await ai.pauseQueue();await ai.resumeQueue();await ai.waitForIdle();assert.equal(capCalls,before,'resuming all must not silently retry this task’s capability failure');assert.equal((await store.read()).state.tasks.find(t=>t.id===a).aiStatus,'paused');
 }
});
