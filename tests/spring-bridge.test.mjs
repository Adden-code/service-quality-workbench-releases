import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../server/spring-ai-bridge.mjs',import.meta.url);
test('Spring bridge forwards only fixed model endpoint to loopback worker with separate ephemeral token',async()=>{
 assert.ok(existsSync(url),'缺少Spring AI桥');const{createSpringAiFetch}=await import(url);let sent;
 const f=createSpringAiFetch({bridgeToken:'x'.repeat(64),fetchImpl:async(...args)=>{sent=args;return new Response('{}');}});
 const signal=new AbortController().signal;await f('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',{method:'POST',headers:{Authorization:'Bearer fictional-secret','Content-Type':'application/json'},body:'{"model":"glm-5.3-flash"}',signal});
 assert.equal(sent[0],'http://127.0.0.1:4192/internal/chat/completions');assert.equal(sent[1].headers['X-Bridge-Token'],'x'.repeat(64));assert.equal(sent[1].signal,signal);assert.equal(sent[1].redirect,'error');
 await assert.rejects(f('https://example.com/anything',{}));
 assert.throws(()=>createSpringAiFetch({bridgeToken:'short'}));
 assert.doesNotThrow(()=>createSpringAiFetch({bridgeToken:'a.~_-'.repeat(8)}));
});

test('Spring bridge uses an explicitly selected isolated loopback worker port',async()=>{
 const {createSpringAiFetch}=await import(url);let target;
 const bridge=createSpringAiFetch({bridgeToken:'x'.repeat(64),workerPort:45672,fetchImpl:async address=>{target=address;return new Response('{}');}});
 await bridge('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions',{method:'POST',headers:{Authorization:'Bearer fictional-secret'},body:'{}'});
 assert.equal(target,'http://127.0.0.1:45672/internal/chat/completions');
});

test('Spring bridge rejects unsafe worker ports without changing the fixed upstream',async()=>{
 const {createSpringAiFetch}=await import(url);
 for(const workerPort of [0,80,65536,'4192/path','04192','http://example.com',null,true,NaN]){
  assert.throws(()=>createSpringAiFetch({bridgeToken:'x'.repeat(64),workerPort}),/端口/);
 }
});

test('Spring bridge forwards per-request provider metadata and never forwards stale authorization in none mode',async()=>{
 const {createSpringAiFetch}=await import(url);let sent;
 const bridge=createSpringAiFetch({bridgeToken:'x'.repeat(64),fetchImpl:async(...args)=>{sent=args;return new Response('{}');}});
 await bridge('http://maas.internal:8000/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer stale-fictional-key'},body:'{"model":"智谱-5.1","reasoning_effort":"low","max_tokens":65536}',providerConfig:{baseUrl:'http://maas.internal:8000/v1',model:'智谱-5.1',authMode:'none',timeoutMs:290000,reasoningEffort:'low',maxTokens:65536}});
 assert.equal(sent[0],'http://127.0.0.1:4192/internal/chat/completions');assert.equal(sent[1].headers['X-Provider-Base-Url'],'http://maas.internal:8000/v1');assert.equal(sent[1].headers['X-Provider-Auth-Mode'],'none');assert.equal(sent[1].headers['X-Provider-Timeout-Ms'],'290000');assert.equal(new Headers(sent[1].headers).get('Authorization'),null);assert.ok(!JSON.stringify(sent).includes('stale-fictional-key'));
 await assert.rejects(bridge('http://other.internal/v1/chat/completions',{method:'POST',providerConfig:{baseUrl:'http://maas.internal:8000/v1',authMode:'none'}}));
});
