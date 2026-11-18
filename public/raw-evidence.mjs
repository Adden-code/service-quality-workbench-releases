/** Literal cell evidence. A match proves presence in this row, not business truth. */
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonempty=value=>typeof value==='string'&&Boolean(value.trim());
const verdicts=new Set(['符合','不符合','无法判定','不适用']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const MAX_RAW_MATCHES_PER_RULE=10000;
export const RAW_QUOTE_MATCHING_VERSION='crlf-lf-v1';
export class RawQuoteMatchBudgetError extends Error{
 constructor(){super(`该引文在本行原文出现次数超过${MAX_RAW_MATCHES_PER_RULE}处，请选取更长且能区分上下文的连续原文。`);this.name='RawQuoteMatchBudgetError';this.code='RAW_QUOTE_MATCH_BUDGET';this.status=400;}
}
function wellFormed(value){
 for(let index=0;index<value.length;index++){
  const code=value.charCodeAt(index);
  if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))return false;}
  else if(code>=0xdc00&&code<=0xdfff)return false;
 }
 return true;
}
/** The original matcher remains the durable contract for unmarked 0.10.0 evidence. */
export function matchLiteralRawQuote(text,quote){
 if(typeof text!=='string'||!nonempty(quote)||!wellFormed(quote))return [];
 const matches=[];let from=0;
 while(from<=text.length-quote.length){const start=text.indexOf(quote,from);if(start<0)break;if(matches.length===MAX_RAW_MATCHES_PER_RULE)throw new RawQuoteMatchBudgetError();matches.push({start,end:start+quote.length});from=start+1;}
 return matches;
}
const canonicalNewlines=value=>value.replace(/\r\n/g,'\n');
function quoteComparison(text,quote){
 if(typeof text!=='string'||!nonempty(quote)||!wellFormed(quote))return null;
 const needle=canonicalNewlines(quote);
 if(!text.includes('\r\n'))return {text,needle,boundaries:null};
 const characters=[],boundaries=[0];
 for(let index=0;index<text.length;index++){
  if(text[index]==='\r'&&text[index+1]==='\n'){characters.push('\n');index++;}
  else characters.push(text[index]);
  boundaries.push(index+1);
 }
 return {text:characters.join(''),needle,boundaries};
}
const originalSpan=(comparison,start)=>({start:comparison.boundaries?.[start]??start,end:comparison.boundaries?.[start+comparison.needle.length]??start+comparison.needle.length});
/** Compare only CRLF/LF, then return every occurrence in original UTF16 coordinates. */
export function matchRawQuote(text,quote){
 const comparison=quoteComparison(text,quote);if(!comparison)return [];
 const matches=[];let from=0;
 while(from<=comparison.text.length-comparison.needle.length){
  const start=comparison.text.indexOf(comparison.needle,from);if(start<0)break;
  if(matches.length===MAX_RAW_MATCHES_PER_RULE)throw new RawQuoteMatchBudgetError();
  matches.push(originalSpan(comparison,start));from=start+1;
 }
 return matches;
}
/** Display and reports must preserve the matching contract of each saved result. */
export function rawSavedQuoteMatches(text,quote,validation){
 if(validation?.evidenceMatching!==undefined&&validation.evidenceMatching!==RAW_QUOTE_MATCHING_VERSION)throw new Error('原文证据匹配口径无效。');
 return (validation?.evidenceMatching===RAW_QUOTE_MATCHING_VERSION?matchRawQuote:matchLiteralRawQuote)(text,quote);
}
/** First exact source slice; no enumeration means no all-occurrence match budget. */
export function sourceQuoteSlice(text,quote){
 const comparison=quoteComparison(text,quote);if(!comparison)return null;
 const start=comparison.text.indexOf(comparison.needle);if(start<0)return null;
 const span=originalSpan(comparison,start);return text.slice(span.start,span.end);
}

/** Nonthrowing because both review routing and durable-state checks consume it. */
export function validateRawResultAssurance(result,session){
 const reasonCodes=[],reasons=[];let valid=true;
 const issue=(code,message,{advisory=false}={})=>{if(!reasonCodes.includes(code)){reasonCodes.push(code);reasons.push(message);}if(!advisory)valid=false;};
 const raw=session?.rawTranscript;
 if(!object(raw)||raw.schemaVersion!==1||typeof raw.text!=='string'||!hash(raw.textSha256))issue('invalid_raw_source','原文来源合同无效。');
 if(!object(result))return {valid:false,reasonCodes:[...reasonCodes,'invalid_raw_result'],reasons:[...reasons,'原文检核结果无效。']};
 if(!nonempty(result.ruleId)||!verdicts.has(result.verdict)||!nonempty(result.reason)||result.reason.length>20000)issue('invalid_raw_result','原文检核标识、判定或理由无效。');
 if(!Array.isArray(result.evidence)||result.evidence.length)issue('invalid_evidence','原文直判不能使用轮次作为已核验证据。');
 if(!Array.isArray(result.referenceIds)||new Set(result.referenceIds).size!==result.referenceIds.length||result.referenceIds.some(value=>!nonempty(value)))issue('invalid_reference','原文检核参考标识无效。');
 if(result.confidence!==undefined&&(typeof result.confidence!=='number'||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1))issue('invalid_confidence','模型自评分须为0至1有限数值。');
 if(result.conflictsWith!==undefined&&(!Array.isArray(result.conflictsWith)||new Set(result.conflictsWith).size!==result.conflictsWith.length||result.conflictsWith.some(id=>!nonempty(id)||id===result.ruleId||(Array.isArray(session?.expectedRuleIds)&&!session.expectedRuleIds.includes(id)))))issue('invalid_consistency','冲突规则标识无效。');
 const metadata=result.rawValidation;
 if(!object(metadata)||Object.keys(metadata).some(key=>!['schemaVersion','status','textSha256','reasonCodes','originalVerdict','originalReason','rejectedQuotes','evidenceMatching'].includes(key))||Object.hasOwn(metadata,'evidenceMatching')&&metadata.evidenceMatching!==RAW_QUOTE_MATCHING_VERSION||metadata.schemaVersion!==1||!['verified','degraded','program-fallback','unverified-quote','manual-provided'].includes(metadata.status)||!hash(metadata.textSha256)||metadata.textSha256!==raw?.textSha256||!Array.isArray(metadata.reasonCodes)||new Set(metadata.reasonCodes).size!==metadata.reasonCodes.length||metadata.reasonCodes.some(value=>!nonempty(value)||value.length>100))issue('invalid_raw_validation','原文校验状态或来源摘要无效。');
 if(metadata?.originalVerdict!==undefined&&!verdicts.has(metadata.originalVerdict))issue('invalid_raw_validation','保留的模型原判无效。');
 if(metadata?.originalReason!==undefined&&(!nonempty(metadata.originalReason)||metadata.originalReason.length>20000))issue('invalid_raw_validation','保留的模型原理由无效。');
 if(metadata?.rejectedQuotes!==undefined&&(!Array.isArray(metadata.rejectedQuotes)||metadata.rejectedQuotes.length>500||metadata.rejectedQuotes.some(value=>!object(value)||Object.keys(value).some(key=>!['quote','reasonCode'].includes(key))||(value.quote!==null&&typeof value.quote!=='string')||!nonempty(value.reasonCode))))issue('invalid_raw_validation','未采用的模型引文诊断无效。');
 const quotes=result.evidenceQuotes;
 if(!Array.isArray(quotes)||quotes.length>500)issue('invalid_quote','逐字原文引文结构无效。');
 else{
  if(!quotes.length)issue('missing_quote','没有已定位的原文引文。',{advisory:result.verdict==='无法判定'||['unverified-quote','manual-provided'].includes(metadata?.status)});
  const canonical=metadata?.evidenceMatching===RAW_QUOTE_MATCHING_VERSION,match=canonical?matchRawQuote:matchLiteralRawQuote,seen=new Set();let matchCount=0;
  for(const quote of quotes){
   if(!object(quote)||Object.keys(quote).some(key=>!['quote','matches'].includes(key))||!nonempty(quote.quote)||quote.quote.length>20000||seen.has(canonical?canonicalNewlines(quote.quote):quote.quote)){issue('invalid_quote','逐字引文内容或重复项无效。');continue;}
   seen.add(canonical?canonicalNewlines(quote.quote):quote.quote);
   let expected;
   try{expected=match(raw?.text,quote.quote);}catch(error){issue(error?.code==='RAW_QUOTE_MATCH_BUDGET'?'quote_match_budget':'invalid_quote','引文定位超过资源预算，请选取更长且能区分上下文的连续原文。');break;}
   matchCount+=expected.length;
   if(matchCount>MAX_RAW_MATCHES_PER_RULE){issue('quote_match_budget','同一规则的引文定位合计超过资源预算，请选取更长且能区分上下文的连续原文。');break;}
   if(!expected.length){issue('quote_mismatch','引文未在本行原文逐字连续命中。');continue;}
   if(canonical&&raw.text.slice(expected[0].start,expected[0].end)!==quote.quote)issue('quote_mismatch','保存的引文须为首个命中的原文切片。');
   if(!Array.isArray(quote.matches)||quote.matches.length!==expected.length||quote.matches.some((span,index)=>!object(span)||Object.keys(span).some(key=>!['start','end'].includes(key))||!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start!==expected[index].start||span.end!==expected[index].end))issue('quote_offset_mismatch','引文位置未精确覆盖本行原文全部UTF16命中。');
  }
 }
 if(['degraded','program-fallback'].includes(metadata?.status)&&(result.verdict!=='无法判定'||!Array.isArray(quotes)||quotes.length))issue('invalid_raw_validation','程序降级或失败占位只能为无已核验引文的无法判定。');
 if(metadata?.status==='degraded'&&(!verdicts.has(metadata.originalVerdict)||!nonempty(metadata.originalReason)||!Array.isArray(metadata.rejectedQuotes)))issue('invalid_raw_validation','局部降级须保留模型原判、原理由及拒绝引文。');
 if(metadata?.status==='unverified-quote'&&(!Array.isArray(metadata.rejectedQuotes)||!metadata.rejectedQuotes.length)&&!metadata.reasonCodes?.includes('dependency_quote_unverified'))issue('invalid_raw_validation','未核验状态须保留引文诊断或辅助依赖标记。');
 const metadataCodes=Array.isArray(metadata?.reasonCodes)?metadata.reasonCodes:[];
 if(metadata?.status==='verified'&&(metadata.rejectedQuotes?.length||metadataCodes.some(code=>['quote_mismatch','invalid_quote','quote_match_budget'].includes(code))))issue('invalid_raw_validation','已核验结果不能同时保留引文失败或拒绝引文状态。');
 if(metadataCodes.includes('source_time_unavailable')&&(raw?.timePolicy?.mode!=='unavailable'||result.verdict!=='无法判定'||!Array.isArray(quotes)||quotes.length))issue('invalid_raw_validation','缺少来源时间的确定性处理须保持无法判定，且与批次声明一致。');
 return {valid,reasonCodes,reasons};
}

/** Conservative frozen-rule detection; ordinary polite use of "timely" is not a clock. */
export function rawTimeRuleIds(basis){
 if(!Array.isArray(basis?.rules))return [];
 const category=/^(?:时效|响应时效|回复时效|服务时效|响应时间|回复时间|timing|timeliness|response time|reply time|response latency|sla)$/i;
 const metric=/(?:响应|回复|答复)(?:时间|时长|时效|延迟|速度|及时性)|首响|首次(?:回复|响应)(?:时间|时长|时效)|response\s+(?:time|latency|timeliness|speed)|(?:first|initial)\s+(?:response|reply)\s+(?:time|latency|timeliness)|reply\s+(?:time|latency|timeliness)|(?:resolution|handling|response)\s+deadline/i;
 const duration=/\d+(?:\.\d+)?\s*(?:秒|分钟|小时|天|seconds?|minutes?|hours?|days?)|(?:一|两|三|五|十)(?:秒|分钟|小时|天)/i;
 const timingCriterion=value=>typeof value==='string'&&duration.test(value)&&(metric.test(value)||/(?:respond|reply)\s+(?:within|in)\b|(?:回复|响应|答复).{0,6}(?:内|超过|不超过)/i.test(value));
 return basis.rules.filter(rule=>object(rule)&&nonempty(rule.id)&&(category.test(rule.category||'')||metric.test([rule.title,rule.name].filter(value=>typeof value==='string').join(' '))||(timingCriterion(rule.passCriteria)&&timingCriterion(rule.failCriteria)))).map(rule=>rule.id);
}
export function rawTimeNotice(session,language='zh'){
 if(session?.rawTranscript?.timePolicy?.mode!=='unavailable')return '';
 return language==='en'?'Reliable source timestamps were not provided. Pure timing checks are unable to determine; inspection time cannot replace conversation time.':'未提供可靠来源时间；纯时效类检核无法判定，不使用质检时点补造会话时间。';
}
