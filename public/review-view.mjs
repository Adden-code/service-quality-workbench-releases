import {reviewRuleDisplayName as ruleDisplayName,reviewTask,nativeMaterialNotice,getReviewSessionRules} from './native-review-language.mjs';
import {groupedEvidenceView} from './evidence-display-ui.mjs';
import {reasonContent,reasonTranslationNotice} from './reason-translation.mjs';
import {reviewFilterControls,reviewSessionLabel,reviewWaitingView} from './review-state-ui.mjs';
import {dependencyRecoveryBadge,dependencyRecoveryNotice} from './dependency-recovery-ui.mjs';
import {taskHistoryView} from './task-history-view.mjs';
import {usesInlineEcommerce,inlineEcommerceView,inlineEcommerceFooter} from './ecommerce-inline-review.mjs';
import {isUnrepliedSession} from './domain.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';
import {sceneAggregateNotice} from './scene-review-view.mjs';
import {pendingResolutionControl,pendingResolutionBatchControl,processedUnknownFooter} from './pending-resolution-ui.mjs';
import {isRawTranscriptSession} from './raw-transcript.mjs';
import {rawReviewView,rawHumanFooter} from './raw-review-view.mjs';
import {d as businessText,businessContent,translationControls} from './content-translation-ui.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {contextFieldsView} from './import-ui.mjs';
import {ecommerceReferenceView} from './ecommerce-ui.mjs';
import {rules,policies,getSessionResults} from './domain.mjs';
import {e,icon,badge,dateTime,empty,issueCount} from './ui.mjs';
import {capturePositions,animateLayout,animateAppearance,cancelMotion} from './motion.mjs';
import {reviewCompletion,completionView} from './review-flow.mjs';
import {manualResultCard,manualHumanFooter} from './business-review.mjs';
import {hasSuccessfulAI,sessionAIStatus,sessionAIIndicator} from './model-ui.mjs';
import {taskPhaseLabel} from './ecommerce-results.mjs';
import {uiLabel} from './i18n.mjs';
import {isAIFinal,requiresHumanReview,getReviewRouting,isReviewWorkComplete,getReviewPresentation} from './ai-triage.mjs';
import {reviewRoutingSummary,batchReturnControl,aiFinalFooter} from './review-routing-ui.mjs';

import {isInactiveTask} from './task-lifecycle.mjs';
import {readingLayout} from './raw-review-layout.mjs';
export const resolvePolicy=id=>policies.find(p=>p.id===id||p.sections?.some(s=>s.id===id));
export function availableSessions(state){return state.sessions.filter(s=>{const t=state.tasks.find(t=>t.id===s.taskId);return !t||!isInactiveTask(t)&&(!['待质检','质检中'].includes(t.status)||t.mode==='manual'&&getReviewPresentation(s).ready);});}
export function reviewQueue(state,ui){
  const history=ui.reviewTaskId&&isInactiveTask(state.tasks.find(t=>t.id===ui.reviewTaskId)),available=history?state.sessions.filter(s=>s.taskId===ui.reviewTaskId):availableSessions(state),query=(ui.reviewQuery||'').toLowerCase();
  return available.filter(s=>(!ui.reviewTaskId||s.taskId===ui.reviewTaskId)&&(!ui.reviewSceneFilter||s.scene===ui.reviewSceneFilter)&&(history||ui.reviewStatus==='全部'||(ui.reviewStatus==='待确认'?requiresHumanReview(s):ui.reviewStatus==='AI失败'?s.aiExecution?.status==='failed':ui.reviewStatus==='AI初判待确认'?getReviewPresentation(s).initialPending:['AI终判免审','AI已判定'].includes(ui.reviewStatus)?isAIFinal(s):ui.reviewStatus==='已处理待补充'?isProcessedUnknown(s):s.review.status==='已确认'))&&`${s.externalId}${s.topic}${s.product}`.toLowerCase().includes(query));
}

export function reviewHeader(state,ui){
  const queue=reviewQueue(state,ui),index=queue.findIndex(s=>s.id===ui.selectedId);
  const completion=reviewCompletion(state,ui),position=completion.complete&&!ui.showReviewRecords?(completion.processedUnknown?uiT('{0} / {1} 条审核工作已处理',{0:completion.confirmed+completion.aiFinal+completion.processedUnknown,1:completion.total}):completion.aiFinal?uiT('{0} / {1} 条已完成',{0:completion.confirmed+completion.aiFinal,1:completion.total}):uiT('{0} / {1} 条已确认',{0:completion.confirmed,1:completion.total})):uiT('{0}条会话{1}',{0:queue.length,1:index>=0?uiT(' · 第{0}条',{0:index+1}):''});
  const selected=queue.find(s=>s.id===ui.selectedId)||queue[0],compact=usesInlineEcommerce(selected)&&!isInactiveTask(state.tasks.find(t=>t.id===selected.taskId));
  return uiHtml`<div class="review-heading ${compact?'ec-compact-heading':''}"><h1>人工审核</h1>${compact?'':uiHtml`<p>${ui.dataMode==='manual'?uiT('核对待审记录，查看AI判定，或逐项记录人工判断。'):uiT('核对AI初判，结合原文与依据确认最终结果。')}</p>`}</div>
    <div class="review-context"><select class="compact-select" id="review-task" aria-label="审核批次"><option value="">全部批次</option>${state.tasks.filter(t=>(!isInactiveTask(t)||t.id===ui.reviewTaskId)&&(!['待质检','质检中'].includes(t.status)||state.sessions.some(s=>s.taskId===t.id&&getReviewPresentation(s).ready))).map(t=>uiHtml`<option value="${e(t.id)}" ${ui.reviewTaskId===t.id?'selected':''}>${e(businessText(t.name))}</option>`).join('')}</select><span class="review-position">${uiT(position)}</span></div>`;
}

// Status and technical provenance share one disclosure; working controls remain visible.
function ecommerceReviewSummary(session,phase){
 const routing=getReviewRouting(session),status=sessionAIStatus(session),problem=['failed','dependency_pending'].includes(status);
 return uiHtml`<header class="ec-review-summary"><details class="ec-review-context"><summary><strong>${e(reviewSessionLabel(session))}</strong>${problem?uiHtml`<span class="ec-ai-warning">${status==='failed'?uiT('AI质检失败'):uiT('依赖检查未完成')}</span>`:''}<span class="ec-summary-more">详情${icon('down',12)}</span></summary><div class="ec-review-context-body">${sessionAIIndicator(session)}${phase?uiHtml`<p>${e(uiT(phase))}</p>`:''}<p>AI原判与操作历史保留；人工核对后另行确认最终结果。</p>${routing.reasons.length?uiHtml`<ul>${routing.reasons.map(reason=>uiHtml`<li>${e(uiT(reason))}</li>`).join('')}</ul>`:''}${session.review.returned?uiHtml`<p><strong>退回原因</strong> ${e(session.review.returned.reason)}</p>`:''}</div></details><button class="text-btn" data-act="task-detail" data-id="${e(session.taskId)}">${problem?uiT('运行记录 / 重试'):uiT('运行记录')}</button></header>`;
}

function policyPreview(ref){
  const policy=resolvePolicy(ref),section=policy?.sections?.find(s=>s.id===ref);
  return uiHtml`<button class="reference-link policy-preview" data-act="policy-detail" data-id="${e(ref)}" aria-label="查看依据：${e(section?.title||policy?.title||ref)}">
    <span class="policy-preview-heading">${icon('file',17)}<span><strong>${e(section?businessText(uiT(section.title)):policy?ruleDisplayName(policy):ref)}</strong><span class="policy-version">${e(ref)} <span>·</span> ${e(policy?.version||'')}</span></span>${icon('chevron',12)}</span>
    ${policy?uiHtml`<span class="policy-effective">生效日期 ${e(policy.effectiveAt)}</span><span class="policy-quote">${businessContent(section?.text||policy.content)}</span>`:''}
  </button>`;
}

function resultCard(result,ui,confirmed,task){
  const rule=rules.find(rule=>rule.id===result.ruleId),current=result.final||result,open=ui.openRules.includes(result.ruleId);
  const changed=result.final&&!['AI接受','AI终判','AI规则免审'].includes(result.final.source);
  const judgmentLabel=changed?(confirmed?'人工结论':'人工草稿'):'AI初判';
  const verdictKind={'符合':'success','不符合':'danger','无法判定':'warning','不适用':'muted'}[current.verdict];
  return uiHtml`<article class="result-card ${current.verdict==='不符合'?'attention':''} ${open?'open':''}" data-rule-card="${e(result.ruleId)}">
    <button class="result-card-heading" data-act="toggle-rule" data-id="${e(result.ruleId)}" aria-controls="rule-details-${e(result.ruleId)}" aria-expanded="${open}"><span class="result-title-left"><strong><span class="index">${String(rules.findIndex(v=>v.id===result.ruleId)+1).padStart(2,'0')}</span>${e(ruleDisplayName(rule||{id:result.ruleId}))}</strong></span><span class="result-tags">${badge(`${uiT(judgmentLabel)} · ${current.verdict}`,verdictKind)}<span class="down-icon">${icon('down',13)}</span></span></button>
    <div class="result-details" id="rule-details-${e(result.ruleId)}" ${open?'':'hidden'}>${changed?uiHtml`<span class="result-subtitle">AI初判 · ${e(uiT(result.verdict))}</span>`:''}<div class="reason">${reasonContent(result.reason,{task,result})}</div>
      ${result.final&&!['AI接受','AI终判','AI规则免审'].includes(result.final.source)?uiHtml`<div class="human-override"><b>${e(uiT(result.final.source))} · ${e(uiT(result.verdict))} → ${e(uiT(result.final.verdict))}</b>${businessContent(result.final.reason)}</div>`:''}
      <div class="evidence-chips">${(current.evidence||[]).length?current.evidence.map(turn=>uiHtml`<button data-act="evidence" data-turn="${turn}" data-rule="${e(result.ruleId)}">${icon('link',13)}定位第${turn}轮${icon('chevron',10)}</button>`).join(''):uiLiteral('<span class="tiny muted">无可定位轮次，检查范围见判断理由</span>')}</div>
      <span class="result-subtitle reference-title">参考依据</span>${(current.referenceIds||[]).map(policyPreview).join('')||uiLiteral('<span class="tiny muted">本项未引用资料</span>')}
      <div class="result-actions"><button class="btn ghost small" data-act="rule-detail" data-id="${e(result.ruleId)}">规则说明</button><button class="btn small" data-act="edit-result" data-rule="${e(result.ruleId)}" ${confirmed?'disabled':''}>${icon('edit',13)}人工修改</button></div>
    </div>
  </article>`;
}

export function humanFooter(session,overall,ui,state){
  if(!session)return reviewWaitingView(reviewQueue(state,{...ui,reviewStatus:'全部'}),ui);
 if(isInactiveTask(state?.tasks.find(t=>t.id===session.taskId)))return uiLiteral('<p class="hint">历史只读 · 已移出审核工作流</p>');
  if(isProcessedUnknown(session))return processedUnknownFooter(session,ui);
  if(isRawTranscriptSession(session))return rawHumanFooter(session,ui,state);
  if(isAIFinal(session))return aiFinalFooter(session,ui);
  if(usesInlineEcommerce(session)&&!isUnrepliedSession(state,session))return pendingResolutionControl(state,session)+inlineEcommerceFooter(session);
  if(session.expectedRuleIds){
    if(!overall)overall=getSessionResults(session).some(r=>r.final?.verdict==='不符合')?'不符合':getSessionResults(session).some(r=>r.final?.verdict==='无法判定')?'无法判定':'符合';
    return pendingResolutionControl(state,session)+manualHumanFooter(session,overall,ui,state);
  }
  if(!overall)overall=issueCount(session)>0?'不符合':getSessionResults(session).some(result=>(result.final?.verdict||result.verdict)==='无法判定')?'无法判定':'符合';
  const confirmed=session.review.status==='已确认';
  const active=session.aiResults.find(r=>r.ruleId===ui.openRules.at(-1))||session.aiResults[0];
  const reference=(session.review.drafts[active?.ruleId]||active)?.referenceIds?.[0];
  return uiHtml`<div class="results-footer"><div class="human-status"><strong>人工最终结论</strong>${badge(confirmed?overall:session.review.status==='待补充'?'待补充':'待确认',confirmed?undefined:'warning')}</div>
    <div class="human-caption">${confirmed?`${e(session.review.reviewer)} · ${dateTime(session.review.completedAt)}`:uiT(`${icon('info',13)}人工修改需填写理由（必填）`)}</div>
    ${confirmed?'':uiHtml`<div class="review-secondary"><button class="text-btn" data-act="accept-ai">${icon('check',13)}其余采用AI结论</button><button class="text-btn" data-act="add-issue">${icon('plus',13)}补充漏检</button><span class="spacer"></span><button class="subtle-btn" data-act="pending">待补充</button><button class="subtle-btn" data-act="save-draft">暂存</button></div>`}
    <div class="review-dock">${reference?uiHtml`<button class="btn" data-act="policy-detail" data-id="${e(reference)}">${icon('file',17)}查看依据</button>`:''}
      ${confirmed?uiHtml`<button class="btn" data-act="reopen-review">重新审核</button><button class="btn primary" data-act="${ui.reviewScopeComplete?'show-completion':'next-session'}">${ui.reviewScopeComplete?uiT('查看审核汇总'):uiT('继续待审核')}${icon('arrow',14)}</button>`:uiHtml`<button class="btn" data-act="edit-result" data-rule="${e(active?.ruleId||'R001')}">${icon('edit',16)}人工修改</button><button class="btn primary" data-act="confirm-review">确认本会话${icon('check',15)}</button>`}
    </div></div>`;
}

export function updateRuleDisclosure(root,id,open,options={}){
  const heading=[...root.querySelectorAll('[data-act="toggle-rule"]')].find(button=>button.dataset.id===id);
  if(!heading)return;
  const card=heading.closest('.result-card'),details=card.querySelector('.result-details');
  const list=card.closest('.result-list'),before=capturePositions(list.querySelectorAll('.result-card'));
  const anchor=heading.getBoundingClientRect().top;
  cancelMotion(details);
  card.classList.toggle('open',open);heading.setAttribute('aria-expanded',String(open));details.hidden=!open;
  // Disable browser scroll anchoring for this local operation, then keep the
  // clicked heading in place where scroll bounds permit it.
  list.scrollTop+=heading.getBoundingClientRect().top-anchor;
  animateLayout(before,options);
  if(open)animateAppearance(details,'details',options);
}

export function reviewView(state,ui){
 const historyTask=state.tasks.find(t=>t.id===ui.reviewTaskId);
 if(isInactiveTask(historyTask))return uiHtml`<div class="history-navigation"><button class="btn" data-act="task-detail" data-id="${e(historyTask.id)}">任务管理与审计</button><span>恢复、作废和删除请进入任务管理；历史判定只读。</span></div>`+taskHistoryView(state,historyTask,ui);

  const completion=reviewCompletion(state,ui);ui.reviewScopeComplete=completion.complete;
  if(completion.complete&&!ui.showReviewRecords)return uiHtml`<div class="review-page">${completionView(completion)}</div>`;
  const queue=reviewQueue(state,ui),session=queue.find(s=>s.id===ui.selectedId)||queue[0];
  if(session&&ui.selectedId!==session.id){
    ui.selectedId=session.id;ui.resultFilter='全部';
    ui.openRules=getSessionResults(session).filter(r=>(r.final?.verdict||r.verdict)==='不符合').map(r=>r.ruleId).slice(0,2);
    if(!ui.openRules.length)ui.openRules=[getSessionResults(session)[0]?.ruleId].filter(Boolean);
    const first=getSessionResults(session).find(r=>r.ruleId===ui.openRules[0]);
    ui.highlightedTurns=first?.final?.evidence||first?.evidence||[];
  }
  if(!session)return reviewWaitingView(reviewQueue(state,{...ui,reviewStatus:'全部'}),ui);
  if(isRawTranscriptSession(session))return rawReviewView(state,ui,{session,queue,allQueue:reviewQueue(state,{...ui,reviewStatus:'全部'})});
  const queueStart=Math.floor(Math.max(0,queue.findIndex(s=>s.id===session.id))/50)*50,queuePage=queue.slice(queueStart,queueStart+50);
  const confirmed=session?.review.status==='已确认',results=session?getSessionResults(session):[];
  const phase=taskPhaseLabel(state.tasks.find(task=>task.id===session?.taskId));
  const compact=usesInlineEcommerce(session)&&!isUnrepliedSession(state,session)&&!isAIFinal(session)&&!isProcessedUnknown(session),layout=compact?readingLayout(session.taskId):null;
  const overall=session&&issueCount(session)>0?'不符合':results.some(r=>(r.final?.verdict||r.verdict)==='无法判定')?'无法判定':'符合';
  const visible=results.filter(r=>ui.resultFilter==='全部'||(ui.resultFilter==='问题项'?(r.final?.verdict||r.verdict)==='不符合':ui.resultFilter==='人工修改'?r.final&&r.final.source!=='AI接受':true));
  return uiHtml`<div class="review-page ${compact?'ec-review-page':''}">${session?translationControls({kind:'session',taskId:session.taskId,sessionId:session.id}):''}${completion.complete?uiHtml`<div class="completion-return"><span>${icon('check',14)}当前范围 ${completion.confirmed+completion.aiFinal+(completion.processedUnknown||0)}/${completion.total} 条已完成</span><button class="text-btn" data-act="show-completion">返回审核汇总${icon('chevron',13)}</button></div>`:''}<div class="review-shell ${compact?'ec-review-shell':''}">
    <aside class="review-queue" aria-label="会话列表"><div class="queue-head"><h2>会话列表 <span class="muted">(${queue.length})</span></h2><div class="search">${icon('search',15)}<input id="review-search" value="${e(ui.reviewQuery)}" placeholder="搜索会话或问题" aria-label="搜索审核会话"></div></div>
      ${batchReturnControl(state,ui)}${pendingResolutionBatchControl(state,ui)}${ui.reviewSceneFilter?uiHtml`<p class="review-scene-filter">${e(uiT(ui.reviewSceneFilter))}<button class="text-btn" data-act="review-clear-scene">清除场景筛选</button></p>`:''}<div class="queue-filters">${reviewFilterControls(reviewQueue(state,{...ui,reviewStatus:'全部'}),ui)}</div>
      ${queue.length>50?uiHtml`<div class="queue-pagination">${queueStart?uiHtml`<button class="text-btn" data-act="select-session" data-id="${e(queue[queueStart-1].id)}">上一页</button>`:''}<span>${queueStart+1}–${Math.min(queueStart+50,queue.length)} / ${queue.length}</span>${queueStart+50<queue.length?uiHtml`<button class="text-btn" data-act="select-session" data-id="${e(queue[queueStart+50].id)}">下一页</button>`:''}</div>`:''}<div class="session-queue-list">${queue.length?queuePage.map(row=>uiHtml`<button class="session-item ${session?.id===row.id?'active':''}" data-act="select-session" data-id="${e(row.id)}" aria-pressed="${session?.id===row.id}"><span class="session-id"><span class="mono">${e(row.externalId||row.id)}</span><i class="session-dot ${isReviewWorkComplete(row)?'done':''}"></i></span><strong>${e(businessText(row.topic))}</strong><p>${dateTime(row.startedAt)} · ${e(reviewSessionLabel(row))}</p>${dependencyRecoveryBadge(row,state.tasks.find(t=>t.id===row.taskId))}</button>`).join(''):empty('暂无会话','请调整筛选条件。')}</div>
    </aside>
    ${session?uiHtml`${compact?uiHtml`<div class="ec-review-split" data-task-id="${e(session.taskId)}" style="--raw-source-width:${layout.ratio}%">`:''}<section class="conversation-pane" aria-label="会话原文"><div class="conversation-top"><h2>${e(businessText(session.topic))}</h2><div class="conversation-sub"><span class="mono">${e(session.externalId||session.id)}</span><span>${e(session.customer)}</span><span>${e(session.agent)}</span><span>${e(session.product)}</span></div><div class="conversation-topic"><span>${dateTime(session.startedAt)}</span><span class="spacer"></span><span>${session.turns.length}轮发言</span></div></div>
      <div class="messages" id="messages">${ecommerceReferenceView(session,state)}${contextFieldsView(session)}${session.turns.map(turn=>turn.role==='系统'?uiHtml`<div class="system-message">${businessContent(turn.text,{quote:true})}</div>`:uiHtml`<article class="message ${turn.role==='客户'?'customer':'agent'} ${ui.highlightedTurns.includes(turn.id)?'evidence':''}" id="turn-${turn.id}" data-turn="${turn.id}"><div class="message-avatar">${turn.role==='客户'?uiT('客'):uiT('服')}</div><div class="message-main"><div class="message-meta"><span>${e(uiT(turn.role))}</span><span>第${turn.id}轮 · ${turn.at?dateTime(turn.at).split(' ').at(-1):''}</span></div><div class="message-bubble">${businessContent(turn.text,{quote:true})}</div>${ui.highlightedTurns.includes(turn.id)?uiHtml`<div class="evidence-label">${icon('link',11)}第${turn.id}轮 · 原文证据</div>`:''}</div></article>`).join('')}</div>
      <div class="conversation-footer"><span>${icon('info',12)}原文不可编辑 · 人工判断单独保存</span><span>${icon('check',12)}提交后保存在本机工作区</span></div>
    </section>
    ${compact?uiHtml`<div role="separator" tabindex="0" aria-label="调整原文和复核宽度" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="85" aria-valuenow="${layout.ratio}" data-reading-divider></div>`:''}<section class="results-pane" aria-label="AI质检与人工审核">${compact?ecommerceReviewSummary(session,phase):uiHtml`<div class="results-top"><div class="results-titlebar"><h2>${session.expectedRuleIds&&!hasSuccessfulAI(session)?uiT('人工检查清单'):uiT('AI质检结果')}</h2><div class="result-summary" title="${issueCount(session)}项问题">${badge(reviewSessionLabel(session),confirmed||isAIFinal(session)?'success':session.review.status==='已暂存'?'blue':'warning')}</div><span class="check-count">${results.length}项检查</span></div></div>${phase?uiHtml`<p class="hint task-phase">${e(uiT(phase))} · 试运行；完整五项V2.1尚未实施。</p>`:''}${isProcessedUnknown(session)?'':reviewRoutingSummary(session)}${session.expectedRuleIds&&!isProcessedUnknown(session)?sessionAIIndicator(session):''}`}
      ${compact?'<div class="result-list">':''}<div class="results-tabs">${['全部','问题项','人工修改'].map(filter=>uiHtml`<button class="${ui.resultFilter===filter?'active':''}" data-act="result-filter" data-value="${filter}">${uiT(filter==='人工修改'?'人工修改记录':filter)}</button>`).join('')}<span class="review-progress" title="已记录人工判断的检查项">${Object.keys(session.review.drafts).length}/${results.length}人工记录</span></div>
      ${nativeMaterialNotice(reviewTask(state,session))}${compact?'':reasonTranslationNotice(session,state.tasks.find(task=>task.id===session.taskId))+groupedEvidenceView(session,session.aiResults,getReviewSessionRules(state,session))}${dependencyRecoveryNotice(session,state.tasks.find(t=>t.id===session.taskId))}${sceneAggregateNotice(state,session,results)}${compact?'':'<div class="result-list">'}${usesInlineEcommerce(session)&&!isAIFinal(session)&&!isProcessedUnknown(session)?inlineEcommerceView(state,session,ui):visible.length?visible.map(result=>session.expectedRuleIds?manualResultCard(state,session,result,ui,confirmed||isProcessedUnknown(session)):resultCard(result,ui,confirmed||isAIFinal(session),reviewTask(state,session))).join(''):empty('当前筛选没有记录','可切换“全部”查看所有检查项。')}</div>
      ${humanFooter(session,overall,ui,state)}
    </section>${compact?'</div>':''}`:uiHtml`<section class="panel review-empty">${empty('没有可审核的会话',ui.dataMode==='manual'?'请在质检任务中导入会话文件，或调整筛选条件。':'请先在质检任务中运行内置演示材料，或调整筛选条件。')}</section>`}
  </div><div class="review-bottom-note">${icon('info',11)}${session&&isAIFinal(session)?uiT('AI原判与依据保留 · 标记可疑可退回人工'):session?.expectedRuleIds?(hasSuccessfulAI(session)?uiT('AI原判保留 · 人工确认后形成最终结论'):sessionAIStatus(session)==='running'?uiT('AI正在检查任务原文与冻结依据'):sessionAIStatus(session)==='dependency_pending'?uiT('依赖检查未完成，可返回任务详情继续处理或逐项人工独立检查'):sessionAIStatus(session)==='failed'?uiT('AI运行失败，可返回任务重试或人工独立检查'):uiT('AI未执行 · 本任务按所绑定依据完成人工独立检查')):uiT('AI初判为虚构预置结果 · 人工确认后形成最终结论')}</div></div>`;
}
