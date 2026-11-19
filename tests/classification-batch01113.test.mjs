import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.VERIFY_APP_ROOT||'.');
const load=(rel,base=root)=>import(pathToFileURL(path.join(base,rel)));
for(const recovery of [false,true])test(`180 ecommerce mixed reviews ${recovery?'resume from 20/180':'run fresh'} without classification breaker and retain review/audit`,async t=>{
 const {createBusinessState,createImportedTask}=await load('public/domain.mjs'),{createCatalog}=await load('public/catalog.mjs'),{defaultScenePackage,SCENE_COLLECTIONS,sceneBasisForTask}=await load('public/scene-configuration.mjs'),{EC_HEADERS,EC_RULE_IDS}=await load('public/ecommerce-schema.mjs'),{workbook}=await load('public/io.mjs'),{parseEcommerceFile}=await load('public/ecommerce-input.mjs');
 const {createWorkspaceStore}=await load('server/workspace-store.mjs'),{createAiService}=await load('server/ai-service.mjs');
 const oldRoot=recovery?process.env.VERIFY_OLD_APP_ROOT:null;
 const previous=oldRoot?{...await load('server/workspace-store.mjs',oldRoot),...await load('server/ai-service.mjs',oldRoot)}:{createWorkspaceStore,createAiService};
 const dataRoot=path.resolve('tests/artifacts/classification01113');await fs.mkdir(dataRoot,{recursive:true});const dir=await fs.mkdtemp(path.join(dataRoot,'test-'));let store=await previous.createWorkspaceStore({dataDir:dir}),service;
 t.after(async()=>{await service?.close();await store.close();assert.ok(dir.startsWith(dataRoot+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const now='2026-11-19T00:00:00Z',state=createBusinessState(),catalog=createCatalog();
 const basis={executionProfile:'ec-business-v1',capturedAt:now,effectiveDate:'2026-11-18',rules:EC_RULE_IDS.map(id=>({id,title:id,name:id,version:'V3.0',category:'Synthetic',scope:'Synthetic',policyIds:[],passCriteria:'Synthetic pass',failCriteria:'Synthetic fail',exceptionCriteria:'Synthetic unknown'})),policies:[],businessProfile:{schemaVersion:1,similarity:{method:'normalized-bigram-dice-v1',threshold:.85,minimumRecords:2,scope:'batch'},structure:{minimumSteps:3,counting:'grapheme-with-spaces-v1',closingWaiver:{zh:200,en:200}},privacy:{maskedAllowed:false},timing:{status:'pending',siteField:'国家',sites:[],standards:[]}}};
 const p=defaultScenePackage({id:'电商评论回复',name:'Synthetic EC',engine:'ecommerce'},basis);p.configuration.status='published';p.configuration.executionMode='configured';p.configuration.capabilities=[{key:'ecommerceClassification',phase:'pre',executorVersion:'scene-capability.v1',dependsOn:[]}];p.template.renderMode='configured';SCENE_COLLECTIONS.forEach(k=>state[k]=[]);state.sceneConfigurations=[p.configuration];state.deliveryTemplates=[p.template];state.sceneConfigurationMigration=1;
 const {SYSTEM_EC_HEADERS}=await load('public/ecommerce-system-source.mjs');
 const rows=Array.from({length:180},(_,i)=>{const r=Array(23).fill('');r[4]='VMALL-MX-HWB2C';r[5]=`Synthetic #${i}: Great overall but the battery fails.`;r[6]=`Synthetic response ${i}`;r[7]='5';r[8]='Synthetic agent';r[9]='2026-11-19 09:00:00';r[16]='2026-11-19 10:00:00';return r;});
 const bytes=Buffer.from(await workbook([{name:'Export',headers:[...SYSTEM_EC_HEADERS],rows}]));const parsed=await parseEcommerceFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes},{standardOnly:true});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const source=await store.putSource(bytes,'synthetic.xlsx'),next=createImportedTask(state,{name:'Synthetic offset recovery',fileName:'synthetic.xlsx',sessions:parsed.sessions,source,basisSnapshot:sceneBasisForTask(state,catalog,'电商评论回复',now),reviewer:'Synthetic',executionSettings:{concurrency:1},now});
 await store.save({state:next,catalog,baseRevision:0,mutationId:'synthetic-initial'});
 let calls=0;const errors=[];
 const config={getPrivate:()=>({model:'synthetic-model',authMode:'none',baseUrl:'http://127.0.0.1:1',configured:true,connectionTested:true})};
 async function client(initial){
  const {createArkClient}=await load('server/ark-client.mjs',initial&&oldRoot?oldRoot:root);
  const wire=createArkClient({fetchImpl:async(_,options)=>{calls++;const input=JSON.parse(JSON.parse(options.body).messages[1].content),b=input.blocks[0],index=Number(b.text.match(/#(\d+)/)[1]);
   const rejected=initial&&index<4,repair=!initial||rejected,undetermined=repair&&index%29===0;
   const payload={status:undetermined?'uncertain':'completed',value:{polarity:'positive',vocKind:repair?'substantive':'none'},confidence:'0.95',reason:'Synthetic mixed or uncertain review',evidence:undetermined?[]:[{blockId:b.id,quote:b.text,start:0,end:b.text.length}]};
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]}));
  }});
  return{inspectSceneCapability:async args=>{const result=await wire.inspectSceneCapability(args);if(initial&&!oldRoot&&Number(args.input.blocks[0].text.match(/#(\d+)/)[1])<4)throw Object.assign(new Error('评价归类结果无效。'),{code:'INVALID_OUTPUT'});return result;},inspectEcommerceRow:async()=>({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'Synthetic direct result',evidence:[2],referenceIds:[],confidence:.9,conflictsWith:[]})),modelId:'synthetic-model'})};
 }

 let frozen,savedBasis,task,before=0;
 if(recovery){
  service=await previous.createAiService({store,modelConfig:config,client:await client(true),onError:e=>errors.push(e.stack),maxAttempts:1,retryDelayMs:0});await service.start(next.tasks[0].id,'synthetic-classification-run');await service.waitForIdle();
  const paused=await store.read();task=paused.state.tasks[0];assert.equal(task.aiStatus,'paused');assert.equal(task.capabilityMonitor.ecommerceClassification.technicalFailures,4);assert.equal(task.aiQueue.rows.filter(r=>r.status==='pending').length,160);
  frozen=structuredClone(paused.state.sessions.slice(0,20).map(s=>({aiResults:s.aiResults,review:s.review,ecommerce:s.ecommerce})));savedBasis=structuredClone(task.basisSnapshot);before=calls;
  await service.close();await store.close();store=await createWorkspaceStore({dataDir:dir});
 }
 service=await createAiService({store,modelConfig:config,client:await client(false),onError:e=>errors.push(e.stack),maxAttempts:1,retryDelayMs:0});
 if(recovery)await service.resume(task.id);else await service.start(next.tasks[0].id,'synthetic-fresh-classification');await service.waitForIdle();const after=await store.read();assert.equal(after.state.tasks[0].aiStatus,'completed',JSON.stringify({errors,stop:after.state.tasks[0].aiQueue.stopReason}));assert.equal(calls-before,recovery?164:180);
 if(recovery){assert.deepEqual(after.state.sessions.slice(0,20).map(s=>({aiResults:s.aiResults,review:s.review,ecommerce:s.ecommerce})),frozen);assert.deepEqual(after.state.tasks[0].basisSnapshot,savedBasis);assert.deepEqual(after.state.tasks[0].source,task.source);}
 const repaired=after.state.sessions.filter(s=>s.sceneCapabilities.outputs.ecommerceClassification.coercion);assert.equal(repaired.length,recovery?164:180);for(const s of repaired){const c=s.sceneCapabilities.outputs.ecommerceClassification;assert.equal(c.attempts,1);assert.equal(c.coercion.requiresHumanReview,true);if(c.status==='completed')assert.equal(c.value.evaluationType,'好评负向');else{assert.equal(c.status,'uncertain');assert.equal(c.value,null);}}
 const {requiresHumanReview,isAIFinal}=await load('public/ai-triage.mjs'),{confirmReview}=await load('public/domain.mjs');assert.ok(after.state.sessions.every(s=>requiresHumanReview(s)&&!isAIFinal(s)));assert.throws(()=>confirmReview(after.state,after.state.sessions[0].id,'2026-11-19T12:00:00Z'),/分类人工复核/);
 assert.equal(after.state.tasks[0].capabilityMonitor.ecommerceClassification.technicalFailures,0);assert.deepEqual(errors,[]);
 await service.close();service=null;await store.close();store=await createWorkspaceStore({dataDir:dir});assert.deepEqual((await store.read()).state,after.state,'normalization audit survives restart');
 if(process.env.VERIFY_CLASSIFICATION_OUTPUT){const file=path.join(process.env.VERIFY_CLASSIFICATION_OUTPUT,`classification-${recovery?'recovery':'fresh'}-verification.json`);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({status:'passed',oldRoot:oldRoot||null,testedRoot:root,syntheticRows:180,pausedCompleted:recovery?20:0,recoveredCapabilities:recovery?4:0,dispatchedPending:recovery?160:180,oneAttemptSuccesses:repaired.length,previousJudgmentsAndReviewPreserved:recovery?20:0,auditPersisted:true,humanReviewMandatory:true,technicalFailures:0,externalModelCalls:0},null,2));}
});
