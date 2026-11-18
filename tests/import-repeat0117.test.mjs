import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState,createImportedTask,getDashboardScope} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
const at='2026-11-17T09:00:00+08:00';
export function fixture(){const catalog=createCatalog(),input={name:'Synthetic repeated import',reviewer:'Synthetic operator',source:{name:'synthetic.json',sha256:'a'.repeat(64),size:20},basisSnapshot:createBasisSnapshot(catalog,{ruleIds:['R004'],effectiveDate:'2026-11-17',now:at}),now:at,sessions:[{id:'SYNTHETIC-1',scene:'新品产品咨询',startedAt:at,agent:'Synthetic agent',topic:'Synthetic',product:'Synthetic',channel:'Synthetic',customer:'Synthetic',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'Synthetic question'},{id:2,role:'客服',text:'Synthetic answer'}]}]};return{catalog,input};}
test('0117 identical files import three times with immutable lineage and separate statistics',()=>{
 const {catalog,input}=fixture();let state=createBusinessState();const originals=[];
 for(let i=1;i<=3;i++){const prev=state;state=createImportedTask(state,input);validateWorkspace(state,catalog,prev,{authenticateNewSnapshots:true});const task=state.tasks[0];assert.equal(task.importLineage.ordinal,i);assert.equal(task.importLineage.firstTaskId,originals[0]?.id||task.id);originals.push(structuredClone(task));}
 assert.deepEqual(state.tasks.slice().reverse(),originals);
 assert.equal(getDashboardScope(state,{period:'all'}).sessions.length,1);
 assert.equal(getDashboardScope(state,{period:'all',repeatImports:'include'}).sessions.length,3);
 assert.equal(getDashboardScope(state,{period:'all',repeatImports:'only'}).sessions.length,2);
 assert.equal(getDashboardScope(state,{period:'batch',taskId:state.tasks[0].id}).sessions.length,1);
 const forged=structuredClone(state);forged.tasks[0].importLineage.ordinal=1;assert.throws(()=>validateWorkspace(forged,catalog,state),/导入|批次/);
});
test('0117 a reserialized identical dataset remains a repeat and duplicate rows inside one task remain invalid',()=>{
 const {catalog,input}=fixture();let state=createImportedTask(createBusinessState(),input);
 state=createImportedTask(state,{...input,source:{...input.source,sha256:'b'.repeat(64)}});assert.equal(state.tasks[0].importLineage.ordinal,2);validateWorkspace(state,catalog);
 assert.throws(()=>createImportedTask(state,{...input,sessions:[...input.sessions,...input.sessions]}),/同一任务|重复/);
});
