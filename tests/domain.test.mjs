import test from 'node:test';
import assert from 'node:assert/strict';

const domain = await import('../public/domain.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const now = '2026-10-18T10:30:00+08:00';
const current = state => state.sessions.filter(s => s.taskId === domain.INITIAL_TASK_ID);
const session = (state, suffix = '003') => state.sessions.find(s => s.id === `DEMO_PRE${suffix}`);
const ai = (item, ruleId) => item.aiResults.find(result => result.ruleId === ruleId);
const human = (item, ruleId, verdict, reason, evidence = []) => ({
  ruleId, verdict, reason, evidence, referenceIds: ai(item, ruleId).referenceIds,
  source: '人工修改',
});

test('the isolated domain exposes the agreed data and function contract', () => {
  for (const name of ['products', 'policies', 'rules', 'demoSessions']) assert.ok(Array.isArray(domain[name]), `${name} must be an array`);
  for (const name of ['createInitialState', 'getSessionResults', 'saveReview', 'acceptAI', 'confirmReview', 'markPending', 'reopenReview', 'createTask', 'setTaskProgress', 'getDashboard']) {
    assert.equal(typeof domain[name], 'function', `${name} must be a function`);
  }
  assert.equal(domain.INITIAL_TASK_ID, 'TASK-20261018-001');
});

test('fictional cases use real evidence turns and valid policy clause references', () => {
  assert.equal(domain.demoSessions.length, 8);
  assert.deepEqual(domain.policies.map(p => p.id), ['P001', 'P002', 'P003', 'P004']);
  assert.deepEqual(domain.rules.map(r => r.id), ['R001', 'R002', 'R003', 'R004', 'R005', 'R006', 'R007']);
  const clauses = new Set(domain.policies.flatMap(p => p.sections.map(section => section.id)));
  for (const [index, item] of domain.demoSessions.entries()) {
    assert.equal(item.id, `DEMO_PRE${String(index + 1).padStart(3, '0')}`);
    assert.equal(item.externalId, item.id);
    assert.equal(item.aiResults.length, 7);
    assert.equal(new Set(item.aiResults.map(r => r.ruleId)).size, 7);
    assert.equal(item.review.status, '待审核');
    assert.equal(item.review.completedAt, null);
    assert.deepEqual(item.review.drafts, {});
    for (const result of item.aiResults) {
      assert.ok(['符合', '不符合', '无法判定', '不适用'].includes(result.verdict));
      assert.ok(result.reason.trim());
      result.evidence.forEach(id => assert.ok(item.turns.some(turn => turn.id === id), `unknown turn ${id}`));
      result.referenceIds.forEach(id => assert.ok(clauses.has(id), `unknown clause ${id}`));
    }
  }
  assert.equal(ai(domain.demoSessions[0], 'R001').verdict, '不符合');
  assert.equal(ai(domain.demoSessions[1], 'R002').verdict, '不符合');
  assert.equal(ai(domain.demoSessions[2], 'R002').verdict, '不符合');
  assert.equal(ai(domain.demoSessions[3], 'R003').verdict, '符合');
  assert.equal(ai(domain.demoSessions[4], 'R007').verdict, '无法判定');
  assert.ok(domain.demoSessions[5].aiResults.every(r => ['符合', '不适用'].includes(r.verdict)));
  assert.equal(ai(domain.demoSessions[6], 'R005').verdict, '不符合');
  assert.equal(ai(domain.demoSessions[7], 'R004').verdict, '不符合');
  assert.equal(ai(domain.demoSessions[7], 'R006').verdict, '不符合');
});

test('initial states are independent and contain historical confirmed sessions for source-derived charts', () => {
  const first = domain.createInitialState();
  const second = domain.createInitialState();
  assert.equal(first.schemaVersion, 1);
  assert.equal(current(first).length, 8);
  const historical = first.sessions.filter(s => s.taskId !== domain.INITIAL_TASK_ID);
  assert.equal(historical.length, 24);
  assert.ok(historical.every(s => s.review.status === '已确认' && s.review.completedAt));
  assert.ok(historical.every(s => s.startedAt.slice(0, 10) >= '2026-10-01' && s.startedAt.slice(0, 10) <= '2026-10-17'));
  assert.ok(first.tasks.every(task => task.sessionIds.every(id => first.sessions.some(s => s.id === id && s.taskId === task.id))));
  first.sessions[0].turns[0].text = 'changed outside module';
  assert.notEqual(first.sessions[0].turns[0].text, second.sessions[0].turns[0].text);
  assert.notEqual(first.sessions[0].turns[0].text, domain.demoSessions[0].turns[0].text);
});

test('saveReview preserves original state and AI results while exposing a changed final judgment', () => {
  const before = domain.createInitialState();
  const item = session(before);
  const original = structuredClone(before);
  const draft = human(item, 'R002', '符合', '第 2 轮已经说明满2999且已领券，3299减200为3099。', [2]);
  const after = domain.saveReview(before, item.id, draft, now);
  assert.deepEqual(before, original);
  assert.notEqual(after, before);
  assert.equal(session(after).review.status, '已暂存');
  assert.deepEqual(session(after).aiResults, item.aiResults);
  const result = domain.getSessionResults(session(after)).find(r => r.ruleId === 'R002');
  assert.equal(result.verdict, '不符合');
  assert.equal(result.final.verdict, '符合');
  assert.equal(result.changed, true);
  assert.ok(domain.getSessionResults(item).every(r => r.final === null && !r.changed));
  draft.reason = 'changed caller draft';
  assert.notEqual(session(after).review.drafts.R002.reason, draft.reason);
});

test('saveReview validates verdict, known rule, human reason and actual evidence turn ids', () => {
  const state = domain.createInitialState();
  const item = session(state);
  const draft = human(item, 'R002', '符合', '价格计算符合规则。', [2]);
  assert.throws(() => domain.saveReview(state, item.id, { ...draft, verdict: '通过' }), /判定|verdict/);
  assert.throws(() => domain.saveReview(state, item.id, { ...draft, ruleId: 'R099' }), /规则|rule/);
  assert.doesNotThrow(() => domain.saveReview(state, item.id, { ...draft, reason: '  ' }));
  assert.throws(() => domain.saveReview(state, item.id, { ...draft, verdict:'不符合', reason: '  ' }), /理由|reason/);
  assert.throws(() => domain.saveReview(state, item.id, { ...draft, evidence: [999] }), /证据|evidence/);
  assert.throws(() => domain.saveReview(state, 'UNKNOWN', draft), /会话|session/);
});

test('acceptAI only fills missing drafts and confirmation is idempotent', () => {
  let state = domain.createInitialState();
  const item = session(state);
  state = domain.saveReview(state, item.id, human(item, 'R002', '符合', '领券门槛、到手价都已解释清楚。', [2]), now);
  const withAI = domain.acceptAI(state, item.id, now);
  assert.equal(Object.keys(session(withAI).review.drafts).length, 7);
  assert.equal(session(withAI).review.drafts.R002.source, '人工修改');
  assert.equal(session(withAI).review.drafts.R002.verdict, '符合');
  assert.equal(session(withAI).review.drafts.R001.source, 'AI接受');
  const confirmed = domain.confirmReview(withAI, item.id, now);
  assert.equal(session(confirmed).review.status, '已确认');
  assert.equal(session(confirmed).review.completedAt, now);
  assert.equal(confirmed.tasks[0].status, '待审核');
  const repeated = domain.confirmReview(confirmed, item.id, '2026-10-18T11:00:00+08:00');
  assert.equal(repeated.activity.length, confirmed.activity.length);
  assert.equal(session(repeated).review.completedAt, now);
  assert.equal(domain.getDashboard(repeated, { period: 'batch', taskId: domain.INITIAL_TASK_ID }).reviewedCount, 1);
});

test('missing AI issue can be added by human and pending/reopen clear completion', () => {
  const state = domain.createInitialState();
  const item = session(state, '004');
  const saved = domain.saveReview(state, item.id, human(item, 'R003', '不符合', '第4轮保证明天送达，超出48小时出库政策。', [4]), now);
  assert.equal(saved.sessions.find(s => s.id === item.id).review.drafts.R003.source, '人工补充');
  const confirmed = domain.confirmReview(saved, item.id, now);
  const reopened = domain.reopenReview(confirmed, item.id, now);
  assert.equal(session(reopened, '004').review.status, '已暂存');
  assert.equal(session(reopened, '004').review.completedAt, null);
  const pending = domain.markPending(confirmed, item.id, '等待客户补充物流页面。', now);
  assert.equal(session(pending, '004').review.status, '待补充');
  assert.equal(session(pending, '004').review.completedAt, null);
  assert.equal(session(pending, '004').review.notes, '等待客户补充物流页面。');
  assert.equal(domain.getDashboard(pending, { period: 'batch', taskId: domain.INITIAL_TASK_ID }).reviewedCount, 0);
  const edited = domain.saveReview(confirmed, item.id, human(item, 'R003', '不符合', '复核后确认存在到货保证。', [4]), now);
  assert.equal(session(edited, '004').review.completedAt, null);
  assert.equal(session(edited, '004').review.status, '已暂存');
});

test('all confirmed session statuses complete their containing task', () => {
  let state = domain.createInitialState();
  for (const item of current(state)) state = domain.confirmReview(state, item.id, now);
  assert.equal(state.tasks.find(t => t.id === domain.INITIAL_TASK_ID).status, '已完成');
  state = domain.reopenReview(state, 'DEMO_PRE001', now);
  assert.equal(state.tasks.find(t => t.id === domain.INITIAL_TASK_ID).status, '待审核');
});

test('new tasks clone only known demo templates with unique internal ids and preserved external ids', () => {
  const before = domain.createInitialState();
  const options = { name: '新批次', fileName: '本地样例.csv', templateIds: ['DEMO_PRE003', 'DEMO_PRE004'] };
  const first = domain.createTask(before, options);
  const task = first.tasks[0];
  assert.equal(task.status, '待质检');
  assert.equal(task.progress, 0);
  assert.equal(task.ruleSetId, 'RS-PRESALES-V1');
  assert.equal(before.tasks.length + 1, first.tasks.length);
  const cloned = first.sessions.filter(s => s.taskId === task.id);
  assert.deepEqual(cloned.map(s => s.externalId), options.templateIds);
  assert.ok(cloned.every(s => s.id !== s.externalId && s.review.status === '待审核' && Object.keys(s.review.drafts).length === 0));
  const second = domain.createTask(first, options);
  assert.notEqual(second.tasks[0].id, task.id);
  assert.equal(new Set(second.sessions.map(s => s.id)).size, second.sessions.length);
  assert.throws(() => domain.createTask(before, { ...options, templateIds: ['NOT_A_TEMPLATE'] }), /模板|template/);
  const running = domain.setTaskProgress(first, task.id, 45);
  assert.equal(running.tasks[0].status, '质检中');
  assert.equal(running.tasks[0].progress, 45);
  const ready = domain.setTaskProgress(running, task.id, 100);
  assert.equal(ready.tasks[0].status, '待审核');
  assert.throws(() => domain.setTaskProgress(first, task.id, 101), /进度|progress/);
});

test('batch quality uses confirmed final judgments and treats AI correction and unknown separately', () => {
  let state = domain.createInitialState();
  let dashboard = domain.getDashboard(state, { period: 'batch', taskId: domain.INITIAL_TASK_ID });
  assert.equal(dashboard.totalSessions, 8);
  assert.equal(dashboard.aiProcessed, 8);
  assert.equal(dashboard.reviewedCount, 0);
  assert.equal(dashboard.pendingCount, 8);
  assert.equal(dashboard.issueCount, 0);
  assert.equal(dashboard.passRate, 0);
  const falsePositive = session(state, '003');
  state = domain.saveReview(state, falsePositive.id, human(falsePositive, 'R002', '符合', '已明确优惠条件和领券动作。', [2]), now);
  state = domain.confirmReview(state, falsePositive.id, now);
  const falseNegative = session(state, '004');
  state = domain.saveReview(state, falseNegative.id, human(falseNegative, 'R003', '不符合', '保证次日到货，违反出库时效口径。', [4]), now);
  state = domain.confirmReview(state, falseNegative.id, now);
  state = domain.confirmReview(state, 'DEMO_PRE005', now);
  dashboard = domain.getDashboard(state, { period: 'batch', taskId: domain.INITIAL_TASK_ID });
  assert.equal(dashboard.reviewedCount, 3);
  assert.equal(dashboard.pendingCount, 5);
  assert.equal(dashboard.problemSessions, 1);
  assert.equal(dashboard.issueCount, 1);
  assert.equal(dashboard.unknownCount, 1);
  assert.equal(dashboard.changedCount, 2);
  assert.equal(dashboard.passRate, 33.3);
  assert.equal(dashboard.reviewRate, 37.5);
  assert.equal(dashboard.changeRate, 66.7);
  assert.equal(dashboard.ruleCounts.find(r => r.ruleId === 'R003').count, 1);
  assert.equal(dashboard.ruleCounts.find(r => r.ruleId === 'R002').count, 0);
  assert.equal(dashboard.distribution.reduce((sum, d) => sum + d.count, 0), 1);
  assert.equal(dashboard.trend.reduce((sum, d) => sum + d.reviewed, 0), 3);
});

test('date filters use conversation date while trends group confirmed completion dates', () => {
  const state = domain.createInitialState();
  const month = domain.getDashboard(state);
  const week = domain.getDashboard(state, { period: 'week' });
  assert.equal(month.totalSessions, 32);
  assert.equal(month.reviewedCount, 24);
  assert.ok(month.trend.length > 7);
  assert.ok(week.totalSessions < month.totalSessions && week.totalSessions >= 8);
  assert.ok(week.trend.every(point => point.label >= '2026-10-12' && point.label <= '2026-10-18'));
  const future = domain.getDashboard(state, { period: 'month', referenceDate: '2026-11-18' });
  assert.equal(future.totalSessions, 0);
  assert.equal(future.reviewRate, 0);
  assert.equal(future.changeRate, 0);
});

test('the missed-delivery scenario has the explicit tomorrow-guarantee phrase', () => {
  assert.ok(domain.demoSessions[3].turns.some(turn => turn.role === '客服' && turn.text.includes('明天必达')));
});

test('default review timestamps are after every pending conversation and batch import', () => {
  let state = domain.createInitialState();
  for (const item of current(state)) {
    state = domain.confirmReview(state, item.id);
    const confirmed = state.sessions.find(s => s.id === item.id);
    assert.ok(Date.parse(confirmed.review.completedAt) >= Date.parse(confirmed.startedAt));
    assert.ok(Date.parse(confirmed.review.completedAt) >= Date.parse(state.tasks.find(t => t.id === item.taskId).createdAt));
  }
});

test('manual evidence references must belong to the edited rule policy scope', () => {
  const state = domain.createInitialState();
  const item = session(state);
  assert.throws(() => domain.saveReview(state, item.id, {
    ...human(item, 'R002', '符合', '优惠条件已说明。', [2]), referenceIds: ['P003-1'],
  }), /依据|reference/);
});

test('week means Monday through reference date, excluding Sunday Oct11 and including Monday Oct12', () => {
  const state = domain.createInitialState();
  state.sessions = [
    { ...structuredClone(domain.demoSessions[0]), id: 'WEEK-SUN', startedAt: '2026-10-11T09:00:00+08:00' },
    { ...structuredClone(domain.demoSessions[1]), id: 'WEEK-MON', startedAt: '2026-10-12T09:00:00+08:00' },
    { ...structuredClone(domain.demoSessions[2]), id: 'WEEK-FUTURE', startedAt: '2026-10-15T09:00:00+08:00' },
  ];
  const dashboard = domain.getDashboard(state, { period: 'week', referenceDate: '2026-10-14' });
  assert.equal(dashboard.totalSessions, 1, 'only the Monday conversation belongs to this week as of Wednesday');
  assert.deepEqual(dashboard.trend.map(point => point.label), ['2026-10-12', '2026-10-13', '2026-10-14']);
});

test('week boundaries use the conversation date in UTC+08 rather than the timestamp date prefix', () => {
  const state = domain.createInitialState();
  state.sessions = [
    { ...structuredClone(domain.demoSessions[0]), id: 'BEFORE-MONDAY', startedAt: '2026-10-11T15:59:59Z' },
    { ...structuredClone(domain.demoSessions[1]), id: 'MONDAY-MIDNIGHT', startedAt: '2026-10-11T16:00:00Z' },
  ];
  const dashboard = domain.getDashboard(state, { period: 'week', referenceDate: '2026-10-14' });
  assert.equal(dashboard.totalSessions, 1, 'Beijing Monday midnight is in this week and Beijing Sunday is excluded');
});

test('trend compares reviewed and problem conversations, not number of failed checks',()=>{
  const stats=domain.getDashboard(domain.createInitialState());
  assert.ok(stats.trend.every(point=>Number.isInteger(point.problems)&&point.problems>=0&&point.problems<=point.reviewed));
  assert.equal(stats.trend.reduce((total,point)=>total+point.problems,0),stats.problemSessions);
  const day=stats.trend.find(point=>point.label==='2026-10-04');
  assert.equal(day.reviewed,1);assert.equal(day.issues,2);assert.equal(day.problems,1);
});

test('one confirmed conversation with two failed checks contributes one problem conversation',()=>{
  const state=domain.confirmReview(domain.createInitialState(),'DEMO_PRE008');
  const stats=domain.getDashboard(state,{period:'batch',taskId:domain.INITIAL_TASK_ID});
  assert.equal(stats.reviewedCount,1);assert.equal(stats.issueCount,2);assert.equal(stats.problemSessions,1);
  assert.equal(stats.trend[0].problems,1);
});
