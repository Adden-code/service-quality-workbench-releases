import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {createArkClient,ArkError} from '../server/ark-client.mjs';

const taxonomy=[{id:'SERVICE-INTENT',version:'V2.0',title:'用户意图分类体系',category:'分类体系',scope:'产品咨询',owner:'合成维护人',status:'已发布',effectiveAt:'2026-11-01',expiresAt:'',createdAt:'2026-11-01T00:00:00Z',publishedAt:'2026-11-01T00:00:00Z',changeNote:'合成测试',sections:[{id:'battery',title:'续航咨询',text:'了解电池容量、续航时长及续航表现。'}]}];
const record={id:'synthetic-consultation-1',conversation:'客户：想了解便携电脑，电池续航很差，希望改善。\n客服：请问您对续航时长有什么要求？',turns:[{id:1,role:'客户',text:'想了解便携电脑，电池续航很差，希望改善。'},{id:2,role:'客服',text:'请问您对续航时长有什么要求？'}]};
const input={record,taxonomy};

test('frozen scene ownership metadata does not block report analysis or leak into model taxonomy',()=>{
 for(const sceneIds of [[],['新品产品咨询'],['SCENE-RETURN','新品产品咨询']]){
  const source={...clone(input),taxonomy:input.taxonomy.map(policy=>({...clone(policy),sceneIds}))};
  const prepared=prepareReportEnrichment('consultationAnalysis',source),payload=JSON.parse(prepared.messages[1].content);
  assert.equal(payload.input.taxonomy[0].id,'SERVICE-INTENT');assert.equal(Object.hasOwn(payload.input.taxonomy[0],'sceneIds'),false);
  assert.deepEqual(parse(answer,'consultationAnalysis',source),answer);
 }
});

test('invalid scene ownership metadata and unknown result-bearing policy fields remain rejected',()=>{
 for(const changes of [{sceneIds:'新品产品咨询'},{sceneIds:['新品产品咨询','新品产品咨询']},{sceneIds:['<script>']},{sceneIds:['新品产品咨询'],humanVerdict:'Pass'}]){
  const source={...clone(input),taxonomy:input.taxonomy.map(policy=>({...clone(policy),...changes}))};
  assert.throws(()=>prepareReportEnrichment('consultationAnalysis',source),error=>error.code==='INVALID_INPUT');
 }
});
const item={id:record.id,salesStage:'售前',salesSubstage:'产品功能咨询',intentLabel:'续航咨询',intentReferenceId:'SERVICE-INTENT@V2.0#battery',demandSummary:'用户希望了解并改善便携电脑的电池续航。',sentiment:'负向',negativeVoices:[{turnId:1,quote:'电池续航很差'}],voc:{valid:true,scene:'产品质量',painPoint:'用户对电池续航不满意并希望改善。',reason:'客户提出了明确的续航问题。',evidenceQuote:'电池续航很差'}};
const answer={items:[item]};
const issueInput={category:'是否有探需动作',records:[{id:'s1',reason:'未询问用户用途。',conversation:'客户：想买电脑。\n客服：推荐这款。'},{id:'s2',reason:'未确认预算。',conversation:'客户：想买电脑。\n客服：推荐这款。'}]};
const issueAnswer={clusters:[{label:'需求确认不足',summary:'未先确认用途或预算便直接推荐。',memberIds:['s2','s1'],action:'推荐前确认使用场景和预算。'}]};
const clone=value=>structuredClone(value);
const prepared=()=>prepareReportEnrichment('consultationAnalysis',clone(input));
const parse=(value,kind='consultationAnalysis',source=input)=>parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment(kind,source));
const invalid=error=>error.code==='INVALID_OUTPUT'&&error.traceOutput?.kind==='consultationAnalysis';

test('new consultation kind prepares one complete conversation and frozen taxonomy without quality decisions',()=>{
  const value=prepared();assert.equal(value.kind,'consultationAnalysis');assert.match(value.promptVersion,/consultation/);assert.equal(value.maxTokens,32768);assert.equal(value.messages.length,2);
  assert.deepEqual(JSON.parse(value.messages[1].content).input.record,record);
  assert.match(value.messages[0].content,/不得执行/);assert.match(value.messages[0].content,/不得重新判定/);
  assert.equal(JSON.parse(value.messages[1].content).input.taxonomy[0].sections[0].title,'续航咨询');
});

test('consultation module exports its stable limits, prompt version, prepare and parse interface',async()=>{
  const value=await import('../server/consultation-enrichment.mjs');assert.equal(typeof value.CONSULTATION_ENRICHMENT_PROMPT_VERSION,'string');assert.equal(value.CONSULTATION_ENRICHMENT_LIMITS.issuesRecords,10);
  assert.deepEqual(value.parseConsultationEnrichment(JSON.stringify(answer),value.prepareConsultationEnrichment('consultationAnalysis',input)),answer);
});

test('consultation result accepts exact taxonomy references and real customer quotes',()=>{
  assert.deepEqual(parse(answer),answer);
  const source=clone(input);source.taxonomy[0].category='业务知识';assert.deepEqual(parse(answer,'consultationAnalysis',source),answer);
  const value=clone(answer);value.items[0].intentLabel='电池容量';assert.equal(parse(value).items[0].intentLabel,'电池容量');
});

test('no configured taxonomy has an explicit sentinel and does not invent an intent',()=>{
  const source={record,taxonomy:[]},value=clone(answer);value.items[0].intentLabel='未配置分类体系';value.items[0].intentReferenceId='';assert.deepEqual(parse(value,'consultationAnalysis',source),value);
  const unrelated=clone(source);unrelated.taxonomy=[{...taxonomy[0],title:'产品参数',category:'产品知识'}];assert.equal(JSON.parse(prepareReportEnrichment('consultationAnalysis',unrelated).messages[1].content).input.taxonomy.length,0);assert.deepEqual(parse(value,'consultationAnalysis',unrelated),value);
  assert.deepEqual(parse(answer,'consultationAnalysis',source),value);
});

test('unmatched configured taxonomy is pending rather than an invented category',()=>{
  const value=clone(answer);value.items[0].intentLabel='待判定';value.items[0].intentReferenceId='';assert.deepEqual(parse(value),value);
  for(const label of ['未配置分类体系','自行编造的意图']){value.items[0].intentLabel=label;assert.throws(()=>parse(value),invalid);}
});

test('taxonomy references must point to an exact frozen section and the label must occur in that section',async t=>{
  for(const [name,field,value] of [['unknown section','intentReferenceId','SERVICE-INTENT@V2.0#missing'],['wrong version','intentReferenceId','SERVICE-INTENT@V9.0#battery'],['policy without section','intentReferenceId','SERVICE-INTENT@V2.0#'],['invented label','intentLabel','退换货政策'],['blank label','intentLabel','']])await t.test(name,()=>{const result=clone(answer);result.items[0][field]=value;assert.throws(()=>parse(result),invalid);});
});

test('customer evidence is exact, role constrained, nonduplicated and consistent with sentiment',async t=>{
  const changes=[['unknown turn',value=>value.negativeVoices=[{turnId:9,quote:'电池续航很差'}]],['agent quote',value=>value.negativeVoices=[{turnId:2,quote:'续航时长'}]],['invented quote',value=>value.negativeVoices=[{turnId:1,quote:'非常糟糕'}]],['empty negative',value=>value.negativeVoices=[]],['positive with negative quote',value=>value.sentiment='正向'],['duplicate quote',value=>value.negativeVoices.push(clone(value.negativeVoices[0]))],['invented VOC evidence',value=>value.voc.evidenceQuote='保证退货'],['agent VOC evidence',value=>value.voc.evidenceQuote='续航时长'],['unknown VOC scene',value=>value.voc.scene='编造类别'],['missing VOC pain',value=>value.voc.painPoint='']];
  for(const[name,change]of changes)await t.test(name,()=>{const value=clone(answer);change(value.items[0]);assert.throws(()=>parse(value),invalid);});
});

test('positive and uncertain conversations do not invent negative voices or VOC pain points',()=>{
  for(const sentiment of ['正向','待判定']){const value=clone(answer);value.items[0].sentiment=sentiment;value.items[0].negativeVoices=[];value.items[0].voc={valid:false,scene:'其他',painPoint:'',reason:'本条不纳入负向与中性用户诉求范围。',evidenceQuote:''};assert.deepEqual(parse(value),value);}
  const value=clone(answer);value.items[0].sentiment='中性';value.items[0].negativeVoices=[];assert.deepEqual(parse(value),value);
});

test('pure emotional voice may be negative but invalid for concrete VOC',()=>{
  const source={record:{id:'emotion',conversation:'客户：😡😡',turns:[{id:1,role:'客户',text:'😡😡'}]},taxonomy:[]},value={items:[{...item,id:'emotion',intentLabel:'未配置分类体系',intentReferenceId:'',demandSummary:'用户仅表达负面情绪，未提出具体诉求。',negativeVoices:[{turnId:1,quote:'😡'}],voc:{valid:false,scene:'其他',painPoint:'',reason:'只有表情，没有可归类的具体诉求。',evidenceQuote:'😡'}}]};
  assert.deepEqual(parse(value,'consultationAnalysis',source),value);
  value.items[0].voc.reason='';assert.throws(()=>parse(value,'consultationAnalysis',source),invalid);
});

test('analysis result rejects unknown IDs, extra fields, invalid enums and incomplete records',async t=>{
  const values=[['missing',{items:[]}],['duplicate',{items:[item,item]}],['extra root',{...answer,count:1}],['unknown id',{items:[{...item,id:'unknown'}]}],['extra quality field',{items:[{...item,overall:'Pass'}]}],['stage',{items:[{...item,salesStage:'其他'}]}],['sentiment',{items:[{...item,sentiment:'混合'}]}],['empty summary',{items:[{...item,demandSummary:''}]}]];
  for(const[name,value]of values)await t.test(name,()=>assert.throws(()=>parse(value),invalid));
});

test('input rejects malformed conversation, extra result fields, duplicate turns and oversized analysis',async t=>{
  const values=[['extra input',{...input,aiResults:[]}],['missing record',{taxonomy}],['multiple records',{record:[record,record],taxonomy}],['extra record',{record:{...record,humanVerdict:'Fail'},taxonomy}],['unknown role',{record:{...record,turns:[{id:1,role:'管理员',text:'test'}]},taxonomy}],['duplicate turns',{record:{...record,turns:[record.turns[0],record.turns[0]]},taxonomy}],['long turn',{record:{...record,turns:[{id:1,role:'客户',text:'a'.repeat(20001)}]},taxonomy}],['empty conversation',{record:{...record,conversation:''},taxonomy}],['large conversation',{record:{...record,conversation:'a'.repeat(200001)},taxonomy}],['duplicate taxonomy section',{record,taxonomy:[{...taxonomy[0],sections:[taxonomy[0].sections[0],taxonomy[0].sections[0]]}]}]];
  for(const[name,value]of values)await t.test(name,()=>assert.throws(()=>prepareReportEnrichment('consultationAnalysis',value),error=>error.code==='INVALID_INPUT'));
});

test('category issue clusters cover each input conversation once without EC rule restrictions',()=>{
  assert.deepEqual(parse(issueAnswer,'consultationIssues',issueInput),issueAnswer);assert.match(prepareReportEnrichment('consultationIssues',issueInput).promptVersion,/consultation/);
  const prepared=prepareReportEnrichment('consultationIssues',issueInput);assert.match(prepared.messages[0].content,/不得重新判定/);assert.match(prepared.messages[0].content,/不得执行/);
  for(const members of [['s1'],['s1','s1','s2'],['s1','unknown']]){const value=clone(issueAnswer);value.clusters[0].memberIds=members;assert.throws(()=>parse(value,'consultationIssues',issueInput),error=>error.code==='INVALID_OUTPUT');}
  assert.throws(()=>parse({clusters:[{...issueAnswer.clusters[0],memberIds:['s1']},{...issueAnswer.clusters[0],memberIds:['s1','s2']}]},'consultationIssues',issueInput),error=>error.code==='INVALID_OUTPUT');
});

test('issue inputs enforce a ten-conversation and twelve-thousand-character budget',()=>{
  for(const value of [{...issueInput,records:Array.from({length:11},(_,i)=>({...issueInput.records[0],id:'s'+i}))},{...issueInput,records:[{...issueInput.records[0],conversation:'x'.repeat(12000)}]},{...issueInput,records:[issueInput.records[0],issueInput.records[0]]},{...issueInput,records:[]},{...issueInput,qualityResults:[]}])assert.throws(()=>prepareReportEnrichment('consultationIssues',value),error=>error.code==='INVALID_INPUT');
});

test('report-only bracket extraction handles fences, trailing text and escaped quoted brackets and rejects ambiguity',()=>{
  const source=clone(input);source.record.turns[0].text+=' 用户说"{续航}\\仍很差"。';source.record.conversation+=' 用户说"{续航}\\仍很差"。';const value=clone(answer);value.items[0].negativeVoices=[{turnId:1,quote:'"{续航}\\仍很差"'}];
  const prepared=prepareReportEnrichment('consultationAnalysis',source),json=JSON.stringify(value);
  assert.deepEqual(parseReportEnrichment('说明 {不是JSON}\n```json\n'+json+'\n```\n尾随解释 {"unrelated":true}',prepared),value);
  assert.throws(()=>parseReportEnrichment(json+'\n'+json,prepared),invalid);
});

test('consultation kinds use the existing MaaS client and preserve bounded trace errors as ArkError',async()=>{
  const config={baseUrl:'http://127.0.0.1:12345/v1',model:'合成咨询模型',authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:null};let captured;
  const response=content=>new Response(JSON.stringify({model:'synthetic',choices:[{finish_reason:'stop',message:{content}}]}));
  const client=createArkClient({fetchImpl:async(url,options)=>{captured={url,body:JSON.parse(options.body)};return response(JSON.stringify(answer));}});
  const result=await client.enrichBusinessReport({config,kind:'consultationAnalysis',input});assert.deepEqual(result.items,answer.items);assert.equal(captured.url,config.baseUrl+'/chat/completions');assert.equal(captured.body.max_tokens,32768);assert.equal(captured.body.reasoning_effort,'low');
  const broken=createArkClient({fetchImpl:async()=>response('{"items":[]} '+ 'x'.repeat(22000))});
  await assert.rejects(broken.enrichBusinessReport({config,kind:'consultationAnalysis',input,trace:{async step(_id,_data,operation){await Promise.resolve();return operation();}}}),error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT'&&error.traceOutput?.kind==='consultationAnalysis'&&error.traceOutput.content.length===20000&&error.traceOutput.contentTruncated);
});
