import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEnglishSource,checkEnglishUi} from '../scripts/check-english-ui.mjs';
import {setLocale,getLocale} from '../public/i18n.mjs';

const inspect=source=>{const previous=getLocale();try{setLocale('en',{storage:null});return checkEnglishSource(source,'synthetic-ui.mjs');}finally{setLocale(previous,{storage:null});}};
test('English build guard rejects an untranslated pager inserted as raw HTML',()=>{
 const report=inspect('export const pager = () => `<button>下一页新遗漏</button>`;');
 assert.ok(report.findings.some(f=>f.kind==='unwrapped-html'&&f.text.includes('下一页新遗漏')));
});
test('English build guard rejects new unmapped error and accessible strings',()=>{
 const report=inspect("import {html,t} from './i18n.mjs';export const error=()=>html`<p role=\"alert\">测试新增未翻译错误</p><input placeholder=\"新增占位提示\">`;export const toast=()=>t('新增服务错误未翻译');");
 assert.equal(report.findings.length,3);assert.ok(report.findings.some(f=>f.kind==='missing-translation-key'));
});
test('English build guard rejects direct DOM writes without relying on old baseline hashes',()=>{
 assert.equal(inspect("node.textContent='新增界面中文';").findings[0].kind,'untranslated-dom-write');
});
test('Mapped Chinese source literals remain legal without changing canonical state values',()=>{
 assert.deepEqual(inspect("import {html,t,uiAttributes} from './i18n.mjs'; const canonical='符合'; export const view=()=>html`<button>下一页</button><input ${uiAttributes('placeholder=\"搜索名称、标识或内容\"')}>`;const label=t('上一页');").findings,[]);
});
test('Explicit Chinese-only branch and private callback remain separate from English UI',()=>{
 assert.deepEqual(inspect("import {getLocale} from './i18n.mjs';function row(){return '<span>中文专用行</span>';}export function view(items){if(getLocale()==='en')return '<p>English</p>';return items.map(row).join('');}").findings,[]);
});
test('Whole-source gate restores caller locale after success or failure',async()=>{
 setLocale('zh',{storage:null});await assert.rejects(checkEnglishUi({root:'D:/nonexistent-english-gate-fixture'}));assert.equal(getLocale(),'zh');
});
