import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSceneCapability,prepareSceneCapability,executeSceneCapabilities} from '../server/scene-capabilities.mjs';
import {defaultScenePackage,resolveSceneRuntime} from '../public/scene-configuration.mjs';
import {createArkClient} from '../server/ark-client.mjs';
const quote='البطارية لا تعمل',text='😀 Synthetic prefix. '+quote+'\r\nSynthetic tail.';
const input={capability:'ecommerceClassification',rating:5,blocks:[{id:'turn-1',text,role:'客户'}]};
const body=(start='95',end='121',extra={})=>({status:'completed',value:{polarity:'negative',vocKind:'substantive'},confidence:'0.95',reason:'Synthetic grounded classification',evidence:[{blockId:'turn-1',quote,start,end,...extra}]});
const parse=(b=body(),i=input)=>parseSceneCapability(JSON.stringify(b),i);
test('numeric-string drifting offsets repair on a unique literal quote, preserving original quote and model coordinates',()=>{
 const start=text.indexOf(quote),end=start+quote.length;
 for(const [a,b] of [['95','121'],['90','118'],['79','107'],[95,121]]){
  const r=parse(body(a,b)),e=r.evidence[0];assert.equal(r.confidence,.95);assert.equal(r.value.evaluationType,'好评负向');assert.equal(e.quote,quote);assert.equal(e.start,start);assert.equal(e.end,end);assert.equal(text.slice(e.start,e.end),quote);
  assert.deepEqual(e.locatorRepair,{version:1,method:'unique-exact',originalStart:a,originalEnd:b});
 }
 const exact=parse(body(String(start),String(end))).evidence[0];assert.deepEqual(exact.locatorRepair,{version:1,method:'numeric-string',originalStart:String(start),originalEnd:String(end)});
 assert.equal(parse(body(start,end)).evidence[0].locatorRepair,undefined);
});
test('repair never guesses among duplicates, crosses blocks, normalizes text or trusts invalid offsets',()=>{
 for(const t of [quote+' / '+quote,'aaaa']){const q=t==='aaaa'?'aa':quote;assert.throws(()=>parse(body(95,121,{quote:q}),{...input,blocks:[{id:'turn-1',text:t}]}),e=>e.validationReason==='evidence_ambiguous');}
 assert.throws(()=>parse(body(0,1,{quote:'not present'})),e=>e.validationReason==='evidence_unverified');
 assert.throws(()=>parse(body(0,1,{blockId:'missing'})),e=>e.validationReason==='evidence_unverified');
 assert.throws(()=>parse(body(0,1,{quote:'Synthetic tail.\n'})),e=>e.validationReason==='evidence_unverified');
 assert.throws(()=>parse(body(0,1,{quote:'البطاريه لا تعمل'})),e=>e.validationReason==='evidence_unverified');
 assert.throws(()=>parse(body(),{...input,blocks:[{id:'turn-1',text:'not here'},{id:'turn-2',text:quote}]}),e=>e.validationReason==='evidence_unverified');
 for(const value of ['',' ','high','0x10','NaN','Infinity','1.5',1.5,null,true,{},[],undefined,-1,'-1',9007199254740992])assert.equal(parse(body(95,121,{start:value})).evidence[0].start,text.indexOf(quote));
 assert.equal(parse(body(4,3)).evidence[0].start,text.indexOf(quote));
});
test('valid explicit duplicate location is retained; repair uses UTF16 rather than code points',()=>{
 const repeated=quote+' / '+quote,second=repeated.lastIndexOf(quote),e=parse(body(second,second+quote.length),{...input,blocks:[{id:'turn-1',text:repeated}]}).evidence[0];assert.equal(e.start,second);assert.equal(e.locatorRepair,undefined);
 const unicode='😀é\r\n'+quote;const repaired=parse(body(999,1000),{...input,blocks:[{id:'turn-1',text:unicode}]}).evidence[0];assert.equal(repaired.start,5);assert.equal(repaired.end,5+quote.length);
});
test('nested timing evidence shares repair without altering event timestamps or counting semantics',()=>{
 const b=body();b.value={firstCustomer:null,firstAgent:null,queries:[{issueId:'q1',topic:'Synthetic',start:null,end:null,evidence:b.evidence}],completeCoverage:true};const r=parse(b,{...input,capability:'timing'});
 assert.equal(r.value.queries[0].evidence[0].start,text.indexOf(quote));assert.equal(r.value.queries[0].evidence[0].quote,quote);assert.equal(r.value.queries[0].start,null);assert.equal(r.value.queries.length,1);
});
test('real adapter validates a drifting string offset in one attempt and retains correction guidance',async()=>{
 const pkg=defaultScenePackage({id:'SYNTHETIC',name:'Synthetic',engine:'ecommerce'}),c=pkg.configuration;c.executionMode='configured';c.capabilities=[{key:'ecommerceClassification',phase:'pre',dependsOn:[]}];let calls=0;
 const client=createArkClient({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify(body())+'\n```'}}]}));}});
 const result=await executeSceneCapabilities({session:{turns:[{id:1,role:'客户',text}],ecommerce:{raw:Array.from({length:22},(_,i)=>i===10?'5':'')}},snapshot:{configuration:c,runtime:resolveSceneRuntime(c,{}),taxonomy:null},client,config:{model:'synthetic',baseUrl:'http://127.0.0.1:1',authMode:'none'},retryDelayMs:0});
 assert.equal(calls,1);assert.equal(result.outputs.ecommerceClassification.status,'completed');assert.equal(result.outputs.ecommerceClassification.attempts,1);assert.match(prepareSceneCapability(input,{code:'INVALID_OUTPUT'}).messages[0].content,/start\/end.*JSON/);
});
