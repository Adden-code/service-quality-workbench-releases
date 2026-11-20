import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook,readXlsx} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {ecommerceSourceProjection} from '../public/ecommerce-schema.mjs';
import {SYSTEM_EC_HEADERS,operatorSite} from '../public/ecommerce-system-source.mjs';
import {normalizeEcReportMetadata,ecReportMetadataSummary} from '../public/ec-report-metadata.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessDeliverySnapshot,buildBusinessDeliveryXlsx} from '../public/business-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {migrateSceneConfigurations} from '../server/scene-configuration-service.mjs';
import {sceneBasisForTask,validateSceneRegistry} from '../public/scene-configuration.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {publishedFixture,sourceRow} from './v21-runtime-fixtures.mjs';
import {importDraftSnapshot,restoreImportDraft} from '../public/import-drafts-manager.mjs';
import {collectReportTranslationFields} from '../public/report-locale.mjs';

const now='2026-11-20T10:00:00+08:00';
const record=(operator,index)=>{const raw=Array(23).fill('');Object.assign(raw,{0:`SYN-${index}`,3:'Synthetic device',4:operator,5:'Synthetic battery lasts all day.',6:'Synthetic reply about battery life.',7:'5',8:'Synthetic admin',9:'2026-11-01 10:00:00',16:'2026-11-01 11:00:00'});return raw;};
async function imported(operators=['VMALL-MX-HWB2C','VMALL-SA-HWB2C','VMALL-MX-HWB2C','UNRECOGNIZED'],batchSite=''){
 const bytes=await workbook([{name:'Synthetic',headers:SYSTEM_EC_HEADERS,rows:operators.map(record)}]);
 const file={name:'synthetic-metadata.xlsx',size:bytes.length,arrayBuffer:async()=>bytes};
 const parsed=await parseEcommerceFile(file,{batchSite});assert.equal(parsed.valid,true,parsed.errors.join(';'));
 return{file,parsed,source:{name:file.name,size:file.size,sha256:parsed.sessions[0].ecommerce.fileSha256,worksheet:{name:parsed.selectedSheet,index:parsed.selectedSheetIndex}}};
}
async function fixture(metadata,operators,batchSite){
 const input=await imported(operators,batchSite),legacy=publishedFixture(),doc=migrateSceneConfigurations({state:createBusinessState(),catalog:legacy.catalog},{now});
 for(const template of doc.state.deliveryTemplates)template.renderMode='configured';
 const basisSnapshot=sceneBasisForTask(doc.state,doc.catalog,'电商评论回复',now);
 const state=createImportedTask(doc.state,{name:'Synthetic metadata batch',sessions:input.parsed.sessions,source:input.source,basisSnapshot,reviewer:'Synthetic reviewer',ecReportMetadata:metadata,now});
 validateWorkspace(state,doc.catalog,doc.state,{authenticateNewSnapshots:true});
 return{...input,state,catalog:doc.catalog,previous:doc.state,task:state.tasks[0]};
}
const snapshot=f=>createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,now});
const banner=html=>html.match(/<header[\s>][\s\S]*?<\/header>/)?.[0]||'';

test('new 23-column task freezes optional batch metadata in task, execution and delivery snapshots',async()=>{
 const input={samplingPeriod:' 2026-11 第一周 ',reportRegion:' Synthetic cross-country region '},f=await fixture(input),before=structuredClone(f.state);
 assert.deepEqual(f.task.ecReportMetadata,{schemaVersion:1,samplingPeriod:'2026-11 第一周',reportRegion:'Synthetic cross-country region'});
 assert.deepEqual(f.task.executionSnapshot.ecReportMetadata,f.task.ecReportMetadata);input.reportRegion='late edit';
 const report=snapshot(f);assert.deepEqual(report.ecReportMetadata,f.task.ecReportMetadata);assert.deepEqual(report.executionSnapshot.ecReportMetadata,f.task.ecReportMetadata);
 assert.deepEqual(report.basis.reportRegions,['Synthetic cross-country region']);assert.equal(report.basis.reportRegionSource,'batch-manual-override');
 assert.deepEqual(report.basis.ecReportMetadataAudit.sourceCountries,['墨西哥','沙特']);assert.deepEqual(f.state,before);
 for(const render of [buildBusinessReportHtml,buildSceneReportHtml]){const html=render(report);assert.match(banner(html),/2026-11 第一周/);assert.match(banner(html),/Synthetic cross-country region/);assert.doesNotMatch(banner(html),/墨西哥|沙特/);assert.match(html,/批次手工覆盖（仅报告地区）/);}
 assert.ok(collectReportTranslationFields(report,{}).some(field=>field.text==='Synthetic cross-country region'));
 f.state.tasks[0].name='later name';assert.equal(report.taskName,'Synthetic metadata batch');
});

test('blank metadata uses distinct countries and no generated-date substitution',async()=>{
 const f=await fixture(),report=snapshot(f);
 assert.deepEqual(f.task.ecReportMetadata,{schemaVersion:1,samplingPeriod:'',reportRegion:''});assert.deepEqual(report.basis.reportRegions,['墨西哥','沙特']);
 assert.deepEqual(report.basis.samplingPeriods,[]);const html=buildSceneReportHtml(report);
 assert.match(banner(html),/未提供；不以生成时间替代/);assert.match(banner(html),/墨西哥 · 沙特/);assert.equal(report.basis.reportRegionSource,'source-country');
 const missing=snapshot(await fixture(undefined,['UNRECOGNIZED']));assert.deepEqual(missing.basis.reportRegions,[]);assert.equal(missing.basis.reportRegionSource,'missing');assert.match(banner(buildSceneReportHtml(missing)),/未提供/);
});

test('English scene report translates the new banner fields and explicitly marks missing metadata',async()=>{
 const f=await fixture({samplingPeriod:'2026-11 第一周',reportRegion:'合成报告地区'}),report=snapshot(f);
 const dictionary={'2026-11 第一周':'First week of November 2026','合成报告地区':'Synthetic report region','墨西哥':'Mexico','沙特':'Saudi Arabia'};
 const translations=collectReportTranslationFields(report,{}).map(field=>({id:field.id,sourceText:field.text,text:dictionary[field.text]||'Synthetic translated field',status:'translated',detectedLanguage:'zh'}));
 const html=buildSceneReportHtml(report,{}, {language:'en',translations});assert.match(banner(html),/First week of November 2026/);assert.match(banner(html),/Synthetic report region/);assert.doesNotMatch(banner(html),/Translation missing/);assert.match(html,/Manual batch override \(report region only\)/);
 const automatic=snapshot(await fixture()),autoTranslations=collectReportTranslationFields(automatic,{}).map(field=>({id:field.id,sourceText:field.text,text:dictionary[field.text]||'Synthetic translated field',status:'translated',detectedLanguage:'zh'}));
 const autoHtml=buildSceneReportHtml(automatic,{}, {language:'en',translations:autoTranslations});assert.match(banner(autoHtml),/Mexico[\s\S]*Saudi Arabia/);assert.match(banner(autoHtml),/Not provided; generation time is not a substitute/);
});

test('report override never changes row site, 22-country mapping, original cells or timing projection',async()=>{
 const countries=['MX','SA','AE','ZA','EG','TR','MY','TH','PH','ID','SG','CL','CO','PE','BR','GB','DE','FR','IT','ES','PL','RO'];
 for(const code of countries){const result=operatorSite(`VMALL-${code}-HWB2C`,'Synthetic fallback');assert.equal(result.code,code);assert.equal(result.origin,'operator-code');assert.notEqual(result.value,'Synthetic fallback');}
 const f=await fixture({reportRegion:'Manual banner only'},['VMALL-MX-HWB2C','UNKNOWN'],'Synthetic fallback');
 assert.deepEqual(f.state.sessions.map(s=>s.ecommerce.raw[3]),['墨西哥','Synthetic fallback']);
 assert.deepEqual(f.state.sessions.map(s=>s.ecommerce.raw),f.parsed.sessions.map(s=>s.ecommerce.raw));
 assert.deepEqual(f.state.sessions.map(s=>s.ecommerce.systemSource.values),f.parsed.sessions.map(s=>s.ecommerce.systemSource.values));
 const report=snapshot(f);assert.deepEqual(report.basis.ecReportMetadataAudit.unrecognizedSiteFallbacks,['Synthetic fallback']);
 assert.deepEqual(report.records.map(r=>r.time),snapshot(await fixture({},['VMALL-MX-HWB2C','UNKNOWN'],'Synthetic fallback')).records.map(r=>r.time));
 const automatic=ecReportMetadataSummary(normalizeEcReportMetadata(),report.records);assert.deepEqual(automatic.reportRegions,['墨西哥','Synthetic fallback']);
});

test('server rejects added, removed, changed and unrecognized metadata on saved tasks',async()=>{
 const f=await fixture({samplingPeriod:'Synthetic week',reportRegion:'Synthetic region'});
 for(const mutate of [t=>{t.ecReportMetadata.reportRegion='Changed';t.executionSnapshot.ecReportMetadata.reportRegion='Changed';},t=>{delete t.ecReportMetadata;delete t.executionSnapshot.ecReportMetadata;},t=>{t.ecReportMetadata.extra='forged';},t=>{delete t.executionSnapshot.ecReportMetadata;},t=>{delete t.executionSnapshot;}]){
  const changed=structuredClone(f.state);mutate(changed.tasks[0]);assert.throws(()=>validateWorkspace(changed,f.catalog,f.state),/报告信息|执行快照/);
 }
 const old=structuredClone(f.state);delete old.tasks[0].ecReportMetadata;delete old.tasks[0].executionSnapshot.ecReportMetadata;
 validateWorkspace(old,f.catalog,old);assert.throws(()=>validateWorkspace(f.state,f.catalog,old),/报告信息|执行快照/);
 const missing=structuredClone(f.state);delete missing.tasks[0].ecReportMetadata;delete missing.tasks[0].executionSnapshot.ecReportMetadata;
 assert.throws(()=>validateWorkspace(missing,f.catalog,f.previous,{authenticateNewSnapshots:true}),/必须冻结批次报告信息/);
 for(const value of [{extra:1},{samplingPeriod:'x'.repeat(121)},{reportRegion:2},{reportRegion:'line\nline'},{schemaVersion:2}])assert.throws(()=>normalizeEcReportMetadata(value));
 const forged=structuredClone(f.state);forged.tasks[0].executionSnapshot.ecReportMetadata.reportRegion='forged';assert.throws(()=>validateSceneRegistry(forged),/报告信息/);
});

test('historical 22-column report and old 23-column snapshot stay on their previous banner path',async()=>{
 const row=sourceRow();Object.assign(row.ecommerce.raw,{0:'Original group',1:'Original sampling period',2:'Original region',3:'Original country'});
 Object.assign(row,ecommerceSourceProjection(row.ecommerce));
 const legacy=publishedFixture([row]),task=legacy.state.tasks[0],before=structuredClone(legacy.state);
 const report=createBusinessDeliverySnapshot(legacy.state,{taskId:task.id,now});assert.equal(report.ecReportMetadata,undefined);assert.equal(task.ecReportMetadata,undefined);
 assert.deepEqual(report.basis.samplingPeriods,['Original sampling period']);assert.match(banner(buildBusinessReportHtml(report)),/Original region/);assert.deepEqual(legacy.state,before);
 const f=await fixture();delete f.task.ecReportMetadata;delete f.task.executionSnapshot.ecReportMetadata;const oldReport=snapshot(f);
 assert.equal(oldReport.basis.reportRegions,undefined);assert.doesNotMatch(banner(buildSceneReportHtml(oldReport)),/墨西哥|沙特/);
});

test('saved import draft restores metadata without conflating the fallback site',async()=>{
 const {file,parsed}=await imported(),dialog={type:'ecommerce-import',step:2,file,parsed,samplingPeriod:'2026-11 第一周',reportRegion:'Synthetic report region',batchSite:'Synthetic fallback',scene:'电商评论回复'};
 const saved=importDraftSnapshot(dialog),restored=restoreImportDraft(saved,file);
 assert.equal(restored.samplingPeriod,dialog.samplingPeriod);assert.equal(restored.reportRegion,dialog.reportRegion);assert.equal(restored.batchSite,dialog.batchSite);assert.equal(restored.file,file);assert.equal(restored.step,2);
});

test('Excel retains source data and exposes metadata provenance in frozen audit',async()=>{
 const f=await fixture({samplingPeriod:'2026-11 第一周',reportRegion:'Synthetic region'}),report=snapshot(f),sheets=await readXlsx(await buildBusinessDeliveryXlsx(report));
 const text=JSON.stringify(sheets);assert.match(text,/2026-11 第一周/);assert.match(text,/批次手工覆盖/);assert.match(text,/VMALL-MX-HWB2C/);assert.match(text,/ecReportMetadata/);
});
