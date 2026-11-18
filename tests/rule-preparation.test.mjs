import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient,ArkError} from '../server/ark-client.mjs';
import {RULE_PREPARATION_PROMPT_VERSION,prepareRulePrompt,parseRuleCandidates,RulePreparationError} from '../server/rule-preparation.mjs';

const input={text:'售前沟通规范\n客服须说明发货不等于送达。\n如地址未知，应先询问地址，不承诺指定日期送达。',scene:'新品产品咨询',sourceName:'虚构售前规则'};
const quote='客服须说明发货不等于送达。';
const candidate=()=>({title:'区分发货和送达',category:'物流履约',scope:'咨询物流的售前会话',passCriteria:'明确区分发货与送达。',failCriteria:'',exceptionCriteria:'',sourceQuote:quote,sourceLocator:{start:input.text.indexOf(quote),end:input.text.indexOf(quote)+quote.length},warnings:[]});
const config={apiKey:'fictional-rule-key',model:'glm-5.3-flash'};
const response=(candidates=[candidate()],{content,finish='stop',status=200}={})=>new Response(JSON.stringify({model:'provider-model',id:'req-prepare',usage:{total_tokens:123},choices:[{finish_reason:finish,message:{content:content??JSON.stringify({candidates}),reasoning_content:'PRIVATE_REASONING'}}]}),{status});

test('preparation validates source input and builds an explicitly bounded candidate prompt',()=>{
  const prepared=prepareRulePrompt(input);
  assert.deepEqual(prepared.input,input);assert.equal(prepared.messages.length,2);
  assert.equal(RULE_PREPARATION_PROMPT_VERSION,'rule-preparation-ark-v2');
  assert.ok(prepared.messages[0].content.includes('不得补造'));assert.equal(JSON.parse(prepared.messages[1].content).text,input.text);
});
test('missing business criteria stay empty and receive explicit review warnings',()=>{
  const [result]=parseRuleCandidates(JSON.stringify({candidates:[candidate()]}),input);
  assert.equal(result.failCriteria,'');assert.equal(result.exceptionCriteria,'');
  assert.ok(result.warnings.some(w=>w.includes('不符合口径')));assert.ok(result.warnings.some(w=>w.includes('例外口径')));
  assert.deepEqual(result.sourceLocator,candidate().sourceLocator);
  assert.equal(input.text.slice(result.sourceLocator.start,result.sourceLocator.end),result.sourceQuote);
});
test('an omitted criterion is a visible gap rather than invented content',()=>{
  const item=candidate();delete item.failCriteria;delete item.scope;delete item.warnings;
  const [result]=parseRuleCandidates(JSON.stringify({candidates:[item]}),input);
  assert.equal(result.failCriteria,'');assert.equal(result.scope,'');assert.ok(result.warnings.length>=3);
});
test('only a single optional outer json fence is accepted and empty candidate list is valid',()=>{
  assert.deepEqual(parseRuleCandidates('```json\n{"candidates":[]}\n```',input),[]);
  assert.throws(()=>parseRuleCandidates('Explanation {"candidates":[]}',input),RulePreparationError);
});
test('unverifiable or malformed source provenance rejects the complete response',async t=>{
  const invalids=[{sourceQuote:'编造的不存在条款'},{sourceQuote:''},{title:''},{passCriteria:12},{warnings:['']},{warnings:'注意'}];
  for(const invalid of invalids)await t.test(JSON.stringify(invalid),()=>{
    assert.throws(()=>parseRuleCandidates(JSON.stringify({candidates:[candidate(),{...candidate(),...invalid}]}),input),error=>error instanceof RulePreparationError&&error.code==='INVALID_OUTPUT'&&!error.message.includes('编造的不存在条款'));
  });
});
test('candidate and source limits fail closed without truncation',()=>{
  assert.throws(()=>parseRuleCandidates(JSON.stringify({candidates:Array.from({length:31},candidate)}),input),RulePreparationError);
  for(const bad of [{...input,text:'a'.repeat(100001)},{...input,text:''},{...input,scene:'任意新场景'},{...input,metadata:{hidden:'data'}}])assert.throws(()=>prepareRulePrompt(bad),RulePreparationError);
});
test('UTF-16 spans are checked against the exact original input including emoji and CRLF',()=>{
  const source={...input,text:'😀\r\n'+quote};const item=candidate();item.sourceLocator={start:4,end:4+quote.length};
  const [result]=parseRuleCandidates(JSON.stringify({candidates:[item]}),source);
  assert.deepEqual(result.sourceLocator,item.sourceLocator);
});
test('unique exact source quotes normalize an off-by-one or absent locator',async t=>{
  const correct=candidate().sourceLocator;
  for(const [name,locator] of [['off by one',{start:correct.start+1,end:correct.end+1}],['absent',undefined],['null',null],['malformed',{start:1.5,end:20}]])await t.test(name,()=>{
    const item={...candidate(),sourceLocator:locator};
    const [result]=parseRuleCandidates(JSON.stringify({candidates:[item]}),input);
    assert.deepEqual(result.sourceLocator,correct);assert.equal(result.sourceQuote,quote);
  });
});
test('programmatic quote location counts emoji and preserves CRLF and surrounding whitespace',()=>{
  const exact='  发货\r\n不等于送达。  ',source={...input,text:'😀\r\n'+exact+'\r\n末尾'};
  const item={...candidate(),sourceQuote:exact,sourceLocator:{start:3,end:3+exact.length}};
  const [result]=parseRuleCandidates(JSON.stringify({candidates:[item]}),source);
  assert.deepEqual(result.sourceLocator,{start:4,end:4+exact.length});assert.equal(result.sourceQuote,exact);
  assert.equal(source.text.slice(result.sourceLocator.start,result.sourceLocator.end),exact);
});
test('repeated exact quotes require an already correct unambiguous locator',async t=>{
  const source={...input,text:quote+'\n'+quote},secondStart=quote.length+1;
  const item={...candidate(),sourceLocator:{start:secondStart,end:secondStart+quote.length}};
  const [result]=parseRuleCandidates(JSON.stringify({candidates:[item]}),source);
  assert.deepEqual(result.sourceLocator,item.sourceLocator);
  for(const [name,locator] of [['absent',undefined],['wrong',{start:1,end:quote.length+1}],['null',null]])await t.test(name,()=>{
    assert.throws(()=>parseRuleCandidates(JSON.stringify({candidates:[{...item,sourceLocator:locator}]}),source),RulePreparationError);
  });
});
test('quote location never trims, normalizes newlines, fuzzy matches or ignores overlapping repeats',()=>{
  const source={...input,text:' 发货\r\n不等于送达。 '};
  for(const badQuote of ['发货\n不等于送达。','发货\r\n等于送达。','  发货\r\n不等于送达。  '])assert.throws(()=>parseRuleCandidates(JSON.stringify({candidates:[{...candidate(),sourceQuote:badQuote,sourceLocator:null}]}),source),RulePreparationError);
  assert.throws(()=>parseRuleCandidates(JSON.stringify({candidates:[{...candidate(),sourceQuote:'aa',sourceLocator:null}]}),{...input,text:'aaa'}),RulePreparationError);
});
test('prepareRules reuses fixed transport and returns only normalized candidates and safe metadata',async()=>{
  let request;
  const client=createArkClient({fetchImpl:async(url,options)=>{request={url,options};return response();}});
  const result=await client.prepareRules({config,input});
  assert.equal(request.url,'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions');assert.equal(request.options.redirect,'error');
  const payload=JSON.parse(request.options.body);assert.equal(payload.model,config.model);assert.equal(payload.stream,false);assert.equal(payload.max_tokens,16384);
  for(const field of ['tools','thinking','response_format'])assert.ok(!Object.hasOwn(payload,field));
  assert.ok(!request.options.body.includes(config.apiKey));assert.equal(result.promptVersion,'rule-preparation-ark-v2');assert.equal(result.modelId,'provider-model');assert.equal(result.requestId,'req-prepare');assert.equal(result.candidates.length,1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_REASONING'));
});
test('prepareRules malformed source quotes are safe ArkErrors with no partial candidates',async()=>{
  const client=createArkClient({fetchImpl:async()=>response([{...candidate(),sourceQuote:'HALLUCINATED_PRIVATE_RULE'}])});
  await assert.rejects(client.prepareRules({config,input}),error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT'&&!error.message.includes('HALLUCINATED_PRIVATE_RULE'));
});
test('preparation errors do not retry or echo provider details',async()=>{
  let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return new Response(config.apiKey+' PRIVATE_PROVIDER_BODY',{status:429});}});
  await assert.rejects(client.prepareRules({config,input}),error=>error instanceof ArkError&&error.code==='RATE_LIMIT'&&!error.message.includes(config.apiKey)&&!error.message.includes('PRIVATE_PROVIDER_BODY'));
  assert.equal(calls,1);
});
test('preparation uses bounded response handling and rejects truncated output',async()=>{
  const bounded=createArkClient({maxResponseBytes:100,fetchImpl:async()=>response()});
  await assert.rejects(bounded.prepareRules({config,input}),error=>error.code==='RESPONSE_TOO_LARGE');
  const truncated=createArkClient({fetchImpl:async()=>response(undefined,{finish:'length'})});
  await assert.rejects(truncated.prepareRules({config,input}),error=>error.code==='OUTPUT_TRUNCATED');
});
test('preparation timeout and external cancellation abort the existing transport',async()=>{
  const waiting=createArkClient({timeoutMs:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  await assert.rejects(waiting.prepareRules({config,input}),error=>error.code==='TIMEOUT');
  const controller=new AbortController();controller.abort();let calls=0;
  const cancelled=createArkClient({fetchImpl:async()=>{calls++;return response();}});
  await assert.rejects(cancelled.prepareRules({config,input,signal:controller.signal}),error=>error.code==='ABORTED');assert.equal(calls,0);
});
