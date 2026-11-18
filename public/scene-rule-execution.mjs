// Explicit, frozen component policies. Full catalog wording stays in the audit basis.
export const RULE_EXECUTION_MODES=['timing-or-model','missing-knowledge','missing-knowledge-or-model'];
export function modelRulesForScene(rules,configuration){
 return rules.map(rule=>{const p=configuration?.ruleExecutionPolicies?.[rule.id];return p?.modelCriteria?{...rule,...p.modelCriteria}:rule;});
}
export function ruleExecutionScope(configuration){
 return {...(configuration?.aggregateRuleId?{aggregateRuleId:configuration.aggregateRuleId}:{}),...(configuration?.ruleExecutionPolicies?{ruleExecutionPolicies:configuration.ruleExecutionPolicies}:{})};
}
