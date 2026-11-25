import fs from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {validateSceneSeed} from './scene-seed.mjs';
import {installBuiltinSceneUpgrade} from './builtin-scene-upgrade.mjs';
import {migrateSceneConfigurations} from './scene-configuration-service.mjs';
import {latestSceneConfiguration,sceneEntity,sameSceneValue} from '../public/scene-configuration.mjs';
import {stable} from '../public/rule-calibration-policy.mjs';
import {encodeWorkspaceArchive} from './workspace-archive.mjs';

const clone=x=>structuredClone(x),digest=x=>createHash('sha256').update(x).digest('hex');
const seedHashes=seed=>[digest(stable(seed)),digest(JSON.stringify(seed))];
// Version/ownership metadata changes during publication; compare the package's
// business content with its previous bundled ancestor, not local maintenance.
const volatile=new Set(['version','ruleVersion','capturedAt','effectiveDate','effectiveAt','createdAt','publishedAt','retiredAt','actor','owner','reason','changeNote','contentHash']);
function content(value){if(Array.isArray(value))return value.map(content);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!volatile.has(key)).map(([key,v])=>[key,content(v)]));return value;}
function bundledEvent(state,sceneId){return [...(state.sceneConfigurationEvents||[])].reverse().find(e=>e.sceneId===sceneId&&['builtin-install','builtin-upgrade','system-upgrade'].includes(e.action)&&e.after?.configuration);}
function bundledAncestor(state,sceneId){return bundledEvent(state,sceneId)?.after;}
function versionTuple(value){return String(value||'').replace(/^V/i,'').split('.').map(n=>Number(n)||0);}
function newer(a,b){const x=versionTuple(a),y=versionTuple(b);return x.some((n,i)=>n!==(y[i]||0)&&x.slice(0,i).every((v,j)=>v===(y[j]||0))&&n>(y[i]||0));}
function isOlderBundle(pkg,event){
 // First-install events predate productVersion metadata. Compare their exact
 // bundled ancestor, never the administrator's independently edited versions.
 const old=event?.after?.configuration;if(!old)return false;
 const incoming=pkg.configuration,oldRules=new Map((old.basis?.rules||[]).map(r=>[r.id,r]));
 if((incoming.basis?.rules||[]).some(r=>oldRules.has(r.id)&&newer(oldRules.get(r.id).version,r.version)))return true;
 const rank={'ec-specific-response-v1':1,'ec-target-calibration-v2':2,'ec-target-calibration-v3':3};
 if((rank[old.basis?.businessProfile?.targetPolicyVersion]||0)>(rank[incoming.basis?.businessProfile?.targetPolicyVersion]||0))return true;
 if(old.basis?.businessProfile?.timing?.policyVersion==='ec-first-reply-fixed24-v1'&&incoming.basis?.businessProfile?.timing?.policyVersion!=='ec-first-reply-fixed24-v1')return true;
 return old.aggregatePolicy==='fail-only.v2'&&incoming.aggregatePolicy!=='fail-only.v2';
}

function preserveLocalSettings(pkg,current,state){
 if(!current)return pkg;
 const p=clone(pkg),c=p.configuration;
 // These are explicit administrator choices. Rule bodies, dependencies and
 // algorithm policies always come from the new bundle.
 c.runtimeFields=c.runtimeFields.map(field=>{const old=current.runtimeFields.find(f=>f.key===field.key);return old?{...field,default:clone(old.default)}:field;});
 c.failurePolicy=clone(current.failurePolicy);
 if(c.engine==='conversation'){
  c.timingPolicy={...clone(current.timingPolicy),enabled:c.capabilities.some(a=>a.key==='timing')};
  // Older workspaces had no timing capability or standards. Enabling the new
  // capability must not invent thresholds or carry an inconsistent off switch.
  if(c.timingPolicy.enabled&&!c.timingPolicy.standards.length&&!c.timingPolicy.fallbackStandards.length)Object.assign(c.timingPolicy,{standardsStatus:'pending',allowBatchOverride:false,missingStandard:'uncertain'});
 }
 else if(c.basis.businessProfile&&current.basis.businessProfile){
  const old=current.basis.businessProfile;
  c.basis.businessProfile.timing.sites=clone(old.timing.sites);
  c.basis.businessProfile.timing.siteField=old.timing.siteField;
  if(old.semanticPolicy?.text&&c.basis.businessProfile.semanticPolicy)c.basis.businessProfile.semanticPolicy.text=clone(old.semanticPolicy.text);
  if(old.structure?.closingWaiver)c.basis.businessProfile.structure.closingWaiver=clone(old.structure.closingWaiver);
 }
 const template=sceneEntity(state,'deliveryTemplates',current.templateRef);
 if(template){p.template.title=template.title;p.template.groupBy=template.groupBy;
  // Keep titles/order for existing sections while adding new required sections.
  const byKey=new Map(p.template.sections.map(s=>[s.key,s]));
  p.template.sections=[...template.sections.filter(s=>byKey.has(s.key)).map(s=>({...byKey.get(s.key),title:s.title})),...p.template.sections.filter(s=>!template.sections.some(v=>v.key===s.key))];
  for(const col of p.template.columns){const old=template.columns.find(v=>v.id===col.id);if(old)col.visible=old.visible;}
 }
 return p;
}

export function prepareAutomaticBuiltinUpgrade(document,{catalogSeed,sceneSeed,productVersion,now=new Date().toISOString()}){
 if(!document.state||!catalogSeed||!sceneSeed)return null;
 validateSceneSeed(sceneSeed,catalogSeed);
 const hashes=seedHashes(sceneSeed),events=document.state.sceneConfigurationEvents||[];
 if(events.some(e=>e.action==='system-upgrade'&&newer(e.productVersion,productVersion)))return null;
 const already=sceneSeed.packages.every(p=>events.some(e=>e.sceneId===p.configuration.sceneId&&(['builtin-upgrade','system-upgrade'].includes(e.action)&&hashes.includes(e.seedHash)||e.action==='builtin-install'&&hashes.includes(e.requestHash))));
 if(already)return null;
 const sceneIds=sceneSeed.packages.filter(p=>{const sceneId=p.configuration.sceneId;if(events.some(e=>e.sceneId===sceneId&&['system-upgrade','builtin-upgrade'].includes(e.action)&&hashes.includes(e.seedHash)))return false;const event=bundledEvent(document.state,sceneId);if(isOlderBundle(p,event)||event?.bundledContentHash===digest(stable(content(p))))return false;const old=event?.after;return !old||!sameSceneValue(content(old),content(p));}).map(p=>p.configuration.sceneId);
 // An unchanged bundle is already represented by its installed package contents.
 if(!sceneIds.length)return null;
 const before=clone(document),actor='system-upgrade',reason=`安装版本 ${productVersion} 自动升级内置口径 ${sceneSeed.id}；历史任务冻结依据不变。`;
 const input={catalogSeed,sceneSeed,actor,reason,operationId:`auto-${hashes[0].slice(0,32)}`,now,sceneIds};
 const migrated=document.state.sceneConfigurationMigration===1?document:migrateSceneConfigurations(document,{actor,reason,now});
 // Validate the original seed first; preserve local settings only in the
 // publication step, so a customized source is never passed off as a bundle.
 const next=installBuiltinSceneUpgrade(migrated,{...input,transformPackage:(p,current,state)=>preserveLocalSettings(p,current,state)});
 const newEvents=next.state.sceneConfigurationEvents.slice(migrated.state.sceneConfigurationEvents.length);
 for(const event of newEvents){event.action='system-upgrade';event.productVersion=productVersion;event.seedId=sceneSeed.id;event.bundledContentHash=digest(stable(content(sceneSeed.packages.find(p=>p.configuration.sceneId===event.sceneId))));event.fromVersion=latestSceneConfiguration(before.state,event.sceneId)?.version??null;event.toVersion=event.after.configuration.version;event.diff.push({path:'installedPackage',before:bundledAncestor(before.state,event.sceneId)?.configuration?.version??null,after:sceneSeed.id});}
 return{next,sceneIds,seedId:sceneSeed.id,reason};
}

export async function upgradeBuiltinOnStartup({store,dataDir,catalogSeed,sceneSeed,productVersion,archive=encodeWorkspaceArchive,writeFile=fs.writeFile}){
 let backupPath,backupWritten=false;
 try{
  const catalog=typeof catalogSeed==='function'?await catalogSeed():catalogSeed,seed=typeof sceneSeed==='function'?await sceneSeed():sceneSeed;
  if(!catalog||!seed)return{status:'unavailable'};
  const input={catalogSeed:catalog,sceneSeed:seed,productVersion};
  const plan=prepareAutomaticBuiltinUpgrade(await store.read(),input);
  if(!plan)return{status:'current',seedId:seed.id};
  await store.validateIntegrity();
  const {bytes}=await archive(dataDir);
  backupPath=`${dataDir}.before-auto-builtin-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}.sqwb`;
  await writeFile(backupPath,bytes,{flag:'wx',mode:0o600});
  backupWritten=true;
  await store.upgradeBuiltinAutomatically(input);
  return{status:'upgraded',seedId:seed.id,backupPath,scenes:plan.sceneIds,message:'内置口径已自动升级并备份。新建任务直接使用新版；历史任务仍保留原口径。',messageEn:'Built-in policies were upgraded and backed up. New tasks use the new policies; existing tasks keep their frozen versions.'};
 }catch(error){return{status:'failed',...(backupWritten?{backupPath}:{}),message:`内置口径自动升级未完成，原工作区已保留。请在场景管理重试装载或联系维护人：${error.message}`,messageEn:'Automatic policy upgrade could not finish. The previous workspace is preserved. Retry loading the bundle in Scenario management or contact your maintainer.',detail:String(error.message)};}
}
