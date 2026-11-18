import test from 'node:test';
import assert from 'node:assert/strict';
import {printableReport} from '../public/report-print.mjs';
test('print action is local and generated report evidence stays byte-for-byte inside document',()=>{
 const evidence='<main><h1>合成报告</h1><table><thead><tr><th>原文</th></tr></thead><tbody><tr><td>&lt;script&gt;占位&lt;/script&gt;</td></tr></tbody></table></main>';
 const html=`<!doctype html><html lang="zh-CN"><head><title>报告</title></head><body>${evidence}</body></html>`,result=printableReport(html);
 assert.ok(result.includes(evidence));assert.match(result,/onclick="window\.print\(\)"/);assert.match(result,/display:table-header-group/);assert.match(result,/@media print/);assert.match(result,/#workbench-print-controls\{display:none!important/);assert.doesNotMatch(result,/https?:\/\//);assert.equal(printableReport(result),result);
});
test('standalone report language controls print label independently from app locale',()=>{
 const result=printableReport('<html lang="en"><head></head><body><h1>Report</h1></body></html>');assert.match(result,/Print \/ Save as PDF/);assert.doesNotMatch(result,/打印/);
 assert.equal(printableReport('plain data'),'plain data');assert.equal(printableReport(null),null);
});
