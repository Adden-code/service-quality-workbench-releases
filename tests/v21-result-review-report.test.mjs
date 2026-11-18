import test from 'node:test';
import assert from 'node:assert/strict';
import {manualResultCard,manualHumanFooter} from '../public/business-review.mjs';
import {businessDialog} from '../public/business-dialogs.mjs';
import {reviewView} from '../public/review-view.mjs';
import {getManagementReport,buildManagementHtml} from '../public/management-report.mjs';
import {exportsView,overviewView} from '../public/views.mjs';
import * as ecommerceResults from '../public/ecommerce-results.mjs';
import * as domain from '../public/domain.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';
import {EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {ecommerceReferenceView} from '../public/ecommerce-ui.mjs';
import {publishedFixture,sourceRow,cutoff} from './v21-runtime-fixtures.mjs';

const uiFor=session=>({dataMode:'manual',selectedId:session.id,reviewStatus:'全部',reviewQuery:'',reviewTaskId:session.taskId,resultFilter:'全部',openRules:['EC-TIME'],highlightedTurns:[],showReviewRecords:true,period:'batch',dashboardTaskId:session.taskId,reportPeriod:'batch',reportTaskId:session.taskId,exportTaskId:session.taskId,includePending:true});
function fixture(rows=[sourceRow({reply:'',replyAt:''})]){
  const {state}=publishedFixture(rows),task=state.tasks[0];
  task.aiRun={id:'result-ui-run',inspectionAt:cutoff};
  for(const s of state.sessions){
    s.aiExecution={status:'completed',runId:task.aiRun.id};
    s.aiResults=[timeJudgment(s,{basis:task.basisSnapshot,inspectionAt:cutoff}),...EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:s.ecommerce.raw[9]?'符合':'无法判定',reason:s.ecommerce.raw[9]?'虚构内容检查完成':'无回复正文，未取得内容判断',evidence:[],referenceIds:[]}))];
  }
  return state;
}
const confirmFact=state=>domain.confirmUnrepliedReview(state,state.sessions[0].id,'事实确认员','2026-11-03T13:00:00+08:00');

test('Stage A time card shows independent reply fact and frozen local calculation evidence',()=>{
  const state=fixture(),s=state.sessions[0],html=manualResultCard(state,s,domain.getSessionResults(s)[0],uiFor(s),false);
  for(const text of ['未回复','V2.1-A（时效升级；其他四项V1）','本地时效计算','2026-11-03T12:00:00+08:00','24','分类阈值','原O列','UTC+08:00','日历尚未业务核对'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/AI初判 · 符合|未回复 · 符合/);
  assert.match(html,/未回复事实不等于质量通过或不通过/);
});
test('content present without reply time is missing-time, never the unreplied confirmation path',()=>{
  const state=fixture([sourceRow({reply:'虚构回复正文',replyAt:''})]),s=state.sessions[0];
  const html=manualResultCard(state,s,domain.getSessionResults(s)[0],uiFor(s),false);
  assert.match(html,/data-time-status="missing-time"/);assert.match(html,/时间缺失待补充/);assert.doesNotMatch(manualHumanFooter(s,'无法判定',uiFor(s),state),/data-act="confirm-unreplied"/);
});
test('unreplied review has explicit fact action, guarded dialog, and distinct confirmed result',()=>{
  const state=fixture(),s=state.sessions[0],ui=uiFor(s);
  const footer=manualHumanFooter(s,'无法判定',ui,state);assert.match(footer,/data-act="confirm-unreplied"/);assert.doesNotMatch(footer,/data-act="confirm-review"/);
  const dialog=businessDialog({type:'confirm-unreplied'},state,ui);assert.match(dialog.body,/data-act="commit-unreplied"/);assert.match(dialog.body,/只确认.*未回复事实/);assert.match(dialog.body,/不形成质量通过或不通过/);
  const next=confirmFact(state),confirmed=next.sessions[0],html=manualHumanFooter(confirmed,'符合',ui,next);
  assert.match(html,/未回复事实已确认/);assert.doesNotMatch(html,/人工最终结论[^]*badge[^>]*>符合/);
});
test('management quality uses quality reviews only and lists unreplied facts separately',()=>{
  let state=confirmFact(fixture([sourceRow({reply:'',replyAt:'',row:3}),sourceRow({row:4})]));
  const s=state.sessions[1];
  for(const ruleId of EC_RULE_IDS)state=domain.saveReview(state,s.id,{ruleId,verdict:ruleId==='EC-TEXT'?'不符合':'符合',reason:'已按冻结规则核对虚构原文',evidence:[],referenceIds:[]},'2026-11-03T13:01:00+08:00');
  state=domain.confirmReview(state,s.id,'2026-11-03T13:02:00+08:00');
  const options={period:'batch',taskId:s.taskId,referenceDate:'2026-11-03'},report=getManagementReport(state,options);
  assert.equal(report.stats.reviewedCount,2);assert.equal(report.qualityReviewedCount,1);assert.equal(report.problemRate,100);
  assert.equal(report.quality.reduce((n,r)=>n+r.count,0),1);assert.equal(report.quality.find(r=>r.key==='undetermined').count,0);
  const html=buildManagementHtml(state,options);assert.match(html,/未回复事实/);assert.match(html,/质量分母.*1/);assert.match(html,/V2.1-A（时效升级；其他四项V1）/);
  assert.match(exportsView(state,uiFor(s)),/质量分母.*1/);assert.match(overviewView(state,uiFor(s)),/未回复.*1/);
});
test('only confirmed unreplied facts yield no quality percentage or quality category',()=>{
  const state=confirmFact(fixture()),report=getManagementReport(state,{period:'all',referenceDate:'2026-11-03'});
  assert.equal(report.qualityReviewedCount,0);assert.equal(report.problemRate,null);assert.equal(report.quality.reduce((n,r)=>n+r.count,0),0);
  const html=buildManagementHtml(state,{period:'all',referenceDate:'2026-11-03'});assert.match(html,/暂无人工已确认质量结果/);assert.doesNotMatch(report.findings.join(''),/问题会话占比为0|全部通过|质量合格/);
});
test('review and preview preserve old reference boundaries and expose stable Stage A export cells',()=>{
  const state=fixture(),s=state.sessions[0],ui=uiFor(s),html=reviewView(state,ui);
  assert.match(html,/原人工参考.*旧口径/);assert.match(html,/规则版本与时点未核实/);assert.match(html,/差异.*不等同于AI错误或准确率/);
  assert.match(exportsView(state,ui),/未回复/);
  assert.equal(typeof ecommerceResults.ecommerceTimeExportFields,'function');
  const cells=ecommerceResults.ecommerceTimeExportFields(state,s);assert.equal(cells['阶段口径'],'V2.1-A（时效升级；其他四项V1）');assert.equal(cells['回复事实'],'未回复');assert.equal(cells['检核截止点'],cutoff);assert.equal(cells['时效阈值小时'],24);assert.equal(cells['人工确认类型'],'尚未确认');
  const legacy=structuredClone(state);delete legacy.tasks[0].basisSnapshot.ruleSetSnapshot;assert.deepEqual(ecommerceResults.ecommerceTimeExportFields(legacy,legacy.sessions[0]),{});
});
test('reference table keeps original labels while separating local facts from absent quality judgments',()=>{
  const state=confirmFact(fixture()),s=state.sessions[0],html=ecommerceReferenceView(s,state);
  assert.match(html,/本地时效 · 未回复/);assert.match(html,/未回复事实已确认/);assert.match(html,/未取得质量判断/);assert.match(html,/OLD-HUMAN-REF-NEVER-MODEL/);
  assert.doesNotMatch(html,/data-column="final">符合/);
  assert.doesNotMatch(html,/测试阈值1小时|连续自然时间/);
});
