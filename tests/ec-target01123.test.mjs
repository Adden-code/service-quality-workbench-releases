import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {basis,row,fixture,sceneId,now} from './ec-target01121-fixtures.mjs';
import {upgradeEcommerceTargetBasis,upgradeEcommerceTargetCalibrationBasis,upgradeEcommerceTargetLimitedBasis,EC_TARGET_CALIBRATION_POLICY_VERSION,EC_TARGET_LIMITED_POLICY_VERSION,EC_TARGET_CALIBRATION_CRITERIA,EC_TARGET_LIMITED_CRITERIA} from '../public/ecommerce-semantic-policy.mjs';
import {businessDuplicateGroups,businessDuplicateAssessment,businessReplySimilarity,validateBusinessEcommerceBasis,validateBusinessDuplicateGroups} from '../public/ecommerce-business-profile.mjs';
import {ecommerceTargetGuidance} from '../server/ecommerce-semantic-prompt.mjs';
import {mergeEcommerceResults,inspectEcommerceBatch} from '../server/ecommerce-engine.mjs';
import {planEcommerceComparisons} from '../server/ecommerce-comparison.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createSpringAiFetch} from '../server/spring-ai-bridge.mjs';
import {ecommerceSourceProjection,ecommerceRecordId,EC_HEADERS} from '../public/ecommerce-schema.mjs';
import {installEcommercePolicyUpgrade} from '../server/builtin-scene-upgrade.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {prepareAutomaticBuiltinUpgrade,upgradeBuiltinOnStartup} from '../server/startup-builtin-upgrade.mjs';
import {latestSceneConfiguration,sceneBasisForTask} from '../public/scene-configuration.mjs';
import {createImportedTask,createBusinessState,saveReview,confirmReview} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {defaultScenePackage,SCENE_COLLECTIONS} from '../public/scene-configuration.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {isDependencyRecoveryTransition,dependencyStaleness} from '../public/scene-dependency-staleness.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {classificationDependentRuleIds,upgradeEcommerceTimingBasis} from '../public/ecommerce-timing-policy.mjs';
import {saveClassificationReview,classificationNeedsJudgment,classificationReviewForm} from '../public/ecommerce-classification-review.mjs';
import {saveInlineEcommerce} from '../public/ecommerce-inline-review.mjs';
const clone=x=>structuredClone(x),v2=()=>upgradeEcommerceTargetCalibrationBasis(upgradeEcommerceTargetBasis(basis())),v3=()=>upgradeEcommerceTargetLimitedBasis(v2()),ids=['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];
function session(n=1,{admin='Synthetic A',reply='Synthetic reply addressing clear screen',comment='Synthetic clear screen praise',evaluationType='好评正向',status='completed'}={}){
 const s=row({reply});s.id=`synthetic-${n}`;s.ecommerce.row=n+2;s.ecommerce.raw[8]=comment;s.ecommerce.raw[11]=admin;s.externalId=ecommerceRecordId(s.ecommerce);
 s.sceneCapabilities={outputs:{ecommerceClassification:{status,value:status==='completed'?{evaluationType,polarity:evaluationType==='无效评价'?'invalid':'positive',vocKind:'none'}:null,reason:'Synthetic classifier fixture'}}};return{...s,...ecommerceSourceProjection(s.ecommerce)};
}
const answer=(verdict='符合',rules=ids)=>({results:rules.map(ruleId=>({ruleId,verdict:ruleId==='EC-TARGET'?verdict:'符合',reason:'Synthetic supplied model answer; not a model accuracy claim',evidence:[2],referenceIds:[]}))});
const targets=outputs=>[...outputs.values()].map(results=>results.find(r=>r.ruleId==='EC-TARGET'));
const merged=(sessions,b=v3(),verdict='符合',extra={})=>mergeEcommerceResults({sessions,basis:b,semanticResults:sessions.map(s=>({sessionId:s.id,...answer(verdict)})),duplicateGroups:[],...extra});
const config={model:'synthetic-v3',authMode:'none',baseUrl:'http://127.0.0.1:1',timeoutMs:30000};
function gateway(produce=()=>answer(),bridge=false){
 const requests=[],fetchImpl=async(url,o)=>{requests.push({url,...JSON.parse(o.body)});return new Response(JSON.stringify({model:config.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(produce(requests.at(-1),requests.length))}}]}),{headers:{'content-type':'application/json'}});};
 return{requests,client:createArkClient({fetchImpl:bridge?createSpringAiFetch({fetchImpl,bridgeToken:'synthetic-bridge-token-'.padEnd(40,'x')}):fetchImpl})};
}
function checkV3(request){
 const prompt=request.messages[0].content,data=JSON.parse(request.messages[1].content);
 assert.match(prompt,/回应具体夸赞点即可/);assert.match(prompt,/好评完全未回应具体夸赞点且无相关增量信息才不符合/);assert.match(prompt,/无效评价语义不适用不能抹除批次重复失败/);
 assert.doesNotMatch(prompt,/复述夸赞＋感谢＋祝福=不符合|好评须有结合评价的增量信息|好评增量信息、负向具体说明和批次三条/);
 assert.equal(data.basis.businessProfile.targetPolicyVersion,EC_TARGET_LIMITED_POLICY_VERSION);assert.deepEqual(data.basis.businessProfile.similarity,v2().businessProfile.similarity);
}
test('v3 is a separate immutable revision; only TARGET and its policy section change from v2',()=>{
 const old=v2(),before=clone(old),next=upgradeEcommerceTargetLimitedBasis(old);validateBusinessEcommerceBasis(next);
 assert.deepEqual(old,before);assert.equal(next.businessProfile.targetPolicyVersion,EC_TARGET_LIMITED_POLICY_VERSION);assert.equal(next.rules.find(r=>r.id==='EC-TARGET').version,'V3.5');
 assert.deepEqual(upgradeEcommerceTargetLimitedBasis(next),next);assert.deepEqual(upgradeEcommerceTargetCalibrationBasis(next),next);assert.deepEqual(upgradeEcommerceTargetBasis(next),next);
 for(const r of old.rules)if(r.id!=='EC-TARGET')assert.deepEqual(next.rules.find(n=>n.id===r.id),r);
 for(const s of old.policies[0].sections)if(s.id!=='EC-TARGET-BUSINESS-1')assert.deepEqual(next.policies[0].sections.find(n=>n.id===s.id),s);
 const profile=clone(next.businessProfile);profile.targetPolicyVersion=EC_TARGET_CALIBRATION_POLICY_VERSION;assert.deepEqual(profile,old.businessProfile);
 for(const field of ['passCriteria','failCriteria']){const marker=field==='passCriteria'?'中差评/负向诉求：':'负向回复';assert.equal(EC_TARGET_LIMITED_CRITERIA[field].slice(EC_TARGET_LIMITED_CRITERIA[field].indexOf(marker)),EC_TARGET_CALIBRATION_CRITERIA[field].slice(EC_TARGET_CALIBRATION_CRITERIA[field].indexOf(marker)));}
 const negativeExamples=s=>s.split('\n').filter(line=>/^例[5-8] /.test(line));assert.deepEqual(negativeExamples(ecommerceTargetGuidance(EC_TARGET_LIMITED_POLICY_VERSION)),negativeExamples(ecommerceTargetGuidance(EC_TARGET_CALIBRATION_POLICY_VERSION)));
});
test('synthetic prompt boundary examples cover concrete repetition, one praised point, generic thanks, and invalid content',()=>{
 const prompt=ecommerceTargetGuidance(EC_TARGET_LIMITED_POLICY_VERSION);
 assert.match(prompt,/例1 好评.*明确回应具体夸赞点/);assert.match(prompt,/例3 .*完全未回应任何具体夸赞点，并且没有相关增量信息/);assert.match(prompt,/例4 .*回应一个具体夸赞点即可/);assert.match(prompt,/例9 .*单条EC-TARGET语义不适用/);
 assert.match(ecommerceTargetGuidance(EC_TARGET_CALIBRATION_POLICY_VERSION),/复述夸赞＋感谢＋祝福=不符合/);
});
test('actual generic, row, retry, batch, and targeted recovery requests share v3 while v2 stays frozen',async()=>{
 const retried=gateway((r,n)=>n===1?{results:[]}:answer());await assert.rejects(retried.client.inspectEcommerceRow({config,session:session(),basis:v3()}),{code:'INVALID_OUTPUT'});await retried.client.inspectEcommerceRow({config,session:session(),basis:v3()});retried.requests.forEach(checkV3);
 const generic=gateway(()=>answer('符合',v3().rules.map(r=>r.id)));await generic.client.inspect({config,session:session(),basis:v3()});checkV3(generic.requests[0]);
 const rows=[session(1),session(2)],batch=gateway(()=>({records:rows.map(s=>({sessionId:s.id,...answer()})),duplicateGroups:[],checkedSessionIds:rows.map(s=>s.id)}));await batch.client.inspectEcommerce({config,sessions:rows,basis:v3()});checkV3(batch.requests[0]);assert.match(batch.requests[0].messages[0].content,/duplicateGroups必须返回空数组/);
 const recovery=gateway(()=>answer('符合',['EC-STEPS']));await recovery.client.inspectEcommerceRow({config,session:session(),basis:v3(),ruleIds:['EC-STEPS']});checkV3(recovery.requests[0]);
 const old=gateway();await old.client.inspectEcommerceRow({config,session:session(),basis:v2()});assert.match(old.requests[0].messages[0].content,/复述夸赞＋感谢＋祝福=不符合/);assert.doesNotMatch(old.requests[0].messages[0].content,/有限校准/);
});
test('Spring AI bridge transports the exact shared v3 prompt without a separate legacy prompt',async()=>{
 const g=gateway(()=>answer(),true),result=await g.client.inspectEcommerceRow({config,session:session(),basis:v3()});checkV3(g.requests[0]);assert.match(g.requests[0].url,/\/internal\/chat\/completions$/);assert.equal(result.promptVersion,EC_TARGET_LIMITED_POLICY_VERSION);
});
test('invalid classification makes semantic TARGET NA but leaves other rules and v2 behavior intact',()=>{
 const s=session(1,{evaluationType:'无效评价',comment:'asdfgh'}),input=answer('不符合'),before=clone(input),out=mergeEcommerceResults({sessions:[s],basis:v3(),semanticResults:[{sessionId:s.id,...input}],duplicateGroups:[]});
 const result=targets(out)[0];assert.equal(result.verdict,'不适用');assert.equal(result.comparisonAssessment.semanticVerdict,'不适用');assert.match(result.reason,/批次重复子项仍/);assert.deepEqual(input,before);
 for(const id of ids.filter(id=>id!=='EC-TARGET'))assert.deepEqual(out.get(s.id).find(r=>r.ruleId===id),input.results.find(r=>r.ruleId===id));
 assert.equal(targets(merged([s],v2(),'不符合'))[0].verdict,'不符合');
 for(const status of ['failed','uncertain'])assert.equal(targets(merged([session(1,{evaluationType:'无效评价',status})],v3(),'不符合'))[0].verdict,'不符合');
 for(const missing of [{comment:''},{reply:''}])assert.equal(targets(merged([session(1,{evaluationType:'无效评价',...missing})]))[0].verdict,'无法判定');
});
test('invalid semantic NA never masks a three-record duplicate or missing administrator',()=>{
 const rows=[1,2,3].map(n=>session(n,{evaluationType:'无效评价',comment:'asdfgh'}));
 for(const result of targets(merged(rows,v3(),'不符合'))){assert.equal(result.verdict,'不符合');assert.equal(result.comparisonAssessment.semanticVerdict,'不适用');assert.equal(result.batchEvidence[0].sessionIds.length,3);}
 for(const result of targets(merged(rows.slice(0,2)))){assert.equal(result.verdict,'不适用');assert.match(result.reason,/改进建议/);assert.equal(result.batchEvidence,undefined);}
 const absent=session(9,{evaluationType:'无效评价',admin:''});assert.equal(targets(merged([absent]))[0].verdict,'无法判定');assert.equal(targets(merged([absent]))[0].comparisonAssessment.semanticVerdict,'不适用');
});
test('v3 duplicate witnesses retain every v2 boundary including 85 percent, distinct admins and no chain closure',()=>{
 const base=Array.from({length:21},(_,i)=>String.fromCodePoint(0x4e00+i)).join(''),edge=base.slice(0,18)+'甲甲甲';assert.equal(businessReplySimilarity(base,edge),.85);
 const exact=[1,2,3].map(n=>session(n)),edgeRows=[session(1,{reply:base}),session(2,{reply:edge}),session(3,{reply:edge})],split=[session(1),session(2),session(3,{admin:'Synthetic B'})];
 const long=Array.from({length:100},(_,i)=>String.fromCodePoint(0x4e00+i)).join(''),chain=[long.slice(0,90)+'甲'.repeat(10),long,'乙'.repeat(10)+long.slice(10)].map((reply,i)=>session(i+1,{reply}));
 const cloned=clone(exact[1]);cloned.id='clone';
 for(const rows of [exact,edgeRows,split,chain,[exact[0],exact[1],cloned]]){assert.deepEqual(businessDuplicateAssessment(rows,v3()),businessDuplicateAssessment(rows,v2()));validateBusinessDuplicateGroups(businessDuplicateGroups(rows,v3()),rows,v3());}
 assert.equal(businessDuplicateGroups(edgeRows,v3()).length,1);assert.equal(businessDuplicateGroups(chain,v3()).length,0);assert.equal(businessDuplicateGroups(split,v3()).length,0);
 assert.notEqual(planEcommerceComparisons(exact,{basis:v3()}).fingerprint,planEcommerceComparisons(exact,{basis:v2()}).fingerprint);
});
test('whole batch combines model NA with deterministic duplicate failure',async()=>{
 const rows=[1,2,3].map(n=>session(n,{evaluationType:'无效评价'})),g=gateway(()=>({records:rows.map(s=>({sessionId:s.id,...answer('不适用')})),duplicateGroups:[],checkedSessionIds:rows.map(s=>s.id)}));
 const result=await inspectEcommerceBatch({sessions:rows,basis:v3(),client:g.client,config});assert.equal(result.promptVersion,EC_TARGET_LIMITED_POLICY_VERSION);for(const t of targets(result.outputs))assert.equal(t.verdict,'不符合');
});
test('v3 human invalid-boundary correction requires a fresh TARGET judgment; v2 and other classifications retain scope',()=>{
 for(const [from,to,expected] of [['好评正向','无效评价',true],['无效评价','好评正向',true],['好评正向','好评负向',false],['无效评价','无效评价',false]]){
  const b=upgradeEcommerceTimingBasis(v3()),s=session(1,{evaluationType:from});s.aiResults=merged([s],b).get(s.id);s.expectedRuleIds=b.rules.map(r=>r.id);s.review.drafts=Object.fromEntries(s.aiResults.map(r=>[r.ruleId,{...clone(r),source:'AI接受'}]));
  const changed=saveClassificationReview({sessions:[s]},s.id,{evaluationType:to,vocKind:to==='好评负向'?'strong-negative':'none',reason:'Synthetic reviewed classification'},now).sessions[0];
  assert.equal(classificationNeedsJudgment(changed,'EC-TARGET'),expected,`${from}->${to}`);assert.equal(classificationNeedsJudgment(changed,'EC-TIME'),false);assert.deepEqual(changed.aiResults,s.aiResults);
  if(expected){assert.equal(changed.review.drafts['EC-TARGET'],undefined);assert.match(classificationReviewForm(changed),/classification-target-impact/);assert.throws(()=>confirmReview({sessions:[changed]},changed.id,now),/针对性/);changed.taskId='synthetic-review';assert.throws(()=>saveInlineEcommerce({sessions:[changed],tasks:[{id:changed.taskId,basisSnapshot:b}]},changed.id,{},now),/EC-TARGET/);}
  const old=clone(s);old.aiResults=merged([old],upgradeEcommerceTimingBasis(v2())).get(old.id);const legacy=saveClassificationReview({sessions:[old]},old.id,{evaluationType:to,vocKind:to==='好评负向'?'strong-negative':'none',reason:'Synthetic old policy review'},now).sessions[0];assert.equal(classificationNeedsJudgment(legacy,'EC-TARGET'),false);
 }
 const b=upgradeEcommerceTimingBasis(v3()),s=session();s.aiResults=merged([s],b).get(s.id);s.review.drafts={};let state=saveClassificationReview({sessions:[s]},s.id,{evaluationType:'无效评价',vocKind:'none',reason:'Synthetic invalid correction'},now),r=state.sessions[0];r.review.drafts['EC-TARGET']={source:'人工修改',verdict:'不适用'};r.review.history.push({ruleId:'EC-TARGET',at:now});
 const back=saveClassificationReview(state,s.id,{evaluationType:'好评正向',vocKind:'none',reason:'Synthetic return to source classification'},'2026-11-23T00:01:00Z').sessions[0];assert.equal(back.review.classification.changed,false);assert.equal(back.review.drafts['EC-TARGET'],undefined);assert.equal(classificationNeedsJudgment(back,'EC-TARGET'),true);
 assert.ok(classificationDependentRuleIds(back).includes('EC-TARGET'));
});

for(const scenario of ['invalid','duplicate','normal','human-protected','human-confirmed','auto-resume'])test(`v3 dependency recovery ${scenario} retains scope, duplicate evidence and audit across restart`,async t=>{
 const root=path.resolve('tests/artifacts/ec-target01123');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'recovery-'));let store=await createWorkspaceStore({dataDir:dir}),ai;
 t.after(async()=>{await ai?.close();await store.close();assert.ok(dir.startsWith(root+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const state=createBusinessState(),catalog=createCatalog(),b=upgradeEcommerceTimingBasis(v3()),p=defaultScenePackage({id:sceneId,name:'Synthetic v3 dependency',engine:'ecommerce'},b);
 p.configuration.status='published';p.configuration.executionMode='configured';p.configuration.capabilities=[{key:'ecommerceClassification',phase:'pre',executorVersion:'scene-capability.v1',dependsOn:[]}];p.configuration.ruleDependencies={'EC-STEPS':['ecommerceClassification'],'EC-TIME':[]};p.template.renderMode='configured';SCENE_COLLECTIONS.forEach(k=>state[k]=[]);state.sceneConfigurations=[p.configuration];state.deliveryTemplates=[p.template];state.sceneConfigurationMigration=1;
 const rows=Array.from({length:scenario==='auto-resume'?21:scenario==='duplicate'?3:1},(_,i)=>session(i+1,{comment:`Synthetic meaningless content ${i}`,admin:scenario==='auto-resume'?`Synthetic Admin ${i}`:'Synthetic A'}).ecommerce.raw),bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),...rows]}])),name='synthetic-recovery.xlsx',parsed=await parseEcommerceFile({name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,name),next=createImportedTask(state,{name:`Synthetic ${scenario}`,sessions:parsed.sessions,source,reviewer:'Synthetic reviewer',basisSnapshot:sceneBasisForTask(state,catalog,sceneId,now),now});await store.save({state:next,catalog,baseRevision:0,mutationId:'recovery-task'});
 let recovered=false,fullCalls=0,targetedCalls=0;const errors=[],client={inspectSceneCapability:async({input})=>{if(!recovered)throw Object.assign(new Error('Synthetic classification failure'),{code:'INVALID_OUTPUT'});const block=input.blocks[0],invalid=scenario!=='normal';return{status:'completed',value:{evaluationType:invalid?'无效评价':'好评正向',polarity:invalid?'invalid':'positive',vocKind:'none'},confidence:.95,reason:'Synthetic recovered classifier',evidence:[{blockId:block.id,quote:block.text,start:0,end:block.text.length}]};},inspectEcommerceRow:async({ruleIds})=>{if(ruleIds){targetedCalls++;assert.deepEqual(ruleIds,['EC-STEPS']);return{...answer('符合',ruleIds),modelId:config.model};}fullCalls++;return{...answer('不符合'),modelId:config.model};}};
 ai=await createAiService({store,modelConfig:{getPrivate:()=>({...config,configured:true,connectionTested:true})},client,maxAttempts:1,retryDelayMs:0,onError:e=>errors.push(String(e.stack||e))});await ai.start(next.tasks[0].id,'synthetic-recovery-run');await ai.waitForIdle();let before=await store.read();assert.equal(before.state.tasks[0].aiStatus,scenario==='auto-resume'?'paused':'completed',JSON.stringify(errors));const id=before.state.sessions[0].id;
 if(scenario.startsWith('human-')){let human=saveReview(before.state,id,{ruleId:'EC-TARGET',verdict:'不符合',reason:'Synthetic protected manual decision',evidence:[2]},new Date().toISOString());if(scenario==='human-confirmed'){human=saveClassificationReview(human,id,{evaluationType:'好评正向',vocKind:'none',reason:'Synthetic independent classification'},new Date().toISOString());for(const ruleId of ['EC-TIME',...ids])human=saveReview(human,id,{ruleId,verdict:ruleId==='EC-TARGET'?'不符合':'符合',reason:'Synthetic independent confirmed judgment',evidence:[2]},new Date().toISOString());human=confirmReview(human,id,new Date().toISOString());}await store.save({state:human,catalog:before.catalog,baseRevision:before.revision,mutationId:'protect-target'});before=await store.read();}
 const old=clone(before.state.sessions[0]),callsBefore=fullCalls;assert.equal(old.aiResults.find(r=>r.ruleId==='EC-TARGET').verdict,'不符合');recovered=true;if(scenario==='auto-resume'){await ai.resume(next.tasks[0].id);await ai.waitForIdle();}else await ai.retryDependencies(next.tasks[0].id,id);const after=await store.read(),actual=after.state.sessions[0],target=actual.aiResults.find(r=>r.ruleId==='EC-TARGET'),audit=after.state.tasks[0].aiQueue.rows[0].capabilityRecovery.at(-1);
 assert.deepEqual(errors,[]);assert.equal(fullCalls,scenario==='auto-resume'?rows.length:callsBefore);assert.equal(targetedCalls,scenario==='auto-resume'?callsBefore:1);assert.deepEqual(actual.aiExecution,old.aiExecution);
 if(scenario.startsWith('human-')){assert.deepEqual(actual,old);assert.equal(audit.protected,true);assert.equal(audit.candidateResults.find(r=>r.ruleId==='EC-TARGET').verdict,'不适用');assert.ok(dependencyStaleness(actual,after.state.tasks[0]).ruleIds.includes('EC-TARGET'));}
 else if(scenario==='normal'){assert.deepEqual(target,old.aiResults.find(r=>r.ruleId==='EC-TARGET'));assert.ok(!audit.appliedRuleIds.includes('EC-TARGET'));}
 else{assert.equal(target.verdict,scenario==='duplicate'?'不符合':'不适用');assert.equal(target.comparisonAssessment.semanticVerdict,'不适用');assert.deepEqual(target.batchEvidence,old.aiResults.find(r=>r.ruleId==='EC-TARGET').batchEvidence);assert.ok(audit.appliedRuleIds.includes('EC-TARGET'));const transition=clone(actual),decision=actual.sceneCapabilities.dependencyRecoveryHistory.at(-1).afterDecision;if(decision)transition.aiDecision=clone(decision);else delete transition.aiDecision;assert.equal(isDependencyRecoveryTransition(old,transition),true);const forged=clone(transition);forged.aiResults.find(r=>r.ruleId==='EC-TARGET').verdict='符合';assert.equal(isDependencyRecoveryTransition(old,forged),false);}
 await ai.close();ai=null;await store.close();store=await createWorkspaceStore({dataDir:dir});assert.deepEqual((await store.read()).state,after.state);
});
function seedWith(seed,upgrade,id){const next=clone(seed),p=next.packages[1];next.id=id;p.configuration.basis=upgrade(p.configuration.basis);p.configuration.ruleBindings=p.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));for(const c of p.template.columns)if(c.ruleId)c.ruleVersion=p.configuration.ruleBindings.find(r=>r.ruleId===c.ruleId).ruleVersion;return next;}
async function importTask(store,label){
 const sourceRow=session().ecommerce.raw;sourceRow[8]+=` ${label}`;const bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),sourceRow]}])),name=`synthetic-${label}.xlsx`,parsed=await parseEcommerceFile({name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,name),before=await store.read(),state=createImportedTask(before.state,{name:label,sessions:parsed.sessions,source,reviewer:'Synthetic reviewer',basisSnapshot:sceneBasisForTask(before.state,before.catalog,sceneId,now),now});const result=await store.save({state,catalog:before.catalog,baseRevision:before.revision,mutationId:`synthetic-import-${label}`});return result.state.tasks.find(t=>t.name===label);
}
test('startup persists only a new v3 scene, preserves frozen v2 task basis, new task selection changes, and downgrade is rejected',async t=>{
 const f=fixture(),oldSeed=seedWith(f.newSeed,b=>upgradeEcommerceTargetCalibrationBasis(upgradeEcommerceTargetBasis(b)),'synthetic-01122'),newSeed=seedWith(oldSeed,upgradeEcommerceTargetLimitedBasis,'synthetic-01123');
 const root=path.resolve('tests/artifacts/ec-target01123');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'startup-')),dataDir=path.join(dir,'workspace');let store=await createWorkspaceStore({dataDir,catalogSeed:f.catalog,sceneSeed:oldSeed});
 t.after(async()=>{await store.close();assert.ok(dir.startsWith(root+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const oldTask=await importTask(store,'before-v3'),before=await store.read(),oldBasis=oldTask.basisSnapshot,oldBasisCopy=clone(oldBasis),input={catalogSeed:f.catalog,sceneSeed:newSeed,productVersion:'0.11.23',now};
 const plan=prepareAutomaticBuiltinUpgrade(before,input);assert.deepEqual(plan.next.state.tasks,before.state.tasks);assert.deepEqual(oldBasis,oldBasisCopy);
 const result=await upgradeBuiltinOnStartup({store,dataDir,...input});assert.equal(result.status,'upgraded',JSON.stringify(result));const fresh=await importTask(store,'after-v3'),after=await store.read();assert.equal(fresh.basisSnapshot.businessProfile.targetPolicyVersion,EC_TARGET_LIMITED_POLICY_VERSION);assert.equal(fresh.executionSnapshot.configuration.basis.businessProfile.targetPolicyVersion,EC_TARGET_LIMITED_POLICY_VERSION);assert.deepEqual(after.state.tasks.find(t=>t.id===oldTask.id),oldTask);assert.deepEqual(oldBasis,oldBasisCopy);
 assert.equal((await upgradeBuiltinOnStartup({store,dataDir,...input})).status,'current');await store.close();store=await createWorkspaceStore({dataDir,catalogSeed:f.catalog,sceneSeed:newSeed});assert.deepEqual((await store.read()).state,after.state);
 const current=latestSceneConfiguration(after.state,sceneId);assert.throws(()=>installEcommercePolicyUpgrade(after,{...f.input,sceneSeed:oldSeed,expectedVersion:current.version}),/已装载/);
 const manual=installEcommercePolicyUpgrade(before,{...f.input,sceneSeed:newSeed});assert.equal(latestSceneConfiguration(manual.state,sceneId).basis.businessProfile.targetPolicyVersion,EC_TARGET_LIMITED_POLICY_VERSION);
 const tampered=clone(newSeed);tampered.packages[1].configuration.basis.rules.find(r=>r.id==='EC-TARGET').failCriteria=EC_TARGET_CALIBRATION_CRITERIA.failCriteria;assert.throws(()=>installEcommercePolicyUpgrade(before,{...f.input,sceneSeed:tampered}),/正文不一致/);
 assert.equal(prepareAutomaticBuiltinUpgrade(after,{...input,sceneSeed:oldSeed,productVersion:'0.11.24'}),null);
});
