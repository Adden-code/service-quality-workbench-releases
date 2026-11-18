import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('可访问的中文页面骨架和六个业务入口存在',()=>{
  const p=path.join(root,'public/index.html');
  assert.ok(fs.existsSync(p),'Demo页面尚未实现');
  const html=fs.readFileSync(p,'utf8');
  assert.match(html,/lang="zh-CN"/);
  assert.match(html,/id="app"/);
  assert.match(html,/app\.mjs/);
  const app=fs.readFileSync(path.join(root,'public/app.mjs'),'utf8');
  for(const label of ['工作概览','质检任务','人工审核','质检规则','政策与知识','结果导出']) assert.ok(app.includes(label),label);
  assert.ok(!/localStorage\.clear\(/.test(app),'不能清空其他应用的数据');
});
test('瓷白玻璃主题独立加载并支持降级与减少动态效果',()=>{
  const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  assert.match(html,/porcelain\.css/);
  const theme=path.join(root,'public/porcelain.css');
  assert.ok(fs.existsSync(theme),'缺少选定的瓷白玻璃主题');
  const css=fs.readFileSync(theme,'utf8');
  assert.match(css,/backdrop-filter/);
  assert.match(css,/@supports/);
  assert.match(css,/prefers-reduced-motion/);
  assert.ok(fs.existsSync(path.join(root,'public/vendor/feather-sprite.svg')));
});
test('固定桌面工作区的网格行允许内部滚动而不撑出确认操作',()=>{
  const css=fs.readFileSync(path.join(root,'public/porcelain.css'),'utf8');
  assert.ok(/grid-template-rows:\s*minmax\(0,\s*1fr\)/.test(css),'网格行不能使用自动最小内容高度');
});
test('政策抽屉的内容区填满剩余空间，返回按钮固定在抽屉底部',()=>{
  const css=fs.readFileSync(path.join(root,'public/porcelain.css'),'utf8');
  assert.ok(/\.modal\.drawer\s+\.modal-body\s*\{[^}]*flex:\s*1/.test(css),'抽屉正文应占满剩余空间');
});
test('规则详情展开后重新绘制审核操作仍传入完整状态以保留未回复事实入口',()=>{
  const app=fs.readFileSync(path.join(root,'public/app.mjs'),'utf8');
  assert.match(app,/footer\.outerHTML=humanFooter\(current\(\),'',ui,state\)/);
});
