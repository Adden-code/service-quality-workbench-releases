// Import lineage describes repeated batches; source SHA and evidence remain untouched.
const rowsFor=(state,task)=>state.sessions.filter(row=>row.taskId===task.id);
const content=rows=>JSON.stringify(rows.map(row=>[row.externalId||row.id,row.rawTranscript?.raw||row.ecommerce?.raw||row.turns?.map(t=>[t.role,t.text,t.at||''])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
const order=(a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id),undefined,{numeric:true});
export function newImportLineage(state,task,rows){
 const body=content(rows),entries=[...state.tasks,...(state.taskDeletionAudit||[]).map(a=>a.task)].filter(t=>t.id!==task.id&&t.mode==='manual'&&t.scene===task.scene).sort(order);
 const match=entries.find(t=>t.source?.sha256===task.source?.sha256||(state.tasks.includes(t)&&content(rowsFor(state,t))===body));
 if(!match)return {schemaVersion:1,firstTaskId:task.id,ordinal:1};
 const firstTaskId=match.importLineage?.firstTaskId||match.id;
 const ordinals=entries.filter(t=>(t.importLineage?.firstTaskId||t.id)===firstTaskId).map(t=>t.importLineage?.ordinal||1);
 return {schemaVersion:1,firstTaskId,ordinal:Math.max(...ordinals)+1};
}
export function importLineage(state,task){
 if(task.importLineage)return task.importLineage;
 if(task.mode!=='manual')return null;
 // Legacy tasks remain immutable. Derive their display from earlier batches only.
 const earlier=state.tasks.filter(t=>order(t,task)<0);
 return newImportLineage({...state,tasks:earlier,taskDeletionAudit:[]},task,rowsFor(state,task));
}
export const isRepeatedImport=(state,task)=>Boolean(task&&importLineage(state,task)?.ordinal>1);
export function importLineageLabel(state,task){const line=importLineage(state,task);return line?`${line.ordinal>1?'再次导入 · ':''}第${line.ordinal}次`:'';}
export function validateImportLineages(state,previous){
 const fail=()=>{throw new Error('重复导入批次关联无效或历史导入记录被修改。');};
 for(const task of state.tasks){const line=task.importLineage,old=previous?.tasks.find(t=>t.id===task.id);
  if(old&&JSON.stringify(old.importLineage)!==JSON.stringify(line))fail();
  if(previous&&!old&&task.mode==='manual'&&!line)fail();
  if(!line)continue;
  if(Object.keys(line).sort().join(',')!=='firstTaskId,ordinal,schemaVersion'||line.schemaVersion!==1||typeof line.firstTaskId!=='string'||!line.firstTaskId||!Number.isSafeInteger(line.ordinal)||line.ordinal<1||line.ordinal===1&&line.firstTaskId!==task.id)fail();
  if(previous&&!old){const base={...state,tasks:state.tasks.filter(t=>order(t,task)<0)};if(JSON.stringify(newImportLineage(base,task,rowsFor(state,task)))!==JSON.stringify(line))fail();}
 }
}
