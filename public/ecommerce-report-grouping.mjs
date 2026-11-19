// Overview presentation only. Read the frozen delivery snapshot; never infer
// missing values or consult the live scene configuration.
const clean=value=>typeof value==='string'?value.trim():'';
export function ecommerceOverviewValue(row,dimension,snapshot){
 const {record,audit}=row,outputs=audit.capabilities?.outputs||{};
 if(dimension==='agent')return clean(audit.agent)||clean(record.raw22?.[11]);
 if(dimension==='product')return clean(record.product)||clean(audit.product)||clean(record.raw22?.[7]);
 if(dimension==='site'){
  const source=clean(record.raw22?.[3]);if(source)return source;
  const site=outputs.site;if(site?.status!=='completed')return '';
  return clean(snapshot.executionSnapshot.configuration.timingPolicy?.sites?.find(s=>s.id===site.value?.siteId)?.label);
 }
 if(dimension==='intent'){
  const intent=outputs.intent;if(intent?.status!=='completed')return '';
  return clean(snapshot.executionSnapshot.taxonomy?.labels?.find(label=>label.id===intent.value?.labelId)?.label);
 }
 return '';
}
export function ecommerceOverviewGroups(rows,dimension,snapshot){
 const byValue=new Map(),missing=[];
 for(const row of rows){const key=ecommerceOverviewValue(row,dimension,snapshot);if(!key){missing.push(row);continue;}if(!byValue.has(key))byValue.set(key,[]);byValue.get(key).push(row);}
 // Stable ties retain first source occurrence. Missing values are kept outside
// the top-30 budget so that they can never disappear into Other.
 const ranked=[...byValue].sort((a,b)=>b[1].length-a[1].length),tail=ranked.slice(30);
 const groups=ranked.slice(0,30).map(([key,items])=>({kind:'value',key,items}));
 if(tail.length)groups.push({kind:'other',count:tail.length,items:tail.flatMap(([,items])=>items)});
 if(missing.length)groups.push({kind:'missing',items:missing});
 return{groups,mergedGroups:tail.length,knownGroups:ranked.length};
}
