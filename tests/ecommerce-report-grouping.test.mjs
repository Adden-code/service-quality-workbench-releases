import test from 'node:test';
import assert from 'node:assert/strict';
import {ecommerceOverviewGroups,ecommerceOverviewValue} from '../public/ecommerce-report-grouping.mjs';
import {defaultScenePackage,freezeSceneExecution,latestSceneConfiguration} from '../public/scene-configuration.mjs';
import {buildSceneReportHtml} from '../public/scene-delivery.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {migrateSceneConfigurations,sceneConfigurationMutation} from '../server/scene-configuration-service.mjs';
import {sceneReportFixture} from './scene-report-fixtures.mjs';
import {systemDeliveryView} from '../public/ecommerce-system-delivery.mjs';
import {assertTaskCatalogScene} from '../public/catalog-scenes.mjs';
const rows=s=>s.records.map((record,i)=>({record,audit:s.sceneAudit[i]}));
const overview=html=>html.split('id="overview"')[1]?.split('</section>')[0];
test('template-only releases can share authenticated EC rules; missing or altered bases are rejected',()=>{
 const basis={executionProfile:'ec-business-v1',rules:['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'].map(id=>({id,title:'Synthetic '+id})),policies:[],businessProfile:{schemaVersion:1,similarity:{method:'normalized-bigram-dice-v1',threshold:.85,minimumRecords:2,scope:'batch'},structure:{minimumSteps:3,counting:'grapheme-with-spaces-v1',closingWaiver:{zh:200,en:200}},privacy:{maskedAllowed:false},timing:{status:'pending',siteField:'Synthetic site',sites:[],standards:[]}}};
 const scene='电商评论回复',state={sceneConfigurations:[1,2].map(version=>({sceneId:scene,status:'published',version,basis:structuredClone(basis)}))};
 assert.equal(assertTaskCatalogScene({scene,state,basisSnapshot:basis}),true);
 assert.throws(()=>assertTaskCatalogScene({scene,state:{sceneConfigurations:[]},basisSnapshot:basis}),/已发布场景/);
 const changed=structuredClone(basis);changed.rules[0].title='Altered';assert.throws(()=>assertTaskCatalogScene({scene,state,basisSnapshot:changed}),/已发布场景/);
});
test('only new EC defaults to agent; NP and legacy no-template deliveries remain product',()=>{
 const basis={rules:[],policies:[]};assert.equal(defaultScenePackage({id:'ec',name:'ec',engine:'ecommerce'},basis).template.groupBy,'agent');assert.equal(defaultScenePackage({id:'np',name:'np',engine:'conversation'},basis).template.groupBy,'product');
 const legacy={sourceFormat:'business-export-23.v1',basis:{ruleVersions:[]},records:[]};assert.equal(systemDeliveryView(legacy).executionSnapshot.template.groupBy,'product');
});
test('top 30 groups sorted by size; tail combines records; missing is never swallowed',()=>{
 const {snapshot}=sceneReportFixture('ecommerce',180);snapshot.sceneAudit.forEach((r,i)=>r.agent=i<5?'   ':i<25?'Largest':`Agent-${i}`);
 const result=ecommerceOverviewGroups(rows(snapshot),'agent',snapshot);
 assert.equal(result.groups[0].key,'Largest');assert.equal(result.groups[0].items.length,20);assert.equal(result.mergedGroups,126);assert.equal(result.groups.filter(g=>g.kind==='value').length,30);
 assert.equal(result.groups.find(g=>g.kind==='other').items.length,126);assert.equal(result.groups.find(g=>g.kind==='missing').items.length,5);
 assert.equal(result.groups.reduce((n,g)=>n+g.items.length,0),180);assert.equal(new Set(result.groups.flatMap(g=>g.items.map(r=>r.record.id))).size,180);
});
for(const n of [0,1,29,30,31])test(`boundary ${n} known groups plus missing`,()=>{
 const {snapshot}=sceneReportFixture('ecommerce',n+1);snapshot.sceneAudit.forEach((r,i)=>r.agent=i===n?'':`Agent-${i}`);
 const result=ecommerceOverviewGroups(rows(snapshot),'agent',snapshot);assert.equal(result.mergedGroups,Math.max(0,n-30));assert.equal(result.groups.at(-1).kind,'missing');assert.equal(result.groups.at(-1).items.length,1);
});
test('site uses recorded input then resolved frozen site; intent uses frozen taxonomy and never review type',()=>{
 const {snapshot}=sceneReportFixture('ecommerce',3),r=rows(snapshot);snapshot.executionSnapshot.configuration.timingPolicy.sites=[{id:'site-a',label:'Site A'}];snapshot.executionSnapshot.taxonomy={labels:[{id:'warranty',label:'Warranty'}]};
 r[0].record.raw22[3]='Mexico';r[0].audit.capabilities.outputs.site={status:'completed',value:{siteId:'site-a'}};r[1].audit.capabilities.outputs.site={status:'completed',value:{siteId:'site-a'}};
 assert.equal(ecommerceOverviewValue(r[0],'site',snapshot),'Mexico');assert.equal(ecommerceOverviewValue(r[1],'site',snapshot),'Site A');assert.equal(ecommerceOverviewValue(r[2],'site',snapshot),'');assert.equal(ecommerceOverviewValue(r[0],'intent',snapshot),'Warranty');
 r[0].audit.capabilities.outputs.intent.status='failed';r[0].record.evaluationType='好评正向';assert.equal(ecommerceOverviewValue(r[0],'intent',snapshot),'');
 snapshot.executionSnapshot.taxonomy.labels=[];assert.equal(ecommerceOverviewValue(r[1],'intent',snapshot),'');
});
for(const [dim,label,value]of [['agent','客服(管理员)','Agent Example'],['site','站点','Site Example'],['intent','用户意图','Intent Example'],['product','产品','Product Example']])test(`HTML ${dim} follows frozen dimension and uses meaningful heading`,()=>{
 const {snapshot,enrichment}=sceneReportFixture('ecommerce',180,{largeFrozen:true});snapshot.executionSnapshot.template.groupBy=dim;snapshot.executionSnapshot.taxonomy={labels:[{id:'warranty',label:'Intent Example'}]};snapshot.sceneAudit.forEach(r=>r.agent='Agent Example');snapshot.records.forEach(r=>{r.raw22[3]='Site Example';r.product='Product Example';});
 const before=structuredClone(snapshot),html=buildSceneReportHtml(snapshot,enrichment),section=overview(html);assert.match(section,new RegExp(label.replace(/[()]/g,'\\$&')));assert.ok(section.includes(value));assert.ok(Buffer.byteLength(html)<2*1024*1024);assert.deepEqual(snapshot,before);assert.match(html,/产品：Product Example/);
});
test('EC empty values display missing; NP does not adopt cap, default or labels',()=>{
 const ec=sceneReportFixture('ecommerce',2);ec.snapshot.sceneAudit.forEach(r=>r.agent=' \t');const html=buildSceneReportHtml(ec.snapshot,ec.enrichment);assert.match(overview(html),/未提供/);assert.doesNotMatch(overview(html),/未执行<\/td><td>2/);
 const np=sceneReportFixture('conversation',35);np.snapshot.records.forEach((r,i)=>r.product=`Distinct-${i}`);const section=overview(buildSceneReportHtml(np.snapshot,np.enrichment));assert.ok(section.includes('Distinct-34'));assert.doesNotMatch(section,/overview-grouping-note|其他\(/);assert.equal(np.snapshot.executionSnapshot.template.groupBy,'product');
});
test('publishing grouping retains old frozen task and NP; diff and new snapshot contain selection',()=>{
 const now='2026-11-19T08:00:00Z',sceneId='电商评论回复';let doc=migrateSceneConfigurations({state:createBusinessState(),catalog:ensureEcommerceCatalog(createCatalog(),now)},{now}),seq=0;
 const mutate=input=>{doc=sceneConfigurationMutation(doc,{actor:'Synthetic admin',reason:'Synthetic report grouping',operationId:`grouping-${++seq}`,...input},{now});};
 const config=latestSceneConfiguration(doc.state,sceneId),template=doc.state.deliveryTemplates.find(t=>t.id===config.templateRef.id);template.groupBy='product';
 const old=freezeSceneExecution(doc.state,sceneId,{basis:config.basis}),np=structuredClone(doc.state.sceneConfigurations.filter(c=>c.engine==='conversation'));
 for(const dimension of ['agent','site','intent']){
  mutate({action:'create',sceneId});let draft=doc.state.scenePackageDrafts.at(-1);const pkg=structuredClone(draft.package);pkg.template.groupBy=dimension;
  mutate({action:'save',draftId:draft.id,expectedRevision:draft.revision,package:pkg});
  for(const tab of ['rules','auxiliary','delivery']){draft=doc.state.scenePackageDrafts.at(-1);mutate({action:'confirm',draftId:draft.id,expectedRevision:draft.revision,tab});}
  draft=doc.state.scenePackageDrafts.at(-1);mutate({action:'publish',draftId:draft.id,expectedRevision:draft.revision});
  const next=freezeSceneExecution(doc.state,sceneId,{basis:latestSceneConfiguration(doc.state,sceneId).basis});assert.equal(next.template.groupBy,dimension);assert.equal(old.template.groupBy,'product');assert.deepEqual(doc.state.sceneConfigurations.filter(c=>c.engine==='conversation'),np);
  const event=doc.state.sceneConfigurationEvents.at(-1);assert.equal(event.actor,'Synthetic admin');assert.ok(JSON.stringify(event).includes('groupBy'));assert.equal(event.after.package?.template?.groupBy||event.after.template?.groupBy,dimension);
 }
});
