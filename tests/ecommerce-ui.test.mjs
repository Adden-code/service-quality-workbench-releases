import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createEcommerceSample } from '../public/ecommerce-sample.mjs';
import { parseEcommerceFile } from '../public/ecommerce-input.mjs';
import { EC_RULE_IDS } from '../public/ecommerce-schema.mjs';
import {EC_HEADERS} from '../public/ecommerce-schema.mjs';
import {workbook} from '../public/io.mjs';
import {getLocale,setLocale} from '../public/i18n.mjs';

async function api() {
  const managerUrl = new URL('../public/ecommerce-manager.mjs', import.meta.url);
  const uiUrl = new URL('../public/ecommerce-ui.mjs', import.meta.url);
  assert.ok(existsSync(managerUrl), '缺少电商导入管理接口和创建按钮');
  assert.ok(existsSync(uiUrl), '缺少电商参考与批次证据展示接口');
  return { ...await import(managerUrl), ...await import(uiUrl) };
}
const event = (id, value = '', extra = {}) => ({ target: { id, value, ...extra } });
const sampleFile = async name => new File([await createEcommerceSample()], name || '虚构电商样例.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
async function settled(d) {
  for (let i = 0; i < 300 && d.loading; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(Boolean(d.loading), false, '异步解析未完成');
}
function confirmPreview(manager,d){
  assert.equal(d.parsed?.valid,true);assert.match(manager.dialog(d),/id="import-preview-confirm"/);
  assert.equal(manager.change(event('import-preview-confirm','',{checked:true})),true);
  assert.equal(d.previewConfirmed,true);
}
function harness(overrides = {}) {
  const h = { dialog: null, creates: [], downloads: [], renders: [], status: {}, recoveryStatus: 'pending' };
  h.ctx = {
    getDialog: () => h.dialog,
    openDialog: d => { h.dialog = d; },
    closeDialog: () => { h.dialog = null; },
    renderDialog: flag => h.renders.push(flag), render: () => {}, toast: () => {},
    download: (blob, filename) => h.downloads.push({ blob, filename }),
    getWorkspaceStatus: () => h.status,
    getRuleVersions:()=>[{version:'V1.0',title:'Sheet4已确认口径'}],
    createTask: async payload => { h.creates.push(payload); },
    reconcileCreated: owner => {
      assert.equal(owner, h.dialog);
      if (h.recoveryStatus === 'saved') h.dialog = null;
      return h.recoveryStatus;
    },
    ...overrides,
  };
  return h;
}
async function ready(overrides) {
  const { createEcommerceManager } = await api(), h = harness(overrides), manager = createEcommerceManager(h.ctx);
  await manager.action('ec-open', {});
  manager.input(event('ec-name', '我的电商批次'));
  manager.input(event('ec-reviewer', '审核甲'));
  manager.change(event('ec-file','',{files:[await sampleFile()]}));await settled(h.dialog);
  confirmPreview(manager,h.dialog);await manager.action('ec-next');assert.equal(h.dialog.step,2);manager.change(event('ec-basis-version','V1.0'));
  return { h, manager, d: h.dialog };
}
async function sessionFixture() {
  const parsed = await parseEcommerceFile(await sampleFile());
  return parsed.sessions.map(session => ({ ...session, taskId: 'EC-TASK', aiResults: [], aiExecution: { status: 'not_started' }, review: { status: '待审核', drafts: {} } }));
}

test('manager opens the upload stage without selecting rules or loading fictional records', async () => {
  const { createEcommerceManager } = await api(), h = harness(), manager = createEcommerceManager(h.ctx);
  assert.equal(manager.dialog({ type: 'other' }), null);
  assert.equal(await manager.action('other', {}), false);
  assert.equal(await manager.action('ec-open', {}), true);
  const d = h.dialog, html = manager.dialog(d);
  assert.equal(d.type, 'ecommerce-import'); assert.equal(d.thresholdHours, 24); assert.equal(d.name, ''); assert.equal(d.reviewer, '本机操作人');assert.equal(d.requirePreviewConfirmation,true);assert.equal(Boolean(d.previewConfirmed),false);
  assert.match(html,/id="ec-name"[^>]*value=""[^>]*placeholder="请填写：批次名-日期"/);
  assert.match(html, /modal-backdrop/); assert.match(html, /id="ec-file"/); assert.match(html, /id="ec-name"/); assert.match(html, /id="ec-reviewer"/);
  assert.match(html,/data-act="ec-template-download"[^>]*>下载标准模板/);
  assert.doesNotMatch(html,/一键体验|虚构Excel/);assert.match(html,/原人工参考.*不会.*模型/);
  assert.match(html,/data-act="ec-next"[^>]*disabled/);
  assert.match(html,/请填写任务名称，才能继续/);
  manager.input(event('ec-name','合成试点-20261115'));assert.match(manager.dialog(d),/本机操作标签可修改/);
  manager.input(event('ec-reviewer','自定义复核人'));assert.equal(d.reviewer,'自定义复核人');
});

const multiSheetFile=async()=>new File([await workbook(['中文 源表','Other Data'].map(name=>({name,headers:[...EC_HEADERS,'产品系列'],rows:[Array(23).fill(''),[...Array(8).fill(''),'评论','回复','5','管理员','2026-11-01 09:00:00','2026-11-01 10:00:00',...Array(8).fill(''),'PRIVATE_EXTENSION']]})))],'多表.xlsx');
test('multiple compatible worksheets use explicit selector and retain the chosen source on preview and creation',async()=>{
 const {createEcommerceManager}=await api(),h=harness(),manager=createEcommerceManager(h.ctx);await manager.action('ec-open');const d=h.dialog;
 manager.input(event('ec-name','选择表任务'));manager.input(event('ec-reviewer','审核人'));manager.change(event('ec-file','',{files:[await multiSheetFile()]}));await settled(d);
 assert.equal(d.parsed.valid,false);assert.deepEqual(d.parsed.availableSheetNames,['中文 源表','Other Data']);assert.match(manager.dialog(d),/id="ec-sheet"/);assert.match(manager.dialog(d),/data-act="ec-next"[^>]*disabled/);
 manager.change(event('ec-sheet','Other Data'));await settled(d);assert.equal(d.parsed.valid,true);assert.equal(d.parsed.selectedSheet,'Other Data');assert.equal(d.parsed.sessions[0].ecommerce.sheetIndex,2);assert.match(manager.dialog(d),/Other Data/);
 await manager.action('ec-next');assert.equal(d.step,1);assert.match(d.error,/确认.*预览|预览.*确认/);assert.equal(h.creates.length,0);
 confirmPreview(manager,d);await manager.action('ec-next');assert.equal(d.step,2);manager.change(event('ec-basis-version','V1.0'));await manager.action('ec-create');assert.equal(h.creates.length,1);assert.equal(h.creates[0].parsed.selectedSheet,'Other Data');
});
test('sheet changes keep asynchronous preview ownership and English labels without translating original names',async()=>{
 const previous=getLocale();setLocale('en');try{
  const {createEcommerceManager}=await api(),h=harness(),manager=createEcommerceManager(h.ctx);await manager.action('ec-open');const d=h.dialog;manager.change(event('ec-file','',{files:[await multiSheetFile()]}));await settled(d);
  let html=manager.dialog(d);assert.match(html,/Source worksheet/);assert.match(html,/Choose a worksheet/);assert.match(html,/中文 源表/);assert.doesNotMatch(html,/Sheet4固定22列|请选择工作表/);
  const file=d.file,bytes=await file.arrayBuffer();let release;
  d.file={name:file.name,size:file.size,arrayBuffer:()=>new Promise(resolve=>{release=()=>resolve(bytes);})};manager.change(event('ec-sheet','中文 源表'));assert.equal(d.loading,true);
  manager.change(event('ec-file','',{files:[await sampleFile('newest.xlsx')]}));await settled(d);release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(d.file.name,'newest.xlsx');assert.equal(d.parsed.selectedSheet,'Sheet4');
 }finally{setLocale(previous);}
});
test('a slower worksheet preview cannot replace a newer selected worksheet or release its loading guard',async()=>{
 const {createEcommerceManager}=await api(),h=harness(),manager=createEcommerceManager(h.ctx);await manager.action('ec-open');const d=h.dialog,file=await multiSheetFile(),bytes=await file.arrayBuffer();manager.change(event('ec-file','',{files:[file]}));await settled(d);
 let releaseOld,releaseNew,reads=0;d.file={name:file.name,size:file.size,arrayBuffer:()=>new Promise(resolve=>{if(++reads===1)releaseOld=()=>resolve(bytes);else releaseNew=()=>resolve(bytes);})};
 manager.change(event('ec-sheet','中文 源表'));manager.change(event('ec-sheet','Other Data'));assert.equal(reads,2);releaseOld();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(d.loading,true);releaseNew();await settled(d);assert.equal(d.parsed.selectedSheet,'Other Data');assert.equal(d.selectedSheet,'Other Data');
});
test('clearing the worksheet selector clears the valid preview and blocks creation until selected again',async()=>{
 const {createEcommerceManager}=await api(),h=harness(),manager=createEcommerceManager(h.ctx);await manager.action('ec-open');const d=h.dialog;manager.change(event('ec-file','',{files:[await multiSheetFile()]}));await settled(d);manager.change(event('ec-sheet','Other Data'));await settled(d);assert.equal(d.parsed.valid,true);
 manager.change(event('ec-sheet',''));assert.equal(d.parsed,null);await settled(d);assert.equal(d.parsed.valid,false);assert.equal(d.selectedSheet,null);assert.match(manager.dialog(d),/data-act="ec-next"[^>]*disabled/);await manager.action('ec-create');assert.equal(h.creates.length,0);
});

test('uploaded Sheet4 preserves entered labels and proceeds to explicit rule version selection', async () => {
  const { h, manager, d } = await ready();
  assert.ok(d.file instanceof File); assert.equal(d.parsed.valid, true); assert.equal(d.parsed.sessions.length, 18);
  assert.equal(d.name, '我的电商批次'); assert.equal(d.reviewer, '审核甲'); assert.equal(h.creates.length, 0);
  const basisHtml=manager.dialog(d);assert.match(basisHtml,/class="btn" data-act="ec-create"[^>]*>仅创建，稍后质检/);assert.match(basisHtml,/class="btn primary" data-act="ec-create-start"[^>]*>创建并开始AI质检/);assert.doesNotMatch(basisHtml,/data-act="ec-create(?:-start)?"[^>]*disabled/);
  d.step=1;const html = manager.dialog(d);
  assert.match(html, /前5条/); assert.match(html, /原人工参考/); assert.match(html, /第2行原标准（仅保留原文）/); assert.match(html, /Sheet4/); assert.match(html, /原始输入/);
  assert.match(html, /缺少评论时间/);
  assert.doesNotMatch(html, /data-act="ec-next"[^>]*disabled/);
});

test('template download is an empty same-structure workbook rather than a sample', async () => {
  const { createEcommerceManager } = await api(), h = harness(), manager = createEcommerceManager(h.ctx);
  await manager.action('ec-template-download', {});
  assert.equal(h.downloads.length, 1);
  const download = h.downloads[0]; assert.match(download.filename, /\.xlsx$/);
  const parsed = await parseEcommerceFile(new File([download.blob], download.filename));
  assert.equal(parsed.valid, false);assert.match(parsed.errors.join('；'),/没有|至少/);assert.equal(h.creates.length,0);
});

test('invalid replacement retains the failed source for conversion while clearing prior preview and source metadata', async () => {
  const {h,manager,d}=await ready(),failedFile=new File(['broken'],'损坏.txt');
  await manager.action('ec-back');assert.equal(d.step,1);
  d.source = { old: true }; d.sourceName = '旧源文件';
  assert.equal(manager.change(event('ec-file', '', { files: [failedFile] })), true);
  assert.equal(d.file,failedFile);assert.equal(d.parsed,null);assert.equal(d.fileName,failedFile.name);assert.equal(d.sourceName,'');assert.equal(d.source,null);assert.equal(d.previewConfirmed,false);
  await settled(d);
  assert.equal(d.file,failedFile);assert.equal(d.parsed,null);assert.match(d.error,/xlsx/);
  const html=manager.dialog(d);assert.match(html,/data-import-stage="needs-conversion"/);assert.match(html,/data-act="import-ai-convert"/);assert.match(html,/data-act="ec-next"[^>]*disabled/);
  await manager.action('ec-create', {});assert.equal(h.creates.length,0);assert.match(d.error,/文件|预览/);
});

test('a slower old upload cannot replace the newest selected file', async () => {
  const { createEcommerceManager } = await api(), h = harness(), manager = createEcommerceManager(h.ctx);
  await manager.action('ec-open', {}); const d = h.dialog, bytes = await createEcommerceSample();
  let finishOld;
  const old = { name: '旧文件.xlsx', size: bytes.byteLength, arrayBuffer: () => new Promise(resolve => { finishOld = () => resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }) };
  manager.change(event('ec-file', '', { files: [old] }));
  manager.change(event('ec-file', '', { files: [await sampleFile('新文件.xlsx')] }));
  await settled(d); assert.equal(d.file.name, '新文件.xlsx');
  finishOld(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(d.file.name, '新文件.xlsx'); assert.equal(d.parsed.sessions.length, 18);
});

test('an older explicit preview cannot release the busy guard of a newer upload', async () => {
  const { manager, d } = await ready(), bytes = await createEcommerceSample();
  const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let finishOld, finishNew;
  d.file = { name: '重新预览旧文件.xlsx', size: bytes.byteLength, arrayBuffer: () => new Promise(resolve => { finishOld = () => resolve(buffer()); }) };
  const oldPreview = manager.action('ec-preview', {});
  const newer = { name: '较慢新文件.xlsx', size: bytes.byteLength, arrayBuffer: () => new Promise(resolve => { finishNew = () => resolve(buffer()); }) };
  manager.change(event('ec-file', '', { files: [newer] }));
  finishOld(); await oldPreview;
  const stillBusy = d.loading;
  finishNew(); await settled(d);
  assert.equal(stillBusy, true); assert.equal(d.file.name, '较慢新文件.xlsx');
});

test('threshold reparse blocks a second edit and creation until the selected threshold is parsed',async()=>{
  const {h,manager,d}=await ready(),bytes=await createEcommerceSample();
  assert.equal(d.step,2);assert.equal(d.previewConfirmed,true);
  let release;
  d.file={name:'阈值核对.xlsx',size:bytes.byteLength,arrayBuffer:()=>new Promise(resolve=>{release=()=>resolve(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));})};
  manager.change(event('ec-threshold','36'));
  assert.equal(d.loading,true);const sequence=d.parseSequence;
  assert.match(manager.dialog(d),/id="ec-threshold"[^>]*disabled/);
  manager.change(event('ec-threshold','48'));
  assert.equal(d.thresholdHours,36);assert.equal(d.parseSequence,sequence);
  await manager.action('ec-create');assert.equal(h.creates.length,0);
  release();await settled(d);
  assert.ok(d.parsed.sessions.every(row=>row.ecommerce.thresholdHours===36));
  await manager.action('ec-create');assert.equal(h.creates.length,1);assert.equal(h.creates[0].thresholdHours,36);
  d.thresholdHours=48;
  await manager.action('ec-create');assert.equal(h.creates.length,1);assert.match(d.error,/阈值.*解析|重新.*核对/);
});

test('missing reviewer is rejected before createTask and the entered name remains intact', async () => {
  const { h, manager, d } = await ready(); manager.input(event('ec-reviewer', '   '));
  await manager.action('ec-create', {});
  assert.equal(h.creates.length, 0); assert.match(d.error, /审核人/); assert.equal(d.name, '我的电商批次');
});

test('createTask is called once while busy and receives the exact parsed file and owner', async () => {
  let finish;
  const { h, manager, d } = await ready();
  h.ctx.createTask = async payload => { h.creates.push(payload); await new Promise(resolve => { finish = resolve; }); };
  const first = manager.action('ec-create', {}); await manager.action('ec-create', {});
  manager.input(event('ec-name', '忙碌期间改名'));
  assert.equal(h.creates.length, 1); assert.equal(d.name, '我的电商批次');
  assert.equal(h.creates[0].file, d.file); assert.equal(h.creates[0].parsed, d.parsed); assert.equal(h.creates[0].owner, d); assert.equal(h.creates[0].thresholdHours, 24);
  finish(); await first;
});

test('failed save preserves the parsed file and labels and safely renders the error message', async () => {
  const { h, manager, d } = await ready(); const file = d.file, parsed = d.parsed;
  h.ctx.createTask = async () => { throw new Error('<img src=x onerror=alert(1)>保存失败'); };
  await manager.action('ec-create', {});
  assert.equal(d.file, file); assert.equal(d.parsed, parsed); assert.equal(d.name, '我的电商批次'); assert.equal(d.reviewer, '审核甲');
  const html = manager.dialog(d); assert.match(html, /id="ec-error"/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/); assert.equal(d.loading, false);
});

test('unacknowledged creation blocks edits and another commit until exact reconciliation', async () => {
  const { h, manager, d } = await ready();
  h.ctx.createTask = async payload => { h.creates.push(payload); payload.owner.expectedCreated = { task: { id: 'created' }, sessions: [] }; throw new Error('保存结果待恢复'); };
  await manager.action('ec-create', {}); const file = d.file;
  assert.equal(manager.input(event('ec-name', '不应改动')), true);
  assert.equal(manager.change(event('ec-file', '', { files: [new File([], '替换.xlsx')] })), true);
  manager.change(event('ec-file','',{files:[await sampleFile()]}));await settled(h.dialog);
  await manager.action('ec-next');manager.change(event('ec-basis-version','V1.0')); await manager.action('ec-create', {});
  assert.equal(d.name, '我的电商批次'); assert.equal(d.file, file); assert.equal(h.creates.length, 1); assert.equal(manager.reconcile(), 'pending');
  h.recoveryStatus = 'not_saved'; assert.equal(manager.reconcile(), 'not_saved'); assert.equal(d.expectedCreated, null);
  manager.input(event('ec-name', '恢复后可改')); assert.equal(d.name, '恢复后可改');
});

test('successful reconciliation delegates closure to the root without creating again', async () => {
  const { h, manager, d } = await ready(); d.expectedCreated = { task: {}, sessions: [] }; h.recoveryStatus = 'saved';
  assert.equal(manager.reconcile(), 'saved'); assert.equal(h.dialog, null); assert.equal(h.creates.length, 0);
});

test('preview and input fields escape uploaded text without changing preserved raw values', async () => {
  const { manager, d } = await ready(); const attack = '<svg onload="alert(1)">';
  d.name = attack; d.reviewer = attack; d.parsed.sessions[0].ecommerce.raw[8] = attack; d.parsed.sessions[0].ecommerce.raw[9] = attack; d.parsed.sessions[0].ecommerce.raw[11] = attack;
  d.step=1;const html = manager.dialog(d);
  assert.doesNotMatch(html, /<svg onload/); assert.match(html, /&lt;svg onload=&quot;/); assert.equal(d.parsed.sessions[0].ecommerce.raw[8], attack);
});

test('reference view separates original labels, completed AI, and confirmed human results', async () => {
  const { ecommerceReferenceView } = await api(), sessions = await sessionFixture(), s = sessions[0];
  s.ecommerce.raw[15] = 'Fail'; s.ecommerce.raw[20] = 'Fail'; s.ecommerce.raw[21] = '原始人工问题说明';
  s.aiResults = EC_RULE_IDS.map(ruleId => ({ ruleId, verdict: '符合' })); s.aiExecution.status = 'completed'; s.review.drafts['EC-TIME'] = { verdict: '不符合' };
  let html = ecommerceReferenceView(s, { sessions });
  assert.match(html, /原人工参考/); assert.match(html, /AI初判/); assert.match(html, /本次人工最终/); assert.match(html, /Fail/); assert.match(html, /原始人工问题说明/);
  assert.match(html, /未确认/); assert.doesNotMatch(html, /data-column="final">不符合/);
  assert.match(html, /Sheet4/); assert.match(html, /第3行/); assert.match(html, /24小时/); assert.match(html, /本次导入批次/);
  s.review.status = '已确认'; html = ecommerceReferenceView(s, { sessions }); assert.match(html, /data-column="final">不符合/);
});

test('reference view never shows stale AI as executed or a draft as final and escapes original cells', async () => {
  const { ecommerceReferenceView } = await api(), sessions = await sessionFixture(), s = sessions[0];
  s.aiResults = EC_RULE_IDS.map(ruleId => ({ ruleId, verdict: '陈旧AI结论' })); s.review.drafts['EC-TIME'] = { verdict: '草稿最终值' }; s.ecommerce.raw[21] = '<script>alert(1)</script>';
  const html = ecommerceReferenceView(s, { sessions });
  assert.doesNotMatch(html, /陈旧AI结论|草稿最终值|<script>/); assert.match(html, /AI未执行/); assert.match(html, /&lt;script&gt;/);
  assert.equal(ecommerceReferenceView({ turns: [] }, {}), '');
});

test('batch evidence uses three real peer IDs and the actual source rows, administrators, and replies', async () => {
  const { ecommerceBatchEvidence } = await api(), sessions = (await sessionFixture()).slice(3, 6);
  sessions[0].ecommerce.raw[9] = '<img src=x>实际回复甲';
  const result = { batchEvidence: [{ sessionIds: sessions.map(s => s.id), kind: 'similar', reason: '<svg>相似理由' }] };
  const html = ecommerceBatchEvidence({ sessions }, result);
  for (const s of sessions) { assert.ok(html.includes(s.id)); assert.ok(html.includes(`第${s.ecommerce.row}行`)); assert.ok(html.includes(s.ecommerce.raw[11])); }
  assert.match(html, /高度相似/); assert.match(html, /实际回复甲/); assert.match(html, /&lt;img/); assert.match(html, /&lt;svg&gt;/); assert.doesNotMatch(html, /<img|<svg>/);
  assert.match(ecommerceBatchEvidence({ sessions }, { batchEvidence: [{ ...result.batchEvidence[0], kind: 'exact' }] }), /完全相同/);
});

test('missing or repeated evidence IDs cannot fabricate a three-record batch group', async () => {
  const { ecommerceBatchEvidence } = await api(), sessions = (await sessionFixture()).slice(3, 6);
  assert.equal(ecommerceBatchEvidence({ sessions }, {}), '');
  const html = ecommerceBatchEvidence({ sessions }, { batchEvidence: [{ sessionIds: [sessions[0].id, sessions[0].id, 'missing-id'], kind: 'exact', reason: '不可证明' }] });
  assert.doesNotMatch(html, /第undefined行|missing-id|不可证明/); assert.match(html, /证据不完整|未找到完整/);
});
