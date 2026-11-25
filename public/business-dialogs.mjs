import {reviewRuleDisplayName as ruleDisplayName,reviewMaterialText,reviewMaterialContent,nativeMaterialNotice,getReviewTaskBasis,getReviewSessionRules,resolveReviewTaskReference} from './native-review-language.mjs';
import {ruleAdvisory} from './rule-advisory.mjs';
import {ruleCategoryField,ruleKindField} from './rule-entry-ui.mjs';
import {rawImportFields} from './raw-import-flow.mjs';
import {d as businessText,businessContent,translationControls} from './content-translation-ui.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {getSessionResults,canConfirmUnreplied} from './domain.mjs';
import {referenceKey} from './task-basis.mjs';
import {e,icon,badge} from './ui.mjs';
import {taskSceneDialog,creationSteps,executionSettingsFields} from './task-workbench.mjs';
import {sceneRuleAvailability} from './catalog-scenes.mjs';
import {sceneAssignmentFields} from './catalog-scene-ui.mjs';
import {hasSuccessfulAI} from './model-ui.mjs';
import {sceneLabel} from './scenarios.mjs';
import {taskBasisSummary,taskTimeRuleNotice,taskRuleList} from './task-rule-selection-ui.mjs';
import {triagePolicyFields,returnReviewDialog} from './review-routing-ui.mjs';
import {latestSceneConfiguration} from './scene-configuration.mjs';
import {sceneRuntimeForm} from './scene-configuration-ui.mjs';
import {importFlowView} from './import-flow-ui.mjs';
const fieldEvidenceEditor=(session,draft)=>!session.contextFields?.length?'':uiHtml`<fieldset class="field-group"><legend class="field-label">字段证据</legend><div class="checks">${session.contextFields.map(f=>uiHtml`<label><input type="checkbox" name="edit-field-evidence" value="${e(f.key)}" ${draft?.fieldEvidence?.includes(f.key)?'checked':''}><span>${e(businessText(f.label))}：${e(f.value)}<small>${e(f.source.sheet)} · 第${e(f.source.row)}行 · ${e(f.source.column)}</small></span></label>`).join('')}</div></fieldset>`;

const head=(title,description='')=>uiHtml`<header class="modal-head"><div><h2 id="dialog-title">${e(uiT(title))}</h2>${description?uiHtml`<p>${e(uiT(description))}</p>`:''}</div><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header>`;
const foot=(action,label,caption='保存成功后才更新记录')=>uiHtml`<footer class="modal-footer"><small>${e(uiT(caption))}</small><div><button class="btn" data-act="close-modal">取消</button><button class="btn primary" data-act="${e(action)}">${e(uiT(label))}</button></div></footer>`;
const textField=(id,label,value='',extra='')=>uiHtml`<div class="field-group"><label class="field-label" for="${id}">${e(uiT(label))}</label><input class="field" id="${id}" value="${e(value)}" ${extra}></div>`;
function unavailableRulesNote(availability){
  const r=availability.reasons,messages=[];
  if(r.empty)messages.push(uiT('规则目录为空。先下载规则模板，填写并导入草稿，再核对发布。'));
  else{
    if(r.unpublished)messages.push(uiT('该场景的规则尚未发布：{0} 个版本。',{0:r.unpublished}));
    if(r.future)messages.push(uiT('尚未到所选日期的生效日：{0} 个版本。',{0:r.future}));
    if(r.expired)messages.push(uiT('在所选日期已过期：{0} 个版本。',{0:r.expired}));
    if(r.unassigned)messages.push(uiT('规则或资料尚未分配到场景，请在规则管理中维护归属。'));
    if(r.policyUnavailable)messages.push(uiT('关联资料未发布、未生效、已过期或未归属本场景：{0} 项规则。',{0:r.policyUnavailable}));
    if(r.meta)messages.push(uiT('当前只有交付物要求，没有可用于本任务的会话检核规则。'));
    if(!messages.length)messages.push(uiT('目录中的规则归属于其他场景。请为当前场景导入或分配规则。'));
  }
  return uiHtml`<div class="empty-rules-recovery" role="status"><h3>当前场景没有可用规则</h3>${messages.map(message=>uiHtml`<p>${e(message)}</p>`).join('')}<button class="btn" data-act="new-manage-rules">前往规则管理</button><p class="hint">已上传文件和当前向导输入会保留；维护完成后可返回继续。</p></div>`;
}

export function businessTaskDialog(dialog,state={}){
  const step=dialog.step||1,parsed=dialog.parsed,records=parsed?.sessions||[],snapshot=dialog.basisSnapshot;
  const selectedScene=dialog.scene==='consultation'?'新品产品咨询':dialog.scene||records[0]?.scene||'新品产品咨询',label=sceneLabel(state,dialog.scenarioSnapshot?{scene:selectedScene,scenarioSnapshot:dialog.scenarioSnapshot}:selectedScene)||'产品咨询';
  let body=head(`新建质检任务 · ${uiT(label)}`)+uiHtml`<div class="modal-body">${creationSteps(step===3?2:1)}<div class="form-error" id="form-error">${e(uiError(dialog.error||''))}</div>`;
  if(step<=2){
    const preview=uiHtml`<div class="table-wrap"><table><thead><tr><th>会话标识</th><th>咨询主题</th><th>产品</th></tr></thead><tbody>${records.slice(0,5).map(s=>uiHtml`<tr><td class="mono">${e(s.externalId||s.id)}</td><td>${e(businessText(s.topic))}</td><td>${e(s.product)}</td></tr>`).join('')}</tbody></table></div><details class="input-transcript"><summary>核对第一条原文</summary>${(records[0]?.turns||[]).map(t=>uiHtml`<p><strong>第${e(t.id)}轮 ${e(uiT(t.role))}</strong> ${businessContent(t.text,{quote:true})}</p>`).join('')}</details>`;
    const rawPreview=parsed?.rawDirect?uiHtml`<div class="soft-note"><strong>原文直判 · ${records.length} 条原表会话</strong><p>原文未经拆轮或角色核验；无需人工清洗确认。</p></div><div class="table-wrap"><table><thead><tr><th>原表行</th><th>会话ID</th><th>客服</th><th>原始全文预览</th></tr></thead><tbody>${records.slice(0,5).map(s=>uiHtml`<tr><td>${s.rawTranscript.row}</td><td>${e(s.id)}</td><td>${e(s.agent)}</td><td><details><summary>${e(s.rawTranscript.text.slice(0,90))}</summary><pre dir="auto">${e(s.rawTranscript.text)}</pre></details></td></tr>`).join('')}</tbody></table></div>`:preview;
    body+=importFlowView(dialog,{label,preview:rawPreview,extra:rawImportFields(dialog)});
  }
  if(step===3){
    const sceneConfig=latestSceneConfiguration(state,selectedScene);
    const date=dialog.effectiveDate||'',availability=sceneRuleAvailability({state,catalog:dialog.catalog,scene:selectedScene,effectiveDate:date}),rules=availability.rules;
    body+=uiHtml`<div data-task-time-notice aria-live="polite">${taskTimeRuleNotice(dialog)}</div>`;
    body+=uiHtml`<div class="field-group"><strong>${e(businessText(dialog.name))}</strong><p class="tiny muted">${records.length}条会话 · ${e(dialog.reviewer)}</p></div>${sceneConfig?uiHtml`<section data-frozen-scene-rules><h3>场景冻结检核规则 · V${sceneConfig.version}</h3><p class="hint">按已发布场景完整执行，目录升级不会替换本次依据。</p><ul>${sceneConfig.basis.rules.map(r=>uiHtml`<li>${e(r.id)} ${e(r.version)} · ${e(ruleDisplayName(r))}</li>`).join('')}</ul></section>`:uiHtml`${textField('basis-date','依据基准日期',date,'type="date"')}<p class="hint">按此日期选择已发布的有效版本。跨生效日期的材料请先明确业务口径、分批处理。</p><div class="task-rule-tools"><span data-task-rule-count aria-live="polite">${uiT('已选 {0}/{1} 项',{0:rules.filter(rule=>(dialog.ruleIds||[]).includes(rule.id)).length,1:rules.length})}</span><div><button class="text-btn" data-act="select-all-task-rules" ${rules.length?'':'disabled'}>全选</button><button class="text-btn" data-act="clear-task-rules" ${rules.length?'':'disabled'}>清空</button></div></div>${taskRuleList(dialog,availability,unavailableRulesNote(availability))}`}<div class="basis-summary" data-task-basis-summary aria-live="polite">${taskBasisSummary(snapshot)}</div>${parsed?.rawDirect?uiHtml`<section class="raw-execution-settings"><h3>任务内并发</h3>${executionSettingsFields(dialog.executionSettings,'task',{raw:true})}</section>`:''}<details class="input-transcript" data-dialog-disclosure="product-settings"><summary>执行设置</summary>${parsed?.rawDirect?'':executionSettingsFields(dialog.executionSettings)}${sceneConfig?sceneRuntimeForm(sceneConfig,dialog.sceneRuntime,dialog.sceneOverrideReason):triagePolicyFields(dialog.reviewPolicy||{version:2,mode:'rule-calibrated',enabled:true,calibrationStatus:'per-rule',rules:[]})}<p>选择“创建并开始AI质检”会自动排队；仅创建可稍后执行。模型接口须先成功测试。</p></details><div class="soft-note">${icon('info',14)}${uiT('依据将随任务保存，后续目录变更不会改写本任务。创建后可在“模型设置”配置接口，再到任务详情点击“开始AI质检”；AI不通过、证据不足及可疑记录进入人工审核；AI通过免审遵循本任务分级审核策略。')}</div>`;
  }
  body+=uiHtml`</div><footer class="modal-footer"><small>原文件与依据版本保存在本机工作区</small><div><button class="btn" data-act="import-save-close">保存草稿并关闭</button>${step===3?uiHtml`<button class="btn" data-act="new-back">上一步</button><button class="btn" data-act="create-business-task" ${!snapshot?'disabled':''}>仅创建，稍后质检</button><button class="btn primary" data-act="create-business-task-start" ${!snapshot?'disabled':''}>创建并开始AI质检</button>`:uiHtml`<button class="btn primary" data-act="new-next" ${!parsed?.valid||!records.length||!dialog.previewConfirmed?'disabled':''}>下一步：依据与执行设置</button>`}</div></footer>`;
  return {body,typeClass:'wide'};
}

export function businessDialog(dialog,state,ui){
  const returnDialog=returnReviewDialog(dialog,state);if(returnDialog)return returnDialog;
  if(dialog.type==='task-scene')return taskSceneDialog(state);
  if(dialog.type==='new-task'&&dialog.mode==='manual')return businessTaskDialog(dialog,state);
  if(dialog.type==='help'&&ui.dataMode==='manual')return {typeClass:'',body:head('文件任务使用说明')+uiHtml`<div class="modal-body"><ol class="guide-list"><li><strong>准备材料</strong><p>新品整段原表提供会话ID、客服、消息详情三列即可直接质检；会话信息与逐条发言表与电商表继续按各自模板导入，上传后核对原文预览。</p></li><li><strong>绑定依据</strong><p>选择基准日期和已发布检查项，规则及参考资料版本随任务保存。产品咨询请先维护并发布适用的真实规则与资料；电商评论需明确确认Sheet4口径与版本。</p></li><li><strong>运行AI质检</strong><p>在“模型设置”填写获准使用的OpenAI兼容接口地址、模型名称与鉴权方式，可选择无需密钥，保存并测试连接。创建任务后点击“AI质检”，完成后可查看初判、原文证据和引用依据。失败会话可重试，已有人工记录的会话会保留。</p></li><li><strong>审核分流</strong><p>按任务策略，满足门槛且证据完整的AI通过记录可形成AI终判；AI不通过、证据不足或已退回的记录由人工核对并确认。尚未执行的记录单列。</p></li><li><strong>确认与导出</strong><p>最终结果区分AI判定和人工确认，可下载质检明细及管理分析报告。记录和原文件由本机服务保存。</p></li></ol><div class="soft-note">本机独立工具没有登录认证；审核人是填写的操作标签。AI运行时会将原文、规则和相关资料发送至配置的模型接口，请使用获准处理的资料。</div></div>`+foot('close-modal','知道了','资料与记录保存于本机工作区')};
  const session=state.sessions.find(s=>s.id===ui.selectedId),task=state.tasks.find(t=>t.id===session?.taskId);
  if(dialog.type==='reset')return {typeClass:'narrow',body:head('恢复初始演示数据')+uiHtml`<div class="modal-body"><p>将恢复演示案例和演示审核记录。文件任务、其人工记录、原文件及规则资料目录都会保留。</p></div>`+foot('do-reset','恢复演示','此操作只影响演示案例')};
  if(task?.mode!=='manual')return null;
  if(session.aiExecution?.status==='running'&&['edit-result','add-issue','confirm-review','confirm-unreplied','pending','reopen'].includes(dialog.type))return {typeClass:'narrow',body:head('AI质检进行中')+uiHtml`<div class="modal-body"><p>AI正在检查本会话。完成后可记录、暂存与确认人工判断。</p></div><footer class="modal-footer"><button class="btn primary" data-act="close-modal">返回审核</button></footer>`};
  const rules=getReviewSessionRules(state,session),basis=getReviewTaskBasis(state,session),results=getSessionResults(session);
  if(dialog.type==='confirm-unreplied'){
    if(!canConfirmUnreplied(state,session))return {typeClass:'narrow',body:head('暂不能确认未回复事实')+uiHtml`<div class="modal-body"><p>需先完成可核验的本地时效计算，并核对原始回复正文和首次回复时间均为空。已有冲突的人工判断须先处理。</p></div>`+foot('close-modal','返回审核','当前未提交事实确认')};
    return {typeClass:'narrow',body:head('确认未回复事实','只确认原始两字段均为空的未回复事实。')+uiHtml`<div class="modal-body"><div class="form-error" id="form-error"></div><p>回复正文：<strong>空</strong>；首次回复时间：<strong>空</strong>。</p><p>审核人标签：<strong>${e(session.review.reviewer)}</strong></p><div class="soft-note">${icon('info',14)}本次只确认来源中的未回复事实，不形成质量通过或不通过，也不确认累计时长或其他四项的质量结论。确认后计入审核完成数，未回复单列并暂不进入质量分母。</div></div>`+foot('commit-unreplied','确认未回复事实')};
  }
  if(['edit-result','add-issue'].includes(dialog.type)){
    const ruleId=dialog.ruleId||rules[0]?.id,rule=rules.find(r=>r.id===ruleId),ai=hasSuccessfulAI(session)?session.aiResults.find(r=>r.ruleId===ruleId):null,draft=dialog.form||(Object.hasOwn(session.review.drafts,ruleId)?session.review.drafts[ruleId]:ai),policyIds=rule?.policyIds||[];
    const options=basis.policies.filter(p=>policyIds.includes(p.id)).flatMap(p=>[{key:referenceKey(p),label:`${p.title} · ${p.version} · 整份资料`},...p.sections.map(section=>({key:referenceKey(p,section),label:`${p.title} · ${p.version} · ${section.title}`}))]);
    return {typeClass:'',body:head('记录人工判断',ai?'AI原判保留，人工修改另行保存；参考资料采用本任务冻结版本。':session.aiExecution?'尚无有效AI结论；按本任务保存的原文与依据逐项检查。':'AI未执行；按本任务保存的原文与依据逐项检查。')+uiHtml`<div class="modal-body"><div class="form-error" id="form-error"></div><div class="form-row"><div class="field-group"><label class="field-label" for="edit-rule">检查项</label><select class="field" id="edit-rule" ${dialog.type==='add-issue'?'':'disabled'}>${rules.map(r=>uiHtml`<option value="${e(r.id)}" ${r.id===ruleId?'selected':''}>${e(ruleDisplayName(r))}</option>`).join('')}</select></div><div class="field-group"><label class="field-label" for="edit-verdict">人工结论</label><select class="field" id="edit-verdict">${['符合','不符合','无法判定','不适用'].map(v=>uiHtml`<option value="${v}" ${draft?.verdict===v?'selected':''}>${uiT(v)}</option>`).join('')}</select></div></div><div class="field-group"><label class="field-label" for="edit-reason">判断理由</label><textarea data-business-original class="field" id="edit-reason" rows="4" placeholder="说明原文、检查范围及判断依据">${e(draft?.reason||'')}</textarea></div>${textField('edit-evidence','证据轮次',Array.isArray(draft?.evidence)?draft.evidence.join(';'):draft?.evidence||'',uiAttributes('placeholder="如 1;3，多项用分号分隔"'))}<div class="field-group"><label class="field-label" for="edit-reference">参考依据</label><select class="field" id="edit-reference"><option value="">无额外参考资料</option>${options.map(o=>uiHtml`<option value="${e(o.key)}" ${draft?.referenceIds?.includes(o.key)?'selected':''}>${e(reviewMaterialText(o.label,task))}</option>`).join('')}</select></div>${fieldEvidenceEditor(session,draft)}<div class="soft-note">${icon('info',14)}无法判定的项目先保留为待补充；完整审核并最终确认后才进入质量统计。</div></div>`+foot('save-result','保存人工判断')};
  }
  if(dialog.type==='confirm-review'){
    const ai=hasSuccessfulAI(session),missing=results.filter(r=>!r.final&&(!ai||!r.verdict)).length,unknown=results.filter(r=>(r.final?.verdict||(ai?r.verdict:null))==='无法判定').length;
    const explanation=ai?'已修改项保留人工判断，其余未记录项采用AI初判；无法判定的项目须保留为待补充，不能确认。':session.aiExecution?'尚无完整有效AI结果，不能采用AI结论。所有应检项完成人工判断后才能确认；无法判定的项目先标记待补充。':'AI未执行，不能采用默认AI结论。所有应检项完成人工判断后才能确认；资料不足请先标记待补充。';
    return {typeClass:'narrow',body:head(ai?'确认本会话审核结果':'确认人工独立检查')+uiHtml`<div class="modal-body"><div class="form-error" id="form-error"></div><p>本会话共 ${results.length} 项检查，${missing} 项尚无有效判断，${unknown} 项无法判定。</p><p>审核人标签：<strong>${e(session.review.reviewer)}</strong></p><div class="soft-note">${icon('info',14)}${e(uiT(explanation))}</div></div>`+foot('do-confirm-review','确认审核结果')};
  }
  if(dialog.type==='policy'){
    const reference=resolveReviewTaskReference(state,session,dialog.id),p=reference?.policy,section=reference?.section;
    return {typeClass:'drawer',body:head(reviewMaterialText(p?.title,task)||'任务参考资料',`${p?.id||''} · 本任务依据快照`)+uiHtml`<div class="modal-body">${nativeMaterialNotice(task)}${translationControls({kind:'session',taskId:session.taskId,sessionId:session.id})}<div class="policy-meta">${badge(p?.version||'','muted')}<span class="tiny muted">依据日期 ${e(basis.effectiveDate)}</span></div>${(p?.sections||[]).map(s=>uiHtml`<section class="policy-section ${section?.id===s.id?'selected-policy-section':''}"><h3>${e(reviewMaterialText(s.title,task))} <small>${e(s.id)}</small></h3><p>${reviewMaterialContent(s.text,task)}</p></section>`).join('')||uiLiteral('<p>未找到该任务引用的资料，请核对快照。</p>')}</div>`+foot('close-modal','返回审核','显示创建任务时绑定的版本')};
  }
  if(dialog.type==='rule'){
    const rule=rules.find(r=>r.id===dialog.id);
    return {typeClass:'drawer',body:head(ruleDisplayName(rule)||'任务检查规则',`${rule?.id||''} · ${rule?.version||''}`)+uiHtml`<div class="modal-body">${nativeMaterialNotice(task)}${translationControls({kind:'session',taskId:session.taskId,sessionId:session.id})}<dl class="detail-grid"><dt>适用范围</dt><dd>${e(reviewMaterialText(rule?.scope,task))}</dd><dt>符合标准</dt><dd>${reviewMaterialContent(rule?.passCriteria,task)}</dd><dt>不符合标准</dt><dd>${reviewMaterialContent(rule?.failCriteria,task)}</dd><dt>例外与缺失</dt><dd>${reviewMaterialContent(rule?.exceptionCriteria,task)}</dd></dl><div class="rule-policy-links">${basis.policies.filter(p=>rule?.policyIds.includes(p.id)).map(p=>uiHtml`<button class="reference-link" data-act="policy-detail" data-id="${e(referenceKey(p))}">${icon('knowledge',13)}${e(reviewMaterialText(p.title,task))} · ${e(p.version)}</button>`).join('')}</div></div>`+foot('close-modal','返回审核',`本任务依据日期 ${basis.effectiveDate}`)};
  }
  return null;
}

export function newRuleDialog(dialog,state={},catalog={}){
  const form=dialog.form||{};
  const area=(key,label)=>uiHtml`<div class="field-group"><label class="field-label" for="cat-${key}">${uiT(label)}</label><textarea data-business-original class="field" id="cat-${key}" rows="3">${e(form[key]||'')}</textarea></div>`;
  return head('新增质检规则','保存为草稿，核对后再发布。')+uiHtml`<div class="modal-body"><div class="form-error" id="form-error">${e(uiError(dialog.error||''))}</div>${[['id','规则标识'],['title','规则名称'],['scope','适用范围'],['owner','维护人'],['effectiveAt','生效日期'],['policyIds','参考资料标识（至少一项，分号分隔）']].map(([key,label])=>textField(`cat-${key}`,label,form[key]||'',key==='effectiveAt'?'type="date"':`maxlength="${key==='id'?80:1000}"`)).join('')}${sceneAssignmentFields(state,form.sceneIds||[])}${ruleCategoryField('cat-category',form.category,catalog,form.sceneIds||[],state)}${ruleKindField('cat-ruleKind',form)}${area('passCriteria','符合标准')}${area('failCriteria','不符合标准')}${area('exceptionCriteria','例外与无法判定条件')}${area('changeNote','规则说明')}</div>`+foot('catalog-save-new-rule','保存规则草稿');
}
