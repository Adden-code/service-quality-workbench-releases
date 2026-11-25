import {getLocale,t,translateError} from './i18n.mjs';
import {createTranslationClient} from './content-translation-client.mjs';
import {builtinDisplayName,BUNDLED_DISPLAY_EN} from './builtin-display-en.mjs';
import {englishDisplayText} from './translation-language.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chinese=value=>/[\u3400-\u9fff]/u.test(String(value??''));
const translatedFields=new Map(),jobViews=new Map();
const sourceKey=source=>JSON.stringify(Object.fromEntries(Object.entries(source).sort(([a],[b])=>a.localeCompare(b))));
const label=(zh,en)=>getLocale()==='en'?en:zh;
export function clearBusinessTranslations(){translatedFields.clear();jobViews.clear();}
export function applyBusinessTranslations(result){
  for(const item of result?.translations||[]){
    if(typeof item.sourceText!=='string'||!['same','translated','failed','pending'].includes(item.status))continue;
    translatedFields.set(item.sourceText,['translated','same'].includes(item.status)&&!englishDisplayText(item.text)?{...item,text:'',status:'failed'}:{...item});
  }
}
/** Read-only display projection. Never use this for form values, IDs, source
 * quotes, exports, calculations, or writes back into the workspace. */
export function d(value){
  const source=String(value??'');if(getLocale()!=='en'||!source)return source;
  const item=translatedFields.get(source);
  if(item&&['translated','same'].includes(item.status)&&englishDisplayText(item.text))return item.text;
  if(BUNDLED_DISPLAY_EN[source])return BUNDLED_DISPLAY_EN[source];
  return chinese(source)?`[Original · English missing] ${source}`:source;
}
export function scenarioName(value){
  const source=String(value??'');
  return ['新品产品咨询','电商评论回复'].includes(source)?t(source):d(source);
}
export function ruleDisplayName(record){
 const name=record?.title||record?.name||record?.id||'';
 return getLocale()==='en'?(builtinDisplayName(record)||d(name)):name;
}
/** Long-form content keeps the original visible or available beside its derived
 * translation. Original data is escaped and never assigned back into state. */
export function businessContent(value,{quote=false}={}){
  const source=String(value??'');if(getLocale()!=='en'||!source)return e(source);
  const item=translatedFields.get(source),complete=item&&['translated','same'].includes(item.status)&&englishDisplayText(item.text);
  if(!complete&&BUNDLED_DISPLAY_EN[source])return `<span class="business-content translated"><small class="business-language-label">English translation</small><span>${e(BUNDLED_DISPLAY_EN[source])}</span><details class="business-original"><summary>Original</summary><span data-business-original>${e(source)}</span></details></span>`;
  if(complete&&item.status==='translated')return `<span class="business-content translated"><small class="business-language-label">English translation</small><span>${e(item.text)}</span><details class="business-original"><summary>Original${quote?' quote':''}</summary><span data-business-original>${e(source)}</span></details></span>`;
  if(complete)return `<span class="business-content"><small class="business-language-label">Original${quote?' quote':''} · Language verified</small><span data-business-original>${e(source)}</span></span>`;
  return `<span class="business-content original"><small class="business-language-label">Original${quote?' quote':''}${chinese(source)?' · English missing':''}</small><span data-business-original>${e(source)}</span></span>`;
}
const jobLabel=job=>({running:label('翻译进行中','Translation running'),paused:label('翻译已暂停','Translation paused'),completed:label('翻译已完成','Translation complete'),completed_with_warnings:label('翻译已完成，部分内容缺译','Translation complete with missing content')})[job?.status]||label('尚未翻译','Not translated');
export function translationControls(source){
  if(getLocale()!=='en'||!source)return '';
  const entry=jobViews.get(sourceKey(source)),job=entry?.job,progress=job?.progress||{},payload=e(JSON.stringify(source));
  const button=(action,text,disabled=false)=>`<button class="btn small" data-act="content-translation-${action}" data-source="${payload}" ${job?`data-job="${e(job.id)}"`:''} ${disabled?'disabled':''}>${e(text)}</button>`;
  return `<div class="content-translation-controls" role="region" aria-label="Business content translation"><div class="translation-actions">${button('start',job?'Translate current content':'Translate business content',entry?.busy||job?.status==='running')}${job?.status==='running'?button('pause','Pause'):job?.status==='paused'?button('resume','Resume'):''}${job&&(progress.failed||job.status==='completed_with_warnings')?button('retry','Retry missing translations'):''}${job?button('refresh','Refresh status',entry?.busy):''}</div><div class="translation-progress" role="status">${entry?.busy?'Sending request…':job?`${e(jobLabel(job))} · ${Number(progress.done)||0}/${Number(progress.total)||0} · ${Number(progress.failed)||0} failed${progress.pending?` · ${Number(progress.pending)} pending`:''}`:'Original business content is retained. Translation runs only when requested, using the configured model.'}${entry?.error?`<span class="translation-error">${e(translateError(entry.error))}</span>`:''}${job?.warningsCount?`<span>${Number(job.warningsCount)} warnings · Original content remains available</span>`:''}</div></div>`;
}

export function createContentTranslationController({client,getToken,fetchImpl,onChange=()=>{},autoPoll=true,pollMs=900}={}){
  const api=client||createTranslationClient({getToken,fetchImpl}),timers=new Map(),inflight=new Map();let stopped=false;
  const changed=()=>{if(!stopped)onChange();};
  function update(source,patch){const key=sourceKey(source),entry={...(jobViews.get(key)||{}),...patch,source};jobViews.set(key,entry);changed();return entry;}
  function schedule(source,job){
    clearTimeout(timers.get(job.id));timers.delete(job.id);
    if(stopped||!autoPoll||job.status!=='running')return;
    timers.set(job.id,setTimeout(()=>{timers.delete(job.id);refresh(source,job.id).catch(()=>{});},pollMs));
  }
  async function consume(source,job){
    if(stopped)return job;
    if(job.source&&sourceKey(job.source)!==sourceKey(source))throw new Error('The translation job does not match the selected source. Refresh before trying again.');
    if(job.targetLang&&job.targetLang!=='en')throw new Error('The translation job does not target English.');
    update(source,{job,busy:false,error:'',pendingJobId:undefined});
    if(job.resultAvailable||['completed','completed_with_warnings'].includes(job.status)){
      const result=await api.result(job.id);if(stopped)return job;
      if(job.sourceFingerprint&&result.sourceFingerprint!==job.sourceFingerprint)throw new Error('The translated result does not match the frozen source.');
      applyBusinessTranslations(result);update(source,{job:result.job||job,busy:false,error:''});
    }
    schedule(source,job);return job;
  }
  async function perform(source,key,request){
    if(stopped)return null;if(inflight.has(key))return inflight.get(key);
    const promise=(async()=>{update(source,{busy:true,error:''});try{const {job}=await request();return await consume(source,job);}catch(error){update(source,{busy:false,error:error.message});throw error;}finally{inflight.delete(key);}})();
    inflight.set(key,promise);return promise;
  }
  function start(source){
    const frozen=JSON.parse(JSON.stringify(source)),key=sourceKey(frozen);
    // Source selectors only; text and browser state never enter the request.
    const allowed={session:['kind','taskId','sessionId'],task:['kind','taskId'],rule:['kind','id','version'],policy:['kind','id','version'],catalog:['kind','section'],scenario:['kind','id']}[frozen.kind];
    if(!allowed||Object.keys(frozen).some(field=>!allowed.includes(field))||allowed.some(field=>typeof frozen[field]!=='string'||!frozen[field].trim()))return Promise.reject(new Error('Unsupported translation source selector. Text cannot be submitted from the browser.'));
    const prior=jobViews.get(key),jobId=prior?.pendingJobId||`UI-TRANS-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    if(!prior?.pendingJobId)update(frozen,{pendingJobId:jobId,job:{id:jobId,source:frozen,targetLang:'en',status:'pending',progress:{done:0,total:0,failed:0,pending:0}}});
    return perform(frozen,`create:${key}`,async()=>{
      // A lost create acknowledgement is recovered with the original job ID.
      // A second click never silently starts a second model translation.
      if(prior?.pendingJobId)try{return await api.get(jobId);}catch(error){if(error.status!==404)throw error;}
      return api.create({jobId,source:frozen,targetLang:'en'});
    });
  }
  function refresh(source,id){return perform(source,`job:${id}`,()=>api.get(id));}
  async function action(source,id,name){
    clearTimeout(timers.get(id));timers.delete(id);
    // Do not lose an explicit pause/resume while a progress GET is in flight.
    const pending=inflight.get(`job:${id}`);if(pending)try{await pending;}catch{}
    clearTimeout(timers.get(id));timers.delete(id);
    return perform(source,`job:${id}`,()=>api.action(id,name));
  }
  return{start,refresh,action,
    async handleAction(name,button){
      if(!name.startsWith('content-translation-'))return false;
      const actionName=name.slice('content-translation-'.length),source=JSON.parse(button.dataset.source);
      if(actionName==='start')await start(source);else if(actionName==='refresh')await refresh(source,button.dataset.job);else if(['pause','resume','retry'].includes(actionName))await action(source,button.dataset.job,actionName);else throw new Error('Unsupported translation action.');
      return true;
    },
    stop(){stopped=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();},
  };
}

export function applyBundledRuleEnglish(catalog,state={}){
 const records=[...(catalog?.rules||[]),...(state.tasks||[]).flatMap(t=>t.basisSnapshot?.rules||[])];
 applyBusinessTranslations({translations:records.filter(r=>r.english).flatMap(r=>['title','summary','scope'].map(k=>({sourceText:r[k],text:r.english[k],status:'translated'})))});
}
