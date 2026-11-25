import {reviewSessionLabel} from './review-state-ui.mjs';
import {getLocale} from './i18n.mjs';
import {samplingDescription} from './rule-calibration-policy.mjs';
import {html as uiHtml,uiLiteral,t as uiT} from './i18n.mjs';
import {d as businessText,ruleDisplayName} from './content-translation-ui.mjs';
import {e,icon,badge,dateTime} from './ui.mjs';
import {getSessionRules} from './task-basis.mjs';
import {getReviewPresentation,DEFAULT_REVIEW_POLICY,normalizeReviewPolicy,getReviewRouting,isAIFinal,returnToHumanReview} from './ai-triage.mjs';

const thresholdLabel=session=>Number(session.aiDecision?.confidenceThreshold??session.reviewPolicy?.confidenceThreshold??0.90).toFixed(2);
export function triagePolicyFields(policy=DEFAULT_REVIEW_POLICY){
 const mode=policy?.version===2?'rule-calibrated':'confidence',selector=uiHtml`<div class="field-group"><label class="field-label" for="triage-mode">审核模式（二选一）</label><select class="field" id="triage-mode"><option value="rule-calibrated" ${mode==='rule-calibrated'?'selected':''}>规则级标定（默认）</option><option value="confidence" ${mode==='confidence'?'selected':''}>置信度门槛（旧模式）</option></select></div>`;
 if(policy?.version===2)return selector+uiHtml`<fieldset class="triage-policy-fields"><legend>规则级免审</legend><label class="check-label"><input id="triage-rule-enabled" type="checkbox" ${policy.enabled?'checked':''}>启用已标定规则的符合免审</label><p class="hint">独立验证不少于30对且一致率≥80%的规则才可启用；未达标规则、非符合项及强制抽检项由人工审核。已启用标定随新任务冻结，运行时核对模型指纹。旧任务策略不变。</p><p class="hint">免审候选每规则每批5%强制抽检，至少5条（不足5条全检），人工核验错误率超过20%自动停用并回溯补审。模型自评置信度不再作为本模式的免审门槛。</p></fieldset>`;
  const value={...DEFAULT_REVIEW_POLICY,...policy};
  return selector+uiHtml`<fieldset class="triage-policy-fields"><legend>分级审核（内测）</legend><label class="check-label" for="triage-enabled"><input id="triage-enabled" type="checkbox" ${value.enabled?'checked':''}>启用AI通过免审</label><div class="field-group"><label class="field-label" for="triage-threshold">AI免审置信度门槛</label><input class="field" id="triage-threshold" type="number" min="0" max="1" step="0.01" value="${e(Number(value.confidenceThreshold).toFixed(2))}" aria-describedby="triage-policy-note"></div><p class="hint" id="triage-policy-note">当前门槛用于内测，尚未用真实业务基准标定。只有全部适用项通过、原文引文及规则一致性检查有效的记录可由AI判定；不通过、证据不足或被标记可疑的记录转人工。策略随任务保存。</p></fieldset>`;
}
export function readTriagePolicy(root=globalThis.document,fallback=DEFAULT_REVIEW_POLICY){
 const selectedMode=root?.querySelector('#triage-mode')?.value;
 const ruleEnabled=root?.querySelector('#triage-rule-enabled');if(selectedMode==='rule-calibrated'||selectedMode!=='confidence'&&typeof ruleEnabled?.checked==='boolean')return normalizeReviewPolicy({version:2,mode:'rule-calibrated',enabled:ruleEnabled?Boolean(ruleEnabled.checked):fallback.enabled!==false,calibrationStatus:'per-rule',rules:[]});
  const enabled=root?.querySelector('#triage-enabled'),threshold=root?.querySelector('#triage-threshold');
  if(!enabled&&!threshold)return normalizeReviewPolicy(selectedMode==='confidence'?DEFAULT_REVIEW_POLICY:fallback||DEFAULT_REVIEW_POLICY);
  if(threshold&&!String(threshold.value).trim())throw new Error('分级审核门槛须为0至1的数值；真实基准尚未标定。');
  return normalizeReviewPolicy({...DEFAULT_REVIEW_POLICY,enabled:enabled?Boolean(enabled.checked):fallback.enabled,confidenceThreshold:threshold?Number(threshold.value):fallback.confidenceThreshold});
}

export function reviewNavigationBadge(summary){
  const title=uiT('待审 {0} 条：按任务和场景查看构成',{0:summary.total});
  return uiHtml`<div class="review-nav-breakdown" data-review-breakdown data-open="false"><button class="review-count-button" data-act="toggle-review-breakdown" aria-label="${e(title)}" title="${e(title)}" aria-expanded="false" aria-controls="review-queue-breakdown"><b class="nav-count">${summary.total}</b></button><div class="review-breakdown-panel" id="review-queue-breakdown" role="region" aria-label="待审构成"><strong>${uiT('待人工审核 {0} 条',{0:summary.total})}</strong><p class="tiny muted">按会话去重；同一会话只计一次。</p>${summary.byTask.length?uiHtml`<h3>按任务</h3>${summary.byTask.map(task=>uiHtml`<button data-act="review-breakdown-task" data-id="${e(task.taskId)}"><span>${e(businessText(task.name))}</span><b>${task.count}</b><small>${uiT('AI不通过 {0} · 需核对 {1} · 已退回 {2}',{0:task.fail,1:task.uncertain,2:task.returned})}</small></button>`).join('')}<h3>按场景</h3>${summary.byScene.map(scene=>uiHtml`<button data-act="review-breakdown-scene" data-scene="${e(scene.scene)}"><span>${e(uiT(scene.scene||'未分配场景'))}</span><b>${scene.count}</b></button>`).join('')}`:uiLiteral('<p>当前没有待人工审核的记录。</p>')}<p class="tiny muted">${uiT('另有AI已判定 {0} 条 · 人工已确认 {1} 条',{0:summary.aiFinal,1:summary.humanConfirmed})}</p></div></div>`;
}

export function reviewRoutingSummary(session){
  const routing=getReviewRouting(session);if(routing.status==='LEGACY')return '';
  const label=reviewSessionLabel(session);
  const returned=session.review?.returned;
  return uiHtml`<div class="review-routing-summary ${routing.aiFinal?'ai-final':routing.needsReview?'needs-review':''}" data-review-routing="${e(routing.status)}"><div>${badge(label,routing.resultSource?'success':routing.needsReview?'warning':'muted')}${routing.aiFinal?uiHtml`<button class="text-btn" data-act="review-return" data-id="${e(session.id)}">标记可疑 → 退回人工</button>`:''}</div>${routing.resultSource==='human'?uiLiteral('<p>人工确认结果为最终结论；AI原判与操作历史保留。</p>'):session.aiDecision?uiHtml`<p>${routing.aiFinal&&session.reviewPolicy?.version===2?uiT('本会话全部规则均为有效规则级免审，原判定与抽检分配留痕。'):routing.aiFinal?uiT('AI终判依据：全部适用项通过，置信度达到门槛，原文引文和规则一致性检查通过。'):uiT('AI原判保留；人工核对后另行确认最终结果。')}</p><p>${session.reviewPolicy?.version===2?uiT('规则独立验证≥30对、一致率≥80%；仅符合项免审。')+' '+samplingDescription(session.reviewPolicy,getLocale()==='en'):uiT('当前门槛 {0}（内测启用，尚未用真实业务基准标定）。',{0:thresholdLabel(session)})}${typeof session.aiDecision.confidence==='number'?uiT(' 最低项目置信度 {0}。',{0:session.aiDecision.confidence.toFixed(2)}):''}</p>${routing.reasons.length?uiHtml`<ul>${routing.reasons.map(reason=>uiHtml`<li>${e(uiT(reason))}</li>`).join('')}</ul>`:''}`:getReviewPresentation(session).aiCount?uiHtml`<p>已保存的AI初判可逐项审核；人工确认后形成最终结果。</p>`:uiLiteral('<p>未执行的记录不计为审核完成。可从全部记录开始独立人工检查。</p>')}${returned?uiHtml`<p class="returned-review-note"><strong>退回原因</strong> ${e(returned.reason)}<br>${e(returned.reviewer)} · ${dateTime(returned.at)}</p>`:''}</div>`;
}

export function aiFinalFooter(session,ui){
  return uiHtml`<div class="results-footer ai-final-footer"><div class="human-status"><strong>最终结果来源</strong>${badge('已由AI判定','success')}</div><div class="human-caption">${session.reviewPolicy?.version===2?uiT('AI规则免审 · 已绑定独立验证标定'):uiT('AI通过 · 门槛 {0} · 内测未标定',{0:thresholdLabel(session)})}</div><div class="review-dock"><button class="btn" data-act="review-return" data-id="${e(session.id)}">标记可疑 → 退回人工</button><button class="btn primary" data-act="${ui.reviewScopeComplete?'show-completion':'next-session'}">${ui.reviewScopeComplete?uiT('查看审核汇总'):uiT('继续待审核')}${icon('arrow',14)}</button></div></div>`;
}
export function batchReturnControl(state,ui){
  const count=state.sessions.filter(session=>(!ui.reviewTaskId||session.taskId===ui.reviewTaskId)&&(!ui.reviewSceneFilter||session.scene===ui.reviewSceneFilter)&&isAIFinal(session)).length;
  return count?uiHtml`<button class="text-btn batch-return-control" data-act="review-return-batch">${uiT('按任务 / 规则标记可疑')}${icon('chevron',12)}</button>`:'';
}

function eligibleReturns(state,dialog){
  return state.sessions.filter(session=>isAIFinal(session)&&(!dialog.sessionIds||dialog.sessionIds.includes(session.id))&&(!dialog.taskId||session.taskId===dialog.taskId)&&(dialog.scope!=='rule'||dialog.ruleIds?.some(id=>session.expectedRuleIds?.includes(id))));
}
export function returnReviewDialog(dialog,state){
  if(dialog.type!=='return-ai')return null;
  const tasks=state.tasks.filter(task=>state.sessions.some(session=>session.taskId===task.id&&isAIFinal(session)));
  if(!dialog.sessionIds&&!dialog.taskId)dialog.taskId=tasks[0]?.id||'';
  const selected=dialog.sessionIds?.map(id=>state.sessions.find(session=>session.id===id)).filter(Boolean)||[],single=selected.length===1,task=state.tasks.find(task=>task.id===(dialog.taskId||selected[0]?.taskId));
  const scope=dialog.scope||'task',candidates=eligibleReturns(state,{...dialog,scope}),ruleOptions=task?getSessionRules(state,state.sessions.find(session=>session.taskId===task.id)||{}):[];
  const reviewer=dialog.reviewer??selected[0]?.review?.reviewer??state.sessions.find(session=>session.taskId===task?.id)?.review?.reviewer??'';
  return {typeClass:'wide',body:uiHtml`<header class="modal-head"><div><h2 id="dialog-title">标记可疑并退回人工</h2><p>保留原AI结论；提交后进入待人工审核，原因与操作人留痕。</p></div><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header><div class="modal-body"><div class="form-error" id="form-error"></div>${single?uiHtml`<p>${e(selected[0].externalId||selected[0].id)} · ${e(businessText(selected[0].topic))}</p>`:uiHtml`<div class="form-row"><div class="field-group"><label class="field-label" for="return-review-task">退回任务</label><select class="field" id="return-review-task">${tasks.map(item=>uiHtml`<option value="${e(item.id)}" ${item.id===dialog.taskId?'selected':''}>${e(businessText(item.name))}</option>`).join('')}</select></div><div class="field-group"><label class="field-label" for="return-review-scope">退回范围</label><select class="field" id="return-review-scope"><option value="task" ${scope==='task'?'selected':''}>任务中的AI已判定记录</option><option value="rule" ${scope==='rule'?'selected':''}>涉及所选规则的AI已判定记录</option></select></div></div>${scope==='rule'?uiHtml`<fieldset class="field-group return-rule-options"><legend>可疑规则（至少一项）</legend><div class="checks">${ruleOptions.map(rule=>uiHtml`<label><input type="checkbox" name="return-review-rule" value="${e(rule.id)}" ${dialog.ruleIds?.includes(rule.id)?'checked':''}><span>${e(ruleDisplayName(rule))}</span></label>`).join('')}</div></fieldset>`:''}`}<p class="return-review-count" aria-live="polite">${uiT('本次将退回 {0} 条AI已判定记录；同一会话只计一次。',{0:candidates.length})}</p><div class="field-group"><label class="field-label" for="return-review-reason">退回原因（必填）</label><textarea class="field" id="return-review-reason" rows="4" maxlength="2000" required placeholder="说明可疑之处，以及需要人工核对的依据。">${e(dialog.reason||'')}</textarea></div><div class="field-group"><label class="field-label" for="return-reviewer">操作人标签（必填）</label><input class="field" id="return-reviewer" value="${e(reviewer)}" maxlength="80" required><p class="hint">操作人标签用于本机操作记录，没有登录身份认证。</p></div><p class="hint">仅退回当前AI终判通过的记录；已由人工确认的结果保持人工结论优先。</p></div><footer class="modal-footer"><small>原AI结论和退回历史均保留</small><div><button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-act="review-return-submit" ${candidates.length?'':'disabled'}>提交并进入人工审核</button></div></footer>`};
}

export function createReviewRoutingController({getState,getUI,getDialog,getRoot=()=>globalThis.document.getElementById('overlay-root'),openDialog,closeDialog,commit,render,renderDialog,navigate,selectSession,now=()=>new Date().toISOString()}){
  function captureForm(dialog){
    const root=getRoot();
    dialog.reason=root.querySelector('#return-review-reason')?.value??dialog.reason;
    dialog.reviewer=root.querySelector('#return-reviewer')?.value??dialog.reviewer;
    const rules=[...root.querySelectorAll('[name="return-review-rule"]')];
    if(rules.length)dialog.ruleIds=rules.filter(input=>input.checked).map(input=>input.value);
  }
  return {
    handleChange(event){
      const dialog=getDialog(),target=event.target;
      if(dialog?.type==='new-task'&&['triage-mode','triage-enabled','triage-threshold'].includes(target.id)){dialog.reviewPolicy=readTriagePolicy(getRoot(),dialog.reviewPolicy);if(target.id==='triage-mode')renderDialog();return true;}
      if(dialog?.type!=='return-ai'||!['return-review-task','return-review-scope'].includes(target.id)&&target.name!=='return-review-rule')return false;
      captureForm(dialog);
      if(target.id==='return-review-task'){dialog.taskId=target.value;dialog.ruleIds=[];}
      if(target.id==='return-review-scope')dialog.scope=target.value;
      if(target.name==='return-review-rule'){
        const count=eligibleReturns(getState(),dialog).length,root=getRoot(),summary=root.querySelector('.return-review-count'),submit=root.querySelector('[data-act="review-return-submit"]');
        if(summary)summary.textContent=uiT('本次将退回 {0} 条AI已判定记录；同一会话只计一次。',{0:count});
        if(submit)submit.disabled=!count;
        return true;
      }
      renderDialog();return true;
    },
    async handleAction(action,button){
      const state=getState(),ui=getUI();
      if(action==='toggle-review-breakdown'){
        const container=button.closest('[data-review-breakdown]'),open=container.dataset.open!=='true';container.dataset.open=String(open);button.setAttribute('aria-expanded',String(open));return true;
      }
      if(['review-breakdown-task','review-breakdown-scene'].includes(action)){
        Object.assign(ui,{reviewTaskId:action==='review-breakdown-task'?button.dataset.id:'',reviewSceneFilter:action==='review-breakdown-scene'?button.dataset.scene:'',reviewStatus:'待确认',reviewQuery:'',selectedId:'',showReviewRecords:true});navigate();return true;
      }
      if(action==='view-review-records'){Object.assign(ui,{showReviewRecords:true,reviewStatus:'全部',reviewQuery:''});render();return true;}
      if(action==='review-return'){openDialog({type:'return-ai',sessionIds:[button.dataset.id||ui.selectedId]});return true;}
      if(action==='review-return-batch'){openDialog({type:'return-ai',scope:'task',taskId:ui.reviewTaskId||''});return true;}
      if(action!=='review-return-submit')return false;
      const dialog=getDialog();if(dialog?.type!=='return-ai')return true;
      captureForm(dialog);
      if(!dialog.reason?.trim())throw new Error('请填写退回人工的原因（不超过2000字符）。');
      if(!dialog.reviewer?.trim())throw new Error('请填写操作人标签。');
      if(dialog.scope==='rule'&&!dialog.ruleIds?.length)throw new Error('请选择规则范围。');
      const candidates=eligibleReturns(state,dialog),selected=candidates[0];
      const options={...(dialog.sessionIds?{sessionIds:[...dialog.sessionIds]}:{taskId:dialog.taskId}),candidateSessionIds:candidates.map(session=>session.id),...(dialog.scope==='rule'?{ruleIds:[...dialog.ruleIds]}:{}),reason:dialog.reason,reviewer:dialog.reviewer,now:now()};
      await commit(latest=>returnToHumanReview(latest,options),'已标记可疑并退回人工，原AI结论保留',{reviewSessionIds:candidates.map(session=>session.id)});
      closeDialog();Object.assign(ui,{reviewTaskId:selected?.taskId||dialog.taskId||'',reviewSceneFilter:'',reviewStatus:'待确认',reviewQuery:'',showReviewRecords:true});
      if(selected)selectSession(selected.id,false);navigate();return true;
    },
  };
}
