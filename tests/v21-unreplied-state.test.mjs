import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../public/domain.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';
import {EC_RULE_IDS,ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';
import {sourceRow,publishedFixture,cutoff} from './v21-runtime-fixtures.mjs';

function stateFixture(){
 const basis=publishedFixture().state.tasks[0].basisSnapshot;
 const s={...sourceRow({reply:'',replyAt:''}),id:'STAGE-A-S1',externalId:sourceRow().id,taskId:'STAGE-A',expectedRuleIds:[...EC_RULE_IDS],aiExecution:{status:'completed',runId:'stage-a-run'},review:{status:'待审核',reviewer:'原审核员',completedAt:null,drafts:{},notes:'',history:[]}};
 const result=timeJudgment(s,{basis,inspectionAt:cutoff});
 s.aiResults=[result,...EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'无法判定',reason:'无实际回复，未检查内容',evidence:[],referenceIds:[]}))];
 return{schemaVersion:1,tasks:[{id:'STAGE-A',mode:'manual',name:'虚构测试',createdAt:'2026-11-03T10:00:00+08:00',status:'待审核',progress:0,sessionIds:[s.id],basisSnapshot:structuredClone(basis),aiRun:{id:'stage-a-run',inspectionAt:cutoff}}],sessions:[s],activity:[]};
}
test('unreplied fact confirmation is explicit and never becomes quality pass',()=>{
 const state=stateFixture();assert.equal(typeof domain.confirmUnrepliedReview,'function');
 assert.equal(domain.canConfirmUnreplied(state,state.sessions[0]),true);
 const next=domain.confirmUnrepliedReview(state,'STAGE-A-S1','事实确认员','2026-11-03T13:00:00+08:00'),s=next.sessions[0];
 assert.equal(s.review.status,'已确认');assert.equal(s.review.disposition,'unreplied');assert.equal(s.review.reviewer,'事实确认员');assert.deepEqual(s.review.drafts,{});
 assert.equal(domain.getReviewDisposition(s),'unreplied');assert.equal(domain.isUnrepliedSession(next,s),true);
 const stats=domain.getDashboard(next,{period:'all'});assert.equal(stats.reviewedCount,1);assert.equal(stats.confirmedUnrepliedCount,1);assert.equal(stats.unrepliedCount,1);assert.equal(stats.passCount,0);assert.equal(stats.determinateReviewedCount,0);assert.equal(stats.qualityReviewedCount,0);
 assert.equal(domain.reopenReview(next,s.id,'2026-11-03T14:00:00+08:00').sessions[0].review.disposition,undefined);
});
test('unreplied fact path rejects forged facts and protects existing human quality drafts',()=>{
 assert.equal(typeof domain.canConfirmUnreplied,'function');const state=stateFixture();
 const forged=structuredClone(state);forged.sessions[0].aiResults[0].timeFacts.elapsedMs=1;assert.equal(domain.canConfirmUnreplied(forged,forged.sessions[0]),false);
 const forgedRef=structuredClone(state);forgedRef.sessions[0].aiResults[0].referenceIds=['EC-POLICY'];assert.equal(domain.canConfirmUnreplied(forgedRef,forgedRef.sessions[0]),false);
 const human=structuredClone(state);human.sessions[0].review.drafts['EC-TEXT']={ruleId:'EC-TEXT',verdict:'不符合',reason:'现有人工作业',evidence:[],referenceIds:[],source:'人工修改'};
 assert.equal(domain.canConfirmUnreplied(human,human.sessions[0]),false);assert.throws(()=>domain.confirmUnrepliedReview(human,human.sessions[0].id,'审核员','2026-11-03T13:00:00+08:00'),/事实|未回复|人工/);assert.equal(human.sessions[0].review.drafts['EC-TEXT'].verdict,'不符合');
 const legacy=structuredClone(state);delete legacy.tasks[0].basisSnapshot.ruleSetSnapshot;assert.equal(domain.canConfirmUnreplied(legacy,legacy.sessions[0]),false);assert.throws(()=>domain.confirmReview(legacy,legacy.sessions[0].id,'2026-11-03T13:00:00+08:00'),/无法判定|待补充/);
});
test('false unreplied timing and invalid start still permit confirming only the two-empty-fields fact',()=>{
 assert.equal(typeof domain.canConfirmUnreplied,'function');
 for(const mode of ['disabled','invalid-start']){
  const state=stateFixture(),s=state.sessions[0];
  if(mode==='disabled'){
   const ruleSetChanges={timeRule:{...structuredClone(state.tasks[0].basisSnapshot.ruleSetSnapshot.timeRule),unrepliedRule:false}};
   state.tasks[0].basisSnapshot=publishedFixture(undefined,{ruleSetChanges}).state.tasks[0].basisSnapshot;
  }
  else{s.ecommerce.raw[12]='invalid';Object.assign(s,ecommerceSourceProjection(s.ecommerce));}
  s.aiResults[0]=timeJudgment(s,{basis:state.tasks[0].basisSnapshot,inspectionAt:cutoff});
  assert.equal(s.aiResults[0].timeFacts.elapsedMs,null);assert.equal(domain.canConfirmUnreplied(state,s),true);
  const confirmed=domain.confirmUnrepliedReview(state,s.id,'事实确认员','2026-11-03T13:00:00+08:00');assert.equal(confirmed.sessions[0].review.disposition,'unreplied');assert.equal(domain.getDashboard(confirmed,{period:'all'}).passCount,0);
 }
});
test('mixed confirmed statistics count facts as reviewed but exclude them from the quality denominator',()=>{
 let state=stateFixture();state=domain.confirmUnrepliedReview(state,state.sessions[0].id,'事实确认员','2026-11-03T13:00:00+08:00');
 const s={...structuredClone(state.sessions[0]),...sourceRow({row:4}),id:'STAGE-A-S2',externalId:sourceRow({row:4}).id,taskId:state.tasks[0].id};
 s.aiResults=EC_RULE_IDS.map(ruleId=>({ruleId,verdict:'符合',reason:'虚构通过',evidence:[],referenceIds:[]}));s.review={status:'已确认',reviewer:'质量审核员',completedAt:'2026-11-03T13:00:00+08:00',drafts:Object.fromEntries(s.aiResults.map(r=>[r.ruleId,structuredClone(r)])),notes:'',history:[]};state.sessions.push(s);state.tasks[0].sessionIds.push(s.id);
 const stats=domain.getDashboard(state,{period:'all'});assert.equal(stats.reviewedCount,2);assert.equal(stats.qualityReviewedCount,1);assert.equal(stats.confirmedUnrepliedCount,1);assert.equal(stats.passCount,1);assert.equal(stats.passRate,100);
});
