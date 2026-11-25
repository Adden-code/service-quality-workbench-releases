import {createNativeReviewMaterialController,nativeReviewLanguage} from './native-review-language.mjs';
import {workspaceLanguage} from './workspace-language.mjs';
import {languageAcceptanceScreen,enforceWorkspaceLocale} from './workspace-language-ui.mjs';
import {startupMaintenanceNotice} from './startup-maintenance-view.mjs';
import {createAdminDraftTranslationController} from './admin-draft-translation.mjs';
import {createReasonTranslationController} from './reason-translation.mjs';
import {workspaceRecoveryDelay} from './workspace-read-budget.mjs';
import {rawInlineKeyboard} from './raw-inline-review.mjs';
import {installReadingControls} from './raw-review-layout.mjs';
installReadingControls();
import {clientBuild} from './build-identity.mjs';
import {taskProblemSummary} from './task-diagnostics.mjs';
import {renderUpdate} from './render-update.mjs';
import {usesInlineEcommerce,saveInlineEcommerce,inlineDrafts} from './ecommerce-inline-review.mjs';
import {localBasisDate,defaultSceneRuleIds} from './catalog-scenes.mjs';
import {saveClassificationReview} from './ecommerce-classification-review.mjs';
import {createRuleCalibrationManager} from './rule-calibration-ui.mjs';
import {taskLifecycleDialog} from './task-lifecycle-ui.mjs';
import {usableTaskState,isVoidedTask,isInactiveTask} from './task-lifecycle.mjs';
import {parseConsultationFile,updateRawImportOptions} from './raw-import-flow.mjs';
import {RAW_INPUT_MODE,RAW_EVIDENCE_VERSION,isRawTranscriptSession} from './raw-transcript.mjs';
import {createRawWorkbenchManager} from './raw-workbench-manager.mjs';
import {createRawReviewTimer} from './raw-review-timer.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {captureDialogInputs,restoreDialogInputs} from './dialog-input-recovery.mjs';
import {getLocale,setLocale} from './i18n.mjs';
import {createContentTranslationController,applyBundledRuleEnglish} from './content-translation-ui.mjs';
import {createBusinessState,INITIAL_TASK_ID,rules,policies,saveReview,acceptAI,confirmReview,confirmUnrepliedReview,markPending,reopenReview,createImportedTask,createRawReinspectionTask,recordRawReviewTime,getSessionResults,scopeState} from './domain.mjs';
import {e,icon,badge,focusCycleTarget} from './ui.mjs';
import {overviewView,tasksView,exportsView,exportSessions,referenceDateFor} from './views.mjs';
import {reviewView,reviewHeader,availableSessions,reviewQueue,updateRuleDisclosure,humanFooter} from './review-view.mjs';
import {dialogView} from './dialogs.mjs';
import {animateAppearance,animateExit,cancelMotion,cancelAllMotion} from './motion.mjs';
import {getManagementReport,buildManagementHtml} from './management-report.mjs';
import {createCatalogManager} from './catalog-controller.mjs';
import {reviewCompletion,nextPendingSession,reopenReviewContext} from './review-flow.mjs';
import {createWorkspaceClient} from './workspace-client.mjs';
import {createBusinessCatalog} from './catalog.mjs';
import {createBasisSnapshot,getSessionRules} from './task-basis.mjs';
import {createImportManager} from './import-manager.mjs';
import {createScenarioManager} from './scenario-manager.mjs';
import {findScenario,freezeScenario,checkScenarioCapabilities} from './scenarios.mjs';
import {latestSceneConfiguration,sceneBasisForTask} from './scene-configuration.mjs';
import {createSceneConfigurationManager,readSceneRuntime} from './scene-configuration-ui.mjs';
import {createEcommerceManager,ecommerceVersionKey} from './ecommerce-manager.mjs';
import {createRuleSetManager} from './rule-set-ui.mjs';
import {createWorkflowManager} from './workflow-manager.mjs';
import {confirmEcommerceCatalog,listExecutableEcommerceVersions,createEcommerceRuleSetBasis} from './ecommerce-catalog.mjs';
import {taskDetailView,handleTaskReportAction,assertConsultationInput,taskStartSettings,canSetRawRunConcurrency} from './task-workbench.mjs';
import {normalizeExecutionSettings} from './execution-settings.mjs';
import {eligibleSceneRules,assertTaskCatalogScene} from './catalog-scenes.mjs';
import {submitModelSettings} from './model-settings.mjs';
import {workspaceUsageDialog} from './workspace-usage-ui.mjs';
import {createDiagnosticManager} from './diagnostics-ui.mjs';
import {createWorkspaceBackupManager,workspaceBackupText} from './workspace-backup-ui.mjs';
import {triageDiagnosticsDialog} from './triage-diagnostics.mjs';
import {printableReport} from './report-print.mjs';
import {createReviewShortcutHandler,firstReviewActionControl} from './review-shortcuts.mjs';
import {createPendingResolutionManager} from './pending-resolution-manager.mjs';
import {createQualityInsightsManager} from './quality-insights-ui.mjs';
import {modelConnectionBadge} from './model-ui.mjs';
import {createBusinessExportManager} from './business-export-manager.mjs';
import {businessTasks} from './business-export-view.mjs';
import {handleTaskRuleSelectionChange,handleTaskRuleSelectionAction,captureTaskRuleViewport,restoreTaskRuleViewport} from './task-rule-selection-ui.mjs';
import {requiresHumanReview,reviewQueueBreakdown,isAIFinal} from './ai-triage.mjs';
import {createReviewRoutingController,reviewNavigationBadge} from './review-routing-ui.mjs';
import {readTriagePolicy} from './review-routing-ui.mjs';
import {DEFAULT_REVIEW_POLICY,normalizeReviewPolicy} from './ai-triage.mjs';
import {createConversationCleaningManager} from './conversation-cleaning-manager.mjs';
import {updateTaskDraftInput} from './task-draft.mjs';
import {createImportDraftManager,restoreImportDraft} from './import-drafts-manager.mjs';
import {createEcommerceConversionManager} from './ecommerce-conversion-manager.mjs';
import {captureCleaningViewport,restoreCleaningViewport} from './cleaning-viewport.mjs';

const navigation=[['overview','工作概览'],['tasks','质检任务'],['review','人工审核'],['rules','质检规则'],['knowledge','政策与知识'],['exports','结果导出']];
let storageWarning='',persistenceBlocked=false,saving=false,toastTimer,dialog=null,previousFocus=null,pollTimer;
let workspaceLoadFailed=false,workspaceReadFailures=0;
let composingInput=null,suspendedTaskDraft=null;
let lastPage=null,lastSession=null,keyboardInput=false;
let overlayEpoch=0,closingOverlay=false,finishOverlayClose=null,backdropPress=null;
const searchKeys={'task-search':'taskQuery','review-search':'reviewQuery','catalog-search':'catalogQuery'};
const ui={dataMode:'manual',page:'overview',period:'month',dashboardTaskId:INITIAL_TASK_ID,taskStatus:'全部',taskQuery:'',catalogQuery:'',reviewTaskId:INITIAL_TASK_ID,reviewStatus:'待确认',reviewQuery:'',selectedId:'',openRules:[],highlightedTurns:[],resultFilter:'全部',exportTaskId:INITIAL_TASK_ID,includePending:false,reportPeriod:'month',reportTaskId:INITIAL_TASK_ID};
const workspace=createWorkspaceClient({structuralSharing:true,storage:{getItem:key=>localStorage.getItem(key)}});
const reasonTranslations=createReasonTranslationController({getToken:()=>workspace.token,onChange:()=>redrawLocalized()});
const nativeMaterials=createNativeReviewMaterialController({api:businessExportApi,onChange:()=>redrawLocalized()});
const adminDraftTranslations=createAdminDraftTranslationController({getToken:()=>workspace.token,onChange:()=>redrawLocalized()});
const contentTranslations=createContentTranslationController({getToken:()=>workspace.token,onChange:()=>redrawLocalized()});
const workflowManager=createWorkflowManager({getToken:()=>workspace.token,openModal:openDialog,closeModal:()=>closeDialog({force:true}),onChange:()=>{if(dialog?.type==='workflow')renderDialog();},toast,download});
let state=createBusinessState(),catalog=createBusinessCatalog();
let languageChoice='',languageSaving=false,languageStage=0;
const businessExportManager=createBusinessExportManager({api:businessExportApi,getState:()=>scoped(),getUI:()=>ui,onRender:()=>render(),download,notify:toast});
const rawWorkbenchManager=createRawWorkbenchManager({getState:()=>state,getUI:()=>ui,getDialog:()=>dialog,getModelConfig:()=>ui.modelConfig,openDialog,closeDialog,renderDialog,render,toast,download,api:businessExportApi,configureModel:origin=>openModelSettings({returnDialog:origin}),commit,selectSession,reinspect:beginRawReinspection});
const rawReviewTimer=createRawReviewTimer({getSession:current,isActive:()=>ui.page==='review'&&(!dialog||['raw-edit','confirm-review','pending','policy','rule'].includes(dialog.type))&&document.visibilityState!=='hidden'&&(document.hasFocus?.()??true),save:packet=>commit(latest=>recordRawReviewTime(latest,packet),undefined,{reviewSessionId:packet.sessionId,deferRender:true,command:{action:'time',sessionId:packet.sessionId,packet,at:packet.now}})});

async function businessExportApi(url,{method='GET',body,signal}={}){
  const token=workspace.token;if(!token)throw new Error('工作区尚未加载，请稍后重试。');
  if(method!=='GET'&&(workspace.hasPending||workspace.conflicted))throw new Error('请先保存或恢复工作区，再开始生成交付物。');
  const response=await fetch(url,{method,signal,headers:{'X-Workspace-Token':token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'交付任务请求失败。'),{status:response.status});if(method==='POST'&&url==='/api/report-jobs'&&!workspace.hasPending&&!workspace.conflicted)adoptWorkspace(await workspace.refresh());return value;
}
try{const loaded=await workspace.load();state=loaded.state;catalog=loaded.catalog;languageStage=loaded.nativeLanguageStage||0;applyBundledRuleEnglish(catalog,state);}
catch(error){storageWarning=getLocale()==='en'?'Workspace loading is delayed. Retrying automatically; editing will unlock when loading succeeds.':`工作区暂未加载：${error.message} 正在自动重试，恢复后自动解除只读。`;persistenceBlocked=true;workspaceLoadFailed=true;}
try{const response=await fetch('/api/build-info',{cache:'no-store'});if(response.ok)ui.buildInfo=await response.json();}catch{}
const reviewRoutingController=createReviewRoutingController({getState:()=>scoped(),getUI:()=>ui,getDialog:()=>dialog,getRoot:()=>document.getElementById('overlay-root'),openDialog,closeDialog,commit,render,renderDialog,navigate:()=>go('review'),selectSession,now:reviewNow});
const qualityInsightsManager=createQualityInsightsManager({getState:()=>state,getDialog:()=>dialog,openDialog,renderDialog,download,beforeAuditDownload:async({taskIds})=>{const ids=taskIds.filter(id=>!isVoidedTask(state.tasks.find(task=>task.id===id)));await registerAuditDelivery(ids,'review-audit');}});
const diagnosticManager=createDiagnosticManager({getToken:()=>workspace.token,getDialog:()=>dialog,openDialog,renderDialog,download});
const workspaceBackupManager=createWorkspaceBackupManager({getToken:()=>workspace.token,getDialog:()=>dialog,openDialog,renderDialog,download,reload:()=>location.reload(),getStatus:()=>({saving,hasPending:workspace.hasPending,conflicted:workspace.conflicted,readOnly:persistenceBlocked,revision:workspace.revision,editing:Boolean(dialog&&!['workspace-backup','workspace-usage','shortcuts-help','help'].includes(dialog.type)),suspendedDraft:Boolean(suspendedTaskDraft),composing:Boolean(composingInput),timerPending:rawReviewTimer.pendingCount>0}),onReloadRequired:()=>{clearTimeout(pollTimer);persistenceBlocked=true;adminDraftTranslations.stop();contentTranslations.stop();reasonTranslations.stop();nativeMaterials.stop();workflowManager.stop();rawWorkbenchManager.stop();businessExportManager.setActive(false);}});
const pendingResolutionManager=createPendingResolutionManager({getState:()=>scoped(),getUI:()=>ui,getDialog:()=>dialog,openDialog,closeDialog,renderDialog,render,commit,selectSession,now:reviewNow});
const cleaningManager=createConversationCleaningManager({configureModel:origin=>openModelSettings({returnDialog:origin}),getState:()=>state,getDialog:()=>dialog,getModelConfig:()=>ui.modelConfig,openDialog,closeDialog:()=>closeDialog({force:true}),renderDialog,toast,
  prepareConversationCleaning:(input,options)=>workspace.prepareConversationCleaning(input,options),uploadSource:file=>workspace.uploadSource(file),
  beginCleanedTask:({parsed,file,scene,source,cleaningReportSnapshot,importDraft,name})=>{assertConsultationInput(parsed,state,scene);setMode('manual');render();openDialog({type:'new-task',mode:'manual',scene,scenarioSnapshot:freezeScenario(state,scene),step:2,parsed,file,fileName:file.name,source,cleaningReportSnapshot,requirePreviewConfirmation:true,name,_importDraft:importDraft,reviewer:cleaningReportSnapshot?.reviewer||'',catalog:catalogManager.getCatalog(),effectiveDate:localBasisDate(),ruleIds:[]});},
});
const ruleCalibrationManager=createRuleCalibrationManager({getState:()=>state,getDialog:()=>dialog,openDialog,renderDialog,read:()=>workspace.readCalibration(),mutate:async input=>{lockSaving(true);try{const value=await workspace.calibrate(input);if(input.action!=='preview')adoptWorkspace(value);return value;}finally{lockSaving(false);}}});
const catalogManager=createCatalogManager({initialCatalog:catalog,getState:()=>state,commitCatalog:next=>saveCatalogToWorkspace(next),deleteRule:async input=>{lockSaving(true);try{const value=await workspace.deleteRule(input);adoptWorkspace(value);return value.catalog;}finally{lockSaving(false);}},getDialog:()=>dialog,getUi:()=>ui,render,renderDialog,openDialog,closeDialog,toast,download});
const ruleSetManager=createRuleSetManager({getCatalog:()=>catalogManager.getCatalog(),getDialog:()=>dialog,openDialog,closeDialog,render,renderDialog,toast,download,commitCatalog:next=>saveCatalogToWorkspace(next),getWorkspaceStatus:()=>({hasPending:workspace.hasPending,conflicted:workspace.conflicted})});
const sceneConfigurationManager=createSceneConfigurationManager({ensureModelReady,uploadSource:file=>workspace.uploadSource(file),prepare:async input=>{const value=await workspace.prepareScenePackage(input);adoptWorkspace(value);return value;},getState:()=>state,getDialog:()=>dialog,openDialog,renderDialog,toast,reload:()=>workspace.refresh(),mutate:async input=>{lockSaving(true);try{const value=await workspace.configureScene(input);adoptWorkspace(value);return value;}finally{lockSaving(false);}}});
const scenarioManager=createScenarioManager({getState:()=>state,getCatalog:()=>catalogManager.getCatalog(),getDialog:()=>dialog,openDialog,closeDialog,render,renderDialog,toast,
  getWorkspaceStatus:()=>({hasPending:workspace.hasPending,conflicted:workspace.conflicted}),
  commitWorkspace:async(updater)=>{const saved=await writeWorkspace(updater);render();return saved;},
});
const importManager=createImportManager({saveImportDraft:d=>importDraftManager.save(d),getState:()=>state,getCatalog:()=>catalogManager.getCatalog(),getDialog:()=>dialog,getUi:()=>ui,openDialog,closeDialog:()=>closeDialog({force:true}),render,renderDialog,toast,download,
  getWorkspaceStatus:()=>({hasPending:workspace.hasPending,conflicted:workspace.conflicted}),
  commitWorkspace:async(updater,message)=>{const saved=await writeWorkspace(updater);render();if(message)toast(message);return saved;},
  uploadSource:file=>workspace.uploadSource(file),prepareRules:input=>workspace.prepareRules(input),
  beginMappedTask:({parsed,file,importDraft,name,reviewer,scene=parsed?.sessions?.[0]?.scene||'新品产品咨询',scenarioSnapshot,importMappingSnapshot,ruleIds=[]})=>{assertConsultationInput(parsed,state,scene);setMode('manual');render();openDialog({type:'new-task',mode:'manual',scene,scenarioSnapshot:scenarioSnapshot||freezeScenario(state,scene),step:2,parsed,file,fileName:file.name,_importDraft:importDraft,name,reviewer:reviewer||uiT('本机操作人'),requirePreviewConfirmation:true,importMappingSnapshot,catalog:catalogManager.getCatalog(),effectiveDate:localBasisDate(),ruleIds});},
});
const ecommerceManager=createEcommerceManager({ensureModelReady, getDialog:()=>dialog,openDialog,closeDialog:()=>closeDialog({force:true}),renderDialog,render,download,toast,
  getSceneConfig:()=>latestSceneConfiguration(state,'电商评论回复'),
  getRuleVersions:()=>{const config=latestSceneConfiguration(state,'电商评论回复');if(config){const r=config.basis.ruleSetSnapshot;return [{...(r||{version:config.basis.rules[0]?.version}),title:'场景冻结口径',ruleIds:config.ruleBindings.map(x=>x.ruleId)}];}return listExecutableEcommerceVersions(catalogManager.getCatalog(),{asOf:localBasisDate()});},
  confirmRules:async({owner})=>{await writeWorkspace(({state,catalog})=>({state,catalog:confirmEcommerceCatalog(catalog,{confirmed:true,source:'Sheet4',owner,now:new Date().toISOString()})}));render();},
  getWorkspaceStatus:()=>({hasPending:workspace.hasPending,conflicted:workspace.conflicted}),createTask:createEcommerceTask,reconcileCreated:reconcileEcommerceCreated});
const ecommerceConversionManager=createEcommerceConversionManager({getDialog:()=>dialog,renderDialog,getModelConfig:()=>ui.modelConfig,configureModel:origin=>openModelSettings({returnDialog:origin}),prepareMapping:async input=>{await importDraftManager.save(dialog);return workspace.prepareImportMapping(input);}});
const importDraftManager=createImportDraftManager({api:(url,options)=>workspace.importDraftRequest(url,options),getDialog:()=>dialog,openDialog,closeDialog,renderDialog,toast,uploadSource:file=>workspace.uploadSource(file),readSource:async sha=>{const response=await fetch(`/api/sources/${sha}`);if(!response.ok)throw new Error('导入草稿原文件无法读取。');return response.arrayBuffer();},getRuleVersions:()=>{const c=latestSceneConfiguration(state,'电商评论回复');return c?[{version:c.basis.rules[0]?.version,title:'场景冻结口径',ruleIds:c.ruleBindings.map(r=>r.ruleId)}]:listExecutableEcommerceVersions(catalogManager.getCatalog(),{asOf:localBasisDate()});},prepareRestored:value=>{if(value.type==='new-task'){value.catalog=catalogManager.getCatalog();}return value;}});
async function ensureModelReady(origin){
 if(ui.modelConfig?.configured&&ui.modelConfig?.connectionTested)return true;
 await openModelSettings({returnDialog:origin});return false;
}
function importFlowExtraDialog(d){
 if(d?.type==='import-change-confirm')return uiHtml`<div class="modal-backdrop" data-backdrop="true"><section class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><h2 id="dialog-title">确认更换导入来源</h2></header><div class="modal-body"><p>${uiT(d.nextAction==='scene'?'当前导入将保存为草稿。更换场景后需重新上传并预检。':'当前文件和预检会保存为草稿。更换文件后需重新预检，已填任务信息保留。')}</p><div class="form-error" id="form-error">${e(d.error||'')}</div></div><footer class="modal-footer"><button class="btn" data-act="import-cancel-change">保留当前导入</button><button class="btn primary" data-act="import-confirm-change">保存并更换</button></footer></section></div>`;
 return '';
}
async function importFlowAction(action){
 if(action==='import-change-scene'){if(dialog?.file)openDialog({type:'import-change-confirm',origin:dialog,nextAction:'scene'});else openDialog({type:'task-scene'});return true;}
 if(action==='import-cancel-change'){openDialog(dialog.origin);return true;}
 if(action==='import-confirm-change'){
  const pending=dialog,origin=pending.origin;await importDraftManager.save(origin);
  if(pending.nextAction==='scene'){openDialog({type:'task-scene'});return true;}
  delete origin._importDraft;origin.previewConfirmed=false;origin.mappingConfirmed=false;origin.sampleConfirmed=false;openDialog(origin);
  if(origin.type==='ecommerce-import')ecommerceManager.change({target:{id:'ec-file',files:[pending.nextFile]}});else if(origin.type==='input-mapping')importManager.change({target:{id:'input-file',files:[pending.nextFile]}});else await parseFile(pending.nextFile);
  return true;
 }
 if(action==='import-ai-convert'){
  if(!dialog?.file)throw new Error('请先上传原文件并完成预检。');
  if(dialog.type==='ecommerce-import'){await ecommerceConversionManager.open(dialog);return true;}
  dialog.requireConversionConfirmation=true;await importDraftManager.save(dialog);if(dialog.retainedConversion){const origin=dialog,restored=restoreImportDraft(origin.retainedConversion,origin.file);restored.returnDialog=origin;restored._importDraft=origin._importDraft;openDialog(restored);}else await cleaningManager.action('cleaning-open');return true;
 }
 return false;
}
function finishEcommerceImport(taskId){closeDialog({force:true});setMode('manual');showTaskDetail(taskId);toast('任务已创建；原人工参考独立保留，可在详情开始AI质检');}
function reconcileEcommerceCreated(owner){
  if(!owner.expectedCreated)return 'none';
  if(workspace.hasPending||workspace.conflicted)return 'pending';
  const expected=owner.expectedCreated,task=state.tasks.find(t=>t.id===expected.task.id),sessions=expected.sessions.map(s=>state.sessions.find(item=>item.id===s.id));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(task&&same(task,expected.task)&&sessions.every((s,i)=>s&&same(s,expected.sessions[i]))){finishEcommerceImport(task.id);return 'saved';}
  if(task||sessions.some(Boolean))return 'conflict';
  return 'not_saved';
}
async function createEcommerceTask({file,parsed,name,reviewer,basisVersion,executionSettings,ecReportMetadata,owner}){
  const recovery=reconcileEcommerceCreated(owner);if(recovery==='saved')return;if(['pending','conflict'].includes(recovery))throw new Error('请先恢复或核对上次保存结果，未重复创建任务。');
  if(!parsed?.valid||!parsed.sessions?.length||!file)throw new Error('请先核对有效电商评论文件。');
  await importDraftManager.save(owner);
  const sha=parsed.sessions[0].ecommerce.fileSha256;
  if(owner.savedSource?.sha256!==sha)owner.savedSource=await workspace.uploadSource(file);
  const source={...structuredClone(owner.savedSource),worksheet:{name:parsed.selectedSheet,index:parsed.selectedSheetIndex}},now=new Date().toISOString(),date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  await writeWorkspace(({state:latest,catalog})=>{
    const sceneConfig=latestSceneConfiguration(latest,'电商评论回复'),frozen=sceneConfig?sceneBasisForTask(latest,catalog,'电商评论回复',now):null;
    const selected=frozen?{version:frozen.rules[0].version,ruleIds:frozen.rules.map(r=>r.id)}:listExecutableEcommerceVersions(catalog,{asOf:date}).find(v=>ecommerceVersionKey(v)===basisVersion);
    if(!selected)throw new Error('所选电商规则版本不再可用，请重新选择已确认版本。');
    const nextCatalog=catalog,basisSnapshot=frozen||(selected.ruleSetId?createEcommerceRuleSetBasis(nextCatalog,{ruleSetId:selected.ruleSetId,version:selected.version,effectiveDate:date,now}):createBasisSnapshot(nextCatalog,{effectiveDate:date,ruleIds:[...selected.ruleIds],now}));
    const next=createImportedTask(latest,{name,reviewer,fileName:file.name,sessions:structuredClone(parsed.sessions),source,basisSnapshot,ecReportMetadata,executionSettings:normalizeExecutionSettings(executionSettings),reviewPolicy:normalizeReviewPolicy(owner.reviewPolicy||DEFAULT_REVIEW_POLICY),sceneRuntime:owner.sceneRuntime||{},sceneOverrideReason:owner.sceneOverrideReason||'',sceneConfigurationVersion:owner.sceneConfigurationVersion,now});
    const task=next.tasks[0];owner.expectedCreated={task:structuredClone(task),sessions:structuredClone(next.sessions.filter(s=>s.taskId===task.id))};
    return{state:next,catalog:nextCatalog};
  });
  await importDraftManager.complete(owner,owner.expectedCreated.task.id);
  finishEcommerceImport(owner.expectedCreated.task.id);if(owner.autoStart)await runAiTask(owner.expectedCreated.task.id);
}
function scoped(){const selected=scopeState(state,ui.dataMode);return ui.page==='tasks'||ui.page==='review'?selected:usableTaskState(selected);}
function setMode(mode){
  ui.dataMode='manual';const first=scoped().tasks[0];
  for(const key of ['dashboardTaskId','exportTaskId','reportTaskId'])ui[key]=first?.id||'';
  ui.reviewTaskId='';
  Object.assign(ui,{reviewStatus:'待确认',reviewQuery:'',taskQuery:'',taskStatus:'全部',showReviewRecords:false,selectedId:'',openRules:[],highlightedTurns:[]});
  const session=scoped().sessions[0];if(session)selectSession(session.id,false);
}
function adoptWorkspace(value){if(Number.isInteger(value.nativeLanguageStage))languageStage=value.nativeLanguageStage;state=value.state;catalog=value.catalog;applyBundledRuleEnglish(catalog,state);ui.aiRuntime=value.aiRuntime||ui.aiRuntime;catalogManager.replaceCatalog(catalog);storageWarning=value.aiRuntime?.error||'';persistenceBlocked=false;workspaceLoadFailed=false;workspaceReadFailures=0;}
function lockSaving(value){
  saving=value;document.body.classList.toggle('workspace-saving',value);
  for(const el of document.querySelectorAll('button,input,select,textarea')){
    if(value){el.dataset.saveDisabled=el.disabled?'true':'false';el.disabled=true;}
    else if(el.dataset.saveDisabled!==undefined){el.disabled=el.dataset.saveDisabled==='true';delete el.dataset.saveDisabled;}
  }
  document.body.setAttribute('aria-busy',String(value));
}
async function writeWorkspace(updater,options){
  if(workspaceBackupManager.blocksWorkspaceWrites)throw new Error(workspaceBackupText('备份或恢复期间暂停编辑；恢复完成后请重新加载页面。','Editing is paused during backup or restore. Reload the page after restoring.'));
  if(persistenceBlocked)throw new Error('工作区处于只读状态，请先重新加载工作区。');
  if(saving)throw new Error('上一项操作正在保存，请稍候。');
  lockSaving(true);
  try{const value=options?.command&&workspace.supportsReviewCommands?await workspace.reviewCommand(options.command):await workspace.transact(updater,options);adoptWorkspace(value);return value;}
  catch(error){storageWarning=error.message;renderStorageWarning();throw error;}
  finally{lockSaving(false);}
}
async function commit(updater,message,options){
  await writeWorkspace(({state:latest,catalog})=>({state:updater(latest),catalog}),options);
  if(!options?.deferRender)render();if(message)toast(message);
}
async function saveCatalogToWorkspace(next){
  const value=await writeWorkspace(({state})=>({state,catalog:next}));return value.catalog;
}
function renderStorageWarning(){
  const slot=document.getElementById('workspace-warning');if(!slot)return;
  const upgradeNotice=startupMaintenanceNotice(workspace.snapshot?.builtinUpgrade);
  slot.innerHTML=upgradeNotice+(storageWarning?uiHtml`<div class="storage-warning" role="alert">${e(uiError(storageWarning))} <button class="text-btn" data-act="${workspace.hasPending?'workspace-retry':'workspace-reload'}">${workspace.hasPending?uiT('重试保存'):uiT('重新加载工作区')}</button></div>`:'');
}
function reviewNow(){return new Date().toISOString();}
function toast(message,error=false){
  clearTimeout(toastTimer);
  const root=document.getElementById('toast-root');cancelMotion(root.firstElementChild);
  root.innerHTML=uiHtml`<div class="toast ${error?'error':''}" role="status">${icon(error?'alert':'check',17)}${e(error?uiError(message):uiT(message))}</div>`;
  const element=root.firstElementChild;
  animateAppearance(element,'toast',{keyboard:keyboardInput});
  toastTimer=setTimeout(()=>{
    const animation=animateExit(element,'toast',{keyboard:keyboardInput});
    const remove=()=>{if(root.firstElementChild===element)root.replaceChildren();};
    if(animation)animation.finished.then(remove,remove);else remove();
  },4200);
}
function current(){return state.sessions.find(s=>s.id===ui.selectedId);}
function focusIdentity(element){
  if(!element||element===document.body)return null;
  if(element.id)return `#${CSS.escape(element.id)}`;
  if(!element.dataset.act)return null;
  const card=element.closest('[data-rule-card]');
  const scope=element.closest('.review-dock')?'.review-dock ':card?`[data-rule-card="${CSS.escape(card.dataset.ruleCard)}"] `:'';
  return scope+['act','id','rule','page','value'].filter(key=>element.dataset[key]!==undefined).map(key=>`[data-${key}="${CSS.escape(element.dataset[key])}"]`).join('');
}
function restoreFocus(identity){
  if(!identity)return;
  const target=document.querySelector(identity)||document.querySelector('.review-dock button:last-child')||document.querySelector('.nav-link.active');
  target?.focus({preventScroll:true});
}
function render(){
  if(composingInput?.isConnected)return;
  const languageScreen=languageAcceptanceScreen(state,{choice:languageChoice,saving:languageSaving,stage:languageStage});
  if(languageScreen){renderUpdate(document.getElementById('app'),languageScreen);document.title=uiT('会话质检工作台');return;}
  const samePage=lastPage===ui.page;
  const disclosures=[...document.querySelectorAll('#app details[data-disclosure][open]')].map(el=>el.dataset.disclosure);
  const focused=samePage&&document.getElementById('app').contains(document.activeElement)?focusIdentity(document.activeElement):null;
  const scrolls=samePage?['.session-queue-list','#messages','.result-list'].map(selector=>({selector,top:document.querySelector(selector)?.scrollTop||0,left:document.querySelector(selector)?.scrollLeft||0})):[];
  const page=navigation.find(n=>n[0]===ui.page)||navigation[0];
  const viewState=scoped(),reviewBreakdown=reviewQueueBreakdown({...viewState,sessions:availableSessions(viewState)});
  const businessAvailable=businessTasks(viewState).length>0;
  const views={overview:overviewView,tasks:(viewState,viewUi)=>viewUi.taskDetailId?taskDetailView(viewState,viewUi):tasksView(viewState,viewUi),review:reviewView,rules:(_state,viewUi)=>catalogManager.view('rules',viewUi),knowledge:(_state,viewUi)=>catalogManager.view('policies',viewUi),exports:(s,u)=>businessAvailable?uiHtml`${businessExportManager.view(s,u)}<details class="panel advanced-audit-export" data-disclosure="audit-exports"><summary>追溯与审计导出（高级）</summary>${exportsView(s,u)}</details>`:exportsView(s,u)};
  let content;
  try{content=views[page[0]](viewState,ui);}catch(error){console.error(error);content=uiHtml`<div class="page-error"><h2>此页未能正常显示</h2><p>${e(uiError(error.message))}</p><button class="btn" data-act="nav" data-page="overview">返回工作概览</button></div>`;}
  const isReview=page[0]==='review';
  renderUpdate(document.getElementById('app'),uiHtml`<div class="layout" data-page="${page[0]}">
    <aside class="sidebar" aria-label="主导航"><a href="#overview" class="brand" data-act="nav" data-page="overview" aria-label="返回工作概览"><div class="brand-mark">质</div><strong>会话质检工作台</strong></a>
      <nav class="nav-list">${navigation.map(([id,label])=>{const link=uiHtml`<button class="nav-link ${page[0]===id?'active':''}" data-act="nav" data-page="${id}" aria-label="${uiT(label)}" aria-current="${page[0]===id?'page':'false'}">${icon(id==='exports'?'export':id,21)}<span>${uiT(label)}</span></button>`;return id==='review'?uiHtml`<div class="review-nav-item">${link}${reviewNavigationBadge(reviewBreakdown)}</div>`:link;}).join('')}</nav>
      <div class="sidebar-bottom"><div class="sidebar-foot"><span>本机业务工作区</span><details class="build-identity"><summary>${e(workspace.snapshot?.productVersion||clientBuild.version)}</summary><p>${e(ui.buildInfo?.buildId||clientBuild.buildId)}</p><p>${e(ui.buildInfo?.sourceCommit?.slice(0,12)||'development')}</p><p>${e(ui.buildInfo?.resourceFingerprint?.slice(0,16)||'')}</p></details></div><button class="btn small" data-act="workspace-backup-open">${workspaceBackupText('备份与恢复','Backup and restore')}</button></div>
    </aside>
    <main class="main"><header class="topbar ${isReview?'review-topbar':''}">${isReview?reviewHeader(viewState,ui):uiHtml`<div class="breadcrumb"><span>服务领域</span>${icon('chevron',11)}<span>会话质检</span>${icon('chevron',11)}<strong>${uiT(page[1])}</strong></div>`}
      <div class="top-tools">${isReview?uiHtml`<button class="text-btn" data-act="review-shortcuts-help">审核快捷键</button>`:''}<div class="locale-switch" role="group" aria-label="${getLocale()==='en'?'Interface language':'界面语言'}"><button data-act="ui-locale" data-locale="zh" ${workspaceLanguage(state)?.mode==='native-v1'?'disabled':''} aria-pressed="${getLocale()==='zh'}" lang="zh-CN">中文</button><button data-act="ui-locale" data-locale="en" ${workspaceLanguage(state)?.mode==='native-v1'?'disabled':''} aria-pressed="${getLocale()==='en'}" lang="en">English</button></div><span class="workspace-timezone" title="${getLocale()==='en'?'All displayed dates and timing use UTC+08:00':'所有日期及计时使用北京时间 UTC+08:00'}">UTC+08:00</span><button class="btn small" data-act="model-settings" aria-label="模型设置">模型设置</button><button class="icon-btn" data-act="help" title="使用指引" aria-label="使用指引">${icon('info',18)}</button>${isReview?'':uiHtml`<button class="profile text-btn" data-act="workspace-usage" aria-label="工作区用量"><span class="avatar">质检</span><span>本机工作区</span></button>`}</div>
    </header>${ui.buildInfo&&clientBuild.buildId!==ui.buildInfo.buildId?uiHtml`<div class="notice-banner warning" role="alert">页面与本机服务版本不同，请重新加载页面。<button class="btn" data-act="reload-build">重新加载页面</button></div>`:''}<div id="workspace-warning"></div><div class="content">${content}</div></main></div>`,{reuse:samePage&&isReview});
  renderStorageWarning();
  for(const key of disclosures){const node=document.querySelector(`#app details[data-disclosure="${CSS.escape(key)}"]`);if(node)node.open=true;}
  for(const saved of scrolls){
    if(saved.selector!=='.session-queue-list'&&lastSession!==ui.selectedId)continue;
    const element=document.querySelector(saved.selector);if(element){element.scrollTop=saved.top;element.scrollLeft=saved.left;}
  }
  if(lastPage!==ui.page)animateAppearance(document.querySelector('.content'),'page',{keyboard:keyboardInput});
  lastPage=ui.page;lastSession=ui.selectedId;
  restoreFocus(focused);
  renderDialog(false);
  businessExportManager.setActive(page[0]==='exports'&&businessAvailable);
  rawReviewTimer.sync();
  const reviewDisplayQueue=ui.page==='review'?reviewQueue(scoped(),ui):[];
  const visibleReview=reviewDisplayQueue.find(s=>s.id===ui.selectedId)||reviewDisplayQueue[0];
  const displaySessions=ui.page==='review'?(isInactiveTask(state.tasks.find(t=>t.id===ui.reviewTaskId))&&ui.historySessionFilter?reviewDisplayQueue.filter(s=>s.id===ui.historySessionFilter):[visibleReview,...reviewDisplayQueue.filter(s=>s.id!==visibleReview?.id)].filter(Boolean)):ui.page==='exports'?exportSessions(scoped(),ui):[];
  const taskFor=session=>state.tasks.find(task=>task.id===session.taskId);
  const first=displaySessions[0];if(first)reasonTranslations.ensure(first,{task:taskFor(first)});
  reasonTranslations.ensureNext(displaySessions.slice(1),{taskFor});
  const displayTasks=new Map(displaySessions.slice(0,8).map(session=>[session.taskId,taskFor(session)]));
  if(ui.page==='tasks'&&ui.taskDetailId)displayTasks.set(ui.taskDetailId,state.tasks.find(task=>task.id===ui.taskDetailId));
  for(const task of displayTasks.values())if(nativeReviewLanguage(task))nativeMaterials.ensure(task);
}
function redrawLocalized(){
  // Rendering a translated view must not replace unsaved user input with a
  // translated value or an older dialog draft, including when a job finishes.
  const inputs=[...document.querySelectorAll('#overlay-root input,#overlay-root select,#overlay-root textarea')].filter(el=>el.type!=='file').map(el=>({id:el.id,name:el.name,value:el.value,checked:el.checked,type:el.type,selectionStart:el.selectionStart,selectionEnd:el.selectionEnd}));
  render();renderDialog();
  for(const saved of inputs){const target=saved.id?document.getElementById(saved.id):[...document.querySelectorAll('#overlay-root input')].find(el=>el.name===saved.name&&el.value===saved.value);if(!target)continue;target.value=saved.value;if(['checkbox','radio'].includes(saved.type))target.checked=saved.checked;if(typeof saved.selectionStart==='number')try{target.setSelectionRange(saved.selectionStart,saved.selectionEnd);}catch{}}
}
function refreshImportDraftNotice(){
 const root=document.getElementById('overlay-root'),existing=root.querySelector('[data-import-draft-notice]');existing?.remove();
 if(!['task-scene','new-task','ecommerce-import'].includes(dialog?.type)||!ui.importDraftCount)return;
 const message=getLocale()==='en'?`${ui.importDraftCount} unfinished drafts. Continue in Inspection tasks → Import drafts.`:`有 ${ui.importDraftCount} 份未完成草稿，可在质检任务→导入草稿中继续`;
 root.querySelector('.modal-body')?.insertAdjacentHTML('afterbegin',`<div class="soft-note" data-import-draft-notice role="status">${e(message)}</div>`);
}
function loadImportDraftNotice(owner){
 if(!['task-scene','new-task','ecommerce-import'].includes(owner?.type))return;
 workspace.importDraftRequest('/api/import-drafts').then(value=>{ui.importDraftCount=(value.drafts||[]).filter(d=>d.status==='draft').length;if(dialog===owner)refreshImportDraftNotice();}).catch(()=>{});
}
function renderDialog(force=true){
  const root=document.getElementById('overlay-root');
  importDraftManager.schedule();
  if(!dialog){if(!closingOverlay)root.replaceChildren();return;}
  adminDraftTranslations.ensure(dialog);
  if(!force&&root.firstElementChild){refreshDialogRecovery();return;}
  root.inert=false;root.removeAttribute('aria-hidden');delete root.dataset.closing;
  const taskRuleViewport=dialog.type==='new-task'&&dialog.mode==='manual'&&dialog.step===3?captureTaskRuleViewport(root):null;
  const cleaningViewport=dialog.type==='conversation-cleaning'?captureCleaningViewport(root):null;
  const cleaningHighlight=dialog.type==='conversation-cleaning'?JSON.stringify(dialog.highlight||null):'';
  const locateCleaningQuote=Boolean(dialog.highlight)&&cleaningHighlight!==root.dataset.cleaningHighlight;
  const modalDisclosures=[...root.querySelectorAll('details[data-dialog-disclosure][open]')].map(el=>el.dataset.dialogDisclosure);
  const workflowDisclosures=[...root.querySelectorAll('details[data-workflow-snapshot][open]')].map(el=>el.dataset.workflowSnapshot);
  const workflowScroll=dialog.type==='workflow'?[...root.querySelectorAll('.workflow-body,.workflow-json')].map(el=>({className:el.className,top:el.scrollTop,left:el.scrollLeft})):[];
  const workflowFocus=['workflow','scenario-edit'].includes(dialog.type)?focusIdentity(document.activeElement):null;
  const scenarioScroll=dialog.type==='scenario-edit'?root.querySelector('.modal-body')?.scrollTop||0:0;
  root.innerHTML=(dialog.type==='shortcuts-help'?uiHtml`<div class="modal-backdrop" data-backdrop="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><header class="modal-head"><h2 id="dialog-title">审核快捷键</h2><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header><div class="modal-body"><p>J / K：下一条 / 上一条；E：编辑首个可处理项；Ctrl+Enter：按当前流程确认。</p><p class="hint">输入、弹窗、保存或未保存修改期间，快捷键不生效。普通 Enter 不会触发确认。</p></div><footer class="modal-footer"><button class="btn" data-act="workspace-usage">工作区用量</button><button class="btn primary" data-act="close-modal">关闭</button></footer></section></div>`:'')||diagnosticManager.dialog(dialog)||workspaceBackupManager.dialog(dialog)||pendingResolutionManager.dialog(dialog)||qualityInsightsManager.dialog(dialog)||workspaceUsageDialog(dialog)||triageDiagnosticsDialog(dialog,state)||taskLifecycleDialog(dialog,state)||rawWorkbenchManager.dialog(dialog)||ecommerceConversionManager.dialog(dialog)||importDraftManager.dialog(dialog)||importFlowExtraDialog(dialog)||cleaningManager.dialog(dialog)||(dialog.type==='workflow'?workflowManager.render():'')||sceneConfigurationManager.dialog(dialog)||scenarioManager.dialog(dialog)||ruleSetManager.dialog(dialog)||ecommerceManager.dialog(dialog)||importManager.dialog(dialog)||ruleCalibrationManager.dialog(dialog)||catalogManager.dialog(dialog)||dialogView(dialog,state,ui);
  refreshImportDraftNotice();
  for(const key of modalDisclosures){const node=root.querySelector(`details[data-dialog-disclosure="${CSS.escape(key)}"]`);if(node)node.open=true;}
  for(const key of workflowDisclosures){const node=root.querySelector(`details[data-workflow-snapshot="${CSS.escape(key)}"]`);if(node)node.open=true;}
  const workflowElements=[...root.querySelectorAll('.workflow-body,.workflow-json')];
  workflowScroll.forEach((saved,i)=>{const el=workflowElements[i];if(el){el.scrollTop=saved.top;el.scrollLeft=saved.left;}});
  if(workflowFocus)restoreFocus(workflowFocus);
  if(scenarioScroll&&dialog.type==='scenario-edit'){const body=root.querySelector('.modal-body');if(body)body.scrollTop=scenarioScroll;}
  restoreTaskRuleViewport(root,taskRuleViewport);
  if(dialog.type==='conversation-cleaning'){
    if(dialog.running||dialog.loading)for(const field of root.querySelectorAll('input,select,textarea'))field.disabled=true;
    restoreCleaningViewport(root,cleaningViewport,{locateQuote:locateCleaningQuote});root.dataset.cleaningHighlight=cleaningHighlight;
  }else delete root.dataset.cleaningHighlight;
  refreshDialogRecovery();
  document.getElementById('app').inert=true;document.body.style.overflow='hidden';
}
function refreshDialogRecovery(){
  const target=document.querySelector('#overlay-root .form-error');
  if(!target)return;
  for(const button of target.querySelectorAll('[data-workspace-recovery]'))button.remove();
  if((workspace.hasPending||workspace.conflicted)&&!target.querySelector('[data-act="workspace-retry"],[data-act="workspace-reload"]')){
    const button=document.createElement('button');button.className='text-btn';button.dataset.workspaceRecovery='true';
    button.dataset.act=workspace.hasPending?'workspace-retry':'workspace-reload';button.textContent=uiT(workspace.hasPending?'重试保存':'重新加载工作区（保留当前输入）');target.append(' ',button);
  }
}
function openDialog(value){
  if(workspaceBackupManager.blocksNavigation&&value!==dialog)return;
  if(dialog?.type==='raw-structure'&&value.type!=='raw-structure')rawWorkbenchManager.stop();
  if(dialog?.type==='workflow'&&value.type!=='workflow')workflowManager.stop();
  if(!dialog)previousFocus=focusIdentity(document.activeElement)||previousFocus;
  const root=document.getElementById('overlay-root');
  for(const element of root.querySelectorAll('.modal,.modal-backdrop'))cancelMotion(element);
  const epoch=++overlayEpoch;closingOverlay=false;finishOverlayClose=null;dialog=value;renderDialog();loadImportDraftNotice(value);
  const modal=root.querySelector('.modal');
  animateAppearance(root.firstElementChild,'backdrop',{keyboard:keyboardInput});
  animateAppearance(modal,modal.classList.contains('drawer')?'drawer':'dialog',{keyboard:keyboardInput});
  requestAnimationFrame(()=>{
    if(epoch!==overlayEpoch||dialog!==value)return;
    root.querySelector('.modal [autofocus],.modal input:not([type="file"]):not([disabled]),.modal textarea,.modal select:not([disabled]),.modal .icon-btn,.modal')?.focus({preventScroll:true});
  });
}
function closeDialog({immediate=false,force=false}={}){
  if(!force&&dialog?.type==='scfg-edit'&&(dialog.dirty||dialog.loading)){dialog.error=dialog.loading?'当前操作正在进行，请等待保存结果。':'有未保存修改。请先保存草稿，或点击放弃本地修改。';renderDialog();return;}
  if(workspaceBackupManager.blocksNavigation||diagnosticManager.busy)return;
  if(dialog?.type==='raw-structure')rawWorkbenchManager.stop();
  if(dialog?.type==='conversation-cleaning')cleaningManager.cancel();
  if(!immediate&&!force&&importDraftManager.eligible(dialog)){const owner=dialog;void importDraftManager.closeAndSave(owner,()=>closeDialog({force:true}));return;}
  if(saving||(!force&&dialog?.loading&&(['input-mapping','rule-import','ecommerce-import','scenario-edit'].includes(dialog.type)||dialog.type?.startsWith('rule-set-'))))return;
  if(!force&&dialog?.type==='scenario-edit'&&dialog.expectedSaved){
    const recovered=scenarioManager.reconcile();if(recovered==='saved')return;
    if(recovered==='pending'){toast('请先恢复本次场景保存结果，当前配置输入已保留。',true);return;}
  }
  if(!force&&dialog?.type?.startsWith('rule-set-')&&dialog.expectedRecord){
    const recovered=ruleSetManager.reconcile();
    if(recovered==='saved')return;
    if(['pending','conflict'].includes(recovered)){toast('请先恢复或核对本次口径保存结果，当前输入已保留。',true);return;}
  }
  if(!force&&dialog?.type==='ecommerce-import'&&dialog.expectedCreated){
    const recovered=reconcileEcommerceCreated(dialog);
    if(recovered==='saved')return;
    if(recovered==='pending'||recovered==='conflict'){toast('请先恢复或核对本次任务保存结果，当前导入输入已保留。',true);return;}
    if(recovered==='not_saved')dialog.expectedCreated=null;
  }
  if(!immediate&&dialog?.type==='model-settings'&&dialog.returnDialog){const origin=dialog.returnDialog;if(origin.conversion)origin.conversion.consent=false;if(origin.type==='conversation-cleaning')cleaningManager.resume(origin);else openDialog(origin);return;}
  if(!dialog&&!closingOverlay)return;
  if(dialog?.type==='workflow')workflowManager.stop();
  dialog=null;const epoch=++overlayEpoch,root=document.getElementById('overlay-root'),modal=root.querySelector('.modal');
  closingOverlay=true;
  document.getElementById('app').inert=false;document.body.style.overflow='';
  restoreFocus(previousFocus);
  root.inert=true;root.setAttribute('aria-hidden','true');root.dataset.closing='true';
  const finish=()=>{
    if(epoch!==overlayEpoch||dialog)return;
    for(const element of root.querySelectorAll('.modal,.modal-backdrop'))cancelMotion(element);
    root.replaceChildren();root.inert=false;root.removeAttribute('aria-hidden');delete root.dataset.closing;
    closingOverlay=false;finishOverlayClose=null;
  };
  finishOverlayClose=finish;
  if(immediate){finish();return;}
  const animations=[animateExit(modal,modal?.classList.contains('drawer')?'drawer':'dialog',{keyboard:keyboardInput}),animateExit(root.firstElementChild,'backdrop',{keyboard:keyboardInput})].filter(Boolean);
  if(!animations.length)finish();else Promise.all(animations.map(animation=>animation.finished.catch(()=>{}))).then(finish);
}
function formError(message){const target=document.getElementById('form-error');if(target)target.innerHTML=`${e(uiError(message))}${workspace.hasPending||workspace.conflicted?uiHtml` <button class="text-btn" data-act="${workspace.hasPending?'workspace-retry':'workspace-reload'}">${workspace.hasPending?uiT('重试保存'):uiT('重新加载工作区（保留当前输入）')}</button>`:''}`;else toast(message,true);}
function go(page,id){if(!navigation.some(n=>n[0]===page))page='overview';if(page==='review'&&ui.page!==page){ui.showReviewRecords=false;if(!id){ui.reviewStatus='待确认';ui.reviewQuery='';ui.selectedId='';}}if(page!==ui.page){ui.catalogCategory='';ui.catalogStatus='';}ui.page=page;if(id)selectSession(id,false);if(location.hash!==`#${page}`)history.replaceState(null,'',`#${page}`);closeDialog({immediate:true});render();window.scrollTo({top:0,behavior:'instant'});}
function selectSession(id,redraw=true){
  const s=state.sessions.find(s=>s.id===id);if(!s)return;
  const results=getSessionResults(s);
  ui.selectedId=id;ui.resultFilter='全部';ui.openRules=results.filter(r=>(r.final?.verdict||r.verdict)==='不符合').map(r=>r.ruleId).slice(0,2);
  if(!ui.openRules.length)ui.openRules=[results[0]?.ruleId].filter(Boolean);
  const first=results.find(r=>r.ruleId===ui.openRules[0]);
  ui.highlightedTurns=first?.final?.evidence||first?.evidence||[];
  if(redraw)render();
}
function showTaskDetail(id){ui.taskDetailId=id;go('tasks');}
function taskReview(id){ui.showReviewRecords=false;ui.reviewSceneFilter='';ui.reviewTaskId=id;ui.reviewStatus='待确认';ui.reviewQuery='';const sessions=state.sessions.filter(s=>s.taskId===id);const next=sessions.find(requiresHumanReview)||sessions[0];if(next)selectSession(next.id,false);go('review');}
function nextSession(){const session=nextPendingSession(scoped(),ui);if(!session){ui.showReviewRecords=false;render();return;}ui.reviewStatus='待确认';ui.reviewQuery='';ui.showReviewRecords=false;selectSession(session.id);}
function download(data,name,mime){if(typeof data==='string'&&mime?.startsWith('text/html'))data=printableReport(data);const blob=data instanceof Blob?data:new Blob([data],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function io(){return import('./io.mjs');}
async function parseFile(file,{selectedSheet}={}){
  if(saving)return;
  if(!file||!dialog||dialog.type!=='new-task')return;
  const owner=dialog,request=Symbol('file-read');owner.parseRequest=request;
  // A replacement upload starts a fresh source chain. Keep task labels, never
  // attach a prior cleaning/mapping audit to a different physical workbook.
  for(const key of ['retainedConversion','conversion','reviewedMapping','parsed','source','savedSource','cleaningReportSnapshot','importMappingSnapshot','cleaningSuggested','expectedCreated','basisSnapshot','reinspectionOf'])delete owner[key];
  owner.ruleIds=[];delete owner.defaultsApplied;
  owner.file=file;owner.fileName=file.name;
  if(file.size>8*1024*1024){dialog.loading=false;dialog.error='文件请控制在8MB以内，请分批导入。';renderDialog();return;}
  dialog.loading=true;dialog.error='';renderDialog();
  try{
    const parsed=await parseConsultationFile(file,{scene:owner.scene||'新品产品咨询',rawOptions:owner.rawImportOptions,selectedSheet});
    if(dialog!==owner||owner.parseRequest!==request)return;
    owner.parsed=parsed;owner.previewConfirmed=false;if(parsed.rawDirect)updateRawImportOptions(owner,{outputLanguage:getLocale()});
    if(!parsed.valid){owner.step=2;throw new Error((parsed.errors||['文件核对未通过']).join('；'));}
    assertConsultationInput(parsed,state,owner.scene||'新品产品咨询');
    dialog.loading=false;dialog.parsed=parsed;dialog.file=file;dialog.fileName=file.name;dialog.step=2;renderDialog();
  }catch(error){if(dialog===owner&&owner.parseRequest===request){dialog.loading=false;dialog.error=error.message;renderDialog();}}
}
async function registerAuditDelivery(taskIds,kind){
  if(!taskIds.length)return;
  adoptWorkspace(await workspace.taskLifecycle([...new Set(taskIds)],'deliverable',{deliveryId:crypto.randomUUID(),kind}));
}
async function exportFile(type){
 const viewState=usableTaskState(scoped()),selected=exportSessions(viewState,ui);if(!selected.length){toast('当前范围没有可导出记录',true);return;}
 const module=await io(),options={taskId:ui.exportTaskId,includePending:ui.includePending};
 const data=type==='xlsx'?await module.buildResultXlsx(viewState,options):module.buildHtmlReport(viewState,options);
 await registerAuditDelivery(selected.map(row=>row.taskId),'audit-'+type);
 download(data,type==='xlsx'?'质检任务_质检明细.xlsx':'质检任务_质检明细报告.html',type==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/html;charset=utf-8');
 toast(`已导出${selected.length}条会话，保留审核状态及依据版本`);
}
async function exportManagementFile(){
 const viewState=usableTaskState(scoped()),options={period:ui.reportPeriod,repeatImports:ui.reportRepeatImports,taskId:ui.reportPeriod==='batch'?ui.reportTaskId:'',referenceDate:referenceDateFor(viewState,ui)},report=getManagementReport(viewState,options);
 if(!report.stats.totalSessions){toast('当前范围暂无会话，请切换统计范围',true);return;}
 const data=buildManagementHtml(viewState,options);
 await registerAuditDelivery(report.scope.sessions.map(row=>row.taskId),'management-html');
 download(data,`质检任务_管理分析报告_${report.periodLabel}_${options.referenceDate}.html`,'text/html;charset=utf-8');
 toast('已导出管理分析报告，质量统计采用AI终判及人工确认结果');
}
function refreshBasis(){
  dialog.basisSnapshot=null;dialog.error='';
  dialog.catalog=catalogManager.getCatalog();
  const config=latestSceneConfiguration(state,dialog.scene||'新品产品咨询');
  if(config){try{dialog.basisSnapshot=sceneBasisForTask(state,dialog.catalog,config.sceneId);dialog.ruleIds=config.ruleBindings.map(r=>r.ruleId);dialog.sceneConfigurationVersion??=config.version;if(dialog.sceneConfigurationVersion!==config.version)throw new Error('场景发布版本已变化，请重新选择场景并核对。');}catch(error){dialog.basisSnapshot=null;dialog.error=error.message;}return;}
  dialog.effectiveDate ||= localBasisDate();
  if(!dialog.defaultsApplied){dialog.ruleIds=defaultSceneRuleIds({state,catalog:dialog.catalog,scene:dialog.scene||'新品产品咨询',effectiveDate:dialog.effectiveDate,preferred:dialog.ruleIds||[]});dialog.defaultsApplied=true;}
  const eligible=new Set(eligibleSceneRules({state,catalog:dialog.catalog,scene:dialog.scene||'新品产品咨询',effectiveDate:dialog.effectiveDate}).map(rule=>rule.id));
  dialog.ruleIds=(dialog.ruleIds||[]).filter(id=>eligible.has(id));
  if(!dialog.ruleIds?.length)return;
  try{dialog.basisSnapshot=createBasisSnapshot(dialog.catalog,{effectiveDate:dialog.effectiveDate,ruleIds:dialog.ruleIds});}
  catch(error){dialog.error=error.message;}
}
async function beginRawReinspection(parent){
  const response=await fetch(`/api/sources/${parent.source.sha256}`);if(!response.ok)throw new Error('原文重检无法读取归档原文件。');
  const file=new File([await response.arrayBuffer()],parent.source.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const parsed=await parseConsultationFile(file,{scene:parent.scene,rawOptions:parent.rawImportOptions,selectedSheet:state.sessions.find(s=>s.taskId===parent.id)?.rawTranscript?.sheet});if(!parsed.valid||!parsed.rawDirect)throw new Error('归档原文不再符合原文直判合同。');
  openDialog({type:'new-task',mode:'manual',scene:parent.scene,scenarioSnapshot:freezeScenario(state,parent.scene),step:3,name:parent.name+' · '+uiT('新规则重检'),reviewer:parent.reviewPolicy?state.sessions.find(s=>s.taskId===parent.id)?.review.reviewer:uiT('本机操作人'),file,fileName:file.name,source:structuredClone(parent.source),parsed,previewConfirmed:true,requirePreviewConfirmation:true,rawImportOptions:{...structuredClone(parent.rawImportOptions),outputLanguage:getLocale()},reinspectionOf:parent.id,catalog:catalogManager.getCatalog(),effectiveDate:localBasisDate(),ruleIds:[],executionSettings:parent.executionSettings,reviewPolicy:parent.reviewPolicy});refreshBasis();renderDialog();
}
async function downloadBusiness(){const bytes=await(await import('./business-input.mjs')).createBusinessXlsx({sample:false});download(bytes,'会话输入_标准模板.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
async function openModelSettings({returnDialog=null}={}){
  const owner={type:'model-settings',config:ui.modelConfig||{},loading:true,returnDialog};openDialog(owner);
  try{const config=await workspace.readModelConfig();ui.modelConfig=config;if(dialog===owner){owner.config=config;owner.loading=false;renderDialog();}}
  catch(error){if(dialog===owner){owner.loading=false;owner.error=error.message;renderDialog();}}
}
async function modelAction(action){
  const owner=dialog;if(owner?.type!=='model-settings')return;
  const values=Object.fromEntries([['model','model-id'],['baseUrl','model-base-url'],['authMode','model-auth-mode'],['apiKey','model-api-key'],['timeoutSeconds','model-timeout'],['reasoningEffort','model-reasoning-effort'],['maxTokens','model-max-tokens'],['deploymentRevision','model-deployment-revision'],['reasoningConfigVersion','model-reasoning-version']].map(([name,id])=>[name,document.getElementById(id)?.value??'']));
  let testStarted=false;
  const refreshConnection=()=>{
    if(dialog!==owner)return;
    const status=document.getElementById('model-connection-status');
    if(status)status.innerHTML=modelConnectionBadge(owner);
  };
  const actionWorkspace={
    saveModelConfig:changes=>workspace.saveModelConfig(changes),
    testModel:()=>{
      // submitModelSettings validates saved/dirty form values before reaching here.
      testStarted=true;owner.testing=true;
      owner.config=ui.modelConfig={...owner.config,connectionTested:false,connectionTestedAt:null};
      owner.message='正在连接模型服务…';refreshConnection();
      if(dialog===owner)document.getElementById('model-feedback').textContent=uiT(owner.message);
      return workspace.testModel();
    },
  };
  owner.message='';owner.error='';
  document.getElementById('model-error').textContent='';document.getElementById('model-feedback').textContent='';
  lockSaving(true);
  try{
    const outcome=await submitModelSettings(action,values,owner.config,actionWorkspace);
    if(action==='model-save'){
      owner.config=outcome.config;ui.modelConfig=owner.config;owner.message=owner.config.configured?'模型设置已保存':'设置已保存，请为当前接口配置密钥';owner.model=owner.config.model;
      if(dialog===owner)document.getElementById('model-api-key').value='';
    }else{
      if(outcome.result.config)owner.config=ui.modelConfig=outcome.result.config;
      owner.message=`连接成功 · ${outcome.result.modelId||outcome.input.model}`;
      reasonTranslations.configurationRecovered();
    }
    if(dialog===owner)document.getElementById('model-feedback').textContent=uiT(owner.message);
  }catch(error){
    if(testStarted){
      // A failed/rejected test may already have revoked the server's prior success.
      // If rereading fails, the conservative state set before the request remains.
      try{owner.config=ui.modelConfig=await workspace.readModelConfig();}catch{}
    }
    owner.error=error.message||String(error);owner.message='';
    if(dialog===owner){document.getElementById('model-error').textContent=uiError(error);document.getElementById('model-feedback').textContent='';}
  }
  finally{owner.testing=false;lockSaving(false);refreshConnection();}
  // Status-only updates above retain every live form value on validation/network errors.
  if(owner.message&&dialog===owner){renderDialog();}
}
async function runAiTask(taskId){
  if(!ui.modelConfig?.configured||!ui.modelConfig?.connectionTested){await openModelSettings();return;}
  const previous=ui.pendingAiStart,runId=previous?.taskId===taskId?previous.runId:crypto.randomUUID(),task=state.tasks.find(item=>item.id===taskId),settings=previous?.taskId===taskId&&previous.settings?previous.settings:taskStartSettings(task,ui);ui.pendingAiStart={taskId,runId,settings};
  lockSaving(true);
  try{const saved=await workspace.startAI(taskId,runId,settings);adoptWorkspace(saved);ui.pendingAiStart=null;}
  catch(error){if(error.status)ui.pendingAiStart=null;throw error;}
  finally{lockSaving(false);}
  render();const runningTask=state.tasks.find(t=>t.id===taskId);toast(runningTask?.aiStatus==='queued'?'任务已排队，前序结束后自动执行':runningTask?.reviewPolicy?.enabled?'AI质检已启动：有效PASS免审，不通过或不确定转人工':'AI质检已启动，校验后的初判将进入人工审核');
}
function scheduleWorkspacePoll(){
  clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{
    if(workspaceLoadFailed&&!workspaceBackupManager.requiresReload&&!workspaceBackupManager.blocksWorkspaceWrites&&!saving&&!dialog&&!composingInput&&!workspace.hasPending&&!workspace.conflicted){
      try{adoptWorkspace(await workspace.load());render();}
      catch{workspaceReadFailures++;storageWarning=getLocale()==='en'?'Workspace loading is delayed. Retrying automatically; saved records are retained. Editing unlocks after recovery.':'工作区读取暂时未完成，正在自动重试；已保存记录保留，恢复后自动解除只读。';renderStorageWarning();}
    }
    if(!persistenceBlocked&&!workspaceBackupManager.requiresReload&&!saving&&!dialog&&!composingInput&&!workspace.hasPending&&!workspace.conflicted){
      try{
        const revision=workspace.revision,value=await workspace.refresh(()=>!saving&&!dialog&&!composingInput);
        if(value){const hadWarning=Boolean(storageWarning);adoptWorkspace(value);if(value.revision!==revision||value.aiRuntime?.error)render();else if(hadWarning)renderStorageWarning();}
      }catch(error){workspaceReadFailures++;storageWarning=getLocale()==='en'?'Progress refresh is delayed. Retrying automatically; saved records and current inputs are retained.':'进度刷新暂时延迟，正在自动重试；已保存记录与当前输入保留。';renderStorageWarning();}
    }
    scheduleWorkspacePoll();
  },workspaceRecoveryDelay(workspaceReadFailures));
}

document.addEventListener('click',async event=>{
  const backdropClick=backdropPress?.released&&event.button===0&&event.target===backdropPress.target;
  backdropPress=null;
  const button=event.target.closest('[data-act]');
  if(!button){if(backdropClick)closeDialog();return;}
  if(button.disabled)return;
  event.preventDefault();const action=button.dataset.act,id=button.dataset.id;
  if(saving)return;
  if(workspaceBackupManager.blocksNavigation&&action!=='workspace-backup-reload')return;
  let releaseRawTiming;
  try{
    if(dialog?.type==='raw-edit')rawWorkbenchManager.captureEdit();
    if(['raw-confirm-next','raw-save-result','accept-ai','do-confirm-review','save-pending','save-draft','select-session','review-status','nav','task-review','task-list','raw-golden-open','raw-structure-open','raw-reinspect','pending-resolve-one','pending-resolve-task','pending-reopen','pending-resolution-save','workspace-backup-open','workspace-backup-tab-export','workspace-backup-tab-restore','workspace-backup-export','workspace-backup-preview','workspace-backup-restore'].includes(action)){releaseRawTiming=rawReviewTimer.suspend();await rawReviewTimer.flush();}
    if(await diagnosticManager.action(action))return;
    if(await workspaceBackupManager.action(action))return;
    if(await rawWorkbenchManager.click(action,button))return;
    if(['task-archive','task-restore','task-void','task-delete'].includes(action)){openDialog({type:'task-lifecycle',taskId:id,action:action.slice(5),error:''});return;}
    if(action==='task-lifecycle-save'){
      dialog.actor=document.getElementById('lifecycle-actor').value.trim();dialog.reason=document.getElementById('lifecycle-reason')?.value.trim()||'';
      dialog.cancelAI=document.getElementById('lifecycle-cancel-ai')?.checked===true;
      const administratorConfirmed=document.getElementById('lifecycle-administrator')?.checked===true;dialog.confirmTaskId=document.getElementById('lifecycle-confirm-id')?.value.trim()||'';
      if(['void','delete'].includes(dialog.action)&&!administratorConfirmed)throw new Error('请确认本机管理员操作。');
      lockSaving(true);try{adoptWorkspace(dialog.action==='delete'?await workspace.deleteTask({taskId:dialog.taskId,confirmTaskId:dialog.confirmTaskId,actor:dialog.actor,reason:dialog.reason,administratorConfirmed}):await workspace.taskLifecycle([dialog.taskId],dialog.action,{actor:dialog.actor,reason:dialog.reason,administratorConfirmed,...(dialog.action==='void'?{cancelAI:dialog.cancelAI}:{})}));}finally{lockSaving(false);}
      const deleted=dialog.action==='delete';closeDialog({force:true});render();toast(deleted?'任务已删除，完整备份位置可在任务页删除审计查看':'任务状态已保存，原文与结果完整保留');return;
    }
    if(action==='reload-build'){location.reload();return;}
    if(action==='task-problem-summary'){const task=state.tasks.find(t=>t.id===id);if(task){const text=taskProblemSummary(task,ui.buildInfo||{version:workspace.snapshot?.productVersion});try{await navigator.clipboard.writeText(text);toast(getLocale()==='en'?'Problem summary copied':'问题摘要已复制');}catch{download(text,'quality-problem-summary.json','application/json');}}return;}
    if(action==='admin-draft-translation-retry'){adminDraftTranslations.ensure(dialog,{retry:true});return;}
    if(action==='native-material-retry'){const task=state.tasks.find(t=>t.id===button.dataset.task);if(task)await nativeMaterials.ensure(task,{retry:true});return;}
    if(action==='native-language-retry'){const session=state.sessions.find(s=>s.id===button.dataset.session),task=state.tasks.find(t=>t.id===session?.taskId);if(!session||!nativeReviewLanguage(task))return;await rawReviewTimer.flush();lockSaving(true);try{await businessExportApi(`/api/tasks/${encodeURIComponent(task.id)}/ai/retry-native-language`,{method:'POST',body:{sessionId:session.id}});adoptWorkspace(await workspace.refresh());}finally{lockSaving(false);}render();toast(getLocale()==='en'?'Native-language retry saved. Review the original and retry audit.':'冻结语种重试已保存，请核对结果与重试留痕。');return;}
    if(action==='reason-translation-retry'){const session=button.dataset.session?state.sessions.find(s=>s.id===button.dataset.session):current();if(session)reasonTranslations.ensure(session,{retry:true,task:state.tasks.find(task=>task.id===session.taskId)});return;}
    if(action==='language-pick'){languageChoice=button.dataset.language;render();return;}
    if(action==='language-confirm'){languageSaving=true;render();try{adoptWorkspace(await workspace.chooseLanguage(languageChoice));enforceWorkspaceLocale(state);}finally{languageSaving=false;render();}return;}
    if(action==='ui-locale'){if(workspaceLanguage(state)?.mode==='native-v1'){enforceWorkspaceLocale(state);render();return;}setLocale(button.dataset.locale);document.title=uiT('会话质检工作台');redrawLocalized();return;}
    if(await ecommerceConversionManager.action(action,button))return;
    if(await importDraftManager.action(action,button))return;
    if(await importFlowAction(action,button))return;
    if(action==='cleaning-close'&&importDraftManager.eligible(dialog)){cleaningManager.cancel();await importDraftManager.save(dialog);}
    if(['cleaning-finish','ec-conversion-run'].includes(action)&&importDraftManager.eligible(dialog))await importDraftManager.save(dialog);
    if(await cleaningManager.action(action,button))return;
    if(await contentTranslations.handleAction(action,button))return;
    if(await businessExportManager.handleAction(action,button))return;
    if(handleTaskReportAction(action,action.startsWith('completion-')?ui.reviewTaskId:id,{ui,navigate:go,state}))return;
    if(await workflowManager.handleAction(action,button))return;
    if(action==='review-shortcuts-help'){openDialog({type:'shortcuts-help'});return;}
    if(action==='workspace-usage'||action==='workspace-usage-refresh'){
      const owner={type:'workspace-usage',loading:true};openDialog(owner);
      try{owner.usage=await businessExportApi('/api/workspace-usage');}catch(error){owner.error=error.message;}finally{owner.loading=false;if(dialog===owner)renderDialog();}return;
    }
    if(action==='triage-diagnostics'){openDialog({type:'triage-diagnostics',taskId:button.dataset.id||''});return;}
    if(action==='model-settings'){await openModelSettings();return;}
    if(action==='model-save'||action==='model-test'){await modelAction(action);return;}
    if(action==='run-ai'){await runAiTask(id);return;}
    if(action==='retry-scene-dependencies'){const session=state.sessions.find(s=>s.id===id);if(!session)throw new Error('会话不存在。');lockSaving(true);toast('正在重试本行依赖项，已保存的人工记录会保留。');try{adoptWorkspace(await workspace.retryDependencies(session.taskId,session.id));}finally{lockSaving(false);}render();toast('本行依赖重试已保存；如有人工记录，请查看候选判断后自行核对并重新确认。');return;}
    if(action==='pause-ai-queue'){lockSaving(true);try{adoptWorkspace(await workspace.pauseAIQueue());}finally{lockSaving(false);}render();toast('已暂停全部AI派发，正在处理的结果会保存');return;}
    if(action==='pause-ai'||action==='resume-ai'){lockSaving(true);try{adoptWorkspace(await workspace[action==='pause-ai'?'pauseAI':'resumeAI'](id));}finally{lockSaving(false);}render();toast(action==='pause-ai'?'已暂停本任务派发，当前请求完成后保存；其他任务可继续':'已继续AI质检');return;}
    if(action==='cancel-queued-ai'||action==='resume-ai-queue'){lockSaving(true);try{adoptWorkspace(await (action==='cancel-queued-ai'?workspace.cancelQueuedAI(id):workspace.resumeAIQueue()));}finally{lockSaving(false);}render();toast(action==='cancel-queued-ai'?'已取消本次AI运行，已保存结果保留':'已继续串行任务队列');return;}
    if(action==='workspace-retry'||action==='workspace-reload'){
      const editingDialog=dialog,inputDraft=captureDialogInputs(document.getElementById('overlay-root'));
      lockSaving(true);
      try{const value=action==='workspace-retry'?await workspace.retryPending():workspace.snapshot?.initialized?await workspace.reload():await workspace.load();adoptWorkspace(value);}
      finally{lockSaving(false);}
      const scenarioRestored=scenarioManager.reconcile();const rsRestored=ruleSetManager.reconcile();const ecRestored=ecommerceManager.reconcile?.();const restored=importManager.reconcile?.();if(dialog===editingDialog&&dialog)dialog.error='';render();if(dialog===editingDialog)restoreDialogInputs(document.getElementById('overlay-root'),inputDraft);toast(scenarioRestored==='saved'?'上次场景配置已核对保存成功，没有重复创建版本。':rsRestored==='saved'?'上次检核口径已核对保存成功，没有重复创建版本。':ecRestored==='saved'?'上次电商任务已核对保存成功，未重复导入。':restored==='saved'?'上次规则导入已确认保存，没有重复创建版本。':'工作区已加载，编辑内容仍保留；请核对当前记录后继续。');return;
    }
    if(await sceneConfigurationManager.action(action,button))return;
    if(await scenarioManager.action(action,button))return;
    if(await ruleSetManager.action(action,button))return;
    if(await ecommerceManager.action(action,button))return;
    if(action==='input-import'&&importDraftManager.eligible(dialog))await importDraftManager.save(dialog);
    if(await importManager.action(action,button))return;
    if(await ruleCalibrationManager.action(action,button))return;
    if(await catalogManager.action(action,button))return;
    if(await pendingResolutionManager.click(action,button))return;
    if(action==='view-processed-unknown'){ui.showReviewRecords=true;ui.reviewStatus='已处理待补充';render();return;}
    if(await qualityInsightsManager.action(action,button))return;
    if(await reviewRoutingController.handleAction(action,button))return;
    if(handleTaskRuleSelectionAction(action,{dialog,root:document.getElementById('overlay-root'),refreshBasis}))return;
    if(action==='nav'){ui.taskDetailId='';if(button.dataset.page==='review'){ui.reviewTaskId='';ui.reviewSceneFilter='';}go(button.dataset.page);}
    else if(action==='new-task'){if(dialog?.file){openDialog({type:'import-change-confirm',origin:dialog,nextAction:'scene'});}else openDialog({type:'task-scene'});}
    else if(action==='task-scene'){const scene=button.dataset.scene==='ecommerce'?'电商评论回复':button.dataset.scene==='consultation'?'新品产品咨询':button.dataset.scene,config=findScenario(state,scene,{includeDisabled:false});if(!config)throw new Error('场景已停用或不存在，请重新选择。');if(config.engine==='ecommerce')await ecommerceManager.action('ec-open');else{const scenarioSnapshot=freezeScenario(state,scene);openDialog({type:'new-task',scene,scenarioSnapshot,mode:'manual',step:1,requirePreviewConfirmation:true,reviewer:uiT('本机操作人'),catalog:catalogManager.getCatalog(),effectiveDate:localBasisDate(),ruleIds:[...config.ruleIds]});if(!config.builtin||config.inputProfileId)await importManager.action('input-import');}}
    else if(action==='execution-page'){const page=await workspace.readExecution(id,Number(button.dataset.offset||0));ui.executionPages??={};ui.executionPages[id]=page;if(ui.taskDetailId===id)render();}
    else if(action==='execution-close'){delete ui.executionPages?.[id];render();}
    else if(action==='task-detail')showTaskDetail(id);
    else if(action==='task-list'){ui.taskDetailId='';go('tasks');}
    else if(action==='help')openDialog({type:'help'});
    else if(action==='close-modal')closeDialog();
    else if(action==='period'){ui.period=button.dataset.value;render();}
    else if(action==='overview-undated-task'){ui.period='batch';ui.dashboardTaskId=id;render();}
    else if(action==='task-status'){ui.taskStatus=button.dataset.value;render();}
    else if(action==='task-review')taskReview(id);
    else if(action==='select-session')selectSession(id);
    else if(action==='review-status'){ui.reviewStatus=button.dataset.value;ui.showReviewRecords=true;render();}
    else if(action==='review-clear-scene'){ui.reviewSceneFilter='';render();}
    else if(action==='result-filter'){ui.resultFilter=button.dataset.value;render();}
    else if(action==='toggle-rule'){
      const open=!ui.openRules.includes(id);ui.openRules=open?[...ui.openRules,id]:ui.openRules.filter(v=>v!==id);
      if(current()?.rawTranscript){render();return;}
      updateRuleDisclosure(document.getElementById('app'),id,open,{keyboard:keyboardInput});
      const footer=document.querySelector('.results-footer');
      if(footer)footer.outerHTML=humanFooter(current(),'',ui,state);
    }
    else if(action==='evidence'){
      const scroll=document.getElementById('messages')?.scrollTop||0;ui.highlightedTurns=[Number(button.dataset.turn)];render();const messages=document.getElementById('messages');if(messages)messages.scrollTop=scroll;document.getElementById(`turn-${button.dataset.turn}`)?.scrollIntoView({behavior:keyboardInput||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    }
    else if(action==='raw-result-filter'){ui.rawResultFilter=button.dataset.value;render();}
    else if(action==='raw-show-quote'){ui.rawActiveRule=button.dataset.rule;ui.rawQuoteIndex=Number(button.dataset.quote)||0;ui.rawHitIndex=0;render();document.getElementById('raw-hit-0')?.scrollIntoView?.({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});}
    else if(action==='raw-hit-next'||action==='raw-hit-previous'){const count=Number(document.getElementById('raw-original')?.dataset.rawMatchCount)||0;if(count){ui.rawHitIndex=((ui.rawHitIndex||0)+(action==='raw-hit-next'?1:-1)+count)%count;render();document.getElementById('raw-hit-'+ui.rawHitIndex)?.scrollIntoView?.({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});}}
    else if(action==='policy-detail')openDialog({type:'policy',id});
    else if(action==='rule-detail')openDialog({type:'rule',id});
    else if(action==='ec-inline-verdict'||action==='ec-inline-use-ai'){
      const s=current(),rule=button.dataset.rule;if(!usesInlineEcommerce(s)||s.review.status==='已确认'||isAIFinal(s))return;
      const edits=(ui.ecInlineDrafts??={})[s.id]??={};
      if(action==='ec-inline-use-ai'){const original=s.aiResults.find(r=>r.ruleId===rule);if(original)edits[rule]=structuredClone(original);}else{const value=inlineDrafts(state,s,edits).find(d=>d.ruleId===rule);edits[rule]={...edits[rule],verdict:button.dataset.verdict,reason:value.verdict===button.dataset.verdict?value.reason:''};}
      render();document.querySelector(`[data-inline-rule="${rule}"] [data-verdict="${button.dataset.verdict||s.aiResults.find(r=>r.ruleId===rule)?.verdict}"]`)?.focus();
    }
    else if(action==='ec-inline-next-attention'){const rows=[...document.querySelectorAll('[data-needs-attention="true"]')];if(rows.length){const at=rows.findIndex(r=>r.dataset.inlineRule===ui.ecAttentionCursor);const next=rows[(at+1)%rows.length];ui.ecAttentionCursor=next.dataset.inlineRule;next.focus();}}
    else if(action==='ec-inline-edit'){document.querySelector(`[data-inline-rule="${button.dataset.rule}"] button`)?.focus();}
    else if(action==='ec-inline-save'||action==='ec-inline-confirm'){
      const sessionId=ui.selectedId,edits=structuredClone(ui.ecInlineDrafts?.[sessionId]||{}),at=reviewNow(),confirm=action==='ec-inline-confirm';
      const classification=document.querySelector('#ec-review-type')?{evaluationType:document.querySelector('#ec-review-type').value,vocKind:document.querySelector('#ec-review-voc').value,reason:document.querySelector('#ec-review-reason').value}:undefined;
      await commit(latest=>saveInlineEcommerce(latest,sessionId,edits,at,{confirm,classification}),confirm?'五项已确认并留痕':'五项草稿已保存；无法判定项保留待补充',{reviewSessionId:sessionId,deferRender:true,command:{action:'ecommerce',sessionId,at:at,edits,confirm,classification}});
      if(ui.ecInlineDrafts)delete ui.ecInlineDrafts[sessionId];if(ui.ecClassificationDrafts)delete ui.ecClassificationDrafts[sessionId];render();
    }
    else if(action==='edit-result'){if(usesInlineEcommerce(current()))document.querySelector(`[data-inline-rule="${button.dataset.rule}"] button`)?.focus();else openDialog({type:'edit-result',ruleId:button.dataset.rule});}
    else if(action==='add-issue')openDialog({type:'add-issue',ruleId:current()?.expectedRuleIds?getSessionRules(state,current())[0]?.id:'R003'});
    else if(action==='save-result'){
      const evidence=document.getElementById('edit-evidence').value.trim();
      if(evidence&&!/^\d+(\s*[;,；，]\s*\d+)*$/.test(evidence))throw new Error('证据轮次请填写整数，多项用英文分号分隔');
      const reason=document.getElementById('edit-reason').value.trim();if(!reason)throw new Error('请填写人工判断理由');
      const reference=document.getElementById('edit-reference').value;
      const draft={ruleId:document.getElementById('edit-rule').value,verdict:document.getElementById('edit-verdict').value,reason,evidence:evidence?evidence.split(/[;,；，]/).map(n=>Number(n.trim())):[],referenceIds:reference?[reference]:[],source:dialog.type==='add-issue'?'人工补充':'人工修改'};
      if(current()?.contextFields?.length)draft.fieldEvidence=[...document.querySelectorAll('[name="edit-field-evidence"]:checked')].map(el=>el.value);
      const sessionId=ui.selectedId,now=reviewNow();await commit(latest=>saveReview(latest,sessionId,draft,now),'人工判断已保存，确认会话后计入最终统计',{reviewSessionId:sessionId,deferRender:true,command:{action:'save',sessionId,at:now,draft}});closeDialog();ui.openRules=[draft.ruleId];ui.highlightedTurns=draft.evidence;render();
    }
    else if(action==='accept-ai'){const sessionId=ui.selectedId,now=reviewNow();await commit(latest=>acceptAI(latest,sessionId,now),'未修改项已采用AI结论；现有人工修改保持不变',{reviewSessionId:sessionId,command:{action:'accept',sessionId,at:now}});}
    else if(action==='save-draft'){const sessionId=ui.selectedId,now=reviewNow();await commit(latest=>reopenReview(latest,sessionId,now),'当前审核已暂存',{reviewSessionId:sessionId,command:{action:'reopen',sessionId,at:now}});}
    else if(action==='ec-classification-save'){const sessionId=ui.selectedId,packet={evaluationType:document.querySelector('#ec-review-type').value,vocKind:document.querySelector('#ec-review-voc').value,reason:document.querySelector('#ec-review-reason').value},at=reviewNow();await commit(latest=>saveClassificationReview(latest,sessionId,packet,at),undefined,{reviewSessionId:sessionId,command:{action:'classification',sessionId,at:at,packet}});}
    else if(action==='confirm-review')openDialog({type:'confirm-review'});
    else if(action==='confirm-unreplied')openDialog({type:'confirm-unreplied'});
    else if(action==='commit-unreplied'){
      const sessionId=ui.selectedId,now=reviewNow();await commit(latest=>confirmUnrepliedReview(latest,sessionId,latest.sessions.find(row=>row.id===sessionId)?.review?.reviewer,now),undefined,{reviewSessionId:sessionId,deferRender:true,command:{action:'unreplied',sessionId,at:now}});ui.showReviewRecords=false;
      const completedTaskId=state.sessions.find(session=>session.id===sessionId)?.taskId;
      if(completedTaskId&&reviewCompletion(scoped(),{...ui,reviewTaskId:completedTaskId}).complete)ui.reviewTaskId=completedTaskId;
      closeDialog();render();toast('已确认未回复事实，未计入质量通过率分母');
      animateAppearance(document.querySelector('.human-status .badge'),'feedback',{keyboard:keyboardInput});
    }
    else if(action==='do-confirm-review'){
      const sessionId=ui.selectedId,now=reviewNow();await commit(latest=>confirmReview(latest,sessionId,now),undefined,{reviewSessionId:sessionId,deferRender:true,command:{action:'confirm',sessionId,at:now}});ui.showReviewRecords=false;
      const completedTaskId=state.sessions.find(session=>session.id===sessionId)?.taskId;
      if(completedTaskId&&reviewCompletion(scoped(),{...ui,reviewTaskId:completedTaskId}).complete)ui.reviewTaskId=completedTaskId;
      closeDialog();
      render();toast('已完成人工确认，看板及导出结果已同步更新');
      animateAppearance(document.querySelector('.human-status .badge'),'feedback',{keyboard:keyboardInput});
    }
    else if(action==='pending')openDialog({type:'pending'});
    else if(action==='save-pending'){const notes=document.getElementById('pending-notes').value.trim();if(!notes)throw new Error('请说明需要补充的材料或信息');const sessionId=ui.selectedId,now=reviewNow();await commit(latest=>markPending(latest,sessionId,notes,now),'已标记为待补充，不计入最终质量结论',{reviewSessionId:sessionId,command:{action:'pending',sessionId,at:now,notes}});closeDialog();}
    else if(action==='reopen-review')openDialog({type:'reopen'});
    else if(action==='do-reopen'){const sessionId=ui.selectedId,now=reviewNow();await commit(latest=>reopenReview(latest,sessionId,now),'已重新打开审核，原人工判断保留为草稿',{reviewSessionId:sessionId,deferRender:true,command:{action:'reopen',sessionId,at:now}});Object.assign(ui,reopenReviewContext(ui));closeDialog();render();}
    else if(action==='next-session')nextSession();
    else if(action==='show-completion'){ui.showReviewRecords=false;render();}
    else if(action==='view-confirmed'){ui.showReviewRecords=true;ui.reviewStatus='已确认';ui.reviewQuery='';render();}
    else if(action==='continue-pending'){const info=reviewCompletion(scoped(),ui);if(info.nextTaskId)taskReview(info.nextTaskId);}
    else if(action==='download-business-template')await downloadBusiness();
    else if(action==='download-source'){const task=state.tasks.find(t=>t.id===id);if(!task?.source)throw new Error('该任务没有保存原文件');const response=await fetch(`/api/sources/${task.source.sha256}`);if(!response.ok)throw new Error('原文件读取失败');download(await response.blob(),task.fileName||task.source.name);}
    else if(action==='download-cleaning-report'){const task=state.tasks.find(t=>t.id===id);if(!task?.cleaningReportSnapshot)throw new Error('本任务没有模型清洗报告。');download(JSON.stringify(task.cleaningReportSnapshot,null,2),`${task.name}_清洗核对报告.json`,'application/json');}
    else if(action==='download-rule-source'){const rule=catalog.rules.find(r=>r.provenance?.source.sha256===id);if(!rule)throw new Error('规则原件不存在');const response=await fetch(`/api/sources/${id}`);if(!response.ok)throw new Error('规则原文件读取失败');download(await response.blob(),rule.provenance.source.name);}
    else if(action==='new-next'){if(!dialog.parsed?.valid)throw new Error('请先上传并核对有效文件。');if(dialog.requirePreviewConfirmation&&!dialog.previewConfirmed)throw new Error('请先核对并确认抽样预览。');const name=document.getElementById('new-task-name').value.trim();if(!name)throw new Error('请填写任务名称');dialog.name=name;if(dialog.mode==='manual'){dialog.reviewer=document.getElementById('new-task-reviewer').value.trim();if(!dialog.reviewer)throw new Error('请填写审核人标签');dialog.catalog=catalogManager.getCatalog();refreshBasis();}dialog.step=3;renderDialog();}
    else if(action==='new-manage-rules'){
      suspendedTaskDraft=dialog;ui.hasSuspendedTaskDraft=true;const scene=dialog.scene||'新品产品咨询';go('rules');ui.catalogScene=scene;render();
    }
    else if(action==='new-resume-draft'){
      if(!suspendedTaskDraft)return;const draft=suspendedTaskDraft;draft.catalog=catalogManager.getCatalog();draft.scenarioSnapshot=freezeScenario(state,draft.scene||'新品产品咨询');openDialog(draft);refreshBasis();renderDialog();
    }
    else if(action==='new-back'){dialog.step--;renderDialog();}
    else if(action==='create-business-task'||action==='create-business-task-start'){
      dialog.executionSettings=normalizeExecutionSettings(dialog.executionSettings,{raw:dialog.parsed?.rawDirect===true});
      const autoStart=action==='create-business-task-start';if(autoStart&&!await ensureModelReady(dialog))return;
      assertConsultationInput(dialog.parsed,state,dialog.scene||'新品产品咨询');refreshBasis();if(!dialog.basisSnapshot)throw new Error(dialog.error||'请至少选择一个有效检查项');
      assertTaskCatalogScene({state,catalog:dialog.catalog,scene:dialog.scene||'新品产品咨询',basisSnapshot:dialog.basisSnapshot});
      const owner=dialog;await importDraftManager.save(owner);const file=owner.file,input={name:owner.name,fileName:owner.fileName,sessions:structuredClone(owner.parsed.sessions),basisSnapshot:structuredClone(owner.basisSnapshot),reviewer:owner.reviewer,executionSettings:normalizeExecutionSettings(owner.executionSettings,{raw:owner.parsed.rawDirect===true}),now:new Date().toISOString()};
      if(owner.parsed.rawDirect){input.inputMode=RAW_INPUT_MODE;input.evidenceContractVersion=RAW_EVIDENCE_VERSION;input.rawImportOptions={...structuredClone(owner.rawImportOptions),outputLanguage:getLocale()};}
      input.reviewPolicy=readTriagePolicy(document.getElementById('overlay-root'),owner.reviewPolicy);
      const sceneConfig=latestSceneConfiguration(state,owner.scene||'新品产品咨询');if(sceneConfig){input.sceneRuntime=readSceneRuntime(document.getElementById('overlay-root'),sceneConfig,owner.sceneRuntime);input.sceneConfigurationVersion=owner.sceneConfigurationVersion;input.sceneOverrideReason=document.getElementById('scene-override-reason')?.value||owner.sceneOverrideReason||'';}
      if(owner.cleaningReportSnapshot)input.cleaningReportSnapshot=structuredClone(owner.cleaningReportSnapshot);
      if(owner.scenarioSnapshot)input.scenarioSnapshot=structuredClone(owner.scenarioSnapshot);
      const capabilityErrors=checkScenarioCapabilities(input.scenarioSnapshot||freezeScenario(state,owner.scene||'新品产品咨询'),input.basisSnapshot.rules);if(capabilityErrors.length)throw new Error(capabilityErrors.join('；'));
      if(owner.importMappingSnapshot)input.importMappingSnapshot=structuredClone(owner.importMappingSnapshot);
      // Upload may be retried safely; content-addressed source storage deduplicates bytes.
      lockSaving(true);try{input.source=await workspace.uploadSource(file);}finally{lockSaving(false);}
      await commit(latest=>{if(owner.reinspectionOf){const {sessions,source,...reinspection}=input;return createRawReinspectionTask(latest,owner.reinspectionOf,reinspection);}return createImportedTask(latest,input);});suspendedTaskDraft=null;ui.hasSuspendedTaskDraft=false;const task=state.tasks[0];await importDraftManager.complete(owner,task.id);closeDialog({force:true});setMode('manual');showTaskDetail(task.id);toast('任务已创建；原文件与依据版本已保存，可开始AI质检');if(autoStart)await runAiTask(task.id);
    }
    else if(action==='export-xlsx')await exportFile('xlsx');
    else if(action==='export-html')await exportFile('html');
    else if(action==='export-management')await exportManagementFile();
  }catch(error){console.warn(error.message);if(dialog)formError(error.message);else toast(error.message,true);}
  finally{releaseRawTiming?.();}
});

function updateSearch(event){
  if(event.isComposing||composingInput===event.target)return;
  const key=searchKeys[event.target.id];
  if(!key)return;const id=event.target.id,position=event.target.selectionStart;ui[key]=event.target.value;render();const input=document.getElementById(id);input?.focus();input?.setSelectionRange(position,position);
}
document.addEventListener('input',event=>{const rule=event.target.dataset?.inlineReason;if(rule&&current()){const edits=(ui.ecInlineDrafts??={})[ui.selectedId]??={};edits[rule]={...edits[rule],reason:event.target.value};}});
document.addEventListener('input',updateSearch);
for(const eventName of ['input','change'])document.addEventListener(eventName,event=>{const keys={'ec-review-type':'evaluationType','ec-review-voc':'vocKind','ec-review-reason':'reason'},key=keys[event.target.id];if(!key||!current())return;const prior=(ui.ecClassificationDrafts??={})[ui.selectedId]??={...(current().review.classification||current().sceneCapabilities?.outputs?.ecommerceClassification?.value||{}),reason:current().review.classification?.reason||''};prior[key]=event.target.value;});
document.addEventListener('input',event=>updateTaskDraftInput(dialog,event.target));
document.addEventListener('input',()=>importDraftManager.schedule());
document.addEventListener('input',event=>{if(!sceneConfigurationManager.input(event))scenarioManager.input(event);});
document.addEventListener('input',event=>{const rule=event.target.dataset?.rawInlineReason;if(rule&&ui.rawInlineDrafts?.[ui.selectedId]?.[rule])ui.rawInlineDrafts[ui.selectedId][rule].reason=event.target.value;});
document.addEventListener('input',event=>importManager.input(event));
document.addEventListener('input',event=>ecommerceManager.input(event));
document.addEventListener('input',event=>ruleSetManager.input(event));
document.addEventListener('input',event=>cleaningManager.input(event));
document.addEventListener('compositionstart',event=>{if(searchKeys[event.target.id])composingInput=event.target;});
document.addEventListener('compositionend',event=>{if(composingInput===event.target)composingInput=null;updateSearch(event);});
document.addEventListener('change',async event=>{
  if(saving)return;
  if(dialog?.type==='task-lifecycle'&&event.target.id==='lifecycle-cancel-ai'){
    dialog.cancelAI=event.target.checked;dialog.actor=document.getElementById('lifecycle-actor')?.value||'';dialog.reason=document.getElementById('lifecycle-reason')?.value||'';dialog.administratorConfirmed=document.getElementById('lifecycle-administrator')?.checked===true;renderDialog();return;
  }
  if(diagnosticManager.change(event))return;
  if(workspaceBackupManager.change(event))return;
  if(workspaceBackupManager.blocksNavigation)return;
  // Capture draft fields before asynchronous handlers can open another dialog.
  if(updateTaskDraftInput(dialog,event.target)){importDraftManager.schedule();return;}
  if(event.target.id==='import-preview-confirm'&&dialog){dialog.previewConfirmed=event.target.checked;renderDialog();importDraftManager.schedule();return;}
  if(['input-upload','ec-file','input-file'].includes(event.target.id)&&dialog?.file&&event.target.files?.[0]&&event.target.files[0]!==dialog.file){openDialog({type:'import-change-confirm',origin:dialog,nextAction:'file',nextFile:event.target.files[0]});return;}
  importDraftManager.schedule();
  try{if(await rawWorkbenchManager.change(event.target))return;}catch(error){formError(error.message);return;}
  if(event.target.id==='raw-start-concurrency'){try{const task=state.tasks.find(item=>item.id===event.target.dataset.task);if(!canSetRawRunConcurrency(task))throw new Error('本次队列已冻结，继续沿用原并发设置。');const concurrency=Number(event.target.value);normalizeExecutionSettings({concurrency},{raw:true});(ui.rawStartConcurrency??={})[task.id]=concurrency;render();}catch(error){toast(error.message,true);}return;}
  if(event.target.id==='raw-review-session'){const release=rawReviewTimer.suspend();try{await rawReviewTimer.flush();selectSession(event.target.value);}catch(error){toast(error.message,true);}finally{release();}return;}
  if(event.target.id==='raw-source-sheet'){await parseFile(dialog.file,{selectedSheet:event.target.value});return;}
  if(dialog?.type==='new-task'&&['raw-time-mode','raw-source-timezone','raw-product-default'].includes(event.target.id)){try{const root=document.getElementById('overlay-root');updateRawImportOptions(dialog,{timePolicy:{mode:root.querySelector('#raw-time-mode').value,timezone:root.querySelector('#raw-source-timezone').value},productDefault:root.querySelector('#raw-product-default').value,outputLanguage:getLocale()});renderDialog();}catch(error){formError(error.message);}return;}
  if(await ecommerceConversionManager.change(event))return;
  if(await cleaningManager.change(event))return;
  if(qualityInsightsManager.change(event))return;
  if(businessExportManager.handleChange(event.target.id,event.target.value))return;
  if(dialog?.type==='model-settings'&&event.target.id==='model-auth-mode'){const noKey=event.target.value==='none',group=document.getElementById('model-key-group'),key=document.getElementById('model-api-key');group.hidden=noKey;key.disabled=noKey;if(noKey)key.value='';return;}
  if(workflowManager.handleChange(event))return;
  if(event.target.id==='scene-override-reason'){dialog.sceneOverrideReason=event.target.value;return;}
  if(event.target.dataset?.sceneParam||event.target.dataset?.sceneStandard!==undefined){const config=latestSceneConfiguration(state,dialog?.scene||'新品产品咨询');if(config){dialog.sceneRuntime=readSceneRuntime(document.getElementById('overlay-root'),config,dialog.sceneRuntime);dialog.sceneOverrideReason=document.getElementById('scene-override-reason')?.value||dialog.sceneOverrideReason||'';if(event.target.dataset.sceneParam==='reviewMode')renderDialog();return;}}
  if(scenarioManager.change(event))return;
  if(ruleSetManager.change(event))return;
  if(ecommerceManager.change(event))return;
  if(importManager.change(event))return;
  if(catalogManager.change(event))return;
  try{if(reviewRoutingController.handleChange(event))return;}catch(error){formError(error.message);return;}
  const value=event.target.value;
  if(event.target.id==='task-status-filter'){ui.taskStatus=value;render();return;}
  if(handleTaskRuleSelectionChange(event,{dialog,root:document.getElementById('overlay-root'),refreshBasis,renderDialog}))return;
  if(event.target.id==='input-upload'){parseFile(event.target.files[0]);return;}
  if(event.target.id==='dashboard-task')ui.dashboardTaskId=value;
  else if(event.target.id==='review-task'){ui.showReviewRecords=false;ui.reviewSceneFilter='';ui.reviewTaskId=value;ui.reviewStatus='待确认';ui.reviewQuery='';ui.selectedId='';}
  else if(event.target.id==='task-folder-filter')ui.taskFolder=value;
  else if(event.target.id==='export-task')ui.exportTaskId=value;
  else if(event.target.id==='report-repeat-imports')ui.reportRepeatImports=value;
  else if(event.target.id==='history-rule-filter')ui.historyRuleFilter=value;
  else if(event.target.id==='history-verdict-filter')ui.historyVerdictFilter=value;
  else if(event.target.id==='history-session-filter')ui.historySessionFilter=value;
  else if(event.target.id==='report-period')ui.reportPeriod=value;
  else if(event.target.id==='report-task')ui.reportTaskId=value;
  else if(event.target.name==='export-status')ui.includePending=value==='all';
  else if(event.target.id==='edit-rule'&&dialog?.type==='add-issue'){dialog.ruleId=value;renderDialog();return;}
  else return;
  render();
});
document.addEventListener('dragover',event=>{if(event.target.closest('#upload-zone')){event.preventDefault();event.target.closest('#upload-zone').classList.add('drag');}});
document.addEventListener('dragleave',event=>event.target.closest('#upload-zone')?.classList.remove('drag'));
document.addEventListener('drop',event=>{if(event.target.closest('#upload-zone')){event.preventDefault();event.target.closest('#upload-zone').classList.remove('drag');parseFile(event.dataTransfer.files[0]);}});
document.addEventListener('pointerdown',event=>{
  keyboardInput=false;document.documentElement.dataset.inputMethod='pointer';
  // A drag from a field to the backdrop can dispatch click on their common
  // ancestor. Only a primary press and release on this same backdrop may close it.
  backdropPress=event.isPrimary&&event.button===0&&event.target.matches?.('[data-backdrop]')?{target:event.target,pointerId:event.pointerId,released:false}:null;
},{capture:true});
document.addEventListener('pointerup',event=>{
  if(!backdropPress)return;
  if(event.pointerId===backdropPress.pointerId&&event.button===0&&event.target===backdropPress.target&&document.elementFromPoint(event.clientX,event.clientY)===backdropPress.target)backdropPress.released=true;
  else backdropPress=null;
},{capture:true});
document.addEventListener('pointercancel',()=>{backdropPress=null;},{capture:true});
window.addEventListener('blur',()=>{backdropPress=null;});
document.addEventListener('keydown',event=>{
  keyboardInput=true;document.documentElement.dataset.inputMethod='keyboard';
  cancelAllMotion();if(closingOverlay)finishOverlayClose?.();
  if(event.key==='Escape'){for(const container of document.querySelectorAll('[data-review-breakdown]')){container.dataset.open='false';container.querySelector('[data-act="toggle-review-breakdown"]')?.setAttribute('aria-expanded','false');}}
  if(!dialog)return;
  if(event.key==='Escape'){event.preventDefault();if(!saving)closeDialog();return;}
  if(event.key==='Tab'){
    const elements=[...document.querySelectorAll('.modal button:not([disabled]),.modal input:not([disabled]),.modal select:not([disabled]),.modal textarea:not([disabled]),.modal a[href]')].filter(el=>el.offsetParent!==null);
    const target=focusCycleTarget(elements,document.activeElement,event.shiftKey);
    if(target){event.preventDefault();target.focus({preventScroll:true});}
  }
});
document.addEventListener('keydown',event=>{
 if(ui.page!=='review'||dialog||saving||event.isComposing||event.repeat||!usesInlineEcommerce(current()))return;
 const row=event.target.closest?.('[data-inline-rule]'),typing=event.target.closest?.('input,textarea,select,[contenteditable="true"]');
 if(event.key==='Tab'&&event.target===row){const rows=[...document.querySelectorAll('[data-inline-rule][data-needs-attention="true"]')];if(rows.length){event.preventDefault();const index=rows.indexOf(row);rows[(index+(event.shiftKey?-1:1)+rows.length)%rows.length].focus();}}
 if(!typing&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&row&&/^[1-4]$/.test(event.key)){const button=row.querySelectorAll('[data-act="ec-inline-verdict"]')[Number(event.key)-1];if(button&&!button.disabled){event.preventDefault();button.click();}}
 if(event.ctrlKey&&event.key==='Enter'&&typing){const button=document.querySelector('[data-act="ec-inline-confirm"]');if(button&&!button.disabled){event.preventDefault();button.click();}}
});
const reviewShortcutHandler=createReviewShortcutHandler({getContext:()=>({page:ui.page,dialogOpen:Boolean(dialog||closingOverlay),saving,dirty:persistenceBlocked||workspace.hasPending||workspace.conflicted,composing:Boolean(composingInput),activeElement:document.activeElement,selectedId:ui.selectedId,queue:document.querySelector('.review-shell,.raw-review-shell')?reviewQueue(scoped(),ui):[]}),onNavigate:({sessionId})=>{const button=[...document.querySelectorAll('.session-item[data-act="select-session"]')].find(item=>item.dataset.id===sessionId);if(button){button.click();return true;}if(document.querySelector('.review-shell')){selectSession(sessionId);return true;}const select=document.getElementById('raw-review-session');if(select&&[...select.options].some(option=>option.value===sessionId)){select.value=sessionId;select.dispatchEvent(new Event('change',{bubbles:true}));return true;}return false;},onEdit:()=>{const control=firstReviewActionControl(document.querySelector('.review-page'),'edit');if(!control)return false;control.click();return true;},onConfirm:()=>{const control=firstReviewActionControl(document.querySelector('.review-page'),'confirm');if(!control)return false;control.click();return true;}});
document.addEventListener('keydown',event=>{if(ui.page==='review'&&!dialog&&!saving)rawInlineKeyboard(event);});
document.addEventListener('keydown',reviewShortcutHandler);
window.addEventListener('hashchange',()=>{if(saving||workspaceBackupManager.blocksNavigation)return;const route=location.hash.slice(1);if(navigation.some(n=>n[0]===route)){ui.page=route;closeDialog({immediate:true});render();}});
window.addEventListener('beforeunload',event=>{if(workspaceBackupManager.isBusy){event.preventDefault();event.returnValue='';}});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',event=>{if(event.matches){cancelAllMotion();if(closingOverlay)finishOverlayClose?.();}});
if(navigation.some(n=>n[0]===location.hash.slice(1)))ui.page=location.hash.slice(1);
setLocale(getLocale());document.title=uiT('会话质检工作台');
window.addEventListener('pagehide',()=>{adminDraftTranslations.stop();contentTranslations.stop();reasonTranslations.stop();nativeMaterials.stop();});
setMode('manual');
try{ui.modelConfig=await workspace.readModelConfig();}catch{ui.modelConfig={configured:false,keyConfigured:false,model:'glm-5.3-flash'};}
render();
scheduleWorkspacePoll();

for(const eventName of ['pointerdown','keydown','input','scroll'])document.addEventListener(eventName,()=>rawReviewTimer.activity(),{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void rawReviewTimer.flush().catch(()=>{});else rawReviewTimer.sync();});
window.addEventListener('blur',()=>{void rawReviewTimer.flush().catch(()=>{});});
window.addEventListener('focus',()=>rawReviewTimer.sync());
window.addEventListener('pagehide',()=>{rawWorkbenchManager.stop();void rawReviewTimer.flush().catch(()=>{});});
