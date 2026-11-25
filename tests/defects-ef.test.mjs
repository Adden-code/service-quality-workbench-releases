import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {createTranslationJobs} from '../server/translation-jobs.mjs';
import {translationHash} from '../server/translation-source.mjs';
import {planConsultationReport,mergeConsultationReport} from '../server/consultation-report-plan.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {businessExportView} from '../public/business-export-view.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';
import {setLocale} from '../public/i18n.mjs';
import {readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {consultationRuntimeFixture,consultationReportAnswer} from './consultation-runtime-fixture.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {reportFixture} from './business-report-fixtures.mjs';
import {scenarioConfig} from './scenario-report-fixtures.mjs';
import {publishedFixture,sourceRow,cutoff} from './v21-runtime-fixtures.mjs';
import {ecommerceSourceProjection,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';

const base=path.resolve(import.meta.dirname,'../../EF/runtime-tests');
const copy=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const invalid=error=>error.code==='INVALID_OUTPUT';
const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-EF',authMode:'none',timeoutMs:120000,reasoningEffort:'low',maxTokens:null};
const envelope=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
const translated=(source,id)=>({id,translation:source,isTargetLanguage:true,detectedLanguage:'en'});
const parseTranslation=(source,item,targetLang='en')=>parseReportEnrichment(JSON.stringify({items:[{id:'t',...item}]}),prepareReportEnrichment('translation',{targetLang,items:[{id:'t',text:source}]}));
const mixedBad='This English explanation adds a separate invented conclusion.\n新增中文结论：建议改进客服表现。';
function goodTranslation(input){return{items:input.items.map(item=>input.targetLang==='zh'?{id:item.id,translation:'中文译文：'+item.text,isTargetLanguage:false,detectedLanguage:'mixed'}:/^\P{Script=Han}*$/u.test(item.text)?translated(item.text,item.id):{id:item.id,translation:'English translation with complete source content.',isTargetLanguage:false,detectedLanguage:'mixed'})};}
function ecState(){
 const row=sourceRow({row:3,reply:'Please check the battery connection.',type:'好评负向'});row.ecommerce.raw[8]='The battery stops working.';row.ecommerce.raw[21]='The agent did not address the battery failure.';Object.assign(row,ecommerceSourceProjection(row.ecommerce));
 const {state}=publishedFixture([row]),task=state.tasks[0];task.aiRun={id:'preserved-quality',inspectionAt:cutoff,startedAt:cutoff};
 const session=state.sessions[0];session.aiExecution={status:'completed',runId:task.aiRun.id};session.aiResults=[timeJudgment(session,{basis:task.basisSnapshot,inspectionAt:cutoff}),...EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:ruleId==='EC-TEXT'?'不符合':'符合',reason:'原有质检结论。',evidence:[1,2],referenceIds:[]}))];
 return{state,task};
}
function ecAnswer(kind,input){
 if(kind==='translation')return goodTranslation(input);
 if(kind==='issueClusters')return{clusters:[{label:'回应不足',summary:'未回应具体故障。',memberIds:input.records.map(row=>row.id),action:'先确认用户故障。'}]};
 if(kind==='caseHighlights')return{cases:input.candidates.slice(0,input.limit).map(row=>({id:row.id,score:4,commentary:'回复给出具体检查动作。',quote:row.reply}))};
 return{items:input.records.map(row=>({id:row.id,valid:true,scene:'产品质量',painPoint:'电池停止工作。',reason:'用户提出具体故障。',evidenceQuote:row.comment}))};
}
async function setup(t,{data=ecState(),provider,rawClient,maxAttempts=2}={}){
 await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'job-')),calls=[];
 const store={read:async()=>({state:copy(data.state),revision:15}),getSource:async()=>({...data.task.source,bytes:data.bytes})};
 const client=rawClient||createArkClient({fetchImpl:async(_url,options)=>{const request=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push(copy(request));return envelope(provider?await provider(request,calls):ecAnswer(request.kind,request.input));}});
 const dependencies={dataDir:dir,store,modelConfig:{getPrivate:()=>({...config})},client,retryDelayMs:1,maxAttempts};let service=await createReportJobs(dependencies);
 t.after(async()=>{await service.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 return{...data,dir,calls,client,get service(){return service;},async restart(){await service.close();service=await createReportJobs(dependencies);}};
}

test('E prepared English parser rejects added Chinese and und bypass; same-English preserves exact source',async t=>{
 for(const detectedLanguage of ['mixed','de','und'])await t.test(detectedLanguage,()=>assert.throws(()=>parseTranslation('Please repair the battery.',{translation:mixedBad,isTargetLanguage:false,detectedLanguage}),invalid));
 assert.equal(parseTranslation('  Exact English source 🙂  ',{translation:'An invented replacement',isTargetLanguage:true,detectedLanguage:'en-US'}).items[0].translation,'  Exact English source 🙂  ');
 for(const source of ['12345','🙂🔋','USB-C 123'])assert.equal(parseTranslation(source,{translation:source,isTargetLanguage:false,detectedLanguage:'und'}).items[0].translation,source);
 assert.throws(()=>parseTranslation('请联系张三确认。',{translation:'Please contact 张三 to confirm.',isTargetLanguage:false,detectedLanguage:'zh'}),invalid);
 assert.equal(parseTranslation('请联系张三确认。',{translation:'Please contact Zhang San to confirm.',isTargetLanguage:false,detectedLanguage:'zh'}).items[0].translation,'Please contact Zhang San to confirm.');
 assert.throws(()=>parseTranslation('请联系张三确认。',{translation:'Please contact 李四 to confirm.',isTargetLanguage:false,detectedLanguage:'zh'}),invalid);
 assert.equal(parseTranslation('Hello',{translation:'你好',isTargetLanguage:false,detectedLanguage:'en'},'zh').items[0].translation,'你好');
 const prompt=prepareReportEnrichment('translation',{targetLang:'en',items:[{id:'t',text:'Hello'}]});assert.match(prompt.messages[0].content,/分析|analysis/);assert.notEqual(prompt.promptVersion,'business-report-enrichment-v1:translation');
});

test('E actual Ark parser rejects bad English then report jobs retry to verified source for comment reply and humanIssue',async t=>{
 let first=true;const f=await setup(t,{provider:({kind,input})=>kind==='translation'&&first?(first=false,{items:input.items.map(item=>({id:item.id,translation:mixedBad,isTargetLanguage:false,detectedLanguage:'mixed'}))}):ecAnswer(kind,input)}),before=JSON.stringify(f.state);
 await f.service.create({jobId:'english-retry',taskId:f.task.id,targetLang:'en'});await f.service.waitForIdle();const result=await f.service.getResult('english-retry');assert.equal(result.job.status,'completed');
 assert.equal(f.calls.filter(call=>call.kind==='translation').length,2);const record=result.snapshot.records[0],entries=result.enrichment.translations[record.id];
 for(const [field,index]of [['comment',8],['reply',9],['humanIssue',21]]){assert.equal(entries[field].text,record.raw22[index]);assert.equal(entries[field].status,'same');}
 assert.equal(JSON.stringify(f.state),before);assert.deepEqual(result.snapshot.records[0].ai.map(row=>row.verdict),['通过','不通过','通过','通过','通过']);
 const detail=await f.service.getNode('english-retry',result.job.nodes.find(node=>node.kind==='translation').id);assert.equal(detail.attempts[0].status,'failed');assert.match(JSON.stringify(detail.attempts[0].output),/新增中文结论/);
});

test('E grounded Chinese prose appended to English is not treated as retained proper names',()=>{
 const source='客服未回答用户关于电池续航的问题。需要进一步确认使用环境，再说明可操作的排查步骤。';
 const english='The agent did not answer the question about battery life. They need to confirm the environment and describe concrete troubleshooting steps before closing the conversation.';
 for(const paragraph of [source,source.replaceAll('。','；')])assert.throws(()=>parseTranslation(source,{translation:english+'\n'+paragraph,isTargetLanguage:false,detectedLanguage:'zh'}),invalid);
 for(const [original,translation]of [['华为 P70屏幕清晰，支持无线充电。','The 华为 P70 has a clear display and supports wireless charging.'],['服务代表 محمد 已回复。','The agent محمد has replied.'],['客服 Иван 已回复。','Agent Иван has replied.'],['产品 α 已准备好。','The α product is ready.']])assert.throws(()=>parseTranslation(original,{translation,isTargetLanguage:false,detectedLanguage:'mixed'}),invalid);
});

test('E injected report client cannot cache mixed English; exhausted jobs export explicit missing then retry only translation',async t=>{
 let healthy=false;const calls=[],client={async enrichBusinessReport(request){calls.push(copy({kind:request.kind,input:request.input}));return request.kind==='translation'&&!healthy?{items:request.input.items.map(item=>({id:item.id,translation:mixedBad,isTargetLanguage:false,detectedLanguage:'mixed'}))}:ecAnswer(request.kind,request.input);}};
 const f=await setup(t,{rawClient:client});await f.service.create({jobId:'english-missing',taskId:f.task.id,targetLang:'en'});await f.service.waitForIdle();const result=await f.service.getResult('english-missing');
 assert.equal(result.job.status,'completed_with_warnings');assert.equal(result.enrichment.translationStats.failedTexts,3);assert.equal(result.enrichment.translationStats.missingCells,3);assert.equal(result.enrichment.translationStats.missingRecords,1);assert.ok(result.enrichment.warnings.some(w=>w.code==='invalid_output'));assert.deepEqual(await fs.readdir(path.join(f.dir,'report-cache')),[]);
 const native=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment)),english=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment,{language:'en'}));
 const nativeRow=native['检核明细'].find(row=>row[XLSX_ROW_NUMBER]===3),englishRow=english['Inspection Details'].find(row=>row[XLSX_ROW_NUMBER]===3);assert.equal(nativeRow[22],'');assert.equal(englishRow[22],'[Untranslated: English translation unavailable]');assert.equal(englishRow[8],result.snapshot.records[0].raw22[8]);
 for(const options of [{},{language:'en'}]){const html=buildBusinessReportHtml(result.snapshot,result.enrichment,options);assert.ok(!html.includes(mixedBad));assert.match(html,/缺失|Translation (failed|missing)/);}
 const nonTranslation=calls.filter(call=>call.kind!=='translation').length,snapshot=JSON.stringify(result.snapshot);healthy=true;await f.service.retry('english-missing');await f.service.waitForIdle();assert.equal((await f.service.get('english-missing')).status,'completed');assert.equal(calls.filter(call=>call.kind!=='translation').length,nonTranslation);assert.equal(JSON.stringify((await f.service.getResult('english-missing')).snapshot),snapshot);
});

test('E legacy completed bad English reads as missing without writes or calls; explicit retry preserves analyses and attempts',async t=>{
 const f=await setup(t);await f.service.create({jobId:'legacy-complete',taskId:f.task.id,targetLang:'en'});await f.service.waitForIdle();const before=await f.service.getResult('legacy-complete');await f.service.close();
 const folder=path.join(f.dir,'report-jobs','legacy-complete'),meta=path.join(folder,'job.json'),job=JSON.parse(await fs.readFile(meta,'utf8')),unit=job.units.find(unit=>unit.kind==='translation'),file=path.join(folder,unit.id+'.json'),stored=JSON.parse(await fs.readFile(file,'utf8'));
 stored.value.items[0]={...stored.value.items[0],translation:mixedBad,isTargetLanguage:false,detectedLanguage:'mixed'};stored.sha256=sha(stored.value);unit.resultSha256=stored.sha256;await fs.writeFile(file,JSON.stringify(stored));await fs.writeFile(meta,JSON.stringify(job));
 const baseline=await Promise.all(['snapshot.json','job.json',unit.id+'.json',unit.id+'-a1.json'].map(async name=>[name,await fs.readFile(path.join(folder,name),'utf8')])),calls=f.calls.length;
 // Legacy cache has a valid envelope but invalid target-language content.
 for(const name of await fs.readdir(path.join(f.dir,'report-cache'))){const cacheFile=path.join(f.dir,'report-cache',name),cache=JSON.parse(await fs.readFile(cacheFile,'utf8'));cache.value={translation:mixedBad,isTargetLanguage:false,detectedLanguage:'mixed'};cache.sha256=sha(cache.value);await fs.writeFile(cacheFile,JSON.stringify(cache));}
 await f.restart();const result=await f.service.getResult('legacy-complete');assert.equal(result.job.status,'completed_with_warnings');assert.equal((await f.service.get('legacy-complete')).nodes.find(node=>node.id===unit.id).status,'failed');assert.equal((await f.service.list(f.task.id))[0].warningsCount,1);assert.equal(result.enrichment.translationStats.failedTexts,3);assert.equal(f.calls.length,calls);
 assert.deepEqual(result.enrichment.issueClusters,before.enrichment.issueClusters);for(const [name,contents]of baseline)assert.equal(await fs.readFile(path.join(folder,name),'utf8'),contents,'read-only '+name);
 const nonTranslation=f.calls.filter(call=>call.kind!=='translation').length;await f.service.retry('legacy-complete');await f.service.waitForIdle();assert.equal((await f.service.get('legacy-complete')).status,'completed');assert.equal(f.calls.filter(call=>call.kind!=='translation').length,nonTranslation);assert.equal(await fs.readFile(path.join(folder,unit.id+'-a1.json'),'utf8'),baseline.find(([name])=>name===unit.id+'-a1.json')[1]);assert.equal(JSON.stringify((await f.service.getResult('legacy-complete')).snapshot),JSON.stringify(before.snapshot));
});

test('E direct legacy render inputs cannot bypass native or derived English translation slots',async()=>{
 const {snapshot,enrichment}=reportFixture();snapshot.targetLang='en';const record=snapshot.records.find(record=>record.id==='case-bad');
 for(const field of ['comment','reply','humanIssue'])enrichment.translations[record.id][field]={status:'translated',text:mixedBad,detectedLanguage:'mixed'};
 const derived=collectReportTranslationFields(snapshot,enrichment).map(field=>({id:field.id,sourceText:field.text,status:'translated',text:mixedBad,detectedLanguage:'mixed'}));
 for(const options of [{},{language:'en',translations:derived}]){
  const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options)),main=tables[options.language?'Inspection Details':'检核明细'],row=main.find(row=>row[XLSX_ROW_NUMBER]===record.sourceRow);assert.ok(!row[22].includes('新增中文'));if(options.language)assert.equal(row[22],'[Untranslated: English translation unavailable]');else assert.ok(!row[22].includes(record.raw22[8]));
  const html=buildBusinessReportHtml(snapshot,enrichment,options),slots=[...html.matchAll(/<p class="translation"[^>]*>([\s\S]*?)<\/p>/g)].map(match=>match[1]);assert.ok(slots.every(text=>!text.includes('新增中文结论')));assert.ok(html.includes(record.raw22[8]));
 }
});

test('E consultation whole conversation retains every 18000-character segment and guards old segment/excerpt outputs',async()=>{
 const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';for(const record of snapshot.records)record.confirmed=record.final.map(item=>({...item,source:'none'}));const record=snapshot.records[0];record.conversation='English conversation 🙂 '.repeat(1800);for(const row of snapshot.original.rows.filter(row=>row.recordId===record.id))row.values[1]=record.conversation;
 const prepared=planConsultationReport(snapshot,'model'),job={units:prepared.units.map(unit=>({...unit,status:unit.kind==='translation'?'completed':'failed'})),status:'completed_with_warnings'},outputs=new Map();
 for(const unit of job.units.filter(unit=>unit.kind==='translation'))outputs.set(unit.id,{items:unit.itemIds.map(id=>{const item=prepared.translations.get(id);return translated(item.text,id);})});
 // Valid source-language segments are copied exactly, including surrogate pairs.
 let merged=mergeConsultationReport(snapshot,job,prepared,outputs);assert.equal(merged.translations[record.id].conversation.text,record.conversation);assert.equal(job.units[0].id,'n1');
 const first=job.units.find(unit=>unit.kind==='translation');outputs.set(first.id,{items:first.itemIds.map(id=>({id,translation:mixedBad,isTargetLanguage:false,detectedLanguage:'mixed'}))});merged=mergeConsultationReport(snapshot,job,prepared,outputs);assert.equal(merged.translations[record.id].conversation.status,'failed');assert.ok(merged.translationStats.failedTexts>0);assert.ok(merged.warnings.some(w=>w.code==='invalid_output'));
 enrichment.translations[record.id].conversation={status:'translated',text:mixedBad,detectedLanguage:'mixed'};for(const turn of record.turns)enrichment.translations[record.id][`excerpt-${turn.id}`]={status:'translated',text:mixedBad,detectedLanguage:'mixed'};
 for(const options of [{},{language:'en'}]){const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options)),main=tables[options.language?'Inspection Details':'检核明细'];assert.ok(main.slice(1).filter(row=>row[0]===record.id).every(row=>!row[3].includes('新增中文结论')));const html=buildBusinessReportHtml(snapshot,enrichment,options);assert.ok(![...html.matchAll(/<p class="translation"[^>]*>([\s\S]*?)<\/p>/g)].some(match=>match[1].includes('新增中文结论')));}
});

test('E consultation actual client retries English conversation contamination and exports complete conversations and exact excerpts',async t=>{
 const data=await consultationRuntimeFixture(2);let bad=true;const expected=text=>text.replaceAll('客户：','Customer: ').replaceAll('客服：','Agent: ');
 const f=await setup(t,{data,provider:({kind,input})=>{if(kind!=='translation')return consultationReportAnswer(kind,input);if(bad){bad=false;return{items:input.items.map(item=>({id:item.id,translation:mixedBad,isTargetLanguage:false,detectedLanguage:'mixed'}))};}return{items:input.items.map(item=>expected(item.text)===item.text?translated(item.text,item.id):{id:item.id,translation:expected(item.text),isTargetLanguage:false,detectedLanguage:'mixed'})};}}),before=JSON.stringify(f.state);
 await f.service.create({jobId:'consultation-en',taskId:f.task.id,targetLang:'en'});await f.service.waitForIdle();const result=await f.service.getResult('consultation-en');assert.equal(result.job.status,'completed');assert.equal(result.job.nodes[0].attempts,2);assert.equal(JSON.stringify(f.state),before);
 for(const record of result.snapshot.records)assert.equal(result.enrichment.translations[record.id].conversation.text,expected(record.conversation));
 for(const options of [{},{language:'en'}]){const tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment,options)),main=tables[options.language?'Inspection Details':'检核明细'];for(const source of result.snapshot.original.rows){const row=main.find(row=>row[XLSX_ROW_NUMBER]===source.sourceRow),record=result.snapshot.records.find(record=>record.id===source.recordId);assert.deepEqual(row.slice(0,3),source.values);assert.equal(row[3],expected(record.conversation));}const html=buildBusinessReportHtml(result.snapshot,result.enrichment,options);assert.ok(!html.includes('新增中文结论'));assert.ok(html.includes('The device is not compatible with my computer 0.'));}
});

async function contentSetup(t){
 await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'content-')),data=reportFixture(),calls=[];let blockWrites=false;data.snapshot.taskName='客服未回答用户关于电池续航的问题, 需要进一步确认使用环境, 再说明可操作的排查步骤.';data.snapshot.records[0].raw22[8]='This exact English source is preserved. '.repeat(450);
 const client=createArkClient({fetchImpl:async(_url,options)=>{const request=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push(copy(request));return envelope(goodTranslation(request.input));}}),dependencies={dataDir:dir,store:{read:async()=>({state:{tasks:[],sessions:[]}})},modelConfig:{getPrivate:()=>({...config})},client,retryDelayMs:1,fsOps:{...fs,rename:async(from,to)=>{if(blockWrites&&/[/\\]n1\.json$/.test(to))throw Object.assign(new Error('synthetic repair write fault'),{code:'EIO'});return fs.rename(from,to);}},reportJobs:{getResult:async()=>({...copy(data),job:{id:'base-report',status:'completed',snapshotFingerprint:'f'.repeat(64),sourceRevision:15}})}};
 let service=await createTranslationJobs(dependencies);t.after(async()=>{await service.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});return{dir,data,calls,get service(){return service;},blockResultWrites(value){blockWrites=value;},async restart(){await service.close();service=await createTranslationJobs(dependencies);}};
}

test('E actual derived same-English content results remain exact in English report cells',async t=>{
 const f=await contentSetup(t);await f.service.create({jobId:'derived-same',source:{kind:'report',jobId:'base-report'},targetLang:'en'});await f.service.waitForIdle();const result=await f.service.getResult('derived-same'),source=f.data.snapshot.records[0].raw22[8],value=result.translations.find(entry=>entry.sourceText===source);assert.equal(value.status,'same');assert.equal(value.text,source);
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(f.data.snapshot,f.data.enrichment,{language:'en',translations:result.translations,translationJob:result.job}));assert.equal(tables['Inspection Details'][2][22],source);
});

for(const interrupted of [false,true])test(`E legacy ${interrupted?'interrupted':'completed'} content output is read-only missing, not STORAGE, and explicitly repairable`,async t=>{
 const f=await contentSetup(t),id='legacy-content';await f.service.create({jobId:id,source:{kind:'report',jobId:'base-report'},targetLang:'en'});await f.service.waitForIdle();await f.service.close();const folder=path.join(f.dir,'content-translations',id),meta=path.join(folder,'job.json'),job=JSON.parse(await fs.readFile(meta,'utf8')),unit=job.units[0],file=path.join(folder,unit.id+'.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));
 assert.ok(job.units.length>1,'saved successful nodes must be independently preserved');const source=f.data.snapshot.taskName;saved.value.items[0]={...saved.value.items[0],translation:'The agent needs to confirm the environment and explain the troubleshooting steps before closing the conversation.\n'+source,isTargetLanguage:false,detectedLanguage:'zh'};saved.sha256=translationHash(saved.value);unit.resultSha256=saved.sha256;await fs.writeFile(file,JSON.stringify(saved));const attempt=path.join(folder,unit.id+'-a1.json'),rawAttempt=JSON.parse(await fs.readFile(attempt,'utf8'));rawAttempt.output=saved.value;await fs.writeFile(attempt,JSON.stringify(rawAttempt));if(interrupted){job.status='running';unit.status='running';}await fs.writeFile(meta,JSON.stringify(job));
 for(const name of await fs.readdir(path.join(f.dir,'translation-cache'))){const cacheFile=path.join(f.dir,'translation-cache',name),cache=JSON.parse(await fs.readFile(cacheFile,'utf8'));cache.value={translation:mixedBad,isTargetLanguage:false,detectedLanguage:'mixed'};cache.sha256=translationHash(cache.value);await fs.writeFile(cacheFile,JSON.stringify(cache));}
 const immutable=await Promise.all(['snapshot.json',unit.id+'.json',unit.id+'-a1.json'].map(async name=>[name,await fs.readFile(path.join(folder,name),'utf8')])),calls=f.calls.length;await f.restart();assert.equal(f.calls.length,calls);const readBefore=await fs.readFile(meta,'utf8'),result=await f.service.getResult(id);assert.equal(result.translations.find(entry=>entry.sourceText===source).status,'failed');assert.equal(result.job.nodes[0].status,'failed');assert.equal((await f.service.get(id)).nodes[0].status,'failed');assert.equal((await f.service.list())[0].warningsCount,1);assert.ok(result.warnings.some(w=>w.code==='invalid_output'));assert.equal(await fs.readFile(meta,'utf8'),readBefore);for(const [name,contents]of immutable)assert.equal(await fs.readFile(path.join(folder,name),'utf8'),contents);assert.equal(f.calls.length,calls);
 const goodNodes=result.job.nodes.filter(node=>node.status==='completed').map(node=>({id:node.id,attempts:node.attempts}));if(!interrupted)f.blockResultWrites(true);await f.service.retry(id);await f.service.waitForIdle();if(!interrupted){assert.equal((await f.service.get(id)).status,'paused');const generated=f.calls.length;f.blockResultWrites(false);await f.service.resume(id);await f.service.waitForIdle();assert.equal(f.calls.length,generated,'a validated repair survives a result write fault without another model call');}const repaired=await f.service.getResult(id);assert.equal(repaired.job.status,'completed');for(const good of goodNodes)assert.equal(repaired.job.nodes.find(node=>node.id===good.id).attempts,good.attempts);assert.equal(await fs.readFile(attempt,'utf8'),immutable.find(([name])=>name===unit.id+'-a1.json')[1]);assert.equal(await fs.readFile(path.join(folder,'snapshot.json'),'utf8'),immutable[0][1]);
});

test('F actual parser and Ark normalize 49 absent-taxonomy labels locally while preserving independent analyses',async()=>{
 const f=await consultationRuntimeFixture(49),client=createArkClient({fetchImpl:async(_url,options)=>{const request=JSON.parse(JSON.parse(options.body).messages[1].content),result=consultationReportAnswer(request.kind,request.input);result.items[0].intentLabel=Number(request.input.record.id.slice(2))%2?'待判定':'模型临时自定义标签';result.items[0].intentReferenceId='';return envelope(result);}});
 for(const [index,session]of f.state.sessions.entries()){
  const record={id:session.id,turns:session.turns,conversation:session.turns.map(turn=>`${turn.role}：${turn.text}`).join('\n')},input={record,taxonomy:index%2?[]:[{...f.task.basisSnapshot.policies[0],title:'检核政策',category:'业务规则'}]},value=consultationReportAnswer('consultationAnalysis',input);value.items[0].intentLabel=index%2?'待判定':'模型临时自定义标签';value.items[0].intentReferenceId='';
  const direct=parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment('consultationAnalysis',input)),actual=await client.enrichBusinessReport({config,kind:'consultationAnalysis',input});assert.equal(direct.items[0].intentLabel,'未配置分类体系');assert.equal(actual.items[0].intentLabel,'未配置分类体系');assert.equal(actual.items[0].intentReferenceId,'');for(const field of ['salesStage','salesSubstage','demandSummary','sentiment','negativeVoices','voc'])assert.deepEqual(actual.items[0][field],value.items[0][field]);
 }
});

test('F absent taxonomy owns intent metadata while unknown fields, evidence and configured references remain strict',async()=>{
 const f=await consultationRuntimeFixture(1),session=f.state.sessions[0],record={id:session.id,turns:session.turns,conversation:session.turns.map(turn=>`${turn.role}：${turn.text}`).join('\n')},input={record,taxonomy:[]},value=consultationReportAnswer('consultationAnalysis',input);delete value.items[0].intentLabel;delete value.items[0].intentReferenceId;
 assert.equal(parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment('consultationAnalysis',input)).items[0].intentLabel,'未配置分类体系');
 for(const [name,change] of [['invented reference',item=>item.intentReferenceId='invented@V1#section'],['nontext intent',item=>item.intentLabel={custom:'bad'}],['one intent key omitted',item=>{item.intentLabel='待判定';delete item.intentReferenceId;}]]){const value=consultationReportAnswer('consultationAnalysis',input);value.items[0].intentLabel='待判定';value.items[0].intentReferenceId='';change(value.items[0]);assert.deepEqual(parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment('consultationAnalysis',input)).items[0],{...value.items[0],intentLabel:'未配置分类体系',intentReferenceId:''},name);}
 for(const change of [item=>item.extra='unknown',item=>item.sentiment='不高兴',item=>item.negativeVoices[0].quote='invented quote']){const bad=consultationReportAnswer('consultationAnalysis',input);bad.items[0].intentLabel='待判定';bad.items[0].intentReferenceId='';change(bad.items[0]);assert.throws(()=>parseReportEnrichment(JSON.stringify(bad),prepareReportEnrichment('consultationAnalysis',input)),invalid);}
 const configured={record,taxonomy:f.task.basisSnapshot.policies};for(const change of [item=>item.intentLabel='模型自定义标签',item=>item.intentReferenceId='TAX@V99#T1']){const bad=consultationReportAnswer('consultationAnalysis',configured);change(bad.items[0]);assert.throws(()=>parseReportEnrichment(JSON.stringify(bad),prepareReportEnrichment('consultationAnalysis',configured)),invalid);}
 for(const dynamic of [false,true]){const prepared=prepareReportEnrichment('consultationAnalysis',{...input,...(dynamic?{analysisFields:['intent','demandSummary'],includeVoc:false}:{})});assert.match(prepared.messages[0].content,/"intentLabel":"未配置分类体系"/);assert.ok(!prepared.messages[0].content.includes('"intentLabel":"待判定"'));}
 const selected=prepareReportEnrichment('consultationAnalysis',{...input,analysisFields:['demandSummary'],includeVoc:false});assert.deepEqual(parseReportEnrichment(JSON.stringify({items:[{id:record.id,demandSummary:'用户询问兼容性。'}]}),selected).items[0],{id:record.id,demandSummary:'用户询问兼容性。'});
});

test('F 49 asynchronous actual-client report analyses survive missing taxonomy with configuration warnings',async t=>{
 const data=await consultationRuntimeFixture(49);data.task.basisSnapshot.policies=[{...data.task.basisSnapshot.policies[0],title:'服务检核政策',category:'业务规则'}];
 const f=await setup(t,{data,provider:({kind,input})=>{if(kind==='translation')return goodTranslation(input);const value=consultationReportAnswer(kind,input);if(kind==='consultationAnalysis'){value.items[0].intentLabel=Number(input.record.id.slice(2))%2?'待判定':'临时定制意图';value.items[0].intentReferenceId='';}return value;}}),original=JSON.stringify(f.state);
 await f.service.create({jobId:'no-taxonomy-49',taskId:f.task.id});await f.service.waitForIdle();const result=await f.service.getResult('no-taxonomy-49');assert.equal(result.job.status,'completed');assert.equal(result.enrichment.analysisStats.completed,49);assert.equal(result.enrichment.analysisStats.failed,0);assert.equal(f.calls.filter(call=>call.kind==='consultationAnalysis').length,49);assert.ok(result.enrichment.warnings.some(w=>w.code==='taxonomy_not_configured'));
 for(const entry of Object.values(result.enrichment.consultationAnalysis)){assert.equal(entry.intentLabel,'未配置分类体系');assert.equal(entry.intentReferenceId,'');assert.equal(entry.sentiment,'负向');assert.ok(entry.negativeVoices.length);assert.equal(entry.voc.valid,true);}assert.equal(JSON.stringify(f.state),original);
 // A pre-fix failed analysis is retried alone, preserving completed analyses, quality and raw attempt files.
 await f.service.close();const folder=path.join(f.dir,'report-jobs','no-taxonomy-49'),meta=path.join(folder,'job.json'),job=JSON.parse(await fs.readFile(meta,'utf8')),unit=job.units.find(unit=>unit.kind==='consultationAnalysis');unit.status='failed';unit.errorCode='invalid_output';unit.error='旧版分类校验失败';job.status='completed_with_warnings';await fs.writeFile(meta,JSON.stringify(job));
 const saved=await fs.readFile(path.join(folder,unit.id+'-a1.json'),'utf8'),before=f.calls.filter(call=>call.kind==='consultationAnalysis').length;await f.restart();assert.equal(f.calls.filter(call=>call.kind==='consultationAnalysis').length,before);await f.service.retry('no-taxonomy-49');await f.service.waitForIdle();assert.equal(f.calls.filter(call=>call.kind==='consultationAnalysis').length,before+1);const retried=await f.service.getResult('no-taxonomy-49');assert.equal(retried.enrichment.analysisStats.completed,49);assert.deepEqual(retried.snapshot,result.snapshot);assert.equal(await fs.readFile(path.join(folder,unit.id+'-a1.json'),'utf8'),saved);
});

test('F missing-taxonomy setup guidance is visible in both UI languages and disabled intent has no warning',()=>{
 const {snapshot,enrichment,state}=consultationReportFixture(),ui={businessTaskId:snapshot.taskId};
 try{for(const language of ['zh','en']){setLocale(language);const html=businessExportView(state,ui,{result:{snapshot,enrichment}});assert.match(html,/未配置分类体系|taxonomy is not configured/i);assert.match(html,/导入.*发布|import.*publish/i);assert.match(html,/关联.*规则|associate.*rule/i);assert.match(html,/新建任务|new task/i);assert.match(html,/旧任务.*冻结|existing tasks.*frozen/i);assert.ok(!/<details[^>]*>[\s\S]*taxonomy is not configured[\s\S]*<\/details>/i.test(html));}
  snapshot.scenarioSnapshot=scenarioConfig({analysisFields:['demandSummary'],customFields:[],report:{title:'报告',groupBy:'product',groupField:'',groupLabel:'产品',sections:['overview']}});snapshot.scene=snapshot.scenarioSnapshot.id;setLocale('en');assert.ok(!businessExportView(state,ui,{result:{snapshot,enrichment}}).includes('taxonomy is not configured'));
 }finally{setLocale('zh');}
});
