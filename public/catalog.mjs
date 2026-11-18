// 独立的本地版本目录。内置质检规则、资料和历史判定仍由 domain.mjs 保持。
import { rules as builtInRules, policies as builtInPolicies } from './domain.mjs';
import {validateRuleProvenance} from './context-fields.mjs';
import {validateRuleSets,ruleSetNumericVersion} from './ecommerce-rule-sets.mjs';
import {validateCatalogSceneIds} from './catalog-scenes.mjs';
import {RULE_KINDS,normalizeRuleKind} from './rule-kind.mjs';

const DEFAULT_NOW = '2026-10-19T10:00:00+08:00';
const INITIAL_TIME = '2026-10-01T09:00:00+08:00';
const KINDS = ['rules', 'policies'];
const STATUSES = ['草稿', '已发布', '已停用', '已弃用'];
const COMMON_FIELDS = ['title', 'category', 'scope', 'effectiveAt', 'expiresAt', 'owner', 'changeNote', 'sceneIds'];
const RULE_FIELDS = ['passCriteria', 'failCriteria', 'exceptionCriteria', 'policyIds','provenance','ruleKind','english'];
const clone = value => structuredClone(value);
const canonicalSections = sections => sections.map(({ id, title, text }) => ({ id, title, text }));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function kindCheck(kind) {
  if (!KINDS.includes(kind)) fail('目录类型无效，仅支持 rules 或 policies。');
}

function textCheck(value, label, max, optional = false) {
  if (typeof value !== 'string' || (!optional && !value.trim())) fail(`${label}不能为空，且必须是文本。`);
  if (value.length > max) fail(`${label}长度不能超过${max}个字符。`);
}

function idCheck(value, label = '标识') {
  textCheck(value, label, 64);
  if (/\s/.test(value)) fail(`${label}不能包含空白字符。`);
}

function dateCheck(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) fail(`${label}日期须为真实的 YYYY-MM-DD。`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label}日期不存在。`);
}

function timeCheck(value, label = '操作时间') {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match) fail(`${label}须为包含时区的有效 ISO 时间。`);
  dateCheck(match[1], label);
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59 || +match[6] > 14 || +match[7] > 59 || (+match[6] === 14 && +match[7] !== 0) || !Number.isFinite(Date.parse(value))) fail(`${label}无效。`);
}

function versionParts(version) {
  const match = typeof version === 'string' && version.match(/^V(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match || !Number.isSafeInteger(+match[1]) || !Number.isSafeInteger(+match[2])) fail('版本号须为规范的 V主版本.次版本，例如 V1.0。');
  return [+match[1], +match[2]];
}

function compareVersion(a, b) {
  const left = versionParts(a), right = versionParts(b);
  return left[0] - right[0] || left[1] - right[1];
}

function latestRecord(records, id) {
  return records.filter(record => record.id === id).reduce((latest, record) => !latest || compareVersion(record.version, latest.version) > 0 ? record : latest, null);
}

export function nextVersion(records, id) {
  if (!Array.isArray(records)) fail('版本记录必须是数组。');
  idCheck(id);
  const latest = latestRecord(records, id);
  if (!latest) return 'V1.0';
  const [major, minor] = versionParts(latest.version);
  if (!Number.isSafeInteger(minor + 1)) fail('版本号已超出可支持范围。');
  return `V${major}.${minor + 1}`;
}

export function validateRecord(record, kind) {
  kindCheck(kind);
  if (!object(record)) fail('版本记录必须是对象。');
  if(record.sceneIds!==undefined)validateCatalogSceneIds(record.sceneIds);
  idCheck(record.id);
  versionParts(record.version);
  for (const [key, label, max] of [
    ['title', '名称', 120], ['category', '类别', 60], ['scope', '适用范围', 500],
    ['owner', '维护人', 80], ['changeNote', '变更说明', 2000],
  ]) textCheck(record[key], label, max);
  dateCheck(record.effectiveAt, '生效');
  if (record.expiresAt !== '') {
    dateCheck(record.expiresAt, '失效');
    if (record.expiresAt <= record.effectiveAt) fail('失效日期必须晚于生效日期。');
  }
  if (!STATUSES.includes(record.status)) fail('版本状态无效。');
  timeCheck(record.createdAt, '创建时间');
  if (record.status === '草稿' || record.status === '已弃用') {
    if (record.publishedAt !== '') fail('草稿不能包含发布时间。');
  } else timeCheck(record.publishedAt, '发布时间');
  if (kind === 'policies') {
    if (record.source !== undefined) textCheck(record.source, '来源说明', 2000, true);
    if (!Array.isArray(record.sections) || record.sections.length < 1 || record.sections.length > 500) fail('资料必须包含1至500条条款。');
    const identifiers = new Set();
    for (const section of record.sections) {
      if (!object(section)) fail('条款必须是对象。');
      idCheck(section.id, '条款标识');
      if (identifiers.has(section.id)) fail(`条款标识重复：${section.id}。`);
      identifiers.add(section.id);
      textCheck(section.title, '条款标题', 200);
      textCheck(section.text, '条款正文', 20000);
      if ((section.policyId !== undefined && section.policyId !== record.id) || (section.version !== undefined && section.version !== record.version)) fail(`条款归属与资料标识或版本不一致：${section.id}。`);
    }
  } else {
    if(record.english!==undefined){if(!object(record.english)||Object.keys(record.english).some(k=>!['title','summary','scope'].includes(k)))fail('规则英文展示字段无效。');for(const k of ['title','summary','scope'])textCheck(record.english[k],`英文${k}`,4000);}
    if(record.ruleKind!==undefined&&!RULE_KINDS.includes(record.ruleKind))fail('规则作用域类型无效。');
    if(record.provenance!==undefined)validateRuleProvenance(record.provenance);
    for (const [key, label] of [['passCriteria', '符合口径'], ['failCriteria', '不符合口径'], ['exceptionCriteria', '例外口径']]) textCheck(record[key], label, 4000);
    if (!Array.isArray(record.policyIds) || !record.policyIds.length || record.policyIds.length > 100) fail('规则依据资料必须为包含1至100个标识的数组。');
    const identifiers = new Set();
    for (const id of record.policyIds) {
      idCheck(id, '依据资料标识');
      if (identifiers.has(id)) fail(`依据资料标识重复：${id}。`);
      identifiers.add(id);
    }
  }
  return true;
}

function ruleReferences(catalog, record) {
  const known = new Set(catalog.policies.map(policy => policy.id));
  for (const id of record.policyIds) if (!known.has(id)) fail(`规则 ${record.id} 引用的依据资料不存在：${id}。`);
}

// 生效期是左闭右开区间；失效日期恰好等于下一版本生效日期时不重叠。
function overlap(a, b) {
  return (!a.expiresAt || b.effectiveAt < a.expiresAt) && (!b.expiresAt || a.effectiveAt < b.expiresAt);
}

export function validateCatalog(catalog) {
  if (!object(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.rules) || !Array.isArray(catalog.policies) || !Array.isArray(catalog.events)) fail('目录结构或事件记录无效。');
  validateRuleSets(catalog.ruleSets);
  if(catalog.deletedRules!==undefined&&!Array.isArray(catalog.deletedRules))fail('规则删除审计格式无效。');
  const deletedKeys=new Set(),operations=new Set();
  for(const entry of catalog.deletedRules||[]){
    if(!object(entry)||!object(entry.snapshot))fail('规则删除审计缺少内容快照。');
    validateRecord(entry.snapshot,'rules');ruleReferences(catalog,entry.snapshot);
    if(entry.snapshot.status!=='已停用'||entry.id!==entry.snapshot.id||entry.version!==entry.snapshot.version)fail('规则删除审计内容不一致。');
    textCheck(entry.actor,'删除人',80);textCheck(entry.reason,'删除原因',2000);textCheck(entry.operationId,'删除操作标识',128);timeCheck(entry.at);
    const k=JSON.stringify([entry.id,entry.version]);if(deletedKeys.has(k)||operations.has(entry.operationId)||catalog.rules.some(r=>r.id===entry.id&&r.version===entry.version))fail('已删除规则版本不得重复或重新使用。');deletedKeys.add(k);operations.add(entry.operationId);
  }
  for (const kind of KINDS) {
    const keys = new Set();
    const published = [];
    for (const record of catalog[kind]) {
      validateRecord(record, kind);
      const key = JSON.stringify([record.id, record.version]);
      if (keys.has(key)) fail(`目录标识和版本重复：${record.id} ${record.version}。`);
      keys.add(key);
      if (kind === 'rules') ruleReferences(catalog, record);
      if (record.status === '已发布') {
        if (published.some(previous => previous.id === record.id && overlap(previous, record))) fail(`已发布版本生效期重叠：${record.id}。`);
        published.push(record);
      }
    }
  }
  for (const event of catalog.events) {
    if (!object(event)) fail('目录事件无效。');
    if(event.kind==='ruleSets'){
      idCheck(event.id,'事件关联标识');ruleSetNumericVersion(event.version);textCheck(event.action,'事件动作',120);timeCheck(event.at,'事件时间');
      if(!catalog.ruleSets?.some(record=>record.ruleSetId===event.id&&record.version===event.version))fail('目录事件关联规则集版本不存在。');
      continue;
    }
    kindCheck(event.kind);
    idCheck(event.id, '事件关联标识');
    versionParts(event.version);
    textCheck(event.action, '事件动作', 120);
    timeCheck(event.at, '事件时间');
    if (!catalog[event.kind].some(record => record.id === event.id && record.version === event.version)&&!(event.kind==='rules'&&deletedKeys.has(JSON.stringify([event.id,event.version])))) fail('目录事件关联版本不存在。');
  }
  return true;
}

/** Production catalogs start without unconfirmed policies or rules. */
export function createBusinessCatalog() {
  return { schemaVersion: 1, rules: [], policies: [], events: [] };
}

/** Legacy fixture initializer; business startup uses createBusinessCatalog. */
export function createCatalog() {
  const common = { expiresAt: '', changeNote: '初始化虚构演示版本', status: '已发布', createdAt: INITIAL_TIME, publishedAt: INITIAL_TIME };
  return {
    schemaVersion: 1,
    rules: builtInRules.map(rule => ({
    ...common, sceneIds:['新品产品咨询'], ruleKind:'session-check', id: rule.id, version: rule.version, title: rule.name, category: rule.category,
      scope: rule.scope, effectiveAt: '2026-10-01', owner: '演示规则维护人',
      passCriteria: rule.passCriteria, failCriteria: rule.failCriteria, exceptionCriteria: rule.exceptionCriteria, policyIds: [...rule.policyIds],
    })),
    policies: builtInPolicies.map(policy => ({
    ...common, sceneIds:['新品产品咨询'], id: policy.id, version: policy.version, title: policy.title, category: policy.category,
      scope: '星澜商城虚构售前服务', effectiveAt: policy.effectiveAt, owner: '演示资料维护人',
      source: '内置虚构演示资料', sections: clone(policy.sections),
    })),
    events: [],
  };
}

export const createDemoCatalog = createCatalog;

function changesCheck(changes, id, version) {
  if (!object(changes)) fail('版本变更必须是对象。');
  if (changes.id !== undefined && changes.id !== id) fail('版本标识不能修改。');
  if (version && changes.version !== undefined && changes.version !== version) fail('草稿版本号不能修改，请创建新版本。');
}

function editableChanges(changes, kind) {
  const keys = [...COMMON_FIELDS, ...(kind === 'rules' ? RULE_FIELDS : ['source', 'sections'])];
  return Object.fromEntries(keys.filter(key => Object.hasOwn(changes, key)).map(key => [key, clone(changes[key])]));
}

function checkNewVersion(records, id, version) {
  versionParts(version);
  if (records.some(record => record.id === id && record.version === version)) fail(`标识和版本重复：${id} ${version}。`);
  const latest = latestRecord(records, id);
  if (latest && compareVersion(version, latest.version) <= 0) fail(`新版本必须高于已有最高版本 ${latest.version}。`);
}

function findRecord(catalog, kind, id, version) {
  const record = catalog[kind].find(item => item.id === id && item.version === version);
  if (!record) fail(`版本不存在：${id} ${version}。`);
  return record;
}

function addEvent(catalog, kind, record, action, at) {
  catalog.events.push({ kind, id: record.id, version: record.version, action, at });
}

export function createDraft(catalog, kind, id, changes = {}, now = DEFAULT_NOW) {
  kindCheck(kind);
  validateCatalog(catalog);
  timeCheck(now);
  idCheck(id);
  changesCheck(changes, id);
  const previous = latestRecord(catalog[kind], id);
  const history=kind==='rules'?[...catalog.rules,...(catalog.deletedRules||[]).map(item=>item.snapshot)]:catalog[kind];
  const version = changes.version ?? nextVersion(history, id);
  checkNewVersion(history, id, version);
  const inherited = previous ? clone(previous) : { effectiveAt: now.slice(0, 10), expiresAt: '' };
  // 原目录已通过归属校验；复制到新版本时去掉条款携带的旧版本元数据。
  // 显式传入的新条款仍在合并后按目标版本校验，不能借复制绕过归属检查。
  if (kind === 'policies' && previous) inherited.sections = canonicalSections(previous.sections);
  const draft = {
    ...inherited,
    ...editableChanges(changes, kind), id, version, status: '草稿', createdAt: now, publishedAt: '',
  };
  if(kind==='rules'&&previous?.english&&!Object.hasOwn(changes,'english')&&['title','scope','passCriteria','failCriteria','exceptionCriteria'].some(k=>Object.hasOwn(changes,k)&&changes[k]!==previous[k]))delete draft.english;
  if(kind==='rules'&&draft.ruleKind===undefined)draft.ruleKind=normalizeRuleKind(draft).ruleKind;
  validateRecord(draft, kind);
  if (kind === 'policies') draft.sections = canonicalSections(draft.sections);
  if (kind === 'rules') ruleReferences(catalog, draft);
  const next = clone(catalog);
  next[kind].push(draft);
  addEvent(next, kind, draft, '创建草稿', now);
  return next;
}

export function updateDraft(catalog, kind, id, version, changes = {}, now = DEFAULT_NOW) {
  kindCheck(kind);
  validateCatalog(catalog);
  timeCheck(now);
  const existing = findRecord(catalog, kind, id, version);
  if (existing.status !== '草稿') fail('只有草稿可以编辑；已发布或已停用内容必须创建新版本。');
  changesCheck(changes, id, version);
  const updated = { ...clone(existing), ...editableChanges(changes, kind) };
  if(kind==='rules'&&existing.english&&!Object.hasOwn(changes,'english')&&['title','scope','passCriteria','failCriteria','exceptionCriteria'].some(k=>Object.hasOwn(changes,k)&&changes[k]!==existing[k]))delete updated.english;
  if(kind==='rules'&&updated.ruleKind===undefined)updated.ruleKind=normalizeRuleKind(updated).ruleKind;
  validateRecord(updated, kind);
  if (kind === 'policies') updated.sections = canonicalSections(updated.sections);
  if (kind === 'rules') ruleReferences(catalog, updated);
  const next = clone(catalog);
  next[kind][next[kind].findIndex(record => record.id === id && record.version === version)] = updated;
  addEvent(next, kind, updated, '更新草稿', now);
  return next;
}

/** Scene ownership is editable metadata, even for a published version. */
export function assignCatalogScenes(catalog,kind,id,version,sceneIds,now=DEFAULT_NOW){
  kindCheck(kind);validateCatalog(catalog);timeCheck(now);validateCatalogSceneIds(sceneIds);
  const next=clone(catalog),record=findRecord(next,kind,id,version);
  record.sceneIds=[...sceneIds];
  addEvent(next,kind,record,'维护场景归属',now);
  validateCatalog(next);return next;
}

/** Scope changes affect future tasks; historical snapshots keep their saved scope. */
export function assignRuleKind(catalog,id,version,ruleKind,now=DEFAULT_NOW){
  validateCatalog(catalog);timeCheck(now);
  if(!RULE_KINDS.includes(ruleKind))fail('规则作用域类型无效。');
  const next=clone(catalog),record=findRecord(next,'rules',id,version);
  record.ruleKind=ruleKind;
  addEvent(next,'rules',record,ruleKind==='meta'?'标记交付物要求':'标记会话检核',now);
  validateCatalog(next);return next;
}

/** Abandon retains the draft and its history; no event can lose its target. */
export function abandonDraft(catalog,kind,id,version,now=DEFAULT_NOW){
  kindCheck(kind);validateCatalog(catalog);timeCheck(now);
  const next=clone(catalog),record=findRecord(next,kind,id,version);
  if(record.status!=='草稿')fail('只有草稿可以弃用。');
  record.status='已弃用';addEvent(next,kind,record,'弃用草稿',now);
  validateCatalog(next);return next;
}

export function publishVersion(catalog, kind, id, version, { closePrevious = false } = {}, now = DEFAULT_NOW) {
  kindCheck(kind);
  validateCatalog(catalog);
  timeCheck(now);
  const existing = findRecord(catalog, kind, id, version);
  if (existing.status !== '草稿') fail('只有草稿可以发布。');
  if (typeof closePrevious !== 'boolean') fail('生效期衔接确认必须为布尔值。');
  if (kind === 'rules') ruleReferences(catalog, existing);
  const next = clone(catalog);
  const draft = findRecord(next, kind, id, version);
  for (const previous of next[kind].filter(record => record.id === id && record.status === '已发布' && overlap(record, draft))) {
    if (!previous.expiresAt && previous.effectiveAt < draft.effectiveAt) {
      if (!closePrevious) fail('上一已发布版本没有失效日期，请明确确认生效期衔接。');
      previous.expiresAt = draft.effectiveAt;
    } else fail(`生效期与已发布版本 ${previous.version} 重叠，无法发布。`);
  }
  draft.status = '已发布';
  draft.publishedAt = now;
  addEvent(next, kind, draft, '发布版本', now);
  validateCatalog(next);
  return next;
}

export function retireVersion(catalog, kind, id, version, now = DEFAULT_NOW) {
  kindCheck(kind);
  validateCatalog(catalog);
  timeCheck(now);
  const existing = findRecord(catalog, kind, id, version);
  if (existing.status !== '已发布') fail('只有已发布版本可以停用，草稿或已停用版本不能重复停用。');
  const next = clone(catalog);
  const retired = findRecord(next, kind, id, version);
  retired.status = '已停用';
  addEvent(next, kind, retired, '停用版本', now);
  return next;
}

export function importPolicies(catalog, records, now = DEFAULT_NOW) {
  validateCatalog(catalog);
  timeCheck(now);
  if (!Array.isArray(records) || !records.length || records.length > 50) fail('每次导入必须包含1至50个资料版本。');
  const next = clone(catalog);
  const keys = new Set();
  // 每一行先对原目录验证，避免文件排列顺序影响同一资料的多版本导入。
  const drafts = records.map(record => {
    if (!object(record)) fail('导入资料版本必须是对象。');
    const draft = {
      ...editableChanges(record, 'policies'), id: record.id, version: record.version,
      expiresAt: record.expiresAt ?? '', status: '草稿', createdAt: now, publishedAt: '',
    };
    validateRecord(draft, 'policies');
    checkNewVersion(catalog.policies, draft.id, draft.version);
    const key = JSON.stringify([draft.id, draft.version]);
    if (keys.has(key)) fail(`导入文件中的资料标识和版本重复：${draft.id} ${draft.version}。`);
    keys.add(key);
    // 文件解析器可携带归属字段；校验通过后仅保留条款标准字段。
    draft.sections = canonicalSections(draft.sections);
    return draft;
  });
  if (drafts.reduce((total, record) => total + record.sections.length, 0) > 500) fail('单次导入条款总数不能超过500条。');
  for (const draft of drafts) {
    next.policies.push(draft);
    addEvent(next, 'policies', draft, '导入草稿', now);
  }
  validateCatalog(next);
  return next;
}

export function importRules(catalog,records,now=DEFAULT_NOW){
  validateCatalog(catalog);timeCheck(now);
  if(!Array.isArray(records)||!records.length||records.length>50)fail('每次导入必须包含1至50个规则版本。');
  let next=catalog;
  // Ascending order allows several new versions of one rule in either file order.
  for(const record of records.slice().sort((a,b)=>compareVersion(a.version,b.version)))next=createDraft(next,'rules',record.id,{...record,sceneIds:record.sceneIds??[]},now);
  return next;
}

export function compareVersions(before, after) {
  const labels = {
    id: '标识', version: '版本号', title: '名称', category: '类别', scope: '适用范围', sceneIds:'场景归属', ruleKind:'规则作用域类型',
    effectiveAt: '生效日期', expiresAt: '失效日期', owner: '维护人', changeNote: '变更说明',
    source: '来源说明', status: '状态', createdAt: '创建时间', publishedAt: '发布时间',
    passCriteria: '符合口径', failCriteria: '不符合口径', exceptionCriteria: '例外口径', policyIds: '依据资料',
  };
  const fields = Object.entries(labels).filter(([key]) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])).map(([key, label]) => ({ key, label, before: clone(before?.[key] ?? null), after: clone(after?.[key] ?? null) }));
  const left = new Map((before?.sections || []).map(section => [section.id, section]));
  const right = new Map((after?.sections || []).map(section => [section.id, section]));
  const sections = [...new Set([...left.keys(), ...right.keys()])].map(id => {
    const previous = left.get(id), next = right.get(id);
    const status = !previous ? '新增' : !next ? '删除' : previous.title !== next.title || previous.text !== next.text ? '修改' : '未变';
    return { id, status, before: clone(previous ?? null), after: clone(next ?? null) };
  });
  return { fields, sections };
}
