import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createBusinessState,createImportedTask,saveReview,confirmReview,getSessionResults} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot,referenceKey} from '../public/task-basis.mjs';
import {buildResultXlsx,readXlsx} from '../public/io.mjs';
import {isAIFinal} from '../public/ai-triage.mjs';
import {freezeReviewRouting,triageReportNotice,resultProvenanceSheet} from '../public/triage-export.mjs';
const root=path.resolve('../outputs/service0107-20261116/test-calibration');
test('durable model-shaped workflow calibrates independent batches, freezes rule policy, samples and recalls on confirmed error',async t=>{
 await fs.mkdir(root,{recursive:true});const dataDir=await fs.mkdtemp(path.join(root,'case-')),store=await createWorkspaceStore({dataDir});
 const config={getPrivate:()=>({connectionTested:true,authMode:'none',model:'synthetic-rule-calibration',baseUrl:'http://127.0.0.1:1/v1'})};
 const client={inspect:async request=>({results:request.basis.rules.map(r=>({ruleId:r.id,verdict:'符合',reason:'合成已核对资料',confidence:0.55,evidence:[2],evidenceQuotes:[{turnId:2,quote:request.session.turns[1].text,role:'客服'}],conflictsWith:[],referenceIds:[referenceKey(request.basis.policies.find(p=>r.policyIds.includes(p.id)))]})),modelId:'synthetic-rule-calibration',requestId:'synthetic',promptVersion:'qa-ark-v1'})};
 const ai=await createAiService({store,modelConfig:config,client,maxAttempts:1});t.after(async()=>{await ai.close();await store.close();assert.ok(dataDir.startsWith(root+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const catalog=createCatalog();await store.save({baseRevision:0,mutationId:'init',state:createBusinessState(),catalog});let serial=0;
 const save=async state=>{const doc=await store.read();return store.save({baseRevision:doc.revision,mutationId:'change-'+(++serial),state,catalog:doc.catalog});};
 const add=async(name,count,version=1)=>{
  const doc=await store.read(),source=await store.putSource(Buffer.from('synthetic original '+name),name+'.json'),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-16',ruleIds:['R004','R001']});
  const sessions=Array.from({length:count},(_,i)=>({id:name+i,scene:'新品产品咨询',startedAt:'2026-11-01T09:00:00+08:00',topic:'合成咨询',channel:'合成渠道',product:'合成产品',agent:'合成客服',customer:'合成客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'请提供合成资料 '+name+i},{id:2,role:'客服',text:'我先核对正式资料。合成回复 '+name+i}]}));
  const policy=version===2?{version:2,mode:'rule-calibrated',enabled:true,calibrationStatus:'per-rule',rules:[]}:{enabled:false};
  const state=createImportedTask(doc.state,{name,sessions,source,basisSnapshot,reviewer:'合成审核员',reviewPolicy:policy});await save(state);const taskId=state.tasks[0].id;await ai.start(taskId,'run-'+name);await ai.waitForIdle();const after=await store.read();assert.equal(after.state.tasks.find(t=>t.id===taskId).aiStatus,'completed');return taskId;
 };
 const train=await add('TRAIN',3),validation=await add('VALIDATE',30);
 let doc=await store.read(),state=doc.state;for(const taskId of [train,validation])for(const [index,row]of state.sessions.filter(s=>s.taskId===taskId).entries()){
  if(taskId===validation&&index>=24)state=saveReview(state,row.id,{...row.aiResults[0],verdict:'不符合',reason:'合成人工纠正'},new Date().toISOString());state=confirmReview(state,row.id,new Date().toISOString());
 }
 await save(state);const preview=await store.calibrationPreview({trainingTaskIds:[train],validationTaskIds:[validation]});assert.equal(preview.groups[0].pairCount,30);assert.equal(preview.groups[0].correctCount,24);
 doc=await store.calibrate({action:'calibrate',trainingTaskIds:[train],validationTaskIds:[validation],actor:'合成标定员'});const record=doc.state.ruleCalibrations.records[0];assert.equal(record.enabled,false);
 if(process.env.CALIBRATION_UI_FIXTURE){const target=path.resolve(process.env.CALIBRATION_UI_FIXTURE);assert.ok(target.startsWith(path.resolve('../outputs/service0107-20261116')+path.sep));await fs.mkdir(target,{recursive:true});await fs.copyFile(path.join(dataDir,'workspace.json'),path.join(target,'workspace.json'));await fs.cp(path.join(dataDir,'sources'),path.join(target,'sources'),{recursive:true});}
 await store.calibrate({id:record.id,action:'enable',actor:'合成标定员',reason:'合成80%边界验收'});
 const run=await add('RUNTIME',7,2);doc=await store.read();const task=doc.state.tasks.find(t=>t.id===run),rows=doc.state.sessions.filter(s=>s.taskId===run);
 assert.equal(task.reviewPolicy.rules.length,1);assert.equal(rows.filter(s=>s.aiDecision.ruleDecisions[0].status==='sample').length,5);const exempt=rows.find(s=>s.aiDecision.ruleDecisions[0].status==='exempt'),sample=rows.find(s=>s.aiDecision.ruleDecisions[0].status==='sample');assert.equal(rows.filter(isAIFinal).length,0);assert.equal(exempt.aiDecision.ruleDecisions.find(r=>r.ruleId==='R001').status,'manual');
 const routing=freezeReviewRouting(exempt,task);assert.deepEqual(routing.exemptRuleIds,['R004']);assert.equal(routing.aiFinal,false);
 const report={reviewPolicy:task.reviewPolicy,records:[{id:exempt.id,routing}],resultScope:'final'};assert.doesNotMatch(triageReportNotice(report),/undefined|尚未.*标定|0\.9/);assert.match(resultProvenanceSheet(report).rows[0].join(' '),/逐规则标定/);
 const originalDecisions=JSON.stringify(rows.map(s=>s.aiDecision));state=confirmReview(doc.state,exempt.id,new Date().toISOString());doc=await save(state);const mixed=doc.state.sessions.find(s=>s.id===exempt.id);assert.deepEqual(Object.keys(mixed.review.drafts),['R001']);assert.equal(getSessionResults(mixed).find(r=>r.ruleId==='R004').final.source,'AI规则免审');const sheets=await readXlsx(await buildResultXlsx(doc.state,{taskId:run})),details=sheets['结果明细'],headers=details[0],aiRow=details.find((r,i)=>i&&r[2]===mixed.id&&r[5]==='R004'),humanRow=details.find((r,i)=>i&&r[2]===mixed.id&&r[5]==='R001');assert.equal(aiRow[headers.indexOf('最终判定来源')],'AI规则免审');assert.equal(aiRow[headers.indexOf('人工最终结论')],'');assert.equal(aiRow[headers.indexOf('审核人')],'');assert.equal(humanRow[headers.indexOf('最终判定来源')],'人工确认');state=saveReview(doc.state,sample.id,{...sample.aiResults[0],verdict:'不符合',reason:'合成强制抽检发现错误'},new Date().toISOString());state=confirmReview(state,sample.id,new Date().toISOString());doc=await save(state);
 assert.equal(doc.state.ruleCalibrations.records[0].enabled,false);assert.ok(doc.state.ruleCalibrations.records[0].invalidatedAt);assert.equal(doc.state.sessions.filter(s=>s.taskId===run&&isAIFinal(s)).length,0);
 assert.equal(getSessionResults(doc.state.sessions.find(s=>s.id===exempt.id))[0].final,null);assert.equal(doc.state.sessions.find(s=>s.id===exempt.id).review.status,'已暂存');assert.equal(JSON.stringify(doc.state.sessions.filter(s=>s.taskId===run).map(s=>s.aiDecision)),originalDecisions);
 await store.validateIntegrity();
});
