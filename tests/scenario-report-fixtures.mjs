import {createHash} from 'node:crypto';
import {consultationRuntimeFixture} from './consultation-runtime-fixture.mjs';
import {workbook} from '../public/io.mjs';

export function scenarioConfig(overrides={}){
 return {schemaVersion:1,id:'SCENE-AFTERSALES',name:'售后咨询',version:1,enabled:true,engine:'conversation',layout:'turns',inputProfileId:'',ruleIds:[],analysisFields:['intent','negativeVoice'],customFields:[{id:'resolution',label:'处理方案',type:'text',instruction:'概括已提供的处理方案。',options:[]},{id:'channel',label:'处理渠道',type:'enum',instruction:'选择客服实际说明的处理渠道。',options:['线上','门店']},{id:'request',label:'客户诉求原文',type:'quote',instruction:'引用客户提出诉求的连续原文。',options:[]}],report:{title:'售后服务质检报告',groupBy:'context',groupField:'area',groupLabel:'区域',sections:['overview','breakdown']},requiredCapabilities:['text-judgment'],createdAt:'2026-11-05T09:00:00+08:00',updatedAt:'2026-11-05T09:00:00+08:00',...overrides};
}
export async function scenarioRuntimeFixture(count=2,overrides={}){
 const f=await consultationRuntimeFixture(count),scenario=scenarioConfig(overrides);f.task.scene=scenario.id;f.task.scenarioSnapshot=structuredClone(scenario);f.state.scenarios=[structuredClone(scenario)];
 const profile=f.task.importMappingSnapshot.profile;
 profile.fields.agent='客服';profile.extras=[{key:'area',column:'原区域列',label:'区域',type:'text',purpose:'retain',required:false}];
 f.state.sessions.forEach((session,index)=>{session.scene=scenario.id;session.agent=index%2?'乙坐席':'甲坐席';});
 const bytes=await workbook([{name:'业务原表',headers:['会话ID','客服','消息详情','原区域列','保留列'],rows:f.state.sessions.map((s,index)=>[s.externalId,s.agent,s.turns.map(t=>`${t.role}：${t.text}`).join('\n'),index%2?'华南':'华北','000'+index])}]);
 f.bytes=bytes;f.task.source={name:'合成售后.xlsx',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
 return{...f,scenario};
}
export function scenarioFieldAnswer(input){return{recordId:input.record.id,fields:input.fields.map(field=>({id:field.id,value:field.type==='quote'?input.record.turns.find(t=>t.role==='客户').text:field.type==='enum'?field.options[0]:'客服建议核对兼容资料。',missing:false,turnId:field.type==='quote'?input.record.turns.find(t=>t.role==='客户').id:null}))};}
