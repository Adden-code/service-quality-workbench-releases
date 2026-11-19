import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildSceneReportHtml,buildSceneDeliveryXlsx,sceneDeliverySheets,sceneReportSizeWarning} from '../public/scene-delivery.mjs';
import {canonicalReportValue,reportSha256,sceneReportIdentity,sceneSnapshotAuditSheet,SCENE_REPORT_WARNING_BYTES} from '../public/scene-report-audit.mjs';
import {readXlsx} from '../public/io.mjs';
import {sceneReportFixture} from './scene-report-fixtures.mjs';
const sha=text=>createHash('sha256').update(text).digest('hex');
test('offline report SHA-256 agrees with Node for UTF-8 and SHA block boundaries',()=>{
 for(const text of ['', 'abc', '中文😀',...'x'.repeat(70).split('').map((_,i)=>'a'.repeat(i+1))])assert.equal(reportSha256(text),sha(text));
});
for(const engine of ['ecommerce','conversation'])for(const language of ['zh','en'])test(`${engine} ${language} restores numbered business report without changing frozen semantics`,()=>{
 const {snapshot,enrichment,translations}=sceneReportFixture(engine),before=structuredClone(snapshot),html=buildSceneReportHtml(snapshot,enrichment,{language,translations}),count=engine==='ecommerce'?6:5;
 assert.match(html,/MSS QUALITY WORKBENCH · BUSINESS DELIVERY/);assert.match(html,/report-banner/);assert.match(html,/metadata|meta-primary/);assert.match(html,/class="stats"/);assert.match(html,/<svg/);assert.match(html,/class="rate-comparison"/);assert.match(html,/class="case error-case"/);assert.match(html,/class="actions"/);assert.match(html,/window.print\(\)/);assert.match(html,/@media print/);assert.match(html,/provenance-strip/);
 assert.equal((html.match(/<section class="report-section"/g)||[]).length,count);assert.match(html,new RegExp(`<span class="section-number">0${count}</span>`));assert.doesNotMatch(html,/<details|JSON\.stringify|&quot;ruleBindings&quot;/);
 assert.match(html,/synthetic-report-source.xlsx/);assert.match(html,/2026-11-01 — 2026-11-18/);assert.match(html,/Synthetic Region/);assert.match(html,/a{64}/);assert.match(html,language==='zh'?/不合格原因聚类与改进建议/:/Failure-cause clusters and improvement recommendations/);assert.match(html,language==='zh'?/用户评价声量聚类/:/Customer review voice clusters/);
 const identity=sceneReportIdentity(snapshot),{createdAt,...signature}=snapshot;assert.equal(identity.snapshotFingerprint,sha(canonicalReportValue(signature)));assert.match(html,new RegExp(identity.contentHash));assert.match(html,new RegExp(identity.snapshotFingerprint));assert.deepEqual(snapshot,before);
 const changed=structuredClone(snapshot);changed.executionSnapshot.configuration.aggregatePolicy='legacy';assert.notEqual(sceneReportIdentity(changed).contentHash,identity.contentHash);
});
for(const engine of ['ecommerce','conversation'])test(`${engine}: 180 rows with a multi-megabyte frozen reference stay under 2 MB`,()=>{
 const {snapshot,enrichment}=sceneReportFixture(engine,180,{largeFrozen:true}),source=JSON.stringify(snapshot);assert.ok(Buffer.byteLength(source)>8*1024*1024);
 const html=buildSceneReportHtml(snapshot,enrichment);assert.ok(Buffer.byteLength(html)<SCENE_REPORT_WARNING_BYTES,`${Buffer.byteLength(html)} bytes`);assert.doesNotMatch(html,/SYNTHETIC_FROZEN_ONLY_/);assert.equal(sceneReportSizeWarning(html),null);
 const audit=sceneSnapshotAuditSheet(snapshot,enrichment),parts=audit.rows.filter(row=>row[0]==='deliverySnapshot'),json=parts.map(row=>row[4]).join('');assert.equal(json,source);assert.equal(parts[0][3],sha(json));assert.ok(parts.every(row=>row[4].length<=24000));assert.equal(JSON.parse(json).executionSnapshot.configuration.referenceMaterials[0].text,snapshot.executionSnapshot.configuration.referenceMaterials[0].text);
});
for(const engine of ['ecommerce','conversation'])for(const language of ['zh','en'])test(`${engine} ${language}: exported XLSX reconstructs full snapshot and audit hashes`,async()=>{
 const {snapshot,enrichment,translations}=sceneReportFixture(engine,8);snapshot.executionSnapshot.configuration.referenceMaterials=[{text:'完整审计原件😀'.repeat(6000)}];
 const sheets=sceneDeliverySheets(snapshot,enrichment);assert.ok(sheets.find(s=>s.name==='完整审计附页').rows.length);assert.doesNotMatch(sheets.find(s=>s.name==='固定声明').rows.find(r=>r[0]==='冻结版本')[1],/ruleBindings/);
 const tables=await readXlsx(await buildSceneDeliveryXlsx(snapshot,enrichment,{language,translations})),sheet=tables[language==='en'?'Frozen snapshot audit':'冻结快照审计'];assert.ok(sheet);
 const html=buildSceneReportHtml(snapshot,enrichment,{language,translations});
 for(const kind of ['deliverySnapshot','enrichment']){const rows=sheet.slice(1).filter(r=>r[0]===kind),json=rows.map(r=>r[4]).join('');assert.equal(sha(json),rows[0][3]);const restored=JSON.parse(json);assert.deepEqual(restored,kind==='deliverySnapshot'?snapshot:enrichment);if(kind==='deliverySnapshot'){const identity=sceneReportIdentity(restored);assert.ok(html.includes(`data-content-hash="${identity.contentHash}"`));assert.ok(html.includes(`data-snapshot-fingerprint="${identity.snapshotFingerprint}"`));}}
 assert.ok(tables[language==='en'?'Full audit trail':'完整审计附页']);
});
test('large HTML warns in the file and exposes a callback without truncating business text',()=>{
 const {snapshot,enrichment}=sceneReportFixture(),warnings=[];enrichment.issueClusters[0].summary='LARGE_SYNTHETIC_TEXT'.repeat(125000);
 const html=buildSceneReportHtml(snapshot,enrichment,{onWarning:warning=>warnings.push(warning)});assert.equal(warnings.length,1);assert.equal(warnings[0].code,'REPORT_HTML_LARGE');assert.match(html,/report-size-warning/);assert.match(html,/超过 2 MB/);assert.ok(html.includes(enrichment.issueClusters[0].summary));assert.equal(sceneReportSizeWarning('a'.repeat(SCENE_REPORT_WARNING_BYTES)),null);
});
test('custom section headings and old aggregation contracts remain frozen',()=>{
 const {snapshot}=sceneReportFixture();delete snapshot.executionSnapshot.configuration.aggregatePolicy;snapshot.executionSnapshot.template.sections=[{key:'improvements',title:'Business-approved custom heading'}];snapshot.records[0].final.forEach(r=>r.verdict='无法判定');const before=structuredClone(snapshot),html=buildSceneReportHtml(snapshot);assert.match(html,/Business-approved custom heading/);assert.equal((html.match(/<section class="report-section"/g)||[]).length,1);assert.deepEqual(snapshot,before);
});
test('English translation slots never reuse Chinese base translations; original job fingerprints remain visible',()=>{
 const {snapshot,enrichment}=sceneReportFixture();snapshot.targetLang='zh';snapshot.records[0].raw22[8]='原评价中文';enrichment.translations[snapshot.records[0].id].comment.text='不能用于英文的中文译文';
 const html=buildSceneReportHtml(snapshot,enrichment,{language:'en',job:{snapshotFingerprint:'saved-original-fingerprint'}});assert.doesNotMatch(html,/不能用于英文的中文译文/);assert.match(html,/Translation missing \(pending or failed\)/);assert.match(html,/Original/);assert.match(html,/saved-original-fingerprint/);assert.match(html,/Saved report job fingerprint/);
});
test('known frozen default rename aliases restore approved headings, with or without spaces; custom titles remain exact',()=>{
 for(const [key,title,expected] of [['improvements','不合格原因聚类与 Top3 改进方向','不合格原因聚类与改进建议'],['improvements','不合格原因聚类与Top3改进方向','不合格原因聚类与改进建议'],['voc','用户评价原声聚类','用户评价声量聚类'],['voc','用户评价 原声聚类','用户评价声量聚类'],['improvements','业务自定义：不合格原因聚类与 Top3 改进方向','业务自定义：不合格原因聚类与 Top3 改进方向'],['voc','业务自定义：用户评价原声聚类','业务自定义：用户评价原声聚类']]){
  const {snapshot}=sceneReportFixture();snapshot.executionSnapshot.template.sections=[{key,title}];const before=structuredClone(snapshot),html=buildSceneReportHtml(snapshot);assert.ok(html.includes(`<span class="section-number">01</span>${expected}</h2>`),title);assert.deepEqual(snapshot,before);
 }
});
