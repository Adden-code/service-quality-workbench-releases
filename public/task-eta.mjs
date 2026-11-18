const timestamp=value=>typeof value==='number'?value:Date.parse(value);
const percentile=(values,ratio)=>values[Math.min(values.length-1,Math.floor((values.length-1)*ratio))];

// Estimate only the row stage, using successful requests from this run. Queue
// waiting and pause time are deliberately absent from per-row service durations.
export function estimateTaskEta(task,{now=Date.now(),status,queueStatus,totalSessions=0}={}){
  const queue=task.aiQueue,rows=queue?.rows||[],runId=task.aiRun?.id;
  const currentStatus=status||queue?.status||task.aiStatus||'not_run',comparison=queue?.comparison;
  const total=rows.length||totalSessions,completed=rows.filter(row=>['completed','protected'].includes(row.status)).length;
  const remainingRows=rows.filter(row=>!['completed','protected'].includes(row.status));
  const phase=queue?.phase==='comparison'?'comparison':'rows';
  const base={kind:'estimating',status:currentStatus,phase,total,completed,remaining:remainingRows.length,sampleCount:0,rangeMs:null,largeBatch:total>=500,comparisonPending:Boolean(comparison&&comparison.status!=='completed'),comparisonCompleted:comparison?.blocks?.filter(block=>block.status==='completed').length||0,comparisonTotal:comparison?.blocks?.length||0};
  if(['completed','cancelled','not_run','not_started'].includes(currentStatus))return {...base,kind:currentStatus==='completed'?'completed':currentStatus==='cancelled'?'cancelled':'not_started'};
  if(queueStatus==='paused'||['paused','interrupted'].includes(currentStatus))return {...base,kind:'paused'};
  if(currentStatus==='queued')return {...base,kind:'queued'};
  if(['failed','partial'].includes(currentStatus)||rows.some(row=>['failed','blocked'].includes(row.status)))return {...base,kind:'incomplete'};
  if(phase==='comparison')return {...base,kind:'comparison'};
  if(currentStatus!=='running'||!queue||!runId)return base;
  if(!remainingRows.length)return {...base,kind:'finishing'};
  if(remainingRows.some(row=>row.status==='running'&&row.attempts>1||row.status==='pending'&&row.attempts>0))return {...base,kind:'retrying'};
  const clock=timestamp(now);
  if(!Number.isFinite(clock))return base;
  const current=rows.filter(row=>row.runId===runId);
  const lastRetry=Math.max(0,...current.filter(row=>row.attempts>1).map(row=>timestamp(row.completedAt||row.startedAt)).filter(Number.isFinite));
  const samples=current.filter(row=>row.status==='completed'&&row.attempts===1).map(row=>({start:timestamp(row.startedAt),end:timestamp(row.completedAt)})).filter(row=>Number.isFinite(row.start)&&Number.isFinite(row.end)&&row.end>row.start&&row.end<=clock&&row.end>lastRetry).sort((a,b)=>a.end-b.end).slice(-20);
  const sampled={...base,sampleCount:samples.length};
  if(samples.length<3)return sampled;
  const durations=samples.map(row=>row.end-row.start).sort((a,b)=>a-b),mean=durations.reduce((sum,value)=>sum+value,0)/durations.length;
  // Sub-second local-only checks are not enough to forecast later model calls.
  if(mean<1000)return sampled;
  const longest=durations.at(-1);
  if(remainingRows.some(row=>row.status==='running'&&(!Number.isFinite(timestamp(row.startedAt))||timestamp(row.startedAt)>clock||clock-timestamp(row.startedAt)>Math.max(longest*2,30000))))return {...sampled,kind:'slow'};
  const concurrency=Number.isSafeInteger(queue.settings?.concurrency)?Math.max(1,Math.min(4,queue.settings.concurrency)):1;
  const segments=new Map();
  for(const row of remainingRows)segments.set(row.batchId||'unsegmented',(segments.get(row.batchId||'unsegmented')||0)+1);
  const waves=[...segments.values()].reduce((sum,count)=>sum+Math.ceil(count/concurrency),0);
  const lower=Math.max(1000,percentile(durations,.25)*waves*.65),upper=Math.max(lower+1000,Math.max(mean*1.8,percentile(durations,.9)*1.4)*waves);
  return {...sampled,kind:'estimate',rangeMs:[Math.round(lower),Math.round(upper)]};
}

// Coarse bounds avoid a second-by-second countdown that implies false precision.
export function etaDisplayRange(rangeMs){
  if(!Array.isArray(rangeMs)||rangeMs.length!==2||rangeMs.some(value=>!Number.isFinite(value)||value<0)||rangeMs[1]<rangeMs[0])return null;
  const [low,high]=rangeMs;
  const unit=high<90000?'seconds':high<5400000?'minutes':'hours',scale=unit==='seconds'?1000:unit==='minutes'?60000:3600000,step=unit==='seconds'?15:1;
  const min=Math.max(0,Math.floor(low/scale/step)*step),max=Math.max(min+step,Math.ceil(high/scale/step)*step);
  return {unit,min,max};
}
