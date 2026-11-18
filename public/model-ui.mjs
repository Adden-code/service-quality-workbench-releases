import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import {e,icon,badge,dateTime} from './ui.mjs';
import {hasCompletedAI} from './domain.mjs';
import {DEFAULT_MODEL_BASE_URL,DEFAULT_MODEL_ID} from './model-settings.mjs';

export function hasSuccessfulAI(session){
  return Boolean(session.expectedRuleIds)&&hasCompletedAI(session);
}

export function sessionAIStatus(session){
  if(session.aiExecution?.status==='running')return 'running';
  if(hasSuccessfulAI(session))return 'completed';
  if(session.aiExecution?.errorCode==='dependency_incomplete')return 'dependency_pending';
  return session.aiExecution?'failed':'not_run';
}

export function sessionAIStatusLabel(session){
  return {running:'AI质检进行中',completed:'AI质检已完成',dependency_pending:'依赖检查未完成',failed:'AI质检失败',not_run:'AI未执行'}[sessionAIStatus(session)];
}

export function sessionAIIndicator(session){
  const status=sessionAIStatus(session),run=session.aiExecution;
  if(status==='not_run')return '';
  const label=sessionAIStatusLabel(session);
  return uiHtml`<div class="ai-execution ${status}" role="status">${badge(label,status==='failed'?'danger':status==='completed'?'success':status==='dependency_pending'?'warning':'blue')}<span class="ai-model">${e(run.modelId||'')}</span>${status==='running'?uiLiteral('<p>正在按本任务保存的规则与资料检查，请稍候。</p>'):['failed','dependency_pending'].includes(status)?uiHtml`<p>${e(uiError(run.error||'未取得完整AI结果，可在任务详情中继续处理。'))}</p>`:uiHtml`<details class="ai-audit"><summary>执行记录</summary><dl><dt>完成时间</dt><dd>${dateTime(run.completedAt)}</dd>${[['请求编号',run.requestId],['提示词版本',run.promptVersion],['运行编号',run.runId]].filter(([,value])=>value).map(([label,value])=>uiHtml`<dt>${uiT(label)}</dt><dd>${e(uiT(value))}</dd>`).join('')}</dl></details>`}</div>`;
}

export function modelConnectionBadge(dialog={}){
  if(dialog.testing)return badge('正在连接模型服务…','blue');
  return badge(dialog.config?.connectionTested?'当前连接已测试通过':'当前连接尚未测试',dialog.config?.connectionTested?'success':'warning');
}

export function modelDialog(dialog={}){
  const config=dialog.config||{},loading=Boolean(dialog.loading);
  const model=dialog.model??config.model??DEFAULT_MODEL_ID,authMode=config.authMode||'bearer',disabled=loading?'disabled':'';
  const body=uiHtml`<header class="modal-head"><div><h2 id="dialog-title">模型设置</h2><p>配置MaaS或其他OpenAI兼容模型服务。</p></div><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header>
    <div class="modal-body">${dialog.returnDialog?uiHtml`<p class="soft-note">返回时会保留原文件、核对内容和修改原因；不会自动调用模型。</p>`:''}<div class="model-config-status">${badge(authMode==='none'?'无需密钥':config.keyConfigured?'本机密钥已保存':'尚未配置密钥',authMode==='none'||config.keyConfigured?'success':'muted')} <span id="model-connection-status" role="status" aria-live="polite">${modelConnectionBadge(dialog)}</span></div><p class="hint">保存设置后请测试连接；测试成功才能开始AI质检。人工审核不受影响。</p>
    <div class="field-group"><label class="field-label" for="model-base-url">接口地址</label><input class="field model-endpoint" id="model-base-url" value="${e(config.baseUrl||DEFAULT_MODEL_BASE_URL)}" type="url" autocomplete="off" spellcheck="false" ${disabled}><p class="hint">填写基础地址，例如 https://maas.example.com/v1；更换地址后请配置该接口的密钥。</p></div>
    <div class="field-group"><label class="field-label" for="model-id">模型名称 / ID</label><input class="field" id="model-id" value="${e(model)}" maxlength="320" autocomplete="off" spellcheck="false" ${disabled}></div>
    <div class="field-group"><label class="field-label" for="model-auth-mode">鉴权方式</label><select class="field" id="model-auth-mode" ${disabled}><option value="bearer" ${authMode==='bearer'?'selected':''}>Bearer API Key</option><option value="none" ${authMode==='none'?'selected':''}>无需密钥</option></select></div>
    <div class="field-group" id="model-key-group" ${authMode==='none'?'hidden':''}><label class="field-label" for="model-api-key">API Key</label><input class="field" id="model-api-key" type="password" value="" autocomplete="off" spellcheck="false" ${loading||authMode==='none'?'disabled':''}><p class="hint">留空保留现有密钥；只保存在本机后台</p></div>
    <details class="model-advanced"><summary>请求参数</summary><div class="model-option-grid"><div class="field-group"><label class="field-label" for="model-timeout">单次超时（秒）</label><input class="field" id="model-timeout" type="number" min="1" max="290" step="1" value="${e((config.timeoutMs??120000)/1000)}" ${disabled}></div><div class="field-group"><label class="field-label" for="model-reasoning-effort">推理档位</label><select class="field" id="model-reasoning-effort" ${disabled}>${[['','接口默认'],['low','低 · low'],['high','高 · high'],['max','最高 · max']].map(([value,label])=>uiHtml`<option value="${value}" ${(config.reasoningEffort||'')===value?'selected':''}>${uiT(label)}</option>`).join('')}</select></div></div><div class="field-group"><label class="field-label" for="model-max-tokens">单次最大输出Token</label><input class="field" id="model-max-tokens" type="number" min="16" max="65536" step="1" value="${e(config.maxTokens??'')}" placeholder="采用各检查节点默认值" ${disabled}></div><div class="model-option-grid"><label class="field-group"><span class="field-label">模型部署版本（可选）</span><input class="field" id="model-deployment-revision" maxlength="160" value="${e(config.deploymentRevision||'')}" ${disabled}></label><label class="field-group"><span class="field-label">推理配置版本（可选）</span><input class="field" id="model-reasoning-version" maxlength="160" value="${e(config.reasoningConfigVersion||'')}" ${disabled}></label></div><p class="hint">同名模型升级或推理配置变化时更新版本；变化后须重测连接并重新标定。只作本机指纹，不作为额外接口参数发送。</p><p class="hint">推理档位需模型接口支持；“接口默认”不发送该参数。设置随每次运行保存，继续任务沿用原设置。</p></details>
    <div class="form-error" id="model-error" role="alert">${e(uiError(dialog.error||''))}</div><div class="model-feedback" id="model-feedback" role="status">${e(uiT(dialog.message||''))}</div></div>
    <footer class="modal-footer"><small>${loading?uiT('正在处理…'):uiT('密钥由本机后台加密保存')}</small><div>${dialog.returnDialog?uiHtml`<button class="btn" data-act="close-modal" ${disabled}>${dialog.returnDialog.type==='conversation-cleaning'?uiT('返回解析核对'):uiT('返回导入')}</button>`:''}<button class="btn" data-act="model-test" ${disabled}>测试连接</button><button class="btn primary" data-act="model-save" ${disabled}>保存设置</button></div></footer>`;
  return {body,typeClass:'model-settings'};
}

export function modelRunDetails(run,taskId=''){
 const config=run?.modelConfig;
 if(!config)return '';
 const fields=[['接口地址',config.baseUrl],['模型名称',config.model],['鉴权方式',config.authMode==='none'?'无需密钥':'Bearer'],['单次超时',`${config.timeoutMs/1000} 秒`],['推理档位',config.reasoningEffort||'接口默认'],['最大输出',config.maxTokens??'节点默认'],['配置指纹',run.modelConfigFingerprint]];
 return uiHtml`<details class="task-model-settings" data-disclosure="${e(taskId)}-model"><summary>本次模型配置</summary><dl class="detail-grid">${fields.map(([label,value])=>uiHtml`<dt>${e(uiT(label))}</dt><dd>${e(['鉴权方式','单次超时','推理档位','最大输出'].includes(label)?uiT(value??'未记录'):value??uiT('未记录'))}</dd>`).join('')}</dl></details>`;
}
