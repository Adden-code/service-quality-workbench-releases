import {normalizeEcReportMetadata} from './ec-report-metadata.mjs';
import {hasCompletedAI,hasRawFallback} from './session-result-availability.mjs';
import {newImportLineage,isRepeatedImport} from './import-lineage.mjs';
import {requiresEcommerceClassification,classificationReviewed,classificationNeedsJudgment} from './ecommerce-classification-review.mjs';
import {ruleExemption,calibratedReviewPolicy} from './rule-calibration-policy.mjs';
import {freezeSceneExecution,latestSceneConfiguration} from './scene-configuration.mjs';
import {usableTaskState,isVoidedTask,isInactiveTask,assertTaskWritable} from './task-lifecycle.mjs';
import {normalizeExecutionSettings} from './execution-settings.mjs';
import {normalizeReviewPolicy,isAIFinal,isFinalSession,isReviewWorkComplete,requiresHumanReview} from './ai-triage.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';
import {validateCleaningReportSnapshot} from './conversation-cleaning.mjs';
// 演示材料与业务任务的纯状态变换；不调用模型、网络或浏览器存储。
import {getSessionRules, resolveTaskReference} from './task-basis.mjs';
import {inspectionRules} from './scene-aggregate.mjs';
import {validateFieldEvidence} from './context-fields.mjs';
import {isSceneKey,freezeScenario,checkScenarioCapabilities,validateScenarioMapping,scenarioForTask,sameScenarioConfig} from './scenarios.mjs';
import {validateInputProfile} from './input-profiles.mjs';
import {EC_RULE_IDS,validateEcommerceRecord,validateEcommerceSource,ecommerceTimeValues,validateEcommerceSources} from './ecommerce-schema.mjs';
import {validateEcommerceBasis} from './ecommerce-catalog.mjs';
import {computeEcommerceTimeFacts,isStageATimeBasis,timePolicyReferences} from './ecommerce-time-results.mjs';
import {RAW_INPUT_MODE,RAW_EVIDENCE_VERSION,isRawTranscriptSession,validateRawTranscript,normalizeRawTimePolicy} from './raw-transcript.mjs';
import {matchRawQuote,validateRawResultAssurance,RAW_QUOTE_MATCHING_VERSION} from './raw-evidence.mjs';
export const INITIAL_TASK_ID = 'TASK-20261018-001';
const DEFAULT_NOW = '2026-10-18T10:00:00+08:00';
const VERDICTS = ['符合', '不符合', '无法判定', '不适用'];
const clone = value => structuredClone(value);

export const products = [
  { id: 'XL-A1', name: '星澜 A1', price: 2499, memory: '12+256GB', battery: '5000mAh', charging: '66W', wirelessCharging: '不支持', facts: ['售价2499元', '12+256GB', '5000mAh电池', '66W有线充电', '不支持无线充电'] },
  { id: 'XL-A1-PRO', name: '星澜 A1 Pro', price: 3299, memory: '12+512GB', battery: '5200mAh', charging: '88W', wirelessCharging: '30W', facts: ['售价3299元', '12+512GB', '5200mAh电池', '88W有线充电', '支持30W无线充电'] },
];

const policy = (id, title, category, sections) => ({
  id, title, version: 'V1.0', effectiveAt: '2026-10-01', category,
  content: sections.map(section => `${section.id} ${section.title}\n${section.text}`).join('\n\n'),
  sections,
});
export const policies = [
  policy('P001', '星澜 A 系列产品参数说明（虚构）', '产品信息', [
    { id: 'P001-1', title: '星澜 A1 标准参数', text: '星澜 A1 售价2499元，12+256GB，5000mAh电池，支持66W有线充电，不支持无线充电。不得混用 Pro 版本参数。' },
    { id: 'P001-2', title: '星澜 A1 Pro 标准参数', text: '星澜 A1 Pro 售价3299元，12+512GB，5200mAh电池，支持88W有线充电及30W无线充电。' },
  ]),
  policy('P002', '星澜商城优惠说明（虚构）', '价格与优惠', [
    { id: 'P002-1', title: '200元优惠券使用条件', text: '演示活动券为满2999元减200元，必须先领券再使用；客服说明券后价时须同时说明门槛及领券动作。星澜 A1 单机2499元不满足门槛。' },
    { id: 'P002-2', title: '到手价计算', text: '星澜 A1 Pro 单机售价3299元，满足满2999元门槛并领取200元券后，到手价为3299－200＝3099元。此价格不等于无条件直降。' },
  ]),
  policy('P003', '订单出库与配送说明（虚构）', '物流履约', [
    { id: 'P003-1', title: '出库口径', text: '现货订单支付成功后预计48小时内出库。出库不等于送达；物流配送时间以物流页面为准，不得保证明天到货、次日必达或指定日期送达。' },
    { id: 'P003-2', title: '时效咨询回应', text: '客户询问到货时间时，应区分出库与配送，告知查询路径；缺少地址或物流信息时不得推定送达日期。' },
  ]),
  policy('P004', '售前沟通与交易规范（虚构）', '沟通与服务', [
    { id: 'P004-1', title: '需求澄清与推荐', text: '推荐产品前，应了解客户已表达的预算、用途及必要功能；已明确的信息无需重复追问。推荐超出预算时应说明差额并征求接受度，不得忽略明确的必要条件。' },
    { id: 'P004-2', title: '客观沟通', text: '使用可核对的信息说明产品，不得使用永远不卡、绝对第一、100%不会坏等无法证明的绝对化或夸大承诺。' },
    { id: 'P004-3', title: '官方支付', text: '仅引导客户通过星澜商城官方订单支付。禁止要求私人转账、个人收款码付款，或以私下优惠引导绕开官方订单。' },
    { id: 'P004-4', title: '结束确认', text: '完成解答后，应确认客户问题是否已解决或是否还有其他疑问。会话仍在取证、等待客户材料时，不强行判断解答已经完成。' },
    { id: 'P004-5', title: '信息不足的处理', text: '截图或附件缺失、关键上下文不足时，应明确缺失信息并请求补充；审核者无法取得关键证据时使用无法判定，不得把缺失信息等同于违规。与会话无关的规则使用不适用。' },
  ]),
];

const rule = (id, name, category, scope, passCriteria, failCriteria, exceptionCriteria, policyIds) => ({
  id, name, category, version: 'V1.0', scope, passCriteria, failCriteria, exceptionCriteria, policyIds, enabled: true,
});
export const rules = [
  rule('R001', '产品参数准确', '产品信息', '涉及产品参数或型号对比的售前会话', '型号、内存、电池和充电等参数与对应产品说明一致。', '混淆型号或提供与产品说明不符的参数。', '没有涉及产品参数时不适用；关键材料缺失时无法判定。', ['P001']),
  rule('R002', '优惠条件与价格准确', '价格与优惠', '涉及优惠券、活动价、到手价的售前会话', '优惠门槛、领券动作与价格计算一致，3299减200为3099。', '遗漏优惠条件、把条件价说成无条件价格，或价格计算错误。', '未涉及优惠活动时不适用；关键价格页面缺失时无法判定。', ['P002']),
  rule('R003', '物流时效承诺合规', '物流履约', '涉及出库、配送及到货时间的售前会话', '明确48小时预计出库与实际配送的区别，不保证送达时间。', '把预计出库等同送达，或保证明天、次日、指定日期送达。', '没有物流时效内容时不适用；关键物流证据缺失时无法判定。', ['P003']),
  rule('R004', '沟通客观无夸大', '沟通规范', '全部售前会话', '使用客观可核对的描述。', '使用绝对第一、永远不卡等无法证实的绝对化承诺。', '信息缺失导致无法核对时使用无法判定。', ['P004']),
  rule('R005', '澄清需求并匹配推荐', '需求匹配', '涉及产品选择或需澄清条件的售前会话', '充分利用已知预算和功能，推荐匹配；超预算需说明并征得接受。', '忽略明确预算或必要功能直接推荐不匹配商品。', '仅有无需推荐的单一事实咨询时不适用；必要需求缺失且无法取证时无法判定。', ['P001', 'P004']),
  rule('R006', '使用官方交易渠道', '交易安全', '涉及下单、支付或交易渠道的售前会话', '通过官方商城订单支付。', '要求私人转账或绕开官方订单。', '未涉及交易或支付渠道时不适用。', ['P004']),
  rule('R007', '信息完整与结束确认', '服务完整性', '已完成解答或需要补充材料的售前会话', '完成解答后确认是否解决；信息不足时明确请求补充。', '已完成解答但没有结束确认，或在信息不足时给出确定结论。', '关键附件缺失导致不能完成审核时无法判定；进行中的取证不因未结束而直接违规。', ['P004']),
];
const defaultRefs = {
  R001: ['P001-1', 'P001-2'], R002: ['P002-1', 'P002-2'], R003: ['P003-1', 'P003-2'],
  R004: ['P004-2'], R005: ['P004-1'], R006: ['P004-3'], R007: ['P004-4', 'P004-5'],
};
const judgment = (ruleId, verdict, reason, evidence = [], referenceIds = defaultRefs[ruleId]) => ({ ruleId, verdict, reason, evidence, referenceIds: [...referenceIds] });
const yes = (id, reason, evidence, refs) => judgment(id, '符合', reason, evidence, refs);
const no = (id, reason, evidence, refs) => judgment(id, '不符合', reason, evidence, refs);
const na = (id, reason) => judgment(id, '不适用', reason);
const emptyReview = () => ({ status: '待审核', reviewer: '演示审核员', completedAt: null, drafts: {}, notes: '' });
const ownDraft = (session,ruleId) => Object.hasOwn(session.review.drafts,ruleId)?session.review.drafts[ruleId]:null;
const makeSession = (index, details, lines, results) => {
  const id = `DEMO_PRE${String(index).padStart(3, '0')}`;
  const hour = '09';
  const minute = (index - 1) * 5;
  return {
    id, externalId: id, taskId: INITIAL_TASK_ID, customer: `演示客户${String(index).padStart(2, '0')}`,
    agent: `演示客服${['小岚', '小禾', '小舟'][(index - 1) % 3]}`, channel: '星澜商城在线客服',
    ...details, startedAt: `2026-10-18T${hour}:${String(minute).padStart(2, '0')}:00+08:00`,
    turns: lines.map(([role, text], n) => ({ id: n + 1, role, speaker: role === '客服' ? `演示客服${['小岚', '小禾', '小舟'][(index - 1) % 3]}` : role === '客户' ? `演示客户${String(index).padStart(2, '0')}` : '演示系统', text, at: `${hour}:${String(minute + n).padStart(2, '0')}` })),
    aiResults: results, review: emptyReview(),
  };
};

export const demoSessions = [
  makeSession(1, { topic: 'A1 无线充电咨询', product: '星澜 A1', intent: '核对充电功能', demoFocus: '明确违规：A1 被说成支持无线充电', scenarioKey: 'wrong-wireless-claim' }, [
    ['客户', '我预算2600，平时看视频，已经看中A1。它能用无线充电板吗？'],
    ['客服', '可以的，星澜A1售价2499元，12+256GB，支持30W无线充电，放到充电板上就能充。'],
    ['客户', '那我家里的无线充电板就能用了。'],
    ['客服', '是的。关于这个充电问题还有其他疑问吗？'],
    ['客户', '没有了。'],
  ], [
    no('R001', '第2轮将A1说成支持30W无线充电；P001-1明确A1不支持无线充电。', [2], ['P001-1']),
    na('R002', '已检查第1—5轮，未涉及优惠活动或券后价。'),
    na('R003', '已检查第1—5轮，未涉及出库或到货时间。'),
    yes('R004', '已检查第1—5轮，无绝对化或夸大宣传用语；参数错误另由R001处理。', [2, 4]),
    na('R005', '客户已选定A1并单独核对充电功能，本轮没有产品推荐。'),
    na('R006', '已检查第1—5轮，未涉及支付或下单渠道。'),
    yes('R007', '第4轮询问是否还有疑问，第5轮客户确认结束。', [4, 5]),
  ]),
  makeSession(2, { topic: 'A1 Pro 活动报价', product: '星澜 A1 Pro', intent: '查询到手价格', demoFocus: '明确违规：优惠门槛与领券动作遗漏', scenarioKey: 'coupon-conditions-missing' }, [
    ['客户', '我预算3500，想买A1 Pro的12+512GB，现在多少？'],
    ['客服', '星澜A1 Pro现在到手3099元，直接下单就行。'],
    ['客户', '这个价还需要做别的吗？'],
    ['客服', '不用，3099元就是到手价。'],
    ['客户', '好的，知道了。'],
    ['客服', '价格问题解释清楚了吗，还有其他问题吗？'],
    ['客户', '没有了。'],
  ], [
    yes('R001', '第1轮客户咨询A1 Pro 12+512GB，客服没有提供冲突的产品参数。', [1], ['P001-2']),
    no('R002', '第2、4轮将3099元描述为直接下单价格，遗漏满2999元且先领200元券的条件。', [2, 4]),
    na('R003', '已检查第1—7轮，无物流时效咨询。'),
    yes('R004', '已检查第1—7轮，无绝对化或夸大产品承诺。', [2, 4]),
    na('R005', '客户已明确选定A1 Pro，仅查询价格，没有推荐环节。'),
    yes('R006', '第2轮引导常规下单，未出现私下支付或个人收款。', [2]),
    yes('R007', '第6轮进行了结束确认，第7轮客户回应没有其他问题。', [6, 7]),
  ]),
  makeSession(3, { topic: 'A1 Pro 领券后价格核对', product: '星澜 A1 Pro', intent: '确认优惠计算', demoFocus: 'AI误判：已说明条件的3099元应改判符合', scenarioKey: 'ai-false-positive' }, [
    ['客户', 'A1 Pro标价3299元，我已经领了满2999减200的券，是不是3099元？'],
    ['客服', '是的。星澜A1 Pro售价3299元，满足满2999元门槛，您已领200元券，使用后3299减200，到手3099元。'],
    ['客户', '明白了，我会到官方商城订单页用券支付。'],
    ['客服', '好的，请在星澜商城官方订单确认优惠再支付。这次价格问题解决了吗？'],
    ['客户', '解决了，谢谢。'],
  ], [
    na('R001', '已检查第1—5轮，仅核对价格，未说明技术参数。'),
    no('R002', '演示预置误判：把3099元与3299元标价的差异当作报价错误，未正确结合第2轮已说明的满减与领券条件。', [2]),
    na('R003', '已检查第1—5轮，没有物流时效内容。'),
    yes('R004', '第2、4轮使用客观价格解释与订单指引，无夸大承诺。', [2, 4]),
    na('R005', '客户已选定产品，咨询仅为优惠计算，无推荐环节。'),
    yes('R006', '第4轮明确要求通过星澜商城官方订单支付。', [4]),
    yes('R007', '第4轮询问是否解决，第5轮客户确认解决。', [4, 5]),
  ]),
  makeSession(4, { topic: '周末用机到货咨询', product: '星澜 A1', intent: '确认配送时间', demoFocus: 'AI漏判：保证明天到货需人工补充问题', scenarioKey: 'ai-false-negative' }, [
    ['客户', '我准备买A1，明天晚上出差，来得及收到吗？'],
    ['客服', '星澜商城现货订单支付后预计48小时内出库。'],
    ['客户', '我的意思是明天一定能拿到吗？'],
    ['客服', '您现在下单，我保证明天必达，肯定赶得上出差。'],
    ['客户', '那我去商城下单。'],
    ['客服', '请在星澜商城官方订单支付，配送问题还有不清楚的吗？'],
    ['客户', '没有了。'],
  ], [
    na('R001', '已检查第1—7轮，没有产品技术参数描述。'),
    na('R002', '已检查第1—7轮，没有活动或价格条件内容。'),
    yes('R003', '演示预置漏判：第2轮提到48小时预计出库，因此给出符合；未识别第4轮的确定送达保证。', [2]),
    yes('R004', '已检查第1—7轮，无产品性能绝对化宣传；配送承诺应由R003核对。', [2, 4]),
    na('R005', '客户已选定A1，仅咨询配送时效，没有产品推荐。'),
    yes('R006', '第6轮引导官方订单支付。', [6]),
    yes('R007', '第6轮询问是否清楚，第7轮客户确认。', [6, 7]),
  ]),
  makeSession(5, { topic: '活动页面截图缺失', product: '星澜 A1 Pro', intent: '核对页面提示', demoFocus: '信息不足：缺失截图不能直接定性违规', scenarioKey: 'missing-evidence' }, [
    ['客户', 'A1 Pro页面上那个提示是什么意思？我刚发了截图。'],
    ['系统', '演示附件不可用：原截图未随会话导入。'],
    ['客服', '我这里没有收到截图，请重新上传或把完整提示文字发来，我再帮您核对。'],
    ['客户', '截图暂时找不到了，我晚点补。'],
    ['客服', '好的，补充截图或提示原文后再核对，目前不能确定您说的是哪项提示。'],
  ], [
    na('R001', '已检查第1—5轮，没有可核对的产品参数描述。'),
    na('R002', '已检查第1—5轮，未知提示内容，未出现具体优惠或价格承诺。'),
    na('R003', '已检查第1—5轮，没有物流咨询或配送承诺。'),
    yes('R004', '第3、5轮客观说明材料不足，没有作出绝对化承诺。', [3, 5]),
    yes('R005', '第3轮为核对提示内容主动澄清缺失信息，第5轮说明待补充后再核对。', [3, 5]),
    na('R006', '已检查第1—5轮，没有下单或支付内容。'),
    judgment('R007', '无法判定', '第2轮提示截图未导入；第3—5轮仍在等待材料，无法核对原页面提示及完整解答结果，不直接视作违规。', [2, 3, 4, 5], ['P004-4', 'P004-5']),
  ]),
  makeSession(6, { topic: '预算内日常用机推荐', product: '星澜 A1', intent: '选择预算内机型', demoFocus: '正常样本：完整需求匹配与客观解答', scenarioKey: 'normal' }, [
    ['客户', '预算2600元，主要聊天看视频，不需要无线充电，想要256GB。'],
    ['客服', '按您的预算和用途，星澜A1售价2499元，12+256GB，5000mAh电池，支持66W有线充电，不支持无线充电，符合您刚才的要求。'],
    ['客户', '可以，大概什么时候发货？'],
    ['客服', '现货订单支付后预计48小时内出库，具体送达时间以物流页面为准，出库不代表已经送达。请在星澜商城官方订单支付。'],
    ['客户', '好的，这些都清楚了。'],
    ['客服', '这次选购问题解决了吗，是否还有其他疑问？'],
    ['客户', '解决了，没有其他问题。'],
  ], [
    yes('R001', '第2轮A1的价格、内存、电池、有线充电和无线充电说明与P001-1一致。', [2], ['P001-1']),
    na('R002', '已检查第1—7轮，没有使用优惠券或活动报价。'),
    yes('R003', '第4轮区分48小时预计出库与实际送达，并指引物流页面。', [4]),
    yes('R004', '已检查第1—7轮，描述客观且无绝对化宣传。', [2, 4]),
    yes('R005', '第1轮已明确预算、用途、容量和无线充电需求，第2轮推荐2499元A1匹配上述条件。', [1, 2], ['P004-1', 'P001-1']),
    yes('R006', '第4轮引导官方商城订单支付。', [4]),
    yes('R007', '第6轮结束确认，第7轮明确问题已解决。', [6, 7]),
  ]),
  makeSession(7, { topic: '明确预算下的型号推荐', product: '星澜 A1 Pro', intent: '预算内选择256GB手机', demoFocus: '需求不匹配：忽略2600元预算推荐3299元机型', scenarioKey: 'budget-mismatch' }, [
    ['客户', '预算最多2600元，不能再加了。只聊天看视频，256GB就够，不要无线充电。'],
    ['客服', '直接买星澜A1 Pro吧，3299元，12+512GB，5200mAh，88W有线充电和30W无线充电。'],
    ['客户', '可我的预算只有2600元。'],
    ['客服', '就买这个吧，我给您推荐A1 Pro。'],
    ['客户', '那我再考虑一下。'],
    ['客服', '好的，刚才参数还有哪里不清楚吗？'],
    ['客户', '参数清楚了。'],
  ], [
    yes('R001', '第2轮A1 Pro参数与P001-2一致。', [2], ['P001-2']),
    na('R002', '已检查第1—7轮，没有活动券或条件价。'),
    na('R003', '已检查第1—7轮，没有配送内容。'),
    yes('R004', '已检查第1—7轮，无产品性能绝对化宣传。', [2, 4]),
    no('R005', '第1、3轮客户明确预算不超过2600元；第2、4轮仍直接推荐3299元Pro，未说明差额或征得超预算接受。', [1, 2, 3, 4], ['P004-1', 'P001-1', 'P001-2']),
    na('R006', '已检查第1—7轮，没有支付渠道指引。'),
    yes('R007', '第6轮进行了进一步疑问确认，第7轮客户回应。', [6, 7]),
  ]),
  makeSession(8, { topic: '低价促单与私人收款', product: '星澜 A1', intent: '确认日常体验和购买渠道', demoFocus: '多问题：夸大宣传并诱导私人转账', scenarioKey: 'exaggeration-private-transfer' }, [
    ['客户', '预算3000元，主要看视频，A1的256GB够用就行，平时会不会卡？'],
    ['客服', '星澜A1是12+256GB、5000mAh，2499元。这机子绝对行业第一，永远不卡，100%不会坏。'],
    ['客户', '那我在哪下单？'],
    ['客服', '不用走商城订单，直接转到我的个人收款码，我私下给您处理。'],
    ['客户', '我先想一想。'],
    ['客服', '好的，关于这款手机还有其他疑问吗？'],
    ['客户', '暂时没有。'],
  ], [
    yes('R001', '第2轮A1的内存、电池和标价符合P001-1，绝对化性能承诺由R004处理。', [2], ['P001-1']),
    na('R002', '已检查第1—7轮，没有具体优惠活动或券后价承诺。'),
    na('R003', '已检查第1—7轮，没有物流时效内容。'),
    no('R004', '第2轮使用绝对行业第一、永远不卡、100%不会坏等无法证明的承诺。', [2]),
    yes('R005', '第1轮已知3000元预算与256GB需求，推荐2499元A1与这些明确条件一致。', [1, 2], ['P004-1', 'P001-1']),
    no('R006', '第4轮要求转到个人收款码并绕过官方商城订单。', [4]),
    yes('R007', '第6轮确认其他疑问，第7轮客户回应。', [6, 7]),
  ]),
];

const getSession = (state, sessionId) => {
  const item = state.sessions.find(session => session.id === sessionId);
  if (!item) throw new Error(`会话不存在：${sessionId}`);
  return item;
};
const getTask = (state, taskId) => {
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`任务不存在：${taskId}`);
  return task;
};
const nextId = (records, prefix) => {
  let number=1;
  while(records.some(item=>item.id===`${prefix}${number}`))number++;
  return `${prefix}${number}`;
};
const manual = (state,item) => getTask(state,item.taskId).mode==='manual';
export {hasCompletedAI} from './session-result-availability.mjs';
export const getReviewDisposition=session=>session.review?.disposition==='unreplied'?'unreplied':'quality';
export function isUnrepliedSession(state,session){
 const basis=state.tasks.find(t=>t.id===session.taskId)?.basisSnapshot,r=session.ecommerce;
 return Boolean(isStageATimeBasis(basis)&&r&&!r.raw[9].trim()&&!r.raw[13].trim());
}
export function canConfirmUnreplied(state,session){
 try{
  const task=getTask(state,session.taskId);
  if(task.mode!=='manual'||!isUnrepliedSession(state,session)||!hasCompletedAI(session)||session.aiExecution?.status==='running')return false;
  validateEcommerceBasis(task.basisSnapshot);
  validateEcommerceSource(session);
  const run=[task.aiRun,...(task.aiRunHistory||[])].find(r=>r?.id===session.aiExecution.runId);
  if(!run?.inspectionAt)return false;
  const facts=computeEcommerceTimeFacts(session,task.basisSnapshot,{inspectionAt:run.inspectionAt}),saved=session.aiResults.find(r=>r.ruleId==='EC-TIME')?.timeFacts;
  if(facts.replyStatus!=='unreplied'||!saved||Object.keys(saved).length!==Object.keys(facts).length||Object.keys(facts).some(key=>saved[key]!==facts[key]))return false;
  if(JSON.stringify(session.aiResults.find(r=>r.ruleId==='EC-TIME')?.referenceIds)!==JSON.stringify(timePolicyReferences(task.basisSnapshot)))return false;
  if(session.aiResults.some(result=>result.verdict!=='无法判定')||Object.values(session.review.drafts).some(result=>result.verdict!=='无法判定'))return false;
  return true;
 }catch{return false;}
}
export function confirmUnrepliedReview(state,sessionId,reviewer,now){
 const existing=getSession(state,sessionId);assertReviewAvailable(state,existing);
 if(!canConfirmUnreplied(state,existing))throw new Error('未回复事实尚未具备可核验的冻结时间结果，或已有矛盾人工判定；请核对后处理，未覆盖原审核。');
 if(typeof reviewer!=='string'||!reviewer.trim())throw new Error('未回复事实确认须填写非空审核人标签。');
 now=operationTime(state,existing,now);
 const task=getTask(state,existing.taskId);
 if(Date.parse(now)<Date.parse(task.createdAt)||Date.parse(now)<Date.parse(existing.startedAt))throw new Error('事实确认时间不能早于评论或任务创建时间。');
 const next=cloneReviewState(state,sessionId),item=getSession(next,sessionId);
 item.review.disposition='unreplied';item.review.status='已确认';item.review.reviewer=reviewer.trim();item.review.completedAt=now;
 item.review.history??=[];item.review.history.push({type:'unreplied-fact',disposition:'unreplied',at:now,reviewer:item.review.reviewer});
 activity(next,item,'确认未回复事实',now);refreshTask(next,item.taskId);return next;
}
const assertReviewAvailable=(state,item)=>{assertTaskWritable(state,item);if(isProcessedUnknown(item))throw new Error('已处理待补充只读，请先重新打开。');if(item.aiExecution?.status==='running')throw new Error('AI正在运行，完成后才能修改人工审核。');};
function actualTime(value,precision=3) {
  const m=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/);
  const date=m&&!m[1].startsWith('0000-')?new Date(`${m[1]}T00:00:00Z`):null;
  if(!m||!date||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==m[1]||+m[2]>23||+m[3]>59||+m[4]>59||(m[5]!=='Z'&&(+m[6]>14||+m[7]>59||(+m[6]===14&&+m[7]!==0)))||(value.match(/\.(\d+)/)?.[1]?.length??0)>precision||!Number.isFinite(Date.parse(value)))throw new Error('操作时间须为真实且包含时区的 ISO 日期时间。');
  return value;
}
export const cloneReviewState=(state,sessionId)=>{
 const target=getSession(state,sessionId);
 return {...state,...(state.tasks?{tasks:state.tasks.map(t=>t.id===target.taskId?{...t}:t)}:{}),sessions:state.sessions.map(s=>s.id===sessionId?{...s,review:clone(s.review)}:s),...(state.activity?{activity:state.activity.slice()}:{})};
};
const operationTime=(state,item,now)=>manual(state,item)?actualTime(now??new Date().toISOString()):(now??DEFAULT_NOW);
const activity = (state, item, action, now) => {
  state.activity.unshift({ id: nextId(state.activity,'ACT-'), sessionId: item.id, taskId: item.taskId, action, at: now, reviewer: item.review.reviewer });
};
const refreshTask = (state, taskId) => {
  const task = getTask(state, taskId);
  const sessions = state.sessions.filter(session => session.taskId === taskId);
  if(task.mode==='manual'){
    const confirmed=sessions.filter(isFinalSession).length;
    task.progress=sessions.length?Math.round(confirmed/sessions.length*100):0;
    task.status=sessions.length&&confirmed===sessions.length?'已完成':'待审核';
    return;
  }
  if (sessions.length && sessions.every(session => session.review.status === '已确认')) {
    task.status = '已完成';
  } else if (task.progress >= 100) task.status = '待审核';
  else if (task.progress > 0) task.status = '质检中';
  else task.status = '待质检';
};
const fillAIDrafts = (item,now,recordHistory=false) => {
  for (const result of item.aiResults) {
    if (item.expectedRuleIds?.includes(result.ruleId)!==false&&!ownDraft(item,result.ruleId)&&!ruleExemption(item,result.ruleId)){
      const saved={...clone(result),source:'AI接受'};
      item.review.drafts={...item.review.drafts,[result.ruleId]:saved};
      if(recordHistory){item.review.history??=[];item.review.history.push({ruleId:result.ruleId,at:now,reviewer:item.review.reviewer,before:null,after:clone(saved)});}
    }
  }
};

export function getSessionResults(session) {
  const expected=session.expectedRuleIds||session.aiResults.map(result=>result.ruleId);
  return expected.map(ruleId => {
    const fallback=hasRawFallback(session),result=(hasCompletedAI(session)||fallback?session.aiResults.find(result=>result.ruleId===ruleId):null)||{ruleId,verdict:null,reason:'',evidence:[],referenceIds:[]};
    const humanFinal=ownDraft(session,ruleId),final=humanFinal||(ruleExemption(session,ruleId)?{...clone(result),source:'AI规则免审'}:isAIFinal(session)?{...clone(result),source:'AI终判'}:null);
    const hasAI=VERDICTS.includes(result.verdict);
    return { ...clone(result), executionStatus:fallback?'执行失败':hasAI?'已执行':'未执行',final: clone(final),reviewed:Boolean(humanFinal),ruleExempt:Boolean(ruleExemption(session,ruleId)),...(isAIFinal(session)?{aiFinal:true}:{}),changed: Boolean(hasAI&&humanFinal && humanFinal.verdict !== result.verdict) };
  });
}

export function saveReview(state, sessionId, draft, now) {
  const item = getSession(state, sessionId);
  assertReviewAvailable(state,item);
  if(isRawTranscriptSession(item)&&isAIFinal(item))throw new Error('AI终判只读，请先标记可疑并填写原因退回人工。');
  if(isRawTranscriptSession(item)&&item.review.status==='已确认')throw new Error('人工确认结果只读，请先重新审核。');
  const sessionRules=getSessionRules(state,item),isManual=manual(state,item);
  now=operationTime(state,item,now);
  const rule=sessionRules.find(rule=>rule.id===draft?.ruleId);
  if (!rule||(isManual&&!item.expectedRuleIds.includes(draft.ruleId))) throw new Error('规则 ruleId 无效。');
  if (!VERDICTS.includes(draft.verdict)) throw new Error('判定 verdict 无效。');
  if(draft.verdict==='符合'&&typeof draft.reason==='string'&&!draft.reason.trim())draft={...draft,reason:'人工核对符合。'};
  if (typeof draft.reason !== 'string' || !draft.reason.trim()||draft.reason.length>20000) throw new Error('人工判定理由 reason 不能为空且不能超过20000字符。');
  if (!Array.isArray(draft.evidence) || draft.evidence.some(id => !item.turns.some(turn => turn.id === id))) throw new Error('证据 evidence 必须是本会话真实轮次。');
  let rawEvidence;
  if(isRawTranscriptSession(item)){
    if(!Array.isArray(draft.evidenceQuotes)||draft.evidenceQuotes.length>500)throw new Error('人工原文判定须提供逐字引文数组。');
    const evidenceQuotes=[],quoteSeen=new Set();
    for(const value of draft.evidenceQuotes){
      if(!value||typeof value.quote!=='string'||!value.quote.trim())throw new Error('人工原文引文不能为空。');
      const matches=matchRawQuote(item.rawTranscript.text,value.quote);if(!matches.length)throw new Error('人工引文未在本行原文逐字定位。');
      const quote=item.rawTranscript.text.slice(matches[0].start,matches[0].end);
      if(!quoteSeen.has(quote)){evidenceQuotes.push({quote,matches});quoteSeen.add(quote);}
    }
    rawEvidence={evidenceQuotes,turnRefs:[],rawValidation:{schemaVersion:1,status:evidenceQuotes.length?'verified':'manual-provided',textSha256:item.rawTranscript.textSha256,evidenceMatching:RAW_QUOTE_MATCHING_VERSION,reasonCodes:evidenceQuotes.length?[]:['missing_quote']}};
    // Human quotation is optional; supplied quotations still require exact source locations.
    if(!validateRawResultAssurance({...draft,...rawEvidence},item).valid)throw new Error('人工原文引文校验未通过。');
  }
  if(draft.fieldEvidence!==undefined)validateFieldEvidence(draft.fieldEvidence,item.contextFields||[]);
  const references = draft.referenceIds ?? (isManual?[]:defaultRefs[draft.ruleId]) ?? [];
  if (!Array.isArray(references) || new Set(references).size!==references.length||references.some(id => {
    const reference=resolveTaskReference(state,item,id);return !reference||!rule.policyIds.includes(reference.policy.id);
  })) throw new Error('依据条款 referenceIds 无效。');
  const next = cloneReviewState(state,sessionId);
  const updated = getSession(next, sessionId);
  const initial = hasCompletedAI(updated)?updated.aiResults.find(result => result.ruleId === draft.ruleId):null;
  const source = isManual&&!initial?'人工独立审核':!isManual&&draft.source === 'AI接受' && draft.verdict === initial?.verdict ? 'AI接受'
    : draft.verdict === '不符合' && initial?.verdict !== '不符合' ? '人工补充' : '人工修改';
  const before=clone(ownDraft(updated,draft.ruleId));
  const saved={ ruleId: draft.ruleId, verdict: draft.verdict, reason: draft.reason.trim(), evidence: [...draft.evidence], referenceIds: [...references], source };
  if(rawEvidence)Object.assign(saved,rawEvidence);
  if(draft.fieldEvidence!==undefined)saved.fieldEvidence=[...draft.fieldEvidence];
  updated.review.drafts={...updated.review.drafts,[draft.ruleId]:saved};
  if(isManual){
    updated.review.history??=[];
    updated.review.history.push({ruleId:draft.ruleId,at:now,reviewer:updated.review.reviewer,before,after:clone(saved)});
  }
  updated.review.status = isManual&&Object.values(updated.review.drafts).some(result=>result.verdict==='无法判定')?'待补充':'已暂存';
  updated.review.completedAt = null;
  delete updated.review.disposition;
  activity(next, updated, '暂存审核', now);
  refreshTask(next, updated.taskId);
  return next;
}

export function acceptAI(state, sessionId, now) {
  const existing=getSession(state, sessionId);
  assertReviewAvailable(state,existing);
  const isManual=manual(state,existing);
  if(isManual&&!hasCompletedAI(existing))throw new Error('本会话AI未运行或未完整完成，不能接受AI判定。');
  now=operationTime(state,existing,now);
  const next = cloneReviewState(state,sessionId);
  const item = getSession(next, sessionId);
  fillAIDrafts(item,now,isManual);
  if (item.review.status !== '已确认') {
    delete item.review.disposition;
    item.review.status = isManual&&Object.values(item.review.drafts).some(result=>result.verdict==='无法判定')?'待补充':'已暂存';
    item.review.completedAt = null;
    activity(next, item, isManual?'接受AI判定':'接受预置判定', now);
  }
  refreshTask(next, item.taskId);
  return next;
}

export function confirmReview(state, sessionId, now) {
  const classified=getSession(state,sessionId);if(requiresEcommerceClassification(classified)&&!classificationReviewed(classified))throw new Error('请先在回复时效项中保存评价分类人工复核。');if(['EC-TIME','EC-STEPS','EC-TARGET'].some(id=>classificationNeedsJudgment(classified,id)))throw new Error(classificationNeedsJudgment(classified,'EC-TARGET')?'评价分类涉及无效评价变更，请重新记录针对性及其他受影响项目的人工判断。':'评价分类已改判，请重新记录时效与回复结构的人工判断。');
  const existing = getSession(state, sessionId);
  assertReviewAvailable(state,existing);
  if(isUnrepliedSession(state,existing))throw new Error('未回复须使用独立的未回复事实确认，不作为质量通过或不通过。');
  const next = cloneReviewState(state,sessionId);
  if (existing.review.status === '已确认') return next;
  if(existing.reviewPolicy?.version===2&&existing.expectedRuleIds.every(id=>ruleExemption(existing,id))&&!Object.keys(existing.review.drafts).length)throw new Error('全部规则已免审，无需人工确认；如需复核请先标记可疑退回人工。');
  const item = getSession(next, sessionId);
  now=operationTime(state,existing,now);
  if(manual(state,item)){
    if(hasCompletedAI(item))fillAIDrafts(item,now,true);
    if(item.expectedRuleIds.some(id=>!VERDICTS.includes(ownDraft(item,id)?.verdict)&&!ruleExemption(item,id)))throw new Error('人工确认前须逐项完成所有预期规则检查。');
    if(item.expectedRuleIds.some(id=>ownDraft(item,id)?.verdict==='无法判定'))throw new Error('仍有无法判定项，请保留为待补充。');
    if(typeof item.review.reviewer!=='string'||!item.review.reviewer.trim())throw new Error('人工确认须填写非空审核人标签。');
    if(Date.parse(now)<Date.parse(item.startedAt)||Date.parse(now)<Date.parse(getTask(state,item.taskId).createdAt))throw new Error('完成时间不能早于会话开始或任务创建时间。');
  }else fillAIDrafts(item);
  item.review.status = '已确认';
  item.review.completedAt = now;
  activity(next, item, '确认审核', now);
  refreshTask(next, item.taskId);
  return next;
}

export function markPending(state, sessionId, notes = '', now) {
  const existing=getSession(state, sessionId);
  assertReviewAvailable(state,existing);
  now=operationTime(state,existing,now);
  const next = cloneReviewState(state,sessionId);
  const item = getSession(next, sessionId);
  item.review.status = '待补充';
  delete item.review.disposition;
  item.review.completedAt = null;
  item.review.notes = String(notes).trim();
  activity(next, item, '标记待补充', now);
  refreshTask(next, item.taskId);
  return next;
}

export function reopenReview(state, sessionId, now) {
  const existing=getSession(state, sessionId);
  assertReviewAvailable(state,existing);
  now=operationTime(state,existing,now);
  const next = cloneReviewState(state,sessionId);
  const item = getSession(next, sessionId);
  item.review.status = '已暂存';
  delete item.review.disposition;
  item.review.completedAt = null;
  activity(next, item, '重新审核', now);
  refreshTask(next, item.taskId);
  return next;
}

export function createTask(state, { name, fileName, templateIds }) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('任务名称不能为空。');
  if (!Array.isArray(templateIds) || !templateIds.length || templateIds.some(id => !demoSessions.some(item => item.id === id))) throw new Error('仅支持已知演示模板 templateIds。');
  const next = clone(state);
  let number = 1;
  while (next.tasks.some(task => task.id === `TASK-20261018-${String(number).padStart(3, '0')}`)) number++;
  const id = `TASK-20261018-${String(number).padStart(3, '0')}`;
  const sessions = templateIds.map((templateId, index) => ({
    ...clone(demoSessions.find(item => item.id === templateId)),
    id: `${id}-S${String(index + 1).padStart(3, '0')}`, externalId: templateId, taskId: id, review: emptyReview(),
  }));
  const task = { id, name: name.trim(), createdAt: DEFAULT_NOW, status: '待质检', ruleSetId: 'RS-PRESALES-V1', sessionIds: sessions.map(item => item.id), fileName: String(fileName || ''), progress: 0 };
  next.tasks.unshift(task);
  next.sessions.push(...sessions);
  next.activity.unshift({ id: nextId(next.activity,'ACT-'), taskId: id, action: '导入演示任务', at: DEFAULT_NOW, reviewer: '演示审核员' });
  return next;
}

export function createImportedTask(state,{name,fileName,sessions,source,basisSnapshot,reviewer,importMappingSnapshot,scenarioSnapshot,executionSettings,reviewPolicy,sceneRuntime={},sceneOverrideReason='',sceneConfigurationVersion,cleaningReportSnapshot,ecReportMetadata,inputMode,evidenceContractVersion,rawImportOptions,reinspectionOf,now=new Date().toISOString()}) {
  if(typeof name!=='string'||!name.trim()||name.length>1000)throw new Error('任务名称不能为空且不能超过1000字符。');
  if(typeof reviewer!=='string'||!reviewer.trim())throw new Error('请填写非空审核人标签。');
  actualTime(now);
  if(!source||typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256)||typeof source.name!=='string'||!source.name.trim()||source.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(source.name)||!Number.isSafeInteger(source.size)||source.size<1||source.size>8*1024*1024)throw new Error('业务任务必须关联已上传原文件的名称、摘要和有效大小。');
  if(!basisSnapshot||!Array.isArray(basisSnapshot.rules)||!basisSnapshot.rules.length||!Array.isArray(basisSnapshot.policies)||new Set(basisSnapshot.rules.map(r=>r.id)).size!==basisSnapshot.rules.length)throw new Error('任务依据快照无效。');
  if(!Array.isArray(sessions)||!sessions.length||sessions.length>500)throw new Error('业务文件须包含1至500个会话。');
  const rawMode=sessions.every(isRawTranscriptSession);
  if(sessions.some(isRawTranscriptSession)&&!rawMode)throw new Error('原文直判和结构化来源须分开创建任务。');
  if(inputMode!==undefined&&inputMode!==RAW_INPUT_MODE||evidenceContractVersion!==undefined&&evidenceContractVersion!==RAW_EVIDENCE_VERSION||!rawMode&&(inputMode!==undefined||rawImportOptions!==undefined||evidenceContractVersion!==undefined||reinspectionOf!==undefined))throw new Error('任务原文模式或证据合同与来源不一致。');
  let rawOptions,parent;
  if(rawMode){
    if(cleaningReportSnapshot!==undefined)throw new Error('原文任务不能用清洗快照替换证据来源。');
    const options=rawImportOptions??{timePolicy:sessions[0].rawTranscript.timePolicy};
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['timePolicy','productDefault','outputLanguage'].includes(key))||options.productDefault!==undefined&&(typeof options.productDefault!=='string'||options.productDefault.length>1000)||options.outputLanguage!==undefined&&!['zh','en'].includes(options.outputLanguage))throw new Error('原文导入选项无效。');
    rawOptions={timePolicy:normalizeRawTimePolicy(options.timePolicy??sessions[0].rawTranscript.timePolicy),productDefault:options.productDefault??'',outputLanguage:options.outputLanguage??'zh'};
    reviewPolicy??={version:1,enabled:true,confidenceThreshold:0.90,calibrationStatus:'unvalidated'};
    if(reinspectionOf!==undefined){
      parent=getTask(state,reinspectionOf);
      const original=parent.sessionIds.map(id=>getSession(state,id));
      if(parent.inputMode!==RAW_INPUT_MODE||parent.mode!=='manual'||JSON.stringify(parent.source)!==JSON.stringify(source)||JSON.stringify(parent.rawImportOptions.timePolicy)!==JSON.stringify(rawOptions.timePolicy)||original.length!==sessions.length||sessions.some((session,index)=>JSON.stringify(session.rawTranscript)!==JSON.stringify(original[index].rawTranscript)||session.id!==original[index].externalId))throw new Error('原文重检必须显式复用父任务的完整归档来源与时间声明。');
    }
  }
  if(sessions.some(session=>session.scene==='电商评论回复')&&sessions.some(session=>!session.ecommerce))throw new Error('新建电商场景必须逐条提供可验证的电商来源，普通问答请使用通用场景。');
  if(basisSnapshot.rules.some(rule=>EC_RULE_IDS.includes(rule.id))&&sessions.some(session=>!session.ecommerce))throw new Error('电商专用规则仅支持对应核心22列原始记录，不能用于普通产品咨询原文。');
  if(sessions.some(session=>session.ecommerce))validateEcommerceBasis(basisSnapshot);
  if(sessions.some(session=>session.ecommerce))validateEcommerceSources(sessions.map(session=>session.ecommerce),source);
  const seen=new Set();
  const scenes=new Set();
  for(const session of sessions){
    if(typeof session.id!=='string'||!session.id.trim()||session.id.length>160)throw new Error('原会话标识不能为空且不能超过160字符。');
    if(!isSceneKey(session.scene))throw new Error('会话场景无效。');scenes.add(session.scene);
    const key=JSON.stringify([session.scene,session.id]);if(seen.has(key))throw new Error(`同一任务内会话标识重复：${session.id}。`);seen.add(key);
    if(rawMode){
      validateRawTranscript(session.rawTranscript);
      const record=session.rawTranscript;
      if(record.fileSha256!==source.sha256||JSON.stringify(record.timePolicy)!==JSON.stringify(rawOptions.timePolicy)||session.startedAt!==''||session.completeness!=='未核验'||session.missingNote!==''||!Array.isArray(session.turns)||session.turns.length||session.id!==record.raw[record.columns.id-1]||session.agent!==record.raw[record.columns.agent-1])throw new Error('原文来源、时间声明或未核验结构不一致。');
      continue;
    }
    if(session.ecommerce!==undefined){
      validateEcommerceRecord(session.ecommerce);
      validateEcommerceSource(session,{sourceId:session.id});
      if(session.ecommerce.fileSha256!==source.sha256||session.scene!=='电商评论回复'||session.startedAt!==(ecommerceTimeValues(session.ecommerce).commentTime||''))throw new Error('电商原文件摘要、场景或评论时间与来源不一致。');
    }else actualTime(session.startedAt,9);
    if(!['完整','部分缺失'].includes(session.completeness)||(session.completeness==='部分缺失'&&!session.missingNote?.trim()))throw new Error('会话完整性及缺失说明无效。');
    if(!Array.isArray(session.turns)||!session.turns.length||session.turns.length>500)throw new Error('每会话须含1至500轮原文。');
    const turns=new Set();for(const turn of session.turns){
      if(!Number.isSafeInteger(turn.id)||turn.id<1||turns.has(turn.id))throw new Error('原文轮次标识无效或重复。');turns.add(turn.id);
      if(!['客户','客服','系统'].includes(turn.role)||typeof turn.text!=='string'||!turn.text.trim()||turn.text.length>20000)throw new Error('原文角色或内容无效。');
      if(turn.at)actualTime(turn.at,9);
    }
  }
  if(scenes.size!==1)throw new Error('混合场景请分批导入。');
  const scene=[...scenes][0],frozenScenario=freezeScenario(state,scene);
  const systemEcommerce=sessions.every(session=>session.ecommerce?.systemSource);
  if(ecReportMetadata!==undefined&&!systemEcommerce)throw new Error('批次报告信息仅适用于业务系统23列电商来源。');
  const frozenEcReportMetadata=systemEcommerce?normalizeEcReportMetadata(ecReportMetadata):undefined;
  const executionSnapshot=freezeSceneExecution(state,scene,{basis:basisSnapshot,overrides:sceneRuntime,overrideReason:sceneOverrideReason,expectedVersion:sceneConfigurationVersion,ecReportMetadata:frozenEcReportMetadata});
  if(executionSnapshot){const values=executionSnapshot.runtime.values;if(rawOptions)rawOptions.productDefault=values.productDefault;reviewPolicy=values.reviewMode==='rule-calibrated'?{version:2,mode:'rule-calibrated',enabled:reviewPolicy?.enabled!==false,calibrationStatus:'per-rule',rules:[]}:{version:1,enabled:reviewPolicy?.enabled!==false,confidenceThreshold:values.legacyConfidenceThreshold,calibrationStatus:'unvalidated'};}
  if(scenarioSnapshot!==undefined&&(!scenarioForTask({scene,scenarioSnapshot})||!sameScenarioConfig(scenarioSnapshot,frozenScenario)))throw new Error('提交的场景快照与当前注册配置不一致。');
  const capabilityErrors=checkScenarioCapabilities(frozenScenario,basisSnapshot.rules);if(capabilityErrors.length)throw new Error(capabilityErrors.join(' '));
  if(importMappingSnapshot!==undefined){
    if(!importMappingSnapshot||typeof importMappingSnapshot!=='object'||Array.isArray(importMappingSnapshot)||Object.keys(importMappingSnapshot).some(key=>key!=='profile'))throw new Error('导入映射快照结构无效。');
    const profile=validateInputProfile(importMappingSnapshot.profile);
    if(profile.scene!==scene)throw new Error('映射场景与任务场景不一致。');
    if(!frozenScenario.builtin)validateScenarioMapping(frozenScenario,profile);
  }else if(!frozenScenario.builtin&&frozenScenario.report.groupBy==='context')throw new Error('扩展字段分组须保存明确的导入映射快照。');
  const next=clone(state),id=nextId([...next.tasks,...(next.taskDeletionAudit||[]).map(a=>a.task)],`TASK-IMPORT-${now.slice(0,10).replaceAll('-','')}-`);
  const usedSessionIds=new Set(next.sessions.map(s=>s.id));let sessionNumber=1;
  const added=sessions.map(session=>{
    while(usedSessionIds.has(`${id}-S${sessionNumber}`))sessionNumber++;
    const sessionId=`${id}-S${sessionNumber++}`;usedSessionIds.add(sessionId);
    const added={...clone(session),id:sessionId,externalId:session.id,taskId:id,expectedRuleIds:inspectionRules(basisSnapshot,executionSnapshot).map(rule=>rule.id),aiResults:[],review:{status:'待审核',reviewer:reviewer.trim(),completedAt:null,drafts:{},notes:'',history:[]}};
    if(!rawMode&&executionSnapshot?.runtime.values.productDefault&&(!added.product||added.product==='未提供'))added.product=executionSnapshot.runtime.values.productDefault;
    if(rawMode){const record=added.rawTranscript;added.product=record.columns.product&&record.raw[record.columns.product-1].trim()?record.raw[record.columns.product-1]:rawOptions.productDefault.trim()?rawOptions.productDefault:'未提供';}
    delete added.calibrationAssignments;delete added.ruleCalibrationRevocations;delete added.aiDecision;delete added.aiDecisionHistory;delete added.aiExecution;delete added.reviewPolicy;
    if(reviewPolicy!==undefined)added.reviewPolicy=normalizeReviewPolicy(reviewPolicy);
    return added;
  });
  const task={id,name:name.trim(),fileName:String(fileName||source.name),mode:'manual',scene,scenarioSnapshot:clone(frozenScenario),aiStatus:'not_run',progress:0,status:'待审核',createdAt:now,source:clone(source),basisSnapshot:clone(basisSnapshot),sessionIds:added.map(s=>s.id)};
  if(executionSnapshot)task.executionSnapshot=executionSnapshot;
  if(frozenEcReportMetadata)task.ecReportMetadata=clone(frozenEcReportMetadata);
  if(rawMode){task.inputMode=RAW_INPUT_MODE;task.evidenceContractVersion=RAW_EVIDENCE_VERSION;task.rawImportOptions=clone(rawOptions);if(parent)task.reinspectionOf=parent.id;}
  if(importMappingSnapshot!==undefined)task.importMappingSnapshot=clone(importMappingSnapshot);
  task.executionSettings=normalizeExecutionSettings(executionSettings,{raw:rawMode});
  if(reviewPolicy!==undefined)task.reviewPolicy=normalizeReviewPolicy(reviewPolicy);
  if(reviewPolicy?.version===2){task.reviewPolicy=calibratedReviewPolicy(next,task,{enabled:reviewPolicy.enabled});for(const row of added)row.reviewPolicy=clone(task.reviewPolicy);}
  if(cleaningReportSnapshot!==undefined){validateCleaningReportSnapshot(cleaningReportSnapshot,{source,sessions:added});task.cleaningReportSnapshot=clone(cleaningReportSnapshot);}
  task.importLineage=newImportLineage(state,task,added);
  next.tasks.unshift(task);next.sessions.push(...added);
  next.activity.unshift({id:nextId(next.activity,'ACT-'),taskId:id,action:'导入业务任务',at:now,reviewer:reviewer.trim()});
  return next;
}

/** A new task with independent rules/results; the archived parent remains untouched. */
export function createRawReinspectionTask(state,parentTaskId,options={}){
 const parent=getTask(state,parentTaskId);
 if(parent.inputMode!==RAW_INPUT_MODE)throw new Error('只有已归档原文直判任务支持按新规则重检。');
 if(options.source!==undefined||options.sessions!==undefined||options.reinspectionOf!==undefined||options.cleaningReportSnapshot!==undefined)throw new Error('重检来源固定为父任务归档原文，不允许替换。');
 const sessions=parent.sessionIds.map(id=>{const session=clone(getSession(state,id));session.id=session.externalId;delete session.externalId;return session;});
 return createImportedTask(state,{...options,name:options.name??`${parent.name} · 新规则重检`,fileName:parent.fileName,sessions,source:parent.source,inputMode:RAW_INPUT_MODE,evidenceContractVersion:RAW_EVIDENCE_VERSION,rawImportOptions:{...parent.rawImportOptions,...options.rawImportOptions,timePolicy:parent.rawImportOptions.timePolicy},reviewPolicy:options.reviewPolicy??parent.reviewPolicy,reinspectionOf:parent.id});
}

/** Measured by visible/focused review UI; durations remain auditable and idempotent. */
export function recordRawReviewTime(state,{sessionId,elapsedMs,reviewer,now=new Date().toISOString(),segmentId}={}){
 const item=getSession(state,sessionId);
 if(!isRawTranscriptSession(item))throw new Error('活跃审核计时仅用于原文直判任务。');
 if(typeof segmentId!=='string'||!segmentId.trim()||segmentId.length>160||/[\u0000-\u001f\u007f]/.test(segmentId)||typeof elapsedMs!=='number'||!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>4*60*60*1000)throw new Error('审核计时段标识或时长无效；单段最多4小时。');
 if(typeof reviewer!=='string'||!reviewer.trim()||reviewer.length>80)throw new Error('审核计时须填写操作人标签。');
 actualTime(now);
 const segment={segmentId,elapsedMs,reviewer:reviewer.trim(),at:now},old=item.review.timeSegments??[],existing=old.find(record=>record.segmentId===segmentId);
 if(existing){if(JSON.stringify(existing)!==JSON.stringify(segment))throw new Error('相同审核计时段不能改写。');return cloneReviewState(state,sessionId);}
 if(old.length>=10000)throw new Error('审核计时段数量超过10000，请保留已记录时长并检查操作。');
 assertReviewAvailable(state,item);
 if(item.review.status==='已确认'||isAIFinal(item))throw new Error('最终结论只读时不累计活跃人工审核时长。');
 if(isProcessedUnknown(item))throw new Error('已处理记录只读时不累计活跃人工审核时长。');
 if(Date.parse(now)<Date.parse(getTask(state,item.taskId).createdAt)||old.length&&Date.parse(now)<Date.parse(old.at(-1).at))throw new Error('审核计时记录时间不能回退。');
 const next=cloneReviewState(state,sessionId),updated=getSession(next,sessionId);updated.review.timeSegments=[...old,segment];updated.review.activeTimeMs=updated.review.timeSegments.reduce((total,record)=>total+record.elapsedMs,0);
 return next;
}

export function setTaskProgress(state, taskId, progress) {
  if(getTask(state, taskId).mode==='manual')throw new Error('人工任务进度由人工确认计算，不能运行模拟质检。');
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('进度 progress 应为0到100。');
  const next = clone(state);
  const task = getTask(next, taskId);
  task.progress = progress;
  refreshTask(next, taskId);
  return next;
}

/** Empty business workspace. Demo fixtures are available only through explicit fixture exports. */
export function createBusinessState() {
  return { schemaVersion: 1, businessMigrationVersion: 1, tasks: [], sessions: [], activity: [] };
}

/** Legacy fixture initializer; business bootstrap must use createBusinessState. */
export function createInitialState() {
  const state = { schemaVersion: 1, tasks: [], sessions: clone(demoSessions), activity: [] };
  const historicalGroups = [[], [], []];
  for (let i = 0; i < 24; i++) {
    const group = Math.floor(i / 8);
    const taskId = `TASK-HISTORY-202610-${String(group + 1).padStart(2, '0')}`;
    const day = String(1 + Math.floor(i * 17 / 24)).padStart(2, '0');
    const template = clone(demoSessions[(i * 3 + group) % demoSessions.length]);
    template.id = `HIST_PRE${String(i + 1).padStart(3, '0')}`;
    template.externalId = template.id;
    template.taskId = taskId;
    template.customer = `历史演示客户${String(i + 1).padStart(2, '0')}`;
    template.turns.forEach(turn => { if (turn.role === '客户') turn.speaker = template.customer; });
    template.startedAt = `2026-10-${day}T09:00:00+08:00`;
    template.demoFocus = `历史虚构样本：${template.demoFocus}`;
    fillAIDrafts(template);
    if (template.scenarioKey === 'ai-false-positive') {
      template.review.drafts.R002 = { ...template.review.drafts.R002, verdict: '符合', reason: '人工复核第2轮：优惠门槛与领券动作均完整，3299减200为3099。', evidence: [2], source: '人工修改' };
    }
    if (template.scenarioKey === 'ai-false-negative') {
      template.review.drafts.R003 = { ...template.review.drafts.R003, verdict: '不符合', reason: '人工补充第4轮保证明天送达，超出预计48小时出库口径。', evidence: [4], source: '人工补充' };
    }
    template.review.status = '已确认';
    template.review.completedAt = `2026-10-${day}T16:00:00+08:00`;
    historicalGroups[group].push(template);
    state.sessions.push(template);
  }
  state.tasks = [
    { id: INITIAL_TASK_ID, name: '10月18日售前服务抽检', createdAt: '2026-10-18T09:45:00+08:00', status: '待审核', ruleSetId: 'RS-PRESALES-V1', sessionIds: demoSessions.map(item => item.id), fileName: '星澜售前演示会话_20261018.csv', progress: 100 },
    ...historicalGroups.map((group, index) => ({ id: group[0].taskId, name: `10月历史抽检批次${index + 1}`, createdAt: group[0].startedAt, status: '已完成', ruleSetId: 'RS-PRESALES-V1', sessionIds: group.map(item => item.id), fileName: `历史虚构样本_${index + 1}.csv`, progress: 100 })).reverse(),
  ];
  return state;
}

export const createDemoState = createInitialState;

export function scopeState(state,mode) {
  if(!['manual','demo'].includes(mode))throw new Error('任务范围须为 manual 或 demo。');
  const tasks=state.tasks.filter(task=>(task.mode==='manual'?'manual':'demo')===mode),taskIds=new Set(tasks.map(task=>task.id));
  const sessions=state.sessions.filter(session=>taskIds.has(session.taskId)),sessionIds=new Set(sessions.map(session=>session.id));
  return {...state,tasks,sessions,activity:state.activity.filter(event=>event.taskId?taskIds.has(event.taskId):event.sessionId?sessionIds.has(event.sessionId):false)};
}
export function resetDemoState(state) {
  const manualState=scopeState(state,'manual'),demo=createInitialState();
  const taskIds=new Set(manualState.tasks.map(task=>task.id)),sessionIds=new Set(manualState.sessions.map(session=>session.id));
  // 只有名称冲突的演示内部标识需要重编号；业务原文和业务任务标识始终保留。
  const taskMap=new Map();for(const task of demo.tasks){const previous=task.id;if(taskIds.has(task.id))task.id=nextId([...manualState.tasks,...demo.tasks],`${previous}-DEMO-`);taskMap.set(previous,task.id);taskIds.add(task.id);}
  const sessionMap=new Map();for(const session of demo.sessions){const previous=session.id;if(sessionIds.has(session.id))session.id=nextId([...manualState.sessions,...demo.sessions],`${previous}-DEMO-`);session.taskId=taskMap.get(session.taskId);sessionMap.set(previous,session.id);sessionIds.add(session.id);}
  for(const task of demo.tasks)task.sessionIds=task.sessionIds.map(id=>sessionMap.get(id));
  return {...clone(state),tasks:[...clone(manualState.tasks),...demo.tasks],sessions:[...clone(manualState.sessions),...demo.sessions],activity:clone(manualState.activity)};
}

const percentage = (numerator, denominator) => denominator ? Math.round(numerator / denominator * 1000) / 10 : 0;
const dayString = date => date.toISOString().slice(0, 10);
const beijingDay = value => Number.isFinite(Date.parse(value))?dayString(new Date(Date.parse(value)+8*60*60*1000)):'';
export function getDashboardScope(state, { period = 'month', taskId = '', referenceDate = '2026-10-18', repeatImports = 'separate' } = {}) {
  state=usableTaskState(state);
  if (!['week', 'month', 'batch', 'all'].includes(period)) throw new Error('统计周期 period 无效。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) || Number.isNaN(Date.parse(referenceDate))) throw new Error('参考日期 referenceDate 无效。');
  const end = referenceDate;
  const startDate = new Date(`${referenceDate}T00:00:00Z`);
  if (period === 'week') startDate.setUTCDate(startDate.getUTCDate() - (startDate.getUTCDay() + 6) % 7);
  else startDate.setUTCDate(1);
  const start = dayString(startDate);
  const selectedTask = taskId || (period === 'batch' ? state.tasks[0]?.id : '');
  const repeatedTasks=new Set(state.tasks.filter(t=>isRepeatedImport(state,t)).map(t=>t.id));
  const sessions = state.sessions.filter(item => {
    const date = beijingDay(item.startedAt);
    const repeated=repeatedTasks.has(item.taskId);
    const includeRepeat=Boolean(selectedTask)||repeatImports==='include'||(repeatImports==='only'?repeated:!repeated);
    const ready=includeRepeat&&(period!=='all'||!['待质检','质检中'].includes(state.tasks.find(task=>task.id===item.taskId)?.status));
    return ready&&(!selectedTask || item.taskId === selectedTask) && (period === 'batch'||period==='all' || (date >= start && date <= end));
  });
  const dates=sessions.map(item=>beijingDay(item.startedAt)).filter(Boolean).sort();
  const unknownDateCount=state.sessions.filter(item=>(!selectedTask||item.taskId===selectedTask)&&!beijingDay(item.startedAt)).length;
  return {sessions,period,taskId:selectedTask,referenceDate,unknownDateCount,start:['batch','all'].includes(period)?(dates[0]||referenceDate):start,end:['batch','all'].includes(period)?(dates.at(-1)||referenceDate):end};
}

export function getDashboard(state, options = {}) {
  const {sessions,period,start,end,unknownDateCount}=getDashboardScope(state,options);
  const reviewed = sessions.filter(isFinalSession);
  const unreplied=sessions.filter(item=>isUnrepliedSession(state,item)),qualityReviewed=reviewed.filter(item=>!isUnrepliedSession(state,item));
  const allRules=sessions.flatMap(item=>getSessionRules(state,item));
  const scopedRules=[...new Map(allRules.map(rule=>[rule.id,rule])).values()];
  const ruleCounts = scopedRules.map(rule => ({ ruleId: rule.id, name: rule.name??rule.title, count: 0 }));
  const categories = [...new Set(allRules.map(rule => rule.category))];
  const distribution = categories.map(label => ({ label, count: 0 }));
  let problemSessions = 0, issueCount = 0, changedCount = 0, unknownCount = 0, passCount = 0, undeterminedCount = 0;
  const trends = new Map();
  const addTrend = label => { if (!trends.has(label)) trends.set(label, { label, reviewed: 0, issues: 0, problems: 0 }); };
  if (period !== 'batch') {
    for (const date = new Date(`${start}T00:00:00Z`); dayString(date) <= end; date.setUTCDate(date.getUTCDate() + 1)) addTrend(dayString(date));
  }
  for (const item of reviewed) {
    if(isUnrepliedSession(state,item)){
      const completedDate=item.review.completedAt?beijingDay(item.review.completedAt):null;
      if(completedDate){addTrend(completedDate);trends.get(completedDate).reviewed++;}
      continue;
    }
    const results = getSessionResults(item);
    const failures = results.filter(result => result.final?.verdict === '不符合');
    if (failures.length) problemSessions++;
    issueCount += failures.length;
    if (results.some(result => result.changed)) changedCount++;
    const expected=getSessionRules(state,item);
    const unresolved=expected.filter(rule=>!['符合','不符合','不适用'].includes(results.find(result=>result.ruleId===rule.id)?.final?.verdict));
    unknownCount += unresolved.length;
    if(unresolved.length||!expected.length)undeterminedCount++;
    else if(!failures.length)passCount++;
    for (const failure of failures) {
      const sessionRule=getSessionRules(state,item).find(rule=>rule.id===failure.ruleId);
      const count=ruleCounts.find(rule=>rule.ruleId===failure.ruleId);if(count)count.count++;
      const category=distribution.find(item=>item.label===sessionRule?.category);if(category)category.count++;
    }
    const finalAt=item.review.completedAt||(isAIFinal(item)?item.aiDecision.decidedAt:null);
    const completedDate = finalAt?beijingDay(finalAt):null;
    if (completedDate) {
      addTrend(completedDate);
      trends.get(completedDate).reviewed++;
      trends.get(completedDate).issues += failures.length;
      trends.get(completedDate).problems += Number(failures.length>0);
    }
  }
  const aiProcessed = sessions.filter(item => hasCompletedAI(item)&&(getTask(state,item.taskId).mode==='manual'||getTask(state,item.taskId).progress===100)&&item.aiResults.length===getSessionRules(state,item).length).length;
  const aiReviewed=qualityReviewed.filter(hasCompletedAI).length;
  return {
    totalSessions: sessions.length, unknownDateCount, aiProcessed, aiProcessedCount:aiProcessed, reviewedCount: reviewed.length, pendingCount: sessions.filter(row=>!isInactiveTask(state.tasks.find(t=>t.id===row.taskId))&&requiresHumanReview(row)).length,processedUnknownCount:sessions.filter(isProcessedUnknown).length,workCompletedCount:sessions.filter(isReviewWorkComplete).length,aiFinalCount:sessions.filter(isAIFinal).length,humanConfirmedCount:sessions.filter(s=>s.review.status==='已确认').length,unprocessedCount:sessions.filter(s=>s.reviewPolicy?.enabled&&!s.aiDecision&&!hasCompletedAI(s)&&s.aiExecution?.status!=='failed'&&!isReviewWorkComplete(s)).length,
    unrepliedCount:unreplied.length,confirmedUnrepliedCount:reviewed.filter(item=>isUnrepliedSession(state,item)&&getReviewDisposition(item)==='unreplied').length,qualityReviewedCount:qualityReviewed.length,
    problemSessions, issueCount, passCount, undeterminedCount, determinateReviewedCount:qualityReviewed.length-undeterminedCount, passRate: percentage(passCount, qualityReviewed.length), reviewRate: percentage(reviewed.length, sessions.length),
    changedCount, changeRate: percentage(changedCount, aiReviewed), unknownCount,
    trend: [...trends.values()].sort((a, b) => a.label.localeCompare(b.label)), distribution, ruleCounts,
  };
}
