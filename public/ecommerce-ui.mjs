import {d as businessText,businessContent,translationControls} from './content-translation-ui.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import { ecommerceComparison, referenceVerdict, taskPhaseLabel, ecommerceTimeFacts, ecommerceTimeFactLabel } from './ecommerce-results.mjs';
import { e } from './ui.mjs';
import {uiLabel} from './i18n.mjs';

const RULE_NAMES = { 'EC-TIME': '回复时效', 'EC-TEXT': '文本质量', 'EC-TARGET': '针对性及批次重复', 'EC-STEPS': '操作步骤结构', 'EC-PRIVACY': '公开回复隐私' };
// Original reference cells and reply evidence never enter the UI dictionary.
const cell = value => uiHtml`<td style="white-space:pre-wrap;overflow-wrap:anywhere">${e(value)}</td>`;
const uiCell=value=>cell(uiLabel(value));

/** Original spreadsheet answers are a comparison reference, never model input or a final review. */
export function ecommerceReferenceView(session, state) {
  if (!session?.ecommerce||session.ecommerce.schemaVersion===6) return '';
  const source = session.ecommerce, review = session.review || {};
  const safeSession = { ...session, aiResults: session.aiResults || [], review: { ...review, drafts: review.drafts || {} } };
  const rows = ecommerceComparison(safeSession), confirmed = review.status === '已确认';
  const phase=taskPhaseLabel(state?.tasks?.find(task=>task.id===session.taskId)),facts=phase&&ecommerceTimeFacts(session),factConfirmed=confirmed&&review.disposition==='unreplied';
  const aiLabel=row=>facts&&row.ruleId==='EC-TIME'?`本地时效 · ${facts.replyStatus==='replied'?row.aiVerdict:ecommerceTimeFactLabel(session)}`:facts?.replyStatus==='unreplied'?'未取得内容判断':row.aiVerdict||'AI未执行';
  const finalLabel=row=>!confirmed?'未确认':factConfirmed?row.ruleId==='EC-TIME'?'未回复事实已确认':'未取得质量判断':row.finalVerdict||'未记录';
  const raw = source.raw || [];
  const overall = referenceVerdict(raw[20]);
  return uiHtml`<details class="input-transcript ecommerce-reference"><summary>原人工参考 / AI / 本次人工最终对照</summary>
    <p class="tiny muted">来源 ${e(source.sheet)} · 第${e(source.row)}行。${phase?uiT(`${e(uiT(phase))}；实际时效模式、分类阈值与截止点见本地时效计算。`):uiT(`测试阈值${e(source.thresholdHours)}小时，按北京时间连续自然时间计时；`)}批次重复仅核对本次导入批次内同一管理员至少3条相同或高度相似回复。</p>
    <div class="table-wrap"><table aria-label="电商五项结论对照"><thead><tr><th>检查项</th><th>原人工参考</th><th>${phase?uiT('本地时效 / AI初判'):uiT('AI初判')}</th><th>本次人工最终</th><th>${phase?uiT('本次结果与原参考'):uiT('AI与原参考')}</th></tr></thead><tbody>${rows.map(row => uiHtml`<tr>${uiCell(RULE_NAMES[row.ruleId] || row.ruleId)}${cell(row.referenceRaw ? `${row.referenceRaw}${row.referenceVerdict ? ` (${uiT(row.referenceVerdict)})` : uiT('（无有效参考）')}` : '未填写')}${uiCell(aiLabel(row))}<td data-column="final">${e(uiLabel(finalLabel(row)))}</td>${uiCell(facts?.replyStatus==='unreplied'?'业务事实单列；无质量对照':row.agreement)}</tr>`).join('')}</tbody></table></div>
    <p><strong>原整体结果：</strong>${e(raw[20] || uiT('未填写'))}${overall ? `（${e(uiT(overall))}）` : ''}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere"><strong>原问题说明：</strong>${e(raw[21] || uiT('未填写'))}</p><p class="hint">原人工参考按旧口径保留原值，规则版本与时点未核实；差异不等同于AI错误或准确率。本次人工审核确认后才展示最终结论。</p></details>`;
}

/** Resolve every peer against actual saved sessions; do not invent missing IDs or source rows. */
export function ecommerceBatchEvidence(state, result) {
  const groups = result?.batchEvidence;
  if (!Array.isArray(groups) || !groups.length) return '';
  const sessions = new Map((state?.sessions || []).map(session => [session.id, session]));
  let incomplete = false;
  const body = groups.map(group => {
    const ids = Array.isArray(group?.sessionIds) ? [...new Set(group.sessionIds.filter(id => typeof id === 'string' && id))] : [];
    const peers = ids.map(id => sessions.get(id));
    if (ids.length < 3 || peers.some(peer => !peer?.ecommerce || !Array.isArray(peer.ecommerce.raw)) || !['exact', 'similar'].includes(group.kind)) { incomplete = true; return ''; }
    return uiHtml`<section class="policy-section"><h4>${group.kind === 'exact' ? uiT('完全相同回复') : uiT('高度相似回复')} · ${peers.length}条实际记录</h4><p style="white-space:pre-wrap;overflow-wrap:anywhere">${businessContent(group.reason || '')}</p><div class="table-wrap"><table aria-label="批次重复原文证据"><thead><tr><th>记录ID</th><th>来源</th><th>管理员</th><th>实际回复</th></tr></thead><tbody>${peers.map(peer => uiHtml`<tr>${cell(peer.id)}${uiCell(`${peer.ecommerce.sheet} · 第${peer.ecommerce.row}行`)}${cell(peer.ecommerce.raw[11] || '未填写')}${cell(peer.ecommerce.raw[9] || '无回复原文')}</tr>`).join('')}</tbody></table></div></section>`;
  }).join('');
  return uiHtml`<details class="input-transcript ecommerce-batch-evidence"><summary>批次重复证据</summary>${body}${result.semanticReason?uiHtml`<details><summary>原模型语义理由</summary><p style="white-space:pre-wrap">${e(result.semanticReason)}</p></details>`:''}${incomplete ? uiLiteral('<p class="hint">部分批次证据不完整，未找到完整的至少3条真实记录，请人工核对。</p>') : ''}</details>`;
}
