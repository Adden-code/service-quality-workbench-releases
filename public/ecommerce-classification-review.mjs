import {assertTaskWritable} from './task-lifecycle.mjs';
import {cloneReviewState} from './domain.mjs';
import {e} from './ui.mjs';
import {getLocale} from './i18n.mjs';
export const hasEcommerceClassification=s=>Boolean(s.sceneCapabilities?.outputs?.ecommerceClassification);
export const classificationReviewed=s=>Boolean(s.review?.classification?.runId===s.aiExecution?.runId&&s.review.classification?.at);
export const classificationChanged=s=>classificationReviewed(s)&&s.review.classification.changed;
export function classificationNeedsJudgment(s,ruleId){return classificationChanged(s)&&['EC-TIME','EC-STEPS'].includes(ruleId)&&(!s.review.drafts[ruleId]||s.review.drafts[ruleId].source==='AI接受'||!s.review.history?.some(h=>h.ruleId===ruleId&&Date.parse(h.at)>=Date.parse(s.review.classification.at)));}
export function saveClassificationReview(state,id,{evaluationType,vocKind,reason},at){
 assertTaskWritable(state,state.sessions.find(s=>s.id===id));
 const next=cloneReviewState(state,id),s=next.sessions.find(s=>s.id===id);if(!s||!hasEcommerceClassification(s)||s.aiExecution?.status!=='completed'||s.review.status==='已确认')throw new Error('请在AI完成后、人工确认前复核分类。');
 if(!['好评正向','好评负向','中评','差评','无效评价'].includes(evaluationType)||!['substantive','strong-negative','none'].includes(vocKind)||typeof reason!=='string'||!reason.trim()||reason.length>2000||!s.review.reviewer.trim()||!/(Z|[+-]\d\d:\d\d)$/.test(at)||!Number.isFinite(Date.parse(at)))throw new Error('请选择分类、填写依据及审核人标签。');
 if(['好评正向','无效评价'].includes(evaluationType)&&vocKind!=='none')throw new Error('好评正向或无效评价不能标记负面声音。');
 const rating=Number(s.ecommerce.raw[10]);if(evaluationType!=='无效评价'&&(rating===1&&evaluationType!=='差评'||rating>=2&&rating<=3&&evaluationType!=='中评'||rating>=4&&rating<=5&&!['好评正向','好评负向'].includes(evaluationType)))throw new Error('评分档位由原始评分确定，不能通过情绪改成其他分档。');
 const ai=s.sceneCapabilities.outputs.ecommerceClassification.value||{},before=s.review.classification||null,changed=ai.evaluationType!==evaluationType||ai.vocKind!==vocKind;
 const after={evaluationType,vocKind,reason:reason.trim(),reviewer:s.review.reviewer,at,runId:s.aiExecution.runId,changed};s.review.classification=after;s.review.classificationHistory=[...(s.review.classificationHistory||[]),{before,after:structuredClone(after)}];if(changed)for(const ruleId of ['EC-TIME','EC-STEPS'])delete s.review.drafts[ruleId];s.review.status='已暂存';return next;
}
export function classificationCoercionNotice(ai){
 if(!ai?.coercion?.changes?.length)return '';const en=getLocale()==='en',cleared=ai.coercion.changes.some(c=>c.reasonCode==='uncertain-value-cleared');
 return `<p class="classification-coercion" role="note">${e(cleared?(en?'AI could not determine the classification. Its tentative value was cleared; please classify this review. The original output remains in the audit.':'AI未能确定分类，已清空其候选值，请人工选择；原始输出保留在审计中。'):(en?'The model marked a substantive negative issue alongside positive sentiment. This combination was corrected to negative; please review it. Both values remain in the audit.':'模型同时标记正向情绪和实质负面问题，已按组合规则修正为负向，请复核；修改前后值均已留痕。'))}</p>`;
}
export function classificationReviewForm(s,draft){
 if(!hasEcommerceClassification(s))return'';const ai=s.sceneCapabilities.outputs.ecommerceClassification,human=classificationReviewed(s)?s.review.classification:null,value=draft||human||ai.value||{},disabled=s.aiExecution?.status!=='completed'||s.review.status==='已确认';
 return`<section class="soft-note scene-classification"><strong>评价归类 · ${human?'已人工复核':'待人工复核'}</strong>${classificationCoercionNotice(ai)}<p>AI分类：${e(ai.value?.evaluationType||'无法判定')}；${e(ai.reason||'')}；置信度 ${e(ai.confidence??'—')}</p><blockquote>${e((ai.evidence||[]).map(x=>x.quote).join('\n'))}</blockquote><p>评分按原表分档。短评有明确负面态度时保留为强烈负面情绪；纯Emoji或无意义内容标记无效。分类纠正后，时效与回复结构必须人工重新判断。</p><label>评价类型<select class="field" id="ec-review-type" ${disabled?'disabled':''}><option value="" disabled ${value.evaluationType?'':'selected'}>${getLocale()==='en'?'Choose a review type':'请选择评价类型'}</option>${['好评正向','好评负向','中评','差评','无效评价'].map(x=>`<option ${value.evaluationType===x?'selected':''}>${x}</option>`).join('')}</select></label><label>用户声音<select class="field" id="ec-review-voc" ${disabled?'disabled':''}><option value="" disabled ${value.vocKind?'':'selected'}>${getLocale()==='en'?'Choose customer voice':'请选择用户声音'}</option>${[['substantive','实质问题'],['strong-negative','强烈负面情绪（不归具体问题类）'],['none','无负面声音 / 无效内容']].map(([id,label])=>`<option value="${id}" ${value.vocKind===id?'selected':''}>${label}</option>`).join('')}</select></label><label>复核依据<textarea class="field" id="ec-review-reason" ${disabled?'disabled':''}>${e(draft?.reason??human?.reason??'')}</textarea></label><button class="btn small" data-act="ec-classification-save" ${disabled?'disabled':''}>保存分类复核</button><p>模型归类问题请按内部流程反馈 Onebox；本机不自动发送。</p></section>`;
}
