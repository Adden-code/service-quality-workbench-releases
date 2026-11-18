// Reuse stable review nodes so a saved judgment does not recreate the original
// transcript, navigation and every unchanged rule card.
const key=node=>node.nodeType===1&&(node.id||node.dataset.ruleCard&&'rule:'+node.dataset.ruleCard||node.dataset.inlineRule&&'inline:'+node.dataset.inlineRule||node.dataset.act==='select-session'&&'session:'+node.dataset.id)||null;
function sync(node,next){
 if(node.isEqualNode(next))return;
 if(node.nodeType!==next.nodeType||node.nodeName!==next.nodeName){node.replaceWith(next);return;}
 if(node.nodeType!==1){node.nodeValue=next.nodeValue;return;}
 const formValue=next.value,checked=next.checked;
 for(const a of [...node.attributes])if(!next.hasAttribute(a.name))node.removeAttribute(a.name);
 for(const a of next.attributes)if(node.getAttribute(a.name)!==a.value)node.setAttribute(a.name,a.value);
 const keyed=new Map([...node.childNodes].map(x=>[key(x),x]).filter(x=>x[0]));
 let cursor=node.firstChild;
 for(const child of [...next.childNodes]){
  const id=key(child),match=id?keyed.get(id):cursor&&!key(cursor)&&cursor.nodeType===child.nodeType&&cursor.nodeName===child.nodeName?cursor:null;
  if(match){if(match!==cursor)node.insertBefore(match,cursor);const following=match.nextSibling;sync(match,child);cursor=following;}
  else node.insertBefore(child,cursor);
 }
 while(cursor){const following=cursor.nextSibling;cursor.remove();cursor=following;}
 if(['INPUT','TEXTAREA','SELECT'].includes(node.nodeName)&&node!==document.activeElement){if(node.value!==formValue)node.value=formValue;if(node.nodeName==='INPUT')node.checked=checked;}
}
export function renderUpdate(root,markup,{reuse=false}={}){
 if(!reuse){root.innerHTML=markup;return;}
 const template=document.createElement('template');template.innerHTML=markup;
 const next=template.content.firstElementChild;
 if(root.children.length!==1||!next){root.replaceChildren(template.content);return;}
 sync(root.firstElementChild,next);
}
