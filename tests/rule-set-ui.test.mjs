import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {createRuleSetDraft,publishRuleSet,exportRuleSet} from '../public/ecommerce-rule-sets.mjs';
const ui=await import('../public/rule-set-ui.mjs').catch(()=>({}));
const at='2026-11-03T12:00:00+08:00';
const fields={ruleSetId:'EC-REVIEW',version:'V2.1-A',title:'阶段A时效口径',owner:'维护人甲',effectiveAt:'2026-10-16',expiresAt:'',changeNote:'累计工作小时试运行',mode:'workingHours',workdays:['Mon','Tue','Wed','Thu','Fri'],workStart:'09:00',workEnd:'18:00',timezone:'UTC+08:00',holidays:'2026-10-01\n2026-10-02',workingDates:'2026-10-10',calendarConfirmed:false,defaultHours:'24',positiveHours:'72',neutralHours:'48',negativeHours:'24',badHours:'24',unrepliedRule:true};
function harness(catalog=createBusinessCatalog()){
 let current=null,live=structuredClone(catalog),writes=0,fail=false;const downloads=[];
 const manager=ui.createRuleSetManager?.({getCatalog:()=>live,getDialog:()=>current,openDialog:d=>{current=d;},closeDialog:()=>{current=null;},render(){},renderDialog(){},toast(){},now:()=>at,download:(...args)=>downloads.push(args),readForm:()=>fields,commitCatalog:async next=>{writes++;if(fail)throw Error('写入失败');live=next;return live;}});
 return {manager,downloads,get current(){return current;},get catalog(){return live;},get writes(){return writes;},failWrites(){fail=true;}};
}
test('rule set form preserves working-hour and legacy-boundary choices and parses explicit calendar dates',()=>{
 assert.equal(typeof ui.ruleSetFormChanges,'function');
 const result=ui.ruleSetFormChanges(fields);
 assert.equal(result.timeRule.mode,'workingHours');assert.equal(result.timeRule.thresholds.byType['好评正向'],72);
 assert.deepEqual(result.timeRule.calendar.holidays,['2026-10-01','2026-10-02']);assert.equal(result.calendarConfirmed,false);
 assert.equal(result.timeRule.replyDetection,'bothEmpty');
 assert.throws(()=>ui.ruleSetFormChanges({...fields,workStart:'18:00',workEnd:'09:00'}));
});
test('rule-set dialog clearly labels stage-A scope, net hours, incomplete holiday calendar and reply evidence',()=>{
 assert.equal(typeof ui.ruleSetDialog,'function');
 const h=harness();assert.ok(h.manager);h.manager.action('ruleset-new');
 const html=ui.ruleSetDialog(h.current,h.catalog).body;
 for(const phrase of ['时效升级','其他四项V1','工作小时','节假日','补班','72','回复内容和时间均为空'])assert.ok(html.includes(phrase),phrase);
 assert.match(html,/id="rs-owner"/);assert.match(html,/id="rs-mode"/);assert.match(html,/id="rs-holidays"/);
});
test('save draft and publish are separate explicit actions and persistence errors retain form',async()=>{
 const h=harness();assert.ok(h.manager);await h.manager.action('ruleset-new');await h.manager.action('ruleset-save');
 assert.equal(h.catalog.ruleSets[0].status,'草稿');assert.equal(h.catalog.ruleSets[0].timeRule.thresholds.byType['好评正向'],72);
 await h.manager.action('ruleset-publish',{dataset:{id:'EC-REVIEW',version:'V2.1-A'}});assert.equal(h.catalog.ruleSets[0].status,'草稿');
 await h.manager.action('ruleset-confirm-publish');assert.equal(h.catalog.ruleSets[0].status,'已发布');
 const failed=harness();await failed.manager.action('ruleset-new');failed.failWrites();await failed.manager.action('ruleset-save');
 assert.equal(failed.current.type,'rule-set-editor');assert.match(failed.current.error,/写入失败/);assert.equal(failed.catalog.ruleSets,undefined);
});
test('published sets expose export and new-version controls without editing live parameters',async()=>{
 let catalog=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',{version:'V2.1-A',owner:'维护人甲'},at);catalog=publishRuleSet(catalog,'EC-REVIEW','V2.1-A',at);
 const h=harness(catalog);await h.manager.action('ruleset-open',{dataset:{id:'EC-REVIEW',version:'V2.1-A'}});
 const html=ui.ruleSetDialog(h.current,h.catalog).body;
 assert.match(html,/data-act="ruleset-export"/);assert.match(html,/data-act="ruleset-new-version"/);assert.doesNotMatch(html,/data-act="ruleset-save"/);
 await h.manager.action('ruleset-export',{dataset:{id:'EC-REVIEW',version:'V2.1-A'}});
 assert.equal(h.downloads.length,1);assert.match(h.downloads[0][0],/ecommerce-rule-set-stage-a/);
});

test('a saved but unacknowledged draft is reconciled before a second save can duplicate its version',async()=>{
 let current,live=createBusinessCatalog(),writes=0,pending=true;
 const manager=ui.createRuleSetManager?.({getCatalog:()=>live,getDialog:()=>current,openDialog:d=>{current=d;},render(){},renderDialog(){},toast(){},now:()=>at,readForm:()=>fields,getWorkspaceStatus:()=>({hasPending:pending}),commitCatalog:async next=>{writes++;live=next;throw Error('保存结果待确认');}});
 assert.ok(manager);await manager.action('ruleset-new');await manager.action('ruleset-save');assert.equal(writes,1);
 await manager.action('ruleset-save');assert.equal(writes,1);pending=false;assert.equal(manager.reconcile(),'saved');
 assert.equal(live.ruleSets.length,1);assert.equal(current.type,'rule-set-detail');
});

test('JSON selection invalidates old preview immediately and an older read cannot replace the latest file',async()=>{
 const h=harness();assert.ok(h.manager);await h.manager.action('ruleset-import');
 let release;const slow={name:'old.json',size:1,text:()=>new Promise(resolve=>{release=resolve;})};
 h.manager.change({target:{id:'rs-file',files:[slow]}});
 h.manager.change({target:{id:'rs-file',files:[{name:'large.json',size:1024*1024+1,text:async()=>''}]}});
 release('{}');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.current.parsed,null);assert.match(h.current.error,/1MB/);
});

test('new versions remain unsaved editable drafts with the next supported version and an accurate title',async()=>{
 let catalog=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',{version:'V2.1-A',owner:'维护人甲'},at);catalog=publishRuleSet(catalog,'EC-REVIEW','V2.1-A',at);
 const h=harness(catalog);await h.manager.action('ruleset-new-version',{dataset:{id:'EC-REVIEW',version:'V2.1-A'}});
 assert.equal(h.writes,0);assert.equal(h.current.form.version,'V2.2-A');assert.match(h.current.form.title,/V2.2-A/);
 assert.match(ui.ruleSetDialog(h.current,h.catalog).body,/V2.2-A（时效升级；其他四项V1）/);
});

test('JSON import is a separate preview and imported drafts require a real owner before save',async()=>{
 const source=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',{version:'V2.1-A'},at),json=exportRuleSet(source,'EC-REVIEW','V2.1-A');
 const h=harness();await h.manager.action('ruleset-import');h.manager.change({target:{id:'rs-file',files:[new File([json],'口径.json')]}});
 for(let i=0;i<100&&h.current.loading;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(h.writes,0);assert.equal(h.current.parsed.status,'草稿');await h.manager.action('ruleset-confirm-import');
 assert.equal(h.writes,0);assert.match(h.current.error,/维护人/);
});
