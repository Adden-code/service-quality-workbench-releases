import {checkNativeProse} from './native-language-validation.mjs';

export const nativeReportLanguage=snapshot=>snapshot?.executionSnapshot?.languageExecution?.mode==='native-v1'?snapshot.executionSnapshot.languageExecution.contentLanguage:null;
// Only original conversation/excerpt fields use the delivery translation cache.
// Generated prose is read in its frozen native language, never back-translated.
export function createNativeReportLocale(snapshot,enrichment,{englishValue=v=>v}={}){
 const language=nativeReportLanguage(snapshot),projection=snapshot.nativeDisplay;
 if(!projection||projection.materialRef!==snapshot.executionSnapshot.languageMaterialRef||projection.languageExecution.selectedMaterialHash!==snapshot.executionSnapshot.languageExecution.selectedMaterialHash)throw new Error('Native report display material is missing or does not match the frozen task.');
 const terms=new Map(projection.terms.map(x=>[x.source,x.text])),originals=new Map(),prose=new Map();
 const unavailable=language==='en'?'Native explanation needs language review; the original is retained in the audit.':'原生说明需语言复核，原始输出保留于审计。';
 const sourceQuotes=snapshot.records.flatMap(r=>[r.conversation,...(r.turns||[]).map(t=>t.text)]).filter(Boolean);
 const checked=(text,assurance)=>!String(text||'').trim()?String(text||''):assurance&&assurance.status!=='verified'?unavailable:checkNativeProse(text,language,{sourceQuotes}).status==='verified'?text:unavailable;
 for(const r of snapshot.records){
  const entries=enrichment.translations?.[r.id]||{};originals.set(r.conversation,entries.conversation);
  for(const t of r.turns||[])originals.set(t.text,entries['excerpt-'+t.id]);
  for(const item of [...(r.ai||[]),...(r.final||[])])if(item.reason)prose.set(item.reason,item.source==='confirmed'?item.reason:checked(item.reason,item.languageValidation));
  if(r.summary)prose.set(r.summary,(r.final||[]).filter(x=>x.verdict==='Fail').map(x=>`${projection.rules.find(v=>v.id===x.ruleId)?.title||x.ruleId}: ${prose.get(x.reason)||checked(x.reason,x.languageValidation)}`).join('; '));
 }
 for(const row of snapshot.sceneAudit||[])for(const result of row.ai||[]){if(result.reason)prose.set(result.reason,checked(result.reason,result.languageValidation));}
 for(const row of snapshot.sceneAudit||[])for(const value of Object.values(row.capabilities?.outputs||{})){if(value.reason)prose.set(value.reason,checked(value.reason,value.languageValidation));if(value.value?.text)prose.set(value.value.text,checked(value.value.text,value.languageValidation));}
 const inspect=(value,audit)=>{if(!value||typeof value!=='object')return;const current=value.languageValidation||audit;for(const [key,item]of Object.entries(value)){if(['reason','summary','commentary','action','painPoint','demandSummary','text'].includes(key)&&typeof item==='string')prose.set(item,checked(item,current));else if(item&&typeof item==='object'&&!['translations','evidence','evidenceQuotes','nativeContract','languageValidation'].includes(key))inspect(item,current);}};
 inspect({...enrichment,translations:undefined});
 const display=source=>{source=String(source??'');if(!source.trim())return source;if(prose.has(source))return prose.get(source);if(terms.has(source))return terms.get(source);if(language==='zh')return source;const fixed=englishValue(source);if(fixed!==source)return fixed;return !/[\p{Script=Han}\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Devanagari}]/u.test(source)?source:'Native field unavailable; see the audit.';};
 const translation=source=>{const item=originals.get(source);return item&&['translated','same'].includes(item.status)&&String(item.text||'').trim()?item:{status:item?.status||'missing',text:''};};
 const translated=source=>{const item=translation(source);return item.text||(language==='en'?'Original-text translation unavailable; see source.':'原文译文缺失，请查看原文。');};
 return{native:true,language,fields:[],counts:{total:0,done:0,failed:0,pending:0,missing:0},display,text:(_id,source)=>display(source),sourceLabel:source=>String(source??''),translation,state:(_id,source)=>translation(source),quote:source=>`Original: ${source}\nTranslation: ${translated(source)}`,value:englishValue,ruleLabel:(id,source)=>projection.rules.find(r=>r.id===id)?.title||display(source||id)};
}
