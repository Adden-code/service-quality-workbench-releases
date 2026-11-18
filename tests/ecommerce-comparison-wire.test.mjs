import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {planEcommerceComparisons,validateComparisonBlock,mergeComparisonGroups} from '../server/ecommerce-comparison.mjs';
import {parseComparisonWire} from '../server/ecommerce-comparison-wire.mjs';
import {EC_HEADERS} from '../public/ecommerce-schema.mjs';

const config={baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-comparison-wire',authMode:'none'};
function row(n,agent='合成客服A'){
 const raw=Array(22).fill('');raw[8]=`合成评论${n}`;raw[9]=`合成独立回复${n}`;raw[11]=agent;
 return{id:`S${n}`,ecommerce:{schemaVersion:1,sheet:'Sheet4',row:n+3,fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('标准'),raw,thresholdHours:24}};
}
function fixture(){const plan=planEcommerceComparisons([row(0),row(1),row(2),row(3),row(4,'合成客服B')],{maxRecords:6});return{plan,block:plan.blocks.find(block=>block.kind==='within')};}
const answer=block=>({similarPairs:[],checkedIds:[...block.representativeIds]});
const positive=block=>({leftId:block.leftIds[0],rightId:block.leftIds[1],reason:'相同操作步骤，且包含引号 "、反斜线 \\ 与 {括号} [数组]。'});
async function compare(content,{plan,block}=fixture(),extra={}){
 const client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({model:config.model,choices:[{finish_reason:'stop',message:{content}}]}))});
 return client.compareEcommerceReplies({config,block,plan,...extra});
}
const invalid=error=>error.code==='INVALID_OUTPUT';
test('partial wire keeps grounded positive pairs but never certifies unchecked records as pass',()=>{
 const {plan,block}=fixture(),ids=block.representativeIds;
 const similarPairs=[[0,1],[0,2],[1,2]].map(([a,b])=>({leftId:ids[a],rightId:ids[b],reason:'Synthetic identical operation wording'}));
 const partial=parseComparisonWire(JSON.stringify({checkedIds:[ids[0]],similarPairs:[...similarPairs,{leftId:'invented',rightId:ids[1],reason:'Invalid id'}]}),block,plan,{allowPartial:true});assert.equal(partial.complete,false);assert.equal(partial.similarPairs.length,3);
 const merged=mergeComparisonGroups(plan,[{...block,status:'failed',partialResult:partial}]);assert.equal(merged.complete,false);assert.ok(merged.groups.some(g=>g.sessionIds.length===3));assert.ok(plan.representatives.filter(r=>block.representativeIds.includes(r.id)).flatMap(r=>r.sessionIds).every(id=>merged.pendingBySession[id]?.includes(block.id)));assert.equal(merged.pendingBySession.S4,undefined);
});

test('one complete comparison object amid prose or markdown preserves quoted and escaped delimiters',async()=>{
 const f=fixture(),value=answer(f.block);value.similarPairs=[positive(f.block)];const json=JSON.stringify(value);
 for(const content of [json,'```json\r\n'+json+'\r\n```','完成本块全部比较。\n```json\n'+json+'\n```\n以上为完整结果。']){
  const result=await compare(content,f);assert.deepEqual(result.similarPairs,value.similarPairs);assert.deepEqual(result.checkedIds,value.checkedIds);
 }
});

test('wire normalization removes only complete duplicate IDs and identical mirrored positive pairs',async()=>{
 const f=fixture(),value=answer(f.block),pair=positive(f.block);value.checkedIds=[...value.checkedIds.map(id=>' '+id+' '),...value.checkedIds];
 value.similarPairs=[{...pair,leftId:' '+pair.leftId+' '},{...pair,leftId:pair.rightId,rightId:pair.leftId},pair];
 const result=await compare('结果：'+JSON.stringify(value)+'\n比较结束。',f);assert.deepEqual(result.checkedIds,f.block.representativeIds);assert.deepEqual(result.similarPairs,[pair]);
 assert.throws(()=>validateComparisonBlock(value,f.block,f.plan),'persisted validation is still exact and rejects redundant wire forms');
});

test('comparison extraction rejects conflicting objects and malformed JSON without syntax repair',async t=>{
 const f=fixture(),a=answer(f.block),b={...a,similarPairs:[positive(f.block)]},json=JSON.stringify(a);
 const cases=[['conflicting complete objects',json+'\n'+JSON.stringify(b)],['duplicate complete objects',json+'\n'+json],['truncated object',json.slice(0,-1)],['malformed tail',json+'\n{"checkedIds":'],['trailing comma',json.replace(/}$/,',}')],['single quotes',json.replaceAll('"',"'")],['array wrapper',JSON.stringify([a])],['wrong root',JSON.stringify({answer:a})],['mismatched delimiters','{"checkedIds": [}']];
 for(const[name,content]of cases)await t.test(name,()=>assert.rejects(compare(content,f),invalid));
});

test('comparison extraction never harvests an object inside a complete or truncated root array',async t=>{
 const f=fixture(),value=answer(f.block),json=JSON.stringify(value);
 const cases=[
  ['leading scalar',JSON.stringify([0,value])],['trailing number',JSON.stringify([value,0])],['trailing boolean',JSON.stringify([value,false])],['nested array',JSON.stringify([[0,value]])],
  ['prose wrapped array','比较结果：\n'+JSON.stringify([0,value])+'\n结束。'],['markdown wrapped array','## 结果\n```json\n'+JSON.stringify([value,0])+'\n```'],['inline markdown array','[结果](#local) '+JSON.stringify([value,false])+' 已完成。'],
  ['missing array close','[0,'+json],['unfinished array tail','['+json+','],['malformed array comma','['+json+',]'],['prose truncated array','说明：\n[0,'+json],['markdown truncated array','```json\n['+json+',\n```'],
 ];
 for(const[name,content]of cases)await t.test(name,()=>assert.rejects(compare(content,f),invalid));
});

test('ordinary non-JSON markdown labels and brackets may surround the one complete comparison object',async()=>{
 const f=fixture(),value=answer(f.block),content='## [说明](#local)\n- [x] 已完成比较\n```json\n'+JSON.stringify(value)+'\n```\n[结束]';
 const result=await compare(content,f);assert.deepEqual(result.checkedIds,value.checkedIds);assert.deepEqual(result.similarPairs,[]);
});

test('comparison JSON cannot hide conflicting duplicate keys behind last-value parsing',async t=>{
 const f=fixture(),value=answer(f.block),json=JSON.stringify(value),pair=positive(f.block);
 const cases=[['duplicate coverage key',json.replace('"checkedIds":','"checkedIds":[],"checkedIds":')],['escaped equivalent coverage key',json.replace('"checkedIds":','"\\u0063heckedIds":[],"checkedIds":')],['duplicate pair reason',JSON.stringify({...value,similarPairs:[pair]}).replace('"reason":','"reason":"", "reason":')]];
 for(const[name,content]of cases)await t.test(name,()=>assert.rejects(compare(content,f),invalid));
});

test('wire normalization retains complete coverage and every pair grounding and reason guard',async t=>{
 const f=fixture(),pair=positive(f.block),out=f.plan.representatives.find(rep=>rep.agent==='合成客服A'&&!f.block.representativeIds.includes(rep.id)).id,other=f.plan.representatives.find(rep=>rep.agent==='合成客服B').id;
 const changes=[
  ['missing IDs with duplicates',value=>value.checkedIds=[value.checkedIds[0],value.checkedIds[0]]],
  ['unknown checked ID',value=>value.checkedIds[0]='RAW_UNKNOWN_MODEL_ID_PRIVATE'],
  ['nontext checked ID',value=>value.checkedIds[0]=1],
  ['missing reason',value=>{value.similarPairs=[{leftId:pair.leftId,rightId:pair.rightId}];}],
  ['blank reason',value=>value.similarPairs=[{...pair,reason:' '}]],
  ['oversize reason',value=>value.similarPairs=[{...pair,reason:'x'.repeat(2001)}]],
  ['self pair',value=>value.similarPairs=[{...pair,rightId:pair.leftId}]],
  ['unknown pair ID',value=>value.similarPairs=[{...pair,rightId:'RAW_UNKNOWN_MODEL_ID_PRIVATE'}]],
  ['out of block pair',value=>value.similarPairs=[{...pair,rightId:out}]],
  ['cross administrator pair',value=>value.similarPairs=[{...pair,rightId:other}]],
  ['conflicting redundant reason',value=>value.similarPairs=[pair,{...pair,leftId:pair.rightId,rightId:pair.leftId,reason:'不同的理由'}]],
 ];
 for(const[name,change]of changes)await t.test(name,async()=>{const value=answer(f.block);change(value);await assert.rejects(compare(JSON.stringify(value),f),error=>invalid(error)&&!error.message.includes('RAW_UNKNOWN_MODEL_ID_PRIVATE'));});
 const cross=f.plan.blocks.find(block=>block.kind==='cross'),value=answer(cross);value.similarPairs=[{leftId:cross.leftIds[0],rightId:cross.leftIds[1],reason:'同侧不属于交叉比较'}];
 await assert.rejects(compare(JSON.stringify(value),{plan:f.plan,block:cross}),invalid);
});

test('invalid comparisons expose bounded safe machine diagnostics and expected missing IDs while retaining bounded raw trace',async()=>{
 const f=fixture(),value=answer(f.block);value.checkedIds[0]='RAW_UNKNOWN_MODEL_ID_PRIVATE';const content=JSON.stringify(value)+'\n'+'私有业务解释'.repeat(5000);
 await assert.rejects(compare(content,f),error=>{
  assert.equal(error.code,'INVALID_OUTPUT');assert.doesNotMatch(error.message,/RAW_UNKNOWN|私有业务/);
  const trace=error.traceOutput;assert.ok(trace,'safe comparison diagnostics are attached');assert.equal(trace.kind,'ecommerceComparison');assert.equal(trace.content.length,20000);assert.equal(trace.contentTruncated,true);assert.equal(trace.contentLength,content.length);
  assert.ok(trace.diagnostic.codes.includes('missing_checked_ids'));assert.ok(trace.diagnostic.codes.includes('unknown_checked_ids'));assert.equal(trace.diagnostic.counts.missingCheckedIds,1);assert.equal(trace.diagnostic.counts.unknownCheckedIds,1);
  assert.deepEqual(trace.diagnostic.missingRepresentativeIds,[f.block.representativeIds[0]]);assert.doesNotMatch(JSON.stringify(trace.diagnostic),/RAW_UNKNOWN|私有业务/);return true;
 });
});

test('comparison extraction and normalization have fixed depth, candidate and redundant entry bounds',async t=>{
 const f=fixture(),value=answer(f.block),json=JSON.stringify(value);
 const cases=[['too many candidates',Array(18).fill('{}').join('\n')+'\n'+json],['deep nesting','{"x":'+'['.repeat(70)+'0'+']'.repeat(70)+'}'],['excess redundant IDs',JSON.stringify({...value,checkedIds:Array(10000).fill(value.checkedIds[0])})],['excess redundant pairs',JSON.stringify({...value,similarPairs:Array(10000).fill(positive(f.block))})]];
 for(const[name,content]of cases)await t.test(name,()=>assert.rejects(compare(content,f),invalid));
});

test('retry feedback admits only fixed diagnostic codes, bounded counts and missing IDs from the frozen block',async()=>{
 const f=fixture();let payload;
 const client=createArkClient({fetchImpl:async(_url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer(f.block))}}]}));}});
 await client.compareEcommerceReplies({config,...f,retryFeedback:{codes:['missing_checked_ids','PRIVATE_UNKNOWN_CODE'],counts:{missingCheckedIds:1,receivedPairs:-1,unknownCheckedIds:Infinity,expectedCheckedIds:1000001,privateText:'PRIVATE_TEXT'},missingRepresentativeIds:[f.block.representativeIds[0],'PRIVATE_UNKNOWN_ID'],content:'PRIVATE_PRIOR_BUSINESS_OUTPUT'}});
 const input=JSON.parse(payload.messages[1].content);assert.deepEqual(input.validationFeedback,{codes:['missing_checked_ids'],counts:{missingCheckedIds:1},missingRepresentativeIds:[f.block.representativeIds[0]]});assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_/);assert.deepEqual(input.representatives.map(rep=>rep.id),f.block.representativeIds);
});
