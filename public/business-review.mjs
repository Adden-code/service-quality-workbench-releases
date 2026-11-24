import {reasonContent} from './reason-translation.mjs';
import {sceneReviewEvidence} from './scene-review-view.mjs';
import {d as businessText,businessContent,translationControls} from './content-translation-ui.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {getSessionResults,canConfirmUnreplied,getReviewDisposition,isUnrepliedSession} from './domain.mjs';
import {getSessionRules,getTaskBasis,resolveTaskReference,referenceKey} from './task-basis.mjs';
import {e,icon,badge,dateTime} from './ui.mjs';
import {hasSuccessfulAI,sessionAIStatus} from './model-ui.mjs';
import {contextFieldsView} from './import-ui.mjs';
import {ecommerceBatchEvidence} from './ecommerce-ui.mjs';
import {ecommerceTimeFacts,ecommerceTimeFactLabel} from './ecommerce-results.mjs';
import {ecommerceTimeEvidenceView} from './ui-time-evidence.mjs';
import {uiLabel} from './i18n.mjs';
import {isAIFinal} from './ai-triage.mjs';
import {aiFinalFooter} from './review-routing-ui.mjs';

export function taskReferencePreview(state,session,key){
  const ref=resolveTaskReference(state,session,key),p=ref?.policy,section=ref?.section;
  return uiHtml`<button class="reference-link policy-preview" data-act="policy-detail" data-id="${e(key)}"><span class="policy-preview-heading">${icon('file',17)}<span><strong>${e(businessText(section?.title||p?.title||key))}</strong><span class="policy-version">${e(p?.id||'')} · ${e(p?.version||'')}</span></span>${icon('chevron',12)}</span>${p?uiHtml`<span class="policy-effective">生效日期 ${e(p.effectiveAt)}</span><span class="policy-quote">${businessContent(section?.text||p.content)}</span>`:''}</button>`;
}
export function manualResultCard(state,session,result,ui,confirmed){
  const rules=getSessionRules(state,session),rule=rules.find(r=>r.id===result.ruleId),current=result.final,open=ui.openRules.includes(result.ruleId);
  const ai=hasSuccessfulAI(session)?session.aiResults.find(r=>r.ruleId===result.ruleId):null,status=sessionAIStatus(session),running=status==='running';
  const aiFinal=isAIFinal(session),active=current||ai,changed=current&&!result.ruleExempt&&!aiFinal&&(!ai||current.source!=='AI接受');
  const localTime=result.ruleId==='EC-TIME'&&ecommerceTimeFacts(session);
  const timeLabel=localTime?ecommerceTimeFactLabel(session):'';
  const label=result.ruleExempt?`${uiT('AI规则免审')} · ${uiT(ai?.verdict||current?.verdict)}`:aiFinal?`${uiT('AI终判')} · ${uiT(ai?.verdict||current?.verdict)}`:current?`${confirmed?'人工结论':'人工草稿'} · ${current.verdict}`:localTime?`本地时效 · ${localTime.replyStatus==='replied'?ai.verdict:timeLabel}`:ai?`AI初判 · ${ai.verdict}`:'待人工判断';
  const evidence=record=>uiHtml`<div class="evidence-chips">${record?.evidence?.map(id=>uiHtml`<button data-act="evidence" data-turn="${e(id)}" data-rule="${e(result.ruleId)}">${icon('link',13)}定位第${e(id)}轮</button>`).join('')||uiLiteral('<span class="tiny muted">无可定位轮次，检查范围见判断理由</span>')}</div>${contextFieldsView(session,record?.fieldEvidence||[])}${ecommerceBatchEvidence(state,record)}`;
  const references=refs=>refs.map(key=>taskReferencePreview(state,session,key)).join('')||uiLiteral('<span class="tiny muted">本项未引用额外资料</span>');
  const refs=ai?.referenceIds||current?.referenceIds||getTaskBasis(state,session).policies.filter(p=>rule?.policyIds.includes(p.id)).map(p=>referenceKey(p));
  const subtitle=localTime?`本地时效计算 · ${timeLabel}`:ai?`AI初判 · ${ai.verdict}`:status==='running'?'AI质检进行中':status==='dependency_pending'?'依赖检查未完成 · 可逐项人工独立检查':status==='failed'?'尚无有效AI结论 · 可人工独立检查':'AI未执行 · 人工独立检查';
  return uiHtml`<article class="result-card ${active?.verdict==='不符合'?'attention':''} ${open?'open':''}" data-rule-card="${e(result.ruleId)}"><button class="result-card-heading" data-act="toggle-rule" data-id="${e(result.ruleId)}" aria-controls="rule-details-${e(result.ruleId)}" aria-expanded="${open}"><span class="result-title-left"><strong><span class="index">${String(rules.findIndex(r=>r.id===result.ruleId)+1).padStart(2,'0')}</span>${e(businessText(rule?.name||result.ruleId))}</strong></span><span class="result-tags">${badge(label,active?undefined:'muted')}<span class="down-icon">${icon('down',13)}</span></span></button><div class="result-details" id="rule-details-${e(result.ruleId)}" ${open?'':'hidden'}><span class="result-subtitle">${e(uiLabel(subtitle))}</span><p class="reason">${ai?.reason?reasonContent(ai.reason):businessContent(current?.reason||uiT('请依据原文与本任务保存的规则、资料逐项检查。'))}</p>${sceneReviewEvidence(session,result.ruleId)}${localTime?ecommerceTimeEvidenceView(state,session):''}${evidence(ai||current)}<span class="result-subtitle reference-title">${ai?uiT('AI参考依据'):current?uiT('人工参考依据'):uiT('可参考的任务资料')}</span>${references(refs)}${ai&&changed?uiHtml`<div class="human-override"><b>${confirmed?uiT('人工结论'):uiT('人工草稿')} · ${e(uiT(current.verdict))}</b><span class="human-result-reason">${businessContent(current.reason)}</span>${evidence(current)}<span class="result-subtitle reference-title">人工参考依据</span>${references(current.referenceIds||[])}</div>`:''}<div class="result-actions"><button class="btn ghost small" data-act="rule-detail" data-id="${e(result.ruleId)}">规则说明</button><button class="btn small" data-act="edit-result" data-rule="${e(result.ruleId)}" ${confirmed||running||aiFinal?'disabled':''}>${icon('edit',13)}${current||ai?uiT('修改人工判断'):uiT('记录人工判断')}</button></div></div></article>`;
}
export function manualHumanFooter(session,overall,ui,state){
  if(isAIFinal(session))return aiFinalFooter(session,ui);
  const results=getSessionResults(session),active=results.find(r=>r.ruleId===ui.openRules.at(-1))||results[0],confirmed=session.review.status==='已确认',remaining=results.filter(r=>!r.final).length;
  const ai=hasSuccessfulAI(session),status=sessionAIStatus(session),running=status==='running',disabled=running?'disabled':'';
  const unreplied=state&&isUnrepliedSession(state,session),factConfirmed=confirmed&&getReviewDisposition(session)==='unreplied',canConfirm=state&&canConfirmUnreplied(state,session);
  if(unreplied||factConfirmed){
    const nextAction=ui.reviewScopeComplete?'show-completion':'next-session';
    return uiHtml`<div class="results-footer unreplied-footer"><div class="human-status"><strong>未回复事实确认</strong>${badge(factConfirmed?'未回复事实已确认':session.review.status==='待补充'?'待补充':'待确认','warning')}</div><div class="human-caption">${factConfirmed?`${e(session.review.reviewer)} · ${dateTime(session.review.completedAt)}`:uiT('只确认来源中的回复正文和首次回复时间均为空；不形成质量通过或不通过。')}</div>${!confirmed?uiHtml`<div class="review-secondary"><button class="subtle-btn" data-act="pending" ${disabled}>待补充</button><button class="subtle-btn" data-act="save-draft" ${disabled}>暂存</button></div>`:''}<div class="review-dock">${confirmed?uiHtml`<button class="btn" data-act="reopen-review">重新审核</button><button class="btn primary" data-act="${nextAction}">${ui.reviewScopeComplete?uiT('查看审核汇总'):uiT('继续待审核')}${icon('arrow',14)}</button>`:uiHtml`<button class="btn" data-act="edit-result" data-rule="${e(active?.ruleId||'')}" ${disabled}>查看或记录人工判断</button><button class="btn primary" data-act="confirm-unreplied" ${canConfirm?'':'disabled'}>确认未回复事实${icon('check',15)}</button>`}</div>${!confirmed&&!canConfirm?uiLiteral('<p class="hint">尚无可核验的完整时效结果，或已有冲突的人工判断；请先核对原文与运行状态。</p>'):''}</div>`;
  }
  const caption=ai?`${remaining}项待人工确认 · AI初判已完成`:running?'AI质检进行中，完成后可记录与确认人工判断':status==='failed'?`${remaining}项尚待人工判断 · AI质检失败`:`${remaining}项尚待人工判断 · AI未执行`;
  return uiHtml`<div class="results-footer"><div class="human-status"><strong>人工最终结论</strong>${badge(confirmed?overall:session.review.status==='待补充'?'待补充':'待确认',confirmed?undefined:'warning')}</div><div class="human-caption">${confirmed?`${e(session.review.reviewer)} · ${dateTime(session.review.completedAt)}`:uiT(caption)}</div>${confirmed?'':uiHtml`<div class="review-secondary">${ai?uiHtml`<button class="text-btn" data-act="accept-ai">${icon('check',13)}其余采用AI结论</button>`:uiHtml`<span class="tiny muted">${e(session.review.reviewer)}（审核人标签）</span>`}<span class="spacer"></span><button class="subtle-btn" data-act="pending" ${disabled}>待补充</button><button class="subtle-btn" data-act="save-draft" ${disabled}>暂存</button></div>`}<div class="review-dock">${confirmed?uiHtml`<button class="btn" data-act="reopen-review">重新审核</button><button class="btn primary" data-act="${ui.reviewScopeComplete?'show-completion':'next-session'}">${ui.reviewScopeComplete?uiT('查看审核汇总'):uiT('继续待审核')}${icon('arrow',14)}</button>`:uiHtml`<button class="btn" data-act="edit-result" data-rule="${e(active?.ruleId||'')}" ${disabled}>${icon('edit',16)}${ai?uiT('人工修改'):uiT('记录人工判断')}</button><button class="btn primary" data-act="confirm-review" ${disabled}>确认本会话${icon('check',15)}</button>`}</div></div>`;
}
