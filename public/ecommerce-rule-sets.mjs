// 阶段A只执行时效升级；其他四项继续已确认的Sheet4 V1口径。
import {validateCalendar,resolveTimeThreshold} from './working-time.mjs';

export const EC_STAGE_A_RULE_SET_ID='EC-REVIEW';
export const EC_STAGE_A_VERSION='V2.1-A';
export const EC_STAGE_A_EXECUTION_PROFILE='v21-time-v1-content';
export const EC_STAGE_A_TITLE='V2.1-A（时效升级；其他四项V1）';
const MAX_JSON=1024*1024, MAX_RECORDS=200;
const FIELDS=['schemaVersion','ruleSetId','version','title','status','effectiveAt','expiresAt','owner','changeNote','createdAt','updatedAt','executionProfile','trial','calendarConfirmed','timeRule'];
const EDITABLE=['title','effectiveAt','expiresAt','owner','changeNote','calendarConfirmed','timeRule'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const fail=message=>{throw new Error(`电商检核口径：${message}`);};
function known(value,keys,label){if(!object(value))fail(`${label}必须为对象。`);for(const key of Object.keys(value))if(!keys.includes(key))fail(`${label}不支持字段 ${key}；阶段A不能静默忽略其他V2.1能力。`);}
function text(value,label,max,{optional=false}={}){if(typeof value!=='string'||(!optional&&!value.trim())||value.length>max)fail(`${label}必须为${optional?'可空':'非空'}文本，长度不超过${max}。`);}
function date(value,label){const parsed=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T00:00:00Z`):null;if(!parsed||!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==value||+value.slice(0,4)<2000||+value.slice(0,4)>2100)fail(`${label}须为2000—2100年间真实YYYY-MM-DD日期。`);}
function time(value,label='操作时间'){const match=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);if(!match)fail(`${label}须为带时区ISO时间。`);date(match[1],label);if(+match[2]>23||+match[3]>59||+match[4]>59||(match[5]!=='Z'&&(+match[6]>14||+match[7]>59||(+match[6]===14&&+match[7]!==0)))||!Number.isFinite(Date.parse(value)))fail(`${label}无效。`);}
function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(value))fail('规则集标识须为1至32位英文字母、数字、下划线或连字符。');}
export function ruleSetNumericVersion(value){const m=typeof value==='string'&&/^V(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})-A$/.exec(value);if(!m)fail('阶段A版本须为V主版本.次版本-A，例如V2.1-A。');return `V${m[1]}.${m[2]}`;}

/** Normalize explicitly supported calendar defaults without inferring holidays. */
export function normalizeRuleSet(record){
  const next=clone(record);
  if(object(next?.timeRule)&&object(next.timeRule.calendar)){
    known(next.timeRule.calendar,['workdays','workStart','workEnd','timezone','holidays','workingDates'],'calendar');
    next.timeRule.calendar=validateCalendar(next.timeRule.calendar);
  }
  return next;
}
export function validateRuleSet(record,{publishing=false}={}){
  known(record,FIELDS,'规则集');if(record.schemaVersion!==1)fail('规则集schemaVersion必须为1。');id(record.ruleSetId);ruleSetNumericVersion(record.version);
  text(record.title,'名称',120);text(record.owner,'维护人',80,{optional:record.status==='草稿'&&!publishing});text(record.changeNote,'变更说明',2000);
  if((publishing||record.status!=='草稿')&&record.owner.trim()==='待填写维护人')fail('发布前必须填写实际维护人。');
  date(record.effectiveAt,'生效');if(record.expiresAt!==''){date(record.expiresAt,'失效');if(record.expiresAt<=record.effectiveAt)fail('失效日期须晚于生效日期。');}
  if(!['草稿','已发布','已停用'].includes(record.status))fail('状态无效。');
  time(record.createdAt,'创建时间');time(record.updatedAt,'更新时间');if(Date.parse(record.updatedAt)<Date.parse(record.createdAt))fail('更新时间不能早于创建时间。');
  if(record.executionProfile!==EC_STAGE_A_EXECUTION_PROFILE||record.trial!==true)fail('仅支持阶段A试运行执行配置。');
  if(typeof record.calendarConfirmed!=='boolean')fail('日历核对状态必须为布尔值。');
  const rule=record.timeRule;known(rule,['mode','calendar','thresholds','unrepliedRule','replyDetection'],'timeRule');
  if(!['workingHours','continuous'].includes(rule.mode))fail('timeRule.mode仅支持workingHours或continuous。');
  known(rule.calendar,['workdays','workStart','workEnd','timezone','holidays','workingDates'],'calendar');
  if(!Array.isArray(rule.calendar.workdays))fail('持久化规则集的workdays必须归一为Mon..Sun数组。');
  if(!Array.isArray(rule.calendar.holidays)||!Array.isArray(rule.calendar.workingDates)||rule.calendar.holidays.length>3660||rule.calendar.workingDates.length>3660)fail('假期和补班表必须为不超过3660项的数组。');
  validateCalendar(rule.calendar);known(rule.thresholds,['default','byType'],'thresholds');
  if(!object(rule.thresholds.byType))fail('thresholds.byType必须为对象。');resolveTimeThreshold(rule,null);
  if(typeof rule.unrepliedRule!=='boolean'||rule.replyDetection!=='bothEmpty')fail('未回复规则须为布尔值，replyDetection仅支持bothEmpty。');
  return true;
}
const overlap=(a,b)=>(!a.expiresAt||b.effectiveAt<a.expiresAt)&&(!b.expiresAt||a.effectiveAt<b.expiresAt);
export function validateRuleSets(records){
  if(records===undefined)return true;
  if(!Array.isArray(records)||records.length>MAX_RECORDS)fail('ruleSets必须是不超过200项的数组。');
  const keys=new Set(),published=[];
  for(const record of records){validateRuleSet(record);const key=JSON.stringify([record.ruleSetId,record.version]);if(keys.has(key))fail('规则集标识和版本重复。');keys.add(key);if(record.status==='已发布'){if(published.some(previous=>previous.ruleSetId===record.ruleSetId&&overlap(previous,record)))fail('同规则集已发布版本的生效期重叠。');published.push(record);}}
  return true;
}
function checkCatalog(catalog){if(!object(catalog)||catalog.schemaVersion!==1||!Array.isArray(catalog.events))fail('目录结构无效。');validateRuleSets(catalog.ruleSets);}
function find(catalog,ruleSetId,version){const found=(catalog.ruleSets||[]).find(r=>r.ruleSetId===ruleSetId&&r.version===version);if(!found)fail('规则集版本不存在。');return found;}
function event(next,record,action,now){next.events.push({kind:'ruleSets',id:record.ruleSetId,version:record.version,action,at:now});}
function editable(changes){known(changes,[...EDITABLE,'version','ruleSetId'],'草稿变更');return Object.fromEntries(EDITABLE.filter(key=>Object.hasOwn(changes,key)).map(key=>[key,clone(changes[key])]));}

/** Form seed. An empty owner is deliberately not publishable. */
export function createRuleSetSeed({ruleSetId=EC_STAGE_A_RULE_SET_ID,version=EC_STAGE_A_VERSION,now=new Date().toISOString(),...changes}={}){
  time(now);id(ruleSetId);ruleSetNumericVersion(version);editable(changes);
  return normalizeRuleSet({schemaVersion:1,ruleSetId,version,title:EC_STAGE_A_TITLE,status:'草稿',effectiveAt:now.slice(0,10),expiresAt:'',owner:'',changeNote:'按用户确认的累计工作小时试运行；正式上线前仍须业务复核24H含义。',createdAt:now,updatedAt:now,executionProfile:EC_STAGE_A_EXECUTION_PROFILE,trial:true,calendarConfirmed:false,timeRule:{mode:'workingHours',calendar:{workdays:['Mon','Tue','Wed','Thu','Fri'],workStart:'09:00',workEnd:'18:00',timezone:'UTC+08:00',holidays:[],workingDates:[]},thresholds:{default:24,byType:{'好评正向':72,'中评':48,'好评负向':24,'差评':24}},unrepliedRule:true,replyDetection:'bothEmpty'},...editable(changes)});
}
export function listRuleSets(catalog,{asOf,includeUnavailable=true}={}){
  checkCatalog(catalog);if(asOf!==undefined)date(asOf,'筛选');if(typeof includeUnavailable!=='boolean')fail('includeUnavailable必须为布尔值。');
  return clone((catalog.ruleSets||[]).filter(r=>includeUnavailable||(r.status==='已发布'&&(!asOf||(r.effectiveAt<=asOf&&(!r.expiresAt||asOf<r.expiresAt))))));
}
export function createRuleSetDraft(catalog,ruleSetId,changes={},now=new Date().toISOString()){
  checkCatalog(catalog);time(now);id(ruleSetId);editable(changes);if(changes.ruleSetId!==undefined&&changes.ruleSetId!==ruleSetId)fail('规则集标识不能修改。');
  const version=changes.version??EC_STAGE_A_VERSION;if((catalog.ruleSets||[]).some(r=>r.ruleSetId===ruleSetId&&r.version===version))fail('规则集标识和版本重复；请创建新版本。');
  const previous=(catalog.ruleSets||[]).filter(r=>r.ruleSetId===ruleSetId).at(-1);
  const record=previous?normalizeRuleSet({...clone(previous),...editable(changes),ruleSetId,version,status:'草稿',createdAt:now,updatedAt:now}):createRuleSetSeed({...changes,ruleSetId,version,now});
  validateRuleSet(record);const next=clone(catalog);(next.ruleSets??=[]).push(record);event(next,record,'创建口径草稿',now);validateRuleSets(next.ruleSets);return next;
}
export function updateRuleSetDraft(catalog,ruleSetId,version,changes={},now=new Date().toISOString()){
  checkCatalog(catalog);time(now);const old=find(catalog,ruleSetId,version);if(old.status!=='草稿')fail('只有草稿可以编辑；已发布内容必须创建新版本。');
  editable(changes);if((changes.ruleSetId!==undefined&&changes.ruleSetId!==ruleSetId)||(changes.version!==undefined&&changes.version!==version))fail('草稿标识和版本不能修改。');
  const updated=normalizeRuleSet({...clone(old),...editable(changes),updatedAt:now});validateRuleSet(updated);
  const next=clone(catalog);next.ruleSets[next.ruleSets.findIndex(r=>r.ruleSetId===ruleSetId&&r.version===version)]=updated;event(next,updated,'更新口径草稿',now);return next;
}
export function publishRuleSet(catalog,ruleSetId,version,now=new Date().toISOString()){
  checkCatalog(catalog);time(now);const old=find(catalog,ruleSetId,version);if(old.status!=='草稿')fail('只有草稿可以发布。');validateRuleSet(old,{publishing:true});
  const next=clone(catalog),record=find(next,ruleSetId,version);record.status='已发布';record.updatedAt=now;event(next,record,'发布试运行口径',now);validateRuleSets(next.ruleSets);return next;
}
export function retireRuleSet(catalog,ruleSetId,version,now=new Date().toISOString()){
  checkCatalog(catalog);time(now);if(find(catalog,ruleSetId,version).status!=='已发布')fail('只有已发布版本可以停用。');
  const next=clone(catalog),record=find(next,ruleSetId,version);record.status='已停用';record.updatedAt=now;event(next,record,'停用口径',now);validateRuleSets(next.ruleSets);return next;
}
export function exportRuleSet(catalog,ruleSetId,version){checkCatalog(catalog);return JSON.stringify({schemaVersion:1,format:'ecommerce-rule-set-stage-a',ruleSet:clone(find(catalog,ruleSetId,version))},null,2);}
export function importRuleSet(catalog,json,now=new Date().toISOString()){
  checkCatalog(catalog);time(now);if(typeof json!=='string'||new TextEncoder().encode(json).length>MAX_JSON)fail('JSON大小须不超过1MB。');
  let parsed;try{parsed=JSON.parse(json);}catch{fail('JSON格式无效。');}known(parsed,['schemaVersion','format','ruleSet'],'导入文件');if(parsed.schemaVersion!==1||parsed.format!=='ecommerce-rule-set-stage-a')fail('导入格式或版本不支持。');
  validateRuleSet(parsed.ruleSet);const incoming=normalizeRuleSet({...clone(parsed.ruleSet),status:'草稿',createdAt:now,updatedAt:now});
  if((catalog.ruleSets||[]).some(r=>r.ruleSetId===incoming.ruleSetId&&r.version===incoming.version))fail('规则集标识和版本重复。');
  const next=clone(catalog);(next.ruleSets??=[]).push(incoming);event(next,incoming,'导入口径草稿',now);validateRuleSets(next.ruleSets);return next;
}

/** Resolve only the selected published effective configuration, with no inferred fallback. */
export function resolvePublishedRuleSet(catalog,{ruleSetId,version,effectiveDate}={}){
  checkCatalog(catalog);date(effectiveDate,'任务生效');id(ruleSetId);ruleSetNumericVersion(version);
  const record=find(catalog,ruleSetId,version);if(record.status!=='已发布'||record.effectiveAt>effectiveDate||(record.expiresAt&&effectiveDate>=record.expiresAt))fail('所选规则集必须为任务日期生效的已发布版本。');return clone(record);
}

const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const content=record=>Object.fromEntries(Object.entries(record).filter(([key])=>!['status','updatedAt'].includes(key)));

/** Guard direct workspace PUTs as well as the normal pure CRUD path. No automatic expiry edits. */
export function validateRuleSetCatalogTransition(previousCatalog,nextCatalog){
  checkCatalog(nextCatalog);validateRuleSets(previousCatalog?.ruleSets);
  const before=previousCatalog?.ruleSets||[],after=nextCatalog.ruleSets||[];
  for(const previous of before){
    const next=after.find(r=>r.ruleSetId===previous.ruleSetId&&r.version===previous.version);
    if(!next)fail('已有规则集版本不能删除或更改标识、版本；请停用已发布版本。');
    if(next.createdAt!==previous.createdAt||Date.parse(next.updatedAt)<Date.parse(previous.updatedAt))fail('规则集创建时间不可改写，更新时间不能倒退。');
    if(previous.status==='草稿'){
      if(next.status==='草稿')continue;
      if(next.status!=='已发布'||!same(content(previous),content(next)))fail('发布须使用已保存草稿的完整内容；请先保存草稿再发布。');
    }else{
      if(same(previous,next))continue;
      if(previous.status!=='已发布'||next.status!=='已停用'||!same(content(previous),content(next)))fail('已发布或已停用规则集内容不可改写；只允许已发布转为停用。');
    }
  }
  for(const next of after)if(!before.some(r=>r.ruleSetId===next.ruleSetId&&r.version===next.version)&&next.status!=='草稿')fail('新规则集必须先保存为草稿，再单独发布。');
  return true;
}
