import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {workbook,readXlsx} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {consultationOriginalFromTables} from '../server/consultation-source.mjs';
import {createConsultationDeliverySnapshot} from '../public/consultation-delivery.mjs';
import {createBusinessExportManager} from '../public/business-export-manager.mjs';
import {businessExportView} from '../public/business-export-view.mjs';
import {setLocale} from '../public/i18n.mjs';
const mode='conversation_unverified',tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const bytes=await workbook([{name:'Synthetic raw',headers:['会话ID','客服','消息详情'],rows:[['SYN-EXPORT','Synthetic agent','Customer: A synthetic concern.\nAgent: Synthetic response.']]}]),source={name:'synthetic.xlsx',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
 const parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true);
 const basisSnapshot={capturedAt:'2026-11-12T00:00:00Z',effectiveDate:'2026-11-12',rules:[{id:'SYN-R',title:'合成检查',version:'V1',category:'合成类别',policyIds:[]}],policies:[]},state=createImportedTask(createBusinessState(),{name:'Synthetic raw export',source,sessions:parsed.sessions,basisSnapshot,reviewer:'Synthetic reviewer',now:'2026-11-12T00:00:00Z'}),task=state.tasks[0],original=consultationOriginalFromTables(state,task,await readXlsx(bytes)),snapshot=createConsultationDeliverySnapshot(state,{taskId:task.id,original,now:'2026-11-12T00:00:00Z'}),ui={businessTaskId:task.id,businessConclusionMode:'combined',businessTargetLang:'zh',businessReportLanguage:'zh',businessRoleEvidenceMode:'customer_only'};
 return{state,task,snapshot,ui};
}
test('raw manager generates with automatic effective evidence mode and enables both real downloads from strict UI default',async()=>{
 setLocale('zh',{storage:null});const f=await fixture(),requests=[],downloads=[];let job;
 const manager=createBusinessExportManager({api:async(url,options={})=>{requests.push({url,options});if(url.includes('?taskId='))return{jobs:[]};if(options.method==='POST'){job={id:options.body.jobId,taskId:f.task.id,status:'completed',phase:'ready',createdAt:'2026-11-12T00:00:00Z',updatedAt:'2026-11-12T00:00:00Z',resultAvailable:true,options:{conclusionMode:'combined',targetLang:'zh',roleEvidenceMode:mode},nodes:[],progress:{total:1,done:1,failed:0,pending:0,running:0,percent:100}};return{job};}if(url.endsWith('/result'))return{snapshot:f.snapshot,enrichment:{},job};return{job};},getState:()=>f.state,getUI:()=>f.ui,download:(...args)=>downloads.push(args),pollMs:100000});
 try{manager.setActive(true);await tick();await tick();await manager.handleAction('business-generate');const post=requests.find(request=>request.options.method==='POST');assert.equal(post.options.body.roleEvidenceMode,mode);assert.equal(f.ui.businessRoleEvidenceMode,'customer_only','Raw effective scope must not overwrite a structured preference.');let html=manager.view(f.state,f.ui);assert.doesNotMatch(html,/服务器返回的交付任务与当前选择不一致/);assert.ok(!/data-act="business-download-(?:xlsx|html)" disabled/.test(html));assert.match(html,/角色未核验/);assert.match(html,/<select id="business-role-evidence-mode"[^>]*disabled/);
  await manager.handleAction('business-download-xlsx');await manager.handleAction('business-download-html');assert.equal(downloads.length,2);const tables=await readXlsx(downloads[0][0]);assert.equal(tables.检核明细[1][0],'SYN-EXPORT');assert.match(downloads[1][0],/角色未核验/);assert.equal(manager.handleChange('business-role-evidence-mode','customer_only'),false);
  setLocale('en',{storage:null});html=manager.view(f.state,f.ui);assert.match(html,/Roles unverified/);assert.match(html,/<select id="business-role-evidence-mode"[^>]*disabled/);assert.doesNotMatch(html,/Correct source roles|temporary/);
 }finally{manager.close();setLocale('zh',{storage:null});}
});
test('raw view independently shows a fixed scope before the manager normalizes UI options',async()=>{
 const f=await fixture();for(const language of ['zh','en']){setLocale(language,{storage:null});const html=businessExportView(f.state,f.ui);assert.match(html,/<option value="conversation_unverified" selected/);assert.match(html,language==='zh'?/归档原文|逐字原文/:/Archived row|Original row/);assert.doesNotMatch(html,/value="customer_only"/);assert.doesNotMatch(html,/先逐轮修正|Correct source roles/);}setLocale('zh',{storage:null});
});
