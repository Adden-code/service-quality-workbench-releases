import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { demoSessions, rules, policies, INITIAL_TASK_ID, createInitialState, acceptAI, saveReview, confirmReview, markPending } from '../public/domain.mjs';

const io = await import('../public/io.mjs').catch(() => ({}));
const file = (data, name = '演示.xlsx') => ({ name, arrayBuffer: async () => data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : new TextEncoder().encode(data).buffer });
const jsonFixture = (sessions = demoSessions) => ({ format: 'SERVICE_QUALITY_DEMO_V1', ruleSetId: 'RS-PRESALES-V1', sessions: sessions.map(s => ({ id: s.id, turns: s.turns.map(({ id, role, text }) => ({ id, role, text })) })), rules: structuredClone(rules), policies: structuredClone(policies) });
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const decode = value => value.replace(/&#(x[\da-f]+|\d+);/gi, (_, v) => String.fromCodePoint(v[0].toLowerCase() === 'x' ? parseInt(v.slice(1), 16) : Number(v))).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
async function mutate(bytes, path, change) { const zip = await JSZip.loadAsync(bytes); zip.file(path, change(await zip.file(path).async('string'))); return zip.generateAsync({ type: 'uint8array' }); }

test('XLSX date-system and cell metadata stay nonenumerable and preserve empty physical columns', async () => {
  assert.equal(typeof io.XLSX_DATE_SYSTEM, 'symbol');
  assert.equal(typeof io.XLSX_CELL_METADATA, 'symbol');
  let bytes = await io.workbook([{ name: 'Sheet4', headers: ['first', 'middle', 'last'], rows: [['a', '', 'c']] }]);
  bytes = await mutate(bytes, 'xl/workbook.xml', xml => xml.replace('<sheets>', '<workbookPr date1904="1"/><sheets>'));
  bytes = await mutate(bytes, 'xl/worksheets/sheet1.xml', xml => xml.replace(/<c r="B2"[^>]*>[\s\S]*?<\/c>/, '<c r="B2" s="1"/>').replace(/(<row r="2"[^>]*>[\s\S]*?)<\/row>/, '$1<c r="XFD2" s="1"/></row>'));
  const tables = await io.readXlsx(bytes), row = tables.Sheet4[1];
  assert.equal(tables[io.XLSX_DATE_SYSTEM], '1904');
  assert.deepEqual(row.slice(0, 3), ['a', '', 'c']);
  assert.equal(row[io.XLSX_CELL_METADATA][1].hasFormula, false);
  assert.equal(row[io.XLSX_CELL_METADATA][1].hasValue, false);
  assert.equal(row[io.XLSX_CELL_METADATA][16383].hasValue, false);
  assert.equal(Object.getOwnPropertyDescriptor(tables, io.XLSX_DATE_SYSTEM).enumerable, false);
  assert.equal(Object.getOwnPropertyDescriptor(row, io.XLSX_CELL_METADATA).enumerable, false);
  assert.deepEqual(Object.keys(tables), ['Sheet4']);
  assert.doesNotMatch(JSON.stringify(tables), /hasValue|dateSystem|hasFormula/);
  assert.equal((await io.readXlsx(await io.workbook([{ name: 'plain', headers: ['a'], rows: [] }])))[io.XLSX_DATE_SYSTEM], '1900');
});

test('shared XLSX reader rejects formulas including self-closing formulas and empty cached values', async () => {
  const bytes = await io.workbook([{ name: 'plain', headers: ['a'], rows: [['x']] }]);
  for (const formula of ['<f/>', '<f>IF(1=1,&quot;&quot;,0)</f><v/>', '<f t="shared" si="1"/>']) {
    const changed = await mutate(bytes, 'xl/worksheets/sheet1.xml', xml => xml.replace(/<c r="A2"[^>]*>[\s\S]*?<\/c>/, `<c r="A2">${formula}</c>`));
    await assert.rejects(() => io.readXlsx(changed), /公式/);
  }
});
async function table(bytes, name) {
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  const index = sheets.findIndex(s => decode(s[1]) === name);
  assert.notEqual(index, -1, `工作表存在：${name}`);
  const xml = await zip.file(`xl/worksheets/sheet${index + 1}.xml`).async('string');
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => decode([...cell[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))));
  return { zip, xml, headers: rows[0], rows: rows.slice(1).map(row => Object.fromEntries(rows[0].map((header, i) => [header, row[i] ?? '']))) };
}

test('input workbook round trips all eight original sessions with six data sheets', async () => {
  assert.equal(typeof io.createDemoXlsx, 'function', '实现演示输入下载');
  const bytes = await io.createDemoXlsx();
  assert.ok(bytes instanceof Uint8Array);
  const result = await io.parseInputFile(file(bytes));
  assert.equal(result.valid, true, result.errors.join('；'));
  assert.deepEqual(result.templateIds, demoSessions.map(s => s.id));
  assert.equal(result.turnCount, demoSessions.reduce((n, s) => n + s.turns.length, 0));
  assert.equal((await table(bytes, '质检规则')).rows.length, 7);
  assert.equal((await table(bytes, '参考资料')).rows.length, 4);
  assert.equal((await table(bytes, '验证案例')).rows.length, 0);
  assert.equal((await table(bytes, '人工耗时')).rows.length, 0);
  assert.equal((await table(bytes, '参考资料')).rows[0]['备注'], policies[0].content);
});

test('known JSON subsets require explicit demo marker and exact original turns', async () => {
  assert.equal(typeof io.parseInputFile, 'function', '实现文件校验');
  const fixture = jsonFixture(demoSessions.slice(2, 4));
  const result = await io.parseInputFile(file(JSON.stringify(fixture), 'demo.json'));
  assert.equal(result.valid, true, result.errors.join('；'));
  assert.deepEqual(result.templateIds, ['DEMO_PRE003', 'DEMO_PRE004']);
  assert.equal(result.turnCount, 12);
  delete fixture.format;
  assert.equal((await io.parseInputFile(file(JSON.stringify(fixture), 'demo.json'))).valid, false);
});

test('edited text, role, order, IDs, rules and policy text cannot load preset AI', async () => {
  assert.equal(typeof io.parseInputFile, 'function');
  for (const change of [
    fixture => { fixture.sessions[0].turns[1].text += '修改'; },
    fixture => { fixture.sessions[0].turns[0].role = '客服'; },
    fixture => { fixture.sessions[0].turns.reverse(); },
    fixture => { fixture.sessions[0].id = 'UNKNOWN_SESSION'; },
    fixture => { fixture.sessions.push(fixture.sessions[0]); },
    fixture => { fixture.rules[0].passCriteria += '修改'; },
    fixture => { fixture.rules[0].policyIds = ['UNKNOWN_POLICY']; },
    fixture => { fixture.policies[0].content += '修改'; },
  ]) {
    const fixture = jsonFixture(demoSessions.slice(0, 1)); change(fixture);
    const result = await io.parseInputFile(file(JSON.stringify(fixture), 'demo.json'));
    assert.equal(result.valid, false, '变更材料必须拒绝');
    assert.ok(result.errors.some(e => /演示|原文|规则|资料|重复|顺序|角色/.test(e)));
    assert.deepEqual(result.templateIds, []);
  }
});

test('XLSX rejects absent sheets/columns, mutated definitions and duplicate or orphan turns', async () => {
  assert.equal(typeof io.createDemoXlsx, 'function');
  const bytes = await io.createDemoXlsx();
  const mutations = [
    ['xl/workbook.xml', xml => xml.replace('name="人工耗时"', 'name="其他"'), /人工耗时/],
    ['xl/worksheets/sheet1.xml', xml => xml.replace('会话ID', '会话编号'), /字段.*会话ID/],
    ['xl/worksheets/sheet2.xml', xml => xml.replace(escape(demoSessions[0].turns[1].text), '篡改原文'), /原文/],
    ['xl/worksheets/sheet1.xml', xml => xml.replaceAll('DEMO_PRE001', 'UNKNOWN_SESSION'), /演示|关联/],
    ['xl/worksheets/sheet2.xml', xml => xml.replace(/(<row\b[^>]*r="2"[^>]*>[\s\S]*?<\/row>)/, '$1$1'), /重复/],
    ['xl/worksheets/sheet2.xml', xml => xml.replace('DEMO_PRE001', 'DEMO_PRE999'), /关联|演示/],
    ['xl/worksheets/sheet3.xml', xml => xml.replace(escape(rules[0].passCriteria), '全部通过'), /规则/],
    ['xl/worksheets/sheet4.xml', xml => xml.replace(escape(policies[0].content), '修改资料'), /资料/],
  ];
  for (const [path, change, expected] of mutations) {
    const result = await io.parseInputFile(file(await mutate(bytes, path, change)));
    assert.equal(result.valid, false, path);
    assert.match(result.errors.join('；'), expected);
  }
});

test('XLSX accepts a consistent subset and sharedStrings but rejects mismatched associated records', async () => {
  assert.equal(typeof io.createDemoXlsx, 'function');
  let bytes = await io.createDemoXlsx();
  for (const path of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) bytes = await mutate(bytes, path, xml => xml.replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, row => /DEMO_PRE00[2-8]/.test(row) ? '' : row));
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/worksheets/sheet2.xml';
  zip.file(path, (await zip.file(path).async('string')).replace('<t xml:space="preserve">客户</t>', '<t xml:space="preserve">客户</t>').replace(/<c([^>]*) t="inlineStr"><is><t xml:space="preserve">客户<\/t><\/is><\/c>/, '<c$1 t="s"><v>0</v></c>'));
  zip.file('xl/sharedStrings.xml', '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>客户</t></si></sst>');
  bytes = await zip.generateAsync({ type: 'uint8array' });
  const result = await io.parseInputFile(file(bytes));
  assert.equal(result.valid, true, result.errors.join('；'));
  assert.deepEqual(result.templateIds, ['DEMO_PRE001']);
  const orphan = '<row r="2"><c r="A2" t="inlineStr"><is><t>CASE_1</t></is></c><c r="B2" t="inlineStr"><is><t>DEMO_PRE002</t></is></c><c r="C2" t="inlineStr"><is><t>R001</t></is></c></row>';
  bytes = await mutate(bytes, 'xl/worksheets/sheet5.xml', xml => xml.replace('</sheetData>', `${orphan}</sheetData>`));
  assert.equal((await io.parseInputFile(file(bytes))).valid, false);
});

test('edited conversation metadata cannot be silently replaced by preset values', async()=>{
  const bytes=await io.createDemoXlsx();
  for(const [sheet,field,replacement] of [
    ['会话信息','会话开始时间','2026-10-01 09:00:00'],
    ['会话信息','时区','UTC+00:00'],
    ['会话信息','渠道','另一个渠道'],
    ['会话信息','客服标识','另一个客服'],
    ['会话信息','客户标识','另一个客户'],
    ['会话明细','发言方标识','另一个发言方'],
    ['会话明细','发言时间','2026-10-01 08:00:00'],
  ]){
    const original=(await table(bytes,sheet)).rows[0][field];
    const index=sheet==='会话信息'?1:2;
    const altered=await mutate(bytes,`xl/worksheets/sheet${index}.xml`,xml=>xml.replace(escape(original),escape(replacement)));
    const parsed=await io.parseInputFile(file(altered));
    assert.equal(parsed.valid,false,`${sheet}.${field}修改后不能校验通过再忽略`);
    assert.deepEqual(parsed.templateIds,[]);
  }
});

test('numeric-equivalent turn IDs cannot skip speaker metadata validation',async()=>{
  const bytes=await io.createDemoXlsx();
  const speaker=demoSessions[0].turns[0].speaker;
  const altered=await mutate(bytes,'xl/worksheets/sheet2.xml',xml=>xml.replace(/<row\b[^>]*r="2"[^>]*>[\s\S]*?<\/row>/,row=>row.replace('>1</t>','>01</t>').replace(escape(speaker),escape('非内置发言方'))));
  const result=await io.parseInputFile(file(altered));
  assert.equal(result.valid,false,'01与1指向同一轮，也必须核对发言方元数据');
  assert.deepEqual(result.templateIds,[]);
});

test('unsupported, malformed XML and oversized expanded ZIP return Chinese errors', async () => {
  assert.equal(typeof io.parseInputFile, 'function');
  assert.equal((await io.parseInputFile(file('hello', 'sample.csv'))).valid, false);
  assert.equal((await io.parseInputFile(file('{', 'sample.json'))).valid, false);
  let bytes = await io.createDemoXlsx();
  bytes = await mutate(bytes, 'xl/worksheets/sheet1.xml', xml => `<!DOCTYPE x [<!ENTITY x SYSTEM "https://example.invalid">]>${xml}`);
  assert.equal((await io.parseInputFile(file(bytes))).valid, false);
  const zip = await JSZip.loadAsync(await io.createDemoXlsx());
  zip.file('huge.txt', 'x'.repeat(17 * 1024 * 1024));
  assert.equal((await io.parseInputFile(file(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })))).valid, false);
});

test('unconfirmed AI acceptance and manual drafts never become final export results', async () => {
  assert.equal(typeof io.buildResultXlsx, 'function', '实现审核结果导出');
  const state = acceptAI(createInitialState(), 'DEMO_PRE001');
  const regular = await table(await io.buildResultXlsx(state, { taskId: INITIAL_TASK_ID }), '结果明细');
  assert.equal(regular.rows.length, 0);
  const included = await table(await io.buildResultXlsx(state, { taskId: INITIAL_TASK_ID, includePending: true }), '结果明细');
  assert.equal(included.rows.length, 56);
  assert.ok(included.rows.every(r => r['人工最终结论'] === '' && r['完成时间'] === ''));
  assert.equal(included.rows.find(r => r['会话ID'] === 'DEMO_PRE001' && r['规则标识'] === 'R001')['人工草稿'], '不符合');
});

test('confirmed correction retains AI verdict, final reason, complete source and versioned clauses', async () => {
  assert.equal(typeof io.buildResultXlsx, 'function');
  let state = saveReview(createInitialState(), 'DEMO_PRE003', { ruleId: 'R002', verdict: '符合', reason: '人工核对优惠条件完整', evidence: [2], referenceIds: ['P002-1'] });
  state = confirmReview(state, 'DEMO_PRE003');
  const { rows, zip } = await table(await io.buildResultXlsx(state, { taskId: INITIAL_TASK_ID }), '结果明细');
  assert.equal(rows.length, 7);
  const row = rows.find(r => r['规则标识'] === 'R002');
  assert.equal(row['AI初判'], '不符合');
  assert.equal(row['人工最终结论'], '符合');
  assert.equal(row['判断理由'], '人工核对优惠条件完整');
  assert.match(row['AI判断理由'], /预置误判/);
  assert.equal(row['证据轮次'], '2');
  assert.match(row['参考资料条款及版本'], /P002-1.*V1\.0/);
  assert.ok(row['完整会话原文'].includes(demoSessions[2].turns[4].text));
  const workbook = await zip.file('xl/workbook.xml').async('string');
  assert.deepEqual([...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map(m => m[1]), ['结果明细', '会话汇总', '批次统计', '口径说明']);
  assert.ok(zip.file('[Content_Types].xml'));
  assert.ok(zip.file('_rels/.rels'));
});

test('batch and session summaries count confirmed final once and preserve unknown outcomes', async () => {
  assert.equal(typeof io.buildResultXlsx, 'function');
  let state = confirmReview(createInitialState(), 'DEMO_PRE001');
  state = confirmReview(state, 'DEMO_PRE005');
  state = markPending(acceptAI(state, 'DEMO_PRE008'), 'DEMO_PRE008', '等补充');
  const bytes = await io.buildResultXlsx(state, { taskId: INITIAL_TASK_ID, includePending: true });
  const batch = (await table(bytes, '批次统计')).rows[0];
  assert.equal(batch['导出会话数'], '8');
  assert.equal(batch['人工已确认会话数'], '2');
  assert.equal(batch['未确认会话数'], '6');
  assert.equal(batch['问题会话数'], '1');
  assert.equal(batch['问题项数'], '1');
  assert.equal(batch['无法判定项数'], '1');
  const summaries = (await table(bytes, '会话汇总')).rows;
  assert.equal(summaries.find(r => r['会话ID'] === 'DEMO_PRE005')['会话结论'], '含无法判定');
  assert.equal(summaries.find(r => r['会话ID'] === 'DEMO_PRE008')['不符合项数'], '');
});

test('XML and standalone HTML escape names, reasons and formula-like strings safely', async () => {
  assert.equal(typeof io.buildHtmlReport, 'function', '实现 HTML 报告');
  let state = saveReview(createInitialState(), 'DEMO_PRE003', { ruleId: 'R002', verdict: '符合', reason: '=<script>alert("x")</script>&\'结论', evidence: [2], referenceIds: ['P002'] });
  state = confirmReview(state, 'DEMO_PRE003');
  state.tasks.find(t => t.id === INITIAL_TASK_ID).name = '<script>bad()</script>&"批次';
  const bytes = await io.buildResultXlsx(state, { taskId: INITIAL_TASK_ID });
  const details = await table(bytes, '结果明细');
  assert.ok(!details.xml.includes('<f>'));
  assert.match(details.xml, /&lt;script&gt;/);
  assert.equal(details.rows.find(r => r['规则标识'] === 'R002')['判断理由'], '=<script>alert("x")</script>&\'结论');
  assert.match(details.rows.find(r => r['规则标识'] === 'R002')['参考资料条款及版本'], /P002.*V1\.0/);
  const html = io.buildHtmlReport(state, { taskId: INITIAL_TASK_ID });
  assert.match(html, /虚构|模拟/);
  assert.match(html, /&lt;script&gt;bad/);
  assert.match(html, /AI初判/);
  assert.match(html, /人工最终结论/);
  assert.ok(!/<script\b|https?:\/\/|<link\b/i.test(html));
  assert.ok(html.includes('人工核对') || html.includes('&lt;script&gt;alert'));
});

function manualExportFixture({confirmed=true}={}) {
  const rules=[{id:'R-CUSTOM',name:'评论回复准确',title:'评论回复准确',version:'V2.1',category:'评论业务',policyIds:['P-CUSTOM']},{id:'R-SECOND',name:'处置清晰',title:'处置清晰',version:'V3.0',category:'评论业务',policyIds:['P-CUSTOM']}];
  const policies=[{id:'P-CUSTOM',title:'评论处置政策',version:'V2.0',effectiveAt:'2026-10-20',source:'运营正式政策',sections:[{id:'section/1',title:'真实条款标题',text:'必须根据评论具体内容回应。'}],content:'section/1 真实条款标题\n必须根据评论具体内容回应。'}];
  const task={id:'TASK-REAL',name:'业务审核批次',mode:'manual',aiStatus:'not_run',status:confirmed?'已完成':'待审核',progress:confirmed?100:0,sessionIds:['SESSION-REAL'],source:{name:'业务会话.json',sha256:'c'.repeat(64),size:500},basisSnapshot:{effectiveDate:'2026-10-25',capturedAt:'2026-10-29T10:00:00+08:00',rules,policies}};
  const draft=id=>({ruleId:id,verdict:'不符合',reason:`人工核对${id}后发现回复缺项`,evidence:[7],referenceIds:['P-CUSTOM@V2.0#section%2F1'],source:'人工独立审核'});
  const session={id:'SESSION-REAL',externalId:'运营会话-007',taskId:task.id,scene:'电商评论回复',startedAt:'2026-10-25T12:35:00+08:00',topic:'耳机评论响应',channel:'商城评论',product:'新耳机',agent:'客服甲',customer:'用户乙',completeness:'部分缺失',missingNote:'评论图片待补充',turns:[{id:7,role:'客服',speaker:'客服甲',at:'2026-10-25T12:36:00+08:00',text:'请提供您的订单信息，我们将核实处理。'}],expectedRuleIds:rules.map(r=>r.id),aiResults:[],review:{status:confirmed?'已确认':'已暂存',reviewer:'审核标签甲',completedAt:confirmed?'2026-10-29T11:00:00+08:00':null,notes:'',drafts:Object.fromEntries(rules.map(r=>[r.id,draft(r.id)]))}};
  return {schemaVersion:1,tasks:[task],sessions:[session],activity:[]};
}

test('manual exports project all custom expected rules with blank AI and frozen policy references',async()=>{
  const state=manualExportFixture(),before=JSON.stringify(state);
  const bytes=await io.buildResultXlsx(state,{taskId:'TASK-REAL'});
  const result=await table(bytes,'结果明细');
  assert.equal(result.rows.length,2);
  const row=result.rows[0];
  assert.equal(row['检查项'],'评论回复准确');assert.equal(row['规则版本'],'V2.1');
  for(const field of ['AI初判','AI判断理由','AI参考条款及版本'])assert.equal(row[field],'',field);
  assert.equal(row['AI执行状态'],'未执行');assert.equal(row['人工最终结论'],'不符合');
  assert.equal(row['判断理由'],'人工核对R-CUSTOM后发现回复缺项');
  assert.match(row['参考资料条款及版本'],/V2\.0.*评论处置政策.*真实条款标题：必须根据评论具体内容回应/);
  assert.match(row['完整会话原文'],/第7轮 客服（客服甲）.*请提供您的订单信息/);
  assert.equal(row['会话场景'],'电商评论回复');assert.equal(row['会话开始时间'],state.sessions[0].startedAt);
  assert.equal(row['缺失说明'],'评论图片待补充');assert.equal(row['发言时间及轮次'],'7: 2026-10-25T12:36:00+08:00');
  assert.equal(row['原文件SHA256'],'c'.repeat(64));
  const summary=(await table(bytes,'会话汇总')).rows[0],batch=(await table(bytes,'批次统计')).rows[0];
  assert.equal(summary['人工修正项数'],'0');assert.equal(summary['不符合项数'],'2');
  assert.equal(batch['问题会话数'],'1');assert.equal(batch['问题项数'],'2');assert.equal(batch['人工修正会话数'],'0');
  assert.equal(JSON.stringify(state),before);
});

test('pending manual exports retain independent drafts and unexecuted expected checks',async()=>{
  const state=manualExportFixture({confirmed:false});delete state.sessions[0].review.drafts['R-SECOND'];
  const bytes=await io.buildResultXlsx(state,{includePending:true});
  const {rows}=await table(bytes,'结果明细');assert.equal(rows.length,2);
  assert.equal(rows[0]['人工最终结论'],'');assert.equal(rows[0]['人工草稿'],'不符合');
  assert.equal(rows[0]['人工草稿证据轮次'],'7');assert.match(rows[0]['人工草稿参考条款及版本'],/评论处置政策/);
  assert.equal(rows[1]['人工草稿'],'');assert.equal(rows[1]['AI执行状态'],'未执行');
  assert.equal((await table(bytes,'批次统计')).rows[0]['问题项数'],'0');
});

test('manual HTML describes imported material and no AI execution without claiming demo data',()=>{
  const state=manualExportFixture(),html=io.buildHtmlReport(state,{taskId:'TASK-REAL'});
  assert.match(html,/人工独立审核/);assert.match(html,/AI未执行|AI未运行/);assert.match(html,/评论处置政策/);
  assert.match(html,/人工最终结论：不符合/);assert.match(html,/AI执行状态：未执行/);
  assert.doesNotMatch(html,/所有产品、客户、会话、规则和资料均为虚构|所有参考资料为V1.0虚构|· 虚构演示/);
});
test('manual detail exports retain additional source metadata at session and turn level',async()=>{
  const state=manualExportFixture();state.sessions[0].metadata={工单:'CASE-真实'};state.sessions[0].campaign='实际活动';state.sessions[0].turns[0].metadata={附件:'截图暂缺'};
  const row=(await table(await io.buildResultXlsx(state),'结果明细')).rows[0];
  assert.deepEqual(JSON.parse(row['会话扩展元数据']),{metadata:{工单:'CASE-真实'},campaign:'实际活动'});
  assert.deepEqual(JSON.parse(row['轮次扩展元数据']),[{id:7,metadata:{附件:'截图暂缺'}}]);
  assert.match(io.buildHtmlReport(state),/CASE-真实/);
});
