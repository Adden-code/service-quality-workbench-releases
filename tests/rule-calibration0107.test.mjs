import test from 'node:test';
import assert from 'node:assert/strict';
import {recordCalibration,calibrationPreview,changeCalibration,monitorCalibrations,validateCalibrationTransition,suspendRestoredCalibrations} from '../server/rule-calibration.mjs';
import {calibratedReviewPolicy,ruleExemption} from '../public/rule-calibration-policy.mjs';
import {applyAIDecisions,isAIFinal,normalizeReviewPolicy} from '../public/ai-triage.mjs';
import {getSessionResults,acceptAI,confirmReview} from '../public/domain.mjs';
import {captureDialogInputs,restoreDialogInputs} from '../public/dialog-input-recovery.mjs';
const now='2026-11-16T09:00:00+08:00',model='a'.repeat(64),rule={id:'SYN-R1',version:'V1.0',title:'合成礼仪',category:'服务规范',passCriteria:'礼貌',failCriteria:'粗鲁',exceptionCriteria:'资料不足',policyIds:[]};
const result=(id,text,verdict='符合')=>({ruleId:id,verdict,reason:'合成依据',confidence:0.55,evidence:[1],evidenceQuotes:[{turnId:1,quote:text,role:'客服'}],conflictsWith:[],referenceIds:[]});
function fixture({count=30,correct=24}={}){
 const state={schemaVersion:1,tasks:[],sessions:[],activity:[]};
 for(const [name,n,hash] of [['TRAIN',3,'b'],['VAL',count,'c']]){
  const task={id:name,mode:'manual',scene:'新品产品咨询',createdAt:now,source:{sha256:hash.repeat(64)},basisSnapshot:{rules:[rule],policies:[]},aiRun:{id:name+'-run',modelConfigFingerprint:model},sessionIds:[]};state.tasks.push(task);
  for(let i=0;i<n;i++){const text=`合成礼貌回复 ${name}-${i}`,s={id:name+i,externalId:name+i,taskId:name,startedAt:now,expectedRuleIds:[rule.id],turns:[{id:1,role:'客服',text}],aiResults:[result(rule.id,text)],aiExecution:{status:'completed',promptVersion:'synthetic-v1',runId:task.aiRun.id},review:{status:'已确认',reviewer:'合成独立审核员',completedAt:now,notes:'',drafts:{[rule.id]:{...result(rule.id,text,name==='VAL'&&i>=correct?'不符合':'符合'),source:'人工修改'}}}};task.sessionIds.push(s.id);state.sessions.push(s);}
 }
 return state;
}
const options={trainingTaskIds:['TRAIN'],validationTaskIds:['VAL'],actor:'合成管理员'};
function activated(){let state=recordCalibration(fixture(),options,now),id=state.ruleCalibrations.records[0].id;state=changeCalibration(state,{id,action:'enable',actor:'合成管理员',reason:'业务80%门槛验证'},now);return{state,id};}
function addRun(state,count=7){const task={...structuredClone(state.tasks[0]),id:'RUN',source:{sha256:'d'.repeat(64)},aiRun:{id:'RUN-run',modelConfigFingerprint:model},sessionIds:[],reviewPolicy:calibratedReviewPolicy(state,state.tasks[0])};delete task.reviewPolicy.sampling;state.tasks.push(task);
 for(let i=0;i<count;i++){const text='新合成会话 '+i,s={id:'RUN'+i,externalId:'RUN'+i,scene:task.scene,taskId:task.id,startedAt:now,expectedRuleIds:[rule.id],turns:[{id:1,role:'客服',text}],aiResults:[result(rule.id,text)],aiExecution:{status:'completed',promptVersion:'synthetic-v1',runId:task.aiRun.id},reviewPolicy:structuredClone(task.reviewPolicy),review:{status:'待审核',reviewer:'合成审核员',completedAt:null,notes:'',drafts:{}}};state.sessions.push(s);task.sessionIds.push(s.id);}return task;
}
test('independent rule pairs meet the business 24/30 boundary; 23/30 or 29 pairs stay shadow only',()=>{
 for(const [count,correct,eligible]of [[30,24,true],[30,23,false],[29,29,false]]){const state=recordCalibration(fixture({count,correct}),options,now),r=state.ruleCalibrations.records[0];assert.equal(r.eligible,eligible);assert.equal(r.passErrorCount,count-correct);assert.equal(r.manualRemaining,eligible?Math.min(count,Math.max(5,Math.ceil(count*.05))):count);
  if(eligible)assert.equal(changeCalibration(state,{id:r.id,action:'enable',actor:'synthetic',reason:'check'},now).ruleCalibrations.records[0].enabled,true);else assert.throws(()=>changeCalibration(state,{id:r.id,action:'enable',actor:'synthetic',reason:'check'},now),/30对/);
 }
});

test('overall 80 percent agreement can coexist with 100 percent PASS errors; advisory risk does not silently change enablement',()=>{
 const state=fixture();
 for(const row of state.sessions.filter(s=>s.taskId==='VAL').slice(0,24)){
  row.aiResults[0].verdict='不符合';row.review.drafts[rule.id].verdict='不符合';
 }
 const recorded=recordCalibration(state,options,now),record=recorded.ruleCalibrations.records[0];
 assert.equal(record.correctCount,24);assert.equal(record.pairCount,30);
 assert.equal(record.passCount,6);assert.equal(record.passErrorCount,6);assert.equal(record.eligible,true);
 assert.equal(changeCalibration(recorded,{id:record.id,action:'enable',actor:'合成管理员',reason:'现行启用条件未变'},now).ruleCalibrations.records[0].enabled,true);
});
test('no overlap across files, copied content, reinspection or reused holdout',()=>{
 assert.throws(()=>calibrationPreview(fixture(),{...options,validationTaskIds:['TRAIN']}),/交集/);
 const duplicate=fixture();duplicate.sessions.find(s=>s.taskId==='VAL').turns=structuredClone(duplicate.sessions[0].turns);assert.throws(()=>calibrationPreview(duplicate,options),/交集/);
 const recorded=recordCalibration(fixture(),options,now);assert.throws(()=>recordCalibration(recorded,options,now),/已经用于标定/);
 const stale=recordCalibration(fixture(),options,now);stale.sessions.find(s=>s.taskId==='VAL').review.drafts[rule.id].reason='label content';stale.sessions.find(s=>s.taskId==='VAL').review.drafts[rule.id].verdict='不符合';assert.throws(()=>changeCalibration(stale,{id:stale.ruleCalibrations.records[0].id,action:'enable',actor:'synthetic',reason:'check'},now),/标签或依据已变化/);
});
test('rule exemptions ignore self-confidence threshold, sample first and every fifth eligible result, keep sources separate',()=>{
 const {state}=activated(),task=addRun(state);applyAIDecisions(state,task,now);const rows=state.sessions.filter(s=>s.taskId==='RUN');
 assert.deepEqual(rows.map(s=>s.aiDecision.ruleDecisions[0].status),['sample','exempt','exempt','exempt','exempt','sample','exempt']);
 assert.equal(isAIFinal(rows[0]),false);assert.equal(isAIFinal(rows[1]),true);assert.equal(getSessionResults(rows[1])[0].final.source,'AI规则免审');assert.equal(getSessionResults(rows[1])[0].reviewed,false);
 const accepted=acceptAI(state,rows[1].id,now);assert.equal(Object.keys(accepted.sessions.find(s=>s.id===rows[1].id).review.drafts).length,0);
 assert.equal(normalizeReviewPolicy(task.reviewPolicy).rules.length,1);
});
test('failed evidence, non-pass and changed model stay human and do not consume PASS sampling positions',()=>{
 const {state}=activated(),task=addRun(state,4),rows=state.sessions.filter(s=>s.taskId==='RUN');rows[0].aiResults[0].verdict='不符合';rows[1].aiResults[0].evidenceQuotes=[];applyAIDecisions(state,task,now);
 assert.deepEqual(rows.map(s=>s.aiDecision.ruleDecisions[0].status),['manual','manual','sample','exempt']);
 const other=activated(),t=addRun(other.state,1);t.aiRun.modelConfigFingerprint='different';applyAIDecisions(other.state,t,now);assert.equal(other.state.sessions.at(-1).aiDecision.ruleDecisions[0].status,'manual');
});
test('monitored erroneous exemptions exceeding 20% disable one rule, revoke previous exemptions, retain original decisions',()=>{
 const {state,id}=activated(),task=addRun(state,7);applyAIDecisions(state,task,now);const rows=state.sessions.filter(s=>s.taskId==='RUN'),original=JSON.stringify(rows.map(s=>s.aiDecision));
 rows[0].review={...rows[0].review,status:'已确认',completedAt:now,drafts:{[rule.id]:{...rows[0].aiResults[0],verdict:'不符合',source:'人工修改'}}};
 const next=monitorCalibrations(state,now),record=next.ruleCalibrations.records[0];assert.equal(record.enabled,false);assert.ok(record.invalidatedAt);assert.equal(ruleExemption(next.sessions.find(s=>s.id==='RUN1'),rule.id),null);assert.equal(JSON.stringify(next.sessions.filter(s=>s.taskId==='RUN').map(s=>s.aiDecision)),original);assert.match(next.ruleCalibrations.events.at(-1).reason,/1\/1/);
 assert.throws(()=>changeCalibration(next,{id,action:'enable',actor:'synthetic',reason:'force'},now),/才能启用/);
});
test('client cannot forge registry or automatic assignments and forbidden rules cannot enable',()=>{
 const {state,id}=activated(),before=structuredClone(state);state.ruleCalibrations.records[0].correctCount=30;assert.throws(()=>validateCalibrationTransition(state,before),/计数|专用/);
 const blocked=changeCalibration(before,{id,action:'forbid',actor:'synthetic',reason:'高严重度'},now);assert.equal(calibratedReviewPolicy(blocked,blocked.tasks[0]).rules.length,0);assert.throws(()=>changeCalibration(blocked,{id,action:'enable',actor:'synthetic',reason:'force'},now),/禁止免审/);
});
test('explicit reload restores DOM-only pending notes and selection without copying files or passwords',()=>{
 const fields=[{id:'pending-notes',type:'textarea',value:'尚未保存的合成说明',selectionStart:2,selectionEnd:3},{id:'upload',type:'file',value:'synthetic.xlsx'},{id:'secret',type:'password',value:'test'}],root={querySelectorAll:()=>fields};const saved=captureDialogInputs(root);assert.equal(saved.length,1);fields[0].value='latest server note';restoreDialogInputs(root,saved);assert.equal(fields[0].value,'尚未保存的合成说明');
});

test('exactly 20% observed errors stays enabled; exceeding it stops, and restored workspaces never resurrect exemptions',()=>{
 const {state,id}=activated(),task=addRun(state,6);applyAIDecisions(state,task,now);const rows=state.sessions.filter(s=>s.taskId==='RUN');
 for(let i=0;i<5;i++)rows[i].review={...rows[i].review,status:'已确认',completedAt:now,drafts:{[rule.id]:{...rows[i].aiResults[0],verdict:i===0?'不符合':'符合',source:'人工修改'}}};
 assert.equal(monitorCalibrations(state,now).ruleCalibrations.records[0].enabled,true);
 const restored=suspendRestoredCalibrations(state,now);assert.equal(restored.ruleCalibrations.records[0].enabled,false);assert.ok(restored.ruleCalibrations.records[0].invalidatedAt);assert.equal(ruleExemption(restored.sessions.find(s=>s.id==='RUN1'),rule.id),null);assert.equal(restored.ruleCalibrations.events.at(-1).action,'restore-stop');
 rows[5].review={...rows[5].review,status:'已确认',completedAt:now,drafts:{[rule.id]:{...rows[5].aiResults[0],verdict:'不符合',source:'人工修改'}}};assert.equal(monitorCalibrations(state,now).ruleCalibrations.records[0].enabled,false);
 const blocked=changeCalibration(state,{id,action:'forbid',actor:'synthetic',reason:'severity'},now);assert.deepEqual(blocked.ruleCalibrations.forbiddenRules.map(r=>r.ruleId),[rule.id]);const allowed=changeCalibration(blocked,{id,action:'allow',actor:'synthetic',reason:'manual decision'},now);assert.equal(allowed.ruleCalibrations.records[0].enabled,false);assert.equal(allowed.ruleCalibrations.forbiddenRules.length,0);
});

test('correcting an enabled calibration validation label invalidates evidence and recalls pending exemptions',()=>{
 const {state}=activated(),task=addRun(state,2);applyAIDecisions(state,task,now);state.sessions.find(s=>s.taskId==='VAL').review.drafts[rule.id].verdict='不符合';const next=monitorCalibrations(state,now);assert.equal(next.ruleCalibrations.records[0].enabled,false);assert.equal(next.ruleCalibrations.events.at(-1).action,'evidence-stop');assert.equal(ruleExemption(next.sessions.find(s=>s.id==='RUN1'),rule.id),null);
});

for(const [count,expected] of [[1,1],[4,4],[5,5],[20,5],[85,5],[100,5],[101,6],[500,25]])test(`new frozen policy samples ${expected} of ${count} eligible judgments per rule per batch`,()=>{
 const {state}=activated(),task=addRun(state,count);task.reviewPolicy=calibratedReviewPolicy(state,state.tasks[0]);for(const s of state.sessions.filter(s=>s.taskId==='RUN'))s.reviewPolicy=structuredClone(task.reviewPolicy);
 applyAIDecisions(state,task,now);const rows=state.sessions.filter(s=>s.taskId==='RUN');assert.equal(rows.filter(s=>s.aiDecision.ruleDecisions[0].status==='sample').length,expected);const before=JSON.stringify(rows.map(s=>s.aiDecision));applyAIDecisions(state,task,now);assert.equal(JSON.stringify(rows.map(s=>s.aiDecision)),before);
});

test('0117 repeated imports never inflate calibration pairs and cross-group originals still reject',()=>{
 const state=fixture(),original=state.tasks.find(t=>t.id==='VAL'),repeat={...structuredClone(original),id:'VAL-REPEAT',importLineage:{schemaVersion:1,firstTaskId:'VAL',ordinal:2},sessionIds:[]};
 state.tasks.push(repeat);for(const row of state.sessions.filter(s=>s.taskId==='VAL')){const copied=structuredClone(row);copied.id+='-repeat';copied.taskId=repeat.id;repeat.sessionIds.push(copied.id);state.sessions.push(copied);}
 const preview=calibrationPreview(state,{...options,validationTaskIds:['VAL','VAL-REPEAT']});assert.equal(preview.groups[0].pairCount,30);assert.deepEqual(preview.excludedRepeatTaskIds,['VAL-REPEAT']);
 assert.throws(()=>calibrationPreview(state,{trainingTaskIds:['VAL'],validationTaskIds:['VAL-REPEAT']}),/交集/);
 assert.throws(()=>calibrationPreview(state,{...options,validationTaskIds:['VAL-REPEAT']}),/再次导入.*排除/);
});
