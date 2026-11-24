import test from 'node:test';
import assert from 'node:assert/strict';
import {basis,row,fixture,sceneId} from './ec-target01121-fixtures.mjs';
import {upgradeEcommerceTargetBasis,upgradeEcommerceTargetCalibrationBasis,EC_TARGET_POLICY_VERSION,EC_TARGET_CALIBRATION_POLICY_VERSION,EC_TARGET_CALIBRATION_CRITERIA} from '../public/ecommerce-semantic-policy.mjs';
import {businessDuplicateGroups,businessDuplicateAssessment,businessReplySimilarity,validateBusinessDuplicateGroups,validateBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
import {mergeEcommerceResults,inspectEcommerceBatch} from '../server/ecommerce-engine.mjs';
import {planEcommerceComparisons} from '../server/ecommerce-comparison.mjs';
import {calibrationScope,calibratedReviewPolicy} from '../public/rule-calibration-policy.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
import {installEcommercePolicyUpgrade} from '../server/builtin-scene-upgrade.mjs';
import {installSceneSeed} from '../server/scene-seed.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {latestSceneConfiguration,validateSceneRegistry} from '../public/scene-configuration.mjs';
const clone=x=>structuredClone(x),v1=()=>upgradeEcommerceTargetBasis(basis()),v2=()=>upgradeEcommerceTargetCalibrationBasis(v1());
const ids=['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];
function session(n=1,{admin='Synthetic A',reply='Synthetic specific reply with usable followup',comment='Synthetic battery concern'}={}){
 const s=row({reply});s.id=`synthetic-${n}`;s.ecommerce.row=n+2;s.ecommerce.raw[8]=comment;s.ecommerce.raw[11]=admin;s.externalId=ecommerceRecordId(s.ecommerce);return {...s,...ecommerceSourceProjection(s.ecommerce)};
}
const answer=(verdict='符合',rules=ids)=>({results:rules.map(ruleId=>({ruleId,verdict:ruleId==='EC-TARGET'?verdict:'符合',reason:'Synthetic semantic evidence; not an accuracy evaluation',evidence:[2],referenceIds:[]}))});
function merged(sessions,b=v2(),verdict='符合'){
 return mergeEcommerceResults({sessions,basis:b,semanticResults:sessions.map(s=>({sessionId:s.id,...answer(verdict)})),duplicateGroups:[]});
}
const targets=output=>[...output.values()].map(results=>results.find(r=>r.ruleId==='EC-TARGET'));
test('v2 changes only TARGET, its policy section and similarity; v1 remains frozen and upgrades are idempotent',()=>{
 const old=v1(),before=clone(old),next=upgradeEcommerceTargetCalibrationBasis(old);validateBusinessEcommerceBasis(next);
 assert.deepEqual(old,before);assert.deepEqual(upgradeEcommerceTargetCalibrationBasis(next),next);assert.deepEqual(upgradeEcommerceTargetBasis(next),next);
 assert.equal(old.businessProfile.targetPolicyVersion,EC_TARGET_POLICY_VERSION);assert.equal(next.businessProfile.targetPolicyVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);
 assert.equal(next.rules.find(r=>r.id==='EC-TARGET').version,'V3.4');
 for(const r of old.rules)if(r.id!=='EC-TARGET')assert.deepEqual(next.rules.find(n=>n.id===r.id),r);
 for(const s of old.policies[0].sections)if(s.id!=='EC-TARGET-BUSINESS-1')assert.deepEqual(next.policies[0].sections.find(n=>n.id===s.id),s);
 for(const key of ['semanticPolicy','timing','privacy','structure'])assert.deepEqual(next.businessProfile[key],old.businessProfile[key]);
 assert.deepEqual(next.businessProfile.similarity,{method:'normalized-bigram-dice-v1',threshold:.85,minimumRecords:3,scope:'batch-administrator'});
 for(const change of [{minimumRecords:2},{scope:'batch'},{threshold:.86}]){const bad=clone(next);Object.assign(bad.businessProfile.similarity,change);assert.throws(()=>validateBusinessEcommerceBasis(bad),/相似度/);}
});
test('two replies are advisory in v2 and remain hard failure in v1',()=>{
 const sessions=[session(1),session(2)];
 assert.equal(businessDuplicateGroups(sessions,v1()).length,1);assert.equal(businessDuplicateGroups(sessions,v2()).length,0);
 for(const result of targets(merged(sessions))){assert.equal(result.verdict,'符合');assert.match(result.reason,/改进建议.*2条.*不作批次硬扣分/);assert.equal(result.batchEvidence,undefined);}
 for(const result of targets(merged(sessions,v1())))assert.equal(result.verdict,'不符合');
});
test('three replies require same nonempty administrator; distinct admins cannot combine',()=>{
 const same=[1,2,3].map(n=>session(n));assert.equal(businessDuplicateGroups(same,v2()).length,1);
 for(const result of targets(merged(same))){assert.equal(result.verdict,'不符合');assert.equal(result.batchEvidence[0].sessionIds.length,3);}
 const split=[session(1),session(2),session(3,{admin:'Synthetic B'})];assert.equal(businessDuplicateGroups(split,v2()).length,0);
 for(const result of targets(merged(split)))assert.equal(result.verdict,'符合');
 const distinct=[1,2,3].map(n=>session(n,{admin:`Admin ${n}`}));assert.equal(businessDuplicateAssessment(distinct,v2()).advisoryGroups.length,0);
});
test('missing administrators are never guessed and cannot erase a semantic failure',()=>{
 const sessions=[1,2,3].map(n=>session(n,{admin:''}));assert.equal(businessDuplicateGroups(sessions,v2()).length,0);
 for(const result of targets(merged(sessions))){assert.equal(result.verdict,'无法判定');assert.equal(result.comparisonAssessment.semanticVerdict,'符合');assert.match(result.reason,/管理员缺失/);}
 for(const result of targets(merged(sessions,v2(),'不符合')))assert.equal(result.verdict,'不符合');
});
test('physical-row clones cannot manufacture a third reply and forged duplicate groups are rejected',()=>{
 const sessions=[1,2,3].map(n=>session(n)),cloneRow=clone(sessions[1]);cloneRow.id='clone-row';
 assert.equal(businessDuplicateGroups([...sessions.slice(0,2),cloneRow],v2()).length,0);
 const good=businessDuplicateGroups(sessions,v2());assert.deepEqual(validateBusinessDuplicateGroups(good,sessions,v2()),good);
 assert.throws(()=>validateBusinessDuplicateGroups([{...good[0],sessionIds:sessions.slice(0,2).map(s=>s.id)}],sessions,v2()),/至少3/);
 assert.throws(()=>validateBusinessDuplicateGroups([{...good[0],sessionIds:[sessions[0].id,sessions[1].id,cloneRow.id]}],[...sessions,cloneRow],v2()),/不同真实来源/);
 const changed=clone(sessions);changed[2].ecommerce.raw[11]='Another administrator';assert.throws(()=>validateBusinessDuplicateGroups(good,changed,v2()),/同一非空管理员/);
});
test('A-B and B-C >=85% cannot chain into an A-C hard-failure witness',()=>{
 const base=Array.from({length:100},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
 const replies=[base.slice(0,90)+'甲'.repeat(10),base,'乙'.repeat(10)+base.slice(10)];
 assert.ok(businessReplySimilarity(replies[0],replies[1])>=.85);assert.ok(businessReplySimilarity(replies[1],replies[2])>=.85);assert.ok(businessReplySimilarity(replies[0],replies[2])<.85);
 const sessions=replies.map((reply,i)=>session(i+1,{reply})),assessment=businessDuplicateAssessment(sessions,v2());
 assert.equal(assessment.duplicateGroups.length,0);assert.equal(new Set(assessment.advisoryGroups.flatMap(g=>g.sessionIds)).size,3);
 assert.throws(()=>validateBusinessDuplicateGroups([{sessionIds:sessions.map(s=>s.id),kind:'similar',reason:'Synthetic forged chain'}],sessions,v2()),/每一对/);
});
test('85% is inclusive, lower scores do not qualify, and every member of larger groups has a valid witness',()=>{
 const base=Array.from({length:21},(_,i)=>String.fromCodePoint(0x4e00+i)).join(''),edge=base.slice(0,18)+'甲甲甲';
 assert.equal(businessReplySimilarity(base,edge),.85);assert.ok(businessReplySimilarity(base,base.slice(0,17)+'甲甲甲甲')<.85);
 assert.equal(businessDuplicateGroups([session(1,{reply:base}),session(2,{reply:edge}),session(3,{reply:edge})],v2()).length,1);
 const rows=Array.from({length:50},(_,i)=>session(i+1)),groups=businessDuplicateGroups(rows,v2());assert.equal(new Set(groups.flatMap(g=>g.sessionIds)).size,50);validateBusinessDuplicateGroups(groups,rows,v2());
});
test('comparison fingerprint includes administrator only in v2; old comparison plan stays stable',()=>{
 const a=[1,2,3].map(n=>session(n)),b=clone(a);b[2].ecommerce.raw[11]='Another admin';
 assert.notEqual(planEcommerceComparisons(a,{basis:v2()}).fingerprint,planEcommerceComparisons(b,{basis:v2()}).fingerprint);
 assert.equal(planEcommerceComparisons(a,{basis:v1()}).fingerprint,planEcommerceComparisons(b,{basis:v1()}).fingerprint);
 assert.equal(planEcommerceComparisons(a,{basis:v2()}).blocks.length,0);
});
test('v2 basis and prompt version invalidate inherited B6 exemptions without mutating old calibration',()=>{
 const old={scene:sceneId,basisSnapshot:v1()},next={scene:sceneId,basisSnapshot:v2()},record={id:'synthetic-b6',ruleId:'EC-TARGET',ruleVersion:'V3.3',enabled:true,pairCount:30,correctCount:30,scope:calibrationScope(old),modelFingerprint:'synthetic',promptVersion:EC_TARGET_POLICY_VERSION},state={ruleCalibrations:{records:[record]}};
 const before=clone(state);assert.equal(calibratedReviewPolicy(state,old).rules.length,1);assert.equal(calibratedReviewPolicy(state,next).rules.length,0);assert.deepEqual(state,before);
});
function gateway(produce=()=>answer()){
 const requests=[];return{requests,client:createArkClient({fetchImpl:async(u,o)=>{const request=JSON.parse(o.body);requests.push(request);return new Response(JSON.stringify({model:'synthetic-target',choices:[{finish_reason:'stop',message:{content:JSON.stringify(produce(request,requests.length))}}]}),{headers:{'content-type':'application/json'}});}})};
}
const config={model:'synthetic-target',authMode:'none',baseUrl:'http://127.0.0.1:1'};
function check(request){
 const content=request.messages[0].content;assert.match(content,/复述夸赞＋感谢＋祝福=不符合/);assert.match(content,/泛泛道歉＋渠道=不符合/);assert.match(content,/具体说明＋正式渠道不要求额外详细方案/);assert.doesNotMatch(content,/例5 评论“很好”/);
 assert.equal(JSON.parse(request.messages[1].content).basis.businessProfile.targetPolicyVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);
 assert.deepEqual(JSON.parse(request.messages[1].content).basis.businessProfile.similarity,v2().businessProfile.similarity);
}
test('actual request and retry carry v2 policy and original output schema; no keyword-based verdict rewriting',async()=>{
 const {client,requests}=gateway((r,n)=>n===1?{results:[]}:answer());
 await assert.rejects(client.inspectEcommerceRow({config,session:session(),basis:v2()}),{code:'INVALID_OUTPUT'});
 const result=await client.inspectEcommerceRow({config,session:session(),basis:v2()});requests.forEach(check);assert.equal(result.promptVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);assert.equal(result.results.find(r=>r.ruleId==='EC-TARGET').verdict,'符合');assert.deepEqual(Object.keys(result.results[0]),['ruleId','verdict','reason','evidence','referenceIds']);
});
test('v1 prompt remains v1, while generic/batch/recovery entry points select frozen v2',async()=>{
 const old=gateway();await old.client.inspectEcommerceRow({config,session:session(),basis:v1()});assert.match(old.requests[0].messages[0].content,/例5 评论“很好”/);assert.doesNotMatch(old.requests[0].messages[0].content,/第二轮校准/);
 const general=gateway(()=>answer('符合',v2().rules.map(r=>r.id)));await general.client.inspect({config,session:session(),basis:v2()});check(general.requests[0]);
 const sessions=[session(1),session(2)],batch=gateway(()=>({records:sessions.map(s=>({sessionId:s.id,...answer()})),duplicateGroups:[],checkedSessionIds:sessions.map(s=>s.id)}));
 await batch.client.inspectEcommerce({config,sessions,basis:v2()});check(batch.requests[0]);assert.match(batch.requests[0].messages[0].content,/duplicateGroups必须返回空数组/);
 const recovery=gateway(()=>answer('符合',['EC-STEPS']));await recovery.client.inspectEcommerceRow({config,session:session(),basis:v2(),ruleIds:['EC-STEPS']});check(recovery.requests[0]);assert.deepEqual(JSON.parse(recovery.requests[0].messages[1].content).basis.rules.map(r=>r.id),['EC-STEPS']);
});
test('shared config contract includes positive incremental and complaint explanation boundaries',()=>{
 assert.match(EC_TARGET_CALIBRATION_CRITERIA.passCriteria,/产品解释、使用建议、个性化处理或后续跟进安排/);
 assert.match(EC_TARGET_CALIBRATION_CRITERIA.passCriteria,/不要求已解决、详细流程或承诺时限/);
 assert.match(EC_TARGET_CALIBRATION_CRITERIA.failCriteria,/泛泛道歉＋联系渠道/);
 assert.match(EC_TARGET_CALIBRATION_CRITERIA.exceptionCriteria,/仅2条相似回复只给改进建议/);
});
test('direct whole-batch executor uses deterministic v2 witnesses even when model returns no duplicate groups',async()=>{
 const sessions=[session(1),session(2),session(3)],g=gateway(()=>({records:sessions.map(s=>({sessionId:s.id,...answer()})),duplicateGroups:[],checkedSessionIds:sessions.map(s=>s.id)}));
 const result=await inspectEcommerceBatch({sessions,basis:v2(),client:g.client,config});assert.equal(result.promptVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);for(const r of targets(result.outputs))assert.equal(r.verdict,'不符合');
});
function seedWith(seed,upgrade){const next=clone(seed),p=next.packages[1];next.id+='-target';p.configuration.basis=upgrade(p.configuration.basis);p.configuration.ruleBindings=p.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));for(const column of p.template.columns)if(column.ruleId)column.ruleVersion=p.configuration.ruleBindings.find(r=>r.ruleId===column.ruleId).ruleVersion;return next;}
test('manual publication appends v2, preserves old tasks/local threshold, rejects tampered seed and does not downgrade',()=>{
 const f=fixture(),oldSeed=seedWith(f.newSeed,upgradeEcommerceTargetBasis),newSeed=seedWith(oldSeed,upgradeEcommerceTargetCalibrationBasis);
 const document={catalog:f.catalog,state:installSceneSeed(createBusinessState(),f.catalog,oldSeed,{now:f.input.now})};
 const current=latestSceneConfiguration(document.state,sceneId);current.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors=2;
 const before=clone(document),input={...f.input,sceneSeed:newSeed},updated=installEcommercePolicyUpgrade(document,input),next=latestSceneConfiguration(updated.state,sceneId);
 assert.deepEqual(document,before);assert.deepEqual(updated.state.tasks,before.state.tasks);assert.deepEqual(updated.catalog,before.catalog);assert.deepEqual(updated.state.sceneConfigurations.slice(0,-1),before.state.sceneConfigurations);
 assert.equal(next.basis.businessProfile.targetPolicyVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);assert.equal(next.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
 assert.ok(updated.state.sceneConfigurationEvents.at(-1).diff.some(d=>d.path.endsWith('similarity')));validateSceneRegistry(updated.state,document.state,{trustedScene:true});
 const bad=clone(newSeed);bad.packages[1].configuration.basis.rules.find(r=>r.id==='EC-TARGET').passCriteria='Synthetic obsolete';assert.throws(()=>installEcommercePolicyUpgrade(document,{...input,sceneSeed:bad}),/正文不一致/);
 const badPolicy=clone(newSeed);badPolicy.packages[1].configuration.basis.policies[0].sections.find(s=>s.id==='EC-TARGET-BUSINESS-1').text='Synthetic obsolete section';assert.throws(()=>installEcommercePolicyUpgrade(document,{...input,sceneSeed:badPolicy}),/正文不一致/);
 assert.throws(()=>installEcommercePolicyUpgrade(updated,{...input,expectedVersion:2,operationId:'repeat'}),/已装载/);
 assert.throws(()=>installEcommercePolicyUpgrade(updated,{...input,sceneSeed:oldSeed,expectedVersion:2,operationId:'downgrade'}),/已装载/);
});
test('durable queue freezes v2 comparison and prompt version, persists pair advice and three-row failures across restart',async t=>{
 const fs=await import('node:fs/promises'),path=await import('node:path');
 const {createImportedTask}=await import('../public/domain.mjs'),{createCatalog}=await import('../public/catalog.mjs'),{defaultScenePackage,SCENE_COLLECTIONS,sceneBasisForTask}=await import('../public/scene-configuration.mjs'),{createWorkspaceStore}=await import('../server/workspace-store.mjs'),{createAiService}=await import('../server/ai-service.mjs'),{workbook}=await import('../public/io.mjs'),{parseEcommerceFile}=await import('../public/ecommerce-input.mjs'),{EC_HEADERS}=await import('../public/ecommerce-schema.mjs');
 const state=createBusinessState(),catalog=createCatalog(),pkg=defaultScenePackage({id:sceneId,name:'Synthetic v2 EC',engine:'ecommerce'},v2());pkg.configuration.status='published';pkg.configuration.executionMode='configured';pkg.template.renderMode='configured';SCENE_COLLECTIONS.forEach(k=>state[k]=[]);state.sceneConfigurations=[pkg.configuration];state.deliveryTemplates=[pkg.template];state.sceneConfigurationMigration=1;
 const root=path.resolve('tests/artifacts/ec-target01122');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'run-'));let store=await createWorkspaceStore({dataDir:dir}),service;
 t.after(async()=>{await service?.close();await store.close();assert.ok(dir.startsWith(root+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const rows=[session(1),session(2),session(3),session(4,{admin:'Synthetic B'}),session(5,{admin:'Synthetic B'})],bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),...rows.map(s=>s.ecommerce.raw)]}]));
 const parsed=await parseEcommerceFile({name:'synthetic-v2.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,'synthetic-v2.xlsx'),frozen=sceneBasisForTask(state,catalog,sceneId,'2026-11-24T00:00:00Z'),next=createImportedTask(state,{name:'Synthetic second calibration',fileName:'synthetic-v2.xlsx',sessions:parsed.sessions,source,basisSnapshot:frozen,reviewer:'Synthetic',now:'2026-11-24T00:00:00Z'});
 await store.save({state:next,catalog,baseRevision:0,mutationId:'synthetic-v2-task'});let calls=0;
 service=await createAiService({store,modelConfig:{getPrivate:()=>({...config,configured:true,connectionTested:true})},client:{inspectEcommerceRow:async({basis:received})=>{calls++;assert.equal(received.businessProfile.targetPolicyVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);return{...answer(),modelId:config.model,promptVersion:EC_TARGET_CALIBRATION_POLICY_VERSION};}},maxAttempts:1});
 await service.start(next.tasks[0].id,'synthetic-v2-run');await service.waitForIdle();const saved=await store.read();assert.equal(calls,5);assert.equal(saved.state.tasks[0].aiStatus,'completed',JSON.stringify(saved.state.tasks[0].aiQueue));assert.equal(saved.state.tasks[0].aiQueue.comparison.blocks.length,0);
 for(const s of saved.state.sessions){const target=s.aiResults.find(r=>r.ruleId==='EC-TARGET');assert.equal(s.aiExecution.promptVersion,EC_TARGET_CALIBRATION_POLICY_VERSION);assert.equal(target.verdict,s.ecommerce.raw[11]==='Synthetic A'?'不符合':'符合');if(s.ecommerce.raw[11]==='Synthetic B')assert.match(target.reason,/改进建议/);}
 await service.close();service=null;await store.close();store=await createWorkspaceStore({dataDir:dir});const reopened=await store.read();assert.deepEqual(reopened.state.sessions,saved.state.sessions);assert.deepEqual(reopened.state.tasks,saved.state.tasks);
});
