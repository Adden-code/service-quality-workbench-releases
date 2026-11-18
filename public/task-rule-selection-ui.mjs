import {html as uiHtml,uiLiteral,t as uiT,translateError} from './i18n.mjs';
import {d as businessText} from './content-translation-ui.mjs';
import {e} from './ui.mjs';
import {rawTimeRuleIds} from './raw-evidence.mjs';
import {ruleAdvisory} from './rule-advisory.mjs';
import {isSessionCheckRule} from './rule-kind.mjs';

export function taskTimeRuleNotice(dialog) {
  if (!dialog.parsed?.rawDirect || dialog.rawImportOptions?.timePolicy?.mode !== 'unavailable') return '';
  const rules = dialog.basisSnapshot?.rules || [];
  const timeIds = new Set(rawTimeRuleIds({rules}));
  const timeRules = rules.filter(rule => timeIds.has(rule.id));
  return uiHtml`<div class="soft-note warning"><p>本批无可靠时间戳，时间依赖检查项会显示无法判定并转人工。</p>${timeRules.length?uiHtml`<p>${uiT('受影响的时间类规则')}：${timeRules.map(rule=>e(businessText(rule.title||rule.name))).join('；')}</p>`:''}</div>`;
}

export function taskBasisSummary(snapshot){
  return uiHtml`<h3>本次绑定依据</h3>${snapshot?uiHtml`<p>${snapshot.rules.length}项规则 · ${snapshot.policies.length}份资料</p>${snapshot.policies.map(policy=>uiHtml`<div><strong>${e(businessText(policy.title))}</strong><span>${e(policy.version)} · 生效 ${e(policy.effectiveAt)}</span></div>`).join('')||uiLiteral('<p class="tiny muted">所选规则不依赖额外资料。</p>')}`:uiLiteral('<p class="tiny muted">选择检查项后显示实际采用的资料版本。</p>')}`;
}

export function taskRuleList(dialog,availability,emptyNote=''){
  const candidates=[...(availability.rules||[]),...(availability.metaRules||[])],seen=new Set();
  const all=candidates.filter(rule=>{const key=JSON.stringify([rule.id,rule.version]);if(seen.has(key))return false;seen.add(key);return true;}),rules=all.filter(isSessionCheckRule),meta=all.filter(rule=>!isSessionCheckRule(rule));
  const row=(rule,disabled=false)=>uiHtml`<label><input type="checkbox" name="task-rule" value="${e(rule.id)}" ${disabled?'disabled':(dialog.ruleIds||[]).includes(rule.id)?'checked':''}><span><strong>${e(businessText(rule.title))}</strong> ${e(rule.version)}<br>${e(businessText(rule.scope))}${!disabled&&ruleAdvisory(rule)?uiHtml`<span class="soft-note warning" data-rule-advisory>${e(ruleAdvisory(rule))}</span>`:''}</span></label>`;
  return uiHtml`${meta.length?uiHtml`<label class="task-meta-toggle"><input type="checkbox" id="task-show-all-rules" ${dialog.showAllTaskRules?'checked':''}>显示全部（含交付物要求）</label><p class="hint">交付物要求保留在目录中，不参加会话检核；如需改标，请前往规则管理。</p>`:''}<div class="checks task-rule-list" data-task-rule-list>${rules.length?`${meta.length?uiHtml`<h3 class="task-rule-group">会话检核</h3>`:''}${rules.map(rule=>row(rule)).join('')}`:emptyNote}${dialog.showAllTaskRules&&meta.length?uiHtml`<h3 class="task-rule-group">交付物要求 · 不参与本任务</h3>${meta.map(rule=>row(rule,true)).join('')}`:''}</div>`;
}

const inputsFor=root=>[...root.querySelectorAll('[name="task-rule"]')];
const isPicker=dialog=>dialog?.type==='new-task'&&dialog.mode==='manual'&&dialog.step===3;

export function updateTaskRuleSelection(root,dialog){
  const inputs=inputsFor(root),selected=new Set(dialog.ruleIds||[]);
  // Keep the list and its checkbox nodes intact: keyboard focus, scroll and
  // pointer position belong to this list, not to the derived basis summary.
  for(const input of inputs)input.checked=!input.disabled&&selected.has(input.value);
  const summary=root.querySelector('[data-task-basis-summary]');if(summary)summary.innerHTML=taskBasisSummary(dialog.basisSnapshot);
  const timing=root.querySelector('[data-task-time-notice]');if(timing)timing.innerHTML=taskTimeRuleNotice(dialog);
  const error=root.querySelector('#form-error');if(error)error.textContent=translateError(dialog.error||'');
  for(const create of root.querySelectorAll('[data-act="create-business-task"],[data-act="create-business-task-start"]'))create.disabled=!dialog.basisSnapshot;
  const count=root.querySelector('[data-task-rule-count]');if(count)count.textContent=uiT('已选 {0}/{1} 项',{0:inputs.filter(input=>input.checked&&!input.disabled).length,1:inputs.filter(input=>!input.disabled).length});
}

export function captureTaskRuleViewport(root){
  const active=root.ownerDocument?.activeElement;
  return {scrolls:['.modal-body','[data-task-rule-list]'].map(selector=>{const element=root.querySelector(selector);return {selector,top:element?.scrollTop||0,left:element?.scrollLeft||0};}),
    focus:active&&root.contains(active)?{id:active.id,name:active.name,value:active.value,selectionStart:active.selectionStart,selectionEnd:active.selectionEnd}:null};
}
export function restoreTaskRuleViewport(root,snapshot){
  if(!snapshot)return;
  const saved=snapshot.focus;
  if(saved){
    const target=saved.id?[...root.querySelectorAll('[id]')].find(element=>element.id===saved.id):[...root.querySelectorAll('[name]')].find(element=>element.name===saved.name&&element.value===saved.value);
    target?.focus({preventScroll:true});
    if(typeof saved.selectionStart==='number'&&target?.setSelectionRange)try{target.setSelectionRange(saved.selectionStart,saved.selectionEnd);}catch{}
  }
  for(const saved of snapshot.scrolls){const element=root.querySelector(saved.selector);if(element){element.scrollTop=saved.top;element.scrollLeft=saved.left;}}
}

export function handleTaskRuleSelectionChange(event,{dialog,root,refreshBasis,renderDialog}){
  if(isPicker(dialog)&&event.target.id==='task-show-all-rules'){const viewport=captureTaskRuleViewport(root);dialog.showAllTaskRules=event.target.checked;renderDialog();restoreTaskRuleViewport(root,viewport);return true;}
  if(!isPicker(dialog)||!(event.target.id==='basis-date'||event.target.name==='task-rule'))return false;
  const changingDate=event.target.id==='basis-date',viewport=changingDate?captureTaskRuleViewport(root):null;
  dialog.effectiveDate=root.querySelector('#basis-date')?.value||dialog.effectiveDate;
  dialog.ruleIds=inputsFor(root).filter(input=>input.checked&&!input.disabled).map(input=>input.value);
  refreshBasis();
  if(changingDate){renderDialog();restoreTaskRuleViewport(root,viewport);}
  else updateTaskRuleSelection(root,dialog);
  return true;
}

export function handleTaskRuleSelectionAction(action,{dialog,root,refreshBasis}){
  if(!isPicker(dialog)||!['select-all-task-rules','clear-task-rules'].includes(action))return false;
  dialog.ruleIds=action==='select-all-task-rules'?inputsFor(root).filter(input=>!input.disabled).map(input=>input.value):[];
  refreshBasis();updateTaskRuleSelection(root,dialog);return true;
}
