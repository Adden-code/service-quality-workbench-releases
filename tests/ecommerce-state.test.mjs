import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {existsSync} from 'node:fs';
test('ecommerce missing timestamps remain unknown and reference labels stay immutable',async()=>{
  assert.ok(existsSync(new URL('../public/ecommerce-input.mjs',import.meta.url)),'缺少电商原表读取');
  const {createEcommerceSample}=await import('../public/ecommerce-sample.mjs'),{parseEcommerceFile}=await import('../public/ecommerce-input.mjs'),{ensureEcommerceCatalog}=await import('../public/ecommerce-catalog.mjs'),{EC_RULE_IDS}=await import('../public/ecommerce-schema.mjs');
  const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'纯虚构.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  assert.equal(parsed.valid,true,parsed.errors.join(';'));
  const catalog=ensureEcommerceCatalog(createCatalog(),{now:'2026-10-30T10:00:00+08:00'});
  const state=createImportedTask(createInitialState(),{name:'纯虚构EC测试',sessions:parsed.sessions,source:{name:'纯虚构.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256},reviewer:'虚构测试员',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS}),now:'2026-10-30T10:00:00+08:00'});
  assert.equal(validateWorkspace(state,catalog),true);
  const missing=state.sessions.find(s=>s.ecommerce&&s.startedAt==='');assert.ok(missing,'虚构样例应覆盖缺失或无效评论时间');
  const modified=structuredClone(state);modified.sessions.find(s=>s.id===missing.id).ecommerce.raw[15]='Fail';
  assert.throws(()=>validateWorkspace(modified,catalog,state),/原文|不可|改写/);
  const forged=structuredClone(state);forged.sessions.find(s=>s.ecommerce).ecommerce.fileSha256='f'.repeat(64);assert.throws(()=>validateWorkspace(forged,catalog),/来源|摘要|原文件/);
});
test('cross-record evidence must include the record being judged, not another administrators valid group',async()=>{
  const {createEcommerceSample}=await import('../public/ecommerce-sample.mjs'),{parseEcommerceFile}=await import('../public/ecommerce-input.mjs'),{ensureEcommerceCatalog}=await import('../public/ecommerce-catalog.mjs'),{EC_RULE_IDS}=await import('../public/ecommerce-schema.mjs');
  const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'组证据虚构.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}),catalog=ensureEcommerceCatalog(createCatalog());
  const state=createImportedTask(createInitialState(),{name:'虚构组归属',sessions:parsed.sessions.filter(s=>[6,7,8,9].includes(s.ecommerce.row)),source:{name:'组证据虚构.xlsx',size:bytes.length,sha256:parsed.sessions[0].ecommerce.fileSha256},reviewer:'虚构人',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS})});
  const rows=state.sessions.filter(s=>s.ecommerce),victim=rows.find(s=>s.ecommerce.row===9),group=rows.filter(s=>s.ecommerce.row!==9).map(s=>s.id);
  victim.review.drafts['EC-TARGET']={ruleId:'EC-TARGET',verdict:'不符合',reason:'伪造：将他人的组挂过来',evidence:[2],referenceIds:[],batchEvidence:[{sessionIds:group,kind:'exact',reason:'他人的三条相同回复'}]};
  assert.throws(()=>validateWorkspace(state,catalog),/本条|当前|归属|证据/);
});
test('new EC source cannot launder human labels into turns and whitespace in administrator is preserved',async()=>{
  const {createEcommerceSample}=await import('../public/ecommerce-sample.mjs'),{parseEcommerceFile}=await import('../public/ecommerce-input.mjs'),{ensureEcommerceCatalog}=await import('../public/ecommerce-catalog.mjs'),{EC_RULE_IDS,ecommerceSourceProjection}=await import('../public/ecommerce-schema.mjs');
  const bytes=await createEcommerceSample(),parsed=await parseEcommerceFile({name:'投影隔离虚构.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}),catalog=ensureEcommerceCatalog(createCatalog());
  const raw=structuredClone(parsed.sessions[0]);raw.ecommerce.raw[11]=' 虚构客服有空格 ';Object.assign(raw,ecommerceSourceProjection(raw.ecommerce));
  const input={name:'来源投影',sessions:[raw],source:{name:'投影隔离虚构.xlsx',size:bytes.length,sha256:raw.ecommerce.fileSha256},reviewer:'虚构人',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-30',ruleIds:EC_RULE_IDS})};
  const state=createImportedTask(createInitialState(),input);assert.equal(validateWorkspace(state,catalog),true);assert.equal(state.sessions.find(s=>s.ecommerce).agent,' 虚构客服有空格 ');
  const forged=structuredClone(input);forged.sessions[0].turns[1].text=forged.sessions[0].ecommerce.raw[21];assert.throws(()=>createImportedTask(createInitialState(),forged),/来源|参考/);
  const forgedState=structuredClone(state);forgedState.sessions.find(s=>s.ecommerce).turns[1].text=raw.ecommerce.raw[21];assert.throws(()=>validateWorkspace(forgedState,catalog),/来源|参考/);
  const clonedInput=structuredClone(input);clonedInput.sessions=[1,2,3].map(n=>({...structuredClone(raw),id:'forged-'+n}));assert.throws(()=>createImportedTask(createInitialState(),clonedInput),/标识|来源/);
  const clonedState=structuredClone(state),original=clonedState.sessions.find(s=>s.ecommerce),task=clonedState.tasks[0];
  for(const n of [2,3]){const duplicate=structuredClone(original);duplicate.id=original.id+'-fake'+n;clonedState.sessions.push(duplicate);task.sessionIds.push(duplicate.id);}
  assert.throws(()=>validateWorkspace(clonedState,catalog),/重复|来源|行/);
});
