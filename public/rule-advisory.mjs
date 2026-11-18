import {getLocale} from './i18n.mjs';

// Deliberately match complete format-oriented labels, rather than report words
// inside conversation requirements. IDs, criteria and scope are not inspected.
const chineseFormat=/^(?:(?:html|markdown|pdf|excel|word|json|csv))?(?:(?:质检|检核|检查|审核)?报告(?:输出)?(?:结构|格式|模板|排版)|(?:质检|检核|检查|审核)(?:结果)?明细表(?:输出|格式|结构)|输出格式)(?:要求|规范|规则|标准|检查)?$/u;
const englishFormat=/^(?:(?:html|markdown|pdf|excel|word|json|csv) )?(?:(?:(?:inspection|audit|quality inspection) )?report (?:output )?(?:structure|format(?:ting)?|layout|template)|(?:(?:inspection|audit|check|quality inspection) )?details? (?:table|sheet) (?:output|format(?:ting)?|structure)|output format(?:ting)?)(?: (?:requirements?|specification|standard|rules?|checks?))?$/u;
const explicitFormat=value=>{
  if(typeof value!=='string')return false;
  const label=value.normalize('NFKC').trim().toLowerCase().replace(/[-_\s]+/gu,' ');
  return chineseFormat.test(label.replace(/\s+/gu,''))||englishFormat.test(label);
};

/** Advisory display only: never modifies eligibility, selection or rule data. */
export function ruleAdvisory(rule){
  if(!explicitFormat(rule?.title)&&!explicitFormat(rule?.category))return '';
  return getLocale()==='en'
    ?'This rule may not apply to an individual conversation (for example, output formatting or report structure). Please confirm whether to include it in conversation quality inspection.'
    :'该规则疑似不作用于单条会话（如输出格式、报告结构类要求），请确认是否纳入会话质检';
}
