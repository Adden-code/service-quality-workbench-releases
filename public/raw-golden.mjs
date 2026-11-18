import {readXlsx,workbook,XLSX_ROW_NUMBER} from './io.mjs';
const fail=message=>{throw new Error('金标准对照：'+message);};
const verdictMap=new Map([['符合','符合'],['通过','符合'],['pass','符合'],['不符合','不符合'],['不通过','不符合'],['fail','不符合'],['无法判定','无法判定'],['待判定','无法判定'],['unable to determine','无法判定'],['uncertain','无法判定'],['不适用','不适用'],['na','不适用'],['n/a','不适用'],['not applicable','不适用']]);
const verdict=value=>verdictMap.get(String(value??'').trim().toLowerCase());
const key=(row,ruleId)=>JSON.stringify([row,ruleId]);
const ratio=(n,d)=>d?n/d:null;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function scope(state,taskId){
 const task=state?.tasks?.find(t=>t.id===taskId);if(task?.inputMode!=='raw-transcript-v1'||!Array.isArray(task.basisSnapshot?.rules)||!task.basisSnapshot.rules.length||!/^[a-f0-9]{64}$/.test(task.source?.sha256))fail('请选择具有冻结原件和规则的原文直判任务。');
 const sessions=state.sessions.filter(s=>s.taskId===taskId);if(!sessions.length||sessions.some(s=>s.rawTranscript?.schemaVersion!==1||!Number.isSafeInteger(s.rawTranscript.row)))fail('任务原文记录或物理行号不完整。');
 const rows=new Map();for(const s of sessions){if(rows.has(s.rawTranscript.row))fail('任务原表行号重复。');rows.set(s.rawTranscript.row,s);}
 const rules=new Map(task.basisSnapshot.rules.map(r=>[r.id,r]));if(rules.size!==task.basisSnapshot.rules.length)fail('冻结规则标识重复。');return{task,sessions,rows,rules};
}
export function evaluateRawGolden(state,taskId,golden,{now=new Date().toISOString()}={}){
 const {task,sessions,rows,rules}=scope(state,taskId);
 if(!golden||golden.schemaVersion!==1||golden.taskId!==task.id||golden.sourceSha256!==task.source.sha256||!Array.isArray(golden.records)||golden.records.length>sessions.length*rules.size)fail('任务、来源摘要、记录数量或对照格式不匹配。');
 const gold=new Map();for(const g of golden.records){
  const session=rows.get(g.sourceRow),rule=rules.get(g.ruleId),v=verdict(g.verdict);
  if(!session||g.conversationId!==session.externalId||!rule||g.ruleVersion!==rule.version||!v||gold.has(key(g.sourceRow,g.ruleId)))fail('存在错行、会话ID／规则／版本不匹配、重复或非法人工判定。');
  gold.set(key(g.sourceRow,g.ruleId),{...g,verdict:v});
 }
 let correct=0,uncertain=0,recalled=0,failTotal=0,unanswered=0,sourceTimeUnavailable=0,technicalFailedRows=0,localValidationFailed=0,wrongPass=0,aiFinalRows=0,assessedPass=0,humanReviewTimeMs=0;
 const comparisons=[];
 for(const s of sessions){
  const originalExempt=s.aiDecision?.status==='PASS'&&s.aiExecution?.status==='completed'&&s.reviewPolicy?.enabled===true;let wrong=false,covered=0;
  if(originalExempt)aiFinalRows++;if(s.aiExecution?.status==='failed')technicalFailedRows++;
  const active=s.review?.activeTimeMs;humanReviewTimeMs+=Number.isFinite(active)&&active>=0?active:0;
  for(const r of rules.values()){
   const a=s.aiResults?.find(a=>a.ruleId===r.id),g=gold.get(key(s.rawTranscript.row,r.id)),v=verdict(a?.verdict),status=a?.rawValidation?.status;
   const answered=Boolean(a&&['verified'].includes(status)&&s.aiExecution?.status!=='failed'&&v);
   if(!answered)unanswered++;if(status==='degraded')localValidationFailed++;
   if(a?.rawValidation?.reasonCodes?.includes('source_time_unavailable'))sourceTimeUnavailable++;
   const effective=answered?v:'无法判定';if(effective==='无法判定')uncertain++;
   const same=Boolean(g&&answered&&g.verdict===v);if(same)correct++;
   if(g){covered++;if(originalExempt&&g.verdict==='无法判定')wrong=true;if(g.verdict==='不符合'){failTotal++;if(answered&&v==='不符合')recalled++;if(originalExempt)wrong=true;}}
   comparisons.push({sourceRow:s.rawTranscript.row,conversationId:s.externalId,ruleId:r.id,ruleVersion:r.version,aiVerdict:v??'无法判定',effectiveVerdict:effective,humanVerdict:g?.verdict??null,correct:same,answerAccepted:answered,validationStatus:status??'missing',reasonCodes:[...(a?.rawValidation?.reasonCodes||[])],initialAIFinal:originalExempt});
  }
  if(originalExempt&&covered===rules.size){assessedPass++;if([...rules.keys()].every(id=>gold.get(key(s.rawTranscript.row,id))?.verdict==='不适用'))wrong=true;}if(wrong)wrongPass++;
 }
 const byRule=[...rules.values()].map(rule=>{const checks=comparisons.filter(c=>c.ruleId===rule.id),labelled=checks.filter(c=>c.humanVerdict),failures=labelled.filter(c=>c.humanVerdict==='不符合');return{ruleId:rule.id,ruleVersion:rule.version,title:rule.title||rule.name||rule.id,correct:checks.filter(c=>c.correct).length,total:checks.length,goldenChecks:labelled.length,accuracy:labelled.length?checks.filter(c=>c.correct).length/checks.length:null,uncertain:checks.filter(c=>c.effectiveVerdict==='无法判定').length,failRecalled:failures.filter(c=>c.answerAccepted&&c.aiVerdict==='不符合').length,failTotal:failures.length};});
 const reviewRouting={uncertainRows:sessions.filter(s=>s.aiDecision?.status==='UNCERTAIN').length,humanQueueRows:sessions.filter(s=>s.review.status!=='已确认'&&(s.review.returned||['FAIL','UNCERTAIN'].includes(s.aiDecision?.status)||s.aiExecution?.status==='failed')).length,returnEvents:sessions.reduce((n,s)=>n+(s.review?.returnHistory?.length||0),0),aiCompletedRows:sessions.filter(s=>s.aiExecution?.status==='completed').length,modelRequestAttempts:task.aiQueue?.rows?.every(r=>Number.isSafeInteger(r.attempts)&&r.attempts>=0)?task.aiQueue.rows.reduce((n,r)=>n+(Array.isArray(r.rawAttempts)?r.rawAttempts.length:r.attempts),0):null};
 const total=sessions.length*rules.size,complete=gold.size===total,accuracy={correct,total,rate:gold.size?ratio(correct,total):null};
 return{schemaVersion:1,taskId:task.id,taskName:task.name||task.id,sourceSha256:task.source.sha256,generatedAt:now,accuracy,uncertainty:{count:uncertain,total,rate:ratio(uncertain,total)},failRecall:{recalled,total:failTotal,rate:ratio(recalled,failTotal)},wrongAIFinalPass:{count:wrongPass,assessedRows:assessedPass,totalAIFinalRows:aiFinalRows},humanReviewTimeMs,counts:{sessions:sessions.length,expectedChecks:total,goldenChecks:gold.size,missingGolden:total-gold.size,unansweredChecks:unanswered,technicalFailedRows,localValidationFailedChecks:localValidationFailed,sourceTimeUnavailableChecks:sourceTimeUnavailable},acceptance:{goldenComplete:complete,evaluated:gold.size>0,targetAccuracy:0.90,passesAccuracyTarget:complete&&accuracy.rate>=0.90,confidenceThreshold:task.reviewPolicy?.confidenceThreshold??0.90,calibrationStatus:'unvalidated'},reviewRouting,byRule,comparisons};
}
const headers={zh:['任务ID','原文件SHA256','原表行','会话ID','规则ID','规则版本','人工判定'],en:['Task ID','Source SHA256','Source row','Conversation ID','Rule ID','Rule version','Human verdict']};
export async function buildRawGoldenTemplate(state,taskId,{language='zh'}={}){
 const {task,sessions,rules}=scope(state,taskId);return workbook([{name:language==='en'?'Golden Comparison':'金标准对照',headers:headers[language==='en'?'en':'zh'],rows:sessions.flatMap(s=>[...rules.values()].map(r=>[task.id,task.source.sha256,s.rawTranscript.row,s.externalId,r.id,r.version,'']))},{name:language==='en'?'Instructions':'填写说明',headers:language==='en'?['Item','Instruction']:['项目','说明'],rows:language==='en'?[['Human verdict','Fill Pass / Fail / Unable to determine / Not applicable. Keep all identity and version columns unchanged.'],['Coverage','Blank answers remain missing and do not shrink the full denominator.'],['Privacy','Comparison is local and never sent to a model.']]:[['人工判定','填写符合／不符合／无法判定／不适用，身份与版本列不改。'],['覆盖','空白保持缺失，不缩小完整分母。'],['隐私','仅本机对照，不发送到模型。']]}]);
}
export async function parseRawGoldenFile(file,state,taskId){
 const {task,rows,rules}=scope(state,taskId);if(!file||!String(file.name||'').toLowerCase().endsWith('.xlsx')||file.size>8*1024*1024)fail('请选择8MB以内的金标准Excel模板。');
 const bytes=new Uint8Array(await file.arrayBuffer());if(!bytes.length||bytes.length>8*1024*1024)fail('文件为空或超过8MB。');const tables=await readXlsx(bytes),table=tables['金标准对照']||tables['Golden Comparison'];if(!Array.isArray(table)||!table.length)fail('缺少金标准对照工作表。');
 const head=table[0];if(!Object.values(headers).some(labels=>labels.length===head.length&&labels.every((label,i)=>label===head[i])))fail('模板表头与列顺序不匹配。');
 const result={schemaVersion:1,taskId:task.id,sourceSha256:task.source.sha256,records:[]};let expectedRows=0;const identities=new Set();
 for(const cells of table.slice(1)){
  if(!cells.some(v=>String(v??'').trim()))continue;if(cells.slice(7).some(v=>String(v??'').trim()))fail('模板存在额外实际数据列。');
  if(cells[0]!==task.id||cells[1]!==task.source.sha256)fail('模板任务或原文件摘要不匹配。');
  const row=Number(cells[2]);if(!Number.isSafeInteger(row)||row<2)fail('原表行号不是有效整数。');
  const k=key(row,cells[4]);if(identities.has(k))fail('模板存在重复行／规则。');identities.add(k);expectedRows++;
  const check={sourceRow:row,conversationId:cells[3],ruleId:cells[4],ruleVersion:cells[5],verdict:cells[6]||''};
  // Validate identity even on a blank answer; altered empty cells may not vanish.
  const source=rows.get(row),rule=rules.get(check.ruleId);
  if(!source||check.conversationId!==source.externalId||!rule||check.ruleVersion!==rule.version||(String(check.verdict).trim()&&!verdict(check.verdict)))fail('存在错行、会话ID／规则／版本不匹配或非法人工判定。');
  if(String(check.verdict).trim())result.records.push({...check,verdict:verdict(check.verdict)});
 }
 if(expectedRows>state.sessions.filter(s=>s.taskId===taskId).length*task.basisSnapshot.rules.length)fail('模板记录超出任务范围。');evaluateRawGolden(state,taskId,result);return result;
}
export function buildRawGoldenHtml(m,{language='zh'}={}){
 const en=language==='en',fmt=rate=>rate===null?(en?'Not evaluated':'未评估'):(rate*100).toFixed(1)+'%';
 const valueLabel=value=>en?({'符合':'Pass','不符合':'Fail','无法判定':'Unable to determine','不适用':'Not applicable'}[value]??value):value;
 const labels=en?['Rule accuracy','Unable-to-determine rate','FAIL recall','Wrong original AI-final PASS rows']:['规则级正确率','无法判定率','FAIL召回率','错误免审PASS行数'];
 const values=[`${fmt(m.accuracy.rate)} (${m.accuracy.correct}/${m.accuracy.total})`,`${fmt(m.uncertainty.rate)} (${m.uncertainty.count}/${m.uncertainty.total})`,`${fmt(m.failRecall.rate)} (${m.failRecall.recalled}/${m.failRecall.total})`,`${m.wrongAIFinalPass.count} (${m.wrongAIFinalPass.assessedRows}/${m.wrongAIFinalPass.totalAIFinalRows} ${en?'fully labelled':'完整标注'})`];
 return '<!doctype html><html lang="'+(en?'en':'zh-CN')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(en?'Raw inspection acceptance comparison':'原文直判验收对照')+'</title><style>body{margin:0;padding:28px;background:#f0f3f8;color:#24304a;font:15px/1.7 system-ui,sans-serif}main{max-width:1100px;margin:auto;background:white;border-radius:12px;padding:30px}header{padding:22px;color:white;background:linear-gradient(135deg,#1f3864,#2f5496);border-radius:9px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.cards article{padding:18px;background:#f6f8fc;border-radius:8px}.cards b{display:block;font-size:24px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border:1px solid #d5e0f0;text-align:left}th{background:#eaf0fa}.note{background:#fff5df;padding:14px;border-radius:8px}.wrap{overflow:auto}@media(max-width:800px){.cards{grid-template-columns:1fr 1fr}body{padding:8px}main{padding:14px}}@media print{body{background:white;padding:0}main{padding:0}.cards article{break-inside:avoid}header{color:#1f3864;background:white;border:1px solid #d5e0f0}}</style><main><header><h1>'+escape(en?'Raw inspection acceptance comparison':'原文直判验收对照')+'</h1><p>'+escape(m.taskName)+' · '+escape(m.taskId)+'</p></header><div class="cards">'+labels.map((label,i)=>'<article>'+escape(label)+'<b>'+escape(values[i])+'</b></article>').join('')+'</div><p class="note">'+escape(en?'The uncalibrated 0.90 model-confidence threshold is independent of the 90% golden accuracy target. Quote matching proves source presence, not semantic correctness. Program failures and missing answers remain in the full denominator. Wrong exempt PASS rows include a golden Fail, a golden Unable to determine, or an entirely Not applicable row.':'未标定的0.90模型自评门槛与90%金标准正确率目标相互独立。引文命中不证明业务语义正确；程序失败和缺失不从完整分母剔除。金标准含不符合、无法判定或整行全部不适用的原免审PASS，计入错误免审行。')+'</p><p>'+escape(en?'Golden coverage':'人工标注覆盖')+': '+m.counts.goldenChecks+'/'+m.counts.expectedChecks+' · '+escape(en?'Incomplete labels':'缺失标注')+': '+m.counts.missingGolden+' · '+escape(en?'Active human review seconds':'人工活跃审核秒')+': '+(m.humanReviewTimeMs/1000).toFixed(1)+'</p><p>'+escape(m.acceptance.goldenComplete?(en?'Golden coverage complete; verify the real intranet benchmark before release acceptance.':'人工对照覆盖完整，真实内网验收仍以业务金标准为准。'):(en?'Golden coverage is incomplete: no acceptance claim is allowed.':'人工标注未完整覆盖：当前不得判定验收通过。'))+'</p><p>'+escape(en?'AI request attempts (inspection only)':'AI调用尝试数（仅质检）')+': '+(m.reviewRouting?.modelRequestAttempts??(en?'Not recorded':'未记录'))+' · '+escape(en?'Uncertain rows':'不确定行数')+': '+(m.reviewRouting?.uncertainRows??0)+' · '+escape(en?'Return-to-review events':'退回人工次数')+': '+(m.reviewRouting?.returnEvents??0)+'</p><div class="wrap"><table><thead><tr>'+[en?'Rule/version':'规则／版本',en?'Accuracy (full denominator)':'正确率（完整分母）',en?'Uncertain/checks':'无法判定／检查项',en?'FAIL recall':'FAIL召回'].map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+(m.byRule||[]).map(r=>'<tr><td>'+escape(r.ruleId+' '+r.ruleVersion+' · '+r.title)+'</td><td>'+fmt(r.accuracy)+' ('+r.correct+'/'+r.total+')</td><td>'+r.uncertain+'/'+r.total+'</td><td>'+fmt(ratio(r.failRecalled,r.failTotal))+' ('+r.failRecalled+'/'+r.failTotal+')</td></tr>').join('')+'</tbody></table></div><div class="wrap"><table><thead><tr>'+[en?'Source row':'原表行',en?'Conversation':'会话',en?'Rule/version':'规则／版本',en?'AI initial':'AI原判',en?'Human golden':'人工金标准',en?'Accepted answer':'有效回答',en?'Matches':'一致'].map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+m.comparisons.map(c=>'<tr><td>'+c.sourceRow+'</td><td>'+escape(c.conversationId)+'</td><td>'+escape(c.ruleId+' '+c.ruleVersion)+'</td><td>'+escape(valueLabel(c.aiVerdict))+'</td><td>'+escape(valueLabel(c.humanVerdict??(en?'Missing':'缺失')))+'</td><td>'+escape(c.answerAccepted?(en?'Yes':'是'):(en?'No':'否'))+'</td><td>'+escape(c.correct?(en?'Yes':'是'):(en?'No':'否'))+'</td></tr>').join('')+'</tbody></table></div><footer><p>'+escape(m.sourceSha256)+' · '+escape(m.generatedAt)+'</p></footer></main></html>';
}
