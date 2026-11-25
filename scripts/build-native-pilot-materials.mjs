import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorizePilotMaterial,languageHash} from '../server/native-language-materials.mjs';
import {nativeSourceConfiguration} from '../server/native-language-execution.mjs';
import {nativePilotPromptDraft} from '../server/native-language-prompt-draft.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [npFile,sceneFile,outFile]=process.argv.slice(2);
if(!npFile||!sceneFile||!outFile)throw new Error('Usage: node scripts/build-native-pilot-materials.mjs np-paired-draft.json scene-seed.json output.json');
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const np=await read(npFile),seed=await read(sceneFile),ec=seed.packages.find(p=>p.configuration.sceneId==='电商评论回复');
const translations=await read(path.join(project,'resources/native-pilot-english.json'));
const auth={actor:'user-authorized-pilot',reason:'User authorized NP and EC native bilingual trial before business review, following PDT direction to gather feedback through use. Existing Chinese criteria are unchanged; this is not business approval.',authorizationId:'user-20261125-pilot-before-business-review',at:'2026-11-25T14:00:00.000Z'};
const clause=(clauseId,zh,en)=>({clauseId,kind:'instruction',locales:{zh,en}});
function material(source,kind,scene,title,scope,clauses){return{id:source.id,version:String(source.version),scene,kind,semanticRevision:'native-pilot-20261125-v1',shared:{applicabilityIds:[],exceptionIds:[],parameterRefs:[],dependencyIds:[]},sourceHash:languageHash(source),locales:{zh:{title:source.title||title,scope:source.scope||scene},en:{title,scope}},clauses};}
const materials=np.materials.filter(m=>m.kind!=='prompt').map(m=>structuredClone(m));
for(const pkg of seed.packages){
 const scene=pkg.configuration.sceneId,t=pkg.template,labels=translations.templates[scene];
 const cols=t.columns.map(c=>clause('column.'+c.id,c.label,labels.columns[c.id]||materials.find(m=>m.id===c.ruleId)?.locales.en.title||translations.rules[c.ruleId]?.title));
 materials.push(material(t,'template',scene,labels.title,'Task-frozen business report and workbook layout.',[clause('title',t.title,labels.title),...t.sections.map(s=>clause('section.'+s.key,s.title,labels.sections[s.key])),...t.columnGroups.map(g=>clause('group.'+g.id,g.label,labels.groups[g.id])),...cols]));
 materials.push(nativePilotPromptDraft(scene));
}
for(const rule of ec.configuration.basis.rules){
 const e=translations.rules[rule.id];
 materials.push(material(rule,'rule','电商评论回复',e.title,'Public ecommerce review replies and the complete imported batch.',[['pass','passCriteria'],['fail','failCriteria'],['exception','exceptionCriteria']].map(([id,k])=>clause(id,rule[k],e[k]))));
}
for(const policy of ec.configuration.basis.policies){
 const clauses=policy.sections.map(s=>{const e=translations.rules[s.id.replace('-BUSINESS-1','')];return clause(s.id,s.text,`Pass: ${e.passCriteria}\nFail: ${e.failCriteria}\nExceptions: ${e.exceptionCriteria}`);});
 materials.push(material(policy,'policy','电商评论回复','Ecommerce reply quality criteria','The complete imported batch.',clauses));
}
for(const ref of ec.configuration.referenceMaterials||[]){
 materials.push(material(ref,'policy','电商评论回复','Ecommerce reply strategy reference','Reference for case commentary only; not an independent inspection rule.',ref.sections.map(s=>clause(s.id,s.text,translations.referenceSections[s.id]))));
}
const config={configuration:ec.configuration,taxonomy:ec.taxonomy,exceptions:ec.exceptions};
materials.push({...material({id:'NATIVE-CONFIG',version:'V1.0',title:'电商程序能力配置'},'policy','电商评论回复','EC program capability configuration','Source binding for program dependencies and configuration.',[clause('configuration','连续自然24小时时效与评价归类解绑；沿用现行五项判据、同管理员至少3条逐对85%重复判据。','Continuous elapsed time uses a fixed 24-hour threshold independently of review classification. Retain the current five criteria and the duplicate rule: at least three distinct replies by the same administrator, each pair meeting 85% similarity.')]),sourceHash:languageHash(nativeSourceConfiguration(config))});
materials.push(material({id:'EC-GLOSSARY',version:'V1.0',title:'电商质检术语'},'glossary','电商评论回复','EC quality-review glossary','Consistent criterion and rationale terminology.',[clause('terms','符合=PASS；不符合=FAIL；无法判定=UNKNOWN；不适用=NA。回复时效；文本质量；模板化回复；回复结构；回复内容合规。','PASS=compliant; FAIL=non-compliant; UNKNOWN=insufficient evidence; NA=not applicable. Reply timeliness; text quality; targeted response and batch repetition; reply structure; public-reply compliance.') ]));
const bundle={schemaVersion:1,id:'native-pilot-20261125-v1',version:'0.11.26',authorization:auth,materials:materials.map(m=>authorizePilotMaterial(m,auth))};
await fs.mkdir(path.dirname(path.resolve(outFile)),{recursive:true});await fs.writeFile(outFile,JSON.stringify(bundle,null,2)+'\n');
console.log(JSON.stringify({output:outFile,count:bundle.materials.length,scenes:[...new Set(materials.map(m=>m.scene))],status:'pilot-unreviewed',hash:languageHash(bundle)}));
