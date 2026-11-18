import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {workbook,readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {parseCleaningResult} from '../server/conversation-cleaning.mjs';
import {inspectConversationCleaningFile,applyCleaningResult,updateCleaningField,confirmCleaningRow,finalizeCleaningDraft,buildCleaningReportSnapshot,validateCleaningReportSnapshot} from '../public/conversation-cleaning.mjs';
import {consultationOriginalFromTables,loadConsultationOriginal} from '../server/consultation-source.mjs';
import {createConsultationDeliverySnapshot,buildConsultationDeliveryXlsx} from '../public/consultation-delivery.mjs';
import {BUILTIN_SCENARIOS,validateScenarioConfig} from '../public/scenarios.mjs';

const now='2026-11-11T10:00:00+08:00',reviewer='合成清洗核对员';
const sourceText='2026-11-11 09:00:00 客户：合成咨询\n2026-11-11 09:00:10 客服：我先核对正式资料。';
const rawHeaders=[' 会话ID ','客服','消息详情','产品','空列','备注'];
const rawValues=['  RAW-007  ',' 原坐席 ',sourceText,' 原产品列并未映射 ','','00001'];
const excludedValues=['','弃行坐席','不属于会话的原始汇总说明。','保留原值','','=仅文本'];
function physical(row,values){Object.defineProperty(values,XLSX_ROW_NUMBER,{value:row});return values;}

async function fixture(){
  const bytes=await workbook([{name:'原始业务',headers:['合成标题','','','','',''],rows:[rawHeaders,rawValues,excludedValues],rowNumbers:[3,7,13]}]);
  const source={name:'合成清洗原表.xlsx',size:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')};
  const file={...source,arrayBuffer:async()=>bytes};
  const inspected=await inspectConversationCleaningFile(file,{scene:'新品产品咨询',headerRow:3,timezone:'+08:00'});
  assert.equal(inspected.valid,true,inspected.errors.join(';'));
  let draft=inspected.draft;
  const input={scene:draft.scene,sourceName:source.name,sheet:draft.sheet,row:7,sessionId:rawValues[0],agent:rawValues[1],text:sourceText,timezone:'+08:00'};
  const result=parseCleaningResult(JSON.stringify({segments:sourceText.split('\n').map(line=>({kind:'message',sourceQuote:line,textQuote:line.slice(line.indexOf('：')+1),role:line.includes(' 客户：')?'客户':'客服',roleQuote:line.includes(' 客户：')?'客户':'客服',atQuote:line.slice(0,19)}))}),input);
  draft=applyCleaningResult(draft,7,result,{now});
  for(const [field,value] of [['id','HUMAN-RENAMED-007'],['agent','人工核对后坐席'],['product','人工补录产品'],['startedAt','2026-11-11T09:00:00+08:00'],['completeness','完整']])draft=updateCleaningField(draft,7,null,field,value,{reason:`人工对照原件核对${field}`,now});
  draft=confirmCleaningRow(draft,7,{reviewer,now});
  draft=updateCleaningField(draft,13,null,'excluded',true,{reason:'这是汇总说明，非独立会话；原行保留供追溯。',now});
  draft=confirmCleaningRow(draft,13,{reviewer,now});
  const parsed=await finalizeCleaningDraft(draft,{source,reviewer,now});
  assert.equal(parsed.valid,true,parsed.errors.join(';'));
  const basisSnapshot=createBasisSnapshot(createCatalog(),{effectiveDate:'2026-11-11',ruleIds:['R001'],now});
  const state=createImportedTask(createBusinessState(),{name:'合成清洗交付任务',fileName:source.name,source,sessions:parsed.sessions,basisSnapshot,reviewer,cleaningReportSnapshot:parsed.cleaningReportSnapshot,now});
  const task=state.tasks[0],tables=await readXlsx(bytes),store={getSource:async sha=>{assert.equal(sha,source.sha256);return{...source,bytes};}};
  return {bytes,source,draft,parsed,state,task,tables,store};
}

test('cleaning source joins reviewed IDs to physical raw rows and preserves original headers and all cell values',async()=>{
  const f=await fixture(),before=JSON.stringify(f.state);
  const original=consultationOriginalFromTables(f.state,f.task,f.tables);
  assert.equal(original.sheetName,'原始业务');assert.equal(original.headerRow,3);assert.equal(original.messageColumn,2);
  assert.deepEqual(original.headers,rawHeaders);
  assert.deepEqual(original.rows,[{sourceRow:7,values:rawValues,recordId:f.state.sessions[0].id}]);
  assert.equal(f.state.sessions[0].externalId,'HUMAN-RENAMED-007');
  assert.equal(original.rows[0].values[0],'  RAW-007  ');
  assert.equal(original.rows[0].values[1],' 原坐席 ');
  assert.equal(original.rows[0].values[2],sourceText);
  assert.equal(JSON.stringify(f.state),before,'delivery source mapping must remain read only');
});

test('archived cleaning XLSX produces a delivery that retains excluded raw rows with review reasons',async()=>{
  const f=await fixture(),original=await loadConsultationOriginal(f);
  assert.equal(original.rows.length,1);
  const excluded=original.additionalSheets.find(sheet=>sheet.sheetName.includes('清洗弃行'));
  assert.ok(excluded,'excluded source rows must remain attached to the exported original');
  assert.equal(excluded.headerRow,3);assert.deepEqual(excluded.headers.slice(0,rawHeaders.length),rawHeaders);
  assert.equal(excluded.rows[0].sourceRow,13);
  assert.deepEqual(excluded.rows[0].values.slice(0,rawHeaders.length),excludedValues);
  assert.ok(excluded.rows[0].values.includes(f.task.cleaningReportSnapshot.rows[1].manual.excluded.reason));
  assert.ok(excluded.rows[0].values.includes(reviewer));
  const snapshot=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,now}),output=await readXlsx(await buildConsultationDeliveryXlsx(snapshot));
  assert.deepEqual(output['检核明细'][1].slice(0,rawHeaders.length),rawValues);
  assert.equal(output['检核明细'][1][XLSX_ROW_NUMBER],7);
  const attached=Object.entries(output).find(([name])=>name.includes('清洗弃行'))?.[1];
  assert.ok(attached);assert.deepEqual(attached[1].slice(0,rawHeaders.length),excludedValues);
  assert.equal(attached[1][XLSX_ROW_NUMBER],13);
  assert.ok(attached[1].some(value=>String(value).includes('非独立会话')));
});

test('cleaning product provenance stays unprovided without an explicit original product mapping',async()=>{
  const f=await fixture(),original=consultationOriginalFromTables(f.state,f.task,f.tables);
  assert.equal(f.state.sessions[0].product,'人工补录产品');
  assert.deepEqual(original.productSources[f.state.sessions[0].id],{value:'',source:'未提供'});
  const snapshot=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,now});
  assert.equal(snapshot.records[0].product,'未提供');assert.equal(snapshot.records[0].productSource,'未提供');
});

test('every raw data row must have cleaning audit coverage and every audit row must still exist in the source',async()=>{
  for(const alter of [f=>f.tables['原始业务'].push(physical(20,['UNEXPLAINED','坐席','未解释原行','','',''])),f=>f.tables['原始业务'].splice(3,1)]){
    const f=await fixture();alter(f);
    assert.throws(()=>consultationOriginalFromTables(f.state,f.task,f.tables),/清洗报告.*归档原表.*行|归档原表.*清洗.*行/);
  }
  const f=await fixture(),draft=structuredClone(f.draft);draft.rows=draft.rows.filter(row=>!row.excluded);
  f.task.cleaningReportSnapshot=buildCleaningReportSnapshot(draft,{source:f.source,reviewer,now});
  assert.equal(validateCleaningReportSnapshot(f.task.cleaningReportSnapshot,{source:f.source,sessions:f.state.sessions}),true);
  assert.throws(()=>consultationOriginalFromTables(f.state,f.task,f.tables),/清洗报告.*归档原表.*行|归档原表.*清洗.*行/);
});

test('cleaning mapping refuses tampered original cells, lost physical locations, and altered column bindings',async()=>{
  for(const alter of [f=>f.tables['原始业务'][2][0]='伪造原ID',f=>f.tables['原始业务'][2][2]='伪造原文',f=>f.tables['原始业务'][2]=physical(8,[...rawValues]),f=>f.task.cleaningReportSnapshot.columns.text='客服']){
    const f=await fixture();alter(f);
    assert.throws(()=>consultationOriginalFromTables(f.state,f.task,f.tables),/清洗|原件|源文本|来源|原表/);
  }
});

test('cleaning report still verifies source binding, human audit history, and final session content',async()=>{
  for(const alter of [f=>f.task.cleaningReportSnapshot.source.sha256='f'.repeat(64),f=>f.task.cleaningReportSnapshot.rows[0].history.find(event=>event.field==='id').from='无此历史值',f=>f.task.cleaningReportSnapshot.rows[1].manual.excluded.reason='',f=>f.state.sessions[0].turns[0].text='修改后未留痕']){
    const f=await fixture();alter(f);
    assert.throws(()=>consultationOriginalFromTables(f.state,f.task,f.tables),/清洗报告|弃行|人工|留痕|来源|一致/);
  }
  const f=await fixture();await assert.rejects(loadConsultationOriginal({...f,store:{getSource:async()=>({...f.source,bytes:new Uint8Array([1,2,3])})}}),/指纹|摘要|不一致/);
});

test('cleaning agent grouping uses the frozen original agent column and never normalized agent or product values',async()=>{
  const f=await fixture(),{builtin,...base}=structuredClone(BUILTIN_SCENARIOS[0]);
  const scenario=validateScenarioConfig({...base,id:'SCENE-CLEAN-SYN',name:'合成清洗场景',report:{...base.report,groupBy:'agent',groupLabel:'客服'}});
  f.task.scene=scenario.id;f.task.scenarioSnapshot=scenario;f.task.cleaningReportSnapshot.scene=scenario.id;f.state.sessions[0].scene=scenario.id;
  const original=consultationOriginalFromTables(f.state,f.task,f.tables);
  assert.deepEqual(original.groupSources[f.state.sessions[0].id],{value:'原坐席',source:'原表列',column:'客服'});
  f.task.scenarioSnapshot.report={...scenario.report,groupBy:'context',groupField:'campaign',groupLabel:'活动'};
  assert.throws(()=>consultationOriginalFromTables(f.state,f.task,f.tables),/分组.*冻结|扩展.*映射|分组.*来源/);
});
