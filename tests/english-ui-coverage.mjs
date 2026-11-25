// Release requirement 37C. Every entry must produce a nonempty real DOM view.
// Fixtures are synthetic; these names are a persistent, reviewable release inventory.
export const REQUIRED_ENGLISH_VIEWS = Object.freeze([
  'overview','tasks','task-detail-execution','execution-page-first','execution-page-next',
  'review-failed','review-pagination-first','review-pagination-next','review-rereview',
  'rules','rule-dialog','configuration-list','configuration-rules','configuration-auxiliary','configuration-delivery','configuration-ai-draft',
  'catalog-draft-editor','policies','policy-dialog','policy-section-titles',
  'audit-export','management-export','business-export','business-export-history','business-export-node-detail',
  'workflow-original-ai-output','workflow-pagination','english-translation','english-translation-failure',
  'model-settings','backup-export','backup-restore-preview','backup-restore-error',
  'wizard-step-1-scene','wizard-step-2-upload','wizard-step-3-settings','wizard-step-4-detail',
  'wizard-ec-step-3-settings','startup-current-recovered','startup-upgrade-failed','startup-retention-warning',
  'import-drafts-empty','import-drafts-existing','rule-import-ai-draft',
]);

// Only field values are exempted. Labels, placeholders, titles and aria-labels
// remain checked even inside Original/source areas. Never exempt textarea/pre.
export function scanEnglishDom({rootSelector='body'}={}) {
  const cjk=/[\u3400-\u9fff]/u, root=document.querySelector(rootSelector), findings=[], originals=[];
  if(!root)throw Error('English scan root missing: '+rootSelector);
  const visible=el=>el.matches('option,optgroup')?visible(el.closest('select')):el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const describe=el=>({tag:el.tagName,id:el.id||'',className:typeof el.className==='string'?el.className:''});
  const sourceValue=(el,attribute)=>{
    if(!['text','value'].includes(attribute))return false;
    // Explicit application source markers apply to their own value, not descendants.
    if(el.matches('[data-business-original]'))return true;
    // Editable business report names and canonical output enums remain source
    // data; exempt these exact value paths, never their labels or placeholders.
    if(attribute==='value'&&/^template\.(?:title|sections\.\d+\.title|columnGroups\.\d+\.label|columns\.\d+\.(?:label|enum))$/.test(el.getAttribute('data-scfg-path')||''))return true;
    // Editable AI candidates are genuine source fields inside the explicit audit.
    return attribute==='value'&&el.closest('[data-dialog-disclosure="admin-draft-original"]')&&(el.matches('[data-candidate-key]')||/^ruleCandidates\.\d+\.(?:title|category|scope|passCriteria|failCriteria|exceptionCriteria)$/.test(el.getAttribute('data-scfg-path')||''));
  };
  for(const el of [root,...root.querySelectorAll('*')]) {
    if(!visible(el)||el.matches('script,style'))continue;
    const ownText=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim();
    const entries=[['text',ownText],...['aria-label','title','placeholder','alt','aria-description'].map(a=>[a,el.getAttribute(a)||''])];
    if(el.matches('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea'))entries.push(['value',el.value]);
    for(const [attribute,text] of entries)if(cjk.test(text)){
      const record={...describe(el),attribute,text};
      (sourceValue(el,attribute)?originals:findings).push(record);
    }
  }
  return {findings,originals,elements:root.querySelectorAll('*').length,headings:[...root.querySelectorAll('h1,h2,h3')].map(el=>el.textContent)};
}
