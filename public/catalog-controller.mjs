import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {createBusinessCatalog,validateCatalog,createDraft,updateDraft,publishVersion,retireVersion,importPolicies,importRules,assignCatalogScenes,assignRuleKind,abandonDraft} from './catalog.mjs';
import {catalogPage,versionSort} from './catalog-view.mjs';
import {catalogDialog} from './catalog-dialogs.mjs';
import {catalogRecordSceneIds,catalogScenes} from './catalog-scenes.mjs';
import {nextRuleIds,ruleCategoryOptions} from './rule-entry.mjs';
import {ruleKindOf} from './rule-kind.mjs';
import {ruleVersionReferences} from './rule-deletion.mjs';

export const CATALOG_KEY='mss-presales-qa-catalog:v1';
export function loadCatalog(storage){
  try{const raw=storage.getItem(CATALOG_KEY);if(raw===null||raw===undefined)return {catalog:createBusinessCatalog(),blocked:false,warning:''};const catalog=JSON.parse(raw);validateCatalog(catalog);return {catalog,blocked:false,warning:''};}
  catch{return {catalog:createBusinessCatalog(),blocked:true,warning:'版本资料记录无法读取，原记录未覆盖。请保留浏览器记录，检查并恢复后重新加载。'};}
}
export function saveCatalog(storage,catalog){
  try{validateCatalog(catalog);storage.setItem(CATALOG_KEY,JSON.stringify(catalog));}
  catch(error){throw new Error(`资料未保存，请先导出并检查浏览器存储空间。${error.message||''}`);}
}

export function createCatalogManager(ctx){
  const initial=ctx.initialCatalog!==undefined?{catalog:ctx.initialCatalog,blocked:false,warning:''}:loadCatalog(ctx.storage);
  validateCatalog(initial.catalog);
  let catalog=structuredClone(initial.catalog),blocked=initial.blocked,warning=initial.warning;
  const now=()=>new Date().toISOString();
  const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const current=()=>ctx.getDialog();
  const find=dialog=>catalog[dialog.kind||'policies'].find(record=>record.id===dialog.id&&record.version===dialog.version);
  function replaceCatalog(next){validateCatalog(next);catalog=structuredClone(next);blocked=false;warning='';}
  async function commit(next,message){
    if(blocked)throw new Error(warning);
    validateCatalog(next);
    if(ctx.commitCatalog){const acknowledged=await ctx.commitCatalog(structuredClone(next));replaceCatalog(acknowledged??next);}
    else {saveCatalog(ctx.storage,next);replaceCatalog(next);}
    ctx.render();if(message)ctx.toast(message);
  }
  function detail(dialog=current()){ctx.openDialog({type:'catalog-detail',kind:dialog.kind||'policies',id:dialog.id,version:dialog.version});}
  const selectedScenes=(name='catalog-scene-id')=>[...document.querySelectorAll(`[name="${name}"]:checked`)].map(input=>input.value);
  const state=()=>ctx.getState?.()||{};
  const initialScenes=()=>catalogScenes(state()).some(scene=>scene.id===ctx.getUi().catalogScene)?[ctx.getUi().catalogScene]:[];
  const importedRecords=d=>d.parsed.map((record,index)=>({...record,...(d.kind==='rules'?{ruleKind:document.getElementById(`catalog-import-rule-kind-${index}`)?.value||ruleKindOf(record)}:{}),sceneIds:selectedScenes(`catalog-import-scene-${index}`)}));
  const value=id=>document.getElementById(`cat-${id}`)?.value.trim()||'';
  function readForm(dialog){
    const form={...find(dialog),...dialog.form,sceneIds:selectedScenes()};
    for(const key of ['title','category','scope','effectiveAt','expiresAt','owner','changeNote'])form[key]=value(key);
    if(dialog.kind==='rules'){
      for(const key of ['passCriteria','failCriteria','exceptionCriteria'])form[key]=value(key);
      form.ruleKind=value('ruleKind')||ruleKindOf(form);
      form.policyIds=value('policyIds').split(/[;；]/).map(item=>item.trim()).filter(Boolean);
    }else form.sections=[...document.querySelectorAll('[data-section-index]')].map((element,index)=>({id:value(`section-id-${index}`),title:value(`section-title-${index}`),text:value(`section-text-${index}`)}));
    return form;
  }
  function validateRuleForm(form){
    const errors=[];
    for(const [key,label] of [['id','规则标识'],['title','规则名称'],['category','类别'],['scope','适用范围'],['effectiveAt','生效日期'],['owner','维护人'],['changeNote','变更说明'],['passCriteria','符合口径'],['failCriteria','不符合口径'],['exceptionCriteria','例外口径']])if(!String(form[key]||'').trim())errors.push(`请填写${label}。`);
    if(!form.policyIds?.length)errors.push('请选择关联参考资料。');
    if(form.category&&!ruleCategoryOptions(catalog,form.sceneIds,state()).includes(form.category))errors.push('请从当前场景现有分类中选择类别。');
    if(errors.length)throw new Error(errors.join('\n'));
  }
  async function downloadRecords(records,name){const {buildKnowledgeXlsx}=await import('./catalog-io.mjs');ctx.download(await buildKnowledgeXlsx(records),name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
  async function upload(file){
    const owner=current();if(!file||!['catalog-import','catalog-rule-import'].includes(owner?.type))return;
    const request=Symbol('catalog-read');owner.request=request;owner.loading=true;owner.error='';owner.parsed=null;ctx.renderDialog();
    try{
      const parse=owner.type==='catalog-rule-import'?(await import('./rule-template-io.mjs')).parseRuleTemplateFile:(await import('./catalog-io.mjs')).parseKnowledgeFile;const parsed=await parse(file);
      if(current()!==owner||owner.request!==request)return;
      if(!parsed.valid)throw new Error(parsed.errors.join('\n'));
      (owner.type==='catalog-rule-import'?importRules:importPolicies)(catalog,parsed.records,now()); // Validate the complete batch before any write.
      owner.loading=false;owner.parsed=parsed.records;owner.fileName=file.name;ctx.renderDialog();
    }catch(error){if(current()===owner&&owner.request===request){owner.loading=false;owner.error=error.message;ctx.renderDialog();}}
  }
  async function action(act,button){
    if(!act.startsWith('catalog-'))return false;
    try{
      const dialog=current();
      if(act==='catalog-open'){ctx.openDialog({type:'catalog-detail',kind:button.dataset.kind,id:button.dataset.id,version:button.dataset.version});}
      else if(act==='catalog-new-rule')ctx.openDialog({type:'catalog-new-rule',kind:'rules',error:'',form:{id:nextRuleIds(catalog,initialScenes()[0]||'',1,state())[0],effectiveAt:today(),policyIds:[],sceneIds:initialScenes()}});
      else if(act==='catalog-save-new-rule'){
        dialog.form={...readForm({...dialog,kind:'rules'}),id:value('id')};
        validateRuleForm(dialog.form);
        if(catalog.rules.some(record=>record.id===dialog.form.id))throw new Error('规则标识已存在，请打开原规则创建新版本。');
        const next=createDraft(catalog,'rules',dialog.form.id,dialog.form,now());
        await commit(next,'新规则草稿已保存，核对后可发布');
        detail({kind:'rules',id:dialog.form.id,version:next.rules.filter(r=>r.id===dialog.form.id).at(-1).version});
      }
      else if(act==='catalog-scenes')ctx.openDialog({...dialog,type:'catalog-scenes',sceneIds:catalogRecordSceneIds(find(dialog),{state:state(),catalog,kind:dialog.kind}),error:''});
      else if(act==='catalog-save-scenes'){dialog.sceneIds=selectedScenes();await commit(assignCatalogScenes(catalog,dialog.kind,dialog.id,dialog.version,dialog.sceneIds,now()),'归属已保存，正文与版本保持不变');detail(dialog);}
      else if(act==='catalog-rule-kind')ctx.openDialog({...dialog,type:'catalog-rule-kind',ruleKind:ruleKindOf(find(dialog)),error:''});
      else if(act==='catalog-save-rule-kind'){await commit(assignRuleKind(catalog,dialog.id,dialog.version,document.getElementById('catalog-rule-kind')?.value,now()),'规则作用域已保存，历史任务依据保持不变');detail(dialog);}
      else if(act==='catalog-abandon')ctx.openDialog({...dialog,type:'catalog-abandon',error:''});
      else if(act==='catalog-do-abandon'){await commit(abandonDraft(catalog,dialog.kind,dialog.id,dialog.version,now()),'草稿已弃用，内容与操作记录保留');detail(dialog);}
      else if(act==='catalog-back')detail(dialog);
      else if(act==='catalog-history'||act==='catalog-diff')ctx.openDialog({...dialog,type:act,error:''});
      else if(act==='catalog-new-version'){
        const next=createDraft(catalog,dialog.kind,dialog.id,{effectiveAt:today(),expiresAt:'',changeNote:'创建新版本草稿，待完善变更内容。'},now());
        const record=next[dialog.kind].filter(item=>item.id===dialog.id).sort(versionSort)[0];
        await commit(next,'新版本草稿已创建；原版内容保持不变');ctx.openDialog({...dialog,type:'catalog-edit',version:record.version,error:'',form:null});
      }else if(act==='catalog-edit')ctx.openDialog({...dialog,type:'catalog-edit',error:'',form:structuredClone(find(dialog))});
      else if(act==='catalog-save'){
        dialog.form=readForm(dialog);if(dialog.kind==='rules')validateRuleForm(dialog.form);const next=updateDraft(catalog,dialog.kind,dialog.id,dialog.version,dialog.form,now());await commit(next,'草稿已保存，尚未发布');detail(dialog);
      }else if(act==='catalog-add-section'||act==='catalog-remove-section'){
        dialog.form=readForm(dialog);
        if(act==='catalog-add-section')dialog.form.sections.push({id:'',title:'',text:''});else dialog.form.sections.splice(Number(button.dataset.index),1);
        ctx.renderDialog();
      }else if(act==='catalog-deletions'){ctx.openDialog({type:'catalog-deletions',kind:'rules'});
      }else if(act==='catalog-delete'){
        const record=find(dialog);if(record?.status!=='已停用')throw new Error('只有已停用的规则版本可以删除。');
        ctx.openDialog({...dialog,type:'catalog-delete',references:ruleVersionReferences(state(),record),expectedRecord:structuredClone(record),operationId:crypto.randomUUID(),actor:'',reason:'',error:''});
      }else if(act==='catalog-do-delete'){
        dialog.actor=value('delete-actor');dialog.reason=value('delete-reason');
        if(!dialog.actor||!dialog.reason)throw new Error('请填写删除人和删除原因。');
        if(!ctx.deleteRule)throw new Error('请连接支持删除审计的本机服务。');
        const next=await ctx.deleteRule({id:dialog.id,version:dialog.version,actor:dialog.actor,reason:dialog.reason,operationId:dialog.operationId,expectedRecord:dialog.expectedRecord});
        replaceCatalog(next);ctx.closeDialog();ctx.render();ctx.toast('规则版本已删除，内容快照与原因保留在删除审计中。');
      }else if(act==='catalog-publish'||act==='catalog-retire')ctx.openDialog({...dialog,type:act,error:''});
      else if(act==='catalog-do-publish'){
        dialog.closePrevious=!!document.getElementById('catalog-close-previous')?.checked;
        const next=publishVersion(catalog,dialog.kind,dialog.id,dialog.version,{closePrevious:dialog.closePrevious},now());
        await commit(next,'版本已发布，可用于新文件任务；已有任务依据保持不变');detail(dialog);
      }else if(act==='catalog-do-retire'){
        await commit(retireVersion(catalog,dialog.kind,dialog.id,dialog.version,now()),'版本已停用，历史内容与审核记录保留');detail(dialog);
      }else if(act==='catalog-import')ctx.openDialog({type:'catalog-import',kind:'policies',parsed:null,error:''});
      else if(act==='catalog-confirm-import'){
        if(!dialog.parsed?.length)throw new Error('请先上传并核对模板');
        dialog.parsed=importedRecords(dialog);await commit(importPolicies(catalog,dialog.parsed,now()),`已导入 ${dialog.parsed.length} 个资料版本草稿`);ctx.closeDialog();
      }else if(act==='catalog-rule-import')ctx.openDialog({type:'catalog-rule-import',kind:'rules',parsed:null,error:''});
      else if(act==='catalog-rule-template'){const {buildRuleTemplateXlsx}=await import('./rule-template-io.mjs');ctx.download(await buildRuleTemplateXlsx(),'质检规则_手工导入模板.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
      else if(act==='catalog-confirm-rule-import'){
        if(!dialog.parsed?.length)throw new Error('请先上传并核对模板');dialog.parsed=importedRecords(dialog);
        await commit(importRules(catalog,dialog.parsed,now()),`已导入 ${dialog.parsed.length} 个规则版本草稿`);ctx.closeDialog();
      }
      else if(act==='catalog-template')await downloadRecords([],'政策与知识_统一导入模板.xlsx');
      else if(act==='catalog-export')ctx.openDialog({type:'catalog-export',kind:'policies',error:''});
      else if(act==='catalog-export-one')await downloadRecords([find(dialog)],`政策资料_${dialog.id}_${dialog.version}.xlsx`);
      else if(act==='catalog-do-export'){
        const ids=[...document.querySelectorAll('[name="catalog-export-id"]:checked')].map(input=>input.value);if(!ids.length)throw new Error('请至少选择一份资料');
        let selected=catalog.policies.filter(record=>ids.includes(record.id));
        if(document.getElementById('catalog-export-mode').value==='latest')selected=ids.map(id=>selected.filter(record=>record.id===id).sort(versionSort)[0]);
        await downloadRecords(selected,'政策与知识_版本资料导出.xlsx');ctx.closeDialog();ctx.toast(`已导出 ${selected.length} 个资料版本`);
      }
    }catch(error){const dialog=current();if(dialog?.type?.startsWith('catalog-')){dialog.error=error.message;ctx.renderDialog();}else ctx.toast(error.message,true);}
    return true;
  }
  function change(event){
    const element=event.target,dialog=current();
    if(element.id==='catalog-upload'){upload(element.files[0]);return true;}
    if(element.name==='catalog-scene-id'&&['catalog-edit','catalog-new-rule'].includes(dialog?.type)){dialog.form=readForm(dialog);if(dialog.type==='catalog-new-rule')dialog.form.id=value('id');ctx.renderDialog();return true;}
    if(element.id==='catalog-scene'){ctx.getUi().catalogScene=element.value;ctx.render();return true;}
    if(element.id==='catalog-category'||element.id==='catalog-status'){
      ctx.getUi()[element.id==='catalog-category'?'catalogCategory':'catalogStatus']=element.value;ctx.render();return true;
    }
    if(element.id==='catalog-version'){dialog.version=element.value;dialog.error='';ctx.renderDialog();return true;}
    if(element.id==='catalog-before'||element.id==='catalog-after'){dialog[element.id==='catalog-before'?'before':'after']=element.value;ctx.renderDialog();return true;}
    return false;
  }
  return {getCatalog:()=>structuredClone(catalog),replaceCatalog,view:(kind,ui)=>catalogPage(catalog,kind,ui,warning,state()),dialog:dialog=>catalogDialog(dialog,catalog,state()),action,change};
}
