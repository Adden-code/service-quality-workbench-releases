import {evidenceStatusLabel} from './evidence-status.mjs';
import {aggregateRuleId} from './scene-aggregate.mjs';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function freezeEvidenceAudit(state,task){
 const aggregate=aggregateRuleId(task.executionSnapshot);
 return state.sessions.filter(s=>s.taskId===task.id).flatMap(s=>(s.expectedRuleIds||(s.aiResults||[]).map(r=>r.ruleId)).filter(id=>id!==aggregate).map(id=>{
  const ai=s.aiResults?.find(r=>r.ruleId===id),human=s.review?.status==='已确认'?s.review.drafts?.[id]:null;
  return {sessionId:s.id,externalId:s.externalId||s.id,ruleId:id,aiStatus:evidenceStatusLabel(ai),finalStatus:evidenceStatusLabel(human||ai,{human:Boolean(human)}),diagnostic:structuredClone({raw:ai?.rawValidation||null,evidence:ai?.evidenceValidation||null,dependencies:ai?.sceneDependencies||null,human:human?{source:human.source,evidenceQuotes:human.evidenceQuotes||[]}:null})};
 }));
}
const label=(s,en)=>en?({'已核验':'Verified','未核验':'Unverified','人工提供':'Human provided'})[s]||'Unverified':s;
export function evidenceAuditSheet(snapshot,english=false){return {name:english?'Evidence verification':'证据核验明细',headers:english?['Conversation ID','Original ID','Rule ID','AI evidence verification','Evidence verification status','Verification audit']:['会话ID','原会话ID','规则标识','AI证据核验状态','证据核验状态','证据核验审计'],rows:(snapshot.evidenceAudit||[]).map(r=>[r.sessionId,r.externalId,r.ruleId,label(r.aiStatus,english),label(snapshot.conclusionMode==='ai'?r.aiStatus:r.finalStatus,english),JSON.stringify(r.diagnostic)])};}
export function appendEvidenceSheets(input,snapshot,english=false){
 if(!Array.isArray(snapshot.evidenceAudit))return input;
 const sheets=input.map(s=>({...s,headers:[...s.headers],rows:s.rows.map(r=>[...r])})),main=sheets[0],title=english?'Evidence verification status':'证据核验状态';
 main.headers.push(title);
 const byId=new Map(snapshot.records.map(r=>[r.id,r]));
 const physical=new Map((snapshot.original?.rows||snapshot.records.map(r=>({sourceRow:r.sourceRow,recordId:r.id}))).map(r=>[r.sourceRow,r.recordId]));
 for(let i=0;i<main.rows.length;i++){
  if(main.headerDepth===2&&i===0){main.rows[i].push(title);continue;}
  const sourceRows=main.auditSourceRows||main.rowNumbers;const recordId=sourceRows?physical.get(sourceRows[i]):snapshot.records[i-(main.headerDepth===2?1:0)]?.id;
  if(!recordId||!byId.has(recordId)){main.rows[i].push('');continue;}
  const states=snapshot.evidenceAudit.filter(r=>r.sessionId===recordId).map(r=>snapshot.conclusionMode==='ai'?r.aiStatus:r.finalStatus);
  main.rows[i].push(label(states.includes('未核验')?'未核验':states.includes('人工提供')?'人工提供':states.length?'已核验':'未核验',english));
 }
 sheets.push(evidenceAuditSheet(snapshot,english));return sheets;
}
export function evidenceAuditHtml(snapshot,english=false){if(!Array.isArray(snapshot.evidenceAudit))return'';const s=evidenceAuditSheet(snapshot,english);return `<details class="evidence-audit"><summary>${escape(s.name)}</summary><table><thead><tr>${s.headers.map(x=>`<th>${escape(x)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r=>`<tr>${r.map(x=>`<td>${escape(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;}
