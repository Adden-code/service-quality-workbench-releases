import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook} from '../public/io.mjs';
import {inspectConversationCleaningFile,applyCleaningResult,updateCleaningField,splitCleaningSegment,confirmCleaningRow,finalizeCleaningDraft,validateCleaningReportSnapshot} from '../public/conversation-cleaning.mjs';
import {parseCleaningResult} from '../server/conversation-cleaning.mjs';

const tick=index=>new Date(Date.UTC(2026,10,11,0,0,index)).toISOString();
const reviewer='Synthetic audit reviewer';
async function prepared(original='Synthetic source message'){
 const bytes=await workbook([{name:'synthetic',headers:['会话ID','客服','消息详情'],rows:[['SYN-AUDIT','synthetic agent',original]]}]);
 const file={name:'synthetic-audit.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
 const inspected=await inspectConversationCleaningFile(file);assert.equal(inspected.valid,true,inspected.errors.join(';'));
 const input={scene:inspected.draft.scene,sourceName:file.name,sheet:'synthetic',row:2,sessionId:'SYN-AUDIT',agent:'synthetic agent',text:original,timezone:''};
 const candidate=parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:original,textQuote:original,role:'客户'}]}),input);
 return {draft:applyCleaningResult(inspected.draft,2,candidate,{now:tick(0)}),source:{sha256:'c'.repeat(64),name:file.name,size:bytes.byteLength},original};
}
function ready(value,index=400){
 let draft=updateCleaningField(value,2,null,'startedAt','2026-11-11T09:00:00+08:00',{reason:'Synthetic start verified from source records.',now:tick(index)});
 return updateCleaningField(draft,2,null,'completeness','完整',{reason:'Synthetic source completeness checked.',now:tick(index+1)});
}
async function finalized(draft,source,index=410){
 const confirmed=confirmCleaningRow(draft,2,{reviewer,now:tick(index)});
 const result=await finalizeCleaningDraft(confirmed,{source,reviewer,now:tick(index+1)});
 assert.equal(result.valid,true,result.errors.join(';'));return result;
}

test('300 keystrokes near the 20000-character business limit produce one replayable text change and a bounded report',async()=>{
 const original='甲'.repeat(19500),fixture=await prepared(original);let draft=fixture.draft;
 for(let index=1;index<=300;index++)draft=updateCleaningField(draft,2,0,'text',original+'乙'.repeat(index),{now:tick(index)});
 const edited=original+'乙'.repeat(300);
 draft=updateCleaningField(draft,2,0,'text',edited,{reason:'Synthetic continuous edit verified.',now:tick(301)});
 const events=draft.rows[0].history.filter(event=>event.field==='text');
 assert.equal(events.length,1,'continuous typing is one field edit, not 300 full-text events');
 assert.equal(events[0].from,original);assert.equal(events[0].to,edited);
 assert.equal(events[0].reason,'Synthetic continuous edit verified.');assert.equal(events[0].at,tick(1));assert.equal(events[0].updatedAt,tick(301));
 assert.equal(draft.rows[0].segments[0].candidate.text,original);assert.equal(fixture.draft.rows[0].segments[0].text,original);
 const result=await finalized(ready(draft),fixture.source);
 assert.equal(result.sessions[0].turns[0].text.length,19800);
 const report=result.cleaningReportSnapshot,reportBytes=Buffer.byteLength(JSON.stringify(report));
 assert.ok(reportBytes<1024*1024,`one synthetic edited row must stay below 1 MiB, got ${reportBytes}`);
 assert.equal(report.counts.manualChanges,3);assert.equal(report.counts.roleChanges,0);
 assert.equal(validateCleaningReportSnapshot(report,{source:fixture.source,sessions:result.sessions}),true);
 const bad=structuredClone(report);bad.rows[0].history.find(event=>event.field==='text').from='fabricated pre-edit text';
 assert.throws(()=>validateCleaningReportSnapshot(bad,{source:fixture.source,sessions:result.sessions}),/留痕|来源|一致/);
});

test('cross-field edit bursts stay separate and replay in order without inflating final role-change counts',async()=>{
 const fixture=await prepared();let draft=fixture.draft;
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' A',{reason:'Synthetic text edit.',now:tick(1)});
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' AB',{reason:'Synthetic text edit.',now:tick(2)});
 draft=updateCleaningField(draft,2,0,'role','客服',{reason:'Synthetic role correction.',now:tick(3)});
 draft=updateCleaningField(draft,2,0,'role','系统',{reason:'Synthetic role correction.',now:tick(4)});
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' ABC',{reason:'Synthetic second text edit.',now:tick(5)});
 const history=draft.rows[0].history;assert.deepEqual(history.map(event=>event.field),['text','role','text']);
 const replay={text:fixture.original,role:'客户'};
 for(const event of history){assert.equal(replay[event.field],event.from);replay[event.field]=event.to;}
 assert.equal(replay.text,draft.rows[0].segments[0].text);assert.equal(replay.role,draft.rows[0].segments[0].role);
 const result=await finalized(ready(draft),fixture.source);
 assert.equal(result.cleaningReportSnapshot.counts.manualChanges,4);assert.equal(result.cleaningReportSnapshot.counts.roleChanges,1);
});

test('confirmation is a retained boundary and subsequent typing cannot rewrite the approved edit',async()=>{
 const fixture=await prepared();let draft=ready(fixture.draft,1);
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' A',{reason:'Approved first edit.',now:tick(4)});
 draft=confirmCleaningRow(draft,2,{reviewer,now:tick(5)});
 const before=structuredClone(draft.rows[0].history);
 assert.equal(before.at(-1).operation,'confirm');assert.equal(before.at(-1).reviewer,reviewer);
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' AB',{reason:'Separate edit after confirmation.',now:tick(6)});
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' ABC',{reason:'Separate edit after confirmation.',now:tick(7)});
 assert.deepEqual(draft.rows[0].history.slice(0,before.length),before);
 const texts=draft.rows[0].history.filter(event=>event.field==='text');assert.equal(texts.length,2);assert.equal(texts[1].from,texts[0].to);
 assert.equal(draft.rows[0].confirmed,false);
 const result=await finalized(draft,fixture.source);
 assert.equal(result.cleaningReportSnapshot.counts.manualChanges,3);
 assert.equal(result.cleaningReportSnapshot.rows[0].history.filter(event=>event.operation==='confirm').length,2);
});

test('editing only the reason after confirmation preserves the earlier approved reason',async()=>{
 const fixture=await prepared();let draft=ready(fixture.draft,1);
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' A',{reason:'First approved reason.',now:tick(4)});
 draft=confirmCleaningRow(draft,2,{reviewer,now:tick(5)});
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' A',{reason:'New reason checked after confirmation.',now:tick(6)});
 const events=draft.rows[0].history.filter(event=>event.field==='text');assert.equal(events.length,2);
 assert.equal(events[0].reason,'First approved reason.');assert.equal(events[1].from,events[1].to);
 assert.equal(events[1].reason,'New reason checked after confirmation.');assert.equal(draft.rows[0].confirmed,false);
});

test('splitting retains the pre-split state and starts a separate editable segment history',async()=>{
 const fixture=await prepared('ABCDEF');let draft=fixture.draft;
 draft=updateCleaningField(draft,2,0,'text','ABCDEF!',{reason:'Synthetic full-message edit.',now:tick(1)});
 draft=splitCleaningSegment(draft,2,0,3,{reason:'Synthetic source boundary correction.',now:tick(2)});
 draft=updateCleaningField(draft,2,0,'text','ABC!',{reason:'Synthetic split-message edit.',now:tick(3)});
 draft=updateCleaningField(draft,2,0,'text','ABC!!',{reason:'Synthetic split-message edit.',now:tick(4)});
 assert.equal(draft.rows[0].history.length,3);assert.equal(draft.rows[0].history[1].operation,'split');assert.equal(draft.rows[0].history[1].previous.text,'ABCDEF!');
 assert.equal(draft.rows[0].history[2].from,'ABC');assert.equal(draft.rows[0].history[2].to,'ABC!!');
 for(let index=0;index<2;index++){
  draft=updateCleaningField(draft,2,index,'kind','message',{reason:'Synthetic manual segmentation checked.',now:tick(5+index*2)});
  draft=updateCleaningField(draft,2,index,'role','客户',{reason:'Synthetic role checked.',now:tick(6+index*2)});
 }
 const result=await finalized(ready(draft),fixture.source);assert.equal(result.turnCount,2);
 const bad=structuredClone(result.cleaningReportSnapshot);bad.rows[0].history.find(event=>event.operation==='split').previous.text='tampered earlier edit';
 assert.throws(()=>validateCleaningReportSnapshot(bad,{source:fixture.source}),/留痕|来源|一致/);
});

test('history compaction leaves the 20000-character business rejection intact',async()=>{
 const fixture=await prepared('甲'.repeat(19500));let draft=ready(fixture.draft);
 draft=updateCleaningField(draft,2,0,'text',fixture.original+'乙'.repeat(501),{reason:'Synthetic oversized negative case.',now:tick(5)});
 assert.throws(()=>confirmCleaningRow(draft,2,{reviewer,now:tick(6)}),/20000|原文/);
});

test('legacy per-input history without operation markers remains readable and replayable',async()=>{
 const fixture=await prepared();let draft=ready(fixture.draft,1);
 draft=updateCleaningField(draft,2,0,'text',fixture.original+' AB',{reason:'Synthetic final text checked.',now:tick(4)});
 const result=await finalized(draft,fixture.source),legacy=structuredClone(result.cleaningReportSnapshot);
 const index=legacy.rows[0].history.findIndex(event=>event.field==='text');
 legacy.rows[0].history.splice(index,1,
  {segmentIndex:0,field:'text',from:fixture.original,to:fixture.original+' A',reason:'',at:tick(3)},
  {segmentIndex:0,field:'text',from:fixture.original+' A',to:fixture.original+' AB',reason:'Synthetic final text checked.',at:tick(4)});
 legacy.rows[0].history=legacy.rows[0].history.filter(event=>event.operation!=='confirm');
 assert.equal(validateCleaningReportSnapshot(legacy,{source:fixture.source,sessions:result.sessions}),true);
});
