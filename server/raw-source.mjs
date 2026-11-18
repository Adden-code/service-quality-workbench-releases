import {createHash} from 'node:crypto';
import {RAW_INPUT_MODE,RAW_EVIDENCE_VERSION,isRawTranscriptSession,validateRawTranscript,normalizeRawTimePolicy,parseRawTranscriptFile} from '../public/raw-transcript.mjs';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new Error(message);};
export function validateRawTaskSource(task,sessions,source=task?.source){
 if(task?.inputMode!==RAW_INPUT_MODE||task.evidenceContractVersion!==RAW_EVIDENCE_VERSION||task.mode!=='manual'||task.cleaningReportSnapshot!==undefined||task.scene==='电商评论回复')fail('原文任务模式或证据来源合同不一致。');
 const options=task.rawImportOptions;
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['timePolicy','productDefault','outputLanguage'].includes(key))||typeof options.productDefault!=='string'||options.productDefault.length>1000||!['zh','en'].includes(options.outputLanguage))fail('原文导入选项或来源时间声明无效。');
 const timePolicy=normalizeRawTimePolicy(options.timePolicy);
 if(!same(timePolicy,options.timePolicy)||!sessions.length||sessions.length!==task.sessionIds?.length)fail('原文任务来源行或时间声明不完整。');
 const rows=new Set();let first;
 for(const session of sessions){
  if(!isRawTranscriptSession(session))fail('原文任务缺少逐行原文来源。');
  const record=session.rawTranscript;validateRawTranscript(record);
  if(hash(Buffer.from(record.text,'utf8'))!==record.textSha256||record.fileSha256!==source?.sha256)fail('原文来源文本或文件摘要不一致。');
  if(!same(record.timePolicy,timePolicy)||session.startedAt!==''||!Array.isArray(session.turns)||session.turns.length||session.completeness!=='未核验'||session.missingNote!==''||session.ecommerce!==undefined)fail('原文来源时间声明或未核验结构不可补造。');
  if((session.externalId??session.id)!==record.raw[record.columns.id-1]||session.agent!==record.raw[record.columns.agent-1]||session.scene!==task.scene)fail('原文会话ID、客服或场景与来源单元格不一致。');
  const product=record.columns.product&&record.raw[record.columns.product-1].trim()?record.raw[record.columns.product-1]:options.productDefault.trim()?options.productDefault:'未提供';
  if(session.product!==product)fail('原文产品必须沿用来源单元格，其次任务默认值，缺失时为未提供。');
  const rowKey=JSON.stringify([record.sheetIndex,record.row]);if(rows.has(rowKey))fail('原文来源物理行重复。');rows.add(rowKey);
  const mapping={sheet:record.sheet,sheetIndex:record.sheetIndex,headerRow:record.headerRow,headers:record.headers,columns:record.columns};
  if(first&&!same(first,mapping))fail('同一原文任务必须沿用同一来源工作表及列映射。');first??=mapping;
 }
 return true;
}
/** Re-read archived bytes, then compare every source cell and the complete selected row set. */
export async function validateRawSource(task,sessions,bytes,source=task?.source){
 validateRawTaskSource(task,sessions,source);
 if(!source||hash(bytes)!==source.sha256||bytes.length!==source.size)fail('原文任务与归档原文件摘要或大小不一致。');
 const first=sessions[0].rawTranscript;
 const parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes},{scene:task.scene,timePolicy:task.rawImportOptions.timePolicy,selectedSheet:first.sheet});
 if(!parsed.valid||!parsed.supported||parsed.sessions.length!==sessions.length)fail('原文来源与归档原件行数或结构不一致。');
 for(let index=0;index<sessions.length;index++){
  const expected=parsed.sessions[index].rawTranscript,saved=sessions[index].rawTranscript;
  if(!same(expected,saved))fail('原文来源文本、映射或源单元格与归档原件不一致。');
 }
 return true;
}
