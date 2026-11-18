import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {createArkClient} from '../../../../server/ark-client.mjs';
import {createSpringAiFetch} from '../../../../server/spring-ai-bridge.mjs';

// Only loopback fictional data is used. This exercises the distributable JAR,
// Node transport, internal bridge authentication and real Spring AI HTTP client.
test('Node to distributable Java worker to local MaaS preserves the configurable contract',{timeout:45000},async t=>{
  const project=fileURLToPath(new URL('../../../../',import.meta.url));
  const temp=path.resolve(project,'../outputs/maas-backend-test-temp');await mkdir(temp,{recursive:true});
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const token='fictional-live-bridge-token-at-least-32-characters';
  const java=path.resolve(project,'../.tools/java-demo/jdk-21.0.12.1+1/bin/java.exe');
  const child=spawn(java,[`-Djava.io.tmpdir=${temp}`,'-jar',path.join(project,'spring-ai-worker/target/spring-ai-worker-1.0.0.jar')],{cwd:project,windowsHide:true,env:{...process.env,WORKBENCH_BRIDGE_TOKEN:token,WORKBENCH_WORKER_PORT:String(port),TEMP:temp,TMP:temp},stdio:['ignore','pipe','pipe']});
  let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log=(log+chunk.toString()).slice(-12000);});
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}});
  const until=Date.now()+20000;let healthy=false;
  while(Date.now()<until){
    if(child.exitCode!==null)throw Error('Fictional worker failed to start: '+log);
    try{const res=await fetch(`http://127.0.0.1:${port}/internal/health`,{headers:{'X-Bridge-Token':token},signal:AbortSignal.timeout(500)});if(res.ok){healthy=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,150));
  }
  assert.equal(healthy,true,'Fictional worker did not become healthy: '+log);
  let captured,delay=0,finish='stop',status=200,sinkCalls=0;
  const provider=http.createServer(async(req,res)=>{
    if(req.url==='/sink'){sinkCalls++;res.end('unexpected redirect');return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    captured={path:req.url,headers:req.headers,body:JSON.parse(raw)};
    if(status===302){res.writeHead(302,{Location:'/sink'});res.end();return;}
    res.writeHead(status,{'Content-Type':'application/json'});res.flushHeaders();
    await new Promise(r=>setTimeout(r,delay));
    res.end(JSON.stringify({id:'fictional-live-id',model:captured.body.model,choices:[{finish_reason:finish,message:{role:'assistant',content:'OK',reasoning_content:'PRIVATE_FICTIONAL_REASONING'}}],usage:{prompt_tokens:7,completion_tokens:1,total_tokens:8}}));
  });
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{provider.closeAllConnections();provider.close(r);}));
  const config={baseUrl:`http://127.0.0.1:${provider.address().port}/maas/v1/chat/completions/`,model:'智谱𠀀-5.1',authMode:'none',apiKey:'stale-fictional-provider-key',timeoutMs:1000,reasoningEffort:'high',maxTokens:65536};
  const client=createArkClient({fetchImpl:createSpringAiFetch({bridgeToken:token,workerPort:port})});
  const answer=await client.test({config});
  assert.equal(answer.text,'连接成功');assert.equal(answer.modelId,config.model);assert.equal(answer.requestId,'fictional-live-id');
  assert.equal(captured.path,'/maas/v1/chat/completions');assert.equal(captured.headers.authorization,undefined);assert.equal(captured.headers['x-bridge-token'],undefined);
  assert.equal(captured.body.max_tokens,65536);assert.equal(captured.body.reasoning_effort,'high');assert.equal(captured.body.model,config.model);assert.ok(!JSON.stringify({captured,answer}).includes(config.apiKey));
  for(const effort of ['low','max',null]){
    await client.test({config:{...config,authMode:'bearer',apiKey:'fictional-current-provider-key',reasoningEffort:effort,maxTokens:null}});
    assert.equal(captured.headers.authorization,'Bearer fictional-current-provider-key');assert.equal(captured.body.max_tokens,2048);
    assert.equal(captured.body.reasoning_effort,effort??undefined);
  }
  finish='length';await assert.rejects(client.test({config}),error=>error.code==='OUTPUT_TRUNCATED');finish='stop';
  delay=1300;await assert.rejects(client.test({config}),error=>error.code==='TIMEOUT'&&error.status===504);delay=0;
  status=302;await assert.rejects(client.test({config:{...config,authMode:'bearer',apiKey:'fictional-current-provider-key'}}),error=>error.code==='PROVIDER_UNAVAILABLE');assert.equal(sinkCalls,0);
});
