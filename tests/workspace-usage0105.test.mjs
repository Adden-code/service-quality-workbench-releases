import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {measureWorkspaceUsage} from '../server/workspace-usage.mjs';
import {workspaceUsageDialog,byteLabel} from '../public/workspace-usage-ui.mjs';

const tempRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../outputs/service0105-20261115/test-usage');
async function fixture(t){await fs.mkdir(tempRoot,{recursive:true});const dir=await fs.mkdtemp(path.join(tempRoot,'usage-'));t.after(async()=>{assert.ok(path.resolve(dir).startsWith(tempRoot+path.sep));await fs.rm(dir,{recursive:true,force:true});});return dir;}
test('usage reads metadata, groups nested files and never reads credential contents',async t=>{
 const dir=await fixture(t);await fs.mkdir(path.join(dir,'.secrets'));await fs.mkdir(path.join(dir,'report-cache'));await fs.mkdir(path.join(dir,'sources'));
 await fs.writeFile(path.join(dir,'workspace.json'),'{}');await fs.writeFile(path.join(dir,'.secrets','key.json'),'secret-not-for-ui');await fs.writeFile(path.join(dir,'report-cache','one'),Buffer.alloc(40));await fs.writeFile(path.join(dir,'sources','one'),Buffer.alloc(10));
 const fsOps={...fs,readFile(){throw new Error('content read forbidden');}};
 const usage=await measureWorkspaceUsage(dir,{fsOps});assert.equal(usage.totalBytes,69);assert.equal(usage.files,4);assert.equal(usage.categories.find(c=>c.key==='cache').bytes,40);assert.equal(usage.categories.find(c=>c.key==='settings').bytes,17);assert.equal(usage.partial,false);assert.ok(!JSON.stringify(usage).includes('secret-not-for-ui'));
 const html=workspaceUsageDialog({type:'workspace-usage',usage});assert.match(html,/数据目录/);assert.match(html,/不是包含原件和报告的完整备份/);assert.doesNotMatch(html,/data-act=".*delete/);
});
test('usage refuses symlink traversal and reports incomplete accounting',async t=>{
 const dir=await fixture(t),outside=await fixture(t);await fs.writeFile(path.join(outside,'never-count'),Buffer.alloc(90));await fs.symlink(outside,path.join(dir,'linked'),process.platform==='win32'?'junction':'dir');
 const usage=await measureWorkspaceUsage(dir);assert.equal(usage.totalBytes,0);assert.equal(usage.skippedLinks,1);assert.equal(usage.partial,true);
});
test('bounded usage scan signals partial totals instead of presenting them as complete',async t=>{
 const dir=await fixture(t);await fs.writeFile(path.join(dir,'one'),Buffer.alloc(20));await fs.writeFile(path.join(dir,'two'),Buffer.alloc(30));const usage=await measureWorkspaceUsage(dir,{maxEntries:1});assert.equal(usage.truncated,true);assert.equal(usage.partial,true);assert.equal(usage.files,1);assert.ok(usage.totalBytes<50);
 assert.equal(byteLabel(null),'—');assert.equal(byteLabel(1024**2),'1.0 MB');
});
