import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import { e, icon, badge } from './ui.mjs';
import {getLocale} from './i18n.mjs';

const NODE_LABELS = { source: '输入核对', basis: '规则与版本', deterministic: '结构计算', model: '模型语义', validation: '结构与证据校验', merge: '合并结论', persist: '保存结果' };
const NODE_STATUS = { pending: ['待执行', 'muted'], running: ['执行中', 'blue'], completed: ['已完成', 'success'], failed: ['执行失败', 'danger'], skipped: ['已跳过', 'muted'] };
const RUN_STATUS = { pending: ['待执行', 'muted'], running: ['运行中', 'blue'], completed: ['已完成', 'success'], partial: ['部分完成', 'warning'], failed: ['运行失败', 'danger'], interrupted: ['已中断', 'warning'] };

export const workflowJson = value => value === undefined ? '' : JSON.stringify(value, null, 2);
export const workflowNodeLabel = node => NODE_LABELS[node.id] || node.label || node.id || '未命名节点';
export function workflowTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(getLocale()==='en'?'en-GB':'zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(parsed);
}
function duration(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} 秒`;
}
const statusBadge = (status, run = false) => badge(...((run ? RUN_STATUS : NODE_STATUS)[status] || ['状态未知', 'muted']));
const engineLabel = engine => ({ 'spring-ai': 'Spring AI', native: '原生模型客户端', 'native-node': '原生模型客户端' }[engine] || engine || '未记录执行引擎');
const errorLabel = error => typeof error === 'string' ? error : error?.reason || error?.message || workflowJson(error);
function runLabel(run, index) { return uiT('第{0}次 · {1} · {2}',{0:index+1,1:workflowTime(run.startedAt),2:uiT((RUN_STATUS[run.status]||['状态未知'])[0])}); }
function snapshot(node, part, title) {
  const value = node[part], present = value !== undefined && value !== null;
  return uiHtml`<details class="workflow-snapshot" data-workflow-snapshot="${e(node.id)}:${part}"><summary>${uiT(title)} JSON</summary><div class="workflow-snapshot-head"><h4>${uiT(title)}</h4><button class="text-btn" data-act="workflow-copy" data-part="${part}" ${present ? '' : 'disabled'}>复制</button></div>${present ? uiHtml`<pre class="workflow-json" tabindex="0" aria-label="${e(uiT(workflowNodeLabel(node)))}${uiT(title)}">${e(workflowJson(value))}</pre>` : uiHtml`<div class="workflow-snapshot-empty">${node.status === 'skipped' ? uiT('该节点已跳过，未产生此快照。') : uiT(`尚未产生${uiT(title)}。`)}</div>`}</details>`;
}
function nodeDetail(node) {
  if (!node) return uiLiteral('<div class="workflow-blank"><h3>暂无节点记录</h3><p>仅展示本次执行实际保存的节点。</p></div>');
  return uiHtml`<section class="workflow-detail" aria-label="节点快照"><div class="workflow-detail-head"><div><span class="workflow-eyebrow">节点详情</span><h3>${e(uiT(workflowNodeLabel(node)))}</h3></div>${statusBadge(node.status)}</div><dl class="workflow-times"><div><dt>开始</dt><dd>${e(workflowTime(node.startedAt))}</dd></div><div><dt>结束</dt><dd>${e(workflowTime(node.completedAt))}</dd></div><div><dt>耗时</dt><dd>${e(uiT(duration(node.durationMs)))}</dd></div></dl>${node.error ? uiHtml`<div class="form-error" role="alert">${e(uiError(errorLabel(node.error)))}</div>` : ''}${snapshot(node, 'input', '输入快照')}${snapshot(node, 'output', '输出快照')}</section>`;
}

/** All server-provided values, including business JSON, remain escaped text. */
export function workflowView(state) {
  if (!state?.active) return '';
  const runs = state.runs || [], current = state.run, nodes = current?.nodes || [];
  const selected = nodes.find(node => node.id === state.nodeId) || nodes[0];
  const done = nodes.filter(node => node.status === 'completed').length;
  const loading = Boolean(state.loadingHistory || state.loadingRun);
  const error = state.error || [state.historyError, state.detailError].filter(Boolean).join('；');
  return uiHtml`<div class="modal-backdrop" data-backdrop><section class="modal workflow-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-title" tabindex="-1">
    <div class="modal-head"><div><h2 id="workflow-title">运行过程</h2><p class="workflow-task-id">${e(state.taskId)}</p></div><button class="icon-btn" data-act="workflow-close" aria-label="关闭运行过程">${icon('close', 19)}</button></div>
    <div class="modal-body workflow-body">
      <div class="workflow-toolbar"><div class="workflow-history"><label class="field-label" for="workflow-run">历史运行</label><select class="field" id="workflow-run" ${runs.length ? '' : 'disabled'}>${runs.length ? runs.map((run, index) => uiHtml`<option value="${e(run.id)}" ${state.runId === run.id ? 'selected' : ''}>${e(uiT(runLabel(run, runs.length - index - 1)))}</option>`).join('') : uiHtml`<option>${state.loadingHistory ? uiT('正在读取…') : state.historyError ? uiT('历史未能读取') : uiT('暂无运行记录')}</option>`}</select></div><button class="btn small" data-act="workflow-refresh" ${loading ? 'disabled' : ''}>${icon('reset', 14)}刷新</button></div>
      <div class="workflow-update" role="status">${loading ? uiLiteral('<span>正在读取运行记录…</span>') : current?.status === 'running' ? uiLiteral('<span class="workflow-live"><i></i>运行中，自动更新</span>') : '<span></span>'}<time>${state.lastUpdated ? uiT(`上次更新 ${e(workflowTime(state.lastUpdated))}`) : ''}</time></div>
      ${error ? uiHtml`<div class="form-error workflow-error" role="alert">${e(uiError(error))}${state.lastAttemptAt ? uiHtml`<small>最近读取 ${e(workflowTime(state.lastAttemptAt))}</small>` : ''}</div>` : ''}
      ${current ? uiHtml`<div class="workflow-run-summary"><div>${statusBadge(current.status, true)}<span>${e(uiT(engineLabel(current.engine)))}</span><span>${current.completedNodes??done} / ${current.totalNodes??nodes.length} 节点完成</span></div><small class="mono">${e(current.id)}</small></div>${current.error ? uiHtml`<div class="form-error" role="alert">${e(uiError(errorLabel(current.error)))}</div>` : ''}${current.metadataOnly?uiHtml`<div class="toolbar-group">${current.offset?uiHtml`<button class="btn small" data-act="workflow-page" data-offset="${Math.max(0,current.offset-50)}">上一页</button>`:''}<span>${current.offset+1}–${current.offset+nodes.length} / ${current.totalNodes}</span>${current.offset+nodes.length<current.totalNodes?uiHtml`<button class="btn small" data-act="workflow-page" data-offset="${current.offset+nodes.length}">下一页</button>`:''}</div>`:''}<div class="workflow-layout"><nav class="workflow-timeline" aria-label="执行节点">${nodes.map((node, index) => uiHtml`<button class="workflow-node ${selected?.id === node.id ? 'active' : ''}" data-act="workflow-node" data-id="${e(node.id)}" aria-pressed="${selected?.id === node.id}"><span class="workflow-step-number">${node.status === 'completed' ? icon('check', 13) : index + 1}</span><span class="workflow-step-text"><strong>${e(uiT(workflowNodeLabel(node)))}</strong><span>${statusBadge(node.status)}<small>${e(uiT(duration(node.durationMs)))}</small></span></span></button>`).join('')}</nav>${nodeDetail(selected)}</div>` : loading ? uiLiteral('<div class="workflow-blank"><p>正在读取服务端保存的运行记录…</p></div>') : runs.length ? uiLiteral('<div class="workflow-blank"><h3>运行记录未能读取</h3><p>可点击刷新重试。</p></div>') : state.historyError ? uiLiteral('<div class="workflow-blank"><h3>运行历史未能读取</h3><p>请检查本机服务后刷新；无法据此判断是否有历史记录。</p></div>') : uiHtml`<div class="workflow-blank">${icon('folder', 30)}<h3>暂无运行记录</h3><p>此任务尚无可回查的节点记录；历史执行不会补造追踪记录。</p></div>`}
    </div><div class="modal-footer workflow-footer"><div><button class="btn" data-act="workflow-export" ${current ? '' : 'disabled'}>${icon('export', 14)}下载运行 JSON</button><small>可能包含会话原文，分享前请核对接收人。</small></div><button class="btn" data-act="workflow-close">关闭</button></div>
  </section></div>`;
}
