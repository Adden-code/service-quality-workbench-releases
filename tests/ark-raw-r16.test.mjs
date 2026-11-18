import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient,ArkError} from '../server/ark-client.mjs';
import {rawSession,rawBasis,rawWire,inspectionAt} from './raw-contract-r16-fixtures.mjs';
const config={baseUrl:'http://127.0.0.1:18999/v1',model:'synthetic-model',authMode:'none',timeoutMs:1000};
const respond=wire=>new Response(JSON.stringify({id:'synthetic-request',model:'synthetic-model',usage:{total_tokens:50},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire),reasoning_content:'NEVER_CAPTURE_REASONING'}}]}),{headers:{'content-type':'application/json'}});
test('inspectRaw uses generic configured transport and reports its independent prompt version',async()=>{
 let payload,provider;const session=rawSession(),client=createArkClient({fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);provider=options.providerConfig;return respond(rawWire(session));}});assert.equal(typeof client.inspectRaw,'function','inspectRaw must exist');
 const steps=[],trace={step:async(id,input,operation)=>{steps.push(id);return operation();}},answer=await client.inspectRaw({config,session,basis:rawBasis(),inspectionAt,outputLanguage:'en',trace});
 assert.equal(answer.results.length,2);assert.equal(answer.promptVersion,'raw-direct-quote-v1');assert.equal(answer.requestId,'synthetic-request');assert.equal(provider.baseUrl,config.baseUrl);assert.equal(payload.max_tokens,16384);assert.equal(payload.stream,false);assert.deepEqual(steps,['model','validation']);assert.ok(!JSON.stringify(answer).includes('NEVER_CAPTURE_REASONING'));assert.equal(JSON.parse(payload.messages[1].content).record.recordId,session.id);
});
test('inspectRaw preserves retry diagnostics and partial degradation without merging model attempts',async()=>{
 let calls=0;const sent=[];const wire=rawWire();wire.results[0].evidenceQuotes=[{quote:'foreign row'}];const client=createArkClient({fetchImpl:async(url,options)=>{calls++;sent.push(JSON.parse(JSON.parse(options.body).messages[1].content));return respond(wire);}});assert.equal(typeof client.inspectRaw,'function','inspectRaw must exist');
 await assert.rejects(client.inspectRaw({config,session:rawSession(),basis:rawBasis(),inspectionAt}),error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT'&&error.diagnostic.ruleIds.includes('SYN-R1')&&typeof error.traceOutput.content==='string');
 const answer=await client.inspectRaw({config,session:rawSession(),basis:rawBasis(),inspectionAt,allowDegraded:true,retryFeedback:{reasonCodes:['quote_mismatch'],ruleIds:['SYN-R1'],content:'PRIVATE_PREVIOUS_MODEL_TEXT'}});assert.equal(calls,2);assert.equal(answer.results[0].rawValidation.status,'unverified-quote');assert.equal(answer.results[1].rawValidation.status,'verified');assert.deepEqual(sent[1].validationFeedback,{reasonCodes:['quote_mismatch'],ruleIds:['SYN-R1']});assert.ok(!JSON.stringify(sent).includes('PRIVATE_PREVIOUS_MODEL_TEXT'));assert.equal(sent[0].inspectionAt,sent[1].inspectionAt);assert.deepEqual(sent[0].basis,sent[1].basis);
});
test('inspectRaw final core failure stays technical INVALID_OUTPUT and never produces completed placeholders',async()=>{
 const client=createArkClient({fetchImpl:async()=>respond({...rawWire(),recordId:'FOREIGN'})});assert.equal(typeof client.inspectRaw,'function','inspectRaw must exist');await assert.rejects(client.inspectRaw({config,session:rawSession(),basis:rawBasis(),inspectionAt,allowDegraded:true}),error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT');
});
test('raw request budget refuses the complete row without truncation or transport',async()=>{
 let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return respond(rawWire());}});const basis=rawBasis();basis.policies[0].sections[0].text='Frozen reference text '.repeat(40000);assert.equal(typeof client.inspectRaw,'function','inspectRaw must exist');await assert.rejects(client.inspectRaw({config,session:rawSession('a'.repeat(100000)),basis,inspectionAt}),error=>error.code==='INPUT_TOO_LARGE');assert.equal(calls,0);
});
test('raw truncated transport diagnostics keep the raw prompt version and never store reasoning',async()=>{
 const client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({id:'synthetic-truncated',choices:[{finish_reason:'length',message:{content:'{"recordId":',reasoning_content:'PRIVATE_REASONING'}}]}))});
 await assert.rejects(client.inspectRaw({config,session:rawSession(),basis:rawBasis(),inspectionAt}),error=>error.code==='OUTPUT_TRUNCATED'&&error.traceOutput.promptVersion==='raw-direct-quote-v1'&&!JSON.stringify(error.traceOutput).includes('PRIVATE_REASONING'));
});
