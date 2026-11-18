import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook} from '../public/io.mjs';
import {createBusinessXlsx} from '../public/business-input.mjs';
const api=await import('../public/raw-import-flow.mjs').catch(()=>({}));
const file=bytes=>({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
test('new whole-cell files proceed directly through raw preflight, with no cleaning call or invented role/time',async()=>{
 assert.equal(typeof api.parseConsultationFile,'function');const bytes=await workbook([{name:'业务',headers:['会话ID','客服','消息详情'],rows:[['SYN-RAW','Agent','Customer: Question\nAgent: Answer']]}]);const parsed=await api.parseConsultationFile(file(bytes),{scene:'新品产品咨询'});assert.equal(parsed.valid,true,parsed.errors?.join(';'));assert.equal(parsed.inputMode,'raw-transcript-v1');assert.deepEqual(parsed.sessions[0].turns,[]);assert.equal(parsed.sessions[0].startedAt,'');
});
test('updating one-time source declarations keeps original file, source text, hash and preview acknowledgement',async()=>{
 const bytes=await workbook([{name:'业务',headers:['会话ID','客服','消息详情'],rows:[['SYN-RAW','Agent','Literal source']]}]);const f=file(bytes),parsed=await api.parseConsultationFile(f,{scene:'新品产品咨询'}),d={file:f,parsed,previewConfirmed:true,name:'Preserved'};const before=structuredClone(parsed.sessions[0].rawTranscript);api.updateRawImportOptions(d,{timePolicy:{mode:'explicit',timezone:'+03:00'},productDefault:'Synthetic product',outputLanguage:'en'});assert.equal(d.file,f);assert.equal(d.name,'Preserved');assert.equal(d.previewConfirmed,true);assert.equal(d.parsed.sessions[0].rawTranscript.text,before.text);assert.equal(d.parsed.sessions[0].rawTranscript.textSha256,before.textSha256);assert.equal(d.parsed.sessions[0].rawTranscript.timePolicy.timezone,'+03:00');assert.equal(d.rawImportOptions.outputLanguage,'en');
});
test('structured standard workbooks retain their existing parser contract',async()=>{
 const bytes=await createBusinessXlsx({sample:true}),parsed=await api.parseConsultationFile(file(bytes),{scene:'新品产品咨询'});assert.equal(parsed.valid,true,parsed.errors?.join(';'));assert.notEqual(parsed.inputMode,'raw-transcript-v1');assert.ok(parsed.sessions[0].turns.length);assert.ok(parsed.sessions[0].startedAt);
});

test('multiple raw sheets remain explicit and a selected source sheet is honored',async()=>{const {workbook}=await import('../public/io.mjs'),bytes=await workbook(['Raw A','Raw B'].map((name,i)=>({name,headers:['会话ID','客服','消息详情'],rows:[['SYN-'+i,'Agent','Literal source '+i]]}))),file={name:'multi.xlsx',size:bytes.length,arrayBuffer:async()=>bytes};const initial=await api.parseConsultationFile(file);assert.equal(initial.valid,false);assert.equal(initial.availableSheetNames.length,2);assert.match(api.rawImportFields({parsed:initial}),/raw-source-sheet/);const chosen=await api.parseConsultationFile(file,{selectedSheet:'Raw B'});assert.equal(chosen.valid,true);assert.equal(chosen.sessions[0].rawTranscript.sheet,'Raw B');assert.equal(chosen.sessions[0].rawTranscript.text,'Literal source 1');});
