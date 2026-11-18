import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
const config={baseUrl:'http://127.0.0.1:10080/v1',model:'synthetic',authMode:'none'};
const basis={rules:[{id:'R1',policyIds:['P1'],passCriteria:'Match the document.',failCriteria:'Contradiction.',exceptionCriteria:'Insufficient evidence is uncertain.'}],policies:[{id:'P1',version:'V1.0',sections:[{id:'S1',text:'The battery lasts two days.'}]}]};
const session={id:'S1',reviewPolicy:{version:1,enabled:true,confidenceThreshold:0.9,calibrationStatus:'unvalidated'},turns:[{id:1,role:'客户',text:'How long does the battery last?'},{id:2,role:'客服',text:'The battery lasts two days.'}]};
const result=()=>({ruleId:'R1',verdict:'符合',confidence:0.95,reason:'Matches the policy.',evidence:['2'],referenceIds:['P1@V1.0#S1'],evidenceQuotes:[{turnId:'2',quote:'The battery lasts two days.',role:'客服'}],conflictsWith:[]});
const respond=content=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:[content]})}}]}),{headers:{'Content-Type':'application/json'}});
test('inspection preserves confidence and validated source quotes and instructs explicit consistency check',async()=>{
 let payload;const answer=await createArkClient({fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return respond(result());}}).inspect({config,session,basis});
 assert.equal(answer.results[0].confidence,0.95);assert.deepEqual(answer.results[0].evidenceQuotes,[{turnId:2,quote:'The battery lasts two days.',role:'客服'}]);assert.deepEqual(answer.results[0].conflictsWith,[]);
 assert.match(payload.messages[0].content,/confidence/);assert.match(payload.messages[0].content,/conflictsWith/);
});
test('invalid confidence, invented source quotes and mismatched roles remain retryable invalid outputs',async()=>{
 for(const modify of [r=>r.confidence=1.4,r=>r.confidence='0.95junk',r=>r.evidenceQuotes[0].quote='Invented',r=>r.evidenceQuotes[0].turnId=1,r=>r.evidenceQuotes[0].role='客户',r=>r.conflictsWith=['R404']]){
  const value=result();modify(value);await assert.rejects(createArkClient({fetchImpl:async()=>respond(value)}).inspect({config,session,basis}),e=>e.code==='INVALID_OUTPUT');
 }
});
