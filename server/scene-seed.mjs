import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SCENE_COLLECTIONS,SCENE_SCHEMA,safeSceneJson,validateScenePackage,validateSceneRegistry,sameSceneValue} from '../public/scene-configuration.mjs';
import {authenticateEcommerceRuleSetBasis,validateEcommerceBasis} from '../public/ecommerce-catalog.mjs';
import {stable} from '../public/rule-calibration-policy.mjs';

const fail=message=>{throw new Error(`场景种子：${message}`);};
const digest=value=>createHash('sha256').update(stable(value)).digest('hex');
const scenes=['新品产品咨询','电商评论回复'];

export function sceneSeedSources(seed){
 const sources=seed.sources??[];if(!Array.isArray(sources)||sources.length>30)fail('来源归档列表无效。');
 const seen=new Set();return sources.map(s=>{if(!s||Object.keys(s).some(k=>!['name','sha256','size','bytesBase64'].includes(k))||typeof s.name!=='string'||!s.name.trim()||s.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(s.name)||!Number.isSafeInteger(s.size)||s.size<1||s.size>8*1024*1024||typeof s.bytesBase64!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||seen.has(s.sha256))fail('来源归档元数据无效。');const bytes=Buffer.from(s.bytesBase64,'base64');if(bytes.toString('base64')!==s.bytesBase64||bytes.length!==s.size||createHash('sha256').update(bytes).digest('hex')!==s.sha256)fail('来源归档字节与摘要不一致。');seen.add(s.sha256);return{name:s.name,size:s.size,sha256:s.sha256,bytes};});
}

/** Only reviewed configuration entities, never a saved user workspace. */
export function validateSceneSeed(input,catalog){
 safeSceneJson(input,'场景种子');
 const forbidden=new Set(['apiKey','apiKeyCiphertext','credentials','secrets','password','accessToken','refreshToken','sessions','tasks','mutations','provenance']);
 const inspect=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(forbidden.has(key))fail('不得包含任务、会话、凭据或外置原文件依赖。');inspect(item);}};inspect(input);
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['schemaVersion','id','packages','sources'].includes(k))||input.schemaVersion!==1||typeof input.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.id))fail('格式或版本无效。');
 const sources=sceneSeedSources(input);
 if(!catalog||!Array.isArray(input.packages)||input.packages.length!==2||new Set(input.packages.map(p=>p.configuration?.sceneId)).size!==2)fail('须同时提供两个内置场景及目录种子。');
 for(const pkg of input.packages){
  validateScenePackage(pkg,{publish:true});
  const c=pkg.configuration;
  for(const ref of c.sourceRefs)if(!sources.some(s=>s.sha256===ref.sha256&&s.name===ref.name&&s.size===ref.size))fail('来源引用须有逐字匹配的随包原件，不能仅有摘要。');
  if(c.engine!==(c.sceneId===scenes[0]?'conversation':'ecommerce'))fail('内置场景与执行引擎不匹配。');
  if(!scenes.includes(c.sceneId)||c.status!=='published'||c.executionMode!=='configured'||pkg.template.renderMode!=='configured')fail('必须是两个已发布的完整配置化场景，不能用兼容占位模板代替。');
  if(pkg.ruleCandidates.length||pkg.policyCandidates.length||pkg.unmapped.length)fail('未确认候选或未处理项不能作为出厂配置。');
  if(c.engine==='ecommerce'){validateEcommerceBasis(c.basis);if(c.basis.ruleSetSnapshot)authenticateEcommerceRuleSetBasis(catalog,c.basis);}
  else for(const frozen of c.basis.rules){
   const live=catalog.rules.find(r=>r.id===frozen.id&&r.version===frozen.version);
   if(!live||live.status!=='已发布'||!Object.entries(live).every(([k,v])=>sameSceneValue(frozen[k],v)))fail(`冻结规则 ${frozen.id}@${frozen.version} 与目录种子不一致。`);
  }
  for(const frozen of c.basis.policies){
   // Engine-owned bases authenticate their own embedded standards above.
   if(c.engine==='ecommerce')continue;
   const live=catalog.policies.find(p=>p.id===frozen.id&&p.version===frozen.version);
   if(!live||!Object.entries(live).every(([k,v])=>sameSceneValue(frozen[k],v)))fail(`冻结资料 ${frozen.id}@${frozen.version} 与目录种子不一致。`);
  }
 }
 return structuredClone(input);
}

export async function loadBundledSceneSeed(resourcesDir){
 try{
  const dir=await fs.lstat(resourcesDir);if(!dir.isDirectory()||dir.isSymbolicLink())fail('资源须为普通目录。');
  const file=path.join(resourcesDir,'scene-seed.json'),stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)fail('资源须为8MB以内的普通文件。');
  return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
 }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

/** Called only before the very first atomic workspace write. Existing workspaces never enter here. */
export function installSceneSeed(state,catalog,input,{now=new Date().toISOString()}={}){
 if(state.tasks.length||state.sessions.length||SCENE_COLLECTIONS.some(k=>state[k]!==undefined))fail('只能装载到全新空工作区。');
 const seed=validateSceneSeed(input,catalog),next=structuredClone(state);
 SCENE_COLLECTIONS.forEach(k=>next[k]=[]);next.sceneConfigurationMigration=SCENE_SCHEMA;
 const seedHash=digest(seed);
 for(const pkg of seed.packages){
  next.sceneConfigurations.push(pkg.configuration);next.deliveryTemplates.push(pkg.template);
  if(pkg.taxonomy)next.classificationTaxonomies.push(pkg.taxonomy);
  next.ruleExceptionTables.push(...pkg.exceptions);
  next.sceneConfigurationEvents.push({id:`builtin-${seed.id}-${pkg.configuration.sceneId}`,operationId:`builtin-${seedHash}-${pkg.configuration.sceneId}`,requestHash:seedHash,sceneId:pkg.configuration.sceneId,action:'builtin-install',actor:'安装包内置配置',reason:`首次装载 ${seed.id}；内容SHA256 ${seedHash}`,at:now,before:null,after:structuredClone(pkg),diff:[{path:'/',before:null,after:structuredClone(pkg)}]});
 }
 validateSceneRegistry(next);return next;
}
