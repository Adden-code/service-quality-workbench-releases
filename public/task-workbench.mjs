import {taskExecutionPage} from './task-execution-page.mjs';
import {importLineage} from './import-lineage.mjs';
import {newProductContentGaps} from './rule-content-health.mjs';
import {sceneCapabilityMonitor} from './scene-review-view.mjs';
import {qualityInsightsButtons} from './quality-insights-ui.mjs';
import {taskLifecycleControls,taskLifecycleNotice} from './task-lifecycle-ui.mjs';
import {isVoidedTask,isInactiveTask} from './task-lifecycle.mjs';
import {ruleKindOf} from './rule-kind.mjs';
import {rawTaskPanel} from './raw-workbench-manager.mjs';
import {d as businessText,ruleDisplayName,businessContent,translationControls,scenarioName} from './content-translation-ui.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {e,icon,badge,dateTime} from './ui.mjs';
import {hasSuccessfulAI,modelRunDetails} from './model-ui.mjs';
import {normalizeExecutionSettings} from './execution-settings.mjs';
import {ruleSetSummary} from './rule-set-ui.mjs';
import {listScenarios,findScenario,sceneLabel} from './scenarios.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';
import {isAIFinal,isFinalSession,isReviewWorkComplete,requiresHumanReview} from './ai-triage.mjs';
import {taskQueueInfo,taskQueueBadge,taskQueueControls,taskQueueNotice,taskPendingProcessing,cleaningReportSummary,taskReviewPolicySummary} from './task-queue-ui.mjs';

export function handleTaskReportAction(action,id,{ui,navigate,state}){
  if(!['task-detail-export','task-detail-report','completion-export','completion-report'].includes(action))return false;
  const completion=action.startsWith('completion-');
  const includeProcessed=action==='completion-export'&&Boolean(state?.sessions?.some(session=>session.taskId===id&&isProcessedUnknown(session)));
  Object.assign(ui,{exportTaskId:id||'',reportTaskId:id||'',businessTaskId:id||'',reportPeriod:id?'batch':'all',...(completion?{includePending:includeProcessed}:action==='task-detail-export'?{includePending:true}:{})});
  navigate('exports');return true;
}
export function assertConsultationInput(parsed,state={},expectedScene='新品产品咨询'){
  if(parsed?.sessions?.some(session=>session.scene==='电商评论回复'))throw new Error('电商评论请从“新建质检任务”选择“电商评论回复”，采用Sheet4专用解析与五项检查。');
  const config=findScenario(state,expectedScene,{includeDisabled:false});
  if(!config||config.engine!=='conversation')throw new Error('所选场景未注册或已停用，请重新选择可用场景。');
  if(!parsed?.sessions?.length||parsed.sessions.some(session=>session.scene!==config.id))throw new Error(`${config.id==='新品产品咨询'?'产品咨询入口':config.name}仅支持“${config.name}”场景，请核对文件中的场景字段。`);
  return parsed;
}
export function canSetRawRunConcurrency(task){
  return task?.inputMode==='raw-transcript-v1'&&(!task.aiQueue||['failed','partial','cancelled'].includes(task.aiQueue.status));
}
export function taskStartSettings(task,ui={}){
  // New tasks persist their selected defaults. Older structured tasks/queues
  // without a saved concurrency keep their original one-worker behavior.
  if(task.aiQueue?.settings&&!canSetRawRunConcurrency(task))return normalizeExecutionSettings({concurrency:1,...task.aiQueue.settings});
  const raw=task.inputMode==='raw-transcript-v1',settings=normalizeExecutionSettings({concurrency:raw?4:1,...(task.aiQueue?.settings??task.executionSettings)},{raw});
  if(raw&&ui.rawStartConcurrency?.[task.id]!==undefined)settings.concurrency=ui.rawStartConcurrency[task.id];
  return normalizeExecutionSettings(settings,{raw});
}
function rawStartControl(task,settings){
  if(task.inputMode!=='raw-transcript-v1')return '';
  const current=task.aiQueue?uiHtml`<p class="hint" data-queue-concurrency="${task.aiQueue.settings.concurrency}">${uiT('队列并发：{0}',{0:task.aiQueue.settings.concurrency})}</p>`:'';
  if(!canSetRawRunConcurrency(task))return uiHtml`${current}<p class="hint">本次队列已冻结；运行、排队和暂停继续均沿用原设置。</p>`;
  return uiHtml`${current}<div class="field-group raw-start-settings"><label class="field-label" for="raw-start-concurrency">${uiT(task.aiQueue?'新运行并发（1—4条）':'首次运行并发（1—4条）')}</label><select class="field" id="raw-start-concurrency" data-task="${e(task.id)}">${[1,2,3,4].map(value=>uiHtml`<option value="${value}" ${settings.concurrency===value?'selected':''}>${uiT('同时处理 {0} 条',{0:value})}</option>`).join('')}</select><p class="hint">${uiT(task.aiQueue?'点击重试失败项或重新入队后采用新并发；已成功结果与人工记录保留。':'开始前可调整本次并发；入队后设置冻结，暂停继续沿用。')}</p></div>`;
}
export function executionSettingsFields(settings={},prefix='task',{raw=false}={}){
  // Preserve partial form input. Validate when creating or starting a task.
  const value={...normalizeExecutionSettings({}, {raw}),...settings};
  return uiHtml`<div class="form-row"><div class="field-group"><label class="field-label" for="${prefix}-concurrency">同时处理记录数</label><input class="field" id="${prefix}-concurrency" type="number" min="1" max="4" step="1" value="${e(value.concurrency)}"></div><div class="field-group"><label class="field-label" for="${prefix}-batch-size">每段记录数</label><input class="field" id="${prefix}-batch-size" type="number" min="1" max="100" step="1" value="${e(value.batchSize)}"></div></div><p class="hint">${raw?uiT('新原文任务默认同时处理4条，可选1—4条；暂停继续沿用，失败后新运行可另选。'):uiT('默认同时处理1条、每段20条；内容较长时按工作量自动拆分，仍属于同一个任务。配置随任务保存，暂停后继续沿用。')}</p>`;
}

export const TASK_FILTERS=['全部','AI未开始','AI排队中','AI运行中','AI已暂停','AI未完成','AI已完成','AI排队已取消','待人工确认','审核工作已处理','审核已完成','人工已完成'];
export function taskExecution(state,task){
  const sessions=state.sessions.filter(s=>s.taskId===task.id),queue=task.aiQueue;
  const complete=sessions.filter(hasSuccessfulAI).length;
  const failed=queue?.rows?queue.rows.filter(row=>['failed','blocked'].includes(row.status)||(queue.comparison?.status==='failed'&&row.status==='completed'&&!hasSuccessfulAI(sessions.find(session=>session.id===row.sessionId)||{}))).length:sessions.filter(s=>s.aiExecution?.status==='failed').length;
  const semantic=queue?.rows?.filter(r=>r.status==='completed').length||0;
  const status=taskQueueInfo(state,task).status;
  const eligible=sessions.some(row=>row.review.status==='待审核'&&!Object.keys(row.review.drafts||{}).length&&!hasSuccessfulAI(row));
  const humanConfirmed=sessions.filter(session=>session.review.status==='已确认').length,aiFinal=sessions.filter(isAIFinal).length,finalized=sessions.filter(isFinalSession).length,pendingHuman=isInactiveTask(task)?0:sessions.filter(requiresHumanReview).length,processedUnknown=sessions.filter(isProcessedUnknown).length,workCompleted=sessions.filter(isReviewWorkComplete).length;
  const processing=taskPendingProcessing(state,task);
  return {eligible,total:sessions.length,complete,failed,pendingProcessing:processing.pending,partialCompletion:processing.partial,unprocessed:Math.max(0,sessions.length-complete-failed),confirmed:humanConfirmed,humanConfirmed,aiFinal,finalized,pendingHuman,processedUnknown,workCompleted,semantic,status,queue};
}
export function taskMatchesStatus(state,task,status){
  const c=taskExecution(state,task);
  return status==='全部'||!status||({'AI未开始':['not_run','not_started'].includes(c.status),'AI排队中':c.status==='queued','AI运行中':c.status==='running','AI已暂停':c.status==='paused','AI未完成':['failed','partial','interrupted'].includes(c.status),'AI已完成':c.status==='completed','AI排队已取消':c.status==='cancelled','待人工确认':c.pendingHuman>0,'审核工作已处理':c.total>0&&c.workCompleted===c.total,'审核已完成':c.total>0&&c.finalized===c.total,'人工已完成':c.total>0&&c.confirmed===c.total})[status]===true;
}
export function taskStage(state,task){
  const c=taskExecution(state,task);
  return c.total>0&&c.workCompleted===c.total?4:c.finalized>0||c.complete>0?3:c.status!=='not_run'&&c.status!=='not_started'?2:1;
}
export function creationSteps(active){
  return uiHtml`<div class="status-strip creation-steps">${['选择场景','上传核对','检查标准与运行安排','任务详情'].map((label,index)=>uiHtml`${index?icon('chevron',10):''}<span class="step ${active===index?'active':''}" ${active===index?'aria-current="step"':''}><span class="step-number">${index+1}</span>${uiT(label)}</span>`).join('')}</div><p class="hint creation-purpose">${uiT(['先选择这批要检查的业务。','上传文件，核对前几条原文是否正确。','核对本次检查标准、人工审核方式和运行参数。','查看进度，审核结果并下载报告。'][active]||'')}</p>`;
}
export function taskSceneDialog(state={}){
  const scenes=listScenarios(state);
  return {typeClass:'wide',body:uiHtml`<header class="modal-head"><div><h2 id="dialog-title">选择质检场景</h2></div><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header><div class="modal-body">${creationSteps(0)}<div class="task-scene-grid">${scenes.map(config=>uiHtml`<button class="task-scene-card" data-act="task-scene" data-scene="${e(config.id)}">${icon(config.engine==='ecommerce'?'tasks':'file',24)}<strong>${e(scenarioName(config.name))}</strong><span>${config.engine==='ecommerce'?uiT('业务系统导出文件 · 五项检查 · AI归类后人工核对'):config.builtin?uiT('标准文件或业务原表 · 已发布规则与资料'):uiT(`${config.layout==='pair'?'单行问答':'多轮会话'} · 已发布规则与资料`)}</span>${config.builtin?'':uiHtml`<small class="scenario-scene-version">配置 V${e(config.version)}</small>`}${icon('chevron',17)}</button>`).join('')}</div></div><footer class="modal-footer"><small>仅展示已启用场景，任务保存创建时的配置版本。</small><div><button class="btn" data-act="close-modal">取消</button></div></footer>`};
}
export function taskDetailView(state,ui){
  const task=state.tasks.find(t=>t.id===ui.taskDetailId);
  if(!task)return uiHtml`<div class="empty"><h2>任务不存在或已移出当前工作区</h2><button class="btn" data-act="task-list">返回任务列表</button></div>`;
  const c=taskExecution(state,task),basis=task.basisSnapshot||{},stage=taskStage(state,task),queue=c.queue,settings=taskStartSettings(task,ui),displaySettings=queue?.settings||settings;
  const control=isInactiveTask(task)?'':taskQueueControls(state,task,c);
  const rowLabels={pending:'未处理',running:'执行中',completed:queue?.phase==='comparison'?'语义已完成，等待批次比较':'语义已完成',failed:'未完成',blocked:'未完成',protected:'保留人工记录'};
  return uiHtml`<div class="page-head task-detail-head"><div><button class="text-btn" data-act="task-list">${icon('chevron',12)}返回任务列表</button><h1>${e(businessText(task.name))}</h1><p class="mono">${e(task.id)}</p></div><div class="head-actions">${taskLifecycleControls(task)}<button class="btn" data-act="task-review" data-id="${e(task.id)}" ${''}>${isInactiveTask(task)?uiT('查看历史记录'):uiT('进入人工审核')}</button></div></div>
    ${qualityInsightsButtons(state,{taskId:task.id})}${taskImportLink(state,task)}
    ${taskLifecycleNotice(task)}${newProductContentGaps(task.basisSnapshot).length?uiHtml`<p class="soft-note warning" role="alert">本任务冻结的规则内容不完整：${e(newProductContentGaps(task.basisSnapshot).map(uiT).join(', '))}。到场景管理装载新版后新建任务或重检；本任务历史依据保持不变。</p>`:''}${basis.rules?.some(rule=>ruleKindOf(rule)==='meta')?uiHtml`<p class="notice-banner">此任务保留创建时的规则范围，含历史交付物要求。按当前作用域重检请新建任务。</p>`:''}${translationControls({kind:'task',taskId:task.id})}
    <div class="status-strip" aria-label="任务当前进展">${['材料已保存','依据已绑定','AI执行','人工审核','双报告'].map((label,index)=>uiHtml`${index?icon('chevron',10):''}<span class="step ${index===stage?'active':''}" ${index===stage?'aria-current="step"':''}>${uiT(label)}</span>`).join('')}</div>
    <div class="task-detail-grid">${isInactiveTask(task)?'':rawTaskPanel(state,task)}<section class="panel task-detail-section"><div class="panel-head"><h2>材料与依据</h2></div><div class="panel-body"><dl class="detail-grid"><dt>场景</dt><dd>${e(scenarioName(sceneLabel(state,task)||uiT('产品咨询')))}${task.scenarioSnapshot?` · V${e(task.scenarioSnapshot.version)}`:''}</dd><dt>原文件</dt><dd>${e(businessText(task.fileName||task.source?.name||uiT('未记录')))}${task.source?uiHtml` <button class="text-btn" data-act="download-source" data-id="${e(task.id)}">下载原文件</button>`:''}</dd><dt>创建时间</dt><dd>${dateTime(task.createdAt)}</dd><dt>依据日期</dt><dd>${e(basis.effectiveDate||uiT('未记录'))}</dd></dl>${basis.ruleSetSnapshot?ruleSetSummary(basis.ruleSetSnapshot):''}<details data-disclosure="${e(task.id)}-basis"><summary>规则与资料版本 · ${basis.rules?.length||0}项规则</summary><ul class="task-basis-list">${(basis.rules||[]).map(r=>uiHtml`<li><strong>${e(ruleDisplayName(r))}</strong> ${e(r.version)}</li>`).join('')}${(basis.policies||[]).map(p=>uiHtml`<li>${e(ruleDisplayName(p))} ${e(p.version)}</li>`).join('')}</ul></details>${task.importMappingSnapshot?uiLiteral('<p class="hint">已保存本次字段映射方案快照。</p>'):''}${cleaningReportSummary(task)}${taskReviewPolicySummary(task)}<button class="text-btn" data-act="triage-diagnostics" data-id="${e(task.id)}">免审阻断原因</button></div></section>
    <section class="panel task-detail-section"><div class="panel-head"><h2>AI执行</h2>${taskQueueBadge(state,task)}</div><div class="panel-body"><div class="task-detail-metrics"><div><strong>${c.complete}</strong><small>AI完成</small></div><div><strong>${c.failed}</strong><small>失败 / 未完成</small></div><div><strong>${Math.max(0,c.total-c.complete-c.failed)}</strong><small>未处理</small></div></div>${queue?.phase==='comparison'?uiHtml`<p class="soft-note">逐行语义已完成 ${c.semantic} / ${c.total}；正在进行批次重复比较（${queue.comparison?.blocks?.filter(b=>b.status==='completed').length||0} / ${queue.comparison?.blocks?.length||0}），逐行判定已保存可审核；未完成的比较只影响模板化回复③，不影响其他项。</p>`:''}<details class="input-transcript" data-disclosure="${e(task.id)}-execution"><summary>执行设置</summary><p>同时处理 ${displaySettings.concurrency} 条，每段最多 ${displaySettings.batchSize} 条，内容较长时自动按工作量拆分。</p>${task.scene==='电商评论回复'&&!basis.ruleSetSnapshot?uiHtml`<p>回复时效阈值：${e(state.sessions.find(row=>row.taskId===task.id)?.ecommerce?.thresholdHours||24)}小时。</p>`:''}</details>${isInactiveTask(task)?'':rawStartControl(task,settings)}${modelRunDetails(task.aiRun,task.id)}${taskQueueNotice(state,task)}${sceneCapabilityMonitor(task)}<div class="toolbar-group">${control}<button class="btn" data-act="workflow-open" data-id="${e(task.id)}">运行过程</button></div>${taskExecutionPage(task,ui)}</div></section>
    <section class="panel task-detail-section"><div class="panel-head"><h2>审核进度</h2></div><div class="panel-body"><p><strong>${c.workCompleted} / ${c.total}</strong> ${uiT(c.processedUnknown?'条审核工作已处理':'条审核已完成')}</p><div class="task-finalization-counts"><span>${uiT('AI已判定 {0} 条',{0:c.aiFinal})}</span><span>${uiT('人工已确认 {0} 条',{0:c.humanConfirmed})}</span><span>${uiT('待人工审核 {0} 条',{0:c.pendingHuman})}</span>${c.processedUnknown?uiHtml`<span>${uiT('已处理，仍无法判定 {0} 条',{0:c.processedUnknown})}</span>`:''}</div><div class="progress-track"><div class="progress-fill" style="width:${c.workCompleted/(c.total||1)*100}%"></div></div>${c.processedUnknown?uiHtml`<p class="hint">处理结束不等于形成最终结论；已处理待补充单独统计，不计为通过或进入最终质量分母。</p>`:''}<button class="btn" data-act="task-review" data-id="${e(task.id)}"  >${isInactiveTask(task)?uiT('查看历史记录'):c.workCompleted===c.total?uiT('查看全部记录'):uiT('进入本任务人工审核')}</button><p class="hint">AI终判和人工确认分别保留来源。未执行的会话不计为完成；已有人工记录在重试时保留。</p></div></section>
    <section class="panel task-detail-section"><div class="panel-head"><h2>双报告</h2></div><div class="panel-body"><div class="task-report-actions"><button class="btn" data-act="task-detail-export" data-id="${e(task.id)}" ${isVoidedTask(task)?'disabled':''}>质检明细与原文</button><button class="btn" data-act="task-detail-report" data-id="${e(task.id)}" ${isVoidedTask(task)?'disabled':''}>管理分析报告</button></div><p class="hint">报告范围限定为本任务；最终结果包含AI终判及人工确认，并分别标注来源。</p></div></section></div>`;
}

export function taskImportLink(state,task){
 const lineage=importLineage(state,task);if(!lineage)return '';
 const first=state.tasks.find(t=>t.id===lineage.firstTaskId),removed=state.taskDeletionAudit?.find(a=>a.task.id===lineage.firstTaskId);
 return uiHtml`<p class="soft-note task-import-lineage">第${lineage.ordinal}次导入 · ${lineage.firstTaskId===task.id?uiT('首次任务'):first?uiHtml`<button class="text-btn" data-act="task-detail" data-id="${e(first.id)}">关联的首次任务：${e(first.id)}</button>`:uiHtml`首次任务 ${e(lineage.firstTaskId)} ${uiT(removed?'已删除，关联保留于任务删除审计':'当前工作区不可查看')}`}</p>`;
}
