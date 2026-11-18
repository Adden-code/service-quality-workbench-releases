// Raw report evidence remains bound to a single immutable source cell. No role
// or message turn is inferred by these presentation helpers.
import {matchRawQuote,rawSavedQuoteMatches,rawTimeRuleIds} from './raw-evidence.mjs';
export const isRawReport=value=>value?.inputMode==='raw-transcript-v1'||value?.rawTranscript?.schemaVersion===1;
export const rawQuoteMatches=matchRawQuote;
export {rawSavedQuoteMatches};
export function groundedRawReportQuote(record,quote){return isRawReport(record)&&rawQuoteMatches(record.rawTranscript?.text??record.conversation??record.text,quote).length>0;}
export function rawEvidenceText(result){return(Array.isArray(result?.evidenceQuotes)?result.evidenceQuotes:[]).map(item=>item.quote).join('\n');}
export function rawReportNotices(snapshot,language='zh'){
 if(!isRawReport(snapshot))return[];
 const english=language==='en',unavailable=snapshot.records?.filter(row=>row.rawTranscript?.timePolicy?.mode!=='explicit').length??0,timeRules=rawTimeRuleIds(snapshot.basis).join(', '),affected=timeRules?(english?` Affected frozen rules: ${timeRules}.`:` 受影响的冻结规则：${timeRules}。`):'';
 return[
  english?'Raw row quotations are located in the archived original cell. Roles unverified: these are conversation concern leads, not confirmed customer VOC.':'逐字引文定位于归档原表单元格。角色未核验：这些是待核验发言方的会话诉求线索，不能作为已确认客户原声。',
  unavailable?(english?`Reliable source timestamps unavailable for ${unavailable} records; time-dependent rules are Unable to determine. Inspection and report dates do not replace conversation time.${affected}`:`${unavailable}条未提供可靠来源时间；依赖时间的规则为无法判定，不用质检或报告生成时间代替会话时间。${affected}`):(english?'Source time interpretation is frozen; missing message times remain unknown.':'来源时间解释已冻结；缺少的消息时间仍为未知。'),
  snapshot.reviewPolicy?.version===2?(english?'Rule-level exemptions use independent validation, not model self-confidence. Exact quotation matching does not prove a business judgment is correct.':'规则级免审依据独立验证，不使用模型自评分门槛。逐字引文命中不证明业务判定正确。'):english?`The saved self-confidence threshold ${snapshot.reviewPolicy?.confidenceThreshold??0.90} is uncalibrated and is not 90% golden-set accuracy. Exact quotation matches do not prove the business verdict is correct.`:`保存的模型自评置信度门槛${snapshot.reviewPolicy?.confidenceThreshold??'0.90'}未标定，不等于90%金标准对照正确率。逐字命中不证明业务判定正确。`,
  english?'Golden comparison: Not evaluated. Accuracy, FAIL recall and wrong AI-final PASS count require the separately matched local golden comparison; no accuracy or recall is inferred from pass rate.':'未进行金标准对照。正确率、FAIL召回率及AI错误免审数须以另行匹配的本地金标准对照为准，不从通过率推算正确率或召回率。',
  english?`Technical execution failures: ${snapshot.records?.filter(record=>record.executionStatus==='failed'||record.aiExecution?.status==='failed').length??0}. Program-generated Unable to determine placeholders are retained separately and are not AI successes.`:`技术执行失败${snapshot.records?.filter(record=>record.executionStatus==='failed'||record.aiExecution?.status==='failed').length??0}条。程序生成的无法判定占位及诊断独立保留，不计为AI执行成功。`
 ];
}
export function validateRawReportRecord(record,original,source){
 if(!isRawReport(record))throw new Error('原文报告缺少逐行来源合同。');
 const raw=record.rawTranscript,rows=original?.rows?.filter(row=>row.recordId===record.id),fail=()=>{throw new Error('原文报告来源、单元格或证据引文定位不一致。');};
 if(!raw||raw.schemaVersion!==1||raw.fileSha256!==source?.sha256||raw.sheet!==original?.sheetName||raw.headerRow!==original?.headerRow||!Array.isArray(raw.headers)||JSON.stringify(raw.headers)!==JSON.stringify(original.headers)||!Array.isArray(raw.raw)||raw.raw.length!==raw.headers.length||typeof raw.text!=='string'||raw.text!==record.conversation||raw.text!==raw.raw[raw.columns?.text-1]||!rows||rows.length!==1||rows[0].sourceRow!==raw.row||JSON.stringify(rows[0].values)!==JSON.stringify(raw.raw))fail();
 for(const phase of ['ai','confirmed','final'])for(const result of record[phase]||[]){
  if((result.evidence||[]).length)fail();
  for(const quote of result.evidenceQuotes||[]){const matches=rawSavedQuoteMatches(raw.text,quote?.quote,result.rawValidation);if(!matches.length||JSON.stringify(matches)!==JSON.stringify(quote.matches))fail();}
  if(result.rawValidation&&result.rawValidation.textSha256!==raw.textSha256)fail();
 }
 return true;
}
