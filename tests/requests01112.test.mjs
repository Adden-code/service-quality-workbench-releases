import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook,readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {createEcommerceTemplate} from '../public/ecommerce-template.mjs';
import {validateEcommerceRecord,validateEcommerceSource,EC_HEADERS} from '../public/ecommerce-schema.mjs';
import {SYSTEM_EC_HEADERS,systemReviewedMapping,operatorSite} from '../public/ecommerce-system-source.mjs';
import {prepareImportMappingPrompt,parseImportMappingResult} from '../server/import-mapping.mjs';
import {derivedOverall,sceneOverall} from '../public/scene-aggregate.mjs';
import {sceneDeliverySheets,buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {defaultScenePackage,resolveSceneRuntime} from '../public/scene-configuration.mjs';
import {createHash} from 'node:crypto';
const file=bytes=>({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});
const row=()=>{const r=Array(23).fill('');Object.assign(r,{0:'000123',4:'VMALL-MX-HWB2C',5:'Synthetic customer review',6:'Synthetic agent reply',7:'5',8:'Synthetic reviewer',9:'2026-11-18 12:00:00',13:'PRIVATE-SENTIMENT-REFERENCE',14:'Preserved follow-up',16:'2026-11-18 13:00:00'});return r;};
test('system 23 columns import at row 2, preserves physical extras, excludes source sentiment from inspection',async()=>{
 const headers=[...SYSTEM_EC_HEADERS,'extra'],values=[...row(),'001 text'];const bytes=await workbook([{name:'Export',headers,rows:[values]}]);const r=await parseEcommerceFile(file(bytes),{standardOnly:true});assert.equal(r.valid,true,r.errors.join());const s=r.sessions[0];assert.equal(s.ecommerce.schemaVersion,6);assert.equal(s.ecommerce.row,2);assert.equal(s.ecommerce.raw[3],'墨西哥');assert.deepEqual(s.ecommerce.systemSource.values,values);assert.equal(s.ecommerce.raw.slice(14).every(v=>v===''),true);assert.doesNotMatch(JSON.stringify({turns:s.turns,contextFields:s.contextFields}),/PRIVATE-SENTIMENT|follow-up/);validateEcommerceSource(s);
 const bad=structuredClone(s.ecommerce);bad.raw[8]='rewritten';assert.throws(()=>validateEcommerceRecord(bad),/原文不一致/);
 const tables=await readXlsx(await createEcommerceTemplate());assert.deepEqual([...tables.系统导出[0]],SYSTEM_EC_HEADERS);assert.equal(tables.系统导出.length,1);
});
test('operator site fallback only fills unrecognized operators and never overrides known sites',()=>{assert.equal(operatorSite('VMALL-MX-HWB2C','Default').value,'墨西哥');assert.equal(operatorSite('unknown','Synthetic site').origin,'batch-manual');assert.equal(operatorSite('maybe MX operator').value,'');});
test('old 22 source requires conversion in operator flow; mapping does not import historic judgement columns',async()=>{
 const raw=Array(22).fill('');for(const [a,b]of [[4,0],[5,1],[6,2],[7,3],[8,5],[9,6],[10,7],[11,8],[12,9],[13,16]])raw[a]=row()[b];raw[15]='PRIVATE-OLD-FAIL';
 const bytes=await workbook([{name:'Old',headers:EC_HEADERS,rows:[Array(22).fill(''),raw]}]),source={sourceName:'synthetic.xlsx',fileSha256:createHash('sha256').update(bytes).digest('hex'),sheet:'Old',sheetIndex:1,headers:[...EC_HEADERS]};assert.equal((await parseEcommerceFile(file(bytes),{standardOnly:true})).valid,false);
 const pairs=[[5,9],[6,10],[7,11],[8,12],[9,13],[16,14]],mappings=pairs.map(([targetIndex,sourceColumn])=>({targetIndex,sourceColumn,sourceHeader:source.headers[sourceColumn-1]}));const receipt=systemReviewedMapping(source,mappings,{reviewed:true,applied:true,dataStartRow:3});const r=await parseEcommerceFile(file(bytes),{standardOnly:true,reviewedMapping:receipt,batchSite:'Synthetic site'});assert.equal(r.valid,true,r.errors.join());assert.equal(r.sessions[0].ecommerce.row,3);assert.equal(r.sessions[0].ecommerce.raw[15],'');assert.equal(r.sessions[0].ecommerce.systemSource.values[15],'PRIVATE-OLD-FAIL');
 const prompt=prepareImportMappingPrompt({...source,mappingVersion:2});assert.equal(JSON.parse(prompt.messages[1].content).targets.length,23);assert.deepEqual(parseImportMappingResult(JSON.stringify({mappings}),{...source,mappingVersion:2}).mappings,mappings);
});
test('new aggregate is fail-only for judged records, old snapshots unchanged, absent results not passing',()=>{
 const old={configuration:{aggregateRuleId:'NP-R01',ruleBindings:[{ruleId:'NP-R01',ruleVersion:'V1.1'},{ruleId:'NP-R02',ruleVersion:'V1.1'}]}},next=structuredClone(old);next.configuration.aggregatePolicy='fail-only.v2';
 for(const [v,expected]of [['不适用','符合'],['无法判定','符合'],['不符合','不符合'],['符合','符合']]){const r=derivedOverall(next,[{ruleId:'NP-R02',verdict:v}]);assert.equal(r.verdict,expected);assert.equal(r.unknownCount,v==='无法判定'?1:0);}
 assert.equal(derivedOverall(old,[{ruleId:'NP-R02',verdict:'不适用'}]).verdict,'不适用');assert.equal(derivedOverall(old,[{ruleId:'NP-R02',verdict:'无法判定'}]).verdict,'无法判定');assert.equal(derivedOverall(next,[]).verdict,'未执行');assert.equal(sceneOverall(next,['符合','未执行']),'未执行');
});
test('configured detail and HTML share new aggregate and flag unknown without an overall NA column',()=>{
 const basis={rules:[{id:'NP-R01',version:'V1.2'},{id:'NP-R02',version:'V1'}],policies:[]},p=defaultScenePackage({id:'新品产品咨询',name:'Synthetic',engine:'conversation'},basis);p.configuration.aggregateRuleId='NP-R01';p.configuration.aggregatePolicy='fail-only.v2';p.configuration.executionMode='configured';p.template.renderMode='configured';p.template.columns=p.template.columns.filter(c=>c.ruleId!=='NP-R01');
 const snapshot={taskName:'Synthetic',source:{name:'Synthetic.xlsx'},executionSnapshot:{configuration:p.configuration,template:p.template,runtime:resolveSceneRuntime(p.configuration)},sceneAudit:[{id:'S',externalId:'SYN-1',review:{status:'已确认',drafts:{},history:[]},ai:[]}],records:[{id:'S',product:'Synthetic',final:[{id:'NP-R02',verdict:'无法判定',source:'confirmed',reason:'Missing knowledge'}],conversation:'Synthetic'}],original:{headers:['Original'],rows:[{recordId:'S',sourceRow:2,values:['Synthetic']}],productSources:{}}};
 const sheets=sceneDeliverySheets(snapshot);assert.match(JSON.stringify(sheets[0]),/含 1 项无法判定/);assert.match(JSON.stringify(sheets[0]),/Pass/);const html=buildSceneReportHtml(snapshot);assert.match(html,/含 1 项无法判定/);assert.match(html,/100.0%/);assert.doesNotMatch(html,/整体NA/);
});

test('changing batch site after confirmed conversion preserves the mapping and row boundary',async()=>{
 const {createEcommerceManager}=await import('../public/ecommerce-manager.mjs');
 const raw=Array(22).fill('');for(const [a,b]of [[8,5],[9,6],[10,7],[11,8],[12,9],[13,16]])raw[a]=row()[b];
 const bytes=await workbook([{name:'Old',headers:EC_HEADERS,rows:[Array(22).fill(''),raw]}]);
 const source={fileSha256:createHash('sha256').update(bytes).digest('hex'),sheet:'Old',sheetIndex:1,headers:[...EC_HEADERS]},mappings=[[5,9],[6,10],[7,11],[8,12],[9,13],[16,14]].map(([targetIndex,sourceColumn])=>({targetIndex,sourceColumn,sourceHeader:source.headers[sourceColumn-1]}));
 const receipt=systemReviewedMapping(source,mappings,{reviewed:true,applied:true,dataStartRow:3});
 const d={type:'ecommerce-import',file:file(bytes),thresholdHours:24,selectedSheet:'Old',availableSheetNames:['Old'],reviewedMapping:receipt,conversion:{source,mappings,dataStartRow:3}};
 const manager=createEcommerceManager({getDialog:()=>d,renderDialog:()=>{}});manager.change({target:{id:'ec-batch-site',value:'Synthetic site'}});
 for(let i=0;i<300&&d.loading;i++)await new Promise(r=>setTimeout(r,2));
 assert.equal(d.loading,false);assert.equal(d.parsed.valid,true,d.error);assert.deepEqual(d.reviewedMapping,receipt);assert.equal(d.parsed.sessions[0].ecommerce.row,3);assert.equal(d.parsed.sessions[0].ecommerce.raw[3],'Synthetic site');
});

test('new builtin ecommerce explanations are translated without changing original material',async()=>{
 const {t,setLocale}=await import('../public/i18n.mjs'),{BUILTIN_ECOMMERCE_RULE_DESCRIPTIONS}=await import('../public/ecommerce-template.mjs');setLocale('en');try{for(const pair of BUILTIN_ECOMMERCE_RULE_DESCRIPTIONS)for(const value of pair)assert.doesNotMatch(t(value),/\p{Script=Han}/u);}finally{setLocale('zh');}
});
