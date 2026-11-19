// Reviewed source-column assignments only. Never rewrite a workbook or invent cells.
import {readXlsx,XLSX_ROW_NUMBER,XLSX_SHEET_NAMES} from './io.mjs';

export const REVIEWED_ECOMMERCE_MAPPING_VERSION=1;
const clone=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=message=>{throw new Error(`电商源列映射${message}`);};
const text=(value,max)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=max;
function checkedHeaders(headers){if(!Array.isArray(headers)||headers.length<1||headers.length>16363||headers.some(header=>typeof header!=='string'||header.length>20000))fail('须保留真实原表头，且满足单元格及导出列数上限。');}
function sourceIdentity(source){
 if(!plain(source)||!/^[a-f0-9]{64}$/.test(source.fileSha256)||!text(source.sheet,80)||!Number.isSafeInteger(source.sheetIndex)||source.sheetIndex<1||source.sheetIndex>16384)fail('原文件摘要或工作表来源无效。');
 checkedHeaders(source.headers);
}
export function validateEcommerceMapping(mappings,headers,{complete=false}={}){
 checkedHeaders(headers);
 if(!Array.isArray(mappings)||mappings.length>22)fail('建议须为最多22项的原列映射。');
 const targets=new Set(),columns=new Set();
 for(const mapping of mappings){
  if(!exact(mapping,['targetIndex','sourceColumn','sourceHeader'])||!Number.isSafeInteger(mapping.targetIndex)||mapping.targetIndex<0||mapping.targetIndex>21||!Number.isSafeInteger(mapping.sourceColumn)||mapping.sourceColumn<1||mapping.sourceColumn>headers.length||!text(mapping.sourceHeader,20000)||mapping.sourceHeader!==headers[mapping.sourceColumn-1])fail('字段索引、原物理列号或逐字原表头无效；不能补造缺列。');
  if(targets.has(mapping.targetIndex)||columns.has(mapping.sourceColumn))fail('存在重复字段或来源列冲突，每个核心字段须使用不同原列。');
  targets.add(mapping.targetIndex);columns.add(mapping.sourceColumn);
 }
 if(complete&&targets.size!==22)fail('缺失核心字段，确认应用前必须完整映射22个字段；禁止补造缺列。');
 return mappings.map(mapping=>({...mapping})).sort((a,b)=>a.targetIndex-b.targetIndex);
}
export function createReviewedEcommerceMapping(source,mappings,{reviewed,applied}={}){
 sourceIdentity(source);if(reviewed!==true||applied!==true)fail('必须分别确认字段映射与原文样例后才能应用。');
 return{schemaVersion:REVIEWED_ECOMMERCE_MAPPING_VERSION,fileSha256:source.fileSha256,sheet:source.sheet,sheetIndex:source.sheetIndex,mappings:validateEcommerceMapping(mappings,source.headers,{complete:true}),reviewed:true,applied:true};
}
export function validateReviewedEcommerceMapping(receipt,source){
 sourceIdentity(source);
 if(!exact(receipt,['schemaVersion','fileSha256','sheet','sheetIndex','mappings','reviewed','applied'])||receipt.schemaVersion!==REVIEWED_ECOMMERCE_MAPPING_VERSION||receipt.fileSha256!==source.fileSha256||receipt.sheet!==source.sheet||receipt.sheetIndex!==source.sheetIndex||receipt.reviewed!==true||receipt.applied!==true)fail('用户确认记录与原文件摘要、工作表或确认状态不一致。');
 return createReviewedEcommerceMapping(source,receipt.mappings,{reviewed:receipt.reviewed,applied:receipt.applied});
}
export function resolveReviewedEcommerceColumns(headers,receipt){
 const reviewed=validateReviewedEcommerceMapping(receipt,{fileSha256:receipt?.fileSha256,sheet:receipt?.sheet,sheetIndex:receipt?.sheetIndex,headers});
 const core=reviewed.mappings.map(mapping=>mapping.sourceColumn),used=new Set(core),extensions=Array.from({length:headers.length},(_,index)=>index+1).filter(column=>!used.has(column));
 return{sourceColumns:{core,extensions},mapped:true,legacyRelativeRegions:false,userReviewed:true};
}
async function digest(bytes){
 if(globalThis.crypto?.subtle)return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 if(typeof process!=='undefined'&&process.versions?.node)return(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
 fail('当前环境不能计算原文件摘要。');
}
export async function inspectEcommerceMappingSource(file,{selectedSheet}={}){
 if(!file||typeof file.arrayBuffer!=='function'||!text(file.name,200)||!/\.xlsx$/i.test(file.name))fail('请选择可读取的.xlsx原文件。');
 if(Number(file.size)>8*1024*1024)fail('原文件超过8MB，请分批处理。');
 const bytes=new Uint8Array(await file.arrayBuffer());if(!bytes.byteLength||bytes.byteLength>8*1024*1024)fail('原文件为空或超过8MB。');
 const tables=await readXlsx(bytes,{maxColumns:16384}),sheetNames=tables[XLSX_SHEET_NAMES],availableSheetNames=sheetNames.filter(sheet=>tables[sheet].some(row=>row[XLSX_ROW_NUMBER]===1&&row.some(value=>typeof value==='string'&&value.trim())));
 if(!availableSheetNames.length)fail('未找到第1行真实表头；不能补造来源列。');
 if(selectedSheet!==undefined&&selectedSheet!==null&&selectedSheet!==''&&(typeof selectedSheet!=='string'||!availableSheetNames.includes(selectedSheet)))fail('请选择原文件中有效的工作表。');
 const chosen=selectedSheet|| (availableSheetNames.length===1?availableSheetNames[0]:null),fileSha256=await digest(bytes);
 if(!chosen)return{sourceName:file.name,fileSha256,availableSheetNames,selectedSheet:null,selectedSheetIndex:null};
 const rows=tables[chosen],header=rows.find(row=>row[XLSX_ROW_NUMBER]===1),width=rows.reduce((width,row)=>row.reduce((extent,value,index)=>value!==''&&value!==undefined?Math.max(extent,index+1):extent,width),22),headers=Array.from({length:width},(_,index)=>header[index]??'');
 checkedHeaders(headers);return{sourceName:file.name,fileSha256,availableSheetNames,selectedSheet:chosen,selectedSheetIndex:sheetNames.indexOf(chosen)+1,sheet:chosen,sheetIndex:sheetNames.indexOf(chosen)+1,headers:clone(headers)};
}
