import {nativeExecutionContext} from './native-language-execution.mjs';
import {languageHash} from './native-language-materials.mjs';
import {languageError} from '../public/workspace-language.mjs';

// Read-only, task-bound display DTO. Never publish the paired package or prompts
// to the browser, and never put this projection into editable workspace state.
export function nativeDisplayProjection(task,frozen,{delivery=false}={}){
 const context=nativeExecutionContext(task,frozen),selected=frozen.selected;
 const select=(kind,id)=>selected.find(m=>m.kind===kind&&m.id===id);
 const clauses=m=>Object.fromEntries((m?.clauses||[]).map(c=>[c.clauseId,c.text]));
 const rules=task.basisSnapshot.rules.filter(r=>r.ruleKind!=='meta').map(r=>{const m=select('rule',r.id),c=clauses(m);return{id:r.id,version:r.version,title:m.title,scope:m.scope,passCriteria:c.pass,failCriteria:c.fail,exceptionCriteria:c.exception};});
 const policies=task.basisSnapshot.policies.map(p=>{const m=select('policy',p.id),c=clauses(m);return{id:p.id,version:p.version,title:m.title,sections:p.sections.map(s=>({id:s.id,title:s.id,text:c[s.id]}))};});
 const terms=new Map(),ambiguous=new Set();
 const add=(source,text)=>{if(typeof source!=='string'||!source.trim()||typeof text!=='string')return;if(terms.has(source)&&terms.get(source)!==text){terms.delete(source);ambiguous.add(source);}else if(!ambiguous.has(source))terms.set(source,text);};
 for(const m of selected.filter(m=>!['prompt','glossary'].includes(m.kind))){const paired=frozen.paired.find(p=>p.id===m.id);for(const lang of ['zh','en']){add(paired.locales[lang].title,m.title);add(paired.locales[lang].scope,m.scope);for(const c of m.clauses)add(paired.clauses.find(p=>p.clauseId===c.clauseId)?.locales[lang],c.text);}}
 for(const r of rules){const source=task.basisSnapshot.rules.find(x=>x.id===r.id);for(const key of ['title','scope','passCriteria','failCriteria','exceptionCriteria'])add(source[key],r[key]);}
 for(const p of policies)add(task.basisSnapshot.policies.find(x=>x.id===p.id).title,p.title);
 let template;
 if(delivery){
  const source=task.executionSnapshot.template,m=source&&select('template',source.id),paired=m&&frozen.paired.find(p=>p.id===m.id),c=clauses(m);
  if(!source||!m||paired.sourceHash!==languageHash(source))languageError('NATIVE_REPORT_MATERIAL_INCOMPLETE','The exact frozen report template requires bilingual review before native delivery.');
  const required=['title',...source.sections.map(s=>'section.'+s.key),...source.columnGroups.map(g=>'group.'+g.id),...source.columns.map(v=>'column.'+v.id)];
  if(required.some(id=>!c[id]))languageError('NATIVE_REPORT_MATERIAL_INCOMPLETE','Reviewed report headings, column groups and column labels are incomplete.');
  template={...structuredClone(source),title:c.title,sections:source.sections.map(s=>({...s,title:c['section.'+s.key]})),columnGroups:source.columnGroups.map(g=>({...g,label:c['group.'+g.id]})),columns:source.columns.map(v=>({...v,label:c['column.'+v.id]}))};
  add(source.title,template.title);for(const s of source.sections)add(s.title,c['section.'+s.key]);for(const g of source.columnGroups)add(g.label,c['group.'+g.id]);for(const v of source.columns)add(v.label,c['column.'+v.id]);
 }
 return{schemaVersion:1,taskId:task.id,scene:task.scene,materialRef:task.executionSnapshot.languageMaterialRef,languageExecution:structuredClone(context.execution),rules,policies,terms:[...terms].map(([source,text])=>({source,text})),...(template?{template}:{})};
}

export function nativeTaskFromDelivery(snapshot){
 // Older deliveries stored the full display basis here; newer NP deliveries
 // omit the derived overall rule from their detail-column projection. Recover
 // the basis that produced the frozen display, then keep all hash checks intact.
 const displayRules=snapshot.nativeDisplay?.rules||[];
 const coversDisplay=basis=>Array.isArray(basis?.rules)&&displayRules.every(display=>basis.rules.some(rule=>rule.id===display.id&&String(rule.version)===String(display.version)));
 const basisSnapshot=coversDisplay(snapshot.basis)?snapshot.basis:snapshot.executionSnapshot?.basis;
 return{id:snapshot.taskId,scene:snapshot.nativeDisplay?.scene,basisSnapshot,executionSnapshot:snapshot.executionSnapshot};
}
export function assertNativeDeliveryLanguage(task,{targetLang,reportLanguage}={}){
 const language=task?.executionSnapshot?.languageExecution?.contentLanguage;if(!language)return;
 if(targetLang!==undefined&&targetLang!==language||reportLanguage!==undefined&&reportLanguage!==language)languageError('NATIVE_LANGUAGE_LOCKED','Report and workbook language must match this task’s frozen native language.');
 return language;
}
