// 原始单元格始终保持文本；v2单独记录日期系统与可核验的时间解释。
import {EC_HEADERS,validateEcommerceSourceColumns} from './ecommerce-columns.mjs';
import {validateReviewedEcommerceMapping} from './ecommerce-conversion.mjs';
export {EC_HEADERS} from './ecommerce-columns.mjs';
export const EC_RULE_IDS = Object.freeze(['EC-TIME', 'EC-TEXT', 'EC-TARGET', 'EC-STEPS', 'EC-PRIVACY']);
const RECORD_KEYS = ['schemaVersion', 'sheet', 'row', 'fileSha256', 'headers', 'standards', 'raw', 'thresholdHours'];
const fail = message => { throw new Error(`电商记录${message}`); };

/** Recognize Beijing local text and explicit +08:00 ISO. Invalid/unknown input stays unknown. */
export function parseBeijingTime(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  const local = /^(\d{4})([-/])(\d{2})\2(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?\+08:00$/.exec(value);
  if (!local && !iso) return null;
  const parts = local ? [local[1], local[3], local[4], local[5], local[6], local[7] ?? '00'] : iso.slice(1, 7);
  const [year, month, day, hour, minute, second] = parts.map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return null;
  const [y, mo, d, h, mi, s] = parts;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${iso?.[7] ?? ''}+08:00`;
}

const DAY_MS = 86400000;
const SERIAL_DATE_MIN = Date.UTC(2000, 0, 1);
const SERIAL_DATE_END = Date.UTC(2101, 0, 1);
const localIso = wallMs => new Date(wallMs).toISOString().replace(/\.000Z$/, '+08:00').replace(/Z$/, '+08:00');

/** Excel serials are Beijing wall-clock readings, not UTC instants. Accept
 * business dates from 2000-01-01 through 2100-12-31 in either workbook system.
 * Round fractions of both serial days and text seconds to the nearest millisecond,
 * with an exact half millisecond rounded forward. Never round the elapsed duration.
 */
function normalizedTime(raw, dateSystem) {
  const text = parseBeijingTime(raw);
  if (text) {
    const fraction = (/\.(\d+)\+08:00$/.exec(text)?.[1] ?? '').padEnd(4, '0');
    const wholeSecond = text.replace(/\.\d+(?=\+08:00$)/, '');
    const millis = Number(fraction.slice(0, 3)) + (fraction[3] >= '5' ? 1 : 0);
    return localIso(Date.parse(wholeSecond) + 8 * 3600000 + millis);
  }
  if (typeof raw !== 'string' || !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) return null;
  const serial = Number(raw.trim());
  if (!Number.isFinite(serial)) return null;
  const epoch = dateSystem === '1904' ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const wallMs = epoch + Math.round(serial * DAY_MS);
  if (!Number.isFinite(wallMs) || wallMs < SERIAL_DATE_MIN || wallMs >= SERIAL_DATE_END) return null;
  return localIso(wallMs);
}

export function ecommerceTimeValues(record) {
  const parse = [2,3,4,5].includes(record.schemaVersion) ? raw => normalizedTime(raw, record.dateSystem) : parseBeijingTime;
  return { commentTime: parse(record.raw[12]), replyTime: parse(record.raw[13]) };
}

// The original full header remains in record.headers; the short source name keeps
// existing 160-character source/evidence contracts and stable context-field keys.
export function ecommerceSourceColumn(record, index) {
  return record.headers[index].length > 160 ? EC_HEADERS[index] : record.headers[index];
}

export function validateEcommerceRecord(record) {
  const keys = [3,4,5].includes(record?.schemaVersion) ? [...RECORD_KEYS, 'dateSystem', 'normalizedTimes', 'sheetIndex', 'extensions', ...([4,5].includes(record.schemaVersion)?['sourceColumns']:[]), ...(record.schemaVersion===5?['reviewedMapping']:[])] : record?.schemaVersion === 2 ? [...RECORD_KEYS, 'dateSystem', 'normalizedTimes'] : RECORD_KEYS;
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Reflect.ownKeys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) fail(`结构须仅包含规定的${keys.length}个字段。`);
  if (![1, 2, 3, 4, 5].includes(record.schemaVersion) || ([3,4,5].includes(record.schemaVersion) ? typeof record.sheet!=='string'||!record.sheet.trim()||record.sheet.length>80 : record.sheet !== 'Sheet4')) fail('版本或工作表无效。');
  if([3,4,5].includes(record.schemaVersion)){
    if(!Number.isSafeInteger(record.sheetIndex)||record.sheetIndex<1||record.sheetIndex>16384)fail('工作表序号须为1至16384的整数。');
    const extensions=record.extensions,keys=['headers','standards','raw'];
    if(!extensions||typeof extensions!=='object'||Array.isArray(extensions)||Reflect.ownKeys(extensions).length!==3||keys.some(key=>!Object.hasOwn(extensions,key)))fail('扩展列结构须仅包含headers、standards、raw。');
    const n=extensions.headers?.length;
    if(!Number.isSafeInteger(n)||n<0||43+n>16384)fail('导出总列数43+扩展列数不得超过16384列。');
    for(const key of keys){const values=extensions[key];if(!Array.isArray(values)||values.length!==n)fail('扩展列的表头、标准与原值须等长。');for(let i=0;i<n;i++)if(typeof values[i]!=='string'||values[i].length>20000)fail(`扩展列${key}第${i+1}列须为文本且最多20000字符。`);}
  }
  if (!Number.isSafeInteger(record.row) || record.row < 3 || record.row > 1048576) fail('物理行须为3至1048576的整数。');
  if (typeof record.fileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.fileSha256)) fail('原文件摘要须为64位小写十六进制。');
  for (const key of ['headers', 'standards', 'raw']) {
    const values = record[key], max = key === 'headers' && record.schemaVersion === 1 ? 160 : 20000;
    if (!Array.isArray(values) || values.length !== 22) fail(`${key}字段须为22个文本单元格。`);
    for (let i = 0; i < 22; i++) if (typeof values[i] !== 'string' || values[i].length > max) fail(`${key}第${i + 1}列须为文本且最多${max}字符。`);
  }
  if([4,5].includes(record.schemaVersion))validateEcommerceSourceColumns(record.sourceColumns,record.headers,record.extensions.headers,record.schemaVersion===5?record.reviewedMapping:undefined);
  if(record.schemaVersion===5){
    const headers=Array(22+record.extensions.headers.length);record.sourceColumns.core.forEach((column,index)=>headers[column-1]=record.headers[index]);record.sourceColumns.extensions.forEach((column,index)=>headers[column-1]=record.extensions.headers[index]);
    validateReviewedEcommerceMapping(record.reviewedMapping,{fileSha256:record.fileSha256,sheet:record.sheet,sheetIndex:record.sheetIndex,headers});
  }
  if (typeof record.thresholdHours !== 'number' || !Number.isFinite(record.thresholdHours) || record.thresholdHours <= 0 || record.thresholdHours > 720) fail('时效阈值须为大于0且不超过720小时的有限数字。');
  if ([2,3,4,5].includes(record.schemaVersion)) {
    if (!['1900', '1904'].includes(record.dateSystem)) fail('日期系统须为1900或1904。');
    const times = record.normalizedTimes, expected = ecommerceTimeValues(record);
    if (!times || typeof times !== 'object' || Array.isArray(times) || Reflect.ownKeys(times).length !== 2 ||
        !Object.hasOwn(times, 'commentTime') || !Object.hasOwn(times, 'replyTime') ||
        times.commentTime !== expected.commentTime || times.replyTime !== expected.replyTime) fail('标准化时间须与原单元格及日期系统一致。');
  }
  return true;
}

// One canonical projection for import, persistence validation and model requests.
// Human reference columns 15..21 and evaluation type column14 never enter it.
export function ecommerceSourceProjection(record){
  validateEcommerceRecord(record);
  const raw=record.raw,{commentTime,replyTime}=ecommerceTimeValues(record),missing=[];
  if(!raw[8].trim())missing.push('缺少评论内容');
  if(!raw[9].trim())missing.push('缺少回复内容');
  if(!raw[11].trim())missing.push('缺少管理员，不能核对同管理员批次重复');
  if(!commentTime)missing.push(raw[12].trim()?'评论时间无法识别为有效北京时间':'缺少评论时间');
  if(!replyTime)missing.push(raw[13].trim()?'首次回复时间无法识别为有效北京时间':'缺少首次回复时间');
  if(commentTime&&replyTime&&Date.parse(replyTime)<Date.parse(commentTime))missing.push('首次回复时间早于评论时间，时效待判定');
  const turns=[];
  if(raw[8].trim())turns.push({id:1,role:'客户',speaker:'',at:commentTime||'',text:raw[8]});
  if(raw[9].trim())turns.push({id:turns.length+1,role:'客服',speaker:raw[11],at:replyTime||'',text:raw[9]});
  const fields=[[0,'regionGroup'],[2,'region'],[3,'country'],[6,'skuCode'],[7,'skuName'],[10,'rating'],[11,'administrator'],[12,'commentTime'],[13,'replyTime']];
  return{scene:'电商评论回复',startedAt:commentTime||'',topic:raw[8].slice(0,120),channel:'电商评论',product:raw[7],agent:raw[11],customer:'',completeness:missing.length?'部分缺失':'完整',missingNote:missing.join('；'),turns,
    contextFields:fields.map(([index,key])=>({key,label:EC_HEADERS[index],type:'text',value:raw[index],source:{sheet:record.sheet,row:record.row,column:ecommerceSourceColumn(record,index)}}))};
}
export const ecommerceRecordId=record=>`EC-${record.fileSha256.slice(0,32)}-${[3,4,5].includes(record.schemaVersion)?`S${record.sheetIndex}`:'Sheet4'}-${record.row}`;
// A task and a frozen deliverable must use one worksheet and one positional descriptor.
export function validateEcommerceSources(records,source){
  if(!Array.isArray(records)||!records.length)fail('来源记录不能为空。');
  records.forEach(validateEcommerceRecord);const first=records[0];
  const descriptor=r=>JSON.stringify([r.schemaVersion,r.fileSha256,r.sheet,r.sheetIndex,r.headers,r.standards,r.dateSystem,r.extensions?.headers,r.extensions?.standards,r.sourceColumns,r.reviewedMapping]);
  if(records.some(r=>descriptor(r)!==descriptor(first)))fail('同次任务的工作表、序号、表头、标准与扩展列来源须完全一致。');
  if(source?.worksheet!==undefined){
    const sheet=source.worksheet;
    if(!sheet||typeof sheet!=='object'||Array.isArray(sheet)||Reflect.ownKeys(sheet).length!==2||!Object.hasOwn(sheet,'name')||!Object.hasOwn(sheet,'index')||sheet.name!==first.sheet||!Number.isSafeInteger(sheet.index)||sheet.index<1||sheet.index>16384||records.some(r=>[3,4,5].includes(r.schemaVersion)&&r.sheetIndex!==sheet.index))fail('任务来源工作表名称及序号与行来源不一致。');
  }
  return true;
}
export function validateEcommerceSource(session,{sourceId=session.externalId??session.id}={}){
  const expected=ecommerceSourceProjection(session.ecommerce);
  if(sourceId!==ecommerceRecordId(session.ecommerce))throw new Error('电商来源标识须对应文件摘要、工作表与真实行号。');
  for(const [key,value] of Object.entries(expected))if(JSON.stringify(session[key])!==JSON.stringify(value))throw new Error(`电商原文/模型字段${key}与原来源投影不一致，禁止混入人工参考答案。`);
  return true;
}
