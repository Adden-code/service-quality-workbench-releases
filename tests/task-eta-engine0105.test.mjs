import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createAiService} from '../server/ai-service.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot,referenceKey} from '../public/task-basis.mjs';
import {parseRawInspectionResult} from '../server/raw-inspection.mjs';
import {estimateTaskEta} from '../public/task-eta.mjs';
import {taskEtaNotice} from '../public/task-queue-ui.mjs';

test('real raw queue persistence supplies timing fields and exposes ETA while a synthetic batch is still running',async t=>{
  const scratch=path.resolve('..','outputs','service0105-20261115','test-eta-engine');await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'case-'));
  const store=await createWorkspaceStore({dataDir});let ai,release;const gate=new Promise(resolve=>release=resolve);let calls=0;
  t.after(async()=>{release();await ai?.close();await store.close();assert.ok(path.resolve(dataDir).startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const bytes=await workbook([{name:'Synthetic Raw',headers:['ID','客服','消息详情'],rows:Array.from({length:8},(_,index)=>['ETA-'+index,'Synthetic agent','Customer: synthetic question.\nAgent: synthetic answer.'])}]);
  const source=await store.putSource(bytes,'synthetic-eta.xlsx'),parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes}),catalog=createCatalog();assert.equal(parsed.valid,true);
  const frozenAt='2026-11-15T00:00:00Z',basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-15',ruleIds:['R004'],now:frozenAt});
  const state=createImportedTask(createBusinessState(),{name:'Synthetic timing batch',source,sessions:parsed.sessions,basisSnapshot,reviewer:'Synthetic reviewer',rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'},outputLanguage:'zh'},executionSettings:{concurrency:2},now:frozenAt});
  await store.save({baseRevision:0,mutationId:'eta-initialize',state,catalog});
  ai=await createAiService({store,maxAttempts:1,modelConfig:{getPrivate:()=>({model:'synthetic-eta',baseUrl:'http://127.0.0.1:9/v1',authMode:'none',configured:true,connectionTested:true})},client:{async inspectRaw(request){
    const number=++calls;if(number<=3)await delay(1100);else await gate;
    const body={recordId:request.session.id,results:request.basis.rules.map(rule=>({ruleId:rule.id,verdict:'符合',reason:'Synthetic literal check.',evidenceQuotes:[{quote:request.session.rawTranscript.text}],referenceIds:rule.policyIds.map(id=>{const policy=request.basis.policies.find(row=>row.id===id);return referenceKey(policy,policy.sections[0]);}),confidence:.96,conflictsWith:[],turnRefs:[]}))};
    return{results:parseRawInspectionResult(JSON.stringify(body),{session:request.session,basis:request.basis}),modelId:'synthetic-eta',promptVersion:'synthetic-eta'};
  }}});
  const taskId=state.tasks[0].id;await ai.start(taskId,'actual-eta-run');
  let active;const deadline=Date.now()+10000;
  while(Date.now()<deadline){const doc=await store.read(),task=doc.state.tasks.find(row=>row.id===taskId);if(task.aiQueue.rows.filter(row=>row.status==='completed').length===3){active=doc;break;}await delay(25);}
  assert.ok(active,'three completed rows must be observable before the held requests finish');
  const task=active.state.tasks.find(row=>row.id===taskId);assert.equal(task.aiStatus,'running');
  for(const row of task.aiQueue.rows.filter(row=>row.status==='completed')){assert.equal(row.runId,'actual-eta-run');assert.equal(row.attempts,1);assert.ok(Date.parse(row.completedAt)-Date.parse(row.startedAt)>=1000);}
  const eta=estimateTaskEta(task);assert.equal(eta.kind,'estimate');assert.equal(eta.sampleCount,3);assert.ok(eta.rangeMs[1]>eta.rangeMs[0]);assert.match(taskEtaNotice(active.state,task),/本阶段预计还需/);
  release();await ai.waitForIdle();assert.equal((await store.read()).state.tasks.find(row=>row.id===taskId).aiStatus,'completed');assert.equal(calls,8);
});
