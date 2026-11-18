// Replacing a draft view must not displace the source text or the field being checked.
const scrollSelectors=['.modal-body','.cleaning-source-panel pre','.cleaning-edit-panel'];
const rowAt=root=>root.querySelector('#cleaning-selected-row')?.value||root.querySelector('[data-cleaning-row]')?.dataset.cleaningRow||'';
const identity=element=>element?{id:element.id||'',data:{...element.dataset},selectionStart:element.selectionStart,selectionEnd:element.selectionEnd}:null;
export function captureCleaningViewport(root){
 const active=root.ownerDocument?.activeElement;
 return {row:rowAt(root),scrolls:scrollSelectors.map(selector=>{const el=root.querySelector(selector);return{selector,top:el?.scrollTop||0,left:el?.scrollLeft||0};}),focus:active&&root.contains(active)?identity(active):null,open:[...root.querySelectorAll('.cleaning-edit-panel details')].map(el=>el.open)};
}
export function restoreCleaningViewport(root,saved,{locateQuote=false}={}){
 if(saved&&String(saved.row)===String(rowAt(root))){
  [...root.querySelectorAll('.cleaning-edit-panel details')].forEach((el,i)=>{el.open=Boolean(saved.open[i]);});
  const key=saved.focus;
  if(key){const candidates=[...root.querySelectorAll('input,select,textarea,button')],target=key.id?candidates.find(el=>el.id===key.id):candidates.find(el=>Object.keys(key.data).length&&Object.entries(key.data).every(([name,value])=>el.dataset[name]===value));if(target&&!target.disabled){target.focus({preventScroll:true});if(typeof key.selectionStart==='number'&&target.setSelectionRange)try{target.setSelectionRange(key.selectionStart,key.selectionEnd);}catch{}}}
  for(const value of saved.scrolls){const el=root.querySelector(value.selector);if(el){el.scrollTop=value.top;el.scrollLeft=value.left;}}
 }
 if(locateQuote)root.querySelector('.cleaning-source-panel mark')?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});
}
