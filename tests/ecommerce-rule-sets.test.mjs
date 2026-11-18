import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessCatalog, validateCatalog} from '../public/catalog.mjs';

const api=()=>import('../public/ecommerce-rule-sets.mjs');
const now='2026-11-03T09:00:00+08:00', later='2026-11-03T10:00:00+08:00';
const changes={owner:'业务维护人',changeNote:'用户确认的阶段A试运行',effectiveAt:'2026-11-03'};
const clone=value=>structuredClone(value);

test('stage A seed is a detached literal-working-hours draft and optional collection preserves old catalog',async()=>{
  const {createRuleSetSeed,createRuleSetDraft}=await api();
  const seed=createRuleSetSeed({now});
  assert.equal(seed.version,'V2.1-A');assert.equal(seed.executionProfile,'v21-time-v1-content');assert.equal(seed.trial,true);
  assert.equal(seed.status,'草稿');assert.equal(seed.calendarConfirmed,false);
  assert.deepEqual(seed.timeRule,{mode:'workingHours',calendar:{workdays:['Mon','Tue','Wed','Thu','Fri'],workStart:'09:00',workEnd:'18:00',timezone:'UTC+08:00',holidays:[],workingDates:[]},thresholds:{default:24,byType:{'好评正向':72,'中评':48,'好评负向':24,'差评':24}},unrepliedRule:true,replyDetection:'bothEmpty'});
  const base=createBusinessCatalog(),before=clone(base),next=createRuleSetDraft(base,'EC-REVIEW',changes,now);
  assert.deepEqual(base,before);assert.equal(base.ruleSets,undefined);assert.equal(next.ruleSets.length,1);assert.equal(validateCatalog(next),true);
  next.ruleSets[0].timeRule.calendar.holidays.push('2026-12-25');assert.deepEqual(seed.timeRule.calendar.holidays,[]);
});

test('draft lifecycle validates publication, immutable published content, independent new versions and effective selection',async()=>{
  const {createRuleSetDraft,updateRuleSetDraft,publishRuleSet,retireRuleSet,listRuleSets}=await api();
  let catalog=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',changes,now);
  assert.deepEqual(listRuleSets(catalog,{asOf:'2026-11-03',includeUnavailable:false}),[]);
  catalog=publishRuleSet(catalog,'EC-REVIEW','V2.1-A',later);
  assert.equal(listRuleSets(catalog,{asOf:'2026-11-03',includeUnavailable:false}).length,1);
  assert.equal(listRuleSets(catalog,{asOf:'2026-11-02',includeUnavailable:false}).length,0);
  assert.throws(()=>updateRuleSetDraft(catalog,'EC-REVIEW','V2.1-A',{title:'偷偷改口径'},later),/草稿|新版本/);
  assert.throws(()=>createRuleSetDraft(catalog,'EC-REVIEW',changes,later),/重复/);
  const second=createRuleSetDraft(catalog,'EC-REVIEW',{...changes,version:'V2.2-A',effectiveAt:'2026-12-01'},later);
  assert.throws(()=>publishRuleSet(second,'EC-REVIEW','V2.2-A',later),/重叠/);
  const retired=retireRuleSet(catalog,'EC-REVIEW','V2.1-A',later);
  assert.equal(retired.ruleSets[0].status,'已停用');assert.equal(catalog.ruleSets[0].status,'已发布');
  assert.deepEqual(listRuleSets(retired,{asOf:'2026-11-03',includeUnavailable:false}),[]);
});

test('strict supported schema refuses full V2.1 features, invalid time settings, dates, bounds and duplicate records',async()=>{
  const {createRuleSetSeed,validateRuleSet,createRuleSetDraft,publishRuleSet}=await api();
  const good=createRuleSetSeed({...changes,now});
  for(const mutate of [
    r=>r.textRule={templateSimilarity:true},r=>r.executionProfile='full-v21',r=>r.trial=false,
    r=>r.timeRule.extra=true,r=>r.timeRule.replyDetection='contentOnly',r=>r.timeRule.unrepliedRule='true',
    r=>r.timeRule.thresholds.default=0,r=>r.timeRule.thresholds.byType['未知']=24,
    r=>r.timeRule.calendar.workdays='Mon-Fri',
    r=>r.timeRule.calendar.workEnd='08:00',r=>r.timeRule.calendar.holidays=['2026-02-30'],
    r=>r.timeRule.calendar.holidays=['2026-11-03','2026-11-03'],
    r=>{r.timeRule.calendar.holidays=['2026-11-03'];r.timeRule.calendar.workingDates=['2026-11-03'];},
    r=>r.calendarConfirmed='yes',r=>r.expiresAt=r.effectiveAt,r=>r.updatedAt='bad',r=>r.version='V2.1',
  ]){const bad=clone(good);mutate(bad);assert.throws(()=>validateRuleSet(bad));}
  const draft=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',{...changes,owner:''},now);
  assert.throws(()=>publishRuleSet(draft,'EC-REVIEW','V2.1-A',later),/维护人/);
  const duplicate=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',changes,now);duplicate.ruleSets.push(clone(duplicate.ruleSets[0]));
  assert.throws(()=>validateCatalog(duplicate),/重复/);
});

test('bounded JSON imports are fresh validated drafts, never executable publications or silent partial feature imports',async()=>{
  const {createRuleSetDraft,publishRuleSet,exportRuleSet,importRuleSet}=await api();
  let source=createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',changes,now);source=publishRuleSet(source,'EC-REVIEW','V2.1-A',later);
  const json=exportRuleSet(source,'EC-REVIEW','V2.1-A'),base=createBusinessCatalog();
  const imported=importRuleSet(base,json,later);
  assert.equal(imported.ruleSets[0].status,'草稿');assert.equal(imported.ruleSets[0].createdAt,later);assert.equal(base.ruleSets,undefined);
  assert.throws(()=>importRuleSet(source,json,later),/重复/);
  assert.throws(()=>importRuleSet(base,'x'.repeat(1024*1024+1),later),/大小|长度|1MB/);
  const bad=JSON.parse(json);bad.ruleSet.templateSimilarity=.8;assert.throws(()=>importRuleSet(base,JSON.stringify(bad),later),/字段|支持/);
});

test('catalog save transitions require stored drafts, immutable identities and frozen publication content',async()=>{
  const {createRuleSetDraft,updateRuleSetDraft,publishRuleSet,retireRuleSet,validateRuleSetCatalogTransition}=await api();
  assert.equal(typeof validateRuleSetCatalogTransition,'function');
  const base=createBusinessCatalog(),draft=createRuleSetDraft(base,'EC-REVIEW',changes,now),published=publishRuleSet(draft,'EC-REVIEW','V2.1-A',later),retired=retireRuleSet(published,'EC-REVIEW','V2.1-A',later);
  assert.equal(validateRuleSetCatalogTransition(base,draft),true);assert.equal(validateRuleSetCatalogTransition(draft,published),true);assert.equal(validateRuleSetCatalogTransition(published,retired),true);
  assert.equal(validateRuleSetCatalogTransition(draft,updateRuleSetDraft(draft,'EC-REVIEW','V2.1-A',{title:'新标题'},later)),true);
  assert.throws(()=>validateRuleSetCatalogTransition(base,published),/草稿/);
  for(const before of [draft,published,retired]){
    const removed=clone(before);removed.ruleSets=[];assert.throws(()=>validateRuleSetCatalogTransition(before,removed),/删除|标识/);
    for(const mutate of [r=>r.ruleSetId='RENAMED',r=>r.version='V2.2-A',r=>r.createdAt=later]){const bad=clone(before);mutate(bad.ruleSets[0]);assert.throws(()=>validateRuleSetCatalogTransition(before,bad));}
  }
  for(const before of [published,retired]){
    for(const mutate of [r=>r.timeRule.thresholds.default=50,r=>r.owner='别人',r=>r.expiresAt='2026-12-01',r=>r.calendarConfirmed=true,r=>r.status='草稿']){const bad=clone(before);mutate(bad.ruleSets[0]);assert.throws(()=>validateRuleSetCatalogTransition(before,bad));}
  }
  const editOnPublish=clone(published);editOnPublish.ruleSets[0].timeRule.thresholds.default=50;assert.throws(()=>validateRuleSetCatalogTransition(draft,editOnPublish),/发布|草稿|内容/);
});

test('draft normalization rejects unsupported calendar keys instead of deleting them silently',async()=>{
  const {createRuleSetSeed,createRuleSetDraft}=await api(),seed=createRuleSetSeed({now});
  seed.timeRule.calendar.lunchBreak={start:'12:00',end:'13:00'};
  assert.throws(()=>createRuleSetDraft(createBusinessCatalog(),'EC-REVIEW',{...changes,timeRule:seed.timeRule},now),/字段|支持/);
});
