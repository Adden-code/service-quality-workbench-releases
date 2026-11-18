import {previewPendingResolution,pendingResolutionBasis,resolvePendingReviews,reopenPendingReview,isProcessedUnknown} from './pending-resolution.mjs';
import {pendingResolutionDialog} from './pending-resolution-ui.mjs';
import {nextPendingSession} from './review-flow.mjs';

export function createPendingResolutionManager({getState,getUI,getDialog,openDialog,closeDialog,renderDialog,render,commit,selectSession,getRoot=()=>document.getElementById('overlay-root'),newId=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}={}){
 const owns=d=>['pending-resolution','pending-reopen'].includes(d?.type);
 function capture(d){const root=getRoot();d.actor=root.querySelector('#pending-resolution-actor')?.value??d.actor;d.reason=root.querySelector('#pending-resolution-reason')?.value??d.reason;if(d.type==='pending-resolution')d.selectedIds=[...root.querySelectorAll('[name="pending-resolution-row"]:checked')].map(el=>el.value);}
 function refresh(d){if(d.type==='pending-reopen'){const session=getState().sessions.find(row=>row.id===d.sessionId);if(!isProcessedUnknown(session)){d.blocked=true;throw new Error('请选择可重新打开的已处理待补充记录。');}d.basis=pendingResolutionBasis(getState(),session);d.blocked=false;}else{d.preview=previewPendingResolution(getState(),d);d.selectedIds=d.preview.filter(row=>row.eligible).slice(0,500).map(row=>row.id);}d.error='';}
 async function click(action,button={dataset:{}}){
  const ui=getUI(),d=getDialog();
  if(action==='pending-resolve-one'||action==='pending-resolve-task'){
   const session=getState().sessions.find(row=>row.id===(button.dataset.id||ui.selectedId));
   const owner={type:'pending-resolution',...(action==='pending-resolve-task'?{taskId:button.dataset.id||ui.reviewTaskId}:{sessionId:session?.id,taskId:session?.taskId}),actor:session?.review?.reviewer||'',reason:''};
   if(!owner.taskId)throw new Error('请先选择一个业务任务。');refresh(owner);openDialog(owner);return true;
  }
  if(action==='pending-reopen'){
   const session=getState().sessions.find(row=>row.id===(button.dataset.id||ui.selectedId));if(!isProcessedUnknown(session))throw new Error('请选择可重新打开的已处理待补充记录。');
   openDialog({type:'pending-reopen',taskId:session.taskId,sessionId:session.id,basis:pendingResolutionBasis(getState(),session),actor:'',reason:''});return true;
  }
  if(!owns(d))return false;
  if(action==='pending-resolution-refresh'){capture(d);try{refresh(d);}catch(error){d.error=error.message;}renderDialog();return true;}
  if(action==='pending-resolution-save'){
   if(d.saving||d.blocked)return true;capture(d);d.saving=true;d.error='';renderDialog();
   try{
    const input={sessionIds:[...d.selectedIds||[]],preview:d.preview,sessionId:d.sessionId,actor:d.actor,reason:d.reason,operationId:newId(),now:now()};
    await commit(state=>{if(d.type==='pending-reopen'){const session=state.sessions.find(row=>row.id===d.sessionId);if(!session||pendingResolutionBasis(state,session)!==d.basis)throw new Error('预览后记录或依据已变化，请重新预览后再处理。');return reopenPendingReview(state,input);}return resolvePendingReviews(state,input);},undefined,{reviewSessionIds:d.type==='pending-reopen'?[d.sessionId]:input.sessionIds});
    closeDialog({force:true});
    if(d.type==='pending-reopen'){ui.showReviewRecords=true;ui.reviewStatus='待确认';selectSession(d.sessionId);}else{const next=nextPendingSession(getState(),ui);if(next)selectSession(next.id);else{ui.showReviewRecords=false;render();}}
   }catch(error){d.error=error.message;}finally{d.saving=false;if(getDialog()===d)renderDialog();}return true;
  }
  return false;
 }
 return{click,capture:()=>{const d=getDialog();if(owns(d))capture(d);},dialog:d=>owns(d)?pendingResolutionDialog(d):null};
}
