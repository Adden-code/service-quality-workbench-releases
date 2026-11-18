import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {publishedFixture,sourceRow,cutoff} from './v21-runtime-fixtures.mjs';
import {EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {readXlsx,workbook,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {timeJudgment} from '../server/ecommerce-engine.mjs';
import {createBusinessDeliverySnapshot,BUSINESS_RULES,businessDeliveryHeaders,buildBusinessDeliveryXlsx,selectBusinessErrorCases,formatBusinessReason} from '../public/business-delivery.mjs';

const ai=(session,verdicts=Array(5).fill('符合'))=>{
 session.aiExecution={status:'completed',runId:'delivery-ai'};
 session.aiResults=EC_RULE_IDS.map((ruleId,index)=>({ruleId,verdict:verdicts[index],reason:`合成${ruleId}判定理由`,evidence:[],referenceIds:[]}));
};
function fixture(rows=[sourceRow()]){
 const {state}=publishedFixture(rows);state.tasks[0].aiRun={id:'delivery-ai',inspectionAt:cutoff};return state;
}
const snapshot=(state,options={})=>createBusinessDeliverySnapshot(state,{taskId:state.tasks[0].id,now:'2026-11-04T09:00:00+08:00',...options});
const rowWith=(row,change)=>{const value=sourceRow({row});change(value.ecommerce.raw);return value;};

test('combined final uses confirmed > historical > AI while unconfirmed drafts never overwrite',()=>{
 const state=fixture([rowWith(3,raw=>{raw[15]='Pass';raw[16]='Fail';raw[17]='';raw[18]='Pass';raw[19]='';raw[20]='Fail';raw[21]='历史文本问题，需修正措辞。';})]);
 const s=state.sessions[0];ai(s);s.review.status='已确认';s.review.drafts['EC-TIME']={ruleId:'EC-TIME',verdict:'不符合',reason:'本次复核时效超出标准。'};
 const before=JSON.stringify(state),value=snapshot(state),r=value.records[0];
 assert.deepEqual(r.final.map(item=>item.source),['confirmed','historical','ai','historical','ai']);
 assert.deepEqual(r.final.map(item=>item.verdict),['不通过','不通过','通过','通过','通过']);assert.equal(r.finalOverall,'不通过');
 assert.equal(value.metrics.correctedRecords,1);assert.equal(value.metrics.confirmedCorrections,1);assert.equal(value.metrics.historicalCorrections,1);assert.equal(value.metrics.historicalDifferenceRecords,1);
 assert.match(r.summary,/人工纠正：/);assert.match(r.summary,/本次/);assert.match(r.summary,/历史/);assert.equal(JSON.stringify(state),before);
 s.review.status='已暂存';assert.equal(snapshot(state).records[0].final[0].source,'historical');
 const onlyAI=snapshot(state,{conclusionMode:'ai'});assert.ok(onlyAI.records[0].final.every(item=>item.source==='ai'));assert.equal(onlyAI.records[0].finalOverall,'通过');assert.equal(onlyAI.metrics.correctedRecords,0);
});

test('raw historical columns remain original, missing AI does not borrow historical as AI',()=>{
 const state=fixture([rowWith(3,raw=>{for(let i=15;i<20;i++)raw[i]='Fail';raw[20]='Pass';})]);
 const r=snapshot(state).records[0];assert.equal(r.hasAI,false);assert.ok(r.ai.every(item=>item.verdict==='待判定'&&item.source==='none'));assert.equal(r.aiOverall,'待判定');assert.equal(r.finalOverall,'不通过');assert.equal(r.historicalOverall,'通过');
 assert.equal(snapshot(state).metrics.correctedRecords,0);
 state.sessions[0].aiExecution={status:'failed'};state.sessions[0].aiResults=EC_RULE_IDS.map(ruleId=>({ruleId,verdict:'符合',reason:'未完整结果',evidence:[],referenceIds:[]}));assert.equal(snapshot(state).records[0].hasAI,false);
 delete state.sessions[0].expectedRuleIds;assert.equal(snapshot(state).records[0].hasAI,false,'旧记录无预期规则列表也必须先完成AI执行');
});

test('overall and per-rule metrics expose unresolved/unreplied and use determinate denominators',()=>{
 const rows=[sourceRow({row:3,type:'好评正向'}),sourceRow({row:4,type:'好评负向'}),sourceRow({row:5,type:'中评'}),sourceRow({row:6,reply:'',replyAt:'',type:'差评'})],state=fixture(rows);
 state.sessions.forEach(s=>{for(let i=15;i<=20;i++)s.ecommerce.raw[i]='';});
 ai(state.sessions[0]);ai(state.sessions[1],['不符合','符合','符合','符合','符合']);ai(state.sessions[2],['无法判定','符合','符合','符合','符合']);ai(state.sessions[3],Array(5).fill('无法判定'));
 const value=snapshot(state),m=value.metrics;assert.deepEqual([m.total,m.passed,m.failed,m.pending,m.unreplied,m.determinate,m.passRate],[4,1,1,1,1,2,50]);
 assert.equal(value.records[3].aiOverall,'待判定','AI初判整体仍限定三值，未回复只用于最终整体');
 assert.deepEqual(m.ruleStats[0].final,{passed:1,failed:1,pending:1,denominator:2,passRate:50});assert.equal(m.typeDistribution.reduce((sum,item)=>sum+item.count,0),4);
 const zero=fixture([sourceRow({reply:'',replyAt:''})]);assert.equal(snapshot(zero).metrics.passRate,null);assert.equal(snapshot(zero).records[0].finalOverall,'未回复');
 // The source fact also applies to an existing V1 task without a stage-A snapshot.
 delete zero.tasks[0].basisSnapshot.ruleSetSnapshot;assert.equal(snapshot(zero).records[0].replyStatus,'unreplied');
 state.sessions[0].aiResults[0].verdict='不适用';assert.equal(snapshot(state,{conclusionMode:'ai'}).records[0].ai[0].verdict,'待判定');
});

test('snapshot preserves per-result cutoff and rejects incompatible source rows or headers',()=>{
 const state=fixture([sourceRow({row:7}),sourceRow({row:3})]);ai(state.sessions[0]);ai(state.sessions[1]);
 state.tasks[0].aiRun={id:'newer-run',inspectionAt:'2026-11-04T08:00:00+08:00'};state.tasks[0].aiRunHistory=[{id:'delivery-ai',inspectionAt:cutoff}];
 state.sessions[0].aiResults[0].timeFacts={inspectionAt:cutoff,mode:'workingHours',elapsedMs:7200000,thresholdHours:24};
 const value=snapshot(state);assert.deepEqual(value.records.map(r=>r.sourceRow),[3,7]);assert.equal(value.records[1].inspectionAt,cutoff);assert.deepEqual(value.basis.inspectionAts,[cutoff]);
 for(const change of [s=>s.sessions[1].ecommerce.row=7,s=>s.sessions[0].ecommerce.row=2,s=>s.sessions[0].ecommerce.headers[0]='另一个字段',s=>s.sessions[0].ecommerce.standards[0]='另一个标准']){const bad=structuredClone(state);change(bad);assert.throws(()=>snapshot(bad));}
 assert.throws(()=>snapshot(state,{conclusionMode:'unknown'}));assert.throws(()=>snapshot(state,{targetLang:'fr'}));assert.throws(()=>snapshot(state,{taskId:'missing'}));
});

test('reason summaries format durations only, preserve IDs, and bound each item to70 code points',()=>{
 const state=fixture();for(let i=15;i<=20;i++)state.sessions[0].ecommerce.raw[i]='';ai(state.sessions[0],['不符合','不符合','符合','符合','符合']);
 state.sessions[0].aiResults[0].reason='连续自然时间25.555555小时（92000000毫秒），订单编码1234567890123456789未改。';
 state.sessions[0].aiResults[1].reason='问题位置🙂'.repeat(30);
 const r=snapshot(state,{conclusionMode:'ai'}).records[0];assert.match(r.summary,/25\.6小时/);assert.ok(!r.summary.includes('92000000'));assert.ok(!r.summary.includes('毫秒'));assert.match(r.summary,/1234567890123456789/);
 assert.ok(r.summary.split('；').every(item=>Array.from(item).length<=70));assert.ok(!r.summary.includes('\uFFFD'));
});

test('legacy time summaries retain measured hours and threshold instead of clipping at the two timestamps',()=>{
 const state=fixture();delete state.tasks[0].basisSnapshot.ruleSetSnapshot;for(let i=15;i<=20;i++)state.sessions[0].ecommerce.raw[i]='';ai(state.sessions[0]);
 state.sessions[0].aiResults[0]=timeJudgment(state.sessions[0]);const value=snapshot(state,{conclusionMode:'ai'});
 assert.match(value.records[0].summary,/65\.0小时/);assert.match(value.records[0].summary,/1\.0小时/);assert.ok(Array.from(value.records[0].summary).length<=70);
});

test('duration context never rewrites the same reason text belonging to another inspection dimension',()=>{
 const record={time:{elapsedMs:3600000,thresholdHours:24,mode:'continuous'},ai:[{id:'EC-TIME',source:'ai',reason:'合成相同理由',verdict:'不通过'}]};
 assert.equal(formatBusinessReason('合成相同理由',{record,ruleId:'EC-TEXT'}),'合成相同理由');assert.equal(formatBusinessReason('合成相同理由',{record}),'合成相同理由');
});

test('error cases cover five dimensions, include longest failing time and never duplicate or select unreplied',()=>{
 const state=fixture(Array.from({length:7},(_,i)=>sourceRow({row:i+3})));state.sessions.forEach((s,index)=>{for(let i=15;i<=20;i++)s.ecommerce.raw[i]='';const verdicts=Array(5).fill('符合');verdicts[index%5]='不符合';ai(s,verdicts);if(index===5)s.aiResults[0].timeFacts={elapsedMs:999999999,inspectionAt:cutoff,thresholdHours:24,mode:'workingHours'};});
 const value=snapshot(state,{conclusionMode:'ai'}),cases=selectBusinessErrorCases(value,5);assert.equal(cases.length,5);assert.equal(new Set(cases.map(r=>r.id)).size,5);assert.ok(cases.some(r=>r.sourceRow===8));
 assert.deepEqual(new Set(cases.flatMap(r=>r.final.filter(item=>item.verdict==='不通过').map(item=>item.id))),new Set(EC_RULE_IDS));assert.deepEqual(selectBusinessErrorCases(value,0),[]);
});

test('business Excel has43 columns, original names/raw, row2 criteria and sparse physical rows with language columns',async()=>{
 const state=fixture([sourceRow({row:7,reply:'Exact English reply.'}),sourceRow({row:3,reply:'Exact English reply.'})]);state.sessions.forEach(s=>ai(s));state.sessions[0].ecommerce.headers[14]='评价类型 好评正向：4-5分';state.sessions[1].ecommerce.headers[14]=state.sessions[0].ecommerce.headers[14];
 const value=snapshot(state,{targetLang:'en'}),translations=Object.fromEntries(value.records.map((r,i)=>[r.id,{comment:{status:i?'failed':'translated',text:'Translated comment'},reply:{status:'same',text:r.raw22[9],detectedLanguage:'en'}}]));
 const bytes=await buildBusinessDeliveryXlsx(value,{translations}),tables=await readXlsx(bytes),main=tables['检核明细'];assert.ok(main);assert.equal(main[0].length,43);assert.deepEqual(main[0].slice(0,22),value.headers22);assert.deepEqual(main[1].slice(0,22),value.standards22);
 assert.equal(businessDeliveryHeaders(value).length,43);assert.match(main[0][22],/英文/);assert.match(main[0][23],/英文/);
 for(const r of value.records){const row=main.find(row=>row[XLSX_ROW_NUMBER]===r.sourceRow);assert.ok(row);assert.deepEqual(row.slice(0,22),r.raw22);assert.equal(row[23],r.raw22[9]);}
 assert.equal(main.find(row=>row[XLSX_ROW_NUMBER]===3)[22],'Translated comment');assert.equal(main.find(row=>row[XLSX_ROW_NUMBER]===7)[22],'');
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.deepEqual([...xml.matchAll(/<row r="(\d+)"/g)].map(m=>Number(m[1])),[1,2,3,7]);assert.ok(xml.includes('AQ7'));assert.ok(tables['口径说明']);
});

test('optional workbook rowNumbers reject conflicts and preserve legacy default numbering',async()=>{
 const sheet={name:'rows',headers:['字段'],rows:[['说明'],['数据']]};
 for(const rowNumbers of [[2,2],[1,3],[3,2],[2],[2,1048577],[2,3.5],'2,3'])await assert.rejects(workbook([{...sheet,rowNumbers}]));
 const legacy=await readXlsx(await workbook([sheet]));assert.deepEqual(legacy.rows.map(r=>r[XLSX_ROW_NUMBER]),[1,2,3]);
 const sparse=await readXlsx(await workbook([{...sheet,rowNumbers:[2,1048576]}]));assert.deepEqual(sparse.rows.map(r=>r[XLSX_ROW_NUMBER]),[1,2,1048576]);
});

test('Excel long translated text uses complete continuation rows without changing43 columns or snapshot',async()=>{
 const state=fixture();ai(state.sessions[0]);const value=snapshot(state),before=JSON.stringify(value),long='长译文🙂'.repeat(9000);
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(value,{translations:{[value.records[0].id]:{comment:{status:'translated',text:long},reply:{status:'empty',text:''}}}}));
 const main=tables['检核明细'];assert.equal(main[0].length,43);const key=main[2][22].match(/长文本留存：(TEXT-\d+)/)?.[1];assert.ok(key);
 assert.equal(tables['长文本留存'].slice(1).filter(row=>row[0]===key).map(row=>row[3]).join(''),long);assert.equal(JSON.stringify(value),before);for(const sheet of Object.values(tables))for(const row of sheet)for(const cell of row)assert.ok(cell.length<=32767);
});

test('Excel discloses missing translations and never marks empty source text as same-language',async()=>{
 const state=fixture([sourceRow({row:3}),sourceRow({row:4,reply:'',replyAt:''})]);state.sessions.forEach(s=>ai(s));const value=snapshot(state);
 const tables=await readXlsx(await buildBusinessDeliveryXlsx(value,{translations:{[value.records[0].id]:{comment:{status:'failed',text:''}},[value.records[1].id]:{reply:{status:'same',text:''}}}}));
 assert.equal(tables['检核明细'][3][23],'');assert.ok(tables['口径说明'].some(row=>row[0]==='翻译失败文本（去重）'&&row[1]==='1'));assert.ok(tables['口径说明'].some(row=>row[0]==='未完成翻译文本（去重）'));
});

test('rule order and improvement text remain stable for HTML and model consumers',()=>{assert.deepEqual(BUSINESS_RULES.map(r=>r.id),EC_RULE_IDS);assert.ok(BUSINESS_RULES.every(r=>r.label&&r.shortLabel&&r.improvement));});
