import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createCatalog} from '../public/catalog.mjs';
import {createBusinessState,createImportedTask,acceptAI,saveReview,confirmReview,getSessionResults} from '../public/domain.mjs';
import {createBasisSnapshot,getSessionRules} from '../public/task-basis.mjs';
import {defaultScenePackage,validateScenePackage,validateSceneTemplate,resolveSceneRuntime,validateSceneTaxonomy} from '../public/scene-configuration.mjs';
import {inspectionBasis,derivedOverall,overallVerdict} from '../public/scene-aggregate.mjs';
import {sceneDeliverySnapshot,sceneDeliverySheets,buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {prepareRawInspection,parseRawInspectionResult,rawUnavailableResults} from '../server/raw-inspection.mjs';
import {rawSession} from './raw-contract-r16-fixtures.mjs';
import {calibrationScope} from '../public/rule-calibration-policy.mjs';
import {sceneAggregateNotice} from '../public/scene-review-view.mjs';
const now='2026-11-16T01:00:00Z',scene='新品产品咨询';
function fixture(){
 const catalog=createCatalog(),base=catalog.rules[0];catalog.rules=Array.from({length:17},(_,i)=>({...structuredClone(base),id:`NP-R${String(i+1).padStart(2,'0')}`,title:`SYNTHETIC ${i+1}`,category:i===0?'整体判定':i<12?'服务礼仪':i<14?'探需':'导购'}));
 const basis=createBasisSnapshot(catalog,{ruleIds:catalog.rules.map(r=>r.id),effectiveDate:now.slice(0,10),now}),pkg=defaultScenePackage({id:scene,name:scene,engine:'conversation'},basis);pkg.configuration.status='published';pkg.configuration.executionMode='configured';pkg.configuration.aggregateRuleId='NP-R01';pkg.template.renderMode='configured';pkg.template.columns=pkg.template.columns.filter(c=>c.ruleId!=='NP-R01');Object.assign(pkg.template.columns.find(c=>c.field==='overall'),{ruleId:'NP-R01',ruleVersion:'V1.0',enum:['符合','不符合','不适用','无法判定','未执行']});
 validateScenePackage(pkg,{publish:true});const state={...createBusinessState(),sceneConfigurationMigration:1,sceneConfigurations:[pkg.configuration],deliveryTemplates:[pkg.template],classificationTaxonomies:[],ruleExceptionTables:[],scenePackageDrafts:[],sceneConfigurationEvents:[]};return{catalog,basis,pkg,state};
}
function snapshot(pkg){return{configuration:pkg.configuration,template:pkg.template,runtime:resolveSceneRuntime(pkg.configuration),basis:pkg.configuration.basis};}
test('a taxonomy correction records the exact example, source label and confirmation without changing the original example',()=>{
 const t={schemaVersion:1,id:'SYN-TAX',sceneId:scene,version:1,labels:[{id:'stage',label:'Synthetic stage',parentId:'',definition:'Synthetic'},{id:'intent',label:'Synthetic intent',parentId:'stage',definition:'Synthetic'}],principles:['Synthetic principle'],examples:[{labelId:'intent',original:'Literal synthetic source',translated:'合成示例原译文',source:'Synthetic row 31'}],mappings:[{exampleIndex:0,originalLabel:'Synthetic original category',targetLabelId:'intent',source:'Synthetic row 31',reason:'User-confirmed synthetic mapping',actor:'Synthetic reviewer',confirmedAt:now}]};validateSceneTaxonomy(t);const bad=structuredClone(t);bad.mappings[0].targetLabelId='other';assert.throws(()=>validateSceneTaxonomy(bad),/目标类别/);assert.equal(t.examples[0].original,'Literal synthetic source');
});
test('17 frozen rules map to 16 checked columns plus one derived overall column, never duplicate R01',()=>{
 const {pkg,basis}=fixture();assert.equal(pkg.configuration.ruleBindings.length,17);assert.equal(pkg.template.columns.filter(c=>c.generator==='rule').length,16);assert.equal(inspectionBasis(basis,snapshot(pkg)).rules.length,16);assert.ok(!inspectionBasis(basis,snapshot(pkg)).rules.some(r=>r.id==='NP-R01'));assert.equal(basis.rules.length,17);
 const duplicate=structuredClone(pkg.template);duplicate.columns.push({...duplicate.columns.find(c=>c.field==='overall'),id:'duplicate-overall'});assert.throws(()=>validateSceneTemplate(duplicate,pkg.configuration),/重复|只能/);
 const independent=structuredClone(pkg.template);independent.columns.find(c=>c.field==='overall').generator='rule';assert.throws(()=>validateSceneTemplate(independent,pkg.configuration),/独立检核/);
 const missing=structuredClone(pkg.template);missing.columns=missing.columns.filter(c=>c.field!=='overall');assert.throws(()=>validateSceneTemplate(missing,pkg.configuration),/16.*17/);
 const old=structuredClone(pkg.configuration);delete old.aggregateRuleId;assert.equal(inspectionBasis(basis,{configuration:old}),basis,'old task contract must remain unchanged');
});
test('aggregate keeps Fail, unknown, not-executed, all-NA meanings separate and ignores any stale R01 input',()=>{
 const {pkg}=fixture(),s=snapshot(pkg),children=pkg.configuration.ruleBindings.filter(r=>r.ruleId!=='NP-R01');
 for(const [values,expected] of [[['不符合','无法判定'],'不符合'],[['符合','无法判定'],'无法判定'],[['符合','未执行'],'未执行'],[['符合','不适用'],'符合'],[['不适用'],'不适用']]){const rows=children.map((r,i)=>({...r,verdict:values[i%values.length]}));rows.push({ruleId:'NP-R01',verdict:'符合'});const result=derivedOverall(s,rows);assert.equal(result.verdict,expected);assert.equal(result.inputs.length,16);assert.equal(result.source,'program-derived');assert.equal(result.ruleVersion,'V1.0');}
 assert.equal(overallVerdict(['不适用','无法判定']),'无法判定');
});
test('raw model contract, accepted results and failed-row fallback all exclude the derived rule',()=>{
 const {pkg,basis}=fixture(),b=inspectionBasis(basis,snapshot(pkg)),s=rawSession('Customer: synthetic request\nAgent: synthetic response');
 const prepared=prepareRawInspection(s,b,{inspectionAt:now}),sent=JSON.parse(prepared.messages[1].content);assert.equal(sent.basis.rules.length,16);assert.ok(!sent.basis.rules.some(r=>r.id==='NP-R01'));
 const wire={recordId:s.id,results:b.rules.map(r=>({ruleId:r.id,verdict:'符合',reason:'Synthetic verified response',evidenceQuotes:[{quote:'synthetic response'}],turnRefs:[],referenceIds:[],confidence:.8,conflictsWith:[]}))};
 const parsed=parseRawInspectionResult(JSON.stringify(wire),{session:s,basis:b});assert.equal(parsed.length,16);assert.equal(derivedOverall(snapshot(pkg),parsed).verdict,'符合');
 wire.results.push({...wire.results[0],ruleId:'NP-R01'});assert.throws(()=>parseRawInspectionResult(JSON.stringify(wire),{session:s,basis:b}),/合同/);
 const failed=rawUnavailableResults(s,b);assert.equal(failed.length,16);assert.ok(!failed.some(r=>r.ruleId==='NP-R01'));assert.equal(derivedOverall(snapshot(pkg),failed).verdict,'无法判定');
});
test('model component projection preserves original catalog bodies and changes the calibration scope',()=>{
 const {pkg,basis}=fixture(),s=snapshot(pkg),task={scene,basisSnapshot:basis,executionSnapshot:s};const original=JSON.stringify(calibrationScope(task));
 pkg.configuration.ruleExecutionPolicies={'NP-R08':{mode:'missing-knowledge-or-model',reason:'Synthetic reference missing',modelCriteria:{passCriteria:'Check only explicit synthetic disclosure',failCriteria:'Explicit synthetic disclosure',exceptionCriteria:'Unknown collection permission'}}};
 validateScenePackage(pkg,{publish:true});const projected=inspectionBasis(basis,s);assert.equal(projected.rules.find(r=>r.id==='NP-R08').failCriteria,'Explicit synthetic disclosure');assert.notEqual(basis.rules.find(r=>r.id==='NP-R08').failCriteria,'Explicit synthetic disclosure');assert.notEqual(JSON.stringify(calibrationScope(task)),original);
 const bad=structuredClone(pkg);delete bad.configuration.ruleExecutionPolicies['NP-R08'].modelCriteria;assert.throws(()=>validateScenePackage(bad),/模型只检核/);
 const invalid=structuredClone(pkg);invalid.configuration.ruleExecutionPolicies['NP-R01']={mode:'missing-knowledge',reason:'Not a model rule'};assert.throws(()=>validateScenePackage(invalid),/字段/);
 const state={tasks:[{id:'t',executionSnapshot:s}]},html=sceneAggregateNotice(state,{taskId:'t'},projected.rules.map(r=>({ruleId:r.id,verdict:'符合',final:{verdict:r.id==='NP-R08'?'无法判定':'符合'}})));assert.match(html,/16/);assert.match(html,/当前子项汇总：无法判定/);assert.equal(sceneAggregateNotice({tasks:[]},{taskId:'old'},[]),'');
});
test('structured AI and human review persist only 16 items; human correction changes derived overall and audit without independent R01',async t=>{
 const f=fixture(),base=path.resolve('tests/.onboarding-scratch');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'aggregate-'));const store=await createWorkspaceStore({dataDir:dir});let ai;t.after(async()=>{await ai?.close();await store.close();assert.ok(dir.startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const source=await store.putSource(Buffer.from('Synthetic conversation only'),'synthetic.json'),session={id:'s',scene,startedAt:now,topic:'合成咨询',product:'合成产品',agent:'合成客服',channel:'合成',customer:'合成客户',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'合成客户',at:now,text:'合成咨询'},{id:2,role:'客服',speaker:'合成客服',at:now,text:'合成答复'}]};
 const state=createImportedTask(f.state,{name:'合成整体派生',fileName:source.name,sessions:[session],source,basisSnapshot:f.basis,reviewer:'合成复核人',now});assert.equal(state.sessions[0].expectedRuleIds.length,16);assert.equal(getSessionRules(state,state.sessions[0]).length,16);assert.equal(state.tasks[0].basisSnapshot.rules.length,17);await store.save({state,catalog:f.catalog,baseRevision:0,mutationId:'initial'});
 let requestIds;ai=await createAiService({store,modelConfig:{getPrivate:()=>({model:'synthetic-model',authMode:'none',baseUrl:'http://127.0.0.1:1',configured:true,connectionTested:true})},client:{inspect:async req=>{requestIds=req.basis.rules.map(r=>r.id);return{results:req.basis.rules.map(r=>({ruleId:r.id,verdict:r.id==='NP-R02'?'不符合':'符合',reason:'合成判定',evidence:[2],referenceIds:[],confidence:.8,conflictsWith:[]})),modelId:'synthetic-model'};}},maxAttempts:1});await ai.start(state.tasks[0].id,'synthetic-aggregate');await ai.waitForIdle();
 let saved=await store.read();assert.equal(saved.state.tasks[0].aiStatus,'completed');assert.equal(requestIds.length,16);assert.ok(!requestIds.includes('NP-R01'));assert.equal(saved.state.sessions[0].aiResults.length,16);assert.equal(derivedOverall(saved.state.tasks[0].executionSnapshot,saved.state.sessions[0].aiResults).verdict,'不符合');
 const id=saved.state.sessions[0].id;let reviewed=acceptAI(saved.state,id);assert.throws(()=>saveReview(reviewed,id,{ruleId:'NP-R01',verdict:'符合',reason:'不可独立修改',evidence:[2]}),/ruleId/);reviewed=saveReview(reviewed,id,{ruleId:'NP-R02',verdict:'符合',reason:'合成逐字复核后纠正',evidence:[2],referenceIds:[]});reviewed=confirmReview(reviewed,id);await store.save({state:reviewed,catalog:saved.catalog,baseRevision:saved.revision,mutationId:'review'});saved=await store.read();
 const task=saved.state.tasks[0],row=saved.state.sessions[0],records=[{id:row.id,product:row.product,final:getSessionResults(row).map(r=>({id:r.ruleId,verdict:r.final.verdict,reason:r.final.reason,source:'confirmed'}))}];const report={...sceneDeliverySnapshot(saved.state,task),taskId:task.id,taskName:task.name,source,records,original:{headers:['原文'],rows:[{recordId:row.id,sourceRow:2,values:['合成咨询 / 合成答复']}]}};
 const sheets=sceneDeliverySheets(report),audit=sheets.find(s=>s.name==='完整审计附页'),aggregate=sheets.find(s=>s.name==='整体派生留痕');assert.equal(audit.rows.length,16);assert.ok(audit.rows.every(r=>r[2]!=='NP-R01'));assert.equal(aggregate.rows.length,1);assert.equal(aggregate.rows[0][2],'NP-R01');assert.equal(aggregate.rows[0][4],'符合');assert.equal(JSON.parse(aggregate.rows[0][7]).length,16);assert.equal(sheets[0].rows[0].filter(x=>x==='整体通过').length,1);assert.match(buildSceneReportHtml(report),/整体派生留痕/);
 const withoutHuman=structuredClone(report);withoutHuman.records[0].final=rowsAsAI(row.aiResults);assert.equal(sceneDeliverySheets(withoutHuman).find(s=>s.name==='整体派生留痕').rows[0][4],'不符合','AI-only report must use AI components even after human correction');
 const voice=structuredClone(report);voice.sceneAudit[0].capabilities={outputs:{negativeVoice:{status:'completed',value:{hasNegative:true,text:'MODEL SUMMARY MUST NOT REPLACE ORIGINAL VOICE'},evidence:[{quote:'Literal synthetic complaint'}]}}};const table=sceneDeliverySheets(voice).find(s=>s.name==='全部业务列');assert.equal(table.rows[0][table.headers.indexOf('用户负面原声')],'Literal synthetic complaint');
});
function rowsAsAI(results){return results.map(r=>({id:r.ruleId,verdict:r.verdict,reason:r.reason,source:'ai'}));}
