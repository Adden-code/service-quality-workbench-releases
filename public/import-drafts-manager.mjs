import {html as h,t,translateError} from './i18n.mjs';
import {e,dateTime} from './ui.mjs';
const kinds=new Set(['new-task','ecommerce-import','conversation-cleaning','input-mapping']);
const omit=new Set(['file','pendingFile','returnDialog','catalog','config','modelConfig','consent','consentBinding','loading','running','parseRequest','request','parseSequence','expectedCreated','expectedSavedRules','completed','_importDraft','importDraftStatus','versions']);
function plainSnapshot(d,depth=0){
 const clean=(value)=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['consent','consentBinding','apiKey','token','modelConfig','config','controller','signal','file','returnDialog'].includes(key)).map(([key,item])=>[key,clean(item)])):value;
 const out={};for(const [key,value] of Object.entries(d||{})){
  if(omit.has(key)||typeof value==='function'||typeof value==='symbol'||value===undefined)continue;
  try{out[key]=clean(JSON.parse(JSON.stringify(value)));}catch{}
 }
 if(depth<2&&kinds.has(d?.returnDialog?.type))out.origin=plainSnapshot(d.returnDialog,depth+1);
 out.loading=false;out.running=false;out.consent=false;
 if(out.draft?.rows)for(const row of out.draft.rows)if(row.status==='running'){row.status='failed';row.error=t('上次解析中断，请核对后重试。');}
 return out;
}
function revive(payload,file){
 const value={...payload,file,loading:false,running:false,consent:false,consentBinding:null,error:'',restored:true};
 if(payload.origin){value.returnDialog=revive(payload.origin,file);delete value.origin;}
 return value;
}
export function createImportDraftManager({api,getDialog,openDialog,closeDialog,renderDialog,toast,uploadSource,readSource,getRuleVersions=()=>[],prepareRestored=value=>value}={}){
 let timer=null,tail=Promise.resolve();const sources=new WeakMap();
 const eligible=d=>kinds.has(d?.type)&&Boolean(d.file)&&!d.expectedCreated&&!d.completed;
 const serial=operation=>{const next=tail.then(operation);tail=next.catch(()=>{});return next;};
 async function save(d=getDialog()){
  if(!eligible(d))return null;
  clearTimeout(timer);timer=null;
  return serial(async()=>{
   const file=d.file;
   let source=sources.get(file);if(!source){source=await uploadSource(file);sources.set(file,source);}
   if(d._importDraft&&d._importDraft.source.sha256!==source.sha256)d._importDraft=undefined;
   const id=d._importDraft?.id||`import-${crypto.randomUUID()}`;
   const result=await api(`/api/import-drafts/${id}`,{method:'PUT',body:{baseRevision:d._importDraft?.revision||0,kind:d.type,source,payload:plainSnapshot(d)}});
   const record=result.draft;Object.assign(d._importDraft||(d._importDraft={}),{id:record.id,revision:record.revision,source:record.source});d.importDraftStatus=t('草稿已保存到本机 · {0}',{0:dateTime(record.updatedAt)});
   return record;
  });
 }
 function schedule(d=getDialog()){
  if(!eligible(d))return;clearTimeout(timer);
  timer=setTimeout(()=>{timer=null;void save(d).catch(error=>{d.importDraftStatus=t('草稿保存失败，当前输入仍保留：{0}',{0:translateError(error)});});},500);timer.unref?.();
 }
 async function closeAndSave(d,done){
  try{await save(d);done();}catch(error){d.error=t('草稿未保存，弹窗保留。请重试：{0}',{0:translateError(error)});if(getDialog()===d)renderDialog();toast?.(d.error,true);}
 }
 async function complete(d,taskId){
  clearTimeout(timer);timer=null;
  if(!d?._importDraft)return;
  return serial(async()=>{
   const result=await api(`/api/import-drafts/${d._importDraft.id}/complete`,{method:'POST',body:{baseRevision:d._importDraft.revision,taskId}});
   d._importDraft.revision=result.draft.revision;d.completed=true;
  });
 }
 async function action(act,button){
  if(act==='import-drafts-list'){
   const owner={type:'import-drafts-list',loading:true,items:[],error:''};openDialog(owner);
   try{const value=await api('/api/import-drafts');owner.items=(value.drafts||[]).filter(d=>d.status==='draft');}catch(error){owner.error=translateError(error);}finally{owner.loading=false;if(getDialog()===owner)renderDialog();}return true;
  }
  if(act==='import-draft-resume'){
   const id=button.dataset.id,owner=getDialog();
   try{
    const first=(await api(`/api/import-drafts/${id}`)).draft;
    const record=(await api(`/api/import-drafts/${id}/resume`,{method:'POST',body:{baseRevision:first.revision}})).draft;
    const bytes=await readSource(record.source.sha256),file=new File([bytes],record.source.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    sources.set(file,record.source);const value=revive(record.payload,file);value._importDraft={id:record.id,revision:record.revision,source:record.source};for(let origin=value.returnDialog;origin;origin=origin.returnDialog)origin._importDraft=value._importDraft;
    if(value.type==='ecommerce-import')value.versions=getRuleVersions();
    if(!kinds.has(value.type))throw new Error('导入草稿类型无效。');
    openDialog(prepareRestored(value));toast?.('已恢复本机导入草稿；模型调用需重新确认。');
   }catch(error){owner.error=translateError(error);renderDialog();}return true;
  }
  if(act==='import-save-close'){const d=getDialog();await closeAndSave(d,()=>closeDialog({force:true}));return true;}
  return false;
 }
 function dialog(d=getDialog()){
  if(d?.type!=='import-drafts-list')return '';
  return h`<div class="modal-backdrop" data-backdrop="true"><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><div><h2 id="dialog-title">导入草稿</h2><p>文件、映射和核对进度保存在本机；恢复不会自动调用模型。</p></div><button class="btn" data-act="close-modal">关闭</button></header><div class="modal-body"><div class="form-error" role="alert">${e(translateError(d.error||''))}</div>${d.loading?h`<p>正在读取草稿…</p>`:d.items.length?h`<div class="table-wrap"><table><thead><tr><th>任务名称</th><th>原文件</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${d.items.map(item=>h`<tr><td>${e(item.name)}</td><td>${e(item.sourceName)}</td><td>${dateTime(item.updatedAt)}</td><td><button class="btn" data-act="import-draft-resume" data-id="${e(item.id)}">继续导入</button></td></tr>`).join('')}</tbody></table></div>`:h`<p>暂无未完成的导入草稿。</p>`}</div></section></div>`;
 }
 return {eligible,save,schedule,closeAndSave,complete,action,dialog,cancelTimer:()=>{clearTimeout(timer);timer=null;}};
}
export {plainSnapshot as importDraftSnapshot,revive as restoreImportDraft};
