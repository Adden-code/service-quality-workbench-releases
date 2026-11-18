import test from 'node:test';
import assert from 'node:assert/strict';
import {e,dateTime,icon} from '../public/ui.mjs';
import * as uiHelpers from '../public/ui.mjs';
import {overviewView,exportsView} from '../public/views.mjs';
import {createInitialState} from '../public/domain.mjs';
import {reviewView,humanFooter} from '../public/review-view.mjs';

test('用户内容安全转义，保留中文与换行',()=>{
  assert.equal(e('<script>"客户" & \'客服\'</script>\n下一行'),'&lt;script&gt;&quot;客户&quot; &amp; &#39;客服&#39;&lt;/script&gt;\n下一行');
});
test('原文轮次可显示时分，完整时间按北京时间显示',()=>{
  assert.equal(dateTime('09:30'),'09:30');
  assert.equal(dateTime('2026-10-18T01:30:00Z'),'10/18 09:30');
  assert.equal(dateTime(''),'—');
});
test('无匹配会话时显示空态，不保留上一条原文',()=>{
  const ui={reviewQuery:'不存在的会话',reviewTaskId:'',reviewStatus:'全部',selectedId:'DEMO_PRE001',openRules:['R001'],highlightedTurns:[2],resultFilter:'全部'};
  const html=reviewView(createInitialState(),ui);
  assert.ok(html.includes('没有可审核的会话'));
  assert.ok(!html.includes('id="messages"'));
});
test('参考条款标题区分同一资料的多个引用',()=>{
  const ui={reviewQuery:'',reviewTaskId:'',reviewStatus:'全部',selectedId:'DEMO_PRE004',openRules:['R003'],highlightedTurns:[4],resultFilter:'全部'};
  const html=reviewView(createInitialState(),ui);
  assert.ok(html.includes('出库口径'));
  assert.ok(html.includes('时效咨询回应'));
});

const reviewUi=()=>({reviewQuery:'',reviewTaskId:'',reviewStatus:'全部',selectedId:'DEMO_PRE001',openRules:['R001'],highlightedTurns:[2],resultFilter:'全部'});
test('审核页直接展示被引用条款正文和生效版本',()=>{
  const html=reviewView(createInitialState(),reviewUi());
  assert.match(html,/class="policy-quote"/);
  assert.ok(html.includes('支持66W有线充电，不支持无线充电。不得混用 Pro 版本参数。'));
  assert.ok(html.includes('生效日期 2026-10-01'));
  assert.ok(html.includes('P001-1'));
  assert.ok(html.includes('V1.0'));
});
test('待审核与人工最终结论分开展示，操作坞保留人工确认',()=>{
  const html=reviewView(createInitialState(),reviewUi());
  assert.match(html,/class="human-status"/);
  assert.match(html,/人工最终结论/);
  assert.match(html,/待确认/);
  assert.match(html,/class="review-dock"/);
  assert.match(html,/data-act="confirm-review"/);
  assert.match(html,/data-act="save-draft"/);
  assert.match(html,/data-act="pending"/);
});
test('图标使用本地正式图标库而不是手绘路径',()=>{
  assert.match(icon('review'),/feather-sprite\.svg#file-text/);
  assert.doesNotMatch(icon('review'),/<path/);
});
test('悬浮操作区跟随最后展开的检查项，不误改前一项',()=>{
  const ui={...reviewUi(),openRules:['R001','R003']};
  const dock=reviewView(createInitialState(),ui).split('class="review-dock"')[1];
  assert.ok(dock.includes('data-rule="R003"'));
  assert.ok(dock.includes('data-id="P003-1"'));
});
test('结果抬头同排展示状态，检查项标题明确AI初判身份',()=>{
  const html=reviewView(createInitialState(),reviewUi());
  assert.ok(html.includes('class="results-titlebar"'));
  const heading=html.split('data-id="R001"')[1].split('</button>')[0];
  assert.ok(heading.includes('AI初判 · 不符合'));
});

test('规则详情常驻且关闭项隐藏，标题与详情有唯一无障碍关联',()=>{
  const html=reviewView(createInitialState(),reviewUi());
  assert.equal((html.match(/class="result-details"/g)||[]).length,7);
  assert.match(html,/data-rule-card="R001"/);
  assert.match(html,/aria-controls="rule-details-R003"/);
  assert.match(html,/id="rule-details-R003"[^>]*hidden/);
  assert.doesNotMatch(html,/id="rule-details-R001"[^>]*hidden/);
});

test('局部更新已确认会话的操作坞时保留真实最终结论',()=>{
  const state=createInitialState(),session=state.sessions.find(s=>s.id==='DEMO_PRE001');
  session.review.status='已确认';
  assert.ok(humanFooter(session,'',reviewUi()).includes('不符合'));
});

test('焦点初次落在弹窗容器时，正反向Tab均进入弹窗而非逃到页面',()=>{
  assert.equal(typeof uiHelpers.focusCycleTarget,'function');
  const first={},middle={},last={},container={},elements=[first,middle,last];
  assert.equal(uiHelpers.focusCycleTarget(elements,container,false),first);
  assert.equal(uiHelpers.focusCycleTarget(elements,container,true),last);
  assert.equal(uiHelpers.focusCycleTarget(elements,first,true),last);
  assert.equal(uiHelpers.focusCycleTarget(elements,last,false),first);
  assert.equal(uiHelpers.focusCycleTarget(elements,middle,false),null);
  assert.equal(uiHelpers.focusCycleTarget([],container,true),null);
});

test('export page offers separate detail and management report cards and actions',()=>{
  const html=exportsView(createInitialState(),{exportTaskId:'',includePending:false,reportPeriod:'month'});
  assert.match(html,/data-report-kind="detail"/);assert.match(html,/data-report-kind="management"/);
  assert.match(html,/下载质检明细报告/);assert.match(html,/下载管理分析报告/);
  assert.match(html,/data-act="export-management"/);assert.match(html,/id="report-period"/);
  assert.doesNotMatch(html,/下载可阅读报告/);
});

test('overview legend compares conversation counts and keeps failed checks in their distribution',()=>{
  const html=overviewView(createInitialState(),{period:'month'});
  assert.match(html,/已审核会话数（条）/);assert.match(html,/问题会话数（条）/);
  assert.doesNotMatch(html,/<span><i><\/i>不符合检查项<\/span>/);
  assert.match(html,/按人工最终确认的不符合检查项/);
});
