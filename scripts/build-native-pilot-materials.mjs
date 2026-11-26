import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {authorizePilotMaterial,languageHash,validateBilingualMaterial} from '../server/native-language-materials.mjs';
import {nativeSourceConfiguration} from '../server/native-language-execution.mjs';
import {nativePilotPromptDraft} from '../server/native-language-prompt-draft.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const PILOT_ID='native-pilot-20261126-v2';
export const PILOT_VERSION='0.11.28';
export const PILOT_AUTHORIZATION=Object.freeze({
 actor:'user-authorized-pilot',
 reason:'On 2026-11-26 the user authorized immediate English native frontline trials of the accepted 0.11.27 Chinese criteria, collecting feedback through use without waiting for EC arbitration or bilingual business review. This is trial authorization, not business approval.',
 authorizationId:'user-20261126-native-frontline-pilot',
 at:'2026-11-26T00:00:00.000Z'
});
const NP='新品产品咨询',EC='电商评论回复';
const clause=(clauseId,zh,en)=>({clauseId,kind:'instruction',locales:{zh,en}});
const fail=message=>{throw new Error(message);};
const exact=(actual,expected,label)=>{if(languageHash(actual)!==languageHash(expected))fail(`Source mismatch: ${label}`);};
const pairedText=(m,id,zh)=>{const c=m.clauses.find(c=>c.clauseId===id);if(!c||c.locales.zh!==zh||!c.locales.en?.trim())fail(`Incomplete or changed source clause: ${m.id}/${id}`);};
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));

function material(source,kind,scene,title,scope,clauses){
 return{id:source.id,version:String(source.version),scene,kind,semanticRevision:PILOT_ID,shared:{applicabilityIds:[],exceptionIds:[],parameterRefs:[],dependencyIds:[]},sourceHash:languageHash(source),locales:{zh:{title:source.title||title,scope:source.scope||scene},en:{title,scope}},clauses};
}

// IDs are immutable identities, even when a caller changes the version label.
export function assertPilotIdentity(bundle,previous){
 if(previous?.id===bundle.id&&languageHash(previous)!==languageHash(bundle))fail(`Pilot bundle ID ${bundle.id} already identifies different bytes; issue a new ID.`);
}

function verifySourceMaterial(m,source,configuration){
 if(m.sourceHash!==languageHash(source)||m.version!==String(source.version))fail(`Source mismatch: ${m.scene}/${m.id}@${m.version}`);
 if(m.kind==='rule'){
  for(const [id,key] of [['pass','passCriteria'],['fail','failCriteria'],['exception','exceptionCriteria']]){
   pairedText(m,id,source[key]);
   const model=configuration.ruleExecutionPolicies?.[source.id]?.modelCriteria;
   if(model)pairedText(m,'model.'+id,model[key]);
  }
 }else if(source.sections){
  exact(m.clauses.map(c=>c.clauseId).sort(),source.sections.map(s=>s.id).sort(),`${m.id} section coverage`);
  for(const section of source.sections)pairedText(m,section.id,section.text);
 }else if(m.kind==='taxonomy'){
  for(const label of source.labels){pairedText(m,label.id,label.label);if(label.definition)pairedText(m,'definition-'+label.id,label.definition);}
  for(const [i,p] of (source.principles||[]).entries()){
   const c=m.clauses.find(c=>c.clauseId==='principle-'+(i+1));
   // The original first principle is already bilingual; its draft separates
   // the two verbatim language blocks instead of repeating both in Chinese.
   if(c&&p===c.locales.en+'\r\n'+c.locales.zh)continue;
   pairedText(m,'principle-'+(i+1),p);
  }
  for(const [i,e] of (source.examples||[]).entries())pairedText(m,'example-'+(i+1),e.labelId+': '+(e.translated||e.original));
 }else if(m.kind==='exception')for(const entry of source.entries)pairedText(m,entry.id,entry.condition);
}

function currentPrompt(scene,target,english){
 const prompt=nativePilotPromptDraft(scene),policy=prompt.clauses.find(c=>c.clauseId==='inspection.ecommerce-policy');
 const prefixes={zh:'对于targetPolicyVersion=',en:'For targetPolicyVersion='};
 for(const lang of ['zh','en'])if(!policy.locales[lang].includes(prefixes[lang]))fail('The shared EC prompt changed; recheck its v2 translation before rebuilding.');
 // Keep the shared text/structure/privacy instructions, replacing the entire
 // conditional v3 branch with the exact current v2 rule in both languages.
 policy.locales.zh=policy.locales.zh.split(prefixes.zh)[0]+'当前冻结 targetPolicyVersion=ec-target-calibration-v2。EC-TARGET 通过：'+target.passCriteria+' 不通过：'+target.failCriteria+' 例外：'+target.exceptionCriteria+' 重试保持同一阈值、建议与例外边界，不为制造FAIL搜罗小问题。';
 policy.locales.en=policy.locales.en.split(prefixes.en)[0]+'The frozen targetPolicyVersion is ec-target-calibration-v2. EC-TARGET Pass: '+english.passCriteria+' Fail: '+english.failCriteria+' Exceptions: '+english.exceptionCriteria+' Retries preserve the same threshold, recommendation and exception boundaries; do not hunt minor issues to manufacture FAIL.';
 const invalid=prompt.clauses.find(c=>c.clauseId==='program.ec-invalid');
 invalid.locales={zh:'当前冻结 v2 不因无效评价分类豁免单条针对性；仍按冻结规则与原文判断，批次重复独立检核。',en:'The frozen v2 criteria do not exempt single-reply relevance because of invalid-review classification. Apply the frozen rule to the original text; batch repetition remains a separate check.'};
 prompt.version='V0.11.28-pilot';prompt.semanticRevision=PILOT_ID;
 prompt.sourceHash=languageHash({draft:nativePilotPromptDraft(scene),target});
 return prompt;
}

export function buildNativePilotMaterials({np,seed,catalog,translations}){
 if(translations.status!=='pilot-unreviewed'||translations.source.version!=='0.11.27')fail('Only the pinned unreviewed 0.11.27 translation set is accepted.');
 for(const [key,value] of Object.entries({scene:seed,catalog}))if(languageHash(value)!==translations.source[key+'Hash'])fail(`Source mismatch: ${key} seed; translate and version a new bundle before rebuilding.`);
 const packages=new Map(seed.packages.map(p=>[p.configuration.sceneId,p]));
 if(packages.size!==2||!packages.has(NP)||!packages.has(EC))fail('Both exact NP and EC source packages are required.');
 const npPackage=packages.get(NP),ec=packages.get(EC),npMaterials=np.materials.filter(m=>m.scene===NP&&!['prompt','template'].includes(m.kind));
 if(languageHash(npMaterials)!==translations.source.npMaterialsHash)fail('NP paired draft bytes changed; recheck every translation before rebuilding.');
 const materials=npMaterials.map(m=>{
  validateBilingualMaterial(m,{published:Boolean(m.review)});
  const source=[...npPackage.configuration.basis.rules,...npPackage.configuration.basis.policies,...catalog.rules,...catalog.policies,npPackage.taxonomy,...npPackage.exceptions].find(s=>s&&s.id===m.id&&String(s.version)===m.version&&languageHash(s)===m.sourceHash);
  if(m.id==='NATIVE-CONFIG'){
   if(m.sourceHash!==languageHash(nativeSourceConfiguration(npPackage)))fail('Source mismatch: NP configuration');
  }else if(m.kind!=='glossary'){
   if(!source)fail(`No exact source for NP material: ${m.id}`);
   verifySourceMaterial(m,source,npPackage.configuration);
  }
  return{...structuredClone(m),semanticRevision:PILOT_ID};
 });
 const target=ec.configuration.basis.rules.find(r=>r.id==='EC-TARGET');
 if(target.version!=='V3.6'||ec.configuration.basis.businessProfile.targetPolicyVersion!=='ec-target-calibration-v2')fail('The native pilot is pinned to EC-TARGET V3.6 / v2.');
 for(const pkg of seed.packages){
  const scene=pkg.configuration.sceneId,t=pkg.template,labels=translations.templates[scene];
  const cols=t.columns.map(c=>clause('column.'+c.id,c.label,labels.columns[c.id]||materials.find(m=>m.id===c.ruleId)?.locales.en.title||translations.rules[c.ruleId]?.title));
  materials.push(material(t,'template',scene,labels.title,'Task-frozen business report and workbook layout.',[clause('title',t.title,labels.title),...t.sections.map(s=>clause('section.'+s.key,s.title,labels.sections[s.key])),...t.columnGroups.map(g=>clause('group.'+g.id,g.label,labels.groups[g.id])),...cols]));
  materials.push(currentPrompt(scene,target,translations.rules['EC-TARGET']));
 }
 for(const rule of ec.configuration.basis.rules){
  const e=translations.rules[rule.id];
  if(!e)fail(`Missing English rule: ${rule.id}`);
  materials.push(material(rule,'rule',EC,e.title,'Public ecommerce review replies and the complete imported batch.',[['pass','passCriteria'],['fail','failCriteria'],['exception','exceptionCriteria']].map(([id,k])=>clause(id,rule[k],e[k]))));
 }
 for(const policy of ec.configuration.basis.policies){
  const clauses=policy.sections.map(s=>{
   const id=s.id.replace('-BUSINESS-1',''),rule=ec.configuration.basis.rules.find(r=>r.id===id),e=translations.rules[id];
   if(!rule||!e)fail(`Missing rule for EC policy section: ${s.id}`);
   exact(s.text,`通过：${rule.passCriteria}\n不通过：${rule.failCriteria}\n例外：${rule.exceptionCriteria}`,s.id);
   return clause(s.id,s.text,`Pass: ${e.passCriteria}\nFail: ${e.failCriteria}\nExceptions: ${e.exceptionCriteria}`);
  });
  materials.push(material(policy,'policy',EC,'Ecommerce reply quality criteria','The complete imported batch.',clauses));
 }
 for(const ref of ec.configuration.referenceMaterials||[])materials.push(material(ref,'policy',EC,'Ecommerce reply strategy reference','Reference for case commentary only; not an independent inspection rule.',ref.sections.map(s=>clause(s.id,s.text,translations.referenceSections[s.id]))));
 materials.push({...material({id:'NATIVE-CONFIG',version:'V1.0',title:'电商程序能力配置'},'policy',EC,'EC program capability configuration','Source binding for program dependencies and configuration.',[clause('configuration','连续自然24小时时效与评价归类解绑；沿用当前v2五项判据，好评要求相关增量信息；同管理员至少3条逐对85%重复判据。','Continuous elapsed time uses a fixed 24-hour threshold independently of review classification. Retain the current v2 five criteria, including relevant added information for positive reviews; the repetition rule requires at least three distinct replies by the same administrator, every pair meeting 85% similarity.')]),sourceHash:languageHash(nativeSourceConfiguration(ec))});
 materials.push(material({id:'EC-GLOSSARY',version:'V1.0',title:'电商质检术语'},'glossary',EC,'EC quality-review glossary','Consistent criterion and rationale terminology.',[clause('terms','符合=PASS；不符合=FAIL；无法判定=UNKNOWN；不适用=NA。回复时效；文本质量；模板化回复；回复结构；回复内容合规。','PASS=compliant; FAIL=non-compliant; UNKNOWN=insufficient evidence; NA=not applicable. Reply timeliness; text quality; targeted response and batch repetition; reply structure; public-reply compliance.')]));
 const bundle={schemaVersion:1,id:PILOT_ID,version:PILOT_VERSION,authorization:PILOT_AUTHORIZATION,materials:materials.map(m=>authorizePilotMaterial(m,PILOT_AUTHORIZATION))};
 const seen=new Set();
 for(const m of bundle.materials){const key=m.scene+'::'+m.id;if(seen.has(key))fail(`Duplicate material: ${key}`);seen.add(key);}
 for(const pkg of seed.packages){
  const sources=[...pkg.configuration.basis.rules.filter(r=>r.ruleKind!=='meta'),...pkg.configuration.basis.policies,...pkg.configuration.referenceMaterials||[],pkg.taxonomy,...pkg.exceptions].filter(Boolean);
  for(const source of sources){const m=bundle.materials.find(m=>m.scene===pkg.configuration.sceneId&&m.id===source.id);if(!m)fail(`Missing source material: ${source.id}`);verifySourceMaterial(m,source,pkg.configuration);}
 }
 assertPilotIdentity(bundle,np);
 return bundle;
}

async function ensureImmutableFile(file,bytes){
 try{const prior=await fs.readFile(file);if(!prior.equals(bytes))fail(`Refusing to replace existing release input with changed bytes: ${file}`);}
 catch(e){if(e.code!=='ENOENT')throw e;return;}
}
export async function writePilotInputs({bundle,sceneFile,catalogFile,outFile}){
 const dir=path.dirname(path.resolve(outFile)),sceneBytes=await fs.readFile(sceneFile),catalogBytes=await fs.readFile(catalogFile);
 const bytes=Buffer.from(JSON.stringify(bundle,null,2)+'\n'),files=[[path.resolve(outFile),bytes],[path.join(dir,'scene-seed.json'),sceneBytes],[path.join(dir,'catalog-seed.json'),catalogBytes]];
 try{assertPilotIdentity(bundle,await read(outFile));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const [file,data] of files)await ensureImmutableFile(file,data);
 await fs.mkdir(dir,{recursive:true});
 // wx refuses races or overwrites. Identical rebuilds remain idempotent.
 for(const [file,data] of files){try{await fs.writeFile(file,data,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;await ensureImmutableFile(file,data);}}
 return{output:path.resolve(outFile),id:bundle.id,version:bundle.version,count:bundle.materials.length,scenes:[...new Set(bundle.materials.map(m=>m.scene))],status:'pilot-unreviewed',hash:languageHash(bundle),files:files.map(([file,data])=>({file,sha256:createHash('sha256').update(data).digest('hex')}))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [npFile,sceneFile,catalogFile,outFile]=process.argv.slice(2);
 if(!npFile||!sceneFile||!catalogFile||!outFile||process.argv.length!==6)fail('Usage: node scripts/build-native-pilot-materials.mjs np-paired-draft-or-bundle.json scene-seed.json catalog-seed.json output.json');
 const bundle=buildNativePilotMaterials({np:await read(npFile),seed:await read(sceneFile),catalog:await read(catalogFile),translations:await read(path.join(project,'resources/native-pilot-english.json'))});
 console.log(JSON.stringify(await writePilotInputs({bundle,sceneFile,catalogFile,outFile})));
}
