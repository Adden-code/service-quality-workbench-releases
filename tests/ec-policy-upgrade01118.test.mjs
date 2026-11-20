import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCatalog} from '../public/catalog.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {defaultScenePackage,latestSceneConfiguration,sceneEntity,sceneBasisForTask,validateSceneRegistry} from '../public/scene-configuration.mjs';
import {createSceneConfigurationManager} from '../public/scene-configuration-ui.mjs';
import {installSceneSeed} from '../server/scene-seed.mjs';
import {installEcommercePolicyUpgrade} from '../server/builtin-scene-upgrade.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {sceneConfigurationMutation} from '../server/scene-configuration-service.mjs';
import {upgradeEcommerceSemanticBasis} from '../public/ecommerce-semantic-policy.mjs';
import {calibrationScope,calibratedReviewPolicy} from '../public/rule-calibration-policy.mjs';
import {EC_HEADERS,EC_RULE_IDS} from '../public/ecommerce-schema.mjs';
import {workbook} from '../public/io.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';

const now='2026-11-20T00:00:00Z',sceneId='电商评论回复',nextTime='2026-11-20T01:00:00Z';
const clone=value=>structuredClone(value);
function fixture(){
 const catalog=createCatalog(),base=catalog.rules[0];
 catalog.rules=Array.from({length:17},(_,i)=>({...clone(base),id:`NP-R${String(i+1).padStart(2,'0')}`,title:`SYNTHETIC NP ${i+1}`,category:i===0?'整体判定':i<12?'服务礼仪':i<14?'探需':'导购'}));
 const np=defaultScenePackage({id:'新品产品咨询',name:'Synthetic NP',engine:'conversation'},createBasisSnapshot(catalog,{ruleIds:catalog.rules.map(r=>r.id),effectiveDate:now.slice(0,10),now}));
 const basis={executionProfile:'ec-business-v1',capturedAt:now,effectiveDate:now.slice(0,10),rules:EC_RULE_IDS.map(id=>({id,title:`Synthetic ${id}`,name:`Synthetic ${id}`,version:'V3.1',category:'合成',scope:'Synthetic scope retained',policyIds:['EC-BUSINESS-POLICY'],passCriteria:'Synthetic old pass',failCriteria:'Synthetic old fail',exceptionCriteria:'Synthetic old unknown'})),policies:[{id:'EC-BUSINESS-POLICY',title:'Synthetic EC policy',name:'Synthetic EC policy',version:'V3.1',sections:EC_RULE_IDS.map(id=>({id:`${id}-BUSINESS-1`,title:id,text:`Synthetic original ${id}`}))}],businessProfile:{schemaVersion:1,similarity:{method:'normalized-bigram-dice-v1',threshold:.85,minimumRecords:2,scope:'batch'},structure:{minimumSteps:3,counting:'grapheme-with-spaces-v1',closingWaiver:{zh:240,en:280}},privacy:{maskedAllowed:false},timing:{mode:'elapsed',status:'ready',siteField:'国家',defaultHours:36,defaultSource:'Synthetic approved default',sites:[{id:'synthetic',label:'合成站点',aliases:['SYNTH']}],standards:[{siteId:'synthetic',evaluationType:'差评',hours:48,source:'Synthetic manual standard retained',authoring:'manual'}]}}};
 const ec=defaultScenePackage({id:sceneId,name:'Synthetic EC',engine:'ecommerce'},basis);
 ec.configuration.capabilities=[{key:'ecommerceClassification',phase:'pre',dependsOn:[],executorVersion:'scene-capability.v1'},{key:'demandSummary',phase:'post',dependsOn:[],executorVersion:'scene-capability.v1'}];
 ec.configuration.timingPolicy.allowBatchOverride=true;
 ec.configuration.runtimeFields.find(f=>f.key==='regionConfidenceThreshold').default=.95;
 ec.configuration.referenceMaterials=[{id:'SYNTHETIC-REFERENCE',title:'Synthetic original reference',version:1,purpose:'case-commentary',sourceSha256:'a'.repeat(64),sections:[{id:'original',title:'Original',text:'Synthetic old reference remains archived.'}]}];
 ec.template.groupBy='site';ec.template.title='Synthetic locally maintained report';ec.template.columns[0].visible=false;
 ec.taxonomy={schemaVersion:1,id:'SYNTHETIC-TAXONOMY',sceneId,version:1,labels:[{id:'parent',label:'Synthetic parent',parentId:'',definition:'Synthetic'},{id:'child',label:'Synthetic child',parentId:'parent',definition:'Synthetic'}],principles:['Synthetic local principle'],examples:[{labelId:'child',original:'Synthetic original',translated:'Synthetic translation',source:'Synthetic source'}]};
 ec.configuration.taxonomyRef={id:ec.taxonomy.id,version:1};
 ec.exceptions=[{id:'SYNTHETIC-EXCEPTION',version:1,sceneId,ruleId:'EC-TEXT',ruleVersion:'V3.1',entries:[{id:'local',condition:'Synthetic explicitly maintained exception',requires:[],result:'继续检核',priority:1,source:'Synthetic manual exception source'}]}];
 ec.configuration.exceptionRefs=[{id:ec.exceptions[0].id,version:1}];
 for(const pkg of [np,ec]){pkg.configuration.status='published';pkg.configuration.executionMode='configured';pkg.template.renderMode='configured';}
 const oldSeed={schemaVersion:1,id:'synthetic-old-01117',packages:[np,ec]},newSeed=clone(oldSeed);
 newSeed.id='synthetic-new-01118';const bundled=newSeed.packages[1];bundled.configuration.basis=upgradeEcommerceSemanticBasis(bundled.configuration.basis);bundled.configuration.ruleBindings=bundled.configuration.basis.rules.map(r=>({ruleId:r.id,ruleVersion:r.version}));for(const col of bundled.template.columns)if(col.ruleId)col.ruleVersion=bundled.configuration.ruleBindings.find(r=>r.ruleId===col.ruleId).ruleVersion;for(const ex of bundled.exceptions)ex.ruleVersion=bundled.configuration.ruleBindings.find(r=>r.ruleId===ex.ruleId).ruleVersion;
 // Bundled defaults intentionally differ: the narrow upgrade must keep local settings.
 bundled.configuration.basis.businessProfile.timing={mode:'elapsed',status:'pending',siteField:'国家',defaultHours:24,defaultSource:'Synthetic bundled default',sites:[],standards:[]};bundled.template.groupBy='agent';bundled.configuration.referenceMaterials=[];
 const state=installSceneSeed(createBusinessState(),catalog,oldSeed,{now});
 return{catalog,oldSeed,newSeed,document:{state,catalog},input:{catalogSeed:catalog,sceneSeed:newSeed,actor:'Synthetic maintainer',reason:'Synthetic Req21 policy update',operationId:'synthetic-ec-upgrade',expectedVersion:1,now:nextTime}};
}
async function sourceFixture(){
 const raw=Array(22).fill('');raw[3]='合成站点';raw[8]='Synthetic review';raw[9]='Synthetic reply';raw[10]='5';raw[12]='2026-11-20 09:00:00';raw[13]='2026-11-20 10:00:00';
 const bytes=Buffer.from(await workbook([{name:'Sheet4',headers:[...EC_HEADERS],rows:[Array(22).fill(''),raw]}]));
 const parsed=await parseEcommerceFile({name:'synthetic-req21.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 return{bytes,sessions:parsed.sessions,source:{name:'synthetic-req21.xlsx',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
function task(state,catalog,source,{name='Synthetic task',at=now}={}){return createImportedTask(state,{name,fileName:source.source.name,sessions:source.sessions,source:source.source,basisSnapshot:sceneBasisForTask(state,catalog,sceneId,at),reviewer:'Synthetic reviewer',now:at});}
async function folder(t){const root=path.resolve('tests/.ec-policy-upgrade-scratch');await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'synthetic-'));t.after(async()=>{assert.ok(directory.startsWith(root+path.sep));await fs.rm(directory,{recursive:true,force:true});});return directory;}

test('EC policy upgrade appends scoped versions, preserves local settings and every old task/entity',async()=>{
 const f=fixture(),source=await sourceFixture();f.document.state=task(f.document.state,f.catalog,source);const before=clone(f.document),old=latestSceneConfiguration(before.state,sceneId),upgraded=installEcommercePolicyUpgrade(f.document,f.input),current=latestSceneConfiguration(upgraded.state,sceneId);
 assert.deepEqual(f.document,before);assert.deepEqual(upgraded.catalog,before.catalog);assert.deepEqual(upgraded.state.tasks,before.state.tasks);assert.deepEqual(upgraded.state.sessions,before.state.sessions);
 for(const collection of ['sceneConfigurations','deliveryTemplates','classificationTaxonomies','ruleExceptionTables','sceneConfigurationEvents'])assert.deepEqual(upgraded.state[collection].slice(0,before.state[collection].length),before.state[collection]);
 assert.equal(upgraded.state.sceneConfigurations.length,before.state.sceneConfigurations.length+1);assert.equal(upgraded.state.deliveryTemplates.length,before.state.deliveryTemplates.length+1);assert.equal(current.version,2);
 assert.deepEqual(upgraded.state.sceneConfigurations.filter(c=>c.engine==='conversation'),before.state.sceneConfigurations.filter(c=>c.engine==='conversation'));
 for(const key of ['timingPolicy','runtimeFields','capabilities','taxonomyRef','referenceMaterials','sourceRefs','ruleDependencies','failurePolicy'])assert.deepEqual(current[key],old[key],key);
 for(const key of ['timing','privacy','similarity','structure'])assert.deepEqual(current.basis.businessProfile[key],old.basis.businessProfile[key],key);
 assert.deepEqual(current.basis.rules.find(r=>r.id==='EC-TIME'),old.basis.rules.find(r=>r.id==='EC-TIME'));
 assert.deepEqual(current.basis.businessProfile.semanticPolicy,{version:'ec-human-aligned-v1',text:{minimumSignificantErrors:1}});
 for(const rule of current.basis.rules.filter(r=>r.id!=='EC-TIME')){assert.equal(rule.version,'V3.2');assert.equal(rule.publishedAt,nextTime);assert.equal(rule.createdAt,nextTime);assert.equal(rule.owner,f.input.actor);assert.ok(rule.changeNote.includes(f.input.reason));}assert.equal(current.basis.capturedAt,nextTime);assert.equal(current.basis.effectiveDate,nextTime.slice(0,10));assert.equal(current.basis.policies[0].publishedAt,nextTime);
 const oldTemplate=sceneEntity(before.state,'deliveryTemplates',old.templateRef),template=sceneEntity(upgraded.state,'deliveryTemplates',current.templateRef);assert.equal(template.version,2);assert.equal(template.groupBy,'site');assert.equal(template.title,oldTemplate.title);assert.equal(template.columns[0].visible,false);for(const col of template.columns.filter(c=>c.ruleId))assert.equal(col.ruleVersion,current.ruleBindings.find(r=>r.ruleId===col.ruleId).ruleVersion);
 const originalException=before.state.ruleExceptionTables[0],exception=sceneEntity(upgraded.state,'ruleExceptionTables',current.exceptionRefs[0]);assert.equal(exception.version,2);assert.equal(exception.ruleVersion,'V3.2');assert.deepEqual(exception.entries,originalException.entries);
 const event=upgraded.state.sceneConfigurationEvents.at(-1);assert.equal(event.action,'ec-policy-upgrade');assert.equal(event.actor,'Synthetic maintainer');assert.equal(event.reason,f.input.reason);assert.deepEqual(event.before.configuration,old);assert.deepEqual(event.after.configuration,current);assert.ok(event.diff.some(d=>d.path.endsWith('semanticPolicy')));assert.ok(event.diff.some(d=>d.path.endsWith('EC-TEXT')));validateSceneRegistry(upgraded.state,before.state,{trustedScene:true});
 const newState=task(upgraded.state,upgraded.catalog,source,{name:'Synthetic new policy task',at:nextTime}),newTask=newState.tasks[0],oldTask=newState.tasks.at(-1);assert.equal(newTask.basisSnapshot.businessProfile.semanticPolicy.version,'ec-human-aligned-v1');assert.equal(newTask.executionSnapshot.configuration.version,2);assert.equal(oldTask.basisSnapshot.businessProfile.semanticPolicy,undefined);assert.deepEqual(oldTask,before.state.tasks[0]);
 const scope=calibrationScope(oldTask),calibration={id:'synthetic-old-b6',enabled:true,pairCount:180,correctCount:170,ruleId:'EC-TEXT',ruleVersion:'V3.1',modelFingerprint:'synthetic-model',promptVersion:'synthetic-prompt',scope};
 newState.ruleCalibrations={records:[calibration]};assert.equal(calibratedReviewPolicy(newState,oldTask).rules.length,1);assert.equal(calibratedReviewPolicy(newState,newTask).rules.length,0);assert.notDeepEqual(calibrationScope(newTask),scope);
});

test('EC policy upgrade rejects absent bundled policy, invalid actors and stale confirmations without mutation',()=>{
 const f=fixture(),before=clone(f.document);
 assert.throws(()=>installEcommercePolicyUpgrade(f.document,{...f.input,sceneSeed:f.oldSeed}),e=>e.status===409&&/未包含/.test(e.message));
 const falseMarker=clone(f.oldSeed);falseMarker.packages[1].configuration.basis.businessProfile.semanticPolicy={version:'ec-human-aligned-v1',text:{minimumSignificantErrors:1}};assert.throws(()=>installEcommercePolicyUpgrade(f.document,{...f.input,sceneSeed:falseMarker}),e=>e.status===409&&/正文不一致/.test(e.message));
 for(const input of [{actor:''},{reason:' '},{operationId:''}])assert.throws(()=>installEcommercePolicyUpgrade(f.document,{...f.input,...input}),e=>e.status===400&&/维护人/.test(e.message));
 assert.throws(()=>installEcommercePolicyUpgrade(f.document,{...f.input,expectedVersion:999}),e=>e.status===409&&/确认期间/.test(e.message));assert.deepEqual(f.document,before);
 const missing=clone(f.document);delete missing.state.sceneConfigurationMigration;assert.throws(()=>installEcommercePolicyUpgrade(missing,f.input),e=>e.status===409&&/迁移/.test(e.message));
});

test('a repeated EC upgrade returns 409 and keeps a later administrator two-error policy unchanged',()=>{
 const f=fixture(),upgraded=installEcommercePolicyUpgrade(f.document,f.input);let edited=sceneConfigurationMutation(upgraded,{action:'create',sceneId,actor:'Synthetic administrator',reason:'Synthetic threshold choice',operationId:'draft-threshold'},{now:nextTime});let draft=edited.state.scenePackageDrafts.at(-1),pkg=clone(draft.package);pkg.configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors=2;
 const mutation=(action,extra={})=>{draft=edited.state.scenePackageDrafts.at(-1);edited=sceneConfigurationMutation(edited,{action,draftId:draft.id,expectedRevision:draft.revision,actor:'Synthetic administrator',reason:'Synthetic threshold choice',operationId:`threshold-${action}-${draft.revision}`,...extra},{now:nextTime});};
 mutation('save',{package:pkg});for(const tab of ['rules','auxiliary','delivery'])mutation('confirm',{tab});mutation('publish');
 const before=clone(edited);assert.throws(()=>installEcommercePolicyUpgrade(edited,{...f.input,operationId:'repeated-upgrade',expectedVersion:3}),e=>e.status===409&&/已装载/.test(e.message));assert.deepEqual(edited,before);assert.equal(latestSceneConfiguration(edited.state,sceneId).basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
});

test('HTTP EC update archives the complete old workspace before publication and never overwrites historical tasks',async t=>{
 const {createWorkbenchServer}=await import('../server.mjs'),{decodeWorkspaceArchive}=await import('../server/workspace-archive.mjs'),f=fixture(),dataDir=await folder(t),source=await sourceFixture();
 const store=await createWorkspaceStore({dataDir,catalogSeed:f.catalog,sceneSeed:f.oldSeed});await store.putSource(source.bytes,source.source.name);const first=await store.read();await store.save({state:task(first.state,first.catalog,source),catalog:first.catalog,baseRevision:first.revision,mutationId:'synthetic-old-task'});await store.close();
 const app=await createWorkbenchServer({dataDir,catalogSeed:f.catalog,sceneSeed:f.newSeed});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const backups=[];t.after(async()=>{await new Promise(resolve=>app.close(resolve));for(const backup of backups){assert.ok(backup.startsWith(dataDir+'.before-ec-policy-'));await fs.unlink(backup);}});
 const origin=`http://127.0.0.1:${app.address().port}`,before=await(await fetch(origin+'/api/workspace')).json();const send=body=>fetch(origin+'/api/scene-config',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Workspace-Token':before.token},body:JSON.stringify(body)});
 const response=await send({action:'install-ec-policy',confirmed:true,actor:'Synthetic maintainer',reason:'Synthetic API update',operationId:'synthetic-http-ec',expectedVersion:1}),after=await response.json();assert.equal(response.status,200,JSON.stringify(after));backups.push(after.backupPath);
 const backup=decodeWorkspaceArchive(await fs.readFile(after.backupPath));assert.deepEqual(backup.document.state,before.state);assert.deepEqual(backup.document.catalog,before.catalog);assert.deepEqual(after.state.tasks,before.state.tasks);assert.deepEqual(after.state.sessions,before.state.sessions);assert.deepEqual(after.catalog,before.catalog);assert.equal(after.state.sceneConfigurations.length,3);
 const repeat=await send({action:'install-ec-policy',confirmed:true,actor:'Synthetic maintainer',reason:'Synthetic repeat',operationId:'synthetic-http-repeat',expectedVersion:2});assert.equal(repeat.status,409);assert.match((await repeat.json()).error,/已装载/);const final=await(await fetch(origin+'/api/workspace')).json();assert.equal(final.revision,after.revision);assert.deepEqual(final.state,after.state);
 const files=await fs.readdir(path.dirname(dataDir));assert.equal(files.filter(name=>name.startsWith(path.basename(dataDir)+'.before-ec-policy-')).length,1);
});

test('EC UI names the narrow update, requires actor/reason and sends the reviewed version; numeric selection stays numeric',async()=>{
 const f=fixture();let state=f.document.state,dialog={type:'scfg-list',sceneId},request;const manager=createSceneConfigurationManager({getState:()=>state,getDialog:()=>dialog,openDialog:value=>dialog=value,renderDialog:()=>{},toast:()=>{},mutate:async value=>{request=value;const updated=installEcommercePolicyUpgrade({state,catalog:f.catalog},{...f.input,...value});state=updated.state;return{...updated,backupPath:'synthetic-backup.sqwb'};}});
 assert.match(manager.dialog(dialog),/scfg-ec-policy-open/);await manager.action('scfg-ec-policy-open');assert.equal(dialog.type,'scfg-ec-policy');assert.match(manager.dialog(dialog),/保留现有计时方式/);await manager.action('scfg-ec-policy-install');assert.equal(request,undefined);assert.match(dialog.error,/更新原因/);manager.input({target:{id:'scfg-reason',dataset:{},value:'Synthetic explicit reason'}});await manager.action('scfg-ec-policy-install');assert.equal(request.action,'install-ec-policy');assert.equal(request.expectedVersion,1);assert.equal(dialog.type,'scfg-list');
 assert.doesNotMatch(manager.dialog({type:'scfg-list',sceneId:'新品产品咨询'}),/scfg-ec-policy-open/);
 const configuration=clone(latestSceneConfiguration(state,sceneId)),template=clone(sceneEntity(state,'deliveryTemplates',configuration.templateRef));dialog={type:'scfg-edit',draft:{status:'draft'},package:{configuration,template,exceptions:[],taxonomy:null,ruleCandidates:[]},dirty:false};manager.input({target:{dataset:{scfgPath:'configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors',scfgNumber:'true'},type:'select-one',value:'2'}});assert.equal(dialog.package.configuration.basis.businessProfile.semanticPolicy.text.minimumSignificantErrors,2);
});
