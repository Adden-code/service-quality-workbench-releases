import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../public/catalog.mjs';
import {createInitialState} from '../public/domain.mjs';

const module = await import('../public/workspace-client.mjs').catch(()=>({}));
const clone = value=>structuredClone(value);
function factory(options){assert.equal(typeof module.createWorkspaceClient,'function','需要统一异步工作区客户端');return module.createWorkspaceClient(options);}
const response=(status,value)=>({ok:status>=200&&status<300,status,json:async()=>clone(value)});
function harness({initialized=true,storage}={}){
  let document={initialized,revision:initialized?1:0,state:initialized?createInitialState():null,catalog:initialized?createCatalog():null,token:'test-token'};
  const writes=[],requests=[],seen=new Map();let loseNext=false,failNext=false,gate=null;
  const fetchImpl=async(url,options={})=>{
    requests.push({url,...options});
    if(url==='/api/sources')return response(201,{sha256:'a'.repeat(64),name:'新输入.json',size:options.body.byteLength});
    if(!options.method||options.method==='GET')return response(200,document);
    const body=JSON.parse(options.body);writes.push(clone(body));
    if(gate){const pending=gate;gate=null;await pending;}
    if(failNext){failNext=false;return response(500,{error:'磁盘未保存，原记录保留'});}
    if(seen.has(body.mutationId))return response(200,{...document,replayed:true});
    if(body.baseRevision!==document.revision)return response(409,{error:'工作区已由另一页面更新'});
    seen.set(body.mutationId,body);document={initialized:true,revision:document.revision+1,state:body.state,catalog:body.catalog,token:'test-token'};
    if(loseNext){loseNext=false;throw new TypeError('connection lost after commit');}
    return response(200,document);
  };
  return {fetchImpl,writes,requests,storage,
    get document(){return clone(document);},
    loseResponse(){loseNext=true;},failWrite(){failNext=true;},
    block(promise){gate=promise;},advance(){document.revision++;},
  };
}
const initial=()=>({state:{...createInitialState(),businessMigrationVersion:1},catalog:createCatalog()});

test('model API requests use server token without adding credentials to workspace state',async()=>{
  const h=harness(),requests=[],config={model:'glm-5.3-flash',configured:true,keyConfigured:true};
  const client=factory({fetchImpl:async(url,options={})=>{if(url.startsWith('/api/model/')){requests.push({url,...options});return response(200,url.endsWith('/test')?{text:'连接成功'}:config);}return h.fetchImpl(url,options);}});
  await client.load();assert.deepEqual(await client.readModelConfig(),config);await client.saveModelConfig({apiKey:'fixture-private-key',model:'glm-5.3-flash'});await client.testModel();
  assert.equal(requests[1].headers['X-Workspace-Token'],'test-token');assert.equal(h.writes.length,0);assert.doesNotMatch(JSON.stringify(client.snapshot),/fixture-private-key/);
});

test('model testing and rule preparation use the saved model timeout with browser overhead',async()=>{
 const h=harness(),limits=[],config={baseUrl:'http://maas.internal/v1',model:'内网模型',authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:32768,configured:true,keyConfigured:false};
 const client=factory({setTimer:(operation,ms)=>{limits.push(ms);return setTimeout(operation,10000);},fetchImpl:async(url,options)=>{
  if(url==='/api/model/config')return response(200,config);
  if(url==='/api/model/test'||url==='/api/rules/prepare')return response(200,{ok:true});
  return h.fetchImpl(url,options);
 }});
 await client.load();await client.readModelConfig();limits.length=0;
 await client.testModel();await client.prepareRules({text:'本地测试规则'});
 assert.deepEqual(limits,[300000,300000]);
});
test('background refresh cannot advance the edit baseline if a form opened while the read was in flight',async()=>{
  const h=harness(),client=factory({fetchImpl:h.fetchImpl});await client.load();h.advance();
  assert.equal(await client.refresh(()=>false),null);assert.equal(client.snapshot.revision,1);
  await client.refresh();assert.equal(client.snapshot.revision,2);
});

test('pause and resume queue actions adopt the server workspace and use the workspace token',async()=>{
  const h=harness(),actions=[];const client=factory({fetchImpl:async(url,options)=>{
    if(/\/api\/tasks\/.+\/ai\/(pause|resume)$/.test(url)){actions.push({url,...options});return response(200,{...h.document,revision:actions.length+1});}
    return h.fetchImpl(url,options);
  }});
  await client.load();assert.equal(typeof client.pauseAI,'function');assert.equal(typeof client.resumeAI,'function');
  await client.pauseAI('TASK-排队');assert.equal(client.snapshot.revision,2);await client.resumeAI('TASK-排队');assert.equal(client.snapshot.revision,3);
  assert.deepEqual(actions.map(action=>action.url),['/api/tasks/TASK-%E6%8E%92%E9%98%9F/ai/pause','/api/tasks/TASK-%E6%8E%92%E9%98%9F/ai/resume']);
  assert.ok(actions.every(action=>action.method==='POST'&&action.headers['X-Workspace-Token']==='test-token'&&action.body==='{}'));
});

test('AI start reconciles an uncertain acknowledgement by its run ID rather than silently charging again',async()=>{
  const h=harness();let starts=0;const client=factory({fetchImpl:async(url,options={})=>{
    if(url.startsWith('/api/ai/tasks/')){starts++;const payload=JSON.parse(options.body);h.setRun(payload.runId);throw new TypeError('response lost');}
    return h.fetchImpl(url,options);
  }});
  h.setRun=id=>{const snapshot=h.document;snapshot.state.tasks[0].aiRun={id};h.fetchImpl=async()=>response(200,{...snapshot,revision:2});};
  await client.load();const doc=await client.startAI('TASK-NEW','run-new');assert.equal(starts,1);assert.equal(doc.revision,2);assert.equal(client.snapshot.state.tasks[0].aiRun.id,'run-new');
});

test('first initialization reads two legacy keys once and preserves their bytes',async()=>{
  const seed=initial(),entries=new Map([['mss-presales-qa-demo:v1',JSON.stringify(seed.state)],['mss-presales-qa-catalog:v1',JSON.stringify(seed.catalog)]]);
  const original=clone([...entries]);let reads=0;
  const storage={getItem:key=>{reads++;return entries.get(key)??null;},setItem(){throw Error('旧记录不可改写');}};
  const h=harness({initialized:false}),client=factory({fetchImpl:h.fetchImpl,storage});
  await client.load();assert.equal(reads,2);assert.equal(h.writes.length,1);
  assert.deepEqual(client.snapshot.state,seed.state);assert.equal(client.snapshot.revision,1);
  assert.deepEqual([...entries],original);
});

test('existing server data wins without reading or merging a browser legacy copy',async()=>{
  const h=harness(),client=factory({fetchImpl:h.fetchImpl,storage:{getItem(){throw Error('不能读取旧浏览器');}}});
  await client.load();assert.equal(client.snapshot.revision,1);assert.equal(h.writes.length,0);
});

test('corrupt legacy records block first initialization without any write',async()=>{
  const h=harness({initialized:false}),client=factory({fetchImpl:h.fetchImpl,storage:{getItem:()=>'{broken'}});
  await assert.rejects(client.load(),/旧记录|迁移|格式/);assert.equal(h.writes.length,0);
});

test('rapid mutations serialize and derive each change from latest acknowledged state',async()=>{
  const h=harness(),client=factory({fetchImpl:h.fetchImpl});await client.load();
  let release;h.block(new Promise(resolve=>{release=resolve;}));
  const append=label=>client.transact(({state,catalog})=>{state.activity.push({action:label});return {state,catalog};});
  const first=append('first'),second=append('second');await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(h.writes.length,1);assert.equal(client.snapshot.state.activity.length,0);release();
  await Promise.all([first,second]);assert.deepEqual(client.snapshot.state.activity.map(x=>x.action),['first','second']);
  assert.deepEqual(h.writes.map(x=>x.baseRevision),[1,2]);
  assert.equal(h.requests.find(x=>x.method==='PUT').headers['X-Workspace-Token'],'test-token');
});

test('a rejected save leaves acknowledged state unchanged and does not claim success',async()=>{
  const h=harness(),client=factory({fetchImpl:h.fetchImpl});await client.load();const before=client.snapshot;
  h.failWrite();await assert.rejects(client.transact(({state,catalog})=>{state.activity.push({action:'unsaved'});return {state,catalog};}),/磁盘未保存/);
  assert.deepEqual(client.snapshot,before);
});

test('unknown network outcome blocks new writes and retries the identical mutation id',async()=>{
  const h=harness(),client=factory({fetchImpl:h.fetchImpl});await client.load();h.loseResponse();
  await assert.rejects(client.transact(({state,catalog})=>{state.activity.push({action:'once'});return {state,catalog};}),/未确认|重试/);
  assert.equal(client.hasPending,true);assert.equal(client.snapshot.state.activity.length,0);
  await assert.rejects(client.transact(initial),/重试|未确认/);
  await client.retryPending();assert.equal(client.hasPending,false);assert.equal(client.snapshot.state.activity.length,1);
  assert.equal(h.writes[0].mutationId,h.writes[1].mutationId);assert.deepEqual(h.writes[0],h.writes[1]);
});

test('revision conflicts block further writes until an explicit reload',async()=>{
  const h=harness(),client=factory({fetchImpl:h.fetchImpl});await client.load();h.advance();
  await assert.rejects(client.transact(initial),/另一页面|冲突/);assert.equal(client.conflicted,true);
  await assert.rejects(client.transact(initial),/重新加载|冲突/);assert.equal(h.writes.length,1);
  await client.reload();assert.equal(client.conflicted,false);assert.equal(client.snapshot.revision,2);
});

test('an unreadable successful response retains the same pending operation for safe retry',async()=>{
  const h=harness();let breakResponse=true;
  const client=factory({fetchImpl:async(url,options)=>{
    const result=await h.fetchImpl(url,options);
    if(options?.method==='PUT'&&breakResponse){breakResponse=false;return {...result,json:async()=>{throw Error('truncated response');}};}
    return result;
  }});
  await client.load();await assert.rejects(client.transact(initial),/未确认|重试/);
  assert.equal(client.hasPending,true);await client.retryPending();assert.equal(client.snapshot.revision,2);
  assert.equal(h.writes[0].mutationId,h.writes[1].mutationId);
});

test('original source upload sends exact bytes and a safely encoded filename',async()=>{
  const h=harness(),client=factory({fetchImpl:h.fetchImpl});await client.load();const data=new TextEncoder().encode('{"会话":"全新原文"}');
  const file={name:'新输入.json',size:data.length,arrayBuffer:async()=>data.buffer};
  const source=await client.uploadSource(file);const request=h.requests.at(-1);
  assert.equal(source.sha256,'a'.repeat(64));assert.equal(request.headers['X-File-Name'],encodeURIComponent(file.name));
  assert.deepEqual(new Uint8Array(request.body),data);assert.equal(request.headers['Content-Type'],'application/octet-stream');
});

test('starting AI sends explicitly frozen execution settings with the idempotent run id',async()=>{
  const h=harness(),calls=[];const client=factory({fetchImpl:async(url,options)=>{
    if(url.startsWith('/api/ai/tasks/')){calls.push({url,...options});return response(200,{...h.document,revision:2});}
    return h.fetchImpl(url,options);
  }});
  await client.load();await client.startAI('task-A','run-A',{concurrency:2,batchSize:10,maxWorkBytes:64000});
  assert.deepEqual(JSON.parse(calls[0].body),{runId:'run-A',settings:{concurrency:2,batchSize:10,maxWorkBytes:64000}});
});
