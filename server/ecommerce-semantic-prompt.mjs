import {isBusinessEcommerceBasis,replyStructureFacts} from '../public/ecommerce-business-profile.mjs';
import {EC_SEMANTIC_POLICY_VERSION,validateEcommerceSemanticPolicy,EC_TARGET_POLICY_VERSION,validateEcommerceTargetPolicy,EC_TARGET_SPECIFIC_CRITERIA} from '../public/ecommerce-semantic-policy.mjs';

export {EC_SEMANTIC_POLICY_VERSION};

export function ecommerceTargetPolicy(basis){
 if(!isBusinessEcommerceBasis(basis)||!Object.hasOwn(basis.businessProfile??{},'targetPolicyVersion'))return null;
 validateEcommerceTargetPolicy(basis);return EC_TARGET_POLICY_VERSION;
}
export function ecommerceTargetGuidance(){return `\n独立冻结针对性口径 ${EC_TARGET_POLICY_VERSION}（仅EC-TARGET①②）：${Object.values(EC_TARGET_SPECIFIC_CRITERIA).join('\n')}
以下均为合成判据示例，不是当前记录，不可复制示例结论或事实：
例1 评论“设备运行很慢”；回复“抱歉，我们认真倾听，请拨打热线或联系WhatsApp。”→不符合：没有回应慢的原因或处理动作。
例2 评论“包装缺少充电线，希望补发”；回复“抱歉没有充电线，请自行联系购买渠道。”→不符合：复述缺件和通用转介不构成补发处理说明。
例3 同样的缺件诉求；回复“该套装应含充电线，我们已为这次缺件登记补发申请，审核后会通知您。”→针对性符合：明确回应缺件并说明处理进展；不要求已经解决成功。
例4 评论“连接时显示E7”；回复“E7表示配对未完成，请先在设置中移除旧配对后重新连接；若仍出现E7，请通过商城私信提供设备型号，以继续核查此连接问题。”→针对性符合：有具体解释和步骤，不能因包含私信指引扣分。
例5 评论“很好”；回复“感谢您的认可！”→不能仅因没有解决方案或固定段落判不符合；没有具体诉求时不创造要求。
仅EC-TARGET的reason采用简短依据“具体诉求：…；回复实际回应：…；满足(a)/(b)或缺失：…”；不输出思维链，不改变其他规则的理由要求。对照评论与回复，不能把评论提出的希望当作客服已给出的方案。保持原有输出schema，不新增必填字段。以上示例只说明①②，不替代程序批次重复结果。
重试时仍执行(a)/(b)；纯致歉＋倾听表态＋通用渠道指引=不符合，禁止为纠正格式把这一硬判据降级为建议。\n`;}

// A frozen opt-in is required. Historical and non-business profiles never inherit
// the current default, including when an unrelated profile carries this field.
export function ecommerceSemanticPolicy(basis){
 if(!isBusinessEcommerceBasis(basis)||!Object.hasOwn(basis.businessProfile??{},'semanticPolicy'))return null;
 const policy=basis.businessProfile.semanticPolicy;validateEcommerceSemanticPolicy(policy);
 return {version:policy.version,text:{minimumSignificantErrors:policy.text.minimumSignificantErrors}};
}

export function ecommerceSemanticFacts(session,basis,capabilities){
 const classification=(capabilities??session.sceneCapabilities)?.outputs?.ecommerceClassification;
 // workflowInput deliberately removes ecommerce/raw before normal execution and
 // dependency recovery. Read the validated source-field projection in both paths;
 // neither historical human reference columns nor review drafts are candidates.
 const ratingFields=(session.contextFields??[]).filter(field=>field.key==='rating'||field.label==='评分');
 const ratingValues=ratingFields.map(field=>Number(field.value));
 const rating=ratingValues.length&&ratingValues.every(value=>[1,2,3,4,5].includes(value))&&new Set(ratingValues).size===1?ratingValues[0]:null;
 const evaluationType=classification?.status==='completed'?classification.value?.evaluationType:rating===1?'差评':rating>=2&&rating<=3?'中评':null;
 const reply=session.turns.filter(t=>['客服','坐席','agent','assistant'].includes(String(t.role).toLowerCase())).map(t=>t.text).join('\n');
 return {evaluationType:['好评正向','好评负向','中评','差评','无效评价'].includes(evaluationType)?evaluationType:null,sourceRating:[1,2,3,4,5].includes(rating)?rating:null,positiveRating:rating===4||rating===5,...replyStructureFacts(reply,basis)};
}

export function ecommerceSemanticGuidance(policy){
 const minimum=policy.text.minimumSignificantErrors;
 return ` 冻结电商语义执行策略 ${EC_SEMANTIC_POLICY_VERSION}：严格按basis.businessProfile.semanticPolicy及以下边界执行所选规则；这些边界对本次请求及每次重试同样生效，不得恢复旧版全量扣分口径。只输出原有判定字段；改进建议写入reason，不增加必填字段。
EC-TEXT：仍核对拼写、语法、标点/表情、通顺/歧义，但只有影响理解或专业形象的显著错误才计入不通过。重音/变音符号、阿语变音与连写差异、专有名词合理写法变体、照录客户原有拼写、无碍理解的轻微语法或标点问题仅作改进建议，不计入显著错误；不得主动搜罗这些正字法小问题凑数。按不同文本位置的显著错误处数计数，同一文本位置的错误被重复引用或归入多个类别只计一次；不同位置的显著错误按处数计入，不能按错误类别凑数。当前冻结阈值为${minimum}处显著错误：处数达到${minimum}才判不符合，少于${minimum}判符合；不能将未达阈值的显著错误或轻微问题转移到其他规则扣分。reason须说明显著错误处数、阈值、具体原文和影响理解/专业形象的严重性依据；存在仅建议的问题时分开说明，即使判符合也保留这些建议。不得仅凭陌生词或外部推测认定拼写错误。
EC-STEPS：好评正向、好评负向不因缺少开头语、致歉、产品价值表达或结束语判不符合；这些缺项只在reason中作为改进建议，不能借字符数或其他规则恢复硬扣分。源评分为4或5星（ecommercePolicyFacts.positiveRating=true）时，无论正向/负向均应用好评段落建议边界，分类尚未知也不能因此对缺段落判不符合。3步及以上操作指导仍须完整顺序编号，接受第一步/第二步/第三步、①/②/③、1./2./3.等；缺号、跳号或部分未编号判不符合。少于3步只免编号要求。好评正向/好评负向已有回复但完全缺乏实质回应或明显无关时，EC-STEPS仍判不符合。差评与中评继续按该任务冻结规则检查原有步骤编号要求，不套用好评类型的固定结构要求，不新增开头语、致歉、产品价值或结束语义务，也不新增EC-STEPS空泛/无实质回应的硬判条件；其针对性仍由EC-TARGET核查。字符统计和closingOptional不为中差评新增结构要求。评价类型未知且判定依赖分类时用无法判定，不能猜测分类。整条回复正文缺失按缺失材料用无法判定，不把无回复与已有空泛回复混为一谈。
EC-PRIVACY：仅用客户名字作礼貌称呼（如Hi Sara），且未同时披露其他个人信息时，适用称呼例外，不因该称呼扣分。客户姓名超出单纯礼貌称呼使用，或与其他个人信息同时公开，不适用称呼例外，须按冻结隐私规则及实际公开回复证据判断，不能一概放行姓名。公开回复中的电话、邮箱、住址、订单号等其他可关联个人的信息仍禁止，包括掩码或部分隐藏形式；称呼例外不豁免这些信息。敏感/违规内容仍按原限制处理。仅输入字段含个人信息不构成公开回复违规。
EC-TARGET：必须实质回应用户的具体问题、诉求或夸赞点；可提供与其相关的解释、处理进度、解决方案、具体步骤，纯好评也可对用户认可的卖点作实质互动，不强制给没有问题的评价编造问题或解决方案。原评价没有具体问题、诉求或具体夸赞点时（如只有“很好”），按评价实际可回应的内容判断，不凭空要求问题解决方案、产品卖点段或固定段落，不通过EC-TARGET恢复已降为建议的EC-STEPS段落义务；已有具体问题、诉求或夸赞点时仍须实质回应。仅复述问题关键词、表示道歉/倾听，再给通用客服渠道而无对应问题的具体回应，判不符合；关键词命中、礼貌或泛泛承诺不能替代对具体内容的实质针对性。具体问题、诉求或夸赞点获得实质回应即可，不能另加必有开头/致歉/结束语要求。批次重复比较的现有规则和程序保持不变。
重试执行提醒：再次按同一冻结策略与阈值检查；修复输出格式或补齐证据不等于要求寻找更多错误，不得为了产出Fail而搜罗重音/变音符号、连写、专名变体、照录客户拼写或无碍理解的小语法问题。建议始终留在reason，不升级为硬失败。`;
}
