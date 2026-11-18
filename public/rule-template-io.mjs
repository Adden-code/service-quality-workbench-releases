// Human-authored rule imports use the offline workbook reader, never a model.
import {workbook,readXlsx} from './io.mjs';
import {validateRecord} from './catalog.mjs';
import {ruleKindOf} from './rule-kind.mjs';
const fields=[['id','规则标识'],['title','规则名称'],['category','类别'],['scope','适用范围'],['version','版本号'],['effectiveAt','生效日期'],['expiresAt','失效日期'],['owner','维护人'],['changeNote','变更说明'],['policyIds','参考资料标识'],['sceneIds','场景标识'],['passCriteria','符合标准'],['failCriteria','不符合标准'],['exceptionCriteria','例外与无法判定条件']];
const kindField=['ruleKind','规则作用域类型'];
const list=value=>String(value||'').split(/[;；]/).map(item=>item.trim()).filter(Boolean);
export async function buildRuleTemplateXlsx(records=[]){
  return workbook([
    {name:'规则信息',headers:[...fields,kindField].map(([,label])=>label),rows:records.map(record=>[...fields,kindField].map(([key])=>key==='ruleKind'?ruleKindOf(record):Array.isArray(record[key])?record[key].join(';'):record[key]??''))},
    {name:'填写说明',headers:['项目','填写要求'],rows:[
      ['流程','下载模板 → 填写规则 → 导入草稿 → 核对发布。无需模型。'],
      ['规则信息','保留全部表头；每行一个规则版本，最多50个。失效日期、场景标识和规则作用域类型可留空，其余字段必填。'],
      ['规则作用域类型','session-check 表示会话检核，meta 表示交付物要求。留空将按标题与口径识别；导入时核对确认。兼容没有此列的旧模板。'],
      ['版本与日期','版本号如 V1.0；日期填写 YYYY-MM-DD 文本。新版本号必须高于目录已有版本。'],
      ['参考资料标识','用英文分号分隔，例如 NP-DOC-001;NP-DOC-002；资料须先导入目录，使用规则前还须发布有效资料。'],
      ['场景标识','用英文分号分隔：新品产品咨询、电商评论回复，或已经注册的 SCENE- 标识。留空表示未分配，不会用于新任务。'],
      ['发布','导入后全部为草稿，不沿用文件中的发布状态。逐项核对口径、参考资料、场景和生效期后发布。'],
      ['文件要求','仅接受8MB以内 .xlsx；拒绝公式、宏、外部关系及嵌入对象。'],
    ]},
  ]);
}
export async function parseRuleTemplateFile(file){
  try{
    if(!file||!/\.xlsx$/i.test(file.name||'')||typeof file.arrayBuffer!=='function')throw new Error('请选择填写好的规则 .xlsx 模板。');
    if(file.size>8*1024*1024)throw new Error('规则模板不能超过8MB。');
    const bytes=new Uint8Array(await file.arrayBuffer());if(!bytes.length||bytes.length>8*1024*1024)throw new Error('规则模板为空或超过8MB。');
    const tables=await readXlsx(bytes),table=tables['规则信息'];
    if(!table)throw new Error('规则模板缺少“规则信息”工作表，请重新下载模板。');
    const [headers=[],...raw]=table;
    if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length||fields.some(([,label])=>!headers.includes(label)))throw new Error('规则模板表头缺少字段或有重复，请重新下载模板。');
    const rows=raw.map((row,index)=>({row,index:index+2})).filter(({row})=>row.some(value=>String(value??'').trim()));
    if(!rows.length||rows.length>50)throw new Error('请填写1至50个规则版本。');
    const records=[],errors=[],keys=new Set(),now=new Date().toISOString();
    for(const {row,index} of rows){
      const record=Object.fromEntries(fields.map(([key,label])=>[key,String(row[headers.indexOf(label)]??'')]));
      const kindColumn=headers.indexOf(kindField[1]),kind=kindColumn>=0?String(row[kindColumn]??'').trim():'';
      if(kind)record.ruleKind=({'会话检核':'session-check','交付物要求':'meta'})[kind]??kind;
      else record.ruleKind=ruleKindOf(record);
      record.policyIds=list(record.policyIds);record.sceneIds=list(record.sceneIds);record.status='草稿';record.createdAt=now;record.publishedAt='';
      try{validateRecord(record,'rules');const key=JSON.stringify([record.id,record.version]);if(keys.has(key))throw new Error('规则标识和版本重复。');keys.add(key);records.push(record);}
      catch(error){errors.push(`规则信息 第${index}行：${error.message}`);}
    }
    return{valid:!errors.length,records:errors.length?[]:records,errors};
  }catch(error){return{valid:false,records:[],errors:[error.message||'规则模板无法读取，请重新下载填写。']};}
}
