import test from 'node:test';
import assert from 'node:assert/strict';
import {basis,row,fixture,sceneId} from './ec-target01121-fixtures.mjs';
import {upgradeEcommerceTargetBasis,EC_TARGET_POLICY_VERSION,EC_TARGET_SPECIFIC_CRITERIA} from '../public/ecommerce-semantic-policy.mjs';
import {upgradeEcommerceTimingBasis} from '../public/ecommerce-timing-policy.mjs';
import {businessDuplicateGroups,validateBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
import {latestSceneConfiguration,validateSceneRegistry} from '../public/scene-configuration.mjs';
import {installEcommercePolicyUpgrade} from '../server/builtin-scene-upgrade.mjs';
import {installSceneSeed} from '../server/scene-seed.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
const clone=x=>structuredClone(x),config={model:'synthetic-target',authMode:'none',baseUrl:'http://127.0.0.1:1'};
const ids=['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];
function newSeed(old){const seed=clone(old);seed.id='synthetic-target01121';const p=seed.packages[1];p.configuration.basis=upgradeEcommerceTargetBasis(p.configuration.basis);p.configuration.ruleBindings=p.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));for(const col of p.template.columns)if(col.ruleId)col.ruleVersion=p.configuration.ruleBindings.find(r=>r.ruleId===col.ruleId).ruleVersion;return seed;}
test('target upgrade changes only TARGET and its policy section, preserves calibrated controls and is idempotent',()=>{
 const old=upgradeEcommerceTimingBasis(basis()),before=clone(old),next=upgradeEcommerceTargetBasis(old);validateBusinessEcommerceBasis(next);
 assert.deepEqual(old,before);assert.deepEqual(upgradeEcommerceTargetBasis(next),next);
 for(const r of old.rules)if(r.id!=='EC-TARGET')assert.deepEqual(next.rules.find(n=>n.id===r.id),r);
 for(const s of old.policies[0].sections)if(s.id!=='EC-TARGET-BUSINESS-1')assert.deepEqual(next.policies[0].sections.find(n=>n.id===s.id),s);
 for(const key of ['similarity','timing','structure','privacy','semanticPolicy'])assert.deepEqual(next.businessProfile[key],old.businessProfile[key]);
 assert.equal(next.businessProfile.targetPolicyVersion,EC_TARGET_POLICY_VERSION);assert.equal(next.rules.find(r=>r.id==='EC-TARGET').version,'V3.3');
 assert.match(next.rules.find(r=>r.id==='EC-TARGET').failCriteria,/WhatsApp/);
 const bad=clone(next);bad.businessProfile.targetPolicyVersion='unknown';assert.throws(()=>validateBusinessEcommerceBasis(bad),/回应口径无效/);
});
test('0.11.20 controlled publication updates TARGET without rewriting previous configuration/tasks or other rules',()=>{
 const f=fixture(),old=f.newSeed,bundle=newSeed(old),document={catalog:f.catalog,state:installSceneSeed(createBusinessState(),f.catalog,old,{now:f.input.now})};
 const before=clone(document),previous=latestSceneConfiguration(document.state,sceneId),input={...f.input,sceneSeed:bundle};
 const updated=installEcommercePolicyUpgrade(document,input),current=latestSceneConfiguration(updated.state,sceneId);
 assert.deepEqual(document,before);assert.deepEqual(updated.state.tasks,before.state.tasks);assert.deepEqual(updated.catalog,before.catalog);
 assert.deepEqual(updated.state.sceneConfigurations.slice(0,-1),before.state.sceneConfigurations);assert.equal(current.basis.businessProfile.targetPolicyVersion,EC_TARGET_POLICY_VERSION);
 for(const r of previous.basis.rules)if(r.id!=='EC-TARGET')assert.deepEqual(current.basis.rules.find(n=>n.id===r.id),r);
 const event=updated.state.sceneConfigurationEvents.at(-1);assert.ok(event.diff.some(d=>d.path.endsWith('targetPolicyVersion')));assert.ok(event.diff.some(d=>d.path.endsWith('EC-TARGET')));validateSceneRegistry(updated.state,document.state,{trustedScene:true});
 assert.throws(()=>installEcommercePolicyUpgrade(updated,{...input,expectedVersion:2,operationId:'repeat'}),e=>e.status===409&&/已装载/.test(e.message));
 const bad=clone(bundle);bad.packages[1].configuration.basis.rules.find(r=>r.id==='EC-TARGET').failCriteria='Synthetic obsolete policy';assert.throws(()=>installEcommercePolicyUpgrade(document,{...input,sceneSeed:bad}),e=>e.status===409&&/正文不一致/.test(e.message));
});
function session(n=1){const s=row();s.id='synthetic-'+n;s.ecommerce.row=n+2;s.externalId=ecommerceRecordId(s.ecommerce);return {...s,...ecommerceSourceProjection(s.ecommerce)};}
const answer=(ruleIds=ids)=>({results:ruleIds.map(ruleId=>({ruleId,verdict:ruleId==='EC-TARGET'?'不符合':'符合',reason:'Synthetic response, no model accuracy claim',evidence:[2],referenceIds:[]}))});
function gateway(produce=()=>answer()){const requests=[];return {requests,client:createArkClient({fetchImpl:async(u,o)=>{const request=JSON.parse(o.body);requests.push(request);return new Response(JSON.stringify({model:'synthetic-target',choices:[{finish_reason:'stop',message:{content:JSON.stringify(produce(request,requests.length))}}]}),{headers:{'content-type':'application/json'}});}})};}
const check=request=>{assert.match(request.messages[0].content,/纯致歉＋倾听表态＋通用渠道指引=不符合/);assert.match(request.messages[0].content,/例5/);assert.match(request.messages[0].content,/具体诉求：/);assert.equal(JSON.parse(request.messages[1].content).basis.businessProfile.targetPolicyVersion,EC_TARGET_POLICY_VERSION);};
test('actual request, re-dispatch after invalid response and trace version include frozen hard criterion',async()=>{
 const b=upgradeEcommerceTargetBasis(basis()),{client,requests}=gateway((r,n)=>n===1?{results:[]}:answer());
 await assert.rejects(client.inspectEcommerceRow({config,session:session(),basis:b}),{code:'INVALID_OUTPUT'});
 const result=await client.inspectEcommerceRow({config,session:session(),basis:b});assert.equal(result.promptVersion,EC_TARGET_POLICY_VERSION);requests.forEach(check);
 assert.deepEqual(Object.keys(result.results[0]),['ruleId','verdict','reason','evidence','referenceIds']);
});
test('historical tasks do not inherit target gate; row, whole batch and generic entry use new gate when frozen',async()=>{
 const b=basis(),next=upgradeEcommerceTargetBasis(b),s=session(),{client,requests}=gateway();
 await client.inspectEcommerceRow({config,session:s,basis:b});assert.doesNotMatch(requests[0].messages[0].content,/独立冻结针对性口径/);assert.equal(JSON.parse(requests[0].messages[1].content).basis.businessProfile.targetPolicyVersion,undefined);
 const batch=[session(1),session(2)],g=gateway(()=>({records:batch.map(s=>({sessionId:s.id,...answer()})),duplicateGroups:[],checkedSessionIds:batch.map(s=>s.id)}));
 const result=await g.client.inspectEcommerce({config,sessions:batch,basis:next});check(g.requests[0]);assert.equal(result.promptVersion,EC_TARGET_POLICY_VERSION);
 assert.deepEqual(businessDuplicateGroups(batch,b),businessDuplicateGroups(batch,next));
 const general=gateway(()=>answer(next.rules.map(r=>r.id)));await general.client.inspect({config,session:s,basis:next});check(general.requests[0]);
 const recovery=gateway(()=>answer(['EC-STEPS']));await recovery.client.inspectEcommerceRow({config,session:s,basis:next,ruleIds:['EC-STEPS']});assert.deepEqual(JSON.parse(recovery.requests[0].messages[1].content).basis.rules.map(r=>r.id),['EC-STEPS']);
});
test('seed/prompt criteria expose the same pass/fail boundaries without keyword-based automatic verdicts',()=>{
 assert.match(EC_TARGET_SPECIFIC_CRITERIA.passCriteria,/\(a\).*\(b\)/);assert.match(EC_TARGET_SPECIFIC_CRITERIA.exceptionCriteria,/不以出现WhatsApp等词机械判Fail/);
 assert.match(EC_TARGET_SPECIFIC_CRITERIA.exceptionCriteria,/原评论或回复缺失才为无法判定/);
});
