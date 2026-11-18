// 日常业务原文入口；只解析材料，不产生或装载任何 AI 判定。
import { readXlsx, workbook, XLSX_ROW_NUMBER } from './io.mjs';
import {isSceneKey} from './scenarios.mjs';

const FORMAT = 'SERVICE_QUALITY_INPUT_V1';
const MAX_FILE = 8 * 1024 * 1024;
const MAX_SESSIONS = 500;
const MAX_TURNS = 500;
const MAX_TEXT = 20000;
const ROLES = ['客户', '客服', '系统'];
const RESERVED = ['aiResults', 'review', 'expectedRuleIds', 'taskId', 'basisSnapshot', 'externalId'];
const INFO_FIELDS = { id: '会话ID', scene: '业务场景', startedAt: '会话开始时间', topic: '会话主题', channel: '渠道', product: '产品型号', agent: '客服标识', customer: '客户标识', completeness: '会话完整性', missingNote: '缺失说明' };
const TURN_FIELDS = { id: '轮次序号', role: '发言角色', speaker: '发言方标识', at: '发言时间', text: '原文内容' };
const INFO_HEADERS = Object.values(INFO_FIELDS);
const TURN_HEADERS = ['会话ID', ...Object.values(TURN_FIELDS)];
const text = value => String(value ?? '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const populated = value => value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '');
const errorAt = (errors, sheet, row, field, message) => errors.push(`${sheet}第${row}行【${field}】：${message}`);

// Date.parse 会把 2 月 30 日等日期归一化，因此先逐个检查本地日历字段。
function validIso(value) {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return false;
  const [, year, month, day, hour, minute, second] = m;
  const [y, mo, d, h, mi, s] = [year, month, day, hour, minute, second].map(Number);
  if (y < 1 || mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]) return false;
  if (m[8] && (Number(m[9]) > 14 || Number(m[10]) > 59 || (Number(m[9]) === 14 && Number(m[10]) !== 0))) return false;
  return Number.isFinite(Date.parse(value));
}

function validateSessions(input, errors, locations = new WeakMap(), xlsx = false) {
  if (!Array.isArray(input) || !input.length) {
    errorAt(errors, '会话信息', 2, xlsx ? '会话ID' : 'sessions', '没有可导入的业务会话。');
    return [];
  }
  if (input.length > MAX_SESSIONS) errorAt(errors, '会话信息', 2, 'sessions', '每个文件最多500个会话，请分批导入。');
  const ids = new Set(), scenes = new Set();
  const output = [];
  input.forEach((raw, index) => {
    const row = locations.get(raw) ?? index + 2;
    const info = (key, message) => errorAt(errors, '会话信息', row, xlsx ? INFO_FIELDS[key] ?? key : key, message);
    if (!object(raw)) { info('sessions', '会话必须是对象。'); return; }
    for (const key of RESERVED) if (Object.hasOwn(raw, key)) info(key, '日常原文不能携带预置结果、审核或任务保留字段。');
    for (const key of Object.keys(INFO_FIELDS)) if (typeof raw[key] !== 'string') info(key, '必需字段必须为文本；无值时请保留空字符串。');
    const normalizedId = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!normalizedId) info('id', '会话ID不能为空。');
    else if (normalizedId.length > 160) info('id', '会话ID最多160字符，请使用业务系统稳定的短标识。');
    else if (ids.has(normalizedId)) info('id', `会话ID规范化后重复：${normalizedId}。`);
    ids.add(normalizedId);
    if (!isSceneKey(raw.scene)) info('scene', '业务场景须为内置场景或合法的SCENE-场景标识。');
    else scenes.add(raw.scene);
    if (!validIso(raw.startedAt)) info('startedAt', '须填写真实日历日期且包含时区的ISO时间，例如2026-10-29T09:30:00+08:00。');
    if (!['完整', '部分缺失'].includes(raw.completeness)) info('completeness', '会话完整性仅支持完整或部分缺失。');
    if (raw.completeness === '部分缺失' && (typeof raw.missingNote !== 'string' || !raw.missingNote.trim())) info('missingNote', '部分缺失时必须填写缺失说明。');
    const session = structuredClone(raw);
    session.id = normalizedId;
    if (!Array.isArray(raw.turns) || !raw.turns.length) { info('turns', '至少需要一轮非空原文。'); session.turns = []; output.push(session); return; }
    if (raw.turns.length > MAX_TURNS) info('turns', '每个会话最多500轮，请分批整理后导入。');
    const turnIds = new Set();
    session.turns = raw.turns.map((turn, turnIndex) => {
      const turnRow = locations.get(turn) ?? turnIndex + 2;
      const issue = (key, message) => errorAt(errors, '会话明细', turnRow, xlsx ? TURN_FIELDS[key] ?? key : key, `${normalizedId || '未填会话ID'}：${message}`);
      if (!object(turn)) { issue('turns', '轮次必须是对象。'); return {}; }
      const integer = (typeof turn.id === 'number' && Number.isSafeInteger(turn.id)) || (typeof turn.id === 'string' && /^\d+$/.test(turn.id.trim()));
      const turnId = integer ? Number(turn.id) : NaN;
      if (!Number.isSafeInteger(turnId) || turnId < 1) issue('id', '轮次序号须为正整数。');
      else if (turnIds.has(turnId)) issue('id', `轮次序号规范化后重复：${turnId}。`);
      turnIds.add(turnId);
      if (!ROLES.includes(turn.role)) issue('role', '发言角色仅支持客户、客服或系统。');
      if (typeof turn.speaker !== 'string') issue('speaker', '发言方标识必须为文本，可留空。');
      if (turn.at !== '' && !validIso(turn.at)) issue('at', '发言时间须为含时区的真实ISO时间，或留空。');
      if (typeof turn.text !== 'string' || !turn.text.trim()) issue('text', '原文内容必须为非空文本。');
      else if (turn.text.length > MAX_TEXT) issue('text', '单轮原文内容最多20000字符。');
      return { ...structuredClone(turn), id: turnId };
    });
    output.push(session);
  });
  if (scenes.size > 1) errorAt(errors, '会话信息', 2, '业务场景', '同一文件不能混合业务场景，请按场景分批导入。');
  return output;
}

function jsonSessions(value, errors) {
  if (!object(value) || value.format !== FORMAT) {
    errorAt(errors, 'JSON', 1, 'format', `必须明确标记format=${FORMAT}。`);
    return [];
  }
  for (const key of Object.keys(value)) if (!['format', 'sessions'].includes(key)) errorAt(errors, 'JSON', 1, key, '日常文件仅接收原文会话；评测答案、人工耗时、规则和资料请分别管理。');
  return validateSessions(value.sessions, errors);
}

function sheetRecords(tables, name, required, errors) {
  if (!Object.hasOwn(tables, name)) { errorAt(errors, name, 1, '工作表', '缺少必需工作表。'); return []; }
  const [rawHeaders = [], ...rows] = tables[name];
  const headerRow=rawHeaders[XLSX_ROW_NUMBER]??1;
  const headers = rawHeaders.map(header => text(header).trim());
  const nonemptyHeaders = headers.filter(Boolean);
  for (const field of required) if (!headers.includes(field)) errorAt(errors, name, headerRow, field, '缺少必需字段。');
  if (new Set(nonemptyHeaders).size !== nonemptyHeaders.length) errorAt(errors, name, headerRow, '表头', '字段名重复。');
  return rows.flatMap((values, index) => {
    if (!values.some(populated)) return [];
    const row=values[XLSX_ROW_NUMBER]??index+2;
    values.forEach((value, column) => { if (populated(value) && !headers[column]) errorAt(errors, name, row, `第${column + 1}列`, '有内容的列缺少字段名，无法保留。'); });
    return [{ row, value: Object.fromEntries(headers.map((header, column) => [header, text(values[column])])) }];
  });
}

function tableSessions(tables, errors, warnings) {
  for (const [name, rows] of Object.entries(tables)) if (!['会话信息', '会话明细'].includes(name)) {
    if (rows.some(row => row.some(populated))) errorAt(errors, name, 1, '工作表', `未知工作表${name}含有内容；日常任务不能混入评测答案、耗时或其他数据表。`);
    else warnings.push(`已忽略无内容工作表：${name}。`);
  }
  const info = sheetRecords(tables, '会话信息', INFO_HEADERS, errors);
  const details = sheetRecords(tables, '会话明细', TURN_HEADERS, errors);
  const locations = new WeakMap(), byId = new Map();
  const sessions = info.map(({ row, value }) => {
    const session = Object.fromEntries(Object.entries(INFO_FIELDS).map(([key, field]) => [key, value[field]]));
    const metadata = Object.fromEntries(Object.entries(value).filter(([key, v]) => !INFO_HEADERS.includes(key) && populated(v)));
    if (Object.keys(metadata).length) session.metadata = metadata;
    session.turns = [];
    locations.set(session, row);
    const id = text(session.id).trim();
    // 重复会话由共同验证器拒绝；明细不复制到重复会话中。
    if (!byId.has(id)) byId.set(id, session);
    return session;
  });
  details.forEach(({ row, value }) => {
    const id = text(value['会话ID']).trim();
    const session = byId.get(id);
    if (!session) { errorAt(errors, '会话明细', row, '会话ID', `关联的会话ID不存在：${id || '未填写'}。`); return; }
    const turn = Object.fromEntries(Object.entries(TURN_FIELDS).map(([key, field]) => [key, value[field]]));
    const metadata = Object.fromEntries(Object.entries(value).filter(([key, v]) => !TURN_HEADERS.includes(key) && populated(v)));
    if (Object.keys(metadata).length) turn.metadata = metadata;
    locations.set(turn, row);
    session.turns.push(turn);
  });
  return validateSessions(sessions, errors, locations, true);
}

/** Parse one business JSON/XLSX file. Failed inputs return no partial sessions. */
export async function parseBusinessInput(file) {
  const errors = [], warnings = [];
  const result = sessions => ({ valid: errors.length === 0, errors: [...new Set(errors)], warnings, sessions: errors.length ? [] : sessions, turnCount: errors.length ? 0 : sessions.reduce((n, session) => n + session.turns.length, 0) });
  try {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择可读取的业务文件。');
    const extension = /\.([^.]+)$/.exec(text(file.name))?.[1]?.toLowerCase();
    if (!['xlsx', 'json'].includes(extension)) throw new Error('业务文件仅支持.xlsx或.json。');
    if (Number(file.size) > MAX_FILE) throw new Error('业务文件大小超过8MB，请分批导入。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength) throw new Error('业务文件为空。');
    if (bytes.byteLength > MAX_FILE) throw new Error('业务文件大小超过8MB，请分批导入。');
    let sessions;
    if (extension === 'json') {
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new Error('JSON格式无效或不是有效UTF-8文本。'); }
      sessions = jsonSessions(value, errors);
    } else sessions = tableSessions(await readXlsx(bytes), errors, warnings);
    return result(sessions);
  } catch (error) {
    const message = typeof error?.message === 'string' && /[\u3400-\u9fff]/.test(error.message) ? error.message : '业务文件无法读取，或XLSX压缩结构无效。';
    errorAt(errors, '文件', 1, '内容', message);
    return result([]);
  }
}

/** Only the two raw-data sheets are generated; every cell is inline text. */
export async function createBusinessXlsx({ sample = false } = {}) {
  const sessions = sample ? [{
    id: 'SAMPLE-EARBUD-001', scene: '新品产品咨询', startedAt: '2026-10-29T09:30:00+08:00',
    topic: '虚构新品耳机佩戴咨询', channel: '虚构样例渠道', product: '虚构拾音Q3耳机', agent: '虚构客服甲', customer: '虚构客户乙', completeness: '完整', missingNote: '',
    turns: [
      { id: 1, role: '客户', speaker: '虚构客户乙', at: '2026-10-29T09:30:05+08:00', text: '这款虚构耳机能更换不同尺寸的耳塞吗？' },
      { id: 2, role: '客服', speaker: '虚构客服甲', at: '2026-10-29T09:30:12+08:00', text: '我需要先核对您咨询的型号及正式随附配件清单，请稍候。' },
    ],
  }] : [];
  return workbook([
    { name: '会话信息', headers: INFO_HEADERS, rows: sessions.map(session => Object.keys(INFO_FIELDS).map(key => session[key])) },
    { name: '会话明细', headers: TURN_HEADERS, rows: sessions.flatMap(session => session.turns.map(turn => [session.id, ...Object.keys(TURN_FIELDS).map(key => turn[key])])) },
  ]);
}
