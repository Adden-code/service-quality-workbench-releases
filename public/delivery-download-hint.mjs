import {e} from './ui.mjs';
export function deliveryDownloadHint(model,english=false){
 const job=model.job;
 const reason=model.downloading?['正在准备下载，请稍候。','Preparing download. Please wait.']:model.busy?['正在提交生成请求，请稍候。','Submitting generation request. Please wait.']:model.loading?['正在读取已保存交付物，请稍候。','Loading saved deliverables. Please wait.']:!job?['先生成业务交付物：请点击上方“生成业务交付物”。','First click Generate business deliverables above.']:job.resultAvailable===false?(job.status==='running'?['正在生成，首份结果保存后即可下载。','Generating. Download becomes available after the first result is saved.']:['尚无已保存交付物；请查看失败详情并重试缺失项，或重新生成。','No saved deliverables yet. Review failures and retry missing items, or generate again.']):null;
 return reason?`<p class="hint download-guidance" role="status">${e(reason[english?1:0])}</p>`:'';
}
