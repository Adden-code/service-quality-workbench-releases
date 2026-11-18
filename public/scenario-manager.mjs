import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {findScenario,isSceneKey,saveScenarioConfig,checkScenarioCapabilities} from './scenarios.mjs';
import {scenarioDialog,scenarioRuleChoices,compatibleScenarioProfiles} from './scenario-ui.mjs';

const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value!==null&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const freshConfig=()=>({schemaVersion:1,id:`SCENE-${crypto.randomUUID().slice(0,8).toUpperCase()}`,name:'',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:[],analysisFields:['salesStage','intent','demandSummary','negativeVoice'],customFields:[],report:{title:'',groupBy:'product',groupField:'',groupLabel:uiT('产品'),sections:['overview','breakdown','dimensions','cases','improvements','voc']},requiredCapabilities:['text-judgment']});
const changeSelection=(values,value,checked)=>checked?[...new Set([...(values||[]),value])]:(values||[]).filter(item=>item!==value);

export function createScenarioManager(ctx){
  const getDialog=()=>ctx.getDialog(),render=()=>ctx.renderDialog();
  const recoveryBlocked=d=>Boolean(d?.expectedSaved&&(ctx.getWorkspaceStatus?.().hasPending||ctx.getWorkspaceStatus?.().conflicted||d.saveConflict));
  function syncRecoveryControls(d){
    if(typeof document==='undefined'||getDialog()!==d)return;
    const blocked=recoveryBlocked(d);for(const node of document.querySelectorAll?.('#overlay-root .scenario-form input,#overlay-root .scenario-form select,#overlay-root .scenario-form textarea,#overlay-root [data-act="scenario-save"],#overlay-root [data-act="scenario-next"],#overlay-root [data-act="scenario-back"]')||[]){
      if(blocked){if(node.dataset.scenarioRecoveryDisabled===undefined)node.dataset.scenarioRecoveryDisabled=node.disabled?'true':'false';node.disabled=true;}
      else if(node.dataset.scenarioRecoveryDisabled!==undefined){node.disabled=node.dataset.scenarioRecoveryDisabled==='true';delete node.dataset.scenarioRecoveryDisabled;}
    }
  }
  function feedback(d,message){d.error=message;const slot=typeof document!=='undefined'?document.getElementById('scenario-error'):null;if(slot){slot.textContent=uiError(message);ctx.renderDialog(false);syncRecoveryControls(d);}else render();}
  function reconcile(){
    const d=getDialog();if(!d?.expectedSaved)return 'none';
    const status=ctx.getWorkspaceStatus?.()||{};if(status.hasPending||status.conflicted){feedback(d,'场景保存结果尚未确认，请先重试保存或重新加载工作区；当前输入保留。');return 'pending';}
    const actual=findScenario(ctx.getState(),d.expectedSaved.id);
    if(actual&&canonical(actual)===canonical(d.expectedSaved)){ctx.openDialog({type:'scenario-list'});ctx.render();return 'saved';}
    if(actual&&actual.version>=d.expectedSaved.version){d.saveConflict=true;feedback(d,'场景保存冲突：相同标识或版本已有不同配置，请重新打开并核对。当前输入保留。');return 'conflict';}
    d.saveConflict=false;syncRecoveryControls(d);return 'not_saved';
  }
  function openEditor(id,readOnly=false){
    const config=findScenario(ctx.getState(),id);if(!config)throw new Error('场景已不存在，请重新加载场景列表。');
    const builtin=config.builtin||!config.id.startsWith('SCENE-');
    ctx.openDialog({type:'scenario-edit',step:1,readOnly:readOnly||builtin,editingId:config.id,expectedVersion:config.version,config:clone(config),selectedProfileId:config.inputProfileId||''});
  }
  function requireStep(d){
    const config=d.config;if(d.readOnly)return;
    if(d.step===1){if(!config.id?.startsWith('SCENE-')||!isSceneKey(config.id))throw new Error('请使用有效的 SCENE- 场景标识。');if(!config.name?.trim())throw new Error('请填写场景名称。');}
    if(d.step===5){if(!config.report.title?.trim())throw new Error('请填写报告标题。');if(config.report.groupBy==='context'&&(!config.report.groupField?.trim()||!config.report.groupLabel?.trim()))throw new Error('请填写明确的配套字段键与分组显示名称。');}
  }
  function prepareSave(d,state,catalog=ctx.getCatalog()){
    const config=clone(d.config),selectedId=d.selectedProfileId??config.inputProfileId??'';
    if(d.editingId&&config.id!==d.editingId)throw new Error('已保存场景的标识不能修改。');
    delete config.builtin;
    let nextState=state;
    if(selectedId){
      const profile=compatibleScenarioProfiles(state,config.layout).find(item=>item.id===selectedId);
      if(!profile)throw new Error('所选字段映射已不存在或模板不匹配，请重新选择。');
      if(profile.scene===config.id)config.inputProfileId=profile.id;
      else{
        const copy={...clone(profile),id:`MAP-${crypto.randomUUID().slice(0,12).toUpperCase()}`,name:`${config.name} · ${profile.name}`.slice(0,120),scene:config.id,version:1};
        config.inputProfileId=copy.id;nextState={...state,inputProfiles:[...(state.inputProfiles||[]),copy]};
      }
    }else config.inputProfileId='';
    const choices=scenarioRuleChoices(catalog,{state,scene:config.id});
    if(config.ruleIds.some(id=>!choices.some(rule=>rule.id===id)))throw new Error('当前默认规则未归属于本场景，请移除或先在规则管理中维护归属。');
    const rules=choices.filter(rule=>config.ruleIds.includes(rule.id)),warnings=checkScenarioCapabilities(config,rules);
    if(config.enabled&&warnings.length)throw new Error(warnings.join('；'));
    const next=saveScenarioConfig(nextState,config,{expectedVersion:d.expectedVersion??0,now:ctx.now?.()||new Date().toISOString()});
    return{state:next,saved:findScenario(next,config.id)};
  }
  async function action(act,button={dataset:{}}){
    if(!act?.startsWith('scenario-'))return false;
    let d=getDialog();if(d?.loading)return true;
    try{
      if(d?.expectedSaved){const result=reconcile();if(result==='saved'||result==='pending'||(result==='conflict'&&act!=='scenario-cancel'))return true;if(result==='not_saved')delete d.expectedSaved;}
      if(act==='scenario-manage'){ctx.openDialog({type:'scenario-list'});return true;}
      if(act==='scenario-new'){ctx.openDialog({type:'scenario-edit',step:1,config:freshConfig(),expectedVersion:0,selectedProfileId:''});return true;}
      if(act==='scenario-edit'||act==='scenario-inspect'){openEditor(button.dataset?.id,act==='scenario-inspect');return true;}
      if(act==='scenario-cancel'){ctx.openDialog({type:'scenario-list'});return true;}
      if(act==='scenario-toggle'){
        const id=button.dataset?.id,config=findScenario(ctx.getState(),id);if(!config||config.builtin||!id.startsWith('SCENE-'))throw new Error('内置场景为只读配置。');
        if(!config.enabled){const warnings=checkScenarioCapabilities(config,scenarioRuleChoices(ctx.getCatalog(),{state:ctx.getState(),scene:config.id}).filter(rule=>config.ruleIds.includes(rule.id)));if(warnings.length)throw new Error(warnings.join('；'));}
        const expectedVersion=Number(button.dataset?.version??config.version);
        await ctx.commitWorkspace(({state,catalog})=>({state:saveScenarioConfig(state,{...clone(config),enabled:!config.enabled},{expectedVersion,now:ctx.now?.()||new Date().toISOString()}),catalog}));
        ctx.openDialog({type:'scenario-list'});ctx.render();ctx.toast(config.enabled?'场景已停用，历史任务保留原配置':'场景已启用');return true;
      }
      if(d?.type!=='scenario-edit')return false;
      if(act==='scenario-save'&&d.expectedSaved){const result=reconcile();if(['saved','pending','conflict'].includes(result))return true;}
      if(recoveryBlocked(d)){feedback(d,'请先恢复场景保存结果，当前输入保留。');return true;}
      if(act==='scenario-next'){requireStep(d);d.step=Math.min(6,(d.step||1)+1);d.error='';render();}
      else if(act==='scenario-back'){d.step=Math.max(1,(d.step||1)-1);d.error='';render();}
      else if(d.readOnly){if(act==='scenario-save')feedback(d,'内置场景为只读配置。');}
      else if(act==='scenario-custom-add'){if(d.config.customFields.length>=20)throw new Error('最多20个自定义分析字段。');d.config.customFields.push({id:'',label:'',type:'text',instruction:'',options:[]});render();}
      else if(act==='scenario-custom-remove'){d.config.customFields.splice(Number(button.dataset?.index),1);render();}
      else if(act==='scenario-save'){
        d.loading=true;d.error='';await ctx.commitWorkspace(({state,catalog})=>{const next=prepareSave(d,state,catalog);d.expectedSaved=clone(next.saved);return{state:next.state,catalog};});
        d.loading=false;ctx.openDialog({type:'scenario-list'});ctx.render();ctx.toast('场景配置已保存');
      }else return false;
    }catch(error){if(d&&getDialog()===d)feedback(d,error.message);else ctx.toast(error.message,true);}
    finally{if(d){d.loading=false;syncRecoveryControls(d);}}
    return true;
  }
  function input(event){
    const d=getDialog(),target=event.target,id=target.id||'',data=target.dataset||{};
    if(d?.type!=='scenario-edit'||d.loading||d.readOnly)return false;if(recoveryBlocked(d))return true;
    const config=d.config;
    if(data.scenarioAnalysis)config.analysisFields=changeSelection(config.analysisFields,data.scenarioAnalysis,target.checked);
    else if(data.scenarioRule)config.ruleIds=changeSelection(config.ruleIds,data.scenarioRule,target.checked);
    else if(data.scenarioSection){if(data.scenarioSection!=='overview')config.report.sections=changeSelection(config.report.sections,data.scenarioSection,target.checked);}
    else if(data.scenarioCapability)config.requiredCapabilities=changeSelection(config.requiredCapabilities,data.scenarioCapability,target.checked);
    else if(data.scenarioCustomIndex!==undefined&&data.scenarioCustomKey){
      const field=config.customFields[Number(data.scenarioCustomIndex)],key=data.scenarioCustomKey;if(!field)return false;
      field[key]=key==='options'?target.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean):target.value;
      if(key==='type'&&target.value!=='enum')field.options=[];
    }else if(target.name==='scenario-layout'){
      config.layout=target.value;const profile=(ctx.getState().inputProfiles||[]).find(item=>item.id===(d.selectedProfileId??config.inputProfileId));if(profile?.layout!==config.layout){d.selectedProfileId='';config.inputProfileId='';}
    }else if(id==='scenario-input-profile')d.selectedProfileId=target.value;
    else if(id==='scenario-id'){if(!d.editingId)config.id=target.value;}
    else if(id==='scenario-name'){const previous=config.name;config.name=target.value;if(!config.report.title||config.report.title===`${previous}质检报告`||config.report.title===`${previous} Quality Inspection Report`)config.report.title=target.value?uiT('{0}质检报告',{0:target.value}):'';}
    else if(id==='scenario-enabled')config.enabled=target.checked;
    else if(id==='scenario-report-title')config.report.title=target.value;
    else if(id==='scenario-report-group-field')config.report.groupField=target.value;
    else if(id==='scenario-report-group-label')config.report.groupLabel=target.value;
    else if(id==='scenario-report-group-by'){config.report.groupBy=target.value;config.report.groupField='';config.report.groupLabel=target.value==='product'?uiT('产品'):target.value==='agent'?uiT('客服'):'';}
    else return false;
    d.error='';return true;
  }
  function change(event){
    const handled=input(event),target=event.target;
    if(handled&&(target.name==='scenario-layout'||['scenario-input-profile','scenario-report-group-by','scenario-enabled'].includes(target.id)||target.dataset?.scenarioCustomKey==='type'||target.dataset?.scenarioCapability))render();
    return handled;
  }
  return{dialog:d=>scenarioDialog(d,ctx.getState(),ctx.getCatalog()),action,input,change,reconcile};
}
