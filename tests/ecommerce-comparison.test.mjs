import test from 'node:test';
import assert from 'node:assert/strict';
import {EC_HEADERS} from '../public/ecommerce-schema.mjs';

const api=()=>import('../server/ecommerce-comparison.mjs');
function row(id,reply=`回复${id}`,agent='客服A',physicalRow=id+3){
  const raw=Array(22).fill('');raw[8]=`评论${id}`;raw[9]=reply;raw[11]=agent;raw[15]='人工参考不可进入比较';
  return{id:`S${id}`,ecommerce:{schemaVersion:1,sheet:'Sheet4',row:physicalRow,fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('标准'),raw,thresholdHours:24}};
}
const allPairs=(block)=>block.kind==='within'?block.leftIds.flatMap((id,i)=>block.leftIds.slice(i+1).map(other=>[id,other])):block.leftIds.flatMap(id=>block.rightIds.map(other=>[id,other]));
const answer=(block,predicate=()=>false)=>({checkedIds:[...block.representativeIds],similarPairs:allPairs(block).filter(([a,b])=>predicate(a,b)).map(([leftId,rightId])=>({leftId,rightId,reason:'实质回复内容一致'}))});

test('comparison planner covers every same-agent pair across workload blocks, without human reference data',async()=>{
  const {planEcommerceComparisons}=await api();
  const sessions=Array.from({length:45},(_,i)=>row(i,`第${i}条独立回复`));sessions.push(row(90,'另一个客服回复','客服B'));
  const plan=planEcommerceComparisons(sessions,{maxRecords:6,maxWorkBytes:2000});
  const seen=new Set();
  for(const block of plan.blocks){assert.ok(block.representativeIds.length<=6);for(const [a,b] of allPairs(block)){const key=[a,b].sort().join('|');assert.ok(!seen.has(key),'每一对只安排一次');seen.add(key);}}
  assert.equal(seen.size,45*44/2);assert.equal(plan.totalPairs,seen.size);
  assert.doesNotMatch(JSON.stringify(plan),/人工参考不可进入比较|标准/);
  const modified=structuredClone(sessions);modified[0].ecommerce.raw[15]='改变人工标签';
  assert.equal(planEcommerceComparisons(modified,{maxRecords:6,maxWorkBytes:2000}).fingerprint,plan.fingerprint);
});

test('exact grouping uses distinct physical source rows and cannot combine administrators',async()=>{
  const {planEcommerceComparisons}=await api();
  const plan=planEcommerceComparisons([row(0,' 同一句 '),row(1,'同一句'),row(2,'同一句'),row(3,'同一句','客服B')]);
  assert.deepEqual(plan.exactGroups.map(g=>g.sessionIds),[['S0','S1','S2']]);
  assert.equal(plan.totalPairs,0,'同一正文只保留一个代表，不跨客服比较');
  assert.throws(()=>planEcommerceComparisons([row(0),row(1,'其他','客服A',3)]),/来源行|物理行/);
});

test('comparison validation rejects incomplete coverage, unknown or repeated pairs and cross-block injection',async()=>{
  const {planEcommerceComparisons,validateComparisonBlock}=await api();
  const plan=planEcommerceComparisons([row(0),row(1),row(2),row(3)],{maxRecords:2,maxWorkBytes:2000});
  const block=plan.blocks.find(b=>b.kind==='cross');
  assert.throws(()=>validateComparisonBlock({...answer(block),checkedIds:[]},block,plan),/覆盖/);
  assert.throws(()=>validateComparisonBlock({...answer(block),similarPairs:[{leftId:block.leftIds[0],rightId:'伪造',reason:'相似'}]},block,plan),/比较|配对/);
  const pair=answer(block,()=>true).similarPairs[0];
  assert.throws(()=>validateComparisonBlock({...answer(block),similarPairs:[pair,{...pair,leftId:pair.rightId,rightId:pair.leftId}]},block,plan),/重复|数量/);
  assert.equal(validateComparisonBlock(answer(block,()=>true),block,plan).similarPairs.length,1);
});

test('cross-block three-way similarity becomes evidence, while a chain does not',async()=>{
  const {planEcommerceComparisons,mergeComparisonGroups}=await api();
  const plan=planEcommerceComparisons([row(0),row(1),row(2)],{maxRecords:2,maxWorkBytes:2000});
  const finished=plan.blocks.map(block=>({id:block.id,status:'completed',result:answer(block,()=>true)}));
  const merged=mergeComparisonGroups(plan,finished);
  assert.equal(merged.complete,true);assert.deepEqual(new Set(merged.groups.flatMap(g=>g.sessionIds)),new Set(['S0','S1','S2']));
  const [a,b,c]=plan.representatives.map(r=>r.id),chain=new Set([[a,b].sort().join('|'),[b,c].sort().join('|')]);
  const chained=plan.blocks.map(block=>({id:block.id,status:'completed',result:answer(block,(x,y)=>chain.has([x,y].sort().join('|')))}));
  assert.equal(mergeComparisonGroups(plan,chained).groups.length,0);
  assert.equal(mergeComparisonGroups(plan,finished.slice(1)).complete,false);
});

test('two exact copies plus a similar representative form a valid weighted triple',async()=>{
  const {planEcommerceComparisons,mergeComparisonGroups}=await api();
  const plan=planEcommerceComparisons([row(0,'一样'),row(1,'一样'),row(2,'高度相似')]);
  const completed=plan.blocks.map(block=>({id:block.id,status:'completed',result:answer(block,()=>true)}));
  assert.deepEqual(new Set(mergeComparisonGroups(plan,completed).groups.flatMap(g=>g.sessionIds)),new Set(['S0','S1','S2']));
  assert.equal(mergeComparisonGroups(plan,[]).complete,false);
});

test('input and comparison workloads are bounded, with no silent reply truncation',async()=>{
  const {planEcommerceComparisons}=await api();
  const plan=planEcommerceComparisons([row(0,'很'.repeat(1000)),row(1,'长'.repeat(1000))],{maxRecords:2,maxWorkBytes:500});
  assert.equal(plan.blocks[0].oversized,true);assert.equal(plan.representatives[0].reply.length,1000);
  assert.throws(()=>planEcommerceComparisons([row(0)],{maxRecords:1}),/设置|范围/);
  assert.throws(()=>planEcommerceComparisons(Array.from({length:501},(_,i)=>row(i))),/范围|500/);
});

test('same fingerprint has stable block identities even if source iteration order changes',async()=>{
  const {planEcommerceComparisons}=await api();
  const sessions=Array.from({length:8},(_,i)=>row(i));
  const a=planEcommerceComparisons(sessions,{maxRecords:4}),b=planEcommerceComparisons([...sessions].reverse(),{maxRecords:4});
  assert.equal(a.fingerprint,b.fingerprint);
  assert.deepEqual(a.blocks,b.blocks,'复用缓存指纹时比较块必须一致');
});
