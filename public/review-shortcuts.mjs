// Keyboard shortcuts only request the same actions exposed by the review UI.
// Confirmation, evidence validation and persistence remain with those actions.
const inputSelector='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"],[role="slider"]';
function acceptsText(element){
  return Boolean(element?.isContentEditable||element?.closest?.(inputSelector)||['INPUT','TEXTAREA','SELECT'].includes(element?.tagName));
}

export function reviewShortcutAction(event,context={}){
  if(!event||context.page!=='review'||context.dialogOpen||context.saving||context.dirty||context.composing||event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229)return null;
  const path=event.composedPath?.()||[event.target];
  if(path.some(acceptsText)||acceptsText(context.activeElement))return null;
  if(event.altKey||event.metaKey||event.shiftKey)return null;
  const key=String(event.key||'').toLowerCase();
  const ids=(context.queue||[]).map(row=>typeof row==='string'?row:row.id),index=ids.indexOf(context.selectedId);
  // Never substitute the first row when selection and rendered scope disagree.
  if(index<0)return null;
  if(event.ctrlKey)return key==='enter'?{kind:'confirm'}:null;
  if(key==='e')return {kind:'edit'};
  if(key!=='j'&&key!=='k')return null;
  const target=index+(key==='j'?1:-1);
  return target>=0&&target<ids.length?{kind:'navigate',sessionId:ids[target]}:null;
}

export function createReviewShortcutHandler({getContext,onNavigate,onEdit,onConfirm}){
  return event=>{
    const action=reviewShortcutAction(event,getContext());
    if(!action)return false;
    const callback={navigate:onNavigate,edit:onEdit,confirm:onConfirm}[action.kind];
    if(typeof callback!=='function')return false;
    // A callback may return false when the current view has no enabled action.
    // It must reuse the normal action handler; this module never commits data.
    const handled=callback(action);
    if(handled===false)return false;
    event.preventDefault();
    return true;
  };
}

function unavailable(control,root,{allowCollapsed=false}={}){
  if(control.disabled||control.getAttribute?.('aria-disabled')==='true')return true;
  for(let element=control;element;element=element.parentElement){
    if(element.inert||element.getAttribute?.('aria-hidden')==='true')return true;
    if(element.hidden&&!(allowCollapsed&&element.classList?.contains('result-details')))return true;
    if(element===root)break;
  }
  // A collapsed result card still has a visible heading; its edit button opens
  // the existing dialog directly. Fully hidden cards/views are not candidates.
  const visible=allowCollapsed?control.closest?.('.result-card')||control:control;
  return typeof visible.getClientRects==='function'&&visible.getClientRects().length===0;
}

export function firstReviewActionControl(root,kind){
  if(!root?.querySelectorAll)return null;
  const selector=kind==='edit'?'.result-list [data-act="ec-inline-edit"],.result-list [data-act="ec-inline-verdict"],.result-list [data-act="edit-result"],.result-list [data-act="raw-edit-result"]':kind==='confirm'?'.results-footer [data-act="ec-inline-confirm"],.results-footer [data-act="confirm-review"],.results-footer [data-act="confirm-unreplied"],.results-footer [data-act="raw-confirm-next"]':null;
  if(!selector)return null;
  return [...root.querySelectorAll(selector)].find(control=>(kind!=='edit'||Boolean(control.dataset?.rule))&&!unavailable(control,root,{allowCollapsed:kind==='edit'}))||null;
}
