import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createModelConfig} from '../server/model-config.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createBusinessState,createImportedTask,acceptAI,confirmReview,getDashboard} from '../public/domain.mjs';
import {createBusinessCatalog,createDraft,publishVersion} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {normalizeReviewPolicy,isAIFinal,requiresHumanReview,returnToHumanReview} from '../public/ai-triage.mjs';
import {parseBusinessInput} from '../public/business-input.mjs';
import {workbook,readXlsx} from '../public/io.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const infoHeaders=['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'];
const turnHeaders=['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'];
const outputRoot=path.resolve('../http-e2e');
const ruleId='HTTP096-CHECK',policyId='HTTP096-POLICY';

function syntheticCatalog(at){
  const common={owner:'Synthetic HTTP reviewer',scope:'合成新品资料核对',sceneIds:['新品产品咨询'],effectiveAt:at.slice(0,10),expiresAt:'',changeNote:'Synthetic API-only acceptance; no business materials.'};
  let catalog=createDraft(createBusinessCatalog(),'policies',policyId,{...common,title:'HTTP合成资料',category:'服务政策',source:'合成自动化测试',sections:[{id:policyId+'-1',title:'资料核对',text:'The agent must verify the synthetic policy before making a product statement.'}]},at);
  catalog=publishVersion(catalog,'policies',policyId,'V1.0',{},at);
  catalog=createDraft(catalog,'rules',ruleId,{...common,title:'是否核对合成资料',category:'服务规范',policyIds:[policyId],passCriteria:'The reply explicitly verifies the synthetic policy.',failCriteria:'The reply explicitly declines to verify the synthetic policy.',exceptionCriteria:'Insufficient evidence remains uncertain; unrelated material is not applicable.'},at);
  return publishVersion(catalog,'rules',ruleId,'V1.0',{},at);
}

async function standardWorkbook(markers,at){
  const sessions=markers.map(marker=>({id:marker,scene:'新品产品咨询',startedAt:at,topic:'Synthetic policy verification '+marker,channel:'Synthetic channel',product:'Synthetic product',agent:'Synthetic agent',customer:'Synthetic customer',completeness:'完整',missingNote:'',turns:[
    {id:1,role:'客户',speaker:'Synthetic customer',at,text:'Please verify the synthetic policy for '+marker+'.'},
    {id:2,role:'客服',speaker:'Synthetic agent',at,text:marker.includes('FAIL')?'I will not check the synthetic policy.':'I will check the synthetic policy before answering.'},
  ]}));
  const bytes=await workbook([
    {name:'会话信息',headers:infoHeaders,rows:sessions.map(s=>[s.id,s.scene,s.startedAt,s.topic,s.channel,s.product,s.agent,s.customer,s.completeness,s.missingNote])},
    {name:'会话明细',headers:turnHeaders,rows:sessions.flatMap(s=>s.turns.map(turn=>[s.id,turn.id,turn.role,turn.speaker,turn.at,turn.text]))},
  ]);
  return{bytes,sessions};
}

function reportAnswer(kind,input){
  if(kind==='translation')return{items:input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'en',translation:'合成译文：'+item.text}))};
  if(kind==='consultationIssues')return{clusters:[{label:'资料核对缺失',summary:'本轮人工确认坐席未核对合成资料。',memberIds:input.records.map(record=>record.id),action:'答复前先核对冻结的合成资料并保留依据。'}]};
  assert.equal(kind,'consultationAnalysis','Unexpected controlled report node');
  const customer=input.record.turns.find(turn=>turn.role==='客户');
  return{items:[{id:input.record.id,salesStage:'售前',salesSubstage:'资料核对',intentLabel:'未配置分类体系',intentReferenceId:'',demandSummary:'客户希望客服核对合成资料后答复。',sentiment:'中性',negativeVoices:[],voc:{valid:true,scene:'其他',painPoint:'希望核对合成资料',reason:'客户原文明确提出资料核对诉求。',evidenceQuote:customer.text}}]};
}

test('0.9.6 synthetic HTTP workflow links strict connection testing, serial triage, human review, frozen deliverables and restart', {timeout:30000},async t=>{
  await fs.mkdir(outputRoot,{recursive:true});const scratch=path.join(outputRoot,'.scratch');await fs.mkdir(scratch,{recursive:true});
  const dataDir=await fs.mkdtemp(path.join(scratch,'workflow-')),startedAt=new Date().toISOString(),first=deferred(),firstEntered=deferred(),second=deferred(),secondEntered=deferred();
  const summary={testKind:'HTTP API integration plus local export rendering',computerUse:false,browserUsed:false,realModelCalls:0,realCredentialsUsed:false,realBusinessMaterialsUsed:false,startedAt,status:'running',steps:[]};
  let server,origin,token,doc,sequence=0,apiRequests=0,transportCalls=0,connectionTests=0,reportCalls=0,activeInspections=0,maxConcurrentInspections=0;const inspections=[];
  t.after(async()=>{first.resolve();second.resolve();if(server)await new Promise(resolve=>server.close(resolve));assert.ok(dataDir.startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  const transport=async(url,options)=>{
    transportCalls++;assert.equal(new URL(url).hostname,'synthetic-http.invalid');
    const request=JSON.parse(options.body);let payload;try{payload=JSON.parse(request.messages[1].content);}catch{}
    let content;
    if(!payload){connectionTests++;content='OK';}
    else if(payload.basis&&payload.session){
      const marker=payload.session.externalId;inspections.push(marker);activeInspections++;maxConcurrentInspections=Math.max(maxConcurrentInspections,activeInspections);
      try{
        if(marker==='HTTP096-PASS-A'){firstEntered.resolve();await first.promise;}
        if(marker==='HTTP096-PASS-B'){secondEntered.resolve();await second.promise;}
        const turn=payload.session.turns.find(turn=>turn.role==='客服'),reference=payload.basis.policies[0].sections[0].referenceKey;
        content=JSON.stringify({results:payload.basis.rules.map(rule=>({ruleId:rule.id,verdict:marker.includes('FAIL')?'不符合':'符合',reason:marker.includes('FAIL')?'合成回复明确拒绝核对资料。':'合成回复明确说明先核对资料。',evidence:[turn.id],referenceIds:[reference],confidence:marker.includes('INVALID')?'high':marker.includes('LOW')?0.50:0.99,conflictsWith:[],evidenceQuotes:[{turnId:turn.id,role:turn.role,quote:marker.includes('INVALID')?'This quotation is absent from the archived source.':turn.text}]}))});
      }finally{activeInspections--;}
    }else{reportCalls++;content=JSON.stringify(reportAnswer(payload.kind,payload.input));}
    return new Response(JSON.stringify({model:'synthetic-http-model',choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  async function open(){
    const config=await createModelConfig({dataDir,env:{}});server=await createWorkbenchServer({dataDir,modelConfig:config,arkClient:createArkClient({fetchImpl:transport}),catalogSeed:null});server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;token=undefined;await refresh();
  }
  async function request(route,method='GET',body){
    apiRequests++;const response=await fetch(origin+route,{method,headers:{Origin:origin,...(token?{'X-Workspace-Token':token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};
  }
  async function refresh(){const response=await request('/api/workspace');assert.equal(response.status,200);doc=response.body;token=doc.token;return doc;}
  async function save(state,catalog=doc.catalog){const response=await request('/api/workspace','PUT',{baseRevision:doc.revision,mutationId:'http096-'+(++sequence),state,catalog});assert.equal(response.status,200,JSON.stringify(response.body));doc=response.body;return doc;}
  async function createTask(name,markers){
    const input=await standardWorkbook(markers,startedAt),filename=name+'.xlsx',file={name:filename,size:input.bytes.length,arrayBuffer:async()=>input.bytes.buffer.slice(input.bytes.byteOffset,input.bytes.byteOffset+input.bytes.byteLength)};
    const parsed=await parseBusinessInput(file);assert.equal(parsed.valid,true,parsed.errors?.join('; '));
    apiRequests++;const response=await fetch(origin+'/api/sources',{method:'POST',headers:{Origin:origin,'X-Workspace-Token':token,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(filename)},body:input.bytes}),source=await response.json();assert.equal(response.status,201,JSON.stringify(source));assert.equal(source.sha256,createHash('sha256').update(input.bytes).digest('hex'));
    const basisSnapshot=createBasisSnapshot(doc.catalog,{ruleIds:[ruleId],effectiveDate:startedAt.slice(0,10)}),reviewPolicy=normalizeReviewPolicy();assert.equal(reviewPolicy.confidenceThreshold,0.90);
    await save(createImportedTask(doc.state,{name,reviewer:'Synthetic human reviewer',sessions:parsed.sessions,source,basisSnapshot,reviewPolicy}));const task=doc.state.tasks.find(task=>task.name===name);assert.equal(task.reviewPolicy.confidenceThreshold,0.9);assert.ok(doc.state.sessions.filter(s=>s.taskId===task.id).every(s=>s.reviewPolicy.confidenceThreshold===0.9));return task.id;
  }
  const byExternal=marker=>doc.state.sessions.find(session=>session.externalId===marker);
  try{
    await open();assert.equal(doc.initialized,false);await save(createBusinessState(),syntheticCatalog(startedAt));assert.equal(doc.catalog.rules.find(rule=>rule.id===ruleId).status,'已发布');
    const taskA=await createTask('Synthetic-HTTP-task-A',['HTTP096-PASS-A','HTTP096-FAIL-A','HTTP096-INVALID-A']),taskB=await createTask('Synthetic-HTTP-task-B',['HTTP096-PASS-B','HTTP096-LOW-B']);summary.steps.push('Uploaded two authentic synthetic standard XLSX files; saved published synthetic directory and task policies at 0.90.');
    let response=await request('/api/model/config','PUT',{baseUrl:'http://synthetic-http.invalid/v1',model:'synthetic-http-model',authMode:'none'});assert.equal(response.status,200);assert.equal(response.body.connectionTested,false);
    response=await request(`/api/tasks/${taskA}/ai`,'POST',{runId:'HTTP096-BEFORE-TEST'});assert.equal(response.status,409);assert.equal(inspections.length,0);assert.equal(transportCalls,0);
    response=await request('/api/model/test','POST',{});assert.equal(response.status,200);assert.equal(response.body.config.connectionTested,true);assert.equal(connectionTests,1);summary.steps.push('Untested start rejected with HTTP 409 and zero model requests; controlled real-config connection test returned OK.');
    response=await request(`/api/tasks/${taskA}/ai`,'POST',{runId:'HTTP096-RUN-A',settings:{concurrency:1,batchSize:2,maxWorkBytes:64000}});assert.equal(response.status,202,JSON.stringify(response.body));await firstEntered.promise;
    response=await request(`/api/tasks/${taskB}/ai`,'POST',{runId:'HTTP096-RUN-B',settings:{concurrency:1,batchSize:2,maxWorkBytes:64000}});assert.equal(response.status,202,JSON.stringify(response.body));assert.equal(response.body.state.tasks.find(task=>task.id===taskB).aiStatus,'queued');assert.equal(response.body.aiRuntime.queue.find(item=>item.taskId===taskB).position,2);assert.deepEqual(inspections,['HTTP096-PASS-A']);
    first.resolve();await secondEntered.promise;await refresh();assert.equal(doc.state.tasks.find(task=>task.id===taskA).aiStatus,'partial');assert.equal(doc.state.tasks.find(task=>task.id===taskB).aiStatus,'running');assert.equal(doc.aiRuntime.queue[0].previousIncompleteCount,1);second.resolve();await server.waitForAiIdle();await refresh();
    assert.equal(maxConcurrentInspections,1);assert.equal(inspections.filter(id=>id==='HTTP096-INVALID-A').length,2);assert.ok(inspections.slice(-2).every(id=>id.endsWith('-B')));assert.equal(byExternal('HTTP096-PASS-A').aiDecision.status,'PASS');assert.equal(isAIFinal(byExternal('HTTP096-PASS-A')),true);assert.equal(byExternal('HTTP096-PASS-A').review.status,'待审核');assert.equal(byExternal('HTTP096-FAIL-A').aiDecision.status,'FAIL');assert.equal(byExternal('HTTP096-LOW-B').aiDecision.status,'UNCERTAIN');assert.equal(byExternal('HTTP096-INVALID-A').aiDecision.status,'UNCERTAIN');assert.equal(byExternal('HTTP096-INVALID-A').aiExecution.status,'failed');assert.equal(byExternal('HTTP096-INVALID-A').aiResults.length,0);assert.equal(doc.aiRuntime.queue.length,0);summary.steps.push('Real Ark parser validated synthetic responses: PASS x2, FAIL x1, low-confidence UNCERTAIN x1, invalid-quote retry-exhausted UNCERTAIN x1; partial task A automatically dispatched queued task B.');
    const passA=byExternal('HTTP096-PASS-A').id,failA=byExternal('HTTP096-FAIL-A').id;
    await save(returnToHumanReview(doc.state,{sessionIds:[passA],reason:'Synthetic source audit requires a human recheck.',reviewer:'Synthetic auditor'}));assert.equal(isAIFinal(byExternal('HTTP096-PASS-A')),false);assert.equal(requiresHumanReview(byExternal('HTTP096-PASS-A')),true);assert.equal(byExternal('HTTP096-PASS-A').review.returnHistory.length,1);
    let reviewed=acceptAI(doc.state,passA);reviewed=confirmReview(reviewed,passA);reviewed=acceptAI(reviewed,failA);reviewed=confirmReview(reviewed,failA);await save(reviewed);
    assert.equal(byExternal('HTTP096-PASS-A').review.status,'已确认');assert.equal(byExternal('HTTP096-PASS-A').aiDecision.status,'PASS');assert.equal(byExternal('HTTP096-PASS-A').review.returnHistory.length,1);assert.equal(byExternal('HTTP096-FAIL-A').review.status,'已确认');assert.equal(isAIFinal(byExternal('HTTP096-PASS-B')),true);
    const dashboard=getDashboard(doc.state,{period:'batch',taskId:taskA});assert.equal(dashboard.humanConfirmedCount,2);assert.equal(dashboard.aiFinalCount,0);assert.equal(dashboard.qualityReviewedCount,2);assert.equal(dashboard.problemSessions,1);assert.equal(dashboard.pendingCount,1);summary.steps.push('Returned one AI-final PASS through authenticated workspace PUT; current human confirmation of returned PASS and FAIL retained original AI and return audit; pending invalid output stayed outside quality denominator.');
    const deliveries=[];
    for(const [taskId,jobId,expected]of [[taskA,'HTTP096-DELIVERY-A',{denominator:2,human:2,ai:0,pending:1,passRate:50}],[taskB,'HTTP096-DELIVERY-B',{denominator:1,human:0,ai:1,pending:1,passRate:100}]]){
      response=await request('/api/report-jobs','POST',{jobId,taskId,conclusionMode:'combined',targetLang:'zh'});assert.equal(response.status,202,JSON.stringify(response.body));await server.waitForReportsIdle();response=await request(`/api/report-jobs/${jobId}/result`);assert.equal(response.status,200,JSON.stringify(response.body));const result=response.body;
      assert.equal(result.snapshot.reviewPolicy.confidenceThreshold,0.9);assert.equal(result.snapshot.metrics.determinate,expected.denominator);assert.equal(result.snapshot.metrics.passRate,expected.passRate);assert.equal(result.snapshot.metrics.humanConfirmedCount,expected.human);assert.equal(result.snapshot.metrics.aiFinalCount,expected.ai);assert.equal(result.snapshot.metrics.pendingHumanCount,expected.pending);
      const sheets=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment)),provenance=sheets['判定来源与分流'];assert.ok(provenance);const sourceIndex=provenance[0].indexOf('最终判定来源');assert.equal(provenance.slice(1).filter(row=>row[sourceIndex]==='人工确认').length,expected.human);assert.equal(provenance.slice(1).filter(row=>row[sourceIndex]==='AI终判').length,expected.ai);assert.equal(provenance.slice(1).filter(row=>row[sourceIndex]==='待人工').length,expected.pending);assert.equal(sheets['检核明细'][0].length,20);
      const html=buildBusinessReportHtml(result.snapshot,result.enrichment,{job:result.job});assert.ok(html.includes(`质量分母 ${expected.denominator}条`));assert.ok(html.includes(`AI终判 ${expected.ai} 条`));assert.ok(html.includes(`人工确认 ${expected.human} 条`));assert.match(html,/未标定/);assert.ok(!/<script\b|<link\b/.test(html));
      deliveries.push({jobId,taskId,jobStatus:result.job.status,failedNodes:result.job.nodes.filter(node=>node.status==='failed').map(node=>({kind:node.kind,errorCode:node.errorCode})),snapshotFingerprint:result.job.snapshotFingerprint,metrics:result.snapshot.metrics,records:result.snapshot.records.map(record=>({id:record.id,source:record.routing.resultSource,overall:record.finalOverall,routing:record.routing.status})),excelMainColumns:sheets['检核明细'][0].length,provenanceRows:provenance.length-1,htmlBytes:Buffer.byteLength(html),snapshot:result.snapshot});
    }
    summary.steps.push('Created two persisted report jobs through HTTP; generated and parsed both Excel and self-contained HTML from each exact returned snapshot; checked AI/human/pending sources and denominators 2 and 1.');
    const beforeDeliveryRegistration=structuredClone(doc.state);await refresh();
    const withoutDeliveryRegistration=structuredClone(doc.state);
    for(const delivery of deliveries){
      const task=withoutDeliveryRegistration.tasks.find(task=>task.id===delivery.taskId),life=task.lifecycle;
      assert.equal(life.schemaVersion,1);assert.deepEqual(life.events,[]);assert.equal(life.deliverables.length,1);
      assert.equal(life.deliverables[0].id,delivery.jobId);assert.equal(life.deliverables[0].kind,'business-report');assert.ok(Number.isFinite(Date.parse(life.deliverables[0].at)));
      delete task.lifecycle;
    }
    assert.deepEqual(withoutDeliveryRegistration,beforeDeliveryRegistration,'Report generation may append its delivery registration, never change inspections or human audit.');
    const frozenState=structuredClone(doc.state),beforeRestart=transportCalls;await new Promise(resolve=>server.close(resolve));server=null;await open();assert.equal(transportCalls,beforeRestart);assert.deepEqual(doc.state,frozenState);assert.equal((await request('/api/model/config')).body.connectionTested,true);
    for(const delivery of deliveries){response=await request(`/api/report-jobs/${delivery.jobId}/result`);assert.equal(response.status,200);assert.deepEqual(response.body.snapshot,delivery.snapshot);assert.equal(response.body.job.snapshotFingerprint,delivery.snapshotFingerprint);}
    assert.equal(transportCalls,beforeRestart);assert.equal(byExternal('HTTP096-PASS-A').review.returnHistory.length,1);summary.steps.push('Restarted actual server and model-config/store instances; restored source/routing/human audit and identical report fingerprints with zero additional controlled provider calls.');
    // Keep the completion gate strict, after collecting export/restart diagnostics.
    summary.deliveries=deliveries.map(({snapshot,...delivery})=>delivery);for(const delivery of deliveries)assert.equal(delivery.jobStatus,'completed',JSON.stringify({jobId:delivery.jobId,failedNodes:delivery.failedNodes}));
    Object.assign(summary,{status:'passed',finishedAt:new Date().toISOString(),apiRequests,controlledTransportCalls:transportCalls,controlledConnectionTests:connectionTests,controlledInspectionRequests:inspections.length,controlledReportRequests:reportCalls,maxConcurrentInspections,inspectionOrder:inspections,decisionStatuses:doc.state.sessions.map(session=>({externalId:session.externalId,aiDecision:session.aiDecision?.status,aiExecution:session.aiExecution?.status,humanStatus:session.review.status,aiFinal:isAIFinal(session),needsHuman:requiresHumanReview(session)})),deliveries:deliveries.map(({snapshot,...delivery})=>delivery)});
  }catch(error){Object.assign(summary,{status:'failed',finishedAt:new Date().toISOString(),error:{message:error.message,stack:error.stack},apiRequests,controlledTransportCalls:transportCalls,inspectionOrder:inspections});throw error;}
  finally{await fs.writeFile(path.join(outputRoot,'latest-summary.json'),JSON.stringify(summary,null,2),'utf8');}
});
