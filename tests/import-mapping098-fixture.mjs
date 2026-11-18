import {workbook} from '../public/io.mjs';
export const mappingCoreIndices=Array.from({length:22},(_,index)=>index);
export const mappingLayout=[9,2,'extra',12,21,0,7,14,4,13,8,6,18,1,20,10,5,19,3,15,11,17,16];
export const mappingSourceHeaders=['大区归属','采样月份','市场区域','业务国家','页面商品编号','采购单编号','商品款号','商品标题','买家留言','商家答复','买家星级','答复坐席','留言发生时点','首答发生时点','历史评价种类',...Array.from({length:7},(_,index)=>`历史字段-${index}`)];
export const mappingRaw=row=>['GROUP','PERIOD','REGION','COUNTRY','00004','00005','00006','PRODUCT',`Synthetic comment ${row}.`,`Synthetic reply ${row}.`,'5','Synthetic administrator','2026-11-01 08:00:00','2026-11-01 09:00:00','PRIVATE_HISTORY_TYPE',...Array.from({length:7},(_,index)=>`PRIVATE_HISTORY_${index}`)];
export async function ecommerceMappingFixture({missing=false,multiple=false,noStandard=false,unknownTimes=false}={}){
 const layout=missing?mappingLayout.filter(index=>index!==21):mappingLayout;
 const physical=values=>layout.map(index=>index==='extra'?'PRIVATE_EXTENSION':values[index]);
 const headers=layout.map(index=>index==='extra'?'保留信息':mappingSourceHeaders[index]);
 const standards=physical(mappingCoreIndices.map(index=>`PRIVATE_STANDARD_${index}`));
 const records=[3,27].map(row=>{const raw=mappingRaw(row);if(unknownTimes)raw[12]=raw[13]='来源未给出完整时点';return{row,raw,values:physical(raw)};});
 const data={name:'原始售后数据',headers,rows:[...(noStandard?[]:[standards]),...records.map(record=>record.values)],rowNumbers:[...(noStandard?[]:[2]),...records.map(record=>record.row)]};
 const bytes=await workbook(multiple?[{...data,name:'第二来源'},data]:[data]);
 const file=new File([bytes],'合成映射.xlsx');
 const mappings=mappingCoreIndices.filter(index=>layout.includes(index)).map(targetIndex=>({targetIndex,sourceColumn:layout.indexOf(targetIndex)+1,sourceHeader:mappingSourceHeaders[targetIndex]}));
 return{bytes,file,headers,standards,records,mappings,layout,sheet:data.name,sheetIndex:multiple?2:1};
}
