import fs from 'node:fs/promises';
import path from 'node:path';
import {workspaceLanguage,validateLanguagePolicy,languageError} from '../public/workspace-language.mjs';
import {languageCanonical,languageHash,validateBilingualMaterial,validateFrozenLanguageMaterial,assertMaterialReleaseAllowed} from './native-language-materials.mjs';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const same=(a,b)=>languageCanonical(a)===languageCanonical(b);
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
    const keys=new Set();for(const r of registry.releases){if(!r||Object.keys(r).length!==4||!['id','version','scene'].every(k=>typeof r[k]==='string'&&r[k].trim())||!hash(r.contentHash)||keys.has(r.id+'@'+r.version))languageError('LANGUAGE_MATERIAL_INVALID','Invalid or duplicate bilingual material reference.');keys.add(r.id+'@'+r.version);}
    const hashes=new Set();for(const r of registry.freezes){if(!r||Object.keys(r).length!==2||!hash(r.hash)||!r.languageExecution||hashes.has(r.hash))languageError('LANGUAGE_MATERIAL_INVALID','Invalid frozen language material reference.');hashes.add(r.hash);}
  }
  const audit=state?.languageAudit;
  if(audit!==undefined&&(!Array.isArray(audit)||new Set(audit.map(e=>e?.id)).size!==audit.length||audit.some(e=>!e||!['classify','select-language','publish-material','freeze-material'].includes(e.action)||!['id','actor','at','reason'].every(k=>typeof e[k]==='string'&&e[k].trim())||!Number.isFinite(Date.parse(e.at))||!Object.hasOwn(e,'before')||!Object.hasOwn(e,'after'))))languageError('LANGUAGE_AUDIT_INVALID','Language audit trail is incomplete.');
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
