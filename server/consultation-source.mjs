// Read only the selected task's archived source, never reconstruct originals from normalized metadata.
import {createHash} from 'node:crypto';
import {readXlsx,XLSX_ROW_NUMBER,XLSX_SHEET_NAMES} from '../public/io.mjs';
import {validateRawTranscript} from '../public/raw-transcript.mjs';
import {scenarioForTask} from '../public/scenarios.mjs';
import {validateCleaningReportSnapshot} from '../public/conversation-cleaning.mjs';

const fail=message=>{throw new Error(message);};
const meaningful=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
const text=value=>String(value??'');
let bundledZip;
async function ensureBundledZip(){
 if(!bundledZip)bundledZip=import('../public/vendor/jszip.min.js').then(module=>{const Zip=typeof module.default==='function'?module.default:globalThis.JSZip;if(typeof Zip!=='function')fail('随包Excel读取组件不可用。');return Zip;});
 globalThis.JSZip=await bundledZip;
}
function tableData(tables,sheetName,headerRow,{allowRepeatedHeaders=false,headerWidth}={}){
 if(!Object.hasOwn(tables,sheetName)||!Array.isArray(tables[sheetName]))fail('归档原表缺少工作表：'+sheetName+'。');
 const table=tables[sheetName];let previous=0;
 for(const row of table){const physical=row[XLSX_ROW_NUMBER];if(!Number.isSafeInteger(physical)||physical<1||physical<=previous)fail('归档原表物理行号缺失、重复或顺序异常。');previous=physical;}
 const header=table.find(row=>row[XLSX_ROW_NUMBER]===headerRow);if(!header)fail('归档原表找不到冻结映射指定的表头行。');
 if(headerWidth!==undefined&&(!Number.isSafeInteger(headerWidth)||headerWidth<header.length||headerWidth>16384))fail('原文冻结表头宽度与归档不一致。');
 const headers=Array.from({length:headerWidth??header.length},(_,index)=>text(header[index])),names=headers.map(v=>v.trim()),nonempty=names.filter(Boolean);
 if(!nonempty.length||!allowRepeatedHeaders&&new Set(nonempty).size!==nonempty.length)fail('归档原表表头为空或字段重复。');
 const rows=table.filter(row=>row[XLSX_ROW_NUMBER]>headerRow&&row.some(meaningful)).map(row=>{
  if(row.slice(headers.length).some(meaningful))fail('归档原表存在表头之外的实际内容，无法完整对应。');
  return{sourceRow:row[XLSX_ROW_NUMBER],values:Array.from({length:headers.length},(_,i)=>text(row[i]))};
 });
 return{sheetName,headerRow,headers,names,rows};
}

function cleaningOriginal(task,sessions,byExternal,tables,scenario){
 const snapshot=task.cleaningReportSnapshot;
 if(!task.source)fail('清洗交付缺少绑定的任务原件。');
 validateCleaningReportSnapshot(snapshot,{source:task.source,sessions});
 if(snapshot.scene!==task.scene)fail('清洗报告与任务冻结场景不一致。');
 const source=tableData(tables,snapshot.sheet,snapshot.headerRow);
 const columns=Object.fromEntries(['id','agent','text'].map(key=>[key,source.names.indexOf(snapshot.columns[key])]));
 if(new Set(Object.values(snapshot.columns)).size!==3||Object.values(columns).some(column=>column<0))fail('归档原表缺少清洗报告冻结的三个独立来源列。');
 const audited=new Map(snapshot.rows.map(row=>[row.row,row]));
 if(source.rows.length!==audited.size)fail('清洗报告与归档原表的来源行数不一致，不能静默丢弃原行或忽略缺失行。');
 const rows=[],excluded=[],seen=new Set();
 for(const original of source.rows){
  const saved=audited.get(original.sourceRow);
  if(!saved)fail('归档原表存在清洗报告未覆盖的来源行。');
  if(['id','agent','text'].some(key=>original.values[columns[key]]!==saved.original[key]))fail('清洗报告的原文与归档原表源单元格不一致。');
  if(saved.excluded){
   excluded.push({...original,values:[...original.values,saved.manual.excluded.reason,saved.reviewer,saved.confirmedAt]});
   continue;
  }
  const session=byExternal.get(saved.fields.id.trim());
  if(!session||seen.has(session.id))fail('清洗报告确认的会话标识与任务不一致或重复，不能猜测原行关联。');
  seen.add(session.id);rows.push({...original,recordId:session.id});
 }
 if(seen.size!==sessions.length)fail('当前任务有会话在清洗报告和归档原表中缺失。');
 // The cleaning contract freezes only id/agent/text columns. Product metadata,
 // including human additions, is not an original product-column mapping.
 const productSources=Object.fromEntries(sessions.map(session=>[session.id,{value:'',source:'未提供'}]));
 let groupSources;
 if(task.scenarioSnapshot&&scenario.report.groupBy!=='product'){
  if(scenario.report.groupBy!=='agent')fail('清洗报告未冻结扩展字段分组的原表列映射，不能从会话摘要猜测分组来源。');
  groupSources=Object.fromEntries(rows.map(row=>{
   const value=row.values[columns.agent].trim();
   return[row.recordId,value?{value,source:'原表列',column:source.headers[columns.agent]}:{value:'',source:'未提供'}];
  }));
 }
 const additionalSheets=[];
 if(excluded.length){
  const headers=[...source.headers];
  for(const label of ['清洗弃行原因','清洗核对人','清洗确认时间']){let unique=label,index=2;while(headers.some(header=>header.trim()===unique))unique=`${label}（${index++}）`;headers.push(unique);}
  additionalSheets.push({sheetName:`清洗弃行_${source.sheetName}`,headerRow:source.headerRow,headers,rows:excluded});
 }
 return{sheetName:source.sheetName,headerRow:source.headerRow,headers:source.headers,rows,messageColumn:columns.text,productSources,...(groupSources?{groupSources}:{}),...(additionalSheets.length?{additionalSheets}:{})};
}

function rawOriginal(task,sessions,tables,scenario){
 const first=sessions[0].rawTranscript;
 if(!first||first.schemaVersion!==1||first.fileSha256!==task.source?.sha256)fail('原文来源摘要与任务归档不一致。');
 if(first.sheetIndex!==(tables[XLSX_SHEET_NAMES]||Object.keys(tables)).indexOf(first.sheet)+1)fail('原文来源工作表序号与归档不一致。');
 const source=tableData(tables,first.sheet,first.headerRow,{allowRepeatedHeaders:true,headerWidth:first.headers?.length}),byRow=new Map(),rows=[];
 for(const session of sessions){
  const raw=session.rawTranscript;
  validateRawTranscript(raw);
  if(session.inputMode!==undefined&&session.inputMode!=='raw-transcript-v1'||!raw||raw.schemaVersion!==1||raw.fileSha256!==task.source.sha256||raw.sheet!==first.sheet||raw.sheetIndex!==first.sheetIndex||raw.headerRow!==first.headerRow||JSON.stringify(raw.headers)!==JSON.stringify(source.headers)||JSON.stringify(raw.columns)!==JSON.stringify(first.columns)||!Array.isArray(raw.raw)||raw.raw.length!==source.headers.length||!Number.isSafeInteger(raw.row)||byRow.has(raw.row)||typeof raw.text!=='string'||!raw.text.trim()||createHash('sha256').update(raw.text,'utf8').digest('hex')!==raw.textSha256||raw.raw[raw.columns?.text-1]!==raw.text)fail('原文来源位置、摘要或冻结单元格无效。');
  if(![raw.columns.id,raw.columns.agent,raw.columns.text,...(raw.columns.product?[raw.columns.product]:[])].every(column=>Number.isSafeInteger(column)&&column>=1&&column<=source.headers.length))fail('原文来源列映射无效。');
  if(String(raw.raw[raw.columns.id-1])!==session.externalId)fail('原文会话标识与归档来源不一致。');
  byRow.set(raw.row,session);
 }
 if(source.rows.length!==sessions.length)fail('原文来源行数与任务不一致，不能静默丢弃来源行。');
 for(const row of source.rows){const session=byRow.get(row.sourceRow);if(!session||JSON.stringify(row.values)!==JSON.stringify(session.rawTranscript.raw))fail('原文与归档原表的全部来源单元格不一致。');rows.push({...row,recordId:session.id});}
 const productSources=Object.fromEntries(sessions.map(session=>{
  const raw=session.rawTranscript,column=raw.columns.product,value=column?raw.raw[column-1].trim():'',fallback=String(task.rawImportOptions?.productDefault??'').trim();
  return[session.id,value?{value,source:'原表列',column:source.headers[column-1]}:fallback?{value:fallback,source:'任务默认'}:{value:'',source:'未提供'}];
 }));
 let groupSources;if(task.scenarioSnapshot&&scenario.report.groupBy!=='product'){
  const column=scenario.report.groupBy==='agent'?first.columns.agent:null;
  if(!column)fail('原文任务未冻结扩展分组列映射，不能猜测分组来源。');
  groupSources=Object.fromEntries(rows.map(row=>{const value=row.values[column-1].trim();return[row.recordId,value?{value,source:'原表列',column:source.headers[column-1]}:{value:'',source:'未提供'}];}));
 }
 return{sheetName:source.sheetName,headerRow:source.headerRow,headers:source.headers,rows,messageColumn:first.columns.text-1,productSources,...(groupSources?{groupSources}:{})};
}

export function consultationOriginalFromTables(state,task,tables){
 const scenario=scenarioForTask(task);
 if(!task||task.mode!=='manual'||scenario?.engine!=='conversation')fail('请选择已导入且具有冻结配置的会话场景任务。');
 const sessions=state.sessions.filter(session=>session.taskId===task.id),byExternal=new Map();
 if(!sessions.length||sessions.length>500)fail('新品原表须关联1至500个会话。');
 if(task.inputMode==='raw-transcript-v1')return rawOriginal(task,sessions,tables,scenario);
 for(const session of sessions){const id=text(session.externalId).trim();if(!id||byExternal.has(id))fail('会话原始标识为空或重复，不能对应归档原表。');byExternal.set(id,session);}
 if(task.cleaningReportSnapshot!==undefined)return cleaningOriginal(task,sessions,byExternal,tables,scenario);
 const profile=task.importMappingSnapshot?.profile;
 const sheetName=profile?.sheet??'会话信息',headerRow=profile?.headerRow??tables['会话信息']?.[0]?.[XLSX_ROW_NUMBER];
 if(!Number.isSafeInteger(headerRow)||headerRow<1)fail('归档原表映射的表头行无效。');
 const source=tableData(tables,sheetName,headerRow),idName=profile?.fields?.id??'会话ID',idColumn=source.names.indexOf(idName.trim());
 if(idColumn<0)fail('归档原表缺少冻结映射中的会话标识列。');
 const productName=profile?profile.fields?.product:'产品型号',productColumn=productName?source.names.indexOf(productName.trim()):-1;
 if(productName&&productColumn<0)fail('归档原表缺少冻结映射中的产品列。');
 const messageName=profile?.fields?.text,messageColumn=messageName?source.names.indexOf(messageName.trim()):null;
 if(messageName&&messageColumn<0)fail('归档原表缺少冻结映射中的消息详情列。');
 const seen=new Set(),products=new Map(sessions.map(s=>[s.id,new Set()]));
 const rows=source.rows.map(row=>{
  const externalId=row.values[idColumn].trim(),session=byExternal.get(externalId);if(!session)fail('归档原表会话标识与当前任务不一致，不能跳过或伪造来源行。');
  seen.add(session.id);const value=productColumn>=0?row.values[productColumn].trim():'';if(value)products.get(session.id).add(value);
  return{...row,recordId:session.id};
 });
 if(seen.size!==sessions.length)fail('当前任务有会话在归档原表中缺失，不能生成不完整原始列。');
 const productSources=Object.fromEntries(sessions.map(session=>{
  const values=[...products.get(session.id)];if(values.length>1)fail('同一会话的原表产品值冲突，请先核对源数据。');
  const fallback=text(profile?.defaults?.product).trim();
  return[session.id,values.length?{value:values[0],source:'原表列',column:source.headers[productColumn]}:fallback?{value:fallback,source:'任务默认'}:{value:'',source:'未提供'}];
 }));
 let groupSources;
 if(task.scenarioSnapshot&&scenario.report.groupBy!=='product'){
  let columnName,defaultValue='';
  if(scenario.report.groupBy==='context'){
   const extra=profile?.extras?.find(extra=>extra.key===scenario.report.groupField);
   if(!extra||!['inspect','retain'].includes(extra.purpose)||typeof extra.column!=='string')fail('报告分组字段未绑定冻结映射的扩展字段key，不能猜测原表列。');columnName=extra.column;
  }else{columnName=profile?profile.fields?.agent:'客服标识';defaultValue=text(profile?.defaults?.agent).trim();}
  const column=columnName?source.names.indexOf(columnName.trim()):-1;
  if(columnName&&column<0)fail('归档原表缺少冻结映射中的分组列。');
  if(scenario.report.groupBy==='context'&&column<0)fail('扩展分组字段缺少原表列映射。');
  groupSources=Object.fromEntries(sessions.map(session=>{
   const values=[...new Set(rows.filter(row=>row.recordId===session.id).map(row=>column>=0?row.values[column].trim():'').filter(Boolean))];
   if(values.length>1)fail('同一会话的原表分组值冲突，请先核对源数据。');
   return[session.id,values.length?{value:values[0],source:'原表列',column:source.headers[column]}:defaultValue?{value:defaultValue,source:'任务默认'}:{value:'',source:'未提供'}];
  }));
 }
 const additionalSheets=[];
 if(!profile){
  const detail=tableData(tables,'会话明细',tables['会话明细']?.[0]?.[XLSX_ROW_NUMBER]),id=detail.names.indexOf('会话ID');if(id<0)fail('归档原表的会话明细缺少会话ID。');
  if(detail.rows.some(row=>!byExternal.has(row.values[id].trim())))fail('归档会话明细存在当前任务外的会话标识。');
  const {names,...values}=detail;additionalSheets.push(values);
 }
 return{sheetName,headerRow,headers:source.headers,rows,messageColumn,productSources,...(groupSources?{groupSources}:{}),...(additionalSheets.length?{additionalSheets}:{})};
}

export async function loadConsultationOriginal({state,task,store}){
 if(!task?.source||typeof store?.getSource!=='function')fail('新品业务交付缺少可读取的归档原文件。');
 if(!/\.xlsx$/i.test(task.source.name))fail('新品业务交付当前需要归档Excel原表；其他格式请使用原追溯导出。');
 const archived=await store.getSource(task.source.sha256),bytes=Buffer.from(archived.bytes??[]);
 if(!bytes.length||bytes.length>8*1024*1024||bytes.length!==task.source.size||archived.sha256!==task.source.sha256||createHash('sha256').update(bytes).digest('hex')!==task.source.sha256)fail('归档原文件大小或摘要指纹与任务不一致，原件保留。');
 await ensureBundledZip();
 return consultationOriginalFromTables(state,task,await readXlsx(bytes,task.inputMode==='raw-transcript-v1'?{maxColumns:16384}:{}));
}
