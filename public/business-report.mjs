import {configuredDelivery,buildSceneReportHtml} from './scene-delivery.mjs';
import {hasReviewPolicy,triageReportNotice} from './triage-export.mjs';
import {BUSINESS_RULES,selectBusinessErrorCases,formatBusinessReason} from './business-delivery.mjs';
import {escapeHTML as e} from './ui.mjs';
import {buildConsultationReportHtml} from './consultation-report.mjs';
import {buildEnglishReportHtml} from './report-english-html.mjs';
import {reusableEnglishBaseTranslation} from './translation-language.mjs';
import {reportStyles,reportTable as table,rateComparisonCell,metadataHtml,caseFindingsHtml,directionHtml,clusterReasonCell,invalidFeedbackHtml,verdictHtml} from './report-presentation.mjs';

const langLabel=lang=>lang==='en'?'英文':'中文';
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const rate=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':`${Math.round(Number(value)*10)/10}%`;
const values=value=>Array.isArray(value)?value:[];
const unique=value=>[...new Set(value)];
const list=value=>values(value).length?unique(value).join('、'):'未提供';
const ruleId=item=>item.ruleId||item.id;
const sourceText=source=>({'confirmed':'本次工作台已确认复核','historical':'原表历史人工参考','ai':'AI初判','ai_final':'AI终判','pending_human':'待人工','none':'无可用结论'})[source]||'未说明';
const finalPolicy=snapshot=>hasReviewPolicy(snapshot)?snapshot.basis.finalPolicy:snapshot.conclusionMode==='ai'?'仅采用AI初判':'工作台本次已确认复核 > 原表历史人工结论 > AI初判';
const textTable=table;
const note=(text,kind='')=>`<p class="note ${kind}">${e(text)}</p>`;
const itemFor=(record,id,group='final')=>values(record[group]).find(item=>ruleId(item)===id);
const failures=record=>record.replyStatus==='unreplied'?[]:values(record.final).filter(item=>item.verdict==='不通过');
const translated=(enrichment,record,key,targetLang)=>{
  const raw=key==='comment'?record.raw22?.[8]:key==='reply'?record.raw22?.[9]:record.humanIssue;
  const entry=enrichment.translations?.[record.id]?.[key];
  if(!String(raw??'').trim())return{status:'empty',text:'',label:'原文为空'};
  if(targetLang==='en'&&['same','translated'].includes(entry?.status)&&!reusableEnglishBaseTranslation(raw,entry))return{status:'failed',text:'',label:'[Translation failed]'};
  if(entry?.status==='same')return{status:'same',text:targetLang==='en'?raw:'（同原文）',label:''};
  if(entry?.status==='translated'&&typeof entry.text==='string'&&entry.text.trim())return{status:'translated',text:entry.text,label:''};
  if(entry?.status==='failed')return{status:'failed',text:'',label:'译文缺失（翻译失败）'};
  return{status:'pending',text:'',label:'译文缺失（尚未完成）'};
};
const translationHtml=(enrichment,record,key,targetLang)=>{const value=translated(enrichment,record,key,targetLang);return value.text?`<p class="translation" data-translation-status="${value.status}"><span class="translation-label">译：</span>${e(value.text)}</p>`:`<p class="missing" data-translation-status="${value.status}"><span class="translation-label">译：</span>${e(value.label)}</p>`;};
function translationWarnings(snapshot,enrichment,errorCases){
  const fields=snapshot.records.flatMap(record=>[['comment',record],['reply',record]]);
  for(const record of errorCases)fields.push(['humanIssue',record]);
  let failed=0,pending=0;const affected=new Set();
  for(const[key,record]of fields){const value=translated(enrichment,record,key,snapshot.targetLang);if(value.status==='failed'){failed++;affected.add(record.id);}if(value.status==='pending'){pending++;affected.add(record.id);}}
  return{failed,pending,affected:affected.size};
}
function durationLabel(value){return typeof value==='number'&&Number.isFinite(value)?`${(value/3600000).toFixed(1)}小时`:'未取得有效累计时长';}
function basisHtml(snapshot){
  const basis=snapshot.basis||{},thresholds=basis.timeThresholds||{};
  const thresholdText=[thresholds.default!==null&&thresholds.default!==undefined?`默认${thresholds.default}小时`:'',...Object.entries(thresholds.byType||{}).map(([key,value])=>`${key}${value}小时`)].filter(Boolean).join('；')||'按各来源记录冻结阈值';
  return `<section class="basis"><h3>实际使用的规则与时效口径</h3>${textTable(['项目','冻结值'],[
    ['来源工作表',snapshot.sourceSheet?.name??'Sheet4'],['来源工作表序号',snapshot.sourceSheet?.index??'旧记录未保存'],['原始扩展列数',snapshot.extensions?.headers?.length??0],['执行阶段',basis.phaseLabel||'Sheet4 V1'],['规则集',`${basis.ruleSetId||'任务冻结依据'} ${basis.ruleSetVersion||''}`],['AI时效口径',`${basis.timeModeLabel||basis.timeMode||'任务冻结时效'}；${basis.timezone||'UTC+08:00'}`],['AI时效阈值',thresholdText],['逐行检核截止点',values(basis.inspectionAts).join('；')||'未保存或尚未执行'],['历史人工口径',basis.historicalPolicy||'原表历史人工结论，可能来自旧口径'],['最终取值优先级',finalPolicy(snapshot)],
  ])}${basis.timeMode==='workingHours'?note(basis.calendarConfirmed?'工作日历已标记为业务核对。':'工作日历尚未核对，仅按任务冻结配置试算；不代表已排除实际法定节假日。','warning'):''}</section>`;
}
function caseText(record,enrichment,targetLang){
  const target=langLabel(targetLang);
  return `<div class="case-text"><div><h4>用户评价原文</h4><p>${e(record.raw22?.[8]||'原文为空')}</p><h4>评价翻译（${target}）</h4>${translationHtml(enrichment,record,'comment',targetLang)}</div><div><h4>坐席回复原文</h4><p>${e(record.raw22?.[9]||'原文为空')}</p><h4>回复翻译（${target}）</h4>${translationHtml(enrichment,record,'reply',targetLang)}</div></div>`;
}
function errorCasesHtml(snapshot,enrichment,cases){
  if(!cases.length)return note('当前口径暂无最终不通过记录。待判定和未回复不据此视为质量通过。');
  return `${cases.length<10?note(`当前可用${cases.length}条错误案例，少于10条，按实际记录展示。`):''}${cases.map((record,index)=>{
    const failed=failures(record);
    return `<article class="case error-case"><div class="case-head"><span class="case-index">${String(index+1).padStart(2,'0')}</span><div><h3>原表行 ${e(record.sourceRow)} · ${e(record.evaluationType||'未归类')}</h3><div class="tags">${failed.map(item=>`<span class="failure-badge">${e(item.label||BUSINESS_RULES.find(rule=>rule.id===ruleId(item))?.label||ruleId(item))}<span class="badge-verdict">不通过</span></span>`).join('')}</div><p class="case-meta">评价类型：${e(record.evaluationType||'未归类')}${record.product?` · 产品：${e(record.product)}`:''} · 原表行：${e(record.sourceRow)}</p></div></div>${caseText(record,enrichment,snapshot.targetLang)}<h4>逐维度问题点评</h4>${caseFindingsHtml(failed.map(item=>({dimension:item.label||ruleId(item),...(item.category?{category:item.category}:{}),reason:formatBusinessReason(item.reason||'未提供逐项理由',{record,ruleId:ruleId(item)}),...(values(item.evidence).length?{evidence:values(item.evidence).join('、')}:{}),source:sourceText(item.source)})))}${record.summary?`<p class="summary">${e(record.summary)}</p>`:''}${record.timeFacts?note(`本地时效：${durationLabel(record.timeFacts.elapsedMs)}；阈值${record.timeFacts.thresholdHours??'未取得'}小时。`):''}<h4>人工问题点描述（${langLabel(snapshot.targetLang)}）</h4>${translationHtml(enrichment,record,'humanIssue',snapshot.targetLang)}<h4>改进方向</h4>${failed.map(item=>directionHtml(item.label||ruleId(item),BUSINESS_RULES.find(rule=>rule.id===ruleId(item))?.improvement||'按冻结标准核对原文，补齐依据后由人工复核。')).join('')}</article>`;
  }).join('')}`;
}
function excellentCasesHtml(snapshot,enrichment){
  const candidates=snapshot.records.filter(record=>record.replyStatus!=='unreplied'&&record.evaluationType==='好评正向'&&record.finalOverall==='通过'&&values(record.final).length===5&&record.final.every(item=>item.verdict==='通过'));
  const byId=new Map(candidates.map(record=>[record.id,record])),seen=new Set();
  const cases=values(enrichment.excellentCases).filter(item=>{
    const record=byId.get(item.id);
    if(!record||seen.has(item.id)||typeof item.commentary!=='string'||!item.commentary.trim()||typeof item.quote!=='string'||!item.quote.trim()||!record.raw22?.[9]?.includes(item.quote))return false;
    seen.add(item.id);return true;
  }).sort((a,b)=>number(b.score)-number(a.score)||byId.get(a.id).sourceRow-byId.get(b.id).sourceRow).slice(0,5);
  if(!cases.length)return note(`暂无已完成的优秀案例点评。最终严格全部通过且为好评正向的候选共${candidates.length}条；未生成点评时不补造案例。`,'warning');
  return `${cases.length<5?note(`当前已完成${cases.length}条优秀案例，少于5条，按实际结果展示。`):''}${cases.map((item,index)=>{
    const record=byId.get(item.id);
    return `<article class="case good-case"><div class="case-head"><span class="case-index">${index+1}</span><h3>原表行 ${e(record.sourceRow)} · 好评正向</h3></div>${caseText(record,enrichment,snapshot.targetLang)}<h4>亮点点评（模型辅助）</h4><p>${e(item.commentary)}</p><blockquote>${e(item.quote)}</blockquote></article>`;
  }).join('')}`;
}
function reasonClusters(snapshot,enrichment){
  const byId=new Map(snapshot.records.map(record=>[record.id,record])),groups=[],seenMembers=new Map();
  for(const item of values(enrichment.issueClusters)){
    const rule=BUSINESS_RULES.find(rule=>rule.id===item.ruleId);if(!rule)continue;
    if(!seenMembers.has(rule.id))seenMembers.set(rule.id,new Set());const seen=seenMembers.get(rule.id);
    const ids=unique(values(item.memberIds)).filter(id=>{const record=byId.get(id);return record&&record.replyStatus!=='unreplied'&&itemFor(record,rule.id)?.verdict==='不通过'&&!seen.has(id);});
    if(!ids.length)continue;ids.forEach(id=>seen.add(id));
    const key=`${rule.id}:${item.label||'原因待归类'}`,existing=groups.find(group=>group.key===key);
    if(existing){existing.ids.push(...ids);if(item.action&&!existing.actions.includes(item.action))existing.actions.push(item.action);}
    else groups.push({key,rule,label:item.label||'原因待归类',summary:item.summary||'',ids,actions:item.action?[item.action]:[]});
  }
  return groups.sort((a,b)=>b.ids.length-a.ids.length||BUSINESS_RULES.indexOf(a.rule)-BUSINESS_RULES.indexOf(b.rule));
}
function issuesHtml(snapshot,enrichment){
  const groups=reasonClusters(snapshot,enrichment),failedRules=BUSINESS_RULES.map(rule=>({rule,ids:snapshot.records.filter(record=>record.replyStatus!=='unreplied'&&itemFor(record,rule.id)?.verdict==='不通过').map(record=>record.id)})).filter(row=>row.ids.length).sort((a,b)=>b.ids.length-a.ids.length||BUSINESS_RULES.indexOf(a.rule)-BUSINESS_RULES.indexOf(b.rule));
  if(!failedRules.length)return note('当前所选口径暂无已判不通过记录；待判定及未回复仍单列，不据此宣称全部通过。');
  const byId=new Map(snapshot.records.map(record=>[record.id,record]));
  const clusterHtml=groups.length?table(['检核项','涉及条数','典型原因 / 痛点与建议（模型辅助）'],groups.map(group=>[group.rule.label,group.ids.length,clusterReasonCell(group.label,group.ids.map(id=>byId.get(id).sourceRow).join('、'),[group.summary,...group.actions].filter(Boolean).join('；'))])):note('原因聚类尚未完成，先展示本地计数与固定维度建议。','warning');
  const top=failedRules.slice(0,3).map((row,index)=>{
    const group=groups.find(group=>group.rule.id===row.rule.id),action=group?.actions[0]||row.rule.improvement;
    return `<li><h4>${index+1}. ${e(row.rule.label)} · 涉及${row.ids.length}条</h4><p>${e(action)}</p><small>${group?.actions.length?'模型辅助建议，需业务复核':'固定维度建议'}</small></li>`;
  }).join('');
  return `${textTable(['检核项','最终不通过条数'],failedRules.map(row=>[row.rule.label,row.ids.length]))}${clusterHtml}<h3>Top 3 改进方向</h3>${failedRules.length<3?note(`当前只有${failedRules.length}个不通过维度，不补造第三项。`):''}<ol class="actions">${top}</ol>${note('一条记录可存在多个不通过维度，各检核项条数不直接相加为记录总数。')}`;
}
function vocHtml(snapshot,enrichment){
  const scope=snapshot.records.filter(record=>['好评负向','中评'].includes(record.evaluationType)),byId=new Map(scope.map(record=>[record.id,record])),seen=new Set(),items=[];
  for(const item of values(enrichment.vocItems))if(byId.has(item.id)&&!seen.has(item.id)){seen.add(item.id);items.push(item);}
  const valid=items.filter(item=>item.valid===true),invalid=items.filter(item=>item.valid===false),pending=Math.max(0,scope.length-items.length),groups=new Map();
  for(const item of valid){const key=item.scene||'其他';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  const explanation=note(`VOC仅覆盖好评负向与中评：目标范围${scope.length}条；已分析${items.length}条，有效${valid.length}条，无效${invalid.length}条，尚未完成${pending}条；范围外${snapshot.records.length-scope.length}条（含好评正向、差评及未归类）。`);
  if(!scope.length)return explanation+note('当前冻结范围没有好评负向或中评记录。');
  const main=groups.size?textTable(['场景','痛点概括','条数','涉及原表行号'],[...groups].sort((a,b)=>b[1].length-a[1].length).map(([scene,rows])=>[scene,unique(rows.map(row=>row.painPoint).filter(Boolean)).join('；'),rows.length,rows.map(row=>byId.get(row.id).sourceRow).join('、')])):note('VOC分析尚未完成或尚无有效场景，不把缺失分析解释为没有用户痛点。','warning');
  const invalidHtml=invalid.length?`<h3>无效评价</h3>${invalidFeedbackHtml(invalid.map(item=>({sourceRows:byId.get(item.id).sourceRow,original:byId.get(item.id).raw22?.[8]||'原文为空',reason:item.reason||'模型未提供有效理由，需复核'})))}`:note('已完成分析的记录中暂无被标记的无效评价；未完成记录仍待分析。');
  return explanation+main+invalidHtml+(pending?note(`VOC分析尚未完成：还有${pending}条未取得结果。`,'warning'):'');
}

const styles=reportStyles;

export function buildBusinessReportHtml(snapshot,enrichment={},options={}){
 if(configuredDelivery(snapshot))return buildSceneReportHtml(snapshot,enrichment,options);
  if(snapshot?.deliveryType==='consultation-v1')return buildConsultationReportHtml(snapshot,enrichment,options);
  if(!snapshot||snapshot.schemaVersion!==1||!Array.isArray(snapshot.records)||!snapshot.metrics)throw new Error('业务交付快照无效。');
  if(options.language==='en')return buildEnglishReportHtml(snapshot,enrichment,options,{cases:selectBusinessErrorCases(snapshot,10)});
  const metrics=snapshot.metrics,basis=snapshot.basis||{},errorCases=selectBusinessErrorCases(snapshot,10),warnings=translationWarnings(snapshot,enrichment,errorCases),target=langLabel(snapshot.targetLang),job=options.job||{},unfinished=['running','paused','pending'].includes(job.status);
  const confirmed=snapshot.records.filter(record=>values(record.confirmed).some(item=>item.source==='confirmed')).length;
  const stat=(label,value,detail='',failure=false)=>`<div class="stat${failure?' failure':''}"><span>${verdictHtml(label)}</span><strong>${e(value)}</strong>${detail?`<em>${e(detail)}</em>`:''}</div>`;
  const section=(id,index,title,body)=>`<section class="report-section" id="${id}"><h2><span class="section-number">${String(index).padStart(2,'0')}</span>${e(title)}</h2>${body}</section>`;
  const overview=`<div class="stats">${stat('总数量',metrics.total,'冻结样本数')}${stat('合格',metrics.passed,'最终整体通过')}${stat('不合格',metrics.failed,'至少一项最终不通过',true)}${stat('整体通过率',rate(metrics.passRate),`质量分母 ${number(metrics.determinate)} 条`)}</div>${note(`待判定${number(metrics.pending)}条；未回复${number(metrics.unreplied)}条，均不进入整体通过率分母。质量分母=通过+不通过；总数量=通过+不通过+待判定+未回复。`)}${metrics.passRate===null?note('暂无可判定质量结论，不计算整体通过率。','warning'):''}${textTable(['人工纠正记录数','本次复核改判','历史覆盖改判'],[[number(metrics.correctedRecords),number(metrics.confirmedCorrections),number(metrics.historicalCorrections)]])}${note('纠正记录按实际应用人工来源且与完整AI初判有差异逐记录去重；不作为AI错误率。')}`;
  const typeDistribution=`${textTable(['评价类型','条数','占比'],values(metrics.typeDistribution).map(row=>[row.label||row.type,row.count,rate(row.percentage)]))}${note(`AI初判与原表历史人工参考存在差异：${number(metrics.historicalDifferenceRecords)}条。历史参考可能采用旧规则或不同检核时点，差异不等于AI错误或准确率。`)}`;
  const ruleStats=values(metrics.ruleStats);
  const rules=`${table(['检核项','AI初判通过率','AI可判定分母','最终通过率','最终可判定分母','最终不通过','最终待判定','通过率对比'],ruleStats.map(row=>[row.label,rate(row.ai?.passRate),number(row.ai?.denominator),rate(row.final?.passRate),number(row.final?.denominator),number(row.final?.failed),number(row.final?.pending),rateComparisonCell(row.ai?.passRate,row.final?.passRate)]))}${note('每项通过率各以本项通过+不通过为分母，排除未回复。待判定与不适用不自动视为通过；最终结果遵循页眉所示优先级。')}`;
  const cases=`<h3>错误案例 · 最多10条</h3>${note('按最终不通过维度覆盖选取，时效填充优先级较低，同时保留最长已判不通过时效记录；不足数量如实展示。')}${errorCasesHtml(snapshot,enrichment,errorCases)}<h3>优秀案例 TOP 5</h3>${excellentCasesHtml(snapshot,enrichment)}`;
  const statusNotice=unfinished?`<aside class="notice">交付分析尚未完成（${e(job.status==='paused'?'已暂停':'生成中')}）。本文件是当前已保存结果，未完成或缺失内容均明确标记。</aside>`:'';
  const translationNotice=(warnings.failed||warnings.pending)?`<aside class="notice">翻译缺失：${warnings.failed}段失败，${warnings.pending}段尚未完成，涉及${warnings.affected}条记录。缺失译文不以“（同原文）”替代，不阻塞本文件导出。</aside>`:'';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>电商评价管理质检报告 · ${e(snapshot.taskName)}</title><style>${styles}</style></head><body><main class="report"><header><div class="report-banner"><div class="eyebrow">MSS QUALITY WORKBENCH · BUSINESS DELIVERY</div><h1>电商评价管理质检报告</h1><p>${e(snapshot.taskName)}</p>${metadataHtml([['数据来源',snapshot.source?.name||'未提供'],['抽检周期',list(basis.samplingPeriods)],['结论口径',finalPolicy(snapshot)]],[['区域',list([...values(basis.regionGroups),...values(basis.regions)])],['样本量 / 生成日期',`${number(metrics.total)} 条 · ${snapshot.createdAt}`],['翻译语种',target]])}</div></header>${triageReportNotice(snapshot)}${statusNotice}${translationNotice}${section('quality-overview',1,'质检数据概况',overview)}${section('evaluation-types',2,'评价类型分布',typeDistribution)}${section('check-results',3,'五大检核项通过情况',rules)}${section('typical-cases',4,'典型案例',cases)}${section('issue-clusters',5,'不合格原因聚类与改进建议',issuesHtml(snapshot,enrichment))}${section('voice-of-customer',6,'用户评价声量聚类',vocHtml(snapshot,enrichment))}<footer class="report-footer"><h2>附注</h2><h3>生成与人工确认声明</h3><p>生成环境：${e(options.environment||'本机独立工作台')}。本报告与业务Excel使用同一冻结快照；生成后发生的工作区修改不自动改写本文件。</p><p>最终优先级：${e(finalPolicy(snapshot))}。本次工作台已确认复核记录${confirmed}条；原表历史人工参考可能来自旧规则。最终结果不能一概称为本次已人工确认，更不能用混合历史覆盖结果推导V2.1准确率。</p><p>译文、优秀案例点评、原因聚类和VOC由模型辅助生成，可能存在误译或归类偏差，需由业务人员结合原文复核。未回复只确认来源事实，不形成质量通过；分析缺失不表示没有问题。</p>${basisHtml(snapshot)}${snapshot.source?.sha256?`<p class="file-id">来源文件SHA-256：${e(snapshot.source.sha256)}</p>`:''}${job.snapshotFingerprint?`<p class="file-id">交付快照指纹：${e(job.snapshotFingerprint)}</p>`:''}</footer></main></body></html>`;
}
export const buildBusinessHtmlReport=buildBusinessReportHtml;
