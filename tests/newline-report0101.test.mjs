import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRawReportRecord} from '../public/raw-report-evidence.mjs';
function fixture(){
 const text='A\nB|A\r\nB',raw={schemaVersion:1,fileSha256:'a'.repeat(64),textSha256:'b'.repeat(64),sheet:'Synthetic',headerRow:1,row:2,headers:['ID','Agent','Transcript'],raw:['SYN','Agent',text],text,columns:{text:3}};
 const original={sheetName:raw.sheet,headerRow:1,headers:raw.headers,rows:[{recordId:'SYN',sourceRow:2,values:raw.raw}]},result={evidence:[],evidenceQuotes:[{quote:'A\nB',matches:[{start:0,end:3},{start:4,end:8}]}],rawValidation:{schemaVersion:1,status:'verified',textSha256:raw.textSha256,reasonCodes:[],evidenceMatching:'crlf-lf-v1'}};
 return{record:{id:'SYN',inputMode:'raw-transcript-v1',rawTranscript:raw,conversation:text,ai:[result],confirmed:[],final:[]},original,result,source:{sha256:raw.fileSha256}};
}
test('report preserves normalized matching spans against original mixed-newline text',()=>{
 const f=fixture();assert.equal(validateRawReportRecord(f.record,f.original,f.source),true);
 f.result.evidenceQuotes[0].matches[1].start=5;assert.throws(()=>validateRawReportRecord(f.record,f.original,f.source));
});
test('historical unmarked reports retain exact-literal spans and are not reinterpreted',()=>{
 const f=fixture();delete f.result.rawValidation.evidenceMatching;f.result.evidenceQuotes=[{quote:'A\r\nB',matches:[{start:4,end:8}]}];assert.equal(validateRawReportRecord(f.record,f.original,f.source),true);
});
