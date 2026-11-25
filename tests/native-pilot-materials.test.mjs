import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {nativeExecutionContext} from '../server/native-language-execution.mjs';
import {sceneBasisForTask,freezeSceneExecution} from '../public/scene-configuration.mjs';
import {resolveNativeTaskMaterial} from '../server/workspace-language-service.mjs';
import {prepareReportEnrichment} from '../server/report-enrichment.mjs';
import {nativeReportMessages,parseNativeReportEnrichment,nativeReportWireValue} from '../server/native-report-language.mjs';
import {languageHash} from '../server/native-language-materials.mjs';
const file=process.env.NATIVE_PILOT_BUNDLE;
const seedDir=process.env.NATIVE_PILOT_SEEDS;
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
for(const language of ['zh','en'])test(`complete installed pilot material ${language} binds both scenes and native EC report replay`,{skip:!file||!seedDir},async t=>{
 const scratch=path.resolve('../outputs/service-r39-pilot-20261125/material-tests');await fs.mkdir(scratch,{recursive:true});const dataDir=await fs.mkdtemp(path.join(scratch,'synthetic-'));
 const bundle=await read(file),store=await createWorkspaceStore({dataDir,nativeLanguageStage:4,catalogSeed:()=>read(path.join(seedDir,'catalog-seed.json')),sceneSeed:()=>read(path.join(seedDir,'scene-seed.json'))});
 t.after(async()=>{await store.close();assert.ok(dataDir.startsWith(scratch+path.sep));await fs.rm(dataDir,{recursive:true,force:true});});
 await store.enableLanguageGovernance();let view=await store.read();await store.selectLanguage({baseRevision:view.revision,operationId:'select',actor:'SYNTHETIC TEST',language});await store.installNativePilotMaterials(bundle);
 assert.ok((await store.nativeReadiness()).scenes.every(s=>s.status==='blocked'));
 view=await store.read();await store.activateNativePilotMaterials(bundle,{baseRevision:view.revision,operationId:'explicit-activation',actor:'SYNTHETIC TEST',reason:'Verify the unchanged paired material against its own frozen v3 baseline.',acknowledgeUnreviewed:true,bundleHash:languageHash(bundle)});
 const ready=await store.nativeReadiness();assert.equal(ready.scenes.length,2);assert.ok(ready.scenes.every(s=>s.status==='ready'),JSON.stringify(ready));view=await store.read();
 for(const scene of ['新品产品咨询','电商评论回复']){
  const basis=sceneBasisForTask(view.state,view.catalog,scene,'2026-11-25T15:00:00Z'),task={id:'SYNTHETIC',scene,basisSnapshot:basis,executionSnapshot:freezeSceneExecution(view.state,scene,{basis})};
  const resolved=resolveNativeTaskMaterial(view.state,task,bundle.materials),context=nativeExecutionContext(resolved.task,resolved.frozen);assert.equal(context.language,language);
  if(scene!=='电商评论回复')continue;
  const comment='Battery drains quickly. Café.',reply='Please check the battery settings.';
  const values={issueClusters:{clusters:[{label:language==='en'?'Specific issue not addressed':'未回应具体问题',summary:language==='en'?'The reply omits the specific battery issue.':'回复未回应具体的电池问题。',memberIds:['S1'],action:language==='en'?'Provide relevant battery troubleshooting instructions.':'提供相关电池排查建议。'}]},voc:{items:[{id:'S1',valid:'true',scene:'PRODUCT_QUALITY',painPoint:language==='en'?'The battery drains quickly during use.':'使用过程中电池耗电过快。',reason:language==='en'?'The customer reports a specific battery issue.':'用户报告了具体电池问题。',evidenceQuote:'Café.'}]}};
  for(const kind of ['issueClusters','voc']){
   const input={records:[{id:'S1',comment,...(kind==='issueClusters'?{reason:language==='en'?'The reply does not address the battery issue.':'回复未回应电池问题。',reply}:{})}],...(kind==='issueClusters'?{ruleId:'EC-TARGET'}:{})};
   const prepared=nativeReportMessages(prepareReportEnrichment(kind,input),context),value=values[kind];
   if(language==='en')assert.doesNotMatch(prepared.messages[0].content,/\p{Script=Han}/u);
   const parsed=parseNativeReportEnrichment(JSON.stringify(value),prepared);assert.equal(parsed.languageValidation.status,'verified');
   assert.deepEqual(parseNativeReportEnrichment(JSON.stringify(nativeReportWireValue(parsed,kind)),prepared),parsed);
   const wrong=structuredClone(value);if(kind==='issueClusters')wrong.clusters[0].label=language==='en'?'未回应具体问题':'The specific customer issue is not addressed';else wrong.items[0].reason=language==='en'?'用户报告了具体电池问题。':'The customer reports a specific battery issue.';
   assert.throws(()=>parseNativeReportEnrichment(JSON.stringify(wrong),prepared),error=>error.nativeLanguageFailure===true);
   if(kind==='voc'){assert.equal(parsed.items[0].scene,'产品质量');assert.equal(parsed.items[0].coercion.changes[0].after,true);}
  }
 }
});
