import {e} from './ui.mjs';
import {getLocale} from './i18n.mjs';
const choices=[['符合','Pass'],['不符合','Fail'],['无法判定','Undetermined'],['不适用','Not applicable']];
export function rawInlineEditor(session,result,ui,readOnly){
 if(readOnly)return'';const en=getLocale()==='en',draft=ui.rawInlineDrafts?.[session.id]?.[result.ruleId],verdict=draft?.verdict||result.final?.verdict||result.verdict;
 return `<div class="raw-inline-editor" data-raw-inline="${e(result.ruleId)}"><div class="raw-inline-choices" role="group" aria-label="${en?'Human verdict':'人工结论'}">${choices.map(([zh,label],i)=>`<button class="btn small" data-act="raw-inline-verdict" data-rule="${e(result.ruleId)}" data-verdict="${zh}" aria-pressed="${verdict===zh}">${i+1} ${en?label:zh}</button>`).join('')}</div>${draft?`<label class="field-label" for="raw-inline-reason-${e(result.ruleId)}">${en?'Reason (optional for Pass)':'判定理由（符合可不填，其余必填）'}</label><textarea id="raw-inline-reason-${e(result.ruleId)}" class="field" data-raw-inline-reason="${e(result.ruleId)}" rows="2">${e(draft.reason||'')}</textarea><div class="toolbar-group"><button class="btn primary small" data-act="raw-inline-save" data-rule="${e(result.ruleId)}">${en?'Save this check':'保存本项'}</button><button class="text-btn" data-act="raw-inline-cancel" data-rule="${e(result.ruleId)}">${en?'Cancel edit':'取消修改'}</button><button class="text-btn" data-act="raw-edit-result" data-rule="${e(result.ruleId)}">${en?'Detailed edit':'详细编辑'}</button></div>`:''}</div>`;
}
export function rawInlineKeyboard(event){
 if(event.defaultPrevented||event.repeat||event.isComposing||event.altKey||event.metaKey)return;
 const card=event.target.closest?.('.raw-rule-card'),typing=event.target.closest?.('input,textarea,select,[contenteditable="true"]');
 if(event.ctrlKey&&event.key==='Enter'&&card){const button=document.querySelector('[data-act="raw-confirm-next"]');if(button&&!button.disabled){event.preventDefault();button.click();}return;}
 if(typing||!card)return;
 if(event.key==='Tab'&&event.target===card){const rows=[...document.querySelectorAll('.raw-rule-card[data-needs-attention="true"]')];if(rows.length){event.preventDefault();const i=rows.indexOf(card);rows[(i+(event.shiftKey?-1:1)+rows.length)%rows.length].focus();}}
 if(!event.ctrlKey&&!event.shiftKey&&/^[1-4]$/.test(event.key)){const button=card.querySelectorAll('[data-act="raw-inline-verdict"]')[Number(event.key)-1];if(button&&!button.disabled){event.preventDefault();button.click();}}
}
