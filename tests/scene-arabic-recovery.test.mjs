import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {prepareSceneCapability,parseSceneCapability,executeSceneCapabilities,recordCapabilityOutcomes} from '../server/scene-capabilities.mjs';
import {defaultScenePackage,resolveSceneRuntime} from '../public/scene-configuration.mjs';
const text='مرحبا، أريد معرفة سعر الجهاز. البطارية لا تعمل 😞';
const session={id:'synthetic-ar',turns:[{id:1,role:'客户',text}]};
const evidence=[{blockId:'turn-1',quote:text,start:0,end:text.length}];
const config={model:'synthetic-model',authMode:'none',baseUrl:'http://127.0.0.1:1'};
function snapshot(){const p=defaultScenePackage({id:'synthetic-ar',name:'Synthetic Arabic',engine:'conversation'});p.configuration.executionMode='configured';p.configuration.capabilities=['intent','demandSummary','negativeVoice'].map(key=>({key,phase:'pre',dependsOn:[]}));return {configuration:p.configuration,runtime:resolveSceneRuntime(p.configuration,{}),taxonomy:{labels:[{id:'pre',label:'售前',parentId:null},{id:'price',label:'价格',parentId:'pre'}]},exceptions:[]};}
const body=key=>({status:'completed',value:key==='intent'?{labelId:'price'}:key==='negativeVoice'?{hasNegative:true,text:'البطارية لا تعمل'}:{text:'يسأل عن السعر ويذكر مشكلة البطارية'},confidence:.9,reason:'Synthetic Arabic evidence',evidence});
const response=body=>new Response(JSON.stringify({model:config.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(body)}}]}));
test('accept exactly one complete JSON markdown fence, reject commentary and concatenated objects',()=>{
 const input={capability:'negativeVoice',blocks:[{id:'turn-1',text}],sites:[]};
 for(const content of [JSON.stringify(body('negativeVoice')),'```json\n'+JSON.stringify(body('negativeVoice'))+'\n```','```\r\n'+JSON.stringify(body('negativeVoice'))+'\r\n```'])assert.equal(parseSceneCapability(content,input).value.hasNegative,true);
 for(const content of ['Explanation: '+JSON.stringify(body('negativeVoice')),'```json\n'+JSON.stringify(body('negativeVoice'))+'\n```\nExtra','{}{}'])assert.throws(()=>parseSceneCapability(content,input));
});
test('Arabic auxiliary contract declares all required fields and sends JSON mode through transport',async()=>{
 const input={capability:'intent',blocks:[{id:'turn-1',text}],taxonomy:snapshot().taxonomy,sites:[]};const p=prepareSceneCapability(input);
 assert.deepEqual(p.outputSchema.required,['status','value','confidence','reason','evidence']);assert.ok(JSON.stringify(p.outputSchema).includes('labelId'));
 let sent;const client=createArkClient({fetchImpl:async(_,o)=>{sent=JSON.parse(o.body);return response(body('intent'));}});
 const out=await client.inspectSceneCapability({config,input});assert.equal(out.value.labelId,'price');assert.equal(sent.response_format.type,'json_object');assert.ok(sent.messages[0].content.includes('required'));
 assert.throws(()=>parseSceneCapability(JSON.stringify({status:'uncertain',confidence:0,reason:'unknown',evidence:[]}),input),/字段/);
 assert.equal(parseSceneCapability(JSON.stringify({...body('intent'),evidence:[{...evidence[0],end:2}]}),input).evidence[0].end,text.length);assert.throws(()=>parseSceneCapability(JSON.stringify({...body('intent'),evidence:[{...evidence[0],quote:'Different source'}]}),input),/引文/);
});
test('Arabic omissions get two correction retries, distinct validation traces and all three tags recover',async()=>{
 const attempts={},seen=[],traces=[];const client=createArkClient({fetchImpl:async(_,o)=>{const req=JSON.parse(o.body),input=JSON.parse(req.messages[1].content),key=input.capability;seen.push(req);attempts[key]=(attempts[key]||0)+1;return response(attempts[key]<3?{results:[]}:body(key));}});
 const result=await executeSceneCapabilities({session,snapshot:snapshot(),config,client,retryDelayMs:0,trace:{step:async(id,input,op)=>{traces.push(id);return op();}}});
 assert.deepEqual(attempts,{intent:3,demandSummary:3,negativeVoice:3});assert.ok(Object.values(result.outputs).every(v=>v.status==='completed'));assert.ok(traces.includes('cap-pre-intent-3-validation'));assert.ok(seen[1].messages[0].content.includes('retry'));
});
test('exhausted Arabic omissions remain failures, breaker counts final rows once, abort/auth do not retry',async()=>{
 let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return response({results:[]});}});const s=snapshot();s.configuration.capabilities=s.configuration.capabilities.slice(0,1);
 const result=await executeSceneCapabilities({session,snapshot:s,config,client,retryDelayMs:0});assert.equal(calls,3);assert.equal(result.outputs.intent.status,'failed');assert.equal(result.outputs.intent.attempts,3);
 let m={};for(let i=0;i<20;i++)m=recordCapabilityOutcomes(m,String(i),result,{window:50,minimum:20,rate:.1});assert.equal(m.intent.technicalFailures,20);assert.equal(m.intent.paused,true);
 calls=0;client.inspectSceneCapability=async()=>{calls++;throw Object.assign(new Error('synthetic auth'),{code:'AUTHENTICATION'});};await assert.rejects(executeSceneCapabilities({session,snapshot:s,config,client,retryDelayMs:0}));assert.equal(calls,1);
});
test('repair reuses successful tags and recalculates dependency-blocked derived sales stage',async()=>{
 const s=snapshot();s.configuration.capabilities.push({key:'salesStage',phase:'pre',dependsOn:['intent']});let failed=true,calls=[];const client={inspectSceneCapability:async({input})=>{calls.push(input.capability);if(failed&&input.capability==='intent')throw Object.assign(new Error('synthetic'),{code:'INVALID_OUTPUT'});return body(input.capability);}};
 const first=await executeSceneCapabilities({session,snapshot:s,config,client,retryDelayMs:0});assert.equal(first.outputs.salesStage.dependencyBlocked,true);assert.equal(calls.filter(k=>k==='intent').length,3,'a failed dependency is attempted only once per phase, not again through salesStage');failed=false;calls=[];
 const next=await executeSceneCapabilities({session,snapshot:s,config,client,previous:first,retryDelayMs:0});assert.deepEqual(calls,['intent']);assert.equal(next.outputs.salesStage.status,'completed');assert.deepEqual(next.outputs.negativeVoice,first.outputs.negativeVoice);
});
