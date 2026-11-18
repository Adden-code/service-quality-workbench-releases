import {appendEvidenceSheets} from './evidence-audit.mjs';
import {classificationReviewed} from './ecommerce-classification-review.mjs';
import {isBusinessEcommerceBasis,businessEvaluationType} from './ecommerce-business-profile.mjs';
import {sceneDeliverySnapshot,configuredDelivery,buildSceneDeliveryXlsx} from './scene-delivery.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';
import {EC_RULE_IDS,ecommerceTimeValues,validateEcommerceRecord,validateEcommerceSources} from './ecommerce-schema.mjs';
import {ecommerceDeliverySource,ecommerceSourceMappingRows} from './ecommerce-delivery-source.mjs';
import {hasCompletedAI} from './domain.mjs';
import {getTaskBasis} from './task-basis.mjs';
import {isStageATimeBasis} from './ecommerce-time-results.mjs';
import {workbook,excelSafeSheets} from './io.mjs';
import {createConsultationDeliverySnapshot,buildConsultationDeliveryXlsx,isConsultationTask} from './consultation-delivery.mjs';
import {buildEnglishDeliveryXlsx,englishDeliveryHeaders} from './report-english-delivery.mjs';
import {reusableEnglishBaseTranslation} from './translation-language.mjs';
import {assertRoleEvidenceSupport} from './role-evidence.mjs';
import {freezeReviewRouting,triageConclusionPolicy,triageMetrics,pendingHumanResult,resultProvenanceSheet} from './triage-export.mjs';
import {normalizeReviewPolicy} from './ai-triage.mjs';
import {isVoidedTask} from './task-lifecycle.mjs';

export const BUSINESS_RULES=Object.freeze([
  {id:'EC-TIME',label:'回复时效',shortLabel:'时效',improvement:'明确回复时限和责任人，跟踪未回复及临近超时记录，按适用工作日历及时响应。'},
  {id:'EC-TEXT',label:'文本质量',shortLabel:'文本',improvement:'发送前核对拼写、语法、标点及语义，清楚描述问题和处理动作。'},
  {id:'EC-TARGET',label:'针对性及批次重复',shortLabel:'针对性',improvement:'逐项回应用户的具体问题或评价，提供对应处理建议，避免同一客服批量套用模板。'},
  {id:'EC-STEPS',label:'操作步骤结构',shortLabel:'结构',improvement:'将需要用户执行的操作按顺序完整编号，每一步写清具体动作。'},
  {id:'EC-PRIVACY',label:'公开回复隐私',shortLabel:'隐私',improvement:'公开回复中移除可识别个人的信息，需要核对身份或订单时使用获准的私密渠道。'},
].map(rule=>Object.freeze(rule)));
const clone=value=>structuredClone(value);
const knownVerdicts=new Map([['pass','通过'],['通过','通过'],['符合','通过'],['fail','不通过'],['不通过','不通过'],['不符合','不通过'],['pending','待判定'],['待判定','待判定'],['无法判定','待判定'],['不适用','待判定'],['not applicable','待判定'],['unable to determine','待判定']]);
const normalized=value=>typeof value==='string'?knownVerdicts.get(value.trim().toLowerCase())??null:null;
const unique=values=>[...new Set(values.filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))];
const allSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const finalPolicy=mode=>mode==='ai'?'仅采用本任务完整AI初判':'工作台本次已确认逐项结果 > 原表历史人工结论 > AI初判';
const overall=(items,unreplied=false)=>unreplied?'未回复':items.some(item=>item.verdict==='不通过')?'不通过':items.every(item=>item.verdict==='通过')?'通过':'待判定';

/** Presentation only: change quantities explicitly labelled as durations, never arbitrary identifiers. */
export function formatBusinessReason(reason,{maxChars=70,record,ruleId}={}){
  if(!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>20000)throw new Error('摘要字符数须为1至20000的整数。');
  let value=String(reason??'').replace(/[\r\n\t]+/g,' ').trim();
  const time=record?.time,originalTime=record?.ai?.find(item=>item.id==='EC-TIME');
  if(ruleId==='EC-TIME'&&originalTime?.source==='ai'&&originalTime.reason.trim()&&originalTime.reason===String(reason??'')&&Number.isFinite(time?.elapsedMs)&&Number.isFinite(time?.thresholdHours))value=`${time.mode==='workingHours'?'累计工作':'连续自然'}时长${(time.elapsedMs/3600000).toFixed(1)}小时，阈值${time.thresholdHours.toFixed(1)}小时；${originalTime.verdict==='不通过'?'超过适用回复时限。':originalTime.verdict==='通过'?'未超过适用回复时限。':'结论仍待判定。'}`;
  value=value.replace(/[（(]\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?\s*(?:毫秒|ms)\s*[）)]/gi,'');
  value=value.replace(/\b(?:elapsedMs|durationMs)\s*[:=：]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)/gi,(_,number)=>`累计时长${(Number(number)/3600000).toFixed(1)}小时`);
  value=value.replace(/([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*(?:毫秒|\bms\b)/gi,(_,number)=>`${(Number(number)/3600000).toFixed(1)}小时`);
  value=value.replace(/(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(\s*(?:工作小时|小时|hours?\b|h\b))/gi,(_,number,unit)=>`${Number(number).toFixed(1)}${unit}`);
  const chars=Array.from(value);return chars.length>maxChars?chars.slice(0,Math.max(0,maxChars-1)).join('')+'…':value;
}

function item(rule,result,source,reason){
  const verdict=normalized(result?.verdict??result);
  return{id:rule.id,ruleId:rule.id,label:rule.label,verdict:verdict??'待判定',reason:String(reason??result?.reason??''),source:verdict?source:'none'};
}
function recordSnapshot(state,task,session,basis){
  const ec=session.ecommerce,raw=clone(ec.raw),hasReply=Boolean(raw[9].trim()),hasReplyTime=Boolean(raw[13].trim());
  const replyStatus=!hasReply&&!hasReplyTime?'unreplied':hasReply&&!hasReplyTime?'missing-time':!hasReply&&hasReplyTime?'conflict':'replied';
  const hasAI=session.aiExecution?.status==='completed'&&Array.isArray(session.aiResults)&&session.aiResults.length===5&&EC_RULE_IDS.every(id=>session.aiResults.some(result=>result.ruleId===id))&&hasCompletedAI(session);
  const ai=BUSINESS_RULES.map(rule=>item(rule,hasAI?session.aiResults.find(result=>result.ruleId===rule.id):null,'ai'));
  const historical=BUSINESS_RULES.map((rule,index)=>item(rule,raw[15+index],'historical',raw[21].trim()?`原表历史人工问题说明（未逐项拆分）：${raw[21]}`:'原表历史人工结论未附具体问题说明。'));
  const qualityConfirmed=session.review?.status==='已确认'&&session.review.disposition!=='unreplied';
  const confirmed=BUSINESS_RULES.map(rule=>item(rule,qualityConfirmed&&Object.hasOwn(session.review.drafts??{},rule.id)?session.review.drafts[rule.id]:null,'confirmed'));
  const savedTime=hasAI?session.aiResults.find(result=>result.ruleId==='EC-TIME')?.timeFacts:null;
  const matchingRun=[task.aiRun,...(task.aiRunHistory??[])].find(run=>run?.id===session.aiExecution?.runId);
  const inspectionAt=savedTime?.inspectionAt??matchingRun?.inspectionAt??'';
  const {commentTime,replyTime}=ecommerceTimeValues(ec),legacyDuration=commentTime&&replyTime&&Date.parse(replyTime)>=Date.parse(commentTime)?Date.parse(replyTime)-Date.parse(commentTime):null;
  const time={mode:isStageATimeBasis(basis)?basis.ruleSetSnapshot.timeRule.mode:'continuous',elapsedMs:savedTime&&Number.isFinite(savedTime.elapsedMs)?savedTime.elapsedMs:isStageATimeBasis(basis)?null:legacyDuration,thresholdHours:savedTime?.thresholdHours??(isStageATimeBasis(basis)?null:ec.thresholdHours),inspectionAt,timezone:savedTime?.calendarTimezone??'UTC+08:00'};
  const routing=freezeReviewRouting(session,task);
  return{id:session.id,sourceRow:ec.row,raw22:raw,...(routing?{routing}:{}),...([3,4,5].includes(ec.schemaVersion)?{extensionValues:clone(ec.extensions.raw)}:{}),evaluationType:isBusinessEcommerceBasis(basis)?(classificationReviewed(session)?session.review.classification.evaluationType:businessEvaluationType(session))||'未归类':raw[14].trim()||'未归类',replyStatus,hasAI,ai,historical,confirmed,final:[],aiOverall:overall(ai),historicalOverall:normalized(raw[20])??'待判定',finalOverall:'待判定',summary:'',humanIssue:raw[21],timeFacts:savedTime?clone(savedTime):null,inspectionAt,time};
}
function aggregate(records){
  const count=verdict=>records.filter(record=>record.finalOverall===verdict).length;
  const passed=count('通过'),failed=count('不通过'),determinate=passed+failed;
  const corrected=new Set(),confirmed=new Set(),historical=new Set(),differences=new Set();
  for(const record of records)if(record.hasAI){
    record.final.forEach((result,index)=>{if(['confirmed','historical'].includes(result.source)&&result.verdict!==record.ai[index].verdict){corrected.add(record.id);(result.source==='confirmed'?confirmed:historical).add(record.id);}});
    if(record.historical.some((result,index)=>result.source!=='none'&&result.verdict!==record.ai[index].verdict))differences.add(record.id);
  }
  const quality=records.filter(record=>record.replyStatus!=='unreplied');
  const stats=(kind,index)=>{
    const passed=quality.filter(record=>record[kind][index].verdict==='通过').length,failed=quality.filter(record=>record[kind][index].verdict==='不通过').length,denominator=passed+failed;
    return{passed,failed,pending:quality.length-denominator,denominator,passRate:denominator?Math.round(passed/denominator*1000)/10:null};
  };
  const types=['好评正向','好评负向','中评','差评','未归类'];
  return{total:records.length,passed,failed,pending:count('待判定'),unreplied:count('未回复'),determinate,passRate:determinate?Math.round(passed/determinate*1000)/10:null,correctedRecords:corrected.size,confirmedCorrections:confirmed.size,historicalCorrections:historical.size,historicalDifferenceRecords:differences.size,
    typeDistribution:types.map(type=>{const count=records.filter(record=>(types.includes(record.evaluationType)?record.evaluationType:'未归类')===type).length;return{type,label:type,count,percentage:records.length?Math.round(count/records.length*1000)/10:0};}),
    ruleStats:BUSINESS_RULES.map((rule,index)=>({id:rule.id,label:rule.label,shortLabel:rule.shortLabel,ai:stats('ai',index),final:stats('final',index)}))};
}

export function createBusinessDeliverySnapshot(state,{taskId,conclusionMode='combined',targetLang='zh',roleEvidenceMode,original,now=new Date().toISOString()}={}){
  if(isVoidedTask(state?.tasks?.find(task=>task.id===taskId)))throw new Error('作废任务仅供追溯，不能生成新交付物。');
  if(!['ai','combined'].includes(conclusionMode))throw new Error('结论口径须为AI初判或综合人工口径。');
  if(!['zh','en'].includes(targetLang))throw new Error('翻译目标语种须为中文或英文。');
  if(typeof now!=='string'||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(now)||!Number.isFinite(Date.parse(now)))throw new Error('生成时间须为带时区的有效时间。');
  const task=state?.tasks?.find(task=>task.id===taskId);if(!task||task.mode!=='manual')throw new Error('请选择一个已导入的业务任务。');
  if(isConsultationTask(state,task))return createConsultationDeliverySnapshot(state,{taskId,conclusionMode,targetLang,roleEvidenceMode,original,now});
  assertRoleEvidenceSupport({roleEvidenceMode});
  const sessions=state.sessions.filter(session=>session.taskId===taskId);if(!sessions.length||sessions.length>500||sessions.some(session=>!session.ecommerce))throw new Error('业务交付仅支持一个含1至500条电商原表记录的任务。');
  const first=sessions[0].ecommerce,seenRows=new Set(),seenIds=new Set();
  validateEcommerceSources(sessions.map(session=>session.ecommerce),task.source);
  for(const session of sessions){
    const r=session.ecommerce;validateEcommerceRecord(r);
    if(!allSame(r.headers,first.headers)||!allSame(r.standards,first.standards)||r.fileSha256!==first.fileSha256)throw new Error('同次业务交付的原文件、表头和标准行须完全一致。');
    if(seenRows.has(r.row)||seenIds.has(session.id)||typeof session.id!=='string'||!session.id)throw new Error('业务记录标识与原表物理行号须唯一，不能重复。');seenRows.add(r.row);seenIds.add(session.id);
  }
  if(task.source?.sha256&&task.source.sha256!==first.fileSha256)throw new Error('业务任务原文件摘要与行来源不一致。');
  const basis=getTaskBasis(state,task),records=sessions.map(session=>recordSnapshot(state,task,session,basis)).sort((a,b)=>a.sourceRow-b.sourceRow);
  for(const record of records){
    record.final=BUSINESS_RULES.map((_,index)=>clone(conclusionMode==='ai'?record.ai[index]:record.routing?record.confirmed[index].source!=='none'?record.confirmed[index]:record.routing.aiFinal||record.routing.exemptRuleIds?.includes(record.ai[index].id)?{...record.ai[index],source:'ai_final'}:pendingHumanResult(record.ai[index],record.routing):record.confirmed[index].source!=='none'?record.confirmed[index]:record.historical[index].source!=='none'?record.historical[index]:record.ai[index]));
    record.finalOverall=overall(record.final,!isBusinessEcommerceBasis(basis)&&record.replyStatus==='unreplied');
    record.summary=!isBusinessEcommerceBasis(basis)&&record.replyStatus==='unreplied'?'回复正文和首次回复时间均为空，未回复单列，不作为质量通过或不通过。':record.final.filter(result=>result.verdict==='不通过').map(result=>{
      const index=EC_RULE_IDS.indexOf(result.id),changed=record.hasAI&&['confirmed','historical'].includes(result.source)&&result.verdict!==record.ai[index].verdict;
      const source=result.source==='confirmed'?'本次确认':result.source==='historical'?'历史人工':'AI初判';
      return formatBusinessReason(`${changed?'人工纠正：':''}${result.label}（${source}）：${formatBusinessReason(result.reason||'未提供具体判定理由。',{record,ruleId:result.id,maxChars:20000})}`);
    }).join('；');
  }
  const config=isStageATimeBasis(basis)?basis.ruleSetSnapshot:null;
  const summary={effectiveDate:basis.effectiveDate??'',capturedAt:basis.capturedAt??'',phaseLabel:config?'V2.1-A（时效升级；其他四项V1）':'Sheet4 V1（连续自然计时）',ruleSetId:config?.ruleSetId??'Sheet4',ruleSetVersion:config?.version??(basis.rules?.find(rule=>rule.id==='EC-TIME')?.version??'V1.0'),ruleVersions:BUSINESS_RULES.map(rule=>({id:rule.id,label:rule.label,version:basis.rules?.find(item=>item.id===rule.id)?.version??''})),timeMode:config?.timeRule.mode??'continuous',timeModeLabel:config?.timeRule.mode==='workingHours'?'累计工作小时':'连续自然小时',timeThresholds:config?clone(config.timeRule.thresholds):{default:new Set(sessions.map(session=>session.ecommerce.thresholdHours)).size===1?first.thresholdHours:null,byType:{},byRecord:sessions.map(session=>({sourceRow:session.ecommerce.row,hours:session.ecommerce.thresholdHours})).sort((a,b)=>a.sourceRow-b.sourceRow)},timezone:config?.timeRule.calendar?.timezone??'UTC+08:00',calendarConfirmed:config?.calendarConfirmed??null,calendar:config?clone(config.timeRule.calendar):null,inspectionAts:unique(records.map(record=>record.inspectionAt)),historicalPolicy:'原表历史人工结论（可能为旧口径）',finalPolicy:finalPolicy(conclusionMode),samplingPeriods:unique(records.map(record=>record.raw22[1])),regionGroups:unique(records.map(record=>record.raw22[0])),regions:unique(records.map(record=>record.raw22[2])),countries:unique(records.map(record=>record.raw22[3]))};
  if(isBusinessEcommerceBasis(basis))Object.assign(summary,{phaseLabel:'内置电商口径 ec-business-v1',executionProfile:'ec-business-v1',timeMode:'workingHours',timeModeLabel:'按站点累计工作小时',timeThresholds:clone(task.executionSnapshot?.runtime.timingStandards??basis.businessProfile.timing.standards),timezone:'按站点冻结配置',calendar:clone(basis.businessProfile.timing.sites),calendarConfirmed:basis.businessProfile.timing.status==='ready'});
  const policy=task.reviewPolicy!==undefined?normalizeReviewPolicy(task.reviewPolicy):sessions.some(session=>isProcessedUnknown(session)||session.review?.resolutionHistory?.length)?normalizeReviewPolicy({enabled:false}):null;if(policy)summary.finalPolicy=triageConclusionPolicy(conclusionMode,'zh',policy);
  return{...sceneDeliverySnapshot(state,task),schemaVersion:1,taskId:task.id,taskName:task.name??task.id,createdAt:now,conclusionMode,targetLang,...(policy?{reviewPolicy:clone(policy),resultScope:conclusionMode==='ai'?'initial':'final'}:{}),source:clone(task.source??{name:task.fileName??'',sha256:first.fileSha256}),sourceSheet:clone(task.source?.worksheet??{name:first.sheet,index:first.sheetIndex??null}),headers22:clone(first.headers),standards22:clone(first.standards),...([3,4,5].includes(first.schemaVersion)?{extensions:{headers:clone(first.extensions.headers),standards:clone(first.extensions.standards)}}:{}),...([4,5].includes(first.schemaVersion)?{sourceColumns:clone(first.sourceColumns)}:{}),...(first.schemaVersion===5?{reviewedMapping:clone(first.reviewedMapping)}:{}),basis:summary,records,metrics:{...aggregate(records),...(policy?triageMetrics(records):{})}};
}

export function selectBusinessErrorCases(snapshot,limit=10){
  if(!Number.isSafeInteger(limit)||limit<0||limit>500)throw new Error('错误案例上限须为0至500的整数。');
  const failed=snapshot.records.filter(record=>record.finalOverall==='不通过'),selected=[];
  const has=(record,id)=>record.final.some(result=>result.id===id&&result.verdict==='不通过');
  const severity=record=>record.final.reduce((sum,result)=>sum+(result.verdict==='不通过'?({'EC-PRIVACY':5,'EC-TEXT':4,'EC-TARGET':4,'EC-STEPS':3,'EC-TIME':1}[result.id]??0):0),0);
  const ordered=[...failed].sort((a,b)=>severity(b)-severity(a)||a.sourceRow-b.sourceRow);
  const add=record=>{if(record&&selected.length<limit&&!selected.some(item=>item.id===record.id))selected.push(record);};
  for(const id of ['EC-PRIVACY','EC-TEXT','EC-TARGET','EC-STEPS'])if(!selected.some(record=>has(record,id)))add(ordered.find(record=>has(record,id)));
  const timeCases=failed.filter(record=>has(record,'EC-TIME')).sort((a,b)=>(b.time?.elapsedMs??b.timeFacts?.elapsedMs??-1)-(a.time?.elapsedMs??a.timeFacts?.elapsedMs??-1)||a.sourceRow-b.sourceRow);add(timeCases[0]);
  ordered.filter(record=>record.final.some(result=>result.id!=='EC-TIME'&&result.verdict==='不通过')).forEach(add);timeCases.forEach(add);ordered.forEach(add);
  return selected;
}

export function businessDeliveryHeaders(snapshot,options={}){
  if(options.language==='en')return englishDeliveryHeaders(snapshot,{},options);
  const language=snapshot.targetLang==='en'?'英文':'中文';
  return[...snapshot.headers22,`评价原文翻译（${language}）`,`回复原文翻译（${language}）`,...BUSINESS_RULES.map(rule=>`AI初判-${rule.label}`),'AI初判-整体',...BUSINESS_RULES.map(rule=>`原表历史人工-${rule.label}`),'原表历史人工-整体',...BUSINESS_RULES.map(rule=>`最终判定-${rule.label}`),'整体通过','不合格原因总结',...(snapshot.extensions?.headers??[])];
}
const translationText=(value,original,targetLang)=>!original?.trim()?'':targetLang==='en'&&!reusableEnglishBaseTranslation(original,value)?'':value?.status==='same'?(targetLang==='en'?original:'（同原文）'):value?.status==='translated'&&typeof value.text==='string'&&value.text.trim()?value.text:'';
export async function buildBusinessDeliveryXlsx(snapshot,enrichment={},options={}){
 if(configuredDelivery(snapshot))return buildSceneDeliveryXlsx(snapshot,enrichment,options);
  if(snapshot?.deliveryType==='consultation-v1')return buildConsultationDeliveryXlsx(snapshot,enrichment,options);
  if(snapshot?.schemaVersion!==1||!Array.isArray(snapshot.records)||snapshot.headers22?.length!==22||snapshot.standards22?.length!==22)throw new Error('业务交付快照无效。');
  if(options.language==='en')return buildEnglishDeliveryXlsx(snapshot,enrichment,options);
  const original=ecommerceDeliverySource(snapshot),n=original.headers.length;
  const rows=snapshot.records.map(record=>[...record.raw22,translationText(enrichment.translations?.[record.id]?.comment,record.raw22[8],snapshot.targetLang),translationText(enrichment.translations?.[record.id]?.reply,record.raw22[9],snapshot.targetLang),...record.ai.map(result=>result.verdict),record.aiOverall,...record.historical.map(result=>result.verdict),record.historicalOverall,...record.final.map(result=>result.verdict),record.finalOverall,record.summary,...original.values(record)]);
  if(rows.some(row=>row.length!==43+n))throw new Error('业务明细须为原43列加原始扩展列。');
  const standards=[...snapshot.standards22,...Array(2).fill(`按所选目标语种翻译；${snapshot.targetLang==='en'?'同语种逐字保留原文':'同语种显示（同原文）'}，失败或未完成留空。`),...Array(5).fill('只取本任务完整AI初判，不适用或无法判定显示待判定。'),'任一AI项不通过则不通过；全部通过才通过，否则待判定（仅三值）。',...BUSINESS_RULES.map((_,index)=>`原表第${16+index}列历史人工参考，原规则可能不同。`),'保留原表第21列整体结果，不用逐项结果覆盖历史原值。',...Array(5).fill(snapshot.basis.finalPolicy),'任一最终不通过则整体不通过；全通过才通过，待判定/未回复单列。','聚合最终不通过项，逐项摘要不超过70字符；人工改判标注来源。'];
  standards.push(...original.standards);
  const sheets=[{name:'检核明细',headers:businessDeliveryHeaders(snapshot),rows:[standards,...rows],rowNumbers:[2,...snapshot.records.map(record=>record.sourceRow)]},{name:'口径说明',headers:['项目','说明'],rows:[['任务',snapshot.taskName],['源文件',snapshot.source?.name??''],['来源工作表',original.sheet.name],['来源工作表序号',original.sheet.index??'旧记录未保存'],['源文件SHA256',snapshot.source?.sha256??''],['生成时间',snapshot.createdAt],['结论口径',snapshot.basis.finalPolicy],['AI质检规则',snapshot.basis.phaseLabel],['冻结依据',JSON.stringify(snapshot.basis)],['质量分母',`${snapshot.metrics.determinate}；通过率=通过/(通过+不通过)，待判定与未回复单列。`],['人工来源','最终逐项来源为本次已确认、原表历史或AI；未确认草稿不参与。历史结果可能来自旧规则，不作为新规则AI准确率金标。'],['原始列与物理行',`A:V原始22列与源表名称/值一致；第2行为原标准，数据物理行使用来源工作表${original.sheet.name}行号。系统列固定至第43列，其后按原顺序保留${n}个扩展列，扩展值不参与AI质检。`],['翻译声明','翻译为模型辅助生成，须人工核对；同原文仅表示识别为目标语种。失败和未完成为空，不能视为成功。']]},{name:'字段说明',headers:['原始列号','原列名','留存说明'],rows:[...snapshot.headers22.map((header,i)=>[i+1,header,'核心原始列，名称与值完整保留。']),...original.headers.map((header,i)=>[44+i,header,'原始扩展列；标准与值按原位置保留，不参与AI质检。'])]}];
  if(original.mapping){
    BUSINESS_RULES.forEach((_,index)=>standards[30+index]=`原表第${snapshot.sourceColumns.core[15+index]}列历史人工参考，原规则可能不同。`);
    standards[35]=`保留原表第${snapshot.sourceColumns.core[20]}列整体结果，不用逐项结果覆盖历史原值。`;
    sheets[1].rows.find(row=>row[0]==='原始列与物理行')[1]=`${original.mapping.userReviewed?'22个核心字段使用用户确认源列映射':'22个核心字段按表头定位'}，原表头、标准与值完整保留；源列映射表列明每个源物理列到导出列的对应关系。数据保留来源工作表${original.sheet.name}物理行号，系统业务列固定至第43列，其后按原相对顺序保留${n}个扩展列，扩展值不参与AI质检。`;
    sheets[2].headers[0]='导出列号';
    sheets.push({name:'源列映射',headers:['源物理列号','导出列号','原列名','列类型','定位依据'],rows:ecommerceSourceMappingRows(snapshot).map(row=>[...row.slice(0,3),row[3]==='core'?'核心字段':'扩展列',row[4]==='user-reviewed-mapping'?'用户确认源列映射（字段与原文样例分别确认）':row[4]==='legacy-relative-core-order'?'已识别22个核心字段保持原相对顺序（含Region重叠别名）':row[4]==='unique-header'?'唯一表头定位':'扩展列原相对顺序'])});
  }
  const failedTexts=new Set(),pendingTexts=new Set(),affected=new Set();
  for(const record of snapshot.records)for(const[field,index]of[['comment',8],['reply',9]]){
    const original=record.raw22[index],translation=enrichment.translations?.[record.id]?.[field];if(!original.trim()||translationText(translation,original,snapshot.targetLang))continue;
    (translation?.status==='failed'||snapshot.targetLang==='en'&&['same','translated'].includes(translation?.status)?failedTexts:pendingTexts).add(original);affected.add(record.id);
  }
  sheets[1].rows.push(['翻译失败文本（去重）',failedTexts.size],['未完成翻译文本（去重）',pendingTexts.size],['缺少译文的记录数',affected.size]);
  const provenance=resultProvenanceSheet(snapshot);if(provenance)sheets.push(provenance);
  return workbook(excelSafeSheets(appendEvidenceSheets(sheets,snapshot)));
}
