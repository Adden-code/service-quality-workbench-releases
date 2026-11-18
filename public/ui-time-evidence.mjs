import {e,badge} from './ui.mjs';
import {getLocale,t} from './i18n.mjs';
import {ecommerceTimeExportFields,ecommerceTimeFacts,ecommerceTimeEvidenceView as originalView} from './ecommerce-results.mjs';
import {getTaskBasis} from './task-basis.mjs';
/** Display adapter only. Timing facts, formulas and original export fields are
 * read from the existing domain module and are never recalculated here. */
export function ecommerceTimeEvidenceView(state,session){
  if(getLocale()!=='en')return originalView(state,session);
  const cells=ecommerceTimeExportFields(state,session);if(!Object.keys(cells).length)return '';
  const facts=ecommerceTimeFacts(session),config=getTaskBasis(state,session).ruleSetSnapshot,calendar=config.timeRule.calendar;
  const missing='Missing',notCalculated='Not calculated';
  const reply={replied:'Replied',unreplied:'Unreplied','missing-time':'Missing reply time',conflict:'Source field conflict',unknown:'Invalid time; verify'}[facts?.replyStatus]||notCalculated;
  const rows=[['Pilot definitions','V2.1-A (timing upgrade; other four checks use V1)'],['Rule set',`${cells['时效规则集']} · ${cells['时效规则集版本']}`],['Timing mode',`${t(cells['时效计算模式'])} · ${cells['时效时区']}`],['Inspection cutoff',cells['检核截止点']||notCalculated],['Start → end',`${cells['时效起点']||missing} → ${cells['时效终点']||missing}`],['Accumulated duration',typeof facts?.elapsedMs==='number'?`${cells['累计时长小时']} hours (${facts.elapsedMs} ms)`:'No valid accumulated value'],['Threshold and source',facts?`${facts.thresholdHours} hours · ${facts.thresholdSource==='byType'?'Type threshold':'Rule set default threshold'}`:notCalculated],['Rating type',`${t(cells['时效评价类型'])} · Original column O${cells['时效评价类型']&&t(cells['时效评价类型'])!==cells['时效评价类型']?` · Original: ${cells['时效评价类型']}`:''}`],['Working calendar',`${Array.isArray(calendar.workdays)?calendar.workdays.join(', '):calendar.workdays} · ${calendar.workStart}—${calendar.workEnd}; ${(calendar.holidays||[]).length} holidays, ${(calendar.workingDates||[]).length} makeup days`],['Calendar verification',config.calendarConfirmed?'Calendar verified by business owner':'Unverified calendar; calculation uses current configuration']];
  return `<section class="context-fields time-evidence" data-time-status="${e(facts?.replyStatus||'not-run')}" aria-label="Local timing calculation"><h3>Local timing calculation ${badge(reply,facts?.replyStatus==='replied'&&facts?.outcome==='pass'?'success':'warning')}</h3><dl class="detail-grid">${rows.map(([label,value])=>`<dt>${e(label)}</dt><dd>${e(value)}</dd>`).join('')}</dl>${facts?.replyStatus==='unreplied'?'<p class="hint">Unreplied is a source fact, not a quality Pass or Fail. Human confirmation only verifies that original reply content and first-reply time are empty.</p>':''}<details class="input-transcript"><summary>Original frozen timing configuration</summary><pre>${e(JSON.stringify(config,null,2))}</pre></details></section>`;
}
