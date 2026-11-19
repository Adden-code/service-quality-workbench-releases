import {evidenceNotice} from './review-evidence-notice.mjs';
import {e} from './ui.mjs';
import {getLocale} from './i18n.mjs';
import {getSessionRules,getTaskBasis,referenceKey} from './task-basis.mjs';
import {saveReview,acceptAI,confirmReview} from './domain.mjs';
import {requiresEcommerceClassification,classificationReviewed,classificationNeedsJudgment,saveClassificationReview} from './ecommerce-classification-review.mjs';
import {computeEcommerceTimeFacts,timePolicyReferences} from './ecommerce-time-results.mjs';
import {ecommerceSourceColumn,ecommerceTimeValues} from './ecommerce-schema.mjs';
import {sceneReviewEvidence} from './scene-review-view.mjs';
const copy=v=>structuredClone(v),q=(zh,en)=>getLocale()==='en'?en:zh;
const verdicts=['符合','不符合','无法判定','不适用'],names=['Pass','Fail','Undetermined','NA'];
export const usesInlineEcommerce=s=>Boolean(s?.ecommerce&&s.expectedRuleIds);
export function inlineTimeDraft(state,s){
 const task=state.tasks.find(t=>t.id===s.taskId),basis=getTaskBasis(state,s),facts=computeEcommerceTimeFacts(s,basis,{inspectionAt:task.aiRun?.inspectionAt||task.createdAt,runtime:task.executionSnapshot?.runtime});
 const fieldEvidence=(s.contextFields||[]).filter(f=>[12,13].some(i=>f.source?.column===ecommerceSourceColumn(s.ecommerce,i))).map(f=>f.key);
 if(facts)return{ruleId:'EC-TIME',verdict:({pass:'符合',fail:'不符合',na:'不适用'})[facts.outcome]||'无法判定',reason:facts.reason,evidence:[],fieldEvidence,referenceIds:timePolicyReferences(basis)};
 const times=ecommerceTimeValues(s.ecommerce),ms=Date.parse(times.replyTime)-Date.parse(times.commentTime),valid=Number.isFinite(ms)&&ms>=0;
 return{ruleId:'EC-TIME',verdict:valid?(ms>s.ecommerce.thresholdHours*3600000?'不符合':'符合'):'无法判定',reason:valid?`自然耗时 ${ms/3600000} 小时，冻结阈值 ${s.ecommerce.thresholdHours} 小时；夜间与周末计入。`:'评论或首次回复时间缺失、无效或反向，待核对。',evidence:[],fieldEvidence,referenceIds:timePolicyReferences(basis)};
}
export function inlineDrafts(state,s,edits={}){
 const basis=getTaskBasis(state,s);
 return getSessionRules(state,s).map(rule=>{
  const ai=s.aiExecution?.status==='completed'?s.aiResults.find(r=>r.ruleId===rule.id):null;
  const refs=basis.policies.filter(p=>rule.policyIds.includes(p.id)).flatMap(p=>{const specific=p.sections.filter(x=>x.id.startsWith(rule.id+'-'));return(specific.length?specific:p.sections).map(x=>referenceKey(p,x));});
  const base=s.review.drafts[rule.id]||ai||(rule.id==='EC-TIME'?inlineTimeDraft(state,s):{ruleId:rule.id,verdict:'符合',reason:'',evidence:s.turns.map(t=>t.id),referenceIds:refs});
  return{...copy(base),referenceIds:base.referenceIds?.length?base.referenceIds:refs,...copy(edits[rule.id]||{}),ruleId:rule.id};
 });
}
/** One explicit action saves the five judgments atomically. Opening the page saves nothing. */
export function saveInlineEcommerce(state,id,edits={},at,{confirm=false,classification}={}){
 const s=state.sessions.find(s=>s.id===id);if(!usesInlineEcommerce(s)||s.review.status==='已确认')throw new Error('请先重新审核，才能修改这条会话。');
 const drafts=inlineDrafts(state,s,edits),missing=drafts.filter(d=>!d.reason?.trim()&&['不符合','无法判定'].includes(d.verdict));
 if(missing.length)throw new Error(`请填写以下项目的判定理由：${missing.map(d=>d.ruleId).join('、')}。`);
 let next=state;
 if(confirm&&requiresEcommerceClassification(s)&&(!classificationReviewed(s)||classification&&['evaluationType','vocKind','reason'].some(k=>classification[k]!==s.review.classification[k]))){
  const value=classification||s.sceneCapabilities?.outputs?.ecommerceClassification?.value||{};
  next=saveClassificationReview(next,id,{...value,reason:value.reason||'人工核对并确认评价分类。'},at);
 }
 const updated=next.sessions.find(r=>r.id===id),needs=['EC-TIME','EC-STEPS'].filter(ruleId=>classificationNeedsJudgment(updated,ruleId)&&!edits[ruleId]);if(needs.length)throw new Error('分类已更正，请先保存分类复核，再核对并点选时效与回复结构结论：'+needs.join('、'));
 if(s.aiExecution?.status==='completed')next=acceptAI(next,id,at);
 for(const draft of drafts){
  const current=next.sessions.find(r=>r.id===id),ai=s.aiResults.find(r=>r.ruleId===draft.ruleId),edit=edits[draft.ruleId];
  if(!edit&&ai&&current.review.drafts[draft.ruleId]&&!classificationNeedsJudgment(current,draft.ruleId))continue;
  next=saveReview(next,id,{...draft,reason:draft.reason?.trim()||(draft.verdict==='不适用'?'人工核对适用范围，本项不适用。':'人工核对原文与冻结口径，未发现本项不符合。'),source:'人工修改'},at);
 }
 return confirm?confirmReview(next,id,at):next;
}
export function inlineAttention(d){return ['不符合','无法判定'].includes(d.verdict)||d.comparisonAssessment?.status==='incomplete';}
export function orderedInlineDrafts(state,s,edits={}){const base=new Map(inlineDrafts(state,s).map(d=>[d.ruleId,inlineAttention(d)]));return inlineDrafts(state,s,edits).sort((a,b)=>Number(base.get(b.ruleId))-Number(base.get(a.ruleId)));}
export function inlineEcommerceView(state,s,ui){
 const readonly=s.review.status==='已确认'||Boolean(s.review.pendingResolution?.active),running=s.aiExecution?.status==='running',disabled=readonly||running;
 const edits=ui.ecInlineDrafts?.[s.id]||{},drafts=orderedInlineDrafts(state,s,edits),rules=getSessionRules(state,s),en=getLocale()==='en';
 return `<section class="ec-inline-review" data-inline-session="${e(s.id)}"><button class="btn small" data-act="ec-inline-next-attention">${q('下一个需处理项','Next attention item')}</button><p class="hint">${q('需核对／不符合／无法判定优先显示。五项一起核对：默认符合仅为待确认草稿；AI待核对项保留原结论。符合无需填理由，不符合／无法判定须说明。','Attention items are shown first. Review all five checks together. Defaults are unconfirmed drafts; AI exceptions retain their verdicts. PASS needs no typed reason; FAIL / Undetermined require a reason.')}</p>${drafts.map((d,i)=>{const ai=s.aiResults.find(r=>r.ruleId===d.ruleId),rule=rules.find(r=>r.id===d.ruleId);return `<article class="ec-inline-row" data-inline-rule="${e(d.ruleId)}" data-needs-attention="${inlineAttention(d)}" tabindex="0"><h3>${i+1}. ${e(rule?.title||rule?.name||d.ruleId)}</h3>${evidenceNotice(ai)}<small>${e(d.ruleId)} · ${ai?q('AI初判','AI'):q('待确认草稿','Unconfirmed draft')} ${e(ai?en?names[verdicts.indexOf(ai.verdict)]:ai.verdict:'')}</small><div class="ec-verdict-segments" role="group" aria-label="${e(q('人工结论','Human verdict'))}">${verdicts.map((v,j)=>`<button type="button" class="btn small ${d.verdict===v?'selected':''}" data-act="ec-inline-verdict" data-rule="${e(d.ruleId)}" data-verdict="${v}" aria-pressed="${d.verdict===v}" ${disabled?'disabled':''}>${en?names[j]:v}<kbd>${j+1}</kbd></button>`).join('')}</div><label class="field-label" for="inline-reason-${e(d.ruleId)}">${['符合','不适用'].includes(d.verdict)?q('备注（选填）','Note (optional)'):q('判定理由（必填）','Reason (required)')}</label><textarea class="field" id="inline-reason-${e(d.ruleId)}" data-inline-reason="${e(d.ruleId)}" rows="2" ${disabled?'disabled':''}>${e(d.reason||'')}</textarea>${ai?`<div class="toolbar-group"><button class="text-btn" data-act="ec-inline-use-ai" data-rule="${e(d.ruleId)}" ${disabled?'disabled':''}>${q('维持AI原判','Keep AI verdict')}</button><button class="text-btn" data-act="ec-inline-edit" data-rule="${e(d.ruleId)}" ${disabled?'disabled':''}>${q('改判','Change')}</button></div>`:''}<details><summary>${q('依据与证据（已预填，可核对）','Basis and evidence (prefilled)')}</summary><p>${e(ai?.reason||d.reason||q('核对本条原文全范围。','Review the full source record.'))}</p><p>${q('参考条款','References')}：${d.referenceIds.map(e).join(' · ')}</p><p>${q('证据轮次','Source turns')}：${(d.evidence||[]).map(e).join(', ')||'—'} · ${q('字段','Fields')}：${(d.fieldEvidence||[]).map(e).join(', ')||'—'}</p>${ai?.comparisonAssessment?.status==='incomplete'?`<p class="soft-note warning">${q('相似比较尚未完整：仅③子维度待人工或重跑，①②原判保留。','Similarity comparison is incomplete: only sub-check 3 needs review or retry; checks 1–2 are preserved.')}</p>`:''}</details></article>`;}).join('')}${sceneReviewEvidence(s,'EC-TIME',ui.ecClassificationDrafts?.[s.id])}<p class="hint">${q('J/K 切会话；项目获得焦点时 Tab 跳下一个需处理项；焦点位于项目时 1/2/3/4 选结论；Ctrl+Enter 确认五项。输入理由时不触发单键快捷键。','J/K: conversations; Tab: controls; 1/2/3/4: verdict for the focused check; Ctrl+Enter: confirm all five. Letter shortcuts do not run while typing.')}</p></section>`;
}
export function inlineEcommerceFooter(s){
 if(s.review.status==='已确认')return `<div class="results-footer"><p>${q('人工已确认','Human confirmed')}</p><button class="btn" data-act="reopen-review">${q('重新审核','Reopen')}</button><button class="btn primary" data-act="next-session">${q('下一条','Next')}</button></div>`;
 const disabled=s.aiExecution?.status==='running'?'disabled':'';
 return `<div class="results-footer"><p>${q('保存草稿不会形成最终结论。确认将同时记录五项和评价分类复核。','Saving a draft does not finalize results. Confirm records all five checks and classification review.')}</p><div class="review-dock"><button class="btn" data-act="ec-inline-save" ${disabled}>${q('保存五项草稿','Save all drafts')}</button><button class="btn primary" data-act="ec-inline-confirm" ${disabled}>${q('确认五项','Confirm all five')}</button></div></div>`;
}
