import {isAIFinal} from './ai-triage.mjs';
import {isProcessedUnknown} from './pending-resolution.mjs';

const MAX_SEGMENT_MS=4*60*60*1000;
/** Visible review time, independent of wall-clock timestamps used for its audit. */
export function createRawReviewTimer({getSession,isActive,save,clock=()=>globalThis.performance?.now?.()??Date.now(),now=()=>new Date().toISOString(),idleMs=60000,checkpointMs=15000,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
 if(typeof getSession!=='function'||typeof isActive!=='function'||typeof save!=='function'||typeof idleMs!=='number'||!Number.isFinite(idleMs)||idleMs<=0||typeof checkpointMs!=='number'||!Number.isFinite(checkpointMs)||checkpointMs<0)throw new TypeError('Invalid raw review timer settings.');
 let active=null,presence=null,checkpoint=null,suspended=0,tail=Promise.resolve();const pending=[];
 const editable=s=>s?.rawTranscript?.schemaVersion===1&&s.review?.status!=='已确认'&&!isAIFinal(s)&&!isProcessedUnknown(s)&&s.aiExecution?.status!=='running';
 const cancelCheckpoint=()=>{if(checkpoint!==null)clearTimer(checkpoint);checkpoint=null;};
 function capture(){
  if(!active)return false;
  const old=active,current=getSession();active=null;cancelCheckpoint();
  // A confirmation render can follow a completed timing flush by milliseconds.
  // Never enqueue that new transient interval for an already-readonly record.
  // Previously queued/failed packets remain untouched for idempotent recovery.
  if(current?.id===old.id&&!editable(current))return false;
  const ending=Math.min(clock(),old.activityAt+idleMs);let remaining=Math.max(0,ending-old.startedAt);
  if(!remaining)return false;
  const at=now();
  while(remaining>0){const elapsedMs=Math.min(remaining,MAX_SEGMENT_MS);pending.push({sessionId:old.id,reviewer:old.reviewer,elapsedMs,segmentId:'review-'+crypto.randomUUID(),now:at});remaining-=elapsedMs;}
  return true;
 }
 function drain(){
  const task=tail.then(async()=>{try{while(pending.length){await save(pending[0]);pending.shift();}}finally{sync();}});tail=task.catch(()=>{});return task;
 }
 function scheduleCheckpoint(){
  if(checkpoint!==null||!checkpointMs||!active||suspended)return;
  const remaining=active.activityAt+idleMs-clock();if(remaining<=0)return;
  checkpoint=setTimer(()=>{checkpoint=null;return flush().catch(()=>{});},Math.min(checkpointMs,remaining));checkpoint?.unref?.();
 }
 function sync(){
  if(suspended){cancelCheckpoint();return;}
  const s=getSession(),enabled=isActive()&&editable(s),at=clock();
  if(active&&(!enabled||active.id!==s.id)){if(capture())void drain().catch(()=>{});}
  if(!enabled){presence=null;cancelCheckpoint();return;}
  if(!presence||presence.id!==s.id)presence={id:s.id,reviewer:s.review.reviewer||'本机操作人',activityAt:at};
  // Saving or rendering a checkpoint must not grant a fresh idle allowance.
  if(!active&&at<presence.activityAt+idleMs)active={...presence,startedAt:at};
  scheduleCheckpoint();
 }
 function flush(){
  capture();
  const s=getSession();if(!isActive()||!editable(s))presence=null;
  const task=drain();sync();return task;
 }
 function activity(){
  if(suspended)return;
  const s=getSession(),at=clock();if(!isActive()||!editable(s)){sync();return;}
  if(active&&(active.id!==s.id||at>active.activityAt+idleMs)){if(capture())void drain().catch(()=>{});}
  if(!presence||presence.id!==s.id)presence={id:s.id,reviewer:s.review.reviewer||'本机操作人',activityAt:at};else presence.activityAt=at;
  if(active)active.activityAt=at;
  sync();
 }
 /** Pause before flush + business mutation, then release against the new UI state. */
 function suspend(){
  suspended++;capture();cancelCheckpoint();let released=false;
  return()=>{if(released)return;released=true;suspended--;if(!suspended){presence=null;sync();}};
 }
 return{sync,activity,flush,suspend,get pendingCount(){return pending.length;}};
}
