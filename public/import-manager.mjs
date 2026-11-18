import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {createDraft} from './catalog.mjs';
import {catalogRecordMatchesScene} from './catalog-scenes.mjs';
import {importDialog} from './import-ui.mjs';
import {assertConsultationInput} from './task-workbench.mjs';
import {findScenario,sceneLabel,freezeScenario} from './scenarios.mjs';
import {prepareRuleCandidates,ruleCandidateErrors,ruleKindOf} from './rule-entry.mjs';

const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value!==null&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const mapping=()=>import('./input-profiles.mjs');
const blankProfile=scene=>({id:'',name:'',version:1,scene:scene||'新品产品咨询',layout:'turns',sheet:'',headerRow:1,fields:{},roleMap:{},dateFormat:'iso',defaults:{},extras:[],ruleIds:[]});
const needsText=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error(`请填写${uiT(label)}。`);return value.trim();};
const sourceLocator=locator=>`字符 ${locator.start+1}–${locator.end}`;
const colName=index=>{let name='';for(let number=index+1;number;number=Math.floor((number-1)/26))name=String.fromCharCode(65+(number-1)%26)+name;return name;};
export function worksheetText(sheet){return `工作表：${sheet.name}\n`+sheet.rows.map(row=>`第${row.row}行 | ${row.values.map((value,index)=>`${colName(index)}列：${String(value??'')}`).join(' | ')}`).join('\n');}

export function createImportManager(ctx){
  const getDialog=()=>ctx.getDialog();
  const render=()=>ctx.renderDialog();
  const recoveryBlocked=d=>{const status=ctx.getWorkspaceStatus?.()||{};return d?.type==='rule-import'&&Boolean(d.saveConflict||(d.expectedSavedRules?.length&&(status.hasPending||status.conflicted)));};
  function syncRecoveryControls(d){
    if(typeof document==='undefined'||getDialog()!==d)return;
    const blocked=recoveryBlocked(d);
    for(const node of document.querySelectorAll('#overlay-root .rule-import input,#overlay-root .rule-import select,#overlay-root .rule-import textarea,#overlay-root .rule-import [data-act^="rule-import-"]')){
      if(blocked){if(node.dataset.recoveryDisabled===undefined)node.dataset.recoveryDisabled=node.disabled?'true':'false';node.disabled=true;}
      else if(node.dataset.recoveryDisabled!==undefined){node.disabled=node.dataset.recoveryDisabled==='true';delete node.dataset.recoveryDisabled;}
    }
  }
  function feedback(d,message){
    d.error=message;
    const slot=typeof document!=='undefined'?document.getElementById('import-error'):null;
    if(slot){slot.textContent=uiError(message);ctx.renderDialog(false);}else render();
  }
  function busy(d,value){
    d.loading=value;
    if(typeof document==='undefined'||getDialog()!==d)return;
    for(const node of document.querySelectorAll('#overlay-root .import-modal button,#overlay-root .import-modal input,#overlay-root .import-modal select,#overlay-root .import-modal textarea')){
      if(value){node.dataset.importDisabled=node.disabled?'true':'false';node.disabled=true;}
      else if(node.dataset.importDisabled!==undefined){node.disabled=node.dataset.importDisabled==='true';delete node.dataset.importDisabled;}
    }
    const slot=document.getElementById('import-feedback');if(slot)slot.textContent=value?uiT('正在处理…'):'';
    if(!value)syncRecoveryControls(d);
  }
  const removePreview=selector=>{if(typeof document!=='undefined')for(const node of document.querySelectorAll?.(selector)||[])node.remove();};
  const invalidate=d=>{d.preview=null;d.error='';removePreview('#overlay-root .import-preview,#overlay-root [data-act="input-begin"]');};
  const invalidateRules=d=>{d.prepared=null;d.candidates=[];d.savedSource=null;d.expectedSavedRules=null;d.saveConflict=false;d.error='';removePreview('#overlay-root .rule-import-candidates,#overlay-root .rule-import-meta,#overlay-root [data-act="rule-import-save"]');};
  function openMapping(profile=null,businessScene=''){
    const config=businessScene||profile?.scene?findScenario(ctx.getState(),businessScene||profile.scene,{includeDisabled:!businessScene}):null;
    if(businessScene&&(!config||config.engine!=='conversation'))throw new Error('场景未注册、已停用或需要专用导入入口，请重新选择。');
    const origin=getDialog();
    const preferred=profile||(config?.inputProfileId?(ctx.getState().inputProfiles||[]).find(item=>item.id===config.inputProfileId):null),next=preferred?clone(preferred):blankProfile(businessScene);
    if(businessScene&&!preferred){next.id=`${businessScene==='新品产品咨询'?'CONSULT':'MAP'}-${crypto.randomUUID().slice(0,8)}`;next.name=`${sceneLabel(ctx.getState(),businessScene)}原表映射`;next.layout=config.layout;}
    if(config&&(!config.builtin||config.ruleIds?.length))next.ruleIds=[...config.ruleIds];
    ctx.openDialog({type:'input-mapping',businessScene,templateLayout:config&&!config.builtin?config.layout:'',profile:next,editingId:preferred?.id||'',preview:null,returnDialog:origin?.type==='new-task'?origin:null,_importDraft:origin?._importDraft});
  }
  function assertRuleSource(d){
    if(d.mode!=='excel')return;
    const sheet=d.inspected?.sheets?.find(sheet=>sheet.name===d.sheet);
    if(!d.file||!sheet)throw new Error('请选择原规则Excel与工作表。');
    if(d.sourceText!==worksheetText(sheet))throw new Error('规则原文与所选工作表来源不一致，请重新选择工作表并整理。');
  }
  async function inspectFile(file,d,rule=false){
    if(!file||d.loading)return;
    const previous=d.file||d.returnDialog?.file;
    if(!rule&&previous&&previous!==file){if(ctx.saveImportDraft&&d._importDraft)try{await ctx.saveImportDraft(d);}catch(error){feedback(d,error.message);return;}delete d._importDraft;d.name=d.name??d.returnDialog?.name;d.reviewer=d.reviewer??d.returnDialog?.reviewer;d.returnDialog=null;}
    // A new selection replaces the previous source immediately, including on parse failure.
    d.file=null;d.inspected=null;
    if(rule){d.sourceName=file.name;d.sheet='';d.sourceText='';invalidateRules(d);}
    else invalidate(d);
    busy(d,true);d.error='';
    try{
      const result=await(await mapping()).inspectMappedFile(file);
      if(getDialog()!==d)return;
      if(!result.valid)throw new Error(result.errors.join('；'));
      d.file=file;d.inspected=result;
      if(rule){d.sourceName=file.name;d.sheet='';d.sourceText='';invalidateRules(d);}
      else invalidate(d);
      d.loading=false;render();
    }catch(error){if(getDialog()===d)feedback(d,error.message);}
    finally{busy(d,false);}
  }
  function validateCandidates(d){
    assertRuleSource(d);
    if(!d.prepared||!Array.isArray(d.candidates)||!d.candidates.length||d.candidates.length>30)throw new Error('请先运行GLM整理并核对候选。');
    const included=d.candidates.filter(c=>c.included!==false);if(!included.length)throw new Error('请至少保留一项候选。');
    const errors=ruleCandidateErrors(d,ctx.getCatalog(),ctx.getState());if(errors.length)throw new Error(errors.join('\n'));
    return included;
  }
  function reconcile(){
    const d=getDialog();if(d?.type!=='rule-import'||!d.expectedSavedRules?.length)return 'none';
    const status=ctx.getWorkspaceStatus?.()||{};
    if(status.hasPending||status.conflicted){feedback(d,'本次规则保存尚未确认，请先重试保存或重新加载工作区；当前候选输入保留。');syncRecoveryControls(d);return 'pending';}
    const actual=d.expectedSavedRules.map(expected=>ctx.getCatalog().rules.find(rule=>rule.id===expected.id&&rule.version===expected.version));
    if(actual.every((rule,index)=>rule&&canonical(rule)===canonical(d.expectedSavedRules[index]))){
      d.loading=false;ctx.closeDialog({force:true});ctx.render();return 'saved';
    }
    if(actual.some(Boolean)){
      d.saveConflict=true;feedback(d,'规则保存冲突：相同标识和版本已存在，但完整草稿内容不同。当前输入已保留，请先核对目录；不会自动创建新版本。');syncRecoveryControls(d);return 'conflict';
    }
    d.saveConflict=false;syncRecoveryControls(d);return 'not_saved';
  }
  async function saveRules(d){
    const included=validateCandidates(d),now=new Date().toISOString();
    const changes=included.map(candidate=>({id:candidate.id.trim(),title:candidate.title.trim(),category:candidate.category.trim(),ruleKind:ruleKindOf(candidate),scope:candidate.scope.trim(),passCriteria:candidate.passCriteria.trim(),failCriteria:candidate.failCriteria.trim(),exceptionCriteria:candidate.exceptionCriteria.trim(),owner:d.owner.trim(),effectiveAt:d.effectiveAt,expiresAt:'',policyIds:[...d.policyIds],sceneIds:[d.scene],changeNote:'导入原规则，人工对照确认',provenance:{source:null,quote:candidate.sourceQuote,locator:sourceLocator(candidate.sourceLocator),scene:d.scene,preparedBy:{modelId:d.prepared.modelId,promptVersion:d.prepared.promptVersion,...(d.prepared.requestId?{requestId:d.prepared.requestId}:{}),at:d.preparedAt||now}}}));
    // Validate the entire batch before storing a source or committing any draft.
    let trial=ctx.getCatalog();for(const item of changes)trial=createDraft(trial,'rules',item.id,{...item,provenance:undefined},now);
    if(!d.savedSource){
      const file=d.mode==='excel'?d.file:new File([d.sourceText],d.sourceName.endsWith('.txt')?d.sourceName:`${d.sourceName}.txt`,{type:'text/plain'});
      if(!file)throw new Error('请保留并选择原规则文件。');d.savedSource=await ctx.uploadSource(file);
    }
    const source=clone(d.savedSource);
    if(!d.expectedSavedRules?.length){
      let expectedCatalog=ctx.getCatalog();const expected=[];
      for(const item of changes){expectedCatalog=createDraft(expectedCatalog,'rules',item.id,{...item,provenance:{...item.provenance,source}},now);expected.push(clone(expectedCatalog.rules.at(-1)));}
      d.expectedSavedRules=expected;
    }
    const expected=clone(d.expectedSavedRules);
    await ctx.commitWorkspace(({state,catalog})=>{
      let next=catalog;
      for(const item of expected){
        const existing=next.rules.find(rule=>rule.id===item.id&&rule.version===item.version);
        if(existing){if(canonical(existing)!==canonical(item))throw new Error('规则保存冲突：同一标识与版本的完整内容不同。');continue;}
        next=createDraft(next,'rules',item.id,item,item.createdAt);
      }
      return{state,catalog:next};
    },`已保存 ${changes.length} 项规则草稿，尚未发布`);
    if(getDialog()===d){d.loading=false;ctx.closeDialog({force:true});ctx.render();}
  }
  async function action(act,button={}){
    if(!act?.startsWith('input-')&&!act?.startsWith('rule-import-'))return false;
    let d=getDialog();
    if(d?.loading)return true;
    try{
      if(act==='input-profiles'){ctx.openDialog({type:'input-profiles',scene:''});return true;}
      if(act==='input-import'){const selected=d?.type==='new-task'&&d.mode==='manual'?(d.scene&&d.scene!=='consultation'?d.scene:'新品产品咨询'):'';openMapping(null,selected);return true;}
      if(act==='input-profile-edit'){
        const profile=(ctx.getState().inputProfiles||[]).find(p=>p.id===button.dataset.id);if(!profile)throw new Error('导入配置已不存在，请重新选择。');openMapping(profile);return true;
      }
      if(act==='rule-import-open'){ctx.openDialog({type:'rule-import',mode:'text',scene:'新品产品咨询',sourceName:'',sourceText:'',owner:'',effectiveAt:'',policyIds:[],candidates:[]});return true;}
      if(!d)return false;
      if(act==='rule-import-save'){
        const result=reconcile();if(result==='saved'){ctx.toast('已核对本批规则草稿此前保存成功，未创建重复版本');return true;}if(['pending','conflict'].includes(result))return true;
      }else if(recoveryBlocked(d)){feedback(d,'请先恢复本次规则保存结果，当前输入保留。');return true;}
      if(act==='input-extra-add'){if(d.profile.extras.length>=50)throw new Error('最多配置50个配套字段。');d.profile.extras.push({key:'',column:'',label:'',type:'text',purpose:'retain',required:false});invalidate(d);render();}
      else if(act==='input-extra-remove'){d.profile.extras.splice(Number(button.dataset.index),1);invalidate(d);render();}
      else if(act==='input-save-profile'){
        if(d.roleMapError)throw new Error(d.roleMapError);
        const current=(ctx.getState().inputProfiles||[]).find(profile=>profile.id===d.profile.id);
        if(current&&d.editingId!==current.id)throw new Error('配置标识已存在，请先从“复用已保存配置”选择该配置。');
        const raw=clone(d.profile);raw.version=current?current.version+1:1;
        busy(d,true);
        const profile=(await mapping()).validateInputProfile(raw);
        await ctx.commitWorkspace(({state,catalog})=>{
          const previous=(state.inputProfiles||[]).find(p=>p.id===profile.id);
          if(previous&&previous.version!==current?.version)throw new Error('导入配置版本已变化，请重新加载后核对。');
          return{state:{...state,inputProfiles:[...(state.inputProfiles||[]).filter(p=>p.id!==profile.id),profile]},catalog};
        },'导入配置已保存');
        d.profile=clone(profile);d.editingId=profile.id;if(getDialog()===d){d.loading=false;render();}
      }else if(act==='input-preview'){
        if(d.roleMapError)throw new Error(d.roleMapError);
        if(!d.file)throw new Error('请先选择业务原表。');
        busy(d,true);const api=await mapping(),profile=api.validateInputProfile(d.profile);
        const preview=await api.parseMappedInput(d.file,profile);if(getDialog()!==d)return true;
        if(!preview.valid)throw new Error(preview.errors.join('；'));if(d.businessScene)assertConsultationInput(preview,ctx.getState(),d.businessScene);d.preview=preview;d.error='';d.loading=false;render();
      }else if(act==='input-begin'){
        if(!d.preview?.valid||!d.file)throw new Error('请先核对有效的转换预览。');
        const scene=d.businessScene||d.profile.scene;assertConsultationInput(d.preview,ctx.getState(),scene);
        const config=freezeScenario(ctx.getState(),scene);
        await ctx.beginMappedTask({parsed:d.preview,file:d.file,importDraft:d._importDraft,name:d.returnDialog?.name||d.name,reviewer:d.returnDialog?.reviewer||d.reviewer,scene,scenarioSnapshot:clone(config),importMappingSnapshot:clone(d.preview.importMappingSnapshot),ruleIds:[...(!config.builtin||config.ruleIds.length?config.ruleIds:d.profile.ruleIds)]});
      }else if(act==='rule-import-prepare'){
        assertRuleSource(d);
        needsText(d.sourceText,'规则原文');const sourceName=needsText(d.sourceName,'来源名称');
        if(d.sourceText.length>100000)throw new Error('规则原文最多100000个字符。');
        if(d.mode==='excel'&&(!d.file||!d.sheet))throw new Error('请选择原规则Excel与工作表。');
        busy(d,true);d.error='';
        const result=await ctx.prepareRules({text:d.sourceText,scene:d.scene,sourceName});if(getDialog()!==d)return true;
        if(!Array.isArray(result.candidates)||!result.candidates.length||result.candidates.length>30)throw new Error('未取得有效候选，请核对原文后再整理。');
        d.prepared=result;d.preparedAt=new Date().toISOString();d.candidates=prepareRuleCandidates(result.candidates,ctx.getCatalog(),d.scene,ctx.getState());d.loading=false;render();
      }else if(act==='rule-import-save'){busy(d,true);await saveRules(d);}
      else return false;
    }catch(error){if(d&&getDialog()===d)feedback(d,error.message);else ctx.toast(error.message,true);}
    finally{if(d)busy(d,false);}
    return true;
  }
  function input(event){
    const d=getDialog(),target=event.target,id=target.id||'',data=target.dataset||{};if(!d||d.loading)return false;
    if(d.type==='rule-import'&&d.expectedSavedRules?.length){
      const result=reconcile();if(['saved','pending','conflict'].includes(result))return true;
      d.expectedSavedRules=null;
    }
    if(d.type==='input-mapping'){
      const p=d.profile;
      if(id==='input-scene'&&d.businessScene&&target.value!==d.businessScene){feedback(d,'产品咨询映射仅支持新品产品咨询；电商评论请从新建任务选择专用场景。');return true;}
      if(data.profileField){if(target.value)p.fields[data.profileField]=target.value;else delete p.fields[data.profileField];}
      else if(data.profileDefault){if(target.value)p.defaults[data.profileDefault]=target.value;else delete p.defaults[data.profileDefault];}
      else if(data.extraIndex!==undefined&&data.extraKey){p.extras[Number(data.extraIndex)][data.extraKey]=target.type==='checkbox'?target.checked:target.value;}
      else if(data.profileRule){p.ruleIds=target.checked?[...new Set([...p.ruleIds,data.profileRule])]:p.ruleIds.filter(v=>v!==data.profileRule);}
      else if(id==='input-role-map'){
        d.roleMapText=target.value;const map=Object.create(null);for(const line of target.value.split('\n').filter(v=>v.trim())){const cut=line.indexOf('=');if(cut<1||!line.slice(0,cut).trim()){d.roleMapError='角色对应请每行填写“原值=客户/客服/系统”。';invalidate(d);feedback(d,d.roleMapError);return true;}const key=line.slice(0,cut).trim();if(Object.hasOwn(map,key)){d.roleMapError='角色对应包含重复源值，请每个源角色只保留一行。';invalidate(d);feedback(d,d.roleMapError);return true;}map[key]=line.slice(cut+1).trim();}p.roleMap=map;d.roleMapError='';feedback(d,'');
      }else if(['input-id','input-name','input-scene','input-layout','input-date-format','input-sheet','input-header-row'].includes(id)){
        if(id==='input-scene'&&d.businessScene&&target.value!==d.businessScene)return true;
        if(id==='input-layout'&&d.templateLayout&&target.value!==d.templateLayout)return true;
        const key={'input-id':'id','input-name':'name','input-scene':'scene','input-layout':'layout','input-date-format':'dateFormat','input-sheet':'sheet','input-header-row':'headerRow'}[id];p[key]=id==='input-header-row'?Number(target.value):target.value;
        if(id==='input-scene'){const config=findScenario(ctx.getState(),target.value);if(config&&!config.builtin){p.layout=config.layout;d.templateLayout=config.layout;}else d.templateLayout='';}
        if(id==='input-layout')for(const field of target.value==='pair'?['role','text','speaker','at']:['customerText','agentText'])delete p.fields[field];
      }else return false;
      invalidate(d);return true;
    }
    if(d.type==='rule-import'){
      if(data.candidateIndex!==undefined&&data.candidateKey){const candidate=d.candidates[Number(data.candidateIndex)];if(!candidate)return false;candidate[data.candidateKey]=target.type==='checkbox'?target.checked:target.value;if(!['confirmed','included','id','category'].includes(data.candidateKey)){candidate.confirmed=false;candidate.confirmationInvalidated=true;const confirm=typeof document!=='undefined'?document.querySelector(`[data-candidate-index="${Number(data.candidateIndex)}"][data-candidate-key="confirmed"]`):null;if(confirm)confirm.checked=false;const note=typeof document!=='undefined'?document.querySelector(`[data-candidate-confirmation-note="${Number(data.candidateIndex)}"]`):null;if(note)note.textContent=uiT('本项口径或作用域已修改，请核对后重新确认。');}else if(data.candidateKey==='confirmed'){candidate.confirmationInvalidated=false;const note=typeof document!=='undefined'?document.querySelector(`[data-candidate-confirmation-note="${Number(data.candidateIndex)}"]`):null;if(note)note.textContent='';}}
      else if(data.ruleImportPolicy)d.policyIds=target.checked?[...new Set([...(d.policyIds||[]),data.ruleImportPolicy])]:d.policyIds.filter(id=>id!==data.ruleImportPolicy);
      else{
        const key={'rule-import-source-name':'sourceName','rule-import-text':'sourceText','rule-import-scene':'scene','rule-import-mode':'mode','rule-import-owner':'owner','rule-import-effective-at':'effectiveAt'}[id];if(!key)return false;
        if(key==='mode'&&d.mode!==target.value){
          if(target.value==='excel'){
            d.textDraft={sourceText:d.sourceText,sourceName:d.sourceName};
            const sheet=d.inspected?.sheets?.find(sheet=>sheet.name===d.sheet);
            d.sourceText=d.file&&sheet?worksheetText(sheet):'';
            if(!sheet)d.sheet='';d.sourceName=d.file?.name||'';
          }else if(d.textDraft){d.sourceText=d.textDraft.sourceText;d.sourceName=d.textDraft.sourceName;}
        }
        d[key]=target.value;if(key==='scene')d.policyIds=[];if(['sourceText','scene','mode','sourceName'].includes(key))invalidateRules(d);
      }
      d.error='';return true;
    }
    return false;
  }
  function change(event){
    const d=getDialog(),target=event.target,id=target.id||'';if(!d||d.loading)return false;
    if(recoveryBlocked(d)){feedback(d,'请先恢复本次规则保存结果，当前输入保留。');return true;}
    if(id==='input-file'&&d.type==='input-mapping'){void inspectFile(target.files?.[0],d);return true;}
    if(id==='rule-import-file'&&d.type==='rule-import'){void inspectFile(target.files?.[0],d,true);return true;}
    if(id==='input-profile-scene'&&d.type==='input-profiles'){d.scene=target.value;render();return true;}
    if(id==='input-profile-select'&&d.type==='input-mapping'){
      const profile=(ctx.getState().inputProfiles||[]).find(p=>p.id===target.value);
      if(d.businessScene&&profile&&profile.scene!==d.businessScene){feedback(d,'当前场景不能复用其他场景的映射方案，请先在场景管理中另存适用映射。');return true;}
      if(profile&&d.templateLayout&&profile.layout!==d.templateLayout){feedback(d,'所选映射与场景模板布局不一致，请选择同模板的映射。');return true;}
      d.profile=profile?clone(profile):blankProfile(d.profile.scene);
      if(d.businessScene&&!profile){const config=findScenario(ctx.getState(),d.businessScene);d.profile.id=`MAP-${crypto.randomUUID().slice(0,8)}`;d.profile.name=`${sceneLabel(ctx.getState(),d.businessScene)}原表映射`;d.profile.layout=config.layout;d.profile.ruleIds=[...config.ruleIds];}d.editingId=profile?.id||'';delete d.roleMapText;d.roleMapError='';invalidate(d);render();return true;
    }
    if(id==='rule-import-sheet'&&d.type==='rule-import'){
      d.sheet=target.value;const sheet=d.inspected?.sheets.find(s=>s.name===d.sheet);d.sourceText=sheet?worksheetText(sheet):'';invalidateRules(d);render();return true;
    }
    const handled=input(event);if(handled&&['input-layout','input-scene','input-sheet','input-header-row','rule-import-mode','rule-import-scene'].includes(id))render();return handled;
  }
  return{dialog:d=>importDialog(d,ctx.getState(),ctx.getCatalog()),action,change,input,reconcile};
}
