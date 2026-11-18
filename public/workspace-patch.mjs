const excluded=new Set(['tasks','sessions']);
export function workspacePatch(before,after){
 const patch={tasks:[],sessions:[],removedTasks:[],removedSessions:[],state:{}};
 for(const [key,removed] of [['tasks','removedTasks'],['sessions','removedSessions']]){
  const old=new Map((before.state?.[key]||[]).map(r=>[r.id,r]));for(const row of after.state[key]){const prior=old.get(row.id);old.delete(row.id);if(prior!==row&&JSON.stringify(prior)!==JSON.stringify(row))patch[key].push(row);}patch[removed]=[...old.keys()];const order=after.state[key].map(r=>r.id);if(JSON.stringify(order)!==JSON.stringify((before.state?.[key]||[]).map(r=>r.id)))patch[key+'Order']=order;
 }
 for(const key of new Set([...Object.keys(before.state||{}),...Object.keys(after.state)]))if(!excluded.has(key)&&before.state?.[key]!==after.state[key]&&JSON.stringify(before.state?.[key])!==JSON.stringify(after.state[key]))patch.state[key]=after.state[key]??null;
 if(before.catalog!==after.catalog&&JSON.stringify(before.catalog)!==JSON.stringify(after.catalog))patch.catalog=after.catalog;
 return patch;
}
export function mergeWorkspacePatch(document,value){
 if(value.baseRevision!==document.revision)throw new Error('增量工作区版本不一致，请重新加载。');const p=value.patch,state={...document.state,...p.state};
 for(const [key,removed] of [['tasks','removedTasks'],['sessions','removedSessions']]){const changed=new Map(p[key].map(r=>[r.id,r])),deleted=new Set(p[removed]);state[key]=document.state[key].filter(r=>!deleted.has(r.id)).map(r=>{const v=changed.get(r.id)||r;changed.delete(r.id);return v;}).concat([...changed.values()]);if(p[key+'Order']){const rows=new Map(state[key].map(r=>[r.id,r]));state[key]=p[key+'Order'].map(id=>rows.get(id));if(state[key].some(r=>!r))throw new Error('增量列表不完整，请重新加载。');}}
 return {...document,...value,state,catalog:p.catalog||document.catalog,patch:undefined,baseRevision:undefined,unchanged:false};
}
