import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {workbook,readXlsx,XLSX_ROW_NUMBER} from '../public/io.mjs';
import {consultationOriginalFromTables,loadConsultationOriginal} from '../server/consultation-source.mjs';
import {createConsultationDeliverySnapshot} from '../public/consultation-delivery.mjs';

const row=(sourceRow,values)=>{Object.defineProperty(values,XLSX_ROW_NUMBER,{value:sourceRow});return values;};
const fixture=()=>{
 const task={id:'t',mode:'manual',scene:'新品产品咨询',source:{name:'原始表.xlsx',sha256:'0'.repeat(64),size:1},importMappingSnapshot:{profile:{sheet:'业务原表',headerRow:2,fields:{id:'会话ID',agent:'客服',text:'消息详情',product:'产品'},defaults:{product:'默认产品'}}}};
 const sessions=['001','002','003'].map((externalId,i)=>({id:'s'+i,taskId:'t',externalId,scene:'新品产品咨询',product:'不用于猜来源',turns:[{id:1,role:'客户',text:'咨询'+externalId}]}));
 const state={tasks:[task],sessions};
 const tables={'业务原表':[row(2,[' 会话ID ','客服','消息详情','产品','空列','备注']),row(4,[' 002 ','乙','  原始消息二\n完整  ','原表机型','','00001']),row(9,['001','甲','原始消息一','','','']),row(20,['003','丙','原始消息三','','','=仅文本'])]};
 return{state,task,tables};
};

test('consultation source preserves original headers/blank columns/values and joins by external ID and physical row',()=>{
 const f=fixture(),original=consultationOriginalFromTables(f.state,f.task,f.tables);
 assert.deepEqual(original.headers,[' 会话ID ','客服','消息详情','产品','空列','备注']);
 assert.deepEqual(original.rows.map(r=>[r.sourceRow,r.recordId]),[[4,'s1'],[9,'s0'],[20,'s2']]);
 assert.equal(original.rows[0].values[2],'  原始消息二\n完整  ');assert.equal(original.rows[0].values[5],'00001');assert.equal(original.messageColumn,2);
 assert.deepEqual(original.productSources.s1,{value:'原表机型',source:'原表列',column:'产品'});
 assert.deepEqual(original.productSources.s0,{value:'默认产品',source:'任务默认'});
 f.task.importMappingSnapshot.profile.defaults.product='';const missing=consultationOriginalFromTables(f.state,f.task,f.tables);assert.deepEqual(missing.productSources.s0,{value:'',source:'未提供'});
});

test('source refuses unmatched/duplicate source IDs, lost rows and ambiguous headers without an invented fallback',()=>{
 for(const alter of [f=>f.tables['业务原表'][1][0]='unknown',f=>f.state.sessions.push({...f.state.sessions[0],id:'other'}),f=>f.tables['业务原表'].pop(),f=>f.tables['业务原表'][0][3]='会话ID']){
  const f=fixture();alter(f);assert.throws(()=>consultationOriginalFromTables(f.state,f.task,f.tables),/标识|原表|会话|重复|来源|表头/);
 }
});

test('standard two-sheet input keeps all source columns and the turn sheet without inventing source rows',()=>{
 const f=fixture();delete f.task.importMappingSnapshot;f.state.sessions=f.state.sessions.slice(0,1);
 const tables={'会话信息':[row(1,['会话ID','产品型号','备注']),row(7,['001','原始机型','保持'])],'会话明细':[row(1,['会话ID','原文内容','附加']),row(14,['001','实际消息','001'])]};
 const original=consultationOriginalFromTables(f.state,f.task,tables);assert.equal(original.rows[0].sourceRow,7);assert.equal(original.messageColumn,null);assert.equal(original.additionalSheets[0].rows[0].sourceRow,14);assert.deepEqual(original.productSources.s0,{value:'原始机型',source:'原表列',column:'产品型号'});
});

test('original product header whitespace and sparse standard header positions remain compatible with frozen snapshots',()=>{
 const f=fixture();f.tables['业务原表'][0][3]=' 产品 ';f.task.basisSnapshot={rules:[{id:'any',title:'检核',category:'实际类别',version:'1'}],policies:[]};
 const original=consultationOriginalFromTables(f.state,f.task,f.tables);assert.equal(original.productSources.s1.column,' 产品 ');
 assert.equal(createConsultationDeliverySnapshot(f.state,{taskId:'t',original}).records.find(r=>r.id==='s1').product,'原表机型');
 delete f.task.importMappingSnapshot;f.state.sessions=f.state.sessions.slice(0,1);
 const sparse={'会话信息':[row(5,['会话ID','产品型号']),row(9,['001','产品'])],'会话明细':[row(6,['会话ID','原文内容']),row(15,['001','消息'])]};
 const standard=consultationOriginalFromTables(f.state,f.task,sparse);assert.equal(standard.headerRow,5);assert.equal(standard.additionalSheets[0].headerRow,6);
});

test('archived XLSX loads with bundled zip and verifies exact bytes/SHA before use',async()=>{
 const f=fixture(),bytes=await workbook([{name:'业务原表',headers:['会话ID','客服','消息详情','产品','空列','备注'],rows:[['001','甲','原始一','','',''],['002','乙','原始二','列产品','',''],['003','丙','原始三','','','']]}]);
 f.task.importMappingSnapshot.profile.headerRow=1;f.task.source.sha256=createHash('sha256').update(bytes).digest('hex');f.task.source.size=bytes.length;
 const store={getSource:async sha=>{assert.equal(sha,f.task.source.sha256);return{...f.task.source,bytes};}};
 const original=await loadConsultationOriginal({state:f.state,task:f.task,store});assert.equal(typeof globalThis.JSZip,'function');assert.equal(original.rows.length,3);assert.equal(original.productSources.s1.value,'列产品');
 const bad={getSource:async()=>({...f.task.source,bytes:new Uint8Array([1,2,3])})};await assert.rejects(loadConsultationOriginal({state:f.state,task:f.task,store:bad}),/指纹|摘要|不一致/);
});

test('an installed payload without package.json or node_modules loads the bundled CommonJS JSZip',async t=>{
 const root='D:/Codex project/outputs/service-consultation-delivery-20261104/zip-package-test';await fs.mkdir(root,{recursive:true});const folder=await fs.mkdtemp(root+'/installed-');
 t.after(async()=>{assert.ok(path.resolve(folder).startsWith(path.resolve(root)+path.sep));await fs.rm(folder,{recursive:true,force:true});});
 await fs.mkdir(path.join(folder,'server'));await fs.copyFile(new URL('../server/consultation-source.mjs',import.meta.url),path.join(folder,'server/consultation-source.mjs'));await fs.cp(new URL('../public/',import.meta.url),path.join(folder,'public'),{recursive:true});
 const f=fixture(),bytes=await workbook([{name:'业务原表',headers:['会话ID','客服','消息详情','产品'],rows:[['001','甲','消息一',''],['002','乙','消息二',''],['003','丙','消息三','']]}]);
 f.task.importMappingSnapshot.profile.headerRow=1;f.task.source.sha256=createHash('sha256').update(bytes).digest('hex');f.task.source.size=bytes.length;
 await fs.writeFile(path.join(folder,'input.json'),JSON.stringify({state:f.state,task:f.task,bytes:Buffer.from(bytes).toString('base64')}));
 await fs.writeFile(path.join(folder,'probe.mjs'),"import fs from 'node:fs/promises';import {loadConsultationOriginal} from './server/consultation-source.mjs';const d=JSON.parse(await fs.readFile(new URL('./input.json',import.meta.url),'utf8'));const original=await loadConsultationOriginal({...d,store:{getSource:async()=>({...d.task.source,bytes:Buffer.from(d.bytes,'base64')})}});console.log(JSON.stringify({rows:original.rows.length,zip:typeof globalThis.JSZip}));");
 const result=await promisify(execFile)(process.execPath,[path.join(folder,'probe.mjs')],{windowsHide:true,cwd:folder});assert.deepEqual(JSON.parse(result.stdout.trim()),{rows:3,zip:'function'});
});
