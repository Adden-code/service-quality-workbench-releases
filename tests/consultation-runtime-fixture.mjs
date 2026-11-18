import {createHash} from 'node:crypto';
import {workbook} from '../public/io.mjs';

export async function consultationRuntimeFixture(count=49){
 const categories=['整体判定原则',...Array(11).fill('服务礼仪与沟通规范'),...Array(2).fill('是否有探需动作'),...Array(3).fill('是否有主动导购和转化意识')];
 const rules=categories.map((category,index)=>({id:'RULE-'+index,title:'合成检核点 '+index,category,version:'V42',policyIds:[]}));
 const policies=[{id:'TAX',version:'V3',title:'测试分类体系',category:'分类体系',sections:[{id:'T1',title:'兼容性咨询',text:'用户希望了解与已有设备的兼容性。'}]}];
 const task={id:'TASK-NEW',name:'合成49会话新品验收',mode:'manual',scene:'新品产品咨询',basisSnapshot:{rules,policies,capturedAt:'2026-11-04T09:00:00+08:00',effectiveDate:'2026-11-04'},importMappingSnapshot:{profile:{sheet:'业务原表',headerRow:1,fields:{id:'会话ID',agent:'客服',text:'消息详情'},defaults:{product:'合成测试新品'}}}};
 const sessions=Array.from({length:count},(_,i)=>{
  const turns=[{id:1,role:'客户',text:`The device is not compatible with my computer ${i}.`},{id:2,role:'客服',text:`Please tell me your computer model ${i}.`}];
  return{id:'S-'+i,externalId:'000'+i,taskId:task.id,scene:'新品产品咨询',product:'合成测试新品',turns,expectedRuleIds:rules.map(r=>r.id),aiExecution:{status:'completed',runId:'quality-old'},aiResults:rules.map((rule,index)=>({ruleId:rule.id,verdict:index===1&&i%3===0?'不符合':index===5&&i%7===0?'不适用':'符合',reason:index===1&&i%3===0?'没有对客户具体兼容性问题进行明确回应。':'已依据实际规则完成合成检查。',evidence:index===1?[2]:[],referenceIds:[]})),review:{status:'待审核',drafts:{}}};
 });
 const bytes=await workbook([{name:'业务原表',headers:['会话ID','客服','消息详情'],rows:sessions.map(s=>[s.externalId,'合成客服',s.turns.map(t=>`${t.role}：${t.text}`).join('\n')])}]);
 task.source={name:'合成原表.xlsx',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
 return{state:{tasks:[task],sessions},task,bytes};
}

export function consultationReportAnswer(kind,input){
 if(kind==='translation')return{items:input.items.map(item=>({id:item.id,isTargetLanguage:false,detectedLanguage:'en',translation:'中文译文：'+item.text}))};
 if(kind==='consultationIssues')return{clusters:[{label:'回应具体诉求',summary:'兼容性问题缺少明确回应',memberIds:input.records.map(r=>r.id),action:'先确认电脑型号，再说明核验兼容性的方法和责任人。'}]};
 const row=input.record,quote=row.turns.find(t=>t.role==='客户').text;
 return{items:[{id:row.id,salesStage:'售前',salesSubstage:'兼容性咨询',intentLabel:'兼容性咨询',intentReferenceId:'TAX@V3#T1',demandSummary:'希望核对设备与电脑兼容性',sentiment:'负向',negativeVoices:[{turnId:1,quote}],voc:{valid:true,scene:'兼容性与功能',painPoint:'设备与电脑无法兼容',reason:'用户明确表达兼容性困扰',evidenceQuote:quote}}]};
}
