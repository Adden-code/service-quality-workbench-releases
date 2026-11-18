import {saveReview,acceptAI,confirmReview,confirmUnrepliedReview,markPending,reopenReview,recordRawReviewTime} from './domain.mjs';
import {saveInlineEcommerce} from './ecommerce-inline-review.mjs';
import {saveClassificationReview} from './ecommerce-classification-review.mjs';
import {assertTaskWritable} from './task-lifecycle.mjs';
export function applyReviewCommand(state,input){
 const s=state.sessions.find(s=>s.id===input.sessionId);if(!s)throw new Error('会话不存在。');assertTaskWritable(state,s);
 const at=input.at;if(typeof at!=='string'||!Number.isFinite(Date.parse(at)))throw new Error('审核时间无效。');
 switch(input.action){
  case 'save':return saveReview(state,s.id,input.draft,at);
  case 'accept':return acceptAI(state,s.id,at);
  case 'confirm':return confirmReview(state,s.id,at);
  case 'accept-confirm':return confirmReview(acceptAI(state,s.id,at),s.id,at);
  case 'unreplied':return confirmUnrepliedReview(state,s.id,s.review.reviewer,at);
  case 'classification':return saveClassificationReview(state,s.id,input.packet,at);
  case 'pending':return markPending(state,s.id,input.notes,at);
  case 'reopen':return reopenReview(state,s.id,at);
  case 'time':return recordRawReviewTime(state,{...input.packet,sessionId:s.id,now:at});
  case 'ecommerce':return saveInlineEcommerce(state,s.id,input.edits||{},at,{confirm:input.confirm===true,classification:input.classification});
  default:throw new Error('不支持的审核操作。');
 }
}
