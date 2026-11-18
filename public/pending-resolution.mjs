import {isInactiveTask as isVoidedTask} from './task-lifecycle.mjs';
import {isRawTranscriptSession} from './raw-transcript.mjs';
import {validateRawResultAssurance} from './raw-evidence.mjs';

const fail=message=>{throw new Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':object(value)?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const same=(a,b)=>canonical(a)===canonical(b);
const omit=(value,keys)=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!keys.includes(key)));
const verdicts=['符合','不符合','无法判定','不适用'];
function zoned(value){const match=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);return Boolean(match&&Number(match[2])<24&&Number(match[3])<60&&Number(match[4])<60&&(match[5]==='Z'||Number(match[6])<=14&&Number(match[7])<60&&(Number(match[6])<14||Number(match[7])===0))&&Number.isFinite(Date.parse(value))&&new Date(match[1]+'T00:00:00Z').toISOString().slice(0,10)===match[1]);}
function operation({reason,actor,now,operationId}){
 if(typeof reason!=='string'||!reason.trim()||reason.trim().length>2000)fail('请填写处理原因（最多2000字）。');
 if(typeof actor!=='string'||!actor.trim()||actor.trim().length>80)fail('请填写操作人标签（最多80字）。');
 if(!zoned(now))fail('处理时间须为有效的带时区时间。');
 if(typeof operationId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(operationId))fail('处理操作标识无效。');
 return{reason:reason.trim(),actor:actor.trim(),at:now,id:operationId};
}

/** Work completion only. This never creates a final quality judgment. */
export const isProcessedUnknown=session=>session?.review?.status==='待补充'&&session.review.resolution?.version===1&&session.review.resolution.kind==='processed-unknown';
function fullAI(session){
 const expected=session.expectedRuleIds||[],results=session.aiResults||[];
 return session.aiExecution?.status==='completed'&&expected.length>0&&results.length===expected.length&&new Set(results.map(result=>result.ruleId)).size===expected.length&&results.every(result=>expected.includes(result.ruleId)&&verdicts.includes(result.verdict)&&typeof result.reason==='string'&&result.reason.trim()&&Array.isArray(result.evidence)&&(!isRawTranscriptSession(session)||result.rawValidation?.status!=='program-fallback'&&validateRawResultAssurance(result,session).valid));
}
export function pendingResolutionEligibility(state,session,{ignoreResolution=false}={}){
 const task=state.tasks?.find(task=>task.id===session?.taskId),reasons=[];
 if(!task||task.mode!=='manual'||isVoidedTask(task)&&!ignoreResolution)reasons.push('只可处理有效业务任务中的待补充记录。');
 if(session?.review?.status!=='待补充')reasons.push('请先将会话标记为待补充。');
 if(!ignoreResolution&&isProcessedUnknown(session))reasons.push('本条已处理；需要修改时请先重新打开。');
 if(session?.aiExecution?.status==='running')reasons.push('AI正在运行，完成后再处理。');
 const expected=session?.expectedRuleIds||[],aiReady=fullAI(session||{}),drafts=session?.review?.drafts||{};
 const results=expected.map(id=>drafts[id]||(aiReady?session.aiResults.find(result=>result.ruleId===id):null));
 if(!expected.length||new Set(expected).size!==expected.length||results.some(result=>!result||!verdicts.includes(result.verdict)||!result.reason?.trim()))reasons.push('检查尚未完整执行或人工逐项处理，不能标记已处理。');
 const unknownRuleIds=expected.filter((_,index)=>results[index]?.verdict==='无法判定');
 if(!unknownRuleIds.length)reasons.push('当前没有可保留的无法判定项。');
 if(results.some((result,index)=>result?.verdict==='不符合'&&!drafts[expected[index]]))reasons.push('仍有未人工核对的不符合项，请先逐项处理。');
 return{eligible:reasons.length===0,reasons,unknownRuleIds,runId:session?.aiExecution?.runId||''};
}
/** Transient exact comparison; not persisted and not a probabilistic hash. */
export function pendingResolutionBasis(state,session){
 const task=state.tasks?.find(task=>task.id===session?.taskId);
 return canonical({taskId:session?.taskId,lifecycle:task?.lifecycle,basis:task?.basisSnapshot,scenario:task?.scenarioSnapshot,expected:session?.expectedRuleIds,execution:session?.aiExecution,results:session?.aiResults,review:omit(session?.review,['activeTimeMs','timeSegments'])});
}
export function previewPendingResolution(state,{taskId,sessionId}={}){
 const rows=state.sessions.filter(session=>sessionId?session.id===sessionId:session.taskId===taskId&&session.review?.status==='待补充');
 return rows.map(session=>({id:session.id,taskId:session.taskId,label:session.externalId||session.id,...pendingResolutionEligibility(state,session),basis:pendingResolutionBasis(state,session)}));
}
function activity(state,session,event){
 const prefix=`PENDING-${session.id}-${session.review.resolutionHistory.length}`;if(state.activity?.some(item=>item.id===prefix))fail('处理审计标识冲突，请重新加载。');
 state.activity??=[];state.activity.unshift({id:prefix,taskId:session.taskId,sessionId:session.id,action:event.action==='resolve'?'待补充已处理，结论仍无法判定':'重新打开已处理待补充',at:event.at,reviewer:event.actor,reason:event.reason,resolutionId:event.action==='resolve'?event.id:event.resolutionId,operationId:event.id});
}
export function resolvePendingReviews(state,{sessionIds,preview,reason,actor,operationId,now=new Date().toISOString()}={}){
 const op=operation({reason,actor,now,operationId});
 if(!Array.isArray(sessionIds)||!sessionIds.length||sessionIds.length>500||new Set(sessionIds).size!==sessionIds.length)fail('请选择1至500条待补充记录。');
 if(!Array.isArray(preview))fail('请先预览待处理记录。');
 const selected=sessionIds.map(id=>{const session=state.sessions.find(row=>row.id===id),shown=preview.find(row=>row.id===id);if(!session||!shown||shown.basis!==pendingResolutionBasis(state,session))fail('预览后记录或依据已变化，请重新预览后再处理。');const info=pendingResolutionEligibility(state,session);if(!info.eligible)fail(info.reasons.join('\n'));return{session,info};});
 if(new Set(selected.map(item=>item.session.taskId)).size!==1)fail('请在同一个任务内批量处理待补充记录。');
 const next=clone(state);
 for(const {session,info}of selected){
  const item=next.sessions.find(row=>row.id===session.id),task=next.tasks.find(task=>task.id===item.taskId),history=item.review.resolutionHistory||[];
  if(Date.parse(op.at)<Date.parse(task.createdAt)||history.length&&Date.parse(op.at)<Date.parse(history.at(-1).at))fail('处理时间不能早于任务或此前处理记录。');
  if(history.some(event=>event.action==='resolve'&&event.id===op.id))fail('处理操作标识已使用。');
  const resolution={version:1,kind:'processed-unknown',...op,unknownRuleIds:[...info.unknownRuleIds],runId:info.runId};
  item.review.resolution=resolution;item.review.resolutionHistory=[...history,{...clone(resolution),action:'resolve'}];activity(next,item,item.review.resolutionHistory.at(-1));
 }
 return next;
}
export function reopenPendingReview(state,{sessionId,reason,actor,operationId,now=new Date().toISOString()}={}){
 const op=operation({reason,actor,now,operationId}),session=state.sessions.find(row=>row.id===sessionId),task=state.tasks.find(task=>task.id===session?.taskId);
 if(!isProcessedUnknown(session)||!task||isVoidedTask(task))fail('请选择可重新打开的已处理待补充记录。');
 if(session.aiExecution?.status==='running')fail('AI正在运行，完成后再处理。');
 if(Date.parse(op.at)<Date.parse(session.review.resolution.at))fail('重新打开时间不能早于处理时间。');
 const next=clone(state),item=next.sessions.find(row=>row.id===sessionId),event={version:1,action:'reopen',...op,resolutionId:item.review.resolution.id};
 delete item.review.resolution;item.review.resolutionHistory=[...item.review.resolutionHistory,event];activity(next,item,event);return next;
}

export function validatePendingResolution(session,task,state){
 const review=session.review||{},history=review.resolutionHistory,current=review.resolution;
 if(history===undefined&&current===undefined)return true;
 if(task.mode!=='manual'||!Array.isArray(history)||!history.length||history.length>10000)fail('待补充处理记录结构无效。');
 let active=null,previousAt=Date.parse(task.createdAt),ids=new Set();
 for(const event of history){
  if(!object(event)||event.version!==1||!['resolve','reopen'].includes(event.action))fail('待补充处理审计无效。');
  operation({reason:event.reason,actor:event.actor,now:event.at,operationId:event.id});
  if(Date.parse(event.at)<previousAt)fail('待补充处理审计时间顺序无效。');previousAt=Date.parse(event.at);
  if(event.action==='resolve'){
   if(active||ids.has(event.id)||event.kind!=='processed-unknown'||!Array.isArray(event.unknownRuleIds)||!event.unknownRuleIds.length||new Set(event.unknownRuleIds).size!==event.unknownRuleIds.length||event.unknownRuleIds.some(id=>!session.expectedRuleIds?.includes(id))||typeof event.runId!=='string'||Object.keys(event).some(key=>!['version','kind','id','at','actor','reason','unknownRuleIds','runId','action'].includes(key)))fail('待补充处理审计内容无效。');
   ids.add(event.id);active=omit(event,['action']);
  }else{if(!active||event.resolutionId!==active.id||Object.keys(event).some(key=>!['version','action','id','at','actor','reason','resolutionId'].includes(key)))fail('待补充重新打开审计无效。');active=null;}
 }
 if(!same(active??undefined,current))fail('待补充当前状态与处理审计不一致。');
 if(current){const info=pendingResolutionEligibility(state,session,{ignoreResolution:true});if(!info.eligible||!same(info.unknownRuleIds,current.unknownRuleIds)||info.runId!==current.runId)fail('已处理待补充必须保留完整原结论、无法判定项和运行依据。');}
 return true;
}
export function validatePendingResolutionTransition(before,after,state,nextState,{trustedAI=false}={}){
 const oldHistory=before.review.resolutionHistory||[],history=after.review.resolutionHistory||[],old=before.review.resolution,current=after.review.resolution;
 if(!oldHistory.length&&!history.length&&old===undefined&&current===undefined)return;
 if(!same(history.slice(0,oldHistory.length),oldHistory)||history.length<oldHistory.length)fail('待补充处理审计不可删除或改写。');
 const changed=!same(old,current)||history.length!==oldHistory.length;
 if(trustedAI&&changed)fail('AI不能改写待补充人工处理状态。');
 if(!changed){if(old&&(!same(omit(before.review,['activeTimeMs','timeSegments']),omit(after.review,['activeTimeMs','timeSegments']))||!same(before.aiExecution,after.aiExecution)||!same(before.aiResults,after.aiResults)))fail('已处理待补充只读，请先重新打开。');return;}
 if(history.length!==oldHistory.length+1||!same(omit(before.review,['resolution','resolutionHistory']),omit(after.review,['resolution','resolutionHistory'])))fail('处理状态变更不能同时改写原审核结论。');
 const event=history.at(-1);
 if(event.action==='resolve'){
  if(old||!current)fail('待补充处理状态转换无效。');
  const info=pendingResolutionEligibility(state,before);if(!info.eligible||!same(info.unknownRuleIds,current.unknownRuleIds)||info.runId!==current.runId)fail('当前记录不满足待补充已处理条件。');
 }else if(!old||current!==undefined||event.resolutionId!==old.id)fail('待补充重新打开状态转换无效。');
 const audit=nextState.activity.find(item=>item.id===`PENDING-${after.id}-${history.length}`);
 if(!audit||audit.sessionId!==after.id||audit.taskId!==after.taskId||audit.at!==event.at||audit.reviewer!==event.actor||audit.reason!==event.reason||audit.operationId!==event.id||audit.resolutionId!==(event.action==='resolve'?event.id:event.resolutionId)||audit.action!==(event.action==='resolve'?'待补充已处理，结论仍无法判定':'重新打开已处理待补充'))fail('待补充处理必须保留逐条操作审计。');
}
