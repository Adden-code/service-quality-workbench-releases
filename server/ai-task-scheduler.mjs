export const AI_TASK_QUEUE_STATUSES=Object.freeze(['queued','running','paused','completed','partial','failed','cancelled']);
export const AI_TASK_QUEUE_PAUSE_REASONS=Object.freeze(['user','interrupted','config_changed','connection_required','storage_error','capability_failure_rate','capability_unavailable']);
const terminal=new Set(['completed','partial','failed','cancelled']);

export const isTaskQueueTerminal=status=>terminal.has(status);
export function createTaskQueue(){return{version:1,status:'ready',pauseReason:null,nextSequence:1,entries:[]};}
export function pendingTaskEntries(queue){return(queue?.entries||[]).filter(entry=>!terminal.has(entry.status)).sort((a,b)=>a.sequence-b.sequence);}
export function taskQueueEntry(queue,taskId,runId){return queue?.entries.find(entry=>entry.taskId===taskId&&entry.runId===runId);}
export function appendTaskEntry(queue,task,queuedAt){
  const previous=taskQueueEntry(queue,task.id,task.aiRun.id);
  const values={taskId:task.id,runId:task.aiRun.id,sequence:queue.nextSequence++,queuedAt,status:task.aiRun.status,completedAt:task.aiRun.completedAt,blockedReason:null};
  if(previous){Object.assign(previous,values);return previous;}
  queue.entries.push(values);return values;
}
export function syncTaskEntries(state){
  for(const entry of state.aiTaskQueue?.entries||[]){
    const task=state.tasks.find(task=>task.id===entry.taskId),run=[task?.aiRun,...(task?.aiRunHistory||[])].find(run=>run?.id===entry.runId);
    if(!run)continue;
    entry.status=run.status;entry.completedAt=run.completedAt;
    if(terminal.has(entry.status))entry.blockedReason=null;
  }
}
export function taskQueueRuntime(queue){
  const entries=queue?.entries||[],pending=pendingTaskEntries(queue);
  const previousIncompleteCount=sequence=>entries.filter(entry=>entry.sequence<sequence&&['partial','failed'].includes(entry.status)).length;
  return{queueStatus:queue?.status||'ready',queuePauseReason:queue?.pauseReason??null,
    queue:pending.map((entry,index)=>({taskId:entry.taskId,runId:entry.runId,position:index+1,status:entry.status,blockedReason:entry.blockedReason,previousIncompleteCount:previousIncompleteCount(entry.sequence)})),
    previousIncompleteCount:previousIncompleteCount(pending[0]?.sequence??Infinity)};
}
