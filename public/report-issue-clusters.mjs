// Frozen report policy. Change the version before changing its semantics; reports
// without this exact snapshot marker must continue through the legacy path.
export const REPORT_CLUSTER_POLICY='issue-clusters-v2-0.11.20';
export const hasReportClusterPolicy=snapshot=>snapshot?.reportClusterPolicy===REPORT_CLUSTER_POLICY;
const array=value=>Array.isArray(value)?value:[];
const unique=values=>[...new Set(values)];
const text=value=>typeof value==='string'?value:'';
const lexical=(a,b)=>a===b?0:a<b?-1:1;
// Preserve original translation keys; display each part before concatenating.
export function reportClusterTextParts(cluster,kind){const parts=unique(array(cluster?.[kind==='summary'?'summaries':'actions']).filter(value=>typeof value==='string'&&value));return parts.length?parts:[text(cluster?.[kind])].filter(Boolean);}
const ecDimensions={'EC-TIME':['回复时效','Response timeliness'],'EC-TEXT':['文本质量','Text quality'],'EC-TARGET':['针对性及批次重复','Relevance and batch repetition'],'EC-STEPS':['操作步骤结构','Instruction structure'],'EC-PRIVACY':['公开回复隐私','Privacy in public replies']};
// Only typography is canonicalized. Keep operators, slashes and hyphens: they
// may distinguish contradictory labels. Never use edit distance or embeddings.
export const normalizeIssueLabel=value=>text(value).normalize('NFKC').toLowerCase().replace(/[\s\u200b\ufeff]+/gu,'').replace(/[，。；：、,.;:!?！？“”‘’"'（）()【】\[\]{}]/gu,(character,index,source)=>/\d/u.test(source[index-1]||'')&&/\d/u.test(source[index+1]||'')?character:'');
const synonyms={
 'EC-TIME':[['回复不及时','回复超时','未及时回复','回复超过时限'],['响应不及时','响应超时','响应超过时限']],
 'EC-TEXT':[['拼写错误','存在拼写错误','单词拼写错误'],['语法错误','存在语法错误','语法不规范'],['标点不规范','标点错误','标点使用不当']],
 'EC-TARGET':[['回复缺乏针对性','回复针对性不足','缺乏针对性的回复'],['未回应用户问题','未回应客户问题','未回答用户问题','未回答客户问题'],['模板化回复','回复模板化','机械套用模板']],
 'EC-STEPS':[['缺少操作指引','未提供操作指引','未给出操作指引'],['缺少解决步骤','未提供解决步骤','未给出解决步骤'],['步骤未编号','操作步骤未编号','缺少步骤编号']],
 'EC-PRIVACY':[['泄露个人信息','暴露个人信息','个人信息泄露'],['索取敏感信息','要求提供敏感信息']],
};
function canonicalLabel(label,scope){
 const normalized=normalizeIssueLabel(label),family=synonyms[scope]?.find(items=>items.some(item=>normalizeIssueLabel(item)===normalized));
 return{key:family?normalizeIssueLabel(family[0]):normalized,label:family?family[0]:text(label).trim()||'原因未提供',method:family?'curated_same_rule_synonym':'normalized_exact'};
}
const failed=result=>['不符合','不通过','fail'].includes(text(result?.verdict).toLowerCase());
const idOf=result=>result?.ruleId||result?.id;
function scopeFor(snapshot,item){
 const rules=array(snapshot.executionSnapshot?.configuration?.basis?.rules).concat(array(snapshot.basis?.rules));
 const dimensions=array(snapshot.basis?.dimensions),rule=rules.find(rule=>rule.id===item.ruleId),category=item.category||rule?.category;
 if(Object.hasOwn(ecDimensions,item.ruleId||''))return{key:item.ruleId,primaryKey:item.ruleId,primaryLabel:ecDimensions[item.ruleId][0],primaryEnglish:ecDimensions[item.ruleId][1],basis:'frozen_rule',matches:result=>idOf(result)===item.ruleId};
 const dimension=dimensions.find(d=>d.key===(category||item.ruleId));
 if(dimension)return{key:`category:${dimension.key}`,primaryKey:`category:${dimension.key}`,primaryLabel:dimension.label||dimension.key,basis:'frozen_dimension',matches:result=>(result.category||rules.find(rule=>rule.id===idOf(result))?.category)===dimension.key};
 if(rule)return{key:`rule:${rule.id}`,primaryKey:category?`category:${category}`:`rule:${rule.id}`,primaryLabel:category||rule.title||rule.name||rule.id,basis:category?'frozen_rule_category':'frozen_rule',matches:result=>idOf(result)===rule.id};
 // No label-based inference of a business dimension. Unknown grouping is
 // explicit and still retains each original scope as a separate secondary key.
 return{key:`unclassified:${item.ruleId||item.category||''}`,primaryKey:'unclassified',primaryLabel:'其他（归属待核实）',primaryEnglish:'Other (classification unverified)',basis:'unclassified',matches:result=>item.ruleId?idOf(result)===item.ruleId:item.category?result.category===item.category:true};
}

export function buildReportIssueClusters(snapshot,rawClusters){
 const raw=structuredClone(array(rawClusters)),records=new Map(array(snapshot.records).map(record=>[record.id,record])),combined=new Map(),excluded=[];
 raw.forEach((item,index)=>{
  const scope=scopeFor(snapshot,item),canonical=canonicalLabel(item.label,scope.key),key=JSON.stringify([scope.key,canonical.key]);
  const members=unique(array(item.memberIds)).filter(id=>{const record=records.get(id);return record&&record.replyStatus!=='unreplied'&&array(record.final).some(result=>failed(result)&&scope.matches(result));});
  const rejected=unique(array(item.memberIds)).filter(id=>!members.includes(id));if(rejected.length)excluded.push({sourceIndex:index,memberIds:rejected,reason:'not_a_known_failure_in_scope'});
  if(!members.length) return;
  if(!combined.has(key))combined.set(key,{...item,label:canonical.label,memberIds:[],summaries:[],actions:[],originalLabels:[],clusterKey:key,scopeKey:scope.key,primaryKey:scope.primaryKey,primaryLabel:scope.primaryLabel,...(scope.primaryEnglish?{primaryEnglish:scope.primaryEnglish}:{}),groupingBasis:scope.basis,sourceIndexes:[],normalizationMethod:canonical.method});
  const group=combined.get(key);group.memberIds=unique([...group.memberIds,...members]);group.originalLabels=unique([...group.originalLabels,text(item.label)]);group.sourceIndexes.push(index);
  for(const summary of reportClusterTextParts(item,'summary'))if(!group.summaries.includes(summary))group.summaries.push(summary);
  for(const action of reportClusterTextParts(item,'action'))if(!group.actions.includes(action))group.actions.push(action);
 });
 const issueClusters=[...combined.values()].map(group=>({...group,summary:group.summaries.join('；'),action:group.actions.join('；')}));
 const primary=new Map();for(const group of issueClusters){if(!primary.has(group.primaryKey))primary.set(group.primaryKey,{key:group.primaryKey,label:group.primaryLabel,...(group.primaryEnglish?{english:group.primaryEnglish}:{}),memberIds:[],clusters:[]});const p=primary.get(group.primaryKey);p.memberIds=unique([...p.memberIds,...group.memberIds]);p.clusters.push(group);}
 const ranked=[...primary.values()].sort((a,b)=>Number(Object.hasOwn(ecDimensions,b.key))-Number(Object.hasOwn(ecDimensions,a.key))||b.memberIds.length-a.memberIds.length||lexical(a.key,b.key));
 let hierarchy=ranked;
 if(ranked.length>8){const retained=ranked.slice(0,7),overflow=ranked.slice(7);hierarchy=[...retained,{key:'overflow',label:'其他检核维度',english:'Other check dimensions',memberIds:unique(overflow.flatMap(group=>group.memberIds)),clusters:overflow.flatMap(group=>group.clusters),originalDimensions:overflow.map(({key,label})=>({key,label}))}];}
 for(const group of hierarchy)group.clusters.sort((a,b)=>b.memberIds.length-a.memberIds.length||lexical(a.clusterKey,b.clusterKey));
 return{issueClusters,issueClustersRaw:raw,issueClusterHierarchy:hierarchy,issueClusterAudit:{version:REPORT_CLUSTER_POLICY,normalization:'NFKC, whitespace and non-semantic punctuation; curated same-rule families only',fuzzyMatching:false,firstLevelLimit:8,excluded,merges:issueClusters.map(group=>({clusterKey:group.clusterKey,method:group.normalizationMethod,sourceIndexes:group.sourceIndexes,originalLabels:group.originalLabels,memberIds:group.memberIds,sourceMemberCounts:group.sourceIndexes.map(index=>array(raw[index].memberIds).length)}))}};
}

export function reportClusterView(snapshot,enrichment){
 return hasReportClusterPolicy(snapshot)?buildReportIssueClusters(snapshot,enrichment.issueClustersRaw||enrichment.issueClusters):null;
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reportIssueHierarchyHtml(snapshot,enrichment,{english=false,display=value=>value,sourceLabel,topDirections=false}={}){
 const view=reportClusterView(snapshot,enrichment);if(!view)return'';
 const records=new Map(array(snapshot.records).map(record=>[record.id,record]));
 const source=id=>sourceLabel?sourceLabel(id):(()=>{const row=records.get(id);return array(row?.sourceRows).length?row.sourceRows.join('、'):row?.sourceRow||row?.externalId||id;})();
 const primaryLabel=group=>english?(group.english||display(group.label)):group.label;
 const displayParts=values=>values.map(value=>display(value)).join(english?'; ':'；');
 const notice=english?'Model-assisted clusters are for reference; review the source evidence. Primary groups follow frozen check dimensions (at most 8); specific causes remain separate. Only equivalent typography and curated synonyms within the same rule are merged.':'原因聚类由模型辅助生成，仅供参考，请结合原文复核。一级按冻结检核维度归类（最多8类），二级保留具体原因；仅合并同一规则内的文字规范差异与明确同义标签。';
 if(!view.issueClusterHierarchy.length)return`<p class="note">${english?'Cause clusters are pending; missing analysis does not mean no issues.':'原因聚类尚未生成，分析缺失不表示没有问题。'}</p>`;
 const parts=view.issueClusterHierarchy.map(primary=>`<article class="issue-primary" data-cluster-primary="${escape(primary.key)}"><h3>${escape(primaryLabel(primary))} <span>${primary.memberIds.length} ${english?'records':'条'}</span></h3>${primary.originalDimensions?`<p class="note">${escape(english?'Grouped here because the primary-category limit was reached; original dimensions are retained below.':'超过一级类别上限，以下保留原检核维度及具体原因。')}</p>`:''}<ol class="issue-secondary">${primary.clusters.map(cluster=>`<li data-cluster-secondary="${escape(cluster.clusterKey)}"><h4>${escape(display(cluster.label))} · ${cluster.memberIds.length} ${english?'records':'条'}</h4>${primary.originalDimensions?`<p>${escape(english?'Original check dimension: ':'原检核维度：')}${escape(display(cluster.primaryLabel))}</p>`:''}<p class="cluster-source-rows">${english?'Source rows / IDs: ':'成员记录（原表行号 / 会话ID）：'}${escape(cluster.memberIds.map(source).join('、'))}</p><p>${escape(displayParts(reportClusterTextParts(cluster,'summary')))}</p><p>${english?'Action: ':'改进建议：'}${escape(displayParts(reportClusterTextParts(cluster,'action')))}</p><details class="cluster-audit"><summary>${english?'Original labels and merge audit':'原始标签与合并依据'}</summary><p>${escape(cluster.originalLabels.join(' / '))}</p><p>${escape(cluster.normalizationMethod==='curated_same_rule_synonym'?(english?'Curated synonyms within the same rule':'同一检核规则内的明确同义词表'):(english?'Unicode, whitespace and punctuation normalization only':'仅规范Unicode、空白及非语义标点'))}</p></details></li>`).join('')}</ol></article>`).join('');
 const directions=topDirections?`<h3>${english?'Top 3 improvement directions':'Top 3 改进方向'}</h3><ol class="actions">${[...view.issueClusterHierarchy].sort((a,b)=>b.memberIds.length-a.memberIds.length).slice(0,3).map(group=>`<li><h4>${escape(primaryLabel(group))}</h4><p>${escape(displayParts(unique(group.clusters.flatMap(cluster=>reportClusterTextParts(cluster,'action')))))}</p></li>`).join('')}</ol>`:'';
 return`<div class="issue-hierarchy" data-cluster-policy="${REPORT_CLUSTER_POLICY}"><style>.issue-hierarchy .issue-primary{margin:18px 0;border-top:1px solid #e3e9f3;padding-top:8px}.issue-hierarchy .issue-primary h3 span{font-size:13px;font-weight:400;color:#62718a}.issue-hierarchy .issue-secondary{padding-left:24px}.issue-hierarchy .issue-secondary>li{padding:0 0 14px;overflow-wrap:anywhere}.issue-hierarchy .issue-secondary h4{margin:12px 0 6px}.issue-hierarchy .issue-secondary p{margin:5px 0}.issue-hierarchy .cluster-audit{font-size:12px;color:#62718a}.issue-hierarchy .cluster-audit summary{cursor:pointer}@media print{.issue-hierarchy .issue-secondary>li{break-inside:avoid}}</style><p class="note">${notice}</p>${parts}${directions}<p class="note">${english?'A record can fail more than one check; primary-category counts must not be added as a distinct-record total.':'同一记录可能涉及多个不通过检核维度，一级类别条数不能直接相加为记录总数。'}</p></div>`;
}

export const ISSUE_CLUSTER_FEWSHOTS=' 标签粒度示例（只示意归纳方式，不是本批事实，不照抄示例ID）：示例1：同一文本规则中“单词拼写错误”和“拼写错误”统一用“拼写错误”，两个原成员ID合并到一个memberIds；不要另建同义组。示例2：同一针对性规则中“未回答用户问题”和“未回应客户问题”统一用“未回应用户问题”，但“模板重复”是另一具体原因，不能因为同属针对性而合并。示例3：“操作步骤缺失”与“操作步骤顺序错误”必须分为两组；“已回复”与“未回复”含义相反，不得因字面相似合并。label只写可定位的具体原因，不写“服务问题”等过宽标签；一级检核维度和最多8类限制由程序按冻结依据生成，无需增加JSON字段。模型辅助归纳仅供参考，不能当作已核实根因。';
