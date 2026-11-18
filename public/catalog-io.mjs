// 知识资料统一模板。只读取本地文件，不调用模型，也不沿用文件中的发布状态。
import { workbook, readXlsx } from './io.mjs';
import {validateCatalogSceneIds} from './catalog-scenes.mjs';

const MAX_FILE = 8 * 1024 * 1024;
const INFO_REQUIRED = ['资料标识','资料名称','资料类别','适用范围','版本号','生效日期','失效日期','维护人','变更说明','来源说明','历史状态'];
const INFO=[...INFO_REQUIRED,'场景标识'];
const CLAUSES = ['资料标识','版本号','条款标识','条款标题','条款正文'];
const text = value => String(value ?? '');
const keyOf = (id, version) => JSON.stringify([id, version]);
const fail = message => { throw new Error(message); };

export async function buildKnowledgeXlsx(records = [], { instructions = true } = {}) {
  const sheets = [
    { name:'资料信息', headers:INFO, rows:records.map(record=>[record.id,record.title,record.category,record.scope,record.version,record.effectiveAt,record.expiresAt ?? '',record.owner,record.changeNote,record.source ?? '',record.status ?? '草稿',(record.sceneIds??[]).join(';')]) },
    { name:'条款内容', headers:CLAUSES, rows:records.flatMap(record=>(record.sections ?? []).map(section=>[record.id,record.version,section.id,section.title,section.text])) },
  ];
  if (instructions) sheets.push({ name:'填写说明', headers:['项目','填写要求'], rows:[
    ['工作表','保留资料信息、条款内容两张数据表及全部表头。资料信息每行是一份资料的一个版本，条款内容每行是一条条款。'],
    ['必填内容','资料标识、资料名称、资料类别、适用范围、版本号、生效日期、维护人、变更说明，以及条款内容的所有字段。来源说明、失效日期、历史状态可留空。'],
    ['资料与条款','资料标识和版本号共同关联条款。每个资料版本至少有一条条款，同一版本内条款标识不能重复。不同版本可沿用同一条款标识。'],
    ['标识与版本','资料标识和条款标识不超过64字且不含空白。版本号使用 V主版本.次版本，例如 V1.0 或 V1.1，不使用前导零。'],
    ['日期','日期填写真实的 YYYY-MM-DD，例如 2026-10-01，也可使用 Excel 日期单元格。失效日期留空表示未设置，填写时必须晚于生效日期。'],
    ['历史状态','历史状态仅供查看。导入后所有版本均为草稿，需要在工作台检查并发布。'],
    ['场景标识','可选；新品产品咨询、电商评论回复或已注册的SCENE-标识，多项用英文分号分隔；留空表示未分配。导入预览中可以逐版本维护。'],
    ['内容限制','单次最多50个资料版本、合计500条条款。资料名称120字、资料类别60字、适用范围500字、维护人80字、变更说明和来源说明各2000字、条款标题200字、条款正文20000字。'],
    ['文件要求','仅接受8MB以内的 .xlsx 文件。不接受公式、宏、外部关系或嵌入对象。以等号开头的正文应保存为文本单元格。'],
  ] });
  return workbook(sheets);
}

function decodeAttribute(value) {
  return value.replace(/&([^;\s]+);/g, (_, entity) => {
    const known = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if (Object.hasOwn(known,entity)) return known[entity];
    const code = /^#x[\da-f]+$/i.test(entity) ? parseInt(entity.slice(2),16) : /^#\d+$/.test(entity) ? Number(entity.slice(1)) : NaN;
    if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    fail('XLSX关系含有无效或不安全的XML实体。');
  });
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(match=>[match[1],decodeAttribute(match[3])]));
}
const tags = (xml,name) => [...xml.matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b([^>]*?)(?:\\/>|>)`,'g'))].map(match=>attributes(match[1]));
const elements = (xml,name) => [...xml.matchAll(new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>)`,'g'))].map(match=>({attributes:attributes(match[1]),content:match[2] ?? ''}));
const nodeText = xml => elements(xml,'t').map(node=>decodeAttribute(node.content)).join('');

function formulaLocations(xml, name, shared, errors) {
  const rows = elements(xml,'row');
  const columnIndex = (cell,index) => {
    const label = /^([A-Z]+)\d+$/.exec(cell.attributes.r ?? '')?.[1];
    return label ? [...label].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1 : index;
  };
  const headers = [];
  elements(rows[0]?.content ?? '', 'c').forEach((cell,index)=>{
    const value = elements(cell.content,'v')[0]?.content ?? '';
    headers[columnIndex(cell,index)] = cell.attributes.t === 's' ? shared[Number(value)] ?? '' : cell.attributes.t === 'inlineStr' ? nodeText(cell.content) : decodeAttribute(value);
  });
  rows.forEach((row,index)=>elements(row.content,'c').forEach((cell,cellIndex)=>{
    if (!elements(cell.content,'f').length) return;
    const physicalRow = /^\d+$/.test(row.attributes.r ?? '') ? Number(row.attributes.r) : index+1;
    const column = columnIndex(cell,cellIndex);
    const field = headers[column] || `${/^([A-Z]+)/.exec(cell.attributes.r ?? '')?.[1] ?? column+1}列`;
    issue(errors,name,physicalRow,field,'不能包含公式，请改为文本或原始值');
  }));
}

// readXlsx 先完成体积和单元格检查；这里只补查整个包的关系及日期系统。
async function packageMetadata(bytes, { locateFormulas = false } = {}) {
  const Zip = globalThis.JSZip ?? (typeof process !== 'undefined' && process.versions?.node ? (await import('jszip')).default : null);
  if (!Zip) fail('离线文件组件未加载，请刷新页面后重试。');
  const zip = await Zip.loadAsync(bytes);
  const relationships = new Map();
  for (const entry of Object.values(zip.files).filter(entry=>!entry.dir && /\.rels$/i.test(entry.name))) {
    const xml = await entry.async('string');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('XLSX关系含有不安全的XML声明。');
    const entries = tags(xml,'Relationship');
    if (entries.some(item=>item.TargetMode?.toLowerCase() === 'external' || /^(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i.test(item.Target ?? ''))) fail('知识资料不接受外部资料关系。');
    if (entries.some(item=>/macro|vba|oleObject|externalLink/i.test(item.Type ?? ''))) fail('知识资料不接受宏、外部链接或嵌入对象。');
    relationships.set(entry.name,entries);
  }
  const types = zip.file('[Content_Types].xml');
  if (types) {
    const xml = await types.async('string');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('XLSX内容类型含有不安全的XML声明。');
    if ([...tags(xml,'Default'),...tags(xml,'Override')].some(item=>/macro|vba|oleObject|externalLink/i.test(item.ContentType ?? ''))) fail('知识资料不接受宏、外部链接或嵌入对象。');
  }
  const book = await zip.file('xl/workbook.xml').async('string');
  const dateSystem = tags(book,'workbookPr')[0]?.date1904;
  if (dateSystem !== undefined && !['0','1','false','true'].includes(dateSystem)) fail('工作簿日期系统无效。');
  const rowNumbers = {}, formulaErrors = [];
  const shared = locateFormulas && zip.file('xl/sharedStrings.xml') ? elements(await zip.file('xl/sharedStrings.xml').async('string'),'si').map(node=>nodeText(node.content)) : [];
  for (const sheet of tags(book,'sheet')) {
    const target = relationships.get('xl/_rels/workbook.xml.rels')?.find(item=>item.Id === sheet['r:id'])?.Target;
    if (!target) continue;
    const parts = [];
    for (const part of (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
    const xml = await zip.file(parts.join('/')).async('string');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('XLSX工作表含有不安全的XML声明。');
    rowNumbers[sheet.name] = tags(xml,'row').map((row,index)=>/^\d+$/.test(row.r ?? '') ? Number(row.r) : index+1);
    if (locateFormulas) formulaLocations(xml,sheet.name,shared,formulaErrors);
  }
  return { date1904:dateSystem === '1' || dateSystem === 'true', rowNumbers, formulaErrors };
}

function dataRows(tables, name, headers, errors, rowNumbers) {
  if (!Object.hasOwn(tables,name)) { errors.push(`${name} 第1行「工作表」：缺少必需工作表。`); return []; }
  const [rawHeaders = [], ...data] = tables[name];
  const actual = Array.from(rawHeaders,text);
  for (const header of headers) if (!actual.includes(header)) errors.push(`${name} 第1行「${header}」：缺少字段。`);
  const seen = new Set();
  for (const header of actual) { if (header && seen.has(header)) errors.push(`${name} 第1行「${header}」：字段重复。`); seen.add(header); }
  return data.map((row,index)=>({ row:rowNumbers[name]?.[index+1] ?? index+2, values:Object.fromEntries(actual.map((header,i)=>[header,text(row[i])])) }))
    .filter(item=>Object.values(item.values).some(value=>value.trim()));
}

function issue(errors, sheet, row, field, message) { errors.push(`${sheet} 第${row}行「${field}」：${message}。`); }
function checkText(value, field, max, errors, sheet, row, optional = false) {
  if (!optional && !value.trim()) issue(errors,sheet,row,field,'不能为空');
  if (value.length > max) issue(errors,sheet,row,field,`长度不能超过${max}个字符`);
}
function checkId(value, field, errors, sheet, row) {
  checkText(value,field,64,errors,sheet,row);
  if (/\s/.test(value)) issue(errors,sheet,row,field,'不能包含空白字符');
}
function checkVersion(value, errors, sheet, row) {
  const match = value.match(/^V(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) issue(errors,sheet,row,'版本号','须为规范的 V主版本.次版本，例如 V1.0');
}
function dateValue(value, field, errors, row, date1904, optional = false) {
  if (!value && optional) return '';
  let result = value;
  if (/^\d+(?:\.0+)?$/.test(value)) {
    const serial = Number(value);
    if (Number.isSafeInteger(serial) && serial >= (date1904 ? 0 : 1) && serial <= 3000000 && (date1904 || serial !== 60)) {
      const epoch = date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,31);
      const date = new Date(epoch + (date1904 ? serial : serial > 60 ? serial-1 : serial)*86400000);
      result = date.toISOString().slice(0,10);
    }
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(result) && !result.startsWith('0000-') ? new Date(`${result}T00:00:00Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== result) { issue(errors,'资料信息',row,field,'须为真实的 YYYY-MM-DD 日期或有效的 Excel 日期'); return ''; }
  return result;
}

function validateTables(tables, errors, metadata) {
  const info = dataRows(tables,'资料信息',INFO_REQUIRED,errors,metadata.rowNumbers);
  const clauses = dataRows(tables,'条款内容',CLAUSES,errors,metadata.rowNumbers);
  if (errors.length) return [];
  if (!info.length) issue(errors,'资料信息',2,'资料标识','至少填写一个资料版本及其条款');
  if (info.length > 50) issue(errors,'资料信息',info[50].row,'资料标识','单次最多导入50个资料版本');
  if (clauses.length > 500) issue(errors,'条款内容',clauses[500].row,'条款标识','单次合计最多导入500条条款');
  if (errors.length) return [];
  const records = [], byVersion = new Map(), recordRows = new Map();
  for (const {row,values:v} of info) {
    checkId(v['资料标识'],'资料标识',errors,'资料信息',row);
    checkVersion(v['版本号'],errors,'资料信息',row);
    for (const [field,max] of [['资料名称',120],['资料类别',60],['适用范围',500],['维护人',80],['变更说明',2000]]) checkText(v[field],field,max,errors,'资料信息',row);
    checkText(v['来源说明'],'来源说明',2000,errors,'资料信息',row,true);
    checkText(v['历史状态'],'历史状态',80,errors,'资料信息',row,true);
    const effectiveAt = dateValue(v['生效日期'],'生效日期',errors,row,metadata.date1904);
    const expiresAt = dateValue(v['失效日期'],'失效日期',errors,row,metadata.date1904,true);
    if (effectiveAt && expiresAt && expiresAt <= effectiveAt) issue(errors,'资料信息',row,'失效日期','必须晚于生效日期');
    const key = keyOf(v['资料标识'],v['版本号']);
    if (byVersion.has(key)) issue(errors,'资料信息',row,'资料标识 / 版本号','资料标识与版本号重复');
    const record = { id:v['资料标识'], title:v['资料名称'], category:v['资料类别'], scope:v['适用范围'], version:v['版本号'], effectiveAt, expiresAt, owner:v['维护人'], changeNote:v['变更说明'], source:v['来源说明'], status:'草稿', sections:[] };
    if(v['场景标识']!==undefined){
      record.sceneIds=v['场景标识'].split(/[;；]/).map(value=>value.trim()).filter(Boolean);
      try{validateCatalogSceneIds(record.sceneIds);}catch(error){issue(errors,'资料信息',row,'场景标识',error.message);}
    }
    records.push(record); byVersion.set(key,record); recordRows.set(key,row);
  }
  const sectionKeys = new Set();
  for (const {row,values:v} of clauses) {
    checkId(v['资料标识'],'资料标识',errors,'条款内容',row);
    checkVersion(v['版本号'],errors,'条款内容',row);
    checkId(v['条款标识'],'条款标识',errors,'条款内容',row);
    checkText(v['条款标题'],'条款标题',200,errors,'条款内容',row);
    checkText(v['条款正文'],'条款正文',20000,errors,'条款内容',row);
    const key = keyOf(v['资料标识'],v['版本号']);
    const sectionKey = JSON.stringify([v['资料标识'],v['版本号'],v['条款标识']]);
    if (sectionKeys.has(sectionKey)) issue(errors,'条款内容',row,'条款标识','同一资料版本内条款标识重复');
    sectionKeys.add(sectionKey);
    const record = byVersion.get(key);
    if (!record) issue(errors,'条款内容',row,'资料标识 / 版本号','关联的资料版本不存在');
    else record.sections.push({id:v['条款标识'],title:v['条款标题'],text:v['条款正文']});
  }
  for (const record of records) if (!record.sections.length) issue(errors,'资料信息',recordRows.get(keyOf(record.id,record.version)),'条款内容','每个资料版本至少填写一条条款');
  return errors.length ? [] : records;
}

export async function parseKnowledgeFile(file) {
  const errors = [];
  try {
    if (!file || typeof file.arrayBuffer !== 'function') fail('请选择可读取的知识资料文件。');
    if (!/\.xlsx$/i.test(text(file.name))) fail('知识资料仅支持 .xlsx 文件，请下载统一模板填写。');
    if (Number(file.size) > MAX_FILE) fail('知识资料文件大小不能超过8MB。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE) fail('知识资料文件为空或大小超过8MB。');
    let tables;
    try { tables = await readXlsx(bytes); }
    catch (error) {
      // 仅在通用读取器已完成压缩包边界检查并明确拒绝公式后，补充单元格位置。
      if (text(error?.message).startsWith('输入材料不能包含公式')) {
        const metadata = await packageMetadata(bytes,{locateFormulas:true});
        if (metadata.formulaErrors.length) return {valid:false,records:[],errors:metadata.formulaErrors};
      }
      throw error;
    }
    const records = validateTables(tables,errors,await packageMetadata(bytes));
    return {valid:errors.length === 0,records:errors.length ? [] : records,errors:[...new Set(errors)]};
  } catch (error) {
    const message = text(error?.message);
    return {valid:false,records:[],errors:[/[\u3400-\u9fff]/.test(message) ? message : '知识资料文件无法读取或XLSX压缩结构无效，请重新下载统一模板。']};
  }
}
