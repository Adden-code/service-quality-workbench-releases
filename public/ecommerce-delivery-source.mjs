// Old delivery snapshots have no extension descriptor and remain 43 columns.
// New snapshots keep one positional descriptor and one value array per record.
import {validateEcommerceSourceColumns} from './ecommerce-columns.mjs';
import {validateReviewedEcommerceMapping} from './ecommerce-conversion.mjs';
export function ecommerceDeliverySource(snapshot){
  if(snapshot.sourceFormat==='business-export-23.v1')return{sheet:snapshot.sourceSheet,headers:[],standards:[],values:()=>[],mapping:null};
  const sheet=snapshot.sourceSheet??{name:'Sheet4',index:null};
  if(!sheet||typeof sheet.name!=='string'||!sheet.name.trim()||sheet.name.length>80||sheet.index!==null&&(!Number.isSafeInteger(sheet.index)||sheet.index<1||sheet.index>16384))throw new Error('业务交付来源工作表无效。');
  const extensions=snapshot.extensions??{headers:[],standards:[]},n=extensions.headers?.length;
  if(!Array.isArray(extensions.headers)||!Array.isArray(extensions.standards)||extensions.standards.length!==n||43+n>16384||[...extensions.headers,...extensions.standards].some(value=>typeof value!=='string'||value.length>20000))throw new Error('业务交付扩展列描述无效或超出16384列。');
  const values=record=>{
    const values=record.extensionValues??[];
    if(!Array.isArray(values)||values.length!==n||values.some(value=>typeof value!=='string'||value.length>20000))throw new Error('业务交付扩展列原值须与表头、标准逐列一致。');
    return values;
  };
  snapshot.records.forEach(values);
  if(snapshot.reviewedMapping!==undefined&&snapshot.sourceColumns===undefined)throw new Error('已确认源列映射缺少原物理列描述。');
  const mapping=snapshot.sourceColumns===undefined?null:validateEcommerceSourceColumns(snapshot.sourceColumns,snapshot.headers22,extensions.headers,snapshot.reviewedMapping);
  if(snapshot.reviewedMapping!==undefined){
    const headers=Array(22+n);snapshot.sourceColumns.core.forEach((column,index)=>headers[column-1]=snapshot.headers22[index]);snapshot.sourceColumns.extensions.forEach((column,index)=>headers[column-1]=extensions.headers[index]);
    validateReviewedEcommerceMapping(snapshot.reviewedMapping,{fileSha256:snapshot.source?.sha256,sheet:sheet.name,sheetIndex:sheet.index,headers});
  }
  return{sheet,headers:extensions.headers,standards:extensions.standards,values,mapping};
}

export function ecommerceSourceMappingRows(snapshot){
  const {mapping}=ecommerceDeliverySource(snapshot);
  if(!mapping)return[];
  const provenance=mapping.userReviewed?'user-reviewed-mapping':mapping.legacyRelativeRegions?'legacy-relative-core-order':'unique-header';
  return[...snapshot.sourceColumns.core.map((column,index)=>[column,index+1,snapshot.headers22[index],'core',provenance]),...snapshot.sourceColumns.extensions.map((column,index)=>[column,44+index,snapshot.extensions.headers[index],'extension','original-relative-order'])].sort((a,b)=>a[0]-b[0]);
}
