import {isVoidedTask} from './task-lifecycle.mjs';
import {isSessionCheckRule} from './rule-kind.mjs';

const verdicts=new Set(['符合','不符合','无法判定','不适用']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const array=value=>Array.isArray(value)?value:[];
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':value===undefined?'undefined':JSON.stringify(value);
export const metric=(count,total)=>({count,total,rate:total?count/total:null});
const taskRules=task=>array(task?.basisSnapshot?.rules);
const ruleBody=rule=>({title:rule?.title??rule?.name,category:rule?.category,scope:rule?.scope,passCriteria:rule?.passCriteria,failCriteria:rule?.failCriteria,exceptionCriteria:rule?.exceptionCriteria,policyIds:rule?.policyIds,ruleKind:rule?.ruleKind});

/** Completed output only: technical-failure placeholders are not model answers. */
export function inspectionAnswer(session,ruleId){
  if(session?.aiExecution?.status!=='completed')return{status:session?.aiExecution?.status||'unexecuted',verdict:null};
  const matches=array(session.aiResults).filter(result=>result.ruleId===ruleId);
  if(matches.length!==1||!verdicts.has(matches[0].verdict))return{status:'missing',verdict:null};
  if(matches[0].rawValidation?.status==='program-fallback')return{status:'failed',verdict:null};
  return{status:'answered',verdict:matches[0].verdict,reason:matches[0].reason||''};
}
export function humanAnswer(session,ruleId){
  const result=session?.review?.drafts?.[ruleId];
  if(!result||!verdicts.has(result.verdict))return{status:'unrecorded',verdict:null,confirmed:false};
  return{status:session.review.disposition==='unreplied'?'unreplied-fact':session.review.status||'unrecorded',confirmed:session.review.status==='已确认'&&session.review.disposition!=='unreplied',verdict:result.verdict,reason:result.reason||'',record:structuredClone(result)};
}

/** Rates describe observed checks, not accuracy or a representative gold set. */
export function buildRuleHealth(state,{taskIds,scene,sort='changes'}={}){
  const selected=new Set(taskIds||[]),tasks=array(state?.tasks).filter(task=>task.mode==='manual'&&(!selected.size||selected.has(task.id))&&(!scene||task.scene===scene)),active=tasks.filter(task=>!isVoidedTask(task)),groups=new Map();let expectedMetaChecks=0,sessionCount=0;
  for(const task of active){
    const sessions=array(state.sessions).filter(session=>session.taskId===task.id);sessionCount+=sessions.length;
    for(const rule of taskRules(task)){
      const applicable=sessions.filter(session=>!session.expectedRuleIds||session.expectedRuleIds.includes(rule.id));
      if(!isSessionCheckRule(rule)){expectedMetaChecks+=applicable.length;continue;}
      const key=JSON.stringify([task.scene||'',rule.id,rule.version||'']);
      if(!groups.has(key))groups.set(key,{key,scene:task.scene||'',ruleId:rule.id,version:rule.version||'',title:rule.title||rule.name||rule.id,taskIds:new Set(),bodies:new Set(),expectedChecks:0,aiAnswered:0,aiUnknown:0,aiFail:0,aiNotApplicable:0,technicalFailureChecks:0,unansweredChecks:0,humanConfirmedChecks:0,humanIndependentChecks:0,pairedHumanChecks:0,changedHumanChecks:0});
      const group=groups.get(key);group.taskIds.add(task.id);group.bodies.add(canonical(ruleBody(rule)));
      for(const session of applicable){
        group.expectedChecks++;const ai=inspectionAnswer(session,rule.id),human=humanAnswer(session,rule.id);
        if(ai.status==='answered'){group.aiAnswered++;if(ai.verdict==='无法判定')group.aiUnknown++;if(ai.verdict==='不符合')group.aiFail++;if(ai.verdict==='不适用')group.aiNotApplicable++;}
        else {group.unansweredChecks++;if(ai.status==='failed')group.technicalFailureChecks++;}
        if(human.confirmed){group.humanConfirmedChecks++;if(ai.status==='answered'){group.pairedHumanChecks++;if(human.verdict!==ai.verdict)group.changedHumanChecks++;}else group.humanIndependentChecks++;}
      }
    }
  }
  const rows=[...groups.values()].map(({bodies,taskIds,...row})=>({...row,taskIds:[...taskIds],basisVariantCount:bodies.size,aiCoverage:metric(row.aiAnswered,row.expectedChecks),unknownRate:metric(row.aiUnknown,row.aiAnswered),failTriggerRate:metric(row.aiFail,row.aiAnswered),humanCoverage:metric(row.humanConfirmedChecks,row.expectedChecks),humanChangeRate:metric(row.changedHumanChecks,row.pairedHumanChecks),quoteRejectionRate:null}));
  const field={changes:'humanChangeRate',unknown:'unknownRate',fail:'failTriggerRate',coverage:'humanCoverage'}[sort]||'humanChangeRate';
  rows.sort((a,b)=>(b[field].rate??-1)-(a[field].rate??-1)||b.expectedChecks-a.expectedChecks||a.key.localeCompare(b.key));
  return{schemaVersion:1,rows,taskCount:active.length,sessionCount,excludedVoidedTasks:tasks.length-active.length,excludedMetaChecks:expectedMetaChecks,quoteRejectionHistoryAvailable:false,unit:'task-session-rule',humanSample:'current-confirmed-review-with-completed-AI'};
}

/** Only explicitly retained physical source positions are eligible for alignment. */
export function sourcePosition(task,session){
  const record=session?.rawTranscript||session?.ecommerce;
  if(!record)return{valid:false,reason:'source_position_missing',fileSha256:task?.source?.sha256||'',sheet:'',row:null};
  if(!hash(task?.source?.sha256)||record.fileSha256!==task.source.sha256||!record.sheet||!Number.isSafeInteger(record.row)||record.row<1)return{valid:false,reason:'source_position_invalid',fileSha256:record.fileSha256||'',sheet:record.sheet||'',row:record.row??null};
  return{valid:true,fileSha256:record.fileSha256,sheet:record.sheet,sheetIndex:record.sheetIndex??null,row:record.row,key:JSON.stringify([record.fileSha256,record.sheet,record.row])};
}
const sourceContent=session=>session.rawTranscript?canonical({text:session.rawTranscript.text,textSha256:session.rawTranscript.textSha256,raw:session.rawTranscript.raw,columns:session.rawTranscript.columns,timePolicy:session.rawTranscript.timePolicy}):canonical({raw:session.ecommerce?.raw,headers:session.ecommerce?.headers,extensions:session.ecommerce?.extensions,sourceColumns:session.ecommerce?.sourceColumns});
const policyBody=(task,rule)=>canonical(array(task?.basisSnapshot?.policies).filter(policy=>array(rule?.policyIds).includes(policy.id)).map(policy=>({id:policy.id,version:policy.version,sections:policy.sections,content:policy.content})).sort((a,b)=>a.id.localeCompare(b.id)));
const failed=(before,after,reason,details={})=>({schemaVersion:1,compatible:false,reason,beforeTaskId:before?.id||'',afterTaskId:after?.id||'',rows:[],...details});

export function eligibleReinspectionPairs(state){
  const tasks=array(state?.tasks).filter(task=>task.mode==='manual'),map=new Map(tasks.map(task=>[task.id,task]));
  return tasks.filter(task=>task.reinspectionOf&&map.has(task.reinspectionOf)).map(task=>({beforeTaskId:task.reinspectionOf,afterTaskId:task.id,beforeName:map.get(task.reinspectionOf).name,afterName:task.name,createdAt:task.createdAt})).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function compareTaskReinspection(state,{beforeTaskId,afterTaskId}={}){
  const after=array(state?.tasks).find(task=>task.id===afterTaskId),before=array(state?.tasks).find(task=>task.id===(beforeTaskId||after?.reinspectionOf));
  if(!before||!after||before.id===after.id)return failed(before,after,'task_pair_missing');
  if(before.mode!=='manual'||after.mode!=='manual'||before.scene!==after.scene)return failed(before,after,'scene_mismatch');
  if(!hash(before.source?.sha256)||before.source.sha256!==after.source?.sha256)return failed(before,after,'source_mismatch');
  const byTask=task=>array(state.sessions).filter(session=>session.taskId===task.id),left=byTask(before),right=byTask(after);
  if(!left.length||!right.length)return failed(before,after,'source_rows_missing');
  for(const [task,sessions] of [[before,left],[after,right]])if(Array.isArray(task.sessionIds)&&(task.sessionIds.length!==sessions.length||sessions.some(session=>!task.sessionIds.includes(session.id))))return failed(before,after,'source_rows_missing');
  const maps=[];
  for(const [task,sessions] of [[before,left],[after,right]]){
    const map=new Map();for(const session of sessions){const position=sourcePosition(task,session);if(!position.valid)return failed(before,after,position.reason);if(map.has(position.key))return failed(before,after,'duplicate_source_position');map.set(position.key,{session,position});}maps.push(map);
  }
  const [oldRows,newRows]=maps;
  // A full-batch reinspection must preserve its exact source row set.
  if(oldRows.size!==newRows.size||[...oldRows.keys()].some(key=>!newRows.has(key)))return failed(before,after,'source_row_set_mismatch');
  for(const [key,old] of oldRows){const next=newRows.get(key);if((old.position.sheetIndex!==null&&next.position.sheetIndex!==null&&old.position.sheetIndex!==next.position.sheetIndex)||old.session.externalId!==next.session.externalId||sourceContent(old.session)!==sourceContent(next.session))return failed(before,after,'source_content_mismatch',{source:old.position});}
  const rulesBefore=new Map(taskRules(before).map(rule=>[rule.id,rule])),rulesAfter=new Map(taskRules(after).map(rule=>[rule.id,rule]));
  if(!rulesBefore.size||!rulesAfter.size)return failed(before,after,'rules_missing');
  if(rulesBefore.size!==taskRules(before).length||rulesAfter.size!==taskRules(after).length)return failed(before,after,'duplicate_rule_id');
  const ruleIds=[...new Set([...rulesBefore.keys(),...rulesAfter.keys()])],rows=[];
  for(const [key,old] of oldRows){const next=newRows.get(key);
    for(const ruleId of ruleIds){
      const oldRule=rulesBefore.get(ruleId),newRule=rulesAfter.get(ruleId),oldExpected=Boolean(oldRule&&(!old.session.expectedRuleIds||old.session.expectedRuleIds.includes(ruleId))),newExpected=Boolean(newRule&&(!next.session.expectedRuleIds||next.session.expectedRuleIds.includes(ruleId)));
      if(!oldExpected&&!newExpected)continue;
      const ruleChange=!oldExpected?'added':!newExpected?'removed':oldRule.version!==newRule.version?'version':canonical(ruleBody(oldRule))!==canonical(ruleBody(newRule))?'content':'unchanged';
      const beforeAI=oldExpected?inspectionAnswer(old.session,ruleId):{status:'not-selected',verdict:null},afterAI=newExpected?inspectionAnswer(next.session,ruleId):{status:'not-selected',verdict:null};
      const beforeHuman=oldExpected?humanAnswer(old.session,ruleId):{status:'not-selected',verdict:null,confirmed:false},afterHuman=newExpected?humanAnswer(next.session,ruleId):{status:'not-selected',verdict:null,confirmed:false};
      const aiComparable=beforeAI.status==='answered'&&afterAI.status==='answered',aiVerdictChanged=aiComparable&&beforeAI.verdict!==afterAI.verdict;
      const humanComparable=Boolean(beforeHuman.verdict&&afterHuman.verdict),humanVerdictChanged=humanComparable&&beforeHuman.verdict!==afterHuman.verdict;
      const humanRecordChanged=canonical(beforeHuman)!==canonical(afterHuman),policyChanged=Boolean(oldRule&&newRule&&policyBody(before,oldRule)!==policyBody(after,newRule));
      rows.push({source:old.position,externalId:old.session.externalId||'',beforeSessionId:old.session.id,afterSessionId:next.session.id,ruleId,title:newRule?.title||newRule?.name||oldRule?.title||oldRule?.name||ruleId,beforeVersion:oldRule?.version??null,afterVersion:newRule?.version??null,ruleChange,policyChanged,beforeAI,afterAI,beforeHuman,afterHuman,aiComparable,aiVerdictChanged,humanComparable,humanVerdictChanged,humanRecordChanged,changed:ruleChange!=='unchanged'||policyChanged||aiVerdictChanged||beforeAI.status!==afterAI.status||humanRecordChanged});
    }
  }
  return{schemaVersion:1,compatible:true,relation:after.reinspectionOf===before.id?'parent-child':'same-source',beforeTaskId:before.id,afterTaskId:after.id,beforeName:before.name,afterName:after.name,sourceSha256:before.source.sha256,sourceRows:left.length,beforeVoided:isVoidedTask(before),afterVoided:isVoidedTask(after),rows,summary:{totalChecks:rows.length,changedChecks:rows.filter(row=>row.changed).length,aiComparable:rows.filter(row=>row.aiComparable).length,aiFlips:rows.filter(row=>row.aiVerdictChanged).length,humanComparable:rows.filter(row=>row.humanComparable).length,humanFlips:rows.filter(row=>row.humanVerdictChanged).length,humanRecordChanges:rows.filter(row=>row.humanRecordChanged).length,addedRules:ruleIds.filter(id=>!rulesBefore.has(id)).length,removedRules:ruleIds.filter(id=>!rulesAfter.has(id)).length,versionChanges:ruleIds.filter(id=>rulesBefore.has(id)&&rulesAfter.has(id)&&rulesBefore.get(id).version!==rulesAfter.get(id).version).length}};
}
