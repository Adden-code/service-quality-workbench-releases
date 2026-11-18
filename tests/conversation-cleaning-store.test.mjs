import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {workbook} from '../public/io.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {parseCleaningResult} from '../server/conversation-cleaning.mjs';
import {inspectConversationCleaningFile,applyCleaningResult,updateCleaningField,confirmCleaningRow,finalizeCleaningDraft} from '../public/conversation-cleaning.mjs';

const now='2026-11-11T10:00:00+08:00';
const raw='2026-11-11 09:00:00 客户：合成问题';
const asFile=(bytes,name='合成业务.xlsx')=>({name,size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
async function bytesFor(text=raw,id='SYN-1'){return workbook([{name:'业务',headers:['会话ID','客服','消息详情'],rows:[[id,'合成坐席',text]]}]);}
async function fixture(t){
 const base=path.resolve('tests/.cleaning-store-scratch');await fs.mkdir(base,{recursive:true});
 const directory=await fs.mkdtemp(path.join(base,'case-')),store=await createWorkspaceStore({dataDir:directory});
 t.after(async()=>{await store.close();assert.ok(directory.startsWith(base+path.sep));await fs.rm(directory,{recursive:true,force:true});});
 const catalog=createCatalog(),state=createBusinessState();
 return {directory,store,catalog,state,basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-11-11',ruleIds:['R001'],now})};
}
async function prepared(f,{actualBytes,modelBytes}={}){
 actualBytes??=await bytesFor();modelBytes??=actualBytes;
 const source=await f.store.putSource(actualBytes,'合成业务.xlsx'),file=asFile(modelBytes),inspected=await inspectConversationCleaningFile(file,{scene:'新品产品咨询',timezone:'+08:00'});
 assert.equal(inspected.valid,true,inspected.errors.join(';'));
 let draft=inspected.draft;const row=draft.rows[0],text=row.original.text;
 const input={scene:draft.scene,sourceName:file.name,sheet:draft.sheet,row:row.row,sessionId:row.original.id,agent:row.original.agent,text,timezone:'+08:00'};
 const result=parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:text,textQuote:text.slice(text.indexOf('：')+1),role:'客户',roleQuote:'客户',atQuote:'2026-11-11 09:00:00'}]}),input);
 draft=applyCleaningResult(draft,2,{...result,modelId:'synthetic-fixture',requestId:'synthetic-1'},{now});
 draft=updateCleaningField(draft,2,null,'startedAt','2026-11-11T09:00:00+08:00',{reason:'人工核对合成首条消息时间',now});
 draft=updateCleaningField(draft,2,null,'completeness','完整',{reason:'人工核对合成原件范围',now});
 draft=confirmCleaningRow(draft,2,{reviewer:'合成核对人',now});
 const parsed=await finalizeCleaningDraft(draft,{source,reviewer:'合成核对人',now});assert.equal(parsed.valid,true,parsed.errors.join(';'));
 return {source,parsed};
}
const imported=(f,value)=>createImportedTask(f.state,{name:'合成清洗任务',fileName:value.source.name,source:value.source,sessions:value.parsed.sessions,basisSnapshot:f.basisSnapshot,reviewer:'合成质检审核人',cleaningReportSnapshot:value.parsed.cleaningReportSnapshot,now});

test('confirmed synthetic cleaning survives actual domain creation and atomic source-checked store save',async t=>{
 const f=await fixture(t),value=await prepared(f),state=imported(f,value);
 const saved=await f.store.save({baseRevision:0,mutationId:'cleaned-first',state,catalog:f.catalog});
 assert.equal(saved.revision,1);assert.equal(saved.state.tasks[0].cleaningReportSnapshot.counts.includedTurns,1);
 assert.equal(saved.state.sessions[0].aiResults.length,0);assert.equal(saved.state.sessions[0].review.status,'待审核');
 await f.store.close();const reopened=await createWorkspaceStore({dataDir:f.directory});t.after(()=>reopened.close());
 const again=await reopened.read();assert.deepEqual(again.state.tasks[0].cleaningReportSnapshot,state.tasks[0].cleaningReportSnapshot);
});
test('internally consistent forged original text is rejected against immutable saved XLSX bytes',async t=>{
 const f=await fixture(t),actualBytes=await bytesFor(),modelBytes=await bytesFor('2026-11-11 09:00:00 客户：伪造问题');
 const value=await prepared(f,{actualBytes,modelBytes}),state=imported(f,value);
 await assert.rejects(f.store.save({baseRevision:0,mutationId:'forged-original',state,catalog:f.catalog}),/原文|源单元格|原件/);
 assert.equal((await f.store.read()).revision,0);
});
test('a report rebound to a different saved source is rejected even when digest metadata agrees',async t=>{
 const f=await fixture(t),value=await prepared(f),other=await f.store.putSource(await bytesFor(raw,'SYN-9'),'另一合成.xlsx');
 value.source=other;value.parsed.cleaningReportSnapshot.source=structuredClone(other);
 const state=imported(f,value);
 await assert.rejects(f.store.save({baseRevision:0,mutationId:'wrong-source',state,catalog:f.catalog}),/源单元格|原文|原件/);
});
test('saved cleaning reports remain immutable during subsequent workspace saves',async t=>{
 const f=await fixture(t),value=await prepared(f),state=imported(f,value);
 const first=await f.store.save({baseRevision:0,mutationId:'immutable-first',state,catalog:f.catalog});
 const changed=structuredClone(first.state);changed.tasks[0].cleaningReportSnapshot.reviewer='另一个操作标签';
 await assert.rejects(f.store.save({baseRevision:1,mutationId:'immutable-second',state:changed,catalog:f.catalog}),/不可|改写/);
 assert.deepEqual((await f.store.read()).state.tasks[0].cleaningReportSnapshot,first.state.tasks[0].cleaningReportSnapshot);
});
