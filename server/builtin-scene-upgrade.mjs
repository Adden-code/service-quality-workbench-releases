import {createHash} from 'node:crypto';
import {validateSceneSeed} from './scene-seed.mjs';
import {createDraft,publishVersion,retireVersion,nextVersion} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {validateSceneRegistry,latestSceneConfiguration,SceneConfigurationError} from '../public/scene-configuration.mjs';
const clone=x=>structuredClone(x),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function installBuiltinSceneUpgrade(document,{catalogSeed,sceneSeed,actor,reason,operationId,now=new Date().toISOString()}){
 validateSceneSeed(sceneSeed,catalogSeed);if(!actor?.trim()||!reason?.trim()||!operationId)throw new SceneConfigurationError('请填写维护人和装载原因。');
 const next=clone(document),s=next.state;if(s.sceneConfigurationMigration!==1)throw new SceneConfigurationError('请先迁移场景配置。',undefined,409);
 const replay=s.sceneConfigurationEvents.find(e=>e.operationId===`${operationId}:新品产品咨询`);if(replay){if(replay.requestHash!==hash({seedHash:hash(sceneSeed),actor,reason}))throw new SceneConfigurationError('相同操作标识的内容不一致。',undefined,409);return next;}
 const seedHash=hash(sceneSeed);if(s.sceneConfigurationEvents.some(e=>e.action==='builtin-upgrade'&&e.seedHash===seedHash))throw new SceneConfigurationError('本安装包内置场景已装载，可在场景管理查看或维护。',undefined,409);
 const original={catalog:clone(next.catalog),configurations:clone(s.sceneConfigurations)},np=clone(sceneSeed.packages.find(p=>p.configuration.engine==='conversation'));
 for(const kind of ['policies','rules'])for(const source of catalogSeed[kind]){
  const version=nextVersion([...(next.catalog[kind]||[]),...(kind==='rules'?(next.catalog.deletedRules||[]).map(x=>x.snapshot):[])],source.id);
  for(const old of next.catalog[kind].filter(r=>r.id===source.id&&r.status==='已发布'))next.catalog=retireVersion(next.catalog,kind,old.id,old.version,now);
  const value={...clone(source),version,effectiveAt:now.slice(0,10),expiresAt:'',owner:actor.trim(),changeNote:`安装包 ${sceneSeed.id} 内置升级；${reason.trim()}`};delete value.publishedAt;delete value.retiredAt;delete value.name;delete value.content;
  next.catalog=createDraft(next.catalog,kind,source.id,value,now);next.catalog=publishVersion(next.catalog,kind,source.id,version,{},now);
 }
 np.configuration.basis=createBasisSnapshot(next.catalog,{effectiveDate:now.slice(0,10),ruleIds:np.configuration.ruleBindings.map(r=>r.ruleId),now});np.configuration.ruleBindings=np.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));
 for(const col of np.template.columns)if(col.ruleId)col.ruleVersion=np.configuration.ruleBindings.find(r=>r.ruleId===col.ruleId).ruleVersion;
 for(const ex of np.exceptions)ex.ruleVersion=np.configuration.ruleBindings.find(r=>r.ruleId===ex.ruleId).ruleVersion;
 const packages=[np,...sceneSeed.packages.filter(p=>p.configuration.engine!=='conversation').map(clone)];
 for(const p of packages){const c=p.configuration,previous=latestSceneConfiguration(s,c.sceneId);c.version=Math.max(0,...s.sceneConfigurations.filter(v=>v.sceneId===c.sceneId).map(v=>v.version))+1;c.status='published';c.actor=actor.trim();c.reason=reason.trim();c.createdAt=now;c.publishedAt=now;delete c.contentHash;
  for(const [key,entities] of [['deliveryTemplates',[p.template]],['classificationTaxonomies',p.taxonomy?[p.taxonomy]:[]],['ruleExceptionTables',p.exceptions]])for(const entity of entities){entity.version=Math.max(0,...s[key].filter(v=>v.id===entity.id).map(v=>v.version))+1;s[key].push(entity);}
  c.templateRef={id:p.template.id,version:p.template.version};c.taxonomyRef=p.taxonomy?{id:p.taxonomy.id,version:p.taxonomy.version}:null;c.exceptionRefs=p.exceptions.map(x=>({id:x.id,version:x.version}));c.contentHash=hash(c);s.sceneConfigurations.push(c);
  s.sceneConfigurationEvents.push({id:`builtin-upgrade-${operationId}-${c.sceneId}`,operationId:`${operationId}:${c.sceneId}`,requestHash:hash({seedHash,actor,reason}),sceneId:c.sceneId,action:'builtin-upgrade',seedHash,actor:actor.trim(),reason:reason.trim(),at:now,before:{configuration:previous,catalog:c.engine==='conversation'?original.catalog:null},after:clone(p),diff:[{path:'configuration',before:previous,after:clone(c)}]});
 }
 validateSceneRegistry(s);return next;
}
