import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient,ArkError} from '../server/ark-client.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {EC_RULE_IDS,EC_HEADERS,ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';

const config={apiKey:'fictional-evidence-key'};
const basis=createBasisSnapshot(ensureEcommerceCatalog(createCatalog()),{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS});
const semanticRuleIds=EC_RULE_IDS.filter(id=>id!=='EC-TIME');
const makeSession=()=>{
  const raw=Array(22).fill('');
  raw[8]='SYNTHETIC_COMMENT';raw[9]='SYNTHETIC_REPLY';raw[11]='SYNTHETIC_ADMIN';raw[15]='PRIVATE_HUMAN_REFERENCE';
  const ecommerce={schemaVersion:1,sheet:'Sheet4',row:3,fileSha256:'b'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('虚构测试标准'),raw,thresholdHours:24};
  return {id:'evidence-row',externalId:ecommerceRecordId(ecommerce),...ecommerceSourceProjection(ecommerce),ecommerce};
};
const ruleIds=method=>method==='inspectEcommerceRow'?semanticRuleIds:EC_RULE_IDS;
const makeResults=(method,evidence)=>ruleIds(method).map(ruleId=>({ruleId,verdict:'符合',reason:'仅用于本机兼容性验证',evidence,referenceIds:[`EC-POLICY@V1.0#${ruleId}-1`],fieldEvidence:['administrator']}));
const clientFor=(results,onRequest=()=>{})=>createArkClient({fetchImpl:async(_,options)=>{
  onRequest(options);
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results})}}]}),{headers:{'content-type':'application/json'}});
}});
const invalidOutput=error=>error instanceof ArkError&&error.code==='INVALID_OUTPUT';

for(const method of ['inspect','inspectEcommerceRow']){
  test(`${method} normalizes decimal integer text at the response boundary without mutating evidence`,async t=>{
    for(const evidence of [[2],['2'],[' 2 '],['02'],['\t2\n']])await t.test(JSON.stringify(evidence),async()=>{
      Object.freeze(evidence);
      const results=makeResults(method,evidence),before=structuredClone(results);
      let sent;
      const answer=await clientFor(results,options=>{sent=options.body;})[method]({config,session:makeSession(),basis});
      assert.deepEqual(answer.results,results.map(item=>({...item,evidence:[2]})));
      assert.ok(answer.results.every(item=>item.evidence.every(Number.isSafeInteger)));
      assert.deepEqual(results,before);
      assert.doesNotMatch(sent,/PRIVATE_HUMAN_REFERENCE/);
    });
  });

  test(`${method} rejects evidence outside the permitted integer syntax or actual turn set`,async t=>{
    const cases=[
      ['mixed duplicate',[2,'2']],['normalized duplicate',['02',' 2 ']],
      ['unknown integer',[3]],['unknown integer text',['3']],['negative integer text',['-2']],['zero text',['0']],
      ['unsafe integer',[Number.MAX_SAFE_INTEGER+1]],['unsafe integer text',['9007199254740993']],
      ['decimal text',['2.0']],['fraction text',['2.5']],['exponent text',['2e0']],['plus text',['+2']],
      ['empty text',['']],['blank text',[' \t\n']],['hexadecimal text',['0x2']],['binary text',['0b10']],
      ['Infinity text',['Infinity']],['NaN text',['NaN']],['true',[true]],['false',[false]],['null',[null]],
      ['fraction number',[2.5]],['array entry',[[2]]],['object entry',[{id:2}]],
    ];
    for(const [name,evidence] of cases)await t.test(name,async()=>{
      const results=makeResults(method,Object.freeze(evidence)),before=structuredClone(results);
      await assert.rejects(clientFor(results)[method]({config,session:makeSession(),basis}),invalidOutput);
      assert.deepEqual(results,before);
    });
  });

  test(`${method} retains frozen reference, verdict, rule-count and field-evidence checks with integer text`,async t=>{
    const cases=[
      ['forged reference',items=>{items[0].referenceIds=['EC-POLICY@V1.0#FORGED'];}],
      ['old reference',items=>{items[0].referenceIds=['EC-POLICY@V0.9#EC-TEXT-1'];}],
      ['short reference',items=>{items[0].referenceIds=['EC-TEXT-1'];}],
      ['duplicate reference',items=>{items[0].referenceIds.push(items[0].referenceIds[0]);}],
      ['invalid verdict',items=>{items[0].verdict='Pass';}],
      ['missing rule',items=>{items.pop();}],
      ['duplicate rule',items=>{items[1]=structuredClone(items[0]);}],
      ['unknown field',items=>{items[0].fieldEvidence=['unknown'];}],
      ['duplicate field',items=>{items[0].fieldEvidence=['administrator','administrator'];}],
    ];
    for(const [name,mutate] of cases)await t.test(name,async()=>{
      const results=makeResults(method,['2']);mutate(results);
      await assert.rejects(clientFor(results)[method]({config,session:makeSession(),basis}),invalidOutput);
    });
  });
}

test('inspection validates normalized evidence against actual sparse turn IDs',async()=>{
  const session=makeSession();
  session.turns=[{id:2,role:'客户',text:'SYNTHETIC_QUESTION'},{id:9,role:'客服',text:'SYNTHETIC_ANSWER'}];
  const answer=await clientFor(makeResults('inspect',[' 9 '])).inspect({config,session,basis});
  assert.ok(answer.results.every(item=>item.evidence.length===1&&item.evidence[0]===9));
  await assert.rejects(clientFor(makeResults('inspect',['3'])).inspect({config,session,basis}),invalidOutput);
});

test('ecommerce response compatibility retains source-projection validation before transport',async()=>{
  const session=makeSession();session.turns[1].text='FORGED_REPLY';
  let calls=0;
  await assert.rejects(clientFor(makeResults('inspectEcommerceRow',['2']),()=>{calls++;}).inspectEcommerceRow({config,session,basis}),error=>error instanceof ArkError&&error.code==='INVALID_INPUT');
  assert.equal(calls,0);
});
