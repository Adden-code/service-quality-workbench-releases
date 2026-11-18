import {configuredDelivery,buildSceneReportHtml} from './scene-delivery.mjs';
import {hasReviewPolicy,triageReportNotice} from './triage-export.mjs';
import {selectConsultationErrorCases,consultationConfiguration} from './consultation-delivery.mjs';
import {selectConsultationCaseExcerpts} from './consultation-excerpts.mjs';
import {CONVERSATION_UNVERIFIED,unverifiedRoleEvidence,assertRoleEvidenceSupport,roleEvidenceNotice,groundedConversationQuote} from './role-evidence.mjs';
import {escapeHTML as e} from './ui.mjs';
import {formatBusinessReason} from './business-delivery.mjs';
import {buildEnglishReportHtml} from './report-english-html.mjs';
import {reusableEnglishBaseTranslation} from './translation-language.mjs';
import {isRawReport,groundedRawReportQuote,rawEvidenceText,validateRawReportRecord} from './raw-report-evidence.mjs';
import {reportStyles,reportTable as table,rateComparisonCell,metadataHtml,caseFindingsHtml,directionHtml,clusterReasonCell,invalidFeedbackHtml,verdictHtml} from './report-presentation.mjs';

const array=value=>Array.isArray(value)?value:[];
const unique=value=>[...new Set(value)];
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const rate=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':`${Math.round(Number(value)*10)/10}%`;
const langLabel=value=>value==='en'?'英文':'中文';
const idOf=item=>item.ruleId||item.id;
const rowsOf=record=>array(record.sourceRows).join('、')||'未提供';
const finalPolicy=snapshot=>hasReviewPolicy(snapshot)?snapshot.basis.finalPolicy:snapshot.conclusionMode==='ai'?'仅采用AI初判':'工作台本次已确认复核 > AI初判（未确认草稿不参与）';
const sourceLabel=source=>source==='confirmed'?'本次工作台已确认复核':source==='ai'?'AI初判':source==='ai_final'?'AI终判':source==='pending_human'?'待人工':'无可用结论';
const note=(text,warning=false)=>`<p class="note${warning?' warning':''}">${e(text)}</p>`;
const failed=record=>array(record.final).filter(item=>item.verdict==='Fail');
const dimensions=snapshot=>array(snapshot.basis?.dimensions);
const ruleCategory=(snapshot,item)=>item.category||array(snapshot.basis?.rules).find(rule=>rule.id===idOf(item))?.category||'未分类';
const isDimensionFailure=(snapshot,record,category)=>failed(record).some(item=>ruleCategory(snapshot,item)===category&&dimensions(snapshot).some(dimension=>dimension.key===category&&array(dimension.ruleIds).includes(idOf(item))));
const customerRole=role=>['客户','用户','customer','user'].includes(String(role??'').toLowerCase());
const groundedQuote=(record,quote,turnId,mode)=>isRawReport(record)?groundedRawReportQuote(record,quote):mode===CONVERSATION_UNVERIFIED?groundedConversationQuote(record,quote,turnId):typeof quote==='string'&&quote.trim()&&array(record.turns).some(turn=>customerRole(turn.role)&&(turnId===undefined||String(turn.id)===String(turnId))&&String(turn.text??'').includes(quote));

function frozenMetadata(snapshot){
  const basis=snapshot.basis||{},range=basis.conversationTimeRange,versions=new Map();
  for(const rule of array(basis.rules)){const version=typeof rule.version==='string'&&rule.version.trim()?rule.version:'版本未提供';versions.set(version,(versions.get(version)||0)+1);}
  const validRange=typeof range?.from==='string'&&typeof range?.to==='string'&&Number.isFinite(Date.parse(range.from))&&Number.isFinite(Date.parse(range.to));
  const time=validRange?`${range.from} 至 ${range.to}（已提供${number(range.provided)}条，缺失${number(range.missing)}条）`:`未提供（缺失${range?number(range.missing):number(snapshot.metrics.total)}条）`;
  const taxonomy=array(basis.policies).filter(policy=>String(policy.category??'').trim()==='分类体系'||String(policy.title??'').includes('分类体系'));
  const products=basis.productSourceCounts&&typeof basis.productSourceCounts==='object'?['原表列','任务默认','未提供'].map(source=>`${source}${number(basis.productSourceCounts[source])}条`).join(' / '):'来源计数未保存';
  return{time,versions:[...versions].map(([version,count])=>`${version}：${count}项`).join('；')||'未保存冻结规则版本',taxonomy,taxonomyLabel:taxonomy.length?taxonomy.map(policy=>`${policy.id}@${policy.version||'版本未提供'}`).join('；'):'未配置分类体系',products};
}

function translatedExcerpt(enrichment,record,turn,targetLang){
  const value=enrichment.translations?.[record.id]?.[`excerpt-${turn.id}`];
  if(targetLang==='en'&&['same','translated'].includes(value?.status)&&!reusableEnglishBaseTranslation(turn.text,value))return'<p class="missing" data-translation-status="failed"><span class="translation-label">译：</span>[Translation failed]</p>';
  if(value?.status==='same')return`<p class="translation" data-translation-status="same"><span class="translation-label">译：</span>${targetLang==='en'?e(turn.text):'（同原文）'}</p>`;
  if(value?.status==='translated'&&typeof value.text==='string'&&value.text.trim())return`<p class="translation" data-translation-status="translated"><span class="translation-label">译：</span>${e(value.text)}</p>`;
  return`<p class="missing" data-translation-status="${value?.status==='failed'?'failed':'pending'}"><span class="translation-label">译：</span>${value?.status==='failed'?'译文缺失（翻译失败）':'译文缺失（尚未完成）'}</p>`;
}
function clusters(snapshot,enrichment){
  const records=new Map(snapshot.records.map(record=>[record.id,record])),groups=[],seenByCategory=new Map();
  for(const item of array(enrichment.issueClusters)){
    const category=item.category||dimensions(snapshot).find(dimension=>dimension.key===item.ruleId)?.key||array(snapshot.basis?.rules).find(rule=>rule.id===item.ruleId)?.category;
    if(!dimensions(snapshot).some(dimension=>dimension.key===category))continue;
    if(!seenByCategory.has(category))seenByCategory.set(category,new Set());const seen=seenByCategory.get(category);
    const ids=unique(array(item.memberIds)).filter(id=>records.has(id)&&!seen.has(id)&&isDimensionFailure(snapshot,records.get(id),category));
    if(!ids.length)continue;ids.forEach(id=>seen.add(id));
    groups.push({category,label:item.label||'原因待归类',summary:item.summary||'',ids,action:typeof item.action==='string'?item.action:''});
  }
  return groups.sort((a,b)=>b.ids.length-a.ids.length);
}
function casesHtml(snapshot,enrichment,cases,groups){
  if(!cases.length)return note('当前口径暂无已判定不通过案例；NA和待判定单列，不视为通过。');
  const config=consultationConfiguration(snapshot);
  return note(`按冻结规则的实际维度覆盖，展示${cases.length}条错误案例（最多10条）；不足10条按实际展示。`)+cases.map((record,index)=>{
    const excerpts=selectConsultationCaseExcerpts(record),results=failed(record),analysis=enrichment.consultationAnalysis?.[record.id],ready=analysis?.status==='completed';
    const evidenceTable=caseFindingsHtml(results.map(item=>({dimension:`${item.label||idOf(item)} / ${ruleCategory(snapshot,item)}`,reason:formatBusinessReason(item.reason||'未保存判定理由',{maxChars:500}),evidence:isRawReport(record)?rawEvidenceText(item)||'未提供可定位原文引文':array(item.evidence).join('、')||'未提供直接证据轮次',source:sourceLabel(item.source)})));
    const directions=unique(results.map(item=>ruleCategory(snapshot,item))).map(category=>({category,actions:unique(groups.filter(group=>group.category===category&&group.ids.includes(record.id)&&group.action.trim()).map(group=>group.action))}));
    return `<article class="case"><div class="case-head"><span class="case-index">${String(index+1).padStart(2,'0')}</span><div><h3>原表行 ${e(rowsOf(record))} · ${e(record.product||'未提供')}</h3><div class="tags">${unique(results.map(item=>ruleCategory(snapshot,item))).map(category=>`<span class="failure-badge">${e(category)}<span class="badge-verdict">不通过</span></span>`).join('')}</div><p class="case-meta">会话：${e(record.externalId||record.id)} · 产品来源：${e(record.productSource||'未提供')}${record.productColumn?`（${e(record.productColumn)}）`:''}</p></div></div>${config.custom?selectedCaseAnalysis(config,analysis,record,enrichment,snapshot.roleEvidenceMode):ready?note(`销售阶段：${[analysis.salesStage,analysis.salesSubstage].filter(Boolean).join(' / ')||'未提供'}；核心意图：${analysis.intentLabel||'未提供'}；诉求总结：${analysis.demandSummary||'未提供'}`):note('本条会话分析尚未完成，暂不生成销售阶段、意图或诉求总结。',true)}<h4>${unverifiedRoleEvidence(snapshot)?'会话原文选摘（角色未核验）':'关键原文选摘'}</h4>${excerpts.length?excerpts.map(turn=>`<div class="excerpt"><p class="turn-label">${turn.raw?'原文引文':`第${e(turn.id)}轮`} · ${unverifiedRoleEvidence(snapshot)?'原角色':''}${e(turn.role)}${unverifiedRoleEvidence(snapshot)?' · 角色未核验':''} · ${turn.raw?'逐字定位原表单元格':turn.basis==='evidence'?'不通过项引用轮次':'上下文选摘，非直接违规引用'}</p><p>${turn.raw?`<mark class="raw-quotation">${e(turn.text)}</mark>`:e(turn.text)}</p><h4>关键原文选摘翻译（${langLabel(snapshot.targetLang)}）</h4>${translatedExcerpt(enrichment,record,turn,snapshot.targetLang)}</div>`).join(''):note('没有可定位的客户/客服选摘，需回到原始会话核对；未拼造违规原文。',true)}${note('HTML仅展示关键原文选摘；完整消息详情及整会话译文保留在业务Excel。')}<h4>逐项问题与证据</h4>${evidenceTable}${record.summary?`<p class="summary">${e(record.summary)}</p>`:''}${config.report.sections.includes('improvements')?`<h4>改进方向（模型辅助）</h4>${directions.map(direction=>directionHtml(direction.category,direction.actions.length?direction.actions.join('；'):'改进方向尚未生成，请结合冻结规则及原文人工复核。')).join('')}`:''}</article>`;
  }).join('');
}
function selectedCaseAnalysis(config,analysis,record,enrichment,mode){
 const labels={salesStage:'销售环节',intent:'核心意图',demandSummary:'诉求总结',negativeVoice:mode===CONVERSATION_UNVERIFIED?'负面会话原文（角色未核验）':'用户负面原声'},values={salesStage:[analysis?.salesStage,analysis?.salesSubstage].filter(Boolean).join(' / '),intent:analysis?.intentLabel,demandSummary:analysis?.demandSummary,negativeVoice:array(analysis?.negativeVoices).filter(voice=>groundedQuote(record,voice.quote,voice.turnId,mode)).map(voice=>`${isRawReport(record)?'原文引文 · 角色未核验':`第${voice.turnId}轮`}：${voice.quote}`).join('；')||'未识别到负向声音'};
 let result=config.analysisFields.length?note(analysis?.status==='completed'?config.analysisFields.map(key=>`${labels[key]}：${values[key]||'未提供'}`).join('；'):'本条已选择的会话分析尚未完成。',analysis?.status!=='completed'):'';
 const entry=enrichment.scenarioFields?.[record.id];
 if(config.customFields.length)result+=table(['自定义分析字段','辅助结果'],config.customFields.map(field=>{const value=entry?.fields?.find(item=>item.id===field.id);return[field.label,entry?.status!=='completed'?(entry?.status==='failed'?'AI字段分析失败':'AI字段分析未完成'):!value||value.missing?'未提供':field.type==='quote'?(groundedQuote(record,value.value,value.turnId)?`${isRawReport(record)?'原文引文 · 角色未核验':`第${value.turnId}轮`}：${value.value}`:'原声证据无效，待复核'):value.value];}));
 return result;
}
function issuesHtml(snapshot,enrichment,groups){
  const byId=new Map(snapshot.records.map(record=>[record.id,record]));
  const counts=dimensions(snapshot).map(dimension=>({dimension,ids:snapshot.records.filter(record=>isDimensionFailure(snapshot,record,dimension.key)).map(record=>record.id)})).filter(row=>row.ids.length).sort((a,b)=>b.ids.length-a.ids.length);
  if(!counts.length)return note('当前实际维度暂无已判不通过记录；NA、待判定及整体原则项保留各自状态，不据此宣称全部合格。');
  const groupTable=groups.length?table(['维度','涉及条数','典型原因 / 痛点概括 / 改进动作'],groups.map(group=>[group.category,group.ids.length,clusterReasonCell(group.label,group.ids.map(id=>rowsOf(byId.get(id))).join('；'),[group.summary,group.action].filter(Boolean).join('；'))])):note('原因聚类尚未完成；以下仅展示本地不通过计数，改进方向尚未生成。',true);
  const actions=counts.slice(0,3).map((row,index)=>{
    const choices=unique(groups.filter(group=>group.category===row.dimension.key&&group.action.trim()).map(group=>group.action));
    return`<li><h4>${index+1}. ${e(row.dimension.label||row.dimension.key)} · 涉及${row.ids.length}条</h4><p>${choices.length?e(choices.join('；')):'改进方向尚未生成，请结合冻结规则及原文人工复核。'}</p></li>`;
  }).join('');
  return table(['实际维度','最终不通过会话数'],counts.map(row=>[row.dimension.label||row.dimension.key,row.ids.length]))+groupTable+`<h3>Top 3 改进建议</h3>${counts.length<3?note(`当前只有${counts.length}个不通过维度，不补造其他方向。`):''}<ol class="actions">${actions}</ol>`+note('一条会话可命中多个维度，各维度数量不直接相加为会话总数；统计使用已知记录去重，不使用模型自报数量。');
}
const sentimentClass=value=>['负向','负面','negative'].includes(value)?'negative':['中性','中立','中评','neutral'].includes(value)?'neutral':['正向','正面','positive'].includes(value)?'positive':'unknown';
function vocHtml(snapshot,enrichment){
  const unverified=unverifiedRoleEvidence(snapshot);
  const scope=[],outside=[],unknown=[],valid=[],invalid=[],pending=[];
  for(const record of snapshot.records){
    const analysis=enrichment.consultationAnalysis?.[record.id],kind=analysis?.status==='completed'?sentimentClass(analysis.sentiment):'unknown';
    if(kind==='unknown'){unknown.push(record);continue;}if(kind==='positive'){outside.push(record);continue;}
    scope.push(record);const item=analysis.voc;
    if(item?.valid===true&&typeof item.scene==='string'&&item.scene.trim()&&typeof item.painPoint==='string'&&item.painPoint.trim()&&groundedQuote(record,item.evidenceQuote,undefined,snapshot.roleEvidenceMode))valid.push({record,item,analysis});
    else if(item?.valid===false&&typeof item.reason==='string'&&item.reason.trim())invalid.push({record,item,analysis});
    else pending.push(record);
  }
  const groups=new Map();for(const row of valid){if(!groups.has(row.item.scene))groups.set(row.item.scene,[]);groups.get(row.item.scene).push(row);}
  const unfinished=snapshot.records.filter(record=>enrichment.consultationAnalysis?.[record.id]?.status!=='completed').length;
  const intro=unverified?note(`会话诉求线索 · 角色未核验：会话分析尚未完成${unfinished}条；负向与中性会话线索${scope.length}条，范围外${outside.length}条；情绪范围未确定${unknown.length}条，具体线索${valid.length}条、无具体痛点${invalid.length}条、详情未完成${pending.length}条。上述数量不是已确认客户VOC统计，发言方均待核验。`,true):note(`会话分析尚未完成${unfinished}条；已确认负向与中性范围${scope.length}条，范围外${outside.length}条（正向）；VOC范围尚有${unknown.length}条待分析确认。已纳入范围内有效${valid.length}条、无效${invalid.length}条、VOC详情未完成${pending.length}条。`,!!(unknown.length||pending.length));
  const data=groups.size?table([unverified?'会话诉求场景（角色未核验）':'吐槽场景','痛点概括','会话数','涉及原表行号'],[...groups].sort((a,b)=>b[1].length-a[1].length).map(([scene,rows])=>[scene,unique(rows.map(row=>row.item.painPoint)).join('；'),rows.length,rows.map(row=>rowsOf(row.record)).join('；')])):note(unverified?'暂无可定位的具体会话诉求线索；角色未核验，缺失分析不表示没有诉求。':unknown.length||pending.length?'VOC分析尚未完成；尚无已核实的有效场景，不能推断用户没有负面诉求。':'已完成的负向/中性记录暂无有效具体痛点场景。',!!(unknown.length||pending.length));
  const voices=scope.flatMap(record=>{const analysis=enrichment.consultationAnalysis?.[record.id];return array(analysis?.negativeVoices).filter(voice=>groundedQuote(record,voice.quote,voice.turnId,snapshot.roleEvidenceMode)).map(voice=>[rowsOf(record),isRawReport(record)?'原文引文 · 角色未核验':`第${voice.turnId}轮${unverified?` · 原角色${record.turns.find(turn=>turn.id===voice.turnId)?.role} · 角色未核验`:''}`,voice.quote]);});
  const voiceTable=voices.length?`<h3>${unverified?'负面会话原文（角色未核验）':'负面用户原声（已定位原文）'}</h3>${table(['原表行号','原文轮次',unverified?'会话原文（角色未核验）':'客户原声'],voices)}`:note(unverified?'尚无可定位的负面会话线索；缺失分析不代表没有诉求。':unfinished?'负面用户原声尚待会话分析完成，不把缺失分析写成无负声。':'已完成范围内未提取到可核对的负面用户原声。',!!unfinished);
  const invalidTable=invalid.length?`<h3>无效评价 / 无具体痛点</h3>${invalidFeedbackHtml(invalid.map(row=>({sourceRows:rowsOf(row.record),reason:row.item.reason})),{reason:'原因'})}`:'';
  return intro+data+voiceTable+invalidTable;
}
const styles=reportStyles;

function analysisCompletionNotice(snapshot,enrichment,job,config){
  const messages=[],countStatus=entries=>{
    let failed=0,pending=0;for(const record of snapshot.records){const status=entries?.[record.id]?.status;if(status==='failed')failed++;else if(status!=='completed')pending++;}return{failed,pending};
  };
  if(config.analysisFields.length||config.report.sections.includes('voc')){
    const counts=countStatus(enrichment.consultationAnalysis);if(counts.failed||counts.pending)messages.push(`会话分析失败${counts.failed}条，未完成${counts.pending}条`);
  }
  if(config.customFields.length){
    const counts=countStatus(enrichment.scenarioFields);if(counts.failed||counts.pending)messages.push(`自定义字段提取失败${counts.failed}条，未完成${counts.pending}条`);
    const missing=snapshot.records.reduce((total,record)=>{const entry=enrichment.scenarioFields?.[record.id];return total+(entry?.status==='completed'?config.customFields.filter(field=>!entry.fields?.some(item=>item.id===field.id&&!item.missing)).length:0);},0);
    if(missing)messages.push(`自定义字段证据不足或未提供${missing}项`);
  }
  const warnings=array(enrichment.warnings),issues=config.report.sections.includes('improvements')?warnings.filter(warning=>warning.kind==='consultationIssues').length:0;
  if(issues)messages.push(`原因归纳失败${issues}个节点`);
  const known=new Set(['translation','consultationAnalysis','scenarioFields','consultationIssues']),other=warnings.filter(warning=>!known.has(warning.kind)).length;
  if(other)messages.push(`其他辅助分析提示${other}项`);
  if(!messages.length&&['completed_with_warnings','failed'].includes(job.status||enrichment.status)&&warnings.some(warning=>warning.kind!=='translation'))messages.push('辅助分析存在缺失或失败内容');
  return messages.length?`<aside class="notice">${e(messages.join('；'))}。缺失内容保留在业务明细中，可回到工作台查看节点并重试；缺失分析不得解释为无问题。</aside>`:'';
}

export function buildConsultationReportHtml(snapshot,enrichment={},options={}){
 if(configuredDelivery(snapshot))return buildSceneReportHtml(snapshot,enrichment,options);
  assertRoleEvidenceSupport(snapshot,consultationConfiguration(snapshot));
  if(isRawReport(snapshot))for(const record of snapshot.records)validateRawReportRecord(record,snapshot.original,snapshot.source);
  if(snapshot?.schemaVersion!==1||snapshot.deliveryType!=='consultation-v1'||!Array.isArray(snapshot.records)||!snapshot.metrics)throw new Error('新品咨询交付快照无效。');
  if(options.language==='en'){const config=consultationConfiguration(snapshot);return buildEnglishReportHtml(snapshot,enrichment,options,{config,cases:config.report.sections.includes('cases')?selectConsultationErrorCases(snapshot,10):[]});}
  const config=consultationConfiguration(snapshot),metrics=snapshot.metrics,basis=snapshot.basis||{},job=options.job||{},groups=config.report.sections.includes('improvements')?clusters(snapshot,enrichment):[],cases=config.report.sections.includes('cases')?selectConsultationErrorCases(snapshot,10):[],stats=enrichment.translationStats||{},partial=['pending','running','paused'].includes(job.status);
  const metadata=frozenMetadata(snapshot);
  const stat=(label,value,detail='',failure=false)=>`<div class="stat${failure?' failure':''}"><span>${verdictHtml(label)}</span><strong>${e(value)}</strong>${detail?`<small>${e(detail)}</small>`:''}</div>`;
  const section=(id,index,title,body)=>`<section class="report-section" id="${id}"><h2><span class="section-number">${String(index).padStart(2,'0')}</span>${e(title)}</h2>${body}</section>`;
  const overview=`<div class="stats">${stat('总会话数',metrics.total,'冻结样本')}${stat('合格',metrics.passed,'最终整体通过')}${stat('不合格',metrics.failed,'至少一项Fail',true)}${stat('整体通过率',rate(metrics.passRate),`质量分母 ${number(metrics.determinate)}条`)}</div>${note(`NA ${number(metrics.na)}条；待判定${number(metrics.pending)}条。通过率=通过/(通过+不通过)，NA及待判定不进入分母；任一Fail优先，全部NA为NA，存在未知状态不自动判通过。`)}${metrics.passRate===null?note('暂无可判定质量结论，不计算通过率。',true):''}${note(`本次人工纠正${number(metrics.correctedRecords)}条；仅使用已确认复核，未确认草稿不参与。原表历史人工结论映射未配置，本场景不使用电商评论原表人工列。`)}`;
  const product=table(['产品','会话数','合格','不合格','NA','待判定','质量分母','通过率'],array(metrics.byProduct).map(row=>[row.product||'未提供',row.total,row.passed,row.failed,row.na,row.pending,row.determinate,rate(row.passRate)]))+table(['产品来源','会话数'],Object.entries(basis.productSourceCounts||{}))+note('产品按已有原表映射或任务默认值分组；未提供的单列，不推测产品，不增加导出产品配置。');
  const dimensionStats=array(metrics.dimensionStats).filter(row=>dimensions(snapshot).some(dimension=>dimension.key===(row.key||row.category||row.label)));
  const dimension=`${table(['实际规则类别','AI通过率','最终通过率','最终不通过','NA','待判定','最终质量分母','通过率对比'],dimensionStats.map(row=>[row.label||row.key,rate(row.ai?.passRate),rate(row.final?.passRate),row.final?.failed,row.final?.na,row.final?.pending,row.final?.denominator,rateComparisonCell(row.ai?.passRate,row.final?.passRate)]))}${note(`本任务${array(basis.rules).length}条冻结检查项、${dimensions(snapshot).length}个实际维度；整体判定原则保留在明细列及整体结论中，不计入维度通过率。每个维度按通过+不通过为分母，NA和待判定单列。`)}`;
  const notices=(partial?`<aside class="notice">交付分析尚未完成。当前文件为已保存快照，未完成的译文与分析均明确标记。</aside>`:'')+(number(stats.failedTexts)||number(stats.pendingTexts)?`<aside class="notice">翻译失败${number(stats.failedTexts)}段，尚未完成${number(stats.pendingTexts)}段；失败影响${number(stats.affectedRecords)}条记录，缺译文共涉及${number(stats.missingRecords)}条记录。翻译缺失不以“同原文”替代。</aside>`:'')+analysisCompletionNotice(snapshot,enrichment,job,config);
  const confirmed=snapshot.records.filter(record=>array(record.confirmed).some(item=>item.source==='confirmed')).length;
  const breakdown=config.custom?table([config.report.groupLabel,'会话数','合格','不合格','NA','待判定','质量分母','通过率'],array(metrics.byGroup).map(row=>[row.value||'未提供',row.total,row.passed,row.failed,row.na,row.pending,row.determinate,rate(row.passRate)]))+note(`${basis.grouping?.policy||'按冻结来源分组。'} 缺失${number(basis.grouping?.missing)}条；分组字段：${config.report.groupBy==='context'?config.report.groupField:config.report.groupBy==='agent'?'客服':'产品'}。`):product;
  const modules={overview:{id:'quality-overview',title:'总体质检概况',body:()=>overview},breakdown:{id:'product-quality',title:`按${config.report.groupLabel}质检概况`,body:()=>breakdown},dimensions:{id:'dimension-results',title:'实际规则类别通过情况',body:()=>dimension},cases:{id:'typical-cases',title:'错误案例 · 最多10条',body:()=>casesHtml(snapshot,enrichment,cases,groups)},improvements:{id:'issue-clusters',title:'不合格原因聚类与Top 3改进建议',body:()=>issuesHtml(snapshot,enrichment,groups)},voc:{id:'voice-of-customer',title:unverifiedRoleEvidence(snapshot)?'会话诉求线索 · 角色未核验':'用户原声VOC · 负向与中性',body:()=>vocHtml(snapshot,enrichment)}};
  const sectionsHtml=['overview','breakdown','dimensions','cases','improvements','voc'].filter(key=>config.report.sections.includes(key)).map((key,index)=>section(modules[key].id,index+1,modules[key].title,modules[key].body())).join('');
  const fieldNames=unverifiedRoleEvidence(snapshot)?{salesStage:'销售环节',intent:'会话意图线索（角色未核验）',demandSummary:'会话诉求线索（角色未核验）',negativeVoice:'负面会话原文（角色未核验）'}:{salesStage:'销售环节',intent:'用户意图',demandSummary:'用户诉求总结',negativeVoice:'用户负面原声'};
  const configurationNote=config.custom?note(`场景：${config.scenario.name}（${config.scenario.id}，版本${config.scenario.version}）；报告标题：${config.report.title}；分组：${config.report.groupLabel}；启用模块：${config.report.sections.map(key=>modules[key].title).join('、')}；分析字段：${[...config.analysisFields.map(key=>fieldNames[key]),...config.customFields.map(field=>field.label)].join('、')||'未选择'}。`):'';
  return`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(config.report.title)} · ${e(snapshot.taskName)}</title><style>${styles}</style></head><body><main class="report"><header><div class="report-banner"><div class="eyebrow">MSS QUALITY WORKBENCH · BUSINESS DELIVERY</div><h1>${e(config.report.title)}</h1><p>${e(snapshot.taskName)}</p>${unverifiedRoleEvidence(snapshot)?`<p class="role-evidence-notice">${e(roleEvidenceNotice('zh',snapshot))}</p>`:''}${metadataHtml([['数据来源',`${snapshot.source?.name||'未提供'} · ${snapshot.original?.sheetName||'未提供工作表'}`],['会话开始时间范围',metadata.time],['结论口径',finalPolicy(snapshot)]],[['样本量 / 生成时间',`${number(metrics.total)}条 · ${snapshot.createdAt}`],['规则版本',metadata.versions],['分类体系依据',metadata.taxonomyLabel],['翻译语种',langLabel(snapshot.targetLang)],['产品来源',metadata.products]])}</div></header>${triageReportNotice(snapshot)}${notices}${sectionsHtml}<footer class="report-footer"><h2>附注</h2>${unverifiedRoleEvidence(snapshot)?note(roleEvidenceNotice('zh',snapshot),true):''}${configurationNote}<h3>冻结规则与来源声明</h3>${note(`以下规则ID与版本均来自任务冻结快照；依据生效日期：${basis.effectiveDate||'未提供'}。`)}${table(['检查项','名称','实际类别','版本'],array(basis.rules).map(rule=>[rule.id,rule.title||rule.name||rule.id,rule.category||'未分类',rule.version||'未提供']))}<h3>分类体系依据</h3>${metadata.taxonomy.length?table(['资料ID','名称','版本'],metadata.taxonomy.map(policy=>[policy.id,policy.title||policy.id,policy.version||'未提供'])):note('未配置分类体系；核心意图不得自行补造分类。',true)}<p>整体判定原则仍参与整体结论，不进入实际动作维度通过率；不会因其他检查项的人工改判自动重算，需逐项确认本次最终结果。</p><p>会话开始时间范围来自已保存会话时间，缺失数量单列，不使用报告生成时间替代。</p><p>生成环境：${e(options.environment||'本机独立工作台')}。本报告与业务Excel使用同一冻结快照，生成后的工作区修改不自动改写本文件。完整会话原文与整会话译文仅在业务Excel保留。</p><p>最终优先级：${e(finalPolicy(snapshot))}。本次已确认复核记录${confirmed}条；原表历史人工结论映射未配置，未确认草稿不构成最终复核。未确认的最终AI结论不能概称已人工审核。</p><p>${config.custom?'翻译与本次启用的分析字段、报告模块由模型辅助生成，需结合原文核对；缺失分析不得解释为无问题。':'翻译、销售阶段与意图、诉求摘要、原因聚类和VOC由模型辅助生成，需结合原文核对；缺失分析不得解释为无负声或无问题。'}没有可验证时间事实时不推导超时程度。</p>${snapshot.source?.sha256?`<p class="file-id">来源SHA-256：${e(snapshot.source.sha256)}</p>`:''}${job.snapshotFingerprint?`<p class="file-id">快照指纹：${e(job.snapshotFingerprint)}</p>`:''}</footer></main></body></html>`;
}
