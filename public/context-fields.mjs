import {isSceneKey} from './scenarios.mjs';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const fail=message=>{throw new Error(message);};
const text=(v,label,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(`${label}无效。`);};
export function validateContextFields(fields=[],turns=[]){
 if(!Array.isArray(fields)||fields.length>2000)fail('场景字段最多2000项。');
 const keys=new Set(),turnIds=new Set(turns.map(t=>t.id));
 for(const f of fields){
  if(!object(f)||Object.keys(f).some(k=>!['key','label','type','value','turnId','source'].includes(k)))fail('场景字段结构无效。');
  text(f.key,'场景字段标识',160);text(f.label,'场景字段名称',120);
  if(keys.has(f.key))fail('场景字段标识重复。');keys.add(f.key);
  if(f.type==='number'?typeof f.value!=='number'||!Number.isFinite(f.value):f.type!=='text'||typeof f.value!=='string'||f.value.length>20000)fail('场景字段值与类型不一致。');
  if(f.turnId!==undefined&&(!Number.isSafeInteger(f.turnId)||!turnIds.has(f.turnId)))fail('场景字段关联轮次不存在。');
  if(!object(f.source)||Object.keys(f.source).some(k=>!['sheet','row','column'].includes(k))||!Number.isSafeInteger(f.source.row)||f.source.row<1||f.source.row>1048576)fail('场景字段来源行无效。');
  text(f.source.sheet,'场景字段来源表',80);text(f.source.column,'场景字段来源列',160);
 }
 return true;
}
export function validateFieldEvidence(evidence=[],fields=[]){
 if(!Array.isArray(evidence)||new Set(evidence).size!==evidence.length||evidence.some(k=>typeof k!=='string'||!fields.some(f=>f.key===k)))fail('字段证据必须引用本会话真实场景字段，且不能重复。');return true;
}
export function validateRuleProvenance(p){
 if(!object(p)||Object.keys(p).some(k=>!['source','quote','locator','scene','preparedBy'].includes(k)))fail('规则来源结构无效。');
 const s=p.source;
 if(!object(s)||typeof s.name!=='string'||!s.name.trim()||s.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(s.name)||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.size)||s.size<1||s.size>8*1024*1024)fail('规则来源原文件名称或摘要无效。');
 text(p.quote,'规则来源原文',100000);text(p.locator,'规则来源定位',400);
 if(!isSceneKey(p.scene))fail('规则来源场景无效。');
 if(!object(p.preparedBy))fail('规则来源整理记录无效。');
 const modelId=p.preparedBy.modelId;
 if(typeof modelId!=='string'||!modelId.trim()||[...modelId].length>160)fail('规则来源整理记录无效。');
 for(const [key,max] of [['promptVersion',160],['at',80]])text(p.preparedBy[key],'规则来源整理记录',max);
 if(!Number.isFinite(Date.parse(p.preparedBy.at))||!/(Z|[+-]\d{2}:\d{2})$/.test(p.preparedBy.at))fail('规则来源整理时间无效。');
 if(p.preparedBy.requestId!==undefined)text(p.preparedBy.requestId,'规则来源请求标识',160);
 return true;
}
