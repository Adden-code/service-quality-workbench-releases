import {e,icon,badge} from './ui.mjs';
import {conversionConfirmations} from './import-flow-ui.mjs';
import {importDraftSnapshot} from './import-drafts-manager.mjs';
import {html as uiHtml,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {inspectConversationCleaningFile,cleaningRowInput,applyCleaningResult,recordCleaningFailure,updateCleaningField,firstVerifiedCleaningMessageTime,adoptFirstCleaningMessageTime,splitCleaningSegment,confirmCleaningRow,finalizeCleaningDraft,MAX_CLEANING_CELL_CHARS} from './conversation-cleaning.mjs';

const labels={id:'会话ID',agent:'客服',startedAt:'会话开始时间',completeness:'会话完整性',missingNote:'缺失说明',customer:'客户标识',topic:'会话主题',channel:'渠道',product:'产品型号',role:'角色',at:'消息时间',text:'原文',kind:'片段类型',included:'保留本片段',excluded:'弃用本行'};
const statusLabel={pending:'未起草',running:'正在起草',prepared:'待人工核对',failed:'失败待处理',manual:'人工整理中'};
const now=()=>new Date().toISOString();
const hasWork=d=>Boolean(d?.draft?.rows?.some(row=>row.attempts?.length||row.history?.length||row.confirmed));
const fieldAttributes=(row,index,key)=>`data-cleaning-row="${row}" data-cleaning-segment="${index===null?'row':index}" data-cleaning-field="${key}"`;
const selected=(value,option)=>value===option?' selected':'';
const modelReady=config=>config?.configured===true&&config.connectionTested===true;
const configBinding=config=>JSON.stringify(['baseUrl','model','authMode','timeoutMs','reasoningEffort','maxTokens','connectionTestedAt'].map(key=>config?.[key]??null));
const inputField=(id,label,value,extra='')=>uiHtml`<label class="cleaning-field" for="${e(id)}"><span>${uiT(label)}</span><input class="field" id="${e(id)}" value="${e(value??'')}" ${uiAttributes(extra)}></label>`;
const sourceText=origin=>!origin||origin.kind==='missing'?uiT('来源未提供，补录需写原因'):origin.kind==='ai-inferred'?uiT('AI语义建议，原文待核对'):origin.kind==='derived'?uiT('程序按原文位置分配编号'):uiT('原文字符 {0}–{1}',{0:origin.start+1,1:origin.end});
function sourceButton(row,index,key,origin){return uiHtml`<button class="text-btn cleaning-source-link" data-act="cleaning-source" data-row="${row}" data-index="${index===null?'row':index}" data-field="${key}" type="button">${e(sourceText(origin))}</button>`;}
const rowFieldSource=(row,key)=>key==='startedAt'&&row.manual.startedAt?.origin?{...row.manual.startedAt.origin,kind:'exact'}:row.fieldSources[key];
function reasonField(row,index,key,manual){const label=uiT(labels[key]||key);return !manual?.[key]?'':uiHtml`<label class="cleaning-reason"><span>${e(uiT('人工{0}修改 / 补录原因（必填）',{0:label}))}</span><input class="field" aria-label="${e(uiT('{0}修改原因',{0:label}))}" value="${e(manual[key].reason)}" ${fieldAttributes(row,index,key)} data-cleaning-reason="true" maxlength="1000"></label>`;}
function sourceView(d,row){
 const focus=d.highlight?.row===row.row?d.highlight:null,segment=focus&&focus.index!==null?row.segments[focus.index]:null;
 if(focus&&focus.index===null&&['id','agent'].includes(focus.field))return uiHtml`<div class="cleaning-source-panel"><strong>${e(uiT('源列 {0} · 第{1}行',{0:d.draft.columns[focus.field],1:row.row}))}</strong><pre><mark>${e(row.original[focus.field])}</mark></pre></div>`;
 const loc=segment?(segment.fieldSources?.[focus.field]?.start!==undefined?segment.fieldSources[focus.field]:segment.sourceLocator):focus?.index===null&&focus.field==='startedAt'?row.manual.startedAt?.origin||null:null;
 const text=row.original.text;
 return uiHtml`<div class="cleaning-source-panel"><div><strong>${e(uiT('源单元格：{0} · 第{1}行 · {2}',{0:d.draft.sheet,1:row.row,2:d.draft.columns.text}))}</strong><small>原件只读；点击字段来源定位高亮</small></div><pre>${loc?`${e(text.slice(0,loc.start))}<mark>${e(text.slice(loc.start,loc.end))}</mark>${e(text.slice(loc.end))}`:e(text)}</pre></div>`;
}
function firstTimeButton(d,row,disabled){
 const first=firstVerifiedCleaningMessageTime(d.draft,row.row);if(!first)return '';
 return uiHtml`<button class="text-btn" data-act="cleaning-use-first-time" data-row="${row.row}"${disabled}>采用首条消息时间</button><p class="hint">仅在点击并人工确认后作为会话开始时间，来源定位和采用原因将留痕。</p>`;
}
function editableSegment(d,row,segment,index){
 if(segment.kind==='separator')return '';
 const attrs=key=>fieldAttributes(row.row,index,key),disabled=d.running?' disabled':'';
 const split=d.splitInputs?.[`${row.row}:${index}`]||{};
 return uiHtml`<article class="cleaning-message ${segment.included?'':'excluded'}"><div class="cleaning-message-head"><strong>${e(uiT('片段 {0}',{0:index+1}))} ${segment.kind==='unparsed'?badge(uiT('待处理片段'),'warning'):''}</strong><label><input type="checkbox" ${attrs('included')} ${segment.included?'checked':''}${disabled}>保留本片段</label></div>${reasonField(row.row,index,'included',segment.manual)}<div class="cleaning-fields"><div>${inputField(`cleaning-turn-${row.row}-${index}`,'轮次ID',segment.id,`${attrs('id')} type="number" min="1"${disabled}`)}${sourceButton(row.row,index,'id',{kind:'derived'})}${reasonField(row.row,index,'id',segment.manual)}</div><div><label class="cleaning-field"><span>片段类型</span><select class="field" ${attrs('kind')}${disabled}><option value="message"${selected(segment.kind,'message')}>消息</option><option value="unparsed"${selected(segment.kind,'unparsed')}>待处理片段</option></select></label>${reasonField(row.row,index,'kind',segment.manual)}</div><div><label class="cleaning-field"><span>角色</span><select class="field" ${attrs('role')}${disabled}><option value="">待人工核对</option>${['客户','客服','系统'].map(role=>`<option value="${role}"${selected(segment.role,role)}>${uiT(role)}</option>`).join('')}</select></label>${sourceButton(row.row,index,'role',segment.fieldSources?.role)}${reasonField(row.row,index,'role',segment.manual)}</div><div>${inputField(`cleaning-at-${row.row}-${index}`,'消息时间',segment.at,`${attrs('at')} placeholder="未知时留空；补录需完整日期及来源原因"${disabled}`)}${sourceButton(row.row,index,'at',segment.fieldSources?.at)}${reasonField(row.row,index,'at',segment.manual)}</div></div><label class="cleaning-field"><span>原文</span><textarea class="field" rows="3" ${attrs('text')}${disabled}>${e(segment.text)}</textarea></label>${sourceButton(row.row,index,'text',segment.fieldSources?.text)}${reasonField(row.row,index,'text',segment.manual)}${segment.warnings?.length?uiHtml`<p class="cleaning-warning">${segment.warnings.map(value=>e(uiError(value))).join('；')}</p>`:''}<details class="cleaning-split"><summary>校正消息边界：拆分本片段</summary><p class="hint">源文本位置 ${segment.sourceLocator.start}–${segment.sourceLocator.end}；填写单元格原文中从0开始的拆分偏移。两部分均保留并重新核对。</p><div class="cleaning-fields">${inputField(`cleaning-split-${row.row}-${index}`,'拆分偏移',split.offset??'',`type="number" min="${segment.sourceLocator.start+1}" max="${segment.sourceLocator.end-1}" data-cleaning-split="offset" data-row="${row.row}" data-index="${index}"${disabled}`)}${inputField(`cleaning-split-reason-${row.row}-${index}`,'拆分原因（必填）',split.reason||'',`data-cleaning-split="reason" data-row="${row.row}" data-index="${index}" maxlength="1000"${disabled}`)}</div><button class="btn" data-act="cleaning-split" data-row="${row.row}" data-index="${index}"${disabled}>按来源位置拆分</button></details></article>`;
}
function reviewView(d,canDraft){
 const draft=d.draft,row=draft?.rows?.find(row=>row.row===d.selectedRow)||draft?.rows?.[0];if(!row)return '';
 const done=draft.rows.filter(row=>row.confirmed).length,failed=draft.rows.filter(row=>row.status==='failed').length,disabled=d.running?' disabled':'';
 return uiHtml`<section class="cleaning-review"><div class="cleaning-review-head"><h3>逐行人工核对</h3><span>${done}/${draft.rows.length} 行已确认 · ${failed} 行失败待处理</span><select class="field" id="cleaning-selected-row" aria-label="选择待核对原表行">${draft.rows.map(item=>`<option value="${item.row}"${selected(row.row,item.row)}>${e(uiT('第{0}行 · {1} · {2}',{0:item.row,1:item.original.id||uiT('空会话ID'),2:uiT(item.confirmed?item.excluded?'已确认弃行':'人工已确认':statusLabel[item.status]||item.status)}))}</option>`).join('')}</select></div>${row.error?uiHtml`<p class="form-error">${e(uiError(row.error))}</p>`:''}<div class="cleaning-review-grid">${sourceView(d,row)}<div class="cleaning-edit-panel"><div class="cleaning-fields">${['id','agent','startedAt'].map(key=>uiHtml`<div>${inputField(`cleaning-row-${key}`,labels[key],row.fields[key],`${fieldAttributes(row.row,null,key)}${key==='startedAt'?' placeholder="YYYY-MM-DDTHH:mm:ss+08:00"':''}${disabled}`)}${sourceButton(row.row,null,key,rowFieldSource(row,key))}${key==='startedAt'?firstTimeButton(d,row,disabled):''}${reasonField(row.row,null,key,row.manual)}</div>`).join('')}<div><label class="cleaning-field"><span>会话完整性</span><select class="field" ${fieldAttributes(row.row,null,'completeness')}${disabled}><option value="">待人工确认</option>${['完整','部分缺失'].map(value=>`<option value="${value}"${selected(row.fields.completeness,value)}>${uiT(value)}</option>`).join('')}</select></label>${reasonField(row.row,null,'completeness',row.manual)}</div></div>${row.fields.completeness==='部分缺失'?inputField('cleaning-row-missing','缺失说明',row.fields.missingNote,`${fieldAttributes(row.row,null,'missingNote')}${disabled}`)+reasonField(row.row,null,'missingNote',row.manual):''}<details class="cleaning-optional-fields"><summary>主题、渠道等可选字段</summary><div class="cleaning-fields">${['topic','channel','product','customer'].map(key=>inputField(`cleaning-row-${key}`,labels[key],row.fields[key],`${fieldAttributes(row.row,null,key)}${disabled}`)+reasonField(row.row,null,key,row.manual)).join('')}</div></details><div class="cleaning-row-disposition"><label><input type="checkbox" ${fieldAttributes(row.row,null,'excluded')} ${row.excluded?'checked':''}${disabled}>弃用本行（原文和原因保留在报告）</label>${reasonField(row.row,null,'excluded',row.manual)}</div>${!row.excluded?row.segments.map((segment,index)=>editableSegment(d,row,segment,index)).join(''):''}<div class="cleaning-row-actions"><button class="btn" data-act="cleaning-manual" data-row="${row.row}"${disabled}>人工整理本行</button><button class="btn" data-act="cleaning-retry" data-row="${row.row}"${disabled||(!canDraft?' disabled':'')}>重新起草本行</button><button class="btn primary" data-act="cleaning-confirm-row" data-row="${row.row}"${disabled}>${row.confirmed?uiT('重新确认本行'):uiT('对照原文，确认本行')}</button></div><p class="hint">无法解析的内容须人工整理或注明弃用原因；所有原行均留痕。补录时间请填写可核实来源，不用当前日期代填。</p></div></div></section>`;
}

export function createConversationCleaningManager(ctx){
 const get=()=>ctx.getDialog(),render=(force=true)=>ctx.renderDialog(force);
 // Original conversations stay only in this page's memory. No localStorage or
 // background persistence is used for unfinished preparation.
 const retainedByScene=new Map();
 let controller=null;
 function fresh(previous,scene,{inheritFile=true}={}){
  const context=inheritFile?(previous?.type==='conversation-cleaning'?previous.returnDialog:previous):null;
  const value={type:'conversation-cleaning',scene,_importDraft:inheritFile?context?._importDraft:undefined,requireConversionConfirmation:Boolean(context?.requireConversionConfirmation),mappingConfirmed:false,sampleConfirmed:false,file:inheritFile?context?.file||null:null,sheet:inheritFile?context?.profile?.sheet||'':'',headerRow:inheritFile?context?.profile?.headerRow||1:1,idColumn:inheritFile?context?.profile?.fields?.id||'会话ID':'会话ID',agentColumn:inheritFile?context?.profile?.fields?.agent||'客服':'客服',textColumn:inheritFile?context?.profile?.fields?.text||'消息详情':'消息详情',timezone:'',reviewer:context?.reviewer||uiT('本机操作人'),draft:null,consent:false,consentBinding:null,running:false,loading:false,error:'',restored:false,returnDialog:context||null};
  retainedByScene.set(scene,value);return value;
 }
 function feedback(d,message){d.error=String(message||'清洗操作未完成。');render();}
 async function inspect(d){
  if(!d.file||d.running)return;
  if(hasWork(d))throw new Error('本草稿已有模型调用或人工核对；如需更换来源，请使用“重新选择文件并新建清洗草稿”。');
  d.loading=true;d.error='';d.draft=null;d.consent=false;d.savedSource=null;render();
  try{
   const result=await inspectConversationCleaningFile(d.file,{scene:d.scene,sheet:d.sheet,headerRow:d.headerRow,idColumn:d.idColumn,agentColumn:d.agentColumn,textColumn:d.textColumn,timezone:d.timezone});
   if(get()!==d)return;d.sheets=result.sheets||d.sheets||[];
   if(!result.valid)throw new Error(result.errors.join('；'));
   d.draft=result.draft;d.sheet=result.draft.sheet;d.selectedRow=result.draft.rows[0]?.row;d.warnings=result.warnings;
  }catch(error){if(get()===d)d.error=error.message;}finally{d.loading=false;if(get()===d)render();}
 }
 async function run(d,rowNumber,retry=false){
  if(!d.draft)throw new Error('请先选择并核对业务原表。');
  if(!d.consent)throw new Error('请先勾选模型调用知情同意，再开始AI起草。');
  const config=ctx.getModelConfig?.()||{};
  if(!modelReady(config))throw new Error('请先在模型设置中成功测试当前获准接口。');
  if(d.consentBinding&&d.consentBinding!==configBinding(config)){d.consent=false;throw new Error('模型设置已经变化，请重新核对本次接口并勾选知情同意。');}
  const eligible=d.draft.rows.filter(row=>(rowNumber===undefined||row.row===rowNumber)&&!row.confirmed&&!row.excluded&&!row.history.length&&(retry?['pending','failed','prepared'].includes(row.status):['pending','failed'].includes(row.status)));
  if(!eligible.length)throw new Error('没有可起草行；已有人工改动请继续核对，避免覆盖。');
  controller=new AbortController();const currentController=controller;d.running=true;d.progress={done:0,total:eligible.length,row:null};d.error='';render();
  try{
   for(const original of eligible){
    if(currentController.signal.aborted||get()!==d)break;
    const row=d.draft.rows.find(row=>row.row===original.row);row.status='running';d.progress.row=row.row;render();
    try{
     const input=cleaningRowInput(d.draft,row.row);
     if(input.text.length>MAX_CLEANING_CELL_CHARS)throw new Error('本会话超过清洗输入预算，未截断；请人工整理或分批处理。');
     const result=await ctx.prepareConversationCleaning(input,{signal:currentController.signal});
     if(currentController.signal.aborted)throw new Error('本次请求已取消。');
     d.draft=applyCleaningResult(d.draft,row.row,result,{now:now()});d.mappingConfirmed=false;d.sampleConfirmed=false;
    }catch(error){d.draft=recordCleaningFailure(d.draft,row.row,error.message,{now:now(),cancelled:currentController.signal.aborted});}
    d.progress.done++;if(get()===d)render();
   }
  }finally{if(controller===currentController)controller=null;d.running=false;if(get()===d)render();}
 }
 function dialog(d=get()){
  if(d?.type!=='conversation-cleaning')return null;
  const config=ctx.getModelConfig?.()||{},count=d.draft?.rows?.length||0,ready=modelReady(config),canDraft=ready&&d.consent;
  const confirmed=d.draft?.rows?.every(row=>row.confirmed),locked=d.running||d.loading,sourceLocked=locked||hasWork(d);
  const body=uiHtml`<header class="modal-head"><div><h2 id="dialog-title">AI解析转换</h2><p>AI起草 → 人工核对 → 清洗报告留痕</p></div><button class="icon-btn" data-act="cleaning-close" aria-label="关闭清洗">${icon('close',18)}</button></header><div class="modal-body"><div class="status-strip creation-steps"><span class="step">1 AI起草</span>${icon('chevron',10)}<span class="step">2 人工核对</span>${icon('chevron',10)}<span class="step">3 留痕导入</span></div><p class="soft-note warning cleaning-release-boundary">本轮解析转换流程已调整，请在内网使用49会话/1735轮次基准复测数量、角色与时间；外部合成测试不代表业务准确率。</p>${d.restored?uiHtml`<p class="soft-note cleaning-restored">已恢复未完成解析草稿，已有模型结果和人工修改均保留；再次调用需重新确认。</p>`:''}<p class="hint">草稿与原文件保存在本机工作区；可保存并关闭，稍后从“导入草稿”继续。保存失败时请保留当前页面并重试。</p><div class="form-error" id="cleaning-error" role="alert">${e(uiError(d.error||''))}</div><label class="import-upload"><input type="file" id="cleaning-file" accept=".xlsx" aria-label="选择三列会话原表" ${sourceLocked?'disabled':''}>${e(d.file?.name||uiT('选择业务.xlsx：会话ID / 客服 / 消息详情'))}</label><fieldset class="cleaning-fields cleaning-source-options" ${sourceLocked?'disabled':''}>${d.sheets?.length?`<label class="cleaning-field"><span>${uiT('工作表')}</span><select class="field" id="cleaning-sheet"${locked?' disabled':''}><option value="">${uiT('请选择')}</option>${d.sheets.map(name=>`<option value="${e(name)}"${selected(d.sheet,name)}>${e(name)}</option>`).join('')}</select></label>`:inputField('cleaning-sheet','工作表',d.sheet,'placeholder="单工作表自动识别"')}${inputField('cleaning-header-row','表头物理行',d.headerRow,'type="number" min="1"')}${inputField('cleaning-id-column','会话ID源列',d.idColumn)}${inputField('cleaning-agent-column','客服源列',d.agentColumn)}${inputField('cleaning-text-column','消息详情源列',d.textColumn)}<label class="cleaning-field"><span>来源时间解释</span><select class="field" id="cleaning-timezone"${locked?' disabled':''}><option value=""${selected(d.timezone,'')}>只接收来源明确时区</option><option value="+08:00"${selected(d.timezone,'+08:00')}>我确认本地完整日期时间为北京时间</option></select></label></fieldset><div class="toolbar-group"><button class="btn" data-act="cleaning-inspect" ${sourceLocked||!d.file?'disabled':''}>读取 / 重新核对原表</button><button class="text-btn" data-act="cleaning-new-draft">重新选择文件并新建清洗草稿</button>${count?uiHtml`<span class="hint">${count} 原始会话行，原件完整保留</span>`:''}</div><div class="cleaning-awareness"><div class="toolbar-group" role="status">${badge(ready?'模型连接已测试通过':config.configured?'当前连接尚未测试':'尚未配置模型',ready?'success':'warning')}<button class="btn" data-act="cleaning-configure-model" ${locked?'disabled':''}>配置并测试模型</button></div>${!ready?uiHtml`<p class="hint">${config.configured?uiT('当前模型尚未测试通过。请先测试连接，再返回清洗。'):uiT('先配置并测试模型，才能起草；当前原表和核对内容会保留。')}</p>`:''}${d.modelReturned?uiHtml`<p class="hint" role="status">设置已返回，原草稿已保留。请重新核对接口并勾选本次调用授权。</p>`:''}<p>将逐会话发送所选三列原文至当前已保存并成功测试的获准模型接口${config.model?`（${e(config.model)}）`:''}。每行独立请求；可能计费，失败不会自动重试。原人工答案、金标准及其他表不参与清洗。</p><label><input type="checkbox" id="cleaning-consent" ${d.consent?'checked':''}${d.running?' disabled':''}>我已知情并确认本次材料获准发送至当前接口</label><div class="toolbar-group"><button class="btn" data-act="cleaning-run" ${locked||!count||!canDraft?'disabled':''}>${icon('spark',14)}AI起草未处理行</button>${d.running?uiHtml`<button class="btn" data-act="cleaning-cancel">取消后续调用</button>`:''}<span role="status" aria-live="polite">${d.progress?uiT(`已处理 ${d.progress.done}/${d.progress.total} 行`)+(d.running?uiT(`，正在处理原表第${d.progress.row}行`):''):''}</span></div></div>${inputField('cleaning-reviewer','清洗核对人（操作标签）',d.reviewer,'maxlength="80"')}${d.requireConversionConfirmation?conversionConfirmations(d):''}${reviewView(d,canDraft)}</div><footer class="modal-footer"><small>人工确认后仍须通过原标准双表预检，并绑定有效规则与资料</small><div><button class="btn" data-act="import-save-close">保存草稿并关闭</button><button class="btn" data-act="cleaning-close">返回</button><button class="btn primary" data-act="cleaning-finish" ${locked||!count||!confirmed||(d.requireConversionConfirmation&&(!d.mappingConfirmed||!d.sampleConfirmed))?'disabled':''}>核对完成，继续绑定依据</button></div></footer>`;
  return uiHtml`<div class="modal-backdrop" data-backdrop="true"><section class="modal wide import-modal conversation-cleaning-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1">${body}</section></div>`;
 }
 async function action(act,button={}){
  if(!act?.startsWith('cleaning-'))return false;
  let d=get();
  if(act==='cleaning-open'){
   const previous=d,scene=previous?.businessScene||previous?.scene||previous?.profile?.scene||'新品产品咨询';
   if(previous?.loading||previous?.running)return true;
   const retained=retainedByScene.get(scene);
   if(retained?.draft&&!retained.completed){
    retained.returnDialog=previous?.type==='conversation-cleaning'?previous.returnDialog:previous||retained.returnDialog;retained.restored=true;
    ctx.openDialog(retained);return true;
   }
   const value=fresh(previous,scene);
   ctx.openDialog(value);d=get();if(d.file)await inspect(d);return true;
  }
  if(d?.type!=='conversation-cleaning')return false;
  if(act==='cleaning-cancel'){controller?.abort();return true;}
  if(act==='cleaning-close'){controller?.abort();if(d.returnDialog){d.returnDialog.retainedConversion=importDraftSnapshot(d,2);ctx.openDialog(d.returnDialog);}else ctx.closeDialog();return true;}
  if(act==='cleaning-new-draft'){
   controller?.abort();const next=fresh(d,d.scene,{inheritFile:false});ctx.openDialog(next);return true;
  }
  if(d.running||d.loading)return true;
  try{
   d.error='';
   if(act==='cleaning-configure-model')await ctx.configureModel?.(d);
   else if(act==='cleaning-inspect')await inspect(d);
   else if(act==='cleaning-run')await run(d);
   else if(act==='cleaning-retry')await run(d,Number(button.dataset?.row),true);
   else if(act==='cleaning-manual'){
    const row=d.draft?.rows.find(row=>row.row===Number(button.dataset?.row));if(!row)throw new Error('请先选择原行。');row.status='manual';row.error='';render();
   }else if(act==='cleaning-source'){
    d.highlight={row:Number(button.dataset?.row),index:button.dataset?.index==='row'?null:Number(button.dataset?.index),field:button.dataset?.field};render();
   }else if(act==='cleaning-split'){
    const row=Number(button.dataset?.row),index=Number(button.dataset?.index),values=d.splitInputs?.[`${row}:${index}`]||{};
    d.draft=splitCleaningSegment(d.draft,row,index,Number(values.offset),{reason:values.reason||'',now:now()});d.splitInputs={};render();
   }else if(act==='cleaning-confirm-row'){
    d.draft=confirmCleaningRow(d.draft,Number(button.dataset?.row),{reviewer:d.reviewer,now:now()});render();
   }else if(act==='cleaning-use-first-time'){
    const row=Number(button.dataset?.row),first=firstVerifiedCleaningMessageTime(d.draft,row);
    if(!first)throw new Error('首条消息没有可核验的完整来源时间，请人工核实后补录。');
    const reason=uiT('人工点击采用原文首条消息时间作为会话开始时间；已核对来源第{0}行、字符{1}–{2}。',{0:row,1:first.start+1,2:first.end});
    d.draft=adoptFirstCleaningMessageTime(d.draft,row,{reason,now:now()});render();
   }else if(act==='cleaning-finish'){
    if(d.requireConversionConfirmation&&(!d.mappingConfirmed||!d.sampleConfirmed))throw new Error('请先确认字段对应与抽样预览，两层确认均完成后才能使用转换结果。');
    d.loading=true;render();
    // A local source upload is content addressed and does not send it to a model.
    if(!d.savedSource)d.savedSource=await ctx.uploadSource(d.file);
    const parsed=await finalizeCleaningDraft(d.draft,{source:d.savedSource,reviewer:d.reviewer,...(d.requireConversionConfirmation?{conversionReview:{version:1,mappingConfirmedAt:d.mappingConfirmedAt,previewConfirmedAt:d.sampleConfirmedAt,operator:d.reviewer}}:{}),now:now()});
    if(!parsed.valid)throw new Error(parsed.errors.join('；'));
    if(get()!==d)return true;d.loading=false;
    await ctx.beginCleanedTask({parsed,file:d.file,scene:d.scene,source:d.savedSource,cleaningReportSnapshot:parsed.cleaningReportSnapshot,importDraft:d._importDraft,name:d.returnDialog?.name});
    d.completed=true;if(retainedByScene.get(d.scene)===d)retainedByScene.delete(d.scene);
   }else return false;
  }catch(error){if(get()===d){d.loading=false;feedback(d,error.message);}else ctx.toast?.(error.message,true);}
  finally{if(act==='cleaning-finish'){d.loading=false;if(get()===d)render();}}
  return true;
 }
 function input(event){
  const d=get(),target=event?.target;if(d?.type!=='conversation-cleaning'||!target)return false;
  if(d.running||d.loading)return true;
  const id=target.id,data=target.dataset||{};
  if(['cleaning-mapping-confirm','cleaning-sample-confirm'].includes(id)){const field=id==='cleaning-mapping-confirm'?'mappingConfirmed':'sampleConfirmed';d[field]=target.checked;d[field+'At']=target.checked?now():null;return true;}
  if(id==='cleaning-consent'){d.consent=target.checked;d.consentBinding=target.checked?configBinding(ctx.getModelConfig?.()||{}):null;d.error='';return true;}
  if(id==='cleaning-reviewer'){d.reviewer=target.value;return true;}
  if(id==='cleaning-selected-row'){d.selectedRow=Number(target.value);d.highlight=null;return true;}
  if(data.cleaningSplit){const key=`${data.row}:${data.index}`;d.splitInputs={...d.splitInputs,[key]:{...d.splitInputs?.[key],[data.cleaningSplit]:target.value}};return true;}
  if(data.cleaningField){
   d.mappingConfirmed=false;d.sampleConfirmed=false;
   try{
    const rowNumber=Number(data.cleaningRow),index=data.cleaningSegment==='row'?null:Number(data.cleaningSegment),key=data.cleaningField;
    const row=d.draft.rows.find(row=>row.row===rowNumber),segment=index===null?null:row.segments[index],targetValue=segment||(['excluded'].includes(key)?row:row.fields),manual=(segment||row).manual;
    const value=data.cleaningReason?targetValue[key]:target.type==='checkbox'?target.checked:target.value;
    const reason=data.cleaningReason?target.value:manual?.[key]?.reason||'';
    d.draft=updateCleaningField(d.draft,rowNumber,index,key,value,{reason,now:now()});d.error='';
   }catch(error){d.error=error.message;}
   return true;
  }
  const key={'cleaning-sheet':'sheet','cleaning-header-row':'headerRow','cleaning-id-column':'idColumn','cleaning-agent-column':'agentColumn','cleaning-text-column':'textColumn','cleaning-timezone':'timezone'}[id];
  if(key){if(hasWork(d)){d.error='本草稿已有模型调用或人工核对；如需更换来源，请使用“重新选择文件并新建清洗草稿”。';return true;}d[key]=key==='headerRow'?Number(target.value):target.value;d.draft=null;d.consent=false;d.savedSource=null;return true;}
  return false;
 }
 async function change(event){
  const d=get();if(d?.type!=='conversation-cleaning')return false;
  if(event.target?.id==='cleaning-file'){
   if(hasWork(d)){feedback(d,'本草稿已有模型调用或人工核对；如需更换来源，请使用“重新选择文件并新建清洗草稿”。');return true;}
   if(d.running)return true;d.file=event.target.files?.[0]||null;d.draft=null;d.consent=false;d.sheet='';d.sheets=[];if(d.file)await inspect(d);else render();return true;
  }
  const handled=input(event);if(handled)render();return handled;
 }
 function resume(d){
  if(d?.type!=='conversation-cleaning'||d.completed)return;
  d.consent=false;d.consentBinding=null;d.error='';d.modelReturned=true;ctx.openDialog(d);
 }
 return {dialog,action,input,change,resume,cancel:()=>controller?.abort()};
}
