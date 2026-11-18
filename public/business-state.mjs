// One-way, versioned isolation of identifiable fixture material. Original records remain in the archive.
import {demoSessions} from './domain.mjs';
import {createDemoCatalog,validateCatalog} from './catalog.mjs';
import {RAW_INPUT_MODE,isRawTranscriptSession} from './raw-transcript.mjs';

export const BUSINESS_MIGRATION_VERSION=1;
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
// Scene assignment was added after legacy fixtures shipped; it is not source content.
const sameCatalogContent=(left,right)=>same(Object.fromEntries(Object.entries(left).filter(([field])=>field!=='sceneIds')),Object.fromEntries(Object.entries(right).filter(([field])=>field!=='sceneIds')));
const key=record=>JSON.stringify([record.id,record.version]);
const turnBody=session=>session.turns?.map(({id,role,text})=>({id,role,text}));
const fixtureBodies=demoSessions.map(turnBody);

export function isLegacyDemoTask(task,sessions=[]){
  if(task.inputMode===RAW_INPUT_MODE||sessions.some(session=>session.taskId===task.id&&isRawTranscriptSession(session)))return false;
  if(task.mode==='manual')return false;
  if(task.mode==='demo')return true;
  // Pre-mode versions only allowed this fixed template source. Do not infer unknown imported records.
  return task.mode===undefined&&task.ruleSetId==='RS-PRESALES-V1'&&task.sessionIds?.length>0&&
    task.sessionIds.every(id=>{const session=sessions.find(item=>item.id===id&&item.taskId===task.id);return session&&fixtureBodies.some(body=>same(body,turnBody(session)));});
}

export function migrateBusinessWorkspace({state,catalog}){
  validateCatalog(catalog);
  if(state.businessMigrationVersion===BUSINESS_MIGRATION_VERSION)return {state:clone(state),catalog:clone(catalog),changed:false};
  if(state.businessMigrationVersion!==undefined)throw new Error('业务工作区迁移版本不受支持，请保留原记录并检查服务版本。');
  if(state.legacyDemoArchive!==undefined)throw new Error('旧演示归档已存在但缺少迁移版本，请保留原记录并人工核对。');
  const nextState=clone(state),nextCatalog=clone(catalog),taskIds=new Set(state.tasks.filter(task=>isLegacyDemoTask(task,state.sessions)).map(task=>task.id));
  const demoTasks=state.tasks.filter(task=>taskIds.has(task.id)),demoSessions=state.sessions.filter(session=>taskIds.has(session.taskId)),sessionIds=new Set(demoSessions.map(session=>session.id));
  const archivedEvent=event=>taskIds.has(event.taskId)||sessionIds.has(event.sessionId);
  const fixture=createDemoCatalog(),archivedRules=nextCatalog.rules.filter(record=>fixture.rules.some(expected=>sameCatalogContent(expected,record)));
  // A customized rule may still reference an original policy. Keep that policy available in the business catalog.
  const ruleKeys=new Set(archivedRules.map(key)),retainedRules=nextCatalog.rules.filter(record=>!ruleKeys.has(key(record))),neededPolicyIds=new Set(retainedRules.flatMap(rule=>rule.policyIds));
  const archivedPolicies=nextCatalog.policies.filter(record=>!neededPolicyIds.has(record.id)&&fixture.policies.some(expected=>sameCatalogContent(expected,record))),policyKeys=new Set(archivedPolicies.map(key));
  const archivedCatalogEvent=event=>(event.kind==='rules'?ruleKeys:policyKeys).has(key(event));
  nextState.tasks=nextState.tasks.filter(task=>!taskIds.has(task.id));nextState.sessions=nextState.sessions.filter(session=>!taskIds.has(session.taskId));nextState.activity=nextState.activity.filter(event=>!archivedEvent(event));
  nextCatalog.rules=retainedRules;nextCatalog.policies=nextCatalog.policies.filter(record=>!policyKeys.has(key(record)));nextCatalog.events=nextCatalog.events.filter(event=>!archivedCatalogEvent(event));
  if(demoTasks.length||archivedRules.length||archivedPolicies.length){
    nextState.legacyDemoArchive={schemaVersion:1,tasks:clone(demoTasks),sessions:clone(demoSessions),activity:clone(state.activity.filter(archivedEvent)),catalog:{schemaVersion:1,rules:clone(archivedRules),policies:clone(archivedPolicies),events:clone(catalog.events.filter(archivedCatalogEvent))}};
  }
  nextState.businessMigrationVersion=BUSINESS_MIGRATION_VERSION;validateCatalog(nextCatalog);
  return {state:nextState,catalog:nextCatalog,changed:true};
}
