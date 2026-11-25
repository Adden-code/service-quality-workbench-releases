import {taskLanguage} from './workspace-language.mjs';
import {getTaskBasis,resolveTaskReference} from './task-basis.mjs';
import {inspectionRules} from './scene-aggregate.mjs';
import {checkNativeProse,nativeLanguageIssue} from './native-language-validation.mjs';
import {ruleDisplayName,businessContent,d} from './content-translation-ui.mjs';
import {isInactiveTask} from './task-lifecycle.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canonical=value=>Array.isArray(value)?JSON.stringify(value.map(canonical)):value&&typeof value==='object'?JSON.stringify(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):JSON.stringify(value);
const materials=new Map();
export function nativeReviewLanguage(task){return task?.executionSnapshot?.languageExecution?taskLanguage(task).contentLanguage:null;}
export function reviewTask(state,item){if(typeof item==='string')item=state.tasks?.find(t=>t.id===item)||state.sessions?.find(s=>s.id===item);return item?.taskId?state.tasks?.find(t=>t.id===item.taskId):item;}
const materialKey=task=>canonical([task.id,task.executionSnapshot.languageMaterialRef,task.executionSnapshot.languageExecution]);
export function clearNativeReviewMaterials(){materials.clear();}
export function applyNativeReviewMaterial(task,material){
 if(!nativeReviewLanguage(task)||material?.schemaVersion!==1||material.taskId!==task.id||material.materialRef!==task.executionSnapshot.languageMaterialRef||canonical(material.languageExecution)!==canonical(task.executionSnapshot.languageExecution)||!Array.isArray(material.rules)||!Array.isArray(material.policies))throw new Error('Frozen display material does not match this task.');
 const basis=getTaskBasis({},task);
 for(const [kind,records]of [['rules',basis.rules],['policies',basis.policies]])for(const record of records||[])if(record.ruleKind!=='meta'&&!material[kind].some(r=>r.id===record.id&&r.version===record.version))throw new Error('Frozen display material is missing a task version.');
 materials.set(materialKey(task),structuredClone(material));
}
export function nativeReviewMaterial(task){return nativeReviewLanguage(task)?materials.get(materialKey(task)):undefined;}
export function createNativeReviewMaterialController({api,onChange=()=>{}}={}){
 const pending=new Map(),failed=new Set();let stopped=false;
 return{async ensure(task,{retry=false}={}){if(stopped||!nativeReviewLanguage(task))return;const key=materialKey(task);if(materials.has(key)||failed.has(key)&&!retry)return;if(pending.has(key))return pending.get(key);const request=Promise.resolve().then(()=>api(`/api/tasks/${encodeURIComponent(task.id)}/native-material`)).then(({material})=>{if(stopped)return;applyNativeReviewMaterial(task,material);failed.delete(key);onChange();}).catch(()=>{failed.add(key);if(!stopped)onChange();}).finally(()=>pending.delete(key));pending.set(key,request);return request;},stop(){stopped=true;}};
}
export function getReviewTaskBasis(state,item){
 const task=reviewTask(state,item),basis=getTaskBasis(state,item),language=nativeReviewLanguage(task);if(!language)return basis;
 const material=nativeReviewMaterial(task),missing=language==='en'?'Frozen material unavailable':'冻结材料暂不可用';
 const rules=(basis.rules||[]).map(rule=>{const selected=material?.rules.find(r=>r.id===rule.id&&r.version===rule.version);return{...rule,...(selected||{title:`${rule.id} · ${missing}`,scope:missing,passCriteria:missing,failCriteria:missing,exceptionCriteria:missing}),name:selected?.title||`${rule.id} · ${missing}`,nativeDisplayLanguage:language};});
 const policies=(basis.policies||[]).map(policy=>{const selected=material?.policies.find(p=>p.id===policy.id&&p.version===policy.version);const sections=selected?.sections||policy.sections?.map(s=>({id:s.id,title:s.id,text:missing}))||[];return{...policy,...(selected||{title:`${policy.id} · ${missing}`}),sections,content:sections.map(s=>s.text).join('\n\n'),nativeDisplayLanguage:language};});
 return{...basis,rules,policies};
}
export function getReviewSessionRules(state,item){const task=reviewTask(state,item);return inspectionRules(getReviewTaskBasis(state,item),task?.executionSnapshot);}
export function resolveReviewTaskReference(state,item,key){const task=reviewTask(state,item);if(!nativeReviewLanguage(task))return resolveTaskReference(state,item,key);const projected={...task,basisSnapshot:getReviewTaskBasis(state,item)};return resolveTaskReference({...state,tasks:[projected]},projected,key);}
export function reviewRuleDisplayName(record){return record?.nativeDisplayLanguage?record.title||record.name||record.id||'':ruleDisplayName(record);}
export function reviewMaterialText(value,task){return nativeReviewLanguage(task)?String(value??''):d(value);}
export function reviewMaterialContent(value,task){return nativeReviewLanguage(task)?`<span data-native-material>${escape(value)}</span>`:businessContent(value);}
export function nativeMaterialNotice(task){const language=nativeReviewLanguage(task);if(!language||nativeReviewMaterial(task))return'';return`<p class="soft-note warning" role="status">${language==='en'?'The frozen display material has not loaded.':'任务冻结的显示材料尚未加载。'} <button class="text-btn" data-act="native-material-retry" data-task="${escape(task.id)}">${language==='en'?'Reload frozen material':'重新加载冻结材料'}</button></p>`;}
export function nativeProseFinding(value,{task,result,path='reason'}={}){
 const language=nativeReviewLanguage(task);if(!language)return null;
 const sourceQuotes=[...(result?.evidenceQuotes||[]),...(result?.evidence||[])].map(q=>q?.quote).filter(q=>typeof q==='string'),checked=checkNativeProse(String(value??''),language,{sourceQuotes});
 const assurance=result?.languageValidation,field=assurance?.language===language?assurance.fields?.find(f=>f.path===path):null;
 // Saved assurance can verify short prose. A detected mismatch is never hidden.
 return{language,status:checked.status==='mismatch'?'mismatch':field?.status||checked.status};
}
export function nativeLanguageNotice(language){return language==='en'?'AI output language needs review. The original output is retained below.':'AI输出语种需核实；原始输出保留在下方。';}
export function nativeReasonContent(value,options={}){const finding=nativeProseFinding(value,options);if(!finding)return null;const text=String(value??'');if(!text)return'';return finding.status==='verified'?`<span class="ai-reason-content" data-reason-status="native" lang="${finding.language}">${escape(text)}</span>`:`<span class="ai-reason-content" data-reason-status="native-${finding.status}"><span>${nativeLanguageNotice(finding.language)}</span><details class="business-original ai-original-audit"><summary>${finding.language==='en'?'Original AI output':'AI原始输出'}</summary><span data-business-original dir="auto">${escape(text)}</span></details></span>`;}
export function nativeReasonRetryAvailable(session,task){return Boolean(nativeReviewLanguage(task)&&!isInactiveTask(task)&&session.review?.status!=='已确认'&&!Object.keys(session.review?.drafts||{}).length&&session.aiExecution?.status!=='running'&&((session.aiResults||[]).some(nativeLanguageIssue)||Object.values(session.sceneCapabilities?.outputs||{}).some(nativeLanguageIssue)));}
