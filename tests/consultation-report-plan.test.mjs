import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REPORT_ENRICHMENT_PROMPT_VERSION,prepareReportEnrichment} from '../server/report-enrichment.mjs';
import {selectConsultationCaseExcerpts} from '../public/consultation-excerpts.mjs';
const url=new URL('../server/consultation-report-plan.mjs',import.meta.url);
async function api(){assert.ok(existsSync(url),'missing consultation report plan');return import(url);}
const clone=value=>structuredClone(value);
const taxonomy=[{id:'INTENT',version:'V1',title:'用户意图分类体系',category:'分类体系',sections:[{id:'usage',title:'使用咨询',text:'了解产品使用方法。'}]}];
const makeRecord=(id,{failed=true,conversation,turns}={})=>({id,externalId:id,sourceRows:[Number(id.replace(/\D/g,''))||2],conversation:conversation??'客户：想了解产品如何使用。\n客服：请看说明。',turns:turns??[{id:1,role:'客户',text:'想了解产品如何使用。',speaker:'合成客户',at:''},{id:2,role:'客服',text:'请看说明。',speaker:'合成客服',at:''}],finalOverall:failed?'不通过':'通过',final:[{id:'UNRELATED-CODE',ruleId:'UNRELATED-CODE',label:'需求承接',category:'真实类别甲',verdict:failed?'Fail':'Pass',reason:failed?'未具体回应用户问题。':'已具体回应。',evidence:[2]}],timeFacts:[]});
const fixture=(records=[makeRecord('r1')])=>({schemaVersion:1,deliveryType:'consultation-v1',taskId:'task',targetLang:'zh',createdAt:'2026-11-04T12:00:00Z',basis:{dimensions:[{key:'真实类别甲',label:'真实类别甲',ruleIds:['UNRELATED-CODE']}],rules:[{id:'UNRELATED-CODE',category:'真实类别甲'}],policies:clone(taxonomy)},records});
const jobFor=prepared=>({id:'synthetic-job',status:'completed',updatedAt:'2026-11-04T13:00:00Z',units:clone(prepared.units)});
function translationOutputs(prepared,job,{same=false}={}){
 const outputs=new Map();for(const unit of job.units)if(unit.kind==='translation'){unit.status='completed';outputs.set(unit.id,{items:unit.itemIds.map(id=>({id,translation:same?prepared.translations.get(id).text:`译文:${prepared.translations.get(id).text}`,isTargetLanguage:same,detectedLanguage:same?'zh':'en'}))});}return outputs;
}
const analysisResult=(id,sentiment='中性')=>({id,salesStage:'售前',salesSubstage:'产品使用',intentLabel:'使用咨询',intentReferenceId:'INTENT@V1#usage',demandSummary:'了解使用方式。',sentiment,negativeVoices:sentiment==='负向'?[{turnId:1,quote:'想了解'}]:[],voc:{valid:['中性','负向'].includes(sentiment),scene:['中性','负向'].includes(sentiment)?'其他':'其他',painPoint:['中性','负向'].includes(sentiment)?'了解使用方式。':'',reason:'按真实客户原文辅助分析。',evidenceQuote:['中性','负向'].includes(sentiment)?'想了解':''}});

test('consultation planner exposes plan input and merge interfaces',async()=>{const value=await api();for(const key of ['planConsultationReport','consultationInputFor','mergeConsultationReport'])assert.equal(typeof value[key],'function');});

test('plan translates full conversations and selected case excerpts with exact deduplication and one item per node',async()=>{
 const {planConsultationReport,consultationInputFor}=await api(),s=fixture([makeRecord('r1'),makeRecord('r2')]),before=JSON.stringify(s),p=planConsultationReport(s,'model-a');
 assert.equal(JSON.stringify(s),before);assert.equal(p.translations.size,3);
 const conversation=[...p.translations.values()].find(value=>value.text===s.records[0].conversation);assert.equal(conversation.refs.filter(ref=>ref.field==='conversation').length,2);
 for(const record of s.records)for(const turn of selectConsultationCaseExcerpts(record)){assert.ok([...p.translations.values()].some(item=>item.text===turn.text&&item.refs.some(ref=>ref.recordId===record.id&&ref.field===`excerpt-${turn.id}`)));}
 for(const [index,unit]of p.units.entries()){assert.equal(unit.id,`n${index+1}`);assert.equal(unit.status,'pending');assert.equal(unit.attempts,0);assert.deepEqual(unit.history,[]);if(unit.kind==='translation'){assert.equal(unit.itemIds.length,1);assert.equal(consultationInputFor(s,unit,p).items.length,1);}}
});

test('translation cache keys are stable and isolated from the old ecommerce prompt, language and model settings',async()=>{
 const {planConsultationReport}=await api(),s=fixture([makeRecord('r1',{failed:false,conversation:'exact text'})]);
 const item=planConsultationReport(s,'model-a').translations.values().next().value,same=planConsultationReport(clone(s),'model-a').translations.values().next().value;
 assert.equal(item.key,same.key);assert.match(item.key,/^[a-f0-9]{64}$/);assert.equal(item.text,'exact text');
 const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
 const old=createHash('sha256').update(canonical({text:item.text,targetLang:'zh',model:'model-a',prompt:REPORT_ENRICHMENT_PROMPT_VERSION})).digest('hex');assert.notEqual(item.key,old);
 assert.notEqual(item.key,planConsultationReport(s,'model-b').translations.values().next().value.key);s.targetLang='en';assert.notEqual(item.key,planConsultationReport(s,'model-a').translations.values().next().value.key);
});

test('long conversations split without lost UTF16 units or broken surrogate pairs and retain zero-based field ordering',async()=>{
 const {planConsultationReport}=await api(),original='a'.repeat(17999)+'🙂'+'b'.repeat(22000),s=fixture([makeRecord('r1',{failed:false,conversation:original})]),p=planConsultationReport(s,'model');
 const parts=[...p.translations.values()].flatMap(item=>item.refs.filter(ref=>ref.field==='conversation').map(ref=>({text:item.text,...ref}))).sort((a,b)=>a.partIndex-b.partIndex);
 assert.ok(parts.length>1);assert.equal(parts.map(part=>part.text).join(''),original);assert.deepEqual(parts.map(part=>part.partIndex),parts.map((_,i)=>i));
 for(const part of parts){assert.ok(part.text.length<=18000);assert.equal(part.partCount,parts.length);assert.ok(!/^[\uDC00-\uDFFF]/.test(part.text));assert.ok(!/[\uD800-\uDBFF]$/.test(part.text));}
});

test('whitespace-only segments are preserved locally and never dispatched to a translation contract that rejects them',async()=>{
 const {planConsultationReport,consultationInputFor,mergeConsultationReport}=await api(),original='x'.repeat(18000)+' '.repeat(36000)+'末段',s=fixture([makeRecord('r1',{failed:false,conversation:original})]),p=planConsultationReport(s,'model'),j=jobFor(p);
 const translationUnits=p.units.filter(unit=>unit.kind==='translation');
 for(const unit of translationUnits){const input=consultationInputFor(s,unit,p);assert.ok(input.items[0].text.trim(),'blank fragments must not reach the model');assert.doesNotThrow(()=>prepareReportEnrichment('translation',input));}
 assert.ok([...p.translations.values()].some(item=>item.literal===true));
 const outputs=translationOutputs(p,j,{same:true}),merged=mergeConsultationReport(s,j,p,outputs);assert.equal(merged.translations.r1.conversation.status,'same');assert.equal(merged.translations.r1.conversation.text,original);assert.equal(merged.translationStats.pendingTexts,0);assert.equal(merged.translationStats.totalTexts,translationUnits.length);assert.equal(merged.translationStats.completedTexts,translationUnits.length);assert.ok(merged.translationStats.literalTexts>0);
 const last=translationUnits.at(-1),item=outputs.get(last.id).items[0];item.isTargetLanguage=false;item.detectedLanguage='en';item.translation='translated ending';
 const mixed=mergeConsultationReport(s,j,p,outputs);assert.equal(mixed.translations.r1.conversation.status,'translated');assert.equal(mixed.translations.r1.conversation.text,'x'.repeat(18000)+' '.repeat(36000)+'translated ending');
});

test('complete same-language fields stay same and mixed successful parts assemble into one full translation',async()=>{
 const {planConsultationReport,mergeConsultationReport}=await api(),s=fixture([makeRecord('r1',{failed:false,conversation:'x'.repeat(18000)+'y'.repeat(30)})]),p=planConsultationReport(s,'model'),j=jobFor(p),outputs=translationOutputs(p,j,{same:true});
 let e=mergeConsultationReport(s,j,p,outputs);assert.deepEqual(e.translations.r1.conversation,{status:'same',text:s.records[0].conversation,detectedLanguage:'zh'});
 const units=j.units.filter(unit=>unit.kind==='translation'),last=units.at(-1);outputs.get(last.id).items[0]={id:last.itemIds[0],translation:'后一段译文',isTargetLanguage:false,detectedLanguage:'en'};
 e=mergeConsultationReport(s,j,p,outputs);assert.equal(e.translations.r1.conversation.status,'translated');assert.equal(e.translations.r1.conversation.text,'x'.repeat(18000)+'后一段译文');
});

test('failed or pending segments blank the complete field and count missing fields rather than partial cells',async()=>{
 const {planConsultationReport,mergeConsultationReport}=await api(),s=fixture([makeRecord('r1',{failed:false,conversation:'x'.repeat(18000)+'y'.repeat(30)})]),p=planConsultationReport(s,'model'),j=jobFor(p),outputs=translationOutputs(p,j),unit=j.units.find(unit=>unit.kind==='translation');
 unit.status='failed';unit.errorCode='timeout';unit.error='模型调用超时。';
 let e=mergeConsultationReport(s,j,p,outputs);assert.equal(e.translations.r1.conversation.status,'failed');assert.equal(e.translations.r1.conversation.text,'');assert.equal(e.translationStats.failedTexts,1);assert.equal(e.translationStats.missingCells,1);assert.equal(e.translationStats.affectedRecords,1);assert.equal(e.translationStats.missingRecords,1);
 unit.status='pending';delete unit.errorCode;delete unit.error;e=mergeConsultationReport(s,j,p,outputs);assert.equal(e.translations.r1.conversation.status,'pending');assert.equal(e.translations.r1.conversation.text,'');assert.equal(e.translationStats.pendingTexts,1);assert.equal(e.translationStats.failedTexts,0);
});

test('retry completion replaces stale failed analysis and translation without mutating previous merged results',async()=>{
 const {planConsultationReport,mergeConsultationReport}=await api(),s=fixture([makeRecord('r1',{failed:false})]),p=planConsultationReport(s,'model'),j=jobFor(p),outputs=translationOutputs(p,j),translation=j.units.find(unit=>unit.kind==='translation'),analysis=j.units.find(unit=>unit.kind==='consultationAnalysis');
 translation.status='failed';translation.errorCode='timeout';translation.error='模型调用超时。';analysis.status='failed';analysis.errorCode='invalid_output';analysis.error='分析结果无效。';outputs.set(analysis.id,{items:[analysisResult('r1','负向')]});
 const first=mergeConsultationReport(s,j,p,outputs);assert.equal(first.consultationAnalysis.r1.status,'failed');assert.equal(first.vocItems.length,0);assert.equal(first.analysisStats.missingRecords,1);
 translation.status='completed';analysis.status='completed';outputs.set(analysis.id,{items:[analysisResult('r1','中性')]});const after=mergeConsultationReport(s,j,p,outputs);
 assert.equal(after.translations.r1.conversation.status,'translated');assert.equal(after.consultationAnalysis.r1.status,'completed');assert.equal(after.consultationAnalysis.r1.sentiment,'中性');assert.equal(after.vocItems.length,1);assert.equal(after.analysisStats.missingRecords,0);assert.equal(first.consultationAnalysis.r1.status,'failed');
});

test('each analysis node projects only one full conversation and freeze-time taxonomy',async()=>{
 const {planConsultationReport,consultationInputFor}=await api(),s=fixture([makeRecord('r1'),makeRecord('r2')]),p=planConsultationReport(s,'model'),units=p.units.filter(unit=>unit.kind==='consultationAnalysis');assert.equal(units.length,2);
 for(const unit of units){const input=consultationInputFor(s,unit,p);assert.equal(unit.recordIds.length,1);assert.deepEqual(Object.keys(input.record).sort(),['conversation','id','turns']);assert.deepEqual(Object.keys(input.record.turns[0]).sort(),['id','role','text']);assert.deepEqual(input.taxonomy,s.basis.policies);assert.equal(input.record.conversation,s.records.find(record=>record.id===unit.recordIds[0]).conversation);assert.doesNotThrow(()=>prepareReportEnrichment(unit.kind,input));}
});

test('cause plans use actual dimension category, deduplicate each failed conversation and respect the exact JSON budget',async()=>{
 const {planConsultationReport,consultationInputFor}=await api(),records=Array.from({length:23},(_,i)=>makeRecord(`r${i+1}`,{conversation:'完整原文'+i,turns:[{id:1,role:'客户',text:'客户原话'+i},{id:2,role:'客服',text:'客服原话'+i}]})),s=fixture(records),p=planConsultationReport(s,'model'),units=p.units.filter(unit=>unit.kind==='consultationIssues');
 assert.equal(units.length,3);assert.deepEqual(units.flatMap(unit=>unit.recordIds),records.map(record=>record.id));
 for(const unit of units){assert.equal(unit.category,'真实类别甲');const input=consultationInputFor(s,unit,p);assert.ok(input.records.length<=10);assert.ok(JSON.stringify(input).length<=12000);assert.match(input.records[0].conversation,/节选/);assert.ok(input.records[0].conversation.length<=6000);assert.match(input.records[0].reason,/未具体回应/);assert.doesNotThrow(()=>prepareReportEnrichment(unit.kind,input));}
});

test('only cause-model context is explicitly bounded while original source remains intact',async()=>{
 const {planConsultationReport,consultationInputFor}=await api(),record=makeRecord('r1',{conversation:'原始全文'.repeat(5000),turns:[{id:1,role:'客户',text:'客户原文'.repeat(2000)},{id:2,role:'客服',text:'客服原文'.repeat(2000)}]}),s=fixture([record]),before=clone(s),p=planConsultationReport(s,'model'),unit=p.units.find(unit=>unit.kind==='consultationIssues'),input=consultationInputFor(s,unit,p);
 assert.ok(input.records[0].conversation.length<=6000);assert.match(input.records[0].conversation,/节选/);assert.match(input.records[0].conversation,/完整原文/);assert.equal(s.records[0].conversation,before.records[0].conversation);assert.deepEqual(s,before);
});

test('oversized single cause and analysis units are explicit nonretryable INPUT_TOO_LARGE preflight errors',async()=>{
 const {planConsultationReport,consultationInputFor}=await api(),r=makeRecord('r1');r.final[0].reason='完整原因'.repeat(4000);const s=fixture([r]),p=planConsultationReport(s,'model'),unit=p.units.find(unit=>unit.kind==='consultationIssues');
 assert.equal(unit.inputError.code,'INPUT_TOO_LARGE');assert.throws(()=>consultationInputFor(s,unit,p),error=>error.code==='INPUT_TOO_LARGE');
 const long=fixture([makeRecord('r2',{failed:false,conversation:'x'.repeat(200001)})]),q=planConsultationReport(long,'model'),analysis=q.units.find(unit=>unit.kind==='consultationAnalysis');assert.equal(analysis.inputError.code,'INPUT_TOO_LARGE');assert.throws(()=>consultationInputFor(long,analysis,q),error=>error.code==='INPUT_TOO_LARGE');
});

test('VOC adopts completed negative and neutral analyses and exposes excluded and missing scope',async()=>{
 const {planConsultationReport,mergeConsultationReport}=await api(),s=fixture(Array.from({length:5},(_,i)=>makeRecord(`r${i+1}`,{failed:false}))),p=planConsultationReport(s,'model'),j=jobFor(p),outputs=translationOutputs(p,j),units=j.units.filter(unit=>unit.kind==='consultationAnalysis');
 for(const [index,sentiment]of ['负向','中性','正向','待判定'].entries()){units[index].status='completed';outputs.set(units[index].id,{items:[analysisResult(`r${index+1}`,sentiment)]});}units[4].status='failed';units[4].errorCode='timeout';units[4].error='模型超时。';
 const e=mergeConsultationReport(s,j,p,outputs);assert.deepEqual(e.vocItems.map(item=>[item.id,item.sentiment]),[['r1','负向'],['r2','中性']]);assert.equal(e.analysisStats.total,5);assert.equal(e.analysisStats.completed,4);assert.equal(e.analysisStats.failed,1);assert.equal(e.analysisStats.missingRecords,1);assert.equal(e.analysisStats.positiveExcluded,1);assert.equal(e.analysisStats.uncertain,1);assert.equal(e.analysisStats.unresolvedScope,2);assert.equal(e.analysisComplete,false);assert.equal(e.status,j.status);assert.equal(e.generatedAt,j.updatedAt);
});

test('completed category clusters merge duplicate labels with real unique members and ignore stale unsuccessful outputs',async()=>{
 const {planConsultationReport,mergeConsultationReport}=await api(),s=fixture(Array.from({length:12},(_,i)=>makeRecord(`r${i+1}`))),p=planConsultationReport(s,'model'),j=jobFor(p),outputs=translationOutputs(p,j),units=j.units.filter(unit=>unit.kind==='consultationIssues');
 for(const unit of units){unit.status='completed';outputs.set(unit.id,{clusters:[{label:'回应不足',summary:'未回应具体问题。',action:'先核对需求。',memberIds:[...unit.recordIds]}]});}
 let e=mergeConsultationReport(s,j,p,outputs);assert.equal(e.issueClusters.length,1);assert.equal(e.issueClusters[0].memberIds.length,12);assert.equal(e.issueClusters[0].category,'真实类别甲');assert.equal(e.issueClusters[0].ruleId,'真实类别甲');
 units.at(-1).status='failed';units.at(-1).errorCode='invalid_output';units.at(-1).error='模型输出无效。';e=mergeConsultationReport(s,j,p,outputs);assert.equal(e.issueClusters[0].memberIds.length,10);assert.ok(e.warnings.some(value=>value.kind==='consultationIssues'&&value.recordIds.length===2));
});
