import {createHash} from 'node:crypto';
import {fixture,materialSet,reviewed,modelEnvelope} from './native-language-stage2-fixture.mjs';
import {syntheticMaterial,nativePolicy} from './native-language-fixture.mjs';
import {nativeReportPromptDraft} from '../server/native-language-prompt-draft.mjs';
import {freezeNativeLanguage,freezeTaskLanguageContract,languageHash} from '../server/native-language-materials.mjs';
import {nativeExecutionContext,assureNativeResults,nativeAssurance} from '../server/native-language-execution.mjs';
import {NATIVE_LANGUAGE_VALIDATOR} from '../public/native-language-validation.mjs';
import {defaultScenePackage} from '../public/scene-configuration.mjs';
import {workbook} from '../public/io.mjs';
export {modelEnvelope};
export async function stage3Fixture(language='en'){
 const f=fixture(language),basis=structuredClone(f.basis);basis.rules[0].category='合成检查';
 const pkg=defaultScenePackage({id:'新品产品咨询',name:'Synthetic NP',engine:'conversation',basis});
 const snapshot={...structuredClone(f.snapshot),template:pkg.template};delete snapshot.languageExecution;delete snapshot.languageMaterialRef;snapshot.configuration.basis=basis;
 snapshot.configuration.ruleBindings=[{ruleId:'NP-SYNTHETIC',ruleVersion:'V1.0'}];pkg.template.columnGroups=[{id:'synthetic',label:'合成检查',parentId:''}];pkg.template.columns.splice(6,0,{id:'check',label:'合成规则',field:'',generator:'rule',ruleId:'NP-SYNTHETIC',ruleVersion:'V1.0',groupId:'synthetic',enum:['Pass','Fail','NA'],visible:true,condition:null});
 const material=syntheticMaterial('template',pkg.template.id);material.shared.parameterRefs=[];material.sourceHash=languageHash(pkg.template);material.clauses=[['title',pkg.template.title,'Synthetic consultation quality report'],...pkg.template.sections.map(s=>['section.'+s.key,s.title,({overview:'Quality overview',dimensions:'Check results',cases:'Case studies',improvements:'Failure causes and improvements',voc:'Customer voice'})[s.key]||'Quality analysis']),...pkg.template.columnGroups.map(g=>['group.'+g.id,g.label,'Synthetic quality checks']),...pkg.template.columns.map(c=>['column.'+c.id,c.label,c.generator==='rule'?'Synthetic check':({translation:'Conversation translation',overall:'Overall result',failureSummary:'Failure reasons and recommended actions',demandSummary:'Customer request',negativeVoiceFlag:'Negative feedback',negativeVoice:'Original negative feedback',salesStage:'Sales stage',intent:'Customer intent'})[c.field]||'Synthetic '+c.id])].map(([clauseId,zh,en])=>({clauseId,kind:'instruction',locales:{zh,en}}));
 const materials=[...materialSet(basis,snapshot).map(m=>m.kind==='prompt'?reviewed(nativeReportPromptDraft()):m),reviewed(material)];
 const frozen=freezeNativeLanguage(nativePolicy(language),{materials,promptId:'NP-NATIVE-PROMPTS',glossaryId:'NP-GLOSSARY',languageValidatorVersion:NATIVE_LANGUAGE_VALIDATOR});
 const task=freezeTaskLanguageContract({...f.task,name:'Synthetic native delivery',mode:'manual',basisSnapshot:basis,executionSnapshot:snapshot,importMappingSnapshot:{profile:{sheet:'Source',headerRow:1,fields:{id:'ID',agent:'Agent',text:'Conversation'},defaults:{product:'Synthetic Phone'}}}},nativePolicy(language),frozen),context=nativeExecutionContext(task,frozen);
 const sessions=[0,1].map(i=>{const reason=language==='en'?(i?'The agent provides the information requested by the customer.':'The agent does not address the specific customer request.'):(i?'坐席提供了用户询问的具体信息。':'坐席未回应用户提出的具体问题。'),aiResults=assureNativeResults([{ruleId:'NP-SYNTHETIC',verdict:i?'符合':'不符合',reason,evidence:[2],referenceIds:[],confidence:0.95}],context),summary=language==='en'?'The customer asks for specific product information.':'用户询问具体的产品信息。';return{...structuredClone(f.session),id:'SYNTHETIC-'+i,externalId:'S'+i,taskId:task.id,expectedRuleIds:['NP-SYNTHETIC'],aiExecution:{status:'completed',runId:'synthetic-run'},aiResults,review:{status:'已确认',reviewer:'Synthetic reviewer',drafts:Object.fromEntries(aiResults.map(r=>[r.ruleId,structuredClone(r)])),history:[]},sceneCapabilities:{outputs:{demandSummary:{status:'completed',value:{text:summary},reason:summary,evidence:[],languageValidation:nativeAssurance({reason:summary,value:{text:summary}},context,{capability:'demandSummary'})}}}};});
 for(const s of sessions)for(const r of Object.values(s.review.drafts))r.source='manual';
 const bytes=await workbook([{name:'Source',headers:['ID','Agent','Conversation'],rows:sessions.map(s=>[s.externalId,'Synthetic agent',s.turns.map(t=>t.text).join('\n')])}]);task.source={name:'synthetic-stage3.xlsx',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
 return{task,sessions,state:{tasks:[task],sessions},bytes,frozen,context,materials};
}
export function nativeReportAnswer(kind,input,language='en'){
 if(kind==='translation')return{items:input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'mixed',translation:language==='en'?'The customer asks about a blue version. The agent confirms that a blue version is available.':'用户询问蓝色版本是否存在，坐席确认有蓝色版本。',confidence:0.96}))};
 if(kind==='consultationIssues')return{clusters:[{label:language==='en'?'The customer request needs a specific response':'具体诉求未回应',summary:language==='en'?'The agent did not provide the information requested by the customer.':'坐席未提供用户所询问的具体信息。',memberIds:input.records.map(r=>r.id),action:language==='en'?'The agent should address the specific product request before closing the conversation.':'坐席应在结束会话前回应用户的具体产品诉求。'}]};
 if(kind==='caseHighlights')return{cases:input.candidates.slice(0,input.limit).map(c=>({id:c.id,score:'5',commentary:language==='en'?'The agent provides specific information that answers the customer request.':'坐席提供具体信息，回应了用户提出的问题。',quote:c.reply}))};
 throw new Error('Unexpected synthetic report kind: '+kind);
}
