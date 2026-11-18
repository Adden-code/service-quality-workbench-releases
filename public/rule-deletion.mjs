import {sceneRuleReferences} from './scene-configuration.mjs';
const clone=value=>structuredClone(value);
const key=rule=>JSON.stringify([rule.id,rule.version]);
export function ruleVersionReferences(state,rule){
 return [...(state?.tasks||[]).filter(task=>(task.basisSnapshot?.rules||[]).some(item=>item.id===rule.id&&item.version===rule.version)).map(task=>({id:task.id,name:task.name})),...sceneRuleReferences(state,rule)];
}
export function deleteRetiredRule(catalog,state,{id,version,reason,actor,operationId,expectedRecord},at=new Date().toISOString()){
 if(typeof reason!=='string'||!reason.trim()||reason.trim().length>2000)throw new Error('请填写删除原因（最多2000字）。');
 if(typeof actor!=='string'||!actor.trim()||actor.trim().length>80)throw new Error('请填写删除人标签（最多80字）。');
 if(typeof operationId!=='string'||!operationId||operationId.length>128)throw new Error('删除操作标识无效。');
 const existing=(catalog.deletedRules||[]).find(item=>item.operationId===operationId);
 if(existing){if(existing.id!==id||existing.version!==version||existing.reason!==reason.trim()||existing.actor!==actor.trim())throw new Error('删除操作标识已被另一请求使用。');return clone(catalog);}
 const rule=catalog.rules.find(item=>item.id===id&&item.version===version);
 if(!rule||rule.status!=='已停用')throw new Error('只有已停用的规则版本可以删除。');
 if(expectedRecord&&JSON.stringify(rule)!==JSON.stringify(expectedRecord))throw new Error('规则在确认期间已变化，请重新打开后核对。');
 const references=ruleVersionReferences(state,rule);
 if(references.length)throw new Error(`该版本已被 ${references.length} 项任务引用或场景/草稿引用，不能删除（含归档及作废任务）。`);
 const next=clone(catalog);
 next.rules=next.rules.filter(item=>key(item)!==key(rule));
 (next.deletedRules??=[]).push({id,version,operationId,actor:actor.trim(),reason:reason.trim(),at,snapshot:clone(rule)});
 next.events.push({kind:'rules',id,version,action:'删除未引用版本',at});return next;
}
