import {hasReportClusterPolicy,reportClusterView,reportClusterTextParts} from './report-issue-clusters.mjs';
import {nativeReportLanguage,createNativeReportLocale} from './native-report-locale.mjs';
import {selectConsultationCaseExcerpts} from './consultation-excerpts.mjs';
import {CONVERSATION_UNVERIFIED,groundedConversationQuote} from './role-evidence.mjs';
import {reusableEnglishBaseTranslation} from './translation-language.mjs';
import {sceneDeliveryRows,sceneDeliveryValue} from './scene-delivery-values.mjs';

const array=value=>Array.isArray(value)?value:[];
const readable=value=>typeof value==='string'&&value.trim();
const fieldHash=value=>{let hash=0xcbf29ce484222325n;for(const char of value)hash=BigInt.asUintN(64,(hash^BigInt(char.codePointAt(0)))*0x100000001b3n);return hash.toString(16).padStart(16,'0');};
export const reportFieldId=(...parts)=>{const value=parts.map(part=>encodeURIComponent(String(part))).join('.');return value.length<=180?value:`${value.slice(0,120)}~${fieldHash(value)}`;};
export const ENGLISH_BUSINESS_RULES=Object.freeze([
 {id:'EC-TIME',label:'Response timeliness',improvement:'Define response deadlines and owners. Track unanswered and near-deadline records against the applicable work calendar.'},
 {id:'EC-TEXT',label:'Text quality',improvement:'Check spelling, grammar, punctuation and meaning before sending. State the issue and the next action clearly.'},
 {id:'EC-TARGET',label:'Relevance and batch repetition',improvement:'Address each specific question or review with a relevant action. Avoid reusing one response across customers.'},
 {id:'EC-STEPS',label:'Step structure',improvement:'Number the required actions in order and describe each action completely.'},
 {id:'EC-PRIVACY',label:'Privacy in public replies',improvement:'Remove personal identifiers from public replies. Use an approved private channel for identity or order checks.'},
].map(value=>Object.freeze(value)));
const fixed=new Map(Object.entries({
 '通过':'Pass','符合':'Pass','Pass':'Pass','pass':'Pass','不通过':'Fail','不符合':'Fail','Fail':'Fail','fail':'Fail',
 '待判定':'Pending','无法判定':'Pending','pending':'Pending','NA':'Not applicable','不适用':'Not applicable','未回复':'Unreplied',
 '好评正向':'Positive review, positive sentiment','好评负向':'Positive review, negative sentiment','中评':'Neutral review','差评':'Negative review','未归类':'Unclassified',
 '原表列':'Original source column','任务默认':'Task default','未提供':'Not provided','客户':'Customer','用户':'Customer','客服':'Agent','坐席':'Agent',
 '正向':'Positive','中性':'Neutral','负向':'Negative','是':'Yes','否':'No','未分类':'Unclassified','未配置分类体系':'Taxonomy not configured',
}));
export const englishReportValue=value=>fixed.get(String(value??''))??String(value??'');
export const reportSentiment=value=>['负向','负面','negative'].includes(String(value??'').toLowerCase())?'negative':['中性','中立','中评','neutral'].includes(String(value??'').toLowerCase())?'neutral':['正向','正面','positive'].includes(String(value??'').toLowerCase())?'positive':'unknown';
export function reportEnglishBaseTranslations(snapshot,enrichment={}){
 const reused=new Map();if(snapshot?.targetLang!=='en')return reused;
 const add=(parts,source,entry)=>{if(!reusableEnglishBaseTranslation(source,entry))return;reused.set(reportFieldId(...parts),{source,text:entry.text,status:entry.status});};
 for(const record of array(snapshot.records)){
  const prefix=['record',record.id],entries=enrichment.translations?.[record.id]||{};
  if(snapshot.deliveryType==='consultation-v1'){add([...prefix,'conversation'],record.conversation,entries.conversation);for(const turn of selectConsultationCaseExcerpts(record))add([...prefix,'turn',turn.id],turn.text,entries[`excerpt-${turn.id}`]);}
  else{add([...prefix,'comment'],record.raw22?.[8],entries.comment);add([...prefix,'reply'],record.raw22?.[9],entries.reply);add([...prefix,'humanIssue'],record.humanIssue,entries.humanIssue);}
 }
 return reused;
}

export function visibleReportClusters(snapshot,enrichment={}){
 const consultation=snapshot?.deliveryType==='consultation-v1';
 if(hasReportClusterPolicy(snapshot))return consultation&&snapshot.scenarioSnapshot&&!snapshot.scenarioSnapshot.builtin&&!array(snapshot.scenarioSnapshot.report?.sections).includes('improvements')?[]:reportClusterView(snapshot,enrichment).issueClusters.map((item,index)=>({item,index}));
 return array(enrichment.issueClusters).map((item,index)=>({item,index})).filter(({item})=>{
  const key=consultation?(item.category||array(snapshot.basis?.rules).find(rule=>rule.id===item.ruleId)?.category||array(snapshot.basis?.dimensions).find(dimension=>dimension.key===item.ruleId)?.key):item.ruleId;
  return (!consultation||!snapshot.scenarioSnapshot||snapshot.scenarioSnapshot.builtin||array(snapshot.scenarioSnapshot.report?.sections).includes('improvements'))&&array(item.memberIds).some(id=>array(snapshot.records).some(record=>record.id===id&&record.replyStatus!=='unreplied'&&array(record.final).some(result=>['Fail','不通过'].includes(result.verdict)&&(consultation?result.category===key:(result.ruleId||result.id)===key))));
 });
}

/** This is an allowlist of text actually displayed by the two report files.
 * Original worksheet values, private metadata, traces, IDs and model settings are never traversed.
 * Header names are collected only for separate Field Guide aliases, never rewritten in the source sheet.
 */
export function collectReportTranslationFields(snapshot,enrichment={}){
 const reused=reportEnglishBaseTranslations(snapshot,enrichment),fields=[],seen=new Set(),add=(parts,text)=>{const id=reportFieldId(...parts);if(readable(text)&&!seen.has(id)&&!reused.has(id)){seen.add(id);fields.push({id,text});}};
 add(['task','name'],snapshot?.taskName);
 if(snapshot?.executionSnapshot){
  const frozen=snapshot.executionSnapshot,t=frozen.template;
  add(['scene','title'],t.title);for(const s of array(t.sections))add(['scene','section',s.key],s.title);
  for(const g of array(t.columnGroups))add(['scene','group',g.id],g.label);
  for(const c of array(t.columns)){add(['scene','column',c.id],c.label);array(c.enum).forEach((x,i)=>add(['scene','column',c.id,'enum',i],x));const parts=[];let g=t.columnGroups.find(g=>g.id===c.groupId);const seen=new Set();while(g&&!seen.has(g.id)){seen.add(g.id);parts.unshift(g.label);g=t.columnGroups.find(x=>x.id===g.parentId);}add(['scene','column',c.id,'groupPath'],parts.join(' / '));}
  for(const label of array(frozen.taxonomy?.labels))add(['scene','label',label.id],label.label);
  for(const site of array(frozen.configuration.timingPolicy?.sites))add(['scene','site',site.id],site.label);
  for(const row of array(snapshot.sceneAudit)){add(['scene','row',row.id,'product'],row.product);add(['scene','row',row.id,'classificationReason'],row.classificationReason);for(const [key,result] of Object.entries(row.capabilities?.outputs||{})){add(['scene','row',row.id,key,'reason'],result.reason);add(['scene','row',row.id,key,'valueReason'],result.value?.reason);if(result.status==='completed'){add(['scene','row',row.id,key,'text'],result.value?.text);add(['scene','row',row.id,key,'label'],result.value?.label);}}for(const r of row.ai||[])add(['scene','row',row.id,r.ruleId,'reason'],r.reason);for(const [id,r] of Object.entries(row.review?.drafts||{}))add(['scene','row',row.id,id,'humanReason'],r.reason);}
  // Collect the exact strings the configured workbook renders, including composed
  // failure summaries and hidden sibling columns retained in All business columns.
  if(array(snapshot.sceneAudit).length)for(const row of sceneDeliveryRows(snapshot))for(const column of array(t.columns)){
   if(column.generator==='rule'||['translation','commentTranslation','replyTranslation'].includes(column.field))continue;
   add(['scene','row',row.record.id,'column',column.id],sceneDeliveryValue(row,column,snapshot,enrichment));
  }
 }

 const consultation=snapshot?.deliveryType==='consultation-v1',basis=snapshot?.basis??{},scenario=snapshot?.scenarioSnapshot;
 const custom=Boolean(scenario&&!scenario.builtin),analysisFields=custom?array(scenario.analysisFields):['salesStage','intent','demandSummary','negativeVoice'];
 const sections=custom?array(scenario.report?.sections):['overview','breakdown','dimensions','cases','improvements','voc'];
 const customFields=custom?array(scenario.customFields):[];
 array(consultation?snapshot?.original?.headers:snapshot?.headers22).forEach((header,index)=>add(['source','header',index],header));
 if(!consultation)array(snapshot?.extensions?.headers).forEach((header,index)=>add(['source','extension','header',index],header));
 array(snapshot?.original?.additionalSheets).forEach((sheet,index)=>array(sheet.headers).forEach((header,column)=>add(['source','extra',index,'header',column],header)));
 if(consultation){
  for(const rule of array(basis.rules)){add(['rule',rule.id,'label'],rule.title||rule.name);add(['rule',rule.id,'category'],rule.category);}
  for(const dimension of array(basis.dimensions))add(['dimension',dimension.key,'label'],dimension.label||dimension.key);
  for(const policy of array(basis.policies))add(['policy',policy.id,'title'],policy.title||policy.name);
  if(custom){add(['scenario','name'],scenario.name);add(['scenario','report','title'],scenario.report?.title);add(['scenario','report','groupLabel'],scenario.report?.groupLabel);for(const field of customFields)add(['scenario','field',field.id,'label'],field.label);}
 }else{
  for(const key of ['phaseLabel','timeModeLabel'])add(['basis',key],basis[key]);
  for(const key of ['samplingPeriods','regionGroups','regions','countries','reportRegions'])array(basis[key]).forEach((text,index)=>add(['basis',key,index],text));
 }
 for(const record of array(snapshot?.records)){
  const prefix=['record',record.id];
  add([...prefix,'summary'],record.summary);
  if(consultation){
   add([...prefix,'product'],record.product);if(custom)add([...prefix,'group'],record.groupValue);
   add([...prefix,'conversation'],record.conversation);
   if(sections.includes('cases'))for(const turn of selectConsultationCaseExcerpts(record))add([...prefix,'turn',turn.id],turn.text);
  }else{add([...prefix,'comment'],record.raw22?.[8]);add([...prefix,'reply'],record.raw22?.[9]);add([...prefix,'humanIssue'],record.humanIssue);}
  for(const group of ['ai','historical','confirmed','final'])for(const item of array(record[group])){
   // Full reasons are visible in the Judgment Trail, including valid historical references.
   add([...prefix,group,item.ruleId||item.id,'reason'],item.reason);
   if(consultation){add([...prefix,group,item.ruleId||item.id,'label'],item.label);add([...prefix,group,item.ruleId||item.id,'category'],item.category);}
  }
  if(consultation){
   const analysis=enrichment.consultationAnalysis?.[record.id];
   if(analysis?.status==='completed'){
    if(analysisFields.includes('salesStage'))for(const key of ['salesStage','salesSubstage'])add([...prefix,'analysis',key],analysis[key]);
    if(analysisFields.includes('intent')&&analysis.intentLabel!=='未配置分类体系')add([...prefix,'analysis','intentLabel'],analysis.intentLabel);
    if(analysisFields.includes('demandSummary'))add([...prefix,'analysis','demandSummary'],analysis.demandSummary);
    const inVocScope=sections.includes('voc')&&['negative','neutral'].includes(reportSentiment(analysis.sentiment));
    if(analysisFields.includes('negativeVoice')||inVocScope)array(analysis.negativeVoices).forEach((voice,index)=>{if(groundedReportQuote(record,voice.quote,voice.turnId,snapshot.roleEvidenceMode))add([...prefix,'analysis','negativeVoice',index],voice.quote);});
    if(inVocScope)for(const key of ['scene','painPoint','reason','evidenceQuote']){const text=analysis.voc?.[key];if(key!=='evidenceQuote'||groundedReportQuote(record,text,undefined,snapshot.roleEvidenceMode))add([...prefix,'analysis','voc',key],text);}
   }
   const entry=enrichment.scenarioFields?.[record.id];
   if(entry?.status==='completed')for(const field of customFields){const item=array(entry.fields).find(item=>item.id===field.id);if(item&&!item.missing&&(field.type!=='quote'||groundedReportQuote(record,item.value,item.turnId)))add([...prefix,'field',field.id],item.value);}
  }
 }
 if(sections.includes('cases'))array(enrichment.excellentCases).forEach((item,index)=>{const record=array(snapshot?.records).find(record=>record.id===item.id);if(!record)return;add(['excellent',index,'commentary'],item.commentary);if(readable(item.quote)&&(record.raw22?.[9]?.includes(item.quote)||record.conversation?.includes(item.quote)||array(record.turns).some(turn=>turn.text?.includes(item.quote))))add(['excellent',index,'quote'],item.quote);});
 if(!consultation){
  array(enrichment.vocItems).forEach((item,index)=>{if(!array(snapshot?.records).some(record=>record.id===item.id))return;for(const key of ['scene','painPoint','reason','evidenceQuote'])add(['voc',index,key],item[key]);});
 }
 if(!consultation||sections.includes('improvements'))visibleReportClusters(snapshot,enrichment).forEach(({item,index})=>{for(const key of ['label','summary','action'])add(['cluster',index,key],item[key]);for(const [key,plural]of[['summary','summaries'],['action','actions']]){array(item[plural]).forEach((part,partIndex)=>add(['cluster',index,key,'part',partIndex],part));add(['cluster',index,key,'joined'],array(item[plural]).join('\n'));}if(hasReportClusterPolicy(snapshot)){add(['cluster',index,'primaryLabel'],item.primaryLabel);for(const key of ['summary','action'])reportClusterTextParts(item,key).forEach((part,partIndex)=>add(['cluster',index,key,'part',partIndex],part));}});
 return fields;
}

export function groundedReportQuote(record,quote,turnId,mode){return record?.inputMode==='raw-transcript-v1'?groundedConversationQuote(record,quote):mode===CONVERSATION_UNVERIFIED?groundedConversationQuote(record,quote,turnId):Boolean(readable(quote)&&array(record?.turns).some(turn=>['客户','用户','customer','user'].includes(String(turn.role??'').toLowerCase())&&(turnId===undefined||String(turn.id)===String(turnId))&&String(turn.text??'').includes(quote)));}

export function createReportLocale(snapshot,enrichment={},options={}){
 if(nativeReportLanguage(snapshot))return createNativeReportLocale(snapshot,enrichment,{englishValue:englishReportValue});
 const language=options.language==='en'?'en':'zh',fields=collectReportTranslationFields(snapshot,enrichment),byId=new Map(fields.map(field=>[field.id,field])),byText=new Map(),entries=new Map(),reused=reportEnglishBaseTranslations(snapshot,enrichment),reusedByText=new Map();
 for(const value of reused.values())if(!reusedByText.has(value.source))reusedByText.set(value.source,value);
 for(const field of fields){if(!byText.has(field.text))byText.set(field.text,[]);byText.get(field.text).push(field.id);}
 // A translation from another language or an unknown field can never become an English report value.
 if(!options.translationJob?.targetLang||options.translationJob.targetLang==='en')for(const entry of array(options.translations)){const field=byId.get(entry?.id);if(field&&entry.sourceText===field.text&&!entries.has(entry.id))entries.set(entry.id,entry);}
 // Content-job result envelopes historically omit detectedLanguage. An exact,
 // source-bound same result still passes the shared Latin-source check.
 const state=(id,source)=>{const reusedValue=reused.get(id);if(reusedValue?.source===source)return reusedValue;const field=byId.get(id),entry=entries.get(id);if(!field||field.text!==source)return{status:'missing',text:''};const checked=entry?.status==='same'&&entry.detectedLanguage===undefined?{...entry,detectedLanguage:'en'}:entry;if(reusableEnglishBaseTranslation(source,checked))return{status:entry.status,text:entry.status==='same'?source:entry.text};return{status:entry?.status==='failed'?'failed':entry?.status==='pending'?'pending':'missing',text:''};};
 const lookup=source=>{const ids=byText.get(source)||[];return ids.map(id=>state(id,source)).find(value=>['same','translated'].includes(value.status))||reusedByText.get(source)||ids.map(id=>state(id,source)).find(value=>value.status==='failed')||ids.map(id=>state(id,source)).find(value=>value.status==='pending')||{status:'missing',text:''};};
 const fallback=value=>`[Untranslated: ${value.status==='failed'?'translation failed':value.status==='pending'?'translation pending':'English translation unavailable'}]`;
 const text=(id,source)=>{source=String(source??'');if(language==='zh'||!source.trim())return source;const value=state(id,source);return value.text||fallback(value,source);};
 const display=source=>{source=String(source??'');if(language==='zh'||!source.trim())return source;const value=lookup(source);return value.text||fallback(value,source);};
 const sourceLabel=source=>{source=String(source??'');if(language==='zh'||!source.trim())return source;const value=lookup(source);return value.text?value.text===source?source:`${value.text} [Original: ${source}]`:`[Original: ${source}]`;};
 const quote=source=>{source=String(source??'');if(!source.trim())return'Original: [empty]\nEnglish translation: [not applicable]';return`Original: ${source}\nEnglish translation: ${display(source)}`;};
 const counts={total:fields.length,done:0,failed:0,pending:0,missing:0};for(const field of fields){const value=state(field.id,field.text);if(['same','translated'].includes(value.status))counts.done++;else counts[value.status]++;}
 return{language,fields,text,display,sourceLabel,quote,state,translation:source=>lookup(String(source??'')),counts,value:englishReportValue,ruleLabel:(id,source)=>{if(language==='zh')return String(source||id);const builtin=ENGLISH_BUSINESS_RULES.find(rule=>rule.id===id)?.label;if(builtin)return builtin;const value=lookup(String(source||id));return value.text||`${id} · ${fallback(value,String(source||id))}`;}};
}
