import {getLocale} from './i18n.mjs';
import {createTranslationClient} from './content-translation-client.mjs';
import {englishDisplayText} from './translation-language.mjs';
import {rulePreparationFields,sceneDraftFields,adminDraftFieldLabel} from './admin-draft-fields.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canonical=value=>JSON.stringify(value,Object.keys(value).sort());
const cache=new Map(),key=d=>JSON.stringify([canonical(d.source),d.fields]);
export function clearAdminDraftTranslations(){cache.clear();}
export function adminDraftDescriptor(dialog){
 if(dialog?.type==='rule-import'&&dialog.prepared?.preparationId){
  const fields=rulePreparationFields(dialog.prepared);
  return{source:{kind:'rule-preparation',preparationId:dialog.prepared.preparationId},fields,dirty:JSON.stringify(rulePreparationFields({candidates:dialog.candidates}))!==JSON.stringify(dialog.preparedEditorFields||fields)};
 }
 if(dialog?.type==='scfg-edit'&&dialog.draft?.preparation)return{source:{kind:'scene-draft',draftId:dialog.draft.id,revision:String(dialog.draft.revision)},fields:sceneDraftFields(dialog.draft),dirty:Boolean(dialog.dirty)};
 return null;
}
export function adminDraftTranslationPanel(dialog){
 const d=adminDraftDescriptor(dialog);if(getLocale()!=='en')return '';
 if(!d)return '<section class="soft-note" data-admin-draft-preview><h3>English AI draft preview</h3><p>Translation source is unavailable. Generate a new draft to load an English preview. Original AI content remains in the collapsed audit.</p></section>';
 const entry=cache.get(key(d)),state=entry?.state||'pending';
 if(d.dirty)return '<section class="soft-note" data-admin-draft-preview><h3>English AI draft preview</h3><p>The original draft has unsaved edits. Save the draft to translate its saved version. Original editing remains in the collapsed audit.</p></section>';
 const visible=d.fields.filter(f=>dialog.type!=='scfg-edit'||(dialog.tab==='rules'?/^(rules|unresolved)\./.test(f.id):dialog.tab==='delivery'?f.id.startsWith('delivery.'):! /^(rules|unresolved|delivery)\./.test(f.id)));
 const missing=d.fields.some(f=>!entry?.values?.has(f.id));
 return `<section class="soft-note" data-admin-draft-preview><h3>English AI draft preview</h3><p role="status">${missing?(state==='failed'?'Translation unavailable. Retry to load English.':state==='loading'?'Translating the saved AI draft into English…':'English translation pending.'):'English display translations loaded.'} This preview does not change the original draft or its source references.</p>${missing&&state!=='loading'?'<button class="btn" data-act="admin-draft-translation-retry">Retry English translation</button>':''}<dl>${visible.map(f=>`<dt>${escape(adminDraftFieldLabel(f.id))}</dt><dd style="white-space:pre-wrap">${escape(entry?.values?.get(f.id)||'[English translation pending]')}</dd>`).join('')}</dl></section>`;
}
export function refreshAdminDraftPreview(dialog,root=globalThis.document){const panel=root?.querySelector?.('[data-admin-draft-preview]');if(panel)panel.outerHTML=adminDraftTranslationPanel(dialog);}
export function adminDraftOriginalOpen(dialog){return getLocale()==='en'?`${adminDraftTranslationPanel(dialog)}<details class="business-original ai-original-audit" data-dialog-disclosure="admin-draft-original"><summary>Original AI draft and source references (edit original)</summary>`:'';}
export function adminDraftOriginalClose(){return getLocale()==='en'?'</details>':'';}

/** Auto-load persistent, source-bound translation jobs. No client text is posted,
 * and no translated value is ever assigned to a candidate or package. */
export function createAdminDraftTranslationController({client,getToken,fetchImpl,onChange=()=>{},pollMs=700,autoPoll=true}={}){
 const api=client||createTranslationClient({getToken,fetchImpl}),attempts=new Map(),timers=new Map(),pendingIds=new Map();let stopped=false;
 const changed=()=>{if(!stopped)onChange();};
 function apply(result,d,entry){
  if(result.job?.targetLang!=='en'||canonical(result.job?.source||{})!==canonical(d.source)||canonical(result.sourceSnapshot?.source||{})!==canonical(d.source)||JSON.stringify(result.sourceSnapshot?.fields)!==JSON.stringify(d.fields)||!/^[a-f0-9]{64}$/.test(result.sourceFingerprint||'')||result.sourceFingerprint!==result.job.sourceFingerprint)return false;
  const originals=new Map(d.fields.map(f=>[f.id,f.text]));
  for(const item of result.translations||[])if(originals.get(item.id)===item.sourceText&&['same','translated'].includes(item.status)&&englishDisplayText(item.text))entry.values.set(item.id,item.text);
  entry.state=d.fields.every(f=>entry.values.has(f.id))?'completed':result.job.status==='running'?'loading':'failed';return true;
 }
 async function consume(job,d,entry,id){
  if(stopped)return;
  if(!apply(await api.result(job.id),d,entry))throw new Error('Draft translation source mismatch');changed();
  if(job.status==='running'&&autoPoll){clearTimeout(timers.get(id));timers.set(id,setTimeout(()=>api.get(job.id).then(({job})=>consume(job,d,entry,id)).catch(()=>fail(entry)),pollMs));}
 }
 function fail(entry){entry.state='failed';changed();}
 async function ensure(dialog,{retry=false,lang=getLocale()}={}){
  const d=adminDraftDescriptor(dialog);if(stopped||lang!=='en'||!d||d.dirty||!d.fields.length)return;
  const id=key(d);if(attempts.has(id)&&!retry)return attempts.get(id);
  const entry=cache.get(id)||{values:new Map()};entry.state='loading';cache.set(id,entry);
  const run=Promise.resolve().then(async()=>{
   const listed=await api.list(d.source);
   const jobs=[...(listed.jobs||[])];
   if(pendingIds.has(id)&&!jobs.some(j=>j.id===pendingIds.get(id))){try{jobs.unshift((await api.get(pendingIds.get(id))).job);}catch(error){if(error.status!==404)throw error;}}
   for(let job of jobs){
    if(job.targetLang!=='en')continue;
    if(!apply(await api.result(job.id),d,entry))continue;
    if(retry&&entry.state==='failed'){
     if(job.status==='completed')continue;
     try{await api.action(job.id,job.status==='paused'?'resume':'retry');job=(await api.get(job.id)).job;}catch(error){if(error.status===409)continue;throw error;}
    }
    pendingIds.delete(id);await consume(job,d,entry,id);return;
   }
   const jobId=pendingIds.get(id)||`UI-DRAFT-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;pendingIds.set(id,jobId);
   const {job}=await api.create({jobId,source:d.source,targetLang:'en'});pendingIds.delete(id);await consume(job,d,entry,id);
  }).catch(()=>fail(entry));attempts.set(id,run);queueMicrotask(changed);return run;
 }
 return{ensure,stop(){stopped=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();}};
}
