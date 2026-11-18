import {isBusinessEcommerceBasis,validateBusinessEcommerceBasis} from '../public/ecommerce-business-profile.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {listScenarios,findScenario,saveScenarioConfig} from '../public/scenarios.mjs';
import {catalogRecordMatchesScene} from '../public/catalog-scenes.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {listExecutableEcommerceVersions,createEcommerceRuleSetBasis,authenticateEcommerceRuleSetBasis} from '../public/ecommerce-catalog.mjs';
import {createDraft,publishVersion,nextVersion} from '../public/catalog.mjs';
import {isSessionCheckRule} from '../public/rule-kind.mjs';
import {nextRuleIds} from '../public/rule-entry.mjs';
import {stable} from '../public/rule-calibration-policy.mjs';
import {SCENE_SCHEMA,SCENE_COLLECTIONS,defaultScenePackage,latestSceneConfiguration,sceneEntity,sceneRefKey,validateScenePackage,validateSceneRegistry,safeSceneJson,SceneConfigurationError,NP_CATEGORIES} from '../public/scene-configuration.mjs';

const clone=v=>structuredClone(v),hash=v=>createHash('sha256').update(stable(v)).digest('hex');
const fail=(m,status=400)=>{throw new SceneConfigurationError(m,[m],status);};
const same=(a,b)=>stable(a)===stable(b);
export function sceneDiff(before,after,path=''){
 if(same(before,after))return[];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))return[...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>sceneDiff(before[k]??null,after[k]??null,`${path}/${k.replaceAll('~','~0').replaceAll('/','~1')}`));
 return[{path:path||'/',before:clone(before??null),after:clone(after??null)}];
}
function audit(state,{actor,reason,operationId,action,sceneId,before,after,at,requestHash}){
 state.sceneConfigurationEvents.push({id:`SCE-${randomUUID()}`,operationId,requestHash,sceneId,action,actor,reason,at,before:clone(before),after:clone(after),diff:sceneDiff(before,after)});
}
function basisForScene(state,catalog,scene,now){
 const effectiveDate=now.slice(0,10);
 if(scene.engine==='ecommerce'){const versions=listExecutableEcommerceVersions(catalog,{asOf:effectiveDate});const selected=versions.at(-1);if(!selected)return{capturedAt:now,effectiveDate,rules:[],policies:[]};return selected.ruleSetId?createEcommerceRuleSetBasis(catalog,{...selected,effectiveDate,now}):createBasisSnapshot(catalog,{ruleIds:selected.ruleIds,effectiveDate,now});}
 const ruleIds=[...new Set(catalog.rules.filter(r=>r.status==='已发布'&&isSessionCheckRule(r)&&r.effectiveAt<=effectiveDate&&(!r.expiresAt||r.expiresAt>effectiveDate)&&catalogRecordMatchesScene(r,scene.id,{state,catalog,kind:'rules'})).map(r=>r.id))];
 return ruleIds.length?createBasisSnapshot(catalog,{ruleIds,effectiveDate,now}):{capturedAt:now,effectiveDate,rules:[],policies:[]};
}
export function migrateSceneConfigurations(document,{actor='本机迁移',reason='将既有场景转换为兼容配置，历史任务不变',operationId=`scene-migration-${randomUUID()}`,now=new Date().toISOString()}={}){
 if(document.state.sceneConfigurationMigration===SCENE_SCHEMA)return clone(document);
 if(SCENE_COLLECTIONS.some(k=>document.state[k]!==undefined))fail('工作区含未识别的场景实体，请保留原件后检查。');
 const next=clone(document),state=next.state;SCENE_COLLECTIONS.forEach(k=>state[k]=[]);state.sceneConfigurationMigration=SCENE_SCHEMA;
 for(const scene of listScenarios(state,{includeDisabled:true})){
  const pkg=defaultScenePackage(scene,basisForScene(state,next.catalog,scene,now));
  const c={...pkg.configuration,status:pkg.configuration.ruleBindings.length?'published':'draft',createdAt:now,publishedAt:now,actor,reason};c.contentHash=hash(c);
  state.sceneConfigurations.push(c);state.deliveryTemplates.push(pkg.template);
  audit(state,{actor,reason,operationId:`${operationId}:${scene.id}`,action:'migrate',sceneId:scene.id,before:null,after:{configuration:c,template:pkg.template},at:now,requestHash:hash({operationId,sceneId:scene.id})});
 }
 validateSceneRegistry(state);return next;
}
function packageFor(state,catalog,sceneId,now){
 const scene=findScenario(state,sceneId);if(!scene)fail('场景不存在，请先登记场景身份。');const c=latestSceneConfiguration(state,sceneId);
 const pkg=c?{configuration:clone(c),template:clone(sceneEntity(state,'deliveryTemplates',c.templateRef)),taxonomy:c.taxonomyRef?clone(sceneEntity(state,'classificationTaxonomies',c.taxonomyRef)):null,exceptions:c.exceptionRefs.map(r=>clone(sceneEntity(state,'ruleExceptionTables',r))),ruleCandidates:[],policyCandidates:[],unmapped:[]}:defaultScenePackage(scene,basisForScene(state,catalog,scene,now));
 const maximum=Math.max(0,...state.sceneConfigurations.filter(x=>x.sceneId===sceneId).map(x=>x.version));
 pkg.configuration.version=maximum+1;pkg.configuration.status='draft';pkg.template.version=Math.max(0,...state.deliveryTemplates.filter(x=>x.id===pkg.template.id).map(x=>x.version))+1;pkg.configuration.templateRef={id:pkg.template.id,version:pkg.template.version};
 for(const field of ['contentHash','createdAt','publishedAt','actor','reason'])delete pkg.configuration[field];
 return pkg;
}
export function sceneDependencyHash(catalog,pkg){const c=pkg.configuration;return hash({rules:c.ruleBindings.map(r=>catalog.rules.find(x=>x.id===r.ruleId&&x.version===r.ruleVersion)||null),policies:c.basis.policies.map(r=>catalog.policies.find(x=>x.id===r.id&&x.version===r.version)||null),ruleSet:c.basis.ruleSetSnapshot?catalog.ruleSets?.find(r=>r.ruleSetId===c.basis.ruleSetSnapshot.ruleSetId&&r.version===c.basis.ruleSetSnapshot.version):null});}
const confirmationHash=(pkg,tab)=>hash(tab==='rules'?{rules:pkg.configuration.basis,candidates:pkg.ruleCandidates,bindings:pkg.configuration.ruleBindings}:tab==='auxiliary'?{config:pkg.configuration,taxonomy:pkg.taxonomy,exceptions:pkg.exceptions}:pkg.template);
function validActor(input){if(typeof input.actor!=='string'||!input.actor.trim()||input.actor.trim().length>80||typeof input.reason!=='string'||!input.reason.trim()||input.reason.trim().length>2000)fail('请填写操作人标签与变更原因。');if(typeof input.operationId!=='string'||!input.operationId||input.operationId.length>128)fail('配置操作标识无效。');}
export function sceneConfigurationMutation(document,input,{now=new Date().toISOString(),preparation=null}={}){
 safeSceneJson(input);validActor(input);if(document.state.sceneConfigurationMigration!==SCENE_SCHEMA)fail('请先完成场景配置迁移。',409);
 const requestHash=hash(input),replay=document.state.sceneConfigurationEvents.find(e=>e.operationId===input.operationId);if(replay){if(replay.requestHash!==requestHash)fail('同一配置操作标识不可重复用于不同内容。',409);return clone(document);}
 const next=clone(document),state=next.state,actor=input.actor.trim(),reason=input.reason.trim();let draft=state.scenePackageDrafts.find(d=>d.id===input.draftId),before=clone(draft??null);
 if(input.action==='create'||input.action==='create-subject'){
  if(input.action==='create-subject'){const id=`SCENE-${randomUUID().slice(0,8).toUpperCase()}`;if(typeof input.name!=='string'||!input.name.trim())fail('请填写科目名称。');const identity={schemaVersion:1,id,name:input.name.trim(),version:1,enabled:true,engine:'conversation',layout:input.layout||'turns',inputProfileId:'',ruleIds:[],analysisFields:[],customFields:[],report:{title:`${input.name.trim()}质检报告`,groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']},requiredCapabilities:['text-judgment']};const added=saveScenarioConfig(state,identity,{expectedVersion:0,now});state.scenarios=added.scenarios;input={...input,sceneId:id};}

  if(!findScenario(state,input.sceneId))fail('场景尚未登记。');const pkg=packageFor(state,next.catalog,input.sceneId,now),active=latestSceneConfiguration(state,input.sceneId);
  if(input.action==='create-subject'){if(!Array.isArray(input.allowedRuleCategories)||!input.allowedRuleCategories.length)fail('请先登记允许的规则类别。');pkg.configuration.allowedRuleCategories=clone(input.allowedRuleCategories);pkg.configuration.executionMode='configured';}
  draft={id:`SCD-${randomUUID()}`,sceneId:input.sceneId,status:'draft',revision:1,basePublishedVersion:active?.version||0,package:pkg,confirmations:{},createdAt:now,updatedAt:now,actor,dependencyHash:sceneDependencyHash(next.catalog,pkg)};state.scenePackageDrafts.push(draft);
 }else{
  if(!draft)fail('草稿不存在。',404);if(draft.revision!==input.expectedRevision)fail('这份草稿已被另一页面修改，当前输入保留，请对照差异后合并。',409);
  if(input.action==='archive'||input.action==='restore'){
   if(draft.status==='published')fail('已发布草稿不能弃用或恢复。');draft.status=input.action==='archive'?'archived':'draft';
  }else{
   if(draft.status!=='draft')fail('只有进行中的草稿可以编辑或发布。');
   if(input.action==='apply-preparation'){
    if(!preparation)fail('AI三件套结果只能由服务端解析后登记。');
    applyPreparation(draft,state,next.catalog,preparation,{actor,now});draft.confirmations={};draft.dependencyHash=sceneDependencyHash(next.catalog,draft.package);
   }else if(input.action==='refresh-rules'){
    const c=draft.package.configuration,basis=basisForScene(state,next.catalog,findScenario(state,draft.sceneId),now),prior=draft.package.template.columns;
    c.basis=basis;c.ruleBindings=basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));
    draft.package.template.columns=[...basis.rules.map(r=>({...prior.find(x=>x.generator==='rule'&&x.ruleId===r.id)||{id:`check-${r.id}`,label:r.title,groupId:'',enum:['符合','不符合','不适用','无法判定','未执行'],visible:true,condition:null},generator:'rule',ruleId:r.id,ruleVersion:r.version})),...prior.filter(x=>x.generator!=='rule')];
    draft.confirmations={};draft.dependencyHash=sceneDependencyHash(next.catalog,draft.package);
   }else if(input.action==='save'){
    safeSceneJson(input.package);if(input.package?.configuration?.sceneId!==draft.sceneId||input.package.configuration.version!==draft.package.configuration.version)fail('草稿不能更换场景或目标版本。');
    const old=draft.package;if(draft.preparation){if(!same(input.package.configuration.sourceRefs,old.configuration.sourceRefs)||!same(input.package.policyCandidates,old.policyCandidates))fail('AI原始来源归档和原文不可改写；需要换来源请重新起草。');for(let i=0;i<old.ruleCandidates.length;i++)if(input.package.ruleCandidates[i]&&!same(input.package.ruleCandidates[i].provenance,old.ruleCandidates[i].provenance))fail('AI来源引文与模型元信息不可改写。');}draft.package=clone(input.package);for(const tab of ['rules','auxiliary','delivery'])if(confirmationHash(old,tab)!==confirmationHash(draft.package,tab))delete draft.confirmations[tab];
    if(confirmationHash(old,'rules')!==confirmationHash(draft.package,'rules'))draft.confirmations={};draft.dependencyHash=sceneDependencyHash(next.catalog,draft.package);
   }else if(input.action==='confirm'){
    if(!['rules','auxiliary','delivery'].includes(input.tab))fail('请选择三件套核对页。');validateScenePackage(draft.package);draft.confirmations[input.tab]=confirmationHash(draft.package,input.tab);
   }else if(input.action==='publish'){
    const active=latestSceneConfiguration(state,draft.sceneId);if((active?.version||0)!==draft.basePublishedVersion)fail('场景已发布了更新版本，本草稿基线过期，请比较后创建新草稿。',409);
    if(sceneDependencyHash(next.catalog,draft.package)!==draft.dependencyHash)fail('所引用规则或资料已变化，请重新保存核对后发布。',409);
    if(['rules','auxiliary','delivery'].some(tab=>draft.confirmations[tab]!==confirmationHash(draft.package,tab)))fail('请先逐项确认检核规则、辅助判定和交付形式三个Tab。');
    validateScenePackage(draft.package,{publish:true});const pkg=clone(draft.package),c=pkg.configuration;
    if(c.sceneId==='新品产品咨询'&&c.executionMode==='configured'){
     const counts=[1,11,2,3];if(c.ruleBindings.length!==17||NP_CATEGORIES.some((cat,i)=>c.basis.rules.filter(r=>r.category===cat).length!==counts[i]))fail('新品正式配置须核对17条规则（整体1/礼仪11/探需2/导购3），不能用占位规则补数。');
    }
    for(const candidate of pkg.policyCandidates||[]){if(candidate.version!==nextVersion(next.catalog.policies,candidate.id))fail('来源资料版本已被占用，请重新核对。',409);next.catalog=createDraft(next.catalog,'policies',candidate.id,candidate,now);next.catalog=publishVersion(next.catalog,'policies',candidate.id,candidate.version,{},now);}
    // Candidates carry program-assigned IDs and human-completed catalog records.
    for(const candidate of pkg.ruleCandidates){if(candidate.version!==nextVersion([...next.catalog.rules,...(next.catalog.deletedRules||[]).map(x=>x.snapshot)],candidate.id))fail('候选规则编号或版本已被占用，请重新分配。',409);next.catalog=createDraft(next.catalog,'rules',candidate.id,candidate,now);next.catalog=publishVersion(next.catalog,'rules',candidate.id,candidate.version,{},now);}
    if(isBusinessEcommerceBasis(c.basis))validateBusinessEcommerceBasis(c.basis);
    if(c.basis.ruleSetSnapshot)authenticateEcommerceRuleSetBasis(next.catalog,c.basis);
    for(const r of c.ruleBindings){if(c.basis.ruleSetSnapshot||isBusinessEcommerceBasis(c.basis))continue;const live=next.catalog.rules.find(x=>x.id===r.ruleId&&x.version===r.ruleVersion);if(!live||live.status!=='已发布'||!isSessionCheckRule(live))fail(`冻结规则${r.ruleId} ${r.ruleVersion}不可执行。`);const frozen=c.basis.rules.find(x=>x.id===r.ruleId);for(const key of ['title','category','passCriteria','failCriteria','exceptionCriteria','policyIds'])if(!same(frozen[key],live[key]))fail('冻结规则正文与目录不一致。');}
    c.basis.rules=c.basis.rules.map(r=>{const live=next.catalog.rules.find(x=>x.id===r.id&&x.version===r.version);return live?{...clone(live),name:live.title}:r;});
    c.basis.policies=c.basis.policies.map(p=>{const live=next.catalog.policies.find(x=>x.id===p.id&&x.version===p.version);return live?{...clone(live),content:live.sections.map(s=>`${s.id} ${s.title}\n${s.text}`).join('\n\n')}:p;});
    c.status='published';c.actor=actor;c.reason=reason;c.createdAt=now;c.publishedAt=now;c.contentHash=hash(c);
    if(state.sceneConfigurations.some(x=>sceneRefKey(x)===sceneRefKey(c)))fail('配置版本已存在。',409);state.sceneConfigurations.push(c);
    for(const [collection,entities] of [['deliveryTemplates',[pkg.template]],['classificationTaxonomies',pkg.taxonomy?[pkg.taxonomy]:[]],['ruleExceptionTables',pkg.exceptions]])for(const e of entities){const old=sceneEntity(state,collection,e);if(old&&!same(old,e))fail('修改分类/模板/例外内容必须递增版本。');if(!old)state[collection].push(e);}
    draft.status='published';draft.publishedRef={id:c.id,version:c.version};
   }else fail('不支持的场景配置操作。');
  }
  draft.revision++;draft.updatedAt=now;draft.actor=actor;draft.reason=reason;
 }
 audit(state,{actor,reason,operationId:input.operationId,action:input.action,sceneId:draft.sceneId,before,after:draft,at:now,requestHash});validateSceneRegistry(state,document.state,{trustedScene:true});return next;
}

function applyPreparation(draft,state,catalog,preparation,{actor,now}){
 const {result,document:source,model}=preparation,p=draft.package,c=p.configuration;
 if(c.engine!=='conversation')fail('电商五项使用已有执行器；三件套规则起草适用于会话检核科目。');
 const policyId=`SC-DOC-${randomUUID().slice(0,12)}`,common={version:'V1.0',effectiveAt:now.slice(0,10),expiresAt:'',owner:actor,changeNote:'三件套AI起草，待人工对照确认',sceneIds:[draft.sceneId],status:'已发布',createdAt:now,publishedAt:now};
 const sections=[];let content='';const flush=()=>{if(content){sections.push({id:`${policyId}-${sections.length+1}`,title:`来源文本块 ${sections.length+1}`,text:content});content='';}};for(const block of source.blocks){const located=`【${block.id} ${JSON.stringify(block.location)}】\n${block.text}`;for(let start=0;start<located.length;start+=14000){const part=located.slice(start,start+14000);if(content.length+part.length+2>15000)flush();content+=(content?'\n\n':'')+part;}}flush();
 if(sections.length>200)fail('规则文档文本块过多，请拆分成较小的可核对文档。');
 const policy={...common,id:policyId,title:source.source.name.slice(0,120),category:'场景规则依据',scope:draft.sceneId,source:source.source.name,sections};p.policyCandidates=[policy];
 const reserved={...catalog,rules:[...catalog.rules,...state.scenePackageDrafts.flatMap(d=>d.package.ruleCandidates||[])]},ids=nextRuleIds(reserved,draft.sceneId,result.rules.length,state);
 p.ruleCandidates=result.rules.map((r,i)=>({...common,id:ids[i],title:r.title,category:r.category||'',scope:r.scope,passCriteria:r.passCriteria,failCriteria:r.failCriteria,exceptionCriteria:r.exceptionCriteria,policyIds:[policyId],ruleKind:'session-check',provenance:{source:source.source,scene:draft.sceneId,quote:r.evidence[0].quote,locator:`${r.evidence[0].blockId} UTF16 ${r.evidence[0].start}-${r.evidence[0].end}`,preparedBy:{modelId:model.modelId,promptVersion:result.contract,at:now}}}));
 c.basis={capturedAt:now,effectiveDate:now.slice(0,10),rules:p.ruleCandidates.map(r=>({...r,name:r.title})),policies:[{...policy,content:sections.map(s=>`${s.id} ${s.title}\n${s.text}`).join('\n\n')}]};c.ruleBindings=p.ruleCandidates.map(r=>({ruleId:r.id,ruleVersion:r.version}));c.sourceRefs=[source.source];c.executionMode='configured';
 c.capabilities=result.auxiliary.map(a=>({key:a.capability,phase:a.phase,executorVersion:'scene-capability.v1',dependsOn:a.dependsOn}));c.ruleDependencies=Object.fromEntries(result.rules.map((r,i)=>[ids[i],r.dependencies]));
 c.timingPolicy.standards=[];c.timingPolicy.fallbackStandards=[];c.timingPolicy.enabled=c.capabilities.some(a=>a.key==='timing');
 const tax=result.auxiliary.find(a=>a.capability==='intent')?.taxonomy;
 p.taxonomy=tax?{schemaVersion:1,id:`TAX-${draft.sceneId}`,sceneId:draft.sceneId,version:Math.max(0,...state.classificationTaxonomies.filter(t=>t.sceneId===draft.sceneId).map(t=>t.version))+1,...clone(tax)}:null;c.taxonomyRef=p.taxonomy?{id:p.taxonomy.id,version:p.taxonomy.version}:null;
 p.exceptions=result.rules.flatMap((r,i)=>r.exceptionTable?.length?[{id:`EX-${ids[i]}`,version:1,sceneId:draft.sceneId,ruleId:ids[i],ruleVersion:p.ruleCandidates[i].version,entries:r.exceptionTable.map(x=>({id:x.id,condition:x.condition,requires:x.requires,result:'不适用',priority:x.priority,source:x.evidence.map(e=>`${e.blockId}:${e.start}-${e.end} ${e.quote}`).join('\n')}))}]:[]);c.exceptionRefs=p.exceptions.map(x=>({id:x.id,version:x.version}));
 const mapping=new Map(result.rules.map((r,i)=>[r.candidateIndex,p.ruleCandidates[i]]));
 p.template.renderMode='configured';if(result.delivery){const d=result.delivery;p.template.title=d.title;p.template.groupBy=d.groupBy;p.template.sections=d.sections.map(({key,title})=>({key,title}));p.template.columnGroups=d.groups.map(g=>({id:g.key,label:g.label,parentId:g.parentKey}));p.template.columns=d.columns.map((col,i)=>({id:`column-${i+1}`,label:col.label,generator:col.generator,...(col.generator==='rule'?{ruleId:mapping.get(col.candidateIndex).id,ruleVersion:mapping.get(col.candidateIndex).version}:{field:col.field}),groupId:col.groupKey,condition:col.condition,enum:col.generator==='rule'?['符合','不符合','不适用','无法判定','未执行']:(col.enum||[]),visible:true}));}
 else p.template.columns=c.basis.rules.map(r=>({id:`check-${r.id}`,label:r.title,generator:'rule',ruleId:r.id,ruleVersion:r.version,groupId:'',condition:null,enum:['符合','不符合','不适用','无法判定','未执行'],visible:true}));
 p.unmapped=[...result.rejected.map(r=>({kind:r.kind,reason:r.reason})),...result.unmappedBlocks,...result.warnings.map(reason=>({kind:'warning',reason})),...(!result.delivery?[{kind:'delivery',reason:'交付形式未识别，请人工维护并说明处理。'}]:[])];
 draft.preparation={source:clone(source),model:clone(model),result:clone(result),at:now};draft.imported=true;
}
