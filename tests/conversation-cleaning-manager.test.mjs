import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {workbook} from '../public/io.mjs';
import {parseCleaningResult} from '../server/conversation-cleaning.mjs';
import {updateCleaningField,confirmCleaningRow} from '../public/conversation-cleaning.mjs';
import {setLocale} from '../public/i18n.mjs';
const url=new URL('../public/conversation-cleaning-manager.mjs',import.meta.url);
const api=existsSync(url)?await import(url):{};
async function setup({prepare,rows=[['SYN-1','甲','客户：合成问题'],['SYN-2','乙','客服：合成回答']]}={}){
 let dialog=null,requests=0;
 const bytes=await workbook([{name:'业务',headers:['会话ID','客服','消息详情'],rows}]);
 const file={name:'合成.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 const ctx={getState:()=>({}),getDialog:()=>dialog,openDialog:value=>{dialog=value;},renderDialog:()=>{},closeDialog:()=>{dialog=null;},toast:()=>{},getModelConfig:()=>({configured:true,connectionTested:true,model:'合成替身'}),prepareConversationCleaning:async(input,options)=>{requests++;return prepare?prepare(input,options):{...parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:input.text,textQuote:input.text,role:'客户'}]}),input),modelId:'synthetic-model'};}};
 const manager=api.createConversationCleaningManager(ctx);await manager.action('cleaning-open');
 await manager.change({target:{id:'cleaning-file',files:[file]}});
 ctx.uploadSource=async()=>({sha256:'b'.repeat(64),name:file.name,size:bytes.byteLength});
 return {manager,ctx,getDialog:()=>dialog,requests:()=>requests};
}
test('manager opens an independent source review with explicit call awareness',async()=>{
 assert.equal(typeof api.createConversationCleaningManager,'function');
 const setupValue=await setup(),d=setupValue.getDialog();assert.equal(d.type,'conversation-cleaning');assert.equal(d.draft.rows.length,2);
 const html=setupValue.manager.dialog(d);assert.match(html,/AI起草/);assert.match(html,/人工核对/);assert.match(html,/清洗报告/);assert.match(html,/cleaning-consent/);
 await setupValue.manager.action('cleaning-run');assert.equal(setupValue.requests(),0);assert.match(d.error,/知情|同意/);
});
test('drafting is sequential, exposes progress and never drops provider failures',async()=>{
 let active=0,maxActive=0;
 const value=await setup({prepare:async input=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;if(input.row===2)throw new Error('合成失败');return {...parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:input.text,textQuote:input.text,role:'客服'}]}),input),modelId:'synthetic'};}});
 value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});
 await value.manager.action('cleaning-run');
 assert.equal(value.requests(),2);assert.equal(maxActive,1);
 assert.equal(value.getDialog().draft.rows[0].status,'failed');assert.equal(value.getDialog().draft.rows[1].status,'prepared');
 assert.equal(value.getDialog().draft.rows.length,2);assert.equal(value.getDialog().progress.done,2);
});
test('cancelling stops later rows and retains the interrupted original',async()=>{
 let notifyStart;const started=new Promise(resolve=>notifyStart=resolve);
 const value=await setup({prepare:async(input,{signal})=>{notifyStart();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
 value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});
 const running=value.manager.action('cleaning-run');await started;await value.manager.action('cleaning-cancel');await running;
 assert.equal(value.requests(),1);assert.equal(value.getDialog().draft.rows.length,2);
 assert.equal(value.getDialog().draft.rows[0].status,'failed');assert.equal(value.getDialog().draft.rows[1].status,'pending');
});
test('source HTML is escaped and field source buttons expose exact highlighting',async()=>{
 const value=await setup(),d=value.getDialog();d.draft.rows[0].original.text='<img src=x onerror=alert(1)>';
 const html=value.manager.dialog(d);assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img'));
 assert.match(html,/cleaning-source/);assert.match(html,/cleaning-confirm-row/);
});
test('typing edits state without rebuilding the focused input node',async()=>{
 const value=await setup();let rebuilds=0;
 const focused={value:'',selectionStart:0},root={focused,set innerHTML(value){rebuilds++;this.focused={value};}};
 value.ctx.renderDialog=()=>{root.innerHTML=value.manager.dialog(value.getDialog());};
 for(const text of ['2','20','202','2026']){
  focused.value=text;focused.selectionStart=text.length;
  value.manager.input({target:{id:'cleaning-row-startedAt',type:'text',value:text,dataset:{cleaningRow:'2',cleaningSegment:'row',cleaningField:'startedAt'}}});
 }
 assert.equal(rebuilds,0);assert.equal(root.focused,focused);assert.equal(focused.selectionStart,4);
 assert.equal(value.getDialog().draft.rows[0].fields.startedAt,'2026');
});
test('changing the tested model after awareness requires a new explicit acknowledgement',async()=>{
 const value=await setup();let model='synthetic-A';value.ctx.getModelConfig=()=>({configured:true,connectionTested:true,model});
 value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});model='synthetic-B';
 await value.manager.action('cleaning-run');assert.equal(value.requests(),0);assert.equal(value.getDialog().consent,false);
 assert.match(value.getDialog().error,/设置已经变化|重新核对/);
});
test('first verified message time requires an explicit click and adds human source audit',async()=>{
 const at='2026-11-11T09:00:00+08:00',text=at+' 客户：合成问题';
 const value=await setup({rows:[['SYN-1','甲',text]],prepare:async input=>parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:input.text,textQuote:'合成问题',role:'客户',roleQuote:'客户',atQuote:at}]}),input)});
 value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});await value.manager.action('cleaning-run');
 assert.equal(value.getDialog().draft.rows[0].fields.startedAt,'');
 assert.match(value.manager.dialog(),/data-act="cleaning-use-first-time"/);
 await value.manager.action('cleaning-use-first-time',{dataset:{row:'2'}});
 const row=value.getDialog().draft.rows[0];assert.equal(row.fields.startedAt,at);
 assert.match(row.manual.startedAt.reason,/人工|首条/);assert.equal(row.manual.startedAt.origin.quote,at);
 assert.equal(row.original.text,text);assert.equal(row.confirmed,false);
 await value.manager.action('cleaning-source',{dataset:{row:'2',index:'row',field:'startedAt'}});
 assert.ok(value.manager.dialog().includes(`<mark>${at}</mark>`),'adopted start time must highlight its exact source');
});
test('no complete source date means no first-message-time shortcut and no invented start',async()=>{
 const value=await setup();assert.doesNotMatch(value.manager.dialog(),/data-act="cleaning-use-first-time"/);
 await value.manager.action('cleaning-use-first-time',{dataset:{row:'2'}});
 assert.equal(value.getDialog().draft.rows[0].fields.startedAt,'');assert.match(value.getDialog().error,/首条|时间/);
});
test('closing and reopening the same scene restores paid draft and manual edits from page memory',async()=>{
 const value=await setup();value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});await value.manager.action('cleaning-run');
 value.manager.input({target:{value:'人工核对人',id:'cleaning-reviewer'}});
 const original=value.getDialog(),calls=value.requests();await value.manager.action('cleaning-close');
 value.ctx.openDialog({type:'new-task',scene:'新品产品咨询'});await value.manager.action('cleaning-open');
 assert.equal(value.getDialog(),original);assert.equal(value.requests(),calls);assert.equal(value.getDialog().reviewer,'人工核对人');
 assert.equal(value.getDialog().draft.rows[0].attempts.length,1);assert.match(value.manager.dialog(),/恢复|本页内存/);
});
test('explicit new-draft action clears the source and call awareness without recalling the old draft',async()=>{
 const value=await setup();value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});await value.manager.action('cleaning-run');
 const original=value.getDialog();await value.manager.action('cleaning-new-draft');
 assert.notEqual(value.getDialog(),original);assert.equal(value.getDialog().draft,null);assert.equal(value.getDialog().file,null);assert.equal(value.getDialog().consent,false);
 await value.manager.action('cleaning-close');await value.manager.action('cleaning-open');assert.notEqual(value.getDialog(),original);
});
test('a new file or source mapping cannot silently replace a draft after model calls',async()=>{
 const value=await setup();value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});await value.manager.action('cleaning-run');
 const original=value.getDialog().draft;
 value.manager.input({target:{id:'cleaning-text-column',value:'另一个列'}});
 assert.equal(value.getDialog().draft,original);assert.match(value.getDialog().error,/新建清洗草稿/);
 await value.manager.action('cleaning-inspect');assert.equal(value.getDialog().draft,original);
});
test('successful handoff clears the retained cleaning draft',async()=>{
 const value=await setup();value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});await value.manager.action('cleaning-run');
 const d=value.getDialog();d.reviewer='合成核对人';
 for(const row of d.draft.rows){
  d.draft=updateCleaningField(d.draft,row.row,null,'startedAt','2026-11-11T09:00:00+08:00',{reason:'合成核实时间'});
  d.draft=updateCleaningField(d.draft,row.row,null,'completeness','完整',{reason:'合成核实完整性'});
  d.draft=confirmCleaningRow(d.draft,row.row,{reviewer:d.reviewer});
 }
 let handoffs=0;value.ctx.beginCleanedTask=async()=>{handoffs++;value.ctx.openDialog({type:'new-task',scene:'新品产品咨询'});};
 await value.manager.action('cleaning-finish');assert.equal(handoffs,1);
 await value.manager.action('cleaning-open');assert.notEqual(value.getDialog(),d);assert.equal(value.getDialog().draft,null);
});
test('cleaning clearly labels real benchmark acceptance as pending without blocking synthetic pilot work',async()=>{
 const value=await setup(),html=value.manager.dialog();assert.match(html,/49.*1735/);assert.match(html,/内网.*复测/);
 assert.match(html,/data-act="cleaning-run" disabled/);
 value.manager.input({target:{id:'cleaning-consent',checked:true}});
 assert.doesNotMatch(value.manager.dialog(),/data-act="cleaning-run" disabled/);
});
test('closing an in-flight draft retains the failed row and untouched pending rows for recovery',async()=>{
 let notify;const started=new Promise(resolve=>notify=resolve);
 const value=await setup({prepare:async(input,{signal})=>{notify();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));}});
 value.manager.input({target:{id:'cleaning-consent',type:'checkbox',checked:true}});
 const running=value.manager.action('cleaning-run');await started;const original=value.getDialog();await value.manager.action('cleaning-close');await running;
 value.ctx.openDialog({type:'new-task',scene:'新品产品咨询'});await value.manager.action('cleaning-open');
 assert.equal(value.getDialog(),original);assert.equal(value.getDialog().draft.rows[0].status,'failed');assert.equal(value.getDialog().draft.rows[1].status,'pending');assert.equal(value.requests(),1);
});
test('English cleaning UI translates source warnings and actions while preserving raw worksheet facts',async t=>{
 setLocale('en',{storage:null});t.after(()=>setLocale('zh',{storage:null}));
 const value=await setup(),html=value.manager.dialog();
 assert.ok(html.includes('AI-assisted import conversion'));
 assert.ok(html.includes('Choose another file and start a new cleaning draft'));
 assert.ok(html.includes('Not parsed yet. Use AI drafting or prepare it manually'));
 assert.ok(html.includes('49 conversations / 1,735 turns'));
 assert.ok(html.includes('客户：合成问题'),'raw source conversation must remain Chinese');
 assert.ok(html.includes('value="客服"'),'canonical role values must remain unchanged');
 assert.ok(html.includes('value="会话ID"'),'source header values must remain unchanged');
 assert.doesNotMatch(html,/模型辅助清洗会话|来源未提供，补录需写原因|尚未解析；可使用AI起草|第2行 ·|源文本位置 0/);
});
