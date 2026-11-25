import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocale,t,translateError} from '../public/i18n.mjs';
import {applyBusinessTranslations,businessContent,applyBundledRuleEnglish,clearBusinessTranslations,d,ruleDisplayName} from '../public/content-translation-ui.mjs';
import {createReasonTranslationController,clearReasonTranslations,reasonContent,reasonText} from '../public/reason-translation.mjs';
import {sessionDisplayFields} from '../public/session-display-fields.mjs';
import {classificationReviewForm} from '../public/ecommerce-classification-review.mjs';
import {taskExecutionPage} from '../public/task-execution-page.mjs';
import {contextFieldsView} from '../public/import-ui.mjs';
import {EC_HEADERS} from '../public/ecommerce-columns.mjs';
import {SYSTEM_EC_HEADERS} from '../public/ecommerce-system-source.mjs';

test('standard source-field labels project to English without rewriting the original header or cells',()=>{
 const source={contextFields:[...new Set([...EC_HEADERS,...SYSTEM_EC_HEADERS])].map((label,i)=>({key:String(i),label,value:'Synthetic original',source:{sheet:'Sheet4',row:3,column:label}}))},before=JSON.stringify(source);
 setLocale('en');try{const html=contextFieldsView(source);assert.doesNotMatch(html,/[\u3400-\u9fff]|English missing/u);assert.equal(JSON.stringify(source),before);}finally{setLocale('zh');}
});

test('mixed-script business translation cache cannot be presented as verified English',()=>{
 clearBusinessTranslations();setLocale('en');try{applyBusinessTranslations({translations:[{sourceText:'原文范围',text:'Scope仍是中文',status:'translated'}]});assert.notEqual(d('原文范围'),'Scope仍是中文');assert.doesNotMatch(businessContent('原文范围'),/English translation|Scope仍是中文/);}finally{clearBusinessTranslations();setLocale('zh');}
});

test('English repeat imports, navigation and known backend failures contain no Chinese UI',()=>{
 setLocale('en');try{
  for(const text of ['再次导入 · 第2次','AI失败','上一条','下一条','规则出处'])assert.doesNotMatch(t(text),/[\u3400-\u9fff]/u,text);
  assert.equal(translateError(new Error('请选择分类、填写依据及审核人标签。')),'Choose a classification and enter a review reason and reviewer label.');
  assert.match(translateError('模型结果不完整或依据无效（本行未保存质检结论）'),/No inspection verdict was saved.*Retry/);
  assert.match(translateError('模型响应超时，可继续其他行或重试本行。'),/timed out.*retry/);
  assert.match(translateError('引文无法在声明轮次逐字定位。'),/cannot be matched verbatim.*Check/);
  assert.match(translateError('工作区版本冲突，请保留编辑内容后重新加载。'),/Keep your edits.*reload/);
  assert.doesNotMatch(translateError(new Error('内部未知异常：某个故障')) ,/[\u3400-\u9fff]|Original message/);
  const view=taskExecutionPage({id:'T',aiQueue:{}},{executionPages:{T:{offset:0,total:1,rows:[{sourceRow:3,status:'failed',error:'未取得完整AI结果，可在任务详情中继续处理。'}]}}});
  assert.doesNotMatch(view,/[\u3400-\u9fff]/u);
 }finally{setLocale('zh');}
});

test('legacy built-in names have offline English mappings without mutating frozen catalog or tasks',()=>{
 const catalog={rules:[{id:'NP-R02',title:'及时响应与负向回应'},{id:'EC-TARGET',title:'针对性及批次重复（测试规则）'}]},state={tasks:[{basisSnapshot:{rules:[{id:'EC-TEXT',name:'文本质量（测试规则）'}]}}]},before=JSON.stringify({catalog,state});
 clearBusinessTranslations();setLocale('en');try{
  applyBundledRuleEnglish(catalog,state);
  for(const rule of [...catalog.rules,...state.tasks[0].basisSnapshot.rules])assert.doesNotMatch(ruleDisplayName(rule),/[\u3400-\u9fff]|English missing/u,rule.title||rule.name);
  assert.match(d('用户自定义检查名称'),/用户自定义检查名称/);
  assert.match(ruleDisplayName({id:'NP-R02',title:'用户自定义检查名称'}),/用户自定义检查名称/);
  assert.equal(JSON.stringify({catalog,state}),before);
 }finally{clearBusinessTranslations();setLocale('zh');}
});

test('failed ecommerce rows translate classification explanations through frozen-source jobs and identify failed originals',async()=>{
 const s={id:'S',taskId:'T',ecommerce:{raw:Array(22).fill(''),aiTypeReason:'原始分类理由'},review:{status:'待审核',reviewer:'Reviewer',drafts:{}},aiExecution:{status:'failed',runId:'RUN'},aiResults:[],sceneCapabilities:{outputs:{ecommerceClassification:{status:'completed',reason:'评分为一星且描述产品缺陷。',value:{evaluationType:'差评',vocKind:'substantive',reason:'分类补充理由'}}}}};
 const before=JSON.stringify(s),fields=sessionDisplayFields(s),requests=[];
 const api={list:async()=>({jobs:[]}),create:async input=>{requests.push(input);return{job:{...input,id:input.jobId,status:'completed'}};},result:async id=>({job:{id,source:requests[0].source,targetLang:'en',status:'completed'},sourceSnapshot:{fields},translations:fields.map(f=>({...f,sourceText:f.text,status:'translated',text:'One-star rating and a described product defect.'}))})};
 clearReasonTranslations();setLocale('en');const controller=createReasonTranslationController({client:api,autoPoll:false});
 try{
  await controller.ensure(s);assert.equal(requests.length,1);assert.deepEqual(requests[0].source,{kind:'session-display',taskId:'T',sessionId:'S'});
  assert.match(classificationReviewForm(s),/One-star rating and a described product defect/);assert.match(classificationReviewForm(s),/Original AI explanation/);
  assert.equal(JSON.stringify(s),before);
  clearReasonTranslations();const failed=createReasonTranslationController({client:{list:async()=>{throw Error('offline');}},autoPoll:false});await failed.ensure(s);
  assert.equal(reasonText(s.sceneCapabilities.outputs.ecommerceClassification.reason),'[Translation unavailable — retry required]');
  assert.doesNotMatch(reasonText(s.sceneCapabilities.outputs.ecommerceClassification.reason),/[\u3400-\u9fff]/u);
  assert.match(reasonContent(s.ecommerce.aiTypeReason),/data-business-original/);failed.stop();
 }finally{controller.stop();clearReasonTranslations();setLocale('zh');}
});

test('English display rejects a completed mixed-script translation and retries without exposing the original in main text',async()=>{
 clearReasonTranslations();setLocale('en');const row={id:'S2',taskId:'T2',aiResults:[{ruleId:'R',reason:'客服未解释处理办法。'}]},fields=sessionDisplayFields(row),jobs=[],results=new Map();let calls=0;
 const api={list:async()=>({jobs}),result:async id=>results.get(id),create:async input=>{calls++;const job={...input,id:input.jobId,status:'completed'};jobs.push(job);results.set(job.id,{job,sourceSnapshot:{fields},translations:fields.map(f=>({...f,sourceText:f.text,status:'translated',text:calls===1?'The agent said 中文处理办法。':'The agent did not explain the next action.'}))});return{job};}};
 const controller=createReasonTranslationController({client:api,autoPoll:false});try{
  assert.equal(reasonText(row.aiResults[0].reason),'[Translation pending]');await controller.ensure(row);assert.equal(reasonText(row.aiResults[0].reason),'[Translation unavailable — retry required]');
  const html=reasonContent(row.aiResults[0].reason);assert.match(html,/<details class="business-original ai-original-audit"><summary>Original AI explanation<\/summary><span data-business-original>客服未解释处理办法。/);assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
  await controller.ensure(row,{retry:true});assert.equal(calls,2);assert.equal(reasonText(row.aiResults[0].reason),'The agent did not explain the next action.');
 }finally{controller.stop();clearReasonTranslations();setLocale('zh');}
});

test('display allowlist includes auxiliary text, metric topics and recovery AI candidates but excludes source and human audit',()=>{
 const row={id:'S',taskId:'T',aiResults:[],turns:[{text:'PRIVATE USER'}],review:{notes:'PRIVATE HUMAN'},sceneCapabilities:{outputs:{demandSummary:{reason:'摘要依据',value:{text:'用户希望退货'}},negativeVoice:{value:{text:'客户不满售后体验'}},timing:{metrics:[{reason:'计时依据',actual:[{topic:'退货进度'}]}]},intent:{value:{label:'退换货咨询',reason:'意图理由'},evidence:[{quote:'PRIVATE QUOTE'}]}}}};
 const task={id:'T',aiQueue:{rows:[{sessionId:'S',capabilityRecovery:[{candidateCapabilities:{outputs:{ecommerceClassification:{reason:'恢复归类理由'}}},candidateResults:[{ruleId:'EC-STEPS',reason:'恢复检核理由'}],rawResponse:'PRIVATE AUDIT'}]}]}};
 const texts=sessionDisplayFields(row,task).map(f=>f.text);for(const expected of ['摘要依据','用户希望退货','客户不满售后体验','计时依据','退货进度','退换货咨询','意图理由','恢复归类理由','恢复检核理由'])assert.ok(texts.includes(expected),expected);assert.doesNotMatch(JSON.stringify(texts),/PRIVATE/);
});
