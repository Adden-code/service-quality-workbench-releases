import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSceneCapability,prepareSceneCapability,executeSceneCapabilities,recordCapabilityOutcomes} from '../server/scene-capabilities.mjs';
import {classificationReviewForm} from '../public/ecommerce-classification-review.mjs';
import {confirmReview} from '../public/domain.mjs';
import {isAIFinal,requiresHumanReview} from '../public/ai-triage.mjs';
import {getLocale,setLocale} from '../public/i18n.mjs';
const text='Synthetic: I recommend it, but the battery fails.';
const input={capability:'ecommerceClassification',rating:5,blocks:[{id:'b',text}],sites:[]};
const body=(value={polarity:'positive',vocKind:'substantive'},extra={})=>({status:'completed',value,confidence:'0.95',reason:'Synthetic mixed review',evidence:[{blockId:'b',quote:text,start:'95',end:'121'}],...extra});
test('classification prompt, correction and local schema state rating-independent polarity and legal pairs',()=>{
 for(const retry of [undefined,{code:'INVALID_OUTPUT'}]){const p=prepareSceneCapability(input,retry),system=p.messages[0].content;assert.match(system,/与评分高低无关/);assert.match(system,/positive.*vocKind=none/);assert.match(system,/uncertain.*value.*null/);assert.equal(p.responseFormat.type,'json_object');assert.ok(p.outputSchema.properties.value.anyOf[0].allOf);assert.ok(p.outputSchema.allOf);}
});
test('only the approved contradictory pair normalizes, original strings and repaired quote are audited',()=>{
 for(const rating of [1,2,3,4,5,null]){const raw=body(),before=structuredClone(raw),r=parseSceneCapability(JSON.stringify(raw),{...input,rating});assert.deepEqual(raw,before);assert.equal(r.value.polarity,'negative');assert.equal(r.value.vocKind,'substantive');assert.equal(r.value.evaluationType,rating===1?'差评':rating===2||rating===3?'中评':rating>=4?'好评负向':'无法判定');assert.equal(r.reason,before.reason);assert.equal(r.coercion.requiresHumanReview,true);assert.deepEqual(r.coercion.changes,[{field:'value.polarity',original:'positive',normalized:'negative',reasonCode:'substantive-negative-content'}]);assert.equal(r.evidence[0].locatorRepair.method,'unique-exact');assert.equal(r.confidence,.95);}
 for(const value of [{polarity:'positive',vocKind:'strong-negative'},{polarity:'invalid',vocKind:'substantive'},{polarity:'unknown',vocKind:'substantive'},{polarity:'positive',vocKind:'substantive',extra:'bad'}])assert.throws(()=>parseSceneCapability(JSON.stringify(body(value)),input));
 for(const polarity of ['positive','negative','invalid']){const r=parseSceneCapability(JSON.stringify(body({polarity,vocKind:'none'})),input);assert.equal(r.value.polarity,polarity);assert.equal(r.coercion,undefined);}
});
test('uncertain EC clears tentative value but remains uncertain and excludes invalid confidence or missing reason',()=>{
 const original={polarity:'positive',vocKind:'substantive'},r=parseSceneCapability(JSON.stringify(body(original,{status:'uncertain',evidence:[]})),input);assert.equal(r.status,'uncertain');assert.equal(r.value,null);assert.deepEqual(r.coercion.changes[0].original,original);assert.equal(r.coercion.changes[0].normalized,null);assert.equal(r.value?.evaluationType,undefined);
 assert.throws(()=>parseSceneCapability(JSON.stringify(body(original,{status:'uncertain',confidence:'high'})),input),/置信度/);assert.throws(()=>parseSceneCapability(JSON.stringify(body(original,{reason:''})),input),/理由/);
 assert.throws(()=>parseSceneCapability(JSON.stringify(body({text:'bad'},{status:'uncertain'})),{...input,capability:'demandSummary'}),/value必须为null/);
});
test('quote annotation preserves coercion and technical breaker still stops genuine malformed output',()=>{
 let caught;try{parseSceneCapability(JSON.stringify(body(undefined,{evidence:[{blockId:'b',quote:'not in original',start:0,end:2}]})),input);}catch(e){caught=e;}
 assert.equal(caught.unverifiedCandidate.value.evaluationType,'好评负向');assert.ok(caught.unverifiedCandidate.coercion);assert.equal(caught.unverifiedCandidate.origin,'unverified');
 let monitor={};for(let i=0;i<20;i++)monitor=recordCapabilityOutcomes(monitor,'s'+i,{outputs:{ecommerceClassification:parseSceneCapability(JSON.stringify(body()),input)}},{window:50,minimum:20,rate:.1});assert.equal(monitor.ecommerceClassification.technicalFailures,0);assert.equal(monitor.ecommerceClassification.paused,false);
 for(let i=0;i<4;i++)monitor=recordCapabilityOutcomes(monitor,'s'+i,{outputs:{ecommerceClassification:{status:'failed',errorCode:'INVALID_OUTPUT'}}},{window:50,minimum:20,rate:.1});assert.equal(monitor.ecommerceClassification.paused,true);
});
test('normalized classification remains human-only and uses business-readable bilingual review notices',()=>{
 const ai=parseSceneCapability(JSON.stringify(body()),input),s={id:'s',aiExecution:{status:'completed',runId:'r'},sceneCapabilities:{outputs:{ecommerceClassification:ai}},review:{status:'待审核',reviewer:'Synthetic',drafts:{}}};assert.equal(isAIFinal(s),false);assert.equal(requiresHumanReview(s),true);assert.throws(()=>confirmReview({sessions:[s]},'s','2026-11-19T00:00:00Z'),/分类人工复核/);
 const locale=getLocale();try{setLocale('zh');assert.match(classificationReviewForm(s),/已按组合规则修正为负向/);assert.doesNotMatch(classificationReviewForm(s),/substantive-negative-content/);const unknown=structuredClone(s);unknown.sceneCapabilities.outputs.ecommerceClassification=parseSceneCapability(JSON.stringify(body(undefined,{status:'uncertain',evidence:[]})),input);assert.match(classificationReviewForm(unknown),/<option value="" disabled selected>请选择评价类型/);setLocale('en');assert.match(classificationReviewForm(s),/corrected to negative/);}finally{setLocale(locale);}
});
