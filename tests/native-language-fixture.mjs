import {bilingualHashes,reviewBilingualMaterial} from '../server/native-language-materials.mjs';
export function syntheticMaterial(kind='rule',id=`SYNTHETIC-${kind}`){
  return {id,version:'V1.0',scene:'新品产品咨询',kind,semanticRevision:'synthetic-1',shared:{applicabilityIds:[],exceptionIds:[],parameterRefs:['sampleLimit'],dependencyIds:[]},locales:{zh:{title:'合成验收材料',scope:'仅供验收，不是业务口径。'},en:{title:'Synthetic acceptance material',scope:'Acceptance only; not a business criterion.'}},clauses:[{clauseId:'sample-1',kind:'instruction',locales:{zh:'合成参数 {{sampleLimit}}，仅测试语言合同。',en:'Synthetic parameter {{sampleLimit}}, for language contract testing only.'}}]};
}
export function approvedMaterial(kind,id){const m=syntheticMaterial(kind,id);return reviewBilingualMaterial(m,{reviewer:'synthetic-business-reviewer',reason:'Synthetic bilingual acceptance fixture, not approval of production criteria.',confirmedLanguages:['zh','en'],expectedHashes:bilingualHashes(m),at:'2026-11-25T01:00:00Z'});}
export const nativePolicy=language=>({schemaVersion:1,mode:'native-v1',contentLanguage:language,uiLanguagePolicy:'locked-to-content',initializedAt:'2026-11-25T01:00:00Z',initializedBy:'synthetic-operator',initializationId:'synthetic-init',historyClassification:'new-workspace'});
export const syntheticMaterials=()=>['rule','prompt','glossary'].map(kind=>approvedMaterial(kind));
