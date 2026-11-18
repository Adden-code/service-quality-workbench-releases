import {parseRawTranscriptFile,normalizeRawTimePolicy,RAW_INPUT_MODE} from './raw-transcript.mjs';
import {parseBusinessInput} from './business-input.mjs';
import {html as h,t} from './i18n.mjs';
import {e} from './ui.mjs';
export async function parseConsultationFile(file,{scene='新品产品咨询',rawOptions,selectedSheet}={}){
 if(String(file?.name||'').toLowerCase().endsWith('.xlsx')){
  const raw=await parseRawTranscriptFile(file,{scene,timePolicy:rawOptions?.timePolicy,selectedSheet:selectedSheet??rawOptions?.selectedSheet});if(raw.supported)return raw;
 }
 return parseBusinessInput(file);
}
export function updateRawImportOptions(d,changes={}){
 if(d?.parsed?.inputMode!==RAW_INPUT_MODE)return false;
 const current=d.rawImportOptions||{timePolicy:d.parsed.sessions[0]?.rawTranscript.timePolicy,productDefault:'',outputLanguage:'zh'};
 const next={...current,...changes,timePolicy:normalizeRawTimePolicy(changes.timePolicy||current.timePolicy)};
 if(typeof next.productDefault!=='string'||next.productDefault.length>200||!['zh','en'].includes(next.outputLanguage))throw new Error('原文任务产品默认值或输出语言无效。');
 d.rawImportOptions=next;for(const s of d.parsed.sessions){s.rawTranscript.timePolicy=structuredClone(next.timePolicy);const productColumn=s.rawTranscript.columns.product,original=productColumn?s.rawTranscript.raw[productColumn-1]?.trim():'';s.product=original||next.productDefault;}
 return true;
}
export function rawImportFields(d){
 if(d?.parsed?.inputMode!==RAW_INPUT_MODE)return'';const options=d.rawImportOptions||{timePolicy:d.parsed.sessions[0]?.rawTranscript.timePolicy,productDefault:'',outputLanguage:'zh'},policy=options.timePolicy;
 return h`<section class="raw-import-declarations"><h3>原文直判</h3>${d.parsed.availableSheetNames?.length>1?h`<label class="field-label" for="raw-source-sheet">来源工作表（必选）</label><select class="field" id="raw-source-sheet" ${d.reinspectionOf?'disabled':''}><option value="">${t('请选择本次导入的工作表')}</option>${d.parsed.availableSheetNames.map(sheet=>h`<option value="${e(sheet)}" ${d.parsed.selectedSheet===sheet?'selected':''}>${e(sheet)}</option>`).join('')}</select>`:''}<p>按行读取原始全文与全部已选规则，不先清洗成轮次表。</p><div class="form-row"><div class="field-group"><label class="field-label" for="raw-time-mode">来源时间口径</label><select class="field" id="raw-time-mode" ${d.reinspectionOf?'disabled':''}><option value="unavailable" ${policy?.mode==='unavailable'?'selected':''}>无可靠时间戳，时间类规则无法判定</option><option value="explicit" ${policy?.mode==='explicit'?'selected':''}>原文有可核验时间，按来源解释</option></select></div><div class="field-group"><label class="field-label" for="raw-source-timezone">来源时区</label><input class="field" id="raw-source-timezone" value="${e(policy?.timezone||'+08:00')}" placeholder="+08:00" ${d.reinspectionOf?'disabled':''}></div><div class="field-group"><label class="field-label" for="raw-product-default">产品默认值（可选）</label><input class="field" id="raw-product-default" maxlength="200" value="${e(options.productDefault||'')}"></div></div><p class="hint">缺失时间保持未知；时区声明不会补造开始时间、角色或轮次。</p></section>`;
}
