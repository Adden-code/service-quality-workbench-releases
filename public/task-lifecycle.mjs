// Lifecycle is independent of inspection status; original results are never removed.
const fail=message=>{throw new Error(message);};
const text=value=>typeof value==='string'&&value.trim();
const iso=value=>text(value)&&Number.isFinite(Date.parse(value))&&/[TZ]/.test(value)&&/(Z|[+-]\d\d:\d\d)$/.test(value);
export const isVoidedTask=task=>Boolean(task?.lifecycle?.voidedAt);
export const isArchivedTask=task=>Boolean(task?.lifecycle?.archivedAt);
export const isInactiveTask=task=>isArchivedTask(task)||isVoidedTask(task);
export function assertTaskWritable(state,sessionOrTask){
 const task=sessionOrTask?.taskId?state.tasks.find(t=>t.id===sessionOrTask.taskId):sessionOrTask;
 if(isInactiveTask(task))fail(isVoidedTask(task)?'作废任务只读，不能继续审核或运行。':'归档任务只读，请先恢复任务再审核或运行。');
}
export function syncTaskLifecycleStatus(task){
 if(!isInactiveTask(task))return;
 const status=isVoidedTask(task)?'已作废':'已归档';
 if(task.status!==status){task.lifecycle.previousStatus=task.status;task.status=status;}
}
export function migrateTaskLifecycleStatus(input){
 const result=structuredClone(input);let changed=false;
 for(const task of result.state.tasks)if(isInactiveTask(task)&&task.status!==(isVoidedTask(task)?'已作废':'已归档')){syncTaskLifecycleStatus(task);changed=true;}
 return {...result,changed};
}
export function taskInFolder(task,folder='active'){
 if(folder==='all')return true;
 if(folder==='voided')return isVoidedTask(task);
 if(folder==='archived')return isArchivedTask(task)&&!isVoidedTask(task);
 return !isArchivedTask(task)&&!isVoidedTask(task);
}
export function taskVoidBlockers(state,task){
 const reasons=[];
 if(isVoidedTask(task))reasons.push('任务已作废。');
 if(taskHasPendingAI(state,task))reasons.push('请勾选“同时取消本任务AI运行”，或先结束本任务AI队列，再作废。');
 return reasons;
}
export function taskHasPendingAI(state,task){return ['queued','running','paused','interrupted'].includes(task?.aiQueue?.status)||['queued','running','paused','interrupted'].includes(task?.aiStatus)||(state.sessions||[]).some(row=>row.taskId===task?.id&&row.aiExecution?.status==='running');}
export function validateTaskLifecycle(task){
 const life=task.lifecycle;if(life===undefined)return true;
 if(!life||Array.isArray(life)||life.schemaVersion!==1||!Array.isArray(life.events)||!Array.isArray(life.deliverables))fail('任务生命周期记录无效。');
 if(Object.keys(life).some(key=>!['schemaVersion','archivedAt','voidedAt','voidReason','previousStatus','events','deliverables'].includes(key)))fail('任务生命周期字段无效。');
 if(life.previousStatus!==undefined&&(!text(life.previousStatus)||life.previousStatus.length>80))fail('任务原工作状态无效。');
 for(const key of ['archivedAt','voidedAt'])if(life[key]!==undefined&&!iso(life[key]))fail('任务生命周期时间无效。');
 if(life.voidedAt&&(!text(life.voidReason)||life.voidReason.length>2000))fail('作废原因不能为空且不能超过2000字。');
 for(const event of life.events)if(!event||!['archive','restore','void'].includes(event.action)||!iso(event.at)||!text(event.actor)||event.actor.length>80||typeof event.reason!=='string'||event.reason.length>2000)fail('任务生命周期审计记录无效。');
 for(const event of life.events)if(event.cancelledRunId!==undefined&&(event.action!=='void'||!text(event.cancelledRunId)||event.cancelledRunId.length>101||![task.aiRun,...(task.aiRunHistory||[])].some(run=>run?.id===event.cancelledRunId&&run.status==='cancelled')))fail('作废取消运行审计无效。');
 for(const item of life.deliverables)if(!item||!text(item.id)||item.id.length>150||!text(item.kind)||item.kind.length>80||!iso(item.at))fail('任务交付物记录无效。');
 if(new Set(life.deliverables.map(item=>item.id)).size!==life.deliverables.length)fail('交付物登记不能重复。');
 return true;
}
export function applyTaskLifecycle(state,taskId,action,{reason='',actor='本机操作人',deliveryId,kind='report',administratorConfirmed=false,cancelledRunId,now=new Date().toISOString()}={}){
 const next=structuredClone(state),task=next.tasks.find(item=>item.id===taskId);
 if(!task)fail('任务不存在。');
 if(!text(actor)||actor.length>80)fail('请填写操作人标签（最多80字）。');
 if(!iso(now))fail('操作时间无效。');
 if(isVoidedTask(task)){
  const event=task.lifecycle.events.findLast(event=>event.action==='void');
  if(action==='void'&&typeof reason==='string'&&task.lifecycle.voidReason===reason.trim()&&event?.actor===actor.trim()&&Boolean(event?.administratorConfirmed)===administratorConfirmed)return next;
  fail('作废任务仅供追溯，不能继续运行、审核或导出。');
 }
 if(action==='archive'&&(['queued','running','paused'].includes(task.aiQueue?.status)||['queued','running','paused'].includes(task.aiStatus)))fail('请先结束或取消AI队列，再归档任务。');
 if(action==='void'){
  const blockers=taskVoidBlockers(state,task);if(blockers.length)fail(blockers.join('\n'));
  if(!text(reason)||reason.trim().length>2000)fail('请填写作废原因（最多2000字）。');
 }
 const life=task.lifecycle??={schemaVersion:1,events:[],deliverables:[]};
 if(action==='deliverable'){
  if(!text(deliveryId))fail('交付物登记标识不能为空。');
  if(!life.deliverables.some(item=>item.id===deliveryId))life.deliverables.push({id:deliveryId,kind,at:now});
 }else if(action==='archive'){
  if(life.archivedAt)return next;life.archivedAt=now;life.events.push({action,at:now,actor:actor.trim(),reason:''});
 }else if(action==='restore'){
  if(!life.archivedAt)return next;delete life.archivedAt;task.status=life.previousStatus||'待审核';delete life.previousStatus;life.events.push({action,at:now,actor:actor.trim(),reason:''});
 }else if(action==='void'){
  life.voidedAt=now;life.voidReason=reason.trim();life.events.push({action,at:now,actor:actor.trim(),reason:reason.trim(),...(administratorConfirmed?{administratorConfirmed:true}:{}),...(cancelledRunId?{cancelledRunId}:{})});
 }else fail('任务操作无效。');
 syncTaskLifecycleStatus(task);validateTaskLifecycle(task);return next;
}
export function usableTaskState(state){
 const tasks=state.tasks.filter(task=>!isVoidedTask(task)),ids=new Set(tasks.map(task=>task.id));
 return {...state,tasks,sessions:state.sessions.filter(row=>ids.has(row.taskId))};
}
