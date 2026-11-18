import {createHash} from 'node:crypto';
import {WorkspaceError,validateWorkspace} from './workspace-validation.mjs';
import {isVoidedTask} from '../public/task-lifecycle.mjs';
const fail=message=>{throw new WorkspaceError(message,409);};
export function prepareTaskDeletion(document,input,{backupPath='pending',at=new Date().toISOString()}={}){
 if(input.administratorConfirmed!==true||input.confirmTaskId!==input.taskId)fail('删除须确认本机管理员操作，并再次输入完整任务编号。');
 if(typeof input.actor!=='string'||!input.actor.trim()||input.actor.length>80)fail('请填写操作人标签（最多80字）。');
 if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)fail('请填写删除原因（最多2000字）。');
 const task=document.state.tasks.find(t=>t.id===input.taskId);if(!task||task.mode!=='manual'||!isVoidedTask(task))fail('只有已作废的业务任务可以删除。');
 const children=document.state.tasks.filter(t=>t.reinspectionOf===task.id);
 if(children.length)fail(`以下重检任务仍引用该批次，请先处理关联任务：${children.map(t=>t.id).join('、')}。`);
 const records=(document.state.ruleCalibrations?.records||[]).filter(r=>[...(r.trainingTaskIds||[]),...(r.validationTaskIds||[])].includes(task.id));
 if(records.length)fail(`任务仍是标定审计依据，不能删除。关联标定：${records.map(r=>r.id).join('、')}；可保留作废状态。`);
 if(['queued','running','paused'].includes(task.aiStatus)||['queued','running','paused'].includes(task.aiQueue?.status))fail('请先结束或取消AI队列。');
 const next=structuredClone(document),state=next.state,sessionIds=new Set(task.sessionIds),rows=state.sessions.filter(s=>sessionIds.has(s.id));
 state.tasks=state.tasks.filter(t=>t.id!==task.id);state.sessions=state.sessions.filter(s=>s.taskId!==task.id);
 state.activity=state.activity.filter(a=>a.taskId!==task.id&&!sessionIds.has(a.sessionId));
 if(state.aiTaskQueue)state.aiTaskQueue.entries=state.aiTaskQueue.entries.filter(e=>e.taskId!==task.id);
 const minimal=Object.fromEntries(['id','name','mode','scene','source','createdAt','importLineage'].filter(k=>task[k]!==undefined).map(k=>[k,structuredClone(task[k])]));
 (state.taskDeletionAudit??=[]).push({task:minimal,at,actor:input.actor.trim(),reason:input.reason.trim(),administratorConfirmed:true,backupPath,sessionCount:rows.length,lifecycle:structuredClone(task.lifecycle),snapshotSha256:createHash('sha256').update(JSON.stringify({task,rows})).digest('hex')});
 validateWorkspace(state,next.catalog);return next;
}
// Work on a validated backup map, never delete paths supplied by the browser.
// The restore transaction installs this map atomically and retains a complete backup.
export function filterTaskFiles(original,document,input){
 const files=new Map(original),id=input.taskId,jobIds=new Set();
 const parse=bytes=>{try{return JSON.parse(bytes.toString('utf8'));}catch{return null;}};
 const matches=value=>value&&(value.taskId===id||value.sourceTaskId===id||value.source?.taskId===id||value.source?.id===id);
 for(let pass=0;pass<2;pass++)for(const [name,bytes] of files){
  if(!/^(report-jobs|content-translations|raw-structure\/report-jobs)\/[^/]+\/job\.json$/.test(name))continue;
  const job=parse(bytes);if(!matches(job)&&!jobIds.has(job?.source?.jobId))continue;
  jobIds.add(job.id);const prefix=name.slice(0,-'job.json'.length);for(const key of files.keys())if(key.startsWith(prefix))files.delete(key);
 }
 for(const [name,bytes] of files){
  if(name.startsWith('import-drafts/')&&name.endsWith('.json')&&parse(bytes)?.taskId===id)files.delete(name);
  if(name.startsWith('workflow-runs/')&&name.endsWith('.json')){const run=parse(bytes);if(matches(run)||matches(run?.meta)||jobIds.has(run?.taskId))files.delete(name);}
  // Content-keyed caches have no dependable ownership index; discard only these
  // regenerable caches. Other jobs' saved outputs and catalog translations remain.
  if(/^(report-cache|translation-cache|raw-structure\/report-cache)\//.test(name))files.delete(name);
 }
 const task=document.state.tasks.find(t=>t.id===id),sha=task.source?.sha256;
 const referenced=JSON.stringify({state:{...document.state,tasks:document.state.tasks.filter(t=>t.id!==id),sessions:document.state.sessions.filter(s=>s.taskId!==id),taskDeletionAudit:[]},catalog:document.catalog}).includes(sha)||[...files].some(([n,b])=>n.startsWith('import-drafts/')&&b.toString('utf8').includes(sha));
 if(sha&&!referenced)for(const name of files.keys())if(name===`sources/${sha}`||name.startsWith(`sources/${sha}.`))files.delete(name);
 const next=prepareTaskDeletion(document,input);files.set('workspace.json',Buffer.from(JSON.stringify(next)));return files;
}
