import {samplingDescription} from './rule-calibration-policy.mjs';
import {html as h,t,translateError,getLocale} from './i18n.mjs';
import {e,icon,badge} from './ui.mjs';
import {rawEditDialog} from './raw-review-view.mjs';
import {getSessionResults,saveReview,acceptAI,confirmReview} from './domain.mjs';
import {hasSuccessfulAI} from './model-ui.mjs';
import {evaluateRawGolden,buildRawGoldenTemplate,parseRawGoldenFile,buildRawGoldenHtml} from './raw-golden.mjs';
import {workbook,excelSafeSheets} from './io.mjs';
import {isAIFinal} from './ai-triage.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';
import {nextPendingSession} from './review-flow.mjs';
const configKey=config=>JSON.stringify(Object.fromEntries(['baseUrl','model','authMode','timeoutMs','reasoningEffort','maxTokens'].map(k=>[k,config?.[k]??null])));
const ready=config=>config?.configured===true&&config?.connectionTested===true;
const pct=value=>value===null?t('未评估'):(value*100).toFixed(1)+'%';
const terminal=status=>['completed','completed_with_warnings','failed','cancelled'].includes(status);
const frame=(title,body,footer='',wide=true)=>h`<div class="modal-backdrop" data-backdrop="true"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><h2 id="dialog-title">${t(title)}</h2><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header><div class="modal-body">${body}</div><footer class="modal-footer">${footer}</footer></section></div>`;
export function rawTaskPanel(state,task){
 if(task.inputMode!=='raw-transcript-v1')return'';const rows=state.sessions.filter(s=>s.taskId===task.id),uncertain=rows.filter(s=>s.aiDecision?.status==='UNCERTAIN').length,fail=rows.filter(s=>s.aiDecision?.status==='FAIL').length,pass=rows.filter(isAIFinal).length;
 return h`<section class="panel task-detail-section raw-task-panel"><div class="panel-head"><h2>原文直判</h2></div><div class="panel-body"><p>每行原文与全部已选规则独立质检，轮次仅作导航提示。</p>${task.rawImportOptions?.timePolicy?.mode==='unavailable'?h`<p class="soft-note warning">本批无可靠时间戳，时间依赖规则统一无法判定；不会补造会话时间。</p>`:''}<div class="task-finalization-counts"><span>${t('AI终判')} ${pass}</span><span>${t('问题')} ${fail}</span><span>${t('需核实')} ${uncertain}</span></div><p class="hint">${task.reviewPolicy?.version===2?samplingDescription(task.reviewPolicy,getLocale()==='en'):t('0.90为未标定自评门槛；正确率、无法判定率、FAIL召回率与错误免审PASS数须用金标准并列对照。')}</p><div class="toolbar-group"><button class="btn" data-act="raw-golden-open" data-id="${e(task.id)}">金标准验收对照</button><button class="btn" data-act="raw-reinspect" data-id="${e(task.id)}">使用新规则重检</button><button class="text-btn" data-act="raw-structure-open" data-id="${e(task.id)}">可选结构化导出</button></div><p class="hint">结构化仅为后台辅助产物，不替换原文证据，也不作为重检前置。</p></div></section>`;
}
export function createRawWorkbenchManager({getState,getUI,getDialog,getModelConfig,openDialog,closeDialog,renderDialog,render,toast,download,api,configureModel,commit,selectSession,reinspect,getRoot=()=>document.getElementById('overlay-root')}={}){
 let timer=null;const current=()=>getDialog(),session=()=>getState().sessions.find(s=>s.id===getUI().selectedId),stop=()=>{if(timer)clearTimeout(timer);timer=null;};
 const redraw=()=>renderDialog();
 function task(id){const result=getState().tasks.find(t=>t.id===id);if(result?.inputMode!=='raw-transcript-v1')throw new Error('请选择原文直判任务。');return result;}
 function captureEdit(){const d=current();if(d?.type!=='raw-edit')return;const root=getRoot();d.verdict=root.querySelector('#raw-edit-verdict')?.value??d.verdict;d.reason=root.querySelector('#raw-edit-reason')?.value??d.reason;d.evidenceQuotes=[...root.querySelectorAll('.raw-quote-input')].map(el=>({quote:el.value}));d.referenceIds=[...root.querySelectorAll('[name="raw-edit-reference"]:checked')].map(el=>el.value);}
 async function saveInline(s,ruleId){
  const edit=getUI().rawInlineDrafts?.[s.id]?.[ruleId];if(!edit)return;
  const input={ruleId,verdict:edit.verdict,reason:(edit.reason||'').trim(),evidence:[],evidenceQuotes:[],referenceIds:[],source:'人工修改'},at=new Date().toISOString();
  await commit(state=>saveReview(state,s.id,input,at),undefined,{reviewSessionId:s.id,deferRender:true,command:{action:'save',sessionId:s.id,draft:input,at}});delete getUI().rawInlineDrafts[s.id][ruleId];
 }
 async function readStructure(owner){
  const value=await api('/api/raw-structure-jobs/'+owner.job.id);if(current()!==owner)return;owner.job=value.job||value;
  if(terminal(owner.job.status)){try{owner.result=await api('/api/raw-structure-jobs/'+owner.job.id+'/result');}catch(error){owner.error=error.message;}}
  redraw();if(current()===owner&&!terminal(owner.job.status)&&owner.job.status!=='paused')timer=setTimeout(()=>{readStructure(owner).catch(error=>{owner.error=error.message;redraw();});},1000);
 }
 async function click(action,button={dataset:{}}){
  const d=current();
  if(['raw-edit-result','raw-copy-selection','raw-save-result','raw-confirm-next','raw-inline-verdict','raw-inline-save','raw-inline-cancel'].includes(action)){
   const s=action==='raw-save-result'?getState().sessions.find(row=>row.id===d?.sessionId):session();
   if(isProcessedUnknown(s))throw new Error('已处理待补充只读，请先重新打开。');
   if(!s||s.aiExecution?.status==='running'||s.review?.status==='已确认'||isAIFinal(s))throw new Error('当前结果只读；AI终判请先标记可疑并退回人工，人工已确认请先重新审核。');
  }
  if(action==='raw-inline-verdict'){
   const s=session(),ui=getUI(),id=button.dataset.rule,result=getSessionResults(s).find(r=>r.ruleId===id);if(!result)throw new Error('检查项已变化，请重新打开。');
   const drafts=(ui.rawInlineDrafts??={})[s.id]??=( {} ),previous=drafts[id]||result.final||result;
   drafts[id]={verdict:button.dataset.verdict,reason:previous.verdict===button.dataset.verdict?previous.reason||'':''};ui.rawActiveRule=id;render();document.querySelector(`[data-rule-card="${id}"]`)?.focus();return true;
  }
  if(action==='raw-inline-cancel'){delete getUI().rawInlineDrafts?.[session().id]?.[button.dataset.rule];render();return true;}
  if(action==='raw-inline-save'){await saveInline(session(),button.dataset.rule);render();return true;}
  if(action==='raw-golden-open'){
   const selected=task(button.dataset.id),snapshot={tasks:[structuredClone(selected)],sessions:structuredClone(getState().sessions.filter(s=>s.taskId===selected.id))};openDialog({type:'raw-golden',state:snapshot,taskId:selected.id});return true;
  }
  if(action==='raw-golden-template'){download(await buildRawGoldenTemplate(d.state,d.taskId,{language:getLocale()}),'raw-golden-template.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return true;}
  if(action==='raw-golden-html'){download(buildRawGoldenHtml(d.metrics,{language:getLocale()}),'raw-golden-comparison.html','text/html;charset=utf-8');return true;}
  if(action==='raw-golden-json'){download(JSON.stringify(d.metrics,null,2),'raw-golden-comparison.json','application/json');return true;}
  if(action==='raw-reinspect'){await reinspect(task(button.dataset.id));return true;}
  if(action==='raw-structure-open'){
   const selected=task(button.dataset.id),owner={type:'raw-structure',taskId:selected.id,taskName:selected.name,modelFingerprint:configKey(getModelConfig()),consent:false,loading:true};openDialog(owner);
   try{const list=await api('/api/raw-structure-jobs?taskId='+encodeURIComponent(selected.id)),jobs=list.jobs||list;owner.job=Array.isArray(jobs)?jobs[0]:null;if(owner.job)await readStructure(owner);}finally{owner.loading=false;if(current()===owner)redraw();}return true;
  }
  if(action==='raw-structure-model'){d.consent=false;await configureModel(d);return true;}
  if(action==='raw-structure-run'){
   if(!ready(getModelConfig()))throw new Error('请先成功测试当前模型接口。');
   if(!d.consent||d.modelFingerprint!==configKey(getModelConfig())){d.consent=false;throw new Error('模型设置或授权已变化，请重新核对并确认。');}
   d.loading=true;redraw();try{const value=await api('/api/raw-structure-jobs',{method:'POST',body:{jobId:crypto.randomUUID(),taskId:d.taskId,consent:true}});d.job=value.job||value;d.consent=false;await readStructure(d);}finally{d.loading=false;if(current()===d)redraw();}return true;
  }
  if(['raw-structure-pause','raw-structure-resume','raw-structure-retry'].includes(action)){
   stop();const op=action.split('-').at(-1),value=await api('/api/raw-structure-jobs/'+d.job.id+'/'+op,{method:'POST',body:{}});d.job=value.job||value;await readStructure(d);return true;
  }
  if(action==='raw-structure-download'){
   const result=d.result?.artifact?d.result:await api('/api/raw-structure-jobs/'+d.job.id+'/result'),artifact=result.artifact;
   if(!artifact?.sheets?.length)throw new Error('尚无可下载的结构化产物。');download(await workbook(excelSafeSheets(artifact.sheets)),(artifact.kind==='standard-double-sheet'?'raw-standard':'raw-ai-unverified-draft')+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');download(JSON.stringify({job:result.job,validation:artifact.validation,missingInfo:artifact.missingInfo,unparsed:artifact.unparsed,warnings:result.warnings},null,2),'raw-structure-audit.json','application/json');return true;
  }
  if(action==='raw-edit-result'||action==='raw-copy-selection'){
   const s=session(),ruleId=button.dataset.rule||getUI().rawActiveRule||s.expectedRuleIds[0],result=getSessionResults(s).find(r=>r.ruleId===ruleId),value=result?.final||result||{},owner={type:'raw-edit',sessionId:s.id,ruleId,verdict:getUI().rawInlineDrafts?.[s.id]?.[ruleId]?.verdict||value.verdict||'无法判定',reason:getUI().rawInlineDrafts?.[s.id]?.[ruleId]?.reason??value.reason??'',evidenceQuotes:structuredClone(value.evidenceQuotes||[]),referenceIds:[...(value.referenceIds||[])]};
   if(action==='raw-copy-selection'){
    const selection=globalThis.window?.getSelection?.(),original=document.getElementById('raw-original'),range=selection?.rangeCount?selection.getRangeAt(0):null;
    if(!range||!original?.contains(range.commonAncestorContainer)||!selection.toString().trim())throw new Error('请先在左侧原文选中一段连续文字。');owner.evidenceQuotes=[{quote:selection.toString()}];
   }
   openDialog(owner);return true;
  }
  if(action==='raw-add-quote'){captureEdit();d.evidenceQuotes.push({quote:''});redraw();return true;}
  if(action==='raw-remove-quote'){captureEdit();d.evidenceQuotes.splice(Number(button.dataset.quote),1);redraw();return true;}
  if(action==='raw-save-result'){
   captureEdit();const owner=d,input={ruleId:d.ruleId,verdict:d.verdict,reason:d.reason.trim(),evidence:[],evidenceQuotes:d.evidenceQuotes.filter(q=>q.quote.trim()),referenceIds:d.referenceIds,source:'人工修改'};
   const at=new Date().toISOString();await commit(state=>saveReview(state,owner.sessionId,input,at),undefined,{reviewSessionId:owner.sessionId,deferRender:true,command:{action:'save',sessionId:owner.sessionId,draft:input,at}});delete getUI().rawInlineDrafts?.[owner.sessionId]?.[owner.ruleId];closeDialog({force:true});getUI().rawActiveRule=owner.ruleId;render();return true;
  }
  if(action==='raw-confirm-next'){
   for(const ruleId of Object.keys(getUI().rawInlineDrafts?.[session().id]||{}))await saveInline(session(),ruleId);
   const s=session(),id=s.id,at=new Date().toISOString();await commit(state=>{const saved=hasSuccessfulAI(state.sessions.find(r=>r.id===id))?acceptAI(state,id,at):state;return confirmReview(saved,id,at);},undefined,{reviewSessionId:id,deferRender:true,command:{action:hasSuccessfulAI(s)?'accept-confirm':'confirm',sessionId:id,at}});
   const ui=getUI(),next=nextPendingSession(getState(),{...ui,reviewTaskId:s.taskId});if(next)selectSession(next.id);else{ui.showReviewRecords=false;render();}return true;
  }
  return false;
 }
 async function change(target){
  const d=current();if(target.id==='raw-golden-file'){
   const file=target.files?.[0];if(!file)return true;d.error='';d.loading=true;redraw();try{const gold=await parseRawGoldenFile(file,d.state,d.taskId);d.metrics=evaluateRawGolden(d.state,d.taskId,gold);d.fileName=file.name;}catch(error){d.error=error.message;d.metrics=null;}finally{d.loading=false;if(current()===d)redraw();}return true;
  }
  if(target.id==='raw-structure-consent'){d.consent=target.checked;d.modelFingerprint=configKey(getModelConfig());redraw();return true;}
  return false;
 }
 function dialog(d){
  if(d?.type==='raw-edit'){const content=rawEditDialog(d,getState(),getState().sessions.find(s=>s.id===d.sessionId));return `<div class="modal-backdrop" data-backdrop="true"><section class="modal ${content.typeClass}" role="dialog" aria-modal="true" aria-labelledby="dialog-title">${content.body}</section></div>`;}
  if(d?.type==='raw-golden'){
   const m=d.metrics;return frame('金标准验收对照',h`<div class="form-error" id="form-error" role="alert">${e(translateError(d.error||''))}</div><p>人工标签仅在本机比对，不发送模型。缺失与失败保留完整分母。</p><button class="btn" data-act="raw-golden-template">下载本任务金标准模板</button><label class="import-upload"><input id="raw-golden-file" type="file" accept=".xlsx" aria-label="上传填写好的金标准模板" ${d.loading?'disabled':''}>${e(d.fileName||t('上传填写好的金标准模板'))}</label>${m?h`<div class="task-detail-metrics raw-golden-metrics"><div><strong>${pct(m.accuracy.rate)}</strong><small>${t('规则级正确率')} ${m.accuracy.correct}/${m.accuracy.total}</small></div><div><strong>${pct(m.uncertainty.rate)}</strong><small>${t('无法判定率')} ${m.uncertainty.count}/${m.uncertainty.total}</small></div><div><strong>${pct(m.failRecall.rate)}</strong><small>${t('FAIL召回率')} ${m.failRecall.recalled}/${m.failRecall.total}</small></div><div><strong>${m.wrongAIFinalPass.count}</strong><small>错误免审PASS行数</small></div></div><p>${t('人工标注覆盖')} ${m.counts.goldenChecks}/${m.counts.expectedChecks} · ${t('人工活跃审核秒')} ${(m.humanReviewTimeMs/1000).toFixed(1)}</p><p class="hint">${t('免审PASS完整标注覆盖')} ${m.wrongAIFinalPass.assessedRows}/${m.wrongAIFinalPass.totalAIFinalRows} · ${t('技术失败行')} ${m.counts.technicalFailedRows} · ${t('无有效回答项')} ${m.counts.unansweredChecks} · ${t('缺失金标准项')} ${m.counts.missingGolden}</p><p class="hint">${t('AI调用尝试数（仅质检）')} ${m.reviewRouting.modelRequestAttempts??t('未记录')} · ${t('不确定行数')} ${m.reviewRouting.uncertainRows} · ${t('退回人工次数')} ${m.reviewRouting.returnEvents}</p>${!m.acceptance.goldenComplete?h`<p class="soft-note warning">金标准未完整覆盖，不能宣称验收通过。</p>`:''}`:h`<p class="soft-note">尚未进行金标准对照，不展示虚构正确率。</p>`}<p class="hint">${d.state?.tasks?.find(task=>task.id===d.taskId)?.reviewPolicy?.version===2?t('本页仅作金标准对照，不会启用免审；请在规则级标定入口完成独立验证。'):t('0.90为未标定自评门槛，与90%金标准正确率目标独立。')}</p>`,h`<button class="btn" data-act="raw-golden-json" ${m?'':'disabled'}>下载对照JSON</button><button class="btn primary" data-act="raw-golden-html" ${m?'':'disabled'}>下载验收对照报告</button>`);
  }
  if(d?.type==='raw-structure'){
   const cfg=getModelConfig()||{},job=d.job,result=d.result,artifact=result?.artifact;
   if(configKey(cfg)!==d.modelFingerprint)d.consent=false;
   return frame('可选结构化导出',h`<div class="form-error" id="form-error" role="alert">${e(translateError(d.error||''))}</div><p>${e(d.taskName)}</p><p>后台生成结构化辅助表，不改变本次判定、原文证据或人工记录。</p><p class="soft-note warning">无可靠时间或字段不完整时输出AI生成未核验草稿，不冒充可直接导入的会话信息与逐条发言表。</p>${badge(ready(cfg)?'模型连接已测试通过':'当前连接尚未测试',ready(cfg)?'success':'warning')}<button class="btn" data-act="raw-structure-model">配置并测试模型</button><p>${t('当前接口')}：${e(cfg.baseUrl||'')} · ${e(cfg.model||'')}</p><label class="check-label"><input type="checkbox" id="raw-structure-consent" ${d.consent?'checked':''} ${d.loading?'disabled':''}>我确认原文获准发送至当前已测试接口，生成可选结构化产物</label><button class="btn primary" data-act="raw-structure-run" ${d.loading||!d.consent||!ready(cfg)||job?.status==='running'?'disabled':''}>开始后台结构化</button>${job?h`<p role="status">${e(t(job.status))} · ${job.processed||0}/${job.total||0}</p><div class="toolbar-group"><button class="btn" data-act="raw-structure-pause" ${job.status==='running'?'':'disabled'}>暂停</button><button class="btn" data-act="raw-structure-resume" ${job.status==='paused'?'':'disabled'}>继续</button><button class="btn" data-act="raw-structure-retry" ${job.failed?'':'disabled'}>重试失败项</button></div><ul>${(job.nodes||[]).map(n=>h`<li>${e(t(n.label||n.recordId))} · ${e(t(n.status))}${n.error?h`<span class="task-row-error">${e(translateError(n.error))}</span>`:''}</li>`).join('')}</ul>`:''}${artifact?h`<p class="soft-note">${e(t(artifact.label==='标准双表（AI生成，未核验）'?'会话信息与逐条发言表（AI生成，未核验）':artifact.label))} · ${e(artifact.kind==='standard-double-sheet'?t('会话信息与逐条发言表已通过格式检查'):t('AI生成未核验草稿'))}</p>`:''}`,h`<button class="btn primary" data-act="raw-structure-download" ${artifact?'':'disabled'}>下载辅助表与转换说明</button>`);
  }
  return'';
 }
 return{click,change,dialog,stop,captureEdit};
}
