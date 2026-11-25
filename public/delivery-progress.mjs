const n=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const native=model=>Boolean(model.result?.snapshot?.executionSnapshot?.languageExecution||model.job?.nativeLanguage);
const terminal=status=>['completed','completed_with_warnings'].includes(status);
export function deliveryUnitProgress(units=[]){
 const counts={total:units.length,done:0,skipped:0,failed:0,pending:0,running:0};
 for(const unit of units){if(unit.status==='completed'){counts.done++;if(unit.notApplicable===true)counts.skipped++;}else if(['skipped','not_applicable'].includes(unit.status)){counts.done++;counts.skipped++;}else if(unit.status==='failed')counts.failed++;else if(unit.status==='running')counts.running++;else counts.pending++;}
 return finish(counts);
}
function finish(counts){const settled=counts.done+counts.failed;return{...counts,settled,percent:counts.total?Math.min(100,Math.round(settled/counts.total*100)):100};}
export function deliveryJobProgress(job){
 // Some history/summary callers include only a preview of the node list.
 if(Array.isArray(job?.nodes)&&(!job.progress||job.nodes.length===Number(job.progress.total)))return deliveryUnitProgress(job.nodes);
 const p=job?.progress||{},done=n(p.done),failed=n(p.failed),running=n(p.running),total=Math.max(n(p.total),done+failed+running+n(p.pending));
 return finish({total,done,skipped:Math.min(done,n(p.skipped)),failed,pending:Math.max(n(p.pending),total-done-failed-running),running});
}
export function deliveryJobStatus(job){
 if(!job)return'pending';const p=deliveryJobProgress(job);
 if(terminal(job.status)&&(p.pending||p.running))return'incomplete';
 if(job.status==='completed'&&p.failed)return'completed_with_warnings';
 return job.status;
}
export function combinedReportProgress(model,language){
 const base=deliveryJobProgress(model.job);if(language!=='en'||native(model))return base;
 const derived=model.translationJob?deliveryJobProgress(model.translationJob):{total:1,done:0,skipped:0,failed:0,pending:1,running:0};
 return finish(Object.fromEntries(['total','done','skipped','failed','pending','running'].map(key=>[key,n(base[key])+n(derived[key])])));
}
export function combinedReportStatus(model,language){
 const base=deliveryJobStatus(model.job);if(language!=='en'||native(model)||!terminal(base))return base;
 if(!model.translationJob)return model.translationError?'incomplete':'awaiting_translation';
 const derived=deliveryJobStatus(model.translationJob);
 if(!terminal(derived))return derived;
 return base==='completed_with_warnings'||derived==='completed_with_warnings'?'completed_with_warnings':'completed';
}
export function deliveryProgressCaption(p,english=false){
 const done=n(p.done),skipped=n(p.skipped),failed=n(p.failed),total=n(p.total),pending=n(p.pending),settled=done+failed,percent=total?Math.min(100,Math.round(settled/total*100)):100;
 return english?`Processed ${settled} / ${total} nodes · Successful ${done-skipped} · Not applicable ${skipped} · Failed ${failed} · Pending ${pending} · ${percent}%`:`已处理 ${settled} / ${total} 个节点 · 成功 ${done-skipped} · 不适用 ${skipped} · 失败 ${failed} · 等待 ${pending} · ${percent}%`;
}
