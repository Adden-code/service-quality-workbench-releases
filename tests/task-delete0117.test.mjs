import {taskHistoryView} from '../public/task-history-view.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {applyTaskLifecycle,taskVoidBlockers} from '../public/task-lifecycle.mjs';
import {prepareTaskDeletion,filterTaskFiles} from '../server/task-deletion.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {fixture} from './import-repeat0117.test.mjs';
const options={actor:'Synthetic maintainer',reason:'Synthetic discarded batch',administratorConfirmed:true};
test('0117 archived confirmed/exported task may be voided; running task remains blocked',()=>{
 const {input}=fixture();let state=createImportedTask(createBusinessState(),input),id=state.tasks[0].id;
 state=applyTaskLifecycle(state,id,'deliverable',{deliveryId:'synthetic-report'});state=applyTaskLifecycle(state,id,'archive');
 assert.deepEqual(taskVoidBlockers(state,state.tasks[0]),[]);state=applyTaskLifecycle(state,id,'void',options);assert.equal(state.tasks[0].status,'已作废');
 const active=createImportedTask(createBusinessState(),input);active.tasks[0].aiStatus='paused';assert.ok(taskVoidBlockers(active,active.tasks[0]).length);
});
test('0117 deletion needs both confirmations, preserves other tasks and protects audit and task IDs',()=>{
 const {catalog,input}=fixture();let state=createImportedTask(createBusinessState(),input),id=state.tasks[0].id;state=applyTaskLifecycle(state,id,'void',options);
 state=createImportedTask(state,input);const other=structuredClone(state.tasks[0]),doc={schemaVersion:1,revision:3,mutations:[],state,catalog};
 const request={...options,taskId:id,confirmTaskId:id};
 for(const bad of [{administratorConfirmed:false},{confirmTaskId:'wrong'},{actor:''},{reason:''}])assert.throws(()=>prepareTaskDeletion(doc,{...request,...bad}),/确认|操作人|原因/);
 const next=prepareTaskDeletion(doc,request,{backupPath:'synthetic-backup.sqwb'});validateWorkspace(next.state,catalog);assert.equal(next.state.tasks.length,1);assert.deepEqual(next.state.tasks[0],other);assert.equal(next.state.sessions.length,1);assert.equal(next.state.taskDeletionAudit[0].task.id,id);
 assert.throws(()=>validateWorkspace({...next.state,taskDeletionAudit:[]},catalog,next.state),/删除审计/);
 const recreated=createImportedTask(next.state,input);assert.equal(recreated.tasks[0].importLineage.ordinal,3);assert.notEqual(recreated.tasks[0].id,id);
 const files=new Map([['workspace.json',Buffer.from(JSON.stringify(doc))],['report-jobs/a/job.json',Buffer.from(JSON.stringify({id:'a',taskId:id}))],['report-jobs/a/snapshot.json',Buffer.from('private')],['report-jobs/b/job.json',Buffer.from(JSON.stringify({id:'b',taskId:other.id}))],['workflow-runs/a.json',Buffer.from(JSON.stringify({taskId:'a'}))],['report-cache/x.json',Buffer.from('{}')]]);
 const filtered=filterTaskFiles(files,doc,request);assert.ok(!filtered.has('report-jobs/a/job.json'));assert.ok(!filtered.has('workflow-runs/a.json'));assert.ok(filtered.has('report-jobs/b/job.json'));assert.ok(!filtered.has('report-cache/x.json'));
});

test('0117 historical view filters business IDs and verdicts without writable controls',()=>{
 const {input}=fixture();let state=createImportedTask(createBusinessState(),input);state=applyTaskLifecycle(state,state.tasks[0].id,'void',options);const task=state.tasks[0],row=state.sessions[0];row.review.drafts.R004={ruleId:'R004',verdict:'无法判定',reason:'Synthetic <script>unsafe</script>'};
 const html=taskHistoryView(state,task,{historyRuleFilter:'R004',historyVerdictFilter:'无法判定'});assert.match(html,/SYNTHETIC-1/);assert.match(html,/history-verdict-filter/);assert.match(html,/1 \/ 1 条会话/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/data-act=|<textarea|<script>/);
 assert.match(taskHistoryView(state,task,{historyVerdictFilter:'不符合'}),/当前筛选没有记录/);
});
