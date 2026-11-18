import {isProcessedUnknown} from './pending-resolution.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {getSessionResults} from './domain.mjs';
import {e,icon} from './ui.mjs';
import {d as businessText,scenarioName} from './content-translation-ui.mjs';
import {requiresHumanReview,isAIFinal,isFinalSession,isReviewWorkComplete,getReviewRouting} from './ai-triage.mjs';
import {sceneLabel} from './scenarios.mjs';

import {isInactiveTask} from './task-lifecycle.mjs';
const processable=state=>state.sessions.filter(session=>!isInactiveTask(state.tasks.find(task=>task.id===session.taskId))&&!['待质检','质检中'].includes(state.tasks.find(task=>task.id===session.taskId)?.status));
const withinScope=(session,ui)=>(!ui.reviewTaskId||session.taskId===ui.reviewTaskId)&&(!ui.reviewSceneFilter||session.scene===ui.reviewSceneFilter);
export function reviewCompletion(state,ui){
  const all=processable(state),scope=all.filter(session=>withinScope(session,ui));
  const pending=scope.filter(requiresHumanReview).length;
  const others=all.filter(session=>requiresHumanReview(session)&&!withinScope(session,ui));
  const confirmed=scope.filter(session=>session.review.status==='已确认');
  const aiFinal=scope.filter(isAIFinal).length,processedUnknown=scope.filter(isProcessedUnknown).length;
  const notRun=scope.filter(session=>!isReviewWorkComplete(session)&&getReviewRouting(session).status==='NOT_RUN').length;
  const selectedTask=state.tasks.find(task=>task.id===ui.reviewTaskId),scopeTaskName=ui.reviewTaskId?(selectedTask?.name||'所选批次'):'';
  const scopeSceneId=ui.reviewSceneFilter||'',scopeSceneLabel=scopeSceneId?sceneLabel(state,selectedTask?.scene===scopeSceneId?selectedTask:scopeSceneId):'';
  const scopeKind=ui.reviewTaskId?(scopeSceneId?'task-scene':'task'):(scopeSceneId?'scene':'all');
  const scopeLabel=scopeSceneId?`${scopeTaskName?scopeTaskName+' · ':''}场景：${scopeSceneLabel}`:scopeTaskName||'全部可审核批次';
  return {total:scope.length,confirmed:confirmed.length,aiFinal,processedUnknown,notRun,pending,complete:scope.length>0&&scope.every(isReviewWorkComplete),
    globalPending:all.filter(requiresHumanReview).length,globalNotRun:all.filter(session=>!isReviewWorkComplete(session)&&getReviewRouting(session).status==='NOT_RUN').length,otherPending:others.length,
    scopeLabel,scopeKind,scopeTaskName,scopeSceneId,scopeSceneLabel,scopeIsTask:Boolean(selectedTask),
    nextTaskId:others[0]?.taskId||'',nextSessionId:others[0]?.id||'',waitingTasks:state.tasks.filter(task=>['待质检','质检中'].includes(task.status)).length,
    problems:confirmed.filter(session=>getSessionResults(session).some(result=>result.final?.verdict==='不符合')).length,
    unknowns:processedUnknown+confirmed.filter(session=>getSessionResults(session).some(result=>result.final?.verdict==='无法判定')).length};
}
export function nextPendingSession(state,ui){
  const scope=processable(state).filter(session=>withinScope(session,ui));
  const index=scope.findIndex(session=>session.id===ui.selectedId);
  return [...scope.slice(index+1),...scope.slice(0,index+1)].find(requiresHumanReview)||null;
}
export function reopenReviewContext(ui){return {...ui,showReviewRecords:false,reviewStatus:'全部',reviewQuery:''};}
export function completionView(info){
  const sceneScoped=Boolean(info.scopeSceneId);
  const title=info.processedUnknown?'本批次审核工作已处理':sceneScoped?(info.scopeTaskName?'当前任务与场景审核完成':'本场景审核完成'):info.globalPending===0?(info.waitingTasks||info.globalNotRun?'当前可审核会话已完成':'全部审核完成'):'本批次审核完成';
  const caption=sceneScoped?(info.scopeTaskName?uiT('{0} · 场景：{1}',{0:businessText(info.scopeTaskName),1:scenarioName(info.scopeSceneLabel)}):uiT('场景：{0}',{0:scenarioName(info.scopeSceneLabel)})):info.scopeIsTask?businessText(info.scopeLabel):uiT(info.scopeLabel);
  const reportLabel=sceneScoped?(info.scopeTaskName?'查看本任务管理汇总':'查看全部任务管理汇总'):'查看管理汇总';
  const exportLabel=sceneScoped?(info.scopeTaskName?'导出本任务质检明细':'导出全部任务质检明细'):'导出质检明细';
  return uiHtml`<section class="review-completion panel" aria-label="审核完成汇总">
    <div class="completion-symbol">${icon('check',30)}</div><p class="completion-scope">${e(caption)}</p><h1>${uiT(title)}</h1>
    <p class="completion-subtitle">${info.processedUnknown?uiT('审核工作已处理 {0} / {1} 条；其中 {2} 条结论仍无法判定。',{0:info.confirmed+(info.aiFinal||0)+info.processedUnknown,1:info.total,2:info.processedUnknown}):uiT('{0} / {1} 条已完成：AI已判定 {2} 条，人工已确认 {3} 条。',{0:info.confirmed+(info.aiFinal||0),1:info.total,2:info.aiFinal||0,3:info.confirmed})}</p>
    <div class="completion-metrics"><div><strong>${info.aiFinal||0}<small>条</small></strong><span>AI已判定</span></div><div><strong>${info.confirmed}<small>条</small></strong><span>人工已确认</span></div><div><strong>${info.problems}<small>条</small></strong><span>存在不符合的会话</span></div><div><strong>${info.unknowns}<small>条</small></strong><span>含无法判定的会话</span></div></div>
    <p class="completion-note">${uiT(info.processedUnknown?'已处理待补充不属于人工确认，不计为通过，也不进入最终质量分母。':'审核完成不等于全部通过；一条会话可能同时含不符合和无法判定。')}</p>
    ${info.otherPending?uiHtml`<div class="completion-next">${icon('tasks',18)}<div><strong>${sceneScoped?uiT('其他审核范围还有 {0} 条待人工确认',{0:info.otherPending}):uiT('其他批次还有 {0} 条待人工确认',{0:info.otherPending})}</strong><p>${uiT(sceneScoped?'当前范围已完成，可继续处理其余待审记录。':'当前批次已完成，可继续处理其他批次。')}</p></div></div>`:''}
    ${info.waitingTasks?uiHtml`<p class="completion-note">另有 ${info.waitingTasks} 个任务尚未进入人工审核，等待质检完成后处理。</p>`:''}
    ${info.globalNotRun?uiHtml`<p class="completion-note">${uiT('另有 {0} 条尚未执行完成，不计为审核完成。',{0:info.globalNotRun})}</p>`:''}
    <div class="completion-actions"><button class="btn primary" data-act="completion-report">${icon('overview',16)}${uiT(reportLabel)}</button><button class="btn" data-act="completion-export">${icon('export',16)}${uiT(exportLabel)}</button>${info.otherPending?uiHtml`<button class="btn" data-act="continue-pending">${uiT(sceneScoped?'继续其他待审范围':'继续其他待审批次')}${icon('arrow',15)}</button>`:''}</div>
    <div class="completion-record-actions">${info.processedUnknown?uiHtml`<button class="text-btn" data-act="view-processed-unknown">查看已处理待补充</button>`:''}${sceneScoped?uiLiteral('<button class="text-btn" data-act="review-clear-scene">清除场景筛选</button>'):''}<button class="text-btn" data-act="view-review-records">${uiT('查看全部记录')}${icon('chevron',13)}</button><button class="text-btn" data-act="view-confirmed">查看已确认会话${icon('chevron',13)}</button>${info.aiFinal?uiHtml`<button class="text-btn" data-act="review-return-batch">${uiT('按任务 / 规则标记可疑')}${icon('chevron',13)}</button>`:''}</div>
  </section>`;
}
