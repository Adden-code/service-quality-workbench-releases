import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {EC_RULE_IDS,EC_HEADERS,ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
const {createArkClient}=await import(process.env.EC_ARK_MODULE||'../server/ark-client.mjs');
const config={apiKey:'fictional-test-not-a-real-key',model:'glm-5.3-flash'};
const basis=createBasisSnapshot(ensureEcommerceCatalog(createCatalog()),{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS});
const sessions=[1,2,3].map(n=>{
  const raw=Array(22).fill('');raw[8]='虚构商品好看';raw[9]='感谢您对虚构商品的支持';raw[11]='虚构小王';raw[15]='PRIVATE_HUMAN_REFERENCE';raw[21]='PRIVATE_HUMAN_EXPLANATION';
  const original={id:'ec'+n,agent:'虚构小王',turns:[{id:1,role:'客户',text:raw[8]},{id:2,role:'客服',text:raw[9]}],contextFields:[],ecommerce:{schemaVersion:1,sheet:'Sheet4',row:n+2,fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('标准'),raw,thresholdHours:24},review:{notes:'PRIVATE_CURRENT_REVIEW'}};return{...original,externalId:ecommerceRecordId(original.ecommerce),...ecommerceSourceProjection(original.ecommerce)};
});
const valid=()=>({records:sessions.map(s=>({sessionId:s.id,results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'虚构语义检查完成',evidence:[1,2],referenceIds:[]}))})),duplicateGroups:[{sessionIds:sessions.map(s=>s.id),reason:'三个回复实质内容一致'}],checkedSessionIds:sessions.map(s=>s.id)});
const response=body=>new Response(JSON.stringify({model:'fictional-provider-model',usage:{total_tokens:72},choices:[{finish_reason:'stop',message:{content:JSON.stringify(body)}}]}),{status:200,headers:{'content-type':'application/json'}});
test('EC batch API sends complete projected scope without original human labels or current drafts',async()=>{
  let payload;
  const client=createArkClient({fetchImpl:async(url,opts)=>{payload=opts.body;return response(valid());}});
  const result=await client.inspectEcommerce({config,sessions,basis});
  for(const forbidden of ['PRIVATE_HUMAN_REFERENCE','PRIVATE_HUMAN_EXPLANATION','PRIVATE_CURRENT_REVIEW',config.apiKey])assert.ok(!payload.includes(forbidden));
  for(const s of sessions)assert.ok(payload.includes(s.id));
  assert.equal(result.records.length,3);assert.equal(result.duplicateGroups.length,1);
});
test('EC batch API refuses missing coverage, phantom peers and fewer-than-three groups',async()=>{
  const invalids=[b=>{b.checkedSessionIds.pop();},b=>{b.records.pop();},b=>{b.duplicateGroups[0].sessionIds[2]='phantom';},b=>{b.duplicateGroups[0].sessionIds.pop();},b=>{b.records[0].results[0].evidence=[999];}];
  for(const mutate of invalids){const body=valid();mutate(body);const client=createArkClient({fetchImpl:async()=>response(body)});await assert.rejects(()=>client.inspectEcommerce({config,sessions,basis}),/格式|证据|不完整/);}
});
test('EC batch rejects reference laundering into model fields before any network request',async()=>{
  let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return response(valid());}});
  for(const key of ['turns','topic','missingNote','contextFields']){
    const forged=structuredClone(sessions);
    if(key==='turns')forged[0].turns[1].text=forged[0].ecommerce.raw[21];
    else if(key==='contextFields')forged[0].contextFields[0].value=forged[0].ecommerce.raw[21];
    else forged[0][key]=forged[0].ecommerce.raw[21];
    await assert.rejects(()=>client.inspectEcommerce({config,sessions:forged,basis}),/来源|发送/);
  }
  assert.equal(calls,0);
});
