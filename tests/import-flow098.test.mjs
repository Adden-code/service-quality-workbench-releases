import test from 'node:test';
import assert from 'node:assert/strict';
import {importFlowView,conversionConfirmations} from '../public/import-flow-ui.mjs';
import {updateTaskDraftInput} from '../public/task-draft.mjs';
import {IMPORT098_EN} from '../public/import098-locale-en.mjs';
import {EC_HEADERS} from '../public/ecommerce-columns.mjs';
import {setLocale} from '../public/i18n.mjs';
test('both scene import screens use matching labels, upload and preflight structures',()=>{
 for(const ecommerce of [false,true]){
  const html=importFlowView({name:'Batch',reviewer:'Operator',file:{name:'source.xlsx'},fileName:'source.xlsx',parsed:{valid:true,sessions:[{}]}},{ecommerce});
  assert.match(html,/class="form-row import-task-labels"/);assert.match(html,/import-precheck success/);assert.match(html,/id="import-preview-confirm"/);assert.doesNotMatch(html,/data-act="import-ai-convert"/);
 }
});
test('ecommerce failed preflight keeps the file and promotes field conversion',()=>{
 const html=importFlowView({file:{name:'raw.xlsx'},parsed:{valid:false,sessions:[]}},{ecommerce:true});
 assert.match(html,/raw.xlsx/);assert.match(html,/data-act="import-ai-convert"/);assert.match(html,/<details class="import-secondary"/);
});
test('metadata edits preserve source and exact preflight results',()=>{
 const file={name:'actual.xlsx'},parsed={valid:true,sessions:[{id:'SYN'}]},d={type:'new-task',mode:'manual',file,parsed,previewConfirmed:true};
 updateTaskDraftInput(d,{id:'new-task-name',value:'Changed batch'});updateTaskDraftInput(d,{id:'new-task-reviewer',value:'Changed operator'});
 assert.equal(d.file,file);assert.equal(d.parsed,parsed);assert.equal(d.previewConfirmed,true);
});
test('AI conversion exposes two independent human confirmations alongside exact sample text',()=>{
 const html=conversionConfirmations({draft:{columns:{id:'ID',agent:'Agent',text:'Transcript'},rows:[{row:3,fields:{id:'SYN'},segments:[{kind:'message',role:'客户',at:'2026-11-11T09:00:00+08:00',text:'<synthetic original>'}]}]}});
 assert.match(html,/cleaning-mapping-confirm/);assert.match(html,/cleaning-sample-confirm/);assert.match(html,/&lt;synthetic original&gt;/);
});

test('English import copy is complete for target field labels and keeps original headers separate',()=>{
 for(const label of EC_HEADERS)assert.equal(typeof IMPORT098_EN[label],'string',label);
 for(const [key,value] of Object.entries(IMPORT098_EN)){
  assert.doesNotMatch(value,/[\u3400-\u9fff]/u,key);
  assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...value.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),key);
 }
});

test('English primary conversion label translates despite the leading icon',t=>{
 setLocale('en',{storage:null});t.after(()=>setLocale('zh',{storage:null}));
 const html=importFlowView({file:{name:'source.xlsx'},parsed:{valid:false,sessions:[]}},{ecommerce:true});
 assert.match(html,/AI-assisted import conversion/);assert.doesNotMatch(html,/AI解析转换/);
});

test('new consultation preflight errors guide source-column mapping, never force the old cleaning review',()=>{const html=importFlowView({file:{name:'raw.xlsx'},parsed:{valid:false,sessions:[]}});assert.match(html,/raw.xlsx/);assert.match(html,/手动字段映射/);assert.doesNotMatch(html,/data-act="import-ai-convert"/);});
