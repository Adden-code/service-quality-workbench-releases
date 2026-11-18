import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkbenchServer} from '../server.mjs';
import {createCatalog,createDraft,validateCatalog,retireVersion} from '../public/catalog.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {deleteRetiredRule,ruleVersionReferences} from '../public/rule-deletion.mjs';
import {nextRuleIds} from '../public/rule-entry.mjs';
import {catalogDialog} from '../public/catalog-dialogs.mjs';
import {taskRuleList} from '../public/task-rule-selection-ui.mjs';
import {setLocale} from '../public/i18n.mjs';
const now='2026-11-16T08:00:00+08:00',input={id:'R007',version:'V1.0',actor:'synthetic operator',reason:'synthetic erroneous import',operationId:'synthetic-delete-1'};
const retired=()=>retireVersion(createCatalog(),'rules',input.id,input.version,now);

test('deletion preserves complete audit snapshot and reserves prior ID/version',()=>{
 const original=retired(),before=JSON.stringify(original),next=deleteRetiredRule(original,{tasks:[]},input,now);
 assert.equal(JSON.stringify(original),before);assert.equal(next.rules.length,original.rules.length-1);assert.equal(validateCatalog(next),true);
 assert.deepEqual(next.deletedRules[0].snapshot,original.rules.find(r=>r.id===input.id));
 assert.deepEqual(next.deletedRules[0],{...input,at:now,snapshot:original.rules.find(r=>r.id===input.id)});
 assert.deepEqual(deleteRetiredRule(next,{tasks:[]},input,now),next);
 assert.throws(()=>deleteRetiredRule(next,{tasks:[]},{...input,reason:'changed'},now),/另一请求/);
 assert.equal(nextRuleIds(next,'',1)[0],'R008');
 const newVersion=createDraft(next,'rules','R007',{...original.rules.find(r=>r.id==='R007'),version:undefined},now);
 assert.equal(newVersion.rules.at(-1).version,'V1.1');
 assert.throws(()=>validateCatalog({...next,deletedRules:[{...next.deletedRules[0],snapshot:{...next.deletedRules[0].snapshot,status:'已发布'}}]}),/不一致/);
});

test('all task references protect exact retired version including archived and void tasks',()=>{
 const rule=retired().rules.find(r=>r.id==='R007');
 for(const lifecycle of [undefined,{archived:true},{voided:true}]){
  const state={tasks:[{id:'SYN-T',name:'synthetic',lifecycle,basisSnapshot:{rules:[rule]}}]};
  assert.equal(ruleVersionReferences(state,rule).length,1);assert.throws(()=>deleteRetiredRule(retired(),state,input,now),/不能删除/);
 }
 assert.doesNotThrow(()=>deleteRetiredRule(retired(),{tasks:[{basisSnapshot:{rules:[{...rule,version:'V1.1'}]}}]},input,now));
 for(const change of [{reason:''},{actor:''},{operationId:''}])assert.throws(()=>deleteRetiredRule(retired(),{}, {...input,...change}));
 assert.throws(()=>deleteRetiredRule(createCatalog(),{},input),/已停用/);
 assert.throws(()=>deleteRetiredRule(retired(),{}, {...input,expectedRecord:{...rule,title:'stale'}}),/已变化/);
});

test('picker defends mixed legacy availability and exposes meta only as unchecked disabled rows',()=>{
 const valid={id:'CHECK',version:'V1.0',title:'会话规则',ruleKind:'session-check'},meta={id:'META',version:'V1.0',title:'Html报告结构要求',ruleKind:'meta'},availability={rules:[valid,meta],metaRules:[meta]};
 const draft={ruleIds:['CHECK','META']},before=JSON.stringify(draft);
 const hidden=taskRuleList(draft,availability);assert.doesNotMatch(hidden,/value="META"/);assert.match(hidden,/value="CHECK" checked/);
 const visible=taskRuleList({...draft,showAllTaskRules:true},availability);assert.equal((visible.match(/value="META"/g)||[]).length,1);assert.match(visible,/value="META" disabled/);assert.doesNotMatch(visible,/value="META"[^>]*checked/);assert.equal(JSON.stringify(draft),before);
});

test('deletion dialogs disclose reference blockers and display audit in both languages without missing translations',()=>{
 const catalog=retired(),dialog={type:'catalog-delete',kind:'rules',...input,references:[{id:'SYN-T',name:'synthetic'}]};
 assert.match(catalogDialog(dialog,catalog),/不能删除/);assert.doesNotMatch(catalogDialog(dialog,catalog),/data-act="catalog-do-delete"/);
 assert.match(catalogDialog({...dialog,references:[]},catalog),/cat-delete-reason/);
 const audit=deleteRetiredRule(catalog,{},input,now);
 try{setLocale('en');const html=catalogDialog({type:'catalog-deletions',kind:'rules'},audit);assert.match(html,/Rule deletion audit/);assert.match(html,/synthetic erroneous import/);assert.doesNotMatch(html,/Translation missing|暂无|规则删除审计/);}finally{setLocale('zh');}
});

test('HTTP deletion rechecks live references, rejects forged audit, is idempotent and survives restart',async t=>{
 const scratch=path.resolve('../outputs/service0107-20261116/test-api');await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'case-'));
 let server;const start=async()=>{server=await createWorkbenchServer({dataDir,catalogSeed:null});server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;};
 const close=async()=>{if(server?.listening)await new Promise(resolve=>server.close(resolve));};
 t.after(async()=>{await close();assert.ok(path.resolve(dataDir).startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 let origin=await start();const read=()=>fetch(origin+'/api/workspace').then(r=>r.json());let doc=await read();
 const request=async(url,body,method='POST',token=doc.token)=>{const r=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':token},body:JSON.stringify(body)});return{status:r.status,value:await r.json()};};
 const sourceResponse=await fetch(origin+'/api/sources',{method:'POST',headers:{Origin:origin,'X-Workspace-Token':doc.token,'Content-Type':'application/octet-stream','X-File-Name':'synthetic.txt'},body:'synthetic original'}),source=await sourceResponse.json();
 const catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-16',ruleIds:['R001'],now});
 const state=createImportedTask(createBusinessState(),{name:'synthetic reference',reviewer:'synthetic',now,source,basisSnapshot,sessions:[{id:'SYN',scene:'新品产品咨询',startedAt:now,topic:'合成',product:'合成产品',agent:'合成客服',customer:'合成客户',channel:'合成',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',text:'合成问题'}]}]});
 doc=(await request('/api/workspace',{baseRevision:0,mutationId:'init',state,catalog},'PUT')).value;assert.equal(doc.revision,1);
 const marked=retireVersion(retireVersion(catalog,'rules','R001','V1.0',now),'rules','R007','V1.0',now);
 doc=(await request('/api/workspace',{baseRevision:doc.revision,mutationId:'retire',state,catalog:marked},'PUT')).value;assert.equal(doc.revision,2);
 assert.equal((await request('/api/rules/delete',input,'POST','bad-token')).status,403);
 const denied=await request('/api/rules/delete',{...input,id:'R001'});assert.equal(denied.status,409);assert.match(denied.value.error,/任务引用/);
 const deleted=await request('/api/rules/delete',input);assert.equal(deleted.status,200,JSON.stringify(deleted));doc=deleted.value;
 assert.deepEqual(doc.state,state);assert.equal(doc.catalog.deletedRules.length,1);assert.equal((await request('/api/rules/delete',input)).value.revision,doc.revision);
 const forged=structuredClone(doc.catalog);forged.deletedRules[0].reason='tampered';assert.equal((await request('/api/workspace',{baseRevision:doc.revision,mutationId:'forge',state,catalog:forged},'PUT')).status,400);
 const removed=structuredClone(doc.catalog);removed.rules.pop();assert.equal((await request('/api/workspace',{baseRevision:doc.revision,mutationId:'remove',state,catalog:removed},'PUT')).status,400);
 const editedHistory=structuredClone(doc.catalog);editedHistory.events=editedHistory.events.filter(e=>e.id!=='R007');assert.equal((await request('/api/workspace',{baseRevision:doc.revision,mutationId:'history',state,catalog:editedHistory},'PUT')).status,400);
 await close();origin=await start();assert.deepEqual((await read()).catalog,doc.catalog);
});
