import {groupEvidenceQuotes} from './evidence-display.mjs';
import {getLocale} from './i18n.mjs';
import {d} from './content-translation-ui.mjs';
import {e} from './ui.mjs';
export function groupedEvidenceView(session,results,rules=[]){
 const groups=groupEvidenceQuotes(session,results),en=getLocale()==='en';if(!groups.length)return '';
 return `<details class="grouped-review-evidence"><summary>${en?'Grouped original evidence':'原文证据汇总'} · ${groups.length}</summary>${groups.map((group,index)=>`<article class="grouped-evidence-item" data-evidence-group="${index+1}"><strong>${en?'Quote':'引文'} ${index+1} · ${e(en?group.englishLabel:group.label)}</strong><blockquote class="original-source" data-business-original>${e(group.quote)}</blockquote><small>${en?'Covered rules':'覆盖规则'}: ${group.ruleIds.map(id=>e(d(rules.find(rule=>rule.id===id)?.title||id))).join(' · ')}</small>${group.status==='unverified'?`<small>${en?'Source location unverified; check the original':'来源位置未核验，请核对原文'}</small>`:''}</article>`).join('')}</details>`;
}
export function ruleEvidenceReference(session,results,ruleId){
 const ids=groupEvidenceQuotes(session,results).flatMap((group,index)=>group.ruleIds.includes(ruleId)?[index+1]:[]);if(!ids.length)return '';
 return `<small class="grouped-evidence-reference">${getLocale()==='en'?'Grouped evidence quotes':'汇总证据引文'}: ${ids.join(', ')}</small>`;
}
