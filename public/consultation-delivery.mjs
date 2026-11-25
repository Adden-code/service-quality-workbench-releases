import {aggregateRuleId,failOnlyAggregate,sceneOverall} from './scene-aggregate.mjs';
import {appendEvidenceSheets} from './evidence-audit.mjs';
import {sceneDeliverySnapshot,configuredDelivery,buildSceneDeliveryXlsx} from './scene-delivery.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';
import {hasCompletedAI} from './domain.mjs';
import {isSessionCheckRule} from './rule-kind.mjs';
import {workbook,excelSafeSheets} from './io.mjs';
import {scenarioForTask,validateScenarioConfig} from './scenarios.mjs';
import {buildEnglishDeliveryXlsx,englishDeliveryHeaders} from './report-english-delivery.mjs';
import {reusableEnglishBaseTranslation} from './translation-language.mjs';
import {CONVERSATION_UNVERIFIED,assertRoleEvidenceSupport,unverifiedRoleEvidence,roleEvidenceNotice,groundedConversationQuote} from './role-evidence.mjs';
import {normalizeReviewPolicy} from './ai-triage.mjs';
import {freezeReviewRouting,triageConclusionPolicy,triageMetrics,pendingHumanResult,resultProvenanceSheet} from './triage-export.mjs';
import {isRawReport,rawQuoteMatches,rawSavedQuoteMatches,groundedRawReportQuote,rawEvidenceText,rawReportNotices,validateRawReportRecord} from './raw-report-evidence.mjs';

const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const verdicts=new Map([['符合','Pass'],['pass','Pass'],['通过','Pass'],['不符合','Fail'],['fail','Fail'],['不通过','Fail'],['不适用','NA'],['na','NA'],['not applicable','NA'],['无法判定','待判定'],['待判定','待判定']]);
const normalize=value=>typeof value==='string'?verdicts.get(value.trim().toLowerCase())??'待判定':'待判定';
const category=rule=>typeof rule.category==='string'&&rule.category.trim()?rule.category:'未分类';
const label=rule=>rule.title||rule.name||rule.id;
const policy=mode=>mode==='ai'?'仅采用本任务完整AI初判':'工作台本次已确认逐项结果 > AI初判；本场景不支持原表历史人工结论映射';
const overall=items=>items.some(item=>item.verdict==='Fail')?'不通过':!items.length||items.some(item=>!['Pass','NA'].includes(item.verdict))?'待判定':items.some(item=>item.verdict==='Pass')?'通过':'NA';
const fail=message=>{throw new Error(message);};
const physical=(row,headerRow)=>Number.isSafeInteger(row)&&row>headerRow&&row<=1048576;

const builtinAnalysisFields=['salesStage','intent','demandSummary','negativeVoice'];
const builtinReport={title:'新品质检报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview','breakdown','dimensions','cases','improvements','voc']};
export function consultationConfiguration(snapshot){
 if(configuredDelivery(snapshot)&&snapshot.executionSnapshot.configuration.executionMode==='legacy'){const old=consultationConfiguration({...snapshot,executionSnapshot:undefined}),t=snapshot.executionSnapshot.template;return{...old,report:{...old.report,title:t.title,sections:t.sections.map(s=>s.key)}};}
 if(configuredDelivery(snapshot)){const c=snapshot.executionSnapshot;return{analysisFields:[],customFields:[],report:{title:c.template.title,groupBy:c.template.groupBy,groupField:'',groupLabel:c.template.groupBy,sections:c.template.sections.map(s=>s.key)},scenario:snapshot.scenarioSnapshot||null,custom:Boolean(snapshot.scenarioSnapshot&&!snapshot.scenarioSnapshot.builtin)};}
 if(snapshot?.scenarioSnapshot===undefined)return{analysisFields:[...builtinAnalysisFields],customFields:[],report:clone(builtinReport),scenario:null,custom:false};
 const scenario=snapshot.scenarioSnapshot?.builtin===true?scenarioForTask({scene:snapshot.scene??snapshot.scenarioSnapshot.id,scenarioSnapshot:snapshot.scenarioSnapshot}):validateScenarioConfig(snapshot.scenarioSnapshot);
 if(!scenario||scenario.engine!=='conversation')fail('报告场景冻结配置无效。');
 if(snapshot.scene!==undefined&&snapshot.scene!==scenario.id)fail('报告场景与冻结配置不一致。');
 if(scenario.builtin)return{analysisFields:[...builtinAnalysisFields],customFields:[],report:clone(builtinReport),scenario,custom:false};
 return{analysisFields:scenario.analysisFields,customFields:scenario.customFields,report:scenario.report,scenario,custom:true};
}
export function consultationNeedsAnalysis(snapshot){if(snapshot?.executionSnapshot?.configuration.executionMode==='configured')return false;const config=consultationConfiguration(snapshot);return Boolean(config.analysisFields.length||config.report.sections.includes('voc'));}
export function consultationTaxonomyMissing(snapshot){if(snapshot?.executionSnapshot?.configuration.executionMode==='configured')return snapshot.executionSnapshot.configuration.capabilities.some(c=>c.key==='intent')&&!snapshot.executionSnapshot.taxonomy;return consultationConfiguration(snapshot).analysisFields.includes('intent')&&!(snapshot?.basis?.policies||snapshot?.basisSnapshot?.policies||[]).some(policy=>String(policy.category??'').trim()==='分类体系'||String(policy.title??'').includes('分类体系'));}
/** Only imported conversation tasks with frozen rules may use this report route. */
export function isConsultationTask(state,task){
 const sessions=state?.sessions?.filter(row=>row.taskId===task?.id)||[];
 let scenario;try{scenario=scenarioForTask(task);}catch{return false;}
 return Boolean(task?.mode==='manual'&&scenario?.engine==='conversation'&&Array.isArray(task.basisSnapshot?.rules)&&task.basisSnapshot.rules.length&&sessions.length&&sessions.length<=500&&sessions.every(row=>row.scene===task.scene&&!row.ecommerce));
}

function validateSheet(sheet,{primary=false,recordIds}={}){
 if(!object(sheet)||typeof sheet.sheetName!=='string'||!sheet.sheetName.trim()||!Number.isSafeInteger(sheet.headerRow)||sheet.headerRow<1||sheet.headerRow>=1048576||!Array.isArray(sheet.headers)||!sheet.headers.length||sheet.headers.length>16384||sheet.headers.some(value=>typeof value!=='string')||!sheet.headers.some(value=>value.trim())||!Array.isArray(sheet.rows)||!sheet.rows.length)fail('原始工作表、字段或表头物理行信息无效，不能承诺完整保留原表。');
 const seen=new Set();
 for(const row of sheet.rows){
  if(!object(row)||!physical(row.sourceRow,sheet.headerRow)||seen.has(row.sourceRow)||!Array.isArray(row.values)||row.values.length>sheet.headers.length||row.values.some(value=>typeof value!=='string'))fail('原始数据行号重复、越界或原列值不完整。');
  seen.add(row.sourceRow);
  if(primary&&!recordIds.has(row.recordId))fail('原始数据行未关联本任务的真实会话。');
 }
}
function validateOriginal(original,sessions){
 const ids=new Set(sessions.map(row=>row.id));validateSheet(original,{primary:true,recordIds:ids});
 if(original.messageColumn!==null&&(!Number.isSafeInteger(original.messageColumn)||original.messageColumn<0||original.messageColumn>=original.headers.length))fail('原始消息详情列配置无效。');
 if(!object(original.productSources))fail('产品来源信息缺失，不能猜测产品来源。');
 for(const session of sessions){
  if(!original.rows.some(row=>row.recordId===session.id))fail('原始数据缺少会话对应的物理行，不能编造原表行号。');
  const item=original.productSources[session.id];
  if(!object(item)||typeof item.value!=='string'||!['原表列','任务默认','未提供'].includes(item.source)||(item.source==='未提供'?Boolean(item.value.trim()):!item.value.trim())||(item.source==='原表列'&&(typeof item.column!=='string'||!original.headers.includes(item.column))))fail('产品来源无效；未提供的产品不得携带推测值。');
 }
 if(original.additionalSheets!==undefined){
  if(!Array.isArray(original.additionalSheets))fail('原文附表信息无效。');
  for(const sheet of original.additionalSheets)validateSheet(sheet);
 }
}
function resultItem(rule,result,source,session){
 const evidence=Array.isArray(result?.evidence)?[...result.evidence]:[];
 const native=result?.languageValidation?{languageValidation:clone(result.languageValidation),...(result.nativeContract?{nativeContract:clone(result.nativeContract)}:{})}:{};
 if(isRawReport(session)){
  const quotes=clone(result?.evidenceQuotes||[]);
  if(evidence.length||quotes.some(item=>!rawSavedQuoteMatches(session.rawTranscript.text,item?.quote,result?.rawValidation).length||JSON.stringify(rawSavedQuoteMatches(session.rawTranscript.text,item?.quote,result?.rawValidation))!==JSON.stringify(item.matches))||result?.rawValidation&&result.rawValidation.textSha256!==session.rawTranscript.textSha256)fail('原文证据引文或来源摘要与本行不一致，不能生成交付物。');
  return{id:rule.id,ruleId:rule.id,label:label(rule),category:category(rule),verdict:normalize(result?.verdict),reason:String(result?.reason??''),evidence:[],evidenceQuotes:quotes,turnRefs:clone(result?.turnRefs||[]),...(result?.rawValidation?{rawValidation:clone(result.rawValidation)}:{}),...native,source:result?source:'none'};
 }
 if(evidence.some(id=>!session.turns.some(turn=>turn.id===id)))fail('判定证据轮次不属于本会话，不能生成交付物。');
 return{id:rule.id,ruleId:rule.id,label:label(rule),category:category(rule),verdict:normalize(result?.verdict),reason:String(result?.reason??''),evidence,...native,source:result?source:'none'};
}
function reasonSummary(result,corrected=false){
 let value=String(result.reason||'未提供具体判定理由').replace(/[\r\n\t]+/g,' ').trim();
 value=value.replace(/[（(]\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?\s*(?:毫秒|ms)\s*[）)]/gi,'');
 value=value.replace(/\b(?:elapsedMs|durationMs)\s*[:=：]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)/gi,(_,number)=>`累计时长${(Number(number)/3600000).toFixed(1)}小时`);
 value=value.replace(/([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*(?:毫秒|\bms\b)/gi,(_,number)=>`${(Number(number)/3600000).toFixed(1)}小时`);
 value=value.replace(/(\d+(?:\.\d+)?)(\s*(?:工作小时|小时|hours?\b|h\b))/gi,(_,number,unit)=>`${Number(number).toFixed(1)}${unit}`);
 const full=`${result.source==='confirmed'?(corrected?'人工纠正：':'人工确认：'):''}${result.label}：${value}`,chars=[...full];return chars.length>70?chars.slice(0,69).join('')+'…':full;
}
function stats(values){
 const passed=values.filter(value=>value==='Pass'||value==='通过').length,failed=values.filter(value=>value==='Fail'||value==='不通过').length,na=values.filter(value=>value==='NA').length,pending=values.length-passed-failed-na,denominator=passed+failed;
 return{passed,failed,na,pending,denominator,passRate:denominator?passed/denominator*100:null};
}
function recordStats(records){const {denominator,...rest}=stats(records.map(row=>row.finalOverall));return{total:records.length,...rest,determinate:denominator};}

export function createConsultationDeliverySnapshot(state,{taskId,conclusionMode='combined',targetLang='zh',roleEvidenceMode,original,now=new Date().toISOString()}={}){
 const task=state?.tasks?.find(row=>row.id===taskId);
 if(!isConsultationTask(state,task))fail('请选择具有冻结依据的产品咨询任务。');
 if(!['combined','ai'].includes(conclusionMode)||!['zh','en'].includes(targetLang)||typeof now!=='string'||!Number.isFinite(Date.parse(now)))fail('业务交付口径、目标语种或生成时间无效。');
 if(!object(task.source)||typeof task.source.name!=='string'||!/^[a-f0-9]{64}$/.test(task.source.sha256||'')||!Number.isSafeInteger(task.source.size)||task.source.size<1)fail('缺少可核验的原文件来源，不能承诺全部原始列。');
 const derivedId=task.executionSnapshot?.languageExecution?aggregateRuleId(task.executionSnapshot):null;
 const sessions=state.sessions.filter(row=>row.taskId===task.id),frozen=task.basisSnapshot,rules=clone(frozen.rules.filter(r=>isSessionCheckRule(r)&&r.id!==derivedId)),ruleIds=rules.map(rule=>rule.id),frozenRuleIds=frozen.rules.filter(r=>r.id!==derivedId).map(rule=>rule.id),config=consultationConfiguration(task);
 if(!rules.length)fail('该任务只有交付物要求，没有可导出的会话检核项。请使用会话检核规则新建任务。');
 const evidenceMode=assertRoleEvidenceSupport({deliveryType:'consultation-v1',inputMode:task.inputMode,roleEvidenceMode},config);
 if(ruleIds.some(id=>typeof id!=='string'||!id.trim())||new Set(ruleIds).size!==ruleIds.length||!Array.isArray(frozen.policies))fail('任务冻结规则或资料无效。');
 validateOriginal(original,sessions);
 const dimensions=[],principleRuleIds=[];
 for(const rule of rules){
  const key=category(rule);if(key.trim()==='整体判定原则'){principleRuleIds.push(rule.id);continue;}
  let dimension=dimensions.find(value=>value.key===key);if(!dimension){dimension={key,label:key,ruleIds:[]};dimensions.push(dimension);}dimension.ruleIds.push(rule.id);
 }
 const productSourceCounts={'原表列':0,'任务默认':0,'未提供':0};
 const records=sessions.map(session=>{
  if(isRawReport(task))for(const result of session.aiResults||[]){const rule=rules.find(rule=>rule.id===result.ruleId);if(rule)resultItem(rule,result,'ai',session);}
  const sourceRows=original.rows.filter(row=>row.recordId===session.id).sort((a,b)=>a.sourceRow-b.sourceRow),product=original.productSources[session.id];productSourceCounts[product.source]++;
  const expected=session.expectedRuleIds,hasAI=session.aiExecution?.status==='completed'&&Array.isArray(expected)&&expected.length===frozenRuleIds.length&&new Set(expected).size===frozenRuleIds.length&&frozenRuleIds.every(id=>expected.includes(id))&&hasCompletedAI(session);
  const rawFallback=isRawReport(task)&&session.aiExecution?.status==='failed'&&Array.isArray(session.aiResults)&&session.aiResults.length===frozenRuleIds.length&&new Set(session.aiResults.map(item=>item.ruleId)).size===frozenRuleIds.length&&session.aiResults.every(item=>frozenRuleIds.includes(item.ruleId)&&item.verdict==='无法判定'&&item.rawValidation?.status==='program-fallback');
  const ai=rules.map(rule=>resultItem(rule,hasAI||rawFallback?session.aiResults.find(item=>item.ruleId===rule.id):null,rawFallback?'program_fallback':'ai',session));
  const historical=rules.map(rule=>({...resultItem(rule,null,'none',session),reason:'本场景未建立原表历史人工结论映射，不能自动采用留档字段。'}));
  const confirmed=rules.map(rule=>resultItem(rule,session.review?.status==='已确认'&&session.review.disposition!=='unreplied'?session.review.drafts?.[rule.id]:null,'confirmed',session));
   const routing=freezeReviewRouting(session,task);
   const final=ai.map((item,index)=>clone(conclusionMode==='ai'?item:confirmed[index].source==='confirmed'?confirmed[index]:routing?routing.aiFinal||routing.exemptRuleIds?.includes(item.id)?{...item,source:'ai_final'}:pendingHumanResult(item,routing):item));
  const nativeEnglish=task.executionSnapshot?.languageExecution?.contentLanguage==='en';
  const conversation=original.messageColumn===null?session.turns.map(turn=>`${nativeEnglish?({'客户':'Customer','客服':'Agent','系统':'System'}[turn.role]||turn.role):turn.role}${nativeEnglish?': ':'：'}${turn.text}`).join('\n'):sourceRows.map(row=>row.values[original.messageColumn]??'').join('\n');
  const timeFacts=(hasAI?session.aiResults:[]).filter(result=>Number.isFinite(result.timeFacts?.elapsedMs)&&result.timeFacts.elapsedMs>=0&&Number.isFinite(result.timeFacts.thresholdHours)&&result.timeFacts.thresholdHours>0&&['continuous','workingHours'].includes(result.timeFacts.mode)).map(result=>({...clone(result.timeFacts),ruleId:result.ruleId}));
  const group=groupForRecord(config,original,session,product);
   const record={id:session.id,externalId:session.externalId??session.id,...(isRawReport(task)?{inputMode:task.inputMode,rawTranscript:clone(session.rawTranscript),executionStatus:session.aiExecution?.status||'not_started',aiExecution:clone(session.aiExecution||null)}:{}),...(routing?{routing}:{}),startedAt:typeof session.startedAt==='string'?session.startedAt:'',sourceRows:sourceRows.map(row=>row.sourceRow),conversation,turns:clone(session.turns||[]),product:product.source==='未提供'?'未提供':product.value,productSource:product.source,...(product.column?{productColumn:product.column}:{}),...(config.custom?{groupValue:group.value,groupSource:group.source,...(group.column?{groupColumn:group.column}:{})}:{}),hasAI,ai,historical,confirmed,final,aiOverall:overall(ai),finalOverall:overall(final),summary:final.filter(item=>item.verdict==='Fail').map(item=>reasonSummary(item,hasAI&&item.verdict!==ai.find(result=>result.id===item.id)?.verdict)).join('；'),timeFacts};
   if(failOnlyAggregate(task.executionSnapshot)){const aggregate=items=>sceneOverall(task.executionSnapshot,items.map(x=>x.source==='pending_human'?'待确认':x.source==='none'?'未执行':({'Pass':'符合','Fail':'不符合','NA':'不适用','待判定':'无法判定'}[x.verdict]||'无法判定')));const label=v=>({'符合':'通过','不符合':'不通过','未执行':'待判定','待确认':'待判定'}[v]||v);record.aiOverall=label(aggregate(ai));record.finalOverall=label(aggregate(final));record.unknownCount=final.filter(x=>x.verdict==='待判定').length;}
   if(isRawReport(task))validateRawReportRecord(record,original,task.source);return record;
 }).sort((a,b)=>a.sourceRows[0]-b.sourceRows[0]);
 const ruleStats=rules.map(rule=>({id:rule.id,ruleId:rule.id,label:label(rule),category:category(rule),ai:stats(records.map(row=>row.ai.find(item=>item.id===rule.id).verdict)),final:stats(records.map(row=>row.final.find(item=>item.id===rule.id).verdict))}));
 const dimensionStats=dimensions.map(dimension=>({...clone(dimension),ai:stats(records.map(row=>overall(row.ai.filter(item=>dimension.ruleIds.includes(item.id))))),final:stats(records.map(row=>overall(row.final.filter(item=>dimension.ruleIds.includes(item.id)))))}));
 const products=[...new Set(records.map(row=>row.product))],byProduct=products.map(product=>({product,...recordStats(records.filter(row=>row.product===product))}));
 const byGroup=config.custom?[...new Set(records.map(row=>row.groupValue))].map(value=>({value,...recordStats(records.filter(row=>row.groupValue===value))})):undefined;
 const correctedRecords=records.filter(row=>row.hasAI&&row.final.some((item,index)=>item.source==='confirmed'&&item.verdict!==row.ai[index].verdict)).length;
 const starts=records.map(row=>row.startedAt).filter(value=>value&&Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(a)-Date.parse(b));
 const conversationTimeRange={from:starts[0]||'',to:starts.at(-1)||'',provided:starts.length,missing:records.length-starts.length};
  const reviewPolicy=task.reviewPolicy!==undefined?normalizeReviewPolicy(task.reviewPolicy):sessions.some(session=>isProcessedUnknown(session)||session.review?.resolutionHistory?.length)?normalizeReviewPolicy({enabled:false}):null;
  return{...sceneDeliverySnapshot(state,task),schemaVersion:1,deliveryType:'consultation-v1',...(isRawReport(task)?{inputMode:task.inputMode,evidenceContractVersion:task.evidenceContractVersion,rawImportOptions:clone(task.rawImportOptions)}:{}),taskId:task.id,taskName:task.name,createdAt:now,targetLang,conclusionMode,...(reviewPolicy?{reviewPolicy:clone(reviewPolicy),resultScope:conclusionMode==='ai'?'initial':'final'}:{}),...(evidenceMode===CONVERSATION_UNVERIFIED?{roleEvidenceMode:evidenceMode}:{}),...(config.scenario?{scene:task.scene,scenarioSnapshot:clone(config.scenario)}:{}),source:clone(task.source),original:clone(original),basis:{capturedAt:frozen.capturedAt??'',effectiveDate:frozen.effectiveDate??'',conversationTimeRange,rules,policies:clone(frozen.policies),dimensions,principleRuleIds,finalPolicy:reviewPolicy?triageConclusionPolicy(conclusionMode,'zh',reviewPolicy):policy(conclusionMode),historicalPolicy:'本场景不支持原表历史人工结论映射；原始留档字段不得自动充当人工答案。',productSourceCounts,...(isRawReport(task)?{qualityEvaluation:{status:'not-evaluated',accuracy:null,failRecall:null,wrongAiFinalPassCount:null},sourceTimePolicy:clone(task.rawImportOptions?.timePolicy||{mode:'unavailable',timezone:'+08:00'})}:{}),...(config.custom?{grouping:{groupBy:config.report.groupBy,field:config.report.groupField,label:config.report.groupLabel,missing:records.filter(row=>row.groupSource==='未提供').length,policy:'按冻结映射的原表值或显式默认值分组；未提供单列，同会话冲突拒绝，不推测。'}}:{}),timeSelectionNotice:records.some(row=>row.timeFacts.length)?'仅使用原判定中实际保存的结构化时效事实选择极端时效案例，不推测时效阈值。':'没有真实结构化时效事实，不能评选极端时效案例。'},records,metrics:{...recordStats(records),...(reviewPolicy?triageMetrics(records):{}),correctedRecords,confirmedCorrections:correctedRecords,historicalCorrections:0,historicalDifferenceRecords:0,ruleStats,dimensionStats,byProduct,...(byGroup?{byGroup}:{})}};
}

function groupForRecord(config,original,session,product){
 if(!config.custom||config.report.groupBy==='product')return{value:product.value||'未提供',source:product.source,...(product.column?{column:product.column}:{})};
 const group=original.groupSources?.[session.id];
 if(!object(group)||typeof group.value!=='string'||!['原表列','任务默认','未提供'].includes(group.source)||(group.source==='未提供'?Boolean(group.value.trim()):!group.value.trim())||(group.source==='原表列'&&(!original.headers.includes(group.column))))fail('分组来源缺少冻结原表映射，不能用会话摘要猜测。');
 return{...group,value:group.source==='未提供'?'未提供':group.value};
}

export function consultationDeliveryHeaders(snapshot,options={}){
 if(snapshot?.deliveryType!=='consultation-v1'||!Array.isArray(snapshot.original?.headers)||!Array.isArray(snapshot.basis?.rules))fail('产品咨询交付快照无效。');
 if(options.language==='en')return englishDeliveryHeaders(snapshot,{},options,consultationConfiguration(snapshot));
 const language=snapshot.targetLang==='en'?'英文':'中文';
 const config=consultationConfiguration(snapshot),names={salesStage:['销售环节（一级/二级）'],intent:['用户意图'],demandSummary:['用户诉求总结'],negativeVoice:['是否涉及负面声音','用户负面原声']};
 if(unverifiedRoleEvidence(snapshot))Object.assign(names,{intent:['会话意图线索（角色未核验）'],demandSummary:['会话诉求线索（角色未核验）'],negativeVoice:['是否涉及负面会话线索（角色未核验）','负面会话原文（角色未核验）']});
 return[...snapshot.original.headers,`会话详情翻译（${language}）`,...config.analysisFields.flatMap(field=>names[field]),...config.customFields.map(field=>field.label),...snapshot.basis.rules.map(rule=>label(rule)),'整体通过','不合格原因总结'];
}
const translated=(entry,source,targetLang)=>!source.trim()?'':targetLang==='en'&&!reusableEnglishBaseTranslation(source,entry)?'':entry?.status==='same'?(targetLang==='en'?source:'（同原文）'):entry?.status==='translated'&&typeof entry.text==='string'&&entry.text.trim()?entry.text:'';
function analysisValues(analysis,record,unverified=false){
 const status=analysis?.status;
 if(status!=='completed'){const notice=status==='failed'?'AI分析失败':'AI分析未完成';return Array(5).fill(notice);}
 const sales=[analysis.salesStage,analysis.salesSubstage].filter(value=>typeof value==='string'&&value.trim()).join(' / ')||'未提供分类';
 let voices='负向声音未完成',negativeFlag='待判定';
 if(Array.isArray(analysis.negativeVoices)){
  const valid=analysis.negativeVoices.every(value=>object(value)&&typeof value.quote==='string'&&value.quote.trim()&&(unverified?groundedConversationQuote(record,value.quote,value.turnId):record.turns.some(turn=>turn.role==='客户'&&turn.id===value.turnId&&turn.text.includes(value.quote))));
  voices=valid?(analysis.negativeVoices.length?analysis.negativeVoices.map(value=>isRawReport(record)?`原文引文 · 角色未核验：${value.quote}`:unverified?`第${value.turnId}轮 · 原角色${record.turns.find(turn=>turn.id===value.turnId)?.role} · 角色未核验：${value.quote}`:`第${value.turnId}轮：${value.quote}`).join('\n'):'未识别到负向声音'):'负向声音证据无效，待复核';
  if(valid&&analysis.sentiment==='负向'&&analysis.negativeVoices.length)negativeFlag='是';
  else if(valid&&['正向','中性'].includes(analysis.sentiment)&&!analysis.negativeVoices.length)negativeFlag='否';
 }
 return[sales,typeof analysis.intentLabel==='string'&&analysis.intentLabel.trim()?analysis.intentLabel:'意图分析未完成',typeof analysis.demandSummary==='string'&&analysis.demandSummary.trim()?analysis.demandSummary:'需求摘要未完成',negativeFlag,voices];
}
function selectedAnalysisValues(config,analysis,record,unverified){const values=analysisValues(analysis,record,unverified),indexes={salesStage:[0],intent:[1],demandSummary:[2],negativeVoice:[3,4]};return config.analysisFields.flatMap(field=>indexes[field].map(index=>values[index]));}
function customFieldValues(config,entry,record){
 return config.customFields.map(field=>{
  if(entry?.status!=='completed')return entry?.status==='failed'?'AI字段分析失败':'AI字段分析未完成';
  const item=entry.fields?.find(value=>value.id===field.id);if(!item||item.missing===true)return'未提供';
  if(typeof item.value!=='string'||!item.value.trim()||(field.type==='enum'&&!field.options.includes(item.value)))return'字段分析无效，待复核';
  if(field.type==='quote')return isRawReport(record)?groundedRawReportQuote(record,item.value)?`原文引文 · 角色未核验：${item.value}`:'原文引文无效，待复核':record.turns.some(turn=>turn.role==='客户'&&turn.id===item.turnId&&turn.text.includes(item.value))?`第${item.turnId}轮：${item.value}`:'原声证据无效，待复核';
  return item.value;
 });
}
function sheetName(value,used){
 const base=String(value).replace(/[\\/?*\[\]:]/g,'_').slice(0,31)||'原文附表';let name=base,index=2;
 while(used.has(name))name=base.slice(0,27)+'_'+index++;used.add(name);return name;
}

export async function buildConsultationDeliveryXlsx(snapshot,enrichment={},options={}){
 if(configuredDelivery(snapshot))return buildSceneDeliveryXlsx(snapshot,enrichment,options);
 if(snapshot?.schemaVersion!==1||snapshot.deliveryType!=='consultation-v1'||!Array.isArray(snapshot.records)||!Array.isArray(snapshot.basis?.rules))fail('产品咨询交付快照无效。');
 validateOriginal(snapshot.original,snapshot.records);
 if(isRawReport(snapshot))for(const record of snapshot.records)validateRawReportRecord(record,snapshot.original,snapshot.source);
 assertRoleEvidenceSupport(snapshot,consultationConfiguration(snapshot));
 if(options.language==='en')return buildEnglishDeliveryXlsx(snapshot,enrichment,options,consultationConfiguration(snapshot));
 const headers=consultationDeliveryHeaders(snapshot),records=new Map(snapshot.records.map(row=>[row.id,row])),config=consultationConfiguration(snapshot),needsAnalysis=consultationNeedsAnalysis(snapshot);
 const rows=[...snapshot.original.rows].sort((a,b)=>a.sourceRow-b.sourceRow).map(source=>{
  const record=records.get(source.recordId),values=Array.from({length:snapshot.original.headers.length},(_,index)=>source.values[index]??'');
  return[...values,translated(enrichment.translations?.[record.id]?.conversation,record.conversation,snapshot.targetLang),...selectedAnalysisValues(config,enrichment.consultationAnalysis?.[record.id],record,unverifiedRoleEvidence(snapshot)),...customFieldValues(config,enrichment.scenarioFields?.[record.id],record),...record.final.map(item=>item.verdict),record.finalOverall,record.summary];
 });
 if(headers.length>16384||rows.some(row=>row.length!==headers.length))fail('产品咨询明细列结构无效或超过Excel列上限。');
 const notes=[['任务',snapshot.taskName],['源文件',snapshot.source.name],['源文件SHA256',snapshot.source.sha256],['源工作表',snapshot.original.sheetName],['源表头物理行',snapshot.original.headerRow],['生成时间',snapshot.createdAt],['结论口径',snapshot.basis.finalPolicy],['历史人工',snapshot.basis.historicalPolicy],['统计单位','统计按内部会话ID去重；同一会话映射多个源行时，各行重复完整会话分析和质检结果，不可按导出行数重复统计。'],['原始数据','主表表头置于第1行，源数据沿用真实源物理行号；完整保留全部源列值，不用重组字段替换原表。'],['通过率','通过/(通过+不通过)；NA仅表示规则真实不适用，待判定单列。全部NA的会话整体NA，未知结果不视作NA或通过。'],['冻结依据',JSON.stringify(snapshot.basis)],['产品来源',JSON.stringify(snapshot.basis.productSourceCounts)],['极端时效案例',snapshot.basis.timeSelectionNotice],['翻译与分析','模型辅助生成，须结合原文复核；失败或未完成译文留空，分析未完成不代表没有负向声音。']];
 if(config.scenario)notes.push(['场景配置',JSON.stringify(config.scenario)],['报告标题',config.report.title],['报告分组',JSON.stringify(snapshot.basis.grouping)],['报告模块',config.report.sections.join('、')],['选择分析字段',JSON.stringify(config.analysisFields)],['自定义分析字段',JSON.stringify(config.customFields)]);
 if(unverifiedRoleEvidence(snapshot))notes.unshift(['引用口径',CONVERSATION_UNVERIFIED],['会话原文 / 角色未核验',roleEvidenceNotice('zh',snapshot)]);
 if(isRawReport(snapshot))notes.unshift(...rawReportNotices(snapshot).map((notice,index)=>[['原文证据','来源时间','自评门槛','金标准对照'][index]||'执行状态',notice]));
 const failedTexts=new Set(),pendingTexts=new Set(),missingRecords=new Set();let analysisFailed=0,analysisPending=0;
 for(const record of snapshot.records){
  const entry=enrichment.translations?.[record.id]?.conversation;
  if(record.conversation.trim()&&!translated(entry,record.conversation,snapshot.targetLang)){(entry?.status==='failed'||snapshot.targetLang==='en'&&['same','translated'].includes(entry?.status)?failedTexts:pendingTexts).add(record.conversation);missingRecords.add(record.id);}
  if(needsAnalysis){const status=enrichment.consultationAnalysis?.[record.id]?.status;if(status==='failed')analysisFailed++;else if(status!=='completed')analysisPending++;}
 }
 notes.push(['翻译失败文本（去重）',failedTexts.size],['未完成翻译文本（去重）',pendingTexts.size],['缺少译文的会话数',missingRecords.size],['AI分析失败会话数',analysisFailed],['AI分析未完成会话数',analysisPending]);
 const trail=snapshot.records.flatMap(record=>record.final.map((result,index)=>[record.id,record.externalId,record.sourceRows.join(';'),record.product,record.productSource,result.id,result.label,result.category,record.ai[index].verdict,record.confirmed[index].source==='confirmed'?record.confirmed[index].verdict:'',result.verdict,result.source,result.reason,isRawReport(snapshot)?rawEvidenceText(result):result.evidence.join(';'),...(isRawReport(snapshot)?[JSON.stringify(result.evidenceQuotes||[]),JSON.stringify(result.turnRefs||[]),JSON.stringify(result.rawValidation||{}),JSON.stringify(record.rawTranscript.timePolicy)]:[])]));
 const sheets=[{name:'检核明细',headers,rows,rowNumbers:[...snapshot.original.rows].sort((a,b)=>a.sourceRow-b.sourceRow).map(row=>row.sourceRow)},{name:'口径说明',headers:['项目','说明'],rows:notes},{name:'判定留痕',headers:['会话ID','原会话ID','源物理行','产品','产品来源','规则ID','规则名称','维度','AI初判','本次已确认人工','最终判定','最终来源','完整判断理由',...(isRawReport(snapshot)?['证据引文','引文定位（UTF-16）','轮次参考（模型估计）','引文校验诊断','来源时间声明']:['证据轮次'])],rows:trail}];
  const provenance=resultProvenanceSheet(snapshot);if(provenance)sheets.push(provenance);
  const used=new Set(sheets.map(sheet=>sheet.name));
 for(const extra of snapshot.original.additionalSheets||[])sheets.push({name:sheetName(`原文_${extra.sheetName}`,used),headers:[...extra.headers],rows:[...extra.rows].sort((a,b)=>a.sourceRow-b.sourceRow).map(row=>Array.from({length:extra.headers.length},(_,i)=>row.values[i]??'')),rowNumbers:[...extra.rows].sort((a,b)=>a.sourceRow-b.sourceRow).map(row=>row.sourceRow)});
 return workbook(excelSafeSheets(appendEvidenceSheets(sheets,snapshot)));
}

export function selectConsultationErrorCases(snapshot,limit=10){
 if(!Number.isSafeInteger(limit)||limit<0||limit>100)fail('案例数量须为0至100的整数。');
 if(!limit)return[];
 const failures=snapshot.records.filter(record=>record.finalOverall==='不通过'),count=record=>record.final.filter(item=>item.verdict==='Fail').length;
 const sorted=[...failures].sort((a,b)=>count(b)-count(a)||a.sourceRows[0]-b.sourceRows[0]),selected=[];
 const add=record=>{if(record&&selected.length<limit&&!selected.some(row=>row.id===record.id))selected.push(record);};
 const failureTime=row=>Math.max(-1,...(row.timeFacts||[]).filter(fact=>Number.isFinite(fact.elapsedMs)&&row.final.some(item=>item.id===fact.ruleId&&item.verdict==='Fail')).map(fact=>fact.elapsedMs));
 const timed=sorted.filter(row=>failureTime(row)>=0).sort((a,b)=>failureTime(b)-failureTime(a)||a.sourceRows[0]-b.sourceRows[0]);
 if(limit===1&&timed.length)return[timed[0]];
 // Start with the most multi-dimensional real failure, then cover uncovered frozen categories.
 add(sorted[0]);
 for(const dimension of snapshot.basis.dimensions||[])if(!selected.some(row=>row.final.some(item=>item.verdict==='Fail'&&dimension.ruleIds.includes(item.id)))&&selected.length<limit-(timed.length&&!selected.some(row=>row.id===timed[0].id)?1:0))add(sorted.find(row=>row.final.some(item=>item.verdict==='Fail'&&dimension.ruleIds.includes(item.id))));
 add(timed[0]);sorted.forEach(add);return selected;
}
