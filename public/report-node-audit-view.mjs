import {escapeHTML as e} from './ui.mjs';

const valueText=value=>value===undefined?'undefined':JSON.stringify(value);
export function reportNodeAuditView(detail,english=false){
  const t=(zh,en)=>english?en:zh,attempts=detail?.attempts?.length?detail.attempts:[{output:detail?.output}],changes=[],matches=[];
  for(const [index,attempt]of attempts.entries()){
    const number=attempt.attempt??index+1,coercion=attempt.coercion||attempt.output?.coercion,evidence=attempt.evidenceValidation||attempt.output?.evidenceValidation;
    for(const change of coercion?.changes||[])changes.push({...change,attempt:number});
    for(const match of evidence?.matches||[])if(match.normalization==='NFC')matches.push({...match,attempt:number});
  }
  if(!changes.length&&!matches.length)return'';
  const reason=code=>({numeric_string_to_integer:t('数值字符串转为整数','Numeric string converted to integer'),boolean_string_to_boolean:t('布尔字符串转为布尔值','Boolean string converted to boolean')})[code]||code||'';
  return `<section class="bd-node-audit" aria-label="${t('节点归一与引文核验','Node normalization and quote validation')}">${changes.length?`<h4>${t('类型归一记录','Type normalization records')}</h4><p class="hint">${t('仅转换可明确识别的字段类型，原值和转换后值均保留。引号表示字符串。','Only unambiguous field types are converted. Original and converted values are retained. Quotation marks indicate strings.')}</p><div class="bd-history-scroll"><table class="bd-history-table"><thead><tr>${[t('尝试 / 记录','Attempt / item'),t('字段','Field'),t('原值','Original value'),t('转换后值','Converted value'),t('原因','Reason')].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${changes.map(change=>`<tr><td>${e(change.attempt)}${change.itemId?`<small>${e(change.itemId)}</small>`:''}</td><td>${e(change.field)}</td><td><code>${e(valueText(change.before))}</code></td><td><code>${e(valueText(change.after))}</code></td><td>${e(reason(change.reasonCode))}</td></tr>`).join('')}</tbody></table></div>`:''}${matches.length?`<h4>${t('NFC 引文核验','NFC quote validation')}</h4><p class="hint">${t('以下引文在 Unicode NFC 规范化后与来源匹配。核验只消除等价字符的编码差异，未改写原文、空格、标点或引文。','These quotations matched their source after Unicode NFC normalization. Validation only compares canonically equivalent character encodings; source text, spaces, punctuation and saved quotations are unchanged.')}</p><ul class="bd-audit-quotes">${matches.map(match=>`<li><b>${t('尝试','Attempt')} ${e(match.attempt)} · ${e(match.field)}</b>${match.itemId?` <span>${e(match.itemId)}</span>`:''}<blockquote>${e(match.rawQuote)}${match.quotePreview?`… ${t("（预览；完整引文保存在节点输出）","(preview; full quotation retained in node output)")}`:""}</blockquote></li>`).join('')}</ul>`:''}</section>`;
}
