// Conversation preparation is a separate human-reviewed import step. It never
// creates quality judgments, calls a provider, or writes the workspace.
import {readXlsx,workbook,XLSX_ROW_NUMBER} from './io.mjs';
import {parseBusinessInput} from './business-input.mjs';
import {isSceneKey} from './scenarios.mjs';

export const CLEANING_REPORT_VERSION=1;
export const CLEANING_PROMPT_VERSION='conversation-cleaning-v1';
export const MAX_CLEANING_CELL_CHARS=100000;
const MAX_FILE=8*1024*1024;
const ROLES=['客户','客服','系统'];
const INFO=['id','scene','startedAt','topic','channel','product','agent','customer','completeness','missingNote'];
const INFO_HEADERS=['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'];
const TURN_HEADERS=['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'];
const ROW_FIELDS=['id','agent','startedAt','topic','channel','product','customer','completeness','missingNote'];
const SEGMENT_FIELDS=['id','kind','role','at','text','included'];
const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
const exact=(value)=>value?{kind:'exact',start:0,end:value.length,quote:value}:{kind:'missing'};
const currentTime=()=>new Date().toISOString();
const calendar=value=>{
 const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/);
 if(!m)return false;
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 return y>0&&mo>=1&&mo<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]&&h<24&&mi<60&&s<60&&(m[7]==='Z'||(+m[8]<=14&&+m[9]<60&&(+m[8]!==14||+m[9]===0)))&&Number.isFinite(Date.parse(value));
};
export const validCleaningTime=calendar;
export function normalizeCleaningTime(quote,timezone=''){
 if(calendar(quote))return quote;
 if(timezone!=='+08:00')return '';
 const match=typeof quote==='string'&&quote.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/);
 if(!match)return '';
 const converted=`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]||'00'}${match[7]||''}+08:00`;
 return calendar(converted)?converted:'';
}
export function validateCleaningSegments(original,segments){
 if(typeof original!=='string'||!Array.isArray(segments)||!segments.length||segments.length>1501)fail('清洗片段结构无效。');
 let offset=0;
 for(const segment of segments){
  const loc=segment?.sourceLocator;
  if(!object(segment)||!['message','unparsed','separator'].includes(segment.kind)||!object(loc)||!Number.isSafeInteger(loc.start)||!Number.isSafeInteger(loc.end)||loc.start!==offset||loc.end<loc.start||loc.end>original.length||segment.sourceQuote!==original.slice(loc.start,loc.end)||(loc.end===loc.start&&original.length>0))fail('清洗来源定位、顺序或完整覆盖不一致。');
  if(segment.kind==='separator'&&segment.sourceQuote.trim())fail('有内容的片段不能静默标记为分隔符。');
  offset=loc.end;
 }
 if(offset!==original.length)fail('清洗片段没有完整覆盖原文，未解析内容必须保留。');
 return true;
}
function rawSegment(text){return {kind:'unparsed',sourceQuote:text,sourceLocator:{start:0,end:text.length},text,role:'',at:'',fieldSources:{text:exact(text),role:{kind:'missing'},at:{kind:'missing'}},warnings:['尚未解析；可使用AI起草或人工整理，原文完整保留。']};}
function reviewSegment(segment,index){return {...clone(segment),id:index+1,included:segment.kind!=='separator',manual:{},candidate:clone({...segment,id:index+1,included:segment.kind!=='separator'})};}

export async function inspectConversationCleaningFile(file,options={}){
 const errors=[],warnings=[];
 try{
  if(!file||typeof file.arrayBuffer!=='function'||!/\.xlsx$/i.test(file.name||''))fail('请选择可读取的.xlsx业务原表。');
  if(file.size>MAX_FILE)fail('业务原表超过8MB，请分批处理。');
  const bytes=new Uint8Array(await file.arrayBuffer());if(!bytes.length||bytes.length>MAX_FILE)fail('业务原表为空或超过8MB。');
  const tables=await readXlsx(bytes),sheets=Object.keys(tables);
  const sheet=options.sheet||(sheets.length===1?sheets[0]:'');
  if(!sheet||!tables[sheet])return {valid:false,errors:['请明确选择业务工作表。'],warnings,sheets,draft:null};
  const headerRow=options.headerRow??1;
  if(!Number.isSafeInteger(headerRow)||headerRow<1)fail('请填写有效的表头物理行。');
  const header=tables[sheet].find((row,index)=>(row[XLSX_ROW_NUMBER]??index+1)===headerRow);
  if(!header)fail('所选表头物理行不存在。');
  const headers=Array.from(header,v=>String(v??'').trim());
  if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length)fail('源表表头重复，请先核对。');
  const columns={id:options.idColumn||'会话ID',agent:options.agentColumn||'客服',text:options.textColumn||'消息详情'};
  for(const value of Object.values(columns))if(!headers.includes(value))fail(`缺少清洗源列：${value}。`);
  if(new Set(Object.values(columns)).size!==3)fail('会话ID、客服与消息详情必须映射到三个不同源列。');
  const scene=options.scene||'新品产品咨询';if(!isSceneKey(scene)||scene==='电商评论回复')fail('清洗入口仅支持已登记的多轮会话场景。');
  const timezone=options.timezone||'';if(!['','+08:00'].includes(timezone))fail('时间解析仅支持保留来源时区，或人工明确选择北京时间。');
  const rows=[];
  for(let index=0;index<tables[sheet].length;index++){
   const values=tables[sheet][index],row=values[XLSX_ROW_NUMBER]??index+1;
   if(row<=headerRow||!values.some(v=>String(v??'').trim()))continue;
   const original=Object.fromEntries(Object.entries(columns).map(([key,column])=>[key,String(values[headers.indexOf(column)]??'')]));
   const fields={id:original.id,agent:original.agent,startedAt:'',topic:'',channel:'',product:'',customer:'',completeness:'',missingNote:''};
   const fieldSources=Object.fromEntries(ROW_FIELDS.map(key=>[key,key==='id'||key==='agent'?{...exact(original[key]),sheet,row,column:columns[key]}:{kind:'missing'}]));
   rows.push({row,original,fields,fieldSources,status:'pending',segments:[reviewSegment(rawSegment(original.text),0)],manual:{},history:[],attempts:[],confirmed:false,excluded:false,reviewer:'',confirmedAt:null,error:''});
  }
  if(!rows.length)fail('所选表头之后没有业务记录。');
  if(rows.length>500)fail('单次清洗最多500个原始会话行，请分批处理；系统未截断记录。');
  for(const name of sheets)if(name!==sheet)warnings.push(`未选择工作表${name}；原件仍完整保留。`);
  return {valid:true,errors,warnings,sheets,headers,draft:{version:CLEANING_REPORT_VERSION,sourceName:file.name,scene,sheet,headerRow,columns,timezone,rows}};
 }catch(error){errors.push(error?.message||'业务原表无法读取。');return {valid:false,errors,warnings,draft:null};}
}
export function cleaningRowInput(draft,rowNumber){
 const row=draft.rows.find(r=>r.row===rowNumber);if(!row)fail('清洗来源行不存在。');
 return {scene:draft.scene,sourceName:draft.sourceName,sheet:draft.sheet,row:row.row,sessionId:row.original.id,agent:row.original.agent,text:row.original.text,timezone:draft.timezone};
}
function mutableRow(draft,rowNumber){const next=clone(draft),row=next.rows.find(r=>r.row===rowNumber);if(!row)fail('清洗来源行不存在。');return {next,row};}
export function applyCleaningResult(draft,rowNumber,result,{now=currentTime()}={}){
 const {next,row}=mutableRow(draft,rowNumber);
 validateCleaningSegments(row.original.text,result?.segments);
 if(row.history.length||row.confirmed)fail('本行已有人工核对记录，请保留人工修改；重新起草应另建清洗草稿。');
 row.segments=result.segments.map(reviewSegment);row.status='prepared';row.error='';row.confirmed=false;
 const safeMeta={at:now,status:'prepared',promptVersion:result.promptVersion||CLEANING_PROMPT_VERSION};
 for(const key of ['modelId','requestId'])if(typeof result[key]==='string')safeMeta[key]=result[key].slice(0,200);
 if(object(result.usage))safeMeta.usage=Object.fromEntries(Object.entries(result.usage).filter(([key,value])=>['prompt_tokens','completion_tokens','total_tokens'].includes(key)&&Number.isSafeInteger(value)&&value>=0));
 row.attempts.push(safeMeta);return next;
}
export function recordCleaningFailure(draft,rowNumber,error,{now=currentTime(),cancelled=false}={}){
 const {next,row}=mutableRow(draft,rowNumber);row.status='failed';row.error=cancelled?'本次已取消，本行仍待处理。':String(error||'本行起草失败，原文完整保留。').slice(0,1000);
 row.attempts.push({at:now,status:cancelled?'cancelled':'failed',error:row.error});return next;
}
export function updateCleaningField(draft,rowNumber,segmentIndex,field,value,{reason='',now=currentTime()}={}){
 const {next,row}=mutableRow(draft,rowNumber);
 const segment=segmentIndex===null||segmentIndex===undefined?null:row.segments[segmentIndex];
 if(segmentIndex!==null&&segmentIndex!==undefined&&!segment)fail('清洗片段不存在。');
 const target=segment||row,allowed=segment?SEGMENT_FIELDS:[...ROW_FIELDS,'excluded'];
 if(!allowed.includes(field))fail('不支持修改此清洗字段。');
 const isFlag=field==='included'||field==='excluded';
 if(isFlag&&typeof value!=='boolean')fail('清洗取舍必须为布尔值。');
 if(field==='id'&&segment){if(typeof value==='string'&&/^\d+$/.test(value))value=Number(value);if(!Number.isSafeInteger(value)||value<1)fail('轮次编号须为正整数。');}
 else if(!isFlag&&typeof value!=='string')fail('清洗字段须为文本。');
 const holder=segment?segment:ROW_FIELDS.includes(field)?row.fields:row;
 const previous=holder[field],manual=target.manual||{};
 if(previous===value&&!manual[field])return next;
 const from=manual[field]?.from??previous;
 holder[field]=value;target.manual={...manual,[field]:{from,to:value,reason:String(reason||''),at:now}};
 const index=segment?segmentIndex:null,last=row.history.at(-1);
 // A sequence of input events is one auditable edit. Only the immediately
 // preceding change to this target can be extended; another field, a split or
 // a confirmation closes the edit. Keep its first value and initial time.
 const continuous=!row.confirmed&&last&&(last.operation===undefined||last.operation==='edit')&&last.segmentIndex===index&&last.field===field&&canonical(last.to)===canonical(previous);
 if(continuous){last.to=value;last.reason=String(reason||'');last.updatedAt=now;}
 else row.history.push({operation:'edit',segmentIndex:index,field,from:previous,to:value,reason:String(reason||''),at:now});
 row.confirmed=false;row.confirmedAt=null;row.reviewer='';if(row.status==='pending'||row.status==='failed')row.status='manual';return next;
}
export function firstVerifiedCleaningMessageTime(draft,rowNumber){
 const row=draft?.rows?.find(row=>row.row===rowNumber);if(!row||row.excluded)return null;
 const index=row.segments.findIndex(segment=>segment.included&&segment.kind!=='separator'),segment=row.segments[index],origin=segment?.fieldSources?.at;
 if(segment?.kind!=='message'||!segment.at||segment.at!==segment.candidate?.at||origin?.kind!=='exact'||!Number.isSafeInteger(origin.start)||!Number.isSafeInteger(origin.end)||row.original.text.slice(origin.start,origin.end)!==origin.quote||normalizeCleaningTime(origin.quote,draft.timezone)!==segment.at)return null;
 return {value:segment.at,segmentIndex:index,start:origin.start,end:origin.end,quote:origin.quote};
}
export function adoptFirstCleaningMessageTime(draft,rowNumber,{reason='人工点击采用原文首条消息时间作为会话开始时间，已对照来源核对。',now=currentTime()}={}){
 const first=firstVerifiedCleaningMessageTime(draft,rowNumber);if(!first)fail('首条消息没有可核验的完整来源时间，请人工核实后补录。');
 const next=updateCleaningField(draft,rowNumber,null,'startedAt',first.value,{reason,now}),row=next.rows.find(row=>row.row===rowNumber);
 row.manual.startedAt.origin={kind:'first-message-time',...first};return next;
}
export function splitCleaningSegment(draft,rowNumber,segmentIndex,offset,{reason='',now=currentTime()}={}){
 if(typeof reason!=='string'||!reason.trim())fail('人工拆分消息必须填写边界修改原因。');
 const {next,row}=mutableRow(draft,rowNumber),previous=row.segments[segmentIndex],loc=previous?.sourceLocator;
 if(!loc||!Number.isSafeInteger(offset)||offset<=loc.start||offset>=loc.end)fail('拆分位置须为当前片段内部的源文本UTF-16偏移。');
 if(row.segments.length>=1501)fail('片段数量已达上限，请分批整理。');
 const before=row.original.text.charCodeAt(offset-1),after=row.original.text.charCodeAt(offset);
 if(before>=0xD800&&before<=0xDBFF&&after>=0xDC00&&after<=0xDFFF)fail('拆分位置不能切断一个emoji或其他代理对字符。');
 const make=(start,end,id)=>{
  const sourceQuote=row.original.text.slice(start,end),segment=rawSegment(sourceQuote);
  segment.sourceLocator={start,end};segment.fieldSources.text={kind:'exact',start,end,quote:sourceQuote};
  return reviewSegment(segment,id-1);
 };
 const newId=Math.max(...row.segments.map(segment=>segment.id))+1;
 row.segments.splice(segmentIndex,1,make(loc.start,offset,previous.id),make(offset,loc.end,newId));
 row.history.push({operation:'split',segmentIndex,offset,reason:reason.trim(),at:now,previous:clone(previous)});
 row.status='manual';row.confirmed=false;row.confirmedAt=null;row.reviewer='';return next;
}
function assertManual(target,baseline,current,allowed){
 if(!object(target.manual))fail('人工清洗留痕结构无效。');
 for(const [key,change] of Object.entries(target.manual)){
  if(!allowed.includes(key)||!object(change)||typeof change.reason!=='string'||!change.reason.trim()||change.reason.length>2000||!calendar(change.at))fail('人工改判、补录或弃用必须填写原因，并保留操作时间。');
  if(canonical(change.from)!==canonical(baseline[key])||canonical(change.to)!==canonical(current[key]))fail('人工改判留痕的修改前后值与来源草稿或确认内容不一致。');
 }
}
function assertRow(row,{reviewer,confirmed=false}={}){
 if(typeof reviewer!=='string'||!reviewer.trim())fail('请填写清洗核对人标签。');
 const baseline={...Object.fromEntries(ROW_FIELDS.map(key=>[key,['id','agent'].includes(key)?row.original[key]:''])),excluded:false};
 assertManual(row,baseline,{...row.fields,excluded:row.excluded},[...ROW_FIELDS,'excluded']);
 if(confirmed&&(!row.confirmed||!calendar(row.confirmedAt)||!row.reviewer?.trim()))fail(`原表第${row.row}行尚未人工确认。`);
 if(row.excluded){if(!row.manual?.excluded?.reason?.trim())fail('弃行必须填写原因，原行仍随报告保留。');return;}
 if(['pending','failed','running'].includes(row.status))fail('请先完成本行AI起草或人工处理，失败行不能直接略过。');
 if(!row.fields.id?.trim()||row.fields.id.trim().length>160)fail('请补充有效会话ID并记录来源或补录原因。');
 if(!calendar(row.fields.startedAt))fail('会话开始时间须人工核对为含时区的真实日期时间，来源无时间时不得编造。');
 if(!['完整','部分缺失'].includes(row.fields.completeness)||(row.fields.completeness==='部分缺失'&&!row.fields.missingNote?.trim()))fail('请人工确认会话完整性；部分缺失需填写说明。');
 for(const key of ROW_FIELDS)if(row.fields[key]!==(['id','agent'].includes(key)?row.original[key]:'')&&!row.manual?.[key]?.reason?.trim())fail('会话字段与来源不一致或来源缺失，请记录人工修改或补录原因。');
 for(const key of ['startedAt','completeness'])if(!row.manual?.[key]?.reason?.trim())fail('来源缺少的时间或完整性必须由人工明确补录并填写原因。');
 let included=0;const ids=new Set();
 validateCleaningSegments(row.original.text,row.segments.map(s=>({...s,kind:s.candidate?.kind||s.kind})));
 for(const segment of row.segments){
  assertManual(segment,segment.candidate||{},segment,SEGMENT_FIELDS);
  if(segment.kind==='separator'){
   if(segment.candidate?.kind!=='separator'||segment.sourceQuote.trim())fail('有内容的来源片段不能改判为分隔符。');
   continue;
  }
  if(!segment.included){if(!segment.manual?.included?.reason?.trim())fail('弃用片段必须填写原因；片段仍保留在清洗报告。');continue;}
  if(segment.kind!=='message')fail('尚有未处理片段，请人工转为消息或注明弃用原因。');
  if(!ROLES.includes(segment.role)||!segment.text?.trim()||segment.text.length>20000)fail('请补充有效消息角色和非空原文；单轮最多20000字符。');
  if(segment.at&&!calendar(segment.at))fail('消息时间须为含时区的真实日期时间，未知时保留为空。');
  if(!Number.isSafeInteger(segment.id)||segment.id<1||ids.has(segment.id))fail('消息轮次编号无效或重复。');ids.add(segment.id);
  for(const key of ['kind','role','at','text','id'])if(segment[key]!==segment.candidate?.[key]&&!segment.manual?.[key]?.reason?.trim())fail('消息字段与AI草稿不同，请填写人工改判原因。');
  included++;
 }
 if(!included)fail('至少保留一轮消息，或明确注明弃行原因。');
 if(included>500)fail('单会话最多500轮消息，请分批整理。');
}
export function confirmCleaningRow(draft,rowNumber,{reviewer,now=currentTime()}={}){
 const {next,row}=mutableRow(draft,rowNumber);if(!calendar(now))fail('人工核对时间无效。');assertRow(row,{reviewer});
 row.history.push({operation:'confirm',reviewer:reviewer.trim(),at:now});
 row.confirmed=true;row.reviewer=reviewer.trim();row.confirmedAt=now;return next;
}
function sessionsFromDraft(draft){return draft.rows.filter(row=>!row.excluded).map(row=>({
 ...Object.fromEntries(INFO.map(key=>[key,key==='scene'?draft.scene:String(row.fields[key]??'')])),id:row.fields.id.trim(),
 turns:row.segments.filter(segment=>segment.included&&segment.kind==='message').map(segment=>({id:segment.id,role:segment.role,speaker:segment.role==='客服'?row.fields.agent:segment.role==='客户'?row.fields.customer:'',at:segment.at||'',text:segment.text})),
}));}
function reportCounts(rows){
 const kept=rows.filter(row=>!row.excluded),segments=kept.flatMap(row=>row.segments),changes=rows.flatMap(row=>[...Object.values(row.manual||{}),...row.segments.flatMap(segment=>Object.values(segment.manual||{}))]);
 return {sourceRows:rows.length,sourceSegments:rows.reduce((n,row)=>n+row.segments.filter(s=>s.kind!=='separator').length,0),includedSessions:kept.length,includedTurns:segments.filter(s=>s.included&&s.kind==='message').length,excludedRows:rows.filter(row=>row.excluded).length,excludedSegments:segments.filter(s=>s.kind!=='separator'&&!s.included).length,unparsedSegments:segments.filter(s=>s.kind==='unparsed'&&s.included).length,manualChanges:changes.length+rows.reduce((n,row)=>n+row.history.filter(event=>event.operation==='split').length,0),roleChanges:rows.reduce((n,row)=>n+row.segments.filter(segment=>segment.manual?.role&&segment.manual.role.from!==segment.manual.role.to).length,0)};
}
export function buildCleaningReportSnapshot(draft,{source,reviewer,conversionReview,now=currentTime()}={}){
 if(!object(draft)||draft.version!==CLEANING_REPORT_VERSION||!Array.isArray(draft.rows)||!draft.rows.length)fail('清洗草稿结构无效。');
 for(const row of draft.rows)assertRow(row,{reviewer,confirmed:true});
 const snapshot={version:CLEANING_REPORT_VERSION,promptVersion:CLEANING_PROMPT_VERSION,source:clone(source),sourceName:draft.sourceName,scene:draft.scene,sheet:draft.sheet,headerRow:draft.headerRow,columns:clone(draft.columns),timezone:draft.timezone,reviewer:reviewer.trim(),confirmedAt:now,rows:clone(draft.rows),counts:reportCounts(draft.rows)};
 if(conversionReview!==undefined)snapshot.conversionReview=clone(conversionReview);
 validateCleaningReportSnapshot(snapshot,{source});return snapshot;
}
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:object(value)?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
function validateCleaningHistory(row,timezone){
 const invalid=()=>fail('人工改判留痕的修改前后值与来源草稿或确认内容不一致。');
 const replay={fields:clone(row.fields),excluded:row.excluded,segments:clone(row.segments)};
 // Reverse replay validates both the compact format and older per-input audit
 // events. Splits carry their preceding segment, so indexes remain meaningful
 // when later segments are edited or split again.
 for(let index=row.history.length-1;index>=0;index--){
  const event=row.history[index];if(!object(event)||!calendar(event.at)||event.updatedAt!==undefined&&!calendar(event.updatedAt))invalid();
  if(event.operation==='confirm'){if(typeof event.reviewer!=='string'||!event.reviewer.trim())invalid();continue;}
  if(event.operation==='split'){
   const at=event.segmentIndex,previous=event.previous,loc=previous?.sourceLocator;
   if(!Number.isSafeInteger(at)||at<0||!object(previous)||!loc||!Number.isSafeInteger(event.offset)||event.offset<=loc.start||event.offset>=loc.end||!event.reason?.trim())invalid();
   const parts=[replay.segments[at],replay.segments[at+1]],ranges=[[loc.start,event.offset],[event.offset,loc.end]];
   for(let part=0;part<2;part++){
    const segment=parts[part],[start,end]=ranges[part];
    if(!segment||segment.sourceLocator?.start!==start||segment.sourceLocator?.end!==end||segment.sourceQuote!==row.original.text.slice(start,end)||segment.kind!=='unparsed'||segment.text!==segment.sourceQuote||segment.role!==''||segment.at!==''||segment.included!==true)invalid();
   }
   if(parts[0].id!==previous.id)invalid();
   replay.segments.splice(at,2,clone(previous));continue;
  }
  if(event.operation!==undefined&&event.operation!=='edit')invalid();
  const segment=event.segmentIndex===null?null:replay.segments[event.segmentIndex],allowed=segment?SEGMENT_FIELDS:[...ROW_FIELDS,'excluded'];
  if(event.segmentIndex!==null&&(!Number.isSafeInteger(event.segmentIndex)||event.segmentIndex<0||!segment)||!allowed.includes(event.field)||typeof event.reason!=='string'||event.reason.length>2000)invalid();
  const target=segment||ROW_FIELDS.includes(event.field)&&replay.fields||replay;
  if(canonical(target[event.field])!==canonical(event.to))invalid();target[event.field]=clone(event.from);
 }
 for(const key of ROW_FIELDS)if(replay.fields[key]!==(['id','agent'].includes(key)?row.original[key]:''))invalid();
 if(replay.excluded!==false)invalid();
 for(const segment of replay.segments){
  const candidate=segment.candidate,loc=segment.sourceLocator;
  if(!object(candidate)||!loc||row.original.text.slice(loc.start,loc.end)!==segment.sourceQuote||candidate.sourceQuote!==segment.sourceQuote||canonical(candidate.sourceLocator)!==canonical(loc))invalid();
  for(const field of SEGMENT_FIELDS)if(canonical(segment[field])!==canonical(candidate[field]))invalid();
  const textOrigin=candidate.fieldSources?.text,timeOrigin=candidate.fieldSources?.at;
  if(!textOrigin||candidate.text!==(textOrigin.kind==='missing'?'':textOrigin.quote)||textOrigin.kind!=='missing'&&row.original.text.slice(textOrigin.start,textOrigin.end)!==textOrigin.quote||!timeOrigin||candidate.at!==normalizeCleaningTime(timeOrigin.kind==='missing'?'':timeOrigin.quote,timezone))invalid();
 }
 return true;
}
export function validateCleaningReportSnapshot(snapshot,{source,sessions}={}){
 if(!object(snapshot)||snapshot.version!==CLEANING_REPORT_VERSION||snapshot.promptVersion!==CLEANING_PROMPT_VERSION||!isSceneKey(snapshot.scene)||snapshot.scene==='电商评论回复'||typeof snapshot.sourceName!=='string'||!snapshot.sourceName.trim()||typeof snapshot.sheet!=='string'||!snapshot.sheet.trim()||!Number.isSafeInteger(snapshot.headerRow)||snapshot.headerRow<1||!object(snapshot.columns)||Object.keys(snapshot.columns).some(key=>!['id','agent','text'].includes(key))||['id','agent','text'].some(key=>typeof snapshot.columns[key]!=='string'||!snapshot.columns[key].trim())||!['','+08:00'].includes(snapshot.timezone)||typeof snapshot.reviewer!=='string'||!snapshot.reviewer.trim()||!calendar(snapshot.confirmedAt)||!Array.isArray(snapshot.rows)||!snapshot.rows.length||snapshot.rows.length>500)fail('清洗报告快照结构无效。');
 const review=snapshot.conversionReview;
 if(review!==undefined&&(!object(review)||Object.keys(review).length!==4||review.version!==1||!calendar(review.mappingConfirmedAt)||!calendar(review.previewConfirmedAt)||typeof review.operator!=='string'||!review.operator.trim()||Date.parse(review.mappingConfirmedAt)>Date.parse(snapshot.confirmedAt)||Date.parse(review.previewConfirmedAt)>Date.parse(snapshot.confirmedAt)))fail('转换的字段对应与抽样确认留痕无效。');
 const saved=snapshot.source;
 if(!object(saved)||!(/^[a-f0-9]{64}$/).test(saved.sha256||'')||typeof saved.name!=='string'||!saved.name.trim()||!Number.isSafeInteger(saved.size)||saved.size<1||saved.size>MAX_FILE)fail('清洗报告必须绑定已保存原件。');
 if(source&&['sha256','name','size'].some(key=>saved[key]!==source[key]))fail('清洗报告与任务原件不一致。');
 const rowIds=new Set();
 for(const row of snapshot.rows){
  if(!object(row)||!Number.isSafeInteger(row.row)||row.row<=snapshot.headerRow||rowIds.has(row.row)||!object(row.original)||['id','agent','text'].some(key=>typeof row.original[key]!=='string')||!object(row.fields)||ROW_FIELDS.some(key=>typeof row.fields[key]!=='string')||!Array.isArray(row.history)||!Array.isArray(row.attempts)||typeof row.excluded!=='boolean'||typeof row.confirmed!=='boolean'||!object(row.manual)||!Array.isArray(row.segments))fail('清洗报告来源行无效或重复。');
  for(const event of row.history)if(event.operation==='split'&&(!event.reason?.trim()||!calendar(event.at)||!object(event.previous)||row.original.text.slice(event.previous.sourceLocator?.start,event.previous.sourceLocator?.end)!==event.previous.sourceQuote))fail('人工拆分边界的来源或原因留痕无效。');
  rowIds.add(row.row);assertRow(row,{reviewer:snapshot.reviewer,confirmed:true});validateCleaningHistory(row,snapshot.timezone);
  const adopted=row.manual.startedAt?.origin;
  if(adopted){
   const first=firstVerifiedCleaningMessageTime(snapshot,row.row);
   if(!first||adopted.kind!=='first-message-time'||['value','segmentIndex','start','end','quote'].some(key=>adopted[key]!==first[key])||adopted.value!==row.fields.startedAt)fail('采用首条消息时间的人工留痕与来源不一致。');
  }
  for(const field of ['id','agent']){
   const origin=row.fieldSources?.[field];if(!object(origin)||origin.sheet!==snapshot.sheet||origin.row!==row.row||origin.column!==snapshot.columns[field]||(row.original[field]&&((origin.start!==0||origin.end!==row.original[field].length||origin.quote!==row.original[field]))))fail('会话ID或客服源文本定位无效。');
  }
  validateCleaningSegments(row.original.text,row.segments.map(segment=>({...segment,kind:segment.candidate?.kind||segment.kind})));
  for(const segment of row.segments){
   if(!object(segment.candidate)||segment.candidate.sourceQuote!==segment.sourceQuote||canonical(segment.candidate.sourceLocator)!==canonical(segment.sourceLocator))fail('清洗AI草稿和原文定位不可改写。');
   if(!['message','unparsed','separator'].includes(segment.candidate.kind)||!Number.isSafeInteger(segment.candidate.id)||segment.candidate.id<1||!['客户','客服','系统',''].includes(segment.candidate.role)||typeof segment.candidate.text!=='string'||typeof segment.candidate.at!=='string')fail('清洗草稿字段结构无效。');
   for(const key of ['text','role','at']){
    const origin=segment.fieldSources?.[key];
    if(!object(origin)||!['exact','ai-inferred','missing'].includes(origin.kind))fail('消息字段缺少来源定位。');
    if(origin.kind!=='missing'&&(!Number.isSafeInteger(origin.start)||!Number.isSafeInteger(origin.end)||origin.start<segment.sourceLocator.start||origin.end>segment.sourceLocator.end||origin.end<origin.start||row.original.text.slice(origin.start,origin.end)!==origin.quote))fail('消息字段源文本定位不一致。');
    if(canonical(origin)!==canonical(segment.candidate.fieldSources?.[key]))fail('AI草稿来源定位不可由人工字段覆盖。');
    if(key==='text'&&segment.candidate.text!==(origin.kind==='missing'?'':origin.quote))fail('AI草稿原文与来源逐字摘录不一致。');
    if(key==='at'&&segment.candidate.at!==normalizeCleaningTime(origin.kind==='missing'?'':origin.quote,snapshot.timezone))fail('AI草稿时间无法从来源确定转换，禁止补造日期。');
   }
  }
 }
 if(canonical(reportCounts(snapshot.rows))!==canonical(snapshot.counts))fail('清洗报告计数与逐行留痕不一致。');
 if(sessions){
  const expected=sessionsFromDraft(snapshot);if(expected.length!==sessions.length)fail('清洗报告与任务会话数量不一致。');
  for(let index=0;index<expected.length;index++){
   const a=expected[index],b=sessions[index];
   if(!b||a.id!==(b.externalId??b.id)||INFO.filter(key=>key!=='id').some(key=>a[key]!==b[key])||canonical(a.turns)!==canonical(b.turns.map(turn=>Object.fromEntries(['id','role','speaker','at','text'].map(key=>[key,turn[key]??''])))))fail('清洗报告确认内容与任务会话不一致。');
  }
 }
 return true;
}
export async function finalizeCleaningDraft(draft,{source,reviewer,conversionReview,now=currentTime()}={}){
 try{
  const cleaningReportSnapshot=buildCleaningReportSnapshot(draft,{source,reviewer,conversionReview,now});
  const sessions=sessionsFromDraft(draft);if(!sessions.length)fail('全部行均已弃用，不能创建空任务；原行和原因仍保留在当前草稿。');
  const bytes=await workbook([{name:'会话信息',headers:INFO_HEADERS,rows:sessions.map(session=>INFO.map(key=>session[key]))},{name:'会话明细',headers:TURN_HEADERS,rows:sessions.flatMap(session=>session.turns.map(turn=>[session.id,turn.id,turn.role,turn.speaker,turn.at,turn.text]))}]);
  const parsed=await parseBusinessInput({name:'会话清洗_会话信息与逐条发言表草稿.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  if(!parsed.valid)return {...parsed,bytes:null,cleaningReportSnapshot:null};
  validateCleaningReportSnapshot(cleaningReportSnapshot,{source,sessions:parsed.sessions});return {...parsed,bytes,cleaningReportSnapshot};
 }catch(error){return {valid:false,errors:[error?.message||'清洗确认或原双表预检未通过。'],warnings:[],sessions:[],turnCount:0,bytes:null,cleaningReportSnapshot:null};}
}
