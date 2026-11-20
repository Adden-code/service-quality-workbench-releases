import {normalizeEcReportMetadata} from './ec-report-metadata.mjs';
import {d as businessText,businessContent,translationControls} from './content-translation-ui.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import { parseEcommerceFile } from './ecommerce-input.mjs';
import {createEcommerceTemplate,ECOMMERCE_RULE_DESCRIPTIONS,BUILTIN_ECOMMERCE_RULE_DESCRIPTIONS} from './ecommerce-template.mjs';
import {creationSteps,executionSettingsFields} from './task-workbench.mjs';
import {DEFAULT_EXECUTION_SETTINGS,normalizeExecutionSettings} from './execution-settings.mjs';
import { EC_HEADERS, EC_RULE_IDS } from './ecommerce-schema.mjs';
import { e, icon, badge } from './ui.mjs';
import {ruleSetSummary} from './rule-set-ui.mjs';
import {triagePolicyFields,readTriagePolicy} from './review-routing-ui.mjs';
import {sceneRuntimeForm,readSceneRuntime} from './scene-configuration-ui.mjs';
import {importFlowView} from './import-flow-ui.mjs';

const THRESHOLD = 24;
const TEMPLATE_NAME = '电商评论_业务系统导出23列模板.xlsx';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACTIONS = new Set(['ec-open','ec-template-download','ec-next','ec-back','ec-confirm','ec-preview','ec-create','ec-create-start']);
const TEST_RULES=ECOMMERCE_RULE_DESCRIPTIONS;
export const ecommerceVersionKey=record=>record.ruleSetId?`ruleset:${record.ruleSetId}@${record.version}`:record.version;
const selectedVersion=d=>(d.versions||[]).find(record=>ecommerceVersionKey(record)===d.basisVersion);
const usesRuleSet=d=>Boolean(selectedVersion(d)?.ruleSetId);
const usable = d => Boolean(d.file && d.parsed?.valid && d.parsed.sessions?.length);
const thresholdMatches = d => Boolean(d.parsed?.sessions?.length && d.parsed.sessions.every(row=>row.ecommerce?.thresholdHours===d.thresholdHours));
const labelsValid = d => typeof d.name === 'string' && Boolean(d.name.trim()) && typeof d.reviewer === 'string' && Boolean(d.reviewer.trim());
const createDisabled = d => !usable(d) || (!usesRuleSet(d)&&!thresholdMatches(d)) || !labelsValid(d) || !selectedVersion(d) || Boolean(d.settingsError||(!usesRuleSet(d)&&d.thresholdError)) || Boolean(d.loading || d.expectedCreated);
const field = (id, label, value, max, disabled) => uiHtml`<div class="field-group"><label class="field-label" for="${id}">${e(uiT(label))}（必填）</label><input class="field" id="${id}" required aria-required="true" aria-describedby="ec-required-hint" value="${e(value)}" maxlength="${max}" ${disabled ? 'disabled' : ''}></div>`;
const textCell = value => uiHtml`<td style="white-space:pre-wrap;min-width:160px;max-width:320px;overflow-wrap:anywhere">${e(value || '—')}</td>`;

function requiredHint(d){return !d.name?.trim()?'请填写任务名称，才能继续。':!d.reviewer?.trim()?'请填写审核人标签，才能继续。':!usable(d)?'请先上传并核对有效的电商评论工作表。':'';}
function sheetSelection(d,frozen){
  const names=d.availableSheetNames??d.parsed?.availableSheetNames??[];
  if(names.length<2)return '';
  return uiHtml`<div class="field-group"><label class="field-label" for="ec-sheet">来源工作表</label><select class="field" id="ec-sheet" ${frozen?'disabled':''}><option value="">请选择工作表</option>${names.map(name=>uiHtml`<option value="${e(name)}" ${name===d.selectedSheet?'selected':''}>${e(name)}</option>`).join('')}</select><p class="hint">检测到多个符合格式的工作表；每次任务仅导入所选工作表。</p></div>`;
}

function preview(d) {
  if (!d.parsed?.valid) return '';
  const sessions = d.parsed.sessions;
  const record = sessions[0]?.ecommerce;
  return uiHtml`<section class="import-preview" aria-label="电商评论导入预览"><div class="file-result">${icon('file', 22)}<div><strong>${e(d.fileName)}</strong><small>${e(record.sheet)} · ${sessions.length}条评论 · 完整保留原始输入与原文件</small><small>工作表序号 ${e(d.parsed.selectedSheetIndex)} · 扩展列 ${e(record.extensions?.headers.length??0)}</small></div>${badge('预检通过', 'success')}</div>
    <h3 class="field-label">前5条评论预览</h3><div class="table-wrap"><table><thead><tr><th>源行</th><th>评论内容</th><th>实际回复</th><th>管理员</th><th>站点</th></tr></thead><tbody>${sessions.slice(0, 5).map(session => {
      const source = session.ecommerce, raw = source.raw;
      return uiHtml`<tr><td>${e(source.sheet)} · 第${e(source.row)}行</td>${textCell(raw[8])}${textCell(raw[9])}${textCell(raw[11])}<td>${e(raw[3]||uiT('未提供'))}</td></tr>`;
    }).join('')}</tbody></table></div>
    ${d.parsed.warnings?.length ? uiHtml`<div class="soft-note warning"><div><strong>待核对提示</strong><ul>${d.parsed.warnings.map(warning => uiHtml`<li>${e(uiT(warning))}</li>`).join('')}</ul></div></div>` : ''}
    ${record.schemaVersion===6?'':uiHtml`<details class="input-transcript original-source"><summary>核对来源工作表第2行原标准（仅保留原文）</summary><div class="table-wrap"><table><thead><tr><th>原列名</th><th>原标准</th></tr></thead><tbody>${[...(record?.standards||[]),...(record?.extensions?.standards||[])].map((value,index)=>value.trim()?uiHtml`<tr>${textCell(index<22?record.headers[index]:record.extensions.headers[index-22])}${textCell(value)}</tr>`:'').join('')}</tbody></table></div></details>`}${record.sourceColumns?uiHtml`<p class="hint">核心字段已按表头定位；源物理列号随任务冻结，中英文导出的源列映射表可追溯原位置。</p>`:''}</section>`;
}

/** Standalone import UI. Persistence and model execution remain with the caller. */
export function createEcommerceManager(ctx) {
  const current = () => ctx.getDialog();
  const render = () => ctx.renderDialog();
  function feedback(d, message) {
    d.error = String(message || '操作未完成，请重试。');
    if (current() !== d) return;
    const slot = typeof document === 'undefined' ? null : document.getElementById('ec-error');
    if (slot) { slot.textContent = uiError(d.error); ctx.renderDialog(false); }
    else render();
  }
  function syncCreate(d) {
    if (typeof document === 'undefined' || current() !== d) return;
    for(const button of document.querySelectorAll('#overlay-root [data-act="ec-create"],#overlay-root [data-act="ec-create-start"]'))button.disabled=createDisabled(d);
    const next=document.querySelector('#overlay-root [data-act="ec-next"]');if(next)next.disabled=!usable(d)||!labelsValid(d)||Boolean(d.loading)||(d.requirePreviewConfirmation&&!d.previewConfirmed);
    const slot = document.getElementById('ec-error');
    if (slot) slot.textContent = uiError(d.error || '');
    const hint=document.getElementById('ec-required-hint');if(hint)hint.textContent=uiT(requiredHint(d));
  }
  function reconcile() {
    const d = current();
    if (d?.type !== 'ecommerce-import' || !d.expectedCreated) return 'none';
    const status = ctx.reconcileCreated(d);
    if (status === 'not_saved') { d.expectedCreated = null; d.error = ''; if (current() === d) render(); }
    else if (status !== 'saved') feedback(d, status === 'conflict'
      ? '本次任务保存存在冲突，请先恢复工作区并核对已保存内容；当前输入保留，暂不重复创建。'
      : '本次任务保存结果尚未确认，请先重试保存或重新加载工作区；当前输入保留，暂不重复创建。');
    return status;
  }
  function recoveryBlocked(d) {
    if (!d.expectedCreated) return false;
    const status = reconcile();
    return status !== 'not_saved';
  }
  function invalidate(d) {
    d.parseSequence = (d.parseSequence || 0) + 1;
    delete d.conversion;delete d.reviewedMapping;d.file = null; d.parsed = null; d.previewConfirmed=false;d.fileName = ''; d.sourceName = ''; d.source = null; d.error = '';
    return d.parseSequence;
  }
  async function inspect(d, file, {selectedSheet,availableSheetNames=[],reviewedMapping,conversion}={}) {
    const sequence = invalidate(d);
    d.file=file;d.fileName=file?.name||'';d.pendingFile=file;d.selectedSheet=selectedSheet??null;d.availableSheetNames=[...availableSheetNames];
    d.reviewedMapping=reviewedMapping;if(conversion)d.conversion=conversion;
    d.loading = true; d.busy = 'parse'; render();
    try {
      const parsed = await parseEcommerceFile(file, { thresholdHours: d.thresholdHours||THRESHOLD, selectedSheet, standardOnly:true, reviewedMapping, batchSite:d.batchSite||'' });
      if (current() !== d || d.parseSequence !== sequence) return;
      d.availableSheetNames=[...parsed.availableSheetNames];d.selectedSheet=parsed.selectedSheet;
      if (!parsed.valid) {if(parsed.availableSheetNames.length>1){d.file=file;d.fileName=file.name;d.sourceName=file.name;d.parsed=parsed;} d.error = parsed.errors.join('；') || '文件预检失败，请核对来源工作表。'; return; }
      d.file = file; d.fileName = file.name; d.sourceName = file.name; d.parsed = parsed;
    } catch (error) {
      if (current() === d && d.parseSequence === sequence) d.error = String(error?.message || '文件预检失败，请重新选择文件。');
    } finally {
      if (current() === d && d.parseSequence === sequence) { d.pendingFile=null;d.loading = false; d.busy = ''; render(); }
    }
  }
  async function action(act) {
    if (!ACTIONS.has(act)) return false;
    const d = current();
    if (d?.loading && d.type !== 'ecommerce-import') return true;
    if (d?.type === 'ecommerce-import' && (d.loading || recoveryBlocked(d))) return true;
    if (act === 'ec-open') {
      ctx.openDialog({ type: 'ecommerce-import', scene:'电商评论回复', sceneConfigurationVersion:ctx.getSceneConfig?.()?.version, step:1, executionSettings:{...DEFAULT_EXECUTION_SETTINGS},versions:ctx.getRuleVersions?.()||[],basisVersion:'', thresholdHours: THRESHOLD, name: '', reviewer: uiT('本机操作人'), requirePreviewConfirmation:true, file: null, parsed: null, fileName: '', sourceName: '', error: '', loading: false });
      return true;
    }
    if (act !== 'ec-template-download' && d?.type !== 'ecommerce-import') return false;
    try {
      if(act==='ec-template-download'){
        const bytes=await createEcommerceTemplate();ctx.download(new Blob([bytes],{type:XLSX_TYPE}),TEMPLATE_NAME);
      }else if(act==='ec-next'){
        if(!usable(d))throw new Error('请先上传并核对有效的电商评论工作表。');
        if(!labelsValid(d))throw new Error('请填写任务名称和审核人标签。');
        if(d.requirePreviewConfirmation&&!d.previewConfirmed)throw new Error('请先核对并确认抽样预览。');
        d.step=2;d.versions=ctx.getRuleVersions?.()||[];if(ctx.getSceneConfig?.())d.basisVersion=ecommerceVersionKey(d.versions[0]);d.error='';render();
      }else if(act==='ec-back'){d.step=1;d.error='';render();
      }else if(act==='ec-confirm'){
        if(!d.rulesConfirmed)throw new Error('请先对照原标准并勾选确认本次业务口径。');
        if(!usable(d)||!labelsValid(d))throw new Error('请先核对上传文件并填写任务信息。');
        d.loading=true;d.busy='confirm';render();await ctx.confirmRules({owner:d.reviewer,file:d.file,parsed:d.parsed});
        d.versions=ctx.getRuleVersions?.()||[];d.error='';
      } else if (act === 'ec-preview') {
        if (!d.file) throw new Error('请先选择有效的.xlsx文件进行预览。');
        await inspect(d, d.file,{selectedSheet:d.selectedSheet,availableSheetNames:d.availableSheetNames,reviewedMapping:d.reviewedMapping,conversion:d.conversion});
      } else if (act === 'ec-create'||act==='ec-create-start') {
        d.autoStart=act==='ec-create-start';
        if(d.autoStart&&ctx.ensureModelReady&&!await ctx.ensureModelReady(d))return true;
        if (!usable(d)) throw new Error('请先选择有效文件并完成预览。');
        if(!usesRuleSet(d)&&!thresholdMatches(d))throw new Error('当前阈值与解析结果不一致，请重新核对阈值并完成文件解析后创建。');
        if (!d.name?.trim()) throw new Error('请填写任务名称。');
        if (!d.reviewer?.trim()) throw new Error('请填写本批次审核人标签。');
        if (d.name.length > 100 || d.reviewer.length > 80) throw new Error('任务名称最多100字符，审核人标签最多80字符。');
        if(!selectedVersion(d))throw new Error('请选择已确认且受支持的规则版本。');
        if(!usesRuleSet(d)&&d.thresholdError)throw new Error(d.thresholdError);
        const executionSettings=normalizeExecutionSettings(d.executionSettings);
        if(ctx.getSceneConfig?.())d.sceneRuntime=readSceneRuntime(globalThis.document.getElementById('overlay-root'),ctx.getSceneConfig(),d.sceneRuntime);
        d.reviewPolicy=readTriagePolicy(globalThis.document?.getElementById?.('overlay-root')||globalThis.document,d.reviewPolicy);
        d.loading = true; d.busy = 'create'; d.error = ''; render();
        const ecReportMetadata=d.parsed.sessions.every(session=>session.ecommerce?.systemSource)?normalizeEcReportMetadata({samplingPeriod:d.samplingPeriod??'',reportRegion:d.reportRegion??''}):undefined;
        await ctx.createTask({ecReportMetadata, file: d.file, parsed: d.parsed, name: d.name.trim(), reviewer: d.reviewer.trim(), thresholdHours: d.thresholdHours||THRESHOLD,executionSettings, basisVersion:d.basisVersion, owner: d });
      }
    } catch (error) {
      if (d?.type === 'ecommerce-import' && current() === d) feedback(d, error?.message);
      else ctx.toast(String(error?.message || '操作未完成，请重试。'), true);
    } finally {
      // inspect owns its sequence guard: an older preview must not finish a newer upload.
      if (d?.type === 'ecommerce-import' && current() === d && ['confirm', 'create'].includes(d.busy)) { d.loading = false; d.busy = ''; render(); }
    }
    return true;
  }
  function input(event) {
    const d = current(), target = event?.target, id = target?.id;
    if (d?.type !== 'ecommerce-import' || !['ec-name', 'ec-reviewer','ec-sampling-period','ec-report-region'].includes(id)) return false;
    if (d.busy === 'create' || d.busy === 'sample' || recoveryBlocked(d)) return true;
    d[{'ec-name':'name','ec-reviewer':'reviewer','ec-sampling-period':'samplingPeriod','ec-report-region':'reportRegion'}[id]] = target.value;
    d.error = ''; syncCreate(d); return true;
  }
  function change(event) {
    const d = current(), target = event?.target;
    if (d?.type !== 'ecommerce-import') return false;
    if(['triage-mode','triage-enabled','triage-threshold'].includes(target?.id)){try{d.reviewPolicy=readTriagePolicy(globalThis.document?.getElementById?.('overlay-root')||globalThis.document,d.reviewPolicy);d.error='';if(target.id==='triage-mode')render();}catch(error){d.error=error.message;feedback(d,d.error);}return true;}
    if(target?.id==='ec-batch-site'){d.batchSite=target.value.trim();const file=d.file;if(file)void inspect(d,file,{selectedSheet:d.selectedSheet,availableSheetNames:d.availableSheetNames,reviewedMapping:d.reviewedMapping,conversion:d.conversion});return true;}
    if(target?.id==='ec-threshold'){
      if(d.loading||d.expectedCreated||usesRuleSet(d))return true;
      const hours=Number(target.value);if(!Number.isFinite(hours)||hours<=0||hours>720){d.thresholdError='回复时效阈值须大于0且不超过720小时。';feedback(d,d.thresholdError);syncCreate(d);return true;}
      d.thresholdError='';
      d.thresholdHours=hours;d.rulesConfirmed=false;const file=d.file;if(file)void inspect(d,file,{selectedSheet:d.selectedSheet,availableSheetNames:d.availableSheetNames,reviewedMapping:d.reviewedMapping,conversion:d.conversion});else render();return true;
    }
    if(['ec-concurrency','ec-batch-size'].includes(target?.id)){
      d.executionSettings={...DEFAULT_EXECUTION_SETTINGS,...d.executionSettings,[target.id==='ec-concurrency'?'concurrency':'batchSize']:Number(target.value)};
      try{normalizeExecutionSettings(d.executionSettings);d.settingsError='';d.error='';}catch(error){d.settingsError=error.message;feedback(d,error.message);}
      syncCreate(d);return true;
    }
    if(target?.id==='import-preview-confirm'){d.previewConfirmed=target.checked;syncCreate(d);return true;}
    if(target?.id==='ec-confirm-rules'){d.rulesConfirmed=target.checked;d.error='';return true;}
    if(target?.id==='ec-basis-version'){if(d.loading||d.expectedCreated)return true;d.basisVersion=target.value;d.error='';render();return true;}
    if(target?.id==='ec-sheet'){
      if((d.loading&&d.busy!=='parse')||recoveryBlocked(d))return true;
      const file=d.file??d.pendingFile,names=d.availableSheetNames??[];
      if(file)void inspect(d,file,{selectedSheet:target.value||undefined,availableSheetNames:names});
      return true;
    }
    if (target?.id !== 'ec-file') return input(event);
    if ((d.loading && d.busy !== 'parse') || recoveryBlocked(d)) return true;
    void inspect(d, target.files?.[0]); return true;
  }
  function dialog(d) {
    if (d?.type !== 'ecommerce-import') return null;
    const frozen = Boolean(d.expectedCreated || (d.loading && d.busy !== 'parse'));
    const busy = Boolean(d.loading), closeDisabled = busy ? 'disabled' : '';
    const selected=selectedVersion(d),ruleSet=usesRuleSet(d),TEST_RULES=ctx.getSceneConfig?.()?BUILTIN_ECOMMERCE_RULE_DESCRIPTIONS:ECOMMERCE_RULE_DESCRIPTIONS;
    const batchSiteField=(d.parsed?.sessions?.some(s=>s.ecommerce?.systemSource&&!s.ecommerce.raw[3])||d.batchSite?uiHtml`<div class="field-group"><label class="field-label" for="ec-batch-site">未识别运营商时使用的本批站点（选填）</label><input id="ec-batch-site" class="field" maxlength="80" value="${e(d.batchSite||'')}"><p class="hint">只补充无法识别的记录；已识别站点不变。留空时统计为未提供。</p></div>`:'');
    const reportFields=d.parsed?.valid&&d.parsed?.sessions?.every(session=>session.ecommerce?.systemSource)?uiHtml`<section class="policy-section" data-ec-report-metadata><h3>批次报告信息</h3><div class="form-row"><div class="field-group"><label class="field-label" for="ec-sampling-period">抽检周期（选填）</label><input id="ec-sampling-period" class="field" maxlength="120" value="${e(d.samplingPeriod||'')}" placeholder="例如：2026-11 第一周" ${frozen?'disabled':''}><p class="hint">按业务批次填写；留空显示“未提供”，不以报告生成时间替代。</p></div>${batchSiteField}</div><div class="field-group"><label class="field-label" for="ec-report-region">报告地区（选填，手工覆盖）</label><input id="ec-report-region" class="field" maxlength="120" value="${e(d.reportRegion||'')}" ${frozen?'disabled':''}><p class="hint">填写后优先用于报告顶部；留空汇总运营商识别的国家及未识别记录的本批站点补充，无有效值时显示“未提供”。不改变逐条站点和时效计算。</p></div></section>`:'';
    const rules=uiHtml`<section class="policy-section" data-ecommerce-built-in-checks><h3>本场景内置五项检核（只读）</h3><p>本场景使用内置五项检核，无需从规则目录勾选；升级走检核口径管理。</p><ul class="task-basis-list">${TEST_RULES.map(([name],index)=>uiHtml`<li><strong>${e(uiT(name))}</strong> <span class="mono">${e(EC_RULE_IDS[index])}</span></li>`).join('')}</ul><p class="hint">管理入口：质检规则 → 场景筛选“电商评论回复” → 电商检核口径。当前支持调整时效配置，其他四项沿用所选版本的已支持口径。</p></section>${ruleSet?ruleSetSummary(selected):''}<details class="policy-section" ${d.versions?.length?'':'open'}><summary>${ruleSet?uiT('其他四项检查标准与适用范围'):uiT('五项业务口径与适用范围')}</summary><ol class="guide-list">${TEST_RULES.map(([name,detail],index)=>ruleSet&&index===0?'':uiHtml`<li><strong>${e(uiT(name))}</strong><small> ${e(EC_RULE_IDS[index])}</small><p>${e(uiT(index===0?detail.replaceAll('24小时',`${d.thresholdHours||24}小时`):detail))}</p></li>`).join('')}</ol><p class="hint">以所选场景发布的检查标准为准。历史任务保留创建时的标准；更改目录不会重算旧结果。</p></details>`;
    return uiHtml`<div class="modal-backdrop" data-backdrop><section class="modal wide import-modal ecommerce-import" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1" aria-busy="${busy}">
      <header class="modal-head"><div><h2 id="dialog-title">新建质检任务 · 电商评论回复</h2></div><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗" ${closeDisabled}>${icon('close',18)}</button></header>
      <div class="modal-body">${creationSteps(d.step===2?2:1)}<div class="form-error" id="ec-error" role="alert">${e(uiError(d.error||''))}</div>
      ${d.step!==2?importFlowView(d,{ecommerce:true,label:'电商评论回复',preview:preview(d),extra:sheetSelection(d,frozen)+reportFields}):uiHtml`<div class="file-result">${icon('file',22)}<div><strong>${e(d.fileName)}</strong><small>${d.parsed?.sessions?.length||0}条评论 · ${e(d.reviewer)}</small></div></div>${rules}<div class="field-group"><label class="field-label" for="ec-basis-version">本次规则版本</label><select class="field" id="ec-basis-version" ${ctx.getSceneConfig?.()?'disabled':''}><option value="">请选择已确认的规则版本</option>${(d.versions||[]).map(v=>uiHtml`<option value="${e(ecommerceVersionKey(v))}" ${d.basisVersion===ecommerceVersionKey(v)?'selected':''}>${e(businessText(v.title||v.version))} · ${e(v.version)}${v.ruleSetId?` · ${e(v.ruleSetId)}`:''}</option>`).join('')}</select></div>${!d.versions?.length?uiHtml`<section class="ec-rule-confirmation"><p>当前没有已确认的受支持版本，请对照上传文件第2行原标准核对以上五项口径。</p><label class="check-label"><input type="checkbox" id="ec-confirm-rules" ${d.rulesConfirmed?'checked':''}>已核对来源工作表原标准；确认本次按北京时间连续自然时间${e(d.thresholdHours||24)}小时、同一管理员至少3条批次重复及上述五项口径执行。</label><button class="btn" data-act="ec-confirm" ${busy?'disabled':''}>确认并登记本次业务规则</button></section>`:''}<details class="input-transcript" data-dialog-disclosure="ec-settings"><summary>执行设置</summary><div class="field-group"><label class="field-label" for="ec-threshold">回复时效阈值（小时）</label><input class="field" id="ec-threshold" type="number" min="0.01" max="720" step="any" value="${e(d.thresholdHours||24)}" ${busy||ruleSet?'disabled':''}></div>${executionSettingsFields(d.executionSettings,'ec')}${ctx.getSceneConfig?.()?sceneRuntimeForm(ctx.getSceneConfig(),d.sceneRuntime,d.sceneOverrideReason):triagePolicyFields(d.reviewPolicy||{version:2,mode:'rule-calibrated',enabled:true,calibrationStatus:'per-rule',rules:[]})}<p>${ruleSet?uiT('按本任务保存的时效标准计算；下方可核对本次参数。'):uiT('阈值默认24小时；修改后重新解析原文件，按本次设置覆盖时效项并随任务冻结。')}任务创建后手动开始AI执行，可暂停与继续；失败只重试未完成项，人工记录保留。</p><p>首次运行前请在工作台的模型设置中配置接口。</p></details>`}
      <div class="soft-note">${icon('info',14)}<div>评价类型由AI归类后人工核对；原表正负向标记仅作对照，全部原列完整保留。</div><p>按规则级标定策略执行：已启用达标规则的符合项且证据校验通过才可免审，每规则每批5%强制抽检，至少5条（不足5条全检）；其余判定进入人工。关闭免审时，所有初判均须人工确认。</p></div></div>
      <footer class="modal-footer"><small>${busy?uiT('正在处理…'):uiT('原文件、规则版本及审核记录保存在本机工作区')}</small><div><button class="btn" data-act="import-save-close" ${closeDisabled}>保存草稿并关闭</button><button class="btn" data-act="${d.step===2?'ec-back':'close-modal'}" ${closeDisabled}>${d.step===2?uiT('上一步'):uiT('取消')}</button>${d.step===2?uiHtml`<button class="btn" data-act="ec-create" ${createDisabled(d)?'disabled':''}>仅创建，稍后质检</button><button class="btn primary" data-act="ec-create-start" ${createDisabled(d)?'disabled':''}>创建并开始AI质检</button>`:uiHtml`<button class="btn primary" data-act="ec-next" ${!usable(d)||!labelsValid(d)||busy||(d.requirePreviewConfirmation&&!d.previewConfirmed)?'disabled':''}>下一步：检查标准与运行安排</button>`}</div></footer></section></div>`;
  }

  return { dialog, action, change, input, reconcile };
}
