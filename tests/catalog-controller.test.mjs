import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog,createDraft} from '../public/catalog.mjs';
import {createCatalogManager} from '../public/catalog-controller.mjs';

function harness({catalog=createCatalog(),commitCatalog=async next=>next,dialog=null}={}){
  let current=dialog,rendered=0;const messages=[],opened=[];
  const fields=new Map();
  globalThis.document={getElementById:id=>fields.get(id)||null,querySelectorAll:()=>[]};
  const manager=createCatalogManager({initialCatalog:catalog,commitCatalog,
    storage:{getItem(){throw new Error('must not read browser storage');},setItem(){throw new Error('must not write browser storage');}},
    getDialog:()=>current,getUi:()=>({}),render(){rendered++;},renderDialog(){rendered++;},
    openDialog:value=>{current=value;opened.push(value);},closeDialog(){current=null;},toast:message=>messages.push(message),download(){}});
  return {manager,fields,messages,opened,get dialog(){return current;},get rendered(){return rendered;}};
}
function populate(fields,form){for(const [key,value] of Object.entries(form))fields.set(`cat-${key}`,{value:Array.isArray(value)?value.join(';'):String(value??'')});}

test('server catalog initialization bypasses browser storage and exposes protected snapshots',()=>{
  const initial=createCatalog(),h=harness({catalog:initial});
  assert.deepEqual(h.manager.getCatalog(),initial);
  initial.policies[0].title='external mutation';
  assert.notEqual(h.manager.getCatalog().policies[0].title,'external mutation');
  const read=h.manager.getCatalog();read.policies[0].title='read mutation';
  assert.notEqual(h.manager.getCatalog().policies[0].title,'read mutation');
  assert.throws(()=>h.manager.replaceCatalog({}),/目录/);
  const replacement=createCatalog();replacement.policies[0].title='server acknowledged title';
  h.manager.replaceCatalog(replacement);replacement.policies[0].title='mutated afterwards';
  assert.equal(h.manager.getCatalog().policies[0].title,'server acknowledged title');
});

test('new-version transition and success occur only after server acknowledges durable save',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const h=harness({dialog:{type:'catalog-detail',kind:'rules',id:'R001',version:'V1.0'},commitCatalog:async next=>{await wait;return next;}});
  const action=h.manager.action('catalog-new-version',{});
  await Promise.resolve();
  assert.equal(h.dialog.type,'catalog-detail');assert.equal(h.messages.length,0);assert.equal(h.manager.getCatalog().rules.length,7);
  release();await action;
  assert.equal(h.dialog.type,'catalog-edit');assert.equal(h.dialog.version,'V1.1');
  assert.equal(h.manager.getCatalog().rules.length,8);assert.equal(h.messages.length,1);
  const date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  assert.equal(h.manager.getCatalog().rules.at(-1).effectiveAt,date);
});

test('rejected async write retains old catalog and the edited form in the same dialog',async()=>{
  const catalog=createDraft(createCatalog(),'rules','R001',{},'2026-10-29T09:00:00+08:00');
  const h=harness({catalog,dialog:{type:'catalog-edit',kind:'rules',id:'R001',version:'V1.1'},commitCatalog:async()=>{throw new Error('disk unavailable');}});
  const form={...catalog.rules.at(-1),title:'Edited but unsaved title'};populate(h.fields,form);
  await h.manager.action('catalog-save',{});
  assert.equal(h.dialog.type,'catalog-edit');assert.match(h.dialog.error,/disk unavailable/);
  assert.equal(h.dialog.form.title,'Edited but unsaved title');
  assert.equal(h.manager.getCatalog().rules.at(-1).title,catalog.rules.at(-1).title);
  assert.equal(h.messages.length,0);
});

test('new rule follows a real V1.0 draft flow and cannot overwrite an existing identifier',async()=>{
  const h=harness();await h.manager.action('catalog-new-rule',{});
  assert.equal(h.dialog.type,'catalog-new-rule');assert.match(h.manager.dialog(h.dialog),/cat-passCriteria/);
  const form={id:'CUSTOM-NEW',title:'新业务检查项',category:'产品信息',scope:'新品文本咨询',owner:'维护人',effectiveAt:'2026-10-29',policyIds:['P001'],passCriteria:'答复与资料一致',failCriteria:'答复与资料冲突',exceptionCriteria:'资料不足时无法判定',changeNote:'首次创建'};
  populate(h.fields,form);await h.manager.action('catalog-save-new-rule',{});
  const record=h.manager.getCatalog().rules.find(r=>r.id==='CUSTOM-NEW');
  assert.equal(record.version,'V1.0');assert.equal(record.status,'草稿');assert.equal(record.publishedAt,'');
  assert.deepEqual(record.policyIds,['P001']);assert.equal(h.dialog.type,'catalog-detail');
  await h.manager.action('catalog-new-rule',{});populate(h.fields,form);await h.manager.action('catalog-save-new-rule',{});
  assert.equal(h.dialog.type,'catalog-new-rule');assert.match(h.dialog.error,/已存在|重复/);
  assert.equal(h.manager.getCatalog().rules.filter(r=>r.id==='CUSTOM-NEW').length,1);
});

test('failed new rule save preserves full entered values and never announces success',async()=>{
  const h=harness({commitCatalog:async()=>{throw new Error('network unknown');}});
  await h.manager.action('catalog-new-rule',{});
  const form={id:'RULE-X',title:'待保存检查项',category:'产品信息',scope:'测试范围',owner:'审核员',effectiveAt:'2026-10-29',policyIds:['P001','P003'],passCriteria:'通过',failCriteria:'不通过',exceptionCriteria:'资料缺失',changeNote:'首次发布前'};
  populate(h.fields,form);await h.manager.action('catalog-save-new-rule',{});
  assert.equal(h.dialog.type,'catalog-new-rule');assert.equal(h.dialog.form.id,'RULE-X');
  assert.deepEqual(h.dialog.form.policyIds,['P001','P003']);assert.equal(h.dialog.form.failCriteria,'不通过');
  assert.match(h.manager.dialog(h.dialog),/RULE-X/);assert.equal(h.messages.length,0);
  assert.equal(h.manager.getCatalog().rules.length,7);
});

test('publish failure preserves explicit prior-version closing selection',async()=>{
  const catalog=createDraft(createCatalog(),'policies','P003',{effectiveAt:'2026-10-29'},'2026-10-29T09:00:00+08:00');
  const h=harness({catalog,dialog:{type:'catalog-publish',kind:'policies',id:'P003',version:'V1.1'},commitCatalog:async()=>{throw new Error('write failed');}});
  h.fields.set('catalog-close-previous',{checked:true});
  await h.manager.action('catalog-do-publish',{});
  assert.equal(h.dialog.type,'catalog-publish');assert.equal(h.dialog.closePrevious,true);
  assert.match(h.manager.dialog(h.dialog),/id="catalog-close-previous"[^>]*checked/);
  assert.equal(h.manager.getCatalog().policies.at(-1).status,'草稿');assert.equal(h.messages.length,0);
});
