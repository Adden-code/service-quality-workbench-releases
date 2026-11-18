// Capture DOM-only drafts before an explicit workspace reload redraws a dialog.
export function captureDialogInputs(root){
 return [...(root?.querySelectorAll('input,textarea,select')||[])].filter(el=>!['file','password','hidden'].includes(el.type)&&(el.id||el.name)).map(el=>({id:el.id,name:el.name,type:el.type,value:el.value,checked:el.checked,selectionStart:el.selectionStart,selectionEnd:el.selectionEnd}));
}
export function restoreDialogInputs(root,saved){
 const fields=[...(root?.querySelectorAll('input,textarea,select')||[])];
 for(const value of saved||[]){const field=fields.find(el=>value.id?el.id===value.id:el.name===value.name&&el.value===value.value);if(!field||field.type!==value.type)continue;
  if(['checkbox','radio'].includes(field.type))field.checked=value.checked;else if(field.type!=='select-one'||[...field.options].some(o=>o.value===value.value))field.value=value.value;
  if(typeof value.selectionStart==='number'&&field.setSelectionRange)try{field.setSelectionRange(value.selectionStart,value.selectionEnd);}catch{}
 }
}
