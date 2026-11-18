import {getReviewPresentation} from './ai-triage.mjs';
import {getLocale} from './i18n.mjs';
import {e} from './ui.mjs';
const L=(zh,en)=>getLocale()==='en'?en:zh;
export function reviewSessionLabel(session,task){
 const p=getReviewPresentation(session,task),count=p.pendingCount;
 if(p.human)return L('人工已确认','Human confirmed');
 if(p.processedUnknown)return L('已处理，结论仍无法判定','Processed, still undetermined');
 if(p.aiFinal)return L('AI终判免审','AI final · exempt');
 if(p.returned)return L(`已退回人工 · 待确认 ${count} 项`,`Returned · ${count} checks pending`);
 if(session.review?.status==='待补充')return L(`待补充 · 待确认 ${count} 项`,`Awaiting information · ${count} checks pending`);
 if(p.aiCount||p.draftCount)return L(`待人工确认 ${count} 项`,`${count} checks awaiting confirmation`);
 if(p.needsReview)return L(`需人工检查 ${count} 项`,`${count} checks require manual inspection`);
 return p.execution==='running'?L('AI执行中，等待可审结果','AI running · awaiting reviewable results'):L('尚无可审结果','No reviewable results yet');
}
export function reviewFilterControls(sessions,ui){
 const states=sessions.map(s=>getReviewPresentation(s));
 const filters=[['待确认','待确认','Awaiting confirmation',p=>p.needsReview],['AI初判待确认','AI初判待确认','AI initial · awaiting confirmation',p=>p.initialPending],['AI终判免审','AI终判免审','AI final · exempt',p=>p.aiFinal],['已确认','人工已确认','Human confirmed',p=>p.human],['已处理待补充','已处理待补充','Processed · undetermined',p=>p.processedUnknown],['全部','全部','All',()=>true]];
 return filters.map(([id,zh,en,predicate])=>`<button class="text-btn ${ui.reviewStatus===id?'active':''}" aria-pressed="${ui.reviewStatus===id}" data-act="review-status" data-value="${id}">${e(L(zh,en))} <span class="filter-count">${states.filter(predicate).length}</span></button>`).join('');
}
export function reviewWaitingView(sessions,ui){
 return `<section class="panel review-waiting"><h2>${L('暂无待确认的会话','No conversations awaiting confirmation')}</h2><p>${L('没有可审核的会话符合当前筛选。尚未执行的会话会在结果保存后进入待确认；已保存的结果可继续审核。','No reviewable conversations match this filter. New records enter the queue after results are saved; saved results remain reviewable.')}</p><div class="queue-filters">${reviewFilterControls(sessions,ui)}</div><button class="btn" data-act="view-review-records">${L('查看全部记录','View all records')}</button>${ui.reviewTaskId?`<button class="btn" data-act="task-detail" data-id="${e(ui.reviewTaskId)}">${L('查看任务与运行过程','View task and execution')}</button>`:''}</section>`;
}
