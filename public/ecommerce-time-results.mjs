import {isBusinessEcommerceBasis,computeBusinessTimeFacts} from './ecommerce-business-profile.mjs';
import {ecommerceTimeValues} from './ecommerce-schema.mjs';
import {resolveTimeThreshold,timeDurationMs} from './working-time.mjs';
import {isFixed24EcommerceBasis,EC_FIXED24_TIMING_POLICY_VERSION} from './ecommerce-timing-policy.mjs';

export const TIME_EXECUTOR_VERSION='ec-stage-a-time-v1';
export const isStageATimeBasis=basis=>basis?.ruleSetSnapshot?.executionProfile==='v21-time-v1-content';

/** Local deterministic dependencies; these must never be projected into a model request. */
export function ecommerceTimeDependencies(session,basis,inspectionAt){
 if(isBusinessEcommerceBasis(basis))return {executorVersion:isFixed24EcommerceBasis(basis)?EC_FIXED24_TIMING_POLICY_VERSION:'ec-business-v1',inspectionAt:inspectionAt??null,businessProfile:basis.businessProfile,source:session.ecommerce};
 if(!isStageATimeBasis(basis))return null;
 const r=session.ecommerce;
 return{executorVersion:TIME_EXECUTOR_VERSION,inspectionAt,ruleSet:basis.ruleSetSnapshot,source:{reply:r.raw[9],commentTime:r.raw[12],replyTime:r.raw[13],evaluationType:r.raw[14],dateSystem:r.dateSystem??null}};
}

/** Recompute from the immutable source row and frozen rule set, never from saved/client facts. */
export function computeEcommerceTimeFacts(session,basis,{inspectionAt,runtime}={}){
 if(isBusinessEcommerceBasis(basis))return computeBusinessTimeFacts(session,basis,{inspectionAt,runtime,normalizedTimes:ecommerceTimeValues(session.ecommerce)});
 if(!isStageATimeBasis(basis))return null;
 const ruleSet=basis.ruleSetSnapshot,r=session.ecommerce,timeRule=ruleSet.timeRule;
 const resolved=resolveTimeThreshold(timeRule,r.raw[14]);
 const hasReply=Boolean(r.raw[9].trim()),hasReplyTime=Boolean(r.raw[13].trim());
 const {commentTime,replyTime}=ecommerceTimeValues(r);
 const replyStatus=!hasReply&&!hasReplyTime?'unreplied':hasReply&&!hasReplyTime?'missing-time':!hasReply&&hasReplyTime?'conflict':'replied';
 const facts={schemaVersion:1,ruleSetId:ruleSet.ruleSetId,version:ruleSet.version,mode:timeRule.mode,replyStatus,outcome:replyStatus==='unreplied'?'unreplied':'undetermined',inspectionAt:inspectionAt??null,startAt:commentTime,endAt:replyStatus==='unreplied'?(inspectionAt??null):replyTime,elapsedMs:null,thresholdHours:resolved.thresholdHours,thresholdSource:resolved.source,evaluationType:resolved.evaluationType,evaluationTypeSource:'source-column-O',calendarConfirmed:ruleSet.calendarConfirmed,calendarTimezone:timeRule.calendar?.timezone??null,reason:''};
 const typeLabel=resolved.evaluationType&&`${resolved.evaluationType.slice(0,120)}${resolved.evaluationType.length>120?'…':''}`;
 const fallback=resolved.source==='default'?`评价类型${typeLabel?`“${typeLabel}”未命中分类配置`:'缺失'}，使用规则集默认阈值${resolved.thresholdHours}小时。`: `原O列评价类型“${resolved.evaluationType}”，分类阈值${resolved.thresholdHours}小时。`;
 let reason=replyStatus==='unreplied'?'回复正文和首次回复时间均为空，记录未回复事实；此状态不作为质量通过或不通过。':replyStatus==='missing-time'?'有回复正文但首次回复时间为空，时间缺失待补充。':replyStatus==='conflict'?'首次回复时间存在但回复正文为空，来源字段冲突待核对。':'';
 if(replyStatus==='unreplied'&&timeRule.unrepliedRule===false){
  reason+='规则集已关闭未回复累计时长检核，未计算耗时；仍可独立确认两字段均为空的来源事实。';
 }else if(replyStatus==='unreplied'||replyStatus==='replied'){
  try{
   if(!facts.startAt||!facts.endAt)throw new Error('missing-time');
   facts.elapsedMs=timeDurationMs(facts.startAt,facts.endAt,timeRule);
   if(replyStatus==='replied')facts.outcome=facts.elapsedMs>resolved.thresholdMs?'fail':'pass';
   reason+=`${timeRule.mode==='workingHours'?'累计工作时间':'连续自然时间'}${facts.elapsedMs/3600000}小时（${facts.elapsedMs}毫秒），严格超过阈值才Fail。`;
  }catch{
   if(replyStatus==='replied')facts.replyStatus='unknown';
   reason+='评论时间、回复时间或检核截止点缺失/格式无效、顺序反向或超出支持范围，未计算耗时。';
  }
 }
 facts.reason=`${reason}${fallback}${ruleSet.calendarConfirmed?'':'日历尚未业务核对，按当前配置试算；空假期表未排除实际法定节假日。'}`;
 return facts;
}

export function timePolicyReferences(basis){
 const rule=basis?.rules?.find(r=>r.id==='EC-TIME');
 return(rule?.policyIds??[]).map(id=>basis.policies?.find(p=>p.id===id)).filter(Boolean).map(policy=>`${encodeURIComponent(policy.id)}@${policy.version}#`);
}

export function unrepliedSemanticResults(){
 return ['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'].map(ruleId=>({ruleId,verdict:'无法判定',reason:'原表没有回复正文，未调用模型；未取得该项内容判断，不能视作质量通过。',evidence:[],referenceIds:[]}));
}
