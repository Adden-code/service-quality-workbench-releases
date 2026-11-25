// Versioned language metadata. Missing metadata is a read-only legacy adapter,
// never permission to infer a native execution contract from the browser locale.
export const LANGUAGE_STAGE = 1;
export const LANGUAGE_MODES = ['pending-selection','native-v1','legacy-display-v1'];
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const equal=(a,b)=>stable(a)===stable(b);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export class LanguagePolicyError extends Error {
  constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
}
export const languageError=(code,message)=>{throw new LanguagePolicyError(code,message);};
export function workspaceLanguage(state){return state?.workspaceSettings?.languagePolicy||null;}
export function validateLanguagePolicy(policy){
  const fields=['schemaVersion','mode','contentLanguage','uiLanguagePolicy','initializedAt','initializedBy','initializationId','historyClassification'];
  if(!object(policy)||policy.schemaVersion!==1||!LANGUAGE_MODES.includes(policy.mode)||!fields.every(k=>Object.hasOwn(policy,k))||Object.keys(policy).some(k=>!fields.includes(k)))languageError('LANGUAGE_POLICY_INVALID','Invalid workspace language policy.');
  const native=policy.mode==='native-v1';
  if(native?!['zh','en'].includes(policy.contentLanguage)||policy.uiLanguagePolicy!=='locked-to-content':policy.contentLanguage!==null||policy.uiLanguagePolicy!=='legacy-switchable')languageError('LANGUAGE_POLICY_INVALID','Workspace language and mode do not agree.');
  if(!['initializedAt','initializedBy','initializationId','historyClassification'].every(k=>typeof policy[k]==='string'&&policy[k].trim()&&policy[k].length<=500)||!Number.isFinite(Date.parse(policy.initializedAt)))languageError('LANGUAGE_POLICY_INVALID','Language initialization audit is incomplete.');
  return policy;
}
export function taskLanguage(task){
  const frozen=task?.executionSnapshot?.languageExecution;
  if(frozen){validateLanguageExecution(frozen);return structuredClone(frozen);}
  // Do not insert fields in old snapshots, or change their hashes/calibrations.
  return {mode:'legacy-display-v1',contentLanguage:task?.rawImportOptions?.outputLanguage||task?.executionSnapshot?.configuration?.inspectionLanguage||'zh',modelContractVersion:'legacy'};
}
export function validateLanguageExecution(value){
  const fields=['schemaVersion','mode','contentLanguage','modelContractVersion','bilingualPackageHash','selectedMaterialHash','promptBundleRef','glossaryHash','languageValidatorVersion','originalTranslationPolicy'];
  const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  if(!object(value)||Object.keys(value).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(value,k))||value.schemaVersion!==1||value.mode!=='native-v1'||!['zh','en'].includes(value.contentLanguage)||value.modelContractVersion!=='native-language-v1'||!['bilingualPackageHash','selectedMaterialHash','glossaryHash'].every(k=>hash(value[k]))||value.originalTranslationPolicy!=='automatic-at-delivery'||typeof value.languageValidatorVersion!=='string'||!value.languageValidatorVersion.trim())languageError('LANGUAGE_FREEZE_INVALID','Native task language snapshot is incomplete.');
  const p=value.promptBundleRef;if(!object(p)||Object.keys(p).length!==3||!['id','version'].every(k=>typeof p[k]==='string'&&p[k].trim())||!hash(p.hash))languageError('LANGUAGE_FREEZE_INVALID','Frozen prompt reference is invalid.');
  return value;
}
export function languageCalibrationScope(task){
  const value=task?.executionSnapshot?.languageExecution;
  if(!value)return {}; // Legacy fingerprints remain byte-for-byte compatible.
  validateLanguageExecution(value);
  return {languageExecution:structuredClone(value)};
}
export function assertNativeStageReady(state){
  const policy=workspaceLanguage(state);
  if(policy?.mode==='pending-selection')languageError('LANGUAGE_SELECTION_REQUIRED','Choose a workspace language before creating tasks.');
  if(policy?.mode==='native-v1')languageError('NATIVE_LANGUAGE_STAGE_PENDING','Stage 1 verification only. Native AI execution will open after the next stages pass business acceptance.');
}
export function validateLanguageTransition(state,previous,{trustedLanguage=false}={}){
  const policy=workspaceLanguage(state),old=workspaceLanguage(previous);
  if(policy)validateLanguagePolicy(policy);
  if(!trustedLanguage&&previous&&(!equal(policy,old)||!equal(state.languageMaterials,previous.languageMaterials)||!equal(state.languageAudit,previous.languageAudit)))languageError('LANGUAGE_LOCKED','Language settings and bilingual releases can only be changed through their dedicated audited operation.');
  if(previous&&policy?.mode!=='legacy-display-v1'&&policy){
    const ids=new Set((previous.tasks||[]).map(t=>t.id));
    if((state.tasks||[]).some(t=>!ids.has(t.id)))assertNativeStageReady(state);
  }
  for(const task of state?.tasks||[]){
    const value=task.executionSnapshot?.languageExecution;
    if(value){
      validateLanguageExecution(value);
      const s=task.executionSnapshot,ref=state.languageMaterials?.freezes?.find(r=>r.hash===s.languageMaterialRef);
      if(policy?.mode!=='native-v1'||policy.contentLanguage!==value.contentLanguage||!ref||!equal(ref.languageExecution,value))languageError('LANGUAGE_FREEZE_INVALID','Native task language must reference the workspace frozen material registry.');
      if(s.configuration?.inspectionLanguage!==value.contentLanguage||!equal(s.runtime?.values?.outputLanguages,[value.contentLanguage])||task.rawImportOptions&&task.rawImportOptions.outputLanguage!==value.contentLanguage)languageError('LANGUAGE_PARAMETER_CONFLICT','Frozen task language parameters disagree.');
      const before=previous?.tasks?.find(t=>t.id===task.id);if(before&&!equal(before.executionSnapshot?.languageExecution,value))languageError('LANGUAGE_FROZEN','A task language snapshot cannot be rewritten.');
    }
  }
}
