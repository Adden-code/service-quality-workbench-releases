// Physical source cells are immutable. The legacy-shaped projection is an
// internal engine adapter only, never the source workbook or a human answer.
export const SYSTEM_EC_HEADERS=Object.freeze(['展示商品ID','订单编码','SKU编码','SKU名称','运营商名称','评论内容','回复内容','评分','管理员','评论时间','最新回复时间','文本检测结果','正负向检测结果','正负向人工标记','追评内容','追评时间','首次回复时间','末次回复时间','首次展示时间','末次展示时间','处理状态','是否展示','是否已回复']);
const normalize=v=>String(v).normalize('NFKC').replace(/\s/gu,'').toLowerCase();
const required=[5,6,7,8,9,16];
const countries={MX:'墨西哥',SA:'沙特',AE:'阿联酋',ZA:'南非',EG:'埃及',TR:'土耳其',MY:'马来西亚',TH:'泰国',PH:'菲律宾',ID:'印度尼西亚',SG:'新加坡',CL:'智利',CO:'哥伦比亚',PE:'秘鲁',BR:'巴西',GB:'英国',DE:'德国',FR:'法国',IT:'意大利',ES:'西班牙',PL:'波兰',RO:'罗马尼亚'};
export function operatorSite(operator,fallback=''){
 const match=/^VMALL-([A-Z]{2})-HWB2C$/i.exec(operator.trim()),code=match?.[1]?.toUpperCase();
 return code&&countries[code]?{value:countries[code],code,origin:'operator-code',source:operator}:fallback.trim()?{value:fallback.trim(),code:'',origin:'batch-manual',source:operator}:{value:'',code:'',origin:'unrecognized',source:operator};
}
export function systemColumns(headers){
 const mappings=SYSTEM_EC_HEADERS.map((header,targetIndex)=>{const found=headers.flatMap((v,i)=>normalize(v)===normalize(header)?[i+1]:[]);if(found.length!==1)throw new Error(`系统导出表头【${header}】${found.length?'重复':'未找到'}；格式不同可使用“AI解析转换”。`);return{targetIndex,sourceColumn:found[0],sourceHeader:headers[found[0]-1]};});
 return validateSystemMapping(mappings,headers,{complete:true,standard:true});
}
export function validateSystemMapping(mappings,headers,{complete=false,standard=false}={}){
 if(!Array.isArray(headers)||headers.length<1||headers.length>16340||headers.some(v=>typeof v!=='string'||v.length>20000)||!Array.isArray(mappings)||mappings.length>23)throw new Error('原文件表头或字段对应数量无效。');
 const targets=new Set(),sources=new Set();
 for(const m of mappings){if(!m||Object.keys(m).sort().join()!=='sourceColumn,sourceHeader,targetIndex'||!Number.isSafeInteger(m.targetIndex)||m.targetIndex<0||m.targetIndex>22||!Number.isSafeInteger(m.sourceColumn)||m.sourceColumn<1||m.sourceColumn>headers.length||m.sourceHeader!==headers[m.sourceColumn-1]||!m.sourceHeader.trim()||targets.has(m.targetIndex)||sources.has(m.sourceColumn))throw new Error('字段对应须使用不同的真实原列，不能补造或重复使用来源。');targets.add(m.targetIndex);sources.add(m.sourceColumn);}
 if(complete&&(standard?SYSTEM_EC_HEADERS.map((_,i)=>i):required).some(i=>!targets.has(i)))throw new Error('请补齐评论、回复、评分、管理员、评论时间和首次回复时间的列对应；其他原列仍完整保留。');
 return structuredClone(mappings).sort((a,b)=>a.targetIndex-b.targetIndex);
}
export function systemReviewedMapping(source,mappings,{reviewed,applied,dataStartRow=2}={}){
 if(reviewed!==true||applied!==true||![2,3].includes(dataStartRow)||!/^[a-f0-9]{64}$/.test(source.fileSha256)||!Number.isSafeInteger(source.sheetIndex)||source.sheetIndex<1)throw new Error('请分别核对字段对应、首条数据行和原文预览后确认。');
 return{schemaVersion:2,fileSha256:source.fileSha256,sheet:source.sheet,sheetIndex:source.sheetIndex,mappings:validateSystemMapping(mappings,source.headers,{complete:true}),reviewed:true,applied:true,dataStartRow};
}
export function systemValue(source,index){const column=source.mappings.find(m=>m.targetIndex===index)?.sourceColumn;return column?source.values[column-1]:'';}
export function systemEngineValues(source){
 const raw=Array(22).fill('');for(const [target,index]of [[4,0],[5,1],[6,2],[7,3],[8,5],[9,6],[10,7],[11,8],[12,9],[13,16]])raw[target]=systemValue(source,index);
 raw[3]=operatorSite(systemValue(source,4),source.batchSite).value;return raw;
}
export function validateSystemSource(source,record){
 const keys=['format','headers','values','mappings','batchSite','dataStartRow','reviewedMapping'];
 if(!source||Object.keys(source).length!==keys.length||keys.some(k=>!Object.hasOwn(source,k))||source.format!=='business-export-23.v1'||!Array.isArray(source.values)||source.values.length!==source.headers?.length||source.values.some(v=>typeof v!=='string'||v.length>20000)||typeof source.batchSite!=='string'||source.batchSite.length>80||![2,3].includes(source.dataStartRow)||record.row<source.dataStartRow)throw new Error('系统导出来源记录无效。');
 validateSystemMapping(source.mappings,source.headers,{complete:true,standard:!source.reviewedMapping});
 if(source.reviewedMapping){const expected=systemReviewedMapping({...source.reviewedMapping,headers:source.headers},source.mappings,source.reviewedMapping);if(JSON.stringify(expected)!==JSON.stringify(source.reviewedMapping)||expected.fileSha256!==record.fileSha256||expected.sheet!==record.sheet||expected.sheetIndex!==record.sheetIndex||expected.dataStartRow!==source.dataStartRow)throw new Error('已确认的字段对应与原文件不一致。');}
 else if(JSON.stringify(systemColumns(source.headers))!==JSON.stringify(source.mappings)||source.dataStartRow!==2)throw new Error('标准系统导出的来源列或首条数据行不一致。');
 if(JSON.stringify(systemEngineValues(source))!==JSON.stringify(record.raw))throw new Error('判定输入与系统导出的原文不一致。');
}
