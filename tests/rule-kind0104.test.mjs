import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {detectRuleKind,ruleKindOf,migrateRuleKinds} from '../public/rule-kind.mjs';
import {createCatalog,createDraft,updateDraft,validateCatalog,assignRuleKind,abandonDraft,publishVersion} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {sceneRuleAvailability} from '../public/catalog-scenes.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {prepareRawInspection,parseRawInspectionResult} from '../server/raw-inspection.mjs';
import {createConsultationDeliverySnapshot,consultationDeliveryHeaders} from '../public/consultation-delivery.mjs';
import {buildRuleTemplateXlsx,parseRuleTemplateFile} from '../public/rule-template-io.mjs';
import {readXlsx,workbook} from '../public/io.mjs';
import {rawSession,rawBasis,rawWire,inspectionAt} from './raw-contract-r16-fixtures.mjs';

const now='2026-11-15T08:00:00+08:00';
function catalogFixture(){
 const catalog=createCatalog(),base=catalog.rules[0];
 catalog.rules=[{...base,id:'NP-R20',title:'操作说明'}, {...base,id:'NP-R21',title:'Html报告结构要求'}, {...base,id:'NP-R22',title:'检核明细表输出要求'}];
 for(const rule of catalog.rules)delete rule.ruleKind;
 return catalog;
}

test('scope detection covers title and criteria while respecting explicit human correction',()=>{
 for(const title of ['Html报告结构要求','检核明细表输出要求','业务导出要求','HTML report structure requirements','detail sheet output requirements'])assert.equal(detectRuleKind({title}),'meta',title);
 assert.equal(detectRuleKind({title:'交付规范',passCriteria:'报告结构包含目录和明细表。'}),'meta');
 assert.equal(detectRuleKind({title:'客户问题解释',passCriteria:'客服说明功能与操作步骤。'}),'session-check');
 assert.equal(ruleKindOf({title:'Html报告结构要求',ruleKind:'session-check'}),'session-check');
 assert.equal(ruleKindOf({title:'普通条目',ruleKind:'meta'}),'meta');
});

test('catalog migration keeps task snapshots and results byte equivalent and is idempotent',()=>{
 const catalog=catalogFixture(),state={tasks:[{basisSnapshot:{rules:structuredClone(catalog.rules)}}],sessions:[{aiResults:[{ruleId:'NP-R21',verdict:'无法判定'}]}]},before=JSON.stringify({state,catalog});
 const next=migrateRuleKinds({state,catalog},now);
 assert.equal(JSON.stringify({state,catalog}),before);
 assert.equal(next.state,state);
 assert.deepEqual(next.catalog.rules.map(rule=>rule.ruleKind),['session-check','meta','meta']);
 assert.equal(next.catalog.events.filter(event=>event.action==='自动标记交付物要求').length,2);
 assert.equal(migrateRuleKinds(next,now).changed,false);
 assert.equal(validateCatalog(next.catalog),true);
});

test('published rule scope can be corrected with an event without editing its version or text',()=>{
 const catalog=migrateRuleKinds({state:{},catalog:catalogFixture()},now).catalog,before=structuredClone(catalog.rules[1]);
 const changed=assignRuleKind(catalog,'NP-R21','V1.0','session-check',now);
 assert.equal(changed.rules[1].ruleKind,'session-check');assert.equal(catalog.rules[1].ruleKind,'meta');
 const {ruleKind,...rest}=changed.rules[1],{ruleKind:oldKind,...oldRest}=before;assert.deepEqual(rest,oldRest);
 assert.equal(changed.events.at(-1).action,'标记会话检核');
 assert.throws(()=>assignRuleKind(catalog,'NP-R21','V1.0','unknown',now),/作用域/);
});

test('new basis and eligible task rules exclude meta, including old untyped catalog rows',()=>{
 const catalog=catalogFixture(),snapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-15',ruleIds:catalog.rules.map(rule=>rule.id),now});
 assert.deepEqual(snapshot.rules.map(rule=>[rule.id,rule.ruleKind]),[['NP-R20','session-check']]);
 assert.throws(()=>createBasisSnapshot(catalog,{effectiveDate:'2026-11-15',ruleIds:['NP-R21'],now}),/至少一条会话检核/);
 const available=sceneRuleAvailability({state:{},catalog,scene:'新品产品咨询',effectiveDate:'2026-11-15'});
 assert.deepEqual(available.rules.map(rule=>rule.id),['NP-R20']);assert.deepEqual(available.metaRules.map(rule=>rule.id),['NP-R21','NP-R22']);
 const corrected=assignRuleKind(catalog,'NP-R21','V1.0','session-check',now);
 assert.equal(createBasisSnapshot(corrected,{effectiveDate:'2026-11-15',ruleIds:['NP-R21'],now}).rules.length,1);
});

test('new drafts detect scope and abandoned drafts retain events and cannot publish',()=>{
 const catalog=createCatalog(),base=catalog.rules[0];
 const added=createDraft(catalog,'rules','NEW-R1',{...base,id:'NEW-R1',title:'报告结构要求',ruleKind:undefined},now);
 assert.equal(added.rules.at(-1).ruleKind,'meta');
 const updated=updateDraft(added,'rules','NEW-R1','V1.0',{ruleKind:'session-check'},now);assert.equal(updated.rules.at(-1).ruleKind,'session-check');
 const abandoned=abandonDraft(updated,'rules','NEW-R1','V1.0',now);assert.equal(abandoned.rules.at(-1).status,'已弃用');assert.equal(abandoned.events.at(-1).action,'弃用草稿');
 assert.equal(validateCatalog(abandoned),true);assert.throws(()=>publishVersion(abandoned,'rules','NEW-R1','V1.0',{},now),/草稿/);
 assert.throws(()=>abandonDraft(catalog,'rules',base.id,base.version,now),/草稿/);
 assert.throws(()=>validateCatalog({...catalog,rules:[{...base,ruleKind:'invalid'}]}),/作用域/);
});

test('server rejects meta in forged new task snapshots while accepting historical saved contracts',()=>{
 const catalog=createCatalog(),previous=createBusinessState(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-15',ruleIds:['R001'],now});
 const state=createImportedTask(previous,{name:'合成服务校验批次',reviewer:'合成审核员',now,source:{name:'synthetic.json',size:20,sha256:'a'.repeat(64)},basisSnapshot,sessions:[{id:'S',scene:'新品产品咨询',startedAt:now,topic:'咨询',product:'合成产品',agent:'合成客服',customer:'合成客户',channel:'线上',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'客户',at:'',text:'合成问题'}]}]});
 assert.equal(validateWorkspace(state,catalog,previous,{authenticateNewSnapshots:true}),true);
 const metaCatalog=assignRuleKind(catalog,'R001','V1.0','meta',now);
 assert.throws(()=>validateWorkspace(state,metaCatalog,previous,{authenticateNewSnapshots:true}),/交付物要求/);
 assert.equal(validateWorkspace(state,metaCatalog,state,{authenticateNewSnapshots:true}),true);
 const forged=structuredClone(state);forged.tasks[0].basisSnapshot.rules[0].ruleKind='meta';
 assert.throws(()=>validateWorkspace(forged,catalog,previous,{authenticateNewSnapshots:true}),/交付物要求/);
});

test('direct engine typed meta is absent from model input and coverage but legacy contract stays frozen',()=>{
 const session=rawSession(),basis=rawBasis(),wire=rawWire(session);
 basis.rules.push({...basis.rules[1],id:'META',title:'报告结构要求',ruleKind:'meta'});
 const before=JSON.stringify(basis),prepared=prepareRawInspection(session,basis,{inspectionAt});
 assert.deepEqual(prepared.input.basis.rules.map(rule=>rule.id),['SYN-R1','SYN-R2']);
 assert.equal(parseRawInspectionResult(JSON.stringify(wire),{session,basis}).length,2);assert.equal(JSON.stringify(basis),before);
 const legacy=structuredClone(basis);delete legacy.rules.at(-1).ruleKind;
 assert.equal(prepareRawInspection(session,legacy,{inspectionAt}).input.basis.rules.length,3);
 assert.throws(()=>prepareRawInspection(session,{...basis,rules:[basis.rules.at(-1)]},{inspectionAt}),/冻结依据/);
});

test('legacy report export removes meta columns and metrics without losing valid old AI or stored history',()=>{
 const catalog=catalogFixture(),rules=catalog.rules.map(rule=>({...rule,name:rule.title}));
 const task={id:'T',name:'合成旧批次',mode:'manual',scene:'新品产品咨询',source:{name:'synthetic.xlsx',sha256:'a'.repeat(64),size:123},sessionIds:['S'],basisSnapshot:{capturedAt:now,effectiveDate:'2026-11-15',rules,policies:catalog.policies}};
 const session={id:'S',taskId:'T',scene:'新品产品咨询',externalId:'S',startedAt:now,turns:[{id:1,role:'客服',text:'合成操作说明'}],expectedRuleIds:rules.map(rule=>rule.id),aiExecution:{status:'completed',runId:'run'},aiResults:rules.map(rule=>({ruleId:rule.id,verdict:rule.id==='NP-R20'?'符合':'无法判定',reason:'合成判断',evidence:[1],referenceIds:[]})),review:{status:'待审核',drafts:{},reviewer:'合成审核员',completedAt:null,notes:''}};
 const state={tasks:[task],sessions:[session]},original={sheetName:'合成原文',headerRow:1,headers:['ID','消息详情'],messageColumn:1,rows:[{sourceRow:2,recordId:'S',values:['S','合成操作说明']}],productSources:{S:{value:'合成产品',source:'任务默认'}}},before=JSON.stringify(state);
 const snapshot=createConsultationDeliverySnapshot(state,{taskId:'T',original,now});
 assert.equal(JSON.stringify(state),before);assert.deepEqual(snapshot.basis.rules.map(rule=>rule.id),['NP-R20']);
 assert.equal(snapshot.records[0].hasAI,true);assert.equal(snapshot.records[0].finalOverall,'通过');assert.equal(snapshot.metrics.ruleStats.length,1);
 const headers=consultationDeliveryHeaders(snapshot);assert.ok(headers.includes('操作说明'));assert.ok(!headers.some(header=>/报告结构|明细表输出/.test(header)));
});

test('scope round trips through workbook and old template without scope remains accepted',async()=>{
 const catalog=catalogFixture(),rules=catalog.rules.map(rule=>({...rule,ruleKind:'session-check'})),bytes=await buildRuleTemplateXlsx(rules);
 const parse=async bytes=>parseRuleTemplateFile({name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
 const result=await parse(bytes);assert.equal(result.valid,true);assert.ok(result.records.every(rule=>rule.ruleKind==='session-check'));
 const tables=await readXlsx(bytes),rows=tables['规则信息'],legacy=await workbook([{name:'规则信息',headers:rows[0].slice(0,-1),rows:rows.slice(1).map(row=>row.slice(0,-1))}]);
 const older=await parse(legacy);assert.equal(older.valid,true);assert.deepEqual(older.records.map(rule=>rule.ruleKind),['session-check','meta','meta']);
});

test('persistent migration preserves original bytes and never reapplies after restart or seed refresh',async t=>{
 const base=path.resolve('tests/.onboarding-scratch');await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'scope0104-'));
 t.after(async()=>{assert.ok(dataDir.startsWith(base+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 const catalog=catalogFixture(),state=createBusinessState(),original=JSON.stringify({schemaVersion:1,revision:7,state,catalog,mutations:[]},null,2);
 await fs.writeFile(path.join(dataDir,'workspace.json'),original);
 let store=await createWorkspaceStore({dataDir});const migrated=await store.read();await store.close();
 assert.equal(migrated.revision,8);assert.deepEqual(migrated.state,state);assert.deepEqual(migrated.catalog.rules.map(rule=>rule.ruleKind),['session-check','meta','meta']);
 const backups=await fs.readdir(path.join(dataDir,'backups'));assert.equal(backups.length,1);assert.equal(await fs.readFile(path.join(dataDir,'backups',backups[0]),'utf8'),original);
 const bytes=await fs.readFile(path.join(dataDir,'workspace.json'));store=await createWorkspaceStore({dataDir,catalogSeed:catalog});await store.close();assert.deepEqual(await fs.readFile(path.join(dataDir,'workspace.json')),bytes);
});
