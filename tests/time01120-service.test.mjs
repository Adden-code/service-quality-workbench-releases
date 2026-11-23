import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,row,now,sceneId} from './time01120-fixtures.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {sceneBasisForTask} from '../public/scene-configuration.mjs';
import {installSceneSeed} from '../server/scene-seed.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {EC_HEADERS,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {classificationBlockedRuleIds} from '../public/scene-dependency-staleness.mjs';

test('persisted new tasks calculate TIME during classification failure and dependency retry changes STEPS alone',async t=>{
 const root=path.resolve('tests/artifacts/time01120');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'synthetic-')),f=fixture(),store=await createWorkspaceStore({dataDir:dir});let ai;
 t.after(async()=>{await ai?.close();await store.close();assert.ok(dir.startsWith(root+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const state=installSceneSeed(createBusinessState(),f.catalog,f.newSeed,{now}),rows=[row().ecommerce.raw,row({replyAt:'2026-11-22 10:00:01'}).ecommerce.raw,row({replyAt:''}).ecommerce.raw];rows.forEach((r,i)=>{r[8]+=` #${i}`;r[9]+=` #${i}`;});
 const bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),...rows]}])),parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,'synthetic.xlsx'),next=createImportedTask(state,{name:'Synthetic fixed24 task',sessions:parsed.sessions,source,basisSnapshot:sceneBasisForTask(state,f.catalog,sceneId,now),reviewer:'Synthetic reviewer',now,executionSettings:{concurrency:1}});await store.save({state:next,catalog:f.catalog,baseRevision:0,mutationId:'synthetic-time-initial'});
 let classificationFails=true;const targeted=[];const result=ruleId=>({ruleId,verdict:'符合',reason:'Synthetic direct source check',evidence:[2],referenceIds:[],confidence:.95,conflictsWith:[]});
 ai=await createAiService({store,maxAttempts:1,retryDelayMs:0,modelConfig:{getPrivate:()=>({model:'synthetic-model',authMode:'none',baseUrl:'http://127.0.0.1:1',configured:true,connectionTested:true})},client:{inspectSceneCapability:async({input})=>{if(classificationFails)throw Object.assign(new Error('Synthetic classification failure'),{code:'INVALID_OUTPUT'});const b=input.blocks[0];return{status:'completed',value:{evaluationType:'好评负向',polarity:'negative',vocKind:'substantive'},confidence:.95,reason:'Synthetic recovered classification',evidence:[{blockId:b.id,quote:b.text,start:0,end:b.text.length}]};},inspectEcommerceRow:async input=>{if(input.ruleIds)targeted.push([...input.ruleIds]);return{modelId:'synthetic-model',results:(input.ruleIds||EC_RULE_IDS.filter(id=>id!=='EC-TIME')).map(result)};}}});
 await ai.start(next.tasks[0].id,'synthetic-time-run');await ai.waitForIdle();const before=await store.read();assert.equal(before.state.tasks[0].aiStatus,'completed');
 for(const [i,s] of before.state.sessions.entries()){assert.equal(s.aiExecution.status,'completed');assert.equal(s.sceneCapabilities.outputs.ecommerceClassification.status,'failed');assert.equal(s.aiResults.find(r=>r.ruleId==='EC-TIME').verdict,['符合','不符合','无法判定'][i]);assert.equal(s.aiResults.find(r=>r.ruleId==='EC-STEPS').verdict,'无法判定');assert.deepEqual(classificationBlockedRuleIds(s),['EC-STEPS']);}
 classificationFails=false;const s=before.state.sessions[0];await ai.retryDependencies(next.tasks[0].id,s.id);const after=await store.read(),updated=after.state.sessions.find(r=>r.id===s.id);assert.deepEqual(targeted,[['EC-STEPS']]);assert.deepEqual(updated.aiResults.find(r=>r.ruleId==='EC-TIME'),s.aiResults.find(r=>r.ruleId==='EC-TIME'));assert.equal(updated.aiResults.find(r=>r.ruleId==='EC-STEPS').verdict,'符合');assert.deepEqual(updated.sceneCapabilities.dependencyRecoveryHistory.at(-1).ruleIds,['EC-STEPS']);assert.deepEqual(after.state.tasks[0].basisSnapshot,before.state.tasks[0].basisSnapshot);assert.deepEqual(after.state.tasks[0].executionSnapshot,before.state.tasks[0].executionSnapshot);
});
