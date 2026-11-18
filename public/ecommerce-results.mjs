import {EC_RULE_IDS} from './ecommerce-schema.mjs';
import {getTaskBasis} from './task-basis.mjs';
import {isStageATimeBasis} from './ecommerce-time-results.mjs';
import {e,badge} from './ui.mjs';
export const STAGE_A_LABEL='V2.1-A（时效升级；其他四项V1）';
export const taskPhaseLabel=taskOrBasis=>isStageATimeBasis(taskOrBasis?.basisSnapshot||taskOrBasis)?STAGE_A_LABEL:'';
export const ecommerceTimeFacts=session=>session.aiExecution?.status==='completed'?session.aiResults?.find(result=>result.ruleId==='EC-TIME')?.timeFacts||null:null;
const replyLabels=new Map([['replied','已回复'],['unreplied','未回复'],['missing-time','时间缺失待补充'],['conflict','来源字段冲突'],['unknown','时间无效待核对']]);
const outcomeLabels=new Map([['pass','符合'],['fail','不符合'],['unreplied','未回复'],['undetermined','无法判定']]);
export const ecommerceTimeFactLabel=session=>replyLabels.get(ecommerceTimeFacts(session)?.replyStatus)||'';
const modeLabel=mode=>mode==='workingHours'?'累计工作小时':mode==='continuous'?'连续自然小时':'尚未计算';
export function ecommerceTimeExportFields(state,session){
  const basis=getTaskBasis(state,session);
  if(!isStageATimeBasis(basis))return{};
  const config=basis.ruleSetSnapshot,facts=ecommerceTimeFacts(session),timeRule=config.timeRule;
  return {
    '阶段口径':STAGE_A_LABEL,'时效规则集':config.ruleSetId,'时效规则集版本':config.version,
    '回复事实':ecommerceTimeFactLabel(session)||'尚未计算','时效结果':outcomeLabels.get(facts?.outcome)||'尚未计算',
    '时效计算模式':modeLabel(facts?.mode||timeRule.mode),'检核截止点':facts?.inspectionAt||'',
    '时效起点':facts?.startAt||'','时效终点':facts?.endAt||'',
    '累计时长毫秒':facts?.elapsedMs??'','累计时长小时':typeof facts?.elapsedMs==='number'?facts.elapsedMs/3600000:'',
    '时效阈值小时':facts?.thresholdHours??'','阈值来源':facts?facts.thresholdSource==='byType'?'分类阈值':'规则集默认阈值':'尚未计算',
    '时效评价类型':facts?.evaluationType||'未填写','评价类型来源':'原O列','时效时区':facts?.calendarTimezone||timeRule.calendar?.timezone||'',
    '日历核对状态':config.calendarConfirmed?'日历已业务核对':'日历尚未业务核对，按当前配置试算',
    '时效说明':facts?.reason||'尚未取得本地时效计算结果',
    '人工确认类型':session.review.status!=='已确认'?'尚未确认':session.review.disposition==='unreplied'?'未回复事实已确认':'质量结果已确认',
    '时效冻结配置':JSON.stringify(config),
  };
}
export function ecommerceTimeEvidenceView(state,session){
  const cells=ecommerceTimeExportFields(state,session);
  if(!Object.keys(cells).length)return'';
  const facts=ecommerceTimeFacts(session),calendar=getTaskBasis(state,session).ruleSetSnapshot.timeRule.calendar;
  const rows=[['阶段口径',cells['阶段口径']],['规则集',`${cells['时效规则集']} · ${cells['时效规则集版本']}`],['累计口径',`${cells['时效计算模式']} · ${cells['时效时区']}`],['检核截止点',cells['检核截止点']||'尚未计算'],['起止时间',`${cells['时效起点']||'缺失'} → ${cells['时效终点']||'缺失'}`],['累计时长',typeof facts?.elapsedMs==='number'?`${cells['累计时长小时']} 小时（${facts.elapsedMs} 毫秒）`:'未取得有效累计值'],['阈值及来源',facts?`${facts.thresholdHours} 小时 · ${cells['阈值来源']}`:'尚未计算'],['评价类型',`${cells['时效评价类型']} · 原O列`],['工作日历',`${Array.isArray(calendar.workdays)?calendar.workdays.join('、'):calendar.workdays} · ${calendar.workStart}—${calendar.workEnd}；假期 ${(calendar.holidays||[]).length} 天，补班 ${(calendar.workingDates||[]).length} 天`],['日历状态',cells['日历核对状态']]];
  return `<section class="context-fields time-evidence" data-time-status="${e(facts?.replyStatus||'not-run')}" aria-label="本地时效计算"><h3>本地时效计算 ${badge(cells['回复事实'],facts?.replyStatus==='replied'&&facts?.outcome==='pass'?'success':'warning')}</h3><dl class="detail-grid">${rows.map(([label,value])=>`<dt>${e(label)}</dt><dd>${e(value)}</dd>`).join('')}</dl>${facts?.replyStatus==='unreplied'?'<p class="hint">未回复事实不等于质量通过或不通过；人工只确认来源中的回复正文与首次回复时间均为空。</p>':''}<details class="input-transcript"><summary>查看冻结时效配置</summary><pre>${e(JSON.stringify(getTaskBasis(state,session).ruleSetSnapshot,null,2))}</pre></details></section>`;
}
export const referenceVerdict=raw=>typeof raw!=='string'?'':raw.trim().toLowerCase()==='pass'?'符合':raw.trim().toLowerCase()==='fail'?'不符合':'';
export function ecommerceComparison(session){
  if(!session.ecommerce)return[];
  return EC_RULE_IDS.map((ruleId,index)=>{
    const referenceRaw=session.ecommerce.raw[15+index],reference=referenceVerdict(referenceRaw);
    const ai=session.aiExecution?.status==='completed'?session.aiResults.find(r=>r.ruleId===ruleId):null;
    const final=session.review.status==='已确认'?session.review.drafts[ruleId]:null;
    return{ruleId,referenceRaw,referenceVerdict:reference,aiVerdict:ai?.verdict||'',finalVerdict:final?.verdict||'',
      agreement:!reference?'无有效参考':!ai?'AI未执行':!['符合','不符合'].includes(ai.verdict)?'AI待判定':ai.verdict===reference?'一致':'不一致'};
  });
}
