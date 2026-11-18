import {html as uiHtml,t as uiT} from './i18n.mjs';
import {e} from './ui.mjs';
import {ruleKindOf,detectRuleKind} from './rule-kind.mjs';
import {ruleCategoryOptions} from './rule-entry.mjs';

export function ruleKindField(id,rule={},attrs=''){
  const kind=ruleKindOf(rule);
  return uiHtml`<div class="field-group"><label class="field-label" for="${e(id)}">规则作用域类型</label><select class="field" id="${e(id)}" ${attrs}><option value="session-check" ${kind==='session-check'?'selected':''}>会话检核</option><option value="meta" ${kind==='meta'?'selected':''}>交付物要求</option></select>${detectRuleKind(rule)==='meta'?uiHtml`<p class="hint">检测到报告结构或导出要求，请核对作用域类型；交付物要求不参加会话检核。</p>`:''}</div>`;
}

export function ruleCategoryField(id,value,catalog,scenes,state={},attrs=''){
  const options=ruleCategoryOptions(catalog,scenes,state);
  return uiHtml`<div class="field-group"><label class="field-label" for="${e(id)}">类别</label><select class="field" id="${e(id)}" ${attrs}><option value="">请选择类别</option>${options.map(category=>uiHtml`<option value="${e(category)}" ${value===category?'selected':''}>${e(uiT(category))}</option>`).join('')}</select></div>`;
}
