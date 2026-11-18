import fs from 'node:fs/promises';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog,createEcommerceRuleSetBasis} from '../public/ecommerce-catalog.mjs';
import {createRuleSetDraft,publishRuleSet} from '../public/ecommerce-rule-sets.mjs';
import {EC_HEADERS,ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
import {createWorkspaceStore} from '../server/workspace-store.mjs';
import {createAiService} from '../server/ai-service.mjs';

export const cutoff='2026-11-03T12:00:00+08:00';
export const ruleSet={schemaVersion:1,ruleSetId:'EC-STAGE-A-TEST',version:'V2.1-A',executionProfile:'v21-time-v1-content',calendarConfirmed:false,trial:true,timeRule:{mode:'workingHours',calendar:{workdays:'Mon-Fri',workStart:'09:00',workEnd:'18:00',timezone:'UTC+08:00',holidays:[],workingDates:[]},thresholds:{default:24,byType:{'好评正向':72,'中评':48,'好评负向':24,'差评':24}},unrepliedRule:true,replyDetection:'bothEmpty'}};
export const basis={ruleSetSnapshot:ruleSet,rules:[{id:'EC-TIME',policyIds:['EC-TIME-EC-STAGE-A-TEST']}],policies:[{id:'EC-TIME-EC-STAGE-A-TEST',version:'V2.1',sections:[{id:'EC-TIME-EC-STAGE-A-TEST-1'}]}]};
export function sourceRow({reply='虚构回复',replyAt='2026-11-02T10:00:00+08:00',commentAt='2026-10-30T17:00:00+08:00',type='差评',row=3}={}){
 const raw=Array(22).fill('');raw[8]='虚构评论';raw[9]=reply;raw[11]='虚构管理员';raw[12]=commentAt;raw[13]=replyAt;raw[14]=type;raw[15]='OLD-HUMAN-REF-NEVER-MODEL';raw[21]='OLD-DETAIL-NEVER-MODEL';
 const ecommerce={schemaVersion:1,sheet:'Sheet4',row,fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('虚构标准'),raw,thresholdHours:1};
 return{id:ecommerceRecordId(ecommerce),...ecommerceSourceProjection(ecommerce),ecommerce};
}
export function publishedFixture(sessions=[sourceRow()],{ruleSetChanges={}}={}){
 const now='2026-11-03T09:00:00+08:00';let catalog=ensureEcommerceCatalog(createBusinessCatalog(),{now});
 catalog=createRuleSetDraft(catalog,'EC-STAGE-A-TEST',{owner:'虚构维护人',changeNote:'虚构测试已确认阶段A',effectiveAt:'2026-11-03',...ruleSetChanges},now);catalog=publishRuleSet(catalog,'EC-STAGE-A-TEST','V2.1-A',now);
 const basisSnapshot=createEcommerceRuleSetBasis(catalog,{ruleSetId:'EC-STAGE-A-TEST',version:'V2.1-A',effectiveDate:'2026-11-03',now});
 return{catalog,state:createImportedTask(createBusinessState(),{name:'虚构Stage-A运行',sessions,source:{name:'stage-a-fixture.xlsx',size:50,sha256:sessions[0].ecommerce.fileSha256},reviewer:'虚构审核员',basisSnapshot,now})};
}
export async function serviceFixture(t,{sessions,inspect,compare,ruleSetChanges={}}={}){
 const base='D:/Codex project/outputs/service-stage-a-tests';await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(base+'/runtime-'),store=await createWorkspaceStore({dataDir:dir});
 let ai;t.after(async()=>{await ai?.close();await store.close();await fs.rm(dir,{recursive:true,force:true});});
 const source=await store.putSource(Buffer.from('synthetic-stage-a-source-only'),'stage-a-fixture.xlsx');
 const rows=(sessions??[sourceRow()]).map(s=>{const row=structuredClone(s);row.ecommerce.fileSha256=source.sha256;row.id=ecommerceRecordId(row.ecommerce);return row;});
 const {catalog,state}=publishedFixture(rows,{ruleSetChanges});state.tasks[0].source=source;
 const now='2026-11-03T09:00:00+08:00',draftCatalog=createRuleSetDraft(ensureEcommerceCatalog(createBusinessCatalog(),{now}),'EC-STAGE-A-TEST',{owner:'虚构维护人',changeNote:'虚构测试已确认阶段A',effectiveAt:'2026-11-03',...ruleSetChanges},now);
 await store.save({state:createBusinessState(),catalog:draftCatalog,baseRevision:0,mutationId:'stage-a-save-draft'});
 await store.save({state,catalog,baseRevision:1,mutationId:'stage-a-initial'});const calls=[];
 const client={inspectEcommerceRow:async request=>{calls.push(request);return inspect(request,calls.length);},compareEcommerceReplies:compare??(async({block})=>({similarPairs:[],checkedIds:block.representativeIds}))};
 ai=await createAiService({store,client,maxAttempts:1,retryDelayMs:1,modelConfig:{getPrivate:()=>({configured:true,connectionTested:true,baseUrl:'http://127.0.0.1:12345/v1',model:'fixture',authMode:'none',apiKey:null})}});
 return{store,client,calls,taskId:state.tasks[0].id,get ai(){return ai;},async restart(){await ai.close();ai=await createAiService({store,client,maxAttempts:1,retryDelayMs:1,modelConfig:{getPrivate:()=>({configured:true,connectionTested:true,baseUrl:'http://127.0.0.1:12345/v1',model:'fixture',authMode:'none',apiKey:null})}});}};
}
