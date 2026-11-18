import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {workbook,readXlsx} from '../public/io.mjs';

test('actual inline and shared SpreadsheetML escapes decode once to exact cell logical text',async()=>{
 globalThis.JSZip=JSZip;
 const zip=await JSZip.loadAsync(await workbook([{name:'合成原文',headers:['消息详情'],rows:[['PLACEHOLDER']]}]));
 const encoded='  A_x000D_\nB_x0009_عربي_xD83D__xDE00_ &amp; _x005F_x000D_ _x005f_x0041_  ',expected='  A\r\nB\tعربي😀 & _x000D_ _x0041_  ';
 const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');zip.file('xl/worksheets/sheet1.xml',xml.replace('PLACEHOLDER',encoded));
 assert.equal((await readXlsx(await zip.generateAsync({type:'uint8array'})))['合成原文'][1][0],expected);
 zip.file('xl/sharedStrings.xml',`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t xml:space="preserve">${encoded}</t></r></si></sst>`);
 zip.file('xl/worksheets/sheet1.xml',xml.replace('<c r="A2" s="0" t="inlineStr"><is><t xml:space="preserve">PLACEHOLDER</t></is></c>','<c r="A2" t="s"><v>0</v></c>'));
 assert.equal((await readXlsx(await zip.generateAsync({type:'uint8array'})))['合成原文'][1][0],expected);
});
test('writer roundtrips CRLF, controls and escape-looking literal source text without reinterpreting it',async()=>{
 const values=['a\r\nb\rc\nd','_x000D_','_x005F_x000D_','_x005F_','_x0000_','\u0000\u0001\u000B\u000C\u001F','😀 _xD83D__xDE00_','  _x0041_  '];
 const bytes=await workbook([{name:'合成原文',headers:['消息详情'],rows:values.map(value=>[value])}]),tables=await readXlsx(bytes);
 assert.deepEqual(tables['合成原文'].slice(1).map(row=>row[0]),values);
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.ok(xml.includes('_x005F_x000D_'),'Escape-looking source literals must be escaped in OOXML.');assert.ok(xml.includes('_x000D_'));
});
