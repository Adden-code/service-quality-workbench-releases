import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.VERIFY_APP_ROOT||'.');
const load=(rel,base=root)=>import(pathToFileURL(path.join(base,rel)));
test('123 ecommerce rows resume after restart: failed offsets recover once, 103 pending dispatch, 20 judgments remain frozen',async t=>{
 const {createBusinessState,createImportedTask}=await load('public/domain.mjs'),{createCatalog}=await load('public/catalog.mjs'),{defaultScenePackage,SCENE_COLLECTIONS,sceneBasisForTask}=await load('public/scene-configuration.mjs'),{EC_HEADERS,EC_RULE_IDS}=await load('public/ecommerce-schema.mjs'),{workbook}=await load('public/io.mjs'),{parseEcommerceFile}=await load('public/ecommerce-input.mjs');
 const {createWorkspaceStore}=await load('server/workspace-store.mjs'),{createAiService}=await load('server/ai-service.mjs');
 const oldRoot=process.env.VERIFY_OLD_APP_ROOT;
 const previous=oldRoot?{...await load('server/workspace-store.mjs',oldRoot),...await load('server/ai-service.mjs',oldRoot)}:{createWorkspaceStore,createAiService};
 const dataRoot=path.resolve('tests/artifacts/evidence-recovery0119');await fs.mkdir(dataRoot,{recursive:true});const dir=await fs.mkdtemp(path.join(dataRoot,'test-'));let store=await previous.createWorkspaceStore({dataDir:dir}),service;
 t.after(async()=>{await service?.close();await store.close();assert.ok(dir.startsWith(dataRoot+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const now='2026-11-18T00:00:00Z',state=createBusinessState(),catalog=createCatalog();
 const basis={executionProfile:'ec-business-v1',capturedAt:now,effectiveDate:'2026-11-18',rules:EC_RULE_IDS.map(id=>({id,title:id,name:id,version:'V3.0',category:'Synthetic',scope:'Synthetic',policyIds:[],passCriteria:'Synthetic pass',failCriteria:'Synthetic fail',exceptionCriteria:'Synthetic unknown'})),policies:[],businessProfile:{schemaVersion:1,similarity:{method:'normalized-bigram-dice-v1',threshold:.85,minimumRecords:2,scope:'batch'},structure:{minimumSteps:3,counting:'grapheme-with-spaces-v1',closingWaiver:{zh:200,en:200}},privacy:{maskedAllowed:false},timing:{status:'pending',siteField:'国家',sites:[],standards:[]}}};
 const p=defaultScenePackage({id:'电商评论回复',name:'Synthetic EC',engine:'ecommerce'},basis);p.configuration.status='published';p.configuration.executionMode='configured';p.configuration.capabilities=[{key:'ecommerceClassification',phase:'pre',executorVersion:'scene-capability.v1',dependsOn:[]}];p.template.renderMode='configured';SCENE_COLLECTIONS.forEach(k=>state[k]=[]);state.sceneConfigurations=[p.configuration];state.deliveryTemplates=[p.template];state.sceneConfigurationMigration=1;
 const quote='البطارية لا تعمل';const rows=Array.from({length:123},(_,i)=>{const r=Array(22).fill('');r[3]='Synthetic';r[8]=`😀 Synthetic #${i}. ${quote}`;r[9]=`Synthetic response ${i}`;r[10]='5';r[12]='2026-11-17 09:00:00';r[13]='2026-11-17 10:00:00';return r;});
 const bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),...rows]}]));const parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,'synthetic.xlsx'),next=createImportedTask(state,{name:'Synthetic offset recovery',fileName:'synthetic.xlsx',sessions:parsed.sessions,source,basisSnapshot:sceneBasisForTask(state,catalog,'电商评论回复',now),reviewer:'Synthetic',executionSettings:{concurrency:1},now});
 await store.save({state:next,catalog,baseRevision:0,mutationId:'synthetic-initial'});
 let calls=0;const errors=[];
 const config={getPrivate:()=>({model:'synthetic-model',authMode:'none',baseUrl:'http://127.0.0.1:1',configured:true,connectionTested:true})};
 async function client(initial){
  const {createArkClient}=await load('server/ark-client.mjs',initial&&oldRoot?oldRoot:root);
  const wire=createArkClient({fetchImpl:async(_,options)=>{calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content),b=input.blocks[0],index=Number(b.text.match(/#(\d+)/)[1]),drift=!initial||index<3;
   // With VERIFY_OLD_APP_ROOT the actual 0.11.8 parser rejects the exact valid quote.
   // Default regression injects the same INVALID_OUTPUT boundary without a legacy install dependency.
   const evidence={blockId:b.id,quote:initial&&index<3&&!oldRoot?'Synthetic missing quote':drift?quote:b.text,start:drift?'95':0,end:drift?'121':b.text.length};
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify({status:'completed',value:{polarity:'negative',vocKind:'substantive'},confidence:'0.95',reason:'Synthetic',evidence:[evidence]})+'\n```'}}]}));
  }});
  return{inspectSceneCapability:wire.inspectSceneCapability,inspectEcommerceRow:async()=>({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'Synthetic direct result',evidence:[2],referenceIds:[],confidence:.9,conflictsWith:[]})),modelId:'synthetic-model'})};
 }
 service=await previous.createAiService({store,modelConfig:config,client:await client(true),onError:e=>errors.push(e.stack),maxAttempts:1,retryDelayMs:0});await service.start(next.tasks[0].id,'synthetic-offset-run');await service.waitForIdle();
 const paused=await store.read(),task=paused.state.tasks[0];assert.equal(task.aiStatus,'paused');assert.equal(task.capabilityMonitor.ecommerceClassification.technicalFailures,3);assert.equal(task.aiQueue.rows.filter(r=>r.status==='pending').length,103);
 const frozen=structuredClone(paused.state.sessions.slice(0,20).map(s=>({aiResults:s.aiResults,review:s.review,ecommerce:s.ecommerce}))),savedBasis=structuredClone(task.basisSnapshot),before=calls;
 await service.close();await store.close();store=await createWorkspaceStore({dataDir:dir});service=await createAiService({store,modelConfig:config,client:await client(false),onError:e=>errors.push(e.stack),maxAttempts:1,retryDelayMs:0});
 await service.resume(task.id);await service.waitForIdle();const after=await store.read();assert.equal(after.state.tasks[0].aiStatus,'completed',JSON.stringify({errors,calls,stop:after.state.tasks[0].aiQueue.stopReason}));assert.equal(calls-before,106);assert.deepEqual(after.state.sessions.slice(0,20).map(s=>({aiResults:s.aiResults,review:s.review,ecommerce:s.ecommerce})),frozen);assert.deepEqual(after.state.tasks[0].basisSnapshot,savedBasis);assert.deepEqual(after.state.tasks[0].source,task.source);
 const repaired=after.state.sessions.filter(s=>s.sceneCapabilities.outputs.ecommerceClassification.evidence[0].locatorRepair);assert.equal(repaired.length,106);for(const s of repaired){const c=s.sceneCapabilities.outputs.ecommerceClassification,e=c.evidence[0];assert.equal(c.status,'completed');assert.equal(c.attempts,1);assert.equal(c.confidence,.95);assert.equal(e.quote,quote);assert.equal(s.turns[0].text.slice(e.start,e.end),quote);assert.deepEqual(e.locatorRepair,{version:1,method:'unique-exact',originalStart:'95',originalEnd:'121'});}
 const {validateWorkspace}=await load('server/workspace-validation.mjs');
 const altered=structuredClone(after.state);altered.sessions[0].sceneCapabilities.judgmentClassificationSnapshot.output.reason='forged';assert.throws(()=>validateWorkspace(altered,after.catalog,after.state,{trustedAI:true}),/分类依据/);
 const accepted=structuredClone(after.state);accepted.sessions[0].review.drafts['EC-TIME']={...structuredClone(accepted.sessions[0].aiResults.find(r=>r.ruleId==='EC-TIME')),source:'AI接受'};assert.equal(validateWorkspace(accepted,after.catalog,after.state),true);
 assert.ok(after.state.tasks[0].aiQueue.rows.slice(0,3).every(r=>r.capabilityRecovery));assert.equal(after.state.tasks[0].capabilityMonitor.ecommerceClassification.technicalFailures,0);
 await service.close();service=null;await store.close();store=await createWorkspaceStore({dataDir:dir});assert.deepEqual((await store.read()).state,after.state,'repaired evidence survives persisted workspace restart');
 if(process.env.VERIFY_RECOVERY_OUTPUT)await fs.writeFile(process.env.VERIFY_RECOVERY_OUTPUT,JSON.stringify({status:'passed',oldRoot:oldRoot||null,testedRoot:root,syntheticRows:123,pausedCompleted:20,pausedPending:103,recoveredCapabilities:3,dispatchedPending:103,oneAttemptSuccesses:106,previousJudgmentsAndReviewPreserved:20,sourceAndBasisPreserved:true,repairAuditPersisted:true,externalModelCalls:0},null,2));
});
