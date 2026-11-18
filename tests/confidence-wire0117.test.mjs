import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSceneCapability,prepareSceneCapability,executeSceneCapabilities} from '../server/scene-capabilities.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {validateResultAssurance} from '../server/triage-validation.mjs';
import {defaultScenePackage,resolveSceneRuntime} from '../public/scene-configuration.mjs';
const input={blocks:[{id:'b',text:'Synthetic source'}],sites:[{id:'a'}],taxonomy:{labels:[{id:'leaf',parentId:'parent'}]},rating:5,targetLanguage:'zh'};
const values={intent:{labelId:'leaf'},demandSummary:{text:'Synthetic demand'},negativeVoice:{hasNegative:false,text:'No negative voice'},site:{siteId:'a'},translation:{detectedLanguage:'en',text:'合成译文'},ecommerceClassification:{polarity:'positive',vocKind:'none'},timing:{firstCustomer:null,firstAgent:null,queries:[],completeCoverage:true}};
const output=(capability,confidence)=>({status:'completed',value:values[capability],confidence,reason:'Synthetic reason',evidence:[{blockId:'b',quote:'Synthetic source',start:0,end:16}]});
test('all model auxiliary capabilities normalize decimal confidence strings and reject invalid values',()=>{
 for(const capability of Object.keys(values)){
  for(const confidence of ['0.85','0.9','0.95','0.98','1','0',0.85])assert.equal(parseSceneCapability(JSON.stringify(output(capability,confidence)),{...input,capability}).confidence,Number(confidence));
  for(const confidence of ['high','','  ','85%','NaN','Infinity','0x1','1.01','-0.1',null,true])assert.throws(()=>parseSceneCapability(JSON.stringify(output(capability,confidence)),{...input,capability}),/置信度/);
 }
 assert.match(prepareSceneCapability({...input,capability:'intent'},{code:'INVALID_OUTPUT'}).messages[0].content,/confidence.*JSON number.*不要加引号/);
});
test('report translation model boundary normalizes strings; stored judgment validator stays strict',()=>{
 const prepared=prepareReportEnrichment('translation',{targetLang:'en',includeConfidence:true,items:[{id:'s',text:'Synthetic text'}]});
 const wire=confidence=>JSON.stringify({items:[{id:'s',translation:'Synthetic text',isTargetLanguage:true,detectedLanguage:'en',confidence}]});
 assert.equal(parseReportEnrichment(wire('0.85'),prepared).items[0].confidence,.85);
 for(const v of ['high','',' ',null,'1.01'])assert.throws(()=>parseReportEnrichment(wire(v),prepared));
 assert.throws(()=>validateResultAssurance({confidence:'0.85'},{expectedRuleIds:[]}),/置信度/);
});
test('failed checkpoint recovers numeric-string confidence on first call per capability without replaying successful outputs',async()=>{
 const p=defaultScenePackage({id:'synthetic',name:'Synthetic',engine:'conversation'});p.configuration.executionMode='configured';p.configuration.capabilities=['intent','demandSummary','negativeVoice'].map(key=>({key,phase:'pre',dependsOn:[]}));const snapshot={configuration:p.configuration,runtime:resolveSceneRuntime(p.configuration,{}),taxonomy:input.taxonomy};
 let bad=true,calls=0;const client=createArkClient({fetchImpl:async(_,opts)=>{calls++;const i=JSON.parse(JSON.parse(opts.body).messages[1].content),o=output(i.capability,bad?'high':'0.9');o.evidence[0].blockId='turn-1';return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(o)}}]}));}});
 const args={session:{id:'s',turns:[{id:1,role:'客户',text:'Synthetic source'}]},snapshot,client,config:{model:'synthetic',authMode:'none',baseUrl:'http://127.0.0.1:1'},retryDelayMs:0};
 const failed=await executeSceneCapabilities(args);assert.equal(calls,9);assert.ok(Object.values(failed.outputs).every(r=>r.status==='failed'));bad=false;calls=0;
 const recovered=await executeSceneCapabilities({...args,previous:failed});assert.equal(calls,3);assert.ok(Object.values(recovered.outputs).every(r=>r.status==='completed'&&r.confidence===.9));
 await executeSceneCapabilities({...args,previous:recovered});assert.equal(calls,3);
});
