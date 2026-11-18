// Whole-cell input is an independent contract. No role, turn or time is inferred.
import {readXlsx,XLSX_ROW_NUMBER,XLSX_SHEET_NAMES} from './io.mjs';
import {isSceneKey} from './scenarios.mjs';

export const RAW_INPUT_MODE='raw-transcript-v1';
export const RAW_EVIDENCE_VERSION='raw-text-quote-v1';
const HASH=/^[a-f0-9]{64}$/;
const MAX_FILE=8*1024*1024,MAX_CELL=100000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
const normalize=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-:：()（）/]/g,'');
const aliases={id:['id','会话id','会话编号','会话标识','conversationid','sessionid','conversationidentifier'],agent:['客服','客服标识','客服账号','客服帐号','坐席','坐席标识','agent','agentid','agentname','customer service','customerserviceagent'],text:['消息详情','会话原文','整段原文','原始全文','聊天记录','会话内容','message details','messagedetail','transcript','rawtranscript','conversationtext','conversationcontent'],product:['产品','产品型号','产品名称','product','productname','productmodel','model']};
const names=Object.fromEntries(Object.entries(aliases).map(([key,values])=>[key,new Set(values.map(normalize))]));

export function normalizeRawTimePolicy(value={mode:'unavailable',timezone:'+08:00'}){
 if(!object(value)||Object.keys(value).some(key=>!['mode','timezone'].includes(key)))fail('原文来源时间声明字段无效。');
 const policy={mode:value.mode??'unavailable',timezone:value.timezone??'+08:00'};
 if(!['unavailable','explicit'].includes(policy.mode)||typeof policy.timezone!=='string'||!(/^(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/).test(policy.timezone))fail('原文来源时间声明模式或时区无效。');
 return policy;
}
export const isRawTranscriptSession=session=>object(session?.rawTranscript)&&session.rawTranscript.schemaVersion===1;
export const rawTranscriptText=session=>isRawTranscriptSession(session)?session.rawTranscript.text:'';
export function validateRawTranscript(record){
 if(!object(record)||Object.keys(record).some(key=>!['schemaVersion','text','textSha256','fileSha256','sheet','sheetIndex','headerRow','row','columns','headers','raw','timePolicy'].includes(key))||record.schemaVersion!==1)fail('原文来源合同结构无效。');
 if(typeof record.text!=='string'||!record.text.trim()||record.text.length>MAX_CELL||!HASH.test(record.textSha256||'')||!HASH.test(record.fileSha256||''))fail('原文或来源摘要无效。');
 if(typeof record.sheet!=='string'||!record.sheet.trim()||record.sheet.length>200||!Number.isSafeInteger(record.sheetIndex)||record.sheetIndex<1||!Number.isSafeInteger(record.headerRow)||record.headerRow<1||record.headerRow>1048576||!Number.isSafeInteger(record.row)||record.row<=record.headerRow||record.row>1048576)fail('原文来源工作表或物理行无效。');
 if(!Array.isArray(record.headers)||!record.headers.length||record.headers.length>16384||!Array.isArray(record.raw)||record.raw.length!==record.headers.length||[...record.headers,...record.raw].some(value=>typeof value!=='string'||value.length>MAX_CELL))fail('原文源单元格须逐列完整保留。');
 const columns=record.columns;
 if(!object(columns)||Object.keys(columns).some(key=>!['id','agent','text','product'].includes(key))||['id','agent','text'].some(key=>!Object.hasOwn(columns,key))||Object.values(columns).some(value=>!Number.isSafeInteger(value)||value<1||value>record.headers.length)||new Set(Object.values(columns)).size!==Object.values(columns).length)fail('原文来源列映射无效。');
 if(!record.raw[columns.id-1].trim()||record.raw[columns.id-1].length>160||record.text!==record.raw[columns.text-1])fail('原文或会话ID来源单元格不一致。');
 const policy=normalizeRawTimePolicy(record.timePolicy);
 if(Object.keys(record.timePolicy).length!==2||policy.mode!==record.timePolicy.mode||policy.timezone!==record.timePolicy.timezone)fail('原文来源时间声明须完整冻结。');
 return true;
}
async function sha256(bytes){
 if(globalThis.crypto?.subtle)return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 if(typeof process!=='undefined'&&process.versions?.node)return(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
 fail('当前环境不能计算原文件摘要，请使用本地工作台重新导入。');
}
function columnMapping(values){
 const columns={},errors=[];
 for(const [key,allowed]of Object.entries(names)){
  const found=[];for(let index=0;index<values.length;index++)if(allowed.has(normalize(values[index])))found.push(index+1);
  if(found.length>1)errors.push(`原文${key}列存在多个匹配表头，请保留唯一列。`);
  if(found.length===1)columns[key]=found[0];
 }
 return {columns,errors};
}
function structuredTemplate(tables){
 const info=tables['会话信息'],turns=tables['会话明细'];
 if(!info||!turns)return false;
 return info.some(row=>['会话ID','会话开始时间','会话完整性'].every(name=>row.includes(name)))&&turns.some(row=>['会话ID','轮次序号','发言角色','原文内容'].every(name=>row.includes(name)));
}
/** Recognized whole-cell workbooks fail atomically: no invalid nonempty source row is dropped. */
export async function parseRawTranscriptFile(file,{scene='新品产品咨询',timePolicy,selectedSheet}={}){
 const errors=[],warnings=[];let supported=false,chosenSheet=null,selectedSheetIndex=null,availableSheetNames=[],policy;
 const result=sessions=>({valid:supported&&errors.length===0,supported,rawDirect:supported,inputMode:RAW_INPUT_MODE,evidenceContractVersion:RAW_EVIDENCE_VERSION,rawImportOptions:policy?{timePolicy:policy,productDefault:''}:undefined,errors:[...new Set(errors)],warnings,availableSheetNames,selectedSheet:chosenSheet,selectedSheetIndex,sessions:errors.length?[]:sessions,turnCount:null});
 try{
  if(!file||typeof file.arrayBuffer!=='function'||typeof file.name!=='string'||!/\.xlsx$/i.test(file.name))return result([]);
  if(!isSceneKey(scene)||scene==='电商评论回复')return result([]);
  if(Number(file.size)>MAX_FILE)fail('原文文件大小超过8MB，请分批导入。');
  const bytes=new Uint8Array(await file.arrayBuffer());if(!bytes.length||bytes.length>MAX_FILE)fail('原文文件为空或大小超过8MB。');
  const tables=await readXlsx(bytes,{maxColumns:16384}),sheetNames=tables[XLSX_SHEET_NAMES];
  if(structuredTemplate(tables))return result([]);
  const candidates=new Map();
  for(const sheet of sheetNames){
   const rows=tables[sheet],headers=rows.filter(row=>(row[XLSX_ROW_NUMBER]??0)<=100).map(row=>({row,mapping:columnMapping(row)}));
   const exact=headers.filter(({mapping:{columns}})=>columns.id&&columns.agent&&columns.text);
   const partial=headers.filter(({mapping:{columns}})=>columns.text||columns.id&&columns.agent);
   const found=exact.length?exact:partial;
   if(found.length)candidates.set(sheet,{...found[0],ambiguous:exact.length>1});
  }
  availableSheetNames=[...candidates.keys()];if(!availableSheetNames.length)return result([]);supported=true;
  policy=normalizeRawTimePolicy(timePolicy);
  if(selectedSheet!==undefined&&selectedSheet!==null&&selectedSheet!==''){
   if(typeof selectedSheet!=='string'||!candidates.has(selectedSheet))fail('请选择有效的整段原文来源工作表。');chosenSheet=selectedSheet;
  }else if(availableSheetNames.length===1)chosenSheet=availableSheetNames[0];else fail('检测到多个整段原文工作表，请选择本次导入的来源工作表。');
  selectedSheetIndex=sheetNames.indexOf(chosenSheet)+1;
  const candidate=candidates.get(chosenSheet),headerRow=candidate.row[XLSX_ROW_NUMBER],columns=candidate.mapping.columns,sourceRows=tables[chosenSheet];
  if(candidate.ambiguous)fail('同一工作表存在多组原文表头，请拆分后导入，不能静默省略源行。');
  errors.push(...candidate.mapping.errors);for(const key of ['id','agent','text'])if(!columns[key])errors.push(`${chosenSheet}第${headerRow}行：缺少原文必需的${key}列。`);
  if(errors.length)return result([]);
  const extent=sourceRows.reduce((width,row)=>row.reduce((total,value,index)=>value!==''&&value!==undefined?Math.max(total,index+1):total,width),candidate.row.length);
  const cells=row=>Array.from({length:extent},(_,index)=>row[index]??'');
  const headers=cells(candidate.row),data=sourceRows.filter(row=>row[XLSX_ROW_NUMBER]>headerRow&&row.some(value=>value!==''&&value!==undefined));
  if(!data.length)errors.push(`${chosenSheet}第${headerRow+1}行：没有可导入的整段原文记录。`);
  if(data.length>500)errors.push('每个任务最多500条原文记录，请分批导入。');
  const fileSha256=await sha256(bytes),sessions=[],used=new Set();
  for(const values of data){
   const row=values[XLSX_ROW_NUMBER],raw=cells(values),text=raw[columns.text-1],record={schemaVersion:1,text,textSha256:await sha256(new TextEncoder().encode(text)),fileSha256,sheet:chosenSheet,sheetIndex:selectedSheetIndex,headerRow,row,columns:{...columns},headers:[...headers],raw,timePolicy:{...policy}};
   try{validateRawTranscript(record);}catch(error){errors.push(`${chosenSheet}第${row}行：${error.message}`);continue;}
   const id=raw[columns.id-1];if(used.has(id)){errors.push(`${chosenSheet}第${row}行：会话ID重复：${id}。`);continue;}used.add(id);
   sessions.push({id,scene,startedAt:'',topic:'',channel:'',product:columns.product&&raw[columns.product-1].trim()?raw[columns.product-1]:'未提供',agent:raw[columns.agent-1],customer:'',completeness:'未核验',missingNote:'',turns:[],rawTranscript:record});
  }
  for(const sheet of sheetNames)if(sheet!==chosenSheet)warnings.push(`已忽略未选工作表：${sheet}；仅导入${chosenSheet}。`);
  warnings.push('原文角色、轮次、完整性和来源会话时间尚未核验；未补造结构化信息。');
  return result(sessions);
 }catch(error){errors.push(error?.message||'原文文件无法读取。');return result([]);}
}
