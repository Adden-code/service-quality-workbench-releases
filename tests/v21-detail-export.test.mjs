import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedFixture,sourceRow,cutoff} from './v21-runtime-fixtures.mjs';
import {confirmUnrepliedReview} from '../public/domain.mjs';
import {EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';
import {buildResultXlsx,readXlsx,buildHtmlReport} from '../public/io.mjs';

test('Stage A detail exports retain raw22, cutoff and fact confirmation without counting quality pass',async()=>{
  let {state}=publishedFixture([sourceRow({reply:'',replyAt:''})]);
  const task=state.tasks[0],s=state.sessions[0];task.aiRun={id:'export-a',inspectionAt:cutoff};
  s.aiExecution={status:'completed',runId:'export-a'};
  s.aiResults=[timeJudgment(s,{basis:task.basisSnapshot,inspectionAt:cutoff}),...EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'无法判定',reason:'无回复正文',evidence:[],referenceIds:[]}))];
  state=confirmUnrepliedReview(state,s.id,'工程事实审核员','2026-11-03T13:00:00+08:00');
  const options={taskId:task.id},tables=await readXlsx(await buildResultXlsx(state,options));
  const rowObject=(sheet,index=1)=>Object.fromEntries(sheet[0].map((header,column)=>[header,sheet[index][column]??'']));
  const detail=rowObject(tables['结果明细']),summary=rowObject(tables['会话汇总']),batch=rowObject(tables['批次统计']);
  assert.equal(detail['阶段口径'],'V2.1-A（时效升级；其他四项V1）');assert.equal(detail['回复事实'],'未回复');assert.equal(detail['检核截止点'],cutoff);assert.equal(detail['人工确认类型'],'未回复事实已确认');
  assert.equal(summary['会话结论'],'未回复事实已确认');assert.equal(summary['已确认检查项数'],'');
  assert.equal(batch['质量分母'],'0');assert.equal(batch['未回复事实数'],'1');assert.equal(batch['未回复事实已确认数'],'1');assert.equal(batch['无不符合占比'],'');
  const source=tables['电商原表留存'];assert.equal(source[1].length,26);assert.deepEqual(source[1].slice(4),s.ecommerce.raw);
  const html=buildHtmlReport(state,options);for(const term of ['未回复事实已确认','质量分母','原人工参考为旧口径','电商原表留存',cutoff])assert.ok(html.includes(term),term);
  assert.doesNotMatch(html,/连续计时；测试阈值1小时/);
  assert.ok(!html.includes('人工最终结论：未确认'),'事实已确认不显示质量未确认标题');
});

test('pending Stage A exports count immutable unreplied source facts before AI without inventing elapsed results',async()=>{
  const {state}=publishedFixture([sourceRow({reply:'',replyAt:''})]);
  const tables=await readXlsx(await buildResultXlsx(state,{includePending:true}));
  const batch=Object.fromEntries(tables['批次统计'][0].map((h,i)=>[h,tables['批次统计'][1][i]??'']));
  assert.equal(batch['未回复事实数'],'1');assert.equal(batch['未回复事实已确认数'],'0');assert.equal(batch['质量分母'],'0');
  const detail=Object.fromEntries(tables['结果明细'][0].map((h,i)=>[h,tables['结果明细'][1][i]??'']));
  assert.equal(detail['时效结果'],'尚未计算');assert.equal(detail['累计时长毫秒'],'');
});

test('long frozen calendar and policy text survive Excel cell limits through complete continuation rows',async()=>{
  const holidays=Array.from({length:3660},(_,i)=>new Date(Date.UTC(2000,0,1+i)).toISOString().slice(0,10));
  const {state}=publishedFixture([sourceRow()],{ruleSetChanges:{timeRule:{mode:'workingHours',calendar:{workdays:['Mon','Tue','Wed','Thu','Fri'],workStart:'09:00',workEnd:'18:00',timezone:'UTC+08:00',holidays,workingDates:[]},thresholds:{default:24,byType:{}},unrepliedRule:true,replyDetection:'bothEmpty'}}});
  const before=JSON.stringify(state),tables=await readXlsx(await buildResultXlsx(state,{includePending:true}));
  const headers=tables['结果明细'][0],value=tables['结果明细'][1][headers.indexOf('时效冻结配置')];
  const ref=value.match(/长文本留存：(TEXT-\d+)/)?.[1];assert.ok(ref,'长配置显式引用续表');
  const parts=tables['长文本留存'].slice(1).filter(row=>row[0]===ref);assert.ok(parts.length>1);
  assert.deepEqual(JSON.parse(parts.map(row=>row[3]).join('')),state.tasks[0].basisSnapshot.ruleSetSnapshot);
  for(const sheet of Object.values(tables))for(const row of sheet)for(const cell of row)assert.ok(cell.length<=32767,'Excel单元格限制');
  assert.equal(JSON.stringify(state),before);assert.ok(buildHtmlReport(state,{includePending:true}).includes(holidays.at(-1)));
});
