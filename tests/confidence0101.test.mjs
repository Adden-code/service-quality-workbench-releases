import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient,ArkError,PROMPT_VERSION} from '../server/ark-client.mjs';
import {EC_HEADERS,ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
import {normalizeConfidenceValue} from '../public/model-output-values.mjs';

const config={baseUrl:'http://127.0.0.1:10080/v1',model:'synthetic-confidence',authMode:'none'};
const reviewPolicy={version:1,enabled:true,confidenceThreshold:0.9,calibrationStatus:'unvalidated'};
const policy={id:'P/1',version:'V1',sections:[{id:'S#1',text:'Synthetic answer.'}]};
const rule=id=>({id,policyIds:[policy.id],passCriteria:'Match the source.',failCriteria:'Contradict the source.',exceptionCriteria:'Insufficient evidence is uncertain.'});
const basis={rules:['R1','R2'].map(rule),policies:[policy]};
const session={id:'synthetic-structured',reviewPolicy,turns:[{id:1,role:'客户',text:'Synthetic question?'},{id:2,role:'客服',text:'Synthetic answer.'}],contextFields:[{key:'fixtureField',label:'Fixture field',type:'text',value:'Selected source field',source:{sheet:'Fixture',row:3,column:'Field'}}]};
const ecommerceIds=['EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'];
const ecommerceBasis={rules:['EC-TIME',...ecommerceIds].map(rule),policies:[policy]};
const raw=Array(22).fill('');
raw[8]='Synthetic question?';raw[9]='Synthetic answer.';raw[11]='Synthetic agent';
const ecommerce={schemaVersion:1,sheet:'Sheet4',row:3,fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('Synthetic standard'),raw,thresholdHours:24};
const ecommerceSession={id:'synthetic-ecommerce',externalId:ecommerceRecordId(ecommerce),...ecommerceSourceProjection(ecommerce),ecommerce,reviewPolicy};
const result=(ruleId,confidence)=>({ruleId,verdict:'符合',reason:'Matches the synthetic source.',evidence:['2'],referenceIds:['P%2F1@V1#S%231'],confidence,evidenceQuotes:[{turnId:'2',quote:'Synthetic answer.',role:'客服'}],conflictsWith:[]});
const kinds=['structured','ecommerce-row','ecommerce-batch'];
const bodyFor=(kind,confidence)=>kind==='ecommerce-batch'
  ?{records:[{sessionId:ecommerceSession.id,results:ecommerceIds.map(id=>result(id,confidence))}],duplicateGroups:[],checkedSessionIds:[ecommerceSession.id]}
  :{results:(kind==='structured'?['R1','R2']:ecommerceIds).map(id=>result(id,confidence))};
const resultsOf=(kind,body)=>kind==='ecommerce-batch'?body.records[0].results:body.results;
async function inspect(kind,body,{selectedSession=session,content}={}){
  let sent,calls=0;
  const client=createArkClient({fetchImpl:async(_,options)=>{
    calls++;sent=JSON.parse(options.body);
    return new Response(JSON.stringify({id:'synthetic-confidence-request',choices:[{finish_reason:'stop',message:{content:content??JSON.stringify(body)}}]}),{headers:{'Content-Type':'application/json'}});
  }});
  const answer=kind==='structured'?await client.inspect({config,session:selectedSession,basis})
    :kind==='ecommerce-row'?await client.inspectEcommerceRow({config,session:ecommerceSession,basis:ecommerceBasis})
    :await client.inspectEcommerce({config,sessions:[ecommerceSession],basis:ecommerceBasis});
  assert.equal(calls,1);
  return {answer,sent};
}
const invalidOutput=error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT';

test('confidence normalizer preserves invalid values for the existing validator without coercing them',()=>{
  const invalids=['',' \t\r\n','0.9junk','junk0.9','0x1','0b1','0o1','NaN','Infinity','-Infinity','1e309','1e','0.9\n0.8','０.９',true,false,null,undefined,[],[0.9],{value:0.9},new String('0.9'),NaN,Infinity,-Infinity];
  for(const value of invalids)assert.equal(normalizeConfidenceValue(value),value);
  for(const value of ['0.9','9e-1',' 0.9 ','-0.1','1.1'])assert.equal(normalizeConfidenceValue(value),Number(value));
  for(const value of [0,0.9,1,-0.1,1.1])assert.equal(normalizeConfidenceValue(value),value);
});

for(const kind of kinds){
  test(`${kind} normalizes complete decimal and exponent confidence strings at the response boundary`,async t=>{
    for(const value of ['0.9','9e-1','9E-1','+0.9','.9','0.900',' 0.9\t','0','1','1.'])await t.test(JSON.stringify(value),async()=>{
      const body=bodyFor(kind,value),before=structuredClone(body);
      const {answer}=await inspect(kind,body);
      const results=resultsOf(kind,answer);
      assert.ok(results.every(item=>typeof item.confidence==='number'&&item.confidence===Number(value)));
      assert.deepEqual(results[0].evidence,[2]);
      assert.deepEqual(results[0].referenceIds,['P%2F1@V1#S%231']);
      assert.deepEqual(results[0].evidenceQuotes,[{turnId:2,quote:'Synthetic answer.',role:'客服'}]);
      assert.deepEqual(results[0].conflictsWith,[]);
      assert.deepEqual(body,before);
    });
  });
  test(`${kind} preserves finite numeric confidence values`,async()=>{
    for(const value of [0,0.9,1]){
      const {answer}=await inspect(kind,bodyFor(kind,value));
      assert.ok(resultsOf(kind,answer).every(item=>item.confidence===value));
    }
  });
  test(`${kind} rejects malformed, nonnumeric, nonfinite and out-of-range confidence`,async t=>{
    const invalids=[['blank',''],['whitespace',' \t\r\n'],['boolean true',true],['boolean false',false],['null',null],['empty array',[]],['numeric array',[0.9]],['object',{}],['numeric object',{value:0.9}],['junk suffix','0.9junk'],['junk prefix','junk0.9'],['percent','0.9%'],['two numbers','0.9 0.8'],['comma','0,9'],['hex','0x1'],['binary','0b1'],['octal','0o1'],['NaN','NaN'],['Infinity','Infinity'],['negative Infinity','-Infinity'],['overflow','1e309'],['dot','.'],['sign','+'],['incomplete exponent','1e'],['negative string','-0.1'],['large string','1.01'],['negative number',-0.1],['large number',1.01]];
    for(const [label,value] of invalids)await t.test(label,async()=>{
      await assert.rejects(inspect(kind,bodyFor(kind,value)),invalidOutput);
    });
    await t.test('JSON numeric overflow',async()=>{
      const content=JSON.stringify(bodyFor(kind,'overflow-placeholder')).replaceAll('"overflow-placeholder"','1e309');
      await assert.rejects(inspect(kind,null,{content}),invalidOutput);
    });
  });
  test(`${kind} retains strict rule, verdict, reference and evidence validation with string confidence`,async t=>{
    const invalids={
      'missing rule':items=>items.pop(),
      'duplicate rule':items=>items[1]={...items[0]},
      'unknown rule':items=>items[0].ruleId='UNKNOWN',
      'unknown verdict':items=>items[0].verdict='pass',
      'blank reason':items=>items[0].reason=' ',
      'unknown evidence':items=>items[0].evidence=[999],
      'duplicate evidence':items=>items[0].evidence=[2,'2'],
      'unknown reference':items=>items[0].referenceIds=['P%2F1@V0#S%231'],
      'duplicate reference':items=>items[0].referenceIds.push(items[0].referenceIds[0]),
      'unknown field':items=>items[0].fieldEvidence=['UNKNOWN'],
      'invented quote':items=>items[0].evidenceQuotes[0].quote='Invented answer.',
      'unlisted quote turn':items=>items[0].evidenceQuotes[0].turnId=1,
      'mismatched quote role':items=>items[0].evidenceQuotes[0].role='客户',
      'unknown conflict':items=>items[0].conflictsWith=['UNKNOWN'],
      'self conflict':items=>items[0].conflictsWith=[items[0].ruleId],
    };
    for(const [label,mutate] of Object.entries(invalids))await t.test(label,async()=>{
      const body=bodyFor(kind,'0.9');mutate(resultsOf(kind,body));
      if(['invented quote','unlisted quote turn','mismatched quote role'].includes(label)){const {answer}=await inspect(kind,body);const item=(answer.results||answer.records?.[0]?.results||[])[0];assert.equal(item.evidenceValidation.status,'unverified');assert.deepEqual(item.evidenceQuotes,[]);}else await assert.rejects(inspect(kind,body),invalidOutput);
    });
  });
  test(`${kind} still requires every triage assurance field`,async()=>{
    for(const key of ['confidence','evidenceQuotes','conflictsWith']){
      const body=bodyFor(kind,'0.9');delete resultsOf(kind,body)[0][key];
      await assert.rejects(inspect(kind,body),invalidOutput);
    }
  });
  test(`${kind} requests an unquoted JSON confidence number without changing the prompt contract version`,async()=>{
    const {answer,sent}=await inspect(kind,bodyFor(kind,0.9));
    assert.match(sent.messages[0].content,/不带引号的\s*JSON\s*数字/);
    assert.match(sent.messages[0].content,/confidence must be an unquoted JSON number/i);
    assert.equal(answer.promptVersion,kind==='structured'?'qa-ark-v2':kind==='ecommerce-row'?'ec-row-ark-v1':'ec-batch-ark-v1');
    assert.equal(PROMPT_VERSION,'qa-ark-v2');
  });
}

test('legacy structured responses may omit confidence when triage is disabled',async()=>{
  const body=bodyFor('structured',0.9);
  for(const item of body.results)for(const key of ['confidence','evidenceQuotes','conflictsWith'])delete item[key];
  const {answer}=await inspect('structured',body,{selectedSession:{...session,reviewPolicy:{...reviewPolicy,enabled:false}}});
  assert.ok(answer.results.every(item=>!Object.hasOwn(item,'confidence')));
});
