// Offline labels for standard frozen records created before the English seed.
// Matching both ID and title protects renamed/custom rules using the same ID.
const np=[
 ['整体判定原则','Overall'],['及时响应与负向回应','Etiquette 1'],['负面情绪安抚','Etiquette 2'],['结束会话前确认与告知','Etiquette 3'],['查询等待与重复查询','Etiquette 4'],['完整解答与先答后促','Etiquette 5'],['跨平台下单引导','Etiquette 6'],['个人信息收集边界','Etiquette 7'],['产品政策与员工评价','Etiquette 8'],['品牌与商家形象维护','Etiquette 9'],['权益保护与维修政策表述','Etiquette 10'],['沟通内容合规','Etiquette 11'],['主动探需','Probing'],['卖点与需求匹配','Sales 1'],['主动优惠引导','Sales 2'],['主动卖点说明','Sales 3'],['异议处理与挽留','Sales 4'],
];
const rules=Object.fromEntries(np.map(([title,en],i)=>[`NP-R${String(i+1).padStart(2,'0')}`,{[title]:en}]));
Object.assign(rules,{
 'EC-TIME':{'回复时效':'Reply timing','回复时效（测试规则）':'Reply timing (test rule)'},
 'EC-TEXT':{'文本质量':'Text quality','文本质量（测试规则）':'Text quality (test rule)'},
 'EC-TARGET':{'模板化回复':'Reply targeting','针对性及批次重复（测试规则）':'Reply targeting and batch similarity (test rule)'},
 'EC-STEPS':{'非结构化回复':'Reply structure','操作步骤结构（测试规则）':'Procedure structure (test rule)'},
 'EC-PRIVACY':{'回复内容合规':'Reply compliance','公开回复隐私（测试规则）':'Public reply privacy (test rule)'},
 'EC-POLICY':{'电商评论回复五项测试口径说明（非正式制度）':'Ecommerce five-check testing criteria (not formal policy)'},
 'NP-POLICY':{'新品专项完整检核规则与案例原文索引':'Product consultation rules and original case index'},
});
export function builtinDisplayName(record){
 if(!record)return null;const title=record.title||record.name||record.id||'';
 if(record.english?.title&&![...record.english.title].some(c=>/\p{L}/u.test(c)&&!/\p{Script=Latin}/u.test(c)))return record.english.title;
 const direct=rules[record.id]?.[title];if(direct)return direct;
 const source=String(record.id||'').match(/^NP-SOURCE-(\d{2})$/);
 if(source&&title===`NP-R${source[1]} 原文与案例`)return `NP-R${source[1]} source and examples`;
 return null;
}

// Exact bundled source metadata only; custom edits remain source content.
export const BUNDLED_DISPLAY_EN=Object.freeze({
 "电商评论回复首轮测试；北京时间UTC+08:00；仅核对本次导入批次，不作为正式制度。": "Initial ecommerce reply testing; Beijing time UTC+08:00; applies only to this imported batch and is not formal policy.",
 "新品产品咨询": "New-product consultation: applicable sales and retention scenarios",
 "新品产品咨询；针对售前场景；已明确需求且有购买意向的用户。": "New-product consultation: applicable sales and retention scenarios",
 "新品产品咨询；针对售前场景；对产品某功能感兴趣或者有购买意向的用户。": "New-product consultation: applicable sales and retention scenarios",
 "新品产品咨询；针对售前售后场景；拒绝、犹豫、取消订单或退货的用户。": "New-product consultation: applicable sales and retention scenarios"
});
