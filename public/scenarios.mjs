// Versioned scenario contracts. No UI, storage, network or model dependencies.
export const ANALYSIS_FIELDS=Object.freeze(['salesStage','intent','demandSummary','negativeVoice']);
export const REPORT_SECTIONS=Object.freeze(['overview','breakdown','dimensions','cases','improvements','voc']);
export const REQUIRED_CAPABILITIES=Object.freeze(['text-judgment','business-calendar','batch-similarity','external-system','audio-ocr']);
const RESERVED=new Set(['__proto__','prototype','constructor']);
const CONFIG_KEYS=['schemaVersion','id','name','version','enabled','engine','layout','inputProfileId','ruleIds','analysisFields','customFields','report','requiredCapabilities','createdAt','updatedAt'];
const FIELD_KEYS=['id','label','type','instruction','options'];
const REPORT_KEYS=['title','groupBy','groupField','groupLabel','sections'];
const clone=value=>structuredClone(value);
const fail=message=>{throw new Error(message);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function keys(value,allowed,label){
 if(!plain(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||RESERVED.has(key)||!allowed.includes(key)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))fail(`${label}结构或字段无效。`);
}
function text(value,label,max=120,empty=false,multiline=false){if(typeof value!=='string'||(!empty&&!value.trim())||value.length>max||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))fail(`${label}须为有效文本，最多${max}字符。`);return value;}
function token(value,label,max=64,empty=false){text(value,label,max,empty);if(value&&(/\s|@/.test(value)||RESERVED.has(value)))fail(`${label}包含空白或保留字段名。`);return value;}
function array(value,label,max){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max||Reflect.ownKeys(value).some(key=>typeof key!=='string'||(key!=='length'&&!/^(0|[1-9]\d*)$/.test(key))||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))||Object.keys(value).length!==value.length)fail(`${label}须为最多${max}项的数组。`);
 return value;
}
function choices(value,label,allowed,max=allowed.length){array(value,label,max);if(new Set(value).size!==value.length||value.some(item=>!allowed.includes(item)))fail(`${label}包含重复或不支持的选项。`);}
export function validScenarioTime(value){
 const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/);
 if(!m)return false;const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 return y>0&&mo>=1&&mo<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]&&h<=23&&mi<=59&&s<=59&&(m[7]==='Z'||(+m[8]<=14&&+m[9]<=59&&(+m[8]!==14||+m[9]===0)))&&Number.isFinite(Date.parse(value));
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const builtin=(id,engine,layout)=>({schemaVersion:1,id,name:id,version:1,enabled:true,builtin:true,engine,layout,inputProfileId:'',ruleIds:[],analysisFields:engine==='conversation'?[...ANALYSIS_FIELDS]:[],customFields:[],report:{title:engine==='conversation'?'新品质检报告':'电商评论回复质检报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:[...REPORT_SECTIONS]},requiredCapabilities:['text-judgment'],createdAt:'2026-11-05T00:00:00+08:00',updatedAt:'2026-11-05T00:00:00+08:00'});
export const BUILTIN_SCENARIOS=freeze([builtin('新品产品咨询','conversation','turns'),builtin('电商评论回复','ecommerce','pair')]);
const isCustomId=value=>typeof value==='string'&&/^SCENE-[A-Za-z0-9][A-Za-z0-9_-]{0,57}$/.test(value)&&!RESERVED.has(value.slice(6));
export const isSceneKey=value=>BUILTIN_SCENARIOS.some(item=>item.id===value)||isCustomId(value);

/** Validate a complete custom definition and return a detached copy. */
export function validateScenarioConfig(raw){
 keys(raw,CONFIG_KEYS,'场景配置');
 if(raw.schemaVersion!==1||!isCustomId(raw.id))fail('自定义场景schemaVersion或SCENE-标识无效；内置场景只读。');
 text(raw.name,'场景名称');if(raw.name!==raw.name.trim())fail('场景名称不能以空白开头或结尾。');
 if(!Number.isSafeInteger(raw.version)||raw.version<1||typeof raw.enabled!=='boolean')fail('场景版本或启用状态无效。');
 if(raw.engine!=='conversation'||!['turns','pair'].includes(raw.layout))fail('自定义场景仅支持conversation引擎及turns/pair布局。');
 token(raw.inputProfileId,'场景映射标识',64,true);array(raw.ruleIds,'场景规则',100);
 if(new Set(raw.ruleIds).size!==raw.ruleIds.length)fail('场景规则标识重复。');for(const id of raw.ruleIds)token(id,'场景规则标识');
 choices(raw.analysisFields,'场景分析字段',ANALYSIS_FIELDS);
 array(raw.customFields,'自定义分析字段',20);const ids=new Set(),labels=new Set();
 for(const field of raw.customFields){
  keys(field,FIELD_KEYS,'自定义分析字段');token(field.id,'自定义字段标识');
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(field.id)||ANALYSIS_FIELDS.includes(field.id)||ids.has(field.id))fail('自定义字段标识无效、与内置字段冲突或重复。');ids.add(field.id);
  text(field.label,'自定义字段名称');if(labels.has(field.label.trim()))fail('自定义字段名称重复。');labels.add(field.label.trim());
  text(field.instruction,'自定义字段提取说明',4000,false,true);if(!['text','enum','quote'].includes(field.type))fail('自定义字段类型仅支持text/enum/quote。');
  array(field.options,'自定义字段选项',50);for(const option of field.options)text(option,'自定义字段选项');
  if(field.type==='enum'?(field.options.length<2||new Set(field.options.map(value=>value.trim())).size!==field.options.length):field.options.length!==0)fail('枚举字段须有至少两个无重复选项，文本及原声字段选项须为空。');
 }
 keys(raw.report,REPORT_KEYS,'场景报告');text(raw.report.title,'场景报告标题',200);text(raw.report.groupLabel,'场景报告分组名称');
 if(!['product','agent','context'].includes(raw.report.groupBy))fail('报告分组仅支持product/agent/context。');
 token(raw.report.groupField,'报告分组字段',64,raw.report.groupBy!=='context');if(raw.report.groupBy!=='context'&&raw.report.groupField!=='')fail('产品或客服分组不应设置扩展分组字段。');
 choices(raw.report.sections,'报告模块',REPORT_SECTIONS);if(!raw.report.sections.includes('overview'))fail('场景报告必须包含overview总览模块。');
 choices(raw.requiredCapabilities,'场景必需能力',REQUIRED_CAPABILITIES);if(!raw.requiredCapabilities.includes('text-judgment'))fail('通用场景须显式声明text-judgment能力。');
 if(!validScenarioTime(raw.createdAt)||!validScenarioTime(raw.updatedAt)||Date.parse(raw.updatedAt)<Date.parse(raw.createdAt))fail('场景创建及更新时间须为真实且包含时区的ISO时间。');
 return clone(raw);
}

/** Human-readable missing execution abilities; a declaration never creates an executor. */
export function checkScenarioCapabilities(config,rules=[]){
 const errors=[];if(!config||config.engine!=='conversation')return errors;
 if(!Array.isArray(config.requiredCapabilities)||!config.requiredCapabilities.includes('text-judgment'))errors.push('通用场景须显式声明text-judgment能力。');
 for(const capability of config.requiredCapabilities||[])if(capability!=='text-judgment')errors.push(`当前通用会话引擎不支持能力：${capability}。`);
 const selected=[...(config.ruleIds||[]),...(Array.isArray(rules)?rules:[]).map(rule=>typeof rule==='string'?rule:rule?.id)];
 if(selected.some(id=>typeof id==='string'&&id.startsWith('EC-')))errors.push('电商EC-专用规则只能使用专用Sheet4执行器，不能绑定通用场景。');
 for(const rule of Array.isArray(rules)?rules:[])for(const capability of rule?.requiredCapabilities||[])if(capability!=='text-judgment')errors.push(`规则${rule.id||''}需要当前引擎不支持的能力：${capability}。`);
 return [...new Set(errors)];
}

/** Registry validation is shared by pure edits and the authoritative server. */
export function validateScenarioRegistry(state){
 if(state?.scenarios===undefined)return [];
 array(state.scenarios,'自定义场景',100);const definitions=state.scenarios.map(validateScenarioConfig),ids=new Set(),names=new Set(BUILTIN_SCENARIOS.map(item=>item.name));
 for(const config of definitions){
  if(ids.has(config.id)||names.has(config.name))fail('场景标识或名称重复。');ids.add(config.id);names.add(config.name);
  if(config.enabled){const errors=checkScenarioCapabilities(config);if(errors.length)fail(errors.join(' '));}
  if(config.inputProfileId){const profile=Array.isArray(state.inputProfiles)&&state.inputProfiles.find(profile=>profile.id===config.inputProfileId);if(!profile)fail(`场景引用的导入配置不存在：${config.inputProfileId}。`);validateScenarioMapping(config,profile);}
 }
 return definitions;
}
export function validateScenarioMapping(config,profile){
 if(!profile||profile.scene!==config.id||profile.layout!==config.layout)fail('场景的导入映射与场景或布局不一致。');
 if(config.report.groupBy==='context'&&!profile.extras?.some(extra=>extra.key===config.report.groupField))fail(`报告分组须明确引用映射中的扩展字段：${config.report.groupField}。`);
 return true;
}
export function listScenarios(state,{includeDisabled=false}={}){return [...BUILTIN_SCENARIOS,...validateScenarioRegistry(state)].filter(config=>includeDisabled||config.enabled).map(clone);}
export function findScenario(state,id,{includeDisabled=true}={}){return listScenarios(state,{includeDisabled}).find(config=>config.id===id)||null;}
export function scenarioForTask(task){
 if(!task||typeof task!=='object')return null;
 if(task.scenarioSnapshot!==undefined){
  const snapshot=task.scenarioSnapshot;if(snapshot?.id!==task.scene)return null;
  const known=BUILTIN_SCENARIOS.find(config=>config.id===snapshot.id);
  if(known)return sameScenarioConfig(snapshot,known)?clone(known):null;
  try{return validateScenarioConfig(snapshot);}catch{return null;}
 }
 const builtin=BUILTIN_SCENARIOS.find(config=>config.id===task.scene);return builtin?clone(builtin):null;
}
export function sceneLabel(state,subject){
 if(typeof subject==='string')return findScenario(state,subject)?.name||subject;
 if(!subject||typeof subject!=='object')return '';
 const task=subject.taskId?state?.tasks?.find(task=>task.id===subject.taskId):subject;
 return scenarioForTask(task)?.name||findScenario(state,subject.scene)?.name||subject.scene||'';
}
export function saveScenarioConfig(state,input,{expectedVersion,now=new Date().toISOString()}={}){
 keys(input,CONFIG_KEYS,'场景配置');if(!isCustomId(input.id))fail('内置场景只读，自定义场景标识须以SCENE-开头。');
 if(!validScenarioTime(now))fail('场景更新时间无效。');const definitions=validateScenarioRegistry(state),old=definitions.find(config=>config.id===input.id);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion!==(old?.version||0))fail('场景版本冲突，请刷新当前配置后重试。');
 if(input.version!==(old?.version||1))fail('场景输入版本与当前版本不一致。');
 if(old&&Date.parse(now)<Date.parse(old.updatedAt))fail('场景更新时间不能回退。');
 const saved=validateScenarioConfig({...input,version:(old?.version||0)+1,createdAt:old?.createdAt||now,updatedAt:now});
 const next=clone(state);next.scenarios=old?definitions.map(config=>config.id===saved.id?saved:config):[...definitions,saved];validateScenarioRegistry(next);return next;
}
export function freezeScenario(state,id){
 const config=findScenario(state,id);if(!config)fail(`场景未注册：${id}。`);if(!config.enabled)fail('场景已停用，不能创建新任务。');
 const errors=checkScenarioCapabilities(config);if(errors.length)fail(errors.join(' '));return freeze(clone(config));
}
function canonical(value){return Array.isArray(value)?value.map(canonical):plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}
export const sameScenarioConfig=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
