import {validateCalendar,timeDurationMs} from './working-time.mjs';
import {validateEcommerceSemanticPolicy,validateEcommerceTargetPolicy,hasTargetCalibrationPolicy} from './ecommerce-semantic-policy.mjs';
import {isFixed24EcommerceBasis,validateEcommerceTimingPolicy,EC_FIXED24_TIMING_POLICY_VERSION} from './ecommerce-timing-policy.mjs';
export const EC_BUSINESS_PROFILE='ec-business-v1';
export const isBusinessEcommerceBasis=b=>b?.executionProfile===EC_BUSINESS_PROFILE;
export const EC_TYPES=['好评正向','好评负向','中评','差评'];
const IDS=['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];
const fail=m=>{throw new Error(m);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim();
export function validateBusinessEcommerceBasis(b){
 if(!isBusinessEcommerceBasis(b)||b.ruleSetSnapshot||!Array.isArray(b.rules)||b.rules.length!==5||new Set(b.rules.map(r=>r.id)).size!==5||!IDS.every(id=>b.rules.some(r=>r.id===id)))fail('内置电商版本必须包含独立五项规则。');
 const p=b.businessProfile;
 const calibrated=hasTargetCalibrationPolicy(b);
 if(!object(p)||p.schemaVersion!==1||p.similarity?.method!=='normalized-bigram-dice-v1'||p.similarity.threshold!==0.85||p.similarity.minimumRecords!==(calibrated?3:2)||p.similarity.scope!==(calibrated?'batch-administrator':'batch'))fail('电商相似度执行配置不受支持。');
 if(Object.hasOwn(p,'semanticPolicy'))validateEcommerceSemanticPolicy(p.semanticPolicy);
 if(Object.hasOwn(p,'targetPolicyVersion'))validateEcommerceTargetPolicy(b);
 if(p.structure?.minimumSteps!==3||p.structure.counting!=='grapheme-with-spaces-v1'||!['zh','en'].every(l=>Number.isSafeInteger(p.structure.closingWaiver[l])&&p.structure.closingWaiver[l]>0)||p.privacy?.maskedAllowed!==false)fail('电商结构或隐私配置无效。');
 const t=p.timing;if(!object(t)||!['pending','ready'].includes(t.status)||!text(t.siteField)||!Array.isArray(t.sites)||t.sites.length>100||!Array.isArray(t.standards)||t.standards.length>400)fail('电商站点时效配置无效。');
 if(Object.hasOwn(t,'policyVersion'))validateEcommerceTimingPolicy(t);
 if(t.mode!==undefined&&!['elapsed','workingHours'].includes(t.mode))fail('电商计时模式无效。');if(t.mode==='elapsed'&&(!Number.isFinite(t.defaultHours)||t.defaultHours<=0||t.defaultHours>87600||!text(t.defaultSource)))fail('自然时间默认阈值及依据必填。');
 const sites=new Set(),aliases=new Set();for(const s of t.sites){if(!text(s.id)||!text(s.label)||sites.has(s.id)||!Array.isArray(s.aliases)||t.mode!=='elapsed'&&typeof s.calendarConfirmed!=='boolean')fail('电商站点字典无效。');sites.add(s.id);for(const a of new Set([s.id,s.label,...s.aliases])){if(!text(a)||aliases.has(a))fail('站点名称/别名须唯一。');aliases.add(a);}if(t.mode!=='elapsed')validateCalendar(s.calendar);}
 const keys=new Set();for(const r of t.standards){const key=JSON.stringify([r.siteId,r.evaluationType]);if(!sites.has(r.siteId)||!EC_TYPES.includes(r.evaluationType)||keys.has(key)||typeof r.hours!=='number'||!Number.isFinite(r.hours)||r.hours<=0||r.hours>87600||r.authoring!=='manual'||!text(r.source))fail('时效阈值必须按站点/评价类型手工录入并注明依据。');keys.add(key);}
 if(t.status==='pending'&&t.standards.length||t.status==='ready'&&(!t.standards.length&&t.mode!=='elapsed'||t.mode!=='elapsed'&&t.sites.some(s=>!s.calendarConfirmed)))fail('待维护标准必须留空；启用前须核对工作日历。');
 return true;
}
export function visibleCharacterCount(value){return [...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(String(value))].filter(x=>!/^\p{C}+$/u.test(x.segment)).length;}
export function replyStructureFacts(reply,basis){const language=/[\u3400-\u9fff]/u.test(reply)?'zh':'en',count=visibleCharacterCount(reply),threshold=basis.businessProfile.structure.closingWaiver[language];return{language,count,threshold,closingOptional:count>threshold,counting:'grapheme-with-spaces-v1'};}
export const normalizeBusinessReply=s=>String(s).normalize('NFKC').toLocaleLowerCase('und').replace(/[\p{P}\p{Z}\s]/gu,'');
export function businessReplySimilarity(left,right){
 const a=Array.from(normalizeBusinessReply(left)),b=Array.from(normalizeBusinessReply(right));if(!a.length||!b.length)return 0;if(a.join('')===b.join(''))return 1;if(a.length<2||b.length<2)return 0;
 const counts=new Map();for(let i=1;i<a.length;i++){const k=a[i-1]+a[i];counts.set(k,(counts.get(k)||0)+1);}let matches=0;for(let i=1;i<b.length;i++){const k=b[i-1]+b[i],n=counts.get(k)||0;if(n){matches++;counts.set(k,n-1);}}return 2*matches/(a.length+b.length-2);
}
const coordinate=s=>JSON.stringify([s.ecommerce.fileSha256,s.ecommerce.sheet,s.ecommerce.row]);
export function businessDuplicateGroups(sessions,basis){
 if(hasTargetCalibrationPolicy(basis))return businessDuplicateAssessment(sessions,basis).duplicateGroups;
 validateBusinessEcommerceBasis(basis);const pairs=[],covered=new Set(),used=new Set(),rows=sessions.filter(s=>{const c=coordinate(s);if(used.has(c))return false;used.add(c);return Boolean(s.ecommerce.raw[9].trim());});
 // Keep pair evidence, never turn an A~B~C chain into an unproved A~C group.
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(covered.has(a.id)&&covered.has(b.id))continue;const score=businessReplySimilarity(a.ecommerce.raw[9],b.ecommerce.raw[9]);if(score>=basis.businessProfile.similarity.threshold){pairs.push({kind:score===1?'exact':'similar',sessionIds:[a.id,b.id],reason:`归一化字符二元组 Dice 相似度 ${(score*100).toFixed(2)}%，达到 85%；本批次两个不同来源行。`});covered.add(a.id);covered.add(b.id);}}
 return pairs;
}
export function validateBusinessDuplicateGroups(groups,sessions,basis){
 if(hasTargetCalibrationPolicy(basis))return validateCalibratedDuplicateGroups(groups,sessions,basis);
 validateBusinessEcommerceBasis(basis);if(!Array.isArray(groups)||groups.length>124750)fail('电商批次配对证据无效。');const map=new Map(sessions.map(s=>[s.id,s]));return groups.map(g=>{const rows=g?.sessionIds?.map(id=>map.get(id));if(!rows||rows.length!==2||rows.some(s=>!s)||coordinate(rows[0])===coordinate(rows[1])||!text(g.reason)||g.reason.length>2000)fail('新电商重复证据须为两个真实不同来源行。');const score=businessReplySimilarity(rows[0].ecommerce.raw[9],rows[1].ecommerce.raw[9]);if(score<0.85||g.kind!==(score===1?'exact':'similar'))fail('重复证据不能通过程序相似度复算。');return{sessionIds:[...g.sessionIds],kind:g.kind,reason:g.reason};});
}
const administrator=s=>s.ecommerce.raw[11].trim();
// Every hard-failure witness is a complete triangle. This covers every row that
// belongs to a >=3-member clique without enumerating all maximal cliques.
export function businessDuplicateAssessment(sessions,basis){
 validateBusinessEcommerceBasis(basis);
 if(!hasTargetCalibrationPolicy(basis))return{duplicateGroups:businessDuplicateGroups(sessions,basis),advisoryGroups:[],missingAdministratorSessionIds:[]};
 const used=new Set(),rows=sessions.filter(s=>{const key=coordinate(s);if(used.has(key))return false;used.add(key);return Boolean(s.ecommerce.raw[9].trim());});
 const adjacency=rows.map(()=>new Map()),duplicateGroups=[],advisoryGroups=[],covered=new Set(),advised=new Set();
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  if(!administrator(rows[i])||administrator(rows[i])!==administrator(rows[j]))continue;
  const score=businessReplySimilarity(rows[i].ecommerce.raw[9],rows[j].ecommerce.raw[9]);
  if(score>=.85){adjacency[i].set(j,score);adjacency[j].set(i,score);}
 }
 for(let i=0;i<rows.length;i++){
  if(covered.has(i))continue;
  let found=false;
  for(const [j,ij] of adjacency[i]){
   for(const [k,ik] of adjacency[i]){
    if(k<=j||!adjacency[j].has(k))continue;
    const minimum=Math.min(ij,ik,adjacency[j].get(k));
    duplicateGroups.push({sessionIds:[rows[i].id,rows[j].id,rows[k].id],kind:minimum===1?'exact':'similar',reason:`同一管理员的3个不同来源行彼此归一化字符二元组Dice相似度均达到85%，最低 ${(minimum*100).toFixed(2)}%；不采用传递闭包。`});
    [i,j,k].forEach(n=>covered.add(n));found=true;break;
   }
   if(found)break;
  }
 }
 for(let i=0;i<rows.length;i++)for(const [j,score] of adjacency[i])if(j>i&&![i,j].every(n=>covered.has(n)||advised.has(n))){
  advisoryGroups.push({sessionIds:[rows[i].id,rows[j].id],kind:score===1?'exact':'similar',reason:`改进建议：同一管理员有2条回复相似度 ${(score*100).toFixed(2)}%，未形成至少3条彼此达到85%的证据组，不作批次硬扣分。`});
  [i,j].forEach(n=>advised.add(n));
 }
 return{duplicateGroups,advisoryGroups,missingAdministratorSessionIds:sessions.filter(s=>s.ecommerce.raw[9].trim()&&!administrator(s)).map(s=>s.id)};
}
function validateCalibratedDuplicateGroups(groups,sessions,basis){
 validateBusinessEcommerceBasis(basis);if(!Array.isArray(groups)||groups.length>124750)fail('电商批次相似证据无效。');
 const map=new Map(sessions.map(s=>[s.id,s]));
 return groups.map(g=>{
  if(!Array.isArray(g?.sessionIds)||g.sessionIds.length<3||g.sessionIds.length>500||new Set(g.sessionIds).size!==g.sessionIds.length||!text(g.reason)||g.reason.length>2000)fail('第二轮重复证据须含至少3条不同来源记录。');
  const rows=g.sessionIds.map(id=>map.get(id));
  if(rows.some(s=>!s||!s.ecommerce.raw[9].trim())||!administrator(rows[0])||rows.some(s=>administrator(s)!==administrator(rows[0]))||new Set(rows.map(coordinate)).size!==rows.length)fail('重复证据须属于同一非空管理员的不同真实来源行。');
  let minimum=1;
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)minimum=Math.min(minimum,businessReplySimilarity(rows[i].ecommerce.raw[9],rows[j].ecommerce.raw[9]));
  if(minimum<.85||g.kind!==(minimum===1?'exact':'similar'))fail('重复组内每一对回复必须通过85%程序相似度复算。');
  return{sessionIds:[...g.sessionIds],kind:g.kind,reason:g.reason};
 });
}
export function businessEvaluationType(session){const c=session.sceneCapabilities?.outputs?.ecommerceClassification;if(c?.status==='completed')return c.value.evaluationType;const n=Number(session.ecommerce.raw[10]);return n===1?'差评':n>=2&&n<=3?'中评':null;}
// The source parser stores unzoned dates as UTC+08. Reinterpret only those wall-clock
// values using the explicitly maintained site offset; explicit source offsets win.
export function businessTimestamp(raw,normalized,timezone){if(!normalized)return null;if(/(?:Z|[+-]\d\d:\d\d)$/i.test(String(raw).trim()))return normalized;const date=new Date(Date.parse(normalized)+8*3600000);return Number.isFinite(+date)?date.toISOString().slice(0,-1)+timezone.slice(3):null;}
export function computeBusinessTimeFacts(session,basis,{inspectionAt,normalizedTimes,runtime}={}){
 if(isFixed24EcommerceBasis(basis))return computeFixed24TimeFacts(session,basis,{inspectionAt,normalizedTimes});
 const p={...basis.businessProfile.timing,standards:runtime?.timingStandards??basis.businessProfile.timing.standards},r=session.ecommerce,hasReply=Boolean(r.raw[9].trim()),hasTime=Boolean(r.raw[13].trim()),replyStatus=!hasReply&&!hasTime?'unreplied':hasReply&&!hasTime?'missing-time':!hasReply&&hasTime?'conflict':'replied';
 const evaluationType=businessEvaluationType(session),facts={schemaVersion:2,executionProfile:EC_BUSINESS_PROFILE,replyStatus,evaluationType,outcome:'undetermined',inspectionAt:inspectionAt??null,siteId:null,thresholdHours:null,elapsedMs:null,startAt:null,endAt:null,reason:''};
 const unknown=reason=>({...facts,reason});if(evaluationType==='好评正向'&&replyStatus==='unreplied')return{...facts,outcome:'na',reason:'好评正向且未回复，不在时效考核范围。'};
 if(!EC_TYPES.includes(evaluationType))return unknown('评价分类尚未确定，未选择时效阈值。');if(p.status==='pending')return unknown('站点时效标准待质检人员手工维护，未使用参考示例数值。');
 const fields=(session.contextFields||[]).filter(f=>(f.key===p.siteField||f.label===p.siteField)&&String(f.value||'').trim()).map(f=>String(f.value).trim());const direct=p.siteField==='国家'?r.raw[3]:null;if(direct)fields.push(direct.trim());const values=[...new Set(fields)],siteOutput=session.sceneCapabilities?.outputs?.site;
 const matches=values.length===1?p.sites.filter(s=>[s.id,s.label,...s.aliases].includes(values[0])):values.length===0&&siteOutput?.status==='completed'?p.sites.filter(s=>s.id===siteOutput.value.siteId):[];
 if(p.mode==='elapsed'){
  if(values.length>1)return unknown('站点字段冲突，待人工核对。');
  const site=matches[0],standard=p.standards.find(s=>s.siteId===site?.id&&s.evaluationType===evaluationType)||{hours:p.defaultHours,source:p.defaultSource,authoring:'business-default'};
  facts.mode='elapsed';facts.siteId=site?.id||values[0]||null;facts.siteSource=values.length?'source-field':site?'scene-site':'batch-default';facts.thresholdHours=standard.hours;facts.standard=structuredClone(standard);facts.thresholdSource=standard.authoring==='business-default'?'business-default':'site-evaluation';
  if(!['replied','unreplied'].includes(replyStatus))return unknown('回复内容与时间字段缺失或冲突，待核对。');
  facts.startAt=normalizedTimes?.commentTime;facts.endAt=replyStatus==='unreplied'?inspectionAt:normalizedTimes?.replyTime;
  try{facts.elapsedMs=timeDurationMs(facts.startAt,facts.endAt,{mode:'continuous'});}catch{return unknown('时间缺失、无效或反向，未计算时长。');}
  facts.outcome=facts.elapsedMs>standard.hours*3600000?'fail':'pass';facts.reason=`${evaluationType}；${replyStatus==='unreplied'?'未回复，累计至冻结质检时间':'评论时间至首次回复时间'}；自然耗时 ${facts.elapsedMs/3600000} 小时，${facts.thresholdSource==='business-default'?'业务默认':'站点/评价类型'}阈值 ${standard.hours} 小时；夜间、周末、节假日全额计入。`;return facts;
 }
 if(matches.length!==1)return unknown('站点缺失、冲突或未匹配，未静默套用其他站点标准。');const site=matches[0];facts.siteId=site.id;facts.siteSource=values.length?'source-field':'scene-site';facts.calendarTimezone=site.calendar.timezone;facts.calendarConfirmed=site.calendarConfirmed;
 if(!site.calendarConfirmed)return unknown('工作日历和节假日未确认。');const standard=p.standards.find(s=>s.siteId===site.id&&s.evaluationType===evaluationType);if(!standard)return unknown('该站点/评价类型缺少手工阈值。');facts.thresholdHours=standard.hours;facts.standard=structuredClone(standard);
 if(!['replied','unreplied'].includes(replyStatus))return unknown('回复内容与时间字段缺失或冲突，待核对。');facts.startAt=businessTimestamp(r.raw[12],normalizedTimes?.commentTime,site.calendar.timezone);facts.endAt=replyStatus==='unreplied'?inspectionAt:businessTimestamp(r.raw[13],normalizedTimes?.replyTime,site.calendar.timezone);
 try{facts.elapsedMs=timeDurationMs(facts.startAt,facts.endAt,{mode:'workingHours',calendar:site.calendar});}catch{return unknown('时间缺失、无效或反向，未计算时长。');}facts.outcome=facts.elapsedMs>standard.hours*3600000?'fail':'pass';facts.reason=`站点 ${site.label}；${evaluationType}；${replyStatus==='unreplied'?'未回复，累计至冻结质检时间':'累计至首次回复'}；工作时长 ${facts.elapsedMs/3600000} 小时，手工阈值 ${standard.hours} 小时；按冻结工作日历排除非工作时段及已维护假期。`;return facts;
}
function computeFixed24TimeFacts(session,basis,{inspectionAt,normalizedTimes}){
 validateEcommerceTimingPolicy(basis.businessProfile.timing);
 const raw=session.ecommerce.raw,hasReply=Boolean(raw[9].trim()),hasTime=Boolean(raw[13].trim());
 const replyStatus=!hasReply&&!hasTime?'unreplied':hasReply&&!hasTime?'missing-time':!hasReply&&hasTime?'conflict':'replied';
 const facts={schemaVersion:2,executionProfile:EC_BUSINESS_PROFILE,timingPolicyVersion:EC_FIXED24_TIMING_POLICY_VERSION,mode:'elapsed',replyStatus,evaluationType:null,outcome:'undetermined',inspectionAt:inspectionAt??null,siteId:null,thresholdHours:24,thresholdSource:'fixed-policy',elapsedMs:null,startAt:normalizedTimes?.commentTime??null,endAt:replyStatus==='unreplied'?(inspectionAt??null):(normalizedTimes?.replyTime??null),endTimeSource:replyStatus==='unreplied'?'frozen-inspection-time':'firstReplyTime',reason:''};
 if(!['replied','unreplied'].includes(replyStatus))return{...facts,reason:'回复内容与首次回复时间缺失或冲突，待核对；不使用最新回复时间或末次回复时间补足。'};
 try{facts.elapsedMs=timeDurationMs(facts.startAt,facts.endAt,{mode:'continuous'});}catch{return{...facts,reason:'评论时间、首次回复时间或冻结质检截止点缺失、无效或反向，未计算时长。'};}
 facts.outcome=facts.elapsedMs>24*3600000?'fail':'pass';
 facts.reason=`${replyStatus==='unreplied'?'未回复，累计至冻结质检时间（不是首次回复时间）':'评论时间至首次回复时间'}；自然耗时 ${facts.elapsedMs/3600000} 小时，统一阈值 24 小时；严格超过才不符合，夜间、周末、节假日全额计入；不依赖评价分类或站点。`;
 return facts;
}
