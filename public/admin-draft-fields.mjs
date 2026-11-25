/** Display fields only. Source quotations, locators, identifiers and audit data
 * are deliberately excluded; the editor always keeps the original package. */
export function rulePreparationFields(result){
 const fields=[],add=(id,text)=>{if(typeof text==='string'&&text.trim())fields.push({id,text});};
 for(const [i,r] of (result?.candidates||[]).entries()){
  for(const key of ['title','category','scope','passCriteria','failCriteria','exceptionCriteria'])add(`rules.${i}.${key}`,r[key]);
  for(const [j,text] of (r.warnings||[]).entries())add(`rules.${i}.warnings.${j}`,text);
 }
 return fields;
}
export function sceneDraftFields(draft){
 const p=draft?.package||{},fields=rulePreparationFields({candidates:p.ruleCandidates}),add=(id,text)=>{if(typeof text==='string'&&text.trim())fields.push({id,text});};
 for(const [i,item] of (p.unmapped||[]).entries())add(`unresolved.${i}`,typeof item==='string'?item:item.reason);
 for(const [i,item] of (p.taxonomy?.labels||[]).entries())for(const key of ['label','definition'])add(`taxonomy.labels.${i}.${key}`,item[key]);
 for(const [i,text] of (p.taxonomy?.principles||[]).entries())add(`taxonomy.principles.${i}`,text);
 for(const [i,item] of (p.taxonomy?.examples||[]).entries())for(const key of ['original','translated'])add(`taxonomy.examples.${i}.${key}`,item[key]);
 for(const [i,table] of (p.exceptions||[]).entries())for(const [j,item] of (table.entries||[]).entries())add(`exceptions.${i}.${j}.condition`,item.condition);
 add('delivery.title',p.template?.title);
 for(const [i,item] of (p.template?.sections||[]).entries())add(`delivery.sections.${i}.title`,item.title);
 for(const [i,item] of (p.template?.columnGroups||[]).entries())add(`delivery.groups.${i}.label`,item.label);
 for(const [i,item] of (p.template?.columns||[]).entries()){
  add(`delivery.columns.${i}.label`,item.label);
  if(item.generator!=='rule')for(const [j,text] of (item.enum||[]).entries())add(`delivery.columns.${i}.enum.${j}`,text);
 }
 return fields;
}
const names={rules:'Rule',title:'Title',category:'Category',scope:'Scope',passCriteria:'PASS criteria',failCriteria:'FAIL criteria',exceptionCriteria:'Exceptions / uncertainty',warnings:'Warning',unresolved:'Unresolved item',taxonomy:'Taxonomy',labels:'Label',label:'Label',definition:'Definition',principles:'Selection principle',examples:'Example',original:'Source example (English view)',translated:'Bilingual example (English view)',exceptions:'Exception table',condition:'Condition',delivery:'Deliverable',sections:'Section',groups:'Column group',columns:'Column',enum:'Allowed value'};
export function adminDraftFieldLabel(id){return id.split('.').map(x=>/^\d+$/.test(x)?Number(x)+1:names[x]||x).join(' · ');}
