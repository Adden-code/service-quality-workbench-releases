// Explicitly published, frozen timing semantics. Absence means legacy behavior.
export const EC_FIXED24_TIMING_POLICY_VERSION='ec-first-reply-fixed24-v1';
export const isFixed24EcommerceBasis=basis=>basis?.executionProfile==='ec-business-v1'&&basis.businessProfile?.timing?.policyVersion===EC_FIXED24_TIMING_POLICY_VERSION;
export function validateEcommerceTimingPolicy(timing){
 if(timing?.policyVersion!==EC_FIXED24_TIMING_POLICY_VERSION||timing.mode!=='elapsed'||timing.status!=='ready'||timing.defaultHours!==24||!Array.isArray(timing.standards)||timing.standards.length)throw new Error('电商固定时效口径须使用 ec-first-reply-fixed24-v1、连续自然时间和统一 24 小时，不能配置站点或评价类型阈值。');
 return true;
}
export function classificationDependentRuleIds(session,basis){
 const fixed=isFixed24EcommerceBasis(basis)||session?.aiResults?.some(r=>r.ruleId==='EC-TIME'&&r.timeFacts?.timingPolicyVersion===EC_FIXED24_TIMING_POLICY_VERSION);
 return fixed?['EC-STEPS']:['EC-TIME','EC-STEPS'];
}
const nextVersion=version=>{
 const m=typeof version==='string'&&version.match(/^V(\d+)\.(\d+)$/);
 if(!m)throw new Error('电商时效升级需要可追溯的原规则/政策版本。');
 const major=Number(m[1]),minor=Number(m[2]);
 if(!Number.isSafeInteger(major)||!Number.isSafeInteger(minor+1))throw new Error('电商时效版本超出支持范围。');
 return major<3||major===3&&minor<3?'V3.3':`V${major}.${minor+1}`;
};
export function upgradeEcommerceTimingBasis(basis){
 const next=structuredClone(basis);
 if(next?.executionProfile!=='ec-business-v1')return next;
 if(isFixed24EcommerceBasis(next)){validateEcommerceTimingPolicy(next.businessProfile.timing);return next;}
 if(Object.hasOwn(next.businessProfile?.timing??{},'policyVersion'))throw new Error('未知电商时效版本不能静默升级。');
 const rule=next.rules?.find(r=>r.id==='EC-TIME'),policy=next.policies?.find(p=>p.id==='EC-BUSINESS-POLICY');
 if(!rule||!next.businessProfile?.timing)throw new Error('电商时效升级需要完整的冻结业务依据。');
 const oldTiming=next.businessProfile.timing;
 next.businessProfile.timing={...oldTiming,policyVersion:EC_FIXED24_TIMING_POLICY_VERSION,mode:'elapsed',status:'ready',defaultHours:24,defaultSource:'需求29：统一首次回复时效 24 个连续自然小时；严格超过才不符合。',standards:[]};
 const previous=rule.version;rule.version=nextVersion(previous);
 Object.assign(rule,{summary:'统一按评论时间至首次回复时间的连续自然耗时判定；不超过 24 小时符合，严格超过 24 小时不符合，与评价分类及站点无关。',passCriteria:'仅使用原表评论时间与首次回复时间，连续自然耗时不超过 24 小时则符合；恰好 24 小时符合，夜间、周末与节假日计入。',failCriteria:'连续自然耗时严格超过 24 小时则不符合；所有站点和评价类型共用同一阈值。评价分类不确定或失败不阻断本项。',exceptionCriteria:'有回复但首次回复时间缺失/无效、评论时间缺失/无效、时间反向或回复字段冲突时无法判定；不得用最新回复时间、末次回复时间或模型推测补足首次回复时间。正文与首次回复时间均为空时，沿用未回复累计到冻结质检截止点的测量方式，明确标注未回复；截止点不是推测的首次回复时间。',changeNote:`需求29：${previous} → ${rule.version}；执行标识 ${EC_FIXED24_TIMING_POLICY_VERSION}；旧任务继续使用原冻结口径。`});
 if(rule.english)rule.english.summary='Use comment time to first reply time only: continuous elapsed time at most 24 hours passes; strictly greater fails, independent of site and classification. Missing, invalid or reversed times remain undetermined.';
 if(policy){
  const prior=policy.version;policy.version=nextVersion(prior);
  const sections=policy.sections??=[];let section=sections.find(s=>s.id==='EC-TIME-BUSINESS-1');
  if(!section){section={id:'EC-TIME-BUSINESS-1',title:rule.title||rule.name||'EC-TIME'};sections.push(section);}
  section.text=`通过：${rule.passCriteria}\n不通过：${rule.failCriteria}\n例外：${rule.exceptionCriteria}`;
  if(Object.hasOwn(section,'version'))section.version=policy.version;
  policy.content=sections.map(s=>`${s.id} ${s.title}\n${s.text}`).join('\n\n');
  policy.summary=`${policy.summary||''} 需求29：首次回复统一 24 个连续自然小时，评价分类与站点不影响时效。`.trim();
  policy.changeNote=`需求29：${prior} → ${policy.version}；执行标识 ${EC_FIXED24_TIMING_POLICY_VERSION}；其他四项已发布语义政策保持不变。`;
 }
 return next;
}
