import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setLocale,t,translateError} from '../public/i18n.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {catalogPage} from '../public/catalog-view.mjs';
import {catalogDialog} from '../public/catalog-dialogs.mjs';
import {clearBusinessTranslations,ruleDisplayName,d} from '../public/content-translation-ui.mjs';
import {reviewView,humanFooter} from '../public/review-view.mjs';
import {reviewFixture,standardPolicies} from './ui-i18n01124-fixture.mjs';

const han=/[\u3400-\u9fff]/u;
const inEnglish=fn=>{clearBusinessTranslations();setLocale('en');try{return fn();}finally{clearBusinessTranslations();setLocale('zh');}};

test('consultation and ecommerce review queues translate both directions on a middle page',()=>inEnglish(()=>{
 for(const engine of ['conversation','ecommerce']){
  const {state,ui}=reviewFixture(engine),before=JSON.stringify(state),view=reviewView(state,ui);
  const pager=view.match(/<div class="queue-pagination">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(pager,engine+' must exercise a real paginated queue');
  assert.match(pager,/>Previous<\/button>/);assert.match(pager,/>Next<\/button>/);assert.doesNotMatch(pager,han);
  assert.match(pager,/data-id="S-49"/);assert.match(pager,/data-id="S-100"/);assert.equal(JSON.stringify(state),before);
 }
}));

test('raw transcript next-session control is English and keeps its original source',()=>inEnglish(()=>{
 const {state,ui}=reviewFixture('raw'),before=JSON.stringify(state),view=reviewView(state,ui);
 const next=view.match(/data-act="raw-confirm-next"[^>]*>([^<]*)<\/button>/)?.[1];
 assert.equal(next,'Save human judgments and continue');assert.doesNotMatch(next,han);
 assert.match(view,/data-business-original[^>]*[\s\S]*?Synthetic original transcript/);
 assert.equal(JSON.stringify(state),before);
}));

test('standard policy titles appear offline in English in lists and detail headings without translating custom names',()=>inEnglish(()=>{
 const catalog={...createBusinessCatalog(),policies:standardPolicies()},before=JSON.stringify(catalog);
 const cards=catalogPage(catalog,'policies',{}),titles=[...cards.matchAll(/<h3>([^<]*)<\/h3>/g)].map(x=>x[1]);
 assert.equal(titles.length,4);for(const title of titles)assert.doesNotMatch(title,han);
 for(const record of catalog.policies){
  const detail=catalogDialog({type:'catalog-detail',kind:'policies',id:record.id,version:record.version},catalog);
  assert.doesNotMatch(detail.match(/<h2 id="dialog-title">([^<]*)<\/h2>/)?.[1],han);
  assert.doesNotMatch(detail.match(/<section class="policy-section"><h3>([\s\S]*?)<\/h3>/)?.[1],han);
  assert.ok(detail.includes(record.sections[0].text),'original policy text remains available');
  assert.doesNotMatch(t(record.category),han);
 }
 assert.match(ruleDisplayName({id:catalog.policies[0].id,title:'自定义政策名称'}),/自定义政策名称/);
 assert.equal(JSON.stringify(catalog),before);
}));

test('static startup document and no-script fallback are English before JavaScript runs',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const message=html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
 assert.match(message,/Enable JavaScript/);assert.doesNotMatch(message,han);
 assert.match(html,/<html lang="en">/);assert.doesNotMatch(html,han);
 assert.match(html,/<title>Quality Workbench<\/title>/);assert.match(html,/<div class="brand-mark">QA<\/div>/);
 assert.match(html,/Opening Quality Workbench/);
});

test('frozen policy summary and archived review footer use English display labels',()=>inEnglish(()=>{
 assert.equal(d('电商评论回复五项测试口径说明（非正式制度）'),'Ecommerce five-check testing criteria (not formal policy)');
 const {state,ui}=reviewFixture();state.tasks[0].lifecycle={archivedAt:'2026-11-25T10:00:00+08:00'};
 const footer=humanFooter(state.sessions[0],'符合',ui,state);assert.match(footer,/Read-only history/);assert.doesNotMatch(footer,han);
}));

test('unknown and interpolated backend errors cannot append untranslated Original error text',()=>inEnglish(()=>{
 for(const error of ['Original error: 内部未知故障','The operation failed. Original error: 模型结果异常','读取失败：内部服务未响应','磁盘不可写（D:\\测试目录）']){
  const translated=translateError(new Error(error));assert.doesNotMatch(translated,han);assert.doesNotMatch(translated,/Original error:/);assert.match(translated,/retry/i);
 }
}));
