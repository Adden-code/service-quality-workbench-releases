import {UI_EN as BASE_UI_EN} from './ui-locale-en.mjs';
import {UI_EXTRA_EN} from './ui-locale-extra-en.mjs';
import {ONBOARDING_EN} from './onboarding-locale-en.mjs';
import {TRIAGE_EN} from './triage-locale-en.mjs';
import {WORKFLOW096_EN} from './workflow096-locale-en.mjs';
import {WORKFLOW097_EN} from './workflow097-locale-en.mjs';
import {IMPORT098_EN} from './import098-locale-en.mjs';
import {RAW_EN} from './raw-locale-en.mjs';
import {RULE0104_EN} from './rule0104-locale-en.mjs';
import {TASK0104_EN} from './task0104-locale-en.mjs';
import {REVIEW0105_EN} from './review0105-locale-en.mjs';
import {OPERATIONS0105_EN} from './operations0105-locale-en.mjs';
import {PENDING0105_EN} from './pending0105-locale-en.mjs';
import {WORKFLOW0107_EN} from './workflow0107-locale-en.mjs';
import {OPERATOR01122_EN} from './operator01122-locale-en.mjs';
import {OPERATOR01123_EN} from './operator01123-locale-en.mjs';
const UI_EN=Object.freeze({...BASE_UI_EN,...UI_EXTRA_EN,...ONBOARDING_EN,...TRIAGE_EN,...WORKFLOW096_EN,...WORKFLOW097_EN,...IMPORT098_EN,...RAW_EN,...RULE0104_EN,...TASK0104_EN,...REVIEW0105_EN,...OPERATIONS0105_EN,...PENDING0105_EN,...WORKFLOW0107_EN,...OPERATOR01122_EN,...OPERATOR01123_EN});

export const LOCALE_STORAGE_KEY='service-quality-workbench:locale';
const browserStorage=()=>{try{return globalThis.localStorage;}catch{return undefined;}};
export function resolveInitialLocale(environment={document:globalThis.document,navigator:globalThis.navigator,storage:browserStorage()}){
  // Server-side renderers and existing Node contracts remain Chinese.
  if(!environment.document)return 'zh';
  try{const saved=environment.storage?.getItem(LOCALE_STORAGE_KEY);if(['zh','en'].includes(saved))return saved;}catch{}
  return /^zh(?:-|$)/i.test(environment.navigator?.language||environment.navigator?.languages?.[0]||'')?'zh':'en';
}
let locale=resolveInitialLocale();
const listeners=new Set();
export const getLocale=()=>locale;
export function setLocale(value,{storage=browserStorage()}={}){
  locale=value==='en'?'en':'zh';
  try{storage?.setItem(LOCALE_STORAGE_KEY,locale);}catch{}
  if(globalThis.document?.documentElement)globalThis.document.documentElement.lang=locale==='en'?'en':'zh-CN';
  for(const listener of listeners)listener(locale);
  return locale;
}
export function onLocaleChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}

const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(UI_EN).filter(([key])=>/\{\d+\}/.test(key)).sort(([a],[b])=>b.replace(/\{\d+\}/g,'').length-a.replace(/\{\d+\}/g,'').length).map(([key,value])=>{
  const ids=[];let at=0,pattern='';
  for(const match of key.matchAll(/\{(\d+)\}/g)){pattern+=escapeRegExp(key.slice(at,match.index))+'([\\s\\S]*?)';ids.push(match[1]);at=match.index+match[0].length;}
  pattern+=escapeRegExp(key.slice(at));return{regex:new RegExp(`^${pattern}$`,'u'),ids,value};
});
const substitute=(value,params)=>String(value).replace(/\{([^{}]+)\}/g,(all,key)=>Object.hasOwn(params,key)?String(params[key]??''):all);
export function t(text,params={}){
  const source=String(text??'');
  if(locale==='zh')return substitute(source,params);
  if(Object.hasOwn(UI_EN,source))return substitute(UI_EN[source],params);
  // Callers explicitly opt in for fixed UI messages assembled from numbers/IDs.
  // The dictionary contains every static segment; no business object is traversed.
  if(/[\u3400-\u9fff]/u.test(source))for(const {regex,ids,value} of patterns){const match=source.match(regex);if(match)return substitute(value,Object.fromEntries(ids.map((id,index)=>[id,match[index+1]])));}
  return substitute(source,params);
}

const marker=/\uE000(\d+)\uE001/g;
function staticText(text){
  const padding=text.match(/^(\s*)([\s\S]*?)(\s*)$/),values=[];
  const key=padding[2].replace(marker,all=>`{${values.push(all)-1}}`);
  if(!Object.hasOwn(UI_EN,key))return text;
  return padding[1]+substitute(UI_EN[key],values)+padding[3];
}
export function uiAttributes(text){
  if(locale!=='en')return String(text??'');
  return String(text??'').replace(/\b(aria-label|title|placeholder|alt)=(['"])([\s\S]*?)\2/g,(all,name,quote,value)=>`${name}=${quote}${staticText(value)}${quote}`);
}
/** Opt-in source templates only. Interpolated values never enter the UI dictionary.
 * Visible literal text and accessible labels are translated before values are
 * inserted. value/id/data-* attributes and escaped source facts are untouched.
 * This is not a rendered-page, DOM, or arbitrary-object translator.
 */
export function html(strings,...values){
  if(locale!=='en')return strings.reduce((out,part,index)=>out+part+(index<values.length?String(values[index]):''),'');
  const source=strings.map((part,index)=>part+(index<values.length?`\uE000${index}\uE001`:'' )).join('');
  const translated=source.split(/(<!--[\s\S]*?-->|<[^>]*>)/g).map(part=>part.startsWith('<')?uiAttributes(part):staticText(part)).join('');
  return translated.replace(marker,(_,index)=>String(values[Number(index)]));
}
export const uiLiteral=text=>html([String(text??'')]);
export function translateError(error){
  const source=String(error?.message??error??'');
  if(!source)return '';
  if(locale==='zh')return source;
  const translated=t(source);
  // Unknown Latin-script errors may be Spanish/French as well as English.
  // Only our mapped messages are trusted English; raw diagnostics stay in logs.
  if(!/[^\p{Script=Latin}\P{L}]/u.test(translated)&&(translated!==source||Object.values(UI_EN).includes(source)))return translated||'The operation could not be completed.';
  return 'The operation could not be completed. Check the current settings and retry; technical details remain in the original diagnostic log.';
}
export const uiLabel=value=>String(value??'').split(' · ').map(part=>t(part)).join(' · ');
export function formatDateTime(value){
  if(!value)return '—';if(/^\d{2}:\d{2}$/.test(String(value)))return String(value);
  const date=new Date(value);if(Number.isNaN(date.getTime()))return t('未提供');
  return new Intl.DateTimeFormat(locale==='en'?'en-GB':'zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
