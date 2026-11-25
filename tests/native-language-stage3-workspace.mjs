// Reusable, offline synthetic Stage 3 workspace. Never opens a production workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createWorkflowTraceStore} from '../server/workflow-traces.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {migrateSceneConfigurations} from '../server/scene-configuration-service.mjs';
import {sceneBasisForTask} from '../public/scene-configuration.mjs';
import {parseMappedInput} from '../public/input-profiles.mjs';
import {workbook} from '../public/io.mjs';
import {freezeNativeLanguage,freezeTaskLanguageContract,languageHash} from '../server/native-language-materials.mjs';
import {nativeReportPromptDraft} from '../server/native-language-prompt-draft.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {syntheticMaterial} from './native-language-fixture.mjs';
import {materialSet,reviewed,modelEnvelope,capabilityBody,ruleBody} from './native-language-stage2-fixture.mjs';
import {nativeReportAnswer} from './native-language-stage3-fixture.mjs';

export const STAGE3_SYNTHETIC_MARKER='stage3-offline-synthetic-v1';
export const syntheticOriginals={customer:'هل توجد نسخة زرقاء؟',agent:'Sí, existe una versión azul.'};
const at='2026-11-25T01:00:00Z',scene='新品产品咨询';
const reason=(language,fail)=>language==='en'?(fail?'The agent does not address the specific customer request.':'The agent provides the information requested by the customer.'):(fail?'坐席未回应用户提出的具体问题。':'坐席提供了用户所询问的具体信息。');

export function createStage3SyntheticModel({language='en',requests=[]}={}){
 assert.ok(['zh','en'].includes(language));
 const config={model:'synthetic-native-stage3',baseUrl:'http://127.0.0.1:9/v1',authMode:'none',configured:true,connectionTested:true,timeoutMs:30000,reasoningEffort:'low'};
 const client=createArkClient({fetchImpl:async(_url,options)=>{
  const request=JSON.parse(options.body),data=JSON.parse(request.messages[1].content);requests.push(request);
  let answer;
  if(data.kind)answer=nativeReportAnswer(data.kind,data.input||data,language);
  else if(data.capability)answer=capabilityBody(data,language);
  else{
   answer=ruleBody(data,language);const fail=String(data.session?.id||'').endsWith('-S1');
   for(const result of answer.results){result.verdict=fail?'FAIL':'PASS';result.reason=reason(language,fail);}
  }
  return modelEnvelope(answer);
 }});
 return{client,requests,modelConfig:{getPrivate:()=>({...config}),publicConfig:()=>({...config,hasApiKey:false})}};
}

function syntheticCatalog(){
 const catalog=createBusinessCatalog(),common={version:'V1.0',category:'合成检查',scope:'合成验收，不是业务口径。',effectiveAt:'2026-11-01',expiresAt:'',owner:'SYNTHETIC TEST OWNER',changeNote:'Synthetic acceptance only',status:'已发布',createdAt:at,publishedAt:at,sceneIds:[scene]};
 catalog.policies=[{...common,id:'NP-SYNTHETIC-POLICY',title:'合成资料',source:'Synthetic acceptance fixture only',sections:[{id:'source',title:'合成条款',text:'回答合成问题，仅验收用。'}]}];
 catalog.rules=[{...common,id:'NP-SYNTHETIC',title:'合成规则',passCriteria:'回答合成问题。',failCriteria:'未回答合成问题。',exceptionCriteria:'依据不足无法判定。',policyIds:['NP-SYNTHETIC-POLICY']}];
 return catalog;
}

function templateMaterial(template){
 const material=syntheticMaterial('template',template.id);material.shared.parameterRefs=[];material.sourceHash=languageHash(template);
 const titles={overview:'Quality overview',dimensions:'Check results',cases:'Case studies',improvements:'Failure causes and improvements',voc:'Customer voice'};
 const columns={translation:'Conversation translation',overall:'Overall result',failureSummary:'Failure reasons and recommended actions',demandSummary:'Customer request',negativeVoiceFlag:'Negative feedback',negativeVoice:'Original negative feedback',salesStage:'Sales stage',intent:'Customer intent'};
 material.clauses=[['title',template.title,'Synthetic consultation quality report'],...template.sections.map(s=>['section.'+s.key,s.title,titles[s.key]||'Quality analysis']),...template.columnGroups.map(g=>['group.'+g.id,g.label,'Synthetic quality checks']),...template.columns.map(c=>['column.'+c.id,c.label,c.generator==='rule'?'Synthetic check':columns[c.field]||'Synthetic '+c.id])].map(([clauseId,zh,en])=>({clauseId,kind:'instruction',locales:{zh,en}}));
 return reviewed(material);
}

/** Seed only an empty directory; caller owns cleanup. Every source and review is synthetic. */
export async function seedStage3Workspace({dataDir,language='en'}={}){
 assert.ok(dataDir,'An explicit isolated dataDir is required.');assert.ok(['zh','en'].includes(language));
 const directory=path.resolve(dataDir);await fs.mkdir(directory,{recursive:true});
 assert.deepEqual(await fs.readdir(directory),[],'Synthetic seeding requires an empty directory.');
 const model=createStage3SyntheticModel({language}),store=await createWorkspaceStore({dataDir:directory,nativeLanguageStage:3,catalogSeed:null,sceneSeed:null});
 let traceStore,ai;
 try{
  const document=migrateSceneConfigurations({state:createBusinessState(),catalog:syntheticCatalog()},{now:at,actor:'SYNTHETIC TEST OPERATOR',reason:'Synthetic acceptance only'});
  const config=document.state.sceneConfigurations.find(c=>c.sceneId===scene);config.executionMode='configured';config.inspectionLanguage=language;
  config.capabilities=[{key:'demandSummary',phase:'pre',executorVersion:'scene-capability.v1',dependsOn:[]}];config.ruleDependencies={'NP-SYNTHETIC':['demandSummary']};
  const template=document.state.deliveryTemplates.find(t=>t.id===config.templateRef.id);template.columnGroups=[{id:'synthetic',label:'合成检查',parentId:''}];
  for(const column of template.columns)if(column.generator==='rule')column.groupId='synthetic';
  await store.save({baseRevision:0,mutationId:'synthetic-initial',...document});await store.enableLanguageGovernance();let view=await store.read();
  await store.selectLanguage({baseRevision:view.revision,operationId:'synthetic-select-language',actor:'SYNTHETIC TEST OPERATOR',language});view=await store.read();
  const bytes=await workbook([{name:'Source',headers:['ID','Started','Agent','Customer text','Agent text','Product'],rows:[1,2].map(i=>['SYNTHETIC-'+i,at,'Synthetic agent',syntheticOriginals.customer,syntheticOriginals.agent,'Synthetic Phone'])}]);
  const file={name:'synthetic-stage3-'+language+'.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  const profile={id:'SYNTHETIC-STAGE3-PAIR',name:'Synthetic source pair',version:1,scene,layout:'pair',sheet:'Source',headerRow:1,dateFormat:'iso',fields:{id:'ID',startedAt:'Started',agent:'Agent',customerText:'Customer text',agentText:'Agent text',product:'Product'},defaults:{completeness:'完整',customer:'Synthetic customer',topic:'Synthetic request',channel:'Synthetic channel'},roleMap:{},extras:[],ruleIds:['NP-SYNTHETIC']};
  const parsed=await parseMappedInput(file,profile);assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
  const source=await store.putSource(bytes,file.name),basis=sceneBasisForTask(view.state,view.catalog,scene,at);
  const state=createImportedTask(view.state,{name:'SYNTHETIC ONLY - native '+language+' acceptance',source,sessions:parsed.sessions,basisSnapshot:basis,reviewer:'SYNTHETIC TEST REVIEWER',importMappingSnapshot:parsed.importMappingSnapshot,sceneRuntime:{outputLanguages:[language]},sceneOverrideReason:'Synthetic native acceptance language',now:at});
  let task=state.tasks.at(-1);
  const materials=[...materialSet(basis,task.executionSnapshot).map(m=>m.kind==='prompt'?reviewed(nativeReportPromptDraft()):m),templateMaterial(task.executionSnapshot.template)];
  for(const material of materials){view=await store.read();await store.publishLanguageMaterial({baseRevision:view.revision,operationId:'synthetic-publish-'+material.id,material});}
  view=await store.read();await store.freezeLanguageMaterial({baseRevision:view.revision,operationId:'synthetic-freeze',materialHashes:materials.map(m=>m.contentHash),promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',actor:'SYNTHETIC TEST OPERATOR',reason:'Synthetic acceptance only; not approval of production material.'});
  view=await store.read();const frozen=freezeNativeLanguage(view.state.workspaceSettings.languagePolicy,{materials,promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});
  for(const key of ['languageMaterials','languageAudit'])state[key]=view.state[key];task=freezeTaskLanguageContract(task,view.state.workspaceSettings.languagePolicy,frozen);state.tasks[state.tasks.length-1]=task;
  await store.save({baseRevision:view.revision,mutationId:'synthetic-native-task',state,catalog:view.catalog});
  traceStore=await createWorkflowTraceStore({dataDir:directory});ai=await createAiService({store,modelConfig:model.modelConfig,client:model.client,traceStore,maxAttempts:2,retryDelayMs:0});
  await ai.start(task.id,'synthetic-stage3-inspection');await ai.waitForIdle();view=await store.read();task=view.state.tasks.find(t=>t.id===task.id);
  assert.equal(task.aiStatus,'completed');const sessions=view.state.sessions.filter(s=>s.taskId===task.id);
  assert.equal(sessions.length,2);for(const session of sessions){assert.equal(session.aiExecution.status,'completed');assert.ok(session.aiResults.every(r=>r.languageValidation.status==='verified'));assert.equal(session.turns[0].text,syntheticOriginals.customer);}
  const metadata={marker:STAGE3_SYNTHETIC_MARKER,language,taskId:task.id,sessionIds:sessions.map(s=>s.id),materialRef:task.executionSnapshot.languageMaterialRef,materialHashes:materials.map(m=>m.contentHash),promptVersion:materials.find(m=>m.kind==='prompt').version,source,scriptedModelCalls:model.requests.length,externalModelCalls:0,reviewStatus:'pending',scope:'Synthetic test data only. No business approval or real-model quality claim.'};
  await fs.writeFile(path.join(directory,'synthetic-stage3.json'),JSON.stringify(metadata,null,2));return metadata;
 }finally{await ai?.close();await traceStore?.close();await store.close();}
}

/** Reopen only a marked synthetic workspace with a local scripted model. */
export async function serveStage3Workspace({dataDir,port=0,requests=[],runtimeRoot=process.env.R39_RUNTIME_ROOT}={}){
 const directory=path.resolve(dataDir),metadata=JSON.parse(await fs.readFile(path.join(directory,'synthetic-stage3.json'),'utf8'));
 assert.equal(metadata.marker,STAGE3_SYNTHETIC_MARKER);const model=createStage3SyntheticModel({language:metadata.language,requests});
 const factory=runtimeRoot?(await import(pathToFileURL(path.join(path.resolve(runtimeRoot),'server.mjs')))).createWorkbenchServer:createWorkbenchServer;
 const server=await factory({dataDir:directory,nativeLanguageStage:runtimeRoot?4:3,arkClient:model.client,modelConfig:model.modelConfig,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false});
 server.listen(port,'127.0.0.1');await once(server,'listening');return{server,origin:'http://127.0.0.1:'+server.address().port,metadata,requests};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1],language=args.includes('--language')?value('--language'):'en';
 const dataDir=args.includes('--data-dir')?path.resolve(value('--data-dir')):path.resolve(process.env.R39_BROWSER_OUTPUT||'../outputs/service-r39-step3-20261125/browser','synthetic-workspace-'+language);
 const metadata=args.includes('--reuse')?JSON.parse(await fs.readFile(path.join(dataDir,'synthetic-stage3.json'),'utf8')):await seedStage3Workspace({dataDir,language});
 if(args.includes('--serve')){const running=await serveStage3Workspace({dataDir,port:args.includes('--port')?Number(value('--port')):0});console.log(JSON.stringify({dataDir,origin:running.origin,...metadata},null,2));}
 else console.log(JSON.stringify({dataDir,...metadata},null,2));
}
