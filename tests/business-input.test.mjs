import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import JSZip from 'jszip';
import { workbook, readXlsx } from '../public/io.mjs';

const url = new URL('../public/business-input.mjs', import.meta.url);
const api = existsSync(url) ? await import(url) : {};
const INFO = ['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'];
const TURNS = ['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'];
const sample = (overrides = {}) => ({ id: 'REAL-001', scene: '新品产品咨询', startedAt: '2026-10-29T09:30:00+08:00', topic: '新上市耳机的佩戴方式', channel: '业务渠道A', product: '业务耳机Q', agent: '客服甲', customer: '客户乙', completeness: '完整', missingNote: '', turns: [{ id: 1, role: '客户', speaker: '客户乙', at: '2026-10-29T09:30:05+08:00', text: '请保留我的实际问题与标点：<> & =1+1' }, { id: 2, role: '客服', speaker: '客服甲', at: '', text: '请说明您希望了解的佩戴场景。' }], ...overrides });
const source = (sessions = [sample()]) => ({ format: 'SERVICE_QUALITY_INPUT_V1', sessions });
const file = (value, name = '业务会话.json', size) => { const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)); return { name, size: size ?? bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }; };
async function parse(value, name) { assert.equal(typeof api.parseBusinessInput, 'function', '实现业务输入解析'); return api.parseBusinessInput(file(value, name)); }
async function rejected(value, pattern, name) { const result = await parse(value, name); assert.equal(result.valid, false, result.errors.join('；')); assert.deepEqual(result.sessions, []); assert.equal(result.turnCount, 0); assert.match(result.errors.join('；'), pattern); return result; }
const infoRow = s => [s.id,s.scene,s.startedAt,s.topic,s.channel,s.product,s.agent,s.customer,s.completeness,s.missingNote];
const turnRows = s => s.turns.map(t => [s.id,t.id,t.role,t.speaker,t.at,t.text]);
async function xlsx(sessions = [sample()], extras = []) { return workbook([{ name: '会话信息', headers: INFO, rows: sessions.map(infoRow) }, { name: '会话明细', headers: TURNS, rows: sessions.flatMap(turnRows) }, ...extras]); }
async function mutate(bytes, edit) { const zip = await JSZip.loadAsync(bytes); await edit(zip); return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); }
async function xmlEdit(zip, path, change) { zip.file(path, change(await zip.file(path).async('string'))); }

test('business JSON preserves actual metadata and original turns without preset results', async () => {
  const session = sample({ metadata: { campaign: '实际活动', extra: 42 } });
  session.turns[0].metadata = { attachment: '附图说明' };
  const result = await parse(source([session]));
  assert.equal(result.valid, true, result.errors.join('；'));
  assert.deepEqual(result.sessions, [session]);
  assert.equal(result.turnCount, 2);
  assert.equal(result.sessions[0].aiResults, undefined);
  assert.notEqual(result.sessions[0], session);
});

test('marker, sessions, supported scene and one scene per file are required', async () => {
  await rejected({ sessions: [sample()] }, /format|标记/);
  await rejected(source([]), /会话/);
  await rejected(source([sample({ scene: '其他' })]), /业务场景|scene/);
  await rejected(source([sample(), sample({ id: 'REAL-002', scene: '电商评论回复' })]), /分批|场景/);
  assert.equal((await parse(source([sample({ scene: '电商评论回复' })]))).valid, true);
});

test('invalid calendar dates and missing timezone cannot be normalized into valid dates', async () => {
  for (const invalid of ['2026-02-29T09:30:00+08:00','2026-04-31T09:30:00Z','2026-13-01T09:30:00Z','2026-10-29T25:30:00Z','2026-10-29T09:30:00','2026-10-29 09:30:00+08:00','2026-10-29T09:30:00+25:00']) await rejected(source([sample({ startedAt: invalid })]), /会话信息.*行.*startedAt|会话开始时间/);
  assert.equal((await parse(source([sample({ startedAt: '2024-02-29T09:30:00.123Z' })]))).valid, true);
  const session = sample(); session.turns[0].at = '2026-02-30T09:30:00Z';
  await rejected(source([session]), /会话明细.*行.*at|发言时间/);
});

test('session IDs and positive integer turn IDs reject duplicates after normalization', async () => {
  await rejected(source([sample(), sample()]), /重复/);
  await rejected(source([sample(), sample({ id: ' REAL-001 ' })]), /重复/);
  for (const id of [0,-1,1.2,'1.5','bad',true]) { const s = sample(); s.turns[0].id = id; await rejected(source([s]), /轮次|id/); }
  const s = sample(); s.turns[1].id = '01'; await rejected(source([s]), /重复/);
  const normalized = sample(); normalized.turns[0].id = '01';
  assert.equal((await parse(source([normalized]))).sessions[0].turns[0].id, 1);
});

test('session identifiers obey the backend 160 character limit before creating a task', async () => {
  assert.equal((await parse(source([sample({ id: 'A'.repeat(160) })]))).valid, true);
  await rejected(source([sample({ id: 'A'.repeat(161) })]), /会话信息.*行.*id.*160/);
  await rejected(await xlsx([sample({ id: 'A'.repeat(161) })]), /会话信息.*行.*会话ID.*160/, 'long-id.xlsx');
});

test('missing content, invalid roles and incomplete sessions without explanation are rejected', async () => {
  await rejected(source([sample({ turns: [] })]), /轮次|原文/);
  for (const change of [s => { s.turns[0].text = ' \n '; }, s => { s.turns[0].role = '访客'; }, s => { s.turns[0].text = 42; }]) { const s = sample(); change(s); await rejected(source([s]), /会话明细.*行.*text|原文|角色/); }
  await rejected(source([sample({ completeness: '部分缺失' })]), /缺失说明|missingNote/);
  await rejected(source([sample({ completeness: '不确定' })]), /完整性|completeness/);
  assert.equal((await parse(source([sample({ completeness: '部分缺失', missingNote: '截图未提供' })]))).valid, true);
});

test('evaluation answers, timings, rules and imported preset results cannot enter daily work', async () => {
  for (const key of ['answers','timings','cases','rules','policies','验证案例','人工耗时']) await rejected({ ...source(), [key]: [{ secret: '不能混入' }] }, /日常|评测|耗时|规则|资料|字段/);
  for (const key of ['aiResults','review','expectedRuleIds','taskId','basisSnapshot','externalId']) await rejected(source([sample({ [key]: [] })]), /日常|结果|审核|保留|字段/);
});

test('business limits reject over 500 sessions, 500 turns, 20000 characters and 8MB', async () => {
  await rejected(source(Array.from({ length: 501 }, (_, i) => sample({ id: `S-${i}` }))), /500/);
  await rejected(source([sample({ turns: Array.from({ length: 501 }, (_, i) => ({ id: i + 1, role: '客户', speaker: '', at: '', text: '原文' })) })]), /500/);
  const s = sample(); s.turns[0].text = '文'.repeat(20001); await rejected(source([s]), /20000/);
  assert.equal((await parse(source([sample({ turns: [{ id: 1, role: '系统', speaker: '', at: '', text: '文'.repeat(20000) }] })]))).valid, true);
  const result = await api.parseBusinessInput(file(source(), 'large.json', 8 * 1024 * 1024 + 1)); assert.equal(result.valid, false); assert.match(result.errors.join('；'), /8MB/);
  await rejected(' '.repeat(8 * 1024 * 1024 + 1), /8MB/);
});

test('blank template contains exactly two clear sheets and a wholly new fictional sample round trips', async () => {
  assert.equal(typeof api.createBusinessXlsx, 'function', '实现业务空模板与新虚构样例');
  const empty = await api.createBusinessXlsx({ sample: false });
  const tables = await readXlsx(empty);
  assert.deepEqual(Object.keys(tables), ['会话信息','会话明细']); assert.deepEqual(tables['会话信息'], [INFO]); assert.deepEqual(tables['会话明细'], [TURNS]);
  await rejected(empty, /没有|会话|原文/, 'blank.xlsx');
  const bytes = await api.createBusinessXlsx({ sample: true }); const parsed = await parse(bytes, 'sample.xlsx');
  assert.equal(parsed.valid, true, parsed.errors.join('；')); assert.ok(parsed.sessions.length); assert.ok(parsed.turnCount);
  assert.ok(parsed.sessions.every(s => !/^DEMO_PRE/.test(s.id) && s.turns.every(t => !t.text.includes('星澜'))));
  const zip = await JSZip.loadAsync(bytes); assert.doesNotMatch(await zip.file('xl/worksheets/sheet2.xml').async('string'), /<f(?:\s|>)/);
});

test('business XLSX retains all actual metadata including extra nonempty columns', async () => {
  const s = sample();
  const bytes = await workbook([{ name: '会话信息', headers: [...INFO,'关联工单'], rows: [[...infoRow(s),'CASE-REAL-3']] }, { name: '会话明细', headers: [...TURNS,'附件说明'], rows: turnRows(s).map(row => [...row,'实际附件说明']) }]);
  const result = await parse(bytes, 'business.xlsx'); assert.equal(result.valid, true, result.errors.join('；'));
  assert.deepEqual(result.sessions[0], { ...s, metadata: { 关联工单: 'CASE-REAL-3' }, turns: s.turns.map(t => ({ ...t, metadata: { 附件说明: '实际附件说明' } })) });
});

test('XLSX orphan turns, duplicate headers and absent required fields produce contextual errors', async () => {
  const bytes = await xlsx();
  const orphan = await mutate(bytes, zip => xmlEdit(zip, 'xl/worksheets/sheet2.xml', xml => xml.replace('REAL-001','ORPHAN')));
  await rejected(orphan, /会话明细.*行.*会话ID.*不存在/, 'orphan.xlsx');
  const duplicate = await mutate(bytes, zip => xmlEdit(zip, 'xl/worksheets/sheet1.xml', xml => xml.replace('业务场景','会话ID')));
  await rejected(duplicate, /会话信息.*重复|业务场景/, 'duplicate.xlsx');
  const missing = await mutate(bytes, zip => xmlEdit(zip, 'xl/worksheets/sheet1.xml', xml => xml.replace('会话开始时间','未识别')));
  await rejected(missing, /会话信息.*行.*会话开始时间/, 'missing.xlsx');
});

test('XLSX populated unknown tables including evaluation/timing tables are never silently discarded', async () => {
  for (const name of ['验证案例','人工耗时','其他业务']) await rejected(await xlsx([sample()], [{ name, headers: ['记录'], rows: [['真实内容']] }]), /工作表.*验证案例|工作表.*人工耗时|工作表.*其他业务/, 'mixed.xlsx');
  const emptyExtra = await parse(await xlsx([sample()], [{ name: '空表', headers: [], rows: [] }]), 'empty-extra.xlsx');
  assert.equal(emptyExtra.valid, true, emptyExtra.errors.join('；')); assert.ok(emptyExtra.warnings.some(w => /空表/.test(w)));
});

test('XLSX unsafe formulas, DTD, macros and external relationships retain existing reader protections', async () => {
  const bytes = await xlsx();
  for (const edit of [
    zip => xmlEdit(zip, 'xl/worksheets/sheet2.xml', xml => xml.replace('<is>', '<f>SUM(1,1)</f><is>')),
    zip => xmlEdit(zip, 'xl/worksheets/sheet1.xml', xml => xml.replace('<worksheet', '<!DOCTYPE foo [<!ENTITY x "bad">]><worksheet')),
    zip => { zip.file('xl/vbaProject.bin', new Uint8Array([1])); },
    zip => xmlEdit(zip, 'xl/_rels/workbook.xml.rels', xml => xml.replace('Target="worksheets/sheet1.xml"', 'Target="https://example.invalid/x" TargetMode="External"')),
  ]) await rejected(await mutate(bytes, edit), /公式|声明|宏|外部/, 'unsafe.xlsx');
});

test('literal formula-like strings remain text and unsupported or malformed files fail clearly', async () => {
  const s = sample({ turns: [{ id: 1, role: '客户', speaker: '=customer', at: '', text: '=HYPERLINK("https://example.invalid")' }] });
  const result = await parse(await xlsx([s]), 'literal.xlsx'); assert.equal(result.valid, true, result.errors.join('；')); assert.deepEqual(result.sessions[0].turns, s.turns);
  await rejected(source(), /xlsx|json/i, 'wrong.csv'); await rejected('{invalid', /JSON/); await rejected('', /空/);
});
test('sparse XLSX errors identify the physical worksheet row rather than its array index',async()=>{
  const s=sample({turns:[{id:1,role:'访客',speaker:'实际用户',at:'',text:'待检查的原文'}]});
  const sparse=await mutate(await xlsx([s]),zip=>xmlEdit(zip,'xl/worksheets/sheet2.xml',xml=>xml.replace(/r="([A-Z]*)2"/g,(_,column)=>`r="${column}20"`).replace('A1:F2','A1:F20')));
  await rejected(sparse,/会话明细第20行【发言角色】/,'sparse.xlsx');
});
const packageAttacks=[
  ['macro content type',zip=>xmlEdit(zip,'[Content_Types].xml',xml=>xml.replace('spreadsheetml.sheet.main+xml','ms-excel.sheet.macroEnabled.main+xml'))],
  ['encoded macro content type',zip=>xmlEdit(zip,'[Content_Types].xml',xml=>xml.replace('spreadsheetml.sheet.main+xml','ms-excel.sheet.macro&#69;nabled.main+xml'))],
  ['sheet external relationship',zip=>{zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="link" TargetMode="External" Target="https://example.invalid"/></Relationships>');}],
  ['encoded external relationship',zip=>{zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="link" TargetMode="&#69;xternal" Target="https://example.invalid"/></Relationships>');}],
  ['network path relationship',zip=>{zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="link" Target="//example.invalid"/></Relationships>');}],
  ['encoded vba relationship type',zip=>{zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="macro" Type="http://schemas.microsoft.com/office/2006/relationships/&#118;baProject" Target="payload.bin"/></Relationships>');zip.file('xl/payload.bin','macro');}],
  ['greater-than inside relationship attribute',zip=>{zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="link" Target="https://example.invalid/>x" TargetMode="External"/></Relationships>');}],
];
for(const [name,attack] of packageAttacks)test(`shared XLSX reader rejects ${name} anywhere in package`,async()=>{
  const unsafe=await mutate(await xlsx(),attack);await rejected(unsafe,/宏|外部/,'package-unsafe.xlsx');
  await assert.rejects(()=>readXlsx(unsafe),/宏|外部/);
});
