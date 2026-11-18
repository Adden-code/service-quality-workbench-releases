import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBusinessCatalog,createCatalog} from '../public/catalog.mjs';
import {businessTaskDialog} from '../public/business-dialogs.mjs';
import {catalogPage} from '../public/catalog-view.mjs';
import {catalogDialog} from '../public/catalog-dialogs.mjs';
import {createCatalogManager} from '../public/catalog-controller.mjs';
import {setLocale,translateError,t} from '../public/i18n.mjs';
test('step three diagnoses missing rules and offers rule management with draft recovery in both locales',()=>{
 const dialog={type:'new-task',mode:'manual',scene:'新品产品咨询',step:3,parsed:{sessions:[],turnCount:0},catalog:createBusinessCatalog(),effectiveDate:'2026-11-10',ruleIds:[]};
 for(const locale of ['zh','en']){setLocale(locale);const html=businessTaskDialog(dialog,{}).body;assert.match(html,/data-act="new-manage-rules"/);assert.match(html,locale==='en'?/No rules in the catalog|catalog is empty/:/规则目录为空/);assert.match(html,locale==='en'?/uploaded file|uploaded material/:/上传.*保留/);assert.match(html,/create-business-task"[^>]*disabled/);}
 setLocale('zh');
});
test('catalog pages expose positive scene filters and real manual template import actions',()=>{
 const catalog=createCatalog();catalog.rules[0].sceneIds=['SCENE-A'];
 const html=catalogPage(catalog,'rules',{catalogScene:'__unassigned__'});
 assert.match(html,/id="catalog-scene"/);assert.match(html,/data-act="catalog-rule-template"/);assert.match(html,/data-act="catalog-rule-import"/);
 assert.doesNotMatch(html,/data-id="R001"/);
 assert.match(catalogPage(catalog,'policies',{}),/id="catalog-scene"/);
});
test('new task rule management suspends and resumes the parsed draft instead of reuploading',()=>{
 const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 assert.match(source,/new-manage-rules/);assert.match(source,/new-resume-draft/);assert.match(source,/suspendedTaskDraft/);
 assert.doesNotMatch(source,/!EC_RULE_IDS\.includes/);
});
test('published rule ownership is edited through metadata controls and rule import has a manual dialog',async()=>{
 const catalog=createCatalog(),original=structuredClone(catalog.rules[0]);let dialog={type:'catalog-detail',kind:'rules',id:'R001',version:'V1.0'};
 const fields=[],prior=globalThis.document;globalThis.document={querySelectorAll:()=>fields,getElementById:()=>null};
 try{
  const manager=createCatalogManager({initialCatalog:catalog,getDialog:()=>dialog,getUi:()=>({}),openDialog:value=>{dialog=value;},render(){},renderDialog(){},toast(){},commitCatalog:async next=>next,download(){}});
  assert.match(manager.dialog(dialog),/data-act="catalog-scenes"/);await manager.action('catalog-scenes',{});assert.equal(dialog.type,'catalog-scenes');
  fields.push({value:'电商评论回复'});await manager.action('catalog-save-scenes',{});
  const changed=manager.getCatalog().rules[0];assert.deepEqual(changed,{...original,sceneIds:['电商评论回复']});
  await manager.action('catalog-rule-import',{});assert.equal(dialog.type,'catalog-rule-import');assert.match(manager.dialog(dialog),/catalog-upload/);assert.match(manager.dialog(dialog),/不调用模型/);
 }finally{globalThis.document=prior;}
 const imported=catalogDialog({type:'catalog-import',parsed:[catalog.policies[0]]},catalog,{});assert.match(imported,/catalog-import-scene-0/);
});
test('ownership validation and manual import feedback have English translations',()=>{
 setLocale('en');try{
  for(const message of ['新任务规则未归属于当前场景：NP-X。','新任务资料未归属于当前场景：NP-DOC。','目录场景归属尚未注册：SCENE-X。','场景归属须为无重复的有效场景标识数组。','请选择填写好的规则 .xlsx 模板。'])assert.doesNotMatch(translateError(message),/[\u3400-\u9fff]/);
  assert.equal(t('已导入 2 个规则版本草稿'),'Imported 2 rule version drafts');
 }finally{setLocale('zh');}
});
