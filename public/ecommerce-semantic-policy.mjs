// This policy is opt-in and belongs to the frozen scene basis. Merely opening an
// older scene must never opt it in or rewrite an existing task's execution basis.
export const EC_SEMANTIC_POLICY_VERSION='ec-human-aligned-v1';
export const EC_SEMANTIC_RULE_VERSION='V3.2';
const BUSINESS_PROFILE='ec-business-v1';
const POLICY_ID='EC-BUSINESS-POLICY';
const RULE_IDS=['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function validateEcommerceSemanticPolicy(policy){
 if(!exactKeys(policy,['version','text'])||policy.version!==EC_SEMANTIC_POLICY_VERSION||!exactKeys(policy.text,['minimumSignificantErrors'])||![1,2].includes(policy.text.minimumSignificantErrors))throw new Error('电商语义口径无效：须使用 ec-human-aligned-v1，显著文本错误阈值仅支持 1 或 2 处。');
 return true;
}

const criteria={
 'EC-TEXT':{
  summary:'仅显著影响理解、造成实质歧义或明显损害专业形象的文本错误计入不通过阈值；轻微形式问题仅作建议。',
  passCriteria:'逐项检查拼写、语法、标点/表情和表意。只有显著影响理解、造成实质歧义或明显损害专业形象的错误计数；未达到冻结 semanticPolicy.text.minimumSignificantErrors 阈值则符合，默认 1 处，管理员可明确选择 2 处。',
  failCriteria:'有可靠原文证据的显著错误达到冻结阈值时不通过。理由须逐处引用错误、说明其对理解/实质歧义/专业形象的影响，不得只凭拼写差异扣分；同一处错误不得重复计数。',
  exceptionCriteria:'不影响理解和专业形象的大小写、轻微拼写/标点、重音符号遗漏、语言变体或沿用客户原词拼写仅在 reason 中给出改进建议，不计入显著错误；未达阈值的显著错误亦在 reason 中提示。没有公开回复或无法可靠理解原语言时无法判定，不默认通过。',
  englishSummary:'Fail only when evidenced errors significantly affect comprehension, create substantive ambiguity or clearly harm professional image and reach the frozen threshold (default 1, optionally 2); minor orthography, diacritics, variants and copied customer spelling are advisory.'
 },
 'EC-TARGET':{
  summary:'须对具体问题、诉求或夸赞给出实质回应、处理进展或方案；重复关键词、致歉加泛化联系渠道不足以通过。',
  passCriteria:'针对评价的具体问题、诉求或夸赞点给出有内容的回应、解释、处理进展或可执行解决方案，且完整本批次无达到阈值的重复配对；有针对性的服务渠道引导须包含与该问题相关的实质说明或下一步。',
  failCriteria:'未实质回应具体问题/诉求/夸赞、与评价完全无关，或只有致歉/感谢加泛化联系渠道而没有具体说明、处理进展或解决方案时不通过。出现相同关键词或重复客户表述不足以证明针对性。本批次至少两个不同来源行回复归一化相似度达到 85% 也不通过；相似度由程序计算，模型不得声称百分比。',
  exceptionCriteria:'缺原评价或回复时无法判定，不推断未导入历史。归一化采用 NFKC、小写、去空白与标点，字符二元组多重集 Dice 系数；配对证据不作传递闭包。仅涉及表达优化的建议写入 reason，不替代实质回应核查。',
  englishSummary:'Require substantive targeted response, explanation, progress or solution. Keyword echo and apology plus generic contact channels are insufficient; frozen batch similarity checks remain unchanged.'
 },
 'EC-STEPS':{
  summary:'至少 3 步操作须完整按序编号；好评正向/负向的固定段落组成仅作建议，无关或完全缺乏实质回应仍不通过。',
  passCriteria:'操作/排查步骤至少 3 步时完整按序编号，接受第一步、①、1.等形式；少于 3 步免编号要求。好评正向的开头语+产品价值+结束语、好评负向的开头语+致歉+解决方案+结束语仅作写作建议，缺少固定段落本身不导致不通过。',
  failCriteria:'至少 3 步操作未完整按序编号，或好评正向/好评负向回复与评价无关、完全缺乏实质回应时不通过。理由区分步骤编号、实质回应与仅供建议的段落结构，不能仅因缺开头语、独立产品价值段、致歉或结束语判 Fail。',
  exceptionCriteria:'中差评仍沿用既有结构口径，不套用好评固定段落要求；不能把礼貌语算作操作步骤。好评段落结构不足只在 reason 中给改进建议。原中文/英文可见字符计数及结束语豁免参数保留；分类未知且判断依赖分类、无回复或证据不足时无法判定，不默认通过。',
  englishSummary:'Number all actual operations when there are at least 3. Positive-rating paragraph composition is advisory only; irrelevant or wholly non-substantive responses still fail. Neutral/negative-rating structure remains unchanged.'
 },
 'EC-PRIVACY':{
  summary:'仅用客户名字作礼貌称呼且无其他个人信息不扣分；其他个人/敏感信息和违规内容仍按原限制处理。',
  passCriteria:'公开回复不含泄露的用户个人信息或敏感/违规内容。仅用客户名字作礼貌称呼（如 Hi Sara），且没有同时公开其他个人信息时允许。',
  failCriteria:'公开回复出现电话、地址、邮箱、可关联个人的订单明细等个人信息，或敏感/违规内容时不通过；掩码个人信息同样不允许。客户姓名超出单纯礼貌称呼使用或与其他个人信息同时公开，不适用称呼例外；须引用实际公开回复证据。',
  exceptionCriteria:'名字称呼例外仅限纯礼貌称呼且无其他个人信息，不扩大到姓名关联订单、联系方式等信息披露。输入表格包含个人信息本身不等于公开泄露；无回复或不能确认是否个人信息时无法判定。轻微表达建议仅写入 reason。',
  englishSummary:'A customer name used only as a salutation is allowed when no other personal information is disclosed. Other personal information, including masked details, and prohibited content remain restricted.'
 }
};

function upgradedVersion(version){
 const match=typeof version==='string'&&version.match(/^V(\d+)\.(\d+)$/);
 if(!match)throw new Error('电商口径升级需要可追溯的原规则/政策版本。');
 const major=Number(match[1]),minor=Number(match[2]);
 if(!Number.isSafeInteger(major)||!Number.isSafeInteger(minor+1))throw new Error('电商口径版本超出可支持范围。');
 return major<3||major===3&&minor<2?EC_SEMANTIC_RULE_VERSION:`V${major}.${minor+1}`;
}

export function upgradeEcommerceSemanticBasis(basis,options={}){
 const next=structuredClone(basis);
 if(next?.executionProfile!==BUSINESS_PROFILE)return next;
 if(!object(options)||Object.keys(options).some(key=>key!=='minimumSignificantErrors'))throw new Error('电商语义口径升级选项无效。');
 if(!object(next.businessProfile)||!Array.isArray(next.rules)||!Array.isArray(next.policies)||RULE_IDS.some(id=>next.rules.filter(rule=>rule.id===id).length!==1))throw new Error('电商语义口径升级需要完整的冻结业务依据。');
 const previous=next.businessProfile.semanticPolicy;
 if(Object.hasOwn(next.businessProfile,'semanticPolicy'))validateEcommerceSemanticPolicy(previous);
 const minimumSignificantErrors=Object.hasOwn(options,'minimumSignificantErrors')?options.minimumSignificantErrors:previous?.text.minimumSignificantErrors??1;
 const policy={version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors}};
 validateEcommerceSemanticPolicy(policy);
 // A second invocation preserves already frozen thresholds and versions unless
 // the caller explicitly asks for the other supported scene-level threshold.
 if(previous){next.businessProfile.semanticPolicy=policy;return next;}
 next.businessProfile.semanticPolicy=policy;
 for(const rule of next.rules){
  const change=criteria[rule.id];if(!change)continue;
  const previousVersion=rule.version;
  rule.version=upgradedVersion(previousVersion);
  for(const key of ['summary','passCriteria','failCriteria','exceptionCriteria'])rule[key]=change[key];
  if(rule.english)rule.english.summary=change.englishSummary;
  rule.changeNote=`需求21：按人工判断校准电商语义口径；${previousVersion} → ${rule.version}；执行标识 ${EC_SEMANTIC_POLICY_VERSION}。${rule.changeNote?`前版变更说明：${rule.changeNote}`:''}`;
 }
 for(const record of next.policies){
  if(record.id!==POLICY_ID)continue;
  const previousVersion=record.version;record.version=upgradedVersion(previousVersion);
  const sections=Array.isArray(record.sections)?record.sections:[];
  for(const ruleId of RULE_IDS){
   const sectionId=`${ruleId}-BUSINESS-1`,rule=next.rules.find(item=>item.id===ruleId);
   let section=sections.find(item=>item.id===sectionId);
   if(!section){section={id:sectionId,title:rule.title||rule.name||ruleId};sections.push(section);}
   section.text=`通过：${rule.passCriteria}\n不通过：${rule.failCriteria}\n例外：${rule.exceptionCriteria}`;
  }
  for(const section of sections)if(Object.hasOwn(section,'version'))section.version=record.version;
  record.sections=sections;
  record.content=sections.map(section=>`${section.id} ${section.title}\n${section.text}`).join('\n\n');
  record.summary='需求21：好评段落结构改为建议；纯名字称呼例外；显著文本错误阈值默认1处、可选2处；实质针对性回应仍为必需。';
  record.changeNote=`需求21：${previousVersion} → ${record.version}；执行标识 ${EC_SEMANTIC_POLICY_VERSION}；旧版本在发布历史与原始参考档案中保留，不作为本版本执行口径。`;
 }
 return next;
}
