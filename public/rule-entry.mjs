import {catalogRecordMatchesScene} from './catalog-scenes.mjs';
import {detectRuleKind,ruleKindOf} from './rule-kind.mjs';
import {t as uiT} from './i18n.mjs';

const initialCategories=['服务规范','信息准确性','服务时效','其他检查','交付物要求'];
const inScenes=(record,scenes,catalog,state)=>!scenes?.length||scenes.some(scene=>catalogRecordMatchesScene(record,scene,{state,catalog,kind:'rules'}));

/** A closed choice list. Empty catalogs use a small starter vocabulary. */
export function ruleCategoryOptions(catalog={},scenes=[],state={}){
  const categories=[...new Set((catalog.rules||[]).filter(record=>inScenes(record,scenes,catalog,state)).map(record=>record.category?.trim()).filter(Boolean))];
  return categories.length?categories:initialCategories;
}

/** IDs are assigned locally, never accepted from a model response. */
export function nextRuleIds(catalog={},scene='',count=1,state={}){
  const all=[...(catalog.rules||[]),...(catalog.deletedRules||[]).map(item=>item.snapshot)],known=new Set(all.map(rule=>rule.id)),scoped=all.filter(rule=>inScenes(rule,scene?[scene]:[],catalog,state));
  const families=new Map();
  for(const id of new Set(scoped.map(rule=>rule.id))){
    const match=String(id).match(/^(.*?)(\d+)$/);if(!match)continue;
    const number=Number(match[2]);if(!Number.isSafeInteger(number))continue;
    const family=families.get(match[1])||{prefix:match[1],count:0,width:0,max:0};
    family.count++;family.max=Math.max(family.max,number);if(match[2].startsWith('0'))family.width=Math.max(family.width,match[2].length);families.set(match[1],family);
  }
  const family=[...families.values()].sort((a,b)=>b.count-a.count||b.max-a.max||a.prefix.localeCompare(b.prefix))[0]||{prefix:scene==='新品产品咨询'?'NP-R':scene==='电商评论回复'?'EC-R':'R',max:0,width:0};
  let number=family.max;const result=[];
  while(result.length<count){
    number++;if(!Number.isSafeInteger(number))throw new Error('规则编号已超出可支持范围，请人工指定标识。');
    const id=family.prefix+String(number).padStart(family.width,'0');if(known.has(id))continue;known.add(id);result.push(id);
  }
  return result;
}

export function prepareRuleCandidates(candidates,catalog,scene,state={}){
  const ids=nextRuleIds(catalog,scene,candidates.length,state),categories=ruleCategoryOptions(catalog,[scene],state);
  return candidates.map((candidate,index)=>({...structuredClone(candidate),id:ids[index],category:categories.includes(candidate.category)?candidate.category:'',ruleKind:detectRuleKind(candidate),included:true,confirmed:false}));
}

const fields=[['id','规则标识',64],['title','规则名称',120],['category','类别',60],['scope','适用范围',500],['passCriteria','符合口径',4000],['failCriteria','不符合口径',4000],['exceptionCriteria','例外及无法判定口径',4000]];
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function ruleCandidateErrors(dialog,catalog={},state={}){
  const errors=[],included=(dialog.candidates||[]).filter(candidate=>candidate.included!==false),categories=ruleCategoryOptions(catalog,[dialog.scene],state),ids=new Set();
  if(!included.length)errors.push('请至少保留一项候选。');
  if(!dialog.owner?.trim())errors.push('请填写维护人。');else if(dialog.owner.length>80)errors.push('维护人长度不能超过80个字符。');
  if(!validDate(dialog.effectiveAt))errors.push('请填写有效的生效日期。');
  if(!dialog.policyIds?.length)errors.push('请选择关联参考资料。');
  else if(dialog.policyIds.some(id=>!(catalog.policies||[]).some(policy=>policy.id===id&&catalogRecordMatchesScene(policy,dialog.scene,{state,catalog,kind:'policies'}))))errors.push('参考资料未归属于当前场景，请先维护资料归属。');
  for(const [index,candidate] of (dialog.candidates||[]).entries()){
    if(candidate.included===false)continue;
    const item=[];
    for(const [key,label,max] of fields){if(typeof candidate[key]!=='string'||!candidate[key].trim())item.push(uiT('请填写{0}',{0:uiT(label)}));else if(candidate[key].length>max)item.push(uiT('{0}长度不能超过{1}个字符',{0:uiT(label),1:max}));}
    if(candidate.category?.trim()&&!categories.includes(candidate.category.trim()))item.push('请从当前场景现有分类中选择类别');
    const id=candidate.id?.trim();if(id){if(/\s/.test(id))item.push('规则标识不能包含空白字符');if(ids.has(id))item.push('候选中的规则标识不能重复');ids.add(id);if((catalog.rules||[]).some(rule=>rule.id===id))item.push('规则标识已存在，请修改编号或到目录创建新版本');}
    if(candidate.ruleKind!==undefined&&!['session-check','meta'].includes(candidate.ruleKind))item.push('规则作用域类型无效');
    if(!candidate.confirmed)item.push('请勾选“我已对照原文”确认');
    const locator=candidate.sourceLocator,source=dialog.sourceText||'';
    if(!locator||!Number.isSafeInteger(locator.start)||!Number.isSafeInteger(locator.end)||locator.start<0||locator.end<=locator.start||locator.end>source.length||source.slice(locator.start,locator.end)!==candidate.sourceQuote)item.push('候选原文引用与来源不一致，请重新整理');
    if(item.length)errors.push(uiT('第 {0} 项：{1}。',{0:index+1,1:item.map(message=>uiT(message)).join('; ')}));
  }
  return errors.map(message=>uiT(message));
}

export {ruleKindOf};
