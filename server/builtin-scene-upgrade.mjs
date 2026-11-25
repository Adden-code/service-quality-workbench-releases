import {createHash} from 'node:crypto';
import {validateSceneSeed} from './scene-seed.mjs';
import {createDraft,publishVersion,retireVersion,nextVersion} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {validateSceneRegistry,validateScenePackage,latestSceneConfiguration,sceneEntity,sameSceneValue,SceneConfigurationError} from '../public/scene-configuration.mjs';
import {isFixed24EcommerceBasis,upgradeEcommerceTimingBasis,EC_FIXED24_TIMING_POLICY_VERSION} from '../public/ecommerce-timing-policy.mjs';
import {upgradeEcommerceSemanticBasis,upgradeEcommerceTargetBasis,hasSpecificResponsePolicy,upgradeEcommerceTargetCalibrationBasis,hasTargetCalibrationPolicy,upgradeEcommerceTargetLimitedBasis,hasTargetLimitedPolicy} from '../public/ecommerce-semantic-policy.mjs';
import {validateBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
const clone=x=>structuredClone(x),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const EC_SCENE='电商评论回复',EC_POLICY='ec-human-aligned-v1';
const ecSemanticIds=['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];

/** Explicitly append the bundled EC policy revisions, preserving unrelated local settings. */
export function installEcommercePolicyUpgrade(document,{catalogSeed,sceneSeed,actor,reason,operationId,expectedVersion,now=new Date().toISOString()}){
 if(typeof actor!=='string'||!actor.trim()||actor.length>80||typeof reason!=='string'||!reason.trim()||reason.length>2000||typeof operationId!=='string'||!operationId.trim()||operationId.length>200)throw new SceneConfigurationError('请填写维护人和电商政策更新原因，并提供有效操作标识。');
 validateSceneSeed(sceneSeed,catalogSeed);
 const bundled=sceneSeed.packages.find(p=>p.configuration.sceneId===EC_SCENE)?.configuration.basis;
 if(bundled?.executionProfile!=='ec-business-v1'||!sameSceneValue(bundled.businessProfile?.semanticPolicy,{version:EC_POLICY,text:{minimumSignificantErrors:1}}))throw new SceneConfigurationError('本安装包未包含已确认的电商语义政策，请使用包含 ec-human-aligned-v1 的新版完整安装包。',undefined,409);
 validateBusinessEcommerceBasis(bundled);
 const targetLimitedUpgrade=hasTargetLimitedPolicy(bundled),targetCalibrationUpgrade=hasTargetCalibrationPolicy(bundled),targetUpgrade=hasSpecificResponsePolicy(bundled)||targetCalibrationUpgrade;
 const targetUpgrader=targetLimitedUpgrade?upgradeEcommerceTargetLimitedBasis:targetCalibrationUpgrade?upgradeEcommerceTargetCalibrationBasis:upgradeEcommerceTargetBasis;
 const bundledBase=clone(bundled);delete bundledBase.businessProfile.semanticPolicy;delete bundledBase.businessProfile.targetPolicyVersion;let verified=upgradeEcommerceSemanticBasis(bundledBase);if(targetUpgrade)verified=targetUpgrader(verified);
 if(ecSemanticIds.some(id=>{const supplied=bundled.rules.find(r=>r.id===id),expected=verified.rules.find(r=>r.id===id);return ['summary','passCriteria','failCriteria','exceptionCriteria'].some(key=>supplied[key]!==expected[key]);}))throw new SceneConfigurationError('安装包电商政策标识与四项规则正文不一致，未更新；请使用经过验证的新版完整安装包。',undefined,409);
 if(targetCalibrationUpgrade){const section=b=>b.policies.find(p=>p.id==='EC-BUSINESS-POLICY')?.sections.find(s=>s.id==='EC-TARGET-BUSINESS-1')?.text;if(section(bundled)!==section(verified))throw new SceneConfigurationError('安装包针对性规则与政策章节正文不一致，未更新。',undefined,409);}
 const timingUpgrade=isFixed24EcommerceBasis(bundled);
 if(timingUpgrade){const base=clone(bundled);delete base.businessProfile.timing.policyVersion;const expected=upgradeEcommerceTimingBasis(base).rules.find(r=>r.id==='EC-TIME'),supplied=bundled.rules.find(r=>r.id==='EC-TIME');if(['summary','passCriteria','failCriteria','exceptionCriteria'].some(key=>supplied[key]!==expected[key]))throw new SceneConfigurationError('安装包电商固定时效标识与规则正文不一致，未更新。',undefined,409);}
 const state=document.state,current=latestSceneConfiguration(state,EC_SCENE);
 if(state?.sceneConfigurationMigration!==1)throw new SceneConfigurationError('请先迁移场景配置。',undefined,409);
 if(!current||current.engine!=='ecommerce'||current.executionMode!=='configured'||current.basis?.executionProfile!=='ec-business-v1')throw new SceneConfigurationError('当前电商场景尚未使用完整业务配置，不能仅更新四项语义政策。',undefined,409);
 if(current.basis.businessProfile?.semanticPolicy?.version===EC_POLICY&&(!timingUpgrade||isFixed24EcommerceBasis(current.basis))&&(!targetUpgrade||hasTargetLimitedPolicy(current.basis)||!targetLimitedUpgrade&&(hasTargetCalibrationPolicy(current.basis)||!targetCalibrationUpgrade&&hasSpecificResponsePolicy(current.basis))))throw new SceneConfigurationError('当前电商语义政策已装载；已发布的单处/两处错误门槛将保留。调整门槛请新建场景配置草稿后发布。',undefined,409);
 if(expectedVersion!==undefined&&current.version!==expectedVersion)throw new SceneConfigurationError('电商配置在确认期间已变化，请刷新并核对当前版本后重试。',undefined,409);
 if(state.sceneConfigurationEvents.some(e=>e.operationId===operationId))throw new SceneConfigurationError('操作标识已使用，请刷新后重试。',undefined,409);
 validateBusinessEcommerceBasis(current.basis);
 const next=clone(document),s=next.state,c=clone(current),template=clone(sceneEntity(s,'deliveryTemplates',current.templateRef)),originalExceptions=current.exceptionRefs.map(r=>clone(sceneEntity(s,'ruleExceptionTables',r)));
 if(!template||originalExceptions.some(e=>!e))throw new SceneConfigurationError('当前电商配置的模板或例外表缺失，未更新。',undefined,409);
 c.basis=upgradeEcommerceSemanticBasis(current.basis);
 if(targetUpgrade)c.basis=targetUpgrader(c.basis);
 if(timingUpgrade){c.basis=upgradeEcommerceTimingBasis(c.basis);c.ruleDependencies['EC-TIME']=[];delete c.timingRuleMetrics?.['EC-TIME'];c.timingPolicy.allowBatchOverride=false;}
 c.basis.capturedAt=now;c.basis.effectiveDate=now.slice(0,10);
 for(const collection of ['rules','policies'])for(const record of c.basis[collection])if(!sameSceneValue(record,current.basis[collection].find(r=>r.id===record.id))){record.effectiveAt=now.slice(0,10);record.createdAt=now;record.publishedAt=now;record.owner=actor.trim();record.changeNote=`${record.changeNote||''} 发布原因：${reason.trim()}`;}
 c.ruleBindings=c.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));
 c.version=Math.max(...s.sceneConfigurations.filter(v=>v.sceneId===EC_SCENE).map(v=>v.version))+1;
 c.actor=actor.trim();c.reason=reason.trim();c.createdAt=now;c.publishedAt=now;delete c.contentHash;
 template.version=Math.max(...s.deliveryTemplates.filter(v=>v.id===template.id).map(v=>v.version))+1;
 for(const column of template.columns){const binding=c.ruleBindings.find(r=>r.ruleId===column.ruleId);if(binding)column.ruleVersion=binding.ruleVersion;}
 c.templateRef={id:template.id,version:template.version};
 const exceptions=originalExceptions.map(original=>{const binding=c.ruleBindings.find(r=>r.ruleId===original.ruleId);if(original.ruleVersion===binding.ruleVersion)return original;const value={...clone(original),version:Math.max(...s.ruleExceptionTables.filter(v=>v.id===original.id).map(v=>v.version))+1,ruleVersion:binding.ruleVersion};s.ruleExceptionTables.push(value);return value;});
 c.exceptionRefs=exceptions.map(e=>({id:e.id,version:e.version}));c.contentHash=hash(c);
 const after={configuration:c,template,taxonomy:c.taxonomyRef?clone(sceneEntity(s,'classificationTaxonomies',c.taxonomyRef)):null,exceptions,ruleCandidates:[],policyCandidates:[],unmapped:[]};
 validateScenePackage(after,{publish:true});s.sceneConfigurations.push(c);s.deliveryTemplates.push(template);
 const changedIds=c.basis.rules.filter(r=>!sameSceneValue(r,current.basis.rules.find(old=>old.id===r.id))).map(r=>r.id);
 const diff=[{path:'configuration.basis.businessProfile.semanticPolicy',before:current.basis.businessProfile.semanticPolicy??null,after:clone(c.basis.businessProfile.semanticPolicy)},...changedIds.map(id=>({path:`configuration.basis.rules.${id}`,before:clone(current.basis.rules.find(r=>r.id===id)),after:clone(c.basis.rules.find(r=>r.id===id))})),{path:'configuration.basis.policies',before:clone(current.basis.policies),after:clone(c.basis.policies)},{path:'configuration.ruleBindings',before:clone(current.ruleBindings),after:clone(c.ruleBindings)},{path:'template',before:clone(sceneEntity(s,'deliveryTemplates',current.templateRef)),after:clone(template)}];
 if(timingUpgrade){for(const key of ['basis.businessProfile.timing','ruleDependencies','timingPolicy']){const pick=(value)=>key.split('.').reduce((v,k)=>v?.[k],value);if(!sameSceneValue(pick(current),pick(c)))diff.push({path:`configuration.${key}`,before:clone(pick(current)),after:clone(pick(c))});}}
 if(targetUpgrade)diff.push({path:'configuration.basis.businessProfile.targetPolicyVersion',before:current.basis.businessProfile.targetPolicyVersion??null,after:c.basis.businessProfile.targetPolicyVersion});
 if(targetCalibrationUpgrade&&!sameSceneValue(current.basis.businessProfile.similarity,c.basis.businessProfile.similarity))diff.push({path:'configuration.basis.businessProfile.similarity',before:clone(current.basis.businessProfile.similarity),after:clone(c.basis.businessProfile.similarity)});
 if(!sameSceneValue(originalExceptions,exceptions))diff.push({path:'exceptions',before:originalExceptions,after:clone(exceptions)});
 s.sceneConfigurationEvents.push({id:`ec-policy-upgrade-${operationId}`,operationId,requestHash:hash({policy:EC_POLICY,...(timingUpgrade?{timingPolicy:EC_FIXED24_TIMING_POLICY_VERSION}:{}),actor,reason,expectedVersion}),sceneId:EC_SCENE,action:'ec-policy-upgrade',policyVersion:EC_POLICY,...(timingUpgrade?{timingPolicyVersion:EC_FIXED24_TIMING_POLICY_VERSION}:{}),seedHash:hash(sceneSeed),actor:actor.trim(),reason:reason.trim(),at:now,before:{configuration:clone(current),template:clone(sceneEntity(s,'deliveryTemplates',current.templateRef)),exceptions:originalExceptions},after:clone(after),diff});
 validateSceneRegistry(s,state,{trustedScene:true});return next;
}
export function installBuiltinSceneUpgrade(document,{catalogSeed,sceneSeed,actor,reason,operationId,now=new Date().toISOString(),sceneIds,transformPackage}){
 validateSceneSeed(sceneSeed,catalogSeed);if(!actor?.trim()||!reason?.trim()||!operationId)throw new SceneConfigurationError('请填写维护人和装载原因。');
 const next=clone(document),s=next.state;if(s.sceneConfigurationMigration!==1)throw new SceneConfigurationError('请先迁移场景配置。',undefined,409);
 const replay=s.sceneConfigurationEvents.find(e=>e.operationId===`${operationId}:新品产品咨询`);if(replay){if(replay.requestHash!==hash({seedHash:hash(sceneSeed),actor,reason}))throw new SceneConfigurationError('相同操作标识的内容不一致。',undefined,409);return next;}
 const seedHash=hash(sceneSeed);if(s.sceneConfigurationEvents.some(e=>['builtin-upgrade','system-upgrade'].includes(e.action)&&e.seedHash===seedHash))throw new SceneConfigurationError('本安装包内置场景已装载，可在场景管理查看或维护。',undefined,409);
 const original={catalog:clone(next.catalog),configurations:clone(s.sceneConfigurations)},np=clone(sceneSeed.packages.find(p=>p.configuration.engine==='conversation'));
 if(!sceneIds||sceneIds.includes('新品产品咨询'))for(const kind of ['policies','rules'])for(const source of catalogSeed[kind]){
  const version=nextVersion([...(next.catalog[kind]||[]),...(kind==='rules'?(next.catalog.deletedRules||[]).map(x=>x.snapshot):[])],source.id);
  for(const old of next.catalog[kind].filter(r=>r.id===source.id&&r.status==='已发布'))next.catalog=retireVersion(next.catalog,kind,old.id,old.version,now);
  const value={...clone(source),version,effectiveAt:now.slice(0,10),expiresAt:'',owner:actor.trim(),changeNote:`安装包 ${sceneSeed.id} 内置升级；${reason.trim()}`};delete value.publishedAt;delete value.retiredAt;delete value.name;delete value.content;
  next.catalog=createDraft(next.catalog,kind,source.id,value,now);next.catalog=publishVersion(next.catalog,kind,source.id,version,{},now);
 }
 if(!sceneIds||sceneIds.includes('新品产品咨询')){np.configuration.basis=createBasisSnapshot(next.catalog,{effectiveDate:now.slice(0,10),ruleIds:np.configuration.ruleBindings.map(r=>r.ruleId),now});np.configuration.ruleBindings=np.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));}
 for(const col of np.template.columns)if(col.ruleId)col.ruleVersion=np.configuration.ruleBindings.find(r=>r.ruleId===col.ruleId).ruleVersion;
 for(const ex of np.exceptions)ex.ruleVersion=np.configuration.ruleBindings.find(r=>r.ruleId===ex.ruleId).ruleVersion;
 const packages=[np,...sceneSeed.packages.filter(p=>p.configuration.engine!=='conversation').map(clone)].filter(p=>!sceneIds||sceneIds.includes(p.configuration.sceneId)).map(p=>transformPackage?transformPackage(p,latestSceneConfiguration(s,p.configuration.sceneId),s):p);
 for(const p of packages){const c=p.configuration,previous=latestSceneConfiguration(s,c.sceneId);c.version=Math.max(0,...s.sceneConfigurations.filter(v=>v.sceneId===c.sceneId).map(v=>v.version))+1;c.status='published';c.actor=actor.trim();c.reason=reason.trim();c.createdAt=now;c.publishedAt=now;delete c.contentHash;
  for(const [key,entities] of [['deliveryTemplates',[p.template]],['classificationTaxonomies',p.taxonomy?[p.taxonomy]:[]],['ruleExceptionTables',p.exceptions]])for(const entity of entities){entity.version=Math.max(0,...s[key].filter(v=>v.id===entity.id).map(v=>v.version))+1;s[key].push(entity);}
  c.templateRef={id:p.template.id,version:p.template.version};c.taxonomyRef=p.taxonomy?{id:p.taxonomy.id,version:p.taxonomy.version}:null;c.exceptionRefs=p.exceptions.map(x=>({id:x.id,version:x.version}));c.contentHash=hash(c);s.sceneConfigurations.push(c);
  s.sceneConfigurationEvents.push({id:`builtin-upgrade-${operationId}-${c.sceneId}`,operationId:`${operationId}:${c.sceneId}`,requestHash:hash({seedHash,actor,reason}),sceneId:c.sceneId,action:'builtin-upgrade',seedHash,actor:actor.trim(),reason:reason.trim(),at:now,before:{configuration:previous,catalog:c.engine==='conversation'?original.catalog:null},after:clone(p),diff:[{path:'configuration',before:previous,after:clone(c)}]});
 }
 validateSceneRegistry(s);return next;
}
