import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setImmediate as immediate} from 'node:timers/promises';
import {createAiService} from '../server/ai-service.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createBusinessState,createImportedTask,hasCompletedAI,getSessionResults} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot,referenceKey} from '../public/task-basis.mjs';
import {parseRawInspectionResult,RAW_INSPECTION_PROMPT_VERSION} from '../server/raw-inspection.mjs';
import {workflowDependencies} from '../server/workflow-contract.mjs';
import {isAIFinal} from '../public/ai-triage.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
const now='2026-11-12T10:00:00+08:00';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function validBody(request){
 return {recordId:request.session.id,results:request.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic literal evidence checked.',evidenceQuotes:[{quote:request.session.rawTranscript.text}],turnRefs:[],referenceIds:rule.policyIds.map(id=>{const policy=request.basis.policies.find(p=>p.id===id);return referenceKey(policy,policy.sections[0]);}),confidence:0.97,conflictsWith:[]}))};
}
async function fixture(t,{count=1,ruleIds=['R004'],timing=false,concurrency=1,outputLanguage='zh',respond,maxAttempts=2}={}){
 const scratch=path.resolve('tests/.raw-ai-r16-scratch');await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'case-'));let store=await createWorkspaceStore({dataDir}),ai;
 const bytes=await workbook([{name:'Synthetic Raw',headers:['ID','客服','消息详情','source extra'],rows:Array.from({length:count},(_,index)=>[`SYN-${index+1}`,`Agent ${index+1}`,`Customer: synthetic row ${index+1}?\nAgent: literal row ${index+1} reply. 😀`,`retain ${index+1}`]),rowNumbers:Array.from({length:count},(_,index)=>5+index*3)}]);
 const source=await store.putSource(bytes,'synthetic-raw.xlsx'),parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes}),catalog=createCatalog();assert.equal(parsed.valid,true,parsed.errors.join(';'));
 if(timing){const rule=catalog.rules.find(rule=>rule.id==='R004');rule.category='响应时效';rule.title='首次响应时间';}
 const basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds,now}),state=createImportedTask(createBusinessState(),{name:'Synthetic raw run',source,sessions:parsed.sessions,basisSnapshot,reviewer:'Synthetic Reviewer',rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'},outputLanguage},executionSettings:{concurrency},now});
 await store.save({baseRevision:0,mutationId:'initial',state,catalog});
 const calls=[],errors=[],traceRuns=[],traceSteps=[];let structuredCalls=0;
 const traceStore={async begin(value){traceRuns.push(structuredClone(value));},async step(runId,node,input,operation){traceSteps.push({runId,node,input:structuredClone(input)});return operation();},async finish(){}};
 const modelConfig={getPrivate:()=>({model:'synthetic-raw',baseUrl:'http://127.0.0.1:9/v1',authMode:'none',configured:true,connectionTested:true})};
 const client={engine:'synthetic',async inspect(){structuredCalls++;throw Object.assign(new Error('Raw input must never use structured inspect'),{code:'INVALID_OUTPUT'});},async inspectRaw(request){
  calls.push({session:structuredClone(request.session),basis:structuredClone(request.basis),inspectionAt:request.inspectionAt,outputLanguage:request.outputLanguage,allowDegraded:request.allowDegraded,retryFeedback:structuredClone(request.retryFeedback)});
  const body=respond?await respond(request,calls.length,calls):validBody(request),content=typeof body==='string'?body:JSON.stringify(body);
  return {results:parseRawInspectionResult(content,{session:request.session,basis:request.basis,outputLanguage:request.outputLanguage},{allowDegraded:request.allowDegraded}),modelId:'synthetic-raw',requestId:`SYN-REQ-${calls.length}`,promptVersion:RAW_INSPECTION_PROMPT_VERSION};
 }};
 const service=()=>createAiService({store,modelConfig,client,traceStore,maxAttempts,retryDelayMs:1,onError:error=>errors.push(error)});ai=await service();
 t.after(async()=>{await ai.close();await store.close();assert.ok(dataDir.startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return {dataDir,taskId:state.tasks[0].id,calls,errors,traceRuns,traceSteps,get ai(){return ai;},get store(){return store;},get structuredCalls(){return structuredCalls;},async restart(){await ai.close();await store.close();store=await createWorkspaceStore({dataDir});ai=await service();}};
}
test('raw rows call only inspectRaw with every frozen rule, exact cell and stable inspection/time/language options',async t=>{
 const f=await fixture(t,{count:2,ruleIds:['R001','R004'],outputLanguage:'en'});await f.ai.start(f.taskId,'RAW-RUN-1');await f.ai.waitForIdle();const doc=await f.store.read(),task=doc.state.tasks[0];
 assert.equal(f.calls.length,2);assert.equal(f.structuredCalls,0);assert.equal(task.aiStatus,'completed');assert.equal(task.aiRun.inspectionAt,task.aiRun.startedAt);assert.deepEqual(task.aiQueue.rows.map(row=>row.sourceRow),[5,8]);
 for(const call of f.calls){assert.equal(call.inspectionAt,task.aiRun.inspectionAt);assert.equal(call.outputLanguage,'en');assert.equal(call.allowDegraded,false);assert.deepEqual(call.session.turns,[]);assert.equal(call.session.startedAt,'');assert.equal(call.session.review,undefined);assert.equal(call.session.aiResults,undefined);assert.deepEqual(call.basis.rules.map(rule=>rule.id),['R001','R004']);assert.ok(!call.session.rawTranscript.text.includes(call.session.externalId==='SYN-1'?'row 2':'row 1'));}
 for(const s of doc.state.sessions){assert.equal(isAIFinal(s),true);assert.equal(s.review.status,'待审核');assert.equal(s.aiExecution.promptVersion,RAW_INSPECTION_PROMPT_VERSION);assert.equal(hasCompletedAI(s),true);}
 assert.equal(f.errors.length,0);assert.ok(f.traceSteps.find(step=>step.node==='source').input.sourceRows.every(row=>[5,8].includes(row.row)));
 const before=f.calls.length;await f.ai.start(f.taskId,'RAW-RUN-1');await f.ai.waitForIdle();assert.equal(f.calls.length,before);
});
test('invalid raw quote retries once with diagnostics, exact original row and unchanged inspection cutoff',async t=>{
 const f=await fixture(t,{respond:(request,n)=>{const body=validBody(request);if(n===1)body.results[0].evidenceQuotes=[{quote:'foreign-row quote'}];return body;}});await f.ai.start(f.taskId,'RAW-RETRY-QUOTE');await f.ai.waitForIdle();const doc=await f.store.read(),s=doc.state.sessions[0];
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].allowDegraded,false);assert.equal(f.calls[1].allowDegraded,true);assert.equal(f.calls[0].inspectionAt,f.calls[1].inspectionAt);assert.deepEqual(f.calls[0].session,f.calls[1].session);
 assert.deepEqual(f.calls[1].retryFeedback,{reasonCodes:['quote_mismatch','missing_quote'],ruleIds:['R004']});assert.equal(s.aiExecution.status,'completed');assert.equal(s.aiResults[0].rawValidation.status,'verified');assert.equal(isAIFinal(s),true);assert.equal(doc.state.tasks[0].aiQueue.rows[0].attempts,2);
});
test('final quote downgrade retains valid checks from that single attempt and routes the row to review',async t=>{
 const f=await fixture(t,{ruleIds:['R001','R004'],respond:request=>{const body=validBody(request);body.results[1].verdict='不符合';body.results[1].evidenceQuotes=[{quote:'fabricated quote'}];return body;}});await f.ai.start(f.taskId,'RAW-PARTIAL-DEGRADE');await f.ai.waitForIdle();const doc=await f.store.read(),task=doc.state.tasks[0],s=doc.state.sessions[0];
 assert.equal(f.calls.length,2);assert.equal(s.aiExecution.status,'completed');assert.equal(task.aiStatus,'completed');assert.equal(s.aiResults[0].rawValidation.status,'verified');assert.equal(s.aiResults[0].verdict,'符合');assert.equal(s.aiResults[1].rawValidation.status,'degraded');assert.equal(s.aiResults[1].verdict,'无法判定');assert.equal(s.aiResults[1].rawValidation.originalVerdict,'不符合');assert.equal(s.aiDecision.status,'UNCERTAIN');assert.equal(isAIFinal(s),false);assert.equal(f.errors.length,0);
});
test('exhausted core-contract failure persists complete program fallback and technical failed state',async t=>{
 const f=await fixture(t,{ruleIds:['R001','R004'],respond:request=>({...validBody(request),recordId:'WRONG-ROW'})});await f.ai.start(f.taskId,'RAW-CORE-FAIL');await f.ai.waitForIdle();const doc=await f.store.read(),task=doc.state.tasks[0],s=doc.state.sessions[0];
 assert.equal(f.calls.length,2);assert.equal(s.aiExecution.status,'failed');assert.equal(task.aiStatus,'failed');assert.equal(task.aiRun.done,0);assert.equal(task.aiRun.failed,1);assert.equal(task.aiQueue.rows[0].status,'failed');assert.equal(task.aiQueue.rows[0].semanticResult,undefined);
 assert.equal(s.aiResults.length,2);assert.ok(s.aiResults.every(result=>result.rawValidation.status==='program-fallback'&&result.verdict==='无法判定'));assert.equal(s.aiDecision.status,'UNCERTAIN');assert.equal(hasCompletedAI(s),false);assert.equal(getSessionResults(s)[0].executionStatus,'执行失败');assert.equal(f.errors.length,0);
});
test('unavailable timestamps force pure timing rules unable without retrying the missing information',async t=>{
 const f=await fixture(t,{timing:true});await f.ai.start(f.taskId,'RAW-NO-TIME');await f.ai.waitForIdle();const doc=await f.store.read(),s=doc.state.sessions[0];assert.equal(f.calls.length,1);assert.equal(s.aiExecution.status,'completed');assert.equal(s.aiResults[0].verdict,'无法判定');assert.ok(s.aiResults[0].rawValidation.reasonCodes.includes('source_time_unavailable'));assert.equal(s.startedAt,'');assert.equal(s.aiDecision.status,'UNCERTAIN');
});
test('four raw workers retain row identities and retry only the failed row after restart',async t=>{
 let active=0,peak=0,repair=false;const entered=deferred(),release=deferred();
 const f=await fixture(t,{count:4,concurrency:4,respond:async(request,n,calls)=>{active++;peak=Math.max(peak,active);if(calls.length===4)entered.resolve();if(n<=4)await release.promise;active--;if(!repair&&request.session.externalId==='SYN-3')return 'not JSON';return validBody(request);}});
 const started=f.ai.start(f.taskId,'RAW-FOUR');await entered.promise;release.resolve();await started;await f.ai.waitForIdle();let doc=await f.store.read();assert.equal(peak,4);assert.equal(f.calls.length,5);assert.equal(doc.state.tasks[0].aiStatus,'partial');const completed=doc.state.sessions.filter(s=>s.aiExecution.status==='completed').map(s=>structuredClone(s));assert.equal(completed.length,3);
 repair=true;await f.restart();const count=f.calls.length;await immediate();assert.equal(f.calls.length,count);await f.ai.resume(f.taskId);await f.ai.waitForIdle();doc=await f.store.read();assert.equal(f.calls.length,count+1);assert.equal(f.calls.at(-1).session.externalId,'SYN-3');assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.equal(doc.state.sessions.find(s=>s.externalId==='SYN-3').aiDecisionHistory.length,1);
 for(const s of completed)assert.deepEqual(doc.state.sessions.find(row=>row.id===s.id),s);assert.equal(f.errors.length,0);
});
test('closing an in-flight raw request pauses and restart never calls until explicit resume',async t=>{
 const entered=deferred();let interrupted=true;
 const f=await fixture(t,{respond:request=>{if(!interrupted)return validBody(request);entered.resolve();return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Synthetic abort'),{code:'interrupted'})),{once:true}));}});
 const started=f.ai.start(f.taskId,'RAW-INTERRUPT');await entered.promise;await started;await f.restart();let doc=await f.store.read();assert.equal(doc.state.tasks[0].aiStatus,'paused');assert.equal(f.calls.length,1);const at=doc.state.tasks[0].aiRun.inspectionAt;
 interrupted=false;await f.ai.resume(f.taskId);await f.ai.waitForIdle();doc=await f.store.read();assert.equal(f.calls.length,2);assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.equal(f.calls[1].inspectionAt,at);assert.equal(f.errors.length,0);
});
test('raw dependency fingerprints change with inspection cutoff, language, model, prompt or frozen rule basis',async t=>{
 const f=await fixture(t),doc=await f.store.read(),s=doc.state.sessions[0],task=doc.state.tasks[0];
 const base={basis:task.basisSnapshot,inspectionAt:now,rawImportOptions:task.rawImportOptions,promptVersion:RAW_INSPECTION_PROMPT_VERSION,modelConfigFingerprint:'a'.repeat(64)},original=JSON.stringify(workflowDependencies(s,base));
 for(const update of [{inspectionAt:'2026-11-12T11:00:00+08:00'},{rawImportOptions:{...task.rawImportOptions,outputLanguage:'en'}},{modelConfigFingerprint:'b'.repeat(64)},{promptVersion:'synthetic-prompt-v2'},{basis:{...task.basisSnapshot,effectiveDate:'2026-11-13'}}])assert.notEqual(JSON.stringify(workflowDependencies(s,{...base,...update})),original);
});
test('restart rejects a tampered raw row cache fingerprint against the frozen source and execution basis',async t=>{
 const f=await fixture(t);await f.ai.start(f.taskId,'RAW-CACHE-VERIFY');await f.ai.waitForIdle();await f.ai.close();await f.store.close();
 const filename=path.join(f.dataDir,'workspace.json'),original=JSON.parse(await fs.readFile(filename,'utf8'));
 for(const tamper of [doc=>{doc.state.tasks[0].aiQueue.rows[0].inputSha256='f'.repeat(64);},doc=>{doc.state.tasks[0].aiQueue.fingerprint='e'.repeat(64);}]){
  const doc=structuredClone(original);tamper(doc);await fs.writeFile(filename,JSON.stringify(doc));
  await assert.rejects(async()=>{const reopened=await createWorkspaceStore({dataDir:f.dataDir});await reopened.close();},/指纹|摘要|原文|冻结/);
 }
});
test('actual raw client, source store and trace files retain a failed quote attempt followed by valid recovery',async t=>{
 const f=await fixture(t);await f.ai.close();const trace=await createWorkflowTraceStore({dataDir:f.dataDir}),wireRequests=[];
 const client=createArkClient({fetchImpl:async(url,options)=>{
  const payload=JSON.parse(options.body),input=JSON.parse(payload.messages[1].content);wireRequests.push(input);
  const body={recordId:input.record.recordId,results:input.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic transport quote.',evidenceQuotes:[{quote:wireRequests.length===1?'altered source':input.record.text}],turnRefs:[],referenceIds:[input.basis.policies.find(policy=>rule.policyIds.includes(policy.id)).sections[0].referenceKey],confidence:0.97,conflictsWith:[]}))};
  return new Response(JSON.stringify({id:`SYN-NATIVE-${wireRequests.length}`,model:'synthetic-raw',choices:[{finish_reason:'stop',message:{content:JSON.stringify(body),reasoning_content:'DO_NOT_RETAIN_REASONING'}}]}),{status:200,headers:{'content-type':'application/json'}});
 }});
 const modelConfig={getPrivate:()=>({model:'synthetic-raw',baseUrl:'http://127.0.0.1:9/v1',authMode:'none',configured:true,connectionTested:true})};
 const ai=await createAiService({store:f.store,modelConfig,client,traceStore:trace,maxAttempts:2,retryDelayMs:1});
 try{
  await ai.start(f.taskId,'RAW-NATIVE-TRACE');await ai.waitForIdle();const doc=await f.store.read(),saved=await trace.read('RAW-NATIVE-TRACE');
  assert.equal(wireRequests.length,2);assert.equal(wireRequests[0].record.text,wireRequests[1].record.text);assert.equal(wireRequests[0].inspectionAt,wireRequests[1].inspectionAt);assert.ok(wireRequests[1].validationFeedback.reasonCodes.includes('quote_mismatch'));
  assert.equal(doc.state.sessions[0].aiExecution.requestId,'SYN-NATIVE-2');assert.equal(saved.kind,'raw-transcript-rows');assert.equal(saved.status,'completed');assert.equal(saved.nodes.find(node=>node.id==='r0-a1-validation').status,'failed');assert.equal(saved.nodes.find(node=>node.id==='r0-a2-validation').status,'completed');assert.doesNotMatch(JSON.stringify(saved),/DO_NOT_RETAIN_REASONING/);
  assert.equal(doc.state.tasks[0].aiQueue.rows[0].rawAttempts.length,2);
 }finally{await ai.close();await trace.close();}
});
