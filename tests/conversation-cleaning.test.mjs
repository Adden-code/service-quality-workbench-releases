import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {workbook} from '../public/io.mjs';

const publicUrl=new URL('../public/conversation-cleaning.mjs',import.meta.url);
const serverUrl=new URL('../server/conversation-cleaning.mjs',import.meta.url);
const api=existsSync(publicUrl)?await import(publicUrl):{};
const server=existsSync(serverUrl)?await import(serverUrl):{};
const input={scene:'新品产品咨询',sourceName:'合成业务.xlsx',sheet:'业务',row:2,sessionId:'SYN-1',agent:'合成客服',text:'😀\r\n[2026-11-11 09:00:00] 客户：合成问题\r\n[2026-11-11 09:00:04] 客服：合成回答',timezone:'+08:00'};
const first='[2026-11-11 09:00:00] 客户：合成问题';
const second='[2026-11-11 09:00:04] 客服：合成回答';
const wire=()=>({segments:[{kind:'message',sourceQuote:first,textQuote:'合成问题',role:'客户',roleQuote:'客户',atQuote:'2026-11-11 09:00:00'},{kind:'message',sourceQuote:second,textQuote:'合成回答',role:'客服',roleQuote:'客服',atQuote:'2026-11-11 09:00:04'}],warnings:[]});
const file=bytes=>({name:'合成业务.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
const source={sha256:'a'.repeat(64),name:'合成业务.xlsx',size:100,createdAt:'2026-11-11T00:00:00Z'};
const now='2026-11-11T10:00:00+08:00';
async function draft(rows=[['SYN-1','合成客服',input.text]]){
 const bytes=await workbook([{name:'业务',headers:['会话ID','客服','消息详情'],rows}]);
 const result=await api.inspectConversationCleaningFile(file(bytes),{scene:input.scene,timezone:'+08:00'});
 assert.equal(result.valid,true,result.errors.join(';'));return result.draft;
}
function fixRow(value,row=2){
 let next=api.updateCleaningField(value,row,null,'startedAt','2026-11-11T09:00:00+08:00',{reason:'人工核对首条消息时间',now});
 next=api.updateCleaningField(next,row,null,'completeness','完整',{reason:'人工对照原件确认完整',now});return next;
}

test('cleaning exports the bounded source-only preparation contract',()=>{
 assert.equal(typeof server.prepareCleaningPrompt,'function');
 const result=server.prepareCleaningPrompt(input);
 assert.equal(result.input.text,input.text);assert.equal(result.maxTokens,16384);
 assert.match(result.messages[0].content,/人工|待核对/);assert.match(result.messages[0].content,/指令/);
 assert.throws(()=>server.prepareCleaningPrompt({...input,text:'x'.repeat(server.MAX_CLEANING_CELL_CHARS+1)}),{code:'INPUT_TOO_LARGE'});
 assert.throws(()=>server.prepareCleaningPrompt({...input,expectedRuleIds:['GOLD']}),{code:'INVALID_INPUT'});
});
test('exact UTF16 spans and field sources preserve emoji and CRLF without source mutation',()=>{
 const result=server.parseCleaningResult(JSON.stringify(wire()),input);
 const messages=result.segments.filter(s=>s.kind==='message');
 assert.equal(messages[0].sourceLocator.start,4);
 assert.equal(messages[0].at,'2026-11-11T09:00:00+08:00');
 assert.equal(input.text.slice(messages[0].fieldSources.text.start,messages[0].fieldSources.text.end),'合成问题');
 assert.equal(result.segments.map(s=>s.sourceQuote).join(''),input.text);
 assert.equal(result.unparsedCount,1,'non-whitespace omitted prefix remains a visible unparsed segment');
});
test('ambiguous quotes, overlapping spans and invented message text reject the complete response',()=>{
 assert.throws(()=>server.parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:'重复',textQuote:'重复',role:'客户'}]}),{...input,text:'重复\n重复'}),{code:'INVALID_OUTPUT'});
 const repeated={...input,text:'重复\n重复'};
 const valid=server.parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:'重复',sourceLocator:{start:3,end:5},textQuote:'重复',role:'客户'}]}),repeated);
 assert.equal(valid.segments.find(s=>s.kind==='message').sourceLocator.start,3);
 assert.throws(()=>server.parseCleaningResult(JSON.stringify({segments:[wire().segments[0],wire().segments[0]]}),input),{code:'INVALID_OUTPUT'});
 assert.throws(()=>server.parseCleaningResult(JSON.stringify({segments:[{...wire().segments[0],textQuote:'原文没有的话'}]}),input),{code:'INVALID_OUTPUT'});
});
test('time-only and absent dates remain empty; semantic role proposals are visibly inferred',()=>{
 const result=server.parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:'09:00 合成问题',textQuote:'合成问题',role:'客户',atQuote:'09:00'}]}),{...input,text:'09:00 合成问题'});
 assert.equal(result.segments[0].at,'');assert.equal(result.segments[0].fieldSources.role.kind,'ai-inferred');
 assert.ok(result.segments[0].warnings.some(s=>/日期|时间/.test(s)));
});
test('all raw rows including blank identifiers and messages survive local inspection',async()=>{
 const value=await draft([['SYN-1','合成客服',input.text],['','合成客服','无法切分的合成原文'],['SYN-3','合成客服','']]);
 assert.equal(value.rows.length,3);assert.deepEqual(value.rows.map(r=>r.row),[2,3,4]);
 assert.equal(value.rows[1].original.id,'');assert.equal(value.rows[2].original.text,'');
 assert.equal(value.rows[0].segments[0].kind,'unparsed');
 assert.equal(value.rows[0].fields.startedAt,'');assert.equal(value.rows[0].fields.completeness,'');
});
test('unresolved content and unsigned manual additions block confirmation',async()=>{
 let value=await draft();
 assert.throws(()=>api.confirmCleaningRow(value,2,{reviewer:'合成审核人',now}),/起草|片段|处理/);
 value=api.applyCleaningResult(value,2,server.parseCleaningResult(JSON.stringify(wire()),input),{now});
 value=fixRow(value);
 assert.throws(()=>api.confirmCleaningRow(value,2,{reviewer:'合成审核人',now}),/片段|未处理/);
 value=api.updateCleaningField(value,2,0,'included',false,{reason:'合成前缀不是会话发言；仍保留在报告',now});
 value=api.updateCleaningField(value,2,1,'role','客服',{now});
 assert.throws(()=>api.confirmCleaningRow(value,2,{reviewer:'合成审核人',now}),/原因/);
});
test('confirmed human corrections produce actual standard two-sheet bytes and original preflight',async()=>{
 let value=api.applyCleaningResult(await draft(),2,server.parseCleaningResult(JSON.stringify(wire()),input),{now});
 value=fixRow(value);
 value=api.updateCleaningField(value,2,0,'included',false,{reason:'合成前缀不是发言，保留来源',now});
 value=api.updateCleaningField(value,2,1,'role','客服',{reason:'合成人工改判测试',now});
 value=api.confirmCleaningRow(value,2,{reviewer:'合成审核人',now});
 const result=await api.finalizeCleaningDraft(value,{reviewer:'合成审核人',source,now});
 assert.equal(result.valid,true,result.errors.join(';'));assert.equal(result.sessions.length,1);assert.equal(result.turnCount,2);
 assert.equal(result.sessions[0].turns[0].role,'客服');assert.ok(result.bytes.byteLength>0);
 assert.equal(result.cleaningReportSnapshot.counts.sourceRows,1);
 assert.equal(result.cleaningReportSnapshot.counts.includedSessions,1);
 assert.equal(result.cleaningReportSnapshot.counts.excludedSegments,1);
 assert.equal(result.cleaningReportSnapshot.counts.roleChanges,1);
 assert.equal(api.validateCleaningReportSnapshot(result.cleaningReportSnapshot,{source,sessions:result.sessions}),true);
 const bad=structuredClone(result.cleaningReportSnapshot);bad.counts.roleChanges=0;
 assert.throws(()=>api.validateCleaningReportSnapshot(bad,{source,sessions:result.sessions}),/计数/);
 const changed=structuredClone(result.sessions);changed[0].turns[0].text='篡改内容';
 assert.throws(()=>api.validateCleaningReportSnapshot(result.cleaningReportSnapshot,{source,sessions:changed}),/会话|一致/);
});
test('row exclusion requires a reason and remains in the saved report',async()=>{
 let value=await draft([['SYN-1','合成客服',input.text],['SYN-2','合成客服','坏格式合成原文']]);
 value=api.updateCleaningField(value,3,null,'excluded',true,{now});
 assert.throws(()=>api.confirmCleaningRow(value,3,{reviewer:'合成审核人',now}),/原因/);
 value=api.updateCleaningField(value,3,null,'excluded',true,{reason:'人工排除合成坏行；未丢弃原件',now});
 value=api.confirmCleaningRow(value,3,{reviewer:'合成审核人',now});
 assert.equal(value.rows.length,2);assert.equal(value.rows[1].confirmed,true);
});
test('editing a confirmed field revokes row confirmation and preserves prior candidate',async()=>{
 const simple={...input,text:first};
 let value=await draft([['SYN-1','合成客服',first]]);
 value=api.applyCleaningResult(value,2,server.parseCleaningResult(JSON.stringify({segments:[wire().segments[0]]}),simple),{now});
 value=api.confirmCleaningRow(fixRow(value),2,{reviewer:'合成审核人',now});
 value=api.updateCleaningField(value,2,0,'text','人工更正合成问题',{reason:'修正合成转写',now});
 assert.equal(value.rows[0].confirmed,false);
 assert.equal(value.rows[0].segments[0].text,'人工更正合成问题');
 assert.equal(value.rows[0].segments[0].candidate.text,'合成问题');
});
test('duplicate edited IDs and invalid calendar times still fail the shared business preflight',async()=>{
 const value=await draft([['SYN-1','合成客服',first]]);
 const parsed=server.parseCleaningResult(JSON.stringify({segments:[wire().segments[0]]}),{...input,text:first});
 let next=fixRow(api.applyCleaningResult(value,2,parsed,{now}));
 next=api.updateCleaningField(next,2,null,'startedAt','2026-02-30T09:00:00+08:00',{reason:'合成无效日历负例',now});
 assert.throws(()=>api.confirmCleaningRow(next,2,{reviewer:'合成审核人',now}),/时间|日期/);
});
test('saved audit rejects candidate-source fabrication and disguised separator omissions',async()=>{
 let value=await draft([['SYN-1','合成客服',first]]);
 value=api.applyCleaningResult(value,2,server.parseCleaningResult(JSON.stringify({segments:[wire().segments[0]]}),{...input,text:first}),{now});
 value=api.confirmCleaningRow(fixRow(value),2,{reviewer:'合成审核人',now});
 const result=await api.finalizeCleaningDraft(value,{source,reviewer:'合成审核人',now});
 assert.equal(result.valid,true,result.errors.join(';'));
 for(const field of ['text','at']){
  const bad=structuredClone(result.cleaningReportSnapshot),segment=bad.rows[0].segments[0];
  segment[field]=segment.candidate[field]=field==='text'?'来源没有的合成发言':'2026-11-12T09:00:00+08:00';
  assert.throws(()=>api.validateCleaningReportSnapshot(bad,{source}),/来源|原文|草稿/);
 }
 const bad=structuredClone(result.cleaningReportSnapshot);bad.rows[0].fields.topic='无来源的合成主题';
 assert.throws(()=>api.validateCleaningReportSnapshot(bad,{source}),/原因|来源/);
 const dropped=structuredClone(result.cleaningReportSnapshot);dropped.rows[0].segments[0].kind='separator';
 assert.throws(()=>api.validateCleaningReportSnapshot(dropped,{source}),/片段|来源|改判/);
});
test('manual source-bound splitting preserves all raw characters and the prior candidate',async()=>{
 let value=await draft([['SYN-1','合成客服','合成上句\n合成下句']]);
 assert.equal(typeof api.splitCleaningSegment,'function');
 assert.throws(()=>api.splitCleaningSegment(value,2,0,5,{now}),/原因/);
 value=api.splitCleaningSegment(value,2,0,5,{reason:'人工按原文换行校正消息边界',now});
 assert.equal(value.rows[0].segments.length,2);
 assert.equal(value.rows[0].segments.map(segment=>segment.sourceQuote).join(''),'合成上句\n合成下句');
 assert.equal(value.rows[0].history[0].operation,'split');
 assert.equal(value.rows[0].history[0].previous.sourceQuote,'合成上句\n合成下句');
 assert.equal(value.rows[0].confirmed,false);
});
test('manual audit from/to values cannot disagree with candidate and confirmed field values',async()=>{
 let value=await draft([['SYN-1','合成客服',first]]);
 value=fixRow(api.applyCleaningResult(value,2,server.parseCleaningResult(JSON.stringify({segments:[wire().segments[0]]}),{...input,text:first}),{now}));
 value=api.updateCleaningField(value,2,0,'role','客服',{reason:'合成人工改判',now});
 value=api.confirmCleaningRow(value,2,{reviewer:'合成审核人',now});
 const result=await api.finalizeCleaningDraft(value,{source,reviewer:'合成审核人',now});assert.equal(result.valid,true);
 for(const property of ['from','to']){
  const bad=structuredClone(result.cleaningReportSnapshot);bad.rows[0].segments[0].manual.role[property]='系统';
  assert.throws(()=>api.validateCleaningReportSnapshot(bad,{source}),/留痕|改判|一致/);
 }
});
test('first-message-time adoption stays explicit and its source audit is checked on finalization',async()=>{
 let value=await draft([['SYN-1','合成客服',first]]);
 value=api.applyCleaningResult(value,2,server.parseCleaningResult(JSON.stringify({segments:[wire().segments[0]]}),{...input,text:first}),{now});
 assert.equal(value.rows[0].fields.startedAt,'');
 assert.equal(api.firstVerifiedCleaningMessageTime(value,2).value,'2026-11-11T09:00:00+08:00');
 value=api.adoptFirstCleaningMessageTime(value,2,{now});
 value=api.updateCleaningField(value,2,null,'completeness','完整',{reason:'合成完整性核对',now});
 value=api.confirmCleaningRow(value,2,{reviewer:'合成审核人',now});
 const result=await api.finalizeCleaningDraft(value,{source,reviewer:'合成审核人',now});assert.equal(result.valid,true,result.errors.join(';'));
 const bad=structuredClone(result.cleaningReportSnapshot);bad.rows[0].manual.startedAt.origin.start++;
 assert.throws(()=>api.validateCleaningReportSnapshot(bad,{source}),/首条|来源/);
});
test('a later timestamp or a manually added first-message time cannot masquerade as source first time',async()=>{
 const text='客户：合成问题\n'+second;
 let value=await draft([['SYN-1','合成客服',text]]);
 value=api.applyCleaningResult(value,2,server.parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:'客户：合成问题',textQuote:'合成问题',role:'客户',roleQuote:'客户'},wire().segments[1]]}),{...input,text}),{now});
 assert.equal(api.firstVerifiedCleaningMessageTime(value,2),null);
 value=api.updateCleaningField(value,2,0,'at','2026-11-11T09:00:00+08:00',{reason:'人工补录合成时间',now});
 assert.equal(api.firstVerifiedCleaningMessageTime(value,2),null);
 assert.throws(()=>api.adoptFirstCleaningMessageTime(value,2,{now}),/首条|来源/);
});
