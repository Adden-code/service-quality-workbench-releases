import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
const runtimeRoot=path.resolve(process.env.NATIVE_PILOT_RUNTIME_ROOT||'.');
const runtimeModule=relative=>import(pathToFileURL(path.join(runtimeRoot,relative)).href);
import {chromium} from 'playwright';
const {createWorkbenchServer}=await runtimeModule('server.mjs');
const {createWorkspaceStore}=await runtimeModule('server/workspace-store.mjs');
const {createAiService}=await runtimeModule('server/ai-service.mjs');
const {createArkClient}=await runtimeModule('server/ark-client.mjs');
const {createReportJobs}=await runtimeModule('server/report-jobs.mjs');
const {createImportedTask}=await runtimeModule('public/domain.mjs');
const {sceneBasisForTask}=await runtimeModule('public/scene-configuration.mjs');
const {parseBusinessInput}=await runtimeModule('public/business-input.mjs');
const {parseEcommerceFile}=await runtimeModule('public/ecommerce-input.mjs');
const {SYSTEM_EC_HEADERS}=await runtimeModule('public/ecommerce-system-source.mjs');
const {workbook,readXlsx}=await runtimeModule('public/io.mjs');
const {buildBusinessReportHtml}=await runtimeModule('public/business-report.mjs');
const {buildBusinessDeliveryXlsx}=await runtimeModule('public/business-delivery.mjs');
const {languageHash}=await runtimeModule('server/native-language-materials.mjs');

// All rules, references and configuration bytes are the complete shipped seeds.
// Only business records and model responses are synthetic. No remote requests.
const bundlePath=process.env.NATIVE_PILOT_BUNDLE;
const seedRoot=process.env.NATIVE_PILOT_SEEDS;
const skip=!(bundlePath&&seedRoot)&&'Set NATIVE_PILOT_BUNDLE and NATIVE_PILOT_SEEDS to run the complete shipped-material gate.';
const output=path.resolve(process.env.R39_FULLFLOW_OUTPUT||'outputs/native-pilot-fullflow');
const readJson=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const [bundle,catalogSeed,sceneSeed]=skip?[]:await Promise.all([readJson(bundlePath),readJson(path.join(seedRoot,'catalog-seed.json')),readJson(path.join(seedRoot,'scene-seed.json'))]);
if(!skip)assert.equal(bundle.materials.length,52,'Full shipped pilot bundle, not a reduced one-rule fixture');
const model={model:'SYNTHETIC-OFFLINE-FULLFLOW',baseUrl:'http://127.0.0.1:9/v1',authMode:'none',configured:true,connectionTested:true,timeoutMs:30000,reasoningEffort:'low'};
const modelConfig={getPrivate:()=>model,publicConfig:()=>({...model,hasApiKey:false})};
const q=(language,zh,en)=>language==='zh'?zh:en;
const envelope=value=>new Response(JSON.stringify({id:'synthetic-local-response',model:model.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}),{status:200,headers:{'content-type':'application/json'}});
function reply(data,language){
 const reason=q(language,'客服提供了回应用户具体诉求的信息。','The agent provides specific information that addresses the customer request.');
 if(data.kind){const {kind,input}=data;
  if(kind==='translation')return{items:input.items.map(i=>({id:i.id,isTargetLanguage:false,detectedLanguage:'mixed',translation:q(language,'这是一段合成会话，用户提出产品诉求，客服提供具体回应。','The synthetic customer asks about the product and the agent provides a specific response.'),confidence:.99}))};
  if(kind==='caseHighlights')return{cases:input.candidates.slice(0,input.limit).map(c=>({id:c.id,score:5,commentary:reason,quote:c.reply}))};
  if(['issueClusters','consultationIssues'].includes(kind))return{clusters:[{label:q(language,'具体诉求未得到充分回应','The customer request needs a specific response'),summary:q(language,'客服没有提供用户所询问的具体信息。','The agent did not provide the information requested by the customer.'),memberIds:input.records.map(r=>r.id),action:q(language,'客服应在结束会话前回应具体诉求。','The agent should address the specific customer request before closing the conversation.')}]};
  if(kind==='voc')return{items:input.records.map(r=>({id:r.id,valid:true,scene:'PRODUCT_QUALITY',painPoint:q(language,'用户反映产品电池存在具体问题。','The customer reports a specific issue with the product battery.'),reason:q(language,'用户原文提供了具体产品问题依据。','The original customer comment provides specific evidence of a product issue.'),evidenceQuote:r.comment}))};
  if(kind==='consultationAnalysis'){
   const fields=input.analysisFields||['salesStage','intent','demandSummary','negativeVoice'],voc=input.analysisFields===undefined||input.includeVoc,source=input.record.turns?.find(t=>t.role==='客户')||input.record.turns?.[0],negative=(source?.text||input.record.text||'').includes('SYNTHETIC-ISSUE'),item={id:input.record.id};
   if(fields.includes('salesStage'))Object.assign(item,{salesStage:'PRE_SALES',salesSubstage:q(language,'用户在购买前询问产品信息','The customer asks for product information before purchase')});
   if(fields.includes('intent'))Object.assign(item,{intentLabel:input.taxonomy?.length?'UNKNOWN':'UNCONFIGURED',intentReferenceId:''});
   if(fields.includes('demandSummary'))item.demandSummary=q(language,'用户询问具体产品信息并希望获得明确回应。','The customer asks for specific product information and a clear response.');
   if(fields.includes('negativeVoice')||voc)Object.assign(item,{sentiment:negative?'NEGATIVE':'POSITIVE',negativeVoices:negative?[{turnId:source.id,quote:source.text}]:[]});
   if(voc)item.voc={valid:negative,scene:negative?'PRODUCT_QUALITY':'OTHER',painPoint:negative?q(language,'用户反映产品电池存在具体问题。','The customer reports a specific issue with the product battery.'):'',reason:q(language,negative?'用户原文明确反映具体电池问题。':'用户没有提供需要归类的具体负面问题。',negative?'The customer provides specific evidence of a battery issue.':'The customer does not provide a specific negative issue to classify.'),evidenceQuote:negative?source.text:''};
   return{items:[item]};
  }
  if(kind==='scenarioFields')return{recordId:input.record.id,fields:input.fields.map(f=>({id:f.id,value:'',missing:true,turnId:null}))};
  throw Error('Unexpected synthetic report kind: '+kind);
 }
 if(data.capability){
  const b=data.blocks[0],negative=b.text.includes('SYNTHETIC-ISSUE');let value;
  if(data.capability==='ecommerceClassification')value={polarity:negative?'negative':'positive',vocKind:negative?'substantive':'none'};
  else if(data.capability==='intent')value={labelId:data.taxonomy.labels.find(l=>l.parentId).id};
  else if(data.capability==='site')value={siteId:data.sites[0].id};
  else if(data.capability==='negativeVoice')value={hasNegative:negative,text:q(language,negative?'用户反映了具体电池问题。':'用户没有表达具体负面问题。',negative?'The customer reports a specific battery issue.':'The customer does not report a negative issue.')};
  else if(data.capability==='timing')value={firstCustomer:null,firstAgent:null,queries:[],completeCoverage:true};
  else value={text:q(language,'用户询问具体产品信息。','The customer asks for specific product information.')};
  return{status:'completed',value,confidence:.99,reason:q(language,'用户原文为本次辅助判定提供了具体依据。','The original customer text provides specific evidence for this auxiliary finding.'),evidence:[{blockId:b.id,quote:b.text,start:0,end:b.text.length}]};
 }
 const turn=data.session.turns.find(t=>t.role==='客服')||data.session.turns.at(-1),failed=turn.text.includes('SYNTHETIC-FAIL');
 return{results:data.basis.rules.map(r=>({ruleId:r.id,verdict:failed&&['NP-R03','EC-TARGET'].includes(r.id)?'FAIL':'PASS',reason:failed&&['NP-R03','EC-TARGET'].includes(r.id)?q(language,'客服没有回应用户提出的具体问题。','The agent does not address the specific customer request.'):reason,evidence:[turn.id],evidenceQuotes:[{turnId:turn.id,role:turn.role,quote:turn.text}],fieldEvidence:[],referenceIds:r.policyIds.map(id=>data.basis.policies.find(p=>p.id===id).sections[0].referenceKey),confidence:.99,conflictsWith:[]}))};
}
async function inputFile(scene){
 if(scene==='电商评论回复'){
  const rows=[0,1].map(i=>{const raw=Array(23).fill('');Object.assign(raw,{0:'SYNTHETIC-EC-'+i,3:'Synthetic product',4:'VMALL-MX-HWB2C',5:i?'La batería falla cada día. SYNTHETIC-ISSUE':'La pantalla es muy clara. SYNTHETIC-PRAISE',6:i?'Gracias por escribir. SYNTHETIC-FAIL':'Nos alegra que disfrutes de la pantalla clara. SYNTHETIC-PASS',7:i?'1':'5',8:'SYNTHETIC-AGENT-'+i,9:'2026-11-24 10:00:00',16:'2026-11-24 11:00:00',22:'是'});return raw;});
  const bytes=Buffer.from(await workbook([{name:'System export',headers:[...SYSTEM_EC_HEADERS],rows}]));const parsed=await parseEcommerceFile({name:'synthetic-ec.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));assert.ok(parsed.sessions.every(s=>s.ecommerce.systemSource.format==='business-export-23.v1'));return{bytes,name:'synthetic-ec.xlsx',sessions:parsed.sessions};
 }
 const infoHeaders=['会话ID','业务场景','会话开始时间','会话主题','渠道','产品型号','客服标识','客户标识','会话完整性','缺失说明'],turnHeaders=['会话ID','轮次序号','发言角色','发言方标识','发言时间','原文内容'];
 const ids=['SYNTHETIC-NP-PASS','SYNTHETIC-NP-FAIL'],info=ids.map(id=>[id,scene,'2026-11-24T10:00:00+08:00','Synthetic product question','Synthetic channel','Synthetic product','Synthetic agent','Synthetic customer','完整','']),turns=ids.flatMap((id,i)=>[[id,1,'客户','Synthetic customer','2026-11-24T10:00:00+08:00',i?'La batería falla cada día. SYNTHETIC-ISSUE':'هل توجد نسخة زرقاء؟'],[id,2,'客服','Synthetic agent','2026-11-24T10:00:10+08:00',i?'Gracias por escribir. SYNTHETIC-FAIL':'Sí, puedo comprobar la versión azul. SYNTHETIC-PASS']]);
 const bytes=Buffer.from(await workbook([{name:'会话信息',headers:infoHeaders,rows:info},{name:'会话明细',headers:turnHeaders,rows:turns}])),parsed=await parseBusinessInput({name:'synthetic-np.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));return{bytes,name:'synthetic-np.xlsx',sessions:parsed.sessions};
}
async function reviewAll(store,task,language){
 const ids=(await store.read()).state.sessions.filter(s=>s.taskId===task.id).map(s=>s.id);
 const command=async(id,action,extra={})=>{const s=(await store.read()).state.sessions.find(s=>s.id===id);return store.reviewCommand({mutationId:crypto.randomUUID(),sessionId:id,expected:JSON.stringify(s.review),action,at:new Date().toISOString(),...extra});};
 for(const id of ids){
  let s=(await store.read()).state.sessions.find(s=>s.id===id);
  if(s.ecommerce){const c=s.sceneCapabilities.outputs.ecommerceClassification.value;await command(id,'classification',{packet:{evaluationType:c.evaluationType,vocKind:c.vocKind,reason:q(language,'合成测试审核人已核对原文分类。','The synthetic reviewer checked this classification against the original source.')}});}
  await command(id,'accept');s=(await store.read()).state.sessions.find(s=>s.id===id);
  // Synthetic human adjudication exercises the normal review command, not a
  // runtime bypass. Unknown program components are explicitly retained in AI.
  for(const r of s.aiResults.filter(r=>r.verdict==='无法判定'))await command(id,'save',{draft:{ruleId:r.ruleId,verdict:'不适用',reason:q(language,'合成测试人工复核记录：此检查在本合成样本中标记不适用，AI无法判定原记录保留。','Synthetic human review marks this check not applicable to this fixture; the original unknown AI finding remains preserved.'),evidence:[1],referenceIds:[]}});
  await command(id,'confirm');
 }
}
for(const language of ['zh','en'])for(const scene of ['新品产品咨询','电商评论回复'])test(`full 52-material pilot ${language} ${scene}: ordinary import, AI, human review, report, restart and browser downloads`,{skip},async t=>{
 const key=(scene==='新品产品咨询'?'np':'ec')+'-'+language;await fs.mkdir(output,{recursive:true});const dir=await fs.mkdtemp(path.join(output,key+'-')),dataDir=path.join(dir,'workspace'),requests=[],modelFailures=[];
 let store,ai,reports,server,browser;
 t.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await reports?.close();await ai?.close();await store?.close();});
 const client=createArkClient({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body),data=JSON.parse(body.messages[1].content);requests.push({system:body.messages[0].content,data});try{if(data.contract==='native-language-v1'||data.contract==='native-report-v1')if(language==='en')assert.doesNotMatch(body.messages[0].content,/\p{Script=Han}/u);return envelope(reply(data,language));}catch(e){modelFailures.push(e.message);throw e;}}});
 store=await createWorkspaceStore({dataDir,catalogSeed,sceneSeed,nativeLanguageStage:4});await store.enableLanguageGovernance();let current=await store.read();await store.selectLanguage({baseRevision:current.revision,operationId:'select-'+key,actor:'SYNTHETIC TEST',language});current=await store.read();await store.activateNativePilotMaterials(bundle,{baseRevision:current.revision,operationId:'activate-'+key,actor:'SYNTHETIC TEST',reason:'Synthetic fullflow activation; business review pending',acknowledgeUnreviewed:true,bundleHash:languageHash(bundle)});
 assert.ok((await store.nativeReadiness()).scenes.every(s=>s.status==='ready'));
 const input=await inputFile(scene),source=await store.putSource(input.bytes,input.name);current=await store.read();const basis=sceneBasisForTask(current.state,current.catalog,scene,new Date().toISOString());assert.equal(basis.rules.length,scene==='新品产品咨询'?17:5);
 const next=createImportedTask(current.state,{name:'SYNTHETIC FULLFLOW '+key,source,sessions:input.sessions,basisSnapshot:basis,reviewer:'SYNTHETIC REVIEWER',now:new Date().toISOString(),executionSettings:{concurrency:1}});let saved=await store.save({baseRevision:current.revision,mutationId:'create-'+key,state:next,catalog:current.catalog}),task=saved.state.tasks[0];
 const frozenBefore=JSON.stringify(task.executionSnapshot),originals=JSON.stringify(saved.state.sessions.map(s=>s.turns));
 if(scene==='电商评论回复'){const reference=task.executionSnapshot.configuration.referenceMaterials[0],frozen=await store.readNativeMaterial(task),material=frozen.paired.find(m=>m.id===reference.id);assert.ok(material,'EC referenceMaterials must be included in the frozen native package');assert.equal(material.sourceHash,languageHash(reference));}
 ai=await createAiService({store,modelConfig,client,maxAttempts:2,retryDelayMs:0});await ai.start(task.id,'synthetic-fullflow-'+key);await ai.waitForIdle();saved=await store.read();task=saved.state.tasks[0];assert.equal(task.aiStatus,'completed',JSON.stringify({queue:task.aiQueue,modelFailures}));assert.equal(JSON.stringify(saved.state.sessions.map(s=>s.turns)),originals);assert.equal(JSON.stringify(task.executionSnapshot),frozenBefore);
 await reviewAll(store,task,language);saved=await store.read();assert.ok(saved.state.sessions.every(s=>s.review.status==='已确认'));
 reports=await createReportJobs({dataDir,store,modelConfig,client,maxAttempts:2,retryDelayMs:0,onError:e=>modelFailures.push(e.stack)});const jobId='fullflow-'+key;await reports.create({jobId,taskId:task.id,targetLang:language,reportLanguage:language});await reports.waitForIdle();const result=await reports.getResult(jobId);
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(dir,'model-requests.json'),JSON.stringify(requests,null,2));
 assert.equal(result.job.status,'completed',JSON.stringify({nodes:result.job.nodes,modelFailures}));assert.equal(result.job.nativeLanguage,language);assert.equal(result.enrichment.analysisComplete,true);
 const kinds=new Set(requests.filter(r=>r.data.contract==='native-report-v1').map(r=>r.data.kind));for(const kind of scene==='新品产品咨询'?['consultationIssues','caseHighlights']:['issueClusters','voc','caseHighlights'])assert.ok(kinds.has(kind),'Missing fullflow node '+kind);
 if(scene==='新品产品咨询')for(const capability of ['intent','demandSummary','negativeVoice'])assert.ok(requests.some(r=>r.data.capability===capability&&r.data.contract==='native-language-v1'),'Full configured NP report reuses native '+capability);
 if(scene==='电商评论回复'){const highlight=requests.find(r=>r.data.kind==='caseHighlights').data.input;assert.equal(highlight.referenceMaterials[0].id,'EC-REPLY-STRATEGIES');assert.equal(highlight.referenceMaterials[0].sections.length,19);if(language==='en')assert.doesNotMatch(highlight.referenceMaterials[0].sections.map(s=>s.text).join('\n'),/\p{Script=Han}/u);}
 const html=buildBusinessReportHtml(result.snapshot,result.enrichment,{language,job:result.job}),xlsx=await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment,{language});await fs.writeFile(path.join(dir,'report.html'),html);await fs.writeFile(path.join(dir,'details.xlsx'),xlsx);assert.match(html,new RegExp(`<html lang="${language==='en'?'en':'zh-CN'}"`));assert.doesNotMatch(html,/\[Translation missing\]|\[Translation unavailable|\[Untranslated:|Translation pending/);assert.ok(JSON.stringify(await readXlsx(xlsx)).includes('SYNTHETIC-ISSUE'));assert.deepEqual(modelFailures,[]);
 const callCount=requests.length;await reports.close();reports=null;await ai.close();ai=null;await store.close();store=null;
 store=await createWorkspaceStore({dataDir,nativeLanguageStage:4});assert.equal(JSON.stringify((await store.read()).state.tasks[0].executionSnapshot),frozenBefore);reports=await createReportJobs({dataDir,store,modelConfig,client,retryDelayMs:0});assert.deepEqual(await reports.getResult(jobId),result);assert.equal(requests.length,callCount);await reports.close();reports=null;await store.close();store=null;
 server=await createWorkbenchServer({dataDir,nativeLanguageStage:4,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false,arkClient:client,modelConfig});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:/Users/42910/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}}),pageErrors=[],external=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.route('**/*',route=>{if(/^https?:/.test(route.request().url())&&!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.goto(origin);await page.locator('[data-native-readiness="ready"]').waitFor();await page.locator('.nav-link[data-act="nav"][data-page="exports"]').click();await page.locator(`[data-act="business-job-mount"][data-job-id="${jobId}"]`).waitFor();await page.locator(`[data-act="business-job-mount"][data-job-id="${jobId}"]`).click();
 for(const [action,extension]of [['business-download-html','html'],['business-download-xlsx','xlsx']]){const button=page.locator(`[data-act="${action}"]`);await button.waitFor();await page.waitForFunction(a=>!document.querySelector(`[data-act="${a}"]`).disabled,action);const downloadPromise=page.waitForEvent('download');await button.click();const download=await downloadPromise;await download.saveAs(path.join(dir,'mounted-download.'+extension));assert.equal(await download.failure(),null);}
 const mountedHtml=await fs.readFile(path.join(dir,'mounted-download.html'),'utf8'),mountedSheets=await readXlsx(await fs.readFile(path.join(dir,'mounted-download.xlsx')));assert.match(mountedHtml,new RegExp(`<html lang="${language==='en'?'en':'zh-CN'}"`));assert.doesNotMatch(mountedHtml,/\[Translation missing\]|\[Translation unavailable|\[Untranslated:|Translation pending/);assert.ok(JSON.stringify(mountedSheets).includes('SYNTHETIC-ISSUE'));assert.doesNotMatch(JSON.stringify(mountedSheets),/Translation missing|Translation unavailable|Translation pending|Untranslated:/);assert.equal(requests.length,callCount,'Mounting/downloading must not rerun native inspection or report analysis');assert.deepEqual(external,[]);assert.deepEqual(pageErrors,[]);await page.screenshot({path:path.join(dir,'mounted-deliverable.png'),fullPage:true});await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify({status:'passed',runtimeRoot,scene,language,materials:bundle.materials.length,model:'scripted-local-only',externalModelCalls:0,jobId,kinds:[...kinds],pageErrors,external},null,2));
});
