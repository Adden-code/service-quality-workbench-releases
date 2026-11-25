import {collectReportTranslationFields} from './report-locale.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Derived audit only. Full source conversations and worksheet columns stay in
 * their existing Original sheets; model text is never written back to storage. */
export function reportOriginalAuditRows(snapshot,enrichment={}){
 const rows=collectReportTranslationFields(snapshot,enrichment).filter(field=>
  /^(excellent|cluster|voc)\./.test(field.id)||
  /^record\./.test(field.id)&&!(/\.(conversation|comment|reply|humanIssue|product|group)$/.test(field.id)||/\.turn\./.test(field.id))||
  /^scene\.row\./.test(field.id)&&!field.id.endsWith('.product')
 ).map(field=>[field.id,field.text]);
 for(const [id,fields]of Object.entries(enrichment.translations||{}))for(const [key,item]of Object.entries(fields))if(typeof item?.text==='string'&&item.text.trim())rows.push([`savedTranslation.${id}.${key}`,item.text]);
 for(const [index,warning]of (enrichment.warnings||[]).entries())rows.push([`warning.${index}`,typeof warning==='string'?warning:String(warning.message||warning.error||warning.kind||'')]);
 return rows;
}
export function reportOriginalAuditHtml(snapshot,enrichment={}){
 // Translation copies of full source conversations are retained in Excel only.
 const rows=reportOriginalAuditRows(snapshot,enrichment).filter(([id])=>!id.startsWith('savedTranslation.'));
 return rows.length?`<details class="original-ai-audit" data-original-ai-audit><summary>Original AI and judgment text — audit only</summary><p>Saved source-language text is retained for comparison. The report body uses English translations or an explicit translation status.</p><table><thead><tr><th>Saved field</th><th>Original text</th></tr></thead><tbody>${rows.map(([id,text])=>`<tr><td>${escape(id)}</td><td>${escape(text)}</td></tr>`).join('')}</tbody></table></details>`:'';
}
export const reportOriginalAuditSheet=(snapshot,enrichment={})=>({name:'Original AI Audit',headers:['Saved field','Original AI / judgment text'],rows:reportOriginalAuditRows(snapshot,enrichment)});
