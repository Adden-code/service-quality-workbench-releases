/** Catalog scope is metadata. Frozen task snapshots are never migrated in place. */
export const RULE_KINDS = ['session-check', 'meta'];

const formatFeature = /(?:报告\s*(?:输出\s*)?(?:结构|格式|模板|排版)|(?:检核|质检|检查|审核)?\s*明细表\s*(?:输出|结构|格式)|导出\s*(?:要求|格式|规范)|report\s+(?:output\s+)?(?:structure|format(?:ting)?|layout|template)|details?\s+(?:table|sheet)\s+(?:output|structure|format)|export\s+(?:requirements?|format(?:ting)?|specifications?))/iu;
const formatTitle = /^(?:(?:html|markdown|pdf|excel|word|json|csv)\s*)?输出格式(?:要求|规则|规范|标准)?$/iu;

export function detectRuleKind(rule) {
  const title = String(rule?.title || rule?.name || '').normalize('NFKC');
  const content = [title, rule?.category, rule?.scope, rule?.passCriteria, rule?.failCriteria, rule?.exceptionCriteria]
    .filter(value => typeof value === 'string').join('\n').normalize('NFKC');
  return formatFeature.test(content) || formatTitle.test(title.trim()) ? 'meta' : 'session-check';
}

export function ruleKindOf(rule) {
  return RULE_KINDS.includes(rule?.ruleKind) ? rule.ruleKind : detectRuleKind(rule);
}

export const isSessionCheckRule = rule => ruleKindOf(rule) === 'session-check';
export const normalizeRuleKind = rule => ({...rule, ruleKind: ruleKindOf(rule)});

export function migrateRuleKinds({state, catalog}, now = new Date().toISOString()) {
  if (!catalog?.rules?.some(rule => rule.ruleKind === undefined)) return {state, catalog, changed: false};
  const next = structuredClone(catalog);
  for (const rule of next.rules) {
    if (rule.ruleKind !== undefined) continue;
    rule.ruleKind = detectRuleKind(rule);
    if (rule.ruleKind === 'meta') next.events.push({kind:'rules', id:rule.id, version:rule.version, action:'自动标记交付物要求', at:now});
  }
  return {state, catalog:next, changed:true};
}
