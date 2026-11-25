import {getLocale} from './i18n.mjs';
import {createTranslationClient} from './content-translation-client.mjs';
import {sessionDisplayFields} from './session-display-fields.mjs';
import {englishDisplayText} from './translation-language.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const han=value=>/[\u3400-\u9fff]/u.test(value);
// Latin script is not proof of English (Spanish/French can be ASCII too).
// Every AI prose value needs a matching English translation/verification job.
const needs=(text,lang)=>lang==='en'?/\p{L}/u.test(text):!han(text)&&/\p{L}/u.test(text);
const values=new Map(),states=new Map();
const key=(text,lang)=>JSON.stringify([lang,text]);
export function clearReasonTranslations(){values.clear();states.clear();}
export function reasonText(value,lang=getLocale()){
 const text=String(value??'');if(!text||!needs(text,lang))return text;
 const entry=values.get(key(text,lang));if(entry)return entry;
 const status=states.get(key(text,lang));
 return lang==='en'?`[${status==='failed'?'Translation unavailable — retry required':status==='loading'?'Translating AI content…':'Translation pending'}]`:`[原文 · ${status==='failed'?'翻译暂不可用':status==='loading'?'翻译中…':'待翻译'}] ${text}`;
}
export function reasonContent(value){
 const text=String(value??''),translated=reasonText(text),lang=getLocale(),complete=values.has(key(text,lang)),missing=needs(text,lang)&&!complete;
 return `<span class="ai-reason-content" data-reason-status="${complete?'translated':missing?states.get(key(text,lang))||'pending':'original'}"><span>${escape(translated)}</span>${complete||missing?`<details class="business-original ai-original-audit"><summary>${lang==='en'?'Original AI explanation':'AI理由原文'}</summary><span data-business-original>${escape(text)}</span></details>`:''}</span>`;
}
export function reasonTranslationNotice(session,task){
 const lang=getLocale(),fields=sessionDisplayFields(session,task).filter(field=>needs(field.text,lang));
 if(!fields.length)return '';
 const missing=fields.filter(field=>!values.has(key(field.text,lang))),failed=missing.some(field=>states.get(key(field.text,lang))==='failed'),loading=missing.some(field=>states.get(key(field.text,lang))==='loading');
 return `<div class="reason-translation-status" role="status">${lang==='en'?(missing.length?(failed?'Some AI content could not be translated. Retry to load English. Original AI output is available in the collapsed audit.':loading?'Translating AI content into English. Original AI output is available in the collapsed audit.':'English translation is pending. Original AI output is available in the collapsed audit.'):'AI content uses cached English translations.'):(missing.length?(failed?'部分AI理由翻译暂不可用，保留原文。':'正在翻译AI理由，完成前保留原文。'):'AI理由已使用中文译文缓存。')}${missing.length&&!loading?` <button class="text-btn" data-act="reason-translation-retry" data-session="${escape(session.id)}">${lang==='en'?(failed?'Retry missing explanations':'Translate AI content'):'翻译AI理由'}</button>`:''}</div>`;
}
/** Display jobs use the existing frozen-source translation pipeline. No workspace
 * writes or inspection calls are made. Source and language form the cache key. */
export function createReasonTranslationController({client,getToken,fetchImpl,onChange=()=>{},pollMs=700,autoPoll=true}={}){
 const api=client||createTranslationClient({getToken,fetchImpl}),attempts=new Map(),timers=new Map(),pendingIds=new Map();let stopped=false;
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
  changed();
  if(job.status==='running'&&autoPoll){clearTimeout(timers.get(entry.id));timers.set(entry.id,setTimeout(()=>api.get(job.id).then(({job})=>consume(job,entry)).catch(()=>fail(entry)),pollMs));}
 }
 function fail(entry){for(const field of entry.fields)if(!values.has(key(field.text,entry.lang)))states.set(key(field.text,entry.lang),'failed');changed();}
 async function ensure(session,{retry=false,lang=getLocale(),task}={}){
  if(stopped||!session?.taskId)return;
  const fields=sessionDisplayFields(session,task),signature=JSON.stringify(fields),source={kind:'session-display',taskId:session.taskId,sessionId:session.id},id=JSON.stringify([source,lang,signature]);
  if(!fields.some(field=>needs(field.text,lang)))return;
  if(attempts.has(id)&&!retry)return attempts.get(id);
  const entry={id,fields,signature,source,lang};
  for(const field of fields)if(needs(field.text,lang)&&!values.has(key(field.text,lang)))states.set(key(field.text,lang),'loading');
  const promise=Promise.resolve().then(async()=>{
   // A persisted matching snapshot restores the display cache without a model call.
   if(pendingIds.has(id)){try{let {job}=await api.get(pendingIds.get(id));if(retry&&job.status==='paused'){await api.action(job.id,'resume');job=(await api.get(job.id)).job;}await consume(job,entry);pendingIds.delete(id);return;}catch(error){if(![404,409].includes(error.status))throw error;if(error.status===409)pendingIds.delete(id);}}
   const listed=await api.list(source);
   for(const job of listed.jobs||[]){if(job.targetLang!==lang)continue;const result=await api.result(job.id);if(apply(result,entry)){if(retry&&job.status==='completed'&&fields.some(field=>needs(field.text,lang)&&!values.has(key(field.text,lang))))continue;if(retry&&job.status!=='running'&&job.status!=='completed'){try{await api.action(job.id,job.status==='paused'?'resume':'retry');}catch(error){if(error.status===409)continue;throw error;}await consume((await api.get(job.id)).job,entry);}else await consume(job,entry);return;}}
   const jobId=pendingIds.get(id)||`UI-REASON-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;pendingIds.set(id,jobId);
   const {job}=await api.create({jobId,source,targetLang:lang});await consume(job,entry);pendingIds.delete(id);
  }).catch(()=>fail(entry));
  attempts.set(id,promise);queueMicrotask(changed);return promise;
 }
 return {ensure,stop(){stopped=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();}};
}
