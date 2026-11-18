import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createBusinessState,createImportedTask,acceptAI,confirmReview} from '../public/domain.mjs';
import {createBusinessCatalog,createDraft,publishVersion} from '../public/catalog.mjs';
import {saveScenarioConfig,freezeScenario} from '../public/scenarios.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {parseMappedInput} from '../public/input-profiles.mjs';
import {workbook,readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';

const base='D:/Codex project/outputs/service-scenario-config-20261105/http-lifecycle';
const now='2026-11-05T09:00:00+08:00';
function definition(){return{schemaVersion:1,id:'SCENE-RETURN',name:'售后退换货咨询',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:['RETURN-ONE','RETURN-TWO'],analysisFields:['demandSummary','negativeVoice'],customFields:[{id:'channel','label':'办理渠道','type':'enum',instruction:'按坐席实际给出的办理渠道选择；无法判断标缺失。',options:['线上','门店']},{id:'customerQuote','label':'客户问题原声','type':'quote',instruction:'逐字提取客户说明退货原因的原话。',options:[]}],report:{title:'售后退换货质检报告',groupBy:'context',groupField:'region',groupLabel:'区域',sections:['overview','breakdown','dimensions','cases','improvements','voc']},requiredCapabilities:['text-judgment'],createdAt:now,updatedAt:now};}
function catalogFixture(){
  const common={owner:'隔离测试',scope:'合成退换货咨询',effectiveAt:'2026-11-05',expiresAt:'',changeNote:'仅用于自动化工程验收'};
  let catalog=createDraft(createBusinessCatalog(),'policies','RETURN-POLICY',{...common,title:'退换货政策（合成）',category:'服务政策',source:'本地合成材料',sections:[{id:'RETURN-POLICY-1',title:'退货办理',text:'坐席应回应客户的退货原因并说明线上办理渠道。'}]},now);
  catalog=publishVersion(catalog,'policies','RETURN-POLICY','V1.0',{},now);
  for(const [id,title,category]of [['RETURN-ONE','说明办理渠道','政策说明'],['RETURN-TWO','回应客户问题','沟通规范']]){
    catalog=createDraft(catalog,'rules',id,{...common,title,category,policyIds:['RETURN-POLICY'],passCriteria:'对原文中客户问题作出回应并说明办理方法。',failCriteria:'未回应客户提出的问题或未说明办理方法。',exceptionCriteria:'原文缺失无法判断；与本项无关时不适用。'},now);
    catalog=publishVersion(catalog,'rules',id,'V1.0',{},now);
  }
  return catalog;
}
function answer(kind,input,{invalidEnum=false}={}){
  if(kind==='translation')return{items:input.items.map(row=>({id:row.id,translation:row.text,isTargetLanguage:true,detectedLanguage:'zh'}))};
  if(kind==='consultationIssues')return{clusters:[{label:'未回应具体问题',summary:'未回应客户提出的退货原因',memberIds:input.records.map(row=>row.id),action:'先回应客户说明的具体问题，再给出线上办理步骤。'}]};
  if(kind==='scenarioFields')return{recordId:input.record.id,fields:input.fields.map(field=>({id:field.id,value:field.type==='enum'?(invalidEnum?'未配置选项':'线上'):input.record.turns.find(turn=>turn.role==='客户').text,missing:false,turnId:field.type==='quote'?1:null}))};
  assert.equal(kind,'consultationAnalysis');
  const selected=input.analysisFields||[],item={id:input.record.id},customer=input.record.turns.find(turn=>turn.role==='客户');
  if(selected.includes('salesStage'))Object.assign(item,{salesStage:'售后',salesSubstage:'退换货咨询'});
  if(selected.includes('intent'))Object.assign(item,{intentLabel:'未配置分类体系',intentReferenceId:''});
  if(selected.includes('demandSummary'))item.demandSummary='客户希望办理退货并了解处理方式';
  if(selected.includes('negativeVoice')||input.includeVoc)Object.assign(item,{sentiment:'负向',negativeVoices:[{turnId:1,quote:customer.text}]});
  if(input.includeVoc)item.voc={valid:true,scene:'售后/退换货',painPoint:'客户需要办理退货',reason:'原文明确提出退货诉求',evidenceQuote:customer.text};
  return{items:[item]};
}

test('third scene survives full HTTP import, independent inspection, human review, configured reports and later disable',async t=>{
  await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'workspace-')),calls=[];let badEnum=true;
  const client=createArkClient({fetchImpl:async(_url,options)=>{
    const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);let output;
    if(payload.basis){
      calls.push({kind:'inspection',input:payload.session});assert.equal(payload.session.turns.length,2);
      output={results:payload.basis.rules.map(rule=>({ruleId:rule.id,verdict:rule.id==='RETURN-TWO'&&payload.session.externalId==='0002'?'不符合':'符合',reason:'依据本条会话与冻结规则进行合成判断。',evidence:[2],referenceIds:[],fieldEvidence:[]}))};
    }else{
      calls.push(structuredClone(payload));const inject=payload.kind==='scenarioFields'&&badEnum;if(inject)badEnum=false;output=answer(payload.kind,payload.input,{invalidEnum:inject});
    }
    return new Response(JSON.stringify({model:'local-controlled',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  const settings={baseUrl:'http://127.0.0.1:1/v1',model:'local-controlled',authMode:'none',timeoutMs:120000,reasoningEffort:'low',maxTokens:32768};
  const server=await createWorkbenchServer({dataDir,arkClient:client,modelConfig:{publicConfig:()=>({...settings,configured:true,connectionTested:true}),getPrivate:()=>({...settings,connectionTested:true})}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dataDir).startsWith(path.resolve(base)+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
  let doc=await(await fetch(origin+'/api/workspace')).json(),sequence=0;
  const headers={'Content-Type':'application/json',Origin:origin,'X-Workspace-Token':doc.token};
  async function save(state,catalog=doc.catalog){const response=await fetch(origin+'/api/workspace',{method:'PUT',headers,body:JSON.stringify({baseRevision:doc.revision,mutationId:'lifecycle-'+(++sequence),state,catalog})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));doc=value;return doc;}
  let state=saveScenarioConfig(createBusinessState(),definition(),{expectedVersion:0,now});const catalog=catalogFixture();await save(state,catalog);
  const profile={id:'RETURN-MAPPING',name:'退换货逐轮原表',version:1,scene:'SCENE-RETURN',layout:'turns',sheet:'业务原表',headerRow:1,fields:{id:'会话号',startedAt:'时间',role:'角色',text:'消息',agent:'客服'},roleMap:{},dateFormat:'iso',defaults:{completeness:'完整',product:'测试产品'},extras:[{key:'region',column:'区域',label:'区域',type:'text',purpose:'retain',required:true}],ruleIds:['RETURN-ONE','RETURN-TWO']};
  const bytes=await workbook([{name:'业务原表',headers:['会话号','时间','角色','消息','客服','区域'],rows:[['0001',now,'客户','产品有问题，我要退货。','客服甲','Europe'],['0001',now,'客服','请在订单页面提交退货申请。','客服甲','Europe'],['0002',now,'客户','商品不合适，我要退货。','客服乙','APAC'],['0002',now,'客服','请在订单页面提交退货申请。','客服乙','APAC']]}]);
  const file={name:'退换货原表.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},parsed=await parseMappedInput(file,profile);assert.equal(parsed.valid,true,parsed.errors.join('；'));assert.equal(parsed.sessions.length,2);
  const uploaded=await fetch(origin+'/api/sources',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:bytes});assert.equal(uploaded.status,201);const source=await uploaded.json();
  state={...doc.state,inputProfiles:[profile]};state=saveScenarioConfig(state,{...state.scenarios[0],inputProfileId:profile.id},{expectedVersion:1,now});await save(state);
  const basisSnapshot=createBasisSnapshot(doc.catalog,{ruleIds:profile.ruleIds,effectiveDate:'2026-11-05',now});
  state=createImportedTask(doc.state,{name:'售后场景闭环验证',reviewer:'隔离审核员',sessions:parsed.sessions,source,basisSnapshot,importMappingSnapshot:{profile},scenarioSnapshot:freezeScenario(doc.state,'SCENE-RETURN'),now});await save(state);const taskId=doc.state.tasks[0].id;
  let response=await fetch(origin+`/api/tasks/${taskId}/ai`,{method:'POST',headers,body:JSON.stringify({runId:'scenario-e2e-run'})});assert.equal(response.status,202,await response.text());await server.waitForAiIdle();doc=await(await fetch(origin+'/api/workspace')).json();
  assert.equal(doc.state.tasks[0].aiStatus,'completed');assert.equal(calls.filter(call=>call.kind==='inspection').length,2);assert.ok(doc.state.sessions.every(session=>session.aiResults.length===2));
  state=doc.state;for(const session of state.sessions){state=acceptAI(state,session.id,now);state=confirmReview(state,session.id,now);}await save(state);
  const frozenTask=structuredClone(doc.state.tasks[0]),beforeDeliveryRevision=doc.revision;
  response=await fetch(origin+'/api/report-jobs',{method:'POST',headers,body:JSON.stringify({jobId:'scenario-http-delivery',taskId,targetLang:'zh',conclusionMode:'combined'})});assert.equal(response.status,202,await response.text());await server.waitForReportsIdle();
  response=await fetch(origin+'/api/report-jobs/scenario-http-delivery/result',{headers});assert.equal(response.status,200);const result=await response.json();assert.equal(result.job.status,'completed',JSON.stringify(result.job));
  const tables=await readXlsx(await buildBusinessDeliveryXlsx(result.snapshot,result.enrichment)),rows=tables['检核明细'];assert.equal(rows.length,5);assert.equal(rows[1][XLSX_ROW_NUMBER],2);assert.equal(rows[1][0],'0001');
  assert.ok(rows[0].includes('办理渠道'));assert.ok(rows[0].includes('客户问题原声'));assert.ok(rows[0].includes('用户诉求总结'));assert.ok(!rows[0].some(label=>label.startsWith('销售环节')||label==='用户意图'));
  assert.ok(rows.slice(1).every(row=>row[rows[0].indexOf('办理渠道')]==='线上'));assert.ok(rows[1][rows[0].indexOf('客户问题原声')].includes('产品有问题'));
  const html=buildBusinessReportHtml(result.snapshot,result.enrichment);assert.match(html,/售后退换货质检报告/);assert.match(html,/Europe/);assert.match(html,/APAC/);assert.match(html,/区域/);assert.equal((html.match(/<section\b/g)||[]).length,6);assert.ok(!/<script|<link\b|https?:\/\//.test(html));
  assert.equal(calls.filter(call=>call.kind==='scenarioFields').length,3,'One invalid enum must retry, not silently succeed.');assert.equal(calls.filter(call=>call.kind==='consultationAnalysis').length,2);
  for(const call of calls.filter(call=>call.kind==='consultationAnalysis'))assert.deepEqual(call.input.analysisFields,['demandSummary','negativeVoice']);
  // Report creation durably registers its output, so the next edit needs the
  // acknowledged workspace revision. The frozen inspection data stays intact.
  doc=await(await fetch(origin+'/api/workspace')).json();assert.equal(doc.revision,beforeDeliveryRevision+1);
  const deliveredTask=structuredClone(doc.state.tasks[0]),{lifecycle,...unchangedTask}=deliveredTask;
  assert.deepEqual(unchangedTask,frozenTask);assert.equal(lifecycle.deliverables.length,1);
  assert.equal(lifecycle.deliverables[0].id,'scenario-http-delivery');assert.equal(lifecycle.deliverables[0].kind,'business-report');
  state=saveScenarioConfig(doc.state,{...doc.state.scenarios[0],name:'后续修改名称',enabled:false,analysisFields:[],customFields:[],report:{...doc.state.scenarios[0].report,title:'后续报告',sections:['overview']}},{expectedVersion:2,now});await save(state);
  assert.deepEqual(doc.state.tasks[0],deliveredTask);assert.throws(()=>freezeScenario(doc.state,'SCENE-RETURN'),/停用/);
  const reloaded=await(await fetch(origin+'/api/report-jobs/scenario-http-delivery/result',{headers})).json();assert.deepEqual(reloaded.snapshot,result.snapshot);assert.equal(buildBusinessReportHtml(reloaded.snapshot,reloaded.enrichment),html);
  const traceResponse=await fetch(origin+`/api/workflow/runs?taskId=${taskId}`,{headers}),traces=await traceResponse.json();assert.ok(traces.runs.length>=1);
  assert.ok(result.job.traceRunIds.length>=1);for(const traceId of result.job.traceRunIds){const response=await fetch(origin+`/api/workflow/runs/${traceId}`,{headers});assert.equal(response.status,200);}
  await fs.writeFile(path.join(base,'latest-summary.json'),JSON.stringify({realModelCalls:0,sourceRows:4,conversations:2,rules:2,excelColumns:rows[0].length,htmlSections:6,inspectionCalls:2,customFieldCalls:3,scenarioVersion:frozenTask.scenarioSnapshot.version,finalStatus:result.job.status,traceRuns:traces.runs.length+result.job.traceRunIds.length},null,2));
});
