import {isBusinessEcommerceBasis,businessDuplicateGroups,validateBusinessDuplicateGroups} from '../public/ecommerce-business-profile.mjs';
import {EC_RULE_IDS,ecommerceTimeValues,ecommerceSourceColumn,validateEcommerceRecord,validateEcommerceSource} from '../public/ecommerce-schema.mjs';
import {isEcommerceBasis} from '../public/ecommerce-catalog.mjs';
import {workflowInput} from './workflow-contract.mjs';
import {computeEcommerceTimeFacts,isStageATimeBasis,timePolicyReferences,unrepliedSemanticResults} from '../public/ecommerce-time-results.mjs';

const fail=message=>{throw new Error(message);};
const semanticIds=EC_RULE_IDS.filter(id=>id!=='EC-TIME');
const record=s=>s.ecommerce;
const reply=s=>record(s).raw[9];
const administrator=s=>record(s).raw[11].trim();
const fieldKeys=(s,columns)=>s.contextFields?.filter(f=>columns.some(index=>ecommerceSourceColumn(record(s),index)===f.source.column)).map(f=>f.key)||[];
const judgment=(ruleId,verdict,reason,extra={})=>({ruleId,verdict,reason,evidence:[],referenceIds:[],...extra});

export function timeJudgment(session,{basis,inspectionAt,runtime}={}){
  if(isStageATimeBasis(basis)||isBusinessEcommerceBasis(basis)){
    const timeFacts=computeEcommerceTimeFacts(session,basis,{inspectionAt,runtime});
    return judgment('EC-TIME',timeFacts.outcome==='pass'?'符合':timeFacts.outcome==='fail'?'不符合':timeFacts.outcome==='na'?'不适用':'无法判定',timeFacts.reason,{timeFacts,fieldEvidence:fieldKeys(session,[12,13]),referenceIds:timePolicyReferences(basis)});
  }
  const r=record(session),{commentTime:start,replyTime:end}=ecommerceTimeValues(r);
  const fields=fieldKeys(session,[12,13]),extra={fieldEvidence:fields,referenceIds:timePolicyReferences(basis)};
  if(!start||!end)return judgment('EC-TIME','无法判定','评论时间或首次回复时间缺失/格式无效，未计算回复耗时。',extra);
  const ms=Date.parse(end)-Date.parse(start);
  if(ms<0)return judgment('EC-TIME','无法判定','首次回复时间早于评论时间，请核对原表。',extra);
  const seconds=Math.floor(ms/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
  return judgment('EC-TIME',ms>r.thresholdHours*3600000?'不符合':'符合',`北京时间连续计时（夜间和周末计入）：${start} → ${end}；耗时${hours}小时${minutes}分${seconds%60}秒，测试阈值${r.thresholdHours}小时；严格超过阈值才Fail。`,extra);
}

export function exactDuplicateGroups(sessions){
  const groups=new Map();
  const physical=new Set();
  for(const s of sessions){const source=JSON.stringify([s.ecommerce.fileSha256,s.ecommerce.sheet,s.ecommerce.row]);if(physical.has(source))continue;physical.add(source);const a=administrator(s),text=reply(s).trim();if(!a||!text)continue;const key=JSON.stringify([a,text]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s.id);}
  return [...groups.values()].filter(ids=>ids.length>=3).map(sessionIds=>({sessionIds,kind:'exact',reason:'同一管理员在本批次至少3条记录中重复使用相同回复（忽略首尾空白）。'}));
}

export function validateDuplicateGroups(groups,sessions,basis){
  if(isBusinessEcommerceBasis(basis))return validateBusinessDuplicateGroups(groups,sessions,basis);
  if(!Array.isArray(groups)||groups.length>500)fail('重复回复组结构无效。');
  const map=new Map(sessions.map(s=>[s.id,s]));
  return groups.map(group=>{
    if(!group||!Array.isArray(group.sessionIds)||group.sessionIds.length<3||group.sessionIds.length>500||new Set(group.sessionIds).size!==group.sessionIds.length||typeof group.reason!=='string'||!group.reason.trim()||group.reason.length>2000)fail('重复回复组必须包含3条以上有效批次记录和理由。');
    const rows=group.sessionIds.map(id=>map.get(id));
    if(rows.some(s=>!s||!reply(s).trim())||!administrator(rows[0])||rows.some(s=>administrator(s)!==administrator(rows[0])))fail('重复回复证据须属于同一管理员的真实批次记录。');
    if(new Set(rows.map(s=>JSON.stringify([record(s).fileSha256,record(s).sheet,record(s).row]))).size!==rows.length)fail('重复回复证据不能用同一来源行克隆凑数。');
    if(group.kind!==undefined&&!['exact','similar'].includes(group.kind))fail('重复回复证据类别无效。');
    if(group.kind==='exact'&&rows.some(s=>reply(s).trim()!==reply(rows[0]).trim()))fail('完全重复证据组的实际回复不一致。');
    return{sessionIds:[...group.sessionIds],kind:group.kind==='exact'?'exact':'similar',reason:group.reason};
  });
}

export function mergeEcommerceResults({sessions,semanticResults,duplicateGroups,deterministic,allowPartial=false,basis,inspectionAt,runtime,pendingComparisons={}}){
  const byId=new Map(sessions.map(s=>[s.id,s]));
  if(!Array.isArray(semanticResults)||(!allowPartial&&semanticResults.length!==sessions.length)||new Set(semanticResults.map(r=>r.sessionId)).size!==semanticResults.length)fail('批次语义结果须完整覆盖全部记录。');
  const semantic=new Map();
  for(const row of semanticResults){
    if(!byId.has(row.sessionId)||!Array.isArray(row.results)||row.results.length!==4||new Set(row.results.map(r=>r.ruleId)).size!==4||row.results.some(r=>!semanticIds.includes(r.ruleId)||!['符合','不符合','无法判定','不适用'].includes(r.verdict)||typeof r.reason!=='string'||!r.reason.trim()))fail('语义结果未完整覆盖四个检查项。');
    semantic.set(row.sessionId,row.results);
  }
  const business=isBusinessEcommerceBasis(basis);
  const groups=business?validateBusinessDuplicateGroups([...(deterministic?.duplicateGroups??businessDuplicateGroups(sessions,basis)),...duplicateGroups],sessions,basis):validateDuplicateGroups([...(deterministic?.duplicateGroups??exactDuplicateGroups(sessions)),...validateDuplicateGroups(duplicateGroups,sessions)],sessions);
  const output=new Map();
  for(const s of sessions){
    if(!semantic.has(s.id))continue;
    const matches=groups.filter(g=>g.sessionIds.includes(s.id)),seen=new Set();
    const unique=matches.filter(g=>{const key=JSON.stringify([...g.sessionIds].sort());if(seen.has(key))return false;seen.add(key);return true;});
    const localTime=timeJudgment(s,{basis,inspectionAt,runtime});
    const results=[structuredClone((isStageATimeBasis(basis)||business)?localTime:deterministic?.times?.find(t=>t.sessionId===s.id)?.result??localTime),...semantic.get(s.id).map(item=>{
      const r=structuredClone(item),hasReply=Boolean(reply(s).trim());
      if(r.verdict==='不适用')r.verdict='符合';
      if(r.ruleId==='EC-TARGET'){const pending=pendingComparisons[s.id]||[];r.comparisonAssessment={status:pending.length?'incomplete':'completed',pendingBlockIds:pending,semanticVerdict:r.verdict,semanticReason:r.reason};if(pending.length&&r.verdict!=='不符合'){r.semanticReason=r.reason;r.verdict='无法判定';r.reason=`模板化回复③尚有 ${pending.length} 个相似比较块未完成，仅该子维度待人工/重跑；逐行针对性①②：${r.semanticReason}`;}}
      if(r.ruleId==='EC-TARGET'&&unique.length){
        r.semanticReason=r.reason;
        r.verdict='不符合';r.reason=`本批次${business?'不同来源行':'同一管理员'}回复重复/高度相似：${unique.map(g=>`${g.sessionIds.length}条记录，${g.reason}`).join('；')} 本条语义检查：${r.reason}`;
        if(r.reason.length>20000)r.reason=r.reason.slice(0,19940)+'…（摘要已截短；完整模型语义理由及批次证据分别保留）';
        r.batchEvidence=unique;r.fieldEvidence=[...new Set([...(r.fieldEvidence||[]),...fieldKeys(s,[11])])];
      }else if(!hasReply||(r.ruleId==='EC-TARGET'&&(!record(s).raw[8].trim()||(!business&&!administrator(s)&&r.verdict!=='不符合')))){
        r.verdict='无法判定';r.reason=!hasReply?'原表回复内容缺失，未编造回复，待补充后检查。':!record(s).raw[8].trim()?'评论内容缺失，无法核对回复针对性。':r.verdict==='不符合'?r.reason:'管理员缺失，无法完成本项的同客服批次重复检查。';
      }
      return r;
    })];
    if(results.some(r=>typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>20000))throw Object.assign(new Error('合并模型理由不完整或超限，未保存结果。'),{code:'invalid_output'});
    output.set(s.id,results);
  }
  return output;
}

export async function inspectEcommerceBatch({sessions,basis,client,config,signal,trace,inspectionAt=new Date().toISOString()}){
  const step=(id,input,operation)=>trace?.step?trace.step(id,input,operation):operation();
  await step('source',{sessions:sessions.map(workflowInput)},()=>{
    if(!sessions.length||sessions.length>500||new Set(sessions.map(s=>s.id)).size!==sessions.length)fail('电商评论批次范围无效。');
    for(const s of sessions){validateEcommerceRecord(s.ecommerce);validateEcommerceSource(s,{sourceId:s.externalId??s.id});}
    return{recordCount:sessions.length,sources:sessions.map(s=>({sessionId:s.id,...workflowInput(s).source})),missing:sessions.filter(s=>s.completeness!=='完整').map(s=>({sessionId:s.id,note:s.missingNote}))};
  });
  await step('basis',{basis},()=>{
    if(!isEcommerceBasis(basis))fail('电商评论任务的测试标准版本不匹配，请重新核对规则，未运行固定算法。');
    return{basis,scope:'本次完整导入批次，同一非空管理员分别比较',thresholds:sessions.map(s=>({sessionId:s.id,hours:s.ecommerce.thresholdHours}))};
  });
  const deterministic=await step('deterministic',{sessions:sessions.map(s=>({sessionId:s.id,administrator:administrator(s),reply:reply(s),commentTime:record(s).raw[12],replyTime:record(s).raw[13],...([2,3,4,5,6].includes(record(s).schemaVersion)?{dateSystem:record(s).dateSystem,normalizedTimes:ecommerceTimeValues(record(s))}:{}),thresholdHours:record(s).thresholdHours})),...(isStageATimeBasis(basis)?{ruleSet:basis.ruleSetSnapshot,inspectionAt}: {})},()=>({times:sessions.map(s=>({sessionId:s.id,result:timeJudgment(s,{basis,inspectionAt})})),duplicateGroups:exactDuplicateGroups(sessions)}));
  const skipped=isStageATimeBasis(basis)?sessions.filter(s=>!reply(s).trim()&&!record(s).raw[13].trim()):[],requested=sessions.filter(s=>!skipped.includes(s));
  const result=requested.length?await client.inspectEcommerce({config,sessions:requested,basis,signal,trace}):{records:[],duplicateGroups:[],modelId:config?.model,promptVersion:'ec-local-unreplied-v1'};
  const semanticResults=[...result.records,...skipped.map(s=>({sessionId:s.id,results:unrepliedSemanticResults()}))];
  const merged=await step('merge',{deterministic,semanticResults,duplicateGroups:result.duplicateGroups},()=>Object.fromEntries(mergeEcommerceResults({sessions,semanticResults,duplicateGroups:result.duplicateGroups,deterministic,basis,inspectionAt})));
  const outputs=new Map(Object.entries(merged));
  return{outputs,modelId:result.modelId,requestId:result.requestId,usage:result.usage,promptVersion:'ec-hybrid-v1'};
}
