import {getSessionResults} from './domain.mjs';
import {t,uiLabel,formatDateTime,html} from './i18n.mjs';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const e=escapeHTML;
// Official Feather 4.29.2 sprite, vendored locally with its MIT license.
const iconNames={overview:'grid',tasks:'clipboard',review:'file-text',rules:'shield',knowledge:'book-open',export:'download',search:'search',plus:'plus',chevron:'chevron-right',down:'chevron-down',check:'check',clock:'clock',alert:'alert-triangle',info:'info',close:'x',arrow:'arrow-right',back:'arrow-left',file:'file-text',reset:'rotate-ccw',edit:'edit-3',spark:'zap',link:'link',play:'play',filter:'filter',trend:'trending-up',eye:'eye',folder:'folder'};
export const icon=(name,size=18)=>`<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="./vendor/feather-sprite.svg#${iconNames[name]||'file-text'}"></use></svg>`;
export function badge(text,kind){const k=kind||({'不符合':'danger','符合':'success','无法判定':'warning','不适用':'muted','待审核':'warning','已暂存':'blue','待补充':'warning','已确认':'success','已完成':'success','质检中':'blue','待质检':'muted'}[text]||'muted');return `<span class="badge ${e(k)}"><i></i>${e(uiLabel(text))}</span>`;}
export const dateTime=formatDateTime;
export const shortDate=value=>value?String(value).slice(5,10).replace('-','.'):'—';
export const percent=value=>`${Math.round(Number(value)||0)}%`;
export const empty=(title,detail='可以调整筛选条件，或上传业务原文件创建任务。')=>html`<div class="empty">${icon('folder',34)}<h3>${e(t(title))}</h3><p>${e(t(detail))}</p></div>`;
export function finalResult(session,result){return session.review.drafts[result.ruleId]||result;}
export function issueCount(session){return getSessionResults(session).filter(r=>(r.final||r).verdict==='不符合').length;}
export function humanChanged(session){return getSessionResults(session).some(r=>r.changed);}
export function focusCycleTarget(elements,active,reverse=false){
  if(!elements.length)return null;
  if(!elements.includes(active))return reverse?elements.at(-1):elements[0];
  if(reverse&&active===elements[0])return elements.at(-1);
  if(!reverse&&active===elements.at(-1))return elements[0];
  return null;
}
