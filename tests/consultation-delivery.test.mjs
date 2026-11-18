import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';

const api=await import('../public/consultation-delivery.mjs').catch(()=>({}));
const now='2026-11-04T12:00:00+08:00';
function fixture({count=1,ruleCount=3,headerRow=1}={}){
 const categories=['产品知识','服务规范','风险控制'];
 const rules=Array.from({length:ruleCount},(_,index)=>({id:`C-${index+1}`,title:`合成检查${index+1}`,name:`合成检查${index+1}`,category:index===ruleCount-1&&ruleCount>3?'整体判定原则':categories[index%3],version:'V4',passCriteria:'有事实依据',failCriteria:'缺少事实依据',exceptionCriteria:'无关不适用',policyIds:['P-1']}));
 const sessions=Array.from({length:count},(_,index)=>({id:`s-${index+1}`,taskId:'task-c',externalId:`raw-${index+1}`,scene:'新品产品咨询',startedAt:now,product:'不可据此猜产品来源',topic:'咨询',turns:[{id:1,role:'客户',text:`原文客户${index+1}`},{id:2,role:'客服',text:`原文回复${index+1}`}],expectedRuleIds:rules.map(rule=>rule.id),aiResults:[],review:{status:'待审核',drafts:{},reviewer:'合成复核人',completedAt:null,notes:''}}));
 const task={id:'task-c',name:'合成新品专项',mode:'manual',scene:'新品产品咨询',source:{name:'source.xlsx',sha256:'a'.repeat(64),size:512},sessionIds:sessions.map(row=>row.id),basisSnapshot:{capturedAt:now,effectiveDate:'2026-11-04',rules,policies:[{id:'P-1',title:'合成资料',version:'V2',sections:[{id:'P-1-1',title:'条款',text:'合成资料正文'}]}]}};
 const original={sheetName:'原始聊天',headerRow,headers:['记录号','消息详情','留档字段'],messageColumn:1,rows:sessions.map((row,index)=>({sourceRow:headerRow+1+index*4,values:[`000${index+1}`,`  整段原始消息${index+1}\n客户：问题\n客服：答复  `,index?'':''],recordId:row.id})),productSources:Object.fromEntries(sessions.map(row=>[row.id,{value:'合成产品甲',source:'任务默认'}]))};
 return{state:{schemaVersion:1,tasks:[task],sessions,activity:[]},original};
}
function complete(state,index=0,verdicts){
 const row=state.sessions[index];row.aiExecution={status:'completed',runId:'synthetic-ai'};
 row.aiResults=state.tasks[0].basisSnapshot.rules.map((rule,position)=>({ruleId:rule.id,verdict:verdicts?.[position]??'符合',reason:`判断理由${position+1}`,evidence:[1],referenceIds:['P-1@V2#P-1-1']}));
}
const snapshot=(f,options={})=>api.createConsultationDeliverySnapshot(f.state,{taskId:'task-c',original:f.original,now,...options});

test('consultation delivery exports the frozen public interface',()=>{
 for(const name of ['isConsultationTask','createConsultationDeliverySnapshot','consultationDeliveryHeaders','buildConsultationDeliveryXlsx','selectConsultationErrorCases'])assert.equal(typeof api[name],'function',`${name} must be implemented`);
});

test('snapshot uses frozen dynamic rules, preserves all source text/rows and has no fixture fallback',()=>{
 const f=fixture({count:2,ruleCount:17});complete(f.state,0);complete(f.state,1);
 f.original.rows.push({sourceRow:10,recordId:'s-1',values:['0001','第二段原文，不可丢失','尾列']});
 const before=JSON.stringify(f),s=snapshot(f);
 assert.equal(s.deliveryType,'consultation-v1');assert.equal(s.schemaVersion,1);assert.equal(s.records.length,2);
 assert.deepEqual(s.original,f.original);assert.deepEqual(s.basis.rules,f.state.tasks[0].basisSnapshot.rules);assert.deepEqual(s.basis.policies,f.state.tasks[0].basisSnapshot.policies);
 assert.deepEqual(s.records[0].sourceRows,[2,10]);assert.equal(s.records[0].conversation,f.original.rows[0].values[1]+'\n'+f.original.rows[2].values[1]);
 assert.equal(s.records[0].final.length,17);assert.deepEqual(s.basis.principleRuleIds,['C-17']);assert.ok(!s.basis.dimensions.some(d=>d.key==='整体判定原则'));
 assert.equal(JSON.stringify(f),before);s.records[0].turns[0].text='修改快照';assert.equal(f.state.sessions[0].turns[0].text,'原文客户1');
 const broken=fixture();delete broken.state.tasks[0].basisSnapshot;assert.equal(api.isConsultationTask(broken.state,broken.state.tasks[0]),false);assert.throws(()=>snapshot(broken),/冻结|依据|产品咨询/);
});

test('confirmed manual items override complete AI but drafts and metadata history never do',()=>{
 const f=fixture();complete(f.state);const row=f.state.sessions[0];
 row.metadata={'人工结论':'Fail'};row.review.status='已暂存';row.review.drafts['C-1']={ruleId:'C-1',verdict:'不符合',reason:'未确认草稿',evidence:[2]};
 assert.equal(snapshot(f).records[0].final[0].verdict,'Pass');assert.ok(snapshot(f).records[0].historical.every(r=>r.source==='none'));
 row.review.status='已确认';row.review.drafts['C-1'].reason='已确认的具体问题';row.review.completedAt=now;
 const s=snapshot(f),r=s.records[0];assert.equal(r.final[0].verdict,'Fail');assert.equal(r.final[0].source,'confirmed');assert.deepEqual(r.final[0].evidence,[2]);assert.equal(r.ai[0].verdict,'Pass');assert.equal(r.finalOverall,'不通过');
 assert.equal(s.metrics.correctedRecords,1);assert.equal(s.metrics.historicalCorrections,0);assert.match(r.summary,/人工纠正/);assert.match(s.basis.historicalPolicy,/不支持|无.*历史|未.*历史/);
 assert.equal(snapshot(f,{conclusionMode:'ai'}).records[0].final[0].source,'ai');assert.equal(snapshot(f,{conclusionMode:'ai'}).metrics.correctedRecords,0);
});

test('only a complete expected AI result set is adopted',()=>{
 for(const mutation of [s=>s.aiExecution.status='failed',s=>s.aiResults.pop(),s=>s.aiResults[1].ruleId=s.aiResults[0].ruleId,s=>delete s.expectedRuleIds,s=>s.expectedRuleIds=['different']]){
  const f=fixture();complete(f.state);mutation(f.state.sessions[0]);const r=snapshot(f).records[0];assert.equal(r.hasAI,false);assert.ok(r.ai.every(item=>item.source==='none'&&item.verdict==='待判定'));
 }
});

test('accepting an already failed AI item is manual confirmation rather than an AI correction',()=>{
 const f=fixture();complete(f.state,0,['不符合','符合','符合']);const row=f.state.sessions[0];row.review.status='已确认';row.review.drafts['C-1']={...row.aiResults[0]};
 const s=snapshot(f);assert.equal(s.metrics.correctedRecords,0);assert.match(s.records[0].summary,/人工确认/);assert.ok(!s.records[0].summary.includes('人工纠正'));
});

test('Pass Fail NA and pending remain distinct with determinate denominators at rule dimension and product level',()=>{
 const f=fixture({count:5});
 complete(f.state,0,['符合','不适用','不适用']);complete(f.state,1,['不符合','无法判定','符合']);complete(f.state,2,['不适用','不适用','不适用']);complete(f.state,3,['符合','无法判定','不适用']);
 f.original.productSources['s-3']={value:'合成产品乙',source:'任务默认'};f.original.productSources['s-4']={value:'',source:'未提供'};f.original.productSources['s-5']={value:'',source:'未提供'};
 const s=snapshot(f),m=s.metrics;
 assert.deepEqual(s.records.map(r=>r.finalOverall),['通过','不通过','NA','待判定','待判定']);assert.deepEqual([m.total,m.passed,m.failed,m.na,m.pending,m.determinate,m.passRate],[5,1,1,1,2,2,50]);
 assert.deepEqual(m.ruleStats[0].final,{passed:2,failed:1,na:1,pending:1,denominator:3,passRate:2/3*100});
 assert.equal(m.dimensionStats[0].key,'产品知识');assert.equal(m.dimensionStats[0].final.na,1);
 const a=m.byProduct.find(row=>row.product==='合成产品甲');assert.equal(a.total,2);assert.equal(a.passRate,50);
 assert.equal(m.byProduct.find(row=>row.product==='合成产品乙').na,1);assert.equal(m.byProduct.find(row=>row.product==='未提供').pending,2);
 const onlyNA=fixture();complete(onlyNA.state,0,['不适用','不适用','不适用']);assert.equal(snapshot(onlyNA).metrics.passRate,null);
});

test('products are taken solely from verified original source information and source counts are disclosed',()=>{
 const f=fixture({count:3});f.original.headers.push('产品列');f.original.rows[0].values.push('源产品');f.original.rows[1].values.push('');f.original.rows[2].values.push('');
 f.original.productSources={'s-1':{value:'源产品',source:'原表列',column:'产品列'},'s-2':{value:'导入默认产品',source:'任务默认'},'s-3':{value:'',source:'未提供'}};
 const s=snapshot(f);assert.deepEqual(s.records.map(r=>[r.product,r.productSource]),[['源产品','原表列'],['导入默认产品','任务默认'],['未提供','未提供']]);assert.equal(s.records[0].productColumn,'产品列');assert.deepEqual(s.basis.productSourceCounts,{'原表列':1,'任务默认':1,'未提供':1});
 for(const mutate of [o=>delete o.productSources['s-2'],o=>o.productSources['s-2']={value:'有值',source:'未提供'},o=>o.productSources['s-2']={value:'有值',source:'AI猜测'}]){const bad=structuredClone(f);mutate(bad.original);assert.throws(()=>snapshot(bad),/产品.*来源|产品.*未提供/);}
});

test('source rows must be authentic unique in bounds and map every task session without silently losing original columns',()=>{
 for(const mutate of [f=>delete f.original,f=>delete f.state.tasks[0].source,f=>f.original.rows[0].sourceRow=1,f=>f.original.rows.push({...f.original.rows[0]}),f=>f.original.rows[0].recordId='missing',f=>f.original.rows[0].values.push('未命名实值'),f=>f.original.messageColumn=9,f=>f.original.rows=[]]){
  const f=fixture();mutate(f);assert.throws(()=>snapshot(f));
 }
 const f=fixture();assert.throws(()=>snapshot(f,{targetLang:'fr'}));assert.throws(()=>snapshot(f,{conclusionMode:'other'}));assert.throws(()=>snapshot(f,{taskId:'missing'}));
 f.original.messageColumn=null;assert.match(snapshot(f).records[0].conversation,/客户.*原文客户1[\s\S]*客服.*原文回复1/);
});

test('28-column Excel preserves original values and sparse physical rows, repeats multirow session outputs, and adds source disclosure',async()=>{
 const f=fixture({count:2,ruleCount:17});f.state.sessions.forEach((_,i)=>complete(f.state,i));f.original.rows.push({sourceRow:10,recordId:'s-1',values:['0001','会话另一行','尾列']});
 const s=snapshot(f,{targetLang:'en'}),enrichment={translations:{'s-1':{conversation:{status:'translated',text:'Full translated conversation'}},'s-2':{conversation:{status:'translated',text:'Second full English conversation'}}},consultationAnalysis:{'s-1':{status:'completed',salesStage:'售前',salesSubstage:'产品对比',intentLabel:'选择产品',demandSummary:'关注续航',sentiment:'中性',negativeVoices:[{turnId:1,quote:'原文客户1'}],voc:{valid:true,scene:'续航',painPoint:'关注续航'}}}};
 const tables=await readXlsx(await api.buildConsultationDeliveryXlsx(s,enrichment)),main=tables['检核明细'];
 assert.equal(api.consultationDeliveryHeaders(s).length,28);assert.equal(main[0].length,28);assert.deepEqual(main[0].slice(0,3),s.original.headers);assert.match(main[0][3],/英文/);assert.deepEqual(main.map(r=>r[XLSX_ROW_NUMBER]),[1,2,6,10]);
 for(const source of f.original.rows){const row=main.find(row=>row[XLSX_ROW_NUMBER]===source.sourceRow);assert.deepEqual(row.slice(0,3),source.values);assert.equal(row[3],source.recordId==='s-1'?'Full translated conversation':'Second full English conversation');assert.equal(row[26],'通过');}
 assert.match(main.find(row=>row[XLSX_ROW_NUMBER]===2)[4],/售前.*产品对比/);assert.match(main.find(row=>row[XLSX_ROW_NUMBER]===6)[4],/未完成/);assert.ok(tables['口径说明'].some(row=>row.join(' ').includes('同一会话')&&row.join(' ').includes('重复')));
 assert.equal(s.metrics.total,2);assert.ok(tables['判定留痕']);
});

test('translation and analysis failures remain explicit and long text is retained through continuation sheets',async()=>{
 const f=fixture({ruleCount:17});complete(f.state);const s=snapshot(f),long='完整长译文🙂'.repeat(9000),before=JSON.stringify(s);
 const e={translations:{'s-1':{conversation:{status:'translated',text:long}}},consultationAnalysis:{'s-1':{status:'failed'}}};
 const bytes=await api.buildConsultationDeliveryXlsx(s,e),tables=await readXlsx(bytes),main=tables['检核明细'];const key=main[1][3].match(/长文本留存：(TEXT-\d+)/)?.[1];assert.ok(key);const reconstructed=tables['长文本留存'].slice(1).filter(row=>row[0]===key).map(row=>row[3]).join('');assert.equal(reconstructed.length,long.length);const mismatch=Array.from({length:long.length},(_,index)=>index).find(index=>long[index]!==reconstructed[index]);assert.equal(mismatch,undefined,'continuation text must reconstruct exactly without replacing a split Unicode surrogate');assert.match(main[1][8],/失败/);assert.equal(JSON.stringify(s),before);
 const failed=await readXlsx(await api.buildConsultationDeliveryXlsx(s,{translations:{'s-1':{conversation:{status:'failed',text:'假成功'}}}}));assert.equal(failed['检核明细'][1][3],'');assert.ok(failed['口径说明'].some(row=>row[0]==='翻译失败文本（去重）'&&row[1]==='1'));assert.match(failed['检核明细'][1][8],/未完成/);
});

test('source header below row1 never causes fabricated source data rows or duplicated row IDs',async()=>{
 const f=fixture({headerRow:4});complete(f.state);const s=snapshot(f),bytes=await api.buildConsultationDeliveryXlsx(s),tables=await readXlsx(bytes),main=tables['检核明细'];
 assert.ok(main.some(row=>row[XLSX_ROW_NUMBER]===5&&row[0]==='0001'));assert.ok(tables['口径说明'].some(row=>row[0]==='源表头物理行'&&row[1]==='4'));
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string'),rows=[...xml.matchAll(/<row r="(\d+)"/g)].map(m=>Number(m[1]));assert.equal(new Set(rows).size,rows.length);
});

test('optional standard-input companion sheets keep every original column and physical row',async()=>{
 const f=fixture();f.original.additionalSheets=[{sheetName:'会话明细',headerRow:3,headers:['会话ID','轮次','原文','未知留档列'],rows:[{sourceRow:4,values:['raw-1','1','真实轮次原文','  原样空格  ']},{sourceRow:9,values:['raw-1','2','后续回复','']}]}];
 const s=snapshot(f),tables=await readXlsx(await api.buildConsultationDeliveryXlsx(s)),companion=Object.values(tables).find(rows=>rows[0]?.includes('未知留档列'));
 assert.ok(companion);assert.deepEqual(companion.slice(1).map(r=>r[XLSX_ROW_NUMBER]),[4,9]);assert.equal(companion[1][3],'  原样空格  ');assert.deepEqual(s.original.additionalSheets,f.original.additionalSheets);
});

test('failure summaries bound each reason and case selection covers actual categories with multiple failures first',()=>{
 const f=fixture({count:5});f.state.sessions.forEach((_,i)=>complete(f.state,i));
 f.state.sessions[0].aiResults[0].verdict='不符合';f.state.sessions[1].aiResults[1].verdict='不符合';f.state.sessions[2].aiResults[2].verdict='不符合';for(const result of f.state.sessions[3].aiResults)result.verdict='不符合';
 f.state.sessions[3].aiResults[0].reason='🙂证据问题'.repeat(40);f.state.sessions[3].aiResults[1].reason='累计时长25.555555小时（92000000毫秒）';
 const s=snapshot(f),selected=api.selectConsultationErrorCases(s,3);assert.equal(selected[0].id,'s-4');assert.equal(new Set(selected.map(r=>r.id)).size,selected.length);assert.ok(selected.every(r=>r.finalOverall==='不通过'));assert.deepEqual(new Set(selected.flatMap(r=>r.final.filter(i=>i.verdict==='Fail').map(i=>i.category))),new Set(['产品知识','服务规范','风险控制']));
 assert.ok(s.records[3].summary.split('；').every(part=>[...part].length<=70));assert.match(s.records[3].summary,/25\.6小时/);assert.ok(!s.records[3].summary.includes('毫秒'));assert.deepEqual(api.selectConsultationErrorCases(s,0),[]);assert.match(s.basis.timeSelectionNotice,/无|未|没有/);
});

test('extreme timeout selection uses only timing facts whose own final item failed',()=>{
 const result={basis:{dimensions:[]},records:[
  {id:'multi',sourceRows:[2],finalOverall:'不通过',final:[{id:'a',verdict:'Fail'},{id:'b',verdict:'Fail'}],timeFacts:[]},
  {id:'short-failure-with-long-pass',sourceRows:[3],finalOverall:'不通过',final:[{id:'time',verdict:'Fail'},{id:'other',verdict:'Pass'}],timeFacts:[{ruleId:'time',elapsedMs:3600000},{ruleId:'other',elapsedMs:3600000000}]},
  {id:'longest-actual-failure',sourceRows:[4],finalOverall:'不通过',final:[{id:'time',verdict:'Fail'}],timeFacts:[{ruleId:'time',elapsedMs:360000000}]},
 ]};
 assert.deepEqual(api.selectConsultationErrorCases(result,2).map(r=>r.id),['multi','longest-actual-failure']);
});

test('snapshot time range uses original session start times and discloses missing times',()=>{
 const f=fixture({count:3});f.state.sessions[0].startedAt='2026-11-02T09:00:00+08:00';f.state.sessions[1].startedAt='2026-11-03T17:00:00+08:00';delete f.state.sessions[2].startedAt;
 const s=snapshot(f);assert.deepEqual(s.basis.conversationTimeRange,{from:'2026-11-02T09:00:00+08:00',to:'2026-11-03T17:00:00+08:00',provided:2,missing:1});assert.equal(s.records[0].startedAt,f.state.sessions[0].startedAt);
});
