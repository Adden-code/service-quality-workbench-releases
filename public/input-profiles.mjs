// Deterministic business-XLSX adaptation. This module never saves data or calls a model.
import {readXlsx,XLSX_ROW_NUMBER} from './io.mjs';
import {parseBusinessInput} from './business-input.mjs';
import {isSceneKey} from './scenarios.mjs';

const MAX_FILE=8*1024*1024,MAX_EXTRAS=50,MAX_CONTEXT=2000;
const ROLES=['客户','客服','系统'];
const COMMON=['id','startedAt','topic','channel','product','agent','customer','completeness','missingNote'];
const DEFAULTS=['topic','channel','product','agent','customer','completeness','missingNote'];
const TURN_FIELDS=['role','text','speaker','at'],PAIR_FIELDS=['customerText','agentText'];
const PROFILE_KEYS=['id','name','version','scene','layout','sheet','headerRow','fields','roleMap','dateFormat','defaults','extras','ruleIds','createdAt','updatedAt'];
const EXTRA_KEYS=['key','column','label','type','purpose','required'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const fail=message=>{throw new Error(message);};
const nonempty=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
const string=(value,label,max,empty=false)=>{
 if(typeof value!=='string'||(!empty&&!value.trim())||value.length>max)fail(label+'须为'+(empty?'':'非空')+'文本，且最多'+max+'字符。');
 return value;
};
const keys=(value,allowed,label)=>{
 if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail(label+'包含不支持的字段或结构。');
};
const safeKey=(value,label,max=64)=>{string(value,label,max);if(/\s|@/.test(value)||['__proto__','prototype','constructor'].includes(value))fail(label+'不能含空白、@或保留字段名。');};
function validIso(value){
 const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/);
 if(!m)return false;
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 return y>0&&mo>=1&&mo<=12&&d>=1&&d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]&&h<=23&&mi<=59&&s<=59&&(m[7]==='Z'||(+m[8]<=14&&+m[9]<=59&&(+m[8]!==14||+m[9]===0)))&&Number.isFinite(Date.parse(value));
}

/** Return a detached, data-free configuration; throw a readable error when invalid. */
export function validateInputProfile(profile){
 keys(profile,PROFILE_KEYS,'导入配置');
 safeKey(profile.id,'配置标识');string(profile.name,'配置名称',120);
 if(!Number.isSafeInteger(profile.version)||profile.version<1)fail('配置版本version须为正整数。');
 if(!isSceneKey(profile.scene))fail('业务场景须为内置场景或合法的SCENE-场景标识。');
 if(!['turns','pair'].includes(profile.layout))fail('布局仅支持turns或pair。');
 string(profile.sheet,'工作表名称',80);
 if(!Number.isSafeInteger(profile.headerRow)||profile.headerRow<1||profile.headerRow>100000)fail('表头物理行须为1至100000之间的整数。');
 if(!['iso','beijing'].includes(profile.dateFormat))fail('日期格式须明确选择iso或beijing。');
 const allowed=[...COMMON,...(profile.layout==='turns'?TURN_FIELDS:PAIR_FIELDS)];
 keys(profile.fields,allowed,'字段映射');
 for(const [key,value] of Object.entries(profile.fields))string(value,'映射列 '+key,160,true);
 for(const key of ['id','startedAt',...(profile.layout==='turns'?['role','text']:PAIR_FIELDS)])if(!profile.fields[key]?.trim())fail('请明确映射必需字段 '+key+' 的源表头。');
 if(!object(profile.roleMap))fail('角色映射roleMap须为对象。');
 for(const [key,value] of Object.entries(profile.roleMap)){string(key,'源角色',160);if(!ROLES.includes(value))fail('角色映射只能指向客户、客服或系统。');}
 keys(profile.defaults,DEFAULTS,'默认常量');
 for(const [key,value] of Object.entries(profile.defaults))string(value,'默认常量 '+key,20000,true);
 if(!profile.fields.completeness?.trim()&&!profile.defaults.completeness?.trim())fail('请明确映射会话完整性completeness，或填写默认完整性。');
 if(profile.defaults.completeness!==undefined&&!['完整','部分缺失'].includes(profile.defaults.completeness))fail('默认完整性只支持完整或部分缺失。');
 if(!Array.isArray(profile.extras)||profile.extras.length>MAX_EXTRAS)fail('扩展字段须为最多50项的数组。');
 const seen=new Set();
 for(const extra of profile.extras){
  keys(extra,EXTRA_KEYS,'扩展字段');safeKey(extra.key,'扩展字段key');
  if(seen.has(extra.key))fail('扩展字段key重复：'+extra.key+'。');seen.add(extra.key);
  string(extra.column,'扩展字段源列',160);string(extra.label,'扩展字段名称',120);
  if(!['text','number'].includes(extra.type))fail('扩展字段类型type仅支持text或number。');
  if(!['inspect','retain'].includes(extra.purpose))fail('扩展字段用途purpose仅支持inspect或retain。');
  if(typeof extra.required!=='boolean')fail('扩展字段required须明确为布尔值。');
 }
 if(!Array.isArray(profile.ruleIds)||profile.ruleIds.length>100||new Set(profile.ruleIds).size!==profile.ruleIds.length)fail('配置规则标识须为最多100项且无重复的数组。');
 for(const id of profile.ruleIds){string(id,'规则标识',64);if(/\s/.test(id))fail('规则标识不能包含空白。');}
 for(const key of ['createdAt','updatedAt'])if(profile[key]!==undefined&&!validIso(profile[key]))fail('配置'+key+'须为包含时区的真实ISO时间。');
 const result=structuredClone(profile);
 result.fields=Object.fromEntries(Object.entries(profile.fields).filter(([,value])=>value.trim()).map(([key,value])=>[key,value.trim()]));
 result.extras=result.extras.map(extra=>({...extra,column:extra.column.trim()}));
 return result;
}

async function spreadsheet(file){
 if(!file||typeof file.arrayBuffer!=='function')fail('请选择可读取的业务Excel文件。');
 if(!/\.xlsx$/i.test(String(file.name||'')))fail('原业务表映射仅支持.xlsx文件。');
 if(Number(file.size)>MAX_FILE)fail('文件大小超过8MB，请分批导入。');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(!bytes.byteLength)fail('文件为空。');
 if(bytes.byteLength>MAX_FILE)fail('文件大小超过8MB，请分批导入。');
 const tables=await readXlsx(bytes);
 for(const [name,rows] of Object.entries(tables)){
  let previous=0;
  for(let index=0;index<rows.length;index++){
   const row=rows[index][XLSX_ROW_NUMBER]??index+1;
   if(!Number.isSafeInteger(row)||row<1||row>1048576||row<=previous)fail(name+'的物理行号无效、重复或顺序异常。');
   previous=row;
  }
 }
 return tables;
}
const safeError=error=>typeof error?.message==='string'&&/[\u3400-\u9fff]/.test(error.message)?error.message:'业务Excel无法读取，或压缩结构无效。';
/** rows retain actual worksheet row numbers; values remain in original column order. */
export async function inspectMappedFile(file){
 try{
  const tables=await spreadsheet(file);
  const sheets=Object.entries(tables).map(([name,rows])=>{
   const values=rows.map((row,index)=>({row:row[XLSX_ROW_NUMBER]??index+1,values:Array.from({length:row.length},(_,column)=>String(row[column]??''))}));
   return {name,rows:values,headers:(values.find(item=>item.values.some(nonempty))?.values||[]).map(value=>value.trim())};
  });
  return {valid:true,errors:[],warnings:[],sheets};
 }catch(error){return {valid:false,errors:[safeError(error)],warnings:[],sheets:[]};}
}
function dateValue(value,format,issue){
 if(!value.trim())issue('时间不能为空。');
 if(format==='iso'){if(!validIso(value))issue('时间须为含时区且日期真实的ISO文本。');return value;}
 const m=value.trim().match(/^(\d{4})([-/])(\d{2})\2(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/);
 if(!m)issue('北京时间须为YYYY-MM-DD HH:mm[:ss]文本；不自动转换Excel数字日期。');
 const converted=m[1]+'-'+m[3]+'-'+m[4]+'T'+m[5]+':'+m[6]+':'+(m[7]||'00')+(m[8]||'')+'+08:00';
 if(!validIso(converted))issue('北京时间包含无效日期或时间。');return converted;
}
const at=(sheet,row,column,message)=>fail(sheet+'第'+row+'行【'+column+'】：'+message);
function extraValues(profile,headers,values,row,turnId,context){
 for(const extra of profile.extras){
  const raw=String(values[headers.indexOf(extra.column)]??'');
  if(!raw.trim()){if(extra.required)at(profile.sheet,row,extra.column,'此扩展字段为必填。');continue;}
  let value=raw;
  if(extra.type==='number'){
   if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())||!Number.isFinite(Number(raw)))at(profile.sheet,row,extra.column,'须为有限数字，不能含单位或百分号。');
   value=Number(raw);
   if(Number.isInteger(value)&&!Number.isSafeInteger(value))at(profile.sheet,row,extra.column,'数字超过安全整数精度，请改为文本字段。');
   if(value===0&&!/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?$/.test(raw.trim()))at(profile.sheet,row,extra.column,'数字精度过小，不能转换为零，请改为文本字段。');
  }else if(raw.length>20000)at(profile.sheet,row,extra.column,'扩展文本最多20000字符。');
  if(extra.purpose==='inspect'){
   if(context.length>=MAX_CONTEXT)at(profile.sheet,row,extra.column,'单会话参与判断的扩展字段最多2000项，请缩小范围。');
   context.push({key:extra.key+(turnId!==undefined?'@'+turnId:''),label:extra.label,type:extra.type,value,...(turnId!==undefined?{turnId}:{}),source:{sheet:profile.sheet,row,column:extra.column}});
  }
 }
}
function mapTable(tables,profile,warnings,rolePreview){
 const rows=tables[profile.sheet];if(!rows)fail('所选工作表不存在：'+profile.sheet+'。');
 for(const [name,other] of Object.entries(tables))if(name!==profile.sheet&&other.some(row=>row.some(nonempty)))warnings.push('未导入未选中的工作表：'+name+'；原文件仍保留。');
 const header=rows.find((row,index)=>(row[XLSX_ROW_NUMBER]??index+1)===profile.headerRow);
 if(!header)at(profile.sheet,profile.headerRow,'表头','所选物理行不存在。');
 const headers=Array.from({length:header.length},(_,i)=>String(header[i]??'').trim()),nonemptyHeaders=headers.filter(Boolean);
 if(!nonemptyHeaders.length)at(profile.sheet,profile.headerRow,'表头','表头不能为空。');
 if(new Set(nonemptyHeaders).size!==nonemptyHeaders.length)at(profile.sheet,profile.headerRow,'表头','表头字段名重复。');
 for(const name of [...Object.values(profile.fields),...profile.extras.map(extra=>extra.column)])if(!headers.includes(name))at(profile.sheet,profile.headerRow,name,'缺少已配置的源列。');
 const sessions=[],grouped=new Map(),mappedColumns=new Set(Object.values(profile.fields));
 function makeSession(values,row){
  const session={id:'',scene:profile.scene,startedAt:'',topic:'',channel:'',product:'',agent:'',customer:'',completeness:'',missingNote:'',turns:[],contextFields:[]};
  for(const key of COMMON){
   const column=profile.fields[key],raw=column?String(values[headers.indexOf(column)]??''):String(profile.defaults[key]??'');
   session[key]=raw.trim();
  }
  if(!session.id||session.id.length>160)at(profile.sheet,row,profile.fields.id,'会话标识不能为空且最多160字符。');
  session.startedAt=dateValue(session.startedAt,profile.dateFormat,message=>at(profile.sheet,row,profile.fields.startedAt,message));
  if(!['完整','部分缺失'].includes(session.completeness))at(profile.sheet,row,profile.fields.completeness||'完整性常量','须明确填写完整或部分缺失。');
  if(session.completeness==='部分缺失'&&!session.missingNote)at(profile.sheet,row,profile.fields.missingNote||'缺失说明常量','部分缺失时必须填写缺失说明。');
  return session;
 }
 function addTurn(session,role,text,values,row,column){
  if(!text.trim()||text.length>20000)at(profile.sheet,row,column,'原文须为非空文本，最多20000字符。');
  if(session.turns.length>=500)at(profile.sheet,row,column,'每个会话最多500轮，请分批整理。');
  const turn={id:session.turns.length+1,role,speaker:'',at:'',text};
  if(profile.layout==='turns'){
   if(profile.fields.speaker)turn.speaker=String(values[headers.indexOf(profile.fields.speaker)]??'');
   if(profile.fields.at){const raw=String(values[headers.indexOf(profile.fields.at)]??'');if(raw.trim())turn.at=dateValue(raw,profile.dateFormat,message=>at(profile.sheet,row,profile.fields.at,message));}
  }else turn.speaker=role==='客户'?session.customer:session.agent;
  session.turns.push(turn);return turn;
 }
 for(let index=0;index<rows.length;index++){
  const values=rows[index],row=values[XLSX_ROW_NUMBER]??index+1;
  if(row<=profile.headerRow||!values.some(nonempty))continue;
  for(let column=0;column<values.length;column++)if(nonempty(values[column])&&!headers[column])at(profile.sheet,row,'第'+(column+1)+'列','有内容的列缺少表头，无法保留。');
  const current=makeSession(values,row);
  let session=grouped.get(current.id);
  if(profile.layout==='pair'&&session)at(profile.sheet,row,profile.fields.id,'单行评论会话标识重复。');
  if(session){
   for(const key of COMMON.filter(key=>key!=='id')){
    if(session[key]&&current[key]&&session[key]!==current[key])at(profile.sheet,row,profile.fields[key]||key,'同一会话的会话级字段冲突。');
    if(!session[key]&&current[key])session[key]=current[key];
   }
  }else{
   if(sessions.length>=500)at(profile.sheet,row,profile.fields.id,'每个文件最多500个会话，请分批导入。');
   session=current;sessions.push(session);grouped.set(session.id,session);
  }
  const metadata=Object.fromEntries(headers.flatMap((name,column)=>name&&!mappedColumns.has(name)&&nonempty(values[column])?[[name,String(values[column])]]:[]));
  if(profile.layout==='turns'){
   const roleText=String(values[headers.indexOf(profile.fields.role)]??'').trim();
   const role=Object.hasOwn(profile.roleMap,roleText)?profile.roleMap[roleText]:ROLES.includes(roleText)?roleText:null;
   if(!role)at(profile.sheet,row,profile.fields.role,'源角色没有明确映射为客户、客服或系统。');
   const turn=addTurn(session,role,String(values[headers.indexOf(profile.fields.text)]??''),values,row,profile.fields.text);
   const sourceValue=String(values[headers.indexOf(profile.fields.role)]??'');
   let group=rolePreview.groups.find(item=>item.sourceValue===sourceValue&&item.role===role);
   if(!group){group={sourceValue,role,count:0,samples:[]};rolePreview.groups.push(group);}
   group.count++;rolePreview.total++;
   if(group.samples.length<3)group.samples.push({externalId:session.id,row,turnId:turn.id,text:turn.text});
   if(Object.keys(metadata).length)turn.metadata=metadata;
   extraValues(profile,headers,values,row,turn.id,session.contextFields);
  }else{
   addTurn(session,'客户',String(values[headers.indexOf(profile.fields.customerText)]??''),values,row,profile.fields.customerText);
   const reply=String(values[headers.indexOf(profile.fields.agentText)]??'');
   if(reply.trim())addTurn(session,'客服',reply,values,row,profile.fields.agentText);
   else warnings.push(profile.sheet+'第'+row+'行【'+profile.fields.agentText+'】：客服回复为空，未补造回复，请核对会话完整性。');
   if(Object.keys(metadata).length)session.metadata=metadata;
   extraValues(profile,headers,values,row,undefined,session.contextFields);
  }
 }
 if(!sessions.length)at(profile.sheet,profile.headerRow,'记录','表头之后没有可导入的业务记录。');
 return sessions;
}

/** A failed mapping returns no partial sessions or snapshot. No source facts are guessed. */
export async function parseMappedInput(file,inputProfile){
 const warnings=[];
 try{
  const profile=validateInputProfile(inputProfile),tables=await spreadsheet(file);
  const rolePreview=profile.layout==='turns'?{sheet:profile.sheet,sourceColumn:profile.fields.role,total:0,groups:[]}:null;
  const sessions=mapTable(tables,profile,warnings,rolePreview);
  const bytes=new TextEncoder().encode(JSON.stringify({format:'SERVICE_QUALITY_INPUT_V1',sessions}));
  const parsed=await parseBusinessInput({name:'mapped-business-input.json',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  if(!parsed.valid)return {...parsed,warnings:[...warnings,...parsed.warnings]};
  return {...parsed,warnings:[...warnings,...parsed.warnings],...(rolePreview?{rolePreview}:{}),importMappingSnapshot:{profile:structuredClone(profile)}};
 }catch(error){return {valid:false,errors:[safeError(error)],warnings,sessions:[],turnCount:0};}
}
