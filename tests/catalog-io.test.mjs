import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import JSZip from 'jszip';

const moduleUrl = new URL('../public/catalog-io.mjs', import.meta.url);
const io = existsSync(moduleUrl) ? await import(moduleUrl) : {};
const INFO = ['资料标识','资料名称','资料类别','适用范围','版本号','生效日期','失效日期','维护人','变更说明','来源说明','历史状态'];
const CLAUSES = ['资料标识','版本号','条款标识','条款标题','条款正文'];
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const sample = (overrides = {}) => ({ id:'P005', title:'虚构售前资料', category:'产品说明', scope:'虚构产品的售前咨询', version:'V1.0', effectiveAt:'2026-10-01', expiresAt:'', owner:'资料维护员', changeNote:'首次建档', source:'手工编写的虚构资料', status:'已发布', sections:[{id:'P005-01',title:'产品说明',text:'支持范围需以正式资料为准。'}], ...overrides });
const file = (bytes, name = '知识资料.xlsx', size = bytes.byteLength) => ({ name, size, arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
function api() { assert.equal(typeof io.buildKnowledgeXlsx, 'function', '实现知识资料 XLSX 导出'); assert.equal(typeof io.parseKnowledgeFile, 'function', '实现知识资料 XLSX 导入'); return io; }
const infoRow = record => [record.id,record.title,record.category,record.scope,record.version,record.effectiveAt,record.expiresAt,record.owner,record.changeNote,record.source,record.status];
const clauseRows = record => record.sections.map(section=>[record.id,record.version,section.id,section.title,section.text]);
async function fixture(records = [sample()], { infoHeaders = INFO, clauseHeaders = CLAUSES, infoRows = records.map(infoRow), sectionRows = records.flatMap(clauseRows), date1904 = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}">${date1904 ? '<workbookPr date1904="1"/>' : ''}<sheets><sheet name="资料信息" sheetId="1" r:id="rId1"/><sheet name="条款内容" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);
  for (const [index, headers, rows] of [[1,infoHeaders,infoRows],[2,clauseHeaders,sectionRows]]) zip.file(`xl/worksheets/sheet${index}.xml`, `<worksheet xmlns="${ns}"><sheetData>${[headers,...rows].map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>`<c r="${String.fromCharCode(65+c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
async function mutate(bytes, operation) { const zip = await JSZip.loadAsync(bytes); await operation(zip); return zip.generateAsync({type:'uint8array',compression:'DEFLATE'}); }
async function xmlChange(zip, path, change) { zip.file(path, change(await zip.file(path).async('string'))); }
async function rejected(bytes, pattern, message = '') { const result = await api().parseKnowledgeFile(file(bytes)); assert.equal(result.valid,false,message); assert.deepEqual(result.records,[]); assert.ok(result.errors.some(error=>pattern.test(error)), result.errors.join('；')); return result; }

test('blank knowledge template has exact three sheets and reusable input styles', async()=>{
  const bytes = await api().buildKnowledgeXlsx();
  assert.ok(bytes instanceof Uint8Array);
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file('xl/workbook.xml').async('string');
  assert.deepEqual([...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map(match=>match[1]),['资料信息','条款内容','填写说明']);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet,/state="frozen"/); assert.match(sheet,/<autoFilter/);
  for (const header of INFO) assert.ok(sheet.includes(header));
  const noInstructions = await JSZip.loadAsync(await api().buildKnowledgeXlsx([], {instructions:false}));
  assert.doesNotMatch(await noInstructions.file('xl/workbook.xml').async('string'),/填写说明/);
});

test('knowledge export round trips exact metadata and clause text while forcing draft', async()=>{
  const record = sample({title:'资料 <A> & "B"',source:'来源\n第二行',sections:[{id:'P005-01',title:'=SUM(A1:A2)',text:'=HYPERLINK("https://example.invalid")\n+下一行\n@保留原文\n<标签>&'}]});
  const bytes = await api().buildKnowledgeXlsx([record]);
  const parsed = await api().parseKnowledgeFile(file(bytes));
  assert.equal(parsed.valid,true,parsed.errors.join('；'));
  assert.deepEqual(parsed.records,[{...record,status:'草稿',sceneIds:[]}]);
  assert.ok(!Object.hasOwn(parsed.records[0],'createdAt'));
  const zip = await JSZip.loadAsync(bytes);
  assert.doesNotMatch(await zip.file('xl/worksheets/sheet2.xml').async('string'),/<f\b/);
});

test('same stable ID accepts several versions with independent repeated clause IDs', async()=>{
  const records = [sample(),sample({version:'V1.1',effectiveAt:'2026-11-01',changeNote:'补充适用范围',sections:[{id:'P005-01',title:'新版说明',text:'新版本条款'}]})];
  const result = await api().parseKnowledgeFile(file(await api().buildKnowledgeXlsx(records)));
  assert.equal(result.valid,true,result.errors.join('；'));
  assert.deepEqual(result.records,records.map(record=>({...record,status:'草稿',sceneIds:[]})));
});

test('empty template is rejected with a helpful data-sheet location', async()=>{
  await rejected(await api().buildKnowledgeXlsx(),/资料信息.*第2行.*资料标识.*至少|资料信息.*至少.*资料/);
});

test('missing sheets and columns and duplicate headers report a sheet and field', async()=>{
  api();
  const missingSheet = await mutate(await fixture(),zip=>xmlChange(zip,'xl/workbook.xml',xml=>xml.replace('name="条款内容"','name="其他"')));
  await rejected(missingSheet,/条款内容.*工作表|工作表.*条款内容/);
  await rejected(await fixture(undefined,{infoHeaders:INFO.map(header=>header==='版本号'?'资料版本':header)}),/资料信息.*第1行.*版本号/);
  await rejected(await fixture(undefined,{clauseHeaders:CLAUSES.map(header=>header==='条款正文'?'正文':header)}),/条款内容.*第1行.*条款正文/);
  await rejected(await fixture(undefined,{infoHeaders:[...INFO,'资料名称']}),/资料信息.*第1行.*资料名称.*重复/);
});

test('required metadata and clause cells are validated without partial imports', async()=>{
  api();
  for (const [key,label] of [['id','资料标识'],['title','资料名称'],['category','资料类别'],['scope','适用范围'],['version','版本号'],['effectiveAt','生效日期'],['owner','维护人'],['changeNote','变更说明']]) await rejected(await fixture([sample({[key]:''})]),new RegExp(`资料信息.*第2行.*${label}`));
  for (const [key,label] of [['id','条款标识'],['title','条款标题'],['text','条款正文']]) await rejected(await fixture([sample({sections:[{id:'P005-01',title:'条款',text:'正文',[key]:''}]})]),new RegExp(`条款内容.*第2行.*${label}`));
  const result = await api().parseKnowledgeFile(file(await fixture([sample({expiresAt:'',source:'',status:''})])));
  assert.equal(result.valid,true,result.errors.join('；')); assert.equal(result.records[0].status,'草稿');
});

test('versions and stable IDs must be canonical and bounded', async()=>{
  api();
  for (const version of ['1.0','v1.0','V01.0','V1.00','V1.0.0','V9007199254740992.0']) await rejected(await fixture([sample({version})]),/资料信息.*第2行.*版本号/);
  for (const id of ['P 005','P'.repeat(65)]) await rejected(await fixture([sample({id})]),/资料信息.*第2行.*资料标识/);
});

test('real ISO dates and expiry ordering are required', async()=>{
  api();
  for (const effectiveAt of ['2026-02-30','2026/10/01','2026-1-01','0000-01-01','1900-02-29']) await rejected(await fixture([sample({effectiveAt})]),/资料信息.*第2行.*生效日期/);
  for (const expiresAt of ['2026-09-30','2026-10-01','2026-13-01']) await rejected(await fixture([sample({expiresAt})]),/资料信息.*第2行.*失效日期/);
});

test('Excel serial dates convert using the workbook date system and reject the fictitious leap day', async()=>{
  api();
  const serial = Math.round((Date.UTC(2026,9,1)-Date.UTC(1899,11,30))/86400000);
  let bytes = await fixture([sample({effectiveAt:String(serial),expiresAt:String(serial+31)})]);
  bytes = await mutate(bytes,zip=>xmlChange(zip,'xl/worksheets/sheet1.xml',xml=>xml.replace(new RegExp(`<c r="F2"[\\s\\S]*?</c>`),`<c r="F2"><v>${serial}</v></c>`)));
  const parsed = await api().parseKnowledgeFile(file(bytes));
  assert.equal(parsed.valid,true,parsed.errors.join('；')); assert.equal(parsed.records[0].effectiveAt,'2026-10-01'); assert.equal(parsed.records[0].expiresAt,'2026-11-01');
  await rejected(await fixture([sample({effectiveAt:'60'})]),/生效日期/);
  const early = await api().parseKnowledgeFile(file(await fixture([sample({effectiveAt:'1'})])));
  assert.equal(early.records[0].effectiveAt,'1900-01-01');
  const system1904 = await api().parseKnowledgeFile(file(await fixture([sample({effectiveAt:'0'})],{date1904:true})));
  assert.equal(system1904.valid,true,system1904.errors.join('；')); assert.equal(system1904.records[0].effectiveAt,'1904-01-01');
});

test('duplicate metadata, duplicate clauses, orphan clauses and missing clauses are rejected', async()=>{
  api();
  await rejected(await fixture([sample(),sample()]),/资料信息.*第3行.*重复/);
  await rejected(await fixture([sample({sections:[sample().sections[0],sample().sections[0]]})]),/条款内容.*第3行.*条款标识.*重复/);
  await rejected(await fixture(undefined,{sectionRows:[['UNKNOWN','V1.0','S1','条款','正文']]}),/条款内容.*第2行.*资料标识.*不存在|条款内容.*第2行.*资料标识.*未找到/);
  await rejected(await fixture([sample({sections:[]})]),/资料信息.*第2行.*条款.*至少/);
});

test('row and text limits reject an entire import', async()=>{
  api();
  await rejected(await fixture(Array.from({length:51},(_,i)=>sample({id:`P${i}`}))),/资料信息.*50/);
  await rejected(await fixture([sample({sections:Array.from({length:501},(_,i)=>({id:`S${i}`,title:'标题',text:'正文'}))})]),/条款内容.*500/);
  for (const [key,label,max] of [['title','资料名称',120],['category','资料类别',60],['scope','适用范围',500],['owner','维护人',80],['changeNote','变更说明',2000],['source','来源说明',2000]]) await rejected(await fixture([sample({[key]:'字'.repeat(max+1)})]),new RegExp(`资料信息.*第2行.*${label}.*${max}`));
  await rejected(await fixture([sample({sections:[{id:'S1',title:'标题',text:'字'.repeat(20001)}]})]),/条款内容.*第2行.*条款正文.*20000/);
});

test('exact count and text boundaries remain importable and physical row numbers locate errors', async()=>{
  api();
  const records = Array.from({length:50},(_,i)=>sample({id:`P${i}`,sections:Array.from({length:10},(_,j)=>({id:`S${j}`,title:'标题',text:i===0 && j===0 ? '字'.repeat(20000) : '正文'}))}));
  const parsed = await api().parseKnowledgeFile(file(await api().buildKnowledgeXlsx(records)));
  assert.equal(parsed.valid,true,parsed.errors.join('；')); assert.equal(parsed.records.length,50); assert.equal(parsed.records.flatMap(record=>record.sections).length,500);
  const sparse = await mutate(await fixture([sample({title:''})]),zip=>xmlChange(zip,'xl/worksheets/sheet1.xml',xml=>xml.replace(/r="([A-Z]*)2"/g,(_,column)=>`r="${column}57"`)));
  await rejected(sparse,/资料信息.*第57行.*资料名称/);
});

test('formulas macros external relations and malicious XML cannot be imported', async()=>{
  api(); const base = await fixture();
  const attacks = [
    [zip=>xmlChange(zip,'xl/worksheets/sheet2.xml',xml=>xml.replace('<is>','<f>1+1</f><is>')),/公式/],
    [zip=>zip.file('xl/vbaProject.bin','macro'),/宏/],
    [zip=>xmlChange(zip,'xl/_rels/workbook.xml.rels',xml=>xml.replace('Target="worksheets/sheet1.xml"','TargetMode="External" Target="https://example.invalid/sheet.xml"')),/外部/],
    [zip=>zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="link" TargetMode="External" Target="https://example.invalid"/></Relationships>'),/外部/],
    [zip=>zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Id="link" TargetMode="&#69;xternal" Target="https://example.invalid"/></Relationships>'),/外部/],
    [zip=>xmlChange(zip,'xl/worksheets/sheet2.xml',xml=>'<!DOCTYPE worksheet [<!ENTITY bad SYSTEM "file:///local">]>'+xml),/安全|声明/],
  ];
  for (const [attack,pattern] of attacks) await rejected(await mutate(base,attack),pattern);
});

test('normalized content types and relationship types reject disguised macro parts', async()=>{
  api();
  const base = await api().buildKnowledgeXlsx([sample()]);
  const contentTypes = [
    'application/vnd.ms-excel.sheet.macro&#69;nabled.main+xml',
    'application/vnd.ms-office.&#118;baProject',
    'application/vnd.ms-excel.macrosheet+xml',
    'application/vnd.ms-excel.intlmacrosheet+xml',
  ];
  for (const type of contentTypes) await rejected(await mutate(base,async zip=>{
    zip.file('xl/payload.bin','macro');
    await xmlChange(zip,'[Content_Types].xml',xml=>xml.replace('</Types>',`<Override PartName="/xl/payload.bin" ContentType="${type}"/></Types>`));
  }),/宏/);
  for (const type of ['http://schemas.microsoft.com/office/2006/relationships/vbaProject','http://schemas.microsoft.com/office/2006/relationships/&#118;baProject','http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet']) await rejected(await mutate(base,async zip=>{
    zip.file('xl/payload.bin','macro');
    await xmlChange(zip,'xl/_rels/workbook.xml.rels',xml=>xml.replace('</Relationships>',`<Relationship Id="macro" Type="${type}" Target="payload.bin"/></Relationships>`));
  }),/宏/);
});

test('formula validation names the sheet physical row and actual field', async()=>{
  api();
  const formula = '<f>1+1</f><v>2</v>';
  const normal = await mutate(await fixture(),zip=>xmlChange(zip,'xl/worksheets/sheet2.xml',xml=>xml.replace(/<c r="E2"[^>]*>[\s\S]*?<\/c>/,`<c r="E2">${formula}</c>`)));
  await rejected(normal,/条款内容.*第2行.*条款正文.*公式/);
  const reordered = await fixture(undefined,{clauseHeaders:['条款正文',...CLAUSES.slice(0,4)],sectionRows:sample().sections.map(section=>[section.text,'P005','V1.0',section.id,section.title])});
  const sparse = await mutate(reordered,zip=>xmlChange(zip,'xl/worksheets/sheet2.xml',xml=>xml.replace('<row r="2">','<row r="57">').replace(/<c r="A2"[^>]*>[\s\S]*?<\/c>/,`<c r="A57">${formula}</c>`)));
  await rejected(sparse,/条款内容.*第57行.*条款正文.*公式/);
});

test('file extension ZIP integrity read failures and all archive bounds return validation results', async()=>{
  api(); const bytes = await fixture();
  for (const input of [null,file(bytes,'knowledge.csv'),file(bytes,'knowledge.xlsm'),file(bytes,'knowledge.xlsx',8*1024*1024+1),file(new Uint8Array(8*1024*1024+1),'knowledge.xlsx',1),file(new Uint8Array()),file(new Uint8Array([1,2,3])),{name:'knowledge.xlsx',size:1,arrayBuffer:async()=>{throw new Error('read error');}}]) {
    const result = await api().parseKnowledgeFile(input); assert.equal(result.valid,false); assert.deepEqual(result.records,[]); assert.ok(result.errors.length);
  }
  await rejected(await mutate(bytes,zip=>zip.file('oversized.xml','x'.repeat(4*1024*1024+1))),/大小|过大|限制/);
  await rejected(await mutate(bytes,zip=>{for(let i=0;i<81;i++)zip.file(`extra${i}.txt`,'x');}),/文件数/);
  await rejected(await mutate(bytes,zip=>{for(let i=0;i<5;i++)zip.file(`large${i}.txt`,'x'.repeat(3500000));}),/大小|限制/);
});
