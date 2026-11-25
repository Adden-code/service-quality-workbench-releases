import {createBusinessState} from '../public/domain.mjs';
import {createBusinessCatalog} from '../public/catalog.mjs';
import {ensureEcommerceCatalog} from '../public/ecommerce-catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';

export const standardPolicyTitles=['整体判定原则','服务礼仪与沟通规范','是否有探需动作','是否有主动导购和转化意识'];
export function standardPolicies(){return standardPolicyTitles.map((title,i)=>({id:'NP-STANDARD-'+i,title,category:title,version:'V1.0',status:'已发布',effectiveAt:'2026-11-01',expiresAt:'',createdAt:'2026-11-01T00:00:00+08:00',publishedAt:'2026-11-01T00:00:00+08:00',scope:'Synthetic standard scope',owner:'Synthetic maintainer',changeNote:'Synthetic legacy policy',sceneIds:['新品产品咨询'],sections:[{id:'SECTION-'+i,title,text:'合成政策原文；仅供显示测试，不是标定口径。'}]}));}
export function reviewFixture(engine='ecommerce'){
 const catalog=ensureEcommerceCatalog(createBusinessCatalog(),{owner:'Synthetic maintainer'});
 const ec=engine==='ecommerce',raw=engine==='raw';
 const basis=createBasisSnapshot(catalog,{ruleIds:['EC-TIME','EC-TEXT','EC-TARGET','EC-STEPS','EC-PRIVACY'],effectiveDate:'2026-11-25'});
 if(!ec){basis.rules=[{...basis.rules[0],id:'NP-R01',title:'整体判定原则',name:'整体判定原则',category:'整体判定',policyIds:[]}];basis.policies=[];}
 const scene=ec?'电商评论回复':'新品产品咨询',task={id:'T',name:'Synthetic paged review',scene,mode:'manual',sessionIds:[],basisSnapshot:basis,aiStatus:'failed',reviewPolicy:{enabled:false},source:{name:'synthetic.xlsx',sha256:'a'.repeat(64),size:1}};
 const rows=Array.from({length:101},(_,i)=>{
  const row={id:'S-'+i,externalId:'S-'+i,taskId:task.id,scene,startedAt:'2026-11-25T09:00:00+08:00',topic:'Synthetic topic',agent:'Synthetic agent',customer:'Synthetic customer',product:'Synthetic product',channel:'Synthetic channel',completeness:'完整',turns:[{id:1,role:'客户',at:'09:00',text:'Synthetic customer issue'},{id:2,role:'客服',at:'09:01',text:'Synthetic agent reply'}],expectedRuleIds:basis.rules.map(r=>r.id),aiResults:[],aiExecution:{status:'failed',runId:'SYNTHETIC-RUN',error:'模型结果不完整或依据无效，本行未保存质检结论。'},review:{status:'待审核',reviewer:'Synthetic reviewer',drafts:{},history:[],notes:''}};
  if(ec){const cells=Array(22).fill('');cells[8]='Synthetic customer issue';cells[9]='Synthetic agent reply';cells[10]='1';row.ecommerce={raw:cells,sheet:'Sheet4',row:i+3,thresholdHours:24};row.sceneCapabilities={outputs:{ecommerceClassification:{status:'completed',reason:'评分为一星且描述产品缺陷。',value:{evaluationType:'差评',vocKind:'substantive'},confidence:.9}}};}
  if(raw)row.rawTranscript={schemaVersion:1,text:'Synthetic original transcript',row:i+2,timePolicy:{mode:'unavailable',timezone:'+08:00'}};
  return row;
 });
 task.sessionIds=rows.map(r=>r.id);
 return {catalog,state:{...createBusinessState(),tasks:[task],sessions:rows},ui:{dataMode:'manual',period:'all',reviewTaskId:task.id,reviewStatus:'全部',reviewQuery:'',selectedId:'S-50',resultFilter:'全部',openRules:[],highlightedTurns:[],showReviewRecords:true}};
}
