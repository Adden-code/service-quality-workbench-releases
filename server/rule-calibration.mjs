import {isRepeatedImport} from '../public/import-lineage.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {calibrationScope,calibratedReviewPolicy,stable,allRulesExempt,mandatorySampleCount} from '../public/rule-calibration-policy.mjs';
import {isVoidedTask} from '../public/task-lifecycle.mjs';
const clone=v=>structuredClone(v),sha=v=>createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');
class CalibrationInputError extends Error {
 constructor(message){super(message);this.name='CalibrationInputError';this.status=400;this.code='CALIBRATION_INVALID';}
}
// Only deliberate validation failures cross the HTTP boundary. Unexpected
// runtime errors remain covered by the server's generic error response.
const fail=message=>{throw new CalibrationInputError(message);};
const text=(v,label)=>{if(typeof v!=='string'||!v.trim()||v.length>2000)fail(`请填写${label}。`);return v.trim();};
const registry=state=>state.ruleCalibrations||{schemaVersion:1,records:[],events:[]};
function sourceKeys(task,s){
 if(!/^[a-f0-9]{64}$/.test(task.source?.sha256))return null;
 const raw=s.rawTranscript,ec=s.ecommerce,body=raw?.text||(ec?stable(ec.raw):stable(s.turns?.map(t=>({role:t.role,text:t.text}))));
 if(!body||!s.externalId&&!raw&&!ec)return null;
 return['file:'+task.source.sha256,'record:'+sha([task.source.sha256,raw?.sheet||ec?.sheet||'',raw?.row||ec?.row||s.externalId]),'text:'+sha(body.normalize('NFC').replace(/\r\n?/g,'\n').trim())];
}
function collect(state,taskIds){
 if(!Array.isArray(taskIds)||!taskIds.length||new Set(taskIds).size!==taskIds.length)fail('请选择不重复的参考批次和独立验证批次。');
 const rows=[],allKeys=new Set();for(const id of taskIds){const task=state.tasks.find(t=>t.id===id);if(!task||task.mode!=='manual'||isVoidedTask(task))fail('标定批次不存在或已作废。');
  const repeated=isRepeatedImport(state,task);
  for(const s of state.sessions.filter(s=>s.taskId===id)){
   const keys=sourceKeys(task,s);if(keys)keys.forEach(k=>allKeys.add(k));
   if(repeated||!keys||!s.aiExecution?.promptVersion||s.review?.status!=='已确认'||s.review.disposition||s.aiExecution?.status!=='completed')continue;
   const run=[task.aiRun,...(task.aiRunHistory||[])].find(r=>r?.id===s.aiExecution.runId);if(!run?.modelConfigFingerprint)continue;
   for(const rule of task.basisSnapshot?.rules||[]){const ai=s.aiResults.find(r=>r.ruleId===rule.id),human=s.review.drafts[rule.id];
    if(!ai||!human||!['符合','不符合','不适用'].includes(human.verdict)||!['符合','不符合','不适用','无法判定'].includes(ai.verdict))continue;
    const scope=calibrationScope(task),key=sha({scope,ruleId:rule.id,version:rule.version,modelFingerprint:run.modelConfigFingerprint,promptVersion:s.aiExecution.promptVersion});
    rows.push({key,ruleId:rule.id,ruleVersion:rule.version,title:rule.title||rule.name,scope,modelFingerprint:run.modelConfigFingerprint,promptVersion:s.aiExecution.promptVersion,taskId:id,sessionId:s.id,sourceKeys:keys,ai:ai.verdict,human:human.verdict,humanSource:human.source||'unknown'});
   }
  }
 }
 return{rows,keys:[...allKeys]};
}
export function calibrationPreview(state,{trainingTaskIds,validationTaskIds}={}){
 const training=collect(state,trainingTaskIds),validation=collect(state,validationTaskIds),known=new Set(training.keys);
 if(validation.keys.some(k=>known.has(k)))fail('参考与独立验证样本有交集：同文件、重复原文或重检副本不能跨组。');
 if(!training.rows.length||!validation.rows.length)fail('两组都需要有完整AI执行与本轮人工确认的可核验判定对；再次导入批次自动排除。');
 const groups=[];for(const key of new Set(validation.rows.map(r=>r.key))){
  const candidates=validation.rows.filter(r=>r.key===key),seen=new Set(),pairs=candidates.filter(r=>{const id=r.sourceKeys.find(k=>k.startsWith('text:'));if(seen.has(id))return false;seen.add(id);return true;}),reference=training.rows.filter(r=>r.key===key),first=pairs[0];
  if(!reference.length)continue;
  const pairCount=pairs.length,correctCount=pairs.filter(r=>r.ai===r.human).length,pass=pairs.filter(r=>r.ai==='符合'),passErrorCount=pass.filter(r=>r.human!=='符合').length;
  const eligible=pairCount>=30&&correctCount*5>=pairCount*4;
  groups.push({key,ruleId:first.ruleId,ruleVersion:first.ruleVersion,title:first.title,scope:first.scope,modelFingerprint:first.modelFingerprint,promptVersion:first.promptVersion,pairCount,correctCount,passCount:pass.length,passErrorCount,manualRemaining:eligible?pairCount-pass.length+mandatorySampleCount(pass.length):pairCount,eligible,pairs:pairs.map(({key,scope,modelFingerprint,title,...p})=>p)});
 }
 if(!groups.length)fail('两组没有规则、冻结依据和模型指纹一致的可比较判定对。');
 return{excludedRepeatTaskIds:[...trainingTaskIds,...validationTaskIds].filter(id=>isRepeatedImport(state,state.tasks.find(t=>t.id===id))),trainingTaskIds:[...trainingTaskIds],validationTaskIds:[...validationTaskIds],trainingKeys:training.keys,validationKeys:validation.keys,groups};
}
export function recordCalibration(state,input,at=new Date().toISOString()){
 const actor=text(input.actor,'操作人标签'),preview=calibrationPreview(state,input),next=clone(state),reg=next.ruleCalibrations??={schemaVersion:1,records:[],events:[]};
 // A holdout used to inspect one model/rule configuration cannot become fresh evidence after tuning.
 const previousKeys=new Set(reg.records.flatMap(r=>r.validationKeys||[]));if(preview.validationKeys.some(k=>previousKeys.has(k)))fail('该独立验证集已经用于标定；调整后请使用新的独立验证批次。');
 const runId=randomUUID();for(const group of preview.groups){reg.records.push({...group,id:randomUUID(),runId,trainingTaskIds:preview.trainingTaskIds,validationTaskIds:preview.validationTaskIds,trainingKeys:preview.trainingKeys,validationKeys:preview.validationKeys,createdAt:at,actor,enabled:false,forbidden:(reg.forbiddenRules||[]).some(b=>b.scene===group.scope.scene&&b.ruleId===group.ruleId)});}
 reg.events.push({id:randomUUID(),action:'calibrate',runId,actor,at});return next;
}
export function changeCalibration(state,input,at=new Date().toISOString()){
 const actor=text(input.actor,'操作人标签'),reason=text(input.reason,'操作原因'),next=clone(state),reg=next.ruleCalibrations,record=reg?.records.find(r=>r.id===input.id);if(!record)fail('标定记录不存在。');
 if(!['enable','disable','forbid','allow'].includes(input.action))fail('标定操作无效。');
 if(input.action==='enable'){
  if(record.invalidatedAt||record.forbidden||record.pairCount<30||record.correctCount*5<record.pairCount*4)fail('只有独立验证不少于30对且一致率不低于80%、未停用且未禁止免审的规则才能启用。');
  const fresh=calibrationPreview(state,record).groups.find(g=>g.key===record.key);if(!fresh||stable(fresh.pairs)!==stable(record.pairs))fail('原验证标签或依据已变化，请重新标定。');
  for(const other of reg.records)if(other.ruleId===record.ruleId&&stable(other.scope)===stable(record.scope)&&other.enabled)other.enabled=false;
  record.enabled=true;
 }else if(input.action==='allow'){reg.forbiddenRules=(reg.forbiddenRules||[]).filter(b=>b.scene!==record.scope.scene||b.ruleId!==record.ruleId);for(const r of reg.records)if(r.scope.scene===record.scope.scene&&r.ruleId===record.ruleId)r.forbidden=false;}
 else {record.enabled=false;if(input.action==='forbid'){reg.forbiddenRules??=[];if(!reg.forbiddenRules.some(b=>b.scene===record.scope.scene&&b.ruleId===record.ruleId))reg.forbiddenRules.push({scene:record.scope.scene,ruleId:record.ruleId,actor,reason,at});for(const r of reg.records)if(r.scope.scene===record.scope.scene&&r.ruleId===record.ruleId){r.forbidden=true;r.enabled=false;revoke(next,r,reason,actor,at);}}}
 reg.events.push({id:randomUUID(),action:input.action,calibrationId:record.id,actor,reason,at});
 if(['disable','forbid'].includes(input.action))revoke(next,record,reason,actor,at);
 return next;
}
function revoke(state,record,reason,actor,at){
 for(const s of state.sessions){if(isVoidedTask(state.tasks.find(t=>t.id===s.taskId)))continue;const entry=s.aiDecision?.ruleDecisions?.find(r=>r.calibrationId===record.id&&['exempt','sample'].includes(r.status));if(!entry||s.ruleCalibrationRevocations?.some(r=>r.calibrationId===record.id))continue;
  (s.ruleCalibrationRevocations??=[]).push({calibrationId:record.id,ruleId:entry.ruleId,reason,actor,at,previousReviewStatus:s.review.status,previousCompletedAt:s.review.completedAt});
  if(!s.review.drafts[entry.ruleId]&&s.review.status==='已确认'){s.review.status='已暂存';s.review.completedAt=null;}
 }
 for(const task of state.tasks){const affected=state.sessions.filter(s=>s.taskId===task.id&&s.ruleCalibrationRevocations?.some(r=>r.calibrationId===record.id)&&!s.review.drafts[record.ruleId]);if(affected.length){const all=state.sessions.filter(s=>s.taskId===task.id);task.status='待审核';task.progress=Math.round(all.filter(s=>s.review.status==='已确认'||allRulesExempt(s)).length/all.length*100);}}
}
export function monitorCalibrations(input,at=new Date().toISOString()){
 const state=clone(input),reg=state.ruleCalibrations;if(!reg)return state;
 const validationCache=new Map();
 for(const record of reg.records){if(!record.enabled||record.invalidatedAt)continue;
  if(!validationCache.has(record.runId)){try{validationCache.set(record.runId,calibrationPreview(state,record));}catch{validationCache.set(record.runId,null);}}
  const fresh=validationCache.get(record.runId)?.groups.find(g=>g.key===record.key);
  if(!fresh||stable(fresh.pairs)!==stable(record.pairs)){
   record.enabled=false;record.invalidatedAt=at;const reason='独立验证标签或来源已变化，原标定失效；请重新独立验证。';reg.events.push({id:randomUUID(),action:'evidence-stop',calibrationId:record.id,actor:'系统监控',reason,at});revoke(state,record,reason,'系统监控',at);continue;
  }
  const reviewed=state.sessions.filter(s=>!isVoidedTask(state.tasks.find(t=>t.id===s.taskId))&&s.review.status==='已确认'&&s.aiDecision?.ruleDecisions?.some(r=>r.calibrationId===record.id&&['exempt','sample'].includes(r.status))&&s.review.drafts[record.ruleId]);
  const errors=reviewed.filter(s=>s.review.drafts[record.ruleId].verdict!=='符合');
  if(reviewed.length&&errors.length*5>reviewed.length){record.enabled=false;record.invalidatedAt=at;const reason=`免审人工核验错误率超限：${errors.length}/${reviewed.length} >20%`;reg.events.push({id:randomUUID(),action:'auto-stop',calibrationId:record.id,actor:'系统监控',reason,at,reviewed:reviewed.length,errors:errors.length});revoke(state,record,reason,'系统监控',at);}
 }
 return state;
}
export function calibrationMonitoring(state,id){const record=registry(state).records.find(r=>r.id===id),rows=state.sessions.flatMap(s=>(s.aiDecision?.ruleDecisions||[]).filter(e=>e.calibrationId===id&&['exempt','sample'].includes(e.status)).map(e=>({session:s,entry:e}))),reviewed=rows.filter(r=>r.session.review.status==='已确认'&&r.session.review.drafts[record?.ruleId]);return{candidates:rows.length,sampled:rows.filter(r=>r.entry.status==='sample').length,reviewed:reviewed.length,errors:reviewed.filter(r=>r.session.review.drafts[record.ruleId].verdict!=='符合').length,awaitingSample:rows.filter(r=>r.entry.status==='sample'&&!r.session.review.drafts[record.ruleId]).length};}
export function suspendRestoredCalibrations(input,at=new Date().toISOString()){
 const state=clone(input);for(const record of state.ruleCalibrations?.records||[]){record.enabled=false;record.invalidatedAt??=at;const reason='工作区恢复后标定停用，防止旧备份重新启用已失效免审；请重新独立验证。';revoke(state,record,reason,'恢复保护',at);state.ruleCalibrations.events.push({id:randomUUID(),action:'restore-stop',calibrationId:record.id,actor:'恢复保护',reason,at});}return state;
}
export function validateCalibrationTransition(state,previous,{trustedCalibration=false,trustedAI=false,authenticateNewSnapshots=false}={}){
 const reg=registry(state);if(reg.schemaVersion!==1||!Array.isArray(reg.records)||!Array.isArray(reg.events))fail('规则标定登记格式无效。');
 const ids=new Set();for(const r of reg.records){if(!r||typeof r.id!=='string'||ids.has(r.id)||!Number.isSafeInteger(r.pairCount)||r.pairCount<1||!Number.isSafeInteger(r.correctCount)||r.correctCount<0||r.correctCount>r.pairCount||!Array.isArray(r.pairs)||r.pairs.length!==r.pairCount||r.correctCount!==r.pairs.filter(p=>p.ai===p.human).length||r.enabled&&(r.forbidden||r.invalidatedAt||r.pairCount<30||r.correctCount*5<r.pairCount*4))fail('规则标定计数或启用条件无效。');ids.add(r.id);}
 if(!previous&&authenticateNewSnapshots&&reg.records.length)fail('新工作区不可伪造标定记录。');
 if(previous&&!trustedCalibration&&stable(state.ruleCalibrations)!==stable(previous.ruleCalibrations))fail('标定与监控记录只能通过专用入口更新。');
 for(const task of state.tasks){if(task.reviewPolicy?.version!==2)continue;
  const old=previous?.tasks.find(t=>t.id===task.id);if(authenticateNewSnapshots&&!old){const expected=calibratedReviewPolicy(state,task,{enabled:task.reviewPolicy.enabled});if(stable(task.reviewPolicy)!==stable(expected))fail('新任务规则免审策略必须来自当前已启用的真实标定。');}
 }
 for(const s of state.sessions){const old=previous?.sessions.find(r=>r.id===s.id);if(previous&&!trustedAI&&!trustedCalibration&&(stable(s.calibrationAssignments)!==stable(old?.calibrationAssignments)||stable(s.ruleCalibrationRevocations)!==stable(old?.ruleCalibrationRevocations)))fail('免审分流与回溯记录只能由程序生成。');}
}
