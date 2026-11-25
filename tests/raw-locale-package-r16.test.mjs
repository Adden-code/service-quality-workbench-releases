import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setLocale,t,translateError,html} from '../public/i18n.mjs';
import {rawImportFields} from '../public/raw-import-flow.mjs';
import {rawReviewView,rawEditDialog} from '../public/raw-review-view.mjs';
import {rawTaskPanel,createRawWorkbenchManager} from '../public/raw-workbench-manager.mjs';
import {selfServiceGuide,acceptanceChecklist} from '../packaging/self-service-guide.mjs';
import {englishUsageGuide} from '../packaging/english-guide.mjs';
import {businessUsageGuide} from '../packaging/business-guide.mjs';
import {triageWorkflowGuide} from '../packaging/triage-guide.mjs';
import {payloadFiles} from '../packaging/build.mjs';
import {RAW_EN} from '../public/raw-locale-en.mjs';
import {buildPortable} from '../packaging/build-portable.mjs';
import {businessTaskDialog} from '../public/business-dialogs.mjs';
import {createBusinessState} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';

const project=fileURLToPath(new URL('..',import.meta.url));
const visible=markup=>markup.replace(/<[^>]*>/g,'');
test('R16 English dictionary preserves interpolation placeholders and contains fixed English text',()=>{
 assert.ok(Object.isFrozen(RAW_EN));
 for(const [key,value] of Object.entries(RAW_EN)){
  assert.equal(typeof value,'string',key);assert.ok(value.trim(),key);assert.doesNotMatch(value,/\p{Script=Han}/u,key);
  assert.deepEqual([...key.matchAll(/\{\d+\}/gu)].map(m=>m[0]).sort(),[...value.matchAll(/\{\d+\}/gu)].map(m=>m[0]).sort(),key);
 }
});
function fixture(){
 const rules=[{id:'SYN-R',name:'Synthetic rule',title:'Synthetic rule',version:'V1',policyIds:[]}];
 const task={id:'SYN-T',name:'Synthetic task',mode:'manual',inputMode:'raw-transcript-v1',source:{sha256:'a'.repeat(64)},basisSnapshot:{rules,policies:[]},rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}};
 const session={id:'SYN-S',externalId:'SYN-ROW',taskId:task.id,agent:'Agent A',expectedRuleIds:['SYN-R'],rawTranscript:{schemaVersion:1,text:'Synthetic transcript.',row:2,timePolicy:{mode:'unavailable',timezone:'+08:00'}},aiExecution:{status:'completed'},aiDecision:{status:'UNCERTAIN',reasonCodes:[]},reviewPolicy:{enabled:true,confidenceThreshold:0.9},review:{status:'待审核',reviewer:'Operator',drafts:{},history:[]},aiResults:[{ruleId:'SYN-R',verdict:'无法判定',reason:'Synthetic missing information.',evidence:[],evidenceQuotes:[],referenceIds:[],rawValidation:{status:'degraded'},confidence:0,conflictsWith:[]}]};
 return{task,session,state:{tasks:[task],sessions:[session]}};
}

test('R16 English renders import, review and human quote editing while retaining internal values',ctx=>{
 setLocale('en',{storage:null});ctx.after(()=>setLocale('zh',{storage:null}));const f=fixture(),before=JSON.stringify(f.state);
 const views=[rawImportFields({parsed:{inputMode:'raw-transcript-v1',sessions:[f.session]},rawImportOptions:f.task.rawImportOptions}),rawTaskPanel(f.state,f.task),rawReviewView(f.state,{openRules:['SYN-R'],rawSelectedSession:f.session.id,rawResultFilter:'全部规则'},{session:f.session,queue:[f.session]}),rawEditDialog({ruleId:'SYN-R',verdict:'无法判定',evidenceQuotes:[]},f.state,f.session).body];
 for(const view of views)assert.doesNotMatch(visible(view),/\p{Script=Han}/u,visible(view));
 assert.match(views[0],/value="unavailable"/);assert.match(views[3],/value="无法判定"[^>]*>Unable to determine/);
 assert.match(views[2],/Locate quotation|No located quotation/);assert.equal(JSON.stringify(f.state),before);
 const original='原始事实：不符合 <script>原文</script> العربية',quotation='不符合';
 const localized=html`<p>原始全文</p><pre>${original}</pre><blockquote>${quotation}</blockquote>`;
 assert.ok(localized.includes(original));assert.ok(localized.includes('<blockquote>不符合</blockquote>'));assert.match(localized,/Original transcript/);
});

test('R16 English covers local golden metrics and separate optional structure consent and progress',ctx=>{
 setLocale('en',{storage:null});ctx.after(()=>setLocale('zh',{storage:null}));const f=fixture();
 const manager=createRawWorkbenchManager({getState:()=>f.state,getUI:()=>({}),getModelConfig:()=>({configured:true,connectionTested:true,baseUrl:'https://synthetic.invalid/v1',model:'synthetic'}),getDialog:()=>null});
 const metrics={accuracy:{rate:0.8,correct:8,total:10},uncertainty:{rate:0.2,count:2,total:10},failRecall:{rate:0.5,recalled:1,total:2},wrongAIFinalPass:{count:1,assessedRows:2,totalAIFinalRows:3},counts:{goldenChecks:9,expectedChecks:10,missingGolden:1,technicalFailedRows:1,unansweredChecks:2},humanReviewTimeMs:1000,reviewRouting:{modelRequestAttempts:2,uncertainRows:1,humanQueueRows:1,returnEvents:1,aiCompletedRows:1},acceptance:{goldenComplete:false}};
 const golden=manager.dialog({type:'raw-golden',metrics}),structure=manager.dialog({type:'raw-structure',taskName:'Synthetic task',modelFingerprint:'',consent:false,job:{status:'completed_with_warnings',nodes:[{label:'后台结构化 · SYN',status:'completed'}],processed:1,total:1},result:{artifact:{label:'标准双表（AI生成，未核验）',kind:'standard-double-sheet'}}});
 for(const view of [golden,structure])assert.doesNotMatch(visible(view),/\p{Script=Han}/u,visible(view));
 for(const phrase of ['Rule accuracy','Unable-to-determine rate','FAIL recall','Wrong original AI-final PASS rows','8/10','2/10','1/2','AI request attempts (inspection only)','Uncertain rows','Return-to-review events'])assert.ok(golden.includes(phrase),phrase);
 const legacyGolden=manager.dialog({type:'raw-golden',metrics:{...metrics,reviewRouting:{...metrics.reviewRouting,modelRequestAttempts:null}}});assert.match(legacyGolden,/Not recorded/);assert.doesNotMatch(visible(legacyGolden),/\p{Script=Han}/u);
 assert.match(structure,/current tested endpoint|tested endpoint/);assert.match(structure,/unverified draft/i);assert.match(structure,/raw-structure-consent/);manager.stop();
});

test('integrated raw task preview and affected-time-rule selection render in English without changing source cells',ctx=>{
 setLocale('en',{storage:null});ctx.after(()=>setLocale('zh',{storage:null}));const f=fixture(),state=createBusinessState(),catalog=createBusinessCatalog();
 const rule={...f.task.basisSnapshot.rules[0],category:'Timing',passCriteria:'Respond within 60 seconds.',failCriteria:'Respond after 60 seconds.',scope:'Synthetic only',status:'已发布',effectiveAt:'2026-01-01',expiresAt:'',sceneIds:['新品产品咨询']};catalog.rules.push(rule);
 const dialog={type:'new-task',mode:'manual',scene:'新品产品咨询',step:2,name:'Synthetic task',reviewer:'Operator',file:{name:'original.xlsx'},fileName:'original.xlsx',parsed:{valid:true,rawDirect:true,inputMode:'raw-transcript-v1',availableSheetNames:['Source A','Source B'],selectedSheet:'Source B',sessions:[{...f.session,scene:'新品产品咨询',turns:[],topic:'',product:''}]},rawImportOptions:f.task.rawImportOptions,previewConfirmed:true,catalog,effectiveDate:'2026-11-12',ruleIds:[rule.id],basisSnapshot:{rules:[rule],policies:[]}},before=JSON.stringify(dialog);
 const preview=businessTaskDialog(dialog,state).body,selection=businessTaskDialog({...dialog,step:3},state).body;
 for(const view of [preview,selection])assert.doesNotMatch(visible(view),/\p{Script=Han}/u,visible(view));
 assert.match(preview,/Raw direct inspection/);assert.match(preview,/Synthetic transcript\./);assert.match(preview,/Source worksheet \(required\)/);assert.match(preview,/value="Source B" selected>Source B/);assert.match(selection,/Affected time-dependent rules/);assert.match(selection,/Synthetic rule/);
 assert.equal(JSON.stringify(dialog),before);
});

test('R16 static raw-source and optional-structure errors have direct English translations',async ctx=>{
 setLocale('en',{storage:null});ctx.after(()=>setLocale('zh',{storage:null}));
 for(const file of ['public/raw-transcript.mjs','public/raw-import-flow.mjs','public/raw-workbench-manager.mjs','public/raw-evidence.mjs','server/raw-source.mjs','server/raw-inspection.mjs','server/raw-structure-jobs.mjs']){
  const source=await fs.readFile(path.join(project,file),'utf8');
  for(const match of source.matchAll(/(?:fail|issue|new Error|new RawInspectionError|errors\.push|warnings\.push)\((?:'[^']*',\s*)?'([^'\r\n]*[\u3400-\u9fff][^'\r\n]*)'/gu)){
   const value=translateError(match[1]);assert.doesNotMatch(value,/\p{Script=Han}/u,`${file}: ${match[1]}`);
  }
 }
 for(const message of ['金标准对照：模板任务或原文件摘要不匹配。','金标准对照：存在错行、会话ID／规则／版本不匹配、重复或非法人工判定。','该引文在本行原文出现次数超过4096处，请选取更长且能区分上下文的连续原文。','Source第2行：会话ID重复：SYN-ID。'])assert.doesNotMatch(translateError(message),/\p{Script=Han}/u,message);
 assert.equal(t('未提供可靠来源时间；纯时效类检核无法判定，不使用质检时点补造会话时间。'),'Reliable source timestamps were not provided. Pure timing checks are unable to determine; inspection time cannot replace conversation time.');
});

test('all shipped local module imports are available in the explicit payload or public tree',async()=>{
 assert.equal(new Set(payloadFiles).size,payloadFiles.length);
 for(const name of ['server/raw-inspection.mjs','server/raw-source.mjs','server/raw-structure-jobs.mjs'])assert.ok(payloadFiles.includes(name),name);
 for(const rel of payloadFiles.filter(name=>name.endsWith('.mjs'))){
  const source=await fs.readFile(path.join(project,rel),'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/gu)){
   const target=path.relative(project,path.resolve(project,path.dirname(rel),match[1])).replaceAll('\\','/');
   assert.ok(target.startsWith('public/')||payloadFiles.includes(target),`${rel} requires ${target}`);
  }
 }
});

test('program-only R16 staging preserves every raw runtime module and includes no seed, samples, data or credentials',async ctx=>{
 const evidence=fileURLToPath(new URL('../../copy-package-r16/temp/',import.meta.url));await fs.mkdir(evidence,{recursive:true});
 const dir=await fs.mkdtemp(path.join(evidence,'public-stage-'));
 ctx.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(evidence)+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 const javaRuntime=path.join(dir,'java');await fs.mkdir(path.join(javaRuntime,'bin'),{recursive:true});
 const inputs={nodeExe:path.join(dir,'node.exe'),nodeLicense:path.join(dir,'LICENSE.txt'),javaRuntime,jarPath:path.join(dir,'synthetic-worker.jar')};
 for(const name of [inputs.nodeExe,inputs.nodeLicense,inputs.jarPath,path.join(javaRuntime,'bin/java.exe')])await fs.writeFile(name,'SYNTHETIC runtime placeholder; never execute');
 const result=await buildPortable({outputDir:path.join(dir,'output'),...inputs,archive:false,split:false}),meta=JSON.parse(await fs.readFile(path.join(result.root,'portable-info.json'),'utf8')),manifest=JSON.parse(await fs.readFile(path.join(result.root,'文件校验清单.json'),'utf8'));
 assert.equal(meta.version,'0.11.23');assert.equal(meta.factoryReady,false);assert.equal(meta.catalogSeedIncluded,false);assert.equal(meta.catalog,null);assert.equal(meta.catalogInfo,null);assert.equal(meta.sourceDataIncluded,false);assert.equal(meta.credentialsIncluded,false);
 assert.ok(!manifest.files.some(entry=>/^(?:data|tests|docs\/samples)\/|catalog-seed\.json|(?:^|\/)\.env|\.secrets|sample.*\.xlsx/i.test(entry.path)));
 for(const rel of ['server/raw-inspection.mjs','server/raw-source.mjs','server/raw-structure-jobs.mjs','public/raw-locale-en.mjs','public/raw-review-view.mjs','public/raw-golden.mjs']){
  assert.ok(manifest.files.some(entry=>entry.path===rel),rel);assert.deepEqual(await fs.readFile(path.join(result.root,rel)),await fs.readFile(path.join(project,rel)),rel);
 }
 assert.ok(!(await fs.readdir(path.join(dir,'output'))).some(name=>name.endsWith('_完整安装包.exe')));
});

test('release version and bilingual instructions define raw direct inspection, legacy drafts and all four golden metrics',async()=>{
 const {productVersion}=await import('../packaging/version.mjs');assert.equal(productVersion,'0.11.23');
 const pkg=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8'));assert.equal(pkg.version,productVersion);
 for(const text of [selfServiceGuide('en'),englishUsageGuide(productVersion),triageWorkflowGuide('en'),acceptanceChecklist('en')]){
  for(const phrase of ['Raw direct inspection','legacy','0.90','90%','FAIL recall','uncertainty','wrong original AI-final PASS','denominator'])assert.ok(text.toLowerCase().includes(phrase.toLowerCase()),phrase);
  assert.match(text,/no catalog seed/i);assert.match(text,/no.*sample/i);assert.match(text,/factoryReady=false/);
  assert.doesNotMatch(text.replace(/\[Raw template schema\][\s\S]*?\[\/Raw template schema\]/gu,''),/\p{Script=Han}/u);
 }
 for(const text of [selfServiceGuide('zh'),businessUsageGuide(productVersion),triageWorkflowGuide('zh'),acceptanceChecklist('zh')])for(const phrase of ['原文直判','旧清洗草稿','0.90','90%','正确率','无法判定率','FAIL召回率','错误免审PASS','分母','factoryReady=false'])assert.ok(text.includes(phrase),phrase);
});
