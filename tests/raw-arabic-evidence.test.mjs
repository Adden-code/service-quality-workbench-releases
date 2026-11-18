import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRawInspectionResult} from '../server/raw-inspection.mjs';
import {validateRawResultAssurance} from '../public/raw-evidence.mjs';
import {rawSession,rawBasis,rawWire} from './raw-contract-r16-fixtures.mjs';
function check(source,quote,allowDegraded=false){const session=rawSession(source),wire=rawWire(session);wire.results.forEach(r=>r.evidenceQuotes=[{quote}]);return {session,result:parseRawInspectionResult(JSON.stringify(wire),{session,basis:rawBasis()},{allowDegraded})};}
test('Arabic presentation forms, canonical composition and tatweel resolve to exact original UTF16 slices',()=>{
 for(const [source,quote] of [['😞 ﺍﻟﺒﻄﺎﺭﻳﺔ ﻻ ﺗﻌﻤﻞ','البطارية لا تعمل'],['أريد معرفة السعر','ا\u0654ريد معرفة السعر'],['البطــــارية لا تعمل','البطارية لا تعمل']]){
  const {session,result}=check(source,quote);for(const r of result){assert.equal(r.rawValidation.status,'verified');assert.ok(r.rawValidation.reasonCodes.includes('unicode_equivalent_quote'));assert.equal(validateRawResultAssurance(r,session).valid,true);const q=r.evidenceQuotes[0];assert.equal(session.rawTranscript.text.slice(q.matches[0].start,q.matches[0].end),q.quote);}
 }
});
test('Arabic word changes, alef/hamza differences, diacritic removal and partial ligatures are never auto-accepted',()=>{
 for(const [source,quote] of [['أريد معرفة السعر','اريد معرفة السعر'],['عَلَم','علم'],['لا تعمل','تعمل بشكل جيد'],['ﻻ','ل']]){assert.throws(()=>check(source,quote));assert.ok(check(source,quote,true).result.every(r=>r.verdict==='符合'&&r.rawValidation.status==='unverified-quote'&&r.evidenceQuotes.length===0));}
});
