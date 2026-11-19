import {createWorkspaceDecoder} from './workspace-decoder.mjs';
import {html as uiHtml,uiLiteral,uiAttributes,t as uiT,translateError as uiError} from './i18n.mjs';
import { workflowView, workflowJson } from './workflow-view.mjs';

const ACTIONS = new Set(['workflow-open', 'workflow-close', 'workflow-refresh', 'workflow-node', 'workflow-copy', 'workflow-export', 'workflow-page']);
const initial = () => ({ active: false, taskId: '', runs: [], runId: '', run: null, nodeId: '', loadingHistory: false, loadingRun: false, historyError: '', detailError: '', lastUpdated: '', lastAttemptAt: '' });

/** Read-only, token-authenticated trace viewer. Closing invalidates every pending response. */
export function createWorkflowManager({ getToken, openModal, closeModal, onChange = () => {}, toast = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis), pollMs = 1000, download } = {}) {
  const paged=typeof globalThis.Worker==='function',decoder=paged?createWorkspaceDecoder({fetchImpl}):null;
  let state = initial(), owner = 0, selection = 0, pollTimer = null;
  const requests = new Set();
  const current = (epoch, sequence = selection) => state.active && epoch === owner && sequence === selection;
  const errorText = () => [state.historyError, state.detailError].filter(Boolean).join('；');
  const notify = () => onChange();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function clearPoll() { if (pollTimer !== null) clearTimeout(pollTimer); pollTimer = null; }
  function cancelRequests() { for (const controller of requests) controller.abort(); requests.clear(); }
  function begin() { clearPoll(); const sequence = ++selection; cancelRequests(); return sequence; }
  function stop() {
    clearPoll(); owner++; selection++; cancelRequests();
    state.active = false; state.loadingHistory = false; state.loadingRun = false;
  }
  async function request(url) {
    const token = getToken?.();
    if (!token) throw new Error('工作区身份尚未加载，请重新加载工作区后查看。');
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(url, { headers: { 'X-Workspace-Token': token,...(paged?{'X-Workspace-Sync':'records-v1'}:{}) }, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? '工作区身份已失效，请重新加载工作区。' : response.status === 404 ? '该运行记录不存在，请刷新历史运行。' : '暂时无法读取运行记录，请稍后刷新。');
      return decoder?await decoder.decode(await response.arrayBuffer()):await response.json();
    } catch (error) {
      if (/^(工作区身份|该运行记录|暂时无法读取)/.test(error?.message || '')) throw error;
      throw new Error('暂时无法读取运行记录，请检查本机服务后刷新。');
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function schedule(epoch, sequence) {
    clearPoll();
    if (!current(epoch, sequence)) return;
    // Keep discovering retries even when opened before trace creation or while viewing a terminal run.
    // Each cycle finishes its history/detail reads before the next timer is armed.
    pollTimer = setTimeout(() => { pollTimer = null; void refresh(epoch, true); }, Math.max(10, pollMs));
  }
  async function loadRun(epoch, sequence, showLoading = true) {
    if (!current(epoch, sequence) || !state.runId) return false;
    const runId = state.runId;
    if (showLoading) { state.loadingRun = true; notify(); }
    state.lastAttemptAt = new Date().toISOString();
    try {
      const value = await request(`/api/workflow/runs/${encodeURIComponent(runId)}${paged?'?summary=1&offset='+(state.offset||0):''}`);
      if (!current(epoch, sequence)) return false;
      if (!value || value.id !== runId || value.taskId !== state.taskId || !Array.isArray(value.nodes)) throw new Error('运行记录与当前任务不匹配，请刷新后重试。');
      const previousNode=state.run?.nodes.find(n=>n.id===state.nodeId);
      const changed = !same(state.run, value) || Boolean(state.detailError);
      state.run = value; state.detailError = ''; state.lastUpdated = new Date().toISOString();
      if (!value.nodes.some(node => node.id === state.nodeId)) state.nodeId = (value.nodes.find(node => ['running', 'failed'].includes(node.status)) || value.nodes[0])?.id || '';
      if(paged&&state.nodeId){const node=value.nodes.find(n=>n.id===state.nodeId);if(previousNode&&!previousNode.snapshotDeferred&&previousNode.id===node.id&&previousNode.status===node.status&&previousNode.completedAt===node.completedAt)Object.assign(node,previousNode);else await loadNode(epoch,sequence);}
      return changed;
    } catch (error) {
      if (!current(epoch, sequence)) return false;
      const changed = state.detailError !== error.message; state.detailError = error.message; return changed;
    } finally {
      if (current(epoch, sequence)) state.loadingRun = false;
    }
  }
  async function loadNode(epoch=owner,sequence=selection){
    const runId=state.runId,nodeId=state.nodeId;if(!paged||!nodeId)return;
    const node=await request(`/api/workflow/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}`);
    if(!current(epoch,sequence)||state.nodeId!==nodeId||state.runId!==runId)return;
    if(!node||node.id!==nodeId)throw new Error('运行节点与当前选择不匹配。');state.run.nodes=state.run.nodes.map(n=>n.id===nodeId?node:n);
  }
  async function selectRun(runId, epoch = owner) {
    if (!state.active || epoch !== owner || !state.runs.some(run => run.id === runId)) return;
    const changed = runId !== state.runId, sequence = begin();
    state.loadingHistory = false;
    state.runId = runId; state.detailError = '';
    if (changed) { state.offset=0;state.run = null; state.nodeId = ''; state.lastUpdated = ''; }
    try { await loadRun(epoch, sequence); }
    finally { if (current(epoch, sequence)) { notify(); schedule(epoch, sequence); } }
  }
  async function refresh(epoch = owner, background = false) {
    if (!state.active || epoch !== owner) return;
    const sequence = begin(); let changed = !background;
    state.loadingHistory = !background; state.loadingRun = false; state.lastAttemptAt = new Date().toISOString();
    if (!background) { state.historyError = ''; notify(); }
    try {
      const value = await request(`/api/workflow/runs?taskId=${encodeURIComponent(state.taskId)}${paged?'&compact=1':''}`);
      if (!current(epoch, sequence)) return;
      if (!Array.isArray(value?.runs) || value.runs.some(run => !run || typeof run.id !== 'string' || (run.taskId && run.taskId !== state.taskId))) throw new Error('运行历史与当前任务不匹配，请刷新后重试。');
      // Follow new runs only when the user was viewing the previous latest run.
      const followedLatest = !state.runId || state.runId === state.runs[0]?.id;
      changed = changed || !same(state.runs, value.runs) || Boolean(state.historyError);
      state.runs = value.runs; state.historyError = '';
      const selected = (followedLatest ? state.runs[0] : state.runs.find(run => run.id === state.runId)) || state.runs[0];
      if (selected) {
        const selectionChanged = selected.id !== state.runId;
        if (selectionChanged) { state.offset=0;state.runId = selected.id; state.run = null; state.nodeId = ''; state.lastUpdated = ''; changed = true; }
        if (!background || selectionChanged || !state.run || state.run.status === 'running' || state.detailError) {
          const detailChanged = await loadRun(epoch, sequence, !background || selectionChanged);
          changed = detailChanged || changed;
        }
      } else {
        changed = changed || Boolean(state.runId || state.run);
        state.runId = ''; state.run = null; state.nodeId = ''; state.lastUpdated = new Date().toISOString();
      }
    } catch (error) {
      if (current(epoch, sequence)) {
        changed = changed || state.historyError !== error.message; state.historyError = error.message;
        // A failed list read must not hide progress still available from the selected run endpoint.
        if (background && state.run?.status === 'running') {
          const detailChanged = await loadRun(epoch, sequence, false); changed = detailChanged || changed;
        }
      }
    } finally {
      if (current(epoch, sequence)) { state.loadingHistory = false; if (changed) notify(); schedule(epoch, sequence); }
    }
  }
  async function open(taskId) {
    stop(); state = { ...initial(), active: true, taskId: String(taskId || '') };
    const epoch = owner;
    openModal?.({ type: 'workflow', taskId: state.taskId });
    await refresh(epoch);
  }
  async function exportRun() {
    if (!state.run) return;
    const full=paged?await request(`/api/workflow/runs/${encodeURIComponent(state.run.id)}?export=1`):state.run;
    const blob = new Blob([workflowJson(full)], { type: 'application/json;charset=utf-8' });
    const filename = `运行记录-${String(state.run.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    if (download) { download(blob, filename); return; }
    if (typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function handleAction(act, element) {
    if (!ACTIONS.has(act)) return false;
    if (act === 'workflow-open') { await open(element?.dataset?.id); return true; }
    if (!state.active) return false;
    if (act === 'workflow-close') { stop(); closeModal?.(); }
    else if (act === 'workflow-refresh') await refresh();
    else if(act==='workflow-page'){state.offset=Number(element.dataset.offset||0);state.nodeId='';const sequence=begin();await loadRun(owner,sequence);notify();schedule(owner,sequence);}
    else if (act === 'workflow-node') {
      if (state.run?.nodes.some(node => node.id === element?.dataset?.id)) { state.nodeId = element.dataset.id;await loadNode(); notify(); }
    } else if (act === 'workflow-export') await exportRun();
    else if (act === 'workflow-copy') {
      const node = state.run?.nodes.find(node => node.id === state.nodeId), part = element?.dataset?.part;
      if (node && ['input', 'output'].includes(part) && node[part] !== undefined && node[part] !== null) {
        try { await globalThis.navigator.clipboard.writeText(workflowJson(node[part])); toast('节点快照已复制'); }
        catch { toast('可选中快照文本后复制。', true); }
      }
    }
    return true;
  }
  function handleChange(event) {
    if (!state.active || event?.target?.id !== 'workflow-run') return false;
    void selectRun(event.target.value); return true;
  }
  return { open, render: () => workflowView({ ...state, error: errorText() }), handleAction, handleChange, stop, getState: () => structuredClone({ ...state, error: errorText() }) };
}
