import {isBusinessEcommerceBasis,validateBusinessEcommerceBasis} from './ecommerce-business-profile.mjs';
// Shared, deterministic scene package contracts. No network, credentials or UI.
import {isSceneKey,findScenario} from './scenarios.mjs';
import {authenticateEcommerceRuleSetBasis} from './ecommerce-catalog.mjs';
import {isSessionCheckRule} from './rule-kind.mjs';
import {stable} from './rule-calibration-policy.mjs';
import {RULE_EXECUTION_MODES} from './scene-rule-execution.mjs';

export const SCENE_SCHEMA=1;
export const SCENE_CONTRACT='scene-package-draft.v4';
export const SCENE_COLLECTIONS=['sceneConfigurations','deliveryTemplates','classificationTaxonomies','ruleExceptionTables','scenePackageDrafts','sceneConfigurationEvents'];
export const SCENE_CAPABILITIES=['site','intent','salesStage','demandSummary','negativeVoice','translation','timing','ecommerceClassification'];
export const SCENE_METRICS=['firstResponseDuration','queryWaitDuration','queryCount'];
export const NP_CATEGORIES=['整体判定','服务礼仪','探需','导购'];
export const BUSINESS_SECTIONS=['overview','distribution','dimensions','cases','improvements','voc'];
export const GENERATORS=['source','translation','classification','summary','sentiment','derived','rule','human'];
export const FIXED_AUDIT_FIELDS=['ruleId','ruleVersion','result','confidence','evidence','aiReason','humanHistory','reviewer'];
const clone=v=>structuredClone(v);
export const sameSceneValue=(a,b)=>stable(a)===stable(b);
export class SceneConfigurationError extends Error {
 constructor(message,issues=[message],status=400){super(message);this.name='SceneConfigurationError';this.status=status;this.code='SCENE_CONFIGURATION_INVALID';this.issues=issues;}
}
const fail=m=>{throw new SceneConfigurationError(m);};
export function safeSceneJson(value,label='配置',depth=0){
 if(depth>24)fail(`${label}层级超过限制。`);
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isFinite(value))fail(`${label}数值无效。`);return;}
 if(typeof value==='string'){if(value.length>100000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail(`${label}文本无效。`);return;}
 if(Array.isArray(value)){if(value.length>2000)fail(`${label}项目过多。`);value.forEach(v=>safeSceneJson(v,label,depth+1));return;}
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label}须为JSON数据。`);
 for(const k of Reflect.ownKeys(value)){if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'))fail(`${label}字段不安全。`);safeSceneJson(value[k],label,depth+1);}
}
const text=(v,label,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(`${label}不能为空，最多${max}字。`);};
const list=(v,label,max=500)=>{if(!Array.isArray(v)||v.length>max)fail(`${label}须为最多${max}项的列表。`);return v;};
const keys=(v,allowed,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail(`${label}包含不支持的字段。`);};
const unique=(values,label)=>{if(new Set(values).size!==values.length)fail(`${label}不能重复。`);};
const version=v=>{if(!Number.isSafeInteger(v)||v<1)fail('配置版本必须为正整数。');};
const ref=r=>{keys(r,['id','version'],'版本引用');text(r.id,'版本引用');version(r.version);};
export const sceneRefKey=r=>`${r.id}@${r.version}`;
export const latestSceneConfiguration=(state,sceneId)=>[...(state?.sceneConfigurations||[])].filter(c=>c.sceneId===sceneId&&c.status==='published').sort((a,b)=>b.version-a.version)[0]||null;
export function sceneEntity(state,collection,reference){return(state?.[collection]||[]).find(e=>e.id===reference?.id&&e.version===reference?.version)||null;}
export function sceneDraftExpired(d,now=Date.now()){return d.status==='draft'&&now-Date.parse(d.updatedAt)>=30*86400000;}

export function defaultRuntimeFields(){return[
 {key:'reviewMode',label:'人工审核策略',type:'enum',default:'rule-calibrated',options:['rule-calibrated','confidence'],required:true,editable:true},
 {key:'legacyConfidenceThreshold',label:'旧模式置信度门槛',type:'number',default:0.9,min:0,max:1,required:true,editable:true,when:{field:'reviewMode',equals:'confidence'}},
 {key:'outputLanguages',label:'交付语种',type:'multi-enum',default:['zh'],options:['zh','en'],required:true,editable:true},
 {key:'productDefault',label:'本批产品默认值',type:'text',default:'',required:false,editable:true},
 {key:'regionConfidenceThreshold',label:'站点识别置信度',type:'number',default:0.8,min:0,max:1,required:true,editable:false},
 {key:'translationConfidenceThreshold',label:'翻译置信度',type:'number',default:0.8,min:0,max:1,required:true,editable:false},
 {key:'defaultSite',label:'本批兜底站点',type:'text',default:'',required:false,editable:false}
];}
export function defaultTimingPolicy(){return{enabled:false,siteField:'',sites:[],standards:[],allowBatchOverride:false,missingSite:'uncertain',missingStandard:'uncertain',defaultSite:'',fallbackStandards:[],definitions:{firstResponseDuration:'first-customer-to-first-agent',queryWaitDuration:'each-query-notice-to-result',queryCount:'repeat-queries-per-issue'}};}
function defaultBusinessColumn(id,label,field,generator='derived'){return{id,label,field,generator,groupId:'',enum:[],visible:true,condition:null};}
function defaultTemplateColumns(scene,basis){const checks=basis.rules.map(r=>({id:`check-${r.id}`,label:r.title||r.name,generator:'rule',ruleId:r.id,ruleVersion:r.version,groupId:'',enum:['符合','不符合','不适用','无法判定','未执行'],visible:true,condition:null}));if(scene.engine==='ecommerce')return[defaultBusinessColumn('comment-translation','评价原文翻译','commentTranslation','translation'),defaultBusinessColumn('reply-translation','回复原文翻译','replyTranslation','translation'),...basis.rules.map(r=>defaultBusinessColumn(`ai-${r.id}`,`AI初判-${r.title}`,`ai:${r.id}`)),defaultBusinessColumn('ai-overall','AI初判整体','aiOverall'),...basis.rules.map(r=>defaultBusinessColumn(`history-${r.id}`,`原表历史人工-${r.title}`,`historical:${r.id}`,'human')),defaultBusinessColumn('historical-overall','历史人工整体','historicalOverall'),...checks,defaultBusinessColumn('overall','整体通过','overall'),defaultBusinessColumn('failure-summary','不合格原因总结','failureSummary')];return[defaultBusinessColumn('translation','会话详情翻译','translation','translation'),defaultBusinessColumn('sales-stage','销售环节','salesStage','classification'),defaultBusinessColumn('intent','用户意图','intent','classification'),defaultBusinessColumn('demand','用户诉求总结','demandSummary','summary'),defaultBusinessColumn('negative-flag','是否涉及负面声音','negativeVoiceFlag','sentiment'),defaultBusinessColumn('negative-voice','用户负面原声','negativeVoice','sentiment'),...checks,defaultBusinessColumn('overall','整体通过','overall'),defaultBusinessColumn('failure-summary','不合格原因总结','failureSummary')];}
export function defaultScenePackage(scene,basis={rules:[],policies:[]}){
 const id=`CONFIG-${scene.id}`,templateId=`TEMPLATE-${scene.id}`;
 return {configuration:{schemaVersion:SCENE_SCHEMA,id,sceneId:scene.id,version:1,status:'draft',engine:scene.engine,executionMode:'legacy',ruleBindings:basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version})),basis:clone(basis),capabilities:[],taxonomyRef:null,exceptionRefs:[],timingPolicy:defaultTimingPolicy(),runtimeFields:defaultRuntimeFields(),templateRef:{id:templateId,version:1},failurePolicy:{window:50,minimum:20,rate:0.1},ruleDependencies:{},sourceRefs:[]},
 template:{schemaVersion:SCENE_SCHEMA,id:templateId,sceneId:scene.id,version:1,engine:scene.engine,title:scene.report?.title||`${scene.name}质检报告`,sections:BUSINESS_SECTIONS.filter(key=>key!=='distribution'||scene.engine==='ecommerce').map(key=>({key,title:({overview:'质检数据概况',distribution:'评价类型分布',dimensions:'检核项通过情况',cases:'典型案例',improvements:'不合格原因与改进建议',voc:'用户评价原声'})[key]})),groupBy:scene.engine==='ecommerce'?'agent':'product',columnGroups:[],columns:defaultTemplateColumns(scene,basis),renderMode:'legacy',aggregate:'fail-then-unknown-then-pass',auditMode:'complete-appendix',legacyAdapter:scene.engine==='ecommerce'?'ecommerce-43':'consultation'},taxonomy:null,exceptions:[],ruleCandidates:[],policyCandidates:[],unmapped:[]};
}

function validateRuntimeSchema(fields){
 list(fields,'运行参数',30);unique(fields.map(f=>f.key),'运行参数标识');const allowedKeys=new Set(defaultRuntimeFields().map(f=>f.key));
 for(const f of fields){keys(f,['key','label','type','default','options','required','editable','min','max','when'],'运行参数');if(!allowedKeys.has(f.key))fail(`运行参数尚无执行器：${f.key}。`);text(f.label,'运行参数名称');if(!['text','number','enum','multi-enum','boolean'].includes(f.type)||typeof f.required!=='boolean'||typeof f.editable!=='boolean')fail('运行参数类型或开关无效。');
  if(f.type==='number'&&(!Number.isFinite(f.min)||!Number.isFinite(f.max)||f.min>f.max))fail('数值范围无效。');
  if(['enum','multi-enum'].includes(f.type)){list(f.options,'参数选项',100);f.options.forEach(o=>text(o,'参数选项'));unique(f.options,'参数选项');}
  if(f.when){keys(f.when,['field','equals'],'显示条件');if(!fields.some(p=>p.key===f.when.field))fail('显示条件引用不存在的参数。');}
 }
 for(const expected of defaultRuntimeFields()){const f=fields.find(f=>f.key===expected.key);if(!f||f.type!==expected.type)fail(`缺少或改变运行字段类型：${expected.key}。`);}
 const mode=fields.find(f=>f.key==='reviewMode');if(!sameSceneValue(mode.options,['rule-calibrated','confidence']))fail('审核模式只能二选一：规则级标定或旧置信度门槛。');
 resolveSceneRuntime({runtimeFields:fields,timingPolicy:defaultTimingPolicy()},{});
}
export function resolveSceneRuntime(config,overrides={},reason=''){
 safeSceneJson(overrides);keys(overrides,[...config.runtimeFields.map(f=>f.key),'timingStandards'],'本批参数');const values={},sources={};
 for(const f of config.runtimeFields){const supplied=Object.hasOwn(overrides,f.key),v=supplied?overrides[f.key]:f.default;if(supplied&&!f.editable&&!sameSceneValue(v,f.default))fail(`${f.label}不允许本批修改。`);values[f.key]=clone(v);sources[f.key]=supplied&&!sameSceneValue(v,f.default)?'batch':'scene';}
 for(const f of config.runtimeFields){if(f.when&&values[f.when.field]!==f.when.equals)continue;const v=values[f.key];if(f.required&&(v===''||v===null||Array.isArray(v)&&!v.length))fail(`请填写${f.label}。`);
  if(f.type==='number'&&(typeof v!=='number'||!Number.isFinite(v)||v<f.min||v>f.max))fail(`${f.label}须在${f.min}至${f.max}之间。`);
  if(f.type==='text'&&(typeof v!=='string'||v.length>500))fail(`${f.label}文本无效。`);
  if(f.type==='boolean'&&typeof v!=='boolean')fail(`${f.label}须为开关。`);
  if(f.type==='enum'&&!f.options.includes(v)||f.type==='multi-enum'&&(!Array.isArray(v)||new Set(v).size!==v.length||v.some(x=>!f.options.includes(x))))fail(`${f.label}选项无效。`);
 }
 const timingStandards=clone(overrides.timingStandards??config.basis?.businessProfile?.timing.standards??config.timingPolicy.standards);
 if(overrides.timingStandards!==undefined){if(!config.timingPolicy.allowBatchOverride)fail('场景不允许本批覆盖站点标准。');text(reason,'覆盖标准原因',2000);if(config.basis?.businessProfile)validateBusinessEcommerceBasis({...config.basis,businessProfile:{...config.basis.businessProfile,timing:{...config.basis.businessProfile.timing,standards:timingStandards}}});else validateTimingPolicy({...config.timingPolicy,standards:timingStandards});}
 if(values.defaultSite&&!(config.basis?.businessProfile?.timing.sites||config.timingPolicy.sites).some(s=>s.id===values.defaultSite))fail('本批兜底站点必须来自场景站点字典。');
 return{values,sources,timingStandards,overrideReason:overrides.timingStandards!==undefined?reason.trim():''};
}
export function validateTimingPolicy(policy){
 keys(policy,['enabled','standardsStatus','siteField','sites','standards','allowBatchOverride','missingSite','missingStandard','defaultSite','fallbackStandards','definitions'],'时效配置');
 if(policy.standardsStatus!==undefined&&!['pending','ready'].includes(policy.standardsStatus))fail('时效标准状态无效。');
 const pending=policy.standardsStatus==='pending';
 if(pending&&(policy.standards.length||policy.fallbackStandards.length||policy.missingStandard!=='uncertain'||policy.allowBatchOverride))fail('待维护时效标准必须留空，不得设置兜底值或运行时覆盖；请先在场景配置中确认标准。');
 if(typeof policy.enabled!=='boolean'||typeof policy.allowBatchOverride!=='boolean'||!['uncertain','batch-default'].includes(policy.missingSite)||!['uncertain','batch-fallback'].includes(policy.missingStandard)||typeof policy.siteField!=='string')fail('站点时效策略无效。');
 list(policy.sites,'站点',200);unique(policy.sites.map(s=>s.id),'站点');for(const s of policy.sites){keys(s,['id','label','aliases'],'站点');text(s.id,'站点标识');text(s.label,'站点名称');list(s.aliases,'站点别名',30);s.aliases.forEach(a=>text(a,'站点别名'));}
 const aliases=policy.sites.flatMap(s=>[...new Set([s.id,s.label,...s.aliases])]);unique(aliases,'站点键与别名');
 const validateRows=(rows,fallback=false)=>{list(rows,'站点标准',600);unique(rows.map(r=>`${r.siteId}:${r.metric}`),'站点指标');for(const r of rows){keys(r,['siteId','metric','value','unit','operator','source','authoring'],'站点标准');if(!fallback&&!policy.sites.some(s=>s.id===r.siteId)||fallback&&r.siteId!=='*'||!SCENE_METRICS.includes(r.metric))fail('站点或指标不存在。');if(!Number.isFinite(r.value)||r.value<0||r.value>86400*365||r.metric==='queryCount'&&!Number.isSafeInteger(r.value))fail('时效标准须为非负数，查询次数须为整数。');if(r.unit!==(r.metric==='queryCount'?'count':'seconds')||r.operator!=='>')fail('时长按秒、次数按整数，严格超过标准才触发。');text(r.source,'标准依据',4000);if(r.authoring!=='manual')fail('时效标准只能由质检人员手工维护。');}};
 validateRows(policy.standards);validateRows(policy.fallbackStandards,true);
 if(policy.defaultSite&&!policy.sites.some(s=>s.id===policy.defaultSite))fail('默认站点不存在。');
 if(!sameSceneValue(policy.definitions,defaultTimingPolicy().definitions))fail('查询等待必须逐次计时，重复查询必须按问题主题计数。');
 if(policy.enabled&&!pending){if(!policy.sites.length)fail('启用时效前请手工维护站点字典及三项标准。');for(const s of policy.sites)for(const metric of SCENE_METRICS)if(!policy.standards.some(r=>r.siteId===s.id&&r.metric===metric))fail(`站点${s.label}缺少${metric}手工标准。`);}
 if(policy.missingStandard==='batch-fallback'&&SCENE_METRICS.some(m=>!policy.fallbackStandards.some(r=>r.metric===m)))fail('批次兜底标准须手工填写全部三项指标和来源。');
}
export function validateSceneTaxonomy(t){
 keys(t,['schemaVersion','id','sceneId','version','labels','principles','examples','mappings'],'意图分类体系');version(t.version);text(t.id,'分类体系标识');
 list(t.labels,'分类',100);unique(t.labels.map(l=>l.id),'分类');
 for(const l of t.labels){keys(l,['id','label','parentId','definition'],'意图类别');text(l.id,'类别标识');text(l.label,'类别名称');text(l.definition,'类别定义',4000);if(l.parentId&&!t.labels.some(p=>p.id===l.parentId&&p.id!==l.id&&!p.parentId))fail('意图父级必须是明确的一级分类。');}
 list(t.principles,'选择原则',30);if(!t.principles.length)fail('请填写意图选择原则。');t.principles.forEach(p=>text(p,'选择原则',4000));
 list(t.examples,'双语示例',200);if(!t.examples.length)fail('请填写版本化意图示例。');for(const x of t.examples){keys(x,['labelId','original','translated','source'],'分类示例');if(!t.labels.some(l=>l.id===x.labelId&&l.parentId))fail('示例须关联二级分类。');text(x.original,'示例原文',4000);text(x.translated,'示例译文',4000);text(x.source,'示例来源',4000);}
 if(t.mappings!==undefined){list(t.mappings,'分类映射记录',200);unique(t.mappings.map(m=>m.exampleIndex),'示例映射');for(const m of t.mappings){keys(m,['exampleIndex','originalLabel','targetLabelId','source','reason','actor','confirmedAt'],'分类映射');if(!Number.isSafeInteger(m.exampleIndex)||!t.examples[m.exampleIndex]||t.examples[m.exampleIndex].labelId!==m.targetLabelId)fail('分类映射须定位存在的示例及其目标类别。');for(const key of ['originalLabel','source','reason','actor'])text(m[key],'分类映射依据',4000);if(!Number.isFinite(Date.parse(m.confirmedAt)))fail('分类映射须记录确认时间。');}}
}
export function validateSceneReferenceMaterials(materials){
 list(materials,'场景参考资料',20);unique(materials.map(m=>`${m.id}@${m.version}`),'场景参考版本');
 for(const m of materials){keys(m,['id','version','title','purpose','sourceSha256','sections'],'场景参考资料');text(m.id,'参考资料标识');version(m.version);text(m.title,'参考资料标题');if(m.purpose!=='case-commentary'||!/^[a-f0-9]{64}$/.test(m.sourceSha256))fail('场景参考资料仅用于案例点评，须保留来源摘要。');list(m.sections,'参考章节',100);if(!m.sections.length)fail('参考资料不能为空。');for(const s of m.sections){keys(s,['id','title','text'],'参考章节');text(s.id,'参考章节标识');text(s.title,'参考章节名称');text(s.text,'参考原文',20000);}}
}
export function validateSceneTemplate(t,config){
 keys(t,['schemaVersion','id','sceneId','version','engine','title','sections','groupBy','columnGroups','columns','aggregate','auditMode','legacyAdapter','renderMode','casePriorities'],'交付模板');text(t.id,'模板标识');version(t.version);text(t.title,'报告标题');
 if(t.sceneId!==config.sceneId||t.engine!==config.engine||t.schemaVersion!==SCENE_SCHEMA)fail('模板与场景引擎不兼容。');
 if(t.casePriorities!==undefined){list(t.casePriorities,'案例优先级',200);unique(t.casePriorities.map(x=>x.ruleId),'案例优先级规则');for(const x of t.casePriorities)if(!config.ruleBindings.some(r=>r.ruleId===x.ruleId)||![1,2,3].includes(x.priority))fail('案例优先级须绑定已有规则，取1至3。');}
 list(t.sections,'业务章节',10);unique(t.sections.map(s=>s.key),'章节');for(const s of t.sections){keys(s,['key','title'],'章节');if(!BUSINESS_SECTIONS.includes(s.key))fail('章节没有对应渲染器。');text(s.title,'章节标题');}if(!t.sections.some(s=>s.key==='overview'))fail('报告须保留概况章节。');
 if(!['product','agent','site','intent'].includes(t.groupBy))fail('分组维度不受支持。');
 list(t.columnGroups,'列组',50);unique(t.columnGroups.map(g=>g.id),'列组');for(const g of t.columnGroups){keys(g,['id','label','parentId'],'列组');text(g.id,'列组标识');text(g.label,'列组名称');let n=g,seen=new Set();while(n?.parentId){if(seen.has(n.id)||seen.size>=3)fail('列组循环或层级超过3层。');seen.add(n.id);n=t.columnGroups.find(p=>p.id===n.parentId);if(!n)fail('父列组不存在。');}}
 list(t.columns,'明细列',300);unique(t.columns.map(c=>c.id),'列标识');const mapped=[];
 for(const c of t.columns){keys(c,['id','label','generator','ruleId','ruleVersion','field','groupId','enum','visible','condition'],'明细列');text(c.id,'列标识');text(c.label,'列名');if(!GENERATORS.includes(c.generator)||typeof c.visible!=='boolean')fail('列生成方式或可见性无效。');if(c.groupId&&!t.columnGroups.some(g=>g.id===c.groupId))fail('列组不存在。');list(c.enum,'列取值',100);if(c.condition&&!sameSceneValue(c.condition,{field:'overall',equals:'不符合'}))fail('条件填写只支持整体不符合时填写。');
  if(c.generator==='rule'||config.aggregateRuleId&&c.generator==='derived'&&c.field==='overall'){if(!config.ruleBindings.some(r=>r.ruleId===c.ruleId&&r.ruleVersion===c.ruleVersion))fail('检核列引用的规则版本不在场景绑定中。');if(config.aggregateRuleId&&(c.generator==='rule'&&c.ruleId===config.aggregateRuleId||c.generator==='derived'&&c.ruleId!==config.aggregateRuleId))fail('整体规则只映射派生整体列，不能另设独立检核列。');mapped.push(`${c.ruleId}@${c.ruleVersion}`);for(const status of ['符合','不符合','不适用','无法判定','未执行'])if(!c.enum.includes(status))fail('检核列必须保留无法判定和未执行，不得并入NA。');}
  else if(!['product','agent','site','intent','salesStage','demandSummary','negativeVoice','negativeVoiceFlag','translation','commentTranslation','replyTranslation','aiOverall','historicalOverall','overall','failureSummary'].includes(c.field)&&!config.ruleBindings.some(r=>['ai:','historical:'].some(prefix=>c.field===prefix+r.ruleId)))fail('列字段没有对应执行器。');
 }
 unique(mapped,'规则到检核列绑定');if(mapped.length!==config.ruleBindings.length)fail(config.aggregateRuleId?'须按ID与版本映射16个检核子项列＋1个整体派生列，覆盖17条规则。':'每条规则须对应且仅对应一个检核列（按ID与版本校验）。');
 if(config.aggregateRuleId&&t.columns.filter(c=>c.field==='overall').length!==1)fail('整体派生规则必须且只能对应一个整体通过列。');
 if(config.aggregateRuleId&&t.columns.some(c=>c.ruleId===config.aggregateRuleId&&c.condition))fail('整体派生列不能仅在Fail时填写。');
 if(t.renderMode!==undefined&&!['legacy','configured'].includes(t.renderMode))fail('模板渲染模式不受支持。');
 if(t.aggregate!==(config.aggregatePolicy==='fail-only.v2'?'fail-only.v2':'fail-then-unknown-then-pass')||t.auditMode!=='complete-appendix')fail('聚合及固定审计附录不得删除或改写。');
 if(!['consultation','ecommerce-43'].includes(t.legacyAdapter))fail('兼容模板适配器无效。');
}
export function validateSceneConfiguration(c){
 keys(c,['schemaVersion','id','sceneId','version','status','engine','executionMode','aggregateRuleId','aggregatePolicy','ruleExecutionPolicies','referenceMaterials','ruleBindings','basis','capabilities','taxonomyRef','exceptionRefs','timingPolicy','runtimeFields','templateRef','failurePolicy','ruleDependencies','allowedRuleCategories','timingRuleMetrics','inspectionLanguage','sourceRefs','contentHash','createdAt','publishedAt','actor','reason'],'场景配置');
 if(c.schemaVersion!==SCENE_SCHEMA||!isSceneKey(c.sceneId)||!['conversation','ecommerce'].includes(c.engine)||!['draft','published','retired'].includes(c.status)||!['legacy','configured'].includes(c.executionMode))fail('场景配置类型或版本无效。');if(c.engine==='ecommerce'&&c.capabilities?.some(a=>a.key==='timing'))fail('电商时效由冻结的电商检核口径执行，不可叠加会话首次响应/查询时效。');text(c.id,'配置标识');version(c.version);
 list(c.ruleBindings,'冻结规则',200);unique(c.ruleBindings.map(r=>r.ruleId),'冻结规则');for(const r of c.ruleBindings){keys(r,['ruleId','ruleVersion'],'规则版本绑定');text(r.ruleId,'规则标识');text(r.ruleVersion,'规则版本');}
 if(c.aggregateRuleId!==undefined&&(c.aggregateRuleId!=='NP-R01'||c.sceneId!=='新品产品咨询'||c.engine!=='conversation'||c.executionMode!=='configured'||!c.ruleBindings.some(r=>r.ruleId===c.aggregateRuleId)||c.ruleBindings.length!==17))fail('新品整体派生须明确绑定NP-R01及完整17条规则，不能套用于旧任务或其他场景。');
 if(c.aggregatePolicy!==undefined&&(!c.aggregateRuleId||c.aggregatePolicy!=='fail-only.v2'))fail('整体派生版本无效。');
 if(c.aggregateRuleId&&(c.ruleDependencies[c.aggregateRuleId]?.length||c.timingRuleMetrics?.[c.aggregateRuleId]))fail('整体派生规则不独立请求前置能力或时效判定。');
 if(!c.basis||!Array.isArray(c.basis.rules)||!Array.isArray(c.basis.policies)||c.basis.rules.length!==c.ruleBindings.length||c.ruleBindings.some(r=>!c.basis.rules.some(x=>x.id===r.ruleId&&x.version===r.ruleVersion&&isSessionCheckRule(x))))fail('场景冻结规则内容与绑定不一致。');
 list(c.capabilities,'辅助能力',SCENE_CAPABILITIES.length);unique(c.capabilities.map(x=>x.key),'能力');
 for(const a of c.capabilities){keys(a,['key','phase','executorVersion','dependsOn'],'能力');if(!SCENE_CAPABILITIES.includes(a.key)||!['pre','post'].includes(a.phase)||a.executorVersion!=='scene-capability.v1')fail('能力、阶段或执行器版本不受支持。');list(a.dependsOn,'能力依赖',10);if(a.key==='salesStage'&&!a.dependsOn.includes('intent'))fail('销售环节必须从意图父级派生。');}
 const visit=(key,seen=new Set())=>{if(seen.has(key))fail('能力依赖不能循环。');const a=c.capabilities.find(a=>a.key===key);if(!a)fail(`缺少依赖能力：${key}。`);for(const d of a.dependsOn)visit(d,new Set([...seen,key]));};c.capabilities.forEach(a=>visit(a.key));
 for(const a of c.capabilities)if(a.phase==='pre'&&a.dependsOn.some(d=>c.capabilities.find(x=>x.key===d)?.phase!=='pre'))fail('前置能力不能依赖后置能力。');
 if(c.allowedRuleCategories!==undefined){list(c.allowedRuleCategories,'允许规则类别',30);unique(c.allowedRuleCategories,'允许规则类别');c.allowedRuleCategories.forEach(x=>text(x,'规则类别',80));if(c.sceneId==='新品产品咨询'&&!sameSceneValue(c.allowedRuleCategories,NP_CATEGORIES))fail('新品类别枚举固定为四类。');}
 if(c.inspectionLanguage!==undefined&&!['zh','en'].includes(c.inspectionLanguage))fail('检核口径语言只支持中文或英文。');
 for(const [id,metrics] of Object.entries(c.timingRuleMetrics||{})){if(!c.ruleBindings.some(r=>r.ruleId===id)||!Array.isArray(metrics)||!metrics.length||new Set(metrics).size!==metrics.length||metrics.some(m=>!SCENE_METRICS.includes(m))||!c.ruleDependencies[id]?.includes('timing'))fail('时效规则须绑定其实际依赖的指标。');}
 if(c.executionMode==='configured')for(const [id,deps] of Object.entries(c.ruleDependencies))if(deps.includes('timing')&&!c.timingRuleMetrics?.[id]?.length)fail(`请指定规则${id}检核首次响应、查询等待或查询次数中的哪些指标。`);
 for(const [ruleId,deps] of Object.entries(c.ruleDependencies)){if(!c.ruleBindings.some(r=>r.ruleId===ruleId))fail('依赖声明引用未知规则。');list(deps,'规则依赖',10);for(const d of deps)if(!c.capabilities.some(a=>a.key===d&&a.phase==='pre'))fail(`规则${ruleId}依赖${d}，必须启用为前置。`);}
 if(c.ruleExecutionPolicies!==undefined){
  keys(c.ruleExecutionPolicies,c.ruleBindings.filter(r=>r.ruleId!==c.aggregateRuleId).map(r=>r.ruleId),'规则分项执行策略');
  for(const [id,p] of Object.entries(c.ruleExecutionPolicies)){
   keys(p,['mode','reason','modelCriteria'],'规则分项执行策略');if(!RULE_EXECUTION_MODES.includes(p.mode)||c.executionMode!=='configured'||c.engine!=='conversation')fail('分项执行策略仅支持配置化会话检核。');text(p.reason,'分项执行依据',2000);
   if(p.mode==='timing-or-model'&&!c.ruleDependencies[id]?.includes('timing'))fail('时效与模型合并策略须声明时效依赖。');
   if(p.mode!=='missing-knowledge'&&!p.modelCriteria)fail('混合规则须明确模型只检核的子项口径。');
   if(p.modelCriteria){keys(p.modelCriteria,['passCriteria','failCriteria','exceptionCriteria'],'模型子项口径');for(const k of ['passCriteria','failCriteria','exceptionCriteria'])text(p.modelCriteria[k],'模型子项口径',4000);}
  }
 }
 if(c.taxonomyRef)ref(c.taxonomyRef);if(c.capabilities.some(a=>a.key==='intent')&&!c.taxonomyRef)fail('意图能力缺少版本化分类体系。');list(c.exceptionRefs,'例外表',50);c.exceptionRefs.forEach(ref);ref(c.templateRef);
 validateTimingPolicy(c.timingPolicy);if(c.timingPolicy.enabled!==c.capabilities.some(a=>a.key==='timing'))fail('时效能力开关与标准表状态不一致。');
 validateRuntimeSchema(c.runtimeFields);keys(c.failurePolicy,['window','minimum','rate'],'暂停策略');const p=c.failurePolicy;if(!Number.isSafeInteger(p.window)||p.window<20||p.window>500||!Number.isSafeInteger(p.minimum)||p.minimum<20||p.minimum>p.window||typeof p.rate!=='number'||p.rate<0||p.rate>1)fail('技术失败暂停参数无效。');
 list(c.sourceRefs,'来源引用',30);for(const s of c.sourceRefs){if(!/^[a-f0-9]{64}$/.test(s.sha256)||typeof s.name!=='string')fail('来源引用无效。');}
 if(c.referenceMaterials!==undefined)validateSceneReferenceMaterials(c.referenceMaterials);
 return c;
}
export function validateScenePackage(pkg,{publish=false}={}){
 safeSceneJson(pkg);keys(pkg,['configuration','template','taxonomy','exceptions','ruleCandidates','policyCandidates','unmapped'],'三件套');const errors=[];const check=fn=>{try{fn();}catch(e){errors.push(e.message);}};
 check(()=>validateSceneConfiguration(pkg.configuration));check(()=>validateSceneTemplate(pkg.template,pkg.configuration));
 if(pkg.taxonomy)check(()=>validateSceneTaxonomy(pkg.taxonomy));
 for(const [i,r] of (pkg.ruleCandidates||[]).entries())check(()=>{const missing=['id','title','category','scope','passCriteria','failCriteria','exceptionCriteria','owner','effectiveAt'].filter(k=>typeof r[k]!=='string'||!r[k].trim());if(missing.length)fail(`第${i+1}条候选缺项：${missing.join('、')}。`);if(pkg.configuration.sceneId==='新品产品咨询'&&!NP_CATEGORIES.includes(r.category))fail(`第${i+1}条候选类别须从新品四类选择。`);});
 check(()=>{list(pkg.exceptions,'规则例外表',50);for(const t of pkg.exceptions){keys(t,['id','version','sceneId','ruleId','ruleVersion','entries'],'例外表');version(t.version);if(!pkg.configuration.ruleBindings.some(r=>r.ruleId===t.ruleId&&r.ruleVersion===t.ruleVersion))fail('例外表未绑定具体规则版本。');list(t.entries,'例外条件',50);for(const r of t.entries){keys(r,['id','condition','requires','result','priority','source'],'例外条件');text(r.id,'例外标识');text(r.condition,'例外条件',4000);text(r.source,'例外来源',4000);if(!['不适用','继续检核'].includes(r.result)||!Number.isSafeInteger(r.priority))fail('场景表结果须为不适用或继续检核，并有明确优先级；继续检核不等于通过。');list(r.requires,'例外输入',10);for(const dep of r.requires)if(!pkg.configuration.capabilities.some(a=>a.key===dep&&a.phase==='pre')||!pkg.configuration.ruleDependencies[t.ruleId]?.includes(dep))fail('例外表输入须明确声明为该规则的前置能力。');}}});
 check(()=>{list(pkg.ruleCandidates,'检核候选',200);list(pkg.unmapped,'未处理项',200);if(publish&&pkg.unmapped.length)fail('仍有未处理/拒收项，请逐项说明处理后再整套发布。');if(publish&&!pkg.configuration.ruleBindings.length)fail('没有检核规则，不能发布可执行场景。');if(pkg.configuration.taxonomyRef&&(!pkg.taxonomy||sceneRefKey(pkg.taxonomy)!==sceneRefKey(pkg.configuration.taxonomyRef)))fail('分类引用与内容不一致。');if(pkg.configuration.exceptionRefs.some(r=>!pkg.exceptions.some(t=>sceneRefKey(t)===sceneRefKey(r))))fail('例外表引用缺失。');});
 if(errors.length)throw new SceneConfigurationError(errors.join('\n'),errors);return pkg;
}
export function validateSceneRegistry(state,previous=null,{trustedScene=false}={}){
 if(!SCENE_COLLECTIONS.some(k=>state[k]!==undefined)){if(previous?.sceneConfigurationMigration)fail('场景实体不能移除。');return;}
 for(const k of SCENE_COLLECTIONS){list(state[k],k,2000);safeSceneJson(state[k],k);}
 if(state.sceneConfigurationMigration!==SCENE_SCHEMA)fail('场景实体迁移版本无效。');
 for(const k of ['sceneConfigurations','deliveryTemplates','classificationTaxonomies','ruleExceptionTables'])unique(state[k].map(sceneRefKey),k);
 for(const c of state.sceneConfigurations){validateSceneConfiguration(c);const t=sceneEntity(state,'deliveryTemplates',c.templateRef);if(!t)fail('场景模板引用丢失。');validateSceneTemplate(t,c);if(c.taxonomyRef&&!sceneEntity(state,'classificationTaxonomies',c.taxonomyRef))fail('分类体系引用丢失。');for(const r of c.exceptionRefs)if(!sceneEntity(state,'ruleExceptionTables',r))fail('例外表引用丢失。');}
 state.classificationTaxonomies.forEach(validateSceneTaxonomy);
 unique(state.scenePackageDrafts.map(d=>d.id),'草稿');for(const d of state.scenePackageDrafts){if(!['draft','archived','published'].includes(d.status)||!Number.isSafeInteger(d.revision)||d.revision<1||!isSceneKey(d.sceneId)||d.package?.configuration?.sceneId!==d.sceneId)fail('草稿格式无效。');}
 unique(state.sceneConfigurationEvents.map(e=>e.id),'配置审计');for(const e of state.sceneConfigurationEvents){if(!e.actor||!e.reason||!Number.isFinite(Date.parse(e.at))||!Array.isArray(e.diff)||!Object.hasOwn(e,'before')||!Object.hasOwn(e,'after'))fail('配置审计缺少操作者/时间/原因/前后值/diff。');}
 if(previous&&!trustedScene){for(const k of [...SCENE_COLLECTIONS,'sceneConfigurationMigration'])if(!sameSceneValue(state[k],previous[k]))fail('场景实体及审计只能通过配置管理事务修改。');}
 for(const task of state.tasks||[]){const s=task.executionSnapshot;if(!s)continue;if(s.schemaVersion!==SCENE_SCHEMA||s.configuration?.sceneId!==task.scene||!sameSceneValue(s.basis,task.basisSnapshot))fail('任务执行快照与依据不一致。');validateSceneConfiguration(s.configuration);validateSceneTemplate(s.template,s.configuration);if(!sameSceneValue(resolveSceneRuntime(s.configuration,s.overrides,s.overrideReason),s.runtime))fail('任务实际运行参数与冻结配置不一致。');const old=previous?.tasks?.find(t=>t.id===task.id);if(old&&!sameSceneValue(old.executionSnapshot,s))fail('已创建任务的完整执行快照不可改写。');}
}
export function freezeSceneExecution(state,sceneId,{basis,overrides={},overrideReason='',expectedVersion}={}){
 const c=latestSceneConfiguration(state,sceneId);if(!c)return null;
 if(expectedVersion!==undefined&&c.version!==expectedVersion)fail('场景版本在填写期间已变化，请保留输入并重新核对。');
 if(!sameSceneValue(c.ruleBindings.map(r=>[r.ruleId,r.ruleVersion]),basis.rules.map(r=>[r.id,r.version])))fail('任务规则须精确使用已发布场景冻结的版本清单。');
 const template=sceneEntity(state,'deliveryTemplates',c.templateRef);if(!template)fail('场景模板丢失。');
 return{schemaVersion:SCENE_SCHEMA,contract:SCENE_CONTRACT,rendererVersion:'scene-renderer.v1',configuration:clone(c),template:clone(template),taxonomy:c.taxonomyRef?clone(sceneEntity(state,'classificationTaxonomies',c.taxonomyRef)):null,exceptions:c.exceptionRefs.map(r=>clone(sceneEntity(state,'ruleExceptionTables',r))),basis:clone(basis),overrides:clone(overrides),overrideReason,runtime:resolveSceneRuntime(c,overrides,overrideReason)};
}
export function sceneRuleReferences(state,rule){return[...(state?.sceneConfigurations||[]).filter(c=>c.ruleBindings.some(r=>r.ruleId===rule.id&&r.ruleVersion===rule.version)).map(c=>({id:sceneRefKey(c),name:`场景 ${c.sceneId} · V${c.version}`,kind:'scene'})),...(state?.scenePackageDrafts||[]).filter(d=>d.package?.configuration?.ruleBindings?.some(r=>r.ruleId===rule.id&&r.ruleVersion===rule.version)).map(d=>({id:d.id,name:`场景草稿 ${d.sceneId} · ${d.id}`,kind:'draft'}))];}
export function sceneBasisForTask(state,catalog,sceneId,now=new Date().toISOString()){
 const c=latestSceneConfiguration(state,sceneId);if(!c)return null;
 if(!findScenario(state,sceneId)?.enabled)fail('场景已停用。');
 if(c.basis.ruleSetSnapshot)authenticateEcommerceRuleSetBasis(catalog,c.basis);
 if(!c.basis.ruleSetSnapshot&&!isBusinessEcommerceBasis(c.basis))for(const r of c.ruleBindings){const live=catalog.rules.find(x=>x.id===r.ruleId&&x.version===r.ruleVersion);if(!live||live.status!=='已发布')fail(`场景引用${r.ruleId} ${r.ruleVersion}已停用或缺失，请管理员重新发布。`);}
 return{...clone(c.basis),capturedAt:now};
}

// Arrays are atomic: never guess how reordered rules, columns or standards align.
// Non-overlapping object edits can be replayed once against the latest revision.
export function mergeSceneDraft(base,local,remote){
 const conflicts=[];
 const merge=(b,l,r,path)=>{
  if(sameSceneValue(l,b))return clone(r);
  if(sameSceneValue(r,b)||sameSceneValue(l,r))return clone(l);
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  if(object(b)&&object(l)&&object(r)){
   const out={};for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    const value=merge(b[key],l[key],r[key],path?`${path}.${key}`:key);if(value!==undefined)out[key]=value;
   }return out;
  }
  conflicts.push(path);return clone(l);
 };
 const packageValue=merge(base,local,remote,'');return{package:packageValue,conflicts};
}
