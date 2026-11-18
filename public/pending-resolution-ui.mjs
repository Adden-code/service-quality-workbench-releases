import {html as h,t,translateError} from './i18n.mjs';
import {e,icon,badge,dateTime} from './ui.mjs';
import {isProcessedUnknown,pendingResolutionEligibility} from './pending-resolution.mjs';

export function pendingResolutionControl(state,session){
 if(!session||session.review?.status!=='待补充'||isProcessedUnknown(session))return '';
 const info=pendingResolutionEligibility(state,session);
 return h`<div class="soft-note"><button class="btn small" data-act="pending-resolve-one" data-id="${e(session.id)}" ${info.eligible?'':'disabled'}>${t('标记已处理，仍无法判定')}</button>${info.eligible?h`<p class="tiny">处理原因单独留痕，质量结论保持无法判定。</p>`:h`<p class="tiny">${info.reasons.map(reason=>e(t(reason))).join(' ')}</p>`}</div>`;
}
export function pendingResolutionBatchControl(state,ui){
 const task=state.tasks.find(task=>task.id===ui.reviewTaskId);
 if(!task||task.mode!=='manual')return '';
 const count=state.sessions.filter(s=>s.taskId===task.id&&s.review?.status==='待补充'&&!isProcessedUnknown(s)).length;
 return count?h`<button class="text-btn" data-act="pending-resolve-task" data-id="${e(task.id)}">${t('批量处理待补充')} (${count})</button>`:'';
}
export function processedUnknownFooter(session,ui={}){
 const value=session.review.resolution;
 return h`<div class="results-footer"><div class="human-status"><strong>${t('审核工作状态')}</strong>${badge(t('已处理，结论仍无法判定'),'warning')}</div><p class="human-caption">${e(value.actor)} · ${dateTime(value.at)}</p><p>${e(value.reason)}</p><p class="tiny">质量结论未改变，不计为通过或人工确认；补齐依据后可重新打开。</p><div class="review-dock"><button class="btn" data-act="pending-reopen" data-id="${e(session.id)}">重新打开待补充</button><button class="btn primary" data-act="${ui.reviewScopeComplete?'show-completion':'next-session'}">${t(ui.reviewScopeComplete?'查看审核汇总':'继续待审核')}</button></div></div>`;
}
export function pendingResolutionDialog(d){
 const reopen=d.type==='pending-reopen',rows=d.preview||[],eligible=rows.filter(row=>row.eligible).length;
 return h`<div class="modal-backdrop" data-backdrop="true"><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><h2 id="dialog-title">${t(reopen?'重新打开待补充':'处理待补充预览')}</h2><button class="icon-btn" data-act="close-modal" aria-label="关闭弹窗">${icon('close',18)}</button></header><div class="modal-body"><p class="form-error" role="alert">${e(translateError(d.error||''))}</p><p class="soft-note warning">${t(reopen?'重新打开后回到待处理队列，原结论和处理历史保留。':'仅改变审核工作状态，无法判定仍单列；不计为通过，不进入最终质量分母。')}</p>${reopen?'':h`<p>${t('可处理 {0} 条；不满足条件 {1} 条。',{0:eligible,1:rows.length-eligible})}</p><div class="table-wrap"><table><thead><tr><th>选择</th><th>会话ID</th><th>处理范围</th></tr></thead><tbody>${rows.map(row=>h`<tr><td><input type="checkbox" name="pending-resolution-row" value="${e(row.id)}" aria-label="${e(row.label)}" ${row.eligible?'':'disabled'} ${d.selectedIds?.includes(row.id)?'checked':''}></td><td class="mono">${e(row.label)}</td><td>${row.eligible?t('保留无法判定，共 {0} 项',{0:row.unknownRuleIds.length}):row.reasons.map(reason=>e(t(reason))).join(' ')}</td></tr>`).join('')}</tbody></table></div>`}<label class="field-label" for="pending-resolution-actor">操作人标签（必填）</label><input class="field" id="pending-resolution-actor" maxlength="80" required value="${e(d.actor||'')}"><p class="hint">操作人标签用于本机留痕，不代表已验证登录身份。</p><label class="field-label" for="pending-resolution-reason">处理原因（必填）</label><textarea class="field" id="pending-resolution-reason" rows="3" maxlength="2000" required>${e(d.reason||'')}</textarea></div><footer class="modal-footer"><small>${t('每条会话独立记录操作人、时间和原因。')}</small><div><button class="btn" data-act="close-modal" ${d.saving?'disabled':''}>取消</button><button class="btn" data-act="pending-resolution-refresh" ${d.saving?'disabled':''}>重新预览</button><button class="btn primary" data-act="pending-resolution-save" ${d.saving||d.blocked||!reopen&&!eligible?'disabled':''}>${t(reopen?'重新打开待补充':'确认标记已处理')}</button></div></footer></section></div>`;
}
