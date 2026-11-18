import {hasReviewPolicy} from './triage-export.mjs';
import {isFinalSession} from './ai-triage.mjs';
import {getDashboard,getDashboardScope,getSessionResults,getReviewDisposition,isUnrepliedSession} from './domain.mjs';
import {e} from './ui.mjs';
import {reviewTrendChart} from './charts.mjs';
import {taskPhaseLabel,ecommerceTimeFacts} from './ecommerce-results.mjs';

const rate=(count,total)=>total?Math.round(count/total*1000)/10:null;
const displayRate=value=>value===null?'—':`${value}%`;
const periodNames={month:'本月',week:'本周',batch:'按批次',all:'全部可审核会话'};

export function getManagementReport(state,options={}){
  const scope=getDashboardScope(state,options),stats=getDashboard(state,options),hasTriage=scope.sessions.some(session=>hasReviewPolicy(session)||hasReviewPolicy(state.tasks.find(task=>task.id===session.taskId)));
  const reviewed=scope.sessions.filter(session=>isFinalSession(session)&&getReviewDisposition(session)==='quality'&&!isUnrepliedSession(state,session));
  const qualityReviewedCount=stats.qualityReviewedCount??stats.reviewedCount;
  let undetermined=0,noIssue=0;
  for(const session of reviewed){
    const finals=getSessionResults(session).map(result=>result.final?.verdict);
    if(finals.includes('不符合'))continue;
    if(!finals.length||finals.some(verdict=>!['符合','不适用'].includes(verdict)))undetermined++;else noIssue++;
  }
  const quality=[
    {key:'problem',label:'存在不符合',count:stats.problemSessions,color:'#b42332'},
    {key:'undetermined',label:'含无法判定（无不符合）',count:undetermined,color:'#b58a4b'},
    {key:'no-issue',label:'未发现不符合或无法判定',count:noIssue,color:'#4b8b78'},
  ];
  const ids=new Set(scope.sessions.map(session=>session.taskId));
  const batches=state.tasks.filter(task=>ids.has(task.id)).map(task=>{
    const batch=getDashboard({...state,sessions:scope.sessions},{period:'batch',taskId:task.id,referenceDate:scope.referenceDate});
    return {id:task.id,name:task.name,total:batch.totalSessions,reviewed:batch.reviewedCount,pending:batch.pendingCount,processedUnknown:batch.processedUnknownCount||0,qualityReviewed:batch.qualityReviewedCount??batch.reviewedCount,unreplied:batch.unrepliedCount??0,confirmedUnreplied:batch.confirmedUnrepliedCount??0,problems:batch.problemSessions,issues:batch.issueCount};
  });
  const ranks=stats.ruleCounts.filter(rule=>rule.count>0).sort((a,b)=>b.count-a.count);
  const problemRate=rate(stats.problemSessions,qualityReviewedCount);
  const scopeLabel=scope.taskId?(state.tasks.find(task=>task.id===scope.taskId)?.name||scope.taskId):'全部批次';
  const findings=[];findings.push(scope.taskId?'本报告按选定批次完整统计。':options.repeatImports==='include'?'本报告已将再次导入批次并入统计。':options.repeatImports==='only'?'本报告仅统计再次导入批次。':'再次导入批次单列，本报告仅统计首次导入。');
  if(scope.unknownDateCount&&['week','month'].includes(scope.period))findings.push(`另有${scope.unknownDateCount}条评论时间缺失或无效，未纳入本周/月日期统计；按批次可查看完整工作量。`);
  if(!stats.totalSessions)findings.push('当前范围暂无会话，请切换统计时间或选择其他批次。');
  else if(!stats.reviewedCount)findings.push('暂无人工已确认结果。本报告仅展示工作量和审核进度，暂不形成最终质量判断。');
  else if(!qualityReviewedCount)findings.push('暂无人工已确认质量结果；已确认的未回复事实只计入审核进度，不计算质量占比。');
  else{
    findings.push(`已确认质量会话中，${stats.problemSessions}条至少存在一项不符合，问题会话占比为${displayRate(problemRate)}；质量分母为${qualityReviewedCount}条。`);
    if(stats.pendingCount)findings.push(`仍有${stats.pendingCount}条会话待人工确认，当前质量结果仅覆盖${qualityReviewedCount}条已确认质量会话。`);
    else if(!stats.processedUnknownCount&&stats.reviewedCount===stats.totalSessions)findings.push('当前范围的会话均已完成人工确认。');
    if(undetermined)findings.push(`${undetermined}条会话尚含无法判定结果且未发现不符合，不能视为全部通过。`);
    if(ranks.length)findings.push(`不符合检查项数量最多的是${ranks.filter(row=>row.count===ranks[0].count).map(row=>row.name).join('、')}，各${ranks[0].count}项。该分布不等同于问题根因。`);
  }
  if(stats.processedUnknownCount)findings.push(`另有${stats.processedUnknownCount}条已处理但结论仍无法判定，单独统计，不作为通过且不进入最终质量分母。`);
  if(stats.unrepliedCount)findings.push(`未回复事实单列${stats.unrepliedCount}条，其中${stats.confirmedUnrepliedCount??0}条已人工确认；暂不进入质量分母。`);
  const actions=[];
  if(stats.pendingCount)actions.push(`跟进剩余${stats.pendingCount}条待确认会话；资料不足的先补齐依据再形成结论。`);
  if(ranks.length)actions.push(`建议围绕“${ranks[0].name}”抽查原文与政策依据，核对判断口径是否一致。`);
  if(stats.changedCount)actions.push(`汇总${stats.changedCount}条人工改判会话的理由，供后续规则和案例校准参考。`);
  if(stats.unknownCount)actions.push(`对${stats.unknownCount}项无法判定检查项补充资料或明确适用边界，不作为合格结果处理。`);
  const contextTasks=state.tasks.filter(task=>scope.taskId?task.id===scope.taskId:ids.size?ids.has(task.id):true);
  const hasManual=contextTasks.some(task=>task.mode==='manual'),hasDemo=contextTasks.some(task=>task.mode!=='manual');
  const hasAI=scope.sessions.some(session=>session.aiExecution);
  const timeBases=contextTasks.filter(task=>taskPhaseLabel(task)).map(task=>{
    const config=task.basisSnapshot.ruleSetSnapshot,timeRule=config.timeRule;
    const cutoffs=[...new Set(scope.sessions.filter(session=>session.taskId===task.id).map(session=>ecommerceTimeFacts(session)?.inspectionAt).filter(Boolean))];
    return{taskName:task.name,label:taskPhaseLabel(task),ruleSetId:config.ruleSetId,version:config.version,mode:timeRule.mode==='workingHours'?'累计工作小时':'连续自然小时',timezone:timeRule.calendar.timezone,calendarConfirmed:config.calendarConfirmed,thresholds:`默认 ${timeRule.thresholds.default} 小时；${Object.entries(timeRule.thresholds.byType).map(([type,hours])=>`${type} ${hours} 小时`).join('；')}`,calendar:JSON.stringify(timeRule.calendar),inspectionAt:cutoffs.length?cutoffs.join('；'):task.aiRun?.inspectionAt||'尚未计算'};
  });
  const hasRuleCalibration=scope.sessions.some(s=>s.reviewPolicy?.version===2);
  const materialNotice=hasRuleCalibration?'本报告按完整会话统计，逐项最终来源包括已标定规则AI免审与本轮人工确认。混合会话非免审项仍须人工确认；标定状态按任务冻结策略追溯，不把全部规则称为已标定。':hasTriage?`本报告使用任务冻结依据；AI终判 ${stats.aiFinalCount||0} 条，人工确认 ${stats.humanConfirmedCount||0} 条分别统计。仅证据校验通过的AI终判PASS及本轮人工确认进入最终质量分母，待人工FAIL、UNCERTAIN及退回记录排除；未回复事实单列。真实基准未标定。`:!hasManual
    ? `虚构演示数据 · ${scope.period==='all'?'不限制会话月份；演示参考日':'演示统计截止'} ${scope.referenceDate}。结果来自当前浏览器记录，不代表实际业务质量或真实AI效果。`
    : `${hasDemo?'本报告包含业务导入与虚构演示资料；演示任务AI结论为预置。':'本报告使用业务导入资料。'}${hasAI?'业务AI执行状态按会话记录；AI初判须经人工复核':'业务任务采用人工独立审核，AI未执行'}；规则和政策按各任务保存的快照追溯。统计参考日 ${scope.referenceDate}，质量结果仅覆盖人工已确认质量会话，未回复事实单列。`;
  const tasksById=new Map(state.tasks.map(task=>[task.id,task]));
  const failed=scope.sessions.filter(session=>session.aiExecution?.status==='failed'&&
    (session.aiExecution.errorCode!=='dependency_incomplete'||tasksById.get(session.taskId)?.aiQueue?.comparison?.status==='failed')).length;
  const aiCoverage={total:scope.sessions.length,completed:stats.aiProcessed,failed,unfinished:Math.max(0,scope.sessions.length-stats.aiProcessed-failed)};
  if(hasTriage)for(let index=0;index<findings.length;index++)findings[index]=findings[index].replaceAll('人工已确认','AI终判或人工确认').replaceAll('已确认质量会话','已形成最终结论的质量会话').replace('均已完成人工确认','均已形成最终结论');
  return {scope,stats,quality,hasTriage,hasRuleCalibration,qualityReviewedCount,batches,ranks,problemRate,scopeLabel,periodLabel:periodNames[scope.period],findings,actions,hasManual,hasDemo,materialNotice,aiCoverage,timeBases,title:hasManual?'服务会话质量管理报告':'售前咨询质量管理报告'};
}

const table=(headers,rows)=>`<div class="table-scroll"><table><thead><tr>${headers.map(header=>`<th>${e(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${e(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

export function buildManagementHtml(state,options={}){
  const model=getManagementReport(state,options),{scope,stats,qualityReviewedCount}=model;
  const metrics=[['纳入范围',stats.totalSessions,'条'],...(model.hasTriage?[['AI终判',stats.aiFinalCount||0,'条']]:[]),['人工已确认',model.hasTriage?stats.humanConfirmedCount||0:stats.reviewedCount,'条'],['待确认',stats.pendingCount,'条'],...(stats.processedUnknownCount?[['已处理仍无法判定',stats.processedUnknownCount,'条']]:[]),['问题会话',stats.problemSessions,'条'],['问题会话占比',displayRate(model.problemRate),'']];
  const maxRank=Math.max(1,...model.ranks.map(row=>row.count));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(model.title)} · ${e(model.periodLabel)}${model.hasManual?'':' · 虚构演示'}</title><style>
    :root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#263348;background:#edf1f5;font-size:14px;line-height:1.75}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:36px auto;padding:42px 44px;background:#fff;border-radius:20px}h1,h2,h3,p{margin:0}h1{font-size:32px;color:#1f2b3e;letter-spacing:-.5px}h2{font-size:20px;margin-bottom:14px;color:#263348}h3{font-size:15px}header{border-bottom:2px solid #b42332;padding-bottom:24px;margin-bottom:24px}.eyebrow{font-size:12px;color:#8a5965;letter-spacing:1px;margin-bottom:8px}.scope{display:flex;flex-wrap:wrap;gap:7px 20px;margin-top:14px;color:#6b778a}.scope strong{color:#3e506b;font-weight:600}.notice{font-size:12px;color:#987129;background:#fff8eb;border:1px solid #f0e2ca;border-radius:9px;padding:10px 14px;margin-top:16px}.metrics{display:grid;grid-template-columns:repeat(${model.hasTriage?6:5},minmax(0,1fr));border:1px solid #e7ebf1;border-radius:13px;overflow:hidden;margin:24px 0}.metric{padding:18px;border-right:1px solid #e7ebf1}.metric:last-child{border:0}.metric small{display:block;color:#768296;font-size:12px}.metric b{font-size:30px;line-height:1.6;letter-spacing:-.6px}.metric span{font-size:12px;color:#8994a5;margin-left:5px}.summary{padding:19px 22px;background:#f7f9fc;border-left:3px solid #b42332}.summary ul{margin:8px 0 0;padding-left:20px}.summary li+li{margin-top:7px}.section{margin-top:32px}.two-columns{display:grid;grid-template-columns:1fr 1fr;gap:30px}.muted,.caption{color:#7f8b9c;font-size:12px}.progress{height:8px;background:#e9edf3;border-radius:5px;overflow:hidden;margin:12px 0}.progress i{display:block;height:100%;background:#4b8b78}.progress-legend{display:flex;justify-content:space-between;gap:10px;color:#62728a;font-size:13px}.quality-row,.rank-row{margin:12px 0}.row-label{display:flex;justify-content:space-between;gap:14px;font-size:13px;margin-bottom:5px}.bar{height:7px;background:#edf1f5;border-radius:5px;overflow:hidden}.bar i{display:block;height:100%;background:#b42332}.quality-row b,.rank-row b{white-space:nowrap;font-weight:600}.trend-legend{display:flex;gap:24px;flex-wrap:wrap;font-size:12px;color:#6a778b;margin-bottom:10px}.trend-legend span{display:flex;align-items:center;gap:7px}.trend-legend i{width:20px;border-top:2px solid #b42332}.trend-legend span+span i{border-color:#71869e;border-top-style:dashed}.trend-scroll{overflow-x:auto}.trend-chart{display:block;width:100%;min-width:540px;height:auto}.trend-chart .grid{stroke:#e9edf2;stroke-dasharray:3 4}.chart-axis{fill:#788699;font-size:13px}.trend-chart g:focus{outline:2px solid #b42332}.chart-empty{padding:26px;background:#f8fafc;color:#7a879a;text-align:center;border-radius:10px}.table-scroll{max-width:100%;overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:12px 14px;text-align:left;border-bottom:1px solid #e7ebf1;vertical-align:top}th{background:#f6f8fb;color:#68788f;font-weight:600}td:first-child{min-width:170px}tbody tr:last-child td{border-bottom:0}details{margin-top:16px;border:1px solid #e6ebf1;padding:13px 16px;border-radius:10px}summary{cursor:pointer;font-size:13px;color:#60728a}.actions{padding-left:20px;color:#4b5e77}.actions li+li{margin-top:9px}.methods{font-size:12px;color:#7a8799}.methods p+p{margin-top:7px}footer{margin-top:34px;padding-top:15px;border-top:1px solid #e6ebf1;color:#8a95a5;font-size:11px}
    @media(max-width:760px){main{margin:0;padding:26px 18px;border-radius:0}h1{font-size:25px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metric{border-bottom:1px solid #e7ebf1}.two-columns{grid-template-columns:1fr;gap:0}.metric b{font-size:27px}th,td{padding:10px}.scope{display:block}.scope span{display:block}.summary{padding:16px}}@media print{:root{background:#fff}main{max-width:none;margin:0;padding:12mm;border-radius:0}.section,.metrics,.summary{break-inside:avoid}.table-scroll,.trend-scroll{overflow:visible}.trend-chart{min-width:0}.metrics{grid-template-columns:repeat(${model.hasTriage?6:5},minmax(0,1fr))}.two-columns{grid-template-columns:1fr 1fr}details{break-inside:avoid}summary{color:#263348}header{break-after:avoid}}
  </style></head><body><main>
    <header><p class="eyebrow">服务会话质检工作台 · 管理分析</p><h1>${e(model.title)}</h1><div class="scope"><span><strong>${e(model.periodLabel)}</strong> · ${e(model.scopeLabel)}</span><span>会话发生日期 ${e(scope.start)} — ${e(scope.end)}（北京时间）</span></div><p class="notice">${e(model.materialNotice)}</p></header>
    <section class="summary"><h2>总体结论</h2><ul>${model.findings.map(finding=>`<li>${e(finding)}</li>`).join('')}</ul></section>
    <div class="metrics">${metrics.map(([label,value,unit])=>`<div class="metric"><small>${e(label)}</small><b>${e(value)}</b><span>${e(unit)}</span></div>`).join('')}</div>
    <section class="section"><h2>AI处理覆盖情况</h2>${table(['纳入记录（条）','完整AI结果（条）','AI失败/中断（条）','其余未完成或未执行（条）'],[[model.aiCoverage.total,model.aiCoverage.completed,model.aiCoverage.failed,model.aiCoverage.unfinished]])}<p class="caption">覆盖情况按来源记录计数，技术分段不增加业务记录数。局部语义完成而重复检查未完成时，仍属未完成；人工独立审核的记录也可能尚未执行AI。调用失败不作为内容不符合，质量结论继续以人工最终确认为准。</p></section>
    <div class="two-columns"><section class="section"><h2>${stats.processedUnknownCount?'最终结论覆盖情况':'审核进度'}</h2><div class="progress-legend"><span>${stats.processedUnknownCount?'已有最终结论':'已确认'} ${stats.reviewedCount} 条</span><strong>${stats.processedUnknownCount?'最终结论覆盖率':'完成率'} ${stats.totalSessions?displayRate(stats.reviewRate):'—'}</strong></div><div class="progress"><i style="width:${stats.reviewRate}%"></i></div><p class="caption">待确认 ${stats.pendingCount} 条（含尚待处理的待审核、暂存及待补充）。${stats.processedUnknownCount?` 审核工作已处理 ${stats.workCompletedCount} / ${stats.totalSessions} 条，其中仍无法判定 ${stats.processedUnknownCount} 条；工作完成与最终结论分开统计。`:''}</p></section>
    <section class="section"><h2>质量结果分布</h2>${qualityReviewedCount?model.quality.map(row=>`<div class="quality-row"><div class="row-label"><span>${e(row.label)}</span><b>${row.count} 条 · ${displayRate(rate(row.count,qualityReviewedCount))}</b></div><div class="bar"><i style="width:${row.count/qualityReviewedCount*100}%;background:${row.color}"></i></div></div>`).join(''):'<p class="muted">暂无人工已确认质量结果；不计算质量占比。</p>'}<p class="caption">质量分母 ${qualityReviewedCount} 条。三类互斥，合计为已确认质量会话数；未发现不符合不等于所有检查项全部通过。</p></section></div>
    ${stats.unrepliedCount?`<section class="section"><h2>未回复事实</h2>${table(['来源未回复（条）','事实已确认（条）','事实待确认（条）'],[[stats.unrepliedCount,stats.confirmedUnrepliedCount??0,stats.unrepliedCount-(stats.confirmedUnrepliedCount??0)]])}<p class="caption">只确认回复正文和首次回复时间均为空的来源事实，不形成质量通过或不通过。事实确认计入审核完成数，暂不进入质量分母；该分母口径仍待业务正式确认。</p></section>`:''}
    ${model.timeBases.length?`<section class="section"><h2>本次时效口径</h2>${table(['批次','阶段与规则集','计算口径','分类阈值','检核截止点','日历核对'],model.timeBases.map(row=>[row.taskName,`${row.label} · ${row.ruleSetId}@${row.version}`,`${row.mode} · ${row.timezone}`,row.thresholds,row.inspectionAt,row.calendarConfirmed?'已业务核对':'尚未业务核对，按配置试算']))}<p class="caption">阶段A试运行仅升级时效，其余四项继续Sheet4 V1，尚未实施完整五项V2.1。空假期表不代表已排除实际法定节假日。</p><details><summary>查看冻结工作日历</summary>${table(['批次','工作日历配置'],model.timeBases.map(row=>[row.taskName,row.calendar]))}</details></section>`:''}
    <section class="section"><h2>主要问题分布</h2><p class="caption">按人工最终确认的不符合检查项计数，单位为“项”；同一会话可能包含多项。</p>${model.ranks.length?model.ranks.map(row=>`<div class="rank-row"><div class="row-label"><span>${e(row.name)}</span><b>${row.count} 项</b></div><div class="bar"><i style="width:${row.count/maxRank*100}%"></i></div></div>`).join(''):'<p class="chart-empty">当前范围暂无已确认的不符合检查项。</p>'}</section>
    <section class="section"><h2>会话审核趋势</h2><div class="trend-legend"><span><i></i>已审核会话数（条）</span><span><i></i>问题会话数（条）</span></div>${reviewTrendChart(stats.trend)}<p class="caption">按审核完成日期汇总，限于本报告纳入的会话；每条问题会话只计一次。</p><details><summary>查看逐日数据</summary>${table(['审核完成日期','已审核会话数（条）','问题会话数（条）'],stats.trend.map(point=>[point.label,point.reviewed,point.problems]))}</details></section>
    <section class="section"><h2>批次汇总</h2>${model.batches.length?table(['批次','纳入范围（条）','已审核（条）','待确认（条）','已处理仍无法判定（条）','质量分母（条）','未回复事实（条）','事实已确认（条）','问题会话（条）','不符合检查项（项）'],model.batches.map(row=>[row.name,row.total,row.reviewed,row.pending,row.processedUnknown,row.qualityReviewed,row.unreplied,row.confirmedUnreplied,row.problems,row.issues])):'<p class="chart-empty">当前范围暂无会话。</p>'}</section>
    <section class="section"><h2>管理关注事项</h2>${model.actions.length?`<ul class="actions">${model.actions.map(action=>`<li>${e(action)}</li>`).join('')}</ul>`:'<p class="muted">当前没有额外的统计关注事项。</p>'}</section>
    <section class="section methods"><h2>统计口径</h2><p>进度统计纳入范围内全部会话。质量分布、问题会话和问题项仅使用${model.hasTriage?'有证据的AI终判PASS及本轮人工确认':'人工已确认'}的质量结果；未回复事实单列，事实确认计入审核进度但暂不进入质量分母。AI初判与未确认草稿不进入最终质量统计。${model.hasRuleCalibration?'逐规则标定与判定来源按各任务冻结策略追溯，抽检及非免审项仍须人工。':model.hasTriage?'待人工FAIL、UNCERTAIN与退回记录不计作最终不通过；真实基准未标定。':''}</p><p>本周按周一至${model.hasManual?'统计':'演示'}截止日期、本月按月初至截止日期筛选会话发生时间；按批次纳入所选批次全部会话。“全部可审核会话”不限制月份，但排除尚待质检或质检中的任务，与全局审核完成范围一致。趋势按这些会话的审核完成日期分组，范围内的每日累计与会话汇总对应。</p><p>问题会话占比＝问题会话数÷已确认质量会话数。质量分母排除未回复事实；没有已确认质量会话时显示“—”。该分母口径仍待业务正式确认。无法判定单列，不作为已通过；不符合检查项数与会话条数是不同单位。</p><p>本报告不含逐条原文与个人记录；核查具体问题请另行导出质检明细。没有提供真实人工耗时或上一周期对照，不生成效率提升、根因或环比判断。</p></section>
    <footer>本地离线报告 · 可使用浏览器打印功能留档 · ${model.hasManual?'业务任务使用原文件与依据快照；审核人标签由人工填写':'数据与规则均为虚构演示'}</footer>
  </main></body></html>`;
}
