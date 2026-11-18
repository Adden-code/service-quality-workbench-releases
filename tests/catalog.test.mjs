import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rules, policies, demoSessions, createInitialState } from '../public/domain.mjs';

const catalogUrl = new URL('../public/catalog.mjs', import.meta.url);
const now = '2026-10-19T10:00:00+08:00';
const later = '2026-10-19T11:00:00+08:00';
async function api() {
  assert.ok(existsSync(catalogUrl), '缺少独立规则与资料版本目录模块');
  return import(catalogUrl);
}
const copy = value => structuredClone(value);
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function policyRecord(catalog, id = 'P005', changes = {}) {
  return {
    ...copy(catalog.policies[0]), id, version: 'V1.0', title: '新增演示资料',
    effectiveAt: '2026-10-19', changeNote: '新增资料演示', status: '草稿', publishedAt: '',
    sections: [{ id: `${id}-1`, title: '演示条款', text: '仅用于本地虚构演示。' }], ...changes,
  };
}

test('catalog initializes independent published copies without changing built-ins or review state', async () => {
  const { createCatalog, validateCatalog } = await api();
  const originals = JSON.stringify({ rules, policies, demoSessions, state: createInitialState() });
  const first = createCatalog(), second = createCatalog();
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.rules.length, 7);
  assert.equal(first.policies.length, 4);
  assert.deepEqual(first.events, []);
  assert.ok([...first.rules, ...first.policies].every(record => record.status === '已发布' && record.version === 'V1.0' && record.owner && record.scope && record.publishedAt));
  assert.equal(first.rules[0].title, rules[0].name);
  assert.equal(validateCatalog(first), true);
  first.policies[0].sections[0].text = '目录外部修改';
  first.rules[0].policyIds.push('P005');
  assert.notDeepEqual(first, second);
  assert.equal(JSON.stringify({ rules, policies, demoSessions, state: createInitialState() }), originals);
});

test('versions use canonical numeric ordering and increment the highest minor', async () => {
  const { nextVersion, createCatalog, createDraft } = await api();
  assert.equal(nextVersion([], 'P005'), 'V1.0');
  assert.equal(nextVersion([{ id: 'P005', version: 'V1.9' }, { id: 'P005', version: 'V1.10' }, { id: 'OTHER', version: 'V9.9' }], 'P005'), 'V1.11');
  assert.equal(nextVersion([{ id: 'P005', version: 'V2.0' }, { id: 'P005', version: 'V1.99' }], 'P005'), 'V2.1');
  const base = createCatalog();
  for (const version of ['1.1', 'v1.1', 'V01.1', 'V1.01', 'V1.-1', 'V1.1.1', 'V9007199254740992.0']) {
    assert.throws(() => createDraft(base, 'policies', 'P001', { version }, now), /版本/);
  }
  assert.throws(() => createDraft(base, 'policies', 'P001', { version: 'V1.0' }, now), /重复|版本/);
  assert.throws(() => createDraft(base, 'policies', 'P001', { version: 'V0.9' }, now), /高于|版本/);
});

test('record validation checks actual dates, expiry ordering, required text and unique sections', async () => {
  const { createCatalog, validateRecord } = await api();
  const sample = policyRecord(createCatalog());
  assert.equal(validateRecord(sample, 'policies'), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-01', '2026-10-19T00:00:00Z', '0000-01-01']) {
    assert.throws(() => validateRecord({ ...sample, effectiveAt: date }, 'policies'), /日期/);
  }
  assert.equal(validateRecord({ ...sample, effectiveAt: '2024-02-29' }, 'policies'), true);
  for (const expiresAt of ['2026-10-18', '2026-10-19', '2026-02-30']) assert.throws(() => validateRecord({ ...sample, expiresAt }, 'policies'), /日期|晚于/);
  for (const key of ['id', 'title', 'category', 'scope', 'owner', 'changeNote']) assert.throws(() => validateRecord({ ...sample, [key]: ' ' }, 'policies'), /不能为空|标识/);
  assert.throws(() => validateRecord({ ...sample, title: '长'.repeat(121) }, 'policies'), /长度|超过/);
  assert.throws(() => validateRecord({ ...sample, sections: [] }, 'policies'), /条款/);
  assert.throws(() => validateRecord({ ...sample, sections: [sample.sections[0], sample.sections[0]] }, 'policies'), /重复/);
  assert.throws(() => validateRecord({ ...sample, sections: [{ id: 'a', title: '标题', text: '' }] }, 'policies'), /正文|不能为空/);
  assert.throws(() => validateRecord({ ...sample, status: '发布' }, 'policies'), /状态/);
  assert.throws(() => validateRecord(sample, 'anything'), /类型/);
});

test('createDraft clones the latest numeric version and protects all prior data', async () => {
  const { createCatalog, createDraft } = await api();
  const base = freeze(createCatalog());
  const snapshot = JSON.stringify(base);
  const next = createDraft(base, 'policies', 'P003', { effectiveAt: '2026-10-20', changeNote: '更新出库口径', status: '已发布', publishedAt: now }, now);
  const draft = next.policies.at(-1);
  assert.equal(draft.id, 'P003');
  assert.equal(draft.version, 'V1.1');
  assert.equal(draft.status, '草稿');
  assert.equal(draft.publishedAt, '');
  assert.equal(draft.createdAt, now);
  assert.equal(next.events.at(-1).version, 'V1.1');
  assert.equal(next.events.at(-1).at, now);
  draft.sections[0].text = '独立文本';
  assert.equal(JSON.stringify(base), snapshot);
  const latest = createDraft(next, 'policies', 'P003', { changeNote: '从最新草稿复制' }, later);
  assert.equal(latest.policies.at(-1).version, 'V1.2');
  assert.equal(latest.policies.at(-1).sections[0].text, '独立文本');
});

test('new policies and rules validate identifiers and catalog policy references', async () => {
  const { createCatalog, createDraft, updateDraft, publishVersion } = await api();
  const base = createCatalog();
  const next = createDraft(base, 'policies', 'P005', policyRecord(base), now);
  assert.equal(next.policies.at(-1).version, 'V1.0');
  const rule = { ...copy(base.rules[0]), id: 'R008', title: '新增演示规则', effectiveAt: '2026-10-20', version: 'V1.0', policyIds: ['P005'] };
  const withRule = createDraft(next, 'rules', 'R008', rule, now);
  assert.equal(withRule.rules.at(-1).status, '草稿');
  assert.throws(() => createDraft(base, 'rules', 'R008', rule, now), /资料|依据/);
  assert.throws(() => updateDraft(withRule, 'rules', 'R008', 'V1.0', { policyIds: ['MISSING'] }, later), /资料|依据/);
  const orphaned = copy(withRule); orphaned.policies = orphaned.policies.filter(item => item.id !== 'P005');
  assert.throws(() => publishVersion(orphaned, 'rules', 'R008', 'V1.0', {}, later), /资料|依据/);
  assert.throws(() => createDraft(base, 'policies', 'P005', { ...policyRecord(base), id: 'P006' }, now), /标识/);
});

test('draft updates preserve identity and metadata while published and retired content cannot be edited', async () => {
  const { createCatalog, createDraft, updateDraft, retireVersion } = await api();
  const base = createCatalog();
  const drafted = freeze(createDraft(base, 'policies', 'P003', { effectiveAt: '2026-10-20', changeNote: '草稿' }, now));
  const next = updateDraft(drafted, 'policies', 'P003', 'V1.1', { title: '新版标题', status: '已发布', createdAt: later, publishedAt: later }, later);
  assert.equal(next.policies.at(-1).title, '新版标题');
  assert.equal(next.policies.at(-1).status, '草稿');
  assert.equal(next.policies.at(-1).createdAt, now);
  assert.equal(next.policies.at(-1).publishedAt, '');
  assert.equal(drafted.policies.at(-1).title, base.policies[2].title);
  assert.throws(() => updateDraft(drafted, 'policies', 'P003', 'V1.1', { version: 'V2.0' }, later), /版本/);
  assert.throws(() => updateDraft(base, 'policies', 'P003', 'V1.0', { title: '不能修改' }, later), /草稿/);
  const retired = retireVersion(base, 'policies', 'P003', 'V1.0', later);
  assert.throws(() => updateDraft(retired, 'policies', 'P003', 'V1.0', { title: '不能修改' }, later), /草稿/);
});

test('cloning a draft after editing clauses with matching ownership creates a valid next version', async () => {
  const { createCatalog, createDraft, updateDraft, validateCatalog } = await api();
  const drafted = createDraft(createCatalog(), 'policies', 'P003', { changeNote: '含条款归属的草稿' }, now);
  const sections = drafted.policies.at(-1).sections.map(section => ({ ...section, policyId: 'P003', version: 'V1.1' }));
  const edited = freeze(updateDraft(drafted, 'policies', 'P003', 'V1.1', { sections }, later));
  assert.equal(validateCatalog(edited), true);
  const snapshot = JSON.stringify(edited);
  const next = createDraft(edited, 'policies', 'P003', { changeNote: '复制为下一版本' }, later);
  assert.equal(next.policies.at(-1).version, 'V1.2');
  assert.equal(validateCatalog(next), true);
  assert.deepEqual(next.policies.at(-1).sections, drafted.policies.at(-1).sections);
  assert.equal(JSON.stringify(edited), snapshot);
});

test('valid loaded clause ownership is canonicalized on clone while wrong explicit ownership is rejected', async () => {
  const { createCatalog, createDraft, updateDraft, validateCatalog } = await api();
  const loaded = createCatalog();
  loaded.policies[0].sections = loaded.policies[0].sections.map(section => ({ ...section, policyId: 'P001', version: 'V1.0' }));
  assert.equal(validateCatalog(loaded), true);
  freeze(loaded);
  const snapshot = JSON.stringify(loaded);
  const next = createDraft(loaded, 'policies', 'P001', { changeNote: '复制已保存资料' }, now);
  assert.equal(validateCatalog(next), true);
  assert.deepEqual(next.policies.at(-1).sections, policies[0].sections);
  assert.equal(JSON.stringify(loaded), snapshot);
  for (const ownership of [{ policyId: 'P999' }, { version: 'V9.0' }]) {
    const sections = next.policies.at(-1).sections.map(section => ({ ...section, ...ownership }));
    assert.throws(() => updateDraft(next, 'policies', 'P001', 'V1.1', { sections }, later), /归属/);
    assert.throws(() => createDraft(loaded, 'policies', 'P001', { sections }, later), /归属/);
  }
});

test('publishing requires explicit closure of an earlier open period and preserves history', async () => {
  const { createCatalog, createDraft, publishVersion } = await api();
  const base = createCatalog(), builtInSnapshot = JSON.stringify({ rules, policies, demoSessions });
  const drafted = freeze(createDraft(base, 'policies', 'P003', { effectiveAt: '2026-10-20', changeNote: '更新' }, now));
  const snapshot = JSON.stringify(drafted);
  assert.throws(() => publishVersion(drafted, 'policies', 'P003', 'V1.1', {}, later), /衔接/);
  assert.equal(JSON.stringify(drafted), snapshot);
  const next = publishVersion(drafted, 'policies', 'P003', 'V1.1', { closePrevious: true }, later);
  const previous = next.policies.find(item => item.id === 'P003' && item.version === 'V1.0');
  assert.equal(previous.expiresAt, '2026-10-20');
  assert.deepEqual({ ...previous, expiresAt: '' }, base.policies[2]);
  assert.equal(next.policies.at(-1).status, '已发布');
  assert.equal(next.policies.at(-1).publishedAt, later);
  assert.equal(next.events.at(-1).action, '发布版本');
  assert.equal(JSON.stringify({ rules, policies, demoSessions }), builtInSnapshot);
  assert.throws(() => publishVersion(next, 'policies', 'P003', 'V1.1', {}, later), /草稿/);
});

test('all other publishing overlaps are rejected and adjacent finite periods are allowed', async () => {
  const { createCatalog, createDraft, publishVersion } = await api();
  const base = createCatalog();
  let next = createDraft(base, 'policies', 'P005', policyRecord(base, 'P005', { effectiveAt: '2026-11-01', expiresAt: '2026-12-01' }), now);
  next = publishVersion(next, 'policies', 'P005', 'V1.0', {}, now);
  for (const dates of [
    { effectiveAt: '2026-10-01', expiresAt: '' },
    { effectiveAt: '2026-11-01', expiresAt: '2026-11-15' },
    { effectiveAt: '2026-11-15', expiresAt: '2026-12-15' },
  ]) {
    const drafted = createDraft(next, 'policies', 'P005', { ...dates, changeNote: '冲突期间' }, now);
    assert.throws(() => publishVersion(drafted, 'policies', 'P005', 'V1.1', { closePrevious: true }, later), /重叠|冲突/);
  }
  const drafted = createDraft(next, 'policies', 'P005', { effectiveAt: '2026-12-01', expiresAt: '', changeNote: '相邻期间' }, now);
  const published = publishVersion(drafted, 'policies', 'P005', 'V1.1', {}, later);
  assert.equal(published.policies.at(-1).status, '已发布');
  const sameDay = createDraft(base, 'policies', 'P003', { effectiveAt: '2026-10-01' }, now);
  assert.throws(() => publishVersion(sameDay, 'policies', 'P003', 'V1.1', { closePrevious: true }, later), /重叠|冲突/);
});

test('retirement preserves content, effective dates and publication time, and logs history', async () => {
  const { createCatalog, createDraft, retireVersion } = await api();
  const base = freeze(createCatalog());
  const next = retireVersion(base, 'rules', 'R001', 'V1.0', later);
  assert.deepEqual({ ...next.rules[0], status: '已发布' }, base.rules[0]);
  assert.equal(next.rules[0].status, '已停用');
  assert.equal(next.events.at(-1).action, '停用版本');
  const draft = createDraft(base, 'policies', 'P001', {}, now);
  assert.throws(() => retireVersion(draft, 'policies', 'P001', 'V1.1', later), /草稿|已发布/);
  assert.throws(() => retireVersion(next, 'rules', 'R001', 'V1.0', later), /已发布|停用/);
});

test('policy diffs show added, changed, removed and unchanged clauses with independent values', async () => {
  const { createCatalog, compareVersions } = await api();
  const before = copy(createCatalog().policies[3]);
  const after = copy(before);
  after.title = '新版资料标题';
  after.sections[0].text = '修改后的正文';
  after.sections.splice(1, 1);
  after.sections.push({ id: 'P004-6', title: '新增条款', text: '新增正文' });
  const diff = compareVersions(before, after);
  assert.deepEqual(diff.fields.find(field => field.key === 'title'), { key: 'title', label: '名称', before: before.title, after: after.title });
  assert.equal(diff.sections.find(item => item.id === 'P004-1').status, '修改');
  assert.equal(diff.sections.find(item => item.id === 'P004-2').status, '删除');
  assert.equal(diff.sections.find(item => item.id === 'P004-3').status, '未变');
  assert.equal(diff.sections.find(item => item.id === 'P004-6').status, '新增');
  diff.sections[0].after.text = '外部修改差异';
  assert.equal(after.sections[0].text, '修改后的正文');
});

test('rule diffs include criteria and related policy IDs', async () => {
  const { createCatalog, compareVersions } = await api();
  const before = createCatalog().rules[0];
  const after = { ...copy(before), passCriteria: '新符合口径', failCriteria: '新违规口径', exceptionCriteria: '新例外口径', policyIds: ['P001', 'P004'] };
  const diff = compareVersions(before, after);
  assert.deepEqual(new Set(diff.fields.map(field => field.key)), new Set(['passCriteria', 'failCriteria', 'exceptionCriteria', 'policyIds']));
  assert.deepEqual(diff.sections, []);
  diff.fields.find(field => field.key === 'policyIds').after.push('P005');
  assert.deepEqual(after.policyIds, ['P001', 'P004']);
});

test('policy imports are atomic fresh drafts and preserve original input and existing versions', async () => {
  const { createCatalog, importPolicies } = await api();
  const base = freeze(createCatalog());
  const incoming = freeze([
    policyRecord(base, 'P005', { status: '已发布', publishedAt: '2026-01-01T00:00:00Z' }),
    policyRecord(base, 'P005', { version: 'V1.1', title: '第二版本', status: '已停用' }),
  ]);
  const next = importPolicies(base, incoming, now);
  assert.equal(next.policies.length, 6);
  assert.deepEqual(next.policies.slice(0, 4), base.policies);
  assert.ok(next.policies.slice(4).every(item => item.status === '草稿' && item.createdAt === now && item.publishedAt === ''));
  assert.equal(incoming[0].status, '已发布');
  assert.equal(next.events.length, 2);
  assert.ok(next.events.every(event => event.action === '导入草稿' && event.at === now));
});

test('imports reject duplicate existing or batch versions, stale versions, invalid dates and invalid clause ownership atomically', async () => {
  const { createCatalog, importPolicies } = await api();
  const base = freeze(createCatalog()), snapshot = JSON.stringify(base), good = policyRecord(base);
  for (const incoming of [
    [good, good],
    [good, copy(base.policies[0])],
    [good, policyRecord(base, 'P003', { version: 'V0.9' })],
    [good, policyRecord(base, 'P006', { effectiveAt: '2026-02-30' })],
    [good, policyRecord(base, 'P006', { sections: [{ id: '', title: '孤立条款', text: '正文' }] })],
    [good, policyRecord(base, 'P006', { sections: [{ id: 'c', title: '条款', text: '正文', policyId: 'P999' }] })],
    [good, policyRecord(base, 'P006', { sections: [{ id: 'c', title: '条款', text: '正文', version: 'V9.0' }] })],
  ]) {
    assert.throws(() => importPolicies(base, incoming, now), /重复|版本|日期|标识|归属/);
    assert.equal(JSON.stringify(base), snapshot);
  }
  assert.throws(() => importPolicies(base, [], now), /资料|导入/);
});

test('catalog persistence validation rejects duplicate keys, orphan rule references and overlapping published periods', async () => {
  const { createCatalog, createDraft, validateCatalog } = await api();
  const base = createCatalog();
  assert.equal(validateCatalog(JSON.parse(JSON.stringify(base))), true);
  for (const mutate of [
    item => { item.schemaVersion = 2; },
    item => { item.policies.push(copy(item.policies[0])); },
    item => { item.rules[0].policyIds = ['MISSING']; },
    item => { item.policies[0].publishedAt = ''; },
    item => { item.events = 'bad'; },
  ]) {
    const corrupt = copy(base); mutate(corrupt);
    assert.throws(() => validateCatalog(corrupt), /目录|重复|资料|发布|事件/);
  }
  const overlap = createDraft(base, 'policies', 'P003', { effectiveAt: '2026-10-20' }, now);
  Object.assign(overlap.policies.at(-1), { status: '已发布', publishedAt: now });
  assert.throws(() => validateCatalog(overlap), /重叠|冲突/);
});

test('all public state operations reject unknown kinds, missing records and invalid timestamps', async () => {
  const { createCatalog, createDraft, updateDraft, publishVersion, retireVersion, importPolicies } = await api();
  const base = createCatalog();
  assert.throws(() => createDraft(base, 'other', 'P001', {}, now), /类型/);
  assert.throws(() => updateDraft(base, 'policies', 'MISSING', 'V1.0', {}, now), /不存在/);
  assert.throws(() => publishVersion(base, 'policies', 'P001', 'V9.0', {}, now), /不存在/);
  assert.throws(() => retireVersion(base, 'policies', 'P001', 'V9.0', now), /不存在/);
  assert.throws(() => createDraft(base, 'policies', 'P001', {}, '2026-02-30T10:00:00+08:00'), /时间|日期/);
  assert.throws(() => importPolicies(base, [policyRecord(base)], 'not-time'), /时间|日期/);
});
