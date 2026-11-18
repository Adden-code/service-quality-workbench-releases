import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const viewUrl=new URL('../public/catalog-view.mjs',import.meta.url),storeUrl=new URL('../public/catalog-controller.mjs',import.meta.url);
async function views(){assert.ok(existsSync(viewUrl),'缺少规则与资料版本管理界面');const {createCatalog}=await import('../public/catalog.mjs');return {...await import(viewUrl),createCatalog};}
test('catalog pages expose version management and policy-only import/export',async()=>{
 const {catalogPage,createCatalog}=await views();const catalog=createCatalog();
 const rules=catalogPage(catalog,'rules',{}),policies=catalogPage(catalog,'policies',{});
 assert.match(rules,/版本管理/);assert.match(rules,/catalog-open/);
 for(const word of ['导入资料','导出资料','下载模板'])assert.ok(policies.includes(word));
 assert.doesNotMatch(rules,/导入资料/);assert.match(policies,/V1.0/);assert.match(policies,/已有任务保留创建时的依据/);
});
test('catalog content is escaped and empty filters do not expose stale cards',async()=>{
 const {catalogPage,createCatalog}=await views();const catalog=createCatalog();catalog.policies[0].title='<script>alert(1)</script>';
 assert.match(catalogPage(catalog,'policies',{}),/&lt;script&gt;/);
 assert.doesNotMatch(catalogPage(catalog,'policies',{catalogQuery:'no matching phrase'}),/catalog-open/);
});
test('published status is separate from policy validity dates',async()=>{
 const {catalogPage,createCatalog}=await views();const catalog=createCatalog();catalog.policies[0].effectiveAt='2026-12-01';
 const html=catalogPage(catalog,'policies',{});assert.match(html,/未到生效日/);assert.match(html,/已发布/);
});
test('version comparison explains no content changes when only lifecycle metadata differs',async()=>{
 const {createCatalog}=await views();const {createDraft}=await import('../public/catalog.mjs');const {catalogDialog}=await import('../public/catalog-dialogs.mjs');
 const catalog=createDraft(createCatalog(),'policies','P003',{});
 assert.match(catalogDialog({type:'catalog-diff',kind:'policies',id:'P003',version:'V1.1'},catalog),/两个版本没有内容差异/);
});
test('corrupt catalog is retained and blocked; quota failure does not replace in-memory catalog',async()=>{
 assert.ok(existsSync(storeUrl),'缺少独立资料存储保护');const {loadCatalog,saveCatalog,CATALOG_KEY}=await import(storeUrl);
 const entries=new Map([[CATALOG_KEY,'{bad']]);const storage={getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value)};
 const result=loadCatalog(storage);assert.equal(result.blocked,true);assert.equal(entries.get(CATALOG_KEY),'{bad');
 assert.throws(()=>saveCatalog({setItem(){throw new Error('quota');}},result.catalog),/保存|空间/);
});
test('an existing empty catalog value is corruption, not permission to overwrite it',async()=>{
 const {loadCatalog}=await import(storeUrl);let writes=0;const storage={getItem:()=>'',setItem(){writes++;}};
 assert.equal(loadCatalog(storage).blocked,true);assert.equal(writes,0);
});
