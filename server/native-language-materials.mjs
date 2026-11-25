import {createHash} from 'node:crypto';
import {languageError,validateLanguagePolicy,validateLanguageExecution} from '../public/workspace-language.mjs';
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const languageCanonical=v=>Array.isArray(v)?'['+v.map(languageCanonical).join(',')+']':obj(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+languageCanonical(v[k])).join(',')+'}':JSON.stringify(v);
export const languageHash=v=>createHash('sha256').update(languageCanonical(v)).digest('hex');
export function languageDiff(before,after,prefix=''){
  if(languageCanonical(before)===languageCanonical(after))return [];
  if(obj(before)&&obj(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(k=>languageDiff(before[k],after[k],prefix?`${prefix}.${k}`:k));
  return [{path:prefix||'$',before:before??null,after:after??null}];
}
const text=(v,field)=>{if(typeof v!=='string'||!v.trim()||v.length>100000)languageError('BILINGUAL_INCOMPLETE',`${field}: a nonempty value is required in both languages.`);};
const same=(a,b)=>languageCanonical(a)===languageCanonical(b);
export const BILINGUAL_MATERIAL_KINDS=Object.freeze(['rule','policy','exception','prompt','glossary','template','taxonomy']);
export const LANGUAGE_FIELD_ROLES=Object.freeze({localizedProse:['reason','summary','commentary','recommendation'],sourceQuote:['quote','negativeVoiceQuote'],machineValue:['id','status','verdict','confidence','start','end'],userData:['taskName','fileName','operatorNote']});
const keys=(v,fields,label)=>{if(!obj(v)||Object.keys(v).some(k=>!fields.includes(k)))languageError('BILINGUAL_INVALID',`${label}: unknown or invalid fields.`);};
export function bilingualHashes(material){
  validateBilingualMaterial(material,{published:false});
  const shared={id:material.id,version:material.version,scene:material.scene,kind:material.kind,semanticRevision:material.semanticRevision,shared:material.shared,clauses:material.clauses.map(c=>({clauseId:c.clauseId,kind:c.kind}))};
  const locale=lang=>({metadata:material.locales[lang],clauses:material.clauses.map(c=>({clauseId:c.clauseId,text:c.locales[lang]}))});
  return {zhHash:languageHash(locale('zh')),enHash:languageHash(locale('en')),sharedHash:languageHash(shared)};
}
export function validateBilingualMaterial(material,{published=true}={}){
  keys(material,['id','version','scene','kind','semanticRevision','shared','clauses','locales','review','contentHash'],'material');
  for(const k of ['id','version','scene','semanticRevision'])text(material[k],k);
  if(!BILINGUAL_MATERIAL_KINDS.includes(material.kind))languageError('BILINGUAL_INVALID','Unknown bilingual material kind.');
  keys(material.shared,['applicabilityIds','exceptionIds','parameterRefs','dependencyIds'],'shared');
  for(const key of ['applicabilityIds','exceptionIds','parameterRefs','dependencyIds'])if(!Array.isArray(material.shared[key])||material.shared[key].some(v=>typeof v!=='string'||!v.trim())||new Set(material.shared[key]).size!==material.shared[key].length)languageError('BILINGUAL_INVALID',`shared.${key}: unique identifiers required.`);
  keys(material.locales,['zh','en'],'locales');
  for(const lang of ['zh','en']){keys(material.locales[lang],['title','scope'],`locales.${lang}`);for(const k of ['title','scope'])text(material.locales[lang][k],`locales.${lang}.${k}`);}
  if(!Array.isArray(material.clauses)||!material.clauses.length||material.clauses.length>1000||new Set(material.clauses.map(c=>c?.clauseId)).size!==material.clauses.length)languageError('BILINGUAL_INCOMPLETE','Every clause requires a unique identifier and a paired text.');
  for(const c of material.clauses){keys(c,['clauseId','kind','locales'],'clause');text(c.clauseId,'clauseId');text(c.kind,'kind');keys(c.locales,['zh','en'],c.clauseId);for(const lang of ['zh','en'])text(c.locales[lang],`clauses.${c.clauseId}.${lang}`);
    const refs=lang=>[...c.locales[lang].matchAll(/\{\{([a-zA-Z0-9_.-]+)\}\}/g)].map(m=>m[1]).sort();
    if(!same(refs('zh'),refs('en'))||refs('zh').some(id=>!material.shared.parameterRefs.includes(id)))languageError('BILINGUAL_PARAMETER_MISMATCH',`clauses.${c.clauseId}: parameter references differ or are undeclared.`);
  }
  if(published){
    const r=material.review,h=bilingualHashes(material);
    keys(r,['status','semanticRevision','zhHash','enHash','sharedHash','reviewer','reason','reviewedAt'],'review');
    if(r.status!=='approved-pair'||r.semanticRevision!==material.semanticRevision||Object.keys(h).some(k=>r[k]!==h[k]))languageError('BILINGUAL_REVIEW_STALE','Bilingual texts or shared conditions changed. Review both languages again before publishing (zh/en/shared hashes).');
    for(const k of ['reviewer','reason','reviewedAt'])text(r[k],`review.${k}`);
    if(!Number.isFinite(Date.parse(r.reviewedAt)))languageError('BILINGUAL_REVIEW_STALE','Invalid bilingual review time.');
    const {contentHash,...body}=material;if(contentHash!==languageHash(body))languageError('BILINGUAL_HASH_MISMATCH','The bilingual package content hash does not match.');
  }
  return material;
}
// No caller-supplied override: EC arbitration and bilingual business review
// are an explicit later delivery gate, not a client checkbox in this stage.
export function assertMaterialReleaseAllowed(material){
  if(material.scene==='电商评论回复'||material.scene==='ecommerce-comment'||material.scene==='ecommerce'||/^EC-/.test(material.id))languageError('EC_ARBITRATION_PENDING','EC English execution materials are blocked until Chinese arbitration and clause-by-clause bilingual business review are completed.');
  if(material.scene!=='新品产品咨询')languageError('LANGUAGE_SCENE_NOT_READY','Stage 1 release validation currently accepts the NP scene only. Other scenes require a separate approved material scope.');
}
export function reviewBilingualMaterial(material,{reviewer,reason,confirmedLanguages,expectedHashes,at=new Date().toISOString()}={}){
  const candidate=structuredClone(material);delete candidate.review;delete candidate.contentHash;
  const hashes=bilingualHashes(candidate);
  if(!same(confirmedLanguages,['zh','en'])||!same(expectedHashes,hashes))languageError('BILINGUAL_REVIEW_REQUIRED','Review the current Chinese and English texts together; both content hashes must match.');
  text(reviewer,'reviewer');text(reason,'reason');
  candidate.review={status:'approved-pair',semanticRevision:candidate.semanticRevision,...hashes,reviewer:reviewer.trim(),reason:reason.trim(),reviewedAt:at};
  candidate.contentHash=languageHash(candidate);validateBilingualMaterial(candidate);assertMaterialReleaseAllowed(candidate);return candidate;
}
export function resolveBilingualMaterial(material,language){
  validateBilingualMaterial(material);assertMaterialReleaseAllowed(material);
  if(!['zh','en'].includes(language))languageError('LANGUAGE_FREEZE_INVALID','Unsupported content language.');
  return {id:material.id,version:material.version,kind:material.kind,shared:structuredClone(material.shared),...structuredClone(material.locales[language]),clauses:material.clauses.map(c=>({clauseId:c.clauseId,kind:c.kind,text:c.locales[language]}))};
}
export function freezeNativeLanguage(policy,{materials,promptId,glossaryId,languageValidatorVersion='native-language-pending-stage2'}={}){
  validateLanguagePolicy(policy);if(policy.mode!=='native-v1')languageError('LANGUAGE_SELECTION_REQUIRED','Only a selected native workspace can freeze native execution materials.');
  if(!Array.isArray(materials)||!materials.length||new Set(materials.map(m=>m.id)).size!==materials.length)languageError('LANGUAGE_FREEZE_INVALID','A unique, reviewed material set is required.');
  const paired=structuredClone(materials).sort((a,b)=>a.id.localeCompare(b.id,'en')),selected=paired.map(m=>resolveBilingualMaterial(m,policy.contentLanguage));
  const ids=new Set(paired.map(m=>m.id));for(const m of paired)for(const key of ['exceptionIds','dependencyIds'])for(const id of m.shared[key])if(!ids.has(id))languageError('LANGUAGE_MATERIAL_MISSING',`${m.id}: frozen package is missing ${key} reference ${id}.`);
  const prompt=selected.find(m=>m.id===promptId&&m.kind==='prompt'),glossary=selected.find(m=>m.id===glossaryId&&m.kind==='glossary');
  if(!prompt||!glossary)languageError('LANGUAGE_FREEZE_INVALID','The frozen prompt and glossary are required.');
  const languageExecution={schemaVersion:1,mode:'native-v1',contentLanguage:policy.contentLanguage,modelContractVersion:'native-language-v1',bilingualPackageHash:languageHash(paired),selectedMaterialHash:languageHash(selected),promptBundleRef:{id:prompt.id,version:prompt.version,hash:languageHash(prompt)},glossaryHash:languageHash(glossary),languageValidatorVersion,originalTranslationPolicy:'automatic-at-delivery'};
  validateLanguageExecution(languageExecution);
  // Actual bytes are retained, not just a reference to the current installation.
  return {languageExecution,paired,selected};
}
export function validateFrozenLanguageMaterial(frozen){
  const expected=freezeNativeLanguage({schemaVersion:1,mode:'native-v1',contentLanguage:frozen?.languageExecution?.contentLanguage,uiLanguagePolicy:'locked-to-content',initializedAt:'2026-11-25T00:00:00Z',initializedBy:'snapshot-validator',initializationId:'snapshot-validator',historyClassification:'new-workspace'},{materials:frozen?.paired,promptId:frozen?.languageExecution?.promptBundleRef?.id,glossaryId:frozen?.selected?.find(m=>m.kind==='glossary')?.id,languageValidatorVersion:frozen?.languageExecution?.languageValidatorVersion});
  if(!same(frozen,expected))languageError('LANGUAGE_FREEZE_INVALID','Frozen language material bytes or references were changed.');return frozen;
}
export function freezeTaskLanguageContract(task,policy,frozen){
  validateLanguagePolicy(policy);validateFrozenLanguageMaterial(frozen);
  const lang=policy.contentLanguage,s=task?.executionSnapshot;
  if(policy.mode!=='native-v1'||frozen.languageExecution.contentLanguage!==lang||!s)languageError('LANGUAGE_FREEZE_INVALID','Task, workspace and selected execution material must use one native language.');
  if(s.configuration?.inspectionLanguage!==lang||!same(s.runtime?.values?.outputLanguages,[lang])||task.rawImportOptions&&task.rawImportOptions.outputLanguage!==lang)languageError('LANGUAGE_PARAMETER_CONFLICT','inspectionLanguage, raw outputLanguage and outputLanguages must match the locked workspace language.');
  if(s.languageExecution)languageError('LANGUAGE_FROZEN','A task language contract is already frozen.');
  // Used by the next-stage task creation adapter. Stage 1 does not dispatch it.
  return {...structuredClone(task),executionSnapshot:{...structuredClone(s),languageExecution:structuredClone(frozen.languageExecution),languageMaterialRef:languageHash(frozen)}};
}
