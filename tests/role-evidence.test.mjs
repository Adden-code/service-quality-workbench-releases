import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {workbook,readXlsx} from '../public/io.mjs';
import {parseMappedInput} from '../public/input-profiles.mjs';
import {createImportManager} from '../public/import-manager.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {prepareReportEnrichment,parseReportEnrichment} from '../server/report-enrichment.mjs';
import {createArkClient} from '../server/ark-client.mjs';
import {createBusinessDeliverySnapshot} from '../public/business-delivery.mjs';
import {createConsultationDeliverySnapshot,buildConsultationDeliveryXlsx} from '../public/consultation-delivery.mjs';
import {buildBusinessReportHtml} from '../public/business-report.mjs';
import {planConsultationReport,consultationInputFor,mergeConsultationReport} from '../server/consultation-report-plan.mjs';
import {loadConsultationOriginal} from '../server/consultation-source.mjs';
import {consultationRuntimeFixture} from './consultation-runtime-fixture.mjs';
import {setLocale} from '../public/i18n.mjs';

const mode='conversation_unverified',quote='Synthetic watch cannot connect to my computer.';
const record={id:'synthetic-role-source',turns:[{id:1,role:'客户',text:'Sales menu'},{id:2,role:'客服',text:quote},{id:3,role:'客服',text:'Please provide the model.'},{id:4,role:'系统',text:'Synthetic event'}],conversation:`客户：Sales menu\n客服：${quote}\n客服：Please provide the model.\n系统：Synthetic event`};
const answer={items:[{id:record.id,salesStage:'售前',salesSubstage:'兼容性咨询',intentLabel:'未配置分类体系',intentReferenceId:'',demandSummary:'会话提出设备连接问题，发言方待核验。',sentiment:'负向',negativeVoices:[{turnId:2,quote}],voc:{valid:true,scene:'兼容性与功能',painPoint:'设备无法连接电脑。',reason:'会话中明确提出连接问题，角色待核验。',evidenceQuote:quote}}]};
const clone=value=>structuredClone(value),input=(roleEvidenceMode)=>({record:clone(record),taxonomy:[],...(roleEvidenceMode?{roleEvidenceMode}:{})});
const parse=(value,source=input())=>parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment('consultationAnalysis',source));
const errorFor=(value,source=input())=>{try{parse(value,source);assert.fail('Expected rejection');}catch(error){assert.equal(error.code,'INVALID_OUTPUT');return error;}};
const profile=()=>({id:'SIX-COLS',name:'合成六列角色预检',version:1,scene:'新品产品咨询',layout:'turns',sheet:'原表',headerRow:1,fields:{id:'会话ID',agent:'客服',role:'发言角色',text:'发言原文',at:'发言时间',startedAt:'会话开始时间'},roleMap:{},dateFormat:'iso',defaults:{completeness:'完整'},extras:[],ruleIds:[]});
const headers=['会话ID','客服','发言角色','发言原文','发言时间','会话开始时间'];
async function mapped(){const rows=record.turns.map(turn=>[record.id,'Synthetic agent',turn.role,turn.text,'2026-11-06T08:00:00Z','2026-11-06T08:00:00Z']);const bytes=await workbook([{name:'原表',headers,rows}]);return parseMappedInput({name:'synthetic-six-columns.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},profile());}
async function snapshotFor(roleEvidenceMode){const f=await consultationRuntimeFixture(1);f.state.sessions[0].turns=clone(record.turns);f.task.importMappingSnapshot={profile:profile()};
 f.bytes=await workbook([{name:'原表',headers,rows:record.turns.map(turn=>[f.state.sessions[0].externalId,'Synthetic agent',turn.role,turn.text,'2026-11-06T08:00:00Z','2026-11-06T08:00:00Z'])}]);f.task.source={name:'synthetic-six-columns.xlsx',size:f.bytes.length,sha256:createHash('sha256').update(f.bytes).digest('hex')};
 const original=await loadConsultationOriginal({state:f.state,task:f.task,store:{getSource:async()=>({...f.task.source,bytes:f.bytes})}});const snapshot=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original,now:'2026-11-06T08:00:00Z',roleEvidenceMode});return{...f,snapshot,original};}

test('six source columns preview role counts and real locations without changing mixed source roles',async()=>{
 const parsed=await mapped();assert.equal(parsed.valid,true,parsed.errors.join(';'));assert.deepEqual(parsed.sessions[0].turns.map(turn=>turn.role),record.turns.map(turn=>turn.role));
 assert.ok(parsed.rolePreview,'role preview must expose source-role distribution');assert.equal(parsed.rolePreview.sourceColumn,'发言角色');assert.equal(parsed.rolePreview.total,4);
 const service=parsed.rolePreview.groups.find(group=>group.sourceValue==='客服');assert.equal(service.role,'客服');assert.equal(service.count,2);assert.deepEqual(service.samples.map(sample=>sample.text),[quote,'Please provide the model.']);assert.deepEqual(service.samples.map(sample=>[sample.externalId,sample.row,sample.turnId]),[[record.id,3,2],[record.id,4,3]]);
 assert.deepEqual(parsed.importMappingSnapshot,{profile:profile()});
 const dialog={type:'input-mapping',profile:profile(),preview:parsed};const manager=createImportManager({getState:()=>({tasks:[],sessions:[]}),getCatalog:()=>createCatalog(),getDialog:()=>dialog});
 const html=manager.dialog(dialog);assert.match(html,/发言角色/);assert.match(html,/源角色/);assert.match(html,/逐轮/);assert.match(html,/原表第3行/);assert.match(html,/不能.*反转|不可.*反转/);assert.match(html,/Please provide the model/);
 try{setLocale('en',{storage:null});const en=manager.dialog(dialog);assert.match(en,/Source role distribution/);assert.match(en,/Source row 3[^<]*Turn 2/);assert.match(en,/per turn/);assert.match(en,/Please provide the model/);}finally{setLocale('zh',{storage:null});}
});

test('role editor rejects repeated trimmed source keys immediately and retains the last valid mapping',async()=>{
 const p=profile();p.roleMap={visitor:'客户',operator:'客服'};const dialog={type:'input-mapping',profile:p,preview:{valid:true}};let commits=0;
 const manager=createImportManager({getState:()=>({}),getCatalog:()=>createCatalog(),getDialog:()=>dialog,renderDialog(){},commitWorkspace:async()=>{commits++;}});
 manager.input({target:{id:'input-role-map',value:'visitor=客户\n visitor =客服',dataset:{}}});assert.match(dialog.roleMapError,/重复/);assert.match(dialog.error,/重复/);assert.deepEqual(dialog.profile.roleMap,{visitor:'客户',operator:'客服'});assert.equal(dialog.preview,null);
 await manager.action('input-save-profile');assert.equal(commits,0);assert.match(dialog.error,/重复/);
 manager.input({target:{id:'input-role-map',value:'visitor=客户\noperator=客服',dataset:{}}});assert.equal(dialog.roleMapError,'');assert.equal(dialog.profile.roleMap.visitor,'客户');
});

test('strict rejects source-service quote with a field diagnostic; explicit conversation mode accepts the exact turn',()=>{
 const error=errorFor(answer);assert.ok(error.traceOutput?.diagnostic,'strict role mismatch needs a field diagnostic');assert.equal(error.traceOutput.diagnostic.code,'quote_matches_non_customer_turn');assert.equal(error.traceOutput.diagnostic.path,'items[0].negativeVoices[0].quote');assert.deepEqual(error.traceOutput.diagnostic.matchedTurnIds,[2]);assert.deepEqual(error.traceOutput.diagnostic.roles,['客服']);
 const before=JSON.stringify(input(mode)),result=parse(answer,input(mode));assert.equal(result.items[0].negativeVoices[0].quote,quote);assert.equal(JSON.stringify(input(mode)),before);
 const vocOnly=clone(answer);vocOnly.items[0].sentiment='中性';vocOnly.items[0].negativeVoices=[];const vocError=errorFor(vocOnly);assert.equal(vocError.traceOutput.diagnostic.path,'items[0].voc.evidenceQuote');assert.equal(vocError.traceOutput.diagnostic.code,'quote_matches_non_customer_turn');
 const prompt=prepareReportEnrichment('consultationAnalysis',input(mode));assert.match(prompt.messages[0].content,/角色未核验/);assert.match(prompt.messages[0].content,/原角色/);assert.equal(prompt.input.roleEvidenceMode,mode);
});

test('temporary mode keeps exact turn membership, conversation grounding, enums and closed contracts',async t=>{
 const changes=[['fabricated',v=>v.items[0].negativeVoices[0].quote='Invented sentence.','quote_not_in_declared_turn'],['other turn',v=>v.items[0].negativeVoices[0].turnId=3,'quote_not_in_declared_turn'],['unknown turn',v=>v.items[0].negativeVoices[0].turnId=999,'unknown_turn'],['fraction',v=>v.items[0].negativeVoices[0].turnId='2.0','invalid_turn_id'],['unsafe',v=>v.items[0].negativeVoices[0].turnId='9007199254740992','invalid_turn_id'],['cross-turn',v=>v.items[0].negativeVoices[0].quote=quote+'\nPlease provide the model.','quote_not_in_declared_turn'],['translated',v=>v.items[0].negativeVoices[0].quote='手表无法连接电脑。','quote_not_in_declared_turn'],['enum',v=>v.items[0].sentiment='任意','invalid_sentiment'],['unknown field',v=>v.items[0].unexpected='untrusted raw id','invalid_analysis_fields']];
 for(const[name,change,code]of changes)await t.test(name,()=>{const value=clone(answer);change(value);const error=errorFor(value,input(mode));assert.equal(error.traceOutput.diagnostic.code,code);assert.ok(!JSON.stringify(error.traceOutput.diagnostic).includes('untrusted raw id'));});
 const other=input(mode);other.record.conversation='different conversation';assert.equal(errorFor(answer,other).traceOutput.diagnostic.code,'quote_not_in_conversation');
 const noTurns=input(mode);noTurns.record.turns=[record.turns[0]];assert.equal(errorFor(answer,noTurns).traceOutput.diagnostic.code,'unknown_turn');
 const duplicate=clone(answer);duplicate.items[0].negativeVoices.push({turnId:'2',quote});assert.equal(errorFor(duplicate,input(mode)).traceOutput.diagnostic.code,'duplicate_quote');
 const invalidVoc=clone(answer);invalidVoc.items[0].voc.evidenceQuote='foreign conversation quote';assert.equal(errorFor(invalidVoc,input(mode)).traceOutput.diagnostic.code,'quote_not_in_record');
 assert.throws(()=>prepareReportEnrichment('consultationAnalysis',input('auto')),e=>e.code==='INVALID_INPUT');
});

test('canonical integer strings normalize without relaxing role or duplicate validation',()=>{
 for(const roleEvidenceMode of [undefined,mode]){const source=input(roleEvidenceMode);source.record.turns[1].role='客户';const value=clone(answer);value.items[0].negativeVoices[0].turnId=' 002 ';assert.equal(parse(value,source).items[0].negativeVoices[0].turnId,2);}
 const value=clone(answer);value.items[0].negativeVoices[0].turnId='2';assert.equal(errorFor(value).traceOutput.diagnostic.code,'quote_matches_non_customer_turn');
});

test('actual client keeps bounded raw trace plus safe field diagnostic on strict role mismatch',async()=>{
 let calls=0;const client=createArkClient({fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)+' '.repeat(22000)}}]}));}});
 await assert.rejects(client.enrichBusinessReport({config:{baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',authMode:'none',timeoutMs:10000},kind:'consultationAnalysis',input:input()}),e=>e.code==='INVALID_OUTPUT'&&e.traceOutput?.diagnostic?.code==='quote_matches_non_customer_turn'&&e.traceOutput.content.length===20000&&e.traceOutput.contentTruncated);
 assert.equal(calls,1);
});

test('diagnostic sanitization only preserves fixed codes, supported field paths and bounded real-turn roles',async()=>{
 const {safeConsultationDiagnostic}=await import('../server/consultation-enrichment.mjs');
 const raw={code:'quote_matches_non_customer_turn',path:'items[0].negativeVoices[0].quote',matchedTurnIds:[2,'unknown-id',3],roles:['客服','secret','系统'],apiKey:'credential',unknownRawId:'untrusted raw id'};
 assert.deepEqual(safeConsultationDiagnostic(raw),{code:raw.code,path:raw.path,matchedTurnIds:[2,3],roles:['客服','系统']});
 assert.equal(safeConsultationDiagnostic({...raw,path:'items[0].untrustedRawId'}),undefined);assert.equal(safeConsultationDiagnostic({...raw,code:'unknown_provider_code'}),undefined);
 const many={...raw,matchedTurnIds:Array.from({length:100},(_,i)=>i+1),roles:Array(100).fill('客服')};assert.equal(safeConsultationDiagnostic(many).matchedTurnIds.length,20);
});

test('report snapshot freezes mode only when selected and does not alter source roles or quality judgments',async()=>{
 const f=await snapshotFor();const before=JSON.stringify(f.state);const explicit=createConsultationDeliverySnapshot(f.state,{taskId:f.task.id,original:f.original,now:f.snapshot.createdAt,roleEvidenceMode:'customer_only'});assert.deepEqual(explicit,f.snapshot);
 const loose=createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original:f.original,now:f.snapshot.createdAt,roleEvidenceMode:mode});assert.equal(loose.roleEvidenceMode,mode);assert.deepEqual(loose.records[0].turns,f.snapshot.records[0].turns);assert.deepEqual(loose.records[0].final,f.snapshot.records[0].final);assert.equal(JSON.stringify(f.state),before);
 assert.throws(()=>createBusinessDeliverySnapshot(f.state,{taskId:f.task.id,original:f.original,roleEvidenceMode:'guess'}),/角色|引用/);
 const prepared=planConsultationReport(loose,'synthetic-model'),unit=prepared.units.find(unit=>unit.kind==='consultationAnalysis');assert.equal(consultationInputFor(loose,unit,prepared).roleEvidenceMode,mode);
});

test('temporary Excel and both HTML languages name unverified conversation evidence and preserve source roles',async()=>{
 const {snapshot}=await snapshotFor(mode),id=snapshot.records[0].id,value={...clone(answer.items[0]),id,status:'completed',roleEvidenceMode:mode};
 const enrichment={roleEvidenceMode:mode,consultationAnalysis:{[id]:value},vocItems:[{id,...value.voc,sentiment:value.sentiment,roleEvidenceMode:mode}],translations:{},warnings:[]};
 const zh=buildBusinessReportHtml(snapshot,enrichment),en=buildBusinessReportHtml(snapshot,enrichment,{language:'en'});
 for(const html of [zh,en]){assert.match(html,new RegExp(quote));assert.match(html,/角色未核验|Roles unverified/);assert.match(html,/历史参考|historical reference/);assert.match(html,/新建任务|new task/);assert.match(html,/<header[\s\S]*角色未核验|<header[\s\S]*Roles unverified/);assert.match(html,/<footer[\s\S]*角色未核验|<footer[\s\S]*Roles unverified/);assert.doesNotMatch(html,/<h[23][^>]*>用户原声VOC|<h3>负面用户原声|<h3>Customer voice —/);}
 const tables=await readXlsx(await buildConsultationDeliveryXlsx(snapshot,enrichment)),english=await readXlsx(await buildConsultationDeliveryXlsx(snapshot,enrichment,{language:'en'}));
 assert.ok(tables['检核明细'][0].some(v=>/会话原文.*角色未核验/.test(v)));assert.match(tables['检核明细'][1].join(' '),new RegExp(quote));assert.match(tables['口径说明'].flat().join(' '),/角色未核验/);assert.match(tables['口径说明'].flat().join(' '),/新建任务/);
 assert.ok(english['Inspection Details'][0].some(v=>/Conversation.*Roles unverified/.test(v)));assert.match(english['Inspection Details'][1].join(' '),new RegExp(quote));assert.match(english.Methodology.flat().join(' '),/historical reference/);
 assert.ok(!english['Business Analysis'].some(row=>row[0]==='VOC'),'temporary analysis rows must be attributed as unverified conversation leads');
 value.voc={valid:false,scene:'其他',painPoint:'',reason:'未形成具体会话痛点。',evidenceQuote:quote};assert.doesNotMatch(buildBusinessReportHtml(snapshot,enrichment,{language:'en'}),/Customer review — Original/);
 assert.deepEqual(snapshot.records[0].turns.map(turn=>turn.role),record.turns.map(turn=>turn.role));
});
