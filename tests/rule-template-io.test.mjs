import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../public/catalog.mjs';
const api=await import('../public/rule-template-io.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const file=bytes=>({name:'rules.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
test('manual template roundtrips rule criteria, dates, references and scene ownership without a model',async()=>{
 assert.equal(typeof api.buildRuleTemplateXlsx,'function');
 const rules=createCatalog().rules.slice(0,1);rules[0].sceneIds=['新品产品咨询','SCENE-AFTER'];rules[0].version='V2.1';
 const bytes=await api.buildRuleTemplateXlsx(rules),parsed=await api.parseRuleTemplateFile(file(bytes));
 assert.equal(parsed.valid,true,parsed.errors?.join('\n'));assert.equal(parsed.records[0].passCriteria,rules[0].passCriteria);assert.equal(parsed.records[0].version,'V2.1');
 assert.equal(parsed.records[0].status,'草稿');assert.deepEqual(parsed.records[0].sceneIds,rules[0].sceneIds);assert.deepEqual(parsed.records[0].policyIds,rules[0].policyIds);
});
test('empty and malformed rule templates return actionable validation errors',async()=>{
 assert.equal(typeof api.parseRuleTemplateFile,'function');
 const parsed=await api.parseRuleTemplateFile(file(await api.buildRuleTemplateXlsx()));assert.equal(parsed.valid,false);assert.match(parsed.errors.join(' '),/规则|填写/);
 const rule=createCatalog().rules[0];rule.sceneIds=['bad'];const malformed=await api.parseRuleTemplateFile(file(await api.buildRuleTemplateXlsx([rule])));assert.equal(malformed.valid,false);assert.match(malformed.errors.join(' '),/场景/);
});
test('manual batch import is atomic and preserves requested rule versions as drafts',async()=>{
 const {importRules}=await import('../public/catalog.mjs');assert.equal(typeof importRules,'function');
 const catalog=createCatalog(),rule=catalog.rules[0],records=[{...rule,id:'NP-A',version:'V1.1',effectiveAt:'2026-11-12'},{...rule,id:'NP-A',version:'V1.0'}];
 const next=importRules(catalog,records);assert.equal(next.rules.filter(record=>record.id==='NP-A').length,2);assert.equal(catalog.rules.length,7);
 assert.ok(next.rules.filter(record=>record.id==='NP-A').every(record=>record.status==='草稿'&&record.publishedAt===''));
 assert.throws(()=>importRules(catalog,[records[0],{...records[1],policyIds:['MISSING']}]),/资料|不存在/);assert.equal(catalog.rules.length,7);
});
test('knowledge templates preserve scene ownership and accept old templates without this optional column',async()=>{
 const {buildKnowledgeXlsx,parseKnowledgeFile}=await import('../public/catalog-io.mjs'),policy=createCatalog().policies[0];policy.sceneIds=['SCENE-AFTER'];
 const result=await parseKnowledgeFile(file(await buildKnowledgeXlsx([policy])));assert.equal(result.valid,true,result.errors.join('\n'));assert.deepEqual(result.records[0].sceneIds,['SCENE-AFTER']);
});
