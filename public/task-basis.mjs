// 快照冻结任务创建时的完整目录正文。演示回退仅在调用时读取，避免循环依赖初始化。
import {rules as demoRules, policies as demoPolicies} from './domain.mjs';
import {validateRecord} from './catalog.mjs';
import {isSessionCheckRule,normalizeRuleKind} from './rule-kind.mjs';
import {inspectionRules} from './scene-aggregate.mjs';

function dateCheck(value) {
  const parsed=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!value.startsWith('0000-')?new Date(`${value}T00:00:00Z`):null;
  if(!parsed||!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==value)throw new Error('快照生效日期须为真实的 YYYY-MM-DD。');
}
function timeCheck(value) {
  const m=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  if(!m)throw new Error('快照时间须为包含时区的 ISO 时间。');dateCheck(m[1]);
  if(+m[2]>23||+m[3]>59||+m[4]>59||(m[5]!=='Z'&&(+m[6]>14||+m[7]>59||(+m[6]===14&&+m[7]!==0)))||!Number.isFinite(Date.parse(value)))throw new Error('快照时间无效。');
}
export function createBasisSnapshot(catalog,{effectiveDate,ruleIds,now=new Date().toISOString()}={}) {
  dateCheck(effectiveDate);timeCheck(now);
  if(!catalog||!Array.isArray(catalog.rules)||!Array.isArray(catalog.policies))throw new Error('规则资料目录无效。');
  if(!Array.isArray(ruleIds)||!ruleIds.length||ruleIds.some(id=>typeof id!=='string'||!id.trim())||new Set(ruleIds).size!==ruleIds.length)throw new Error('请选择不重复的规则标识。');
  const selected=(kind,id)=>{
    const matches=catalog[kind].filter(r=>r.id===id&&r.status==='已发布'&&r.effectiveAt<=effectiveDate&&(!r.expiresAt||effectiveDate<r.expiresAt));
    if(matches.length!==1)throw new Error(`${id} 在所选日期必须存在唯一生效的已发布版本。`);
    validateRecord(matches[0],kind);return structuredClone(matches[0]);
  };
  const rules=ruleIds.map(id=>normalizeRuleKind(selected('rules',id))).filter(isSessionCheckRule).map(rule=>({...rule,name:rule.title}));
  if(!rules.length)throw new Error('请选择至少一条会话检核规则；交付物要求不参与会话质检。');
  const policyIds=[...new Set(rules.flatMap(rule=>rule.policyIds))];
  const policies=policyIds.map(id=>{const policy=selected('policies',id);return {...policy,content:policy.sections.map(s=>`${s.id} ${s.title}\n${s.text}`).join('\n\n')};});
  return {capturedAt:now,effectiveDate,rules,policies};
}

export function getTaskBasis(state,sessionOrTask) {
  const item=typeof sessionOrTask==='string'?(state.tasks.find(task=>task.id===sessionOrTask)||state.sessions?.find(session=>session.id===sessionOrTask)):sessionOrTask;
  const task=item?.taskId?state.tasks.find(task=>task.id===item.taskId):item;
  return task?.basisSnapshot||{rules:demoRules,policies:demoPolicies};
}
export function getSessionRules(state,session) {const item=typeof session==='string'?(state.sessions?.find(s=>s.id===session)||state.tasks.find(t=>t.id===session)):session;const task=item?.taskId?state.tasks.find(t=>t.id===item.taskId):item;return inspectionRules(getTaskBasis(state,item),task?.executionSnapshot);}
export function referenceKey(policy,sectionOrId=null) {
  const sectionId=typeof sectionOrId==='object'?sectionOrId?.id:sectionOrId;
  return `${encodeURIComponent(policy.id)}@${policy.version}#${encodeURIComponent(sectionId??'')}`;
}
export function resolveTaskReference(state,session,key) {
  if(typeof key!=='string')return null;
  const policies=getTaskBasis(state,session).policies;
  const composite=[];
  for(const policy of policies){
    if(key===referenceKey(policy))composite.push({policy,section:null});
    for(const section of policy.sections)if(key===referenceKey(policy,section))composite.push({policy,section});
  }
  if(composite.length)return composite.length===1?composite[0]:null;
  const short=[];
  for(const policy of policies){
    if(key===policy.id)short.push({policy,section:null});
    for(const section of policy.sections)if(key===section.id)short.push({policy,section});
  }
  return short.length===1?short[0]:null;
}
export function resolveTaskPolicy(state,session,key) {return resolveTaskReference(state,session,key)?.policy||null;}
