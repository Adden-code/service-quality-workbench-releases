import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {EC_RULE_IDS,EC_HEADERS,ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
const basis=createBasisSnapshot(ensureEcommerceCatalog(createCatalog()),{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS});
const raw=Array(22).fill('');raw[8]='ROW_ONE_COMMENT';raw[9]='ROW_ONE_REPLY';raw[11]='虚构管理员';raw[15]='PRIVATE_HUMAN';
const ecommerce={schemaVersion:1,sheet:'Sheet4',row:3,fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('标准'),raw,thresholdHours:24};
const session={id:'row-one',externalId:ecommerceRecordId(ecommerce),...ecommerceSourceProjection(ecommerce),ecommerce,review:{notes:'PRIVATE_CURRENT_REVIEW'}};
test('row client accepts one row and sends exactly four checks without reference columns',async()=>{
 let sent;const client=createArkClient({fetchImpl:async(_,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({results:EC_RULE_IDS.filter(id=>id!=='EC-TIME').map(ruleId=>({ruleId,verdict:'符合',reason:'虚构检查',evidence:[1],referenceIds:[]}))})}}]}));}});
 assert.equal(typeof client.inspectEcommerceRow,'function');const result=await client.inspectEcommerceRow({config:{apiKey:'fixture-secret-key'},session,basis});
 assert.equal(result.results.length,4);const input=JSON.parse(sent.messages[1].content);assert.equal(input.session.id,'row-one');assert.equal(input.basis.rules.length,4);assert.equal(input.sessions,undefined);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_HUMAN|PRIVATE_CURRENT_REVIEW|raw|duplicateGroups/);
});
