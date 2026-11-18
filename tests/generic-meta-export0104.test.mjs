import test from 'node:test';
import assert from 'node:assert/strict';
import {buildResultXlsx,buildHtmlReport,readXlsx} from '../public/io.mjs';
import {DEFAULT_REVIEW_POLICY} from '../public/ai-triage.mjs';

function fixture({legacy=false,onlyMeta=false,withRouting=false}={}){
 const rules=[{id:'CHECK',name:'合成操作说明',title:'合成操作说明',version:'V1.0',category:'服务规范',policyIds:[],ruleKind:onlyMeta?'meta':'session-check'}, {id:'META',name:'Html报告结构要求',title:'Html报告结构要求',version:'V1.0',category:'交付物要求',policyIds:[],ruleKind:'meta'}];
 if(legacy)for(const rule of rules)delete rule.ruleKind;
 const task={id:'T',name:'合成历史任务',mode:'manual',scene:'新品产品咨询',basisSnapshot:{capturedAt:'2026-11-15T00:00:00Z',effectiveDate:'2026-11-15',rules,policies:[]}};
 const results=rules.map(rule=>({ruleId:rule.id,verdict:rule.id==='META'?'不符合':'符合',reason:'合成检核理由',evidence:[1],referenceIds:[]}));
 const session={id:'S',externalId:'SOURCE-S',taskId:'T',scene:task.scene,expectedRuleIds:rules.map(rule=>rule.id),turns:[{id:1,role:'客服',text:'合成原文保留。'}],aiResults:results,aiExecution:{status:'completed',runId:'synthetic-run'},review:{status:'已确认',reviewer:'合成审核员',notes:'',completedAt:'2026-11-15T00:01:00Z',drafts:Object.fromEntries(results.map(result=>[result.ruleId,{...result,source:'人工确认'}]))}};
 if(withRouting){task.reviewPolicy={...DEFAULT_REVIEW_POLICY,enabled:false};session.reviewPolicy={...task.reviewPolicy};}
 return {tasks:[task],sessions:[session],activity:[]};
}
const rows=(sheets,name)=>sheets[name].slice(1).map(row=>Object.fromEntries(sheets[name][0].map((header,index)=>[header,row[index]??''])));

for(const legacy of [false,true])test(`generic Excel and HTML omit ${legacy?'legacy inferred':'typed'} meta results and counts without rewriting source`,async()=>{
 const state=fixture({legacy,withRouting:true}),before=JSON.stringify(state),sheets=await readXlsx(await buildResultXlsx(state,{taskId:'T',includePending:true}));
 const details=rows(sheets,'结果明细'),summary=rows(sheets,'会话汇总')[0],batch=rows(sheets,'批次统计')[0];
 assert.deepEqual(details.map(row=>row['规则标识']),['CHECK']);assert.equal(summary['预期检查项数'],'1');assert.equal(summary['最终检查项数'],'1');assert.equal(summary['不符合项数'],'0');assert.equal(batch['问题项数'],'0');assert.equal(batch['无不符合占比'],'100%');
 assert.equal(rows(sheets,'判定来源与分流').length,1);assert.equal(rows(sheets,'判定来源与分流')[0]['最终判定来源'],'人工确认');
 const html=buildHtmlReport(state,{taskId:'T',includePending:true});assert.doesNotMatch(html,/Html报告结构要求/);assert.match(html,/合成原文保留/);assert.match(html,/交付物要求不生成检查项/);assert.equal(JSON.stringify(state),before);
});

test('generic meta-only historical task retains audit status but never creates a zero-check pass rate',async()=>{
 const state=fixture({onlyMeta:true}),before=JSON.stringify(state),sheets=await readXlsx(await buildResultXlsx(state,{taskId:'T',includePending:true}));
 assert.equal(rows(sheets,'结果明细').length,0);const summary=rows(sheets,'会话汇总')[0],batch=rows(sheets,'批次统计')[0];
 assert.equal(summary['会话结论'],'无会话检核项');assert.equal(summary['审核状态'],'已确认');assert.equal(summary['预期检查项数'],'0');
 assert.equal(batch['人工已确认会话数'],'1');assert.equal(batch['无不符合会话数'],'0');assert.equal(batch['无不符合占比'],'');assert.equal(batch['问题项数'],'0');assert.equal(JSON.stringify(state),before);
});

test('generic export honors an explicitly confirmed session scope despite report-format wording',async()=>{
 const state=fixture();state.tasks[0].basisSnapshot.rules[1].ruleKind='session-check';
 const sheets=await readXlsx(await buildResultXlsx(state,{taskId:'T',includePending:true}));
 assert.deepEqual(rows(sheets,'结果明细').map(row=>row['规则标识']),['CHECK','META']);assert.equal(rows(sheets,'批次统计')[0]['问题项数'],'1');
});
