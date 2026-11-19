import {XLSX_ROW_NUMBER,XLSX_DATE_SYSTEM,XLSX_SHEET_NAMES} from './io.mjs';
import {EC_HEADERS,ecommerceTimeValues,ecommerceSourceProjection,ecommerceRecordId,validateEcommerceRecord} from './ecommerce-schema.mjs';
import {systemColumns,systemEngineValues,systemReviewedMapping,operatorSite,systemValue} from './ecommerce-system-source.mjs';
export function parseSystemTables(tables,{fileSha256,thresholdHours=24,selectedSheet,reviewedMapping,batchSite=''}={}){
 const names=tables[XLSX_SHEET_NAMES],descriptors=new Map(),warnings=[];
 for(const sheet of names){
  if(reviewedMapping&&sheet!==reviewedMapping.sheet)continue;
  const rows=tables[sheet],header=rows.find(r=>r[XLSX_ROW_NUMBER]===1);if(!header)continue;
  const width=Math.max(...rows.map(r=>r.reduce((n,v,i)=>v!==''&&v!==undefined?Math.max(n,i+1):n,0))),headers=Array.from({length:width},(_,i)=>header[i]??'');
  try{const receipt=reviewedMapping?systemReviewedMapping({fileSha256,sheet,sheetIndex:names.indexOf(sheet)+1,headers},reviewedMapping.mappings,reviewedMapping):null;if(receipt&&JSON.stringify(receipt)!==JSON.stringify(reviewedMapping))throw new Error('确认映射与当前文件不一致。');descriptors.set(sheet,{headers,mappings:receipt?.mappings||systemColumns(headers),receipt});}catch(error){if(reviewedMapping)throw error;}
 }
 const availableSheetNames=[...descriptors.keys()];if(!availableSheetNames.length)return null;
 const sheet=selectedSheet|| (availableSheetNames.length===1?availableSheetNames[0]:null);
 const result={availableSheetNames,selectedSheet:sheet,selectedSheetIndex:sheet?names.indexOf(sheet)+1:null,warnings,errors:[],sessions:[],turnCount:0,valid:false};
 if(!descriptors.has(sheet)){result.errors=['检测到多个数据工作表，请选择本次需要检查的工作表。'];return result;}
 const d=descriptors.get(sheet),start=d.receipt?.dataStartRow||2,rows=tables[sheet].filter(r=>r[XLSX_ROW_NUMBER]>=start&&r.some(v=>v!==''&&v!==undefined));
 if(!rows.length||rows.length>500)throw new Error('每批需有1至500条评论，请检查首条数据行或分批导入。');
 for(const values of rows){
  const systemSource={format:'business-export-23.v1',headers:[...d.headers],values:Array.from({length:d.headers.length},(_,i)=>values[i]??''),mappings:structuredClone(d.mappings),batchSite:batchSite.trim(),dataStartRow:start,reviewedMapping:d.receipt};
  const record={schemaVersion:6,sheet,row:values[XLSX_ROW_NUMBER],fileSha256,headers:[...EC_HEADERS],standards:Array(22).fill(''),raw:systemEngineValues(systemSource),thresholdHours,dateSystem:tables[XLSX_DATE_SYSTEM],normalizedTimes:null,sheetIndex:names.indexOf(sheet)+1,extensions:{headers:[],standards:[],raw:[]},systemSource};record.normalizedTimes=ecommerceTimeValues(record);validateEcommerceRecord(record);
  if(!record.raw[8].trim()&&!record.raw[9].trim())throw new Error(`${sheet}第${record.row}行没有评论或回复原文。`);
  const projected=ecommerceSourceProjection(record),site=operatorSite(systemValue(systemSource,4),batchSite);if(!site.value)warnings.push(`${sheet}第${record.row}行运营商站点未识别，可在下方填写本批默认站点；不填写时统计为“未提供”。`);
  if(projected.missingNote)warnings.push(`${sheet}第${record.row}行：${projected.missingNote}`);
  result.sessions.push({id:ecommerceRecordId(record),...projected,ecommerce:record});
 }
 result.valid=true;result.turnCount=result.sessions.reduce((n,s)=>n+s.turns.length,0);return result;
}
