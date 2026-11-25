import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createArkClient} from '../server/ark-client.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {createTranslationJobs} from '../server/translation-jobs.mjs';
import {plausibleEnglishTranslation,reusableEnglishBaseTranslation} from '../public/translation-language.mjs';
import {collectReportTranslationFields,createReportLocale} from '../public/report-locale.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {reportFixture} from './business-report-fixtures.mjs';
import {consultationReportFixture} from './consultation-report-fixtures.mjs';
import {scenarioConfig} from './scenario-report-fixtures.mjs';
import {publishedFixture,sourceRow,cutoff} from './v21-runtime-fixtures.mjs';
import {ecommerceSourceProjection,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';

const base=path.resolve(import.meta.dirname,'../../EF/review-fix-runtime');
const variants=[
 ['ASCII punctuation','客服未回答用户关于电池续航的问题, 需要进一步确认使用环境, 再说明可操作的排查步骤.'],
 ['spaced Chinese punctuation','客服未回答用户关于电池续航的问题 。 需要进一步确认使用环境 ， 再说明可操作的排查步骤 。'],
 ['newline clauses','客服未回答用户关于电池续航的问题\n需要进一步确认使用环境\n再说明可操作的排查步骤'],
];
const english='The agent did not answer the customer question about battery life. The environment should be confirmed before describing the troubleshooting steps. ';
const invalid=error=>error.code==='INVALID_OUTPUT';
const config={configured:true,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-EF-spec-fix',authMode:'none',timeoutMs:120000,reasoningEffort:'low',maxTokens:null};
const envelope=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
const parse=(source,text)=>parseReportEnrichment(JSON.stringify({items:[{id:'t',translation:text,isTargetLanguage:false,detectedLanguage:'zh'}]}),prepareReportEnrichment('translation',{targetLang:'en',items:[{id:'t',text:source}]}));
const same=item=>({id:item.id,translation:item.text,isTargetLanguage:true,detectedLanguage:'en'});
const englishEntries=(snapshot,enrichment,status)=>collectReportTranslationFields(snapshot,enrichment).map(field=>({id:field.id,sourceText:field.text,status,text:''}));

test('E review P1 all three copied-paragraph separators fail shared/prepared/actual Ark checks',async t=>{
 for(const [name,source]of variants)await t.test(name,async()=>{
  for(const separator of ['\n',' ']){const text=english+separator+source;assert.equal(plausibleEnglishTranslation(text,source),false);assert.equal(reusableEnglishBaseTranslation(source,{status:'translated',text,detectedLanguage:'zh'}),false);assert.throws(()=>parse(source,text),invalid);}
  const client=createArkClient({fetchImpl:async()=>envelope({items:[{id:'t',translation:english+'\n'+source,isTargetLanguage:false,detectedLanguage:'zh'}]})});await assert.rejects(client.enrichBusinessReport({config,kind:'translation',input:{targetLang:'en',items:[{id:'t',text:source}]}}),invalid);
 });
});

test('E review P1 non-Latin names remain source text and require Latin transliteration for English output',()=>{
 const company='中国国际航空航天科技产业发展股份有限公司',intro='Please contact this registered company for the service request and confirm the account details before processing. ';
 for(const [source,text]of [[company,intro+company+'.'],[company,intro.repeat(8)+Array(4).fill(company).join(', ')+'.'],['华为 P70屏幕清晰。','The 华为 P70 has a clear display.'],['服务代表 محمد 已回复。','The agent محمد has replied.'],['客服 Иван 已回复。','Agent Иван has replied.'],['产品 α 已准备好。','The α product is ready.']]){assert.equal(plausibleEnglishTranslation(text,source),false,text);assert.throws(()=>parse(source,text),invalid);}
 const source='甲方公司, 乙方公司';assert.equal(plausibleEnglishTranslation('The two parties are 甲方公司 and 乙方公司, as specified in the contract.',source),false);
 assert.equal(plausibleEnglishTranslation('Please ask 张三 to call 李四 while 王五 confirms the details.','张三、李四、王五'),false,'English prose cannot exempt untranslated names.');
 for(const [source,text]of [['华为 P70屏幕清晰。','The Huawei P70 has a clear display.'],['服务代表 محمد 已回复。','The agent Muhammad has replied.'],['客服 Иван 已回复。','Agent Ivan has replied.'],['产品 α 已准备好。','The alpha product is ready.']]){assert.equal(plausibleEnglishTranslation(text,source),true);assert.doesNotThrow(()=>parse(source,text));}
 assert.equal(plausibleEnglishTranslation(english+'\n'+company,company),false,'A standalone CJK line is a missing-translation boundary, even when it could be a name.');
 for(const source of ['12345','🙂🔋','USB-C 123']){const value={items:[{id:'t',translation:source,isTargetLanguage:false,detectedLanguage:'und'}]};assert.equal(parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment('translation',{targetLang:'en',items:[{id:'t',text:source}]})).items[0].translation,source);}
});

function qualityState(source){
 const row=sourceRow({row:3,reply:'Please check the battery connection.',type:'好评负向'});row.ecommerce.raw[8]=source;row.ecommerce.raw[21]='The agent did not answer the question.';Object.assign(row,ecommerceSourceProjection(row.ecommerce));const {state}=publishedFixture([row]),task=state.tasks[0],session=state.sessions[0];task.aiRun={id:'frozen-quality',inspectionAt:cutoff,startedAt:cutoff};session.aiExecution={status:'completed',runId:task.aiRun.id};session.aiResults=[timeJudgment(session,{basis:task.basisSnapshot,inspectionAt:cutoff}),...EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:ruleId==='EC-TEXT'?'不符合':'符合',reason:'原有质检结论。',evidence:[1,2],referenceIds:[]}))];return{state,task};
}
test('E review P1 actual report/content retries reject all separator variants before caches and every translation export slot',async t=>{
 for(const [name,source]of variants)await t.test(name,async t=>{
  await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'paragraph-')),data=qualityState(source),calls=[],bad=english+'\n'+source,before=JSON.stringify(data.state);
  const client=createArkClient({fetchImpl:async(_url,options)=>{const request=JSON.parse(JSON.parse(options.body).messages[1].content);calls.push(request);const {kind,input}=request,value=kind==='translation'?{items:input.items.map(item=>item.text===source?{id:item.id,translation:bad,isTargetLanguage:false,detectedLanguage:'zh'}:same(item))}:kind==='issueClusters'?{clusters:[{label:'针对性不足',summary:'未回应具体问题。',memberIds:input.records.map(row=>row.id),action:'确认后回应问题。'}]}:{items:input.records.map(row=>({id:row.id,valid:true,scene:'产品质量',painPoint:'续航问题。',reason:'包含具体问题。',evidenceQuote:row.comment}))};return envelope(value);}});
  const reports=await createReportJobs({dataDir:dir,store:{read:async()=>({state:structuredClone(data.state),revision:1})},modelConfig:{getPrivate:()=>({...config})},client,retryDelayMs:1});
  const content=await createTranslationJobs({dataDir:dir,store:{read:async()=>({revision:1,state:{tasks:[],sessions:[]},catalog:{rules:[{id:'R',version:'V1.0',title:source}]}})},modelConfig:{getPrivate:()=>({...config})},client,retryDelayMs:1});
  t.after(async()=>{await reports.close();await content.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});
  await reports.create({jobId:'paragraph-report',taskId:data.task.id,targetLang:'en'});await reports.waitForIdle();const result=await reports.getResult('paragraph-report');assert.equal(result.job.status,'completed_with_warnings');assert.equal(result.job.nodes.find(node=>node.kind==='translation').attempts,2);assert.equal(result.enrichment.translationStats.completedTexts,2);assert.equal(result.enrichment.translationStats.failedTexts,1);assert.equal((await fs.readdir(path.join(dir,'report-cache'))).length,2);assert.equal(JSON.stringify(data.state),before);
  const invalidDerived=collectReportTranslationFields(result.snapshot,result.enrichment).map(field=>({id:field.id,sourceText:field.text,status:'translated',text:field.text===source?bad:'Complete English translation.',detectedLanguage:'zh'}));
  for(const language of [undefined,'en']){const options=language?{language,translations:invalidDerived}:{},tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment,options)),row=tables[language?'Inspection Details':'检核明细'].find(row=>row[XLSX_ROW_NUMBER]===3);assert.equal(row[8],source);if(language){assert.ok(row[22].startsWith('[Untranslated: '));assert.ok(!row[22].includes(source));assert.ok(!row[22].includes(bad));}else{assert.ok(!/\p{Script=Han}/u.test(row[22]));assert.ok(!row[22].includes(source));}const html=buildBusinessReportHtml(result.snapshot,result.enrichment,options),blocks=[...html.matchAll(/<p class="translation"[^>]*>([\s\S]*?)<\/p>/g)].map(match=>match[1]);if(language)assert.ok(blocks.every(text=>!text.includes(english+'\n'+source)));else assert.ok(blocks.every(text=>!text.includes('客服未回答用户')));assert.ok(html.includes(source));}
  await content.create({jobId:'paragraph-content',source:{kind:'rule',id:'R',version:'V1.0'},targetLang:'en'});await content.waitForIdle();const translated=await content.getResult('paragraph-content');assert.equal(translated.job.status,'completed_with_warnings');assert.equal(translated.translations[0].status,'failed');assert.equal(translated.translations[0].text,'');assert.deepEqual(await fs.readdir(path.join(dir,'translation-cache')),[]);
 });
});

test('E review P2 failed/pending/missing English views use English markers and retain originals in source and audit fields',async t=>{
 for(const status of ['failed','pending','missing'])await t.test(status,async()=>{
  const {snapshot,enrichment}=reportFixture();snapshot.extensions={headers:['额外原始字段'],standards:['原始字段标准']};for(const record of snapshot.records)record.extensionValues=['保留值-'+record.id];const options={language:'en',translations:englishEntries(snapshot,enrichment,status)},before=JSON.stringify({snapshot,enrichment}),tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options)),locale=createReportLocale(snapshot,enrichment,options),marker=`[Untranslated: ${status==='failed'?'translation failed':status==='pending'?'translation pending':'English translation unavailable'}]`;
  const record=snapshot.records.find(record=>record.id==='case-bad'),field=collectReportTranslationFields(snapshot,enrichment).find(field=>field.text===record.summary);assert.equal(locale.display(record.summary),marker);assert.equal(locale.text(field.id,field.text),marker);assert.ok(locale.quote(record.raw22[8]).includes('Original: '+record.raw22[8]));
  for(const row of tables['Judgment Trail'].slice(1)){assert.equal(row[9],marker);assert.ok(row[10].length);}
  for(const row of tables['Field Guide'].slice(1)){assert.ok(row[1]);assert.equal(row[2],marker);}
  for(const original of snapshot.records){const row=tables['Inspection Details'].find(row=>row[XLSX_ROW_NUMBER]===original.sourceRow);assert.deepEqual(row.slice(0,22),original.raw22);assert.equal(row[43],original.extensionValues[0]);if(original.summary)assert.equal(row[42],marker);}assert.equal(tables['Inspection Details'][0][43],'额外原始字段');
  const html=buildBusinessReportHtml(snapshot,enrichment,options),summaries=[...html.matchAll(/<p class="summary">([\s\S]*?)<\/p>/g)].map(match=>match[1]);assert.ok(summaries.length);assert.ok(summaries.every(text=>text===marker));assert.ok(tables['Original AI Audit'].some(row=>row[1]===record.summary));assert.ok(html.includes(`<p class="original">${record.raw22[8]}</p>`));assert.equal(JSON.stringify({snapshot,enrichment}),before);
 });
});

test('E review P2 product, agent and context group originals remain distinct when their English views are missing',async t=>{
 for(const groupBy of ['product','agent','context'])await t.test(groupBy,async()=>{
  const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';snapshot.scenarioSnapshot=scenarioConfig({analysisFields:['demandSummary'],customFields:[],report:{title:'原报告标题',groupBy,groupField:groupBy==='context'?'area':'',groupLabel:'原始分组',sections:['overview','breakdown','cases']}});snapshot.scene=snapshot.scenarioSnapshot.id;
  const names=groupBy==='product'?['源产品甲','源产品乙']:groupBy==='agent'?['客服甲','客服乙']:['原区域甲','原区域乙'];snapshot.metrics.byGroup=names.map((value,index)=>({value,total:index+1,passed:index+1,failed:0,na:0,pending:0,determinate:index+1,passRate:100}));snapshot.records[0].groupValue=names[0];snapshot.records[1].groupValue=names[1];snapshot.basis.grouping={missing:0};snapshot.original.headers.push('原始分组值');for(const row of snapshot.original.rows)row.values.push(names[row.recordId==='new-bad'?0:1]);
  const options={language:'en',translations:englishEntries(snapshot,enrichment,'missing')},locale=createReportLocale(snapshot,enrichment,options),html=buildBusinessReportHtml(snapshot,enrichment,options),tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options));
  for(const name of names){assert.equal(locale.sourceLabel(name),`[Original: ${name}]`);assert.ok(html.includes(`[Original: ${name}]`));assert.ok(tables['Inspection Details'].slice(1).some(row=>row[3]===name));}
  assert.ok(html.includes('[Original: '+snapshot.records[0].product+']'));assert.ok([...html.matchAll(/<p class="summary">([\s\S]*?)<\/p>/g)].every(match=>match[1].includes('[Untranslated: English translation unavailable]')));
 });
});

test('E review canonical missing-taxonomy status has deterministic English intent without a translation unit',async()=>{
 const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';enrichment.consultationAnalysis['new-bad'].intentLabel='未配置分类体系';enrichment.consultationAnalysis['new-bad'].intentReferenceId='';const fields=collectReportTranslationFields(snapshot,enrichment);assert.ok(!fields.some(field=>field.id==='record.new-bad.analysis.intentLabel'));
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,{language:'en'})),row=tables['Inspection Details'].find(row=>row[XLSX_ROW_NUMBER]===3);assert.equal(row[5],'Taxonomy not configured');assert.ok(buildBusinessReportHtml(snapshot,enrichment,{language:'en'}).includes('Taxonomy not configured'));
});

test('E review missing dynamic rule titles keep opaque rule IDs in the existing English header columns',async()=>{
 const {snapshot,enrichment}=consultationReportFixture();snapshot.original.productSources['new-na'].value='';const options={language:'en',translations:englishEntries(snapshot,enrichment,'missing')},tables=await readXlsx(await buildBusinessDeliveryXlsx(snapshot,enrichment,options)),headers=tables['Inspection Details'][0],start=snapshot.original.headers.length+6;
 for(const [index,rule]of snapshot.basis.rules.entries()){assert.equal(headers[start+index],rule.id+' · [Untranslated: English translation unavailable]');assert.equal(tables['Frozen Rules'][index+1][1],rule.title);assert.equal(tables['Frozen Rules'][index+1][2],'[Untranslated: English translation unavailable]');}
 assert.equal(new Set(headers.slice(start,start+snapshot.basis.rules.length)).size,snapshot.basis.rules.length);
});

test('E review content result hash corruption remains STORAGE for completed and interrupted jobs',async t=>{
 for(const interrupted of [false,true])await t.test(interrupted?'interrupted':'completed',async t=>{
  await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'corrupt-')),dependencies={dataDir:dir,store:{read:async()=>({revision:1,state:{tasks:[],sessions:[]},catalog:{rules:[{id:'R',version:'V1.0',title:'English rule'}]}})},modelConfig:{getPrivate:()=>({...config})},client:createArkClient({fetchImpl:async(_url,options)=>{const {input}=JSON.parse(JSON.parse(options.body).messages[1].content);return envelope({items:input.items.map(same)});}}),retryDelayMs:1};let service=await createTranslationJobs(dependencies);t.after(async()=>{await service.close();assert.ok(path.resolve(dir).startsWith(base+path.sep));await fs.rm(dir,{recursive:true,force:true});});await service.create({jobId:'corrupt',source:{kind:'rule',id:'R',version:'V1.0'},targetLang:'en'});await service.waitForIdle();await service.close();const folder=path.join(dir,'content-translations','corrupt'),file=path.join(folder,'n1.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));saved.value.items[0].translation='Tampered checksum';await fs.writeFile(file,JSON.stringify(saved));if(interrupted){const meta=path.join(folder,'job.json'),job=JSON.parse(await fs.readFile(meta,'utf8'));job.status='running';job.units[0].status='running';await fs.writeFile(meta,JSON.stringify(job));await assert.rejects(createTranslationJobs(dependencies),error=>error.code==='TRANSLATION_STORAGE');}else{service=await createTranslationJobs(dependencies);await assert.rejects(service.getResult('corrupt'),error=>error.code==='TRANSLATION_STORAGE');}
 });
});
