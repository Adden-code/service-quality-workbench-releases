import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {businessTaskDialog} from '../public/business-dialogs.mjs';
import {catalogPage} from '../public/catalog-view.mjs';
import {setLocale} from '../public/i18n.mjs';

const zh='该规则疑似不作用于单条会话（如输出格式、报告结构类要求），请确认是否纳入会话质检';
const en='This rule may not apply to an individual conversation (for example, output formatting or report structure). Please confirm whether to include it in conversation quality inspection.';
const helperUrl=new URL('../public/rule-advisory.mjs',import.meta.url);
const advisory=async()=>{
  assert.ok(existsSync(helperUrl),'A read-only non-conversation rule advisory is required');
  return (await import(helperUrl)).ruleAdvisory;
};
afterEach(()=>setLocale('zh',{storage:undefined}));

const rule=(title,extra={})=>({id:'SYN-RULE',title,category:'会话行为',version:'V1.0',scope:'Synthetic conversation scope',status:'已发布',effectiveAt:'2026-01-01',expiresAt:'',owner:'Synthetic owner',sceneIds:['新品产品咨询'],policyIds:[],passCriteria:'Synthetic passing behavior',failCriteria:'Synthetic failing behavior',exceptionCriteria:'',...extra});
const fixture=()=>({rules:[rule('Html报告结构要求',{id:'SYN-REPORT'}),rule('检核明细表输出要求',{id:'SYN-TABLE'}),rule('及时回答客户问题',{id:'SYN-BEHAVIOR',passCriteria:'客户要求发送报告时确认报告是否已发送。'})],policies:[]});
const dialogFor=catalog=>({type:'new-task',mode:'manual',step:3,name:'Synthetic task',reviewer:'Synthetic reviewer',scene:'新品产品咨询',effectiveDate:'2026-11-12',catalog,ruleIds:['SYN-REPORT','SYN-BEHAVIOR'],basisSnapshot:{rules:catalog.rules.filter(item=>['SYN-REPORT','SYN-BEHAVIOR'].includes(item.id)),policies:[]}});
const inputs=body=>(body.match(/<input\b[^>]*\bname="task-rule"[^>]*>/g)||[]).map(input=>({value:input.match(/\bvalue="([^"]*)"/)[1],checked:/\bchecked\b/.test(input),disabled:/\bdisabled\b/.test(input)}));

test('explicit Chinese report structure and inspection table titles receive the fixed advisory',async()=>{
  const message=await advisory();
  for(const title of ['Html报告结构要求','检核明细表输出要求','报告输出格式要求','质检报告结构规范','输出格式要求'])assert.equal(message(rule(title)),zh,title);
  assert.equal(message(rule('Synthetic format item',{category:'报告结构'})),zh);
  assert.equal(message(rule('Synthetic format item',{category:'输出格式'})),zh);
});

test('explicit English report and inspection table equivalents receive English advisory copy',async()=>{
  const message=await advisory();setLocale('en',{storage:undefined});
  for(const title of ['HTML report structure requirements','Inspection detail table output requirements','Report output format requirements','Output formatting requirements'])assert.equal(message(rule(title)),en,title);
  assert.equal(message(rule('Synthetic category item',{category:'Report structure'})),en);
});

test('conversation behavior and customer report requests are not inferred to be report format rules',async()=>{
  const message=await advisory();
  for(const title of ['及时回答客户问题','按客户要求发送报告','客户要求发送Html报告','向客户解释报告结构','Report delivery requirements','Send the report in HTML format','Explain the report structure to the customer','Follow customer reply output format']){
    assert.equal(message(rule(title,{passCriteria:'Html报告结构要求；Inspection detail table output requirements',failCriteria:'报告输出格式错误',scope:'报告结构',id:'NP-REPORT-FORMAT'})),'',title);
  }
  for(const value of [undefined,null,{},rule('报告要求'),rule('Synthetic',{category:'格式'})])assert.equal(message(value),'');
});

test('advisory inspects only title and category without reading IDs or business criteria or mutating records',async()=>{
  const message=await advisory(),record={title:'Html报告结构要求',category:'合成类别',version:'V4.2',sceneIds:['新品产品咨询']};
  for(const key of ['id','scope','passCriteria','failCriteria','exceptionCriteria'])Object.defineProperty(record,key,{get(){throw new Error(`Unexpected read: ${key}`);},enumerable:true});
  Object.freeze(record.sceneIds);Object.freeze(record);
  assert.equal(message(record),zh);assert.equal(record.version,'V4.2');assert.deepEqual(record.sceneIds,['新品产品咨询']);
});

test('rule management structurally groups report format rules as deliverable requirements',()=>{
  const catalog=fixture(),before=structuredClone(catalog),body=catalogPage(catalog,'rules',{});
  assert.equal((body.match(/data-rule-advisory/g)||[]).length,0);
  assert.match(body,/catalog-scope-heading">交付物要求/);
  assert.match(body,/Html报告结构要求/);assert.deepEqual(catalog,before);
  assert.doesNotMatch(catalogPage({rules:[],policies:[rule('Html报告结构要求')]},'policies',{}),/data-rule-advisory/);
});

test('task rule choices exclude meta by default and show only unchecked disabled meta in show all',()=>{
  const catalog=fixture(),dialog=dialogFor(catalog),before=structuredClone(dialog),body=businessTaskDialog(dialog,{}).body;
  assert.equal((body.match(/data-rule-advisory/g)||[]).length,0);
  assert.match(body,/显示全部（含交付物要求）/);
  assert.deepEqual(inputs(body),[{value:'SYN-BEHAVIOR',checked:true,disabled:false}]);
  const all=businessTaskDialog({...dialog,showAllTaskRules:true},{}).body;
  assert.deepEqual(inputs(all),[{value:'SYN-BEHAVIOR',checked:true,disabled:false},{value:'SYN-REPORT',checked:false,disabled:true},{value:'SYN-TABLE',checked:false,disabled:true}]);
  assert.deepEqual(dialog,before);assert.match(body,/已选 1\/1 项/);
});

test('both actual views display English scope labels without changing stored business records',()=>{
  const catalog=fixture(),before=structuredClone(catalog);setLocale('en',{storage:undefined});
  for(const body of [catalogPage(catalog,'rules',{}),businessTaskDialog(dialogFor(catalog),{}).body]){
    assert.match(body,/deliverable requirements|Deliverable requirements/);assert.ok(!body.includes(zh));
  }
  assert.deepEqual(catalog,before);
});

test('actual views suppress advisory for body-only report mentions and ordinary report delivery behavior',()=>{
  const catalog={rules:[rule('按客户要求发送报告',{id:'SYN-ZH',passCriteria:'Html报告结构要求'}),rule('Send the report in HTML format',{id:'SYN-EN',failCriteria:'Inspection detail table output requirements'})],policies:[]};
  assert.doesNotMatch(catalogPage(catalog,'rules',{}),/data-rule-advisory/);
  assert.doesNotMatch(businessTaskDialog(dialogFor(catalog),{}).body,/data-rule-advisory/);
});

test('advisory never bypasses escaping business titles, categories or rule values in either actual view',()=>{
  const catalog={rules:[rule('<img src=x onerror="synthetic()">',{id:'SYN-" onfocus="synthetic()',category:'输出格式',scope:'<script>synthetic()</script>'})],policies:[]},dialog=dialogFor(catalog);dialog.ruleIds=[catalog.rules[0].id];
  for(const body of [catalogPage(catalog,'rules',{}),businessTaskDialog(dialog,{}).body]){
    assert.ok(body.includes(zh));assert.ok(body.includes('&lt;img'));assert.ok(body.includes('&lt;script&gt;'));
    assert.doesNotMatch(body,/<img|<script|value="SYN-" onfocus=/);
  }
});
