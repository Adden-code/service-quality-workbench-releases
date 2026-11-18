// Explicitly configured derived rules never enter the model or human item-review contract.
// Old tasks without this configuration retain their original independent-rule behavior.
import {modelRulesForScene} from './scene-rule-execution.mjs';
export const aggregateRuleId=snapshot=>snapshot?.configuration?.aggregateRuleId||null;
export function inspectionRules(basis,snapshot){const id=aggregateRuleId(snapshot),rules=basis?.rules||[];return id?rules.filter(rule=>rule.id!==id):rules;}
export function inspectionBasis(basis,snapshot){return aggregateRuleId(snapshot)||snapshot?.configuration?.ruleExecutionPolicies?{...basis,rules:modelRulesForScene(inspectionRules(basis,snapshot),snapshot.configuration)}:basis;}
export function overallVerdict(verdicts){return verdicts.includes('不符合')?'不符合':verdicts.includes('无法判定')?'无法判定':verdicts.includes('未执行')?'未执行':verdicts.includes('符合')?'符合':'不适用';}
export function derivedOverall(snapshot,results){
 const id=aggregateRuleId(snapshot);if(!id)return null;
 const binding=snapshot.configuration.ruleBindings.find(r=>r.ruleId===id);
 const inputs=snapshot.configuration.ruleBindings.filter(r=>r.ruleId!==id).map(r=>({...r,verdict:results.find(x=>(x.ruleId||x.id)===r.ruleId)?.verdict||'未执行'}));
 return{ruleId:id,ruleVersion:binding.ruleVersion,source:'program-derived',algorithm:'fail-then-unknown-then-pass.v1',verdict:overallVerdict(inputs.map(r=>r.verdict)),reason:'由检核子项派生：任一Fail则Fail；无Fail时无法判定/未执行保留；仅适用子项参与，全部NA则整体NA。',inputs};
}
