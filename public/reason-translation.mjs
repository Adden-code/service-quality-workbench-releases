import {getLocale} from './i18n.mjs';
import {createTranslationClient} from './content-translation-client.mjs';
import {sessionDisplayFields,sessionDisplayEntries} from './session-display-fields.mjs';
import {englishDisplayText} from './translation-language.mjs';
import {nativeLanguageIssue} from './native-language-validation.mjs';
import {nativeReviewLanguage,nativeProseFinding,nativeReasonContent,nativeLanguageNotice,nativeReasonRetryAvailable} from './native-review-language.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const han=value=>/[\u3400-\u9fff]/u.test(value);
// Latin script is not proof of English (Spanish/French can be ASCII too).
// Every AI prose value needs a matching English translation/verification job.
const needs=(text,lang)=>lang==='en'?/\p{L}/u.test(text):!han(text)&&/\p{L}/u.test(text);
const values=new Map(),states=new Map();
const key=(text,lang)=>JSON.stringify([lang,text]);
export function clearReasonTranslations(){values.clear();states.clear();}
export function reasonText(value,lang=getLocale(),options={}){
 const finding=nativeProseFinding(value,options);if(finding)return finding.status==='verified'?String(value??''):nativeLanguageNotice(finding.language);
 const text=String(value??'');if(!text||!needs(text,lang))return text;
 const entry=values.get(key(text,lang));if(entry)return entry;
 const status=states.get(key(text,lang));
 return lang==='en'?`[${status==='failed'?'Translation unavailable — retry required':status==='loading'?'Translating AI content…':'Translation pending'}]`:`[原文 · ${status==='failed'?'翻译暂不可用':status==='loading'?'翻译中…':'待翻译'}] ${text}`;
}
export function reasonContent(value,options={}){
 const native=nativeReasonContent(value,options);if(native!==null)return native;
 const text=String(value??''),translated=reasonText(text),lang=getLocale(),complete=values.has(key(text,lang)),missing=needs(text,lang)&&!complete;
 return `<span class="ai-reason-content" data-reason-status="${complete?'translated':missing?states.get(key(text,lang))||'pending':'original'}"><span>${escape(translated)}</span>${complete||missing?`<details class="business-original ai-original-audit"><summary>${lang==='en'?'Original AI explanation':'AI理由原文'}</summary><span data-business-original>${escape(text)}</span></details>`:''}</span>`;
}
export function reasonTranslationNotice(session,task){
 const nativeLanguage=nativeReviewLanguage(task);if(nativeLanguage){const missing=sessionDisplayEntries(session,task).filter(field=>nativeProseFinding(field.text,{task,result:field.result,path:field.path}).status!=='verified'),issue=(session.aiResults||[]).some(nativeLanguageIssue)||Object.values(session.sceneCapabilities?.outputs||{}).some(nativeLanguageIssue);if(!missing.length&&!issue)return'';return `<div class="reason-translation-status" data-native-language-notice role="status">${nativeLanguageNotice(nativeLanguage)}${nativeReasonRetryAvailable(session,task)?` <button class="text-btn" data-act="native-language-retry" data-session="${escape(session.id)}" data-task="${escape(task.id)}">${nativeLanguage==='en'?'Retry original input in the frozen language':'按冻结语种重试原始输入'}</button>`:''}</div>`;}
 const lang=getLocale(),fields=sessionDisplayFields(session,task).filter(field=>needs(field.text,lang));
 if(!fields.length)return '';
 const missing=fields.filter(field=>!values.has(key(field.text,lang))),failed=missing.some(field=>states.get(key(field.text,lang))==='failed'),loading=missing.some(field=>states.get(key(field.text,lang))==='loading');
 return `<div class="reason-translation-status" role="status">${lang==='en'?(missing.length?(failed?'Some AI content could not be translated. Retry to load English. Original AI output is available in the collapsed audit.':loading?'Translating AI content into English. Original AI output is available in the collapsed audit.':'English translation is pending. Original AI output is available in the collapsed audit.'):'AI content uses cached English translations.'):(missing.length?(failed?'部分AI理由翻译暂不可用，保留原文。':'正在翻译AI理由，完成前保留原文。'):'AI理由已使用中文译文缓存。')}${missing.length&&!loading?` <button class="text-btn" data-act="reason-translation-retry" data-session="${escape(session.id)}">${lang==='en'?(failed?'Retry missing explanations':'Translate AI content'):'翻译AI理由'}</button>`:''}</div>`;
}
/** Display jobs use the existing frozen-source translation pipeline. No workspace
 * writes or inspection calls are made. Source and language form the cache key. */
export function createReasonTranslationController({client,getToken,fetchImpl,onChange=()=>{},pollMs=700,autoPoll=true}={}){
 const api=client||createTranslationClient({getToken,fetchImpl}),attempts=new Map(),timers=new Map(),pendingIds=new Map(),recoveries=new Map(),active=new Set(),running=new Set(),failures=new Map(),attemptCounts=new Map();let stopped=false,configurationReady=false;
 const changed=()=>{if(!stopped)onChange();};
 function apply(result,entry){
  if(result.job?.targetLang!==entry.lang||JSON.stringify(result.sourceSnapshot?.fields)!==entry.signature)return false;
  if(result.job?.sourceFingerprint&&result.sourceFingerprint!==result.job.sourceFingerprint)return false;
  const fields=new Map(entry.fields.map(field=>[field.id,field.text]));
  for(const item of result.translations||[]){if(fields.get(item.id)!==item.sourceText)continue;const k=key(item.sourceText,entry.lang);if(['same','translated'].includes(item.status)&&item.text?.trim()&&(entry.lang==='en'?englishDisplayText(item.text):!needs(item.text,entry.lang))){values.set(k,item.text);states.delete(k);}else states.set(k,item.status==='pending'&&result.job.status==='running'?'loading':'failed');}
  if(result.job.status!=='running')for(const field of entry.fields)if(needs(field.text,entry.lang)&&!values.has(key(field.text,entry.lang)))states.set(key(field.text,entry.lang),'failed');
  return true;
 }
 async function consume(job,entry){
  if(stopped)return;
  if(JSON.stringify(job.source)!==JSON.stringify(entry.source)||job.targetLang!==entry.lang)throw new Error('Translation source or language mismatch');
  const result=await api.result(job.id);if(stopped)return;
  if(!apply(result,entry))throw new Error('Translation source changed; original explanation retained');
  failures.delete(entry.id);if(job.status==='running')running.add(entry.id);else running.delete(entry.id);
  // A first missing result may be repaired automatically; the recovery budget
  // stops a permanently failing model from looping on every redraw/navigation.
  if(job.status==='completed_with_warnings'&&(recoveries.get(entry.id)||0)<1)failures.set(entry.id,0);
  changed();
  if(job.status==='running'&&autoPoll){clearTimeout(timers.get(entry.id));timers.set(entry.id,setTimeout(()=>api.get(job.id).then(({job})=>consume(job,entry)).catch(()=>fail(entry)),pollMs));}
 }
 function fail(entry){running.delete(entry.id);failures.set(entry.id,Date.now());for(const field of entry.fields)if(!values.has(key(field.text,entry.lang)))states.set(key(field.text,entry.lang),'failed');changed();if(autoPoll&&(attemptCounts.get(entry.id)||0)<2){clearTimeout(timers.get(entry.id));timers.set(entry.id,setTimeout(changed,3100));}}
 async function ensure(session,{retry=false,lang=getLocale(),task}={}){
  if(stopped||!session?.taskId||nativeReviewLanguage(task))return;
  const fields=sessionDisplayFields(session,task),signature=JSON.stringify(fields),source={kind:'session-display',taskId:session.taskId,sessionId:session.id},id=JSON.stringify([source,lang,signature]);
  if(!fields.some(field=>needs(field.text,lang)&&!values.has(key(field.text,lang))))return;
  if(active.has(id))return attempts.get(id);
  if(attempts.has(id)&&!retry){if(!failures.has(id)||(attemptCounts.get(id)||0)>=2||Date.now()-failures.get(id)<3000)return attempts.get(id);}
  active.add(id);attemptCounts.set(id,(attemptCounts.get(id)||0)+1);
  const entry={id,fields,signature,source,lang};
  for(const field of fields)if(needs(field.text,lang)&&!values.has(key(field.text,lang)))states.set(key(field.text,lang),'loading');
  const promise=Promise.resolve().then(async()=>{
   // A persisted matching snapshot restores the display cache without a model call.
   const recover=async job=>{const used=recoveries.get(id)||0,automatic=!retry&&used<1&&(job.status==='paused'&&(job.stopReason==='interrupted'||configurationReady&&job.stopReason==='configuration_changed')||job.status==='completed_with_warnings'&&!['configuration_changed','storage_error','user_paused'].includes(job.stopReason));if((retry||automatic)&&job.status!=='running'&&job.status!=='completed'){if(automatic)recoveries.set(id,used+1);await api.action(job.id,job.status==='paused'?'resume':'retry');return(await api.get(job.id)).job;}return job;};
   if(pendingIds.has(id)){try{let {job}=await api.get(pendingIds.get(id));job=await recover(job);await consume(job,entry);pendingIds.delete(id);return;}catch(error){if(![404,409].includes(error.status))throw error;if(error.status===409)pendingIds.delete(id);}}
   const listed=await api.list(source);
   for(const job of listed.jobs||[]){if(job.targetLang!==lang)continue;const result=await api.result(job.id);if(apply(result,entry)){if(retry&&job.status==='completed'&&fields.some(field=>needs(field.text,lang)&&!values.has(key(field.text,lang))))continue;try{await consume(await recover(job),entry);}catch(error){if(error.status===409){await consume(job,entry);}else throw error;}return;}}
   const jobId=pendingIds.get(id)||`UI-REASON-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;pendingIds.set(id,jobId);
   const {job}=await api.create({jobId,source,targetLang:lang});await consume(job,entry);pendingIds.delete(id);
  }).catch(()=>fail(entry)).finally(()=>{active.delete(id);changed();});
  attempts.set(id,promise);queueMicrotask(changed);return promise;
 }
 return {ensure,configurationRecovered(){configurationReady=true;for(const id of attempts.keys())if(!active.has(id)&&!running.has(id)){attempts.delete(id);failures.delete(id);attemptCounts.delete(id);recoveries.delete(id);}changed();},ensureNext(sessions,{taskFor=()=>undefined,lang=getLocale()}={}){if(stopped||active.size||running.size)return;for(const session of sessions||[]){const task=taskFor(session);if(nativeReviewLanguage(task))continue;const fields=sessionDisplayFields(session,task),source={kind:'session-display',taskId:session.taskId,sessionId:session.id},id=JSON.stringify([source,lang,JSON.stringify(fields)]),retryDue=failures.has(id)&&(attemptCounts.get(id)||0)<2&&Date.now()-failures.get(id)>=3000;if((!attempts.has(id)||retryDue)&&fields.some(field=>needs(field.text,lang)&&!values.has(key(field.text,lang))))return ensure(session,{task,lang});}},stop(){stopped=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();}};
}
