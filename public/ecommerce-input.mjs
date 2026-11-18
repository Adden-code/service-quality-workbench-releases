// Core22入口。评价类型、人工答案和扩展列只留原始记录，不投影为判断上下文。
import { readXlsx, XLSX_ROW_NUMBER, XLSX_DATE_SYSTEM, XLSX_SHEET_NAMES } from './io.mjs';
import { ecommerceSourceProjection, validateEcommerceRecord, ecommerceTimeValues, ecommerceRecordId } from './ecommerce-schema.mjs';
import {normalizeEcommerceHeader as normalize,resolveEcommerceColumns} from './ecommerce-columns.mjs';
import {validateReviewedEcommerceMapping,resolveReviewedEcommerceColumns} from './ecommerce-conversion.mjs';

const MAX_FILE = 8 * 1024 * 1024;
const populated = value => typeof value === 'string' && value.trim() !== '';
const at = (errors, sheet, row, field, message) => errors.push(`${sheet}第${row}行【${field}】：${message}`);

async function sha256(bytes) {
  if (globalThis.crypto?.subtle) return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (typeof process !== 'undefined' && process.versions?.node) return (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  throw new Error('当前环境不能计算原文件摘要，请使用本地工作台重新导入。');
}

function cells(values, row, errors, {width=22,sheet} = {}) {
  const output = Array.from({ length: width }, (_, i) => values[i] ?? '');
  output.forEach((value, index) => {
    const max = 20000;
    if (typeof value !== 'string' || value.length > max) at(errors, sheet, row, `第${index + 1}列`, `单元格必须是文本且最多${max}字符。`);
  });
  return output;
}

function toSession(record, warnings) {
  const projected=ecommerceSourceProjection(record);
  if(projected.missingNote)warnings.push(`${record.sheet}第${record.row}行：${projected.missingNote}。`);
  return{id:ecommerceRecordId(record),...projected,ecommerce:record};
}

/** Fail atomically: no sessions are returned when structural validation fails. */
export async function parseEcommerceFile(file, { thresholdHours = 24, selectedSheet, reviewedMapping } = {}) {
  const errors = [], warnings = [];
  let availableSheetNames=[],chosenSheet=null,selectedSheetIndex=null;
  const result = sessions => ({ valid: errors.length === 0, errors: [...new Set(errors)], warnings, availableSheetNames, selectedSheet:chosenSheet, selectedSheetIndex, sessions: errors.length ? [] : sessions, turnCount: errors.length ? 0 : sessions.reduce((total, session) => total + session.turns.length, 0) });
  try {
    if (typeof thresholdHours !== 'number' || !Number.isFinite(thresholdHours) || thresholdHours <= 0 || thresholdHours > 720) throw new Error('电商时效阈值须为大于0且不超过720小时的有限数字。');
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择可读取的电商评论文件。');
    if (typeof file.name !== 'string' || !/\.xlsx$/i.test(file.name)) throw new Error('电商评论仅支持.xlsx文件。');
    if (Number(file.size) > MAX_FILE) throw new Error('电商文件大小超过8MB，请分批导入。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.byteLength) throw new Error('电商文件为空。');
    if (bytes.byteLength > MAX_FILE) throw new Error('电商文件大小超过8MB，请分批导入。');
    const tables = await readXlsx(bytes,{maxColumns:16384}),sheetNames=tables[XLSX_SHEET_NAMES],physical = values => values[XLSX_ROW_NUMBER];
    const mappings=new Map(),headerFailures=new Map();let verifiedMapping,reviewedSha256;
    if(reviewedMapping!==undefined){
      if(!reviewedMapping||!Object.hasOwn(tables,reviewedMapping.sheet)||selectedSheet&&selectedSheet!==reviewedMapping.sheet)throw new Error('确认映射的来源工作表与本次选择不一致。');
      const sheet=reviewedMapping.sheet,rows=tables[sheet],header=rows.find(values=>physical(values)===1);
      if(!header)throw new Error('确认映射的来源缺少第1行真实表头。');
      const extent=rows.reduce((width,values)=>values.reduce((n,value,i)=>value!==''&&value!==undefined?Math.max(n,i+1):n,width),22),headers=Array.from({length:extent},(_,i)=>header[i]??'');
      reviewedSha256=await sha256(bytes);verifiedMapping=validateReviewedEcommerceMapping(reviewedMapping,{fileSha256:reviewedSha256,sheet,sheetIndex:sheetNames.indexOf(sheet)+1,headers});
    }
    const headerErrors=(sheet)=>{
      const header=tables[sheet].find(values=>physical(values)===1);
      if(!header){at(errors,sheet,1,'表头','第1行必须包含可唯一定位的22列核心表头。');return;}
      if(headerFailures.has(sheet))at(errors,sheet,1,'表头',headerFailures.get(sheet));
      if(!tables[sheet].some(values=>physical(values)===2))at(errors,sheet,2,'标准','第2行必须保留标准行，第3行起才是业务记录。');
    };
    availableSheetNames=sheetNames.filter(sheet=>{
      if(verifiedMapping&&sheet!==verifiedMapping.sheet)return false;
      const rows=tables[sheet],header=rows.find(values=>physical(values)===1);
      if(!header)return false;
      // Ignore all-empty styled tails while retaining every declared source column.
      const extent=rows.reduce((width,values)=>values.reduce((n,value,i)=>value!==''&&value!==undefined?Math.max(n,i+1):n,width),22);
      try{const headers=Array.from({length:extent},(_,i)=>header[i]??'');mappings.set(sheet,verifiedMapping?resolveReviewedEcommerceColumns(headers,verifiedMapping):resolveEcommerceColumns(headers));}
      catch(error){headerFailures.set(sheet,error.message);return false;}
      return rows.some(values=>physical(values)===2);
    });
    if(!availableSheetNames.length){sheetNames.forEach(headerErrors);throw new Error('未找到符合核心22列表头映射及第2行标准的工作表。');}
    if(selectedSheet!==undefined&&selectedSheet!==null&&selectedSheet!==''){
      if(typeof selectedSheet!=='string'||!availableSheetNames.includes(selectedSheet))throw new Error('请选择有效的电商来源工作表。');
      chosenSheet=selectedSheet;
    }else if(availableSheetNames.length===1)chosenSheet=availableSheetNames[0];
    else throw new Error('检测到多个符合格式的工作表，请选择本次导入的来源工作表。');
    const sheet=chosenSheet,sheetIndex=sheetNames.indexOf(sheet)+1,sourceRows=tables[sheet];
    selectedSheetIndex=sheetIndex;
    for (const name of sheetNames) if (name !== sheet) warnings.push(`已忽略未选工作表：${name}；仅导入${sheet}。`);
    const used = new Set();
    for (const values of sourceRows) {
      const row = physical(values);
      if (!Number.isSafeInteger(row) || row < 1 || row > 1048576 || used.has(row)) at(errors, sheet, row, '物理行', '行号无效、超出1048576或重复。');
      used.add(row);
    }
    const headerRow = sourceRows.find(values => physical(values) === 1), standardRow = sourceRows.find(values => physical(values) === 2);
    // A nonempty source cell declares its positional extent, including blank or
    // duplicate extension labels. All-empty styled tails do not declare columns.
    const extent=sourceRows.reduce((width,values)=>values.reduce((n,value,i)=>value!==''&&value!==undefined?Math.max(n,i+1):n,width),22),n=extent-22;
    if(43+n>16384){at(errors,sheet,1,'列数','核心22列加扩展列的导出总列数43+N不得超过16384列，未导入任何记录。');return result([]);}
    const mapping=mappings.get(sheet),sourceColumns=mapping.sourceColumns,pick=(values,columns)=>columns.map(column=>values[column-1]);
    const allHeaders=cells(headerRow,1,errors,{width:extent,sheet}),allStandards=cells(standardRow,2,errors,{width:extent,sheet}),headers=pick(allHeaders,sourceColumns.core),standards=pick(allStandards,sourceColumns.core);
    const extensionHeaders=pick(allHeaders,sourceColumns.extensions),extensionStandards=pick(allStandards,sourceColumns.extensions);
    if(mapping.legacyRelativeRegions)warnings.push(`${sheet}的Region/区域重叠别名按22个核心字段保留的原相对顺序定位，请核对两个区域字段；原表头与核心字段相对顺序保留该依据。`);
    if(verifiedMapping)warnings.push(`${sheet}已使用用户分别确认字段映射与原文样例的源列映射；原文件、原表头、原列值和物理行列保持不变。`);
    if(n&&(extensionHeaders.some(value=>!value.trim())||new Set(extensionHeaders.map(normalize)).size!==n))warnings.push(`${sheet}扩展列表头含空标签或重复标签，已按原列位置完整保留。`);
    const data = sourceRows.filter(values => physical(values) >= 3 && values.some(value=>value!==''&&value!==undefined));
    if (!data.length) at(errors, sheet, 3, '业务记录', '没有可导入的电商评论记录。');
    if (data.length > 500) at(errors, sheet, 3, '业务记录', '每个文件最多500条评论，请分批导入。');
    if (errors.length) return result([]);
    const fileSha256 = reviewedSha256??await sha256(bytes), sessions = [];
    for (const values of data) {
      const row = physical(values),allRaw=cells(values,row,errors,{width:extent,sheet}),raw=pick(allRaw,sourceColumns.core);
      if (!populated(raw[8]) && !populated(raw[9])) { at(errors, sheet, row, '评论内容/回复内容', '至少需要一条真实非空原文，不能伪造发言。'); continue; }
      if (errors.length) continue;
      const record = { schemaVersion: verifiedMapping?5:mapping.mapped?4:sheet==='Sheet4'&&n===0?2:3, sheet, row, fileSha256, headers: [...headers], standards: [...standards], raw, thresholdHours, dateSystem: tables[XLSX_DATE_SYSTEM] };
      if([3,4,5].includes(record.schemaVersion)){record.sheetIndex=sheetIndex;record.extensions={headers:[...extensionHeaders],standards:[...extensionStandards],raw:pick(allRaw,sourceColumns.extensions)};}
      if([4,5].includes(record.schemaVersion))record.sourceColumns={core:[...sourceColumns.core],extensions:[...sourceColumns.extensions]};
      if(record.schemaVersion===5)record.reviewedMapping=structuredClone(verifiedMapping);
      record.normalizedTimes = ecommerceTimeValues(record);
      validateEcommerceRecord(record);
      sessions.push(toSession(record, warnings));
    }
    return result(sessions);
  } catch (error) {
    const message = typeof error?.message === 'string' && /[\u3400-\u9fff]/.test(error.message) ? error.message : '电商文件无法读取，或XLSX压缩结构无效。';
    errors.push(message); return result([]);
  }
}
