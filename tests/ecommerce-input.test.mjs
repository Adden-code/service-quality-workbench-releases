import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { workbook, readXlsx, XLSX_ROW_NUMBER } from '../public/io.mjs';
import { createCatalog, validateCatalog, createDraft, publishVersion } from '../public/catalog.mjs';
import { createBasisSnapshot } from '../public/task-basis.mjs';
import { validateContextFields } from '../public/context-fields.mjs';
import { createInitialState, createImportedTask } from '../public/domain.mjs';
import { validateWorkspace } from '../server/workspace-validation.mjs';

const moduleApi = async name => {
  const url = new URL(`../public/ecommerce-${name}.mjs`, import.meta.url);
  assert.ok(existsSync(url), `实现 ecommerce-${name}.mjs 模块`);
  return import(url);
};
const HEADERS = ['Region 区域','抽检周期','区域','国家','展示商品ID','订单编码','SKU编码','SKU名称','评论内容','回复内容','评分','管理员','评论时间','首次回复时间','评价类型','Is there any issue with the response time? 是否存在回复时效规范的问题','Is there any text quality issue? 是否存在文本质量问题','Is there an issue with responses not being sufficiently targeted? 是否存在回复不够针对的问题','Is there an issue with responses being insufficiently structured? 是否存在回复不够结构化的问题','Is there an issue with the public disclosure of private data? 是否存在隐私数据公开回复的问题','Overall Passed(整体是否通过)','Description of the specific problem point.(具体问题点描述)'];
const standards = () => Array.from({ length: 22 }, (_, i) => i >= 15 && i <= 19 ? `测试标准${i - 14}，不是评论原文` : '');
const row = (overrides = {}) => {
  const values = ['欧洲','2026-10','西欧','虚构国家','000000000000000123456789','000009876543210123456789','000000012345678901234567','虚构耳机','耳机佩戴舒适，感谢。','感谢您对虚构耳机佩戴体验的认可。','5','虚构管理员甲','2026-10-30 20:00:00','2026-10-31 20:00:00','PRIVATE-EVALUATION-TYPE','PRIVATE-ANSWER-TIME','PRIVATE-ANSWER-TEXT','PRIVATE-ANSWER-TARGET','PRIVATE-ANSWER-STEPS','PRIVATE-ANSWER-PRIVACY','PRIVATE-OVERALL','PRIVATE-PROBLEM'];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values;
};
const file = (bytes, { name = '电商评论.xlsx', size = bytes.byteLength } = {}) => ({ name, size, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const xlsx = (rows = [row()], { headers = HEADERS, standard = standards(), extra = [] } = {}) => workbook([{ name: 'Sheet4', headers, rows: [standard, ...rows] }, ...extra]);
const parse = async (bytes, options, fileOptions) => (await moduleApi('input')).parseEcommerceFile(file(bytes, fileOptions), options);
async function rejected(bytes, pattern, options, fileOptions) {
  const result = await parse(bytes, options, fileOptions);
  assert.equal(result.valid, false);
  assert.deepEqual(result.sessions, []);
  assert.equal(result.turnCount, 0);
  assert.match(result.errors.join('；'), pattern);
  return result;
}
const record = () => ({ schemaVersion: 1, sheet: 'Sheet4', row: 3, fileSha256: 'a'.repeat(64), headers: [...HEADERS], standards: standards(), raw: row(), thresholdHours: 24 });
const now = '2026-10-30T10:00:00+08:00';
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('ecommerce schema exports exactly five stable rule IDs and the ordered canonical 22 columns', async () => {
  const api = await moduleApi('schema');
  assert.deepEqual(api.EC_RULE_IDS, ['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY']);
  assert.deepEqual(api.EC_HEADERS, HEADERS);
  assert.equal(api.validateEcommerceRecord(record()), true);
});

test('Beijing time parsing accepts real local calendars and explicit +08 ISO without guessing numeric dates', async () => {
  const { parseBeijingTime } = await moduleApi('schema');
  for (const input of ['2026-10-30 20:00','2026/10/30 20:00:00','2026-10-30T20:00:00+08:00']) assert.equal(parseBeijingTime(input), '2026-10-30T20:00:00+08:00');
  assert.equal(parseBeijingTime(' 2024-02-29 00:00:00 '), '2024-02-29T00:00:00+08:00');
  assert.equal(parseBeijingTime('2026-10-30T20:00:00.123+08:00'), '2026-10-30T20:00:00.123+08:00');
  for (const value of ['', null, undefined, 46325, '46325','2026-02-29 10:00','2026-04-31 00:00','0000-01-01 00:00','2026-13-01 10:00','2026-01-00 10:00','2026-10-30 24:00','2026-10-30 20:60','2026-10-30 20:00:60','2026-10-30T20:00:00Z','2026-10-30T20:00:00+09:00']) assert.equal(parseBeijingTime(value), null, String(value));
});

test('record validation is closed, bounded and never coerces source cells', async () => {
  const { validateEcommerceRecord } = await moduleApi('schema');
  for (const mutate of [r => r.extra = true, r => r.schemaVersion = 2, r => r.sheet = 'Sheet1', r => r.row = 2, r => r.row = 1048577, r => r.row = 3.5, r => r.fileSha256 = 'A'.repeat(64), r => r.headers.pop(), r => r.standards[0] = 1, r => r.raw[5] = 12345678901234567890, r => r.raw[0] = '文'.repeat(20001), r => r.headers[0] = 'H'.repeat(161), r => r.thresholdHours = 0, r => r.thresholdHours = Infinity, r => r.thresholdHours = 720.1, r => r.thresholdHours = '24']) {
    const value = record(); mutate(value); assert.throws(() => validateEcommerceRecord(value), /电商|字段|行|表头|字符|阈值|摘要|结构|版本/);
  }
  const boundary = record(); boundary.row = 1048576; boundary.raw[0] = '文'.repeat(20000); boundary.headers[0] = 'H'.repeat(160); boundary.thresholdHours = 720;
  assert.equal(validateEcommerceRecord(boundary), true);
  boundary.thresholdHours = 0.25; assert.equal(validateEcommerceRecord(boundary), true);
});

test('Sheet4 import preserves long identifiers and every original cell, while excluding answer columns from context and turns', async () => {
  const original = row(); const bytes = await xlsx([original]); const before = bytes.slice();
  const parsed = await parse(bytes);
  assert.equal(parsed.valid, true, parsed.errors.join('；')); assert.equal(parsed.sessions.length, 1); assert.equal(parsed.turnCount, 2);
  const session = parsed.sessions[0], hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(session.id, `EC-${hash.slice(0, 32)}-Sheet4-3`);
  assert.equal(session.scene, '电商评论回复'); assert.equal(session.channel, '电商评论'); assert.equal(session.agent, original[11]);
  assert.equal(session.product, original[7]); assert.equal(session.customer, ''); assert.equal(session.completeness, '完整');
  assert.equal(session.startedAt, '2026-10-30T20:00:00+08:00');
  assert.deepEqual(session.ecommerce.raw, original); assert.deepEqual(session.ecommerce.standards, standards()); assert.equal(session.ecommerce.fileSha256, hash);
  assert.equal(session.ecommerce.thresholdHours, 24); assert.equal(validateContextFields(session.contextFields, session.turns), true);
  assert.deepEqual(session.turns.map(t => [t.id,t.role,t.text]), [[1,'客户',original[8]],[2,'客服',original[9]]]);
  const context = JSON.stringify({ fields: session.contextFields, turns: session.turns });
  assert.doesNotMatch(context, /PRIVATE|测试标准/);
  assert.equal(session.contextFields.find(f => f.key === 'orderCode'), undefined);
  assert.equal(session.contextFields.find(f => f.key === 'displayProductId'), undefined);
  assert.equal(session.ecommerce.raw[5], original[5]);
  assert.equal(session.contextFields.find(f => f.key === 'skuCode').value, original[6]);
  assert.deepEqual(session.contextFields.find(f => f.key === 'commentTime').source, { sheet: 'Sheet4', row: 3, column: HEADERS[12] });
  assert.deepEqual(bytes, before); assert.deepEqual(original, row());
});

test('same bytes always create stable tool IDs independent of filenames and parse result edits', async () => {
  const bytes = await xlsx([row(), row({ 8: '第二条虚构评论。' })]);
  const first = await parse(bytes), second = await parse(bytes, undefined, { name: '重命名.xlsx' });
  assert.deepEqual(first.sessions.map(s => s.id), second.sessions.map(s => s.id));
  assert.notEqual(first.sessions[0].id, first.sessions[1].id);
  first.sessions[0].ecommerce.raw[5] = '外部修改';
  assert.equal(second.sessions[0].ecommerce.raw[5], row()[5]);
});

test('Chinese, English and whitespace-normalized header aliases locate22 fields while missing core headers reject', async () => {
  const chinese = ['区域','抽检周期','区域','国家','展示商品ID','订单编码','SKU编码','SKU名称','评论内容','回复内容','评分','管理员','评论时间','首次回复时间','评价类型','是否存在回复时效规范的问题','是否存在文本质量问题','是否存在回复不够针对的问题','是否存在回复不够结构化的问题','是否存在隐私数据公开回复的问题','整体是否通过','具体问题点描述'];
  assert.equal((await parse(await xlsx([row()], { headers: chinese }))).valid, true);
  const english = ['Region','Sampling Period','Region','Country','Display Product ID','Order Code','SKU Code','SKU Name','Comment Content','Reply Content','Rating','Administrator','Comment Time','First Reply Time','Evaluation Type',...HEADERS.slice(15, 20).map(h => h.split('?')[0] + '?'),'Overall Passed','Description of the specific problem point.'];
  assert.equal((await parse(await xlsx([row()], { headers: english }))).valid, true);
  assert.equal((await parse(await xlsx([row()], { headers: HEADERS.map(h => ` \n${h.replaceAll(' ', '\n ')}\t`) }))).valid, true);
  const swapped = [...HEADERS]; [swapped[8], swapped[9]] = [swapped[9], swapped[8]];
  const reordered=await parse(await xlsx([row()], { headers: swapped }));assert.equal(reordered.valid,true,reordered.errors.join('；'));assert.equal(reordered.sessions[0].ecommerce.schemaVersion,4);assert.equal(reordered.sessions[0].ecommerce.raw[8],row()[9]);assert.equal(reordered.sessions[0].ecommerce.raw[9],row()[8]);
  const extension=await parse(await xlsx([row()], { headers: [...HEADERS, '隐藏答案'] }));assert.equal(extension.valid,true);assert.deepEqual(extension.sessions[0].ecommerce.extensions.headers,['隐藏答案']);assert.doesNotMatch(JSON.stringify(extension.sessions[0].contextFields),/隐藏答案/);
  await rejected(await xlsx([row()], { headers: HEADERS.slice(0, 21) }), /22|表头|列/);
});

test('standard row is retained as evidence but never counted as a session; other sheets only produce warnings', async () => {
  const result = await parse(await xlsx([row()], { extra: [{ name: 'Sheet1', headers: ['旧答案'], rows: [['PRIVATE-OLD-ANSWER']] }] }));
  assert.equal(result.valid, true, result.errors.join('；')); assert.equal(result.sessions.length, 1);
  assert.ok(result.warnings.some(w => /Sheet1/.test(w)));
  assert.doesNotMatch(JSON.stringify(result.sessions[0].contextFields), /PRIVATE-OLD-ANSWER/);
  assert.equal((await parse(await workbook([{ name: 'Sheet1', headers: HEADERS, rows: [standards(), row()] }]))).valid,true);
  await rejected(await workbook([{name:'Sheet1',headers:['其他字段'],rows:[['标准'],['值']]}]),/表头|核心22/);
  await rejected(await workbook([{ name: 'Sheet4', headers: HEADERS, rows: [] }]), /第2行|标准/);
  await rejected(await xlsx([]), /没有|业务|记录/);
});

test('sparse worksheet keeps physical row numbers in IDs, records and all context sources', async () => {
  const zip = await JSZip.loadAsync(await xlsx([row()]));
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file('xl/worksheets/sheet1.xml', xml.replace(/r="([A-Z]*)3"/g, (_, col) => `r="${col}27"`).replace('A1:V3','A1:V27'));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  assert.equal((await readXlsx(bytes)).Sheet4[2][XLSX_ROW_NUMBER], 27);
  const parsed = await parse(bytes); assert.equal(parsed.valid, true, parsed.errors.join('；'));
  const s = parsed.sessions[0]; assert.match(s.id, /-Sheet4-27$/); assert.equal(s.ecommerce.row, 27); assert.ok(s.contextFields.every(f => f.source.row === 27));
});

test('shared XLSX reader rejects explicit invalid row coordinates instead of assigning an inferred source row', async () => {
  for (const rowId of ['garbage', '-3', '0', '', '3.5', '1048577']) {
    const zip = await JSZip.loadAsync(await xlsx());
    zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml').async('string')).replace('<row r="3">', `<row r="${rowId}">`));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await assert.rejects(() => readXlsx(bytes), /行号|坐标/, `explicit row@r=${rowId}`);
    await rejected(bytes, /行号|坐标/);
  }
});

test('shared XLSX reader rejects explicit cell references whose row disagrees with their containing row', async () => {
  for (const cellId of ['A27', 'A2', 'A0', 'garbage']) {
    const zip = await JSZip.loadAsync(await xlsx());
    zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml').async('string')).replace('<c r="A3"', `<c r="${cellId}"`));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    await assert.rejects(() => readXlsx(bytes), /单元格|坐标|所属行/, `explicit cell@r=${cellId}`);
    await rejected(bytes, /单元格|坐标|所属行/);
  }
});

test('omitted XLSX row and cell coordinates retain sequential inference and original source locations', async () => {
  const original = await xlsx(); const zip = await JSZip.loadAsync(original);
  zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml').async('string')).replace(/<(row|c) r="[^"]+"/g, '<$1'));
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const tables = await readXlsx(bytes); assert.deepEqual(tables.Sheet4, (await readXlsx(original)).Sheet4);
  assert.deepEqual(tables.Sheet4.map(values => values[XLSX_ROW_NUMBER]), [1, 2, 3]);
  const result = await parse(bytes); assert.equal(result.valid, true, result.errors.join('；'));
  assert.match(result.sessions[0].id, /-Sheet4-3$/); assert.ok(result.sessions[0].contextFields.every(field => field.source.row === 3));
});

test('unknown or invalid dates preserve raw cells and leave missing evidence explicit without fabricating timestamps', async () => {
  const input = row({ 12: '2026-02-30 09:00', 13: '' });
  const parsed = await parse(await xlsx([input])); assert.equal(parsed.valid, true, parsed.errors.join('；'));
  const s = parsed.sessions[0]; assert.equal(s.startedAt, ''); assert.ok(s.turns.every(t => t.at === ''));
  assert.equal(s.ecommerce.raw[12], input[12]); assert.equal(s.completeness, '部分缺失'); assert.match(s.missingNote, /评论时间|首次回复时间/);
  assert.ok(parsed.warnings.some(w => /第3行/.test(w)));
  const reversed = await parse(await xlsx([row({ 13: '2026-10-29 20:00' })]));
  assert.equal(reversed.valid, true); assert.equal(reversed.sessions[0].completeness, '部分缺失'); assert.match(reversed.sessions[0].missingNote, /早于|先于/);
});

test('missing comment or reply creates only actual nonempty turns; fully empty conversation rejects the whole file', async () => {
  for (const [overrides, roles] of [[{ 9: '' }, ['客户']], [{ 8: '' }, ['客服']]]) {
    const result = await parse(await xlsx([row(overrides)])); assert.equal(result.valid, true, result.errors.join('；'));
    assert.deepEqual(result.sessions[0].turns.map(t => t.role), roles); assert.equal(result.sessions[0].completeness, '部分缺失'); assert.ok(result.sessions[0].missingNote);
  }
  await rejected(await xlsx([row(), row({ 8: ' \n ', 9: '' })]), /第4行.*评论|第4行.*回复|原文/);
});

test('24 hours remains continuous across night and weekend, and the configured threshold is frozen without changing raw time', async () => {
  const parsed = await parse(await xlsx([row()]), { thresholdHours: 12.5 });
  assert.equal(parsed.valid, true); const s = parsed.sessions[0]; assert.equal(s.ecommerce.thresholdHours, 12.5);
  assert.equal((Date.parse(s.turns[1].at) - Date.parse(s.turns[0].at)) / 3600000, 24);
  for (const thresholdHours of [0, -1, '24', Infinity, 721]) await rejected(await xlsx(), /阈值/, { thresholdHours });
});

test('file, row, header and cell limits reject atomically with useful source locations', async () => {
  const bytes = await xlsx();
  await rejected(bytes, /8MB/, undefined, { size: 8 * 1024 * 1024 + 1 });
  await rejected(bytes, /xlsx/i, undefined, { name: 'wrong.csv' });
  await rejected(new Uint8Array(), /空/);
  await rejected(new Uint8Array([1, 2, 3]), /读取|XLSX|结构/);
  await rejected(await xlsx(Array.from({ length: 501 }, () => row())), /500/);
  assert.equal((await parse(await xlsx(Array.from({ length: 500 }, () => row())))).sessions.length, 500);
  await rejected(await xlsx([row({ 8: '文'.repeat(20001) })]), /第3行.*20000/);
  assert.equal((await parse(await xlsx([row({ 8: '文'.repeat(20000) })]))).valid, true);
  const longHeader = [...HEADERS]; longHeader[0] = 'H'.repeat(161);
  await rejected(await xlsx([row()], { headers: longHeader }), /表头|顺序/);
});

async function editWorkbook(bytes, edit) {
  const zip = await JSZip.loadAsync(bytes);
  await edit(zip);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
async function editSheet(zip, edit) {
  const path = 'xl/worksheets/sheet1.xml';
  zip.file(path, edit(await zip.file(path).async('string')));
}
const numericCell = (xml, coordinate, value) => xml.replace(new RegExp(`<c r="${coordinate}"[^>]*>[\\s\\S]*?<\\/c>`), `<c r="${coordinate}" s="0"><v>${value}</v></c>`);

test('generated 123-row XLSX accepts embedded header explanations, trailing styles and mixed Excel date cells without losing source evidence', async () => {
  const headers = HEADERS.map(h => `${h}\n（说明：${'固定字段的口径说明；'.repeat(20)}）`);
  const rows = Array.from({ length: 123 }, (_, i) => row({ 6: i === 1 ? '' : row()[6], 8: `第${i + 1}条虚构评论` }));
  const bytes = await editWorkbook(await xlsx(rows, { headers }), async zip => editSheet(zip, xml => {
    let output = xml;
    for (let i = 0; i < rows.length; i += 5) {
      output = numericCell(output, `M${i + 3}`, '46325.833333333336');
      output = numericCell(output, `N${i + 3}`, '46326.833333333336');
    }
    return output.replace(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (xmlRow, r) => xmlRow.replace('</row>', `<c r="W${r}" s="1"/><c r="XFD${r}" s="1"/></row>`));
  }));
  const parsed = await parse(bytes);
  assert.equal(parsed.valid, true, parsed.errors.join('；'));
  assert.equal(parsed.sessions.length, 123);
  assert.equal(parsed.turnCount, 246);
  const { validateEcommerceSource } = await moduleApi('schema');
  const { timeJudgment } = await import('../server/ecommerce-engine.mjs');
  for (const [i, session] of parsed.sessions.entries()) {
    assert.equal(session.ecommerce.row, i + 3);
    assert.equal(session.ecommerce.schemaVersion, 2);
    assert.equal(session.ecommerce.dateSystem, '1900');
    assert.deepEqual(session.ecommerce.headers, headers);
    assert.deepEqual(session.ecommerce.normalizedTimes, { commentTime: '2026-10-30T20:00:00+08:00', replyTime: '2026-10-31T20:00:00+08:00' });
    assert.equal(session.ecommerce.raw[12], i % 5 === 0 ? '46325.833333333336' : rows[i][12]);
    assert.equal(validateContextFields(session.contextFields, session.turns), true);
    assert.equal(validateEcommerceSource(session), true);
    assert.deepEqual(session.contextFields.find(f => f.key === 'commentTime').source, { sheet: 'Sheet4', row: i + 3, column: HEADERS[12] });
    assert.deepEqual(timeJudgment(session).fieldEvidence, ['commentTime', 'replyTime']);
    assert.equal(timeJudgment(session).verdict, '符合');
    assert.match(timeJudgment(session).reason, /24小时0分0秒/);
    assert.doesNotMatch(JSON.stringify({ contextFields: session.contextFields, turns: session.turns }), /PRIVATE|口径说明|测试标准/);
  }
  assert.equal(parsed.sessions[1].ecommerce.raw[6], '');
  assert.equal(parsed.sessions[1].ecommerce.raw[7], rows[1][7]);
  assert.equal(parsed.sessions[1].contextFields.find(f => f.key === 'skuCode').value, '');
  const { ensureEcommerceCatalog } = await moduleApi('catalog');
  const { EC_RULE_IDS } = await moduleApi('schema');
  const catalog = ensureEcommerceCatalog(createCatalog(), { now });
  const state = createImportedTask(createInitialState(), { name: '生成的123行兼容性测试', sessions: parsed.sessions, source: { name: 'generated-123.xlsx', size: bytes.length, sha256: parsed.sessions[0].ecommerce.fileSha256 }, reviewer: '虚构验证员', basisSnapshot: createBasisSnapshot(catalog, { effectiveDate: '2026-10-30', ruleIds: EC_RULE_IDS }), now });
  assert.equal(validateWorkspace(state, catalog), true);
  assert.equal(validateWorkspace(JSON.parse(JSON.stringify(state)), catalog), true);
});

test('header matching accepts explanatory suffixes while refusing leading prose and cross-column labels', async () => {
  for (const suffix of ['（口径：北京时间自然耗时）', '\n说明：统计口径说明', ' / 说明：字段口径', ': explanation of this field', '【说明】测试字段']) {
    const headers = [...HEADERS]; headers[12] = `Comment Time${suffix}`;
    assert.equal((await parse(await xlsx([row()], { headers }))).valid, true, suffix);
  }
  // The later business contract permits undelimited suffixes; these used to be rejected.
  for (const header of ['Comment Timezone', 'Comment Timeline', '评论时间戳错误']) {
    const headers = [...HEADERS]; headers[12] = header;
    assert.equal((await parse(await xlsx([row()], { headers }))).valid, true, header);
  }
  for (const header of ['previous Comment Time', 'not 评论时间', 'Comment Time / First Reply Time']) {
    const headers = [...HEADERS]; headers[12] = header;
    await rejected(await xlsx([row()], { headers }), /表头.*评论时间.*缺失/);
  }
  const huge = [...HEADERS]; huge[12] = `评论时间（${'文'.repeat(20000)}）`;
  await rejected(await xlsx([row()], { headers: huge }), /第1行.*20000/);
});

test('pure empty styled trailing cells are ignored, real extension values are retained and formulas still reject with empty caches', async () => {
  const bytes = await xlsx([row()]);
  const blank = await editWorkbook(bytes, zip => editSheet(zip, xml => xml.replace('</row>', '<c r="W1" s="1"/>\n<c r="AD1" s="1"></c></row>')));
  assert.equal((await parse(blank)).valid, true);
  for (const cell of ['<c r="W3" t="inlineStr"><is><t>额外值</t></is></c>', '<c r="W3"><v>0</v></c>', '<c r="W3"><f>IF(1=1,&quot;&quot;,0)</f><v/></c>', '<c r="XFD3"><f/></c>']) {
    const extra = await editWorkbook(bytes, zip => editSheet(zip, xml => xml.replace('</sheetData>', `<row r="4"><c r="A4"/></row></sheetData>`).replace(/(<row r="3"[^>]*>[\s\S]*?)<\/row>/, `$1${cell}</row>`)));
    if(cell.includes('<f'))await rejected(extra,/公式/);
    else {const parsed=await parse(extra);assert.equal(parsed.valid,true,parsed.errors.join('；'));assert.deepEqual(parsed.sessions[0].ecommerce.extensions.raw,[cell.includes('额外值')?'额外值':'0']);}
  }
});

test('Excel serial times use workbook 1900 or 1904 systems only in date columns and retain the numeric raw value', async () => {
  for (const date1904 of [false, true]) {
    const base = date1904 ? 44863 : 46325;
    const bytes = await editWorkbook(await xlsx([row({ 10: '46325', 12: String(base + 20 / 24), 13: '2026-10-31 20:00:00' })]), async zip => {
      const path = 'xl/workbook.xml';
      zip.file(path, (await zip.file(path).async('string')).replace('<sheets>', `<workbookPr date1904="${date1904 ? 'true' : '0'}"/><sheets>`));
      await editSheet(zip, xml => numericCell(xml, 'M3', String(base + 20 / 24)));
    });
    const parsed = await parse(bytes); assert.equal(parsed.valid, true, parsed.errors.join('；'));
    const session = parsed.sessions[0];
    assert.equal(session.startedAt, '2026-10-30T20:00:00+08:00');
    assert.equal(session.ecommerce.dateSystem, date1904 ? '1904' : '1900');
    assert.equal(session.ecommerce.raw[12], String(base + 20 / 24));
    assert.equal(session.contextFields.find(f => f.key === 'rating').value, '46325');
    assert.equal(session.contextFields.find(f => f.key === 'commentTime').value, String(base + 20 / 24));
    const { timeJudgment } = await import('../server/ecommerce-engine.mjs');
    assert.equal(timeJudgment(session).verdict, '符合');
    assert.match(timeJudgment(session).reason, /24小时0分0秒/);
  }
});

test('v2 normalized time evidence is closed and recomputed from raw values while v1 remains unchanged', async () => {
  const { validateEcommerceRecord, ecommerceTimeValues, ecommerceSourceProjection } = await moduleApi('schema');
  const parsed = await parse(await xlsx([row({ 12: '46325.833333333336' })]));
  assert.equal(parsed.valid, true, parsed.errors.join('；'));
  const r = parsed.sessions[0].ecommerce;
  assert.equal(typeof ecommerceTimeValues, 'function');
  assert.deepEqual(ecommerceTimeValues(r), r.normalizedTimes);
  for (const mutate of [r => r.normalizedTimes.commentTime = '2026-10-31T20:00:00+08:00', r => r.normalizedTimes.extra = '', r => delete r.normalizedTimes, r => r.dateSystem = 'other', r => r.raw[12] = 'not a time', r => r.extra = true]) {
    const changed = structuredClone(r); mutate(changed);
    assert.throws(() => validateEcommerceRecord(changed), /电商|时间|日期|结构|字段/);
  }
  const legacy = record(); legacy.raw[12] = '46325.833333333336';
  assert.equal(validateEcommerceRecord(legacy), true);
  assert.equal(ecommerceTimeValues(legacy).commentTime, null);
  assert.equal(ecommerceSourceProjection(legacy).startedAt, '');
});

test('text fractions round decimal half milliseconds forward without floating-point tie errors', async () => {
  const samples = [
    ['2026-10-30T20:00:00.5005+08:00', '2026-10-30T20:00:00.501+08:00'],
    ['2026-10-30T20:00:00.5015+08:00', '2026-10-30T20:00:00.502+08:00'],
    ['2026-10-30T20:00:00.500499999+08:00', '2026-10-30T20:00:00.500+08:00'],
    ['2026-10-30T23:59:59.9995+08:00', '2026-10-31T00:00:00+08:00'],
  ];
  const parsed = await parse(await xlsx(samples.map(([value]) => row({ 12: value }))));
  assert.equal(parsed.valid, true, parsed.errors.join('；'));
  assert.deepEqual(parsed.sessions.map(s => s.ecommerce.normalizedTimes.commentTime), samples.map(([, expected]) => expected));
});

test('Excel serial business dates span Beijing years 2000 through 2100 in both workbook systems', async () => {
  const examples = [
    [36526, 36527, '2000-01-01T00:00:00+08:00', '2000-01-02T00:00:00+08:00', '符合'],
    [39999, 40000, '2009-07-05T00:00:00+08:00', '2009-07-06T00:00:00+08:00', '符合'],
    [73415, 73415.99999998843, '2100-12-31T00:00:00+08:00', '2100-12-31T23:59:59.999+08:00', '符合'],
    [36525.99999998842, 36526, null, '2000-01-01T00:00:00+08:00', '无法判定'],
    [73415, 73416, '2100-12-31T00:00:00+08:00', null, '无法判定'],
    [0, 1, null, null, '无法判定'],
  ];
  const { timeJudgment } = await import('../server/ecommerce-engine.mjs');
  for (const dateSystem of ['1900', '1904']) {
    const shift = dateSystem === '1904' ? 1462 : 0;
    const rows = examples.map(([start, end]) => row({ 12: String(start === 0 ? start : start - shift), 13: String(end === 1 ? end : end - shift) }));
    const bytes = await editWorkbook(await xlsx(rows), async zip => {
      const path = 'xl/workbook.xml';
      zip.file(path, (await zip.file(path).async('string')).replace('<sheets>', `<workbookPr date1904="${dateSystem === '1904' ? '1' : '0'}"/><sheets>`));
    });
    const parsed = await parse(bytes);
    assert.equal(parsed.valid, true, parsed.errors.join('；'));
    for (const [i, session] of parsed.sessions.entries()) {
      assert.deepEqual(session.ecommerce.normalizedTimes, { commentTime: examples[i][2], replyTime: examples[i][3] }, `${dateSystem} fixture row ${i + 3}`);
      assert.equal(timeJudgment(session).verdict, examples[i][4]);
      assert.equal(session.ecommerce.raw[12], rows[i][12]);
      assert.equal(session.ecommerce.raw[13], rows[i][13]);
    }
  }
});

test('unsafe XLSX formulas and external package relationships retain the shared reader protections', async () => {
  for (const edit of [
    async zip => zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml').async('string')).replace('<is>', '<f>SUM(1,1)</f><is>')),
    zip => zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="link" TargetMode="External" Target="https://example.invalid"/></Relationships>'),
  ]) { const zip = await JSZip.loadAsync(await xlsx()); await edit(zip); await rejected(await zip.generateAsync({ type: 'uint8array' }), /公式|外部/); }
});

test('preset creates published V1.0 reference and five explicit testing rules without mutating its input', async () => {
  const { ensureEcommerceCatalog } = await moduleApi('catalog'); const base = freeze(createCatalog());
  const seeded = ensureEcommerceCatalog(base, { now });
  assert.equal(validateCatalog(seeded), true); assert.equal(seeded.rules.length, base.rules.length + 5); assert.equal(seeded.policies.length, base.policies.length + 1);
  const rules = seeded.rules.filter(r => r.id.startsWith('EC-')), policy = seeded.policies.find(p => p.id === 'EC-POLICY');
  assert.equal(policy.sections.length, 5); assert.ok(rules.every(r => r.version === 'V1.0' && r.status === '已发布' && r.policyIds.join() === 'EC-POLICY' && r.owner === '测试维护人'));
  assert.ok(rules.every(r => /测试/.test(r.scope))); assert.match(policy.source, /测试|非正式/); assert.equal(policy.effectiveAt, '2020-01-01');
  const byId = Object.fromEntries(rules.map(r => [r.id, r]));
  assert.match(byId['EC-TIME'].failCriteria, /24小时/); assert.match(byId['EC-TIME'].scope + byId['EC-TIME'].passCriteria, /北京|UTC\+08/);
  assert.match(byId['EC-TARGET'].failCriteria, /同一管理员|同管理员/); assert.match(byId['EC-TARGET'].failCriteria, /3/);
  assert.match(byId['EC-STEPS'].failCriteria, /3/); assert.match(byId['EC-PRIVACY'].exceptionCriteria, /订单|输入/);
  assert.ok(rules.every(r => /无法判定|缺少|不足/.test(r.exceptionCriteria)));
});

test('preset is idempotent and refuses matching IDs whose rule, policy, version or publication semantics changed', async () => {
  const { ensureEcommerceCatalog } = await moduleApi('catalog'); const base = ensureEcommerceCatalog(createCatalog(), { now });
  assert.deepEqual(ensureEcommerceCatalog(freeze(structuredClone(base)), { now: '2026-11-01T10:00:00+08:00', owner: '另一维护人' }), base);
  for (const mutate of [c => c.rules.find(r => r.id === 'EC-TEXT').failCriteria += '改口径', c => c.policies.find(p => p.id === 'EC-POLICY').sections[0].text += '改正文', c => c.rules.find(r => r.id === 'EC-TIME').version = 'V1.1', c => c.rules.find(r => r.id === 'EC-TIME').status = '已停用']) {
    const changed = structuredClone(base); mutate(changed); assert.throws(() => ensureEcommerceCatalog(changed, { now }), /冲突|不匹配|版本|关联/);
  }
});

test('semantic guard accepts only the complete known V1.0 frozen basis and rejects silently edited or revised rules', async () => {
  const api = await moduleApi('catalog'); const { EC_RULE_IDS } = await moduleApi('schema');
  const catalog = api.ensureEcommerceCatalog(createCatalog(), { now });
  const basis = createBasisSnapshot(catalog, { effectiveDate: '2026-10-30', ruleIds: EC_RULE_IDS, now });
  assert.equal(api.isEcommerceBasis(basis), true); assert.equal(api.validateEcommerceBasis(basis), true);
  for (const mutate of [b => b.rules[0].failCriteria = '超过48小时失败', b => b.rules[0].version = 'V1.1', b => b.rules.pop(), b => b.policies[0].sections[0].text += '已修改', b => b.policies[0].version = 'V1.1']) {
    const changed = structuredClone(basis); mutate(changed); assert.equal(api.isEcommerceBasis(changed), false); assert.throws(() => api.validateEcommerceBasis(changed), /测试|匹配|口径|版本|规则|资料/);
  }
  let revised = createDraft(catalog, 'rules', 'EC-TIME', { failCriteria: '改为48小时', effectiveAt: '2026-11-01' }, now);
  revised = publishVersion(revised, 'rules', 'EC-TIME', 'V1.1', { closePrevious: true }, now);
  const revisedBasis = createBasisSnapshot(revised, { effectiveDate: '2026-11-02', ruleIds: EC_RULE_IDS, now });
  assert.equal(api.isEcommerceBasis(revisedBasis), false);
});

test('fictional sample contains 18 real import rows covering boundary and semantic cases without leaking its engineering labels', async () => {
  const { createEcommerceSample } = await moduleApi('sample'); const bytes = await createEcommerceSample(); assert.ok(bytes instanceof Uint8Array);
  const tables = await readXlsx(bytes); assert.deepEqual(Object.keys(tables), ['Sheet4']); assert.deepEqual(tables.Sheet4[0], HEADERS); assert.equal(tables.Sheet4.length, 20);
  const parsed = await parse(bytes); assert.equal(parsed.valid, true, parsed.errors.join('；')); assert.equal(parsed.sessions.length, 18);
  assert.ok(tables.Sheet4[1].some(v => /工程|虚构|测试/.test(v)));
  const cases = parsed.sessions.map(s => s.ecommerce.raw[14]);
  for (const name of ['SAMPLE-NORMAL','SAMPLE-24H-BOUNDARY','SAMPLE-OVER-24H','SAMPLE-DUPLICATE-1','SAMPLE-DUPLICATE-2','SAMPLE-DUPLICATE-3','SAMPLE-DIFFERENT-AGENT-1','SAMPLE-DIFFERENT-AGENT-2','SAMPLE-INVALID-TIME','SAMPLE-MISSING-TIME','SAMPLE-NO-REPLY','SAMPLE-STEPS-UNNUMBERED','SAMPLE-STEPS-NUMBERED','SAMPLE-PRIVACY','SAMPLE-TEXT','SAMPLE-UNRELATED','SAMPLE-NO-COMMENT','SAMPLE-REVERSED-TIME']) assert.ok(cases.some(c => c.includes(name)), name);
  assert.ok(parsed.sessions.every(s => !JSON.stringify({ contextFields: s.contextFields, turns: s.turns }).includes('SAMPLE-')));
  const privacy = parsed.sessions.find(s => s.ecommerce.raw[14].includes('SAMPLE-PRIVACY')); assert.match(privacy.turns.at(-1).text, /example\.com/);
  const duplicates = parsed.sessions.filter(s => /SAMPLE-DUPLICATE-\d/.test(s.ecommerce.raw[14])); assert.equal(new Set(duplicates.map(s => s.agent)).size, 1); assert.equal(new Set(duplicates.map(s => s.turns.at(-1).text)).size, 1);
});
