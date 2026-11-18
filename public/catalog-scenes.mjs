import {isBusinessEcommerceBasis,validateBusinessEcommerceBasis} from './ecommerce-business-profile.mjs';
// Scene ownership is catalog metadata. It never rewrites task basis snapshots.
import {BUILTIN_SCENARIOS,isSceneKey} from './scenarios.mjs';
import {isSessionCheckRule} from './rule-kind.mjs';

export const UNASSIGNED_SCENE='__unassigned__';
export function validateCatalogSceneIds(sceneIds){
  if(!Array.isArray(sceneIds)||sceneIds.length>102||new Set(sceneIds).size!==sceneIds.length||sceneIds.some(id=>!isSceneKey(id)))throw new Error('场景归属须为无重复的有效场景标识数组。');
  return true;
}
export function catalogScenes(state={}){
  return [...BUILTIN_SCENARIOS,...(state.scenarios||[])].map(({id,name,enabled})=>({id,name,enabled}));
}
const legacyScene=id=>typeof id==='string'&&id.startsWith('EC-')?'电商评论回复':typeof id==='string'&&id.startsWith('NP-')?'新品产品咨询':null;
function inferredRuleSceneIds(record,state){
  const legacy=legacyScene(record.id);
  return [...new Set([...(legacy?[legacy]:[]),...(state?.scenarios||[]).filter(config=>config.ruleIds?.includes(record.id)).map(config=>config.id)])];
}
export function catalogRecordSceneIds(record,{state={},catalog={},kind='rules'}={}){
  if(record?.sceneIds!==undefined){validateCatalogSceneIds(record.sceneIds);return [...record.sceneIds];}
  if(!record)return [];
  if(kind==='rules')return inferredRuleSceneIds(record,state);
  const legacy=legacyScene(record.id),references=(catalog.rules||[]).filter(rule=>rule.policyIds?.includes(record.id));
  return [...new Set([...(legacy?[legacy]:[]),...references.flatMap(rule=>catalogRecordSceneIds(rule,{state,catalog,kind:'rules'}))])];
}
export function catalogRecordMatchesScene(record,scene,options={}){
  const ids=catalogRecordSceneIds(record,options);
  return scene===UNASSIGNED_SCENE?ids.length===0:ids.includes(scene);
}
export function migrateCatalogScenes({state,catalog}){
  let changed=false;
  const next=structuredClone(catalog);
  for(const kind of ['rules','policies'])for(const record of next[kind]||[]){
    if(record.sceneIds!==undefined)continue;
    record.sceneIds=catalogRecordSceneIds(record,{state,catalog:next,kind});changed=true;
  }
  return{state,catalog:changed?next:catalog,changed};
}
const effective=(record,date)=>record.status==='已发布'&&record.effectiveAt<=date&&(!record.expiresAt||date<record.expiresAt);
export function sceneRuleAvailability({state={},catalog={},scene,effectiveDate}={}){
  const reasons={empty:!(catalog.rules||[]).length,unassigned:0,otherScene:0,unpublished:0,future:0,expired:0,policyUnavailable:0,meta:0},rules=[],metaRules=[];
  for(const rule of catalog.rules||[]){
    const ownership=catalogRecordSceneIds(rule,{state,catalog,kind:'rules'});
    if(!ownership.length){reasons.unassigned++;continue;}
    if(!ownership.includes(scene)){reasons.otherScene++;continue;}
    if(rule.status!=='已发布'){reasons.unpublished++;continue;}
    if(rule.effectiveAt>effectiveDate){reasons.future++;continue;}
    if(rule.expiresAt&&rule.expiresAt<=effectiveDate){reasons.expired++;continue;}
    if((rule.policyIds||[]).some(id=>{
      const matches=(catalog.policies||[]).filter(policy=>policy.id===id&&effective(policy,effectiveDate));
      return matches.length!==1||!catalogRecordMatchesScene(matches[0],scene,{state,catalog,kind:'policies'});
    })){reasons.policyUnavailable++;continue;}
    if(isSessionCheckRule(rule))rules.push(rule);
    else {metaRules.push(rule);reasons.meta++;}
  }
  return{rules,metaRules,reasons};
}
export const eligibleSceneRules=options=>sceneRuleAvailability(options).rules;
export function assertTaskCatalogScene({state={},catalog,scene,basisSnapshot}){
  if(scene==='电商评论回复'&&isBusinessEcommerceBasis(basisSnapshot)){validateBusinessEcommerceBasis(basisSnapshot);const matches=(state.sceneConfigurations||[]).filter(c=>c.sceneId===scene&&c.status==='published'&&JSON.stringify(c.basis.rules)===JSON.stringify(basisSnapshot.rules)&&JSON.stringify(c.basis.businessProfile)===JSON.stringify(basisSnapshot.businessProfile)&&JSON.stringify(c.basis.policies)===JSON.stringify(basisSnapshot.policies));if(matches.length!==1)throw new Error('内置电商依据必须来自已发布场景。');return true;}
  const stageA=scene==='电商评论回复'&&basisSnapshot?.ruleSetSnapshot;
  const derivedPolicyId=stageA?`EC-TIME-${basisSnapshot.ruleSetSnapshot.ruleSetId}`:null;
  for(const kind of ['rules','policies'])for(const record of basisSnapshot?.[kind]||[]){
    // Stage A synthesizes a time record and policy. Check its real V1 source
    // rule and EC-POLICY; the dedicated compiler authenticates derived content.
    if(kind==='policies'&&stageA&&record.id===derivedPolicyId)continue;
    const sourceTime=kind==='rules'&&stageA&&record.id==='EC-TIME';
    const matches=catalog[kind].filter(item=>item.id===record.id&&(sourceTime?effective(item,basisSnapshot.effectiveDate):item.version===record.version));
    const published=matches.length===1?matches[0]:null;
    if(!published||!catalogRecordMatchesScene(published,scene,{state,catalog,kind}))throw new Error(`新任务${kind==='rules'?'规则':'资料'}未归属于当前场景：${record.id}。`);
  }
  return true;
}

export const localBasisDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function defaultSceneRuleIds({state={},catalog={},scene,effectiveDate=localBasisDate(),preferred=[]}){
 const rules=eligibleSceneRules({state,catalog,scene,effectiveDate}),eligible=new Set(rules.map(r=>r.id));
 const defaults=preferred.length?preferred:(state.scenarios||[]).find(s=>s.id===scene)?.ruleIds||[];
 return [...new Set((defaults.length?defaults:rules.map(r=>r.id)).filter(id=>eligible.has(id)))];
}
