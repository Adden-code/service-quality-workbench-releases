import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {workbook,readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createReportJobs} from '../server/report-jobs.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),clone=value=>structuredClone(value);
const root=path.resolve('../reports-r16/runtime-data');
async function setup(t,{translationFailure=false}={}){
 await fs.mkdir(root,{recursive:true});const dataDir=await fs.mkdtemp(path.join(root,'raw-report-'));
 const texts=['  Customer: لا يعمل 😀\r\nAgent: A return is guaranteed.\r\nCustomer: لا يعمل 😀  ','Customer: SYN distinct second line.\nAgent: A return is guaranteed.'];
 const bytes=await workbook([{name:'实际合成来源',headers:['会话ID','客服','消息详情','产品型号','扩展列'],rows:texts.map((text,index)=>[` SYN-${index+1} `,'Synthetic agent',text,'Synthetic product','  _x000D_ untouched  ']),rowNumbers:[7,19]}]),source={name:'synthetic-raw-report.xlsx',sha256:sha(bytes),size:bytes.length};
 const parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,parsed.errors.join(';'));
 const rules=[{id:'SYN-QUALITY',title:'合成无据承诺',category:'承诺规范',version:'V1',policyIds:[],passCriteria:'有据承诺',failCriteria:'无据承诺'},{id:'SYN-TIME',title:'合成响应时效',category:'响应时效',version:'V1',policyIds:[],passCriteria:'在一小时内响应',failCriteria:'超过一小时响应'}],basisSnapshot={rules,policies:[],effectiveDate:'2026-11-12',capturedAt:'2026-11-12T00:00:00Z'};
 const state=createImportedTask(createBusinessState(),{name:'Synthetic raw report job',source,sessions:parsed.sessions,basisSnapshot,reviewer:'Synthetic reviewer',now:'2026-11-12T00:00:00Z'}),task=state.tasks.at(-1);
 for(const session of state.sessions){const quote='A return is guaranteed.',start=session.rawTranscript.text.indexOf(quote),meta={schemaVersion:1,status:'verified',textSha256:session.rawTranscript.textSha256,reasonCodes:[]};session.aiExecution={status:'completed',runId:'synthetic-quality'};session.aiResults=[{ruleId:'SYN-QUALITY',verdict:'不符合',reason:'合成原文承诺未列条件。',evidence:[],evidenceQuotes:[{quote,matches:[{start,end:start+quote.length}]}],turnRefs:['estimated reply'],referenceIds:[],confidence:0.96,conflictsWith:[],rawValidation:meta},{ruleId:'SYN-TIME',verdict:'无法判定',reason:'未提供可靠来源时间。',evidence:[],evidenceQuotes:[],turnRefs:[],referenceIds:[],confidence:0.95,conflictsWith:[],rawValidation:{...meta,reasonCodes:['source_time_unavailable']}}];}
 const calls=[],config={baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-report',authMode:'none',configured:true,connectionTested:true,timeoutMs:1000},store={read:async()=>({state:clone(state),revision:7}),getSource:async()=>({...source,bytes})};
 const client=createArkClient({fetchImpl:async(_url,options)=>{const body=JSON.parse(options.body),request=JSON.parse(body.messages[1].content);calls.push(clone(request));let result;
  if(request.kind==='translation'){if(translationFailure&&request.input.items.some(item=>item.text.includes('distinct second')))return new Response('{}',{status:500});result={items:request.input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'mixed',translation:'合成译文：'+item.text}))};}
  else if(request.kind==='consultationIssues')result={clusters:[{label:'无据承诺',summary:'已有质检结果指出无据承诺。',memberIds:request.input.records.map(record=>record.id),action:'核对冻结政策后回答。'}]};
  else{const record=request.input.record;assert.equal(record.inputMode,'raw-transcript-v1');assert.equal(record.turns,undefined);const quote=record.text.includes('لا يعمل 😀')?'لا يعمل 😀':'SYN distinct second line.';result={items:[{id:record.id,salesStage:'售后',salesSubstage:'产品使用',intentLabel:'未配置分类体系',intentReferenceId:'',demandSummary:'会话包含具体产品使用诉求。',sentiment:'负向',negativeVoices:[{quote}],voc:{valid:true,scene:'产品质量',painPoint:'会话表达产品使用问题。',reason:'存在逐字可定位的会话诉求，角色未核验。',evidenceQuote:quote}}]};}
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
 }}),options={dataDir,store,modelConfig:{getPrivate:()=>({...config})},client,maxAttempts:1,retryDelayMs:0};let jobs=await createReportJobs(options);
 t.after(async()=>{await jobs.close();assert.ok(dataDir.startsWith(root+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 return{state,task,bytes,calls,texts,dataDir,get jobs(){return jobs;},async restart(){await jobs.close();jobs=await createReportJobs(options);}};
}
test('actual raw preflight→domain task→archived report job→AI wire parser→Excel/HTML runs with no turns',async t=>{
 const f=await setup(t),before=JSON.stringify(f.state);await f.jobs.create({jobId:'synthetic-raw-report',taskId:f.task.id,conclusionMode:'ai'});await f.jobs.waitForIdle();const result=await f.jobs.getResult('synthetic-raw-report');assert.equal(result.job.status,'completed');assert.equal(result.enrichment.analysisStats.completed,2);assert.equal(result.enrichment.vocItems.length,2);assert.equal(result.snapshot.records[0].conversation,f.texts[0]);assert.equal(result.enrichment.consultationAnalysis[f.state.sessions[0].id].negativeVoices[0].matches.length,2);
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment));assert.equal(tables.检核明细[1][2],f.texts[0]);assert.equal(tables.检核明细[1][4],'  _x000D_ untouched  ');assert.equal(tables.检核明细[1][XLSX_ROW_NUMBER],7);assert.equal(tables.检核明细[2][XLSX_ROW_NUMBER],19);assert.ok(tables.判定留痕[0].includes('证据引文'));const html=buildBusinessReportHtml(result.snapshot,result.enrichment);assert.match(html,/A return is guaranteed/);assert.match(html,/角色未核验/);assert.ok(!/第undefined轮/.test(html));assert.equal(JSON.stringify(f.state),before);
 const calls=f.calls.length;await f.restart();assert.deepEqual((await f.jobs.getResult('synthetic-raw-report')).snapshot,result.snapshot);assert.equal(f.calls.length,calls);
});
test('raw report translation failures stay missing while analysis and original evidence remain usable',async t=>{
 const f=await setup(t,{translationFailure:true});await f.jobs.create({jobId:'synthetic-missing-translation',taskId:f.task.id,conclusionMode:'ai'});await f.jobs.waitForIdle();const result=await f.jobs.getResult('synthetic-missing-translation');assert.equal(result.job.status,'completed_with_warnings');assert.ok(result.enrichment.translationStats.failedTexts>0);assert.equal(result.enrichment.analysisStats.completed,2);const tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment));assert.equal(tables.检核明细[2][5],'');assert.equal(tables.检核明细[2][2],f.texts[1]);assert.match(buildBusinessReportHtml(result.snapshot,result.enrichment),/翻译|译文/);
});
