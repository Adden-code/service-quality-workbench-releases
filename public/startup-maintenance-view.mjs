import {getLocale,t} from './i18n.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list=items=>`<ul>${items.map(item=>`<li><code data-business-original>${escape(typeof item==='string'?item:item?.path??item?.relativePath??'')}</code></li>`).join('')}</ul>`;
const actionLabel=action=>t(/refus|preserv/.test(action)?'保留待检查文件':/fail|reject/.test(action)?'自动升级未完成':/prun|retention.*delet/.test(action)?'清理旧升级快照':/retain|backup-created|legacy-adopted/.test(action)?'保留升级快照':/clean|recover/.test(action)?'恢复临时写入':/success|succeeded|complete/.test(action)?'自动升级成功':'启动维护');

/** Source paths stay verbatim and are escaped; system labels always use i18n. */
export function startupMaintenanceNotice(upgrade){
 if(!upgrade)return '';
 const recovery=upgrade.recovery||{},retention=upgrade.retention||{};
 const cleaned=recovery.cleaned||[],refused=recovery.refused||[],pruned=retention.pruned||[],preserved=retention.preserved||[];
 const events=upgrade.maintenanceEvents||[];
 const needsAttention=upgrade.status==='failed'||refused.length>0||preserved.length>0||recovery.status==='failed'||Boolean(upgrade.warning||retention.warning);
 if(!['upgraded','failed'].includes(upgrade.status)&&!cleaned.length&&!refused.length&&!pruned.length&&!preserved.length&&!needsAttention)return '';
 const fallback=upgrade.status==='failed'?'内置口径升级未完成，现有工作区保留。请查看维护记录或从场景管理重试。':upgrade.status==='upgraded'?'内置口径已自动升级并备份；历史任务保持原口径。':needsAttention?'启动维护需要处理。请查看下方具体路径，并联系维护人；不要删除正式工作区文件。':'启动时已恢复未完成的临时写入；已保存的工作区数据保留。';
 const message=getLocale()==='en'?(upgrade.messageEn&&!/\p{Script=Han}/u.test(upgrade.messageEn)?upgrade.messageEn:t(fallback)):(upgrade.message||t(fallback));
 const details=cleaned.length||refused.length||pruned.length||preserved.length||events.length||recovery.auditPath||needsAttention;
 return `<div class="notice-banner ${needsAttention?'warning':''}" role="status" data-builtin-upgrade>${escape(message)}${upgrade.status==='failed'?` <button class="text-btn" data-act="scenario-manage">${escape(t('场景管理'))}</button>`:''}${details?`<details data-startup-maintenance><summary>${escape(t('启动维护与升级记录'))}</summary>${cleaned.length?`<p>${escape(t('已清理临时项'))}: ${cleaned.length}</p>${list(cleaned)}`:''}${recovery.quarantined?.length?`<p>${escape(t('恢复原件存放位置'))}</p>${list(recovery.quarantined.map(item=>item.quarantinePath))}`:''}${refused.length?`<p>${escape(t('需要维护人处理的路径'))}</p>${list(refused)}`:''}${pruned.length?`<p>${escape(t('已清理旧升级快照'))}: ${pruned.length}</p>${list(pruned)}`:''}${retention.retained?.length?`<p>${escape(t('保留的升级快照'))}: ${retention.retained.length}</p>${list(retention.retained)}`:''}${preserved.length||upgrade.warning||retention.warning?`${list(preserved)}<p>${escape(t('部分路径未自动清理；请联系维护人检查上方路径。'))}</p>`:''}${events.length?`<table><thead><tr><th>${escape(t('时间'))}</th><th>${escape(t('操作'))}</th><th>${escape(t('相关路径'))}</th></tr></thead><tbody>${events.map(event=>`<tr><td>${escape(event.at||event.time||'')}</td><td>${escape(actionLabel(event.action||event.event||''))}</td><td><code data-business-original>${escape(event.path||event.backupPath||'')}</code></td></tr>`).join('')}</tbody></table>`:''}${recovery.auditPath?`<p>${escape(t('维护审计文件'))}: <code data-business-original>${escape(recovery.auditPath)}</code></p>`:''}</details>`:''}</div>`;
}
