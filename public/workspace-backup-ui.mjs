import {getLocale,translateError,formatDateTime} from './i18n.mjs';
import {e,icon} from './ui.mjs';

export const WORKSPACE_BACKUP_MAX_BYTES=512*1024*1024;
export const workspaceBackupText=(zh,en,language=getLocale())=>language==='en'?en:zh;
const words=language=>(zh,en)=>workspaceBackupText(zh,en,language);
const number=value=>Number.isSafeInteger(value)&&value>=0;
const size=value=>number(value)?value>=1024**2?`${(value/1024**2).toFixed(1)} MiB`:value>=1024?`${(value/1024).toFixed(1)} KiB`:`${value} B`:'—';
const button=(action,label,{disabled=false,primary=false}={})=>`<button class="btn ${primary?'primary':''}" data-act="${action}" ${disabled?'disabled':''}>${e(label)}</button>`;
const statsValid=value=>value&&['taskCount','sessionCount','ruleCount'].every(key=>number(value[key]));

export function workspaceBackupGuard(status={},language=getLocale()){
  const q=words(language);
  if(status.saving)return q('正在保存，请等待完成后再备份或恢复。','A save is in progress. Wait until it completes before backing up or restoring.');
  if(status.hasPending)return q('上次保存结果未确认，请先重试保存；当前编辑内容仍保留。','The last save is unconfirmed. Retry that save first; current edits are retained.');
  if(status.conflicted)return q('工作区版本冲突，请先保留编辑内容并处理冲突，再备份或恢复。','Resolve the workspace revision conflict after preserving your edits, then back up or restore.');
  if(status.readOnly)return q('工作区尚未正常加载或处于只读状态，请先恢复连接并重新加载。','The workspace is unavailable or read-only. Restore the connection and reload it first.');
  if(status.editing||status.suspendedDraft||status.composing)return q('请先完成或保存并关闭当前编辑与导入草稿，再打开备份或恢复。当前输入不会被覆盖。','Finish or save and close the current editor and import draft first. Your current input will not be replaced.');
  if(status.timerPending)return q('审核耗时记录尚未保存，请等待保存完成后重试。','Review-time records have not been saved yet. Wait for the save and retry.');
  return '';
}

export function validateWorkspaceBackupFile(file,language=getLocale()){
  const q=words(language);
  if(!file||typeof file.name!=='string')return q('请选择一个 .sqwb 完整备份文件。','Choose a .sqwb full-backup file.');
  if(!/\.sqwb$/i.test(file.name))return q('请选择 .sqwb 专用备份档案；不能直接恢复 ZIP、Excel 或工作区 JSON。','Choose a .sqwb backup archive. ZIP, Excel and workspace JSON files cannot be restored directly.');
  if(!number(file.size)||file.size===0)return q('备份文件为空或无法读取，请重新选择。','The backup file is empty or unreadable. Choose it again.');
  if(file.size>WORKSPACE_BACKUP_MAX_BYTES)return q('备份文件超过 512 MiB 上限。','The backup file exceeds the 512 MiB limit.');
  return '';
}

const errorMessages=(code,q)=>({
  BUSY:q('工作区正在执行任务。请先暂停质检、翻译或报告任务，并等待当前请求结束后重试。','The workspace is busy. Pause inspection, translation or report jobs and wait for current requests to finish before retrying.'),
  PREVIEW_EXPIRED:q('恢复预览已过期。请重新预览此文件，并再次核对后确认。','The restore preview has expired. Preview the file again and confirm the new comparison.'),
  REVISION_CONFLICT:q('预览后工作区已变化。请重新预览，核对最新数量后再恢复。','The workspace changed after preview. Preview again and check the latest counts before restoring.'),
  INVALID_BACKUP:q('备份文件未通过完整性或格式校验，尚未恢复。请选择有效的 .sqwb 档案。','The backup failed integrity or format validation and has not been restored. Choose a valid .sqwb archive.'),
  BACKUP_TOO_LARGE:q('备份档案超过 512 MiB 上限，无法继续。','The backup archive exceeds the 512 MiB limit.'),
  RESTORE_FAILED:q('恢复失败。请核对下方服务端说明；不要重复点击恢复，重新预览前先确认工作区状态。','Restore failed. Check the service details below. Do not repeat the restore; verify workspace state before creating another preview.'),
  WORKSPACE_MAINTENANCE:q('工作区正在维护或需要人工检查，已停止继续操作。请保留服务端提示中的路径并重新加载核对。','The workspace is under maintenance or needs inspection. Further changes are blocked. Retain the paths in the service details and reload to check its state.'),
}[code]||'');

export function workspaceBackupError(error,language=getLocale()){
  const q=words(language),known=errorMessages(error?.code,q);
  if(known)return known;
  if(error?.status===403)return q('工作区令牌已失效，请重新加载页面后再操作。','The workspace token is no longer valid. Reload the page before continuing.');
  if(error?.status===413)return errorMessages('BACKUP_TOO_LARGE',q);
  if(error?.status)return q(`本地服务请求失败（${error.status}），未确认操作成功。`,`The local service returned HTTP ${error.status}; success has not been confirmed.`);
  return error?.localMessage||q('未收到本地服务的有效答复，未确认操作成功。请检查服务连接。','No valid response was received from the local service. Success is not confirmed; check the connection.');
}

function counts(info,q){return `<dl class="detail-grid"><dt>${q('任务','Tasks')}</dt><dd>${info.taskCount}</dd><dt>${q('会话','Conversations')}</dt><dd>${info.sessionCount}</dd><dt>${q('规则记录','Rule records')}</dt><dd>${info.ruleCount}</dd></dl>`;}
export function workspaceBackupDialog(d,{language=getLocale(),status={},now=Date.now()}={}){
  if(d?.type!=='workspace-backup')return '';
  const q=words(language),guard=workspaceBackupGuard(status,language),busy=Boolean(d.busy),preview=d.preview,expired=preview&&Date.parse(preview.expiresAt)<=now,blocked=Boolean(guard||busy||d.reloadRequired),restored=d.result?.restored===true;
  const tabs=`<div class="catalog-detail-actions" role="group" aria-label="${q('工作区工具','Workspace tools')}">${button('workspace-usage',q('用量','Storage'),{disabled:busy||d.reloadRequired})}${button('workspace-backup-tab-export',q('完整备份','Full backup'),{disabled:busy||d.reloadRequired,primary:d.tab==='export'})}${button('workspace-backup-tab-restore',q('恢复备份','Restore backup'),{disabled:busy||d.reloadRequired,primary:d.tab==='restore'})}</div>`;
  let body='';
  if(d.reloadRequired){
    body=restored?`<div role="status"><h3>${q('工作区已恢复','Workspace restored')}</h3><p>${q('请重新加载页面，获取恢复后的数据与新的工作区令牌。当前页面暂不继续编辑。','Reload the page to load the restored data and a fresh workspace token. Editing is paused on this page.')}</p>${counts(d.result.restoredCounts,q)}<label class="field-label" for="workspace-backup-retained">${q('恢复前的完整备份路径（可选择复制）','Prior full-backup path (select to copy)')}</label><input class="field mono" id="workspace-backup-retained" readonly value="${e(d.result.retainedPath)}"><p>${q('如需回退，重新加载后在“恢复备份”中选择这个 .sqwb 文件。','To roll back, reload and select this .sqwb file under Restore backup.')}</p></div>`:`<div role="alert"><h3>${q('恢复结果尚未确认','Restore outcome not confirmed')}</h3><p>${q('请求可能已在服务端执行。请重新加载页面并核对任务与规则，勿重复提交本次恢复。','The server may have processed the request. Reload and inspect tasks and rules; do not submit the same restore again.')}</p></div>`;
  }else if(d.tab==='restore'){
    body=`<p>${q('恢复会用备份中的数据替换当前工作区，不会合并。先预览核对，确认后才执行替换。','Restore replaces the current workspace with the backup; it does not merge records. Preview and check the comparison before confirming.')}</p><div class="field-group"><label class="field-label" for="workspace-backup-file">${q('完整备份文件（.sqwb，最大 512 MiB）','Full backup file (.sqwb, up to 512 MiB)')}</label><input class="field" id="workspace-backup-file" type="file" accept=".sqwb" ${blocked?'disabled':''}></div><p class="hint">${q('档案最大 512 MiB；其中单个文件最大 64 MiB，最多 20000 个文件。','Archive limit: 512 MiB, with up to 20,000 files and a 64 MiB limit per file.')}</p>${d.file?`<p>${q('已选择','Selected')}: <strong>${e(d.file.name)}</strong> · ${size(d.file.size)}</p>`:''}`;
    if(preview){
      body+=`<h3>${q('恢复预览','Restore preview')}</h3><div class="form-row"><section><h4>${q('当前工作区','Current workspace')}</h4>${counts(preview.current,q)}</section><section><h4>${q('备份中的工作区','Workspace in backup')}</h4>${counts(preview.backup,q)}</section></div><dl class="detail-grid"><dt>${q('备份创建时间（UTC+08:00）','Backup created (UTC+08:00)')}</dt><dd>${e(formatDateTime(preview.backup.createdAt))}</dd><dt>${q('备份程序版本','Backup app version')}</dt><dd>${e(preview.backup.appVersion)}</dd><dt>${q('文件数 / 数据量','Files / data size')}</dt><dd>${preview.backup.fileCount} / ${size(preview.backup.totalBytes)}</dd><dt>${q('预览有效期至（UTC+08:00）','Preview expires (UTC+08:00)')}</dt><dd>${e(formatDateTime(preview.expiresAt))}</dd></dl>${preview.warnings.length?`<ul class="soft-note warning">${preview.warnings.map(warning=>`<li>${e(warning)}</li>`).join('')}</ul>`:''}${expired?`<p class="form-error" role="alert">${errorMessages('PREVIEW_EXPIRED',q)}</p>`:''}<p class="soft-note warning">${q('确认后，当前规则、任务、结果、原文件与历史文件将被备份内容替换。系统会先保留旧工作区供回退；本机模型设置与密钥保持原样。','Confirmation replaces current rules, tasks, results, originals and historical files with the backup. The prior workspace is retained for rollback. Local model settings and keys stay unchanged.')}</p><div class="check-label"><input id="workspace-backup-confirm" type="checkbox" ${d.confirmed?'checked':''} ${blocked||expired?'disabled':''}><label for="workspace-backup-confirm">${q('我已核对以上数量，确认替换当前工作区，而不是合并数据。','I checked the counts and confirm replacement of this workspace, not a merge.')}</label></div>`;
    }
  }else{
    body=`<p>${q('下载一个包含工作资料的 .sqwb 完整备份档案，建议保存到另一个磁盘或公司允许的备份位置。','Download one .sqwb archive containing your workspace files. Save it to another drive or an approved backup location.')}</p><ul><li>${q('包含：规则、任务、结果、原文件、报告、导入草稿、运行轨迹及缓存。','Includes rules, tasks, results, original files, reports, import drafts, execution traces and caches.')}</li><li>${q('不包含：本机模型设置与密钥、启动器控制信息及启动日志。恢复时本机配置保持原样。','Excludes local model settings and keys, launcher control information and startup logs. Local configuration stays unchanged during restore.')}</li><li>${q('专用未压缩档案，最大 512 MiB；单个文件最大 64 MiB，最多 20000 个文件。下载完成后由你保存；程序不会自动上传到外网。','Dedicated uncompressed archive: up to 512 MiB, 20,000 files and 64 MiB per file. You choose where to save the download; the application does not upload it externally.')}</li></ul>`;
    if(d.downloaded)body+=`<p class="soft-note" role="status">${q('备份文件已生成并交给浏览器下载，请在下载列表确认保存完成：','The archive was generated and handed to the browser. Check its downloads list to confirm it was saved:')} ${e(d.downloaded.name)} · ${size(d.downloaded.bytes)}</p>`;
  }
  const error=d.error?`<p class="form-error" id="workspace-backup-error" role="alert">${e(d.error)}</p>`:'',details=d.errorDetail?`<details><summary>${q('服务端说明','Service details')}</summary><p style="overflow-wrap:anywhere">${e(d.errorDetail)}</p></details>`:'';
  const waiting=busy?`<p role="status" aria-live="polite">${d.busy==='export'?q('正在生成并读取备份文件，请保持页面打开…','Generating and reading the backup. Keep this page open…'):d.busy==='preview'?q('正在上传并校验备份，尚未替换工作区…','Uploading and validating the backup. The workspace has not been replaced…'):q('正在保留旧工作区并恢复备份，请勿关闭页面…','Retaining the prior workspace and restoring the backup. Do not close this page…')}</p>`:'';
  const controls=d.reloadRequired?button('workspace-backup-reload',restored?q('重新加载已恢复的工作区','Reload restored workspace'):q('重新加载并核对工作区','Reload and check workspace'),{primary:true}):d.tab==='restore'?button('workspace-backup-preview',preview?q('重新预览','Preview again'):q('预览备份','Preview backup'),{disabled:blocked||!d.file})+button('workspace-backup-restore',q('确认替换并恢复','Confirm replacement and restore'),{primary:true,disabled:blocked||!preview||expired||!d.confirmed}):button('workspace-backup-export',q('生成并下载完整备份','Create and download full backup'),{primary:true,disabled:blocked});
  return `<div class="modal-backdrop" data-backdrop="true"><section class="modal wide" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-busy="${busy}" tabindex="-1"><header class="modal-head"><div><h2 id="dialog-title">${q('工作区备份与恢复','Workspace backup and restore')}</h2><p>${q('原文件与审核历史一起保护','Protect original files and review history together')}</p></div><button class="icon-btn" data-act="close-modal" aria-label="${q('关闭弹窗','Close dialog')}" ${busy||d.reloadRequired?'disabled':''}>${icon('close',18)}</button></header><div class="modal-body">${tabs}${error}${details}${guard&&!d.reloadRequired?`<p class="soft-note warning" role="status">${e(guard)}</p>`:''}${body}${waiting}${!d.reloadRequired?`<p class="hint">${q('备份和恢复需要工作区暂停写入。如提示忙碌，请暂停运行任务，并等待当前请求结束后重试。','Backup and restore require a quiet workspace. If it is busy, pause running jobs and wait for current requests to finish before retrying.')}</p>`:''}</div><footer class="modal-footer"><small>${q('恢复是替换；旧工作区保留供回退','Restore replaces data; the prior workspace is retained for rollback')}</small><div>${!d.reloadRequired?button('close-modal',q('关闭','Close'),{disabled:busy}):''}${controls}</div></footer></section></div>`;
}

function localError(message){return Object.assign(new Error(message),{localMessage:message});}
function backupFilename(header,now){
  const fallback=`workspace-${new Date(now).toISOString().replace(/[-:.]/g,'')}.sqwb`;
  let name='';try{const encoded=header?.match(/filename\*=UTF-8''([^;]+)/i),plain=header?.match(/filename="([^"]+)"|filename=([^;]+)/i);name=encoded?decodeURIComponent(encoded[1]):plain?(plain[1]||plain[2]).trim():'';}catch{}
  return /^workspace-[A-Za-z0-9._-]+\.sqwb$/i.test(name)?name:fallback;
}

/** Dedicated binary API; workspace-client's JSON transport is deliberately not reused. */
export function createWorkspaceBackupManager(ctx){
  const fetchImpl=ctx.fetchImpl||globalThis.fetch,now=ctx.now||Date.now,current=()=>ctx.getDialog(),status=()=>ctx.getStatus?.()||{};
  let busy=false,reloadRequired=false;
  const render=owner=>{if(current()===owner)ctx.renderDialog();};
  const guard=()=>{const message=workspaceBackupGuard(status());if(message)throw localError(message);if(reloadRequired)throw localError(workspaceBackupText('请先重新加载工作区。','Reload the workspace first.'));};
  async function request(path,{body,contentType}){
    const token=ctx.getToken();if(!token)throw localError(workspaceBackupText('工作区尚未加载，请重新加载页面。','The workspace is not loaded. Reload the page.'));
    const response=await fetchImpl(`/api/workspace-backup/${path}`,{method:'POST',headers:{'Content-Type':contentType,'X-Workspace-Token':token},credentials:'same-origin',body});
    if(!response.ok){let detail={};try{detail=await response.json();}catch{}throw Object.assign(new Error(detail.error||''),{status:response.status,code:detail.code||'',serviceDetail:detail.error||''});}
    return response;
  }
  function requireReload(owner,result){reloadRequired=true;owner.reloadRequired=true;owner.result=result||null;try{ctx.onReloadRequired?.({confirmed:Boolean(result),result});}catch{}}
  async function operate(owner,kind,operation){
    if(busy||reloadRequired)return;guard();busy=true;owner.busy=kind;owner.error='';owner.errorDetail='';render(owner);
    try{await operation();}
    catch(error){
      owner.error=workspaceBackupError(error);owner.errorDetail=error.serviceDetail?translateError(error.serviceDetail):'';
      if(kind==='restore'){
        owner.confirmed=false;owner.preview=null;
        if(!error.status||error.status===403||error.status>=500||['RESTORE_FAILED','WORKSPACE_MAINTENANCE'].includes(error.code))requireReload(owner);
      }
    }finally{busy=false;owner.busy='';render(owner);}
  }
  async function action(act){
    if(act==='workspace-backup-open'||act==='workspace-backup-tab-export'||act==='workspace-backup-tab-restore'){
      if(busy||reloadRequired)return true;guard();const existing=current(),tab=act==='workspace-backup-tab-restore'?'restore':'export';
      if(existing?.type==='workspace-backup'){existing.tab=tab;existing.error='';existing.errorDetail='';render(existing);}else ctx.openDialog({type:'workspace-backup',tab,error:'',file:null,preview:null,confirmed:false});return true;
    }
    if(!['workspace-backup-export','workspace-backup-preview','workspace-backup-restore','workspace-backup-reload'].includes(act))return false;
    const owner=current();if(owner?.type!=='workspace-backup')return true;
    if(act==='workspace-backup-reload'){if(owner.reloadRequired&&!busy)ctx.reload();return true;}
    if(busy||reloadRequired)return true;
    if(act==='workspace-backup-export')await operate(owner,'export',async()=>{
      owner.downloaded=null;const response=await request('export',{body:'{}',contentType:'application/json'});
      if(!/^application\/octet-stream(?:;|$)/i.test(response.headers.get('Content-Type')||''))throw localError(workspaceBackupText('服务端没有返回有效的备份文件，未开始下载。','The service did not return a valid backup file; no download was started.'));
      const blob=await response.blob();if(!blob.size||blob.size>WORKSPACE_BACKUP_MAX_BYTES)throw localError(workspaceBackupText('返回的备份为空或超过 512 MiB，未开始下载。','The returned backup is empty or exceeds 512 MiB; no download was started.'));
      const length=response.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==blob.size))throw localError(workspaceBackupText('备份下载长度不完整，请重试。','The backup download is incomplete. Retry the export.'));
      const name=backupFilename(response.headers.get('Content-Disposition'),now());await ctx.download(blob,name,'application/octet-stream');owner.downloaded={name,bytes:blob.size};
    });
    if(act==='workspace-backup-preview')await operate(owner,'preview',async()=>{
      const issue=validateWorkspaceBackupFile(owner.file);if(issue)throw localError(issue);owner.preview=null;owner.confirmed=false;
      const response=await request('preview',{body:owner.file,contentType:'application/octet-stream'}),value=await response.json();
      if(!value||typeof value.previewId!=='string'||!value.previewId||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=now()||!number(value.baseRevision)||!statsValid(value.backup)||!statsValid(value.current)||!number(value.backup.fileCount)||!number(value.backup.totalBytes)||typeof value.backup.appVersion!=='string'||typeof value.backup.createdAt!=='string'||!Array.isArray(value.warnings)||value.warnings.some(warning=>typeof warning!=='string'))throw localError(workspaceBackupText('服务端预览格式无效，不能恢复；请检查程序版本后重试。','The preview response is invalid. Restore is blocked; check the application version and retry.'));
      owner.preview=value;
    });
    if(act==='workspace-backup-restore'){
      guard();
      if(!owner.preview||!owner.confirmed){owner.error=workspaceBackupText('请先预览备份、核对数量并勾选替换确认。','Preview the backup, check the counts and confirm replacement first.');render(owner);return true;}
      if(Date.parse(owner.preview.expiresAt)<=now()){owner.error=errorMessages('PREVIEW_EXPIRED',words());owner.preview=null;owner.confirmed=false;render(owner);return true;}
      if(number(status().revision)&&status().revision!==owner.preview.baseRevision){owner.error=errorMessages('REVISION_CONFLICT',words());owner.preview=null;owner.confirmed=false;render(owner);return true;}
      await operate(owner,'restore',async()=>{
        const response=await request('restore',{body:JSON.stringify({previewId:owner.preview.previewId,baseRevision:owner.preview.baseRevision}),contentType:'application/json'}),value=await response.json();
        if(!value||value.restored!==true||typeof value.retainedPath!=='string'||!value.retainedPath||!statsValid(value.summary))throw localError(workspaceBackupText('服务端返回的恢复结果无法确认。','The service response does not confirm the restore outcome.'));
        requireReload(owner,{restored:true,retainedPath:value.retainedPath,restoredCounts:value.summary});
      });
    }
    return true;
  }
  function change(event){
    const owner=current(),target=event.target;if(owner?.type!=='workspace-backup'||!['workspace-backup-file','workspace-backup-confirm'].includes(target.id))return false;
    if(busy||reloadRequired)return true;
    if(target.id==='workspace-backup-confirm'){owner.confirmed=Boolean(target.checked);render(owner);return true;}
    owner.preview=null;owner.confirmed=false;owner.downloaded=null;owner.file=target.files?.[0]||null;owner.errorDetail='';owner.error=owner.file?validateWorkspaceBackupFile(owner.file):'';if(owner.error)owner.file=null;render(owner);return true;
  }
  return{action,change,dialog:d=>workspaceBackupDialog(d,{status:status(),now:now()}),get isBusy(){return busy;},get blocksNavigation(){return busy||reloadRequired;},get blocksWorkspaceWrites(){return busy||reloadRequired;},get requiresReload(){return reloadRequired;}};
}
