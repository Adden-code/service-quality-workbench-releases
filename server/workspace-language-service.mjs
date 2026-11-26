import fs from 'node:fs/promises';
import path from 'node:path';
import {workspaceLanguage,validateLanguagePolicy,languageError} from '../public/workspace-language.mjs';
import {languageCanonical,languageHash,validateBilingualMaterial,validateFrozenLanguageMaterial,assertMaterialReleaseAllowed,freezeNativeLanguage,freezeTaskLanguageContract} from './native-language-materials.mjs';
import {nativeExecutionContext,nativeSourceConfiguration,REQUIRED_NATIVE_PROMPTS,REQUIRED_NATIVE_EC_PROMPTS} from './native-language-execution.mjs';
import {assertNativeReportCoverage,requiredNativeReportPrompts} from './native-report-language.mjs';
import {nativeDisplayProjection} from './native-delivery.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {sceneBasisForTask,freezeSceneExecution} from '../public/scene-configuration.mjs';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const same=(a,b)=>languageCanonical(a)===languageCanonical(b);
export function assertNativeMaterialActivated(state,materials){
  for(const material of materials){
    validateBilingualMaterial(material);assertMaterialReleaseAllowed(material);
    if(!materialActivated(state,material))languageError('NATIVE_PILOT_ACTIVATION_REQUIRED','A local maintainer must explicitly activate these exact unreviewed pilot materials before creating new native tasks. Existing frozen tasks remain available.');
  }
}
function materialActivated(state,material){
  if(material.review?.status==='approved-pair')return true;
  // A later explicit activation is the release selection for its scenes. Do
  // not pool grants from old bundles: equal source versions may have different
  // translated bytes. Historical tasks read their own frozen files directly.
  const activation=(state.languageAudit||[]).findLast(e=>e.action==='activate-pilot-materials'&&e.after?.acknowledgeUnreviewed===true&&hash(e.after.bundleHash)&&e.after.scenes?.includes(material.scene));
  return Boolean(activation?.after.materialHashes?.includes(material.contentHash));
}
// Publication is a separate, audited human operation. This resolver consumes
// only existing approved bytes and never chooses among competing versions.
export function resolveNativeTaskMaterial(state,task,materials,selectedFreeze=null){
  const policy=workspaceLanguage(state);
  if(Array.isArray(selectedFreeze))selectedFreeze=selectedFreeze.find(f=>f.paired.every(m=>m.scene===task.scene))||null;
  if(!['新品产品咨询','电商评论回复'].includes(task.scene))languageError('LANGUAGE_SCENE_NOT_READY','This scene has no native execution material scope.');
  if(!task.executionSnapshot)languageError('NATIVE_MATERIAL_NOT_READY','The task needs a published scene configuration and its exact reviewed bilingual materials.');
  if(selectedFreeze&&selectedFreeze.paired.every(m=>m.scene===task.scene)){
    assertNativeMaterialActivated(state,selectedFreeze.paired);
    const prepared=freezeTaskLanguageContract(task,policy,selectedFreeze);prepared.executionSnapshot.schemaVersion=2;
    const context=nativeExecutionContext(prepared,selectedFreeze);assertNativeReportCoverage(context);nativeDisplayProjection(prepared,selectedFreeze,{delivery:true});
    return{task:prepared,frozen:selectedFreeze,hash:languageHash(selectedFreeze)};
  }
  const approved=materials.filter(m=>m.scene===task.scene&&m.review?.status==='approved-pair');
  const sceneMaterials=materials.filter(m=>m.scene===task.scene),available=sceneMaterials.filter(m=>materialActivated(state,m)),selected=[];
  const pick=(matches,label)=>{
    if(!matches.length&&sceneMaterials.some(m=>!materialActivated(state,m)))languageError('NATIVE_PILOT_ACTIVATION_REQUIRED','Explicit local activation of the bundled unreviewed pilot materials is required before new native tasks.');
    if(!matches.length)languageError('NATIVE_MATERIAL_NOT_READY',`No exact reviewed material for ${label}. Complete paired Chinese/English review and publish the matching rules, policies, configuration, report template, prompt and glossary before creating a task.`);
    const reviewed=matches.filter(m=>approved.includes(m));if(reviewed.length)matches=reviewed;
    if(matches.length!==1)languageError('NATIVE_MATERIAL_AMBIGUOUS',`Multiple reviewed versions match ${label}. An explicit approved release selection is required before task creation.`);
    const m=matches[0];validateBilingualMaterial(m);assertMaterialReleaseAllowed(m);if(!selected.some(v=>v.id===m.id))selected.push(m);return m;
  };
  const source=(value,kind)=>{
    const candidates=available.filter(m=>m.id===value.id&&m.kind===kind),matches=candidates.filter(m=>m.sourceHash===languageHash(value)&&(kind==='rule'||kind==='policy'?m.version===String(value.version):true));
    if(!matches.length&&candidates.length)languageError('NATIVE_SOURCE_MISMATCH',`Activated material does not match the current source: ${value.id}@${value.version}. Activation cannot replace missing reviewed source bytes.`);
    return pick(matches,`${value.id}@${value.version}`);
  };
  for(const r of task.basisSnapshot.rules.filter(r=>r.ruleKind!=='meta'))source(r,'rule');
  for(const p of task.basisSnapshot.policies)source(p,'policy');
  const s=task.executionSnapshot;
  for(const reference of s.configuration.referenceMaterials||[])source(reference,'policy');
  if(s.taxonomy)source(s.taxonomy,'taxonomy');for(const table of s.exceptions||[])source(table,'exception');
  source(s.template,'template');
  pick(available.filter(m=>m.id==='NATIVE-CONFIG'&&m.sourceHash===languageHash(nativeSourceConfiguration(s))),'NATIVE-CONFIG');
  const required=[...REQUIRED_NATIVE_PROMPTS,...requiredNativeReportPrompts(task.scene),...(task.scene==='电商评论回复'?REQUIRED_NATIVE_EC_PROMPTS:[])];
  const prompt=pick(available.filter(m=>m.kind==='prompt'&&required.every(id=>m.clauses.some(c=>c.clauseId===id))),'complete inspection and report prompt');
  const glossary=pick(available.filter(m=>m.kind==='glossary'),'glossary');
  for(let i=0;i<selected.length;i++)for(const key of ['exceptionIds','dependencyIds'])for(const id of selected[i].shared[key])if(!selected.some(m=>m.id===id))pick(available.filter(m=>m.id===id),id);
  const frozen=freezeNativeLanguage(policy,{materials:selected,promptId:prompt.id,glossaryId:glossary.id,languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});
  const prepared=freezeTaskLanguageContract(task,policy,frozen);prepared.executionSnapshot.schemaVersion=2;
  const context=nativeExecutionContext(prepared,frozen);assertNativeReportCoverage(context);nativeDisplayProjection(prepared,frozen,{delivery:true});
  return{task:prepared,frozen,hash:languageHash(frozen)};
}
export function nativeLanguageReadiness(state,catalog,materials,selectedFreeze=null){
  const policy=workspaceLanguage(state),base={mode:policy?.mode||'legacy-display-v1',contentLanguage:policy?.contentLanguage||null,scenes:[]};
  if(policy?.mode==='pending-selection')return{...base,status:'selection-required'};
  if(policy?.mode!=='native-v1')return{...base,status:'legacy'};
  const scenes=[...new Set((state.sceneConfigurations||[]).map(c=>c.sceneId))];if(!scenes.includes('新品产品咨询'))scenes.push('新品产品咨询');if(!scenes.includes('电商评论回复'))scenes.push('电商评论回复');
  base.scenes=scenes.map(scene=>{
    try{const basis=sceneBasisForTask(state,catalog,scene),task={id:'readiness-preview',scene,basisSnapshot:basis,executionSnapshot:basis&&freezeSceneExecution(state,scene,{basis})};const value=resolveNativeTaskMaterial(state,task,materials,selectedFreeze);return{scene,status:'ready',materialStatus:value.frozen.paired.some(m=>m.review.status==='pilot-unreviewed')?'pilot-unreviewed':'approved-pair',materialHash:value.hash,promptBundleRef:value.frozen.languageExecution.promptBundleRef};}
    catch(error){return{scene,status:'blocked',code:error.code||'NATIVE_MATERIAL_NOT_READY',detail:error.message};}
  });
  return{...base,status:base.scenes.some(s=>s.status==='ready')?'ready':'blocked'};
}
export function classifyLanguageHistory(state,externalHistory=[]){
  const reasons=[];
  for(const key of ['tasks','sessions','taskDeletionAudit'])if(state?.[key]?.length)reasons.push(key);
  if(state?.legacyDemoArchive)reasons.push('legacy-archive');
  if(state?.activity?.length)reasons.push('prior-activity');
  if(state?.aiTaskQueue?.entries?.length)reasons.push('queue-history');
  reasons.push(...externalHistory);
  return {legacy:reasons.length>0,reasons};
}
export async function diskLanguageHistory(dataDir){
  const found=[];
  for(const dir of ['workflow-runs','report-jobs','raw-structure','content-translations']){
    try{const entries=await fs.readdir(path.join(dataDir,dir));if(entries.some(name=>!name.startsWith('.')))found.push(`files:${dir}`);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return found;
}
export function initializeLanguageGovernance(state,{externalHistory=[],at=new Date().toISOString(),operationId}={}){
  if(workspaceLanguage(state))return state;
  const history=classifyLanguageHistory(state,externalHistory),next=structuredClone(state);
  const policy={schemaVersion:1,mode:history.legacy?'legacy-display-v1':'pending-selection',contentLanguage:null,uiLanguagePolicy:'legacy-switchable',initializedAt:at,initializedBy:'system-upgrade',initializationId:operationId,historyClassification:history.legacy?history.reasons.join(',').slice(0,500):'new-workspace'};
  validateLanguagePolicy(policy);next.workspaceSettings={...next.workspaceSettings,languagePolicy:policy};
  next.languageAudit=[{id:operationId,action:'classify',actor:'system-upgrade',at,reason:history.legacy?'Preserve existing execution and presentation behavior.':'No task, run, delivery or deletion history.',before:null,after:policy}];
  return next;
}
export function selectWorkspaceLanguage(state,{language,actor,operationId,at=new Date().toISOString()}={}){
  const old=workspaceLanguage(state);
  if(!old||old.mode!=='pending-selection')languageError('LANGUAGE_LOCKED','Workspace language has already been established; reload to use the saved language.');
  if(!['zh','en'].includes(language)||typeof actor!=='string'||!actor.trim()||actor.length>100||typeof operationId!=='string'||!operationId.trim()||operationId.length>128)languageError('LANGUAGE_SELECTION_INVALID','Select Chinese or English and provide an operation identity.');
  const next=structuredClone(state),policy={...old,mode:'native-v1',contentLanguage:language,uiLanguagePolicy:'locked-to-content',initializedAt:at,initializedBy:actor.trim(),initializationId:operationId};
  next.workspaceSettings={...next.workspaceSettings,languagePolicy:policy};
  next.languageAudit=[...next.languageAudit,{id:operationId,action:'select-language',actor:actor.trim(),at,reason:'Explicit one-time workspace language selection.',before:old,after:policy}];return next;
}
export function validateLanguageRegistry(state,previous,{trustedLanguage=false}={}){
  const registry=state?.languageMaterials;
  if(registry){
    if(registry.schemaVersion!==1||!Array.isArray(registry.releases)||!Array.isArray(registry.freezes)||Object.keys(registry).some(k=>!['schemaVersion','releases','freezes'].includes(k)))languageError('LANGUAGE_MATERIAL_INVALID','Invalid language material registry.');
    const keys=new Set();for(const r of registry.releases){const key=r?.scene+'::'+r?.id+'@'+r?.version+'#'+r?.contentHash;if(!r||Object.keys(r).length!==4||!['id','version','scene'].every(k=>typeof r[k]==='string'&&r[k].trim())||!hash(r.contentHash)||keys.has(key))languageError('LANGUAGE_MATERIAL_INVALID','Invalid or duplicate bilingual material reference.');keys.add(key);}
    const hashes=new Set();for(const r of registry.freezes){if(!r||Object.keys(r).length!==2||!hash(r.hash)||!r.languageExecution||hashes.has(r.hash))languageError('LANGUAGE_MATERIAL_INVALID','Invalid frozen language material reference.');hashes.add(r.hash);}
  }
  const audit=state?.languageAudit;
  if(audit!==undefined&&(!Array.isArray(audit)||new Set(audit.map(e=>e?.id)).size!==audit.length||audit.some(e=>!e||!['classify','select-language','publish-material','freeze-material','install-pilot-materials','activate-pilot-materials'].includes(e.action)||!['id','actor','at','reason'].every(k=>typeof e[k]==='string'&&e[k].trim())||!Number.isFinite(Date.parse(e.at))||!Object.hasOwn(e,'before')||!Object.hasOwn(e,'after'))))languageError('LANGUAGE_AUDIT_INVALID','Language audit trail is incomplete.');
  for(const event of audit||[])if(event.action==='activate-pilot-materials'){
    const value=event.after;
    if(!value||!hash(value.bundleHash)||value.materialStatus!=='pilot-unreviewed'||value.acknowledgeUnreviewed!==true||!['id','version'].every(k=>typeof value[k]==='string'&&value[k].trim())||!Array.isArray(value.materialHashes)||!value.materialHashes.length||new Set(value.materialHashes).size!==value.materialHashes.length||value.materialHashes.some(h=>!hash(h)||!registry?.releases.some(r=>r.contentHash===h))||!Array.isArray(value.scenes)||!value.scenes.length)languageError('LANGUAGE_AUDIT_INVALID','Pilot activation must bind the exact installed bundle and material hashes with explicit local acknowledgement.');
  }
  if(previous){
    if(!same((audit||[]).slice(0,(previous.languageAudit||[]).length),previous.languageAudit||[]))languageError('LANGUAGE_AUDIT_IMMUTABLE','Language audit history cannot be rewritten.');
    for(const key of ['releases','freezes'])if(!same((registry?.[key]||[]).slice(0,(previous.languageMaterials?.[key]||[]).length),previous.languageMaterials?.[key]||[]))languageError('LANGUAGE_MATERIAL_IMMUTABLE','Published language materials and frozen references cannot be removed or rewritten.');
    if(!trustedLanguage&&(!same(registry,previous.languageMaterials)||!same(audit,previous.languageAudit)))languageError('LANGUAGE_LOCKED','Use the dedicated audited language operation.');
  }
}
export function verifyLanguageFileSet(state,files){
  const read=name=>{const value=files.get(name);if(!value)languageError('LANGUAGE_MATERIAL_MISSING',`Missing frozen language material: ${name}`);return value;};
  for(const r of state?.languageMaterials?.releases||[]){
    const value=JSON.parse(read(`language-materials/${r.contentHash}.json`));validateBilingualMaterial(value);assertMaterialReleaseAllowed(value);
    if(!same(r,{id:value.id,version:value.version,scene:value.scene,contentHash:value.contentHash}))languageError('LANGUAGE_MATERIAL_INVALID','Published bilingual material reference does not match its immutable bytes.');
  }
  for(const r of state?.languageMaterials?.freezes||[]){
    const value=JSON.parse(read(`language-materials/${r.hash}.json`));validateFrozenLanguageMaterial(value);
    if(languageHash(value)!==r.hash||!same(value.languageExecution,r.languageExecution))languageError('LANGUAGE_FREEZE_INVALID','Frozen execution material bytes do not match the registry.');
  }
}
export async function verifyLanguageFiles(state,read){
  const files=new Map();for(const r of [...(state?.languageMaterials?.releases||[]),...(state?.languageMaterials?.freezes||[])]){const name=`language-materials/${r.hash||r.contentHash}.json`;files.set(name,await read(name));}verifyLanguageFileSet(state,files);
}
