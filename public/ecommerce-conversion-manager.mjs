import {SYSTEM_EC_HEADERS,validateSystemMapping,systemReviewedMapping} from './ecommerce-system-source.mjs';
import {inspectEcommerceMappingSource,validateEcommerceMapping,createReviewedEcommerceMapping} from './ecommerce-conversion.mjs';
import {parseEcommerceFile} from './ecommerce-input.mjs';
import {EC_HEADERS} from './ecommerce-schema.mjs';
import {readXlsx,XLSX_ROW_NUMBER} from './io.mjs';
import {html as h,t,translateError} from './i18n.mjs';
import {e,icon,badge} from './ui.mjs';
const ready=config=>config?.configured===true&&config.connectionTested===true;
export function createEcommerceConversionManager({getDialog,renderDialog,getModelConfig,configureModel,prepareMapping}={}){
 const render=()=>renderDialog(),current=()=>getDialog();
 async function inspect(d,selectedSheet){
  const source=await inspectEcommerceMappingSource(d.file,{selectedSheet});
  d.conversion={source,dataStartRow:2,mappings:[],mappingReviewed:false,sampleReviewed:false,consent:false,preview:[]};
  if(source.sheet){const tables=await readXlsx(new Uint8Array(await d.file.arrayBuffer()),{maxColumns:16384});d.conversion.preview=(tables[source.sheet]||[]).filter(row=>row[XLSX_ROW_NUMBER]>=2).slice(0,4).map(row=>({sourceRow:row[XLSX_ROW_NUMBER],values:[...row]}));}
 }
 async function open(d){
  d.conversionMode=true;d.error='';d.loading=true;render();
  try{if(!d.conversion)await inspect(d,d.selectedSheet||undefined);}catch(error){d.error=translateError(error);}finally{d.loading=false;render();}
 }
 async function action(act){
  const d=current();if(!act?.startsWith('ec-conversion-')||d?.type!=='ecommerce-import')return false;
  const c=d.conversion;
  try{
   d.error='';
   if(act==='ec-conversion-back'){d.conversionMode=false;render();return true;}
   if(act==='ec-conversion-model'){await configureModel(d);return true;}
   if(d.loading)return true;
   if(act==='ec-conversion-run'){
    if(!c?.source?.headers)throw new Error('请先选择原文件工作表。');
    if(!ready(getModelConfig())||!c.consent)throw new Error('请先测试模型连接，并确认本次表头获准发送。');
    d.loading=true;render();
    const input=Object.fromEntries(['sourceName','fileSha256','sheet','sheetIndex','headers'].map(key=>[key,c.source[key]]));
    const result=await prepareMapping({...input,mappingVersion:2});c.mappings=validateSystemMapping(result.mappings,c.source.headers,{complete:false});c.aiMappings=structuredClone(c.mappings);c.history=c.history||[];c.mappingReviewed=false;c.sampleReviewed=false;
    c.modelId=result.modelId||'';c.promptVersion=result.promptVersion||'';
   }else if(act==='ec-conversion-apply'){
    const receipt=systemReviewedMapping(c.source,c.mappings,{reviewed:c.mappingReviewed,applied:c.sampleReviewed,dataStartRow:c.dataStartRow||2});
    const parsed=await parseEcommerceFile(d.file,{thresholdHours:d.thresholdHours||24,selectedSheet:c.source.sheet,reviewedMapping:receipt,batchSite:d.batchSite||''});
    if(!parsed.valid)throw new Error(parsed.errors.join('；'));
    d.reviewedMapping=receipt;d.parsed=parsed;d.selectedSheet=parsed.selectedSheet;d.availableSheetNames=parsed.availableSheetNames;d.previewConfirmed=true;d.conversionMode=false;
   }else return false;
  }catch(error){d.error=translateError(error);}finally{d.loading=false;render();}
  return true;
 }
 async function change(event){
  const d=current(),target=event.target;if(d?.type!=='ecommerce-import'||!d.conversionMode)return false;
  const c=d.conversion;
  if(target.id==='ec-conversion-sheet'){try{await inspect(d,target.value||undefined);}catch(error){d.error=translateError(error);}render();return true;}
  if(target.id==='ec-conversion-start-row'){c.dataStartRow=Number(target.value);c.sampleReviewed=false;}
  else if(target.id==='ec-conversion-consent')c.consent=target.checked;
  else if(target.id==='ec-conversion-mapping-confirm'){c.mappingReviewed=target.checked;c.mappingReviewedAt=target.checked?new Date().toISOString():null;}
  else if(target.id==='ec-conversion-preview-confirm'){c.sampleReviewed=target.checked;c.sampleReviewedAt=target.checked?new Date().toISOString():null;}
  else if(target.dataset.mappingTarget!==undefined){
   const targetIndex=Number(target.dataset.mappingTarget),column=Number(target.value);c.history=c.history||[];c.history.push({at:new Date().toISOString(),targetIndex,from:c.mappings.find(m=>m.targetIndex===targetIndex)?.sourceColumn||null,to:column||null,operator:d.reviewer});c.mappings=c.mappings.filter(m=>m.targetIndex!==targetIndex);
   if(column>0)c.mappings.push({targetIndex,sourceColumn:column,sourceHeader:c.source.headers[column-1]});
   c.mappingReviewed=false;c.sampleReviewed=false;
  }else return false;
  render();return true;
 }
 function dialog(d=current()){
  if(d?.type!=='ecommerce-import'||!d.conversionMode)return '';
  const c=d.conversion||{},source=c.source||{},config=getModelConfig()||{},locked=Boolean(d.loading),mappings=c.mappings||[];
  let complete=false;try{validateSystemMapping(mappings,source.headers,{complete:true});complete=true;}catch{}
  return h`<div class="modal-backdrop" data-backdrop="true"><section class="modal wide import-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><div><h2 id="dialog-title">AI解析转换</h2><p>电商原表：AI起草列对应，人工确认后重新预检。</p></div><button class="btn" data-act="import-save-close">保存草稿并关闭</button></header><div class="modal-body"><div class="form-error" id="ec-error" role="alert">${e(d.error||'')}</div><p>${e(d.fileName||d.file?.name||'')}</p>${source.availableSheetNames?.length>1?h`<label class="field-label" for="ec-conversion-sheet">来源工作表</label><select class="field" id="ec-conversion-sheet"><option value="">请选择工作表</option>${source.availableSheetNames.map(name=>h`<option value="${e(name)}" ${source.sheet===name?'selected':''}>${e(name)}</option>`).join('')}</select>`:''}<div class="soft-note"><p>仅将原表头发送到已测试接口；实际评论内容不发送。AI不会补造缺列或修改原文件。</p><button class="btn" data-act="ec-conversion-model" ${locked?'disabled':''}>配置并测试模型</button><label class="check-label"><input type="checkbox" id="ec-conversion-consent" ${c.consent?'checked':''} ${locked?'disabled':''}>我确认本次表头获准发送至当前接口</label><button class="btn primary" data-act="ec-conversion-run" ${locked||!ready(config)||!c.consent||!source.headers?'disabled':''}>AI起草字段对应</button></div>${source.headers?h`<section class="import-conversion-review"><h3>1 字段对应与解释</h3><div class="table-wrap"><table><thead><tr><th>工作台需要的信息</th><th>来源列</th></tr></thead><tbody>${SYSTEM_EC_HEADERS.map((label,index)=>{const selected=mappings.find(m=>m.targetIndex===index)?.sourceColumn||0;return h`<tr><td>${e(t(label))}</td><td><select class="field" data-mapping-target="${index}" ${locked?'disabled':''}><option value="0">未匹配</option>${source.headers.map((header,column)=>h`<option value="${column+1}" ${selected===column+1?'selected':''}>${column+1} · ${e(header)}</option>`).join('')}</select></td></tr>`;}).join('')}</tbody></table></div><label class="check-label"><input type="checkbox" id="ec-conversion-mapping-confirm" ${c.mappingReviewed?'checked':''} ${!complete||locked?'disabled':''}>已核对检查所需信息与文件原列的对应关系</label><h3>2 抽样数据预览</h3><label for="ec-conversion-start-row">第一条评论在哪一行？</label><select id="ec-conversion-start-row"><option value="2" ${c.dataStartRow!==3?'selected':''}>第2行（第1行为表头）</option><option value="3" ${c.dataStartRow===3?'selected':''}>第3行（旧文件第2行为说明）</option></select><div class="table-wrap"><table><thead><tr><th>原表行</th><th>评论内容</th><th>回复内容</th><th>评论时间</th><th>首次回复时间</th></tr></thead><tbody>${(c.preview||[]).filter(row=>row.sourceRow>=(c.dataStartRow||2)).map(row=>h`<tr><td>${row.sourceRow}</td>${[5,6,9,16].map(target=>h`<td>${e(row.values[(mappings.find(m=>m.targetIndex===target)?.sourceColumn||0)-1]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><label class="check-label"><input type="checkbox" id="ec-conversion-preview-confirm" ${c.sampleReviewed?'checked':''} ${!complete||locked?'disabled':''}>已核对抽样预览，确认原文及对应关系无误</label></section>`:''}</div><footer class="modal-footer"><small>所有源列与物理行保持不变；评论、回复、评分、管理员和两项时间的来源列不能缺失。</small><div><button class="btn" data-act="ec-conversion-back" ${locked?'disabled':''}>返回预检</button><button class="btn primary" data-act="ec-conversion-apply" ${locked||!complete||!c.mappingReviewed||!c.sampleReviewed?'disabled':''}>确认转换并重新预检</button></div></footer></section></div>`;
 }
 return {open,action,change,dialog};
}
