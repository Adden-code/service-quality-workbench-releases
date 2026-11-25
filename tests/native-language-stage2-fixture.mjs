import {defaultScenePackage,resolveSceneRuntime} from '../public/scene-configuration.mjs';
import {nativePromptDraft} from '../server/native-language-prompt-draft.mjs';
import {bilingualHashes,reviewBilingualMaterial,freezeNativeLanguage,freezeTaskLanguageContract,languageHash} from '../server/native-language-materials.mjs';
import {nativeSourceConfiguration,nativeExecutionContext} from '../server/native-language-execution.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {nativePolicy,syntheticMaterial} from './native-language-fixture.mjs';
export const config={model:'synthetic-native',baseUrl:'http://127.0.0.1:9/v1',authMode:'none',configured:true,connectionTested:true};
export function reviewed(m){return reviewBilingualMaterial(m,{reviewer:'SYNTHETIC TEST REVIEWER',reason:'Synthetic fixtures only; this is NOT business approval of any production material.',confirmedLanguages:['zh','en'],expectedHashes:bilingualHashes(m),at:'2026-11-25T01:00:00Z'});}
function material(kind,id,clauses,source){const m=syntheticMaterial(kind,id);m.shared.parameterRefs=[];m.clauses=clauses.map(([clauseId,zh,en])=>({clauseId,kind:'instruction',locales:{zh,en}}));if(source)m.sourceHash=languageHash(source);return m;}
export function materialSet(basis,snapshot){
 const out=[nativePromptDraft(),material('glossary','NP-GLOSSARY',[['terms','符合=PASS；不符合=FAIL；无法判定=UNKNOWN；不适用=NA。','PASS=compliant; FAIL=non-compliant; UNKNOWN=insufficient evidence; NA=not applicable.']]),material('policy','NATIVE-CONFIG',[['configuration','合成配置，仅测试。','Synthetic configuration, for testing only.']],nativeSourceConfiguration(snapshot))];
 for(const r of basis.rules)out.push(material('rule',r.id,[['pass',r.passCriteria,'The agent answers the specific customer request.'],['fail',r.failCriteria,'The agent does not answer the specific customer request.'],['exception',r.exceptionCriteria,'Use UNKNOWN if the required evidence is unavailable; use NA only for a supported exception.']],r));
 for(const p of basis.policies)out.push({...material('policy',p.id,p.sections.map(s=>[s.id,s.text,'Synthetic source policy: answer the customer request using the supplied information.']),p),version:p.version});
 for(const m of out.filter(m=>m.kind==='rule'))m.version=basis.rules.find(r=>r.id===m.id).version;
 if(snapshot.taxonomy)out.push(material('taxonomy',snapshot.taxonomy.id,[...snapshot.taxonomy.labels.flatMap(l=>[[l.id,l.label,l.parentId?'Product feature inquiry':'Before purchase'],...(l.definition?[['definition-'+l.id,l.definition,'The customer asks about the product before purchase.']]:[])]),...(snapshot.taxonomy.principles||[]).map((p,i)=>['principle-'+(i+1),p,'Select the main customer concern using the supplied categories.']),...(snapshot.taxonomy.examples||[]).map((e,i)=>['example-'+(i+1),e.translated||e.original,e.labelId+': The customer asks about a product feature.'])],snapshot.taxonomy));
 for(const table of snapshot.exceptions||[])out.push(material('exception',table.id,table.entries.map(e=>[e.id,e.condition,'The customer requests a specific product without asking for comparisons.']),table));
 return out.map(reviewed);
}
export function fixture(language='en'){
 const basis={capturedAt:'2026-11-25T01:00:00Z',effectiveDate:'2026-11-25',rules:[{id:'NP-SYNTHETIC',version:'V1.0',title:'合成规则',scope:'合成场景',passCriteria:'回答合成问题。',failCriteria:'未回答合成问题。',exceptionCriteria:'依据不足无法判定。',policyIds:['NP-SYNTHETIC-POLICY']}],policies:[{id:'NP-SYNTHETIC-POLICY',version:'V1.0',title:'合成资料',sections:[{id:'source',text:'回答合成问题，仅验收用。'}]}]};
 const p=defaultScenePackage({id:'新品产品咨询',name:'Synthetic NP',engine:'conversation',basis});
 const c=p.configuration;c.executionMode='configured';c.inspectionLanguage=language;c.capabilities=[{key:'demandSummary',phase:'pre',dependsOn:[]}];c.ruleDependencies={'NP-SYNTHETIC':['demandSummary']};
 const snapshot={configuration:c,runtime:resolveSceneRuntime(c,{outputLanguages:[language]},'Synthetic language test'),taxonomy:null,exceptions:[],basis};
 const materials=materialSet(basis,snapshot),frozen=freezeNativeLanguage(nativePolicy(language),{materials,promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});
 const task=freezeTaskLanguageContract({id:'SYNTHETIC-TASK',scene:'新品产品咨询',basisSnapshot:basis,executionSnapshot:snapshot},nativePolicy(language),frozen);
 const session={id:'SYNTHETIC-1',scene:'新品产品咨询',product:'Synthetic Phone',reviewPolicy:{enabled:true},turns:[{id:1,role:'customer',text:'هل توجد نسخة زرقاء؟'},{id:2,role:'agent',text:'Sí, existe una versión azul.'}]};
 return{task,basis,snapshot:task.executionSnapshot,session,materials,frozen,context:nativeExecutionContext(task,frozen)};
}
export function modelEnvelope(value){return new Response(JSON.stringify({id:'synthetic-response',model:config.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}),{status:200,headers:{'content-type':'application/json'}});}
export function capabilityBody(data,language='en'){
 const quote=data.blocks[0];const reason=language==='en'?'The customer asks for specific product information.':'用户询问具体产品信息。';
 return{status:'completed',value:data.capability==='intent'?{labelId:data.taxonomy.labels.find(l=>l.parentId).id}:data.capability==='negativeVoice'?{hasNegative:false,text:reason}:{text:reason},reason,confidence:'0.95',evidence:[{blockId:quote.id,quote:quote.text,start:'900',end:'999'}]};
}
export function ruleBody(data,language='en'){
 const raw=Boolean(data.record),session=data.session||data,turn=session.turns?.[1];
 return{...(data.record?{recordId:data.record.recordId}:{}),results:data.basis.rules.map(r=>({ruleId:r.id,verdict:'PASS',reason:language==='en'?'The agent provides the information requested by the customer.':'坐席提供了用户所询问的具体信息。',confidence:'0.96',conflictsWith:[],referenceIds:r.policyIds.map(id=>data.basis.policies.find(p=>p.id===id).sections[0].referenceKey),...(raw?{turnRefs:[],evidenceQuotes:[{quote:data.record.text}]}:{evidence:[turn.id],evidenceQuotes:[{turnId:turn.id,role:turn.role,quote:turn.text}]})}))};
}
