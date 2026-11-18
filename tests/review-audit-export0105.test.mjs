import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewAudit,buildReviewAuditXlsx} from '../public/review-audit-export.mjs';
import {readXlsx} from '../public/io.mjs';

const sha='d'.repeat(64);
function fixture(){
  const first={ruleId:'R1',verdict:'符合',reason:'Accepted synthetic result',source:'AI接受'},after={...first,verdict:'不符合',reason:'Synthetic human reason',source:'人工修改'};
  return{tasks:[{id:'T',name:'Synthetic audit',mode:'manual',scene:'Synthetic',source:{name:'synthetic.xlsx',sha256:sha},lifecycle:{archivedAt:'2026-11-15',voidedAt:'2026-11-15'},basisSnapshot:{rules:[{id:'R1',version:'2.0',title:'Synthetic frozen rule'}]}}],sessions:[{id:'S',externalId:'source-01',taskId:'T',aiExecution:{status:'completed'},aiResults:[{...first,verdict:'不适用'}],rawTranscript:{fileSha256:sha,sheet:'Synthetic',row:17},review:{reviewer:'Current editable label',status:'已确认',completedAt:'2026-11-15T03:00:00Z',drafts:{R1:after},history:[{at:'2026-11-15T01:00:00Z',reviewer:'First local label',ruleId:'R1',before:null,after:first},{at:'2026-11-15T02:00:00Z',reviewer:'Second local label',ruleId:'R1',before:first,after}]}}]};
}

test('audit exports actual event snapshots, never infers first before from current AI or reviewer identity',()=>{
  const state=fixture(),copy=structuredClone(state),audit=buildReviewAudit(state);assert.equal(audit.eventCount,2);assert.equal(audit.knownVerdictChanges,1);assert.equal(audit.missingBeforeEvents,1);
  const [first,second]=audit.rows;assert.equal(first.beforeRecorded,false);assert.equal(first.beforeVerdict,'');assert.equal(first.operatorLabel,'First local label');assert.equal(first.identityAuthenticated,false);assert.equal(first.kind,'first-record');
  assert.equal(second.beforeVerdict,'符合');assert.equal(second.afterVerdict,'不符合');assert.equal(second.reason,'Synthetic human reason');assert.equal(second.operatorLabel,'Second local label');assert.equal(second.ruleVersion,'2.0');assert.equal(second.sourceRow,17);assert.equal(second.taskVoided,true);assert.equal(second.taskArchived,true);assert.equal(second.kind,'verdict-change');assert.deepEqual(state,copy);
});

test('legacy missing history and missing physical source row are disclosed instead of fabricated',()=>{
  const state=fixture();delete state.sessions[0].rawTranscript;delete state.sessions[0].review.history[0].reviewer;state.sessions.push({...structuredClone(state.sessions[0]),id:'OLD',review:{drafts:{R1:{verdict:'符合'}}}});state.sessions[0].review.history.push({type:'unsupported'});
  const audit=buildReviewAudit(state);assert.equal(audit.sessionsWithoutHistory,1);assert.equal(audit.unsupportedEvents,1);assert.equal(audit.rows[0].operatorLabel,'');assert.equal(audit.rows[0].sourceRow,null);assert.equal(audit.rows[0].sourcePositionRecorded,false);assert.equal(audit.rows[0].sourceSha256,sha);
});

test('pending evidence resolve/reopen export as work events, preserve labels/reasons/rules, and add no verdict changes',()=>{
  const state=fixture();state.sessions[0].review.resolutionHistory=[{version:1,kind:'processed-unknown',action:'resolve',id:'resolve-1',at:'2026-11-15T04:00:00Z',actor:'Handler',reason:'Synthetic information absent',unknownRuleIds:['R1'],runId:'run-1'},{version:1,action:'reopen',id:'reopen-1',at:'2026-11-15T05:00:00Z',actor:'Reopener',reason:'Synthetic information added',resolutionId:'resolve-1'}];
  const audit=buildReviewAudit(state);assert.equal(audit.eventCount,4);assert.equal(audit.workStatusEvents,2);assert.equal(audit.knownVerdictChanges,1);assert.equal(audit.missingBeforeEvents,1);
  const resolve=audit.rows[2],reopen=audit.rows[3];assert.equal(resolve.kind,'pending-processed');assert.equal(resolve.afterWorkStatus,'已处理');assert.equal(resolve.afterVerdict,'');assert.equal(resolve.verdictChanged,null);assert.equal(resolve.relatedRuleVersions,'R1@2.0');assert.equal(resolve.operatorLabel,'Handler');assert.equal(reopen.kind,'pending-reopened');assert.equal(reopen.beforeWorkStatus,'已处理');assert.equal(reopen.afterWorkStatus,'待处理');assert.equal(reopen.relatedRuleVersions,'R1@2.0');assert.equal(reopen.reason,'Synthetic information added');
});

test('unreplied facts remain separate and task scope does not include unrelated event history',()=>{
  const state=fixture();state.sessions[0].review.history.push({type:'unreplied-fact',at:'2026-11-15T04:00:00Z',reviewer:'Fact reviewer'});state.tasks.push({...state.tasks[0],id:'OTHER'});state.sessions.push({...structuredClone(state.sessions[0]),taskId:'OTHER',id:'OTHER-S'});
  const audit=buildReviewAudit(state,{taskIds:['T']});assert.equal(audit.eventCount,3);assert.equal(audit.rows.at(-1).kind,'unreplied-fact');assert.equal(audit.rows.at(-1).afterVerdict,'未回复');assert.equal(audit.rows.at(-1).verdictChanged,null);assert.equal(audit.taskCount,1);
});

test('standalone bilingual Excel roundtrips reasons as text and keeps event-time data distinct from current confirmation',async()=>{
  const state=fixture();state.sessions[0].review.history[1].after.reason='=HYPERLINK("https://invalid.example","synthetic")';
  for(const language of ['zh','en']){
    const sheets=await readXlsx(await buildReviewAuditXlsx(state,{language})),rows=sheets[language==='en'?'Review audit':'人工改判审计'],headers=rows[0];
    assert.equal(rows.length,3);assert.equal(rows[2][headers.indexOf(language==='en'?'Saved reason':'本次理由')],'=HYPERLINK("https://invalid.example","synthetic")');
    assert.match(rows[1][headers.indexOf(language==='en'?'Prior human verdict':'修改前人工判定')],language==='en'?/do not infer/:/不从当前AI/);
    assert.equal(rows[2][headers.indexOf(language==='en'?'Frozen rule version':'冻结规则版本')],'2.0');
    assert.ok(sheets[language==='en'?'Scope and limits':'口径与边界'].some(row=>String(row[1]).includes(language==='en'?'not authenticated':'不代表已认证')));
  }
});

test('oversized audit text is fully retained in bilingual continuation sheets without splitting Unicode pairs',async()=>{
  const state=fixture(),long='x'.repeat(32699)+'😀'+'合成'.repeat(22000);state.sessions[0].review.history[1].after.reason=long;
  for(const language of ['zh','en']){
    const sheets=await readXlsx(await buildReviewAuditXlsx(state,{language})),parts=sheets[language==='en'?'Long text':'长文本留存'];assert.ok(parts);
    assert.equal(parts.slice(1).map(row=>row[3]).join(''),long);assert.ok(parts.slice(1).every(row=>row[3].length<=32767));
    const main=sheets[language==='en'?'Review audit':'人工改判审计'],reason=main[2][main[0].indexOf(language==='en'?'Saved reason':'本次理由')];assert.match(reason,/AUDIT-TEXT-1/);
  }
});
