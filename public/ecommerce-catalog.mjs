import {isBusinessEcommerceBasis,validateBusinessEcommerceBasis} from './ecommerce-business-profile.mjs';
// 用户确认的首轮工程测试口径，须由界面明确选择后才加入目录；不代表正式制度。
import { createDraft, publishVersion, validateCatalog } from './catalog.mjs';
import { EC_RULE_IDS } from './ecommerce-schema.mjs';
import {createBasisSnapshot} from './task-basis.mjs';
import {assertTaskCatalogScene} from './catalog-scenes.mjs';
import {validateRuleSet,resolvePublishedRuleSet,listRuleSets,ruleSetNumericVersion,EC_STAGE_A_TITLE} from './ecommerce-rule-sets.mjs';

export const EC_POLICY_ID = 'EC-POLICY';
const VERSION = 'V1.0';
const SCOPE = '电商评论回复首轮测试；北京时间UTC+08:00；仅核对本次导入批次，不作为正式制度。';
const EXCEPTION = '缺少相关原文、有效时间或其他必要证据，无法可靠判断时为无法判定（Unable to determine），保留原因并交人工复核。';
const RULES = [
  {
    id: 'EC-TIME', title: '回复时效（测试规则）', category: '电商评论测试', scope: SCOPE,
    passCriteria: '按北京时间（UTC+08:00）计算评论时间至首次回复时间的连续自然时间；包含晚间、周末。间隔不超过任务冻结的thresholdHours时为Pass；首轮测试阈值为24小时，恰好24小时通过。',
    failCriteria: '评论至首次回复超过24小时为Fail；24小时是首轮测试值，若区域阈值经明确配置，使用任务冻结的thresholdHours，不得临时猜测或改变阈值。',
    exceptionCriteria: `${EXCEPTION}任一时间缺失、无效或首次回复早于评论时，时效为无法判定；不以当前时间补齐。`,
  },
  {
    id: 'EC-TEXT', title: '文本质量（测试规则）', category: '电商评论测试', scope: SCOPE,
    passCriteria: '实际回复没有明显拼写、语法、标点或表情使用问题，表达通顺且没有明显歧义时为Pass。',
    failCriteria: '实际回复存在明显拼写、语法、标点、表情、通顺性或歧义问题，任一项成立即为Fail。',
    exceptionCriteria: `${EXCEPTION}缺少回复或无法可靠理解原语言时，不将未知质量判为Pass。`,
  },
  {
    id: 'EC-TARGET', title: '针对性及批次重复（测试规则）', category: '电商评论测试', scope: SCOPE,
    passCriteria: '回复针对评论的具体问题、诉求或夸赞，内容相关；且本次导入批次内同一管理员不存在累计至少3条重复或高度相似的回复时为Pass。',
    failCriteria: '未针对具体问题、诉求或夸赞，回复与评论完全无关，或本次导入批次内同一管理员累计>=3条重复或高度相似的回复，任一项成立即为Fail；不得跨管理员凑数。',
    exceptionCriteria: `${EXCEPTION}管理员缺失时不能据此认定同管理员批次重复；不推断未导入的历史评论。`,
  },
  {
    id: 'EC-STEPS', title: '操作步骤结构（测试规则）', category: '电商评论测试', scope: SCOPE,
    passCriteria: '实际回复少于3个操作、排查或解决步骤时为Pass；有至少3个此类步骤且按1、2、3顺序编号时为Pass。普通列举或礼貌用语不自动算操作步骤。',
    failCriteria: '实际回复包含>=3个操作、排查或解决步骤，且未按1、2、3顺序编号时为Fail。',
    exceptionCriteria: `${EXCEPTION}缺少回复或无法确认是否存在3个操作步骤时为无法判定。`,
  },
  {
    id: 'EC-PRIVACY', title: '公开回复隐私（测试规则）', category: '电商评论测试', scope: SCOPE,
    passCriteria: '实际公开回复未披露可识别个人的隐私信息时为Pass；仅输入材料含订单号、SKU或客户信息不能据此判为泄露。',
    failCriteria: '实际公开回复披露个人信息，例如可识别的姓名、联系方式、地址或可关联个人的订单信息时为Fail；必须指出公开回复中的具体证据。',
    exceptionCriteria: `${EXCEPTION}输入订单号本身不等于公开回复泄露；缺少实际回复或无法判断信息是否指向个人时为无法判定。`,
  },
].map(rule => ({ ...rule, policyIds: [EC_POLICY_ID] }));
const POLICY = {
  id: EC_POLICY_ID, title: '电商评论回复五项测试口径说明（非正式制度）', category: '电商评论测试', scope: SCOPE,
  source: '用户确认的首轮工程测试口径；并非正式制度或真实评测金标。',
  sections: RULES.map(rule => ({ id: `${rule.id}-1`, title: rule.title, text: `本条仅作工程测试口径，非正式制度。\nPass：${rule.passCriteria}\nFail：${rule.failCriteria}\n无法判定：${rule.exceptionCriteria}` })),
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const RULE_BODY_KEYS = ['category', 'scope', 'passCriteria', 'failCriteria', 'exceptionCriteria', 'policyIds'];
const POLICY_BODY_KEYS = ['title', 'category', 'scope', 'source'];
const contentOf = sections => sections.map(section => `${section.id} ${section.title}\n${section.text}`).join('\n\n');

function matchesRule(record, expected) {
  return record?.id === expected.id && record.version === VERSION && (record.title ?? record.name) === expected.title &&
    (record.name === undefined || record.name === expected.title) && RULE_BODY_KEYS.every(key => same(record[key], expected[key]));
}
function matchesPolicy(record) {
  return record?.id === EC_POLICY_ID && record.version === VERSION && POLICY_BODY_KEYS.every(key => same(record[key], POLICY[key])) &&
    Array.isArray(record.sections) && same(record.sections.map(({ id, title, text }) => ({ id, title, text })), POLICY.sections) &&
    (record.content === undefined || record.content === contentOf(POLICY.sections));
}

/** Immutable, idempotent seeding. Existing EC IDs must remain the original published test version. */
export function ensureEcommerceCatalog(catalog, { now = new Date().toISOString(), effectiveAt = '2020-01-01', owner = '测试维护人' } = {}) {
  validateCatalog(catalog);
  // Check every pre-existing record before adding anything, including drafts and revised versions.
  for (const policy of catalog.policies.filter(record => record.id === EC_POLICY_ID)) if (!matchesPolicy(policy) || policy.status !== '已发布') throw new Error(`电商测试资料${EC_POLICY_ID}存在版本、状态或正文冲突，请人工核对，不能覆盖。`);
  for (const rule of catalog.rules.filter(record => EC_RULE_IDS.includes(record.id))) if (!matchesRule(rule, RULES.find(expected => expected.id === rule.id)) || rule.status !== '已发布') throw new Error(`电商测试规则${rule.id}存在版本、状态或正文冲突，请人工核对，不能覆盖。`);
  let next = structuredClone(catalog);
  const common = { version: VERSION, effectiveAt, expiresAt: '', owner, changeNote: '明确选择首轮电商测试标准；非正式制度。' };
  if (!next.policies.some(record => record.id === EC_POLICY_ID)) {
    next = createDraft(next, 'policies', EC_POLICY_ID, { ...POLICY, ...common }, now);
    next = publishVersion(next, 'policies', EC_POLICY_ID, VERSION, {}, now);
  }
  for (const rule of RULES) if (!next.rules.some(record => record.id === rule.id)) {
    next = createDraft(next, 'rules', rule.id, { ...rule, ...common }, now);
    next = publishVersion(next, 'rules', rule.id, VERSION, {}, now);
  }
  return next;
}

/** Business registration requires an explicit acknowledgement of the actual Sheet4 source. */
export function confirmEcommerceCatalog(catalog, {confirmed=false,source='',...options}={}) {
  if(confirmed!==true)throw new Error('请明确确认已核对Sheet4五项口径后，再登记可执行规则版本。');
  if(source!=='Sheet4')throw new Error('当前执行器仅支持已核对的Sheet4五项口径，不能推断其他来源规则。');
  const next=ensureEcommerceCatalog(catalog,options);
  if(!next.events.some(event=>event.kind==='policies'&&event.id===EC_POLICY_ID&&event.version===VERSION&&event.action==='确认Sheet4口径')){
    next.events.push({kind:'policies',id:EC_POLICY_ID,version:VERSION,action:'确认Sheet4口径',source:'Sheet4',confirmedBy:options.owner||'审核人',at:options.now||new Date().toISOString()});
  }
  validateCatalog(next);return next;
}

/** Only published versions whose complete frozen body the current executor supports are selectable. */
export function listExecutableEcommerceVersions(catalog,{asOf=new Date().toISOString().slice(0,10)}={}) {
  validateCatalog(catalog);
  const versions=[];
  try{
    const basis=createBasisSnapshot(catalog,{effectiveDate:asOf,ruleIds:EC_RULE_IDS});
    assertTaskCatalogScene({catalog,scene:'电商评论回复',basisSnapshot:basis});
    validateLegacyEcommerceBasis(basis);
    versions.push({version:VERSION,title:'Sheet4已确认口径（当前执行器V1.0）',ruleIds:[...EC_RULE_IDS],policyIds:[EC_POLICY_ID]});
  }catch{}
  for(const record of listRuleSets(catalog,{asOf,includeUnavailable:false})){
    try{
      const basis=createEcommerceRuleSetBasis(catalog,{ruleSetId:record.ruleSetId,version:record.version,effectiveDate:asOf});
      versions.push({ruleSetId:record.ruleSetId,version:record.version,title:record.title===EC_STAGE_A_TITLE?record.title:`${record.title} · ${EC_STAGE_A_TITLE}`,executionProfile:record.executionProfile,trial:true,calendarConfirmed:record.calendarConfirmed,timeRule:structuredClone(record.timeRule),ruleIds:[...EC_RULE_IDS],policyIds:basis.policies.map(policy=>policy.id)});
    }catch{}
  }
  return versions;
}

/** Guard the frozen body before a specialized evaluator applies known test semantics. */
function validateLegacyEcommerceBasis(basis) {
  if (!basis || !Array.isArray(basis.rules) || basis.rules.length !== EC_RULE_IDS.length ||
      new Set(basis.rules.map(rule => rule?.id)).size !== EC_RULE_IDS.length ||
      !RULES.every(expected => matchesRule(basis.rules.find(rule => rule?.id === expected.id), expected))) throw new Error('电商测试规则必须完整匹配已确认的五项V1.0正文；规则改版后需重新适配，不能沿用固定判断。');
  if (!Array.isArray(basis.policies) || basis.policies.length !== 1 || !matchesPolicy(basis.policies[0])) throw new Error('电商测试依据资料必须完整匹配EC-POLICY V1.0五项测试口径正文。');
  return true;
}

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equivalent=(left,right)=>same(canonical(left),canonical(right));

/** Materialized records are derived exclusively from the frozen structured ruleSet. */
export function materializeEcommerceTimeRecords(ruleSetSnapshot){
  validateRuleSet(ruleSetSnapshot,{publishing:true});
  if(ruleSetSnapshot.status!=='已发布')throw new Error('冻结规则集必须来自已发布版本。');
  const r=ruleSetSnapshot,t=r.timeRule,c=t.calendar,version=ruleSetNumericVersion(r.version),policyId=`EC-TIME-${r.ruleSetId}`;
  const working=t.mode==='workingHours';
  const mode=working?'累计工作时间':'连续自然时间';
  const calendar=`时区${c.timezone}；工作日${c.workdays.join('、')}；每日${c.workStart}—${c.workEnd}；假期${c.holidays.length}天、补班${c.workingDates.length}天，具体日期以冻结配置及本资料的日期清单为准。`;
  const thresholds=`默认${t.thresholds.default}小时；${Object.entries(t.thresholds.byType).map(([type,hours])=>`${type}${hours}小时`).join('；')||'无分类覆盖'}。评价类型取原O列；缺失、未知或未配置的类型使用default并记录来源。`;
  const passCriteria=`按${mode}精确累计评论至首次回复的毫秒差；${working?`${calendar}仅累计配置工作窗口，不擅自扣午休。`:'包含晚间、周末和假期；calendar在此模式不扣除时间。'}${thresholds}累计时长不超过命中的阈值为Pass，恰好阈值通过；不使用旧行级thresholdHours覆盖本规则集配置。`;
  const failCriteria=`仅当已回复且有效时间的${mode}严格超过命中阈值时为Fail；阈值及来源按本规则集冻结的thresholds计算，不得临时猜测。`;
  const exceptionCriteria=`${EXCEPTION}回复内容和首次回复时间同时为空才为未回复（bothEmpty）；${t.unrepliedRule?'未回复从评论时间累计至本次冻结inspectionAt，并单列业务状态，不判Pass或Fail。':'unrepliedRule=false时不启用未回复累计检核，保留无法判定及人工复核。'}有回复内容但时间空为时间缺失待补充；内容空但有时间为字段冲突；无效或反向时间不得伪造累计值。`;
  const scope=`${EC_STAGE_A_TITLE}试运行；规则集${r.ruleSetId}@${r.version}。仅时效使用本配置，其他四项继续Sheet4 V1。${working?calendar:`使用${c.timezone}解释；执行连续自然时间。`}日历${r.calendarConfirmed?'已经维护人核对':'未核对，空假期表不代表已经排除实际法定节假日'}。正式上线前仍须业务复核24H含义。`;
  const common={version,status:'已发布',effectiveAt:r.effectiveAt,expiresAt:r.expiresAt,owner:r.owner,changeNote:r.changeNote,createdAt:r.createdAt,publishedAt:r.updatedAt};
  const rule={...common,id:'EC-TIME',title:`回复时效（${r.version}试运行）`,name:`回复时效（${r.version}试运行）`,category:'电商评论测试',scope,passCriteria,failCriteria,exceptionCriteria,policyIds:[policyId]};
  const sections=[{id:`${policyId}-1`,title:`${r.ruleSetId}@${r.version}结构化时效口径`,text:`本条由已发布的阶段A试运行规则集生成，非正式制度。\n${scope}\nPass：${passCriteria}\nFail：${failCriteria}\n无法判定及未回复：${exceptionCriteria}`}];
  for(const [key,label] of [['holidays','假期'],['workingDates','补班']]){
    for(let offset=0;offset<c[key].length;offset+=100)sections.push({id:`${policyId}-${key}-${offset/100+1}`,title:`${label}日期清单 ${offset/100+1}`,text:c[key].slice(offset,offset+100).join('、')});
  }
  const policy={...common,id:policyId,title:`${r.ruleSetId}@${r.version}时效执行依据`,category:'电商评论测试',scope,source:`规则集${r.ruleSetId}@${r.version}（${r.title}）；executionProfile=${r.executionProfile}；trial=true；结构化timeRule为本条生成依据。`,sections,content:contentOf(sections)};
  return {rule,policy};
}

/** Pure compiler; generic legacy createBasisSnapshot remains unchanged. */
export function compileEcommerceRuleSetBasis(legacyBasis,ruleSetSnapshot){
  validateLegacyEcommerceBasis(legacyBasis);
  const {rule,policy}=materializeEcommerceTimeRecords(ruleSetSnapshot);
  if(ruleSetSnapshot.effectiveAt>legacyBasis.effectiveDate||(ruleSetSnapshot.expiresAt&&legacyBasis.effectiveDate>=ruleSetSnapshot.expiresAt))throw new Error('冻结规则集在任务生效日期不可用。');
  return {...structuredClone(legacyBasis),rules:legacyBasis.rules.map(item=>item.id==='EC-TIME'?rule:structuredClone(item)),policies:[...structuredClone(legacyBasis.policies),policy],ruleSetSnapshot:structuredClone(ruleSetSnapshot)};
}

export function createEcommerceRuleSetBasis(catalog,{ruleSetId,version,effectiveDate,now=new Date().toISOString()}={}){
  validateCatalog(catalog);
  const ruleSet=resolvePublishedRuleSet(catalog,{ruleSetId,version,effectiveDate});
  const legacy=createBasisSnapshot(catalog,{effectiveDate,ruleIds:EC_RULE_IDS,now});
  assertTaskCatalogScene({catalog,scene:'电商评论回复',basisSnapshot:legacy});
  return compileEcommerceRuleSetBasis(legacy,ruleSet);
}

function validateStageABasis(basis){
  const snapshot=basis?.ruleSetSnapshot,{rule,policy}=materializeEcommerceTimeRecords(snapshot);
  if(!Array.isArray(basis.rules)||basis.rules.length!==EC_RULE_IDS.length||new Set(basis.rules.map(r=>r?.id)).size!==EC_RULE_IDS.length||!Array.isArray(basis.policies)||basis.policies.length!==2)throw new Error('阶段A必须冻结完整五项规则和两份依据资料。');
  if(!RULES.filter(expected=>expected.id!=='EC-TIME').every(expected=>matchesRule(basis.rules.find(r=>r?.id===expected.id),expected))||!matchesPolicy(basis.policies.find(p=>p?.id===EC_POLICY_ID)))throw new Error('阶段A的其他四项规则与原EC-POLICY必须完整匹配Sheet4 V1正文。');
  if(!equivalent(basis.rules.find(r=>r.id==='EC-TIME'),rule)||!equivalent(basis.policies.find(p=>p?.id===policy.id),policy))throw new Error('阶段A时效规则及资料必须完整匹配冻结规则集配置生成的正文。');
  if(typeof basis.effectiveDate!=='string'||snapshot.effectiveAt>basis.effectiveDate||(snapshot.expiresAt&&basis.effectiveDate>=snapshot.expiresAt))throw new Error('阶段A任务日期与规则集生效期不匹配。');
  return true;
}

export function validateEcommerceBasis(basis){
  if(isBusinessEcommerceBasis(basis))return validateBusinessEcommerceBasis(basis);
  return basis&&Object.hasOwn(basis,'ruleSetSnapshot')?validateStageABasis(basis):validateLegacyEcommerceBasis(basis);
}

/** New tasks authenticate against published catalog records; saved tasks use their immutable frozen body. */
export function authenticateEcommerceRuleSetBasis(catalog,basis,{requirePublished=true}={}){
  validateCatalog(catalog);validateStageABasis(basis);
  if(requirePublished)assertTaskCatalogScene({catalog,scene:'电商评论回复',basisSnapshot:basis});
  const frozen=basis.ruleSetSnapshot,record=(catalog.ruleSets||[]).find(r=>r.ruleSetId===frozen.ruleSetId&&r.version===frozen.version);
  if(!record||(requirePublished&&record.status!=='已发布')||(!requirePublished&&!['已发布','已停用'].includes(record.status)))throw new Error('任务规则集必须匹配目录已发布版本。');
  const source=structuredClone(record);if(!requirePublished&&source.status==='已停用'){source.status=frozen.status;source.updatedAt=frozen.updatedAt;}
  if(!equivalent(source,frozen))throw new Error('冻结规则集内容与目录已发布配置不匹配。');
  const legacy=createBasisSnapshot(catalog,{effectiveDate:basis.effectiveDate,ruleIds:EC_RULE_IDS,now:basis.capturedAt});
  const expected=compileEcommerceRuleSetBasis(legacy,frozen);
  const withoutSceneMetadata=value=>({...value,rules:value.rules.map(({sceneIds,...record})=>record),policies:value.policies.map(({sceneIds,...record})=>record)});
  if(!equivalent(withoutSceneMetadata(expected),withoutSceneMetadata(basis)))throw new Error('任务依据快照与已发布目录重建结果不匹配。');
  return true;
}

export function isEcommerceBasis(basis) {
  try { return validateEcommerceBasis(basis); } catch { return false; }
}
