import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {deriveAIDecision} from '../public/ai-triage.mjs';
import {validateResultAssurance} from '../server/triage-validation.mjs';
const text='Synthetic reply.\r\nمرحبا 😀\r\nExact punctuation!';
const policy={id:'P1',version:'V1',sections:[{id:'S1',text:'Synthetic reference.'}]};
const basis={rules:[{id:'R1',policyIds:['P1'],passCriteria:'Use source.',failCriteria:'Unsupported.',exceptionCriteria:'Unknown.'}],policies:[policy]};
const session={id:'S1',expectedRuleIds:['R1'],reviewPolicy:{version:1,enabled:true,confidenceThreshold:0.9,calibrationStatus:'unvalidated'},turns:[{id:1,role:'客户',text:'Synthetic question?'},{id:2,role:'客服',text}]};
const config={baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-newline',authMode:'none'};
async function run(quote,selectedSession=session){
 const body={results:[{ruleId:'R1',verdict:'符合',reason:'Synthetic evidence.',confidence:'0.9',conflictsWith:[],evidence:['2'],referenceIds:['P1@V1#S1'],evidenceQuotes:[{turnId:'2',role:'客服',quote}]}]};
 return createArkClient({fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(body)}}]}))}).inspect({config,session:selectedSession,basis});
}
test('structured model LF quotation resolves to original CRLF slice without changing role or source',async()=>{
 const result=await run(text.replaceAll('\r\n','\n')),item=result.results[0];
 assert.equal(item.confidence,0.9);assert.equal(item.evidenceQuotes[0].quote,text);assert.equal(session.turns[1].text,text);
 assert.doesNotThrow(()=>validateResultAssurance(item,session));
 const s={...session,aiResults:result.results,aiExecution:{status:'completed',runId:'SYN-RUN'}};
 assert.equal(deriveAIDecision(s,s.reviewPolicy,{basis,runId:'SYN-RUN',at:'2026-11-12T10:00:00Z'}).status,'PASS');
});
test('structured newline compatibility still rejects whitespace edits, joins and foreign text',async()=>{
 for(const quote of [text.replace('\r\n',' '),text.replace('Exact','exact'),text.replace('!','?'),'Foreign row'])await assert.rejects(run(quote),error=>error.code==='INVALID_OUTPUT');
});

test('CRLF source expansion may not produce a stored quotation above the existing size limit',async()=>{const original='A\r\n'.repeat(7000),selected={...session,turns:[session.turns[0],{...session.turns[1],text:original}]};await assert.rejects(run(original.replaceAll('\r\n','\n'),selected),error=>error.code==='INVALID_OUTPUT');});
