import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowManager } from '../public/workflow-manager.mjs';
import { workflowView } from '../public/workflow-view.mjs';
import { taskTable } from '../public/views.mjs';

const nodeIds = ['source', 'basis', 'deterministic', 'model', 'validation', 'merge', 'persist'];
const run = (id = 'r1', taskId = 't1', status = 'completed') => ({
  id, taskId, kind: 'ecommerce', engine: 'spring-ai', status,
  startedAt: '2026-10-30T08:00:00.000Z', completedAt: status === 'running' ? null : '2026-10-30T08:00:01.000Z',
  nodes: nodeIds.map((id, i) => ({ id, label: id, status: status === 'running' && i > 2 ? 'pending' : 'completed', durationMs: 10, input: { record: i }, output: { result: i } })),
  summary: { saved: 2 },
});
const reply = value => ({ ok: true, status: 200, json: async () => value });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 80; i++) { if (predicate()) return; await delay(5); } assert.fail('condition did not become true'); }
function manager(fetchImpl, extras = {}) {
  return createWorkflowManager({ getToken: () => 'workspace-token', openModal() {}, closeModal() {}, fetchImpl, ...extras });
}

test('workflow view escapes record text, IDs, labels and errors without rendering executable markup', () => {
  const attack = '\"><script>alert(1)</script><img src=x onerror=alert(1)>';
  const current = run(); current.nodes[0].label = attack; current.nodes[0].input = { text: attack }; current.nodes[0].error = attack;
  const html = workflowView({ active: true, taskId: attack, runs: [current], runId: current.id, run: current, nodeId: 'source', error: attack });
  assert.doesNotMatch(html, /<script|<img|<[^>]+ onerror=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;/);
  assert.match(html, /workflow-copy/);
});

test('history without records never claims success or fabricates nodes', async () => {
  const view = manager(async () => reply({ runs: [] }));
  await view.open('t1');
  assert.match(view.render(), /暂无运行记录/);
  assert.match(view.render(), /不会补造/);
  assert.doesNotMatch(view.render(), /已完成|workflow-node/);
  view.stop();
});

test('manual tasks expose trace action while demo tasks do not', () => {
  const task = { id: 't1', name: '测试任务', mode: 'manual', status: '待审核' };
  const html = taskTable({ tasks: [task], sessions: [] }, [task]);
  assert.match(html, /data-act="workflow-open" data-id="t1"/);
  assert.doesNotMatch(taskTable({ tasks: [{ ...task, mode: 'demo' }], sessions: [] }, [{ ...task, mode: 'demo' }]), /workflow-open/);
});

test('all trace reads carry workspace authentication and selected node exposes separate snapshots', async () => {
  const calls = [], current = run();
  const view = manager(async (url, options) => { calls.push({ url, options }); return reply(url.includes('?') ? { runs: [current] } : current); });
  await view.open('t1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/workflow/runs?taskId=t1');
  assert.ok(calls.every(call => call.options.headers['X-Workspace-Token'] === 'workspace-token'));
  assert.match(view.render(), /Spring AI/);
  assert.equal(await view.handleAction('workflow-node', { dataset: { id: 'model' } }), true);
  assert.equal(view.getState().nodeId, 'model');
  assert.match(view.render(), /输入快照/);
  assert.match(view.render(), /输出快照/);
  view.stop();
});

test('late task history response cannot replace newly opened task', async () => {
  const old = deferred(), current = run('new-run', 'new-task');
  const view = manager(async url => url.includes('taskId=old-task') ? old.promise : reply(url.includes('?') ? { runs: [current] } : current));
  const oldOpen = view.open('old-task');
  await view.open('new-task');
  old.resolve(reply({ runs: [run('old-run', 'old-task')] })); await oldOpen;
  assert.equal(view.getState().taskId, 'new-task');
  assert.equal(view.getState().run.id, 'new-run');
  assert.doesNotMatch(view.render(), /old-run/);
  view.stop();
});

test('late selected-run response cannot overwrite a newer selection', async () => {
  const slow = deferred(), first = run('r1'), second = run('r2');
  const view = manager(async url => url.includes('?') ? reply({ runs: [first, second] }) : url.endsWith('/r1') ? slow.promise : reply(second));
  const opening = view.open('t1');
  await until(() => view.getState().runId === 'r1');
  view.handleChange({ target: { id: 'workflow-run', value: 'r2' } });
  await until(() => view.getState().run?.id === 'r2');
  slow.resolve(reply(first)); await opening;
  assert.equal(view.getState().run.id, 'r2');
  view.stop();
});

test('closing invalidates in-flight requests and prevents polling or repaint', async () => {
  const slow = deferred(); let changed = 0;
  const view = manager(async () => slow.promise, { onChange: () => changed++ });
  const opening = view.open('t1'); view.stop(); const closedChanges = changed;
  slow.resolve(reply({ runs: [run()] })); await opening;
  assert.equal(changed, closedChanges);
  assert.equal(view.getState().active, false);
  assert.equal(view.render(), '');
});

test('running trace polls until actual terminal state, preserves failure and does not claim completion', async () => {
  let detailCalls = 0;
  const current = run('r1', 't1', 'running');
  const view = manager(async url => {
    if (url.includes('?')) return reply({ runs: [current] });
    detailCalls++;
    if (detailCalls === 1) return reply(current);
    const failed = run('r1', 't1', 'failed'); failed.nodes[3].status = 'failed'; failed.nodes[3].error = '模型请求失败';
    for (const node of failed.nodes.slice(4)) node.status = 'skipped';
    return reply(failed);
  }, { pollMs: 10 });
  await view.open('t1');
  await until(() => view.getState().run?.status === 'failed');
  const finalCalls = detailCalls; await delay(35);
  assert.equal(detailCalls, finalCalls);
  assert.match(view.render(), /运行失败/);
  assert.match(view.render(), /已跳过/);
  assert.equal(view.getState().run.nodes.find(node => node.id === 'model').status, 'failed');
  view.stop();
});

test('polling error keeps last data visible with last successful update and permits retry', async () => {
  let detailCalls = 0;
  const current = run('r1', 't1', 'running');
  const view = manager(async url => {
    if (url.includes('?')) return reply({ runs: [current] });
    if (++detailCalls > 1) throw new Error('network down');
    return reply(current);
  }, { pollMs: 10 });
  await view.open('t1');
  await until(() => Boolean(view.getState().error));
  assert.equal(view.getState().run.id, 'r1');
  assert.ok(view.getState().lastUpdated);
  assert.match(view.render(), /上次更新/);
  assert.match(view.render(), /暂时无法读取/);
  view.stop();
});

test('mismatched server task or run identity is rejected before showing business data', async () => {
  const view = manager(async url => reply(url.includes('?') ? { runs: [run()] } : run('r1', 'other-task')));
  await view.open('t1');
  assert.equal(view.getState().run, null);
  assert.match(view.getState().error, /不匹配/);
  view.stop();
});

test('conversation runs preserve actual per-record node order without manufactured seven phases', () => {
  const current = run(); current.kind = 'conversation'; current.nodes = [{ id: 'model-s1', label: '会话1 · 模型语义', status: 'completed' }, { id: 'validation-s1', label: '会话1 · 证据校验', status: 'completed' }];
  const html = workflowView({ active: true, runs: [current], taskId: 't1', runId: current.id, run: current, nodeId: 'model-s1' });
  assert.ok(html.indexOf('data-id="model-s1"') < html.indexOf('data-id="validation-s1"'));
  assert.doesNotMatch(html, /data-id="deterministic"/);
});

test('unreadable history is an error rather than evidence that no history exists', async () => {
  const view = manager(async () => { throw new Error('offline'); });
  await view.open('t1');
  assert.match(view.render(), /运行历史未能读取/);
  assert.doesNotMatch(view.render(), /历史执行不会补造/);
  view.stop();
});

test('export produces the exact selected saved run as JSON with an original-content notice', async () => {
  const current = run(), exports = [];
  const view = manager(async url => reply(url.includes('?') ? { runs: [current] } : current), { download: (blob, name) => exports.push({ blob, name }) });
  await view.open('t1');
  assert.match(view.render(), /可能包含会话原文/);
  await view.handleAction('workflow-export');
  assert.equal(exports.length, 1);
  assert.equal(exports[0].blob.type, 'application/json;charset=utf-8');
  assert.deepEqual(JSON.parse(await exports[0].blob.text()), current);
  assert.match(exports[0].name, /r1\.json$/);
  view.stop();
});

test('newer refresh owns loading indicator until its own history completes', async () => {
  const first = deferred(), second = deferred(); let histories = 0;
  const current = run();
  const view = manager(async url => {
    if (!url.includes('?')) return reply(current);
    if (++histories === 1) return reply({ runs: [current] });
    return histories === 2 ? first.promise : second.promise;
  });
  await view.open('t1');
  const oldRefresh = view.handleAction('workflow-refresh');
  const newRefresh = view.handleAction('workflow-refresh');
  first.resolve(reply({ runs: [] })); await oldRefresh;
  assert.equal(view.getState().loadingHistory, true);
  assert.equal(view.getState().run.id, 'r1');
  second.resolve(reply({ runs: [current] })); await newRefresh;
  assert.equal(view.getState().loadingHistory, false);
  view.stop();
});

test('partial and interrupted states remain explicit and do not poll as completed', async () => {
  for (const status of ['partial', 'interrupted']) {
    let detailCalls = 0; const current = run('r1', 't1', status);
    const view = manager(async url => { if (!url.includes('?')) detailCalls++; return reply(url.includes('?') ? { runs: [current] } : current); }, { pollMs: 10 });
    await view.open('t1'); await delay(25);
    assert.equal(detailCalls, 1);
    assert.match(view.render(), status === 'partial' ? /部分完成/ : /已中断/);
    view.stop();
  }
});

test('an already open empty history discovers a newly started run without reopening', async t => {
  let histories = 0; const current = run('first-live-run', 't1', 'running');
  const view = manager(async url => reply(url.includes('?') ? { runs: ++histories === 1 ? [] : [current] } : current), { pollMs: 10 });
  t.after(() => view.stop());
  await view.open('t1');
  assert.equal(view.getState().run, null);
  await until(() => view.getState().run?.id === 'first-live-run');
  assert.equal(view.getState().run.status, 'running');
});

test('watching the latest completed run follows a newly started retry automatically', async t => {
  let histories = 0; const previous = run('old-run'), retry = run('retry-run', 't1', 'running');
  const view = manager(async url => reply(url.includes('?') ? { runs: ++histories === 1 ? [previous] : [retry, previous] } : url.endsWith('/old-run') ? previous : retry), { pollMs: 10 });
  t.after(() => view.stop());
  await view.open('t1');
  assert.equal(view.getState().run.id, 'old-run');
  await until(() => view.getState().run?.id === 'retry-run');
  assert.equal(view.getState().run.status, 'running');
});

test('history discovery preserves a deliberate older-run selection', async t => {
  const older = run('older'), latest = run('latest'), retry = run('retry', 't1', 'running'); let available = [latest, older];
  const view = manager(async url => reply(url.includes('?') ? { runs: available } : [older, latest, retry].find(item => url.endsWith(`/${item.id}`))), { pollMs: 10 });
  t.after(() => view.stop());
  await view.open('t1');
  view.handleChange({ target: { id: 'workflow-run', value: 'older' } });
  await until(() => view.getState().run?.id === 'older');
  available = [retry, latest, older];
  await until(() => view.getState().runs[0]?.id === 'retry');
  assert.equal(view.getState().runId, 'older');
  assert.equal(view.getState().run.id, 'older');
});

test('unchanged history polls stay silent for both empty and terminal selections', async t => {
  for (const available of [[], [run()]]) {
    let histories = 0, paints = 0;
    const view = manager(async url => {
      if (url.includes('?')) { histories++; return reply({ runs: available }); }
      return reply(available[0]);
    }, { pollMs: 10, onChange: () => paints++ });
    t.after(() => view.stop());
    await view.open('t1'); const initialPaints = paints;
    await until(() => histories >= 3);
    assert.equal(paints, initialPaints);
    view.stop();
  }
});

test('closing during a history poll aborts it and ignores a subsequently resolved response', async t => {
  const pending = deferred(); let histories = 0, paints = 0, pendingSignal;
  const view = manager(async (url, options) => {
    if (++histories === 1) return reply({ runs: [] });
    pendingSignal = options.signal; return pending.promise;
  }, { pollMs: 10, onChange: () => paints++ });
  t.after(() => { view.stop(); pending.resolve(reply({ runs: [] })); });
  await view.open('t1'); await until(() => histories === 2);
  view.stop(); const beforePaints = paints;
  assert.equal(pendingSignal.aborted, true);
  pending.resolve(reply({ runs: [run()] })); await delay(25);
  assert.equal(view.getState().active, false);
  assert.equal(view.getState().run, null);
  assert.equal(paints, beforePaints);
  assert.equal(histories, 2);
});

test('slow automatic history and running-detail reads form a single non-overlapping request chain', async t => {
  const current = run('r1', 't1', 'running'); let active = 0, maximum = 0, calls = 0;
  const view = manager(async url => {
    calls++; maximum = Math.max(maximum, ++active);
    try { await delay(20); return reply(url.includes('?') ? { runs: [current] } : current); }
    finally { active--; }
  }, { pollMs: 10 });
  t.after(() => view.stop());
  await view.open('t1'); await until(() => calls >= 6);
  view.stop(); const stoppedCalls = calls; await delay(30);
  assert.equal(maximum, 1);
  assert.equal(calls, stoppedCalls);
});

test('a history read failure does not stop detail updates for the selected running trace', async t => {
  const running = run('r1', 't1', 'running'), completed = run(); let histories = 0, details = 0;
  const view = manager(async url => {
    if (url.includes('?')) { if (++histories > 1) throw new Error('history temporarily unavailable'); return reply({ runs: [running] }); }
    return reply(++details === 1 ? running : completed);
  }, { pollMs: 10 });
  t.after(() => view.stop());
  await view.open('t1'); await until(() => view.getState().run?.status === 'completed');
  assert.match(view.getState().historyError, /暂时无法读取/);
});
