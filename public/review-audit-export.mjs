import {workbook} from './io.mjs';
import {isVoidedTask,isArchivedTask} from './task-lifecycle.mjs';
import {sourcePosition} from './quality-insights.mjs';

const list=value=>Array.isArray(value)?value:[];
const value=value=>typeof value==='string'?value:'';

/** Existing event snapshots only. Never reconstruct a missing before from today's AI. */
export function buildReviewAudit(state,{taskIds}={}){
  const selected=new Set(taskIds||[]),tasks=list(state?.tasks).filter(task=>task.mode==='manual'&&(!selected.size||selected.has(task.id))),map=new Map(tasks.map(task=>[task.id,task])),rows=[];let sessionsWithoutHistory=0,unsupportedEvents=0;
  for(const session of list(state?.sessions)){
    const task=map.get(session.taskId);if(!task)continue;
    if(!list(session.review?.history).length&&Object.keys(session.review?.drafts||{}).length)sessionsWithoutHistory++;
    for(const [index,event] of list(session.review?.history).entries()){
      if(!event||(!event.ruleId&&event.type!=='unreplied-fact')){unsupportedEvents++;continue;}
      const rule=list(task.basisSnapshot?.rules).find(rule=>rule.id===event.ruleId),position=sourcePosition(task,session),before=event.before&&typeof event.before==='object'?event.before:null,after=event.after&&typeof event.after==='object'?event.after:null;
      const fact=event.type==='unreplied-fact',changed=before&&after&&typeof before.verdict==='string'&&typeof after.verdict==='string'?before.verdict!==after.verdict:null;
      rows.push({eventId:`${session.id}:review-history:${index+1}`,eventIndex:index+1,at:value(event.at),operatorLabel:value(event.reviewer),identityAuthenticated:false,taskId:task.id,taskName:task.name,scene:task.scene,taskArchived:isArchivedTask(task),taskVoided:isVoidedTask(task),sessionId:session.id,externalId:session.externalId||'',sourceName:task.source?.name||'',sourceSha256:task.source?.sha256||'',sourceSheet:position.valid?position.sheet:'',sourceRow:position.valid?position.row:null,sourcePositionRecorded:position.valid,ruleId:event.ruleId||'',ruleVersion:rule?.version||'',ruleTitle:rule?.title||rule?.name||'',kind:fact?'unreplied-fact':changed===true?'verdict-change':before?'review-update':'first-record',beforeRecorded:Boolean(before),beforeVerdict:value(before?.verdict),afterVerdict:fact?'未回复':value(after?.verdict),beforeReason:value(before?.reason),reason:value(after?.reason||event.reason),beforeSource:value(before?.source),afterSource:fact?'未回复事实确认':value(after?.source),verdictChanged:changed,currentReviewStatus:session.review?.status||'',currentCompletedAt:session.review?.completedAt||''});
    }
    for(const [index,event] of list(session.review?.resolutionHistory).entries()){
      if(!event||!['resolve','reopen'].includes(event.action)){unsupportedEvents++;continue;}
      const position=sourcePosition(task,session),original=event.action==='resolve'?event:list(session.review.resolutionHistory).slice(0,index).find(item=>item.action==='resolve'&&item.id===event.resolutionId),ids=list(original?.unknownRuleIds);
      rows.push({eventId:`${session.id}:resolution-history:${index+1}`,eventIndex:index+1,at:value(event.at),operatorLabel:value(event.actor),identityAuthenticated:false,taskId:task.id,taskName:task.name,scene:task.scene,taskArchived:isArchivedTask(task),taskVoided:isVoidedTask(task),sessionId:session.id,externalId:session.externalId||'',sourceName:task.source?.name||'',sourceSha256:task.source?.sha256||'',sourceSheet:position.valid?position.sheet:'',sourceRow:position.valid?position.row:null,sourcePositionRecorded:position.valid,ruleId:'',ruleVersion:'',ruleTitle:'',kind:event.action==='resolve'?'pending-processed':'pending-reopened',operationId:event.id||'',relatedRuleVersions:ids.map(id=>`${id}@${list(task.basisSnapshot?.rules).find(rule=>rule.id===id)?.version||'?'}`).join('; '),beforeWorkStatus:event.action==='resolve'?'待处理':'已处理',afterWorkStatus:event.action==='resolve'?'已处理':'待处理',beforeRecorded:false,beforeVerdict:'',afterVerdict:'',beforeReason:'',reason:value(event.reason),beforeSource:'',afterSource:'',verdictChanged:null,currentReviewStatus:session.review?.status||'',currentCompletedAt:session.review?.completedAt||''});
    }
  }
  rows.sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)||a.eventId.localeCompare(b.eventId));
  return{schemaVersion:1,taskCount:tasks.length,eventCount:rows.length,knownVerdictChanges:rows.filter(row=>row.verdictChanged===true).length,workStatusEvents:rows.filter(row=>row.kind.startsWith('pending-')).length,missingBeforeEvents:rows.filter(row=>!row.beforeRecorded&&!row.kind.startsWith('pending-')).length,sessionsWithoutHistory,unsupportedEvents,includesVoided:true,identity:'editable-local-label',rows};
}

const columns=[
 ['eventId','事件标识','Event ID'],['at','事件时间','Event time'],['operatorLabel','操作标签（未认证身份）','Operator label (not authenticated)'],
 ['taskId','任务ID','Task ID'],['taskName','任务名称','Task name'],['scene','场景','Scene'],['taskArchived','已归档','Archived'],['taskVoided','已作废','Voided'],
 ['externalId','原会话ID','Original conversation ID'],['sessionId','工作区会话ID','Workspace record ID'],['sourceName','原文件','Source file'],['sourceSha256','原文件SHA256','Source SHA256'],['sourceSheet','源工作表','Source sheet'],['sourceRow','源物理行','Physical source row'],
 ['ruleId','规则ID','Rule ID'],['ruleVersion','冻结规则版本','Frozen rule version'],['ruleTitle','规则名称','Rule title'],['kind','事件类型','Event type'],
 ['beforeVerdict','修改前人工判定','Prior human verdict'],['afterVerdict','修改后人工判定','Saved human verdict'],['beforeReason','修改前理由','Prior reason'],['reason','本次理由','Saved reason'],['beforeSource','修改前记录来源','Prior record source'],['afterSource','修改后记录来源','Saved record source'],['currentReviewStatus','导出时审核状态','Review status at export'],['currentCompletedAt','当前确认时间','Current confirmation time'],
 ['operationId','处理操作标识','Work operation ID'],['relatedRuleVersions','相关无法判定规则及版本','Related unknown rules and versions'],['beforeWorkStatus','原工作处理状态','Prior work status'],['afterWorkStatus','后工作处理状态','Saved work status'],
];
const kinds={zh:{'first-record':'首次留痕（未记录前值）','verdict-change':'人工判定变更','review-update':'人工记录更新','unreplied-fact':'未回复事实确认','pending-processed':'待补充已处理（结论不变）','pending-reopened':'重新打开待补充（结论不变）'},en:{'first-record':'First recorded entry (prior value unavailable)','verdict-change':'Human verdict changed','review-update':'Human record updated','unreplied-fact':'Unreplied fact confirmed','pending-processed':'Pending evidence handled (verdict unchanged)','pending-reopened':'Pending evidence reopened (verdict unchanged)'}};
const enVerdict={'符合':'Pass','不符合':'Fail','无法判定':'Unable to determine','不适用':'Not applicable','未回复':'Unreplied','已确认':'Confirmed','已暂存':'Draft saved','待审核':'Pending review','待补充':'Evidence needed','AI接受':'Accepted AI','人工修改':'Human modification','人工补充':'Human addition','人工独立审核':'Independent human review','未回复事实确认':'Unreplied fact confirmed','待处理':'Pending','已处理':'Handled'};

function auditExcelSheets(sheets,en){
  const references=new Map(),chunks=[];
  const safe=value=>{
    if(typeof value!=='string'||value.length<=32767)return value;
    if(references.has(value))return references.get(value);
    const id=`AUDIT-TEXT-${references.size+1}`,parts=[];
    for(let start=0;start<value.length;){let end=Math.min(start+32700,value.length);if(end<value.length&&value.charCodeAt(end-1)>=0xD800&&value.charCodeAt(end-1)<=0xDBFF)end--;parts.push(value.slice(start,end));start=end;}
    parts.forEach((part,index)=>chunks.push([id,index+1,parts.length,part]));
    const marker=en?`Full text in Long text: ${id} (${parts.length} parts; ${value.length} characters)`:`完整内容见长文本留存：${id}（${parts.length}段；共${value.length}字符）`;references.set(value,marker);return marker;
  };
  const output=sheets.map(sheet=>({...sheet,headers:sheet.headers.map(safe),rows:sheet.rows.map(row=>row.map(safe))}));
  if(chunks.length)output.push({name:en?'Long text':'长文本留存',headers:en?['Content ID','Part','Total parts','Full text part']:['内容标识','分段序号','总段数','完整内容分段'],rows:chunks});
  return output;
}

export async function buildReviewAuditXlsx(state,{taskIds,language='zh'}={}){
  const audit=buildReviewAudit(state,{taskIds}),en=language==='en',locale=en?'en':'zh',missing=en?'Not recorded':'未记录';
  const data=audit.rows.map(row=>columns.map(([key])=>{
    if(key==='kind')return kinds[locale][row.kind]||row.kind;
    if(['taskArchived','taskVoided'].includes(key))return row[key]?(en?'Yes':'是'):(en?'No':'否');
    if(['beforeVerdict','afterVerdict'].includes(key)&&row.kind.startsWith('pending-'))return en?'Unchanged (work-status event)':'结论不变（工作处理事件）';
    if(key==='beforeVerdict'&&!row.beforeRecorded)return en?'Not recorded; do not infer from current AI':'未记录，不从当前AI判定推定';
    if(['beforeVerdict','afterVerdict','beforeSource','afterSource','currentReviewStatus','beforeWorkStatus','afterWorkStatus'].includes(key))return (en?enVerdict[row[key]]:null)||row[key]||missing;
    if(['operatorLabel','at','sourceSheet','sourceRow','ruleVersion'].includes(key))return row[key]===null||row[key]===undefined||row[key]===''?missing:row[key];
    return row[key]??'';
  }));
  const notes=en?[
    ['Scope','Saved human-review events, including accepted AI and unchanged verdict updates. Archived and voided batches remain traceable.'],
    ['Prior values','A missing before snapshot remains unknown. It is never reconstructed from the current AI or later human results.'],
    ['Identity','Operator labels are editable local labels, not authenticated identities.'],
    ['Work status','Handled/reopened pending-evidence events change work status only. They do not change verdicts or create a confirmed human quality result.'],
    ['Status','Review status and confirmation time describe the current state at export, not the state at each historical event.'],
    ['Source rows','Physical row positions appear only when explicitly retained in raw/ecommerce source metadata. Other rows remain unrecorded.'],
    ['Coverage',`${audit.eventCount} events; ${audit.knownVerdictChanges} known verdict changes; ${audit.missingBeforeEvents} events without prior snapshots; ${audit.sessionsWithoutHistory} records have drafts without saved history; ${audit.unsupportedEvents} unsupported events.`],
  ]:[
    ['范围','逐条导出已保存的人工审核事件，包含接受AI和结论不变的记录更新。归档与作废批次保留供追溯。'],
    ['前值','缺少before快照时保持未记录，不从当前AI或后续人工结果推定。'],
    ['身份','操作标签为可编辑的本机标签，不代表已认证身份。'],
    ['工作状态','待补充的处理／重新打开仅改变工作状态，结论不变，不产生人工已确认质量结论。'],
    ['状态','审核状态与确认时间为导出时的当前值，不代表每个历史事件当时已确认。'],
    ['源行','仅原文直判／电商明确保留的物理源行可列出；其他记录保持未记录，不补造行号。'],
    ['覆盖',`${audit.eventCount}条事件；${audit.knownVerdictChanges}次已知判定变化；${audit.missingBeforeEvents}条缺前值；${audit.sessionsWithoutHistory}条已有人工稿但未留历史；${audit.unsupportedEvents}条不支持的历史事件。`],
  ];
  return workbook(auditExcelSheets([{name:en?'Review audit':'人工改判审计',headers:columns.map(column=>column[en?2:1]),rows:data},{name:en?'Scope and limits':'口径与边界',headers:en?['Item','Description']:['项目','说明'],rows:notes}],en));
}
