import {validateImportLineages} from '../public/import-lineage.mjs';
import {requiresEcommerceClassification,classificationReviewed,classificationNeedsJudgment} from '../public/ecommerce-classification-review.mjs';
import {isBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
import {validateCatalog} from '../public/catalog.mjs';
import {isSessionCheckRule,ruleKindOf} from '../public/rule-kind.mjs';
import {validateTaskLifecycle,isVoidedTask,isArchivedTask,isInactiveTask} from '../public/task-lifecycle.mjs';
import {validatePendingResolution,validatePendingResolutionTransition} from '../public/pending-resolution.mjs';
import {demoSessions,rules as demoRules,policies as demoPolicies,canConfirmUnreplied,isUnrepliedSession} from '../public/domain.mjs';
import {validateInputProfile} from '../public/input-profiles.mjs';
import {validateContextFields,validateFieldEvidence} from '../public/context-fields.mjs';
import {validateEcommerceRecord,validateEcommerceSource,ecommerceTimeValues,ecommerceSourceColumn,validateEcommerceSources} from '../public/ecommerce-schema.mjs';
import {isEcommerceBasis,authenticateEcommerceRuleSetBasis} from '../public/ecommerce-catalog.mjs';
import {validateDuplicateGroups} from './ecommerce-engine.mjs';
import {MODEL_CONFIG_FIELDS,modelConfigSnapshot,modelConfigFingerprint} from './model-config.mjs';
import {computeEcommerceTimeFacts,isStageATimeBasis,timePolicyReferences} from '../public/ecommerce-time-results.mjs';
import {BUILTIN_SCENARIOS,isSceneKey,scenarioForTask,validateScenarioRegistry,validateScenarioMapping,freezeScenario,checkScenarioCapabilities} from '../public/scenarios.mjs';
import {validateSceneRegistry,latestSceneConfiguration,freezeSceneExecution,sceneBasisForTask} from '../public/scene-configuration.mjs';
import {inspectionRules} from '../public/scene-aggregate.mjs';
import {assertTaskCatalogScene,catalogRecordMatchesScene} from '../public/catalog-scenes.mjs';
import {validateTriageTask,validateTriageSession,validateReturnTransition,validateDecisionHistoryTransition} from './triage-validation.mjs';
import {validateDependencyRecoveryHistory} from '../public/scene-dependency-staleness.mjs';
import {AI_TASK_QUEUE_STATUSES,AI_TASK_QUEUE_PAUSE_REASONS} from './ai-task-scheduler.mjs';
import {validateCleaningReportSnapshot} from '../public/conversation-cleaning.mjs';
import {isFinalSession} from '../public/ai-triage.mjs';
import {RAW_INPUT_MODE,isRawTranscriptSession} from '../public/raw-transcript.mjs';
import {validateRawTaskSource} from './raw-source.mjs';
import {validateCalibrationTransition} from './rule-calibration.mjs';
import {ruleExemption} from '../public/rule-calibration-policy.mjs';
import {createHash} from 'node:crypto';
import {workflowDependencies} from './workflow-contract.mjs';
import {RAW_INSPECTION_PROMPT_VERSION} from './raw-inspection.mjs';

export class WorkspaceError extends Error {
  constructor(message,status=400){super(message);this.name='WorkspaceError';this.status=status;}
}
export const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new WorkspaceError(message);};
const text=(value,label,max=1000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label}须为非空文本。`);};
const identifier=(value,label)=>text(value,label,160);
const equal=(a,b)=>a===b||canonical(a)===canonical(b);
export function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(object(value))return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function unique(records,label){
  if(!Array.isArray(records))fail(`${label}须为数组。`);
  const found=new Set();for(const record of records){if(!object(record))fail(`${label}记录无效。`);identifier(record.id,`${label}标识`);if(found.has(record.id))fail(`${label}标识重复。`);found.add(record.id);}return found;
}
function strings(value,label){
  if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!item.trim())||new Set(value).size!==value.length)fail(`${label}须为无重复的标识数组。`);
}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!value.startsWith('0000-')&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;}
function validZonedTime(value){
  const match=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  return Boolean(match&&validDate(match[1])&&+match[2]<=23&&+match[3]<=59&&+match[4]<=59&&(match[5]==='Z'||(+match[6]<=14&&+match[7]<=59&&(+match[6]!==14||+match[7]===0)))&&Number.isFinite(Date.parse(value)));
}
function validateSnapshot(snapshot){
  if(!object(snapshot)||typeof snapshot.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(snapshot.capturedAt)||!Number.isFinite(Date.parse(snapshot.capturedAt))||!validDate(snapshot.effectiveDate))fail('任务依据快照日期无效。');
  const ruleIds=unique(snapshot.rules,'快照规则'),policyIds=unique(snapshot.policies,'快照资料');
  if(!ruleIds.size)fail('任务依据快照不能没有规则。');
  for(const rule of snapshot.rules){
    text(rule.name??rule.title,'快照规则名称');text(rule.version,'快照规则版本',40);strings(rule.policyIds,'快照规则资料关联');
    for(const key of ['passCriteria','failCriteria','exceptionCriteria'])text(rule[key],'快照规则标准',20000);
    if(rule.policyIds.some(id=>!policyIds.has(id)))fail('快照规则引用的资料不存在。');
  }
  for(const policy of snapshot.policies){
    text(policy.title,'快照资料名称');text(policy.version,'快照资料版本',40);unique(policy.sections,'快照条款');
    if(!policy.sections.length)fail('快照资料缺少条款。');for(const section of policy.sections){text(section.title,'条款标题');text(section.text,'条款正文',20000);}
  }
  return snapshot;
}
function authenticateSnapshot(snapshot,catalog){
  if(snapshot.ruleSetSnapshot!==undefined){
    try{authenticateEcommerceRuleSetBasis(catalog,snapshot);}catch(error){fail(error.message);}
    return;
  }
  const common=['id','title','version','category','scope','effectiveAt','expiresAt','owner','changeNote','status','createdAt','publishedAt'];
  const project=(record,keys)=>Object.fromEntries(keys.map(key=>[key,record[key]]));
  const selected=(records,id)=>{
    const candidates=records.filter(record=>record.id===id&&record.status==='已发布'&&record.effectiveAt<=snapshot.effectiveDate&&(!record.expiresAt||snapshot.effectiveDate<record.expiresAt));
    if(candidates.length!==1)fail(`新任务快照须引用所选日期唯一有效的已发布版本：${id}。`);return candidates[0];
  };
  const neededPolicies=new Set();
  for(const rule of snapshot.rules){
    const published=selected(catalog.rules,rule.id),keys=[...common,'passCriteria','failCriteria','exceptionCriteria','policyIds','provenance'];
    if(!isSessionCheckRule(published)||!isSessionCheckRule(rule)||ruleKindOf(rule)!==ruleKindOf(published))fail(`交付物要求不能进入新会话质检任务：${rule.id}。`);
    if(!equal(project(rule,keys),project(published,keys))||rule.name!==published.title)fail(`新任务规则快照与已发布正文不一致：${rule.id}。`);
    published.policyIds.forEach(id=>neededPolicies.add(id));
  }
  if(snapshot.policies.length!==neededPolicies.size||snapshot.policies.some(policy=>!neededPolicies.has(policy.id)))fail('新任务资料快照须精确对应所选规则引用的资料。');
  for(const policy of snapshot.policies){
    const published=selected(catalog.policies,policy.id),keys=[...common,'source'];
    const sections=published.sections.map(section=>project(section,['id','title','text']));
    const content=sections.map(section=>`${section.id} ${section.title}\n${section.text}`).join('\n\n');
    if(!equal(project(policy,keys),project(published,keys))||!equal(policy.sections.map(section=>project(section,['id','title','text'])),sections)||policy.content!==content)fail(`新任务资料快照与已发布正文不一致：${policy.id}。`);
  }
}
function validateJudgment(result,ruleIds,turnIds,referenceIds,contextFields=[],batchSessions=[],sessionId=null,basis=null){
  if(!object(result)||!ruleIds.has(result.ruleId)||!['符合','不符合','无法判定','不适用'].includes(result.verdict))fail('人工或AI判定结构无效。');
  text(result.reason,'判定理由',20000);
  if(result.semanticReason!==undefined)text(result.semanticReason,'原模型语义理由',20000);
  if(!Array.isArray(result.evidence)||result.evidence.some(id=>!turnIds.has(id)))fail('判定证据轮次不存在。');
  strings(result.referenceIds??[],'判定参考资料');if((result.referenceIds??[]).some(id=>!referenceIds.has(id)))fail('判定依据不属于任务快照。');
  try{validateFieldEvidence(result.fieldEvidence===undefined?[]:result.fieldEvidence,contextFields);}catch(error){fail(error.message);}
  if(result.batchEvidence!==undefined){try{if(result.ruleId!=='EC-TARGET')fail('跨记录证据只能属于电商针对性项。');validateDuplicateGroups(result.batchEvidence,batchSessions,basis);if(result.batchEvidence.some(group=>!group.sessionIds.includes(sessionId)))fail('跨记录证据组必须包含当前判定的本条记录。');}catch(error){fail(error.message);}}
}
function referenceSets(basis){
  const occurrences=new Map();
  for(const policy of basis.policies)for(const id of [policy.id,...policy.sections.map(section=>section.id)])occurrences.set(id,(occurrences.get(id)||0)+1);
  return new Map(basis.rules.map(rule=>{
    const allowed=new Set();
    for(const policy of basis.policies.filter(policy=>rule.policyIds.includes(policy.id))){
      for(const id of [policy.id,...policy.sections.map(section=>section.id)])if(occurrences.get(id)===1)allowed.add(id);
      const prefix=`${encodeURIComponent(policy.id)}@${policy.version}#`;allowed.add(prefix);
      for(const section of policy.sections)allowed.add(prefix+encodeURIComponent(section.id));
    }
    return [rule.id,allowed];
  }));
}
function demoMatches(session){
  // 历史演示修改了发言方姓名与日期，但轮次、角色和原文必须完整匹配固定材料。
  return demoSessions.some(template=>equal(template.turns.map(({id,role,text})=>({id,role,text})),session.turns.map(({id,role,text})=>({id,role,text}))));
}
function without(value,keys){return Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));}

const aiText=(value,label,max=160)=>{text(value,label,max);if(/[\u0000-\u001f\u007f]/.test(value)||/Bearer\s|\bsk-[\w-]+|api[_-]?key\s*[:=]/i.test(value))fail(`${label}包含不安全内容。`);};
const aiModelText=(value,label)=>{aiText(value,label,320);if([...value].length>160)fail(`${label}不能超过160个字符。`);};
function aiFields(record,allowed,label){if(!object(record)||Object.keys(record).some(key=>!allowed.includes(key)))fail(`${label}结构无效。`);}
function executionTime(record,label){
  if(!validZonedTime(record.startedAt)||(['queued','running','paused'].includes(record.status)?record.completedAt!==null:!validZonedTime(record.completedAt))||(record.completedAt!==null&&Date.parse(record.completedAt)<Date.parse(record.startedAt)))fail(`${label}执行时间无效。`);
}
function validateRun(run){
  aiFields(run,['id','modelId','status','total','done','failed','startedAt','completedAt','modelConfig','modelConfigFingerprint','inspectionAt'],'AI运行记录');
  aiText(run.id,'AI运行标识');aiModelText(run.modelId,'AI模型标识');
  if(run.modelConfig!==undefined||run.modelConfigFingerprint!==undefined){
    aiFields(run.modelConfig,MODEL_CONFIG_FIELDS,'AI冻结模型配置');
    let snapshot;try{snapshot=modelConfigSnapshot(run.modelConfig);}catch{fail('AI冻结模型配置无效。');}
    if(!equal(run.modelConfig,snapshot)||run.modelId!==snapshot.model||run.modelConfigFingerprint!==modelConfigFingerprint(snapshot))fail('AI冻结模型配置与运行指纹不一致。');
  }
  if(!AI_TASK_QUEUE_STATUSES.includes(run.status)||['total','done','failed'].some(key=>!Number.isSafeInteger(run[key])||run[key]<0)||run.total<1||run.done+run.failed>run.total)fail('AI运行状态或计数无效。');
  executionTime(run,'AI运行');
  if(run.inspectionAt!==undefined&&(!validZonedTime(run.inspectionAt)||run.inspectionAt!==run.startedAt))fail('AI检核截止点须冻结为逻辑运行开始时刻。');
}
function validateExecution(execution,task){
  aiFields(execution,['status','runId','modelId','requestedModel','startedAt','completedAt','error','errorCode','requestId','promptVersion','usage','inputSha256','basisSha256'],'AI执行记录');
  if(!['running','completed','failed'].includes(execution.status))fail('AI执行状态无效。');
  aiText(execution.runId,'AI执行运行标识');aiModelText(execution.modelId,'AI执行模型标识');
  const run=[task.aiRun,...(task.aiRunHistory||[])].find(run=>run?.id===execution.runId);
  if(!run)fail('AI执行关联的运行记录不存在。');
  if(execution.requestedModel!==undefined){aiModelText(execution.requestedModel,'AI请求模型标识');if(execution.requestedModel!==run.modelId)fail('AI执行请求模型与运行记录不一致。');}
  executionTime(execution,'AI');
  for(const key of ['requestId','promptVersion','errorCode'])if(execution[key]!==undefined)aiText(execution[key],`AI执行${key}`);
  if(execution.errorCode!==undefined&&!/^[A-Za-z0-9_.:-]+$/.test(execution.errorCode))fail('AI执行错误码无效。');
  if(execution.error!==undefined)aiText(execution.error,'AI执行错误提示',1000);
  for(const key of ['inputSha256','basisSha256'])if(execution[key]!==undefined&&!/^[a-f0-9]{64}$/.test(execution[key]))fail('AI执行输入摘要无效。');
  if(execution.usage!==undefined){aiFields(execution.usage,['prompt_tokens','completion_tokens','total_tokens'],'AI用量');if(Object.values(execution.usage).some(value=>!Number.isSafeInteger(value)||value<0))fail('AI用量无效。');}
}

function validateQueue(queue,task,sessions){
  if(!object(queue)||queue.version!==1||!AI_TASK_QUEUE_STATUSES.includes(queue.status)||!['rows','comparison','completed'].includes(queue.phase)||!object(queue.settings)||!Array.isArray(queue.rows)||!Array.isArray(queue.batches)||!/^[a-f0-9]{64}$/.test(queue.fingerprint)||!validZonedTime(queue.updatedAt))fail('AI行队列结构无效。');
  for(const [key,min,max] of [['concurrency',1,4],['batchSize',1,100],['maxWorkBytes',4096,250000]])if(!Number.isSafeInteger(queue.settings[key])||queue.settings[key]<min||queue.settings[key]>max)fail('AI队列调度设置无效。');
  if(queue.status!==task.aiStatus)fail('AI队列状态与任务状态不一致。');
  if(queue.modelConfigFingerprint!==undefined&&(!/^[a-f0-9]{64}$/.test(queue.modelConfigFingerprint)||queue.modelConfigFingerprint!==task.aiRun.modelConfigFingerprint))fail('AI队列模型配置指纹与运行记录不一致。');
  if(task.aiRun.modelConfigFingerprint!==undefined&&queue.modelConfigFingerprint!==task.aiRun.modelConfigFingerprint)fail('AI队列缺少匹配的模型配置指纹。');
  const ids=new Set(sessions.filter(s=>s.taskId===task.id).map(s=>s.id)),rows=new Set(),batches=new Set();
  for(const batch of queue.batches){if(!object(batch)||typeof batch.id!=='string'||batches.has(batch.id)||!Array.isArray(batch.sessionIds)||!batch.sessionIds.length||batch.sessionIds.some(id=>!ids.has(id))||!['pending','running','completed','partial'].includes(batch.status))fail('AI调度段结构无效。');batches.add(batch.id);}
  for(const row of queue.rows){if(!object(row)||!ids.has(row.sessionId)||rows.has(row.sessionId)||!batches.has(row.batchId)||!['pending','running','completed','failed','blocked','protected'].includes(row.status)||!Number.isSafeInteger(row.attempts)||row.attempts<0||!Number.isFinite(row.durationMs)||row.durationMs<0||!/^[a-f0-9]{64}$/.test(row.inputSha256))fail('AI逐行检查点无效。');rows.add(row.sessionId);if(!queue.batches.find(b=>b.id===row.batchId).sessionIds.includes(row.sessionId))fail('AI行与调度段关联无效。');if(row.semanticResult!==undefined&&(!object(row.semanticResult)||!Array.isArray(row.semanticResult.results)))fail('AI局部语义缓存无效。');}
  if(rows.size!==ids.size||queue.batches.flatMap(b=>b.sessionIds).length!==ids.size)fail('AI队列须精确覆盖完整业务批次。');
  if(queue.comparison!==null){const c=queue.comparison;if(!object(c)||!Array.isArray(c.blocks)||!Array.isArray(c.groups)||!['pending','running','completed','failed'].includes(c.status))fail('全批次相似比较检查点无效。');for(const block of c.blocks)if(!object(block)||!['pending','running','completed','failed'].includes(block.status)||!Number.isSafeInteger(block.attempts)||block.attempts<0||(block.status==='completed'&&!object(block.result)))fail('相似比较块检查点无效。');}
  if(task.inputMode===RAW_INPUT_MODE){
    if(queue.comparison!==null)fail('原文直判不允许借用电商跨行比较缓存。');
    const options={basis:task.basisSnapshot,inspectionAt:task.aiRun.inspectionAt,rawImportOptions:task.rawImportOptions,promptVersion:RAW_INSPECTION_PROMPT_VERSION,modelConfigFingerprint:task.aiRun.modelConfigFingerprint},rows=sessions.filter(session=>session.taskId===task.id),sha=value=>createHash('sha256').update(canonical(value)).digest('hex');
    const expected=sha({version:4,...(task.executionSnapshot?{executionSnapshot:task.executionSnapshot}:{}),basis:task.basisSnapshot,settings:queue.settings,modelConfigFingerprint:task.aiRun.modelConfigFingerprint,sessions:rows.map(session=>workflowDependencies(session,options)),promptVersion:RAW_INSPECTION_PROMPT_VERSION,inspectionAt:task.aiRun.inspectionAt});
    if(queue.fingerprint!==expected)fail('原文队列缓存指纹与冻结来源、规则、模型或检核时点不一致。');
    for(const row of queue.rows){
      const session=rows.find(session=>session.id===row.sessionId);
      if(row.sourceRow!==session.rawTranscript.row||row.inputSha256!==sha(workflowDependencies(session,options)))fail('原文行缓存摘要或物理行与冻结来源不一致。');
      if(row.status==='completed'&&session.aiExecution?.status!=='completed'||row.semanticResult!==undefined&&(row.status!=='completed'||session.aiExecution?.status!=='completed'||!equal(row.semanticResult.results,session.aiResults)))fail('原文行缓存不能把技术失败、他行结果或未完成结果冒充已完成。');
    }
    if(queue.status==='completed'&&queue.rows.some(row=>!['completed','protected'].includes(row.status)))fail('原文队列仍有未完成或失败行，不能标为全部完成。');
  }
  const current=queue.rows.filter(r=>r.runId===task.aiRun.id),done=current.filter(r=>sessions.find(s=>s.id===r.sessionId)?.aiExecution?.status==='completed').length,failed=current.filter(r=>r.status==='failed').length;
  if(done!==task.aiRun.done||failed!==task.aiRun.failed)fail('AI持久队列与运行计数不一致。');
}

function validateTaskScheduler(state){
 const q=state.aiTaskQueue;if(q===undefined)return;
 aiFields(q,['version','status','pauseReason','nextSequence','entries'],'AI任务调度器');
 if(q.version!==1||!['ready','paused'].includes(q.status)||!Number.isSafeInteger(q.nextSequence)||q.nextSequence<1||!Array.isArray(q.entries)||q.entries.length>10000||(q.status==='ready'?q.pauseReason!==null:!AI_TASK_QUEUE_PAUSE_REASONS.includes(q.pauseReason)))fail('AI任务调度器状态无效。');
 const sequences=new Set(),keys=new Set(),pendingTasks=new Set();let running=0;
 for(const item of q.entries){
  aiFields(item,['taskId','runId','sequence','queuedAt','status','completedAt','blockedReason'],'AI排队项');
  const task=state.tasks.find(t=>t.id===item.taskId),run=[task?.aiRun,...(task?.aiRunHistory||[])].find(r=>r?.id===item.runId),terminal=['completed','partial','failed','cancelled'].includes(item.status),key=JSON.stringify([item.taskId,item.runId]);
  if(!run||!AI_TASK_QUEUE_STATUSES.includes(item.status)||item.status!==run.status||item.completedAt!==run.completedAt||!validZonedTime(item.queuedAt)||!Number.isSafeInteger(item.sequence)||item.sequence<1||item.sequence>=q.nextSequence||sequences.has(item.sequence)||keys.has(key)||(terminal?!validZonedTime(item.completedAt):item.completedAt!==null)||(item.blockedReason!==null&&!AI_TASK_QUEUE_PAUSE_REASONS.includes(item.blockedReason)))fail('AI排队项与冻结任务或顺序不一致。');
  if(!terminal){if(pendingTasks.has(item.taskId))fail('同一任务不能重复等待执行。');pendingTasks.add(item.taskId);}if(item.status==='running')running++;
  sequences.add(item.sequence);keys.add(key);
 }
 if(running>1)fail('AI任务调度必须串行执行。');
}
function validateRawReviewTime(session,task){
 const review=session.review;
 if(review.activeTimeMs===undefined&&review.timeSegments===undefined)return;
 if(!isRawTranscriptSession(session)||!Array.isArray(review.timeSegments)||review.timeSegments.length>10000||typeof review.activeTimeMs!=='number'||!Number.isFinite(review.activeTimeMs)||review.activeTimeMs<0)fail('原文活跃审核时长结构无效。');
 const used=new Set();let sum=0,last=Date.parse(task.createdAt);
 for(const item of review.timeSegments){
  if(!object(item)||Object.keys(item).length!==4||Object.keys(item).some(key=>!['segmentId','elapsedMs','reviewer','at'].includes(key))||typeof item.segmentId!=='string'||!item.segmentId.trim()||item.segmentId.length>160||/[\u0000-\u001f\u007f]/.test(item.segmentId)||used.has(item.segmentId)||typeof item.elapsedMs!=='number'||!Number.isFinite(item.elapsedMs)||item.elapsedMs<0||item.elapsedMs>4*60*60*1000||typeof item.reviewer!=='string'||!item.reviewer.trim()||item.reviewer.length>80||!validZonedTime(item.at)||Date.parse(item.at)<last)fail('原文审核计时段的时长、操作人、时间或唯一标识无效。');
  used.add(item.segmentId);sum+=item.elapsedMs;last=Date.parse(item.at);
 }
 if(sum!==review.activeTimeMs||!Number.isFinite(sum))fail('原文活跃审核总时长须等于逐段记录之和。');
}
function validateRawReviewTimeTransition(before,after,trustedAI){
 const old=before.review.timeSegments??[],next=after.review.timeSegments??[];
 if(next.length<old.length||!equal(old,next.slice(0,old.length)))fail('已有活跃审核计时记录不可删除或改写。');
 if(trustedAI&&(!equal(old,next)||before.review.activeTimeMs!==after.review.activeTimeMs))fail('AI执行不可修改人工活跃审核时长。');
 if(next.length>old.length&&(before.review.status==='已确认'||before.aiExecution?.status==='running'||isFinalSession(before)))fail('最终结论只读或AI运行期间不能累计人工审核时长。');
}
function validateRawReinspection(task,tasks,sessions){
 if(task.reinspectionOf===undefined)return;
 const parent=tasks.get(task.reinspectionOf),rows=task.sessionIds.map(id=>sessions.find(session=>session.id===id)),old=parent?.sessionIds.map(id=>sessions.find(session=>session.id===id));
 if(task.inputMode!==RAW_INPUT_MODE||!parent||parent.inputMode!==RAW_INPUT_MODE||parent.id===task.id||!equal(task.source,parent.source)||!equal(task.rawImportOptions?.timePolicy,parent.rawImportOptions?.timePolicy)||!old||rows.length!==old.length||rows.some((session,index)=>session?.externalId!==old[index]?.externalId||!equal(session?.rawTranscript,old[index]?.rawTranscript)))fail('原文重检须关联完整相同归档来源和时间声明的父任务。');
 const visited=new Set([task.id]);let current=parent;
 while(current){if(visited.has(current.id))fail('原文重检父任务关系不能循环。');visited.add(current.id);current=current.reinspectionOf?tasks.get(current.reinspectionOf):null;}
}
export function validateWorkspace(state,catalog,previous=null,{authenticateNewSnapshots=false,trustedAI=false,trustedLifecycle=false,trustedCalibration=false,trustedScene=false,trustedReview=false}={}){
  const priorSessions=new Map((previous?.sessions||[]).map(s=>[s.id,s]));
  if(trustedReview){
    if(!previous||Object.keys(previous).some(k=>!['tasks','sessions','activity'].includes(k)&&state[k]!==previous[k])||state.tasks.length!==previous.tasks.length||state.sessions.length!==previous.sessions.length)fail('审核命令不能改变工作区范围。');
    for(let i=0;i<state.tasks.length;i++){const a=previous.tasks[i],b=state.tasks[i];if(Object.keys(a).some(k=>!['status','progress'].includes(k)&&a[k]!==b[k])||Object.keys(b).some(k=>!Object.hasOwn(a,k)&&!['status','progress'].includes(k)))fail('审核命令不能修改任务依据。');}
    for(let i=0;i<state.sessions.length;i++){const a=previous.sessions[i],b=state.sessions[i];if(a!==b&&(Object.keys(a).some(k=>k!=='review'&&a[k]!==b[k])||Object.keys(b).some(k=>!Object.hasOwn(a,k))))fail('审核命令不能修改会话原文或AI原判。');}
  }
  try{validateCatalog(catalog);}catch(error){fail(`资料目录无效：${error.message}`);}
  if(state?.businessMigrationVersion!==undefined&&state.businessMigrationVersion!==1)fail('业务迁移版本无效。');
  if(state?.legacyDemoArchive!==undefined&&(!object(state.legacyDemoArchive)||state.legacyDemoArchive.schemaVersion!==1||state.businessMigrationVersion!==1))fail('历史演示归档版本无效。');
  if(!object(state)||state.schemaVersion!==1)fail('工作区 state.schemaVersion 必须为1。');
  try{if(!trustedReview)validateSceneRegistry(state,previous,{trustedScene});}catch(error){fail(error.message);}
  let scenarios;try{scenarios=validateScenarioRegistry(state);}catch(error){fail(error.message);}
  const knownScenes=new Set([...BUILTIN_SCENARIOS,...scenarios].map(config=>config.id));
  for(const record of [...catalog.rules,...catalog.policies])for(const id of record.sceneIds||[])if(!knownScenes.has(id))fail(`目录场景归属尚未注册：${id}。`);
  if(authenticateNewSnapshots)for(const config of scenarios){
    const old=previous?.scenarios?.find(item=>item.id===config.id);if(old&&equal(old,config))continue;
    for(const id of config.ruleIds){
      const records=[...catalog.rules,...(catalog.deletedRules||[]).map(item=>item.snapshot)].filter(rule=>rule.id===id);
      if(!records.some(rule=>catalogRecordMatchesScene(rule,config.id,{state,catalog,kind:'rules'})))fail(`默认规则未归属于当前场景：${id}。`);
    }
  }
  if(state.inputProfiles!==undefined){
    if(!Array.isArray(state.inputProfiles)||state.inputProfiles.length>100)fail('导入配置最多100份。');
    const ids=new Set();for(const profile of state.inputProfiles){try{validateInputProfile(profile);}catch(error){fail(error.message);}if(!knownScenes.has(profile.scene))fail('导入配置引用的场景尚未注册。');if(ids.has(profile.id))fail('导入配置标识重复。');ids.add(profile.id);}
  }
  if(previous){
    const current=new Map(scenarios.map(config=>[config.id,config]));
    for(const old of previous.scenarios||[]){
      const next=current.get(old.id);if(!next)fail('场景配置不可删除；请停用以保留历史记录。');
      if(!equal(old,next)&&(next.version!==old.version+1||next.createdAt!==old.createdAt||Date.parse(next.updatedAt)<Date.parse(old.updatedAt)))fail('场景修改须保留创建时间并递增一个版本，不能跳过版本或回退时间。');
    }
    const oldIds=new Set((previous.scenarios||[]).map(config=>config.id));if(scenarios.some(config=>!oldIds.has(config.id)&&config.version!==1))fail('新场景配置须从版本1开始。');
  }
  if(state.taskDeletionAudit!==undefined){
    if(!Array.isArray(state.taskDeletionAudit)||new Set(state.taskDeletionAudit.map(a=>a.task?.id)).size!==state.taskDeletionAudit.length)fail('任务删除审计无效。');
    for(const a of state.taskDeletionAudit)if(!a.task?.id||state.tasks.some(t=>t.id===a.task.id)||!validZonedTime(a.at)||!a.actor?.trim()||!a.reason?.trim()||a.administratorConfirmed!==true||!a.backupPath||!/^[a-f0-9]{64}$/.test(a.snapshotSha256)||!Number.isSafeInteger(a.sessionCount))fail('任务删除审计无效。');
  }
  if(previous&&!equal(previous.taskDeletionAudit,state.taskDeletionAudit))fail('任务删除审计只能由删除事务写入，不能改写。');
  const taskIds=unique(state.tasks,'任务'),sessionIds=unique(state.sessions,'会话');unique(state.activity,'活动');
  const tasks=new Map(state.tasks.map(task=>[task.id,task]));
  for(const task of state.tasks){
    if(trustedReview)continue;
    try{validateTaskLifecycle(task);}catch(error){fail(error.message);}
    if(authenticateNewSnapshots&&!previous?.tasks.some(old=>old.id===task.id)&&task.lifecycle!==undefined)fail('新任务不能预置生命周期记录。');
    if(task.mode!=='manual'&&(task.inputMode!==undefined||task.rawImportOptions!==undefined||task.evidenceContractVersion!==undefined||task.reinspectionOf!==undefined||state.sessions.some(session=>session.taskId===task.id&&isRawTranscriptSession(session))))fail('原文直判来源只能属于独立业务任务。');
    text(task.name,'任务名称');text(task.status,'任务状态',80);strings(task.sessionIds,'任务会话关联');
    if(task.scene!==undefined&&!isSceneKey(task.scene))fail('任务场景标识无效。');
    const scenario=scenarioForTask(task),customScene=typeof task.scene==='string'&&task.scene.startsWith('SCENE-');
    if(task.scenarioSnapshot!==undefined&&!scenario)fail('任务场景快照无效或与任务场景不一致。');
    if(customScene&&(task.mode!=='manual'||!scenario))fail('自定义场景任务必须保存完整场景快照。');
    if(scenario&&task.scenarioSnapshot!==undefined&&!scenario.enabled)fail('任务场景快照必须为创建时已启用的配置。');
    if(scenario&&task.mode==='manual'){const errors=checkScenarioCapabilities(scenario,task.basisSnapshot?.rules||[]);if(errors.length)fail(errors.join(' '));}
    if(task.mode==='manual'&&authenticateNewSnapshots&&!previous?.tasks.some(record=>record.id===task.id&&record.mode==='manual')){
      if(!isSceneKey(task.scene)||task.scenarioSnapshot===undefined)fail('新业务任务必须保存已注册场景标识及完整场景快照。');
      let active;try{active=freezeScenario(state,task.scene);}catch(error){fail(error.message);}
      if(!equal(task.scenarioSnapshot,active))fail('新任务场景快照须精确匹配已注册且已启用的当前版本。');
    }
    if(!Number.isFinite(task.progress)||task.progress<0||task.progress>100)fail('任务进度无效。');
    if(task.mode!==undefined&&!['demo','manual'].includes(task.mode))fail('任务模式无效。');
    if(task.basisSnapshot!==undefined)validateSnapshot(task.basisSnapshot);
    if(task.mode==='manual'&&(!['not_run',...AI_TASK_QUEUE_STATUSES].includes(task.aiStatus)||!task.basisSnapshot))fail('业务任务必须保存依据快照及有效AI状态。');
    try{validateTriageTask(task);}catch(error){fail(error.message);}
    if(task.mode==='manual'){
      const taskSessions=state.sessions.filter(session=>session.taskId===task.id),hasRaw=taskSessions.some(isRawTranscriptSession);
      if(task.inputMode!==undefined&&task.inputMode!==RAW_INPUT_MODE||hasRaw&&task.inputMode!==RAW_INPUT_MODE||!hasRaw&&(task.inputMode===RAW_INPUT_MODE||task.rawImportOptions!==undefined||task.evidenceContractVersion!==undefined||task.reinspectionOf!==undefined))fail('任务原文输入模式与逐行来源不一致。');
      if(hasRaw){try{validateRawTaskSource(task,taskSessions);}catch(error){fail(error.message);}validateRawReinspection(task,tasks,state.sessions);}
      if(authenticateNewSnapshots&&!previous?.tasks.some(record=>record.id===task.id&&record.mode==='manual')&&task.scene==='电商评论回复'&&(state.sessions.filter(session=>session.taskId===task.id).some(session=>!session.ecommerce)||!isEcommerceBasis(task.basisSnapshot)))fail('新建电商场景必须提供电商来源及专用规则版本。');
      const sourceRows=state.sessions.filter(session=>session.taskId===task.id&&session.ecommerce).map(session=>session.ecommerce);
      if(sourceRows.length)try{validateEcommerceSources(sourceRows,task.source);}catch(error){fail(error.message);}
      if(task.executionSettings!==undefined){const settings=task.executionSettings;if(!object(settings)||Object.keys(settings).some(key=>!['concurrency','batchSize','maxWorkBytes'].includes(key)))fail('任务调度预设字段无效。');for(const [key,min,max] of [['concurrency',1,4],['batchSize',1,100],['maxWorkBytes',4096,250000]])if(settings[key]!==undefined&&(!Number.isSafeInteger(settings[key])||settings[key]<min||settings[key]>max))fail('任务调度预设超出允许范围。');}
      if(task.aiRun!==undefined){validateRun(task.aiRun);if(task.aiRun.status!==task.aiStatus)fail('AI运行记录与任务状态不一致。');}
      if(task.aiRunHistory!==undefined){if(!Array.isArray(task.aiRunHistory))fail('AI历史运行记录须为数组。');task.aiRunHistory.forEach(validateRun);}
      const runs=[...(task.aiRun?[task.aiRun]:[]),...(task.aiRunHistory||[])];
      if((task.inputMode===RAW_INPUT_MODE||isStageATimeBasis(task.basisSnapshot)||isBusinessEcommerceBasis(task.basisSnapshot))&&runs.some(run=>!validZonedTime(run.inspectionAt)))fail('原文直判或阶段A运行须保存冻结检核截止点。');
      if(new Set(runs.map(run=>run.id)).size!==runs.length)fail('AI运行标识重复。');
      if(task.aiStatus==='not_run'?(task.aiRun!==undefined||runs.length>0):!task.aiRun)fail('AI任务状态缺少对应运行记录。');
      if(authenticateNewSnapshots&&!trustedAI&&!previous?.tasks.some(record=>record.id===task.id&&record.mode==='manual')&&(task.aiStatus!=='not_run'||task.aiRun!==undefined||task.aiRunHistory!==undefined||task.aiQueue!==undefined))fail('新业务任务不允许预置AI运行记录。');
      if(task.aiQueue!==undefined)validateQueue(task.aiQueue,task,state.sessions);
      if(!object(task.source)||typeof task.source.name!=='string'||!task.source.name.trim()||task.source.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(task.source.name)||!Number.isSafeInteger(task.source.size)||task.source.size<1||task.source.size>8*1024*1024)fail('人工任务必须关联已保存的原文件名称、摘要和有效大小。');
      if(authenticateNewSnapshots&&!previous?.tasks.some(record=>record.id===task.id&&record.mode==='manual')){
        if(latestSceneConfiguration(state,task.scene)){
          const frozen=task.executionSnapshot;if(!frozen)fail('新任务必须保存完整场景配置快照。');
          try{const basis=sceneBasisForTask(state,catalog,task.scene,task.basisSnapshot.capturedAt);if(!equal(basis,task.basisSnapshot)||!equal(freezeSceneExecution(state,task.scene,{basis,overrides:frozen.overrides,overrideReason:frozen.overrideReason}),frozen))fail('新任务完整快照必须匹配场景发布版本。');}catch(error){fail(error.message);}
        }else authenticateSnapshot(task.basisSnapshot,catalog);
        try{assertTaskCatalogScene({state,catalog,scene:task.scene,basisSnapshot:task.basisSnapshot});}catch(error){fail(error.message);}
      }
    }
    if(task.source!==undefined&&(!object(task.source)||typeof task.source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(task.source.sha256)))fail('任务原文件摘要无效。');
    if(task.importMappingSnapshot!==undefined){try{if(!object(task.importMappingSnapshot)||Object.keys(task.importMappingSnapshot).some(k=>k!=='profile'))fail('映射快照结构无效。');validateInputProfile(task.importMappingSnapshot.profile);if(task.importMappingSnapshot.profile.scene!==task.scene)fail('映射快照场景与任务不一致。');if(customScene)validateScenarioMapping(scenario,task.importMappingSnapshot.profile);}catch(error){fail(error.message);}}
    else if(customScene&&scenario.report.groupBy==='context')fail('扩展字段分组须保存明确的导入映射快照。');
    if(task.cleaningReportSnapshot!==undefined)try{validateCleaningReportSnapshot(task.cleaningReportSnapshot,{source:task.source,sessions:state.sessions.filter(s=>s.taskId===task.id)});}catch(error){fail(error.message);}
    for(const id of task.sessionIds)if(!sessionIds.has(id)||state.sessions.find(session=>session.id===id).taskId!==task.id)fail('任务与会话关联不一致。');
  }
  validateImportLineages(state,previous);
  const businessIds=new Set();
  for(const session of state.sessions.filter(s=>tasks.get(s.taskId)?.mode==='manual')){const key=JSON.stringify([session.taskId,session.externalId]);if(businessIds.has(key))fail('同一任务内会话标识重复。');businessIds.add(key);}
  const ecommerceRows=new Set();
  validateTaskScheduler(state);
  for(const session of state.sessions){
    if(trustedReview&&session===priorSessions.get(session.id))continue;
    if(!taskIds.has(session.taskId))fail('会话关联任务不存在。');const task=tasks.get(session.taskId);
    if(!task.sessionIds.includes(session.id))fail('任务缺少会话关联。');identifier(session.externalId,'原会话标识');
    if(session.scene!==undefined&&!isSceneKey(session.scene))fail('会话场景标识无效。');
    if(task.mode==='manual'&&((task.scene!==undefined&&session.scene!==task.scene)||(session.scene?.startsWith('SCENE-')&&task.scene!==session.scene)))fail('任务与会话场景必须一致。');
    if(!Array.isArray(session.turns)||(!session.turns.length&&!isRawTranscriptSession(session)))fail('会话须包含原文轮次。');
    const turnIds=new Set();for(const turn of session.turns){
      if(!object(turn)||!Number.isSafeInteger(turn.id)||turn.id<1||turnIds.has(turn.id))fail('会话轮次标识无效或重复。');
      turnIds.add(turn.id);text(turn.role,'发言角色',80);text(turn.text,'会话原文',200000);
    }
    if(!Array.isArray(session.aiResults)||!object(session.review)||!object(session.review.drafts)||!['待审核','已暂存','已确认','待补充'].includes(session.review.status)||typeof session.review.reviewer!=='string'||typeof session.review.notes!=='string'||(session.review.completedAt!==null&&typeof session.review.completedAt!=='string'))fail('会话AI结果或人工审核结构无效。');
    validateRawReviewTime(session,task);
    try{validatePendingResolution(session,task,state);}catch(error){fail(error.message);}
    if(session.review.classification){const c=session.review.classification;if(c.origin!==undefined&&!['manual-row-failed','human-review'].includes(c.origin))fail('评价分类人工来源无效。');if(!requiresEcommerceClassification(session)||!['好评正向','好评负向','中评','差评','无效评价'].includes(c.evaluationType)||!['substantive','strong-negative','none'].includes(c.vocKind)||!validZonedTime(c.at)||!c.reason?.trim()||c.reason.length>2000||c.reviewer!==session.review.reviewer||typeof c.changed!=='boolean'||c.changed!==(c.evaluationType!==session.sceneCapabilities?.outputs?.ecommerceClassification?.value?.evaluationType||c.vocKind!==session.sceneCapabilities?.outputs?.ecommerceClassification?.value?.vocKind)||!Array.isArray(session.review.classificationHistory))fail('评价分类人工复核记录无效。');}
    if(session.review.status==='已确认'&&requiresEcommerceClassification(session)&&(!classificationReviewed(session)||['EC-TIME','EC-STEPS'].some(id=>classificationNeedsJudgment(session,id))))fail('确认前须复核评价归类及改判后受影响的检核项。');
    const basis=task.basisSnapshot||{rules:demoRules,policies:demoPolicies};
    if(task.mode==='manual'&&!session.ecommerce&&basis.rules.some(rule=>rule.id.startsWith('EC-')))fail('电商专用规则必须使用可验证的电商来源记录。');
    if(session.ecommerce!==undefined){
      try{validateEcommerceRecord(session.ecommerce);validateEcommerceSource(session);}catch(error){fail(error.message);}
      const r=session.ecommerce;
      const rowKey=JSON.stringify([session.taskId,r.fileSha256,r.sheet,r.row]);if(ecommerceRows.has(rowKey))fail('同一任务的电商来源行重复，不能克隆记录凑重复回复次数。');ecommerceRows.add(rowKey);
      if(task.mode!=='manual'||session.scene!=='电商评论回复'||r.fileSha256!==task.source.sha256)fail('电商来源摘要与任务原文件不一致。');
      if(!isEcommerceBasis(basis))fail('电商测试任务的冻结规则版本不匹配。');
      if(session.startedAt!==(ecommerceTimeValues(r).commentTime||'')||session.agent!==r.raw[11])fail('电商评论时间或管理员与原来源不一致。');
      const allowedColumns=[0,2,3,6,7,10,11,12,13];
      if((session.contextFields||[]).some(f=>!allowedColumns.some(index=>ecommerceSourceColumn(r,index)===f.source.column&&f.value===r.raw[index])||f.source.sheet!==r.sheet||f.source.row!==r.row))fail('电商模型字段不得包含原人工答案或不匹配的来源值。');
    }
    try{validateContextFields(session.contextFields===undefined?[]:session.contextFields,session.turns);}catch(error){fail(error.message);}
    const ruleIds=new Set(inspectionRules(basis,task.executionSnapshot).map(rule=>rule.id)),references=referenceSets(basis);
    const batchSessions=state.sessions.filter(s=>s.taskId===session.taskId);
    const aiIds=new Set();for(const result of session.aiResults){validateJudgment(result,ruleIds,turnIds,references.get(result?.ruleId)||new Set(),session.contextFields||[],batchSessions,session.id,basis);if(aiIds.has(result.ruleId))fail('AI结果规则重复。');aiIds.add(result.ruleId);}
    for(const [ruleId,result] of Object.entries(session.review.drafts)){if(result?.ruleId!==ruleId)fail('人工判定规则关联不一致。');validateJudgment(result,ruleIds,turnIds,references.get(ruleId)||new Set(),session.contextFields||[],batchSessions,session.id,basis);}
    const stageA=isStageATimeBasis(basis)||isBusinessEcommerceBasis(basis),timeResult=session.aiResults.find(result=>result.ruleId==='EC-TIME');
    if(session.aiResults.some(result=>result.timeFacts!==undefined&&(!stageA||result.ruleId!=='EC-TIME'))||Object.values(session.review.drafts).some(result=>result.timeFacts!==undefined&&(!stageA||result.ruleId!=='EC-TIME')))fail('时效事实只能属于阶段A的本地时效结果。');
    if(stageA&&timeResult){
      const run=[task.aiRun,...(task.aiRunHistory||[])].find(run=>run?.id===session.aiExecution?.runId);
      const frozen=session.sceneCapabilities?.judgmentClassificationSnapshot;
      if(frozen&&(!isBusinessEcommerceBasis(basis)||!object(frozen)||Object.keys(frozen).length!==2||frozen.runId!==session.aiExecution?.runId||!Object.hasOwn(frozen,'output')||frozen.output!==null&&!object(frozen.output)))fail('时效判定的原分类快照无效。');
      const timeSession=frozen?{...session,sceneCapabilities:{...session.sceneCapabilities,outputs:{...session.sceneCapabilities.outputs,ecommerceClassification:frozen.output}}}:session;
      let expected;try{expected=computeEcommerceTimeFacts(timeSession,basis,{inspectionAt:run?.inspectionAt,runtime:task.executionSnapshot?.runtime});}catch{fail('阶段A时效事实无法按冻结配置重算。');}
      const verdict=expected.outcome==='pass'?'符合':expected.outcome==='fail'?'不符合':expected.outcome==='na'?'不适用':'无法判定';
      if(!run?.inspectionAt||!equal(timeResult.timeFacts,expected)||timeResult.verdict!==verdict||!equal(timeResult.referenceIds,timePolicyReferences(basis)))fail('阶段A时效事实、判定或专用政策依据与原来源和冻结配置重算不一致。');
      for(const draft of Object.values(session.review.drafts))if(draft.timeFacts!==undefined&&!equal(draft.timeFacts,expected)&&!(frozen&&draft.source!=='AI接受'&&equal(draft.timeFacts,computeEcommerceTimeFacts(session,basis,{inspectionAt:run?.inspectionAt,runtime:task.executionSnapshot?.runtime}))))fail('人工接受的时效事实与原来源及冻结配置重算不一致。');
      if(expected.replyStatus==='unreplied'&&session.aiResults.some(result=>(!isBusinessEcommerceBasis(basis)||result.ruleId!=='EC-TIME')&&result.verdict!=='无法判定'))fail('未回复的内容检查未取得证据，不能保存虚假质量通过或不通过。');
    }
    if(session.review.disposition!==undefined){
      if(session.review.disposition!=='unreplied'||session.review.status!=='已确认'||!canConfirmUnreplied(state,session))fail('未回复事实确认仅适用于来源两字段都为空且具有可核验冻结结果的阶段A记录。');
    }
    if(task.mode==='manual'){
      try{validateTriageSession(session,task);}catch(error){fail(error.message);}
      strings(session.expectedRuleIds,'预期检查规则');if(!equal([...session.expectedRuleIds].sort(),[...ruleIds].sort()))fail('业务任务预期规则须对应任务快照。');
      if(session.aiExecution!==undefined)validateExecution(session.aiExecution,task);
      if(session.aiExecution?.status==='completed'||isRawTranscriptSession(session)&&session.aiExecution?.status==='failed'&&session.aiResults.length){
        if(!equal([...aiIds].sort(),[...ruleIds].sort()))fail('AI完成结果须精确覆盖所有预期规则。');
      }else if(session.aiResults.length)fail('AI尚未完成的会话不允许保存判定结果。');
      if(task.aiStatus==='not_run'&&session.aiExecution!==undefined)fail('AI未运行任务不允许包含执行记录。');
      if(authenticateNewSnapshots&&!trustedAI&&!previous?.sessions.some(record=>record.id===session.id&&previous.tasks.some(task=>task.id===record.taskId&&task.mode==='manual'))){
        if(session.sceneCapabilities!==undefined||session.aiExecution!==undefined||session.aiDecision!==undefined||session.aiDecisionHistory!==undefined||session.review.returned!==undefined||session.review.returnHistory!==undefined||session.aiResults.length)fail('新业务会话不允许预置AI执行或结果。');
        if(session.review.resolution!==undefined||session.review.resolutionHistory!==undefined)fail('新业务会话不允许预置人工处理审计。');
      }
      if(session.review.status==='已确认'){
        if(session.reviewPolicy?.version===2&&!Object.keys(session.review.drafts).length&&!classificationReviewed(session))fail('仅有AI规则免审的会话不能标为人工确认。');
        if(session.review.disposition!=='unreplied'){
          if(isUnrepliedSession(state,session))fail('未回复只能独立确认来源事实，不能伪造质量通过或不通过。');
          if(session.expectedRuleIds.some(id=>!Object.hasOwn(session.review.drafts,id)&&!ruleExemption(session,id)))fail('人工确认前必须逐项完成所有预期检查。');
          if(session.expectedRuleIds.some(id=>session.review.drafts[id]?.verdict==='无法判定'))fail('仍有无法判定项，请保留为待补充，不能确认最终结果。');
        }
        if(!session.review.reviewer.trim())fail('人工确认必须填写非空审核人标签。');
        if(!validZonedTime(session.review.completedAt))fail('人工确认完成时间须为真实且包含时区的 ISO 时间。');
      }else if(session.review.completedAt!==null)fail('尚未人工确认的记录完成时间必须为空。');
    }else if(!demoMatches(session))fail('演示模式仅允许固定演示原文，业务原文必须使用 manual 模式。');
  }
  if(!trustedReview)validateCalibrationTransition(state,previous,{trustedAI,trustedCalibration,authenticateNewSnapshots});
  for(const event of state.activity){text(event.action,'活动动作');text(event.at,'活动时间');if(event.taskId!==undefined&&!taskIds.has(event.taskId))fail('活动关联任务不存在。');if(event.sessionId!==undefined&&!sessionIds.has(event.sessionId))fail('活动关联会话不存在。');}
  if(previous){
    if(trustedLifecycle&&(!equal(without(previous,['tasks']),without(state,['tasks']))||!equal(previous.tasks.map(task=>without(task,['lifecycle','status'])),state.tasks.map(task=>without(task,['lifecycle','status'])))))fail('任务管理操作不能改写原任务或审核结果。');
    for(const event of previous.activity||[]){
      const taskId=event.taskId||previous.sessions.find(session=>session.id===event.sessionId)?.taskId;
      if(previous.tasks.some(task=>task.id===taskId&&task.mode==='manual')&&!equal(event,state.activity.find(item=>item.id===event.id)))fail('业务任务审计记录不可删除或改写。');
    }
    if(!equal(previous.legacyDemoArchive,state.legacyDemoArchive)||!equal(previous.businessMigrationVersion,state.businessMigrationVersion))fail('历史归档与业务迁移标记不可由工作区请求改写。');
    if(!trustedAI&&!equal(previous.aiTaskQueue,state.aiTaskQueue))fail('AI任务调度队列只能由服务端修改。');
    if(trustedAI&&(!equal(without(previous,['tasks','sessions','aiTaskQueue']),without(state,['tasks','sessions','aiTaskQueue']))||!equal(previous.tasks.map(item=>item.id),state.tasks.map(item=>item.id))||!equal(previous.sessions.map(item=>item.id),state.sessions.map(item=>item.id))))fail('AI更新不可修改活动、任务或会话范围。');
    for(const oldTask of previous.tasks){
      const next=tasks.get(oldTask.id);
      if(!trustedLifecycle&&!equal(oldTask.lifecycle,next?.lifecycle))fail('归档、作废与交付登记只能由任务操作接口修改。');
      if(isVoidedTask(oldTask)&&(!equal(oldTask,next)||oldTask.sessionIds.some(id=>!equal(previous.sessions.find(row=>row.id===id),state.sessions.find(row=>row.id===id)))))fail('作废任务及原结果仅供追溯，不可继续修改。');
      if(isArchivedTask(oldTask)&&(!trustedLifecycle&&!equal(oldTask,next)||oldTask.sessionIds.some(id=>!equal(previous.sessions.find(row=>row.id===id),state.sessions.find(row=>row.id===id)))))fail('归档任务及原结果只读，请先恢复任务。');
      if(isInactiveTask(next)&&next.status!==(isVoidedTask(next)?'已作废':'已归档'))fail('任务主状态与生命周期不一致。');
      if(trustedLifecycle&&!isInactiveTask(next)&&next.status!==(oldTask.lifecycle?.previousStatus||oldTask.status))fail('恢复任务须保留原工作状态。');
      if(next&&oldTask.basisSnapshot!==undefined&&!equal(oldTask.basisSnapshot,next.basisSnapshot))fail('已保存任务的依据快照不可改写。');
      if(next&&oldTask.scenarioSnapshot!==undefined&&!equal(oldTask.scenarioSnapshot,next.scenarioSnapshot))fail('已保存任务的场景快照不可改写。');
      if(oldTask.inputMode===RAW_INPUT_MODE&&(!next||['inputMode','evidenceContractVersion','rawImportOptions','reinspectionOf','source'].some(key=>!equal(oldTask[key],next[key]))))fail('已保存原文任务的来源、输入模式和时间声明不可改写。');
      if(next&&(oldTask.inputMode===RAW_INPUT_MODE||isStageATimeBasis(oldTask.basisSnapshot)||isBusinessEcommerceBasis(oldTask.basisSnapshot)))for(const run of [oldTask.aiRun,...(oldTask.aiRunHistory||[])].filter(Boolean)){
        const saved=[next.aiRun,...(next.aiRunHistory||[])].find(item=>item?.id===run.id);
        if(!saved||saved.inspectionAt!==run.inspectionAt||saved.startedAt!==run.startedAt)fail('已保存阶段A逻辑运行的检核截止点不可推进或改写。');
      }
      if(oldTask.mode!=='manual'){
        if(trustedAI&&(!equal(oldTask,next)||oldTask.sessionIds.some(id=>!equal(previous.sessions.find(item=>item.id===id),state.sessions.find(item=>item.id===id)))))fail('AI更新不可修改演示任务。');
        continue;
      }
      const taskAllowed=trustedLifecycle?['lifecycle','status']:trustedAI?['aiStatus','aiRun','aiRunHistory','aiQueue','capabilityMonitor',...(oldTask.reviewPolicy?.enabled?['status','progress']:[])]:['status','progress','updatedAt'];
      if(trustedAI&&oldTask.reviewPolicy?.enabled&&next&&(next.status!==oldTask.status||next.progress!==oldTask.progress)){
        const rows=state.sessions.filter(s=>s.taskId===next.id),completed=rows.filter(isFinalSession).length,expectedProgress=rows.length?Math.round(completed/rows.length*100):0,expectedStatus=rows.length&&completed===rows.length?'已完成':'待审核';
        if(next.progress!==expectedProgress||next.status!==expectedStatus)fail('AI只能按实际AI终判与人工确认重算分级任务进度。');
      }
      if(!next||!equal(without(oldTask,taskAllowed),without(next,taskAllowed)))fail('业务任务与原标识不可删除或改写；仅允许更新授权状态。');
      for(const id of oldTask.sessionIds){
        const before=previous.sessions.find(session=>session.id===id),after=state.sessions.find(session=>session.id===id);
        if(trustedReview&&before===after)continue;
        if(!after||!equal(without(before,trustedAI?['aiResults','aiExecution','aiDecision','aiDecisionHistory','calibrationAssignments','sceneCapabilities']:trustedCalibration?['review','ruleCalibrationRevocations']:['review']),without(after,trustedAI?['aiResults','aiExecution','aiDecision','aiDecisionHistory','calibrationAssignments','sceneCapabilities']:trustedCalibration?['review','ruleCalibrationRevocations']:['review'])))fail('业务会话原文、标识与初始结果不可改写。');
        if(isRawTranscriptSession(before))validateRawReviewTimeTransition(before,after,trustedAI);
        try{validatePendingResolutionTransition(before,after,previous,state,{trustedAI});}catch(error){fail(error.message);}
        let sceneRecovery=false;try{sceneRecovery=validateDependencyRecoveryHistory(before,after,{trustedAI});}catch(error){fail(error.message);}
        if(trustedAI&&!sceneRecovery)try{validateDecisionHistoryTransition(before,after);}catch(error){fail(error.message);}
        const oldClassification=before.sceneCapabilities?.judgmentClassificationSnapshot,newClassification=after.sceneCapabilities?.judgmentClassificationSnapshot;
        if(!sceneRecovery&&!equal(oldClassification,newClassification)&&(oldClassification||!trustedAI||before.aiExecution?.status!=='completed'||!equal(before.aiResults,after.aiResults)||!equal(newClassification,{runId:before.aiExecution.runId,output:before.sceneCapabilities?.outputs?.ecommerceClassification??null})))fail('既有时效判定的分类依据只能由恢复流程原样冻结，不可改写。');
        if(!trustedAI&&!trustedCalibration)try{validateReturnTransition(before,after);}catch(error){fail(error.message);}
        const comparisonRecovery=trustedAI&&before.ecommerce&&before.review.status==='待审核'&&!Object.keys(before.review.drafts).length&&!before.review.notes?.trim()&&!before.review.history?.length&&before.aiResults.some(r=>r.ruleId==='EC-TARGET'&&r.comparisonAssessment?.status==='incomplete')&&after.aiExecution?.status==='completed'&&before.aiExecution.runId===after.aiExecution.runId&&equal(before.aiResults.filter(r=>r.ruleId!=='EC-TARGET'),after.aiResults.filter(r=>r.ruleId!=='EC-TARGET'));
        if(!sceneRecovery&&!comparisonRecovery&&before.aiDecision!==undefined&&before.aiExecution?.status==='completed'&&!equal(before.aiDecision,after.aiDecision))fail('已完成的AI终判审计记录不可改写。');
        if(!trustedAI&&before.review.status!=='已确认'&&after.review.status==='已确认'&&requiresEcommerceClassification(before)&&!classificationReviewed(after))fail('请先完成人工评价分类复核，再确认五项检查。');
        if(!trustedAI&&before.aiExecution?.status==='running'&&!equal(before.review,after.review))fail('AI正在运行，完成后才能修改人工审核。');
        if(!trustedAI&&!trustedCalibration)for(const [ruleId,draft] of Object.entries(after.review.drafts)){if(draft.source==='AI接受'&&!equal(draft,before.review.drafts[ruleId])){const original=before.aiResults.find(r=>r.ruleId===ruleId);if(!original||!equal(draft,{...original,source:'AI接受'}))fail('接受AI必须完整保留AI原判；修改结论请使用人工改判并说明理由。');}}
        if(!trustedAI&&before.aiExecution?.status!=='completed'&&!equal(before.review,after.review)){
          if(Object.values(after.review.drafts).some(draft=>draft.source==='AI接受'))fail('AI尚未完整完成，不能接受AI判定。');
          if(before.aiExecution?.errorCode==='dependency_incomplete'&&after.review.status==='已确认'&&Object.values(after.review.drafts).some(draft=>draft.source!=='人工独立审核'))fail('完整批次比较尚未完成；只能明确逐项人工独立审核，不能确认未完整的AI结论。');
        }
        if(trustedAI&&!sceneRecovery&&!comparisonRecovery&&before.aiExecution?.status==='completed'&&(!equal(before.aiResults,after.aiResults)||!equal(before.aiExecution,after.aiExecution)))fail('已完成AI执行及初始结果不可改写。');
      }
    }
  }
  return true;
}
