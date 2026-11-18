import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

const session={id:'fictional-1',externalId:'fictional-1',scene:'虚构咨询',topic:'颜色',startedAt:'2026-10-30T09:00:00+08:00',channel:'虚构',product:'虚构',customer:'虚构客户',agent:'虚构客服',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'什么颜色？'},{id:2,role:'客服',text:'我核对一下资料。'}]};
const basis=createBasisSnapshot(createCatalog(),{effectiveDate:'2026-10-30',ruleIds:['R004']});
const valid={results:[{ruleId:'R004',verdict:'符合',reason:'虚构回复未夸大。',evidence:[2],referenceIds:[]}]};
function tracker(){const nodes=[];return{nodes,async step(id,input,operation){const n={id,input,status:'running'};nodes.push(n);try{const out=await operation();n.output=out;n.status='completed';return out;}catch(e){n.status='failed';throw e;}}};}
test('model request and semantic validation leave separate actual snapshots without credentials or reasoning',async()=>{
 const trace=tracker();const client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({id:'fictional-request',model:'fictional-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid),reasoning_content:'HIDDEN_THOUGHT_MUST_NOT_RECORD'}}],usage:{total_tokens:10}}))});
 const out=await client.inspect({session,basis,config:{apiKey:'fixture-secret-key',model:'glm-5.3-flash'},trace});
 assert.equal(out.results.length,1);assert.deepEqual(trace.nodes.map(n=>n.id),['model','validation']);
 assert.deepEqual(trace.nodes[0].input.messages.map(m=>m.role),['system','user']);
 assert.equal(trace.nodes[0].output.content,JSON.stringify(valid));
 assert.doesNotMatch(JSON.stringify(trace.nodes),/fixture-secret-key|HIDDEN_THOUGHT/);
});
test('malformed semantic JSON identifies validation failure while retaining received business content',async()=>{
 const trace=tracker(),client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'not-json'},finish_reason:'stop'}]}))});
 await assert.rejects(client.inspect({session,basis,config:{apiKey:'fixture-secret-key'},trace}));
 assert.deepEqual(trace.nodes.map(n=>[n.id,n.status]),[['model','completed'],['validation','failed']]);
 assert.equal(trace.nodes[1].input.content,'not-json');
});
test('HTTP error identifies model failure and never invents validation success',async()=>{
 const trace=tracker(),client=createArkClient({fetchImpl:async()=>new Response('private provider error',{status:429})});
 await assert.rejects(client.inspect({session,basis,config:{apiKey:'fixture-secret-key'},trace}));
 assert.deepEqual(trace.nodes.map(n=>[n.id,n.status]),[['model','failed']]);
 assert.doesNotMatch(JSON.stringify(trace.nodes),/private provider error/);
});
test('length-limited model response retains safe partial content and usage for failed-node diagnosis',async()=>{
 const trace=tracker(),client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({id:'partial-request',model:'fictional-model',choices:[{finish_reason:'length',message:{content:'{"results":[',reasoning_content:'PRIVATE_THINKING'}}],usage:{total_tokens:87}}))});
 await assert.rejects(client.inspect({session,basis,config:{apiKey:'fixture-secret-key'},trace}),error=>{
   assert.equal(error.code,'OUTPUT_TRUNCATED');assert.equal(error.traceOutput.content,'{"results":[');assert.equal(error.traceOutput.usage.total_tokens,87);assert.equal(error.traceOutput.requestId,'partial-request');assert.doesNotMatch(JSON.stringify(error.traceOutput),/PRIVATE_THINKING|fixture-secret-key/);return true;
 });
});
test('unrecognized finish reason retains business response diagnostics while rejecting its conclusion',async()=>{
 const client=createArkClient({fetchImpl:async()=>new Response(JSON.stringify({id:'unexpected-finish',model:'fictional-model',choices:[{finish_reason:'UNEXPECTED',message:{content:JSON.stringify(valid),reasoning_content:'HIDDEN_REASONING'}}],usage:{total_tokens:34}}))});
 await assert.rejects(client.inspect({session,basis,config:{apiKey:'fixture-secret-key'}}),error=>{assert.equal(error.code,'INVALID_OUTPUT');assert.equal(error.traceOutput.finishReason,'UNEXPECTED');assert.equal(error.traceOutput.content,JSON.stringify(valid));assert.equal(error.traceOutput.usage.total_tokens,34);assert.doesNotMatch(JSON.stringify(error.traceOutput),/HIDDEN_REASONING|fixture-secret-key/);return true;});
});
