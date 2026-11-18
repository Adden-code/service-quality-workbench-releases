// Shared header recognition and physical-column provenance; no model input.
import {resolveReviewedEcommerceColumns} from './ecommerce-conversion.mjs';
export const EC_HEADERS = Object.freeze([
  'Region 区域', '抽检周期', '区域', '国家', '展示商品ID', '订单编码', 'SKU编码', 'SKU名称',
  '评论内容', '回复内容', '评分', '管理员', '评论时间', '首次回复时间', '评价类型',
  'Is there any issue with the response time? 是否存在回复时效规范的问题',
  'Is there any text quality issue? 是否存在文本质量问题',
  'Is there an issue with responses not being sufficiently targeted? 是否存在回复不够针对的问题',
  'Is there an issue with responses being insufficiently structured? 是否存在回复不够结构化的问题',
  'Is there an issue with the public disclosure of private data? 是否存在隐私数据公开回复的问题',
  'Overall Passed(整体是否通过)',
  'Description of the specific problem point.(具体问题点描述)',
]);

export const normalizeEcommerceHeader = value => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const aliases = [
  ['Region', '区域'], ['Sampling Period', 'Inspection Period'], ['Region', '区域'], ['Country'],
  ['Display Product ID', 'Displayed Product ID', 'Product ID'], ['Order Code', 'Order ID', 'Order Number'],
  ['SKU Code', 'SKU ID'], ['SKU Name'], ['Comment Content', 'Review Content', 'Comment', 'Review'],
  ['Reply Content', 'Response Content', 'Reply', 'Response'], ['Rating', 'Score', 'Grade'], ['Administrator', 'Admin'],
  ['Comment Time', 'Review Time'], ['First Reply Time', 'First Response Time'], ['Evaluation Type', 'Review Type', 'Comment Types'],
  ['Is there any issue with the response time?', '是否存在回复时效规范的问题'],
  ['Is there any text quality issue?', '是否存在文本质量问题'],
  ['Is there an issue with responses not being sufficiently targeted?', '是否存在回复不够针对的问题'],
  ['Is there an issue with responses being insufficiently structured?', '是否存在回复不够结构化的问题'],
  ['Is there an issue with the public disclosure of private data?', '是否存在隐私数据公开回复的问题'],
  ['Overall Passed', '整体是否通过'], ['Description of the specific problem point.', '具体问题点描述'],
].map((values, i) => {
  const labels=[...new Set([EC_HEADERS[i], ...values].map(normalizeEcommerceHeader))];
  // Explicit same-column bilingual labels may appear in either language order.
  const chinese=labels.filter(value=>/[\u3400-\u9fff]/u.test(value));
  const english=labels.filter(value=>/[a-z]/i.test(value)&&!/[\u3400-\u9fff]/u.test(value));
  return new Set([...labels,...chinese.flatMap(zh=>english.flatMap(en=>[zh+en,en+zh]))]);
});
const headerLabels = [...new Set(aliases.flatMap(values => [...values]))].sort((a, b) => b.length - a.length);
const longestHeaderPrefix = value => headerLabels.find(candidate => value.startsWith(candidate));
const headerOwners = new Map(headerLabels.map(label=>[label,aliases.reduce((mask,values,index)=>values.has(label)?mask|(1<<index):mask,0)]));
const canonicalRegionLabels = [0,2].map(index=>normalizeEcommerceHeader(EC_HEADERS[index]));
// Reject complete labels from different columns joined together, while allowing
// normal explanatory prose to mention another field and same-column bilingual labels.
// Candidate bits keep the old per-field rejection semantics in one suffix walk.
const crossColumnMask = (suffix, candidates) => {
  const pending = [[0, 0]], seen = new Set();let rejectedCandidates=0;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    let [offset, rejected] = pending[cursor];
    offset += /^[\p{P}\p{S}]+/u.exec(suffix.slice(offset))?.[0].length ?? 0;
    const key = `${offset}:${rejected}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (offset === suffix.length) {rejectedCandidates|=rejected;continue;}
    for (const label of headerLabels) if (suffix.startsWith(label, offset)) pending.push([offset + label.length, rejected|(candidates&~headerOwners.get(label))]);
  }
  return rejectedCandidates;
};
// Keys are immutable primitive text, never mutable header-array or record identity.
// Bound retained source header text to 64*20000 characters; every map/array still
// passes its structural and positional checks on each validation call.
const headerAnalysisCache = new Map(),HEADER_CACHE_LIMIT=64;
const analyzeHeader = header => {
  const cached=headerAnalysisCache.get(header);
  if(cached){headerAnalysisCache.delete(header);headerAnalysisCache.set(header,cached);return cached;}
  const value = normalizeEcommerceHeader(header);
  // Use the longest known prefix so e.g. Comment Time cannot occupy the Comment column.
  const label = longestHeaderPrefix(value);
  const owners=headerOwners.get(label)??0,accepted=owners&~crossColumnMask(value.slice(label?.length??0),owners);
  const analysis=Object.freeze({label,indices:Object.freeze(EC_HEADERS.flatMap((_,index)=>accepted&(1<<index)?[index]:[]))});
  if(headerAnalysisCache.size>=HEADER_CACHE_LIMIT)headerAnalysisCache.delete(headerAnalysisCache.keys().next().value);
  headerAnalysisCache.set(header,analysis);return analysis;
};

const increasing = values => values.every((value,index)=>index===0||value>values[index-1]);
const mappingError = message => { throw new Error(`核心22列表头${message}`); };

/** All positions are one-based physical columns. A proven unique assignment or
 * complete distinct canonical Region pair resolves independent of source order.
 * Otherwise all identified core fields must retain their old relative order.
 */
export function resolveEcommerceColumns(headers){
  const candidates=EC_HEADERS.map(()=>[]),labels=[];
  for(let column=0;column<headers.length;column++){
    const header=headers[column];
    if(typeof header!=='string'||header.length>20000)mappingError(`第${column+1}列须为文本且最多20000字符。`);
    const analysis=analyzeHeader(header);labels.push(analysis.label);
    for(const index of analysis.indices)candidates[index].push(column+1);
  }
  const core=Array(22).fill(null),problems=[];
  for(let index=0;index<22;index++){
    if(index===0||index===2)continue;
    const found=candidates[index];
    if(found.length!==1)problems.push(`【${EC_HEADERS[index]}】${found.length?`在第${found.join('、')}列重复或冲突，须唯一`:'缺失，请补充对应表头'}`);
    else core[index]=found[0];
  }
  if(problems.length)mappingError(problems.join('；')+'。');
  const regionColumns=[...new Set([...candidates[0],...candidates[2]])].sort((a,b)=>a-b);
  if(regionColumns.length!==2)mappingError(`【Region 区域 / 区域】${regionColumns.length<2?'缺失':'重复或冲突'}，需要恰好两个可唯一定位的字段。`);
  let assignments=[];
  for(const first of candidates[0])for(const third of candidates[2])if(first!==third)assignments.push([first,third]);
  if(!assignments.length)mappingError('【Region 区域 / 区域】缺失或冲突，请核对两个区域字段。');
  const ordered=assignments.find(([first,third])=>increasing(core.map((column,index)=>index===0?first:index===2?third:column)));
  // Rank only the Region pair, using the same longest recognized labels as the
  // accepted suffix matcher. A single canonical label plus a shared alias is
  // still ambiguous: legacy sources also use 区域 for the first Region field.
  const canonical=assignments.filter(pair=>pair.every((column,index)=>labels[column-1]===canonicalRegionLabels[index]));
  let legacyRelativeRegions=false,regions;
  // Identical and partially canonical aliases retain demonstrated legacy order.
  if(assignments.length===1)regions=assignments[0];
  else if(canonical.length===1)regions=canonical[0];
  else if(ordered){regions=ordered;legacyRelativeRegions=true;}
  else mappingError('【Region 区域 / 区域】存在歧义，乱序时无法唯一识别；请使用不同的明确表头“Region 区域”和“区域”，或恢复22个核心字段的原相对顺序。');
  [core[0],core[2]]=regions;
  if(new Set(core).size!==22)mappingError('字段来源列冲突，每个核心字段必须使用不同的来源列。');
  const used=new Set(core),extensions=Array.from({length:headers.length},(_,index)=>index+1).filter(column=>!used.has(column));
  return{sourceColumns:{core,extensions},mapped:core.some((column,index)=>column!==index+1),legacyRelativeRegions};
}

/** Closed provenance contract shared by records and frozen export snapshots. */
export function validateEcommerceSourceColumns(sourceColumns,headers,extensionHeaders,reviewedMapping){
  if(!sourceColumns||typeof sourceColumns!=='object'||Array.isArray(sourceColumns)||Reflect.ownKeys(sourceColumns).length!==2||!Object.hasOwn(sourceColumns,'core')||!Object.hasOwn(sourceColumns,'extensions'))mappingError('来源映射须仅包含core和extensions。');
  const {core,extensions}=sourceColumns,n=extensionHeaders?.length,width=22+n;
  if(!Array.isArray(headers)||headers.length!==22||!Array.isArray(extensionHeaders)||43+n>16384||!Array.isArray(core)||core.length!==22||!Array.isArray(extensions)||extensions.length!==n)mappingError('来源映射长度须与22个核心列及扩展列一致。');
  const columns=[...core,...extensions];
  if(columns.some(column=>!Number.isSafeInteger(column)||column<1||column>width)||new Set(columns).size!==width||!increasing(extensions))mappingError('来源映射须一一覆盖全部物理列，扩展列须保持原相对顺序。');
  const physical=Array(width);core.forEach((column,index)=>physical[column-1]=headers[index]);extensions.forEach((column,index)=>physical[column-1]=extensionHeaders[index]);
  const resolved=reviewedMapping===undefined?resolveEcommerceColumns(physical):resolveReviewedEcommerceColumns(physical,reviewedMapping);
  if(JSON.stringify(resolved.sourceColumns)!==JSON.stringify({core,extensions}))mappingError('来源映射与表头唯一定位结果不一致。');
  return resolved;
}

