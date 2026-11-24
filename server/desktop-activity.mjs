export function activeDesktopJobCount({jobs=[],activeIds=[],pendingOperations=0}={}){
 return Math.max(pendingOperations,new Set([...activeIds,...jobs.filter(job=>['running','queued'].includes(job.status)).map(job=>job.id)]).size);
}
export function readDesktopActivity(services){
 const counts={ai:0,report:0,translation:0,structured:0};let unknown=false;
 for(const key of Object.keys(counts))try{const count=services?.[key]?.activityCount();if(!Number.isSafeInteger(count)||count<0)throw Error('Unavailable activity');counts[key]=count;}catch{unknown=true;}
 return{busy:unknown||Object.values(counts).some(count=>count>0),counts,unknown};
}
