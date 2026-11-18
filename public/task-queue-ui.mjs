import {capabilityPauseSummary,capabilityHelpActions} from './task-diagnostics.mjs';
import {samplingDescription} from './rule-calibration-policy.mjs';
import {html as uiHtml,uiLiteral,t as uiT,getLocale} from './i18n.mjs';
import {e,badge,dateTime} from './ui.mjs';
import {hasSuccessfulAI} from './model-ui.mjs';
import {estimateTaskEta,etaDisplayRange} from './task-eta.mjs';

const pendingStatuses=new Set(['queued','running','paused']);
const statusLabels={queued:'AI排队中',running:'AI运行中',paused:'AI已暂停',completed:'AI已完成',partial:'AI未完成',failed:'AI未完成',interrupted:'AI已中断',cancelled:'AI已取消',not_run:'AI未开始',not_started:'AI未开始'};

export function taskQueueInfo(state,task){
  const entries=state.aiTaskQueue?.entries||[],pending=entries.filter(entry=>pendingStatuses.has(entry.status)).sort((a,b)=>a.sequence-b.sequence);
  const own=entries.filter(entry=>entry.taskId===task.id).sort((a,b)=>b.sequence-a.sequence);
  const entry=(task.aiRun?.id?own.find(entry=>entry.runId===task.aiRun.id):own[0])||null;
  const index=entry?pending.indexOf(entry):-1,status=entry?.status||task.aiQueue?.status||task.aiStatus||'not_run';
  const previousIds=new Set(entries.filter(item=>item.sequence<(entry?.sequence??Infinity)&&item.taskId!==task.id&&['partial','failed'].includes(item.status)).map(item=>item.taskId));
  const unfinished=(state.sessions||[]).filter(session=>previousIds.has(session.taskId)&&session.aiExecution?.status!=='completed'&&session.review?.status!=='已确认');
  const queueStatus=state.aiTaskQueue?.status||'ready',pauseReason=state.aiTaskQueue?.pauseReason||null;
  return {status,hasEntry:Boolean(entry),position:index<0?null:index+1,pendingCount:pending.length,queueStatus,pauseReason,blockedReason:entry?.blockedReason||task.aiQueue?.stopReason||pauseReason,
    canCancel:['queued','paused','interrupted'].includes(status)&&!(state.sessions||[]).some(session=>session.taskId===task.id&&session.aiExecution?.status==='running'),canResumeQueue:(queueStatus==='paused'&&pending.length>0)||status==='paused'||status==='interrupted',
    previousIncompleteSessions:unfinished.length,previousIncompleteTasks:new Set(unfinished.map(session=>session.taskId)).size};
}

export function taskQueueBadge(state,task){
  const info=taskQueueInfo(state,task),kind=info.status==='queued'?'blue':info.status==='running'?'blue':['paused','partial','failed','interrupted'].includes(info.status)?'warning':info.status==='completed'?'success':'muted';
  return uiHtml`<span class="task-queue-status" data-task-queue-status="${e(info.status)}">${badge(statusLabels[info.status]||info.status,kind)}${info.position?uiHtml`<span class="task-queue-position" data-task-queue-position="${info.position}" title="队列位置包含正在运行的任务">${uiT('队列第{0}位',{0:info.position})}</span>`:''}${info.position&&info.previousIncompleteSessions?uiHtml`<span class="task-queue-incomplete">${uiT('前序仍有 {0} 条会话未完成',{0:info.previousIncompleteSessions})}</span>`:''}</span>`;
}

export function taskQueueControls(state,task,{eligible,complete=0,failed=0}={}){
  const info=taskQueueInfo(state,task);
  if(eligible===undefined)eligible=(state.sessions||[]).some(session=>session.taskId===task.id&&session.review?.status==='待审核'&&!Object.keys(session.review?.drafts||{}).length&&!hasSuccessfulAI(session));
  if(['partial','failed'].includes(info.status)&&task.aiQueue?.comparison?.status==='failed')return uiHtml`<button class="btn primary" data-act="resume-ai" data-id="${e(task.id)}">${getLocale()==='en'?'Retry unfinished comparison blocks':'重跑未完成相似块'}</button><button class="btn" data-act="task-review" data-id="${e(task.id)}">${getLocale()==='en'?'View saved results':'查看已保留结果'}</button>`;
  const resume=uiLiteral('<button class="btn primary" data-act="resume-ai-queue">继续任务队列</button>');
  if(info.status==='queued')return uiHtml`${info.canResumeQueue?resume:''}<button class="btn" data-act="cancel-queued-ai" data-id="${e(task.id)}">取消排队</button>`;
  if(info.status==='running')return uiHtml`<button class="btn" data-act="pause-ai" data-id="${e(task.id)}">暂停任务队列</button>`;
  if(info.status==='paused'||info.status==='interrupted')return uiHtml`${info.hasEntry?resume:uiHtml`<button class="btn primary" data-act="resume-ai" data-id="${e(task.id)}">继续AI质检</button>`}<button class="btn" data-act="cancel-queued-ai" data-id="${e(task.id)}" ${info.canCancel?'':'disabled'}>${uiT('取消本次运行')}</button>${info.canCancel?'':uiHtml`<span class="hint">${uiT('等待当前请求结束后可取消本次运行。')}</span>`}`;
  return uiHtml`<button class="btn primary" data-act="run-ai" data-id="${e(task.id)}" ${eligible?'':'disabled'}>${uiT(info.status==='cancelled'?'重新加入任务队列':failed?'重试失败项':complete?'处理未完成项':'开始AI质检')}</button>`;
}

export function taskEtaNotice(state,task,{now=Date.now()}={}){
  const info=taskQueueInfo(state,task),eta=estimateTaskEta(task,{now,status:info.status,queueStatus:info.queueStatus,totalSessions:(state.sessions||[]).filter(session=>session.taskId===task.id).length});
  const progress=eta.phase==='comparison'?uiT('批次重复比较：{0} / {1} 块',{0:eta.comparisonCompleted,1:eta.comparisonTotal}):uiT('逐条检核：{0} / {1}',{0:eta.completed,1:eta.total});
  const messages={estimating:'估算中：至少完成 3 条有效耗时样本后显示范围。',queued:'等待任务队列，开始执行后估算。',paused:'已暂停或中断，等待恢复；暂停时间不计入估算。',incomplete:'存在失败或未完成项，处理后重新估算。',retrying:'正在重试，待后续耗时稳定后重新估算。',slow:'当前请求耗时较长，暂不显示剩余时间。',finishing:'正在保存本阶段结果。',comparison:'正在比较整批回复，耗时随比较块变化，暂不估算结束时间。'};
  const range=etaDisplayRange(eta.rangeMs),rangeLabels={seconds:'本阶段预计还需 {0}–{1} 秒',minutes:'本阶段预计还需 {0}–{1} 分钟',hours:'本阶段预计还需 {0}–{1} 小时'};
  const message=range?uiT(rangeLabels[range.unit],{0:range.min,1:range.max}):messages[eta.kind]?uiT(messages[eta.kind]):'';
  const largeBatch=eta.largeBatch&&!['completed','cancelled'].includes(eta.kind);
  if(!message&&!largeBatch)return '';
  return uiHtml`<div class="task-eta-notice" data-task-eta="${e(eta.kind)}">${message?uiHtml`<p><strong>${e(progress)}</strong> · <span>${e(message)}</span></p>`:''}${range?uiHtml`<p class="hint">${uiT('按本次运行最近完成项的实际耗时估算；模型响应速度变化时，区间会调整。')}</p>`:''}${eta.comparisonPending&&eta.phase==='rows'&&message?uiHtml`<p class="hint">${uiT('之后仍需整批重复比较；未计入上述逐条检核估算。')}</p>`:''}${largeBatch?uiHtml`<p class="hint">${uiT('本批 {0} 条将按调度段在后台处理，已完成结果会保存。',{0:eta.total})}${task.scene==='电商评论回复'||eta.comparisonTotal?` ${uiT('电商重复比较覆盖整批；请保持在同一业务任务内。')}`:''}</p>`:''}</div>`;
}

export function taskQueueNotice(state,task,options={}){
  const info=taskQueueInfo(state,task),relevant=info.position||['running','paused','interrupted'].includes(info.status);
  const eta=taskEtaNotice(state,task,options);
  if(!relevant)return eta;
  // Restart pauses the scheduler, but does not resolve a recorded capability failure.
  const reason=info.blockedReason==='interrupted'&&Object.values(task.capabilityMonitor||{}).some(m=>m.paused)?'capability_failure_rate':info.blockedReason;
  const explanation=reason==='capability_failure_rate'?(getLocale()==='en'?`${capabilityPauseSummary(task)}. Paused because technical failures exceeded the limit. Ask the local administrator to check model settings or send the problem summary to development. Saved results remain reviewable. Resume after the cause is fixed.`:`${capabilityPauseSummary(task)}。辅助能力技术失败率超过冻结上限，已暂停。请联系本机管理员检查模型设置；仍失败时复制问题摘要反馈开发。其余已完成结果可正常审核，原因修复后再继续任务队列。`):reason==='capability_unavailable'?(getLocale()==='en'?'An auxiliary executor or model service is unavailable. Fix the reported configuration or authentication failure before resuming.':'辅助执行器或模型服务整体不可用，已暂停。请先修复配置、鉴权或执行器问题。'):reason==='config_changed'?'当前模型配置与任务冻结配置不同。请在模型设置恢复任务原配置并测试连接，再点击“继续任务队列”。':reason==='connection_required'?'当前模型配置尚未通过连接测试。请在模型设置保存并测试连接，再点击“继续任务队列”。':reason==='interrupted'||info.status==='interrupted'?'服务重启或执行中断后，任务队列保持暂停。已保存的结果与顺序保留；核对后点击“继续任务队列”。':reason==='storage_error'?'保存调度状态时出现错误，任务队列已暂停。请先恢复工作区保存，再点击“继续任务队列”。':reason==='user'||info.queueStatus==='paused'?'任务队列已暂停，后续任务不会启动。当前请求结束后保留结果；点击“继续任务队列”恢复整个队列。':'任务按加入顺序逐个执行，同一时间只执行一个任务。';
  const configBlocked=['config_changed','connection_required'].includes(reason);
  return uiHtml`<div class="task-queue-notice ${info.queueStatus==='paused'?'is-paused':''}" role="status"><p>${e(uiT(explanation))}</p>${explanation!=='任务按加入顺序逐个执行，同一时间只执行一个任务。'?uiLiteral('<p>任务按加入顺序逐个执行，同一时间只执行一个任务。</p>'):''}${info.previousIncompleteSessions?uiHtml`<p>${uiT('前序仍有 {0} 条会话未完成；不含已完成AI执行或已人工确认的会话。',{0:info.previousIncompleteSessions})}</p>`:''}${['capability_failure_rate','capability_unavailable'].includes(reason)?capabilityHelpActions(task):''}${configBlocked?uiLiteral('<button class="btn small" data-act="model-settings">打开模型设置</button>'):''}${eta}</div>`;
}

export function cleaningReportSummary(task){
  const report=task.cleaningReportSnapshot;if(!report)return '';
  const labels={sourceRows:'原始行数',includedSessions:'纳入会话',includedTurns:'纳入消息',manualChanges:'人工调整',excludedRows:'弃用行数',excludedSegments:'弃用片段'};
  return uiHtml`<div class="task-cleaning-summary"><h3>清洗报告</h3><dl>${Object.entries(labels).map(([key,label])=>uiHtml`<div><dt>${uiT(label)}</dt><dd data-cleaning-count="${key}">${Number.isSafeInteger(report.counts?.[key])?report.counts[key]:'—'}</dd></div>`).join('')}</dl>${report.reviewer?uiHtml`<p class="hint">${e(uiT('清洗核对人：{0} · {1}',{0:report.reviewer,1:dateTime(report.confirmedAt)}))}</p>`:''}<button class="text-btn" data-act="download-cleaning-report" data-id="${e(task.id)}">下载清洗报告</button><p class="hint">原始材料、人工调整与弃用原因保存在本任务清洗快照中。</p></div>`;
}

export function taskReviewPolicySummary(task){
  const policy=task.reviewPolicy;if(!policy)return '';
  if(policy.version===2)return uiHtml`<div class="task-review-policy"><h3>本任务分级审核策略</h3><p>${uiT(policy.enabled?'规则级免审已启用':'规则级免审未启用')}</p><p>${uiT('已冻结 {0} 条达标规则；其余规则仍须人工。',{0:policy.rules.length})}</p><p>独立验证≥30对、一致率≥80%；仅符合项可免审，${samplingDescription(policy,getLocale()==='en')}强制抽检，错误率>20%停用并回溯。</p><button class="text-btn" data-act="calibration-open">规则级标定与免审</button></div>`;
  return uiHtml`<div class="task-review-policy"><h3>本任务分级审核策略</h3><p>${uiT(policy.enabled?'已启用AI通过免审':'未启用AI通过免审，采用人工确认')}</p><p>${uiT('保存门槛 {0}；尚未用真实业务基准标定。',{0:Number(policy.confidenceThreshold).toFixed(2)})}</p><p class="hint">AI通过免审仅在策略启用且证据与一致性检查通过时生效；不通过、证据不足和可疑记录进入人工。</p></div>`;
}
