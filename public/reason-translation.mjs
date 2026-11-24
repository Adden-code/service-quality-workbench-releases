import {getLocale} from './i18n.mjs';
import {createTranslationClient} from './content-translation-client.mjs';
import {sessionDisplayFields} from './session-display-fields.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const han=value=>/[\u3400-\u9fff]/u.test(value);
const needs=(text,lang)=>lang==='en'?/[^\p{Script=Latin}\P{L}]/u.test(text):!han(text)&&/\p{L}/u.test(text);
const values=new Map(),states=new Map();
const key=(text,lang)=>JSON.stringify([lang,text]);
export function clearReasonTranslations(){values.clear();states.clear();}
export function reasonText(value,lang=getLocale()){
 const text=String(value??'');if(!text||!needs(text,lang))return text;
 const entry=values.get(key(text,lang));if(entry)return entry;
 const status=states.get(key(text,lang));
 return lang==='en'?`[Original · ${status==='failed'?'translation unavailable':status==='loading'?'translating…':'translation pending'}] ${text}`:`[原文 · ${status==='failed'?'翻译暂不可用':status==='loading'?'翻译中…':'待翻译'}] ${text}`;
}
export function reasonContent(value){
 const text=String(value??''),translated=reasonText(text),lang=getLocale(),complete=translated!==text&&!translated.startsWith(lang==='en'?'[Original':'[原文');
 return `<span class="ai-reason-content" data-reason-status="${complete?'translated':needs(text,lang)?states.get(key(text,lang))||'pending':'original'}"><span>${escape(translated)}</span>${complete?`<details class="business-original" data-business-original><summary>${lang==='en'?'Original AI explanation':'AI理由原文'}</summary><span>${escape(text)}</span></details>`:''}</span>`;
}
export function reasonTranslationNotice(session){
 const lang=getLocale(),fields=sessionDisplayFields(session).filter(field=>needs(field.text,lang));
 if(!fields.length)return '';
 const missing=fields.filter(field=>!values.has(key(field.text,lang))),failed=missing.some(field=>states.get(key(field.text,lang))==='failed');
 return `<div class="reason-translation-status" role="status">${lang==='en'?(missing.length?(failed?'Some AI explanations could not be translated. Originals are shown.':'Translating AI explanations; originals are shown until ready.'):'AI explanations use cached English translations.'):(missing.length?(failed?'部分AI理由翻译暂不可用，保留原文。':'正在翻译AI理由，完成前保留原文。'):'AI理由已使用中文译文缓存。')}${failed?` <button class="text-btn" data-act="reason-translation-retry">${lang==='en'?'Retry missing explanations':'重试缺失理由翻译'}</button>`:''}</div>`;
}
/** Display jobs use the existing frozen-source translation pipeline. No workspace
 * writes or inspection calls are made. Source and language form the cache key. */
export function createReasonTranslationController({client,getToken,fetchImpl,onChange=()=>{},pollMs=700,autoPoll=true}={}){
 const api=client||createTranslationClient({getToken,fetchImpl}),attempts=new Map(),timers=new Map(),pendingIds=new Map();let stopped=false;
 const changed=()=>{if(!stopped)onChange();};
 function apply(result,entry){
  if(result.job?.targetLang!==entry.lang||JSON.stringify(result.sourceSnapshot?.fields)!==entry.signature)return false;
  if(result.job?.sourceFingerprint&&result.sourceFingerprint!==result.job.sourceFingerprint)return false;
  for(const item of result.translations||[]){const k=key(item.sourceText,entry.lang);if(['same','translated'].includes(item.status)&&item.text?.trim()){values.set(k,item.text);states.delete(k);}else states.set(k,item.status==='pending'&&result.job.status==='running'?'loading':'failed');}
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
 async function ensure(session,{retry=false,lang=getLocale()}={}){
  if(stopped||!session?.taskId)return;
  const fields=sessionDisplayFields(session),signature=JSON.stringify(fields),source={kind:'session-display',taskId:session.taskId,sessionId:session.id},id=JSON.stringify([source,lang,signature]);
  if(!fields.some(field=>needs(field.text,lang)))return;
  if(attempts.has(id)&&!retry)return attempts.get(id);
  const entry={id,fields,signature,source,lang};
  for(const field of fields)if(needs(field.text,lang)&&!values.has(key(field.text,lang)))states.set(key(field.text,lang),'loading');
  const promise=Promise.resolve().then(async()=>{
   // A persisted matching snapshot restores the display cache without a model call.
   if(pendingIds.has(id)){try{let {job}=await api.get(pendingIds.get(id));if(retry&&job.status==='paused'){await api.action(job.id,'resume');job=(await api.get(job.id)).job;}await consume(job,entry);pendingIds.delete(id);return;}catch(error){if(![404,409].includes(error.status))throw error;if(error.status===409)pendingIds.delete(id);}}
   const listed=await api.list(source);
   for(const job of listed.jobs||[]){if(job.targetLang!==lang)continue;const result=await api.result(job.id);if(apply(result,entry)){if(retry&&job.status!=='running'&&job.status!=='completed'){try{await api.action(job.id,job.status==='paused'?'resume':'retry');}catch(error){if(error.status===409)continue;throw error;}await consume((await api.get(job.id)).job,entry);}else await consume(job,entry);return;}}
   const jobId=pendingIds.get(id)||`UI-REASON-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;pendingIds.set(id,jobId);
   const {job}=await api.create({jobId,source,targetLang:lang});await consume(job,entry);pendingIds.delete(id);
  }).catch(()=>fail(entry));
  attempts.set(id,promise);queueMicrotask(changed);return promise;
 }
 return {ensure,stop(){stopped=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();}};
}
