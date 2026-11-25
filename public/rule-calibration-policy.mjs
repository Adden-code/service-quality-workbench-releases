import {languageCalibrationScope} from './workspace-language.mjs';
import {classificationNeedsJudgment} from './ecommerce-classification-review.mjs';
const clone=v=>structuredClone(v);
import {ruleExecutionScope} from './scene-rule-execution.mjs';
export const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
export const RULE_CALIBRATION_CONTRACT='rule-pairs-80-30.v1';
export function calibrationScope(task){
 const fields=['id','version','title','category','scope','passCriteria','failCriteria','exceptionCriteria','policyIds','ruleKind'];
 return {...languageCalibrationScope(task),...(task.basisSnapshot?.businessProfile?{ecommerceExecution:task.basisSnapshot.businessProfile}:{}),contract:RULE_CALIBRATION_CONTRACT,scene:task.scene,scenario:task.scenarioSnapshot||null,inputMode:task.inputMode||'structured',rawImportOptions:task.rawImportOptions?{timePolicy:task.rawImportOptions.timePolicy,productDefault:task.rawImportOptions.productDefault}:null,
  ...(task.executionSnapshot?{sceneExecution:{...ruleExecutionScope(task.executionSnapshot.configuration),contract:task.executionSnapshot.contract,mode:task.executionSnapshot.configuration.executionMode,capabilities:task.executionSnapshot.configuration.capabilities,timingPolicy:task.executionSnapshot.configuration.timingPolicy,ruleDependencies:task.executionSnapshot.configuration.ruleDependencies,timingRuleMetrics:task.executionSnapshot.configuration.timingRuleMetrics||{},inspectionLanguage:task.executionSnapshot.configuration.inspectionLanguage||'zh',taxonomy:task.executionSnapshot.taxonomy,exceptions:task.executionSnapshot.exceptions,parameters:Object.fromEntries(Object.entries(task.executionSnapshot.runtime.values).filter(([k])=>!['reviewMode','legacyConfidenceThreshold','outputLanguages'].includes(k))),timingStandards:task.executionSnapshot.runtime.timingStandards}}:{}),
  rules:(task.basisSnapshot?.rules||[]).map(rule=>Object.fromEntries(fields.filter(k=>rule[k]!==undefined).map(k=>[k,rule[k]]))),policies:(task.basisSnapshot?.policies||[]).map(p=>({id:p.id,version:p.version,sections:p.sections}))};
}
export function calibratedReviewPolicy(state,task,{enabled=true}={}){
 const scope=calibrationScope(task),rules=(state.ruleCalibrations?.records||[]).filter(r=>r.enabled&&!r.forbidden&&!r.invalidatedAt&&r.pairCount>=30&&r.correctCount/r.pairCount>=0.8&&stable(r.scope)===stable(scope)).map(r=>({ruleId:r.ruleId,ruleVersion:r.ruleVersion,calibrationId:r.id,modelFingerprint:r.modelFingerprint,promptVersion:r.promptVersion,pairCount:r.pairCount,correctCount:r.correctCount}));
 return{version:2,mode:'rule-calibrated',enabled,calibrationStatus:'per-rule',rules,sampling:{rate:0.05,minimum:5,scope:'rule-batch',method:'seeded-rank-v1'}};
}
export function normalizeCalibratedPolicy(input){
 const allowed=['version','mode','enabled','calibrationStatus','rules','sampling'];
 if(!input||Object.keys(input).some(k=>!allowed.includes(k))||input.version!==2||input.mode!=='rule-calibrated'||typeof input.enabled!=='boolean'||input.calibrationStatus!=='per-rule'||!Array.isArray(input.rules)||input.rules.length>500)throw new Error('规则级免审策略格式无效。');
 if(input.sampling&&stable(input.sampling)!==stable({rate:0.05,minimum:5,scope:'rule-batch',method:'seeded-rank-v1'}))throw new Error('抽检必须为每规则每批5%，且不少于5条；不足5条全部抽检。');
 const ids=new Set();for(const r of input.rules){if(!r||Object.keys(r).some(k=>!['ruleId','ruleVersion','calibrationId','modelFingerprint','promptVersion','pairCount','correctCount'].includes(k))||!['ruleId','ruleVersion','calibrationId','modelFingerprint','promptVersion'].every(k=>typeof r[k]==='string'&&r[k])||!Number.isSafeInteger(r.pairCount)||r.pairCount<30||!Number.isSafeInteger(r.correctCount)||r.correctCount>r.pairCount||r.correctCount/r.pairCount<0.8||ids.has(r.ruleId))throw new Error('规则免审必须绑定独立验证不少于30对且一致率不低于80%的标定。');ids.add(r.ruleId);}
 return clone(input);
}
export function ruleExemption(session,ruleId){
 if(classificationNeedsJudgment(session,ruleId))return null;
 if(session.review?.drafts?.[ruleId])return null;
 if(session.reviewPolicy?.version!==2||!session.reviewPolicy.enabled||session.review?.returned||session.aiExecution?.status!=='completed'||session.aiDecision?.runId!==session.aiExecution.runId)return null;
 const entry=session.aiDecision?.ruleDecisions?.find(r=>r.ruleId===ruleId);
 if(!entry||entry.status!=='exempt'||session.ruleCalibrationRevocations?.some(r=>r.calibrationId===entry.calibrationId))return null;
 return entry;
}
export function allRulesExempt(session){return Boolean(session.expectedRuleIds?.length&&session.expectedRuleIds.every(id=>ruleExemption(session,id)));}
export function calibrationStateLabel(record){return !record?'未标定':!record.invalidatedAt&&record.pairCount>=30&&record.correctCount/record.pairCount>=0.8?'已标定':'试标定';}

export function mandatorySampleCount(count){return Math.min(count,Math.max(5,Math.ceil(count*0.05)));}
export function samplingDescription(policy,english=false){return policy?.sampling?english?'5% per rule per batch, minimum 5 (all when fewer than 5)':'每规则每批5%，不少于5条（不足5条全检）':english?'Frozen legacy policy: 20%':'冻结旧策略：20%';}
export function sampleRank(text){let hash=2166136261;for(const ch of text){hash^=ch.codePointAt(0);hash=Math.imul(hash,16777619);}return hash>>>0;}
