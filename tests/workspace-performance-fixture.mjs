import {createInitialState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
export function largeWorkspace({count=430,megabytes=24}={}){
 const base=createInitialState(),sample=base.sessions.find(s=>s.review.status!=='已确认'),state={...base,businessMigrationVersion:1,tasks:[],sessions:[],activity:[]};
 const catalog=createCatalog(),basis=createBasisSnapshot(catalog,{effectiveDate:'2026-11-19',ruleIds:sample.aiResults.map(r=>r.ruleId)});
 for(let i=0;i<9;i++)state.tasks.push({...structuredClone(base.tasks[0]),id:'SYNTHETIC-TASK-'+i,name:'Synthetic performance batch '+i,sessionIds:[],mode:'manual',scene:'新品产品咨询',basisSnapshot:basis,aiStatus:'completed',source:{name:'synthetic.json',size:10,sha256:'a'.repeat(64)},aiRun:{id:'synthetic-run-'+i,modelId:'synthetic',status:'completed',total:1,done:1,failed:0,startedAt:'2026-11-19T01:00:00Z',completedAt:'2026-11-19T02:00:00Z'}});
 const text=' Synthetic conversation for performance verification only.'.repeat(Math.ceil(megabytes*1024*1024/count/57));
 for(let i=0;i<count;i++){const task=state.tasks[i<180?0:1+(i-180)%8],s={...structuredClone(sample),id:'SYNTHETIC-S'+i,externalId:'Synthetic '+i,taskId:task.id,scene:task.scene,expectedRuleIds:sample.aiResults.map(r=>r.ruleId),aiExecution:{status:'completed',runId:task.aiRun.id,modelId:'synthetic',startedAt:task.aiRun.startedAt,completedAt:task.aiRun.completedAt}};s.turns[0].text+='\n'+text;state.sessions.push(s);task.sessionIds.push(s.id);}
 state.tasks=state.tasks.filter(t=>t.sessionIds.length);for(const t of state.tasks){t.aiRun.total=t.aiRun.done=t.sessionIds.length;t.aiQueue={version:1,status:'completed',phase:'completed',fingerprint:'b'.repeat(64),updatedAt:t.aiRun.completedAt,settings:{concurrency:1,batchSize:20,maxWorkBytes:250000},comparison:null,rows:t.sessionIds.map((id,i)=>({sessionId:id,batchId:'b'+Math.floor(i/20),sourceRow:i+2,runId:t.aiRun.id,status:'completed',attempts:1,durationMs:100,inputSha256:'c'.repeat(64)})),batches:Array.from({length:Math.ceil(t.sessionIds.length/20)},(_,i)=>({id:'b'+i,index:i+1,status:'completed',sessionIds:t.sessionIds.slice(i*20,(i+1)*20)}))};}
 return{schemaVersion:1,revision:1,state,catalog,mutations:[]};
}
