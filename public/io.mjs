import {isProcessedUnknown} from './pending-resolution.mjs';
import {hasReviewPolicy,freezeReviewRouting,resultProvenanceSheet,resultSourceLabel} from './triage-export.mjs';
import {usableTaskState} from './task-lifecycle.mjs';
import {isSessionCheckRule} from './rule-kind.mjs';
// 演示输入保持固定材料校验；结果导出同时支持业务人工审核，不调用模型或网络。
import { demoSessions, rules, policies, getSessionResults, isUnrepliedSession } from './domain.mjs';
import { getTaskBasis, getSessionRules, resolveTaskReference } from './task-basis.mjs';
import {ecommerceComparison,ecommerceTimeExportFields} from './ecommerce-results.mjs';
import {EC_HEADERS} from './ecommerce-schema.mjs';
import {isRawReport,rawEvidenceText,rawReportNotices} from './raw-report-evidence.mjs';

const RULE_SET = 'RS-PRESALES-V1';
const JSON_FORMAT = 'SERVICE_QUALITY_DEMO_V1';
const MAX_FILE = 8 * 1024 * 1024;
const MAX_EXPANDED = 16 * 1024 * 1024;
const MAX_PART = 4 * 1024 * 1024;
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// 非枚举行号保留稀疏工作表中的真实位置，不改变旧表格数组或 JSON 序列化合同。
export const XLSX_ROW_NUMBER = Symbol('xlsxPhysicalRowNumber');
export const XLSX_CELL_METADATA = Symbol('xlsxCellMetadata');
export const XLSX_DATE_SYSTEM = Symbol('xlsxDateSystem');
export const XLSX_SHEET_NAMES = Symbol('xlsxSheetNames');
const HEADERS = {
  '会话信息': ['批次ID','会话ID','会话开始时间','会话结束时间','时区','渠道','服务阶段','产品类别','产品型号','客服标识','客户标识','关联工单ID','会话完整性','缺失说明','规则集标识'],
  '会话明细': ['会话ID','轮次序号','发言角色','发言方标识','发言时间','消息类型','原文内容','补充说明'],
  '质检规则': ['规则集标识','规则标识','质检项名称','规则版本','适用条件','通过标准','不通过标准','不适用或无法判定条件','参考资料标识','生效日期','失效日期','维护责任人','评分规则'],
  '参考资料': ['资料标识','资料名称','资料版本','相对文件路径','适用范围','生效日期','失效日期','来源说明','维护责任人','文本状态','备注'],
  '验证案例': ['案例ID','会话ID','规则标识','案例类型','人工结论','证据轮次','判断理由','参考资料标识','审核人标识','审核完成时间','争议说明'],
  '人工耗时': ['记录ID','会话ID','案例ID','审核人标识','审核类型','耗时秒','计时口径','完成时间','中断或异常说明'],
};
const notice = '所有产品、客户、会话、规则和资料均为虚构演示数据；AI结论为预置，不代表真实识别效果。未记录真实人工耗时。';
const text = value => String(value ?? '');
const xmlEscape = value => text(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
// Escape source literals before encoding controls. A single decoding pass then
// distinguishes an actual CR from the literal seven-character text _x000D_.
const spreadsheetText=value=>xmlEscape(text(value).replace(/_(?=x[\da-fA-F]{4}_)/g,'_x005F_').replace(/[\u0000-\u0008\u000B-\u000D\u000E-\u001F\uFFFE\uFFFF]/g,character=>'_x'+character.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')+'_'));
const htmlEscape = xmlEscape;
const splitIds = value => text(value).split(';').filter(Boolean);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = message => { throw new Error(message); };

let bundledNodeZip;
async function zipClass() {
  if (globalThis.JSZip) return globalThis.JSZip;
  if (typeof process !== 'undefined' && process.versions?.node) {
    // Installed programs deliberately contain no node_modules. Use exactly the
    // local vendor shipped for the browser, including on the first server-side
    // cleaning validation before any report has initialized its own ZIP reader.
    if(!bundledNodeZip)bundledNodeZip=import('./vendor/jszip.min.js').then(module=>{
      const Zip=typeof module.default==='function'?module.default:globalThis.JSZip;
      if(typeof Zip!=='function')fail('随包Excel读取组件不可用。');
      return Zip;
    });
    return bundledNodeZip;
  }
  fail('离线文件组件未加载，请刷新页面后重试。');
}

function column(index) {
  let value = index + 1, result = '';
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

function sheetXml(headers, data, rowNumbers, headerDepth=1) {
  if(!Number.isSafeInteger(headerDepth)||headerDepth<1||headerDepth>4||headerDepth>data.length+1)throw new Error('表头层数无效。');
  if(rowNumbers!==undefined&&(!Array.isArray(rowNumbers)||rowNumbers.length!==data.length||rowNumbers.some((row,index)=>!Number.isSafeInteger(row)||row<2||row>1048576||(index>0&&row<=rowNumbers[index-1]))))throw new Error('工作表物理行号须与数据逐行对应、从2起严格递增且不超过1048576，不能与表头冲突。');
  const rows = [headers, ...data];
  const physical = rowNumbers===undefined?rows.map((_,index)=>index+1):[1,...rowNumbers];
  const last = `${column(headers.length - 1)}${physical.at(-1)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerDepth}" topLeftCell="A${headerDepth+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${headers.map((name, index) => `<col min="${index + 1}" max="${index + 1}" width="${/原文|理由|标准|条件|备注|口径|条款/.test(name) ? 65 : 25}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row, index) => `<row r="${physical[index]}"${index === 0 ? ' ht="32" customHeight="1"' : ''}>${headers.map((_, c) => `<c r="${column(c)}${physical[index]}" s="${index < headerDepth ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${spreadsheetText(row[c])}</t></is></c>`).join('')}</row>`).join('')}</sheetData><autoFilter ref="A${headerDepth}:${last}"/></worksheet>`;
}

export async function workbook(sheets) {
  const Zip = await zipClass();
  const zip = new Zip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF263348"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  // Encode complete XML before compression: JSZip string chunks can split a UTF-16 surrogate pair.
  sheets.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, new TextEncoder().encode(sheetXml(sheet.headers, sheet.rows, sheet.rowNumbers,sheet.headerDepth))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const dateTime = value => text(value).replace('T', ' ').slice(0, 19);
function inputRows() {
  return {
    '会话信息': demoSessions.map(s => ['DEMO_PRESALES_20261018',s.id,dateTime(s.startedAt),'','UTC+08:00',s.channel,'售前','虚构手机',s.product,s.agent,s.customer,'',s.scenarioKey === 'missing-evidence' ? '部分缺失' : '完整',s.scenarioKey === 'missing-evidence' ? '原截图未随会话导入' : '',RULE_SET]),
    '会话明细': demoSessions.flatMap(s => s.turns.map(t => [s.id,t.id,t.role,t.speaker,`${s.startedAt.slice(0, 10)} ${t.at}:00`,t.role === '系统' ? '系统事件' : '文本',t.text,''])),
    '质检规则': rules.map(r => [RULE_SET,r.id,r.name,r.version,r.scope,r.passCriteria,r.failCriteria,r.exceptionCriteria,r.policyIds.join(';'),'2026-10-01','','演示规则维护员','不采用评分，仅作虚构演示']),
    '参考资料': policies.map(p => [p.id,p.title,p.version,`references/${p.id}.txt`,p.category,p.effectiveAt,'','人工编写的虚构演示资料','演示资料维护员','可提取文本',p.content]),
    '验证案例': [],
    '人工耗时': [],
  };
}

export async function createDemoXlsx() {
  const rows = inputRows();
  return workbook([
    ...Object.entries(HEADERS).map(([name, headers]) => ({ name, headers, rows: rows[name] })),
    { name: '交付说明', headers: ['项目','说明'], rows: [['材料性质',notice],['导入范围','仅支持本工作台的固定售前演示材料；可保留部分会话，但会话明细和关联记录必须一致。修改原文、规则或资料后不能加载预置结果。'],['资料全文','四份参考资料全文保存在参考资料表的备注列。references/P001.txt 等为配套资料的逻辑路径；本演示直接核对备注中的全文，无需请求外部文件。'],['测量边界','验证案例和人工耗时仅提供字段表头，未编造人工答案或实测耗时。'],['JSON格式',`${JSON_FORMAT}；sessions 为含 id 和 turns[{id,role,text}] 的数组；原文和顺序须与内置材料一致。可提供 rules、policies，但提供时须与固定定义完全一致。`]] },
  ]);
}

function decodeXml(value) {
  return text(value).replace(/&([^;\s]+);/g, (_, entity) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(known, entity)) return known[entity];
    if (/^#(?:\d+|x[\da-f]+)$/i.test(entity)) {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    fail('XML含有不支持或不安全的实体。');
  });
}

// 只读取有界 OOXML 单元格数据，不解释 DTD、外部实体、公式或外部关系。
function safeXml(source) {
  if (source.length > MAX_PART || /<!DOCTYPE|<!ENTITY/i.test(source)) fail('XML文件过大或含有不安全的声明。');
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) fail('XLSX中XML格式错误。');
  } else {
    const body = source.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
    const stack = [];
    let last = 0, tags = 0;
    for (const match of body.matchAll(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
      if (body.slice(last, match.index).includes('<') || ++tags > 100000) fail('XLSX中XML格式错误或内容过多。');
      const token = match[0];
      const name = /^<\/?([\w:.-]+)/.exec(token)?.[1];
      if (!name) fail('XLSX中XML格式错误。');
      if (token.startsWith('</')) { if (stack.pop() !== name) fail('XLSX中XML标签不匹配。'); }
      else if (!token.endsWith('/>')) stack.push(name);
      last = match.index + token.length;
    }
    if (stack.length || body.slice(last).includes('<') || !tags) fail('XLSX中XML不完整。');
  }
  return source;
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) result[match[1]] = decodeXml(match[3]);
  return result;
}
const matches = (xml, name) => [...xml.matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>)`, 'g'))];
const decodeSpreadsheetText=value=>decodeXml(value).replace(/_x([\da-fA-F]{4})_/g,(_,code)=>String.fromCharCode(parseInt(code,16)));
const textNodes = xml => matches(xml, 't').map(match => decodeSpreadsheetText(match[2] ?? '')).join('');
const metadataTags=(xml,name)=>[...xml.matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)(?:\\/>|>)`,'g'))].map(match=>attrs(match[1]));

function parseSheet(xml, shared, maxColumns) {
  const rows = [], rowNumbers = new Set();let previousRow=0;
  for (const row of matches(xml, 'row')) {
    if (rows.length >= 10000) fail('工作表行数超出本演示限制。');
    const rowId = attrs(row[1]).r;
    if (rowId !== undefined && !/^\d+$/.test(rowId)) fail(`工作表显式行号无效：${rowId}`);
    const physicalRow = rowId === undefined ? previousRow + 1 : Number(rowId);
    if (!Number.isSafeInteger(physicalRow) || physicalRow < 1 || physicalRow > 1048576) fail(`工作表行号须为1至1048576的整数：${rowId ?? physicalRow}`);
    if (rowNumbers.has(physicalRow)) fail(`工作表行号重复：${physicalRow}`);
    rowNumbers.add(physicalRow);
    const values = [], occupied = new Set(), cellMetadata = Object.create(null);
    let previousColumn = -1;
    for (const cell of matches(row[2] ?? '', 'c')) {
      const attributes = attrs(cell[1]);
      const reference = attributes.r === undefined ? null : /^([A-Z]+)(\d+)$/.exec(attributes.r);
      if (attributes.r !== undefined && (!reference || Number(reference[2]) !== physicalRow)) fail(`单元格坐标无效或与所属行${physicalRow}不一致：${attributes.r}`);
      const label = reference?.[1];
      const index = label ? [...label].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 : previousColumn + 1;
      if (index >= 16384 || occupied.has(index)) fail('工作表列数过多或单元格重复。');
      occupied.add(index);
      previousColumn = index;
      const content = cell[2] ?? '';
      const hasFormula = matches(content, 'f').length > 0;
      if (hasFormula) fail('输入材料不能包含公式，请保留演示原始值。');
      const value = matches(content, 'v')[0]?.[2] ?? '';
      let decoded;
      if (attributes.t === 'inlineStr') decoded = textNodes(content);
      else if (attributes.t === 's') {
        const sharedIndex = Number(value);
        if (!/^\d+$/.test(value) || shared[sharedIndex] === undefined) fail('共享字符串索引无效。');
        decoded = shared[sharedIndex];
      } else decoded = attributes.t==='str'?decodeSpreadsheetText(value):decodeXml(value);
      const hasValue = decoded !== '';
      cellMetadata[index] = Object.freeze({ type: attributes.t ?? 'n', hasFormula, hasValue });
      // Empty styles can extend to XFD without expanding a sparse row into 16384 cells.
      // Real values retain the shared reader's existing bounded-column protection.
      if (index >= maxColumns && hasValue) fail('工作表列数过多或单元格重复。');
      if (index < maxColumns && (hasValue || index < 100)) values[index] = decoded;
    }
    Object.defineProperty(values,XLSX_ROW_NUMBER,{value:physicalRow});
    Object.defineProperty(values,XLSX_CELL_METADATA,{value:Object.freeze(cellMetadata)});
    previousRow=physicalRow;
    rows.push(values);
  }
  return rows;
}

export async function readXlsx(bytes, {maxColumns=100}={}) {
  if(!Number.isSafeInteger(maxColumns)||maxColumns<1||maxColumns>16384)fail('工作表读取列数上限须为1至16384的整数。');
  const Zip = await zipClass();
  const zip = await Zip.loadAsync(bytes);
  const files = Object.values(zip.files).filter(entry => !entry.dir);
  if (files.length > 80) fail('XLSX压缩包文件数过多。');
  let expanded = 0;
  for (const entry of files) {
    const size = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PART || (expanded += size) > MAX_EXPANDED) fail('XLSX解压后大小超出离线演示限制。');
    if (/externalLinks|vbaProject|embeddings/i.test(entry.name)) fail('本演示不接受外部链接、宏或嵌入对象。');
  }
  const read = async path => { const entry = zip.file(path); if (!entry) fail(`XLSX缺少文件：${path}`); return safeXml(await entry.async('string')); };
  // 所有关系文件均要检查，包括未被会话表读取的工作表、样式和附加部件关系。
  const relationshipsByPath=new Map();
  for(const entry of files.filter(entry=>/\.rels$/i.test(entry.name))){
    const entries=metadataTags(await read(entry.name),'Relationship');
    if(entries.some(item=>item.TargetMode?.trim().toLowerCase()==='external'||/^(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i.test(item.Target?.trim()??'')))fail('输入材料不接受外部资料关系。');
    if(entries.some(item=>/macro|vba|oleObject|externalLink/i.test(item.Type??'')))fail('输入材料不接受宏、外部链接或嵌入对象。');
    relationshipsByPath.set(entry.name,entries);
  }
  const contentTypes=zip.file('[Content_Types].xml')?await read('[Content_Types].xml'):'';
  if([...metadataTags(contentTypes,'Default'),...metadataTags(contentTypes,'Override')].some(item=>/macro|vba|oleObject|externalLink/i.test(item.ContentType??'')))fail('输入材料不接受宏、外部链接或嵌入对象。');
  const book = await read('xl/workbook.xml');
  const date1904 = metadataTags(book, 'workbookPr')[0]?.date1904;
  if (date1904 !== undefined && !['0', '1', 'false', 'true'].includes(date1904)) fail('XLSX工作簿日期系统标记无效。');
  const relationships = relationshipsByPath.get('xl/_rels/workbook.xml.rels');
  if(!relationships)fail('XLSX缺少文件：xl/_rels/workbook.xml.rels');
  const shared = zip.file('xl/sharedStrings.xml') ? matches(await read('xl/sharedStrings.xml'), 'si').map(match => textNodes(match[2] ?? '')) : [];
  const tables = {};
  const sheetNames=[];
  Object.defineProperty(tables, XLSX_SHEET_NAMES, { value: sheetNames });
  Object.defineProperty(tables, XLSX_DATE_SYSTEM, { value: date1904 === '1' || date1904 === 'true' ? '1904' : '1900' });
  for (const sheet of matches(book, 'sheet')) {
    const attributes = attrs(sheet[1]);
    if (Object.hasOwn(tables,attributes.name)) fail(`工作表名称重复：${attributes.name}`);
    const relation = relationships.find(r => r.Id === attributes['r:id']);
    if (!relation || !relation.Type.endsWith('/worksheet')) fail(`工作表关系无效：${attributes.name}`);
    const target = relation.Target.startsWith('/') ? relation.Target.slice(1) : `xl/${relation.Target}`;
    const parts = [];
    for (const part of target.split('/')) { if (part === '..') { if (!parts.length) fail('工作表路径无效。'); parts.pop(); } else if (part && part !== '.') parts.push(part); }
    Object.defineProperty(tables,attributes.name,{value:parseSheet(await read(parts.join('/')), shared, maxColumns),enumerable:true});
    sheetNames.push(attributes.name);
  }
  Object.freeze(sheetNames);
  return tables;
}

function records(tables, name, errors) {
  if (!tables[name]) { errors.push(`缺少必需工作表：${name}。`); return []; }
  const [headers = [], ...data] = tables[name];
  const missing = HEADERS[name].filter(header => !headers.includes(header));
  if (missing.length) errors.push(`${name}缺少字段：${missing.join('、')}。`);
  if (new Set(headers).size !== headers.length) errors.push(`${name}有重复字段。`);
  return data.filter(row => row.some(value => text(value) !== '')).map(row => Object.fromEntries(headers.map((header, i) => [header, text(row[i])])));
}

function uniqueRows(rows, key, label, errors) {
  const keys = new Set();
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key];
    if (!value || keys.has(value)) errors.push(`${label}为空或重复：${value || '未填写'}。`);
    keys.add(value);
  }
}

function validateSessions(sessions, errors) {
  if (!Array.isArray(sessions) || !sessions.length) { errors.push('没有可导入的演示会话。'); return []; }
  if (sessions.length > demoSessions.length) errors.push('演示会话数量过多或存在重复。');
  uniqueRows(sessions, 'id', '会话ID', errors);
  for (const session of sessions) {
    const preset = demoSessions.find(s => s.id === session.id);
    if (!preset) { errors.push(`未知演示会话ID：${text(session.id)}，不能加载预置AI结果。`); continue; }
    if (!Array.isArray(session.turns) || session.turns.length !== preset.turns.length) { errors.push(`${session.id}原文轮次数量与演示材料不一致。`); continue; }
    const seen = new Set();
    session.turns.forEach((turn, index) => {
      if (seen.has(Number(turn.id))) errors.push(`${session.id}轮次重复：${turn.id}。`);
      seen.add(Number(turn.id));
      const original = preset.turns[index];
      if (Number(turn.id) !== original.id || turn.role !== original.role || turn.text !== original.text) errors.push(`${session.id}第${index + 1}轮的原文、角色或顺序与固定演示材料不一致，不能加载预置AI结果。`);
    });
  }
  return sessions;
}

function validateJson(value, errors) {
  if (!value || value.format !== JSON_FORMAT) { errors.push(`JSON必须明确标记演示格式 format=${JSON_FORMAT}。`); return []; }
  if (value.ruleSetId !== undefined && value.ruleSetId !== RULE_SET) errors.push('JSON规则集与固定演示规则不一致。');
  if (value.rules !== undefined && !same(value.rules, rules)) errors.push('JSON质检规则与固定演示定义不一致。');
  if (value.policies !== undefined && !same(value.policies, policies)) errors.push('JSON参考资料与固定演示定义不一致。');
  return validateSessions(value.sessions, errors);
}

function validateTables(tables, errors) {
  const data = Object.fromEntries(Object.keys(HEADERS).map(name => [name, records(tables, name, errors)]));
  if (errors.length) return [];
  const info = data['会话信息'], details = data['会话明细'];
  uniqueRows(info, '会话ID', '会话ID', errors);
  uniqueRows(details, row => `${row['会话ID']}:${row['轮次序号']}`, '会话轮次', errors);
  const sessionIds = new Set(info.map(row => row['会话ID']));
  const expected = inputRows();
  // 返回的是固定模板标识，不能接受后又静默丢弃会影响展示和统计的原始元数据。
  const sessionColumns = HEADERS['会话信息'].filter(field=>field!=='批次ID');
  for (const row of info) {
    const presetIndex = demoSessions.findIndex(s => s.id === row['会话ID']);
    for (const field of ['批次ID','会话ID','会话开始时间','时区','渠道','服务阶段','会话完整性','规则集标识']) if (!row[field]) errors.push(`${row['会话ID'] || '会话信息'}缺少必填值：${field}。`);
    if (presetIndex >= 0) for (const field of sessionColumns) if (row[field] !== text(expected['会话信息'][presetIndex][HEADERS['会话信息'].indexOf(field)])) errors.push(`${row['会话ID']}的${field}与固定演示材料不一致。`);
  }
  for (const row of details) {
    if (!sessionIds.has(row['会话ID'])) errors.push(`会话明细关联的会话ID不存在：${row['会话ID']}。`);
    const preset = demoSessions.find(s => s.id === row['会话ID']);
    const turn = preset?.turns.find(t => t.id === Number(row['轮次序号']));
    if (turn && row['消息类型'] !== (turn.role === '系统' ? '系统事件' : '文本')) errors.push(`${row['会话ID']}消息类型与演示原文不一致。`);
    const original=expected['会话明细'].find(item=>item[0]===row['会话ID']&&Number(item[1])===Number(row['轮次序号']));
    if(!original)errors.push(`${row['会话ID']}第${row['轮次序号']}轮不存在于固定演示原文。`);
    else for(const field of ['发言方标识','发言时间','补充说明'])if(row[field]!==text(original[HEADERS['会话明细'].indexOf(field)]))errors.push(`${row['会话ID']}第${row['轮次序号']}轮的${field}与固定演示材料不一致。`);
  }
  const ruleRows = data['质检规则'], policyRows = data['参考资料'];
  uniqueRows(ruleRows, '规则标识', '规则标识', errors);
  uniqueRows(policyRows, '资料标识', '资料标识', errors);
  const ruleIds = new Set(ruleRows.map(row => row['规则标识'])), policyIds = new Set(policyRows.map(row => row['资料标识']));
  for (const [sheet, rows, idField, definitions] of [['质检规则',ruleRows,'规则标识',rules],['参考资料',policyRows,'资料标识',policies]]) {
    if (rows.length !== definitions.length) errors.push(`${sheet}数量必须与固定演示定义一致。`);
    rows.forEach(row => {
      const index = definitions.findIndex(item => item.id === row[idField]);
      if (index < 0) { errors.push(`未知演示${sheet}：${row[idField]}。`); return; }
      const fields = sheet === '质检规则' ? HEADERS[sheet].filter(name => !['维护责任人','评分规则'].includes(name)) : HEADERS[sheet].filter(name => !['维护责任人','来源说明'].includes(name));
      if (fields.some(name => row[name] !== text(expected[sheet][index][HEADERS[sheet].indexOf(name)]))) errors.push(`${sheet}${row[idField]}的内容或版本与固定演示定义不一致。`);
    });
  }
  for (const row of ruleRows) for (const id of splitIds(row['参考资料标识'])) if (!policyIds.has(id)) errors.push(`规则${row['规则标识']}关联资料不存在：${id}。`);
  const cases = data['验证案例'], timings = data['人工耗时'];
  uniqueRows(cases, row => `${row['案例ID']}:${row['规则标识']}`, '案例ID与规则组合', errors);
  uniqueRows(timings, '记录ID', '耗时记录ID', errors);
  const caseIds = new Set(cases.map(row => row['案例ID']));
  for (const row of [...cases, ...timings]) if (!sessionIds.has(row['会话ID'])) errors.push(`关联记录中的会话ID不存在：${row['会话ID']}。`);
  for (const row of cases) {
    if (!row['案例ID'] || !ruleIds.has(row['规则标识'])) errors.push('验证案例的案例ID或规则关联无效。');
    for (const id of splitIds(row['参考资料标识'])) if (!policyIds.has(id)) errors.push(`验证案例关联资料不存在：${id}。`);
    const turns = details.filter(turn => turn['会话ID'] === row['会话ID']);
    for (const id of splitIds(row['证据轮次'])) if (!turns.some(turn => turn['轮次序号'] === id)) errors.push(`验证案例证据轮次不存在：${id}。`);
  }
  for (const row of timings) {
    if (row['案例ID'] && !caseIds.has(row['案例ID'])) errors.push(`人工耗时关联案例不存在：${row['案例ID']}。`);
    if (!(Number(row['耗时秒']) > 0)) errors.push('人工耗时必须是真实记录的正数秒值。');
    if (row['案例ID'] && !cases.some(c => c['案例ID'] === row['案例ID'] && c['会话ID'] === row['会话ID'])) errors.push('人工耗时的案例与会话关联不一致。');
  }
  return validateSessions(info.map(row => ({ id: row['会话ID'], turns: details.filter(turn => turn['会话ID'] === row['会话ID']).map(turn => ({ id: turn['轮次序号'], role: turn['发言角色'], text: turn['原文内容'] })) })), errors);
}

export async function parseInputFile(file) {
  const errors = [], warnings = [];
  try {
    if (!file || typeof file.arrayBuffer !== 'function') fail('请选择可读取的演示文件。');
    const extension = /\.([^.]+)$/.exec(text(file.name))?.[1]?.toLowerCase();
    if (!['xlsx','json'].includes(extension)) fail('仅支持离线演示 .xlsx 或 .json 文件。');
    if (Number(file.size) > MAX_FILE) fail('文件大小超过8MB，请使用演示材料。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE) fail('文件为空或大小超过8MB。');
    let sessions;
    if (extension === 'json') {
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('JSON格式无效，请使用明确标记的演示材料。'); }
      sessions = validateJson(value, errors);
    } else sessions = validateTables(await readXlsx(bytes), errors);
    if (errors.length) return { valid: false, errors: [...new Set(errors)], warnings, templateIds: [], turnCount: 0 };
    warnings.push(notice);
    return { valid: true, errors: [], warnings, templateIds: sessions.map(s => s.id), turnCount: sessions.reduce((n, s) => n + s.turns.length, 0) };
  } catch (error) {
    const message = /[\u3400-\u9fff]/.test(error.message) ? error.message : '文件无法读取或XLSX压缩结构无效，请重新下载演示模板。';
    return { valid: false, errors: [message], warnings, templateIds: [], turnCount: 0 };
  }
}

function resolveReferences(state, session, ids = []) {
  return [...new Set(ids)].map(id => {
    const resolved = resolveTaskReference(state, session, id);
    if (!resolved) return `${id}（资料未找到或标识不唯一）`;
    const { policy, section } = resolved;
    return `${id} · ${policy.version} · ${policy.title}${section ? ` · ${section.title}：${section.text}` : `：${policy.content}`}`;
  }).join('\n');
}

function reportContext(state, { taskId = '' } = {}) {
  const tasks = (state.tasks ?? []).filter(task => !taskId || task.id === taskId);
  const hasManual = tasks.some(task => task.mode === 'manual');
  const hasDemo = tasks.some(task => task.mode !== 'manual');
  const hasAI=state.sessions.some(session=>tasks.some(task=>task.id===session.taskId&&task.mode==='manual')&&session.aiExecution),hasTriage=tasks.some(hasReviewPolicy);
  const materialNotice = tasks.some(t=>t.reviewPolicy?.version===2) ? '本报告逐项保留已标定规则的AI免审与本轮人工确认；抽检和非免审项仍须人工，混合会话全部检查形成最终结论后才纳入会话质量统计。规则级状态见冻结策略与分流审计，旧任务沿用原冻结口径。' : hasTriage ? '本报告分别保留AI终判、人工确认和待人工记录。最终质量仅含有证据的AI终判PASS及本轮人工确认；AI初判、FAIL、UNCERTAIN和退回待人工记录不能冒充本轮已确认结果。真实基准未标定。' : !hasManual ? notice : hasAI
    ? `本报告使用业务导入资料${hasDemo?'，并包含虚构演示资料':''}。业务AI执行状态按会话记录；AI初判基于任务冻结依据，须经人工复核。最终质量统计仅覆盖人工已确认会话。${hasDemo?'演示任务的AI结论为预置。':''}` : hasDemo
    ? '本报告包含业务导入资料与虚构演示资料。业务任务采用人工独立审核，AI未执行；演示任务的AI结论为预置，不代表真实识别效果。最终质量统计仅覆盖人工已确认会话。'
    : '本报告使用业务导入资料及任务创建时保存的规则政策快照，当前采用人工独立审核，AI未执行。最终质量统计仅覆盖人工已确认会话；审核人是填写的标签。';
  return { hasManual, hasTriage, materialNotice, title: hasManual ? '服务会话质检明细报告' : '售前咨询质检明细报告' };
}
const sourceSessionFields=new Set(['id','externalId','taskId','scene','startedAt','topic','channel','product','agent','customer','completeness','missingNote','turns','expectedRuleIds','aiResults','aiExecution','review','reviewPolicy','aiDecision']);
const sourceTurnFields=new Set(['id','role','speaker','at','text']);
const extraFields=(record,known)=>Object.fromEntries(Object.entries(record).filter(([key])=>!known.has(key)));

function exportData(state, { taskId = '', includePending = false } = {}) {
  state=usableTaskState(state);
  const sessions = [...new Map((state.sessions ?? []).filter(s => (!taskId || s.taskId === taskId) && (includePending || s.review?.status === '已确认' || freezeReviewRouting(s,state.tasks.find(task=>task.id===s.taskId))?.aiFinal)).map(s => [s.id, s])).values()];
  const taskName = id => state.tasks?.find(task => task.id === id)?.name ?? id;
  const hasRaw=sessions.some(isRawReport),allRaw=hasRaw&&sessions.every(isRawReport);
  const context = reportContext(state, { taskId }),hasTriage=context.hasTriage;
  const timeHeaders=Object.keys(sessions.map(s=>ecommerceTimeExportFields(state,s)).find(cells=>Object.keys(cells).length)||{});
  const hasStageA=timeHeaders.length>0;
  const details = [], summaries = [];
  const countSession = session => {
    const confirmed = session.review?.status === '已确认',routing=freezeReviewRouting(session,state.tasks.find(task=>task.id===session.taskId)),aiFinal=Boolean(routing?.aiFinal),finalized=confirmed||aiFinal;
    const metaIds=new Set(getSessionRules(state,session).filter(rule=>!isSessionCheckRule(rule)).map(rule=>rule.id));
    const results = [...new Map(getSessionResults(session).filter(result=>!metaIds.has(result.ruleId)).map(result => [result.ruleId, { ai: result, draft: result.final }])).values()];
    const unreplied=confirmed&&session.review.disposition==='unreplied';
    const finals = finalized&&!unreplied ? results.map(r => r.draft).filter(Boolean) : [];
    return { confirmed, aiFinal, finalized, routing, unreplied, results, count: finals.length, failed: finals.filter(r => r.verdict === '不符合').length, unknown: finals.filter(r => r.verdict === '无法判定').length, na: finals.filter(r => r.verdict === '不适用').length, changed: confirmed&&!unreplied ? results.filter(r => r.ai.changed).length : 0 };
  };
  const stats = new Map();
  for (const session of sessions) {
    const c = countSession(session);
    const timeCells=ecommerceTimeExportFields(state,session);
    const task = state.tasks?.find(task => task.id === session.taskId);
    const basis = getTaskBasis(state, session);
    const sessionRules = getSessionRules(state, session);
    const references = ids => resolveReferences(state, session, ids);
    const aiExecution = c.results.some(({ai}) => ai.executionStatus === '已执行') ? '已执行' : session.aiExecution?.status==='running'?'运行中':session.aiExecution?.errorCode==='dependency_incomplete'?'依赖检查未完成':session.aiExecution?.status==='failed'?'失败':'未执行';
    const aiMetadata=[session.aiExecution?.modelId??'',session.aiExecution?.runId??'',session.aiExecution?.status??'',session.aiExecution?JSON.stringify(session.aiExecution):''];
    const transcript = isRawReport(session)?session.rawTranscript.text:session.turns.map(turn => `第${turn.id}轮 ${turn.role}${turn.speaker ? `（${turn.speaker}）` : ''}：${turn.text}`).join('\n');
    const sessionExtras=extraFields(session,sourceSessionFields);
    const turnExtras=session.turns.flatMap(turn=>{const extras=extraFields(turn,sourceTurnFields);return Object.keys(extras).length?[{id:turn.id,...extras}]:[];});
    for (const { ai, draft } of c.results) {
      const rule = sessionRules.find(r => r.id === ai.ruleId);
      const humanDraft=session.review?.drafts?.[ai.ruleId];
      const final = c.confirmed&&!c.unreplied&&humanDraft ? humanDraft : null;
      const hasAI = ai.executionStatus === '已执行';
      details.push([session.taskId,taskName(session.taskId),session.id,session.externalId ?? session.id,session.topic,rule?.id ?? ai.ruleId,rule?.name ?? rule?.title ?? ai.ruleId,rule?.version ?? '',hasAI ? ai.verdict : '',final?.verdict ?? '',session.review?.status ?? '',transcript,(final?.evidence ?? (hasAI ? ai.evidence : []) ?? []).join(';'),final?.reason ?? '',hasAI ? ai.reason : '',references(final?.referenceIds ?? (hasAI ? ai.referenceIds ?? rule?.policyIds : [])),hasAI ? references(ai.referenceIds ?? rule?.policyIds) : '',session.review?.reviewer ?? '',c.confirmed ? session.review.completedAt ?? '' : '',!c.confirmed ? humanDraft?.verdict ?? '' : '',!c.confirmed ? humanDraft?.reason ?? '' : '',humanDraft?.source ?? '',aiExecution,session.scene ?? '',session.startedAt ?? '',session.channel ?? '',session.product ?? '',session.agent ?? '',session.customer ?? '',session.completeness ?? '',session.missingNote ?? '',session.turns.map(turn => `${turn.id}: ${turn.at ?? ''}`).join('\n'),basis.effectiveDate ?? '',basis.capturedAt ?? '',task?.source?.name ?? task?.fileName ?? '',task?.source?.sha256 ?? '',!c.confirmed ? (humanDraft?.evidence ?? []).join(';') : '',!c.confirmed ? references(humanDraft?.referenceIds ?? []) : '',Object.keys(sessionExtras).length?JSON.stringify(sessionExtras):'',turnExtras.length?JSON.stringify(turnExtras):'']);
      details.at(-1).push(...aiMetadata,(session.contextFields||[]).map(f=>`${f.key} ${f.label}：${f.value}（${f.source.sheet} 第${f.source.row}行 ${f.source.column}）`).join('\n'),(hasAI?ai.fieldEvidence||[]:[]).join(';'),(humanDraft?.fieldEvidence||[]).join(';'),task?.importMappingSnapshot?JSON.stringify(task.importMappingSnapshot):'');
      const ec=session.ecommerce,comparison=ecommerceComparison(session).find(row=>row.ruleId===ai.ruleId);
      details.at(-1).push(comparison?.referenceRaw||'',ec?.raw[20]||'',ec?.raw[21]||'',comparison?.agreement||'',ai.batchEvidence?JSON.stringify(ai.batchEvidence):'',ec?`${ec.sheet} 第${ec.row}行`:'',ec?(timeCells['阶段口径']?`${timeCells['阶段口径']}；${timeCells['时效计算模式']}；分类阈值读取冻结配置；其余四项V1`:`北京时间；连续计时；测试阈值${ec.thresholdHours}小时；本任务同管理员批次比较`):'',ai.semanticReason||'',...timeHeaders.map(key=>timeCells[key]??''));
      if(hasTriage&&(c.aiFinal||ai.ruleExempt)){details.at(-1)[17]='';details.at(-1)[18]='';}
      if(hasTriage)details.at(-1).push(!c.unreplied&&(c.finalized||ai.ruleExempt)?draft?.verdict??'':'',isProcessedUnknown(session)?'已处理，结论仍无法判定':ai.ruleExempt?'AI规则免审':resultSourceLabel(c.confirmed?'human':c.aiFinal?'ai':null),c.routing?.status||'LEGACY',c.routing?.policy.confidenceThreshold??'',c.routing?.policy.version===2?'逐规则标定':c.routing?'未标定':'');
      if(isRawReport(session)){details.at(-1)[12]=rawEvidenceText(final??(hasAI?ai:null));details.at(-1)[36]=!c.confirmed?rawEvidenceText(humanDraft):'';}
      if(hasRaw){const adopted=final??(hasAI?ai:null);details.at(-1).push(isRawReport(session)?JSON.stringify(adopted?.evidenceQuotes||[]):'',isRawReport(session)?JSON.stringify(adopted?.turnRefs||[]):'',isRawReport(session)?JSON.stringify(adopted?.rawValidation||{}):'',isRawReport(session)?JSON.stringify(session.rawTranscript.timePolicy):'');}
    }
    summaries.push([session.taskId,taskName(session.taskId),session.id,session.externalId ?? session.id,session.review?.status ?? '',c.finalized ? c.count : '',c.finalized ? c.failed : '',c.finalized ? c.unknown : '',c.finalized ? c.na : '',c.confirmed ? c.changed : '',!c.results.length?'无会话检核项':c.aiFinal?'AI终判通过':isProcessedUnknown(session)?'已处理，结论仍无法判定':!c.confirmed ? '未确认' : c.failed ? '存在不符合' : c.unknown ? '含无法判定' : '未发现不符合',session.review?.reviewer ?? '',c.confirmed ? session.review.completedAt ?? '' : '',aiExecution,session.scene ?? '',c.results.length]);
    summaries.at(-1).push(...aiMetadata);
    if(c.unreplied){for(const index of [5,6,7,8,9])summaries.at(-1)[index]='';summaries.at(-1)[10]='未回复事实已确认';}
    summaries.at(-1).push(...timeHeaders.map(key=>timeCells[key]??''));
    if(hasTriage&&c.aiFinal)summaries.at(-1)[11]='';
    if(hasTriage)summaries.at(-1).push(isProcessedUnknown(session)?'已处理，结论仍无法判定':resultSourceLabel(c.confirmed?'human':c.aiFinal?'ai':null),c.routing?.status||'LEGACY',c.routing?.policy.confidenceThreshold??'',c.routing?.policy.version===2?'逐规则标定':c.routing?'未标定':'');
    if (!stats.has(session.taskId)) stats.set(session.taskId, { id: session.taskId, exported: 0, reviewed: 0, problems: 0, issues: 0, unknown: 0, changed: 0 });
    const batch = stats.get(session.taskId); batch.exported++;
    batch.unreplied=(batch.unreplied||0)+Number(isUnrepliedSession(state,session));
    batch.confirmedUnreplied=(batch.confirmedUnreplied||0)+Number(c.unreplied);
    batch.noChecks=(batch.noChecks||0)+Number(c.finalized&&!c.unreplied&&!c.results.length);
    batch.humanConfirmed=(batch.humanConfirmed||0)+Number(c.confirmed);batch.aiFinal=(batch.aiFinal||0)+Number(c.aiFinal);
    if (c.finalized) { batch.reviewed++; batch.problems += Number(c.failed > 0); batch.issues += c.failed; batch.unknown += c.unknown; batch.changed += Number(c.changed > 0); }
  }
  if (taskId && !stats.has(taskId)) stats.set(taskId, { id: taskId, exported: 0, reviewed: 0, problems: 0, issues: 0, unknown: 0, changed: 0 });
  const ecommerceHeaders=['原人工参考结论','原人工整体结果','原人工问题说明','原参考与AI对照','AI跨记录证据','电商来源行','电商测试口径','原模型语义理由'];
  const checkedQuality=s=>s.reviewed-(s.noChecks||0);
  const sheets=[
    { name: '结果明细', headers: ['批次ID','批次名称','会话ID','原始会话ID','咨询主题','规则标识','检查项','规则版本','AI初判','人工最终结论','审核状态','完整会话原文','证据轮次','判断理由','AI判断理由','参考资料条款及版本','AI参考条款及版本','审核人','完成时间','人工草稿','人工草稿理由','人工处理方式','AI执行状态','会话场景','会话开始时间','渠道','产品','客服标识','客户标识','会话完整性','缺失说明','发言时间及轮次','依据快照生效日期','依据快照保存时间','原文件名称','原文件SHA256','人工草稿证据轮次','人工草稿参考条款及版本','会话扩展元数据','轮次扩展元数据','AI模型ID','AI运行ID','AI运行状态','AI执行记录','场景配套字段及来源','AI字段证据','人工字段证据','导入配置快照',...ecommerceHeaders], rows: details },
    { name: '会话汇总', headers: ['批次ID','批次名称','会话ID','原始会话ID','审核状态','已确认检查项数','不符合项数','无法判定项数','不适用项数','人工修正项数','会话结论','审核人','完成时间','AI执行状态','会话场景','预期检查项数','AI模型ID','AI运行ID','AI运行状态','AI执行记录'], rows: summaries },
    { name: '批次统计', headers: ['批次ID','批次名称','导出会话数','人工已确认会话数','未确认会话数','问题会话数','问题项数','无法判定项数','人工修正会话数','无不符合会话数','无不符合占比','统计说明'], rows: [...stats.values()].map(s => [s.id,taskName(s.id),s.exported,s.reviewed,s.exported-s.reviewed,s.problems,s.issues,s.unknown,s.changed,checkedQuality(s)-s.problems,checkedQuality(s) ? `${Math.round((checkedQuality(s)-s.problems)/checkedQuality(s)*1000)/10}%` : '', '仅统计本次导出范围的已确认最终结论；无法判定单列，无不符合不等于全部通过。'+(s.noChecks?' 无会话检核项的记录不参与质量占比。':'')]) },
    { name: '口径说明', headers: ['项目','口径'], rows: [['材料性质',context.materialNotice],['导出范围',`批次：${taskId || '全部批次'}；${includePending ? '包含未确认会话' : '仅已确认会话'}。`],['最终结论','只有审核状态为已确认时，人工最终结论和完成时间才有值；未确认的修改仅保留在人工草稿列。'],['AI与人工',context.hasManual ? 'AI执行状态为未执行时，AI初判、AI判断理由及AI参考条款留空。人工独立审核不计为AI改判。存在的AI原始值予以保留，不被人工结果覆盖。' : 'AI初判、AI判断理由和AI参考条款保留原值；人工修改另列，不覆盖AI。'],['问题计数','仅人工最终结论为不符合才计为问题。每段会话、每条规则只计算一次。'],['无法判定','无法判定单独计数；既不算不符合，也不能宣称已通过。无不符合占比只表示已确认会话中未发现不符合的比例。'],['完整原文','结果明细保留整段原文、发言角色及轮次。证据轮次关联本会话原文。'],['资料版本',context.hasManual ? '规则及政策引用读取任务保存的依据快照，保留版本及条款正文；目录后续修改不会改写旧任务依据。' : '条款ID和文档ID均解析到对应资料版本；所有参考资料为V1.0虚构说明。'],['人工耗时','未提供真实实测耗时，不计算效率提升。']] },
  ];
  if(hasStageA){
    sheets[0].headers.push(...timeHeaders);sheets[1].headers.push(...timeHeaders);
    sheets[2].headers.push('质量分母','未回复事实数','未回复事实已确认数');
    [...stats.values()].forEach((stat,index)=>{const row=sheets[2].rows[index],quality=checkedQuality(stat)-(stat.confirmedUnreplied||0);row[9]=quality-stat.problems;row[10]=quality?`${Math.round((quality-stat.problems)/quality*1000)/10}%`:'';row[11]+=' 未回复事实确认计入审核进度，排除出质量分母。';row.push(quality,stat.unreplied||0,stat.confirmedUnreplied||0);});
    sheets[3].rows.push(['阶段A范围','V2.1-A仅升级时效；其余四项仍执行V1。工作日历未核对时按当前配置试算，不能声称已排除实际法定节假日。'],['未回复事实','只有回复正文与首次回复时间均为空才是未回复。事实确认不形成质量通过或不通过，排除出质量分母。'],['原人工参考为旧口径','原人工参考按此前Sheet4或其他旧口径形成，保留对照；差异不等同于AI错误或准确率。']);
    sheets.push({name:'电商原表留存',headers:['批次ID','会话ID','工作表','来源行',...EC_HEADERS],rows:sessions.filter(s=>s.ecommerce).map(s=>[s.taskId,s.id,s.ecommerce.sheet,s.ecommerce.row,...s.ecommerce.raw])});
  }
  if(hasTriage){
    sheets[0].headers.push('最终结论','最终判定来源','分流状态','置信度门槛','真实基准');sheets[1].headers.push('最终判定来源','分流状态','置信度门槛','真实基准');sheets[1].headers[5]='最终检查项数';sheets[2].headers[3]='已形成最终结论会话数';sheets[2].headers.push('AI终判会话数','人工已确认会话数');
    [...stats.values()].forEach((stat,index)=>sheets[2].rows[index].push(stat.aiFinal||0,stat.humanConfirmed||0));
    sheets[3].rows.find(row=>row[0]==='最终结论')[1]='AI终判与本轮人工确认分别留存。人工最终结论、人工审核人及人工完成时间只取本轮已确认人工；AI终判独立列示来源，待人工初判不进入最终统计。';
    sheets[3].rows.find(row=>row[0]==='问题计数')[1]='只有本轮人工已确认的不符合形成最终问题；待人工的FAIL、UNCERTAIN与退回记录不计作最终不通过。';
    const routed=sessions.map(session=>{const task=state.tasks.find(task=>task.id===session.taskId);return{id:session.id,externalId:session.externalId,routing:freezeReviewRouting(session,task)};}).filter(record=>record.routing);
    if(routed.length)sheets.push(resultProvenanceSheet({reviewPolicy:routed[0].routing.policy,records:routed,resultScope:'final'}));
  }
  if(hasRaw){
    sheets[0].headers[12]=allRaw?'证据引文':'证据（原文引文/结构化轮次）';sheets[0].headers[36]=allRaw?'人工草稿证据引文':'人工草稿证据（原文引文/结构化轮次）';
    sheets[0].headers.push('引文定位（UTF-16）','轮次参考（模型估计）','原文引文校验诊断','来源时间声明');
    const raws=sessions.filter(isRawReport);sheets[3].rows.push(...rawReportNotices({inputMode:'raw-transcript-v1',records:raws,reviewPolicy:state.tasks.find(task=>task.id===raws[0]?.taskId)?.reviewPolicy}).map((notice,index)=>[['原文证据','原文来源时间','自评门槛','金标准对照'][index]||'执行状态',notice]));
    sheets[3].rows.find(row=>row[0]==='完整原文')[1]='原文直判保留冻结原表单元格完整字符串；已定位引文逐字锚定本行，不把模型估计轮次或译文作为原文证据。结构化历史任务仍保留原轮次合同。';
  }
  if(sessions.some(session=>getSessionRules(state,session).some(rule=>!isSessionCheckRule(rule))))sheets[3].rows.push(['规则作用域','交付物要求不生成检查项或质量计数；历史冻结结果继续保留在工作区。没有会话检核项的记录不参与质量占比。']);
  const processed=sessions.filter(isProcessedUnknown);
  if(processed.length){
    sheets.push({name:'已处理待补充',headers:['批次ID','会话ID','原会话ID','处理状态','保留无法判定的规则','处理原因','操作人标签（未认证）','处理时间','处理历史'],rows:processed.map(session=>{const r=session.review.resolution;return[session.taskId,session.id,session.externalId||session.id,'已处理，结论仍无法判定',r.unknownRuleIds.join(';'),r.reason,r.actor,r.at,JSON.stringify(session.review.resolutionHistory||[])];})});
    sheets[3].rows.push(['已处理待补充','人工处理工作已结束，但未形成最终质量结论；本表单独保留，不计为通过或进入最终质量分母。仅已确认范围不会包含此类记录；追溯时请选择包含未确认会话。']);
  }
  return sheets;
}

export function excelSafeSheets(sheets){
  const chunks=[],references=new Map();
  const safe=value=>{
    if(typeof value!=='string'||value.length<=32767)return value;
    if(references.has(value))return references.get(value);
    const ref=`TEXT-${String(references.size+1).padStart(5,'0')}`,parts=[];
    for(let start=0;start<value.length;){
      let end=Math.min(start+32700,value.length);
      if(end<value.length&&value.charCodeAt(end-1)>=0xD800&&value.charCodeAt(end-1)<=0xDBFF)end--;
      parts.push(value.slice(start,end));start=end;
    }
    parts.forEach((part,index)=>chunks.push([ref,index+1,parts.length,part]));
    const marker=`完整内容见长文本留存：${ref}（${parts.length}段；共${value.length}字符）`;
    references.set(value,marker);return marker;
  };
  const result=sheets.map(sheet=>({...sheet,headers:sheet.headers.map(safe),rows:sheet.rows.map(row=>row.map(safe))}));
  if(chunks.length)result.push({name:'长文本留存',headers:['内容标识','分段序号','总段数','完整内容分段'],rows:chunks});
  return result;
}
export async function buildResultXlsx(state, options = {}) { return workbook(excelSafeSheets(exportData(state, options))); }

export function buildHtmlReport(state, options = {}) {
  const sheets = exportData(state, options);
  const context = reportContext(state, options);
  const finalTitle=row=>context.hasTriage&&row[sheets[0].headers.indexOf('最终判定来源')]==='AI终判'?`AI终判：${row[sheets[0].headers.indexOf('最终结论')]}`:row[sheets[0].headers.indexOf('人工确认类型')]==='未回复事实已确认'?'未回复事实已确认':`人工最终结论：${row[9] || '未确认'}`;
  const table = sheet => `<div class="scroll"><table><thead><tr>${sheet.headers.map(header => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead><tbody>${sheet.rows.map(row => `<tr>${sheet.headers.map((_, index) => `<td>${htmlEscape(row[index])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(context.title)}${context.hasManual ? '' : ' · 虚构演示'}</title><style>body{font:14px/1.65 "Microsoft YaHei",sans-serif;color:#263348;margin:32px;background:#fff}h1{font-size:26px}h2{font-size:19px;margin-top:32px}.notice{padding:14px;border-left:4px solid #b51e32;background:#fff4f4}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #dce0e6;padding:9px;text-align:left;vertical-align:top;white-space:pre-wrap;min-width:90px;overflow-wrap:anywhere}th{background:#f3f5f8}details{margin:18px 0;padding:12px;border:1px solid #dce0e6}summary{cursor:pointer;font-weight:600}.detail-table td{min-width:130px}@media print{body{margin:15mm}.scroll{overflow:visible}table{font-size:10px}details{break-inside:avoid}}</style></head><body><h1>${htmlEscape(context.title)}</h1><p class="notice">${htmlEscape(context.materialNotice)}</p><h2>批次统计</h2>${table(sheets[2])}<h2>会话汇总</h2>${table(sheets[1])}<h2>审核明细</h2>${sheets[0].rows.map(row => `<details open><summary>${htmlEscape(`${row[3]} · ${row[6]} · ${row[22] === '已执行' ? `AI初判：${row[8]}` : `AI执行状态：${row[22]}`} · ${finalTitle(row)}`)}</summary>${table({ headers: ['字段','内容'], rows: sheets[0].headers.map((header, i) => [header,row[i]]) })}</details>`).join('') || '<p>当前范围没有可导出的审核明细。</p>'}<h2>口径说明</h2>${table(sheets[3])}${sheets.slice(4).map(sheet=>`<h2>${htmlEscape(sheet.name)}</h2>${table(sheet)}`).join('')}</body></html>`;
}
