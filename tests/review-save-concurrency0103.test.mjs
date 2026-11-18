import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceClient} from '../public/workspace-client.mjs';
import {createInitialState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';

function harness(change, {alwaysConflict=false,loseRetryResponse=false}={}) {
  const initial={initialized:true,revision:1,state:createInitialState(),catalog:createCatalog(),token:'synthetic-token'};
  let server=structuredClone(initial);
  const writes=[];
  const response=(status,value)=>({ok:status===200,status,json:async()=>structuredClone(value)});
  const client=createWorkspaceClient({fetchImpl:async(url,options={})=>{
    if(options.method!=='PUT')return response(200,server);
    const body=JSON.parse(options.body);
    writes.push(body);
    if(writes.length===1){server.revision++;change(server);}
    if(alwaysConflict||body.baseRevision!==server.revision)return response(409,{error:'Synthetic revision conflict'});
    server={...server,revision:server.revision+1,state:body.state,catalog:body.catalog};
    if(loseRetryResponse)throw new Error('Synthetic lost acknowledgement');
    return response(200,server);
  }});
  const id=initial.state.sessions[0].id;
  const save=({state,catalog})=>{
    state.sessions.find(session=>session.id===id).review.notes='Saved review';
    state.activity.push({action:'review saved'});
    return {state,catalog};
  };
  return {client,id,save,writes,get server(){return server;}};
}

test('review save retries one rejected revision when another record advances',async()=>{
  const h=harness(doc=>{doc.state.sessions[1].aiResults[0].reason='Background AI result';});
  await h.client.load();
  const result=await h.client.transact(h.save,{reviewSessionId:h.id});
  assert.equal(result.state.sessions[0].review.notes,'Saved review');
  assert.equal(result.state.sessions[1].aiResults[0].reason,'Background AI result');
  assert.deepEqual(h.writes.map(write=>write.baseRevision),[1,2]);
  assert.equal(result.state.activity.length,1);
  assert.equal(h.client.conflicted,false);
});

for(const [label,change] of [
  ['same-record human edit',doc=>{doc.state.sessions[0].review.notes='Other reviewer';}],
  ['same-record AI update',doc=>{doc.state.sessions[0].aiResults[0].reason='Updated AI result';}],
  ['frozen task basis update',doc=>{doc.state.tasks.find(task=>task.id===doc.state.sessions[0].taskId).basisSnapshot={rules:[],policies:[]};}],
  ['task review policy update',doc=>{doc.state.tasks.find(task=>task.id===doc.state.sessions[0].taskId).reviewPolicy={enabled:false};}],
  ['catalog update',doc=>{doc.catalog.rules[0].name='Another catalog version';}],
  ['record removal',doc=>{doc.state.sessions.shift();}],
  ['restored workspace epoch',doc=>{doc.token='new-epoch';}],
  ['task archive or void transition',doc=>{doc.state.tasks.find(task=>task.id===doc.state.sessions[0].taskId).lifecycle={archived:true};}],
  ['frozen scene configuration',doc=>{doc.state.tasks.find(task=>task.id===doc.state.sessions[0].taskId).scenarioSnapshot={id:'changed-scene'};}],
])test(`review save retains conflict protection for ${label}`,async()=>{
  const h=harness(change);
  await h.client.load();
  await assert.rejects(h.client.transact(h.save,{reviewSessionId:h.id}),/conflict/);
  assert.equal(h.writes.length,1);
  assert.equal(h.client.conflicted,true);
  assert.equal(h.client.snapshot.state.sessions[0].review.notes,'');
});

test('review conflict retry is bounded and does not replay a persistent conflict',async()=>{
  const h=harness(()=>{},{alwaysConflict:true});
  await h.client.load();
  await assert.rejects(h.client.transact(h.save,{reviewSessionId:h.id}),/conflict/);
  assert.equal(h.writes.length,2);
  assert.equal(h.client.conflicted,true);
});

test('lost acknowledgement after a safe review retry remains pending',async()=>{
  const h=harness(()=>{},{loseRetryResponse:true});
  await h.client.load();
  await assert.rejects(h.client.transact(h.save,{reviewSessionId:h.id}),/未确认/);
  assert.equal(h.client.hasPending,true);
  assert.equal(h.writes.length,2);
  assert.equal(h.server.state.activity.length,1);
});

test('batch review replays on unrelated progress but refuses any changed target',async()=>{
 for(const targetChanged of [false,true]){
  const h=harness(doc=>{doc.state.sessions[targetChanged?1:2].review.notes='concurrent change';});
  const initial=await h.client.load(),ids=initial.state.sessions.slice(0,2).map(s=>s.id);
  const save=({state,catalog})=>{for(const row of state.sessions.filter(s=>ids.includes(s.id)))row.review.notes='batch saved';return{state,catalog};};
  if(targetChanged){await assert.rejects(h.client.transact(save,{reviewSessionIds:ids}),/conflict/);assert.equal(h.writes.length,1);}
  else {const result=await h.client.transact(save,{reviewSessionIds:ids});assert.equal(h.writes.length,2);assert.ok(result.state.sessions.slice(0,2).every(s=>s.review.notes==='batch saved'));assert.equal(result.state.sessions[2].review.notes,'concurrent change');}
 }
});
