import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createArkClient,ArkError} from '../server/ark-client.mjs';
import {ARK_BASE_URL,DEFAULT_MODEL} from '../server/model-config.mjs';

const config={apiKey:'fictional-transport-key',model:DEFAULT_MODEL,baseUrl:ARK_BASE_URL};
const basis={capturedAt:'2026-10-29T00:00:00Z',effectiveDate:'2026-10-29',rules:[{id:'R1',name:'准确',version:'V1',scope:'全部',passCriteria:'符合正文',failCriteria:'违反正文',exceptionCriteria:'不足则无法判定',policyIds:['P/1']},{id:'R2',name:'结束',version:'V1',scope:'全部',passCriteria:'确认结束',failCriteria:'没有确认',exceptionCriteria:'未结束不适用',policyIds:['P2']}],policies:[{id:'P/1',version:'V1',title:'资料',sections:[{id:'S#1',title:'完整正文',text:'完整正文不能截断'}]},{id:'P2',version:'V2',title:'第二资料',sections:[{id:'S2',title:'结束',text:'应确认结束'}]}]};
const session={id:'s1',externalId:'ext1',topic:'售前',turns:[{id:1,role:'客户',speaker:'客户甲',text:'请问参数？'},{id:2,role:'客服',speaker:'客服乙',text:'参数如上。还有疑问吗？'}],review:{notes:'PRIVATE_DRAFT'},aiResults:[{reason:'OLD_AI_REASON'}],unexpected:'EXTRA_FIELD'};
const validResults=()=>[{ruleId:'R1',verdict:'符合',reason:'与正文一致',evidence:[1,2],referenceIds:['P%2F1@V1#S%231']},{ruleId:'R2',verdict:'不适用',reason:'会话已说明',evidence:[2],referenceIds:['P2@V2#']}];
const envelope=(results=validResults(),extra={})=>({id:'req-test',model:'provider-model',usage:{prompt_tokens:12,completion_tokens:20,total_tokens:32},choices:[{finish_reason:'stop',message:{content:JSON.stringify({results}),reasoning_content:'NEVER_CAPTURE_REASONING'}}],...extra});
const respond=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
test('inspection sends only selected conversation data and full frozen basis to fixed endpoint',async()=>{
  let request;
  const client=createArkClient({fetchImpl:async(url,options)=>{request={url,options};return respond(envelope());}});
  const answer=await client.inspect({config,session,basis});
  assert.equal(request.url,ARK_BASE_URL+'/chat/completions');
  assert.equal(request.options.redirect,'error');assert.equal(request.options.headers.Authorization,'Bearer '+config.apiKey);
  const payload=JSON.parse(request.options.body);
  assert.equal(payload.model,DEFAULT_MODEL);assert.equal(payload.stream,false);assert.equal(payload.max_tokens,16384);
  assert.ok(!('tools' in payload));assert.ok(!('response_format' in payload));assert.ok(!('thinking' in payload));
  assert.ok(request.options.body.includes('完整正文不能截断'));assert.ok(request.options.body.includes('P%2F1@V1#S%231'));
  for(const forbidden of ['PRIVATE_DRAFT','OLD_AI_REASON','EXTRA_FIELD',config.apiKey])assert.ok(!request.options.body.includes(forbidden));
  assert.deepEqual(answer.results,validResults());assert.equal(answer.modelId,'provider-model');assert.equal(answer.requestId,'req-test');
  assert.equal(answer.promptVersion,'qa-ark-v2');assert.ok(!JSON.stringify(answer).includes('NEVER_CAPTURE_REASONING'));
});
test('connectivity test uses a fixed fictional prompt and sanitized result',async()=>{
  let payload;
  const client=createArkClient({fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return respond(envelope(undefined,{choices:[{finish_reason:'stop',message:{content:'OK',reasoning_content:'hidden'}}]}));}});
  const answer=await client.test({config});
  assert.equal(payload.stream,false);assert.equal(payload.max_tokens,2048);assert.ok(!JSON.stringify(payload).includes('ext1'));
  assert.equal(answer.text,'连接成功');assert.equal(answer.modelId,'provider-model');assert.equal(answer.requestId,'req-test');
});
test('permits exactly one outer JSON code fence',async()=>{
  const provider=envelope();provider.choices[0].message.content='```json\n'+JSON.stringify({results:validResults()})+'\n```';
  const result=await createArkClient({fetchImpl:async()=>respond(provider)}).inspect({config,session,basis});
  assert.equal(result.results.length,2);
});
test('inspection accepts integer-string evidence and returns only normalized integers',async()=>{
  const results=validResults();results[0].evidence=Object.freeze(['1',' 2 ']);
  const before=structuredClone(results);
  const answer=await createArkClient({fetchImpl:async()=>respond(envelope(results))}).inspect({config,session,basis});
  assert.deepEqual(answer.results[0].evidence,[1,2]);
  assert.deepEqual(answer.results[0].referenceIds,results[0].referenceIds);
  assert.deepEqual(results,before);
});

test('invalid output rejects the entire case with no provider content in errors',async t=>{
  const cases={missing:()=>validResults().slice(0,1),duplicate:()=>[validResults()[0],validResults()[0]],unknown:()=>[{...validResults()[0],ruleId:'R404'},validResults()[1]],verdict:()=>[{...validResults()[0],verdict:'pass'},validResults()[1]],reason:()=>[{...validResults()[0],reason:''},validResults()[1]],longReason:()=>[{...validResults()[0],reason:'x'.repeat(20001)},validResults()[1]],evidence:()=>[{...validResults()[0],evidence:[999]},validResults()[1]],duplicateEvidence:()=>[{...validResults()[0],evidence:[1,1]},validResults()[1]],decimalStringEvidence:()=>[{...validResults()[0],evidence:['1.0']},validResults()[1]],reference:()=>[{...validResults()[0],referenceIds:['P2@V2#S2']},validResults()[1]],oldReference:()=>[{...validResults()[0],referenceIds:['P%2F1@V0#S%231']},validResults()[1]],shortReference:()=>[{...validResults()[0],referenceIds:['S#1']},validResults()[1]],duplicateReference:()=>[{...validResults()[0],referenceIds:['P%2F1@V1#','P%2F1@V1#']},validResults()[1]]};
  for(const [name,make]of Object.entries(cases))await t.test(name,async()=>{
    const client=createArkClient({fetchImpl:async()=>respond(envelope(make()))});
    await assert.rejects(client.inspect({config,session,basis}),error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT'&&!error.message.includes(config.apiKey));
  });
});
test('missing content, non JSON, nested fences and length finish fail closed',async t=>{
  for(const [name,content,finish]of [['missing',null,'stop'],['json','provider-private-detail','stop'],['nested','```json\n```json\n{}\n```\n```','stop'],['length',JSON.stringify({results:validResults()}),'length']])await t.test(name,async()=>{
    const client=createArkClient({fetchImpl:async()=>respond(envelope(undefined,{choices:[{finish_reason:finish,message:{content}}]}))});
    await assert.rejects(client.inspect({config,session,basis}),error=>error instanceof ArkError&&!error.message.includes('provider-private-detail'));
  });
});
test('HTTP failures are classified without exposing provider messages or secrets',async t=>{
  for(const [status,code]of [[401,'AUTHENTICATION'],[403,'PERMISSION'],[408,'TIMEOUT'],[504,'TIMEOUT'],[429,'RATE_LIMIT'],[500,'PROVIDER_UNAVAILABLE'],[400,'REQUEST_REJECTED'],[404,'REQUEST_REJECTED'],[422,'REQUEST_REJECTED']])await t.test(String(status),async()=>{
    let calls=0;
    const client=createArkClient({fetchImpl:async()=>{calls++;return new Response(config.apiKey+' provider-private-detail',{status});}});
    await assert.rejects(client.inspect({config,session,basis}),error=>error instanceof ArkError&&error.code===code&&error.status===status&&!error.message.includes(config.apiKey)&&!error.message.includes('provider-private-detail'));
    assert.equal(calls,1);
  });
});
test('network exceptions never echo their possibly sensitive error messages',async()=>{
  const client=createArkClient({fetchImpl:async()=>{throw Error(config.apiKey);}});
  await assert.rejects(client.test({config}),error=>error.code==='NETWORK'&&!error.message.includes(config.apiKey));
});
test('request timeout aborts transport',async()=>{
  const client=createArkClient({timeoutMs:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  await assert.rejects(client.test({config}),error=>error.code==='TIMEOUT');
});
test('external cancellation aborts transport',async()=>{
  const aborter=new AbortController();aborter.abort();
  let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return respond(envelope());}});
  await assert.rejects(client.inspect({config,session,basis,signal:aborter.signal}),error=>error.code==='ABORTED');assert.equal(calls,0);
});
test('oversized response is rejected while streaming and stream is cancelled',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(80));controller.enqueue(new Uint8Array(80));},cancel(){cancelled=true;}});
  const client=createArkClient({maxResponseBytes:100,fetchImpl:async()=>new Response(stream)});
  await assert.rejects(client.test({config}),error=>error.code==='RESPONSE_TOO_LARGE');assert.equal(cancelled,true);
});
test('oversized prompt is rejected before transport, without truncation',async()=>{
  let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return respond(envelope());}});
  await assert.rejects(client.inspect({config,session:{...session,turns:[{id:1,role:'客服',text:'a'.repeat(800001)}]},basis}),error=>error.code==='INPUT_TOO_LARGE');assert.equal(calls,0);
});
test('unsafe base URL and malformed config are rejected before transport',async()=>{
  let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return respond(envelope());}});
  await assert.rejects(client.test({config:{...config,baseUrl:'https://user:pass@untrusted.invalid'}}),ArkError);
  await assert.rejects(client.test({}),error=>error instanceof ArkError&&error.code==='NOT_CONFIGURED');
  await assert.rejects(client.test({config:{...config,apiKey:''}}),ArkError);assert.equal(calls,0);
});

test('local OpenAI-compatible provider receives canonical endpoint, Unicode and explicit MaaS options without old credentials in none mode',async t=>{
  let received;const provider=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;received={url:req.url,headers:req.headers,body:JSON.parse(body)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(envelope(undefined,{model:'智谱-5.1',choices:[{finish_reason:'stop',message:{content:'OK'}}]})));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const options={...config,baseUrl:`http://127.0.0.1:${provider.address().port}/v1/chat/completions/`,model:'智谱-5.1',authMode:'none',timeoutMs:1000,maxTokens:65536,reasoningEffort:'high'};
  const result=await createArkClient().test({config:options});
  assert.equal(result.text,'连接成功');assert.equal(result.modelId,'智谱-5.1');assert.equal(received.url,'/v1/chat/completions');assert.equal(received.headers.authorization,undefined);
  assert.equal(received.body.model,'智谱-5.1');assert.equal(received.body.max_tokens,65536);assert.equal(received.body.reasoning_effort,'high');assert.ok(!JSON.stringify(received).includes(config.apiKey));
  await createArkClient().test({config:{...options,authMode:'bearer',reasoningEffort:null,maxTokens:null}});
  assert.equal(received.headers.authorization,'Bearer '+config.apiKey);assert.equal(received.body.max_tokens,2048);assert.ok(!Object.hasOwn(received.body,'reasoning_effort'));
});

test('configured timeout reaches transport and overrides the client production default',async()=>{
  let received;const client=createArkClient({timeoutMs:5,fetchImpl:async(url,options)=>{received=options;return new Promise(()=>{});}});
  await assert.rejects(client.test({config:{...config,timeoutMs:1000,authMode:'none'}}),error=>error.code==='TIMEOUT');
  assert.equal(received.providerConfig.timeoutMs,1000);assert.equal(received.signal.aborted,true);
});
test('timeout cancels a stalled response body',{timeout:500},async()=>{
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
  const client=createArkClient({timeoutMs:15,fetchImpl:async()=>new Response(stream)});
  await assert.rejects(client.test({config}),error=>error.code==='TIMEOUT');assert.equal(cancelled,true);
});
test('provider metadata cannot return an echoed API key',async()=>{
  const client=createArkClient({fetchImpl:async()=>respond(envelope(undefined,{id:config.apiKey,model:config.apiKey}))});
  const answer=await client.inspect({config,session,basis});
  assert.ok(!JSON.stringify(answer).includes(config.apiKey));
});
test('expected metadata fields do not carry nested arbitrary data to the provider',async()=>{
  let payload;
  const client=createArkClient({fetchImpl:async(url,options)=>{payload=options.body;return respond(envelope());}});
  await client.inspect({config,session:{...session,channel:{extra:'NESTED_PRIVATE_META'},turns:session.turns.map(turn=>({...turn,speaker:{extra:'NESTED_PRIVATE_SPEAKER'}}))},basis});
  assert.ok(!payload.includes('NESTED_PRIVATE_META'));assert.ok(!payload.includes('NESTED_PRIVATE_SPEAKER'));
});

const contextFields=()=>[{key:'rating@2',label:'评分',type:'number',value:2,turnId:2,source:{sheet:'评价明细',row:9,column:'客户评分',extra:'PRIVATE_COORDINATE'}},{key:'orderStatus',label:'订单状态',type:'text',value:'已退款',source:{sheet:'评价明细',row:9,column:'订单状态'}}];
test('inspection explicitly sends completeness, missing note and projected context fields only',async()=>{
  let sent;
  const client=createArkClient({fetchImpl:async(url,options)=>{sent=JSON.parse(JSON.parse(options.body).messages[1].content).session;return respond(envelope());}});
  await client.inspect({config,session:{...session,completeness:'部分缺失',missingNote:'附件不可取得',metadata:{private:'RETAIN_ONLY_PRIVATE'},contextFields:contextFields().map(f=>({...f,private:'CONTEXT_EXTRA_PRIVATE'}))},basis});
  assert.equal(sent.completeness,'部分缺失');assert.equal(sent.missingNote,'附件不可取得');
  assert.deepEqual(sent.contextFields,contextFields().map(({source,...field})=>({...field,source:{sheet:source.sheet,row:source.row,column:source.column}})));
  for(const secret of ['RETAIN_ONLY_PRIVATE','CONTEXT_EXTRA_PRIVATE','PRIVATE_COORDINATE'])assert.ok(!JSON.stringify(sent).includes(secret));
});
test('inspection accepts valid field evidence and leaves legacy results unchanged',async()=>{
  const results=validResults();results[0].fieldEvidence=['rating@2','orderStatus'];
  const client=createArkClient({fetchImpl:async()=>respond(envelope(results))});
  const answer=await client.inspect({config,session:{...session,contextFields:contextFields()},basis});
  assert.deepEqual(answer.results[0].fieldEvidence,['rating@2','orderStatus']);assert.ok(!Object.hasOwn(answer.results[1],'fieldEvidence'));
});
test('inspection rejects unknown or repeated field evidence as a whole case',async t=>{
  for(const value of [['unknown'],['rating@2','rating@2'],'rating@2',[2],null])await t.test(JSON.stringify(value),async()=>{
    const results=validResults();results[0].fieldEvidence=value;
    const client=createArkClient({fetchImpl:async()=>respond(envelope(results))});
    await assert.rejects(client.inspect({config,session:{...session,contextFields:contextFields()},basis}),error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT');
  });
});
test('invalid or ambiguous context field input is refused before transport',async t=>{
  const invalids=[['null',null],['duplicate key',[...contextFields(),contextFields()[0]]],['numeric text',[{...contextFields()[0],value:'2'}]],['nonfinite number',[{...contextFields()[0],value:Infinity}]],['unknown turn',[{...contextFields()[0],turnId:999}]],['invalid physical row',[{...contextFields()[0],source:{sheet:'评价明细',row:0,column:'评分'}}]],['missing source',[{...contextFields()[0],source:null}]],['nested object value',[{...contextFields()[1],value:{private:'hidden'}}]]];
  for(const [name,fields] of invalids)await t.test(name,async()=>{
    let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return respond(envelope());}});
    await assert.rejects(client.inspect({config,session:{...session,contextFields:fields},basis}),error=>error.code==='INVALID_INPUT');assert.equal(calls,0);
  });
});
test('context field count and identifiers respect the persisted schema limits',async t=>{
  const invalids=[['field key too long',[{...contextFields()[0],key:'k'.repeat(161)}]],['field label too long',[{...contextFields()[0],label:'k'.repeat(121)}]],['sheet name too long',[{...contextFields()[0],source:{...contextFields()[0].source,sheet:'s'.repeat(81)}}]],['too many fields',Array.from({length:2001},(_,n)=>({...contextFields()[0],key:'field'+n}))]];
  for(const [name,fields] of invalids)await t.test(name,async()=>{
    let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return respond(envelope());}});
    await assert.rejects(client.inspect({config,session:{...session,contextFields:fields},basis}),error=>error.code==='INVALID_INPUT');assert.equal(calls,0);
  });
});
