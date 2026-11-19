export const validJobConcurrency=value=>Number.isSafeInteger(value)&&value>=2&&value<=4;

// One scheduler belongs to one job. A rate limit reduces only that job to a
// single request until the next explicit resume/retry; already running outputs
// are allowed to finish and checkpoint. No speculative provider cancellation.
export function createJobScheduler({concurrency=2,retryDelayMs=500,signal,canDispatch}){
 if(!validJobConcurrency(concurrency))throw new TypeError('Job concurrency must be an integer from 2 to 4.');
 let limit=concurrency,blockedUntil=0,failed=false,requests=0;const waiting=new Set();
 const wakeWaiting=()=>{for(const wake of waiting)wake();waiting.clear();};
 const waitForChange=milliseconds=>new Promise(resolve=>{
  let timer;const wake=()=>{clearTimeout(timer);signal?.removeEventListener('abort',wake);waiting.delete(wake);resolve();};
  waiting.add(wake);if(milliseconds!==undefined)timer=setTimeout(wake,milliseconds);
  signal?.addEventListener('abort',wake,{once:true});if(signal?.aborted)wake();
 });
 return{
  wake:wakeWaiting,
  rateLimited(error,attempt=1){
   limit=1;
   const retryAfter=Number(error?.retryAfterMs),backoff=Math.min(60000,Math.max(1000,retryDelayMs)*2**Math.max(0,attempt-1));
   blockedUntil=Math.max(blockedUntil,Date.now()+Math.min(60000,Math.max(backoff,Number.isFinite(retryAfter)?retryAfter:0)));
  },
  async ready(){
   while(!failed&&!signal?.aborted&&canDispatch()&&blockedUntil>Date.now()){
    await waitForChange(blockedUntil-Date.now());
   }
   return !failed&&!signal?.aborted&&canDispatch();
  },
  async request(operation,attempt=1){
   while(await this.ready()){
    if(requests<limit){
     requests++;
     try{return await operation();}
     catch(error){
      const code=String(error?.code||'').toLowerCase();
      if(code==='rate_limit')this.rateLimited(error,attempt);
      if(['authentication','permission','request_rejected','not_configured'].includes(code))failed=true;
      throw error;
     }finally{requests--;wakeWaiting();}
    }
    await waitForChange();
   }
   throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'});
  },
  async run(units,operation){
   const running=new Set();let cursor=0,problem;
   while(cursor<units.length||running.size){
    while(!problem&&canDispatch()&&cursor<units.length&&running.size<limit){
     if(!await this.ready())break;
     if(problem||running.size>=limit)break;
     const unit=units[cursor++];
     const work=Promise.resolve().then(()=>operation(unit)).catch(error=>{problem??=error;failed=true;wakeWaiting();}).finally(()=>running.delete(work));
     running.add(work);
    }
    if(running.size)await Promise.race(running);
    else break;
   }
   if(problem)throw problem;
  },
 };
}

// Trace node allocation mutates the part counter and node list; keep only that
// metadata operation serial, while traced provider operations remain parallel.
export function serialOperations(){let tail=Promise.resolve();return operation=>{const next=tail.then(operation);tail=next.catch(()=>{});return next;};}

export function interleaveReportUnits(units){
 const translations=units.filter(unit=>unit.kind==='translation'),analysis=units.filter(unit=>unit.kind!=='translation'),ordered=[];
 for(let i=0;i<Math.max(translations.length,analysis.length);i++){if(translations[i])ordered.push(translations[i]);if(analysis[i])ordered.push(analysis[i]);}
 return ordered;
}
