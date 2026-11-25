import {createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx} from './business-delivery.mjs';
import {nativeReportLanguage} from './native-report-locale.mjs';
import {buildBusinessReportHtml} from './business-report.mjs';
import {sceneReportSizeWarning} from './scene-report-audit.mjs';
import {businessExportView,businessTasks,businessTranslationSummary} from './business-export-view.mjs';
import {createConsultationDeliverySnapshot,buildConsultationDeliveryXlsx,isConsultationTask} from './consultation-delivery.mjs';
import {CUSTOMER_ONLY,CONVERSATION_UNVERIFIED,normalizeRoleEvidenceMode} from './role-evidence.mjs';
import {getLocale,translateError} from './i18n.mjs';
import {createTranslationClient} from './content-translation-client.mjs';
import {collectReportTranslationFields} from './report-locale.mjs';
import {readBusinessConcurrencyPreference,writeBusinessConcurrencyPreference,validBusinessConcurrency} from './business-concurrency-preference.mjs';

const terminal=status=>['completed','completed_with_warnings'].includes(status);
const aborted=error=>error?.name==='AbortError';
const olderThan=(candidate,current)=>candidate?.id===current?.id&&Number.isFinite(Date.parse(candidate?.updatedAt||''))&&Number.isFinite(Date.parse(current?.updatedAt||''))&&Date.parse(candidate.updatedAt)<Date.parse(current.updatedAt);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const contentKey=snapshot=>canonical({deliveryType:snapshot.deliveryType,taskId:snapshot.taskId,conclusionMode:snapshot.conclusionMode,targetLang:snapshot.targetLang,roleEvidenceMode:normalizeRoleEvidenceMode(snapshot.roleEvidenceMode),source:snapshot.source,sourceSheet:snapshot.sourceSheet??{name:'Sheet4',index:null},extensions:snapshot.extensions??{headers:[],standards:[]},...(snapshot.sourceColumns?{sourceColumns:snapshot.sourceColumns,reviewedMapping:snapshot.reviewedMapping}:{}),headers22:snapshot.headers22,standards22:snapshot.standards22,original:snapshot.original,basis:snapshot.basis,records:snapshot.records,...(snapshot.executionSnapshot?{executionSnapshot:snapshot.executionSnapshot,sceneAudit:snapshot.sceneAudit}:{})});
const fileName=value=>String(value||'电商质检').replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').slice(0,80);
const makeId=()=>`report-${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const shortHash=value=>{let hash=0xcbf29ce484222325n;for(const char of value)hash=BigInt.asUintN(64,(hash^BigInt(char.codePointAt(0)))*0x100000001b3n);return hash.toString(16).padStart(16,'0');};
const emptyModel=()=>({job:null,result:null,busy:false,downloading:false,loading:false,error:'',notice:'',stale:false,nodeDetail:null,history:[],historyTaskId:'',historyLoading:false,historyError:'',translationJob:null,translationResult:null,translationKey:'',translationError:'',translationBusy:false,translationTriedKey:'',translationNotGenerated:false});
const historySummary=job=>Object.fromEntries(['id','taskId','taskName','createdAt','updatedAt','status','concurrency','options','reportLanguage','progress','warningsCount','resultAvailable'].filter(key=>job[key]!==undefined).map(key=>[key,job[key]]));
const newestFirst=(a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''));
const savedReportLanguage=job=>job.options?.reportLanguage||job.reportLanguage||job.options?.targetLang||'zh';
const message=(zh,en)=>getLocale()==='en'?en:zh;
const errorMessage=(error,zh,en)=>error?.message?translateError(error):message(zh,en);

export function createBusinessExportManager({api,getState,getUI,onRender=()=>{},download,notify=()=>{},pollMs=1500,buildXlsx=buildBusinessDeliveryXlsx,createSnapshot=createBusinessDeliverySnapshot,buildConsultationXlsx=buildConsultationDeliveryXlsx,createConsultationSnapshot=createConsultationDeliverySnapshot,translationClient,concurrencyStorage}={}){
  if(typeof api!=='function'||typeof getState!=='function'||typeof getUI!=='function'||typeof download!=='function')throw new TypeError('业务导出管理器缺少必要依赖。');
  let active=false,disposed=false,epoch=0,timer=null,nodeVersion=0,hydratedKey='',defaultedLanguage=false,lastLocale=getLocale();
  const controllers=new Set(),pendingIds=new Map(),derivedIds=new Map(),authorizedDerivedBases=new Set(),translationRecoveries=new Set(),rejectedDerivedIds=new Set();
  let model=emptyModel();
  const render=()=>{if(!disposed)onRender();};
  function selection(){
    const state=getState(),ui=getUI(),tasks=businessTasks(state);
    if(!tasks.some(task=>task.id===ui.businessTaskId))ui.businessTaskId=tasks[0]?.id||'';
    if(!['ai','combined'].includes(ui.businessConclusionMode))ui.businessConclusionMode='combined';
    if(!['zh','en'].includes(ui.businessReportLanguage)){ui.businessReportLanguage=getLocale();defaultedLanguage=true;lastLocale=getLocale();}
    else if(defaultedLanguage&&getLocale()!==lastLocale){ui.businessReportLanguage=getLocale();ui.businessTargetLang=ui.businessReportLanguage;lastLocale=getLocale();}
    if(!['zh','en'].includes(ui.businessTargetLang))ui.businessTargetLang=ui.businessReportLanguage;
    const allowed=tasks.find(t=>t.id===ui.businessTaskId)?.executionSnapshot?.runtime.values.outputLanguages;if(allowed?.length){if(!allowed.includes(ui.businessTargetLang))ui.businessTargetLang=allowed[0];if(!allowed.includes(ui.businessReportLanguage))ui.businessReportLanguage=allowed[0];}
    const nativeLanguage=nativeReportLanguage(tasks.find(t=>t.id===ui.businessTaskId));if(nativeLanguage){ui.businessTargetLang=nativeLanguage;ui.businessReportLanguage=nativeLanguage;}
    if(![CUSTOMER_ONLY,CONVERSATION_UNVERIFIED].includes(ui.businessRoleEvidenceMode)||!isConsultationTask(state,tasks.find(task=>task.id===ui.businessTaskId)))ui.businessRoleEvidenceMode=CUSTOMER_ONLY;
    const rawTask=tasks.find(task=>task.id===ui.businessTaskId)?.inputMode==='raw-transcript-v1';
    if(!validBusinessConcurrency(ui.businessConcurrency))ui.businessConcurrency=readBusinessConcurrencyPreference(concurrencyStorage);
    return{concurrency:ui.businessConcurrency,taskId:ui.businessTaskId,conclusionMode:ui.businessConclusionMode,targetLang:ui.businessTargetLang,reportLanguage:ui.businessReportLanguage,roleEvidenceMode:rawTask?CONVERSATION_UNVERIFIED:ui.businessRoleEvidenceMode};
  }
  const keyOf=options=>`${options.taskId}|${options.conclusionMode}|${options.targetLang}|${options.reportLanguage||'zh'}|${options.roleEvidenceMode||CUSTOMER_ONLY}`;
  const matches=(job,options)=>job?.taskId===options.taskId&&(job.options?.conclusionMode||'combined')===options.conclusionMode&&(job.options?.targetLang||'zh')===options.targetLang&&(job.options?.roleEvidenceMode??CUSTOMER_ONLY)===(options.roleEvidenceMode??CUSTOMER_ONLY);
  const current=(version,options)=>!disposed&&epoch===version&&keyOf(selection())===keyOf(options);
  function clearTimer(){if(timer!==null){clearTimeout(timer);timer=null;}}
  function invalidate(){epoch++;nodeVersion++;model.translationBusy=false;clearTimer();for(const controller of controllers)controller.abort();controllers.clear();}
  function rememberJob(job){
    if(model.historyTaskId!==job.taskId){model.historyTaskId=job.taskId;model.history=[];}
    const previous=model.history.find(item=>item.id===job.id);if(olderThan(job,previous))return;
    model.history=[historySummary(job),...model.history.filter(item=>item.id!==job.id)].sort(newestFirst);
    getUI().businessJobId=job.id;
  }
  function resetCurrent(taskId){
    const history=model.historyTaskId===taskId?{history:model.history,historyTaskId:taskId,historyError:model.historyError}:{};
    model={...emptyModel(),...history};
  }
  function useJobOptions(job){
    const ui=getUI();ui.businessTaskId=job.taskId;ui.businessConclusionMode=job.options?.conclusionMode||'combined';ui.businessTargetLang=job.options?.targetLang||'zh';ui.businessReportLanguage=savedReportLanguage(job);ui.businessRoleEvidenceMode=job.options?.roleEvidenceMode||CUSTOMER_ONLY;ui.businessJobId=job.id;defaultedLanguage=false;
    const options=selection();hydratedKey=keyOf(options);return options;
  }
  async function request(path,options={}){
    const controller=new AbortController();controllers.add(controller);
    try{return await api(path,{...options,signal:controller.signal});}
    finally{controllers.delete(controller);}
  }
  // The shared client also works in Node tests without fetch/document globals.
  // The application API already provides authentication and abort handling.
  const translations=translationClient||createTranslationClient({getToken:()=>'',fetchImpl:async(path,options={})=>{
    try{const value=await request(path,{method:options.method||'GET',...(options.body!==undefined?{body:JSON.parse(options.body)}:{})});return{ok:true,status:200,json:async()=>value};}
    catch(error){if(aborted(error))throw error;return{ok:false,status:error.status||503,json:async()=>({error:error.message||'Translation request failed.'})};}
  }});
  function resetTranslation(){model.translationJob=null;model.translationResult=null;model.translationKey='';model.translationError='';model.translationBusy=false;model.translationTriedKey='';model.translationNotGenerated=false;}
  const translationContext=result=>canonical({baseJobId:result.job?.id||model.job?.id,snapshotFingerprint:result.job?.snapshotFingerprint||model.job?.snapshotFingerprint,updatedAt:result.job?.updatedAt,fields:collectReportTranslationFields(result.snapshot,result.enrichment)});
  function translationResultMatches(result,job){
    const frozen=result?.sourceSnapshot,report=frozen?.data?.report,fields=collectReportTranslationFields(model.result.snapshot,model.result.enrichment);
    return result?.job?.id===job.id&&result.job.targetLang==='en'&&frozen?.source?.kind==='report'&&frozen.source.jobId===model.job.id&&canonical(frozen.fields)===canonical(fields)&&(!report?.jobId||report.jobId===model.job.id)&&(!report?.snapshotFingerprint||!model.job.snapshotFingerprint||report.snapshotFingerprint===model.job.snapshotFingerprint);
  }
  async function adoptTranslation(job,version,options,key,preloadedResult){
    if(!current(version,options)||model.translationKey!==key)return;
    if(!job||job.source?.kind!=='report'||job.source.jobId!==model.job?.id||job.targetLang!=='en'){model.translationJob=null;model.translationResult=null;derivedIds.set(key,`report-en-${makeId().slice(7)}`);throw new Error('Report translation job does not match the current frozen base report.');}
    if(olderThan(job,model.translationJob))return;
    const old=model.translationJob;model.translationJob=job;
    if(job.resultAvailable!==false&&(!model.translationResult||old?.updatedAt!==job.updatedAt||old?.status!==job.status)){
      const result=preloadedResult||await translations.result(job.id);if(!current(version,options)||model.translationKey!==key||model.translationJob?.id!==job.id)return;
      if(!translationResultMatches(result,job)){rejectedDerivedIds.add(job.id);model.translationJob=null;model.translationResult=null;derivedIds.set(key,`report-en-${makeId().slice(7)}`);throw new Error('Report translation source has changed. Generate a new derived English view.');}
      model.translationResult=result;model.translationJob=result.job||job;
    }
    model.translationError='';model.translationNotGenerated=false;render();
  }
  async function ensureTranslation(version,options,{force=false,refresh=false,allowCreate=authorizedDerivedBases.has(model.job?.id)||model.job?.options?.reportLanguage==='en'}={}){
    if(nativeReportLanguage(model.result?.snapshot))return;
    if(options.reportLanguage!=='en'||!model.result||!terminal(model.job?.status))return;
    const key=translationContext(model.result);
    if(model.translationKey!==key){resetTranslation();model.translationKey=key;}
    if(model.translationBusy||model.translationError&&!force)return;
    if(model.translationJob&&!refresh&&!force)return;
    model.translationBusy=true;model.translationError='';render();
    const restore=async(job,result)=>{
      await adoptTranslation(job,version,options,key,result);
      if(!current(version,options)||model.translationKey!==key)return;
      const saved=model.translationJob,recoverable=saved?.status==='paused'&&saved.stopReason==='interrupted'||saved?.status==='completed_with_warnings'&&!['user_paused','configuration_changed','storage_error'].includes(saved.stopReason);
      if(recoverable&&!translationRecoveries.has(saved.id)){
        translationRecoveries.add(saved.id);
        const answer=await translations.action(saved.id,saved.status==='paused'?'resume':'retry');
        if(current(version,options))await adoptTranslation(answer.job,version,options,key);
      }
    };
    try{
      if(model.translationJob){const answer=await translations.get(model.translationJob.id);if(current(version,options))await restore(answer.job);return;}
      let id=derivedIds.get(key)||`report-en-${shortHash(key)}`;derivedIds.set(key,id);let answer;
      try{answer=await translations.get(id);}
      catch(error){
        if(!current(version,options))return;if(error.status!==404)throw error;
          if(typeof translations.list==='function'){
            const saved=await translations.list({kind:'report',jobId:model.job.id}).catch(error=>{if(error.status===404)return{jobs:[]};throw error;});if(!current(version,options))return;
            for(const candidate of saved.jobs||[]){
              if(rejectedDerivedIds.has(candidate.id)||candidate.targetLang!=='en'||candidate.source?.kind!=='report'||candidate.source.jobId!==model.job.id||candidate.resultAvailable===false)continue;
              const result=await translations.result(candidate.id);if(!current(version,options))return;
              if(translationResultMatches(result,candidate)){derivedIds.set(key,candidate.id);await restore(candidate,result);return;}
            }
          }
        if(!allowCreate){model.translationNotGenerated=true;return;}
        model.translationTriedKey=key;
        try{answer=await translations.create({jobId:id,source:{kind:'report',jobId:model.job.id},targetLang:'en',concurrency:options.concurrency});}
        catch(createError){
          if(!current(version,options))return;
          // A definite config/source conflict cannot be overwritten. A fresh ID
          // creates a new derived view while preserving the older translation job.
          if(createError.status===409){id=`report-en-${makeId().slice(7)}`;derivedIds.set(key,id);answer=await translations.create({jobId:id,source:{kind:'report',jobId:model.job.id},targetLang:'en',concurrency:options.concurrency});}
          else{try{answer=await translations.get(id);}catch{throw createError;}}
        }
      }
      if(current(version,options)){await restore(answer.job);authorizedDerivedBases.delete(model.job.id);}
    }catch(error){if(current(version,options)&&model.translationKey===key&&!aborted(error)){model.translationError=error.message||'English report translation could not be completed.';render();}}
    finally{if(current(version,options)&&model.translationKey===key){model.translationBusy=false;render();}}
  }
  function markStale(snapshot){
    if(!snapshot){model.stale=false;return;}
    try{const options={taskId:snapshot.taskId,conclusionMode:snapshot.conclusionMode,targetLang:snapshot.targetLang,roleEvidenceMode:snapshot.roleEvidenceMode,now:snapshot.createdAt};const latest=snapshot.deliveryType==='consultation-v1'?createConsultationSnapshot(getState(),{...options,original:snapshot.original}):createSnapshot(getState(),options);model.stale=contentKey(latest)!==contentKey(snapshot);}
    catch{model.stale=true;}
  }
  function schedule(){
    clearTimer();if(!active||disposed||!model.job||model.busy)return;
    timer=setTimeout(()=>{timer=null;void poll();},Math.max(50,Number(pollMs)||1500));timer.unref?.();
  }
  async function loadResult(job,version,options){
    const result=await request(`/api/report-jobs/${encodeURIComponent(job.id)}/result`);
    if(!current(version,options)||model.job?.id!==job.id)return null;
    const snapshot=result?.snapshot;
    if(!snapshot||snapshot.taskId!==options.taskId||snapshot.conclusionMode!==options.conclusionMode||snapshot.targetLang!==options.targetLang||(snapshot.roleEvidenceMode??CUSTOMER_ONLY)!==options.roleEvidenceMode)throw new Error('交付结果与当前任务、口径或语种不一致，请重新选择。');
    const resultJob=result.job||job;
    if(model.result?.job?.id===job.id&&olderThan(resultJob,model.result.job))return model.result;
    if(model.translationKey&&(!terminal(resultJob.status)||translationContext({...result,job:resultJob})!==model.translationKey))resetTranslation();
    model.result={...result,job:resultJob};markStale(snapshot);
    if(result.job&&matches(result.job,options)&&result.job.id===job.id&&!olderThan(result.job,model.job)){model.job=result.job;rememberJob(result.job);}
    return model.result;
  }
  async function adopt(job,version,options,{result=true}={}){
    if(!current(version,options))return;
    if(!job||!matches(job,options))throw new Error('服务器返回的交付任务与当前选择不一致。');
    if(olderThan(job,model.job))return;
    if(model.job?.id!==job.id){model.result=null;model.nodeDetail=null;model.stale=false;resetTranslation();}
    model.job=job;model.error='';rememberJob(job);pendingIds.delete(keyOf(options));render();
    if(result&&job.resultAvailable!==false&&(!model.result||terminal(job.status)&&model.result.job?.updatedAt!==job.updatedAt))await loadResult(job,version,options);
    if(current(version,options))await ensureTranslation(version,options,{refresh:true});
    if(current(version,options))render();
  }
  async function hydrate({restore=true}={}){
    let options=selection();const version=epoch;
    if(!options.taskId||disposed)return;
    hydratedKey=keyOf(options);
    if(model.historyTaskId!==options.taskId||model.job&&!matches(model.job,options))resetCurrent(options.taskId);
    model.loading=true;model.historyLoading=true;model.historyError='';let listed=false;render();
    try{
      const answer=await request(`/api/report-jobs?taskId=${encodeURIComponent(options.taskId)}`);
      if(!current(version,options))return;
      const jobs=(answer?.jobs||[]).filter(job=>job?.taskId===options.taskId&&typeof job.id==='string').sort(newestFirst);
      model.history=jobs.map(historySummary);model.historyTaskId=options.taskId;model.historyLoading=false;listed=true;
      const matching=jobs.filter(job=>matches(job,options)),expectedId=pendingIds.get(keyOf(options)),preferredId=model.job?.id||getUI().businessJobId;
      const job=matching.find(item=>item.id===expectedId)||matching.find(item=>item.id===preferredId)||(restore?jobs.find(item=>item.id===preferredId):null)||matching.find(item=>item.status==='running')||(restore?jobs.find(item=>item.status==='running'):null)||matching[0]||(restore?jobs[0]:null);
      if(job){if(!matches(job,options)||restore&&defaultedLanguage&&job.options?.reportLanguage)options=useJobOptions(job);await adopt(job,version,options);}
      else{model.job=null;model.result=null;model.nodeDetail=null;model.stale=false;resetTranslation();}
    }catch(error){if(current(version,options)&&!aborted(error)){const errorText=errorMessage(error,'读取已保存的交付任务失败。','Could not read saved report jobs.');if(listed)model.error=errorText;else model.historyError=errorText;}}
    finally{if(current(version,options)){model.loading=false;model.historyLoading=false;render();schedule();}}
  }
  async function mountJob(id){
    const selected=selection(),candidate=model.historyTaskId===selected.taskId&&model.history.find(job=>job.id===id&&job.taskId===selected.taskId);
    if(!candidate)return;
    invalidate();authorizedDerivedBases.clear();resetCurrent(selected.taskId);const version=epoch,options=useJobOptions(candidate);model.loading=true;render();
    try{
      const answer=await request(`/api/report-jobs/${encodeURIComponent(id)}`);if(!current(version,options))return;
      if(answer.job?.id!==id||answer.job?.taskId!==selected.taskId)throw new Error(message('历史交付任务与当前选择不一致，请刷新历史记录。','The saved report does not match this selection. Refresh the history.'));
      await adopt(answer.job,version,options);
      if(current(version,options))model.notice=message('已载入历史交付，可查看保存的进度、节点及下载文件。','Saved deliverable loaded. Inspect its progress and nodes, or download its files.');
    }catch(error){if(current(version,options)&&!aborted(error))model.error=errorMessage(error,'读取历史交付失败，请刷新历史后重试。','Could not load the saved deliverable. Refresh history and retry.');}
    finally{if(current(version,options)){model.loading=false;render();schedule();}}
  }
  async function poll(){
    if(!active||disposed||!model.job||model.busy)return;
    const options=selection(),version=epoch,id=model.job.id;
    try{const answer=await request(`/api/report-jobs/${encodeURIComponent(id)}`);if(current(version,options)&&model.job?.id===id)await adopt(answer.job,version,options);}
    catch(error){if(current(version,options)&&!aborted(error)){model.error=message('刷新进度失败：','Could not refresh progress: ')+errorMessage(error,'请稍后重试','Please retry later.');render();}}
    finally{if(current(version,options))schedule();}
  }
  async function generate(){
    const options=selection();if(!options.taskId){notify(message('先创建可导出的业务质检任务。','Create an exportable business quality task first.'),true);return;}
    if(model.busy||model.loading)return;
    if(model.job?.status==='running'){notify(message('当前选择已有正在生成的交付任务，可查看节点进度。','A report job is already running for this selection. Inspect its saved execution nodes.'));return;}
    const key=keyOf(options),previousId=pendingIds.get(key);invalidate();hydratedKey=key;const version=epoch,jobId=previousId||makeId();pendingIds.set(key,jobId);model.busy=true;model.error='';model.notice='';render();
    try{
      let answer;
      if(previousId){
        try{
          const saved=await request(`/api/report-jobs/${encodeURIComponent(previousId)}`);
          if(!current(version,options))return;
          if(options.reportLanguage==='en')authorizedDerivedBases.add(saved.job.id);
          await adopt(saved.job,version,options);if(current(version,options)){model.notice=message('已找回上次保存的后台生成任务。','Recovered the saved background report job.');notify(model.notice);}return;
        }catch(error){if(!current(version,options)||aborted(error))return;if(error.status!==404)throw error;}
      }
      try{answer=await request('/api/report-jobs',{method:'POST',body:{jobId,concurrency:options.concurrency,taskId:options.taskId,conclusionMode:options.conclusionMode,targetLang:options.targetLang,reportLanguage:options.reportLanguage,...(options.roleEvidenceMode===CONVERSATION_UNVERIFIED?{roleEvidenceMode:options.roleEvidenceMode}:{})}});}
      catch(error){
        if(!current(version,options)||aborted(error))return;
        const definitive=error.status>=400&&error.status<500&&![408,429].includes(error.status);
        if(definitive){pendingIds.delete(key);throw error;}
        // A dropped POST response may still have created a durable, chargeable job.
        // Resolve that exact ID first; never issue a second automatic POST.
        try{answer=await request(`/api/report-jobs/${encodeURIComponent(jobId)}`);}
        catch{throw new Error(message('生成请求的响应未确认，已保留请求标识。再次点击生成会使用同一标识核对，避免重复创建。','The generation response is unconfirmed. The request ID is retained; generating again checks this ID to avoid duplicate jobs.'));}
      }
      if(!current(version,options))return;
      if(options.reportLanguage==='en')authorizedDerivedBases.add(answer.job.id);
      await adopt(answer.job,version,options);
      if(!current(version,options))return;
      const reused=answer.reused===true||answer.job?.reused===true;
      model.notice=reused?message('已载入相同冻结快照的已有交付，未重复运行基础分析。可查看进度、重试缺失项或下载。','Loaded the existing deliverable for this frozen snapshot without repeating base analysis. Inspect progress, retry missing items or download.'):'';
      notify(model.notice||message('已开始后台生成，可查看进度和节点。','Background generation started. Progress and execution nodes are available.'));
    }catch(error){if(current(version,options)&&!aborted(error)){model.error=errorMessage(error,'生成请求未完成。','The generation request could not be completed.');notify(model.error,true);}}
    finally{if(current(version,options)){model.busy=false;render();schedule();}}
  }
  async function generateEnglish(){
    const options=selection();if(options.reportLanguage!=='en'||!model.job||!terminal(model.job.status)){notify(message('请先完成基础报告并选择英文报告语言。','Complete the base report and select English report language first.'),true);return;}
    if(model.busy||model.translationBusy)return;
    authorizedDerivedBases.add(model.job.id);invalidate();const version=epoch;model.busy=true;render();
    try{await ensureTranslation(version,options,{force:true,allowCreate:true});}
    finally{if(current(version,options)){model.busy=false;render();schedule();}}
  }
  async function control(action,stage){
    if(!model.job||model.busy)return;
    const reportStage=stage==='report'||stage!=='base'&&selection().reportLanguage==='en'&&terminal(model.job.status)&&(!!model.translationJob||!!model.translationError);
    if(reportStage){
      const options=selection();invalidate();const version=epoch;model.busy=true;model.error='';render();
      try{
        if(!model.translationJob){authorizedDerivedBases.add(model.job.id);await ensureTranslation(version,options,{force:true,allowCreate:true});}
        else{const key=model.translationKey,answer=await translations.action(model.translationJob.id,action);if(current(version,options))await adoptTranslation(answer.job,version,options,key);}
      }catch(error){if(current(version,options)&&!aborted(error))model.translationError=error.message||'English report translation status could not be updated.';}
      finally{if(current(version,options)){model.busy=false;render();schedule();}}return;
    }
    const options=selection(),id=model.job.id;invalidate();const version=epoch;model.busy=true;model.error='';render();
    if(action!=='pause'&&options.reportLanguage==='en')authorizedDerivedBases.add(id);
    if(action==='retry')resetTranslation();
    try{const answer=await request(`/api/report-jobs/${encodeURIComponent(id)}/${action}`,{method:'POST',body:{}});if(current(version,options)){await adopt(answer.job,version,options);notify(action==='pause'?message('已请求暂停，正在执行的节点会保存结果。','Pause requested. Running nodes will save their results.'):action==='retry'?message('已请求重试缺失项。','Retry requested for missing items.'):message('已继续后台生成。','Background generation resumed.'));}}
    catch(error){if(current(version,options)&&!aborted(error)){model.error=errorMessage(error,'更新交付任务状态失败。','Could not update report job status.');notify(model.error,true);}}
    finally{if(current(version,options)){model.busy=false;render();schedule();}}
  }
  async function inspectNode(button){
    const id=button?.dataset?.nodeId??button?.dataset?.node;if(!model.job||!id)return;
    const stage=button?.dataset?.stage==='report'?'report':'base',options=selection(),version=epoch,nodeTicket=++nodeVersion,jobId=stage==='report'?model.translationJob?.id:model.job.id;if(!jobId)return;
    try{const detail=await request(`/api/${stage==='report'?'translation-jobs':'report-jobs'}/${encodeURIComponent(jobId)}/nodes/${encodeURIComponent(id)}`);if(current(version,options)&&nodeVersion===nodeTicket&&(stage==='report'?model.translationJob?.id:model.job?.id)===jobId){model.nodeDetail=detail;render();}}
    catch(error){if(current(version,options)&&nodeVersion===nodeTicket&&!aborted(error)){model.error=errorMessage(error,'读取节点详情失败。','Could not read saved node details.');render();}}
  }
  async function downloadFile(kind){
    if(!model.job||model.downloading){if(!model.job)notify(message('请先生成业务交付物。','Generate business deliverables first.'),true);return;}
    const options=selection(),version=epoch,job=model.job;model.downloading=true;model.error='';render();
    try{
      const result=await loadResult(job,version,options);if(!result||!current(version,options))return;
      await ensureTranslation(version,options,{allowCreate:false});if(!current(version,options))return;
      const {snapshot,enrichment={}}=result,latestJob=result.job||job,prefix=options.reportLanguage==='en'?`${fileName(snapshot.taskName)}_${snapshot.conclusionMode==='ai'?'AI-initial':'human-combined'}_English`:`${fileName(snapshot.taskName)}_${snapshot.conclusionMode==='ai'?'AI初判':'人工综合'}_${snapshot.targetLang==='en'?'英文':'中文'}`;
      const consultation=snapshot.deliveryType==='consultation-v1';
      const reportOptions={language:options.reportLanguage,translations:model.translationResult?.translations||[],translationJob:model.translationJob||undefined,job:latestJob,environment:options.reportLanguage==='en'?'Local standalone workbench':'本机独立工作台'};
      const data=kind==='xlsx'?await(consultation?buildConsultationXlsx:buildXlsx)(snapshot,enrichment,reportOptions):buildBusinessReportHtml(snapshot,enrichment,reportOptions);
      if(!current(version,options)||model.job?.id!==job.id)return;
      const suffix=options.reportLanguage==='en'?(kind==='xlsx'?'inspection-details.xlsx':consultation?'product-consultation-quality-report.html':'ecommerce-review-quality-report.html'):(kind==='xlsx'?'业务检核明细.xlsx':consultation?'新品质检报告.html':'电商评价管理质检报告.html');
      await download(data,`${prefix}_${suffix}`,kind==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/html;charset=utf-8');
      const completion=terminal(latestJob.status)?message('已下载本次冻结快照的业务交付文件；缺失内容会明确标记。','Downloaded the frozen report snapshot. Missing content is marked explicitly.'):message('已下载当前已保存结果；尚未完成的分析和译文会明确标记。','Downloaded the saved partial results. Incomplete analysis and translations are marked explicitly.');
      const translationSummary=businessTranslationSummary(enrichment.translationStats);
      const sizeWarning=kind==='html'?sceneReportSizeWarning(data,options.reportLanguage):null;
      notify([completion,translationSummary,sizeWarning?.message].filter(Boolean).join(' '),!!sizeWarning);
    }catch(error){if(current(version,options)&&!aborted(error)){model.error=errorMessage(error,'业务文件导出失败。','Could not export the business file.');notify(model.error,true);}}
    finally{if(current(version,options)){model.downloading=false;render();}}
  }
  return{
    view(state,ui){const options=selection();if(model.result&&matches(model.job,options))markStale(model.result.snapshot);const scopedModel=model.historyTaskId&&model.historyTaskId!==options.taskId?emptyModel():model;return businessExportView(state,ui,scopedModel.job&&!matches(scopedModel.job,options)?{...scopedModel,job:null,result:null,nodeDetail:null,stale:false,translationJob:null,translationResult:null,translationError:'',notice:''}:scopedModel);},
    setActive(value){const next=!!value;if(disposed)return;if(next===active){if(active&&hydratedKey!==keyOf(selection())){invalidate();authorizedDerivedBases.clear();model.busy=false;model.downloading=false;void hydrate({restore:false});}return;}active=next;if(!active){invalidate();authorizedDerivedBases.clear();model.busy=false;model.downloading=false;model.loading=false;model.historyLoading=false;return;}void hydrate();},
    async handleAction(action,button){
      if(disposed||!String(action).startsWith('business-'))return false;
      if(action==='business-generate')await generate();
      else if(action==='business-job-mount')await mountJob(button?.dataset?.jobId);
      else if(action==='business-history-refresh'){if(!model.busy&&!model.downloading){invalidate();authorizedDerivedBases.clear();await hydrate({restore:false});}}
      else if(action==='business-generate-english')await generateEnglish();
      else if(action==='business-pause')await control('pause',button?.dataset?.stage);
      else if(action==='business-resume')await control('resume',button?.dataset?.stage);
      else if(action==='business-retry')await control('retry',button?.dataset?.stage);
      else if(action==='business-download-xlsx')await downloadFile('xlsx');
      else if(action==='business-download-html')await downloadFile('html');
      else if(action==='business-node')await inspectNode(button);
      else if(action==='business-node-close'){nodeVersion++;model.nodeDetail=null;render();}
      else return false;
      return true;
    },
    handleChange(id,value){
      if(id==='business-concurrency'){const concurrency=Number(value);if(!disposed&&validBusinessConcurrency(concurrency)&&!model.busy&&model.job?.status!=='running'){getUI().businessConcurrency=concurrency;writeBusinessConcurrencyPreference(concurrency,concurrencyStorage);render();}return true;}
      const fields={'business-task':'businessTaskId','business-conclusion-mode':'businessConclusionMode','business-target-lang':'businessTargetLang','business-report-language':'businessReportLanguage','business-role-evidence-mode':'businessRoleEvidenceMode'};
      if(disposed||!Object.hasOwn(fields,id))return false;const key=fields[id];
      if(key==='businessRoleEvidenceMode'&&getState().tasks.find(task=>task.id===getUI().businessTaskId)?.inputMode==='raw-transcript-v1')return false;
      if(key==='businessTaskId'&&!businessTasks(getState()).some(task=>task.id===value))return false;
      if(key==='businessRoleEvidenceMode'&&(![CUSTOMER_ONLY,CONVERSATION_UNVERIFIED].includes(value)||!isConsultationTask(getState(),getState().tasks.find(task=>task.id===getUI().businessTaskId))))return false;
      if(key==='businessConclusionMode'&&!['ai','combined'].includes(value)||['businessTargetLang','businessReportLanguage'].includes(key)&&!['zh','en'].includes(value))return false;
      if(getUI()[key]===value)return true;
      getUI()[key]=value;getUI().businessJobId='';if(key==='businessTaskId')getUI().businessRoleEvidenceMode=CUSTOMER_ONLY;if(key==='businessReportLanguage'){defaultedLanguage=false;getUI().businessTargetLang=value;}invalidate();authorizedDerivedBases.clear();resetCurrent(getUI().businessTaskId);hydratedKey=keyOf(selection());render();if(active)void hydrate({restore:key==='businessTaskId'});return true;
    },
    close(){if(disposed)return;active=false;disposed=true;invalidate();},
  };
}
