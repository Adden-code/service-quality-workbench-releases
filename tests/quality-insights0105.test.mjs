import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRuleHealth,compareTaskReinspection,eligibleReinspectionPairs,sourcePosition} from '../public/quality-insights.mjs';
import {qualityInsightsButtons,ruleHealthView,reinspectionDiffView,reviewAuditView,createQualityInsightsManager} from '../public/quality-insights-ui.mjs';
import {setLocale} from '../public/i18n.mjs';

const sha='a'.repeat(64);
const rule=(id='R1',version='1')=>({id,version,title:`Synthetic ${id}`,ruleKind:'session-check',category:'产品信息',passCriteria:'Synthetic pass',failCriteria:'Synthetic fail',policyIds:['P1']});
const task=(id,rules=[rule()])=>({id,name:`Synthetic ${id}`,mode:'manual',scene:'synthetic-scene',createdAt:'2026-11-15T01:00:00Z',source:{sha256:sha,name:'synthetic.xlsx'},basisSnapshot:{rules,policies:[{id:'P1',version:'1',content:'Synthetic reference'}]}});
const result=(verdict='符合')=>({ruleId:'R1',verdict,reason:'Synthetic reason',evidence:[],source:'人工修改'});
const session=(id,taskId,verdict='符合',status='待审核',human)=>({id,taskId,externalId:`source-${id}`,expectedRuleIds:['R1'],aiExecution:{status:'completed'},aiResults:[result(verdict)],review:{status,drafts:human?{R1:result(human)}:{},history:[]},rawTranscript:{fileSha256:sha,sheet:'Synthetic sheet',sheetIndex:1,row:3,text:'Synthetic conversation',textSha256:'b'.repeat(64),raw:['Synthetic conversation'],columns:{text:0},timePolicy:{mode:'unavailable'}}});
function pair(){
  const before=task('before',[rule('R1'),rule('R2')]),after=task('after',[rule('R1','2'),rule('R3')]);after.reinspectionOf='before';after.createdAt='2026-11-15T02:00:00Z';
  const a=session('A','before','符合','已暂存','符合'),b=session('B','after','不符合','已确认','不符合');b.externalId=a.externalId;
  a.expectedRuleIds=['R1','R2'];b.expectedRuleIds=['R1','R3'];a.aiResults.push({...result('不适用'),ruleId:'R2'});b.aiResults.push({...result('无法判定'),ruleId:'R3'});
  return{tasks:[before,after],sessions:[a,b]};
}

test('rule health uses actual AI answers and confirmed human pairs, excludes failure placeholders and handled unknown from confirmation',()=>{
  const base=task('T',[rule(),{...rule('META'),ruleKind:'meta'}]);
  const records=[session('1','T','符合','已确认','符合'),session('2','T','不符合','已确认','符合'),session('3','T','无法判定','待补充','无法判定'),session('4','T','不符合','已暂存','符合'),session('5','T','无法判定','已确认','符合'),session('6','T')];
  records.forEach(row=>row.expectedRuleIds.push('META'));records[2].review.resolution={version:1,kind:'processed-unknown'};records[4].aiExecution.status='failed';records[5].aiExecution.status='unexecuted';
  const state={tasks:[base],sessions:records},original=structuredClone(state),health=buildRuleHealth(state),row=health.rows[0];
  assert.equal(health.rows.length,1);assert.equal(health.excludedMetaChecks,6);assert.equal(row.expectedChecks,6);
  assert.deepEqual(row.aiCoverage,{count:4,total:6,rate:4/6});assert.deepEqual(row.unknownRate,{count:1,total:4,rate:.25});assert.deepEqual(row.failTriggerRate,{count:2,total:4,rate:.5});
  assert.equal(row.technicalFailureChecks,1);assert.equal(row.unansweredChecks,2);assert.equal(row.humanIndependentChecks,1);
  assert.deepEqual(row.humanCoverage,{count:3,total:6,rate:.5});assert.deepEqual(row.humanChangeRate,{count:1,total:2,rate:.5});assert.equal(row.quoteRejectionRate,null);assert.equal(health.quoteRejectionHistoryAvailable,false);
  assert.deepEqual(state,original);
});

test('health separates scenes and frozen versions; archived stays included, voided is excluded and no sample means no rate',()=>{
  const a=task('A'),b=task('B',[rule('R1','2')]),c=task('C'),voided=task('VOID'),archived=task('ARCHIVED');c.scene='other-scene';voided.lifecycle={voidedAt:'2026-11-15'};archived.lifecycle={archivedAt:'2026-11-15'};
  const state={tasks:[a,b,c,voided,archived],sessions:[session('A','A'),session('B','B'),session('C','C'),session('VOID','VOID'),session('ARCHIVED','ARCHIVED')]};
  const report=buildRuleHealth(state);assert.equal(report.rows.length,3);assert.equal(report.taskCount,4);assert.equal(report.excludedVoidedTasks,1);assert.equal(report.rows.find(row=>row.scene==='synthetic-scene'&&row.version==='1').expectedChecks,2);assert.equal(report.rows[0].humanChangeRate.rate,null);
  assert.equal(buildRuleHealth(state,{scene:'other-scene'}).rows.length,1);assert.equal(buildRuleHealth(state,{taskIds:['VOID']}).rows.length,0);
});

test('same frozen version with different content is disclosed, while reopening human review removes it from confirmed samples',()=>{
  const a=task('A'),b=task('B');b.basisSnapshot.rules[0].passCriteria='Different frozen text';
  const one=session('1','A','不符合','已确认','符合'),two=session('2','B','不符合','已确认','符合'),state={tasks:[a,b],sessions:[one,two]};
  assert.equal(buildRuleHealth(state).rows[0].basisVariantCount,2);two.review.status='已暂存';assert.equal(buildRuleHealth(state).rows[0].pairedHumanChecks,1);
  one.review.disposition='unreplied';assert.equal(buildRuleHealth(state).rows[0].pairedHumanChecks,0);
});

test('parent-child diff separates AI flips, human changes, rule addition/removal/version and uses physical source coordinates',()=>{
  const state=pair(),copy=structuredClone(state),diff=compareTaskReinspection(state,{afterTaskId:'after'});
  assert.equal(diff.compatible,true);assert.equal(diff.relation,'parent-child');assert.equal(diff.sourceRows,1);assert.equal(diff.rows.length,3);
  assert.equal(diff.summary.aiFlips,1);assert.equal(diff.summary.aiComparable,1);assert.equal(diff.summary.humanFlips,1);assert.equal(diff.summary.addedRules,1);assert.equal(diff.summary.removedRules,1);assert.equal(diff.summary.versionChanges,1);
  const r1=diff.rows.find(row=>row.ruleId==='R1');assert.equal(r1.ruleChange,'version');assert.equal(r1.beforeHuman.confirmed,false);assert.equal(r1.afterHuman.confirmed,true);assert.equal(r1.source.row,3);
  assert.equal(diff.rows.find(row=>row.ruleId==='R2').ruleChange,'removed');assert.equal(diff.rows.find(row=>row.ruleId==='R3').ruleChange,'added');assert.deepEqual(eligibleReinspectionPairs(state).map(row=>[row.beforeTaskId,row.afterTaskId]),[['before','after']]);assert.deepEqual(state,copy);
});

test('a technical failure versus an answer is availability change, never an AI verdict flip',()=>{
  const state=pair();state.sessions[1].aiExecution.status='failed';const diff=compareTaskReinspection(state,{afterTaskId:'after'});
  assert.equal(diff.summary.aiFlips,0);assert.equal(diff.summary.aiComparable,0);assert.equal(diff.rows[0].afterAI.verdict,null);assert.equal(diff.rows[0].changed,true);
});

test('diff refuses source mismatches instead of guessing by external ID or array position',()=>{
  const cases=[
    ['source_mismatch',state=>state.tasks[1].source.sha256='c'.repeat(64)],
    ['source_position_missing',state=>delete state.sessions[1].rawTranscript],
    ['source_position_invalid',state=>state.sessions[1].rawTranscript.fileSha256='c'.repeat(64)],
    ['source_row_set_mismatch',state=>state.sessions[1].rawTranscript.row=4],
    ['source_content_mismatch',state=>state.sessions[1].rawTranscript.text='Changed content'],
    ['source_content_mismatch',state=>state.sessions[1].externalId='Changed ID'],
    ['source_rows_missing',state=>state.tasks[1].sessionIds=['absent']],
    ['duplicate_source_position',state=>state.sessions.push({...structuredClone(state.sessions[1]),id:'duplicate'})],
  ];
  for(const [reason,mutate] of cases){const state=pair();mutate(state);const diff=compareTaskReinspection(state,{afterTaskId:'after'});assert.equal(diff.compatible,false,reason);assert.equal(diff.reason,reason);assert.deepEqual(diff.rows,[]);}
});

test('explicit same-source comparison is supported, but a changed reference and same-version rule body remain visible',()=>{
  const state=pair();delete state.tasks[1].reinspectionOf;state.tasks[1].basisSnapshot.rules[0].version='1';state.tasks[1].basisSnapshot.rules[0].passCriteria='Changed';state.tasks[1].basisSnapshot.policies[0].content='Changed reference';
  const diff=compareTaskReinspection(state,{beforeTaskId:'before',afterTaskId:'after'});assert.equal(diff.compatible,true);assert.equal(diff.relation,'same-source');assert.equal(diff.rows[0].ruleChange,'content');assert.equal(diff.rows[0].policyChanged,true);
  assert.equal(sourcePosition(state.tasks[0],{...state.sessions[0],rawTranscript:undefined,contextFields:[{sourceRow:3}]}).valid,false);
});

test('UI exposes denominators and unavailable quote history, escapes source content, and renders English controls',()=>{
  const state=pair();state.tasks[0].basisSnapshot.rules[0].title='<script>unsafe</script>';const health=ruleHealthView(state,{language:'en'}),diff=reinspectionDiffView(state,'after',{language:'en'}),audit=reviewAuditView(state,{language:'en'});
  assert.match(health,/Human changes \/ confirmed with AI/);assert.match(health,/historical denominator is unavailable/);assert.match(health,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(health,/<script>/);
  assert.match(diff,/AI flips 1\/1/);assert.match(diff,/not proof of improvement/);assert.match(audit,/not authenticated identities/);
  assert.match(qualityInsightsButtons(state,{taskId:'before',language:'en'}),/data-act="review-audit-open" data-id="before"/);
  for(const [id,label] of [['quality-health-scene','Scene'],['quality-health-sort','Sort']])assert.match(health,new RegExp(`<label for="${id}">${label}</label><select[^>]+id="${id}"`));
  for(const [id,label] of [['quality-diff-before','Original batch'],['quality-diff-after','Reinspection batch']])assert.match(diff,new RegExp(`<label for="${id}">${label}</label><select[^>]+id="${id}"`));
  assert.match(diff,/<input id="quality-diff-changes"[^>]*> <label for="quality-diff-changes">Show changed checks only<\/label>/);
  assert.match(reinspectionDiffView(state,'after',{language:'zh'}),/<label for="quality-diff-before">原批次<\/label><select[^>]+id="quality-diff-before"/);
});

test('manager opens the latest child from a parent, changes filters, exports full data and never mutates state',async()=>{
  setLocale('en');const state=pair(),copy=structuredClone(state),downloads=[];let dialog=null,renders=0;
  const manager=createQualityInsightsManager({getState:()=>state,getDialog:()=>dialog,openDialog:value=>dialog=value,renderDialog:()=>renders++,download:(...args)=>downloads.push(args)});
  assert.equal(await manager.action('quality-diff-open',{dataset:{id:'before'}}),true);assert.equal(dialog.afterTaskId,'after');assert.equal(dialog.beforeTaskId,'before');assert.match(manager.dialog(dialog),/Reinspection differences/);
  manager.change({target:{id:'quality-diff-changes',checked:false}});assert.equal(dialog.changesOnly,false);assert.equal(renders,1);
  await manager.action('quality-diff-export');assert.equal(JSON.parse(downloads[0][0]).rows.length,3);
  await manager.action('quality-health-open',{dataset:{id:'before'}});manager.change({target:{id:'quality-health-sort',value:'unknown'}});assert.equal(dialog.sort,'unknown');await manager.action('quality-health-export');assert.equal(JSON.parse(downloads[1][0]).taskCount,1);
  assert.equal(manager.change({target:{id:'unrelated',value:'x'}}),false);assert.equal(await manager.action('unrelated'),false);assert.deepEqual(state,copy);setLocale('zh');
});

test('health pagination bounds DOM size while export retains all rules',async()=>{
  const rules=Array.from({length:103},(_,i)=>rule(`R${i+1}`)),state={tasks:[task('T',rules)],sessions:[]};let dialog,exported;
  const manager=createQualityInsightsManager({getState:()=>state,getDialog:()=>dialog,openDialog:value=>dialog=value,renderDialog(){},download:value=>exported=JSON.parse(value)});
  await manager.action('quality-health-open');assert.equal((manager.dialog(dialog).match(/<tr>/g)||[]).length,51);await manager.action('quality-insights-next');await manager.action('quality-insights-next');assert.equal(dialog.page,2);assert.equal((manager.dialog(dialog).match(/<tr>/g)||[]).length,4);await manager.action('quality-insights-next');assert.equal(dialog.page,2);await manager.action('quality-health-export');assert.equal(exported.rows.length,103);
});

test('choosing an unrelated original batch blocks both diff rendering and download without claiming a parent-child match',async()=>{
  const state=pair(),unrelated=task('UNRELATED');unrelated.source.sha256='f'.repeat(64);state.tasks.push(unrelated);let dialog,downloads=0;
  const manager=createQualityInsightsManager({getState:()=>state,getDialog:()=>dialog,openDialog:value=>dialog=value,renderDialog(){},download:()=>downloads++});
  await manager.action('quality-diff-open',{dataset:{id:'after'}});assert.equal(dialog.beforeTaskId,'before');manager.change({target:{id:'quality-diff-before',value:'UNRELATED'}});
  const view=manager.dialog(dialog);assert.match(view,/原文件SHA256不一致/);assert.match(view,/data-act="quality-diff-export" disabled/);assert.doesNotMatch(view,/已核验相同文件/);await manager.action('quality-diff-export');assert.equal(downloads,0);assert.match(dialog.error,/原文件SHA256/);
});

test('audit download waits for registration and a rejected registration cannot leak an unregistered download',async()=>{
  const state=pair();let dialog,downloads=0,release,reached;const entered=new Promise(resolve=>reached=resolve),captured=[];
  const ctx={getState:()=>state,getDialog:()=>dialog,openDialog:value=>dialog=value,renderDialog(){},download:()=>downloads++,beforeAuditDownload:async value=>{captured.push(value);reached();await new Promise(resolve=>release=resolve);}};
  const manager=createQualityInsightsManager(ctx);await manager.action('review-audit-open');const work=manager.action('review-audit-export');await entered;
  assert.deepEqual(captured,[{taskIds:['before','after']}]);assert.equal(downloads,0);assert.equal(dialog.exporting,true);await manager.action('review-audit-export');assert.equal(captured.length,1);release();await work;assert.equal(downloads,1);assert.equal(dialog.exporting,false);
  ctx.beforeAuditDownload=async()=>{throw new Error('Synthetic registration failure');};await manager.action('review-audit-export');assert.equal(downloads,1);assert.equal(dialog.error,'Synthetic registration failure');assert.equal(dialog.exporting,false);
});
