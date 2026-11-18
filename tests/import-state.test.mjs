import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,createImportedTask,saveReview} from '../public/domain.mjs';
import {createCatalog,createDraft} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {validateWorkspace} from '../server/workspace-validation.mjs';
import {buildHtmlReport} from '../public/io.mjs';
import {businessDialog} from '../public/business-dialogs.mjs';
const now='2026-10-29T10:00:00+08:00';
function fixture(){
 const catalog=createCatalog(),profile={id:'IP-RATING',name:'评论原表',version:1,scene:'新品产品咨询',layout:'pair',sheet:'评价记录',headerRow:1,fields:{id:'编号',startedAt:'时间',customerText:'评价',agentText:'回复'},roleMap:{},dateFormat:'iso',defaults:{completeness:'完整'},extras:[{key:'rating',column:'星级',label:'评价星级',type:'number',purpose:'inspect',required:true}],ruleIds:['R004']};
 const raw={id:'FICTION-REVIEW-1',scene:'新品产品咨询',startedAt:now,topic:'虚构评价',channel:'',product:'虚构商品',agent:'',customer:'',completeness:'完整',missingNote:'',turns:[{id:1,role:'客户',speaker:'',at:'',text:'没有收到货。'}],contextFields:[{key:'rating',label:'评价星级',type:'number',value:1,source:{sheet:'评价记录',row:2,column:'星级'}}]};
 const state=createImportedTask(createInitialState(),{name:'原表测试',sessions:[raw],source:{name:'原表.xlsx',sha256:'a'.repeat(64),size:100},reviewer:'测试员',basisSnapshot:createBasisSnapshot(catalog,{effectiveDate:'2026-10-29',ruleIds:['R004'],now}),importMappingSnapshot:{profile},now});
 return {state,catalog,profile,session:state.sessions.find(s=>s.taskId===state.tasks[0].id)};
}
test('mapped task freezes the selected input profile and keeps field provenance',()=>{
 const {state,catalog,profile,session}=fixture();assert.deepEqual(state.tasks[0].importMappingSnapshot,{profile});assert.equal(session.contextFields[0].source.row,2);assert.equal(validateWorkspace(state,catalog),true);
 profile.name='后续配置';assert.equal(state.tasks[0].importMappingSnapshot.profile.name,'评论原表');
});
test('input profile structures and duplicate ids are validated on workspace save',()=>{
 const {state,catalog,profile}=fixture();state.inputProfiles=[profile,profile];assert.throws(()=>validateWorkspace(state,catalog),/配置|重复/);
 state.inputProfiles=[{...profile,fields:{}}];assert.throws(()=>validateWorkspace(state,catalog),/字段|映射|配置/);
});
test('context field types, sources and evidence references cannot be forged',()=>{
 const {state,catalog,session}=fixture();session.contextFields[0].value='不是数字';assert.throws(()=>validateWorkspace(state,catalog),/字段|数字|类型/);
 session.contextFields[0].value=1;session.contextFields[0].source.row=0;assert.throws(()=>validateWorkspace(state,catalog),/字段|来源|行/);
 session.contextFields[0].source.row=2;session.review.drafts.R004={ruleId:'R004',verdict:'符合',reason:'虚构判断',evidence:[1],referenceIds:[],fieldEvidence:['unknown']};assert.throws(()=>validateWorkspace(state,catalog),/字段|证据/);
});
test('human field evidence survives review history and readable detail report',()=>{
 const {state,session}=fixture();const next=saveReview(state,session.id,{ruleId:'R004',verdict:'符合',reason:'依据星级及原文核对',evidence:[1],referenceIds:[],fieldEvidence:['rating']},now);
 assert.deepEqual(next.sessions.find(s=>s.id===session.id).review.drafts.R004.fieldEvidence,['rating']);
 assert.match(buildHtmlReport(next,{includePending:true}),/字段证据/);assert.match(buildHtmlReport(next,{includePending:true}),/评价星级/);
 assert.throws(()=>saveReview(state,session.id,{ruleId:'R004',verdict:'符合',reason:'错误引用',evidence:[1],referenceIds:[],fieldEvidence:['missing']},now),/字段|证据/);
});
test('rule source is retained on drafts and rejects unsafe source shapes',()=>{
 const catalog=createCatalog(),base={...catalog.rules[3],id:'R-IMPORTED',title:'虚构导入规则'};
 const provenance={source:{name:'虚构规则.txt',sha256:'b'.repeat(64),size:60},quote:'介绍优惠时须说明满减门槛。',locator:'字符0—15',scene:'新品产品咨询',preparedBy:{modelId:'glm-5.3-flash',promptVersion:'rule-preparation-ark-v1',at:now}};
 const next=createDraft(catalog,'rules',base.id,{...base,provenance},now);assert.deepEqual(next.rules.at(-1).provenance,provenance);
 assert.throws(()=>createDraft(catalog,'rules','R-BAD',{...base,id:'R-BAD',provenance:{...provenance,source:{...provenance.source,name:'../secret.txt'}}},now),/来源|名称|原文件/);
});
test('explicit null context and evidence are rejected rather than treated as absent',()=>{
 for(const invalid of [null,false,0]){const {state,catalog,session}=fixture();session.contextFields=invalid;assert.throws(()=>validateWorkspace(state,catalog),/字段/);}
 const {state,catalog,session}=fixture();session.review.drafts.R004={ruleId:'R004',verdict:'符合',reason:'虚构判断',evidence:[1],referenceIds:[],fieldEvidence:null};assert.throws(()=>validateWorkspace(state,catalog),/字段/);
});
test('editing AI results retains document-level references as selectable evidence',()=>{
 const {state,session}=fixture();session.aiExecution={status:'completed'};session.aiResults=[{ruleId:'R004',verdict:'符合',reason:'虚构判断',evidence:[1],referenceIds:['P004@V1.0#'],fieldEvidence:['rating']}];
 const rendered=businessDialog({type:'edit-result',ruleId:'R004'},state,{selectedId:session.id});assert.match(rendered.body,/<option value="P004@V1\.0#" selected>/);
});
