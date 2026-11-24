import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryUnitProgress,deliveryJobProgress,deliveryJobStatus,combinedReportProgress,combinedReportStatus,deliveryProgressCaption} from '../public/delivery-progress.mjs';
import {projectIncompleteDelivery,adoptIncompleteDelivery} from '../server/delivery-progress.mjs';
import {reportHistoryView} from '../public/report-history-view.mjs';
import {businessExportView} from '../public/business-export-view.mjs';
import {englishBusinessExportView,reportTranslationView} from '../public/report-export-view.mjs';
import {managerState,businessUI,reportFixture,summaryFixture} from './business-report-fixtures.mjs';
import {getLocale,setLocale} from '../public/i18n.mjs';
const job=(status,nodes)=>({id:'synthetic',taskId:'task',status,nodes});
test('completed and genuinely inapplicable nodes settle; missing nodes never count as skips',()=>{
 const nodes=[{status:'completed'},{status:'completed',notApplicable:true},{status:'skipped'},{status:'pending'},{status:'failed'}],p=deliveryUnitProgress(nodes);
 assert.deepEqual(p,{total:5,done:3,skipped:2,failed:1,pending:1,running:0,settled:4,percent:80});
 assert.equal(deliveryJobStatus(job('completed',nodes)),'incomplete');
 assert.match(deliveryProgressCaption(p),/不适用 2.*失败 1.*等待 1.*80%/);
});
test('English title and progress cover both stages including cold/historical remount',()=>{
 const base=job('completed',[{status:'completed'}]);
 const model={job:base};assert.equal(combinedReportStatus(model,'zh'),'completed');assert.equal(combinedReportProgress(model,'zh').percent,100);
 assert.equal(combinedReportStatus(model,'en'),'awaiting_translation');assert.equal(combinedReportProgress(model,'en').percent,50);
 model.translationJob=job('running',[{status:'pending'}]);assert.equal(combinedReportStatus(model,'en'),'running');
 model.translationJob=job('completed',[{status:'completed',notApplicable:true}]);assert.equal(combinedReportStatus(model,'en'),'completed');assert.equal(combinedReportProgress(model,'en').percent,100);assert.equal(combinedReportProgress(model,'en').pending,0);
 model.translationJob=job('completed_with_warnings',[{status:'failed'}]);assert.equal(combinedReportStatus(model,'en'),'completed_with_warnings');assert.equal(combinedReportProgress(model,'en').percent,100);assert.equal(combinedReportProgress(model,'en').failed,1);
});
test('zero-unit complete translation is 100%, not an invented waiting node',()=>{
 const model={job:job('completed',[]),translationJob:job('completed',[])};assert.equal(combinedReportProgress(model,'en').percent,100);assert.equal(combinedReportProgress(model,'en').pending,0);
});
test('terminal legacy unfinished checkpoints are a read-only warning projection and retryable',()=>{
 const saved={status:'completed',units:[{id:'n1',status:'completed'},{id:'n2',status:'pending'},{id:'n3',status:'running'}]},before=structuredClone(saved),view=projectIncompleteDelivery(structuredClone(saved));
 assert.deepEqual(saved,before);assert.equal(view.status,'completed_with_warnings');assert.equal(view.units[1].errorCode,'incomplete_checkpoint');assert.equal(deliveryUnitProgress(view.units).percent,100);assert.equal(deliveryUnitProgress(view.units).skipped,0);
 adoptIncompleteDelivery(saved,view);assert.equal(saved.units[0].status,'completed');assert.equal(saved.units[1].status,'failed');assert.equal(saved.units[2].status,'failed');
 const paused={status:'paused',units:[{status:'pending'}]};assert.deepEqual(projectIncompleteDelivery(structuredClone(paused)),paused);
});
test('history does not say complete alongside pending nodes',()=>{
 const item=job('completed',[{status:'completed'},{status:'pending'}]),html=reportHistoryView({historyTaskId:'task',history:[item]},'task',true);
 assert.match(html,/Incomplete — retry missing items/);assert.match(html,/Pending 1.*50%/);assert.doesNotMatch(html,/bd-history-status">Completed</);
});
test('real export views never headline complete while English report content remains pending',()=>{
 const state=managerState(),ui={...businessUI(),businessReportLanguage:'en'},base=summaryFixture({status:'completed',phase:'completed',warningsCount:0,progress:{total:1,done:1,skipped:1,failed:0,pending:0,running:0,percent:100},nodes:[{id:'n1',status:'completed',kind:'translation',notApplicable:true}]}),model={job:base,result:reportFixture()},previous=getLocale();
 try{for(const language of ['zh','en']){setLocale(language);for(const derived of [null,job('running',[{status:'pending'}]),job('paused',[{status:'pending'}]),job('completed',[{status:'pending'}])]){model.translationJob=derived;const html=businessExportView(state,ui,model),heading=html.match(/<section class="panel bd-run"><div class="bd-section-head"><div><h2>([^<]*)<\/h2>/)?.[1];assert.ok(heading);assert.doesNotMatch(heading,/· Completed$|业务交付 · 已完成$|^已完成$/);assert.match(html,/aria-valuenow="50"/);assert.match(html,language==='en'?/Pending 1/:/等待 1/);}}}finally{setLocale(previous);}
 const html=englishBusinessExportView(state,ui,model,state.tasks);assert.match(html,/Incomplete — retry missing items/);
});
test('derived same-language and failed nodes are distinct in captions and node labels',()=>{
 const model={job:job('completed',[{status:'completed'}]),translationJob:job('completed',[{id:'n1',status:'completed',notApplicable:true}])};let html=reportTranslationView(model,'en',true);assert.match(html,/Not applicable 1.*Failed 0.*Pending 0.*100%/);assert.match(html,/Not applicable \(already in target language\)/);
 model.translationJob=job('completed_with_warnings',[{id:'n1',status:'failed',errorCode:'incomplete_checkpoint',error:'Saved output is missing.'}]);html=reportTranslationView(model,'en',true);assert.match(html,/Not applicable 0.*Failed 1.*Pending 0.*100%/);assert.match(html,/Retry missing items/);assert.doesNotMatch(html,/Not applicable \(already in target language\)/);
});
test('partial node previews preserve backend summary totals in history and combined export views',()=>{
 const preview=summaryFixture({status:'completed',progress:{total:4,done:2,skipped:1,failed:1,pending:1,running:0,percent:75},nodes:[{id:'preview-only',status:'completed'}]}),before=structuredClone(preview);
 assert.deepEqual(deliveryJobProgress(preview),{total:4,done:2,skipped:1,failed:1,pending:1,running:0,settled:3,percent:75});assert.equal(deliveryJobStatus(preview),'incomplete');
 const history=reportHistoryView({historyTaskId:preview.taskId,history:[preview]},preview.taskId,true);assert.match(history,/Processed 3 \/ 4 nodes.*Not applicable 1.*Failed 1.*Pending 1.*75%/);assert.match(history,/Incomplete — retry missing items/);assert.deepEqual(preview,before);
 const base=summaryFixture({status:'completed',warningsCount:0,progress:{total:4,done:4,skipped:1,failed:0,pending:0,running:0,percent:100},nodes:[{id:'preview-only',status:'completed'}]}),derived={...job('running',[]),progress:{total:2,done:1,skipped:0,failed:0,pending:1,running:0,percent:50}},model={job:base,translationJob:derived,result:reportFixture()},state=managerState(),ui={...businessUI(),businessReportLanguage:'en'};
 assert.equal(combinedReportStatus(model,'en'),'running');assert.deepEqual(combinedReportProgress(model,'en'),{total:6,done:5,skipped:1,failed:0,pending:1,running:0,settled:5,percent:83});const html=englishBusinessExportView(state,ui,model,state.tasks);assert.match(html,/Business deliverables · Generating/);assert.match(html,/aria-valuenow="83"/);assert.match(html,/Processed 5 \/ 6 nodes.*Pending 1.*83%/);
});
test('a complete node list remains authoritative over a stale summary count',()=>{
 const value=summaryFixture({status:'completed',nodes:[{status:'completed',notApplicable:true}],progress:{total:1,done:0,skipped:0,failed:0,pending:1,running:0,percent:0}});assert.equal(deliveryJobProgress(value).percent,100);assert.equal(deliveryJobProgress(value).skipped,1);assert.equal(deliveryJobStatus(value),'completed');
});
