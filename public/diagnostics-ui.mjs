import {e,icon} from './ui.mjs';
import {getLocale} from './i18n.mjs';
const q=(zh,en)=>getLocale()==='en'?en:zh;
export function diagnosticDialog(d){
 if(d?.type!=='diagnostics')return '';
 return `<div class="modal-backdrop" data-backdrop="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><h2 id="dialog-title">${q('导出诊断包','Export diagnostics')}</h2><button class="icon-btn" data-act="close-modal" aria-label="${q('关闭','Close')}" ${d.busy?'disabled':''}>${icon('close',18)}</button></header><div class="modal-body"><p>${q('用于向开发人员反馈故障，运行中的任务可继续。','Share technical diagnostics with support while tasks continue running.')}</p><p>${q('包含版本、数量、队列状态、模型地址与名称、认证方式和启动事件。日志只保留已知事件，未知内容不收集。','Includes version, counts, queue states, model endpoint/name/authentication mode and known startup events. Unknown log content is omitted.')}</p><p class="soft-note">${q('不包含密钥、源文件、会话原文、任务名称、提示词、模型回答或引文。最大10MiB，不自动上传。','Excludes keys, source files, conversations, task names, prompts, model responses and quotations. Maximum 10 MiB; no automatic upload.')}</p><label class="check-label"><input type="checkbox" id="diagnostic-traces" ${d.includeTraces?'checked':''} ${d.busy?'disabled':''}>${q('附带运行轨迹摘要（节点状态、耗时、错误码；无正文）','Include workflow summaries (node states, timings and error codes; no content)')}</label><p class="hint">${q('轨迹较多时只收集最近的有限记录，包内coverage.json说明截断范围。','For large histories, only recent bounded records are included; coverage.json describes omissions.')}</p>${d.error?`<p class="form-error" role="alert">${e(d.error)}</p>`:''}${d.result?`<div role="status"><p>${q('诊断包已保存，可复制以下位置发送文件：','Diagnostics saved. Send the file from this location:')}</p><input class="field" id="diagnostic-path" readonly value="${e(d.result.path)}"><p>${e(d.result.name)} · ${(d.result.bytes/1024).toFixed(1)} KiB</p>${d.result.skipped?`<p>${q(`有 ${d.result.skipped} 个轨迹文件未纳入，详见包内说明。`,`${d.result.skipped} trace files omitted; see the coverage report.`)}</p>`:''}</div>`:''}</div><footer class="modal-footer"><span>${d.busy?q('正在生成，请稍候…','Generating…'):q('仅收集技术诊断信息','Technical metadata only')}</span><button class="btn primary" data-act="diagnostic-export" ${d.busy?'disabled':''}>${q('生成并下载诊断包','Create and download ZIP')}</button></footer></section></div>`;
}
export function createDiagnosticManager(ctx){
 let busy=false;const render=d=>{if(ctx.getDialog()===d)ctx.renderDialog();};
 return {dialog:diagnosticDialog,get busy(){return busy;},change(event){const d=ctx.getDialog();if(d?.type==='diagnostics'&&event.target.id==='diagnostic-traces'){if(!busy)d.includeTraces=event.target.checked;return true;}return false;},async action(action){
  if(action==='diagnostic-open'){if(!busy)ctx.openDialog({type:'diagnostics',includeTraces:false});return true;}
  if(action!=='diagnostic-export')return false;const d=ctx.getDialog();if(d?.type!=='diagnostics'||busy)return true;busy=true;d.busy=true;d.error='';render(d);
  try{
   const response=await (ctx.fetchImpl||fetch)('/api/diagnostics/export',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Workspace-Token':ctx.getToken()},body:JSON.stringify({includeTraces:!!d.includeTraces})});
   if(!response.ok){let v={};try{v=await response.json();}catch{}throw new Error(v.error||q('诊断包生成失败，请重新加载后重试。','Diagnostics failed; reload and retry.'));}
   if(response.headers.get('Content-Type')!=='application/zip')throw new Error(q('返回的文件类型不正确。','Unexpected file type.'));
   const blob=await response.blob(),name=response.headers.get('Content-Disposition')?.match(/filename="(diagnostics-[A-Za-z0-9._-]+\.zip)"/)?.[1];
   if(!name||!blob.size||blob.size>10*1024*1024)throw new Error(q('诊断文件为空或超出10MiB。','The diagnostic file is empty or exceeds 10 MiB.'));
   const savedPath=decodeURIComponent(response.headers.get('X-Diagnostic-Path')||'');d.result={name,path:savedPath||q('浏览器下载目录','Browser downloads folder'),bytes:blob.size,skipped:Number(response.headers.get('X-Diagnostic-Traces-Skipped')||0)};
   await ctx.download(blob,name,'application/zip');
  }catch(error){d.error=error.message;}finally{busy=false;d.busy=false;render(d);}return true;
 }};
}
