import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeExecutionSettings} from '../public/execution-settings.mjs';
import {workbook} from '../public/io.mjs';
import {parseRawTranscriptFile} from '../public/raw-transcript.mjs';
import {createBusinessState,createImportedTask} from '../public/domain.mjs';
import {createCatalog} from '../public/catalog.mjs';
import {createBasisSnapshot} from '../public/task-basis.mjs';
import {businessTaskDialog} from '../public/business-dialogs.mjs';
import {taskDetailView} from '../public/task-workbench.mjs';
const at='2026-11-12T10:00:00+08:00';
async function fixture(settings){
 const bytes=await workbook([{name:'Synthetic',headers:['会话ID','客服','消息详情'],rows:[['SYN-CONCURRENCY','Synthetic agent','Customer: synthetic question.\r\nAgent: exact response.']]}]),source={name:'synthetic.xlsx',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const parsed=await parseRawTranscriptFile({name:source.name,size:bytes.length,arrayBuffer:async()=>bytes}),catalog=createCatalog(),basisSnapshot=createBasisSnapshot(catalog,{effectiveDate:'2026-11-12',ruleIds:['R004'],now:at});
 const state=createImportedTask(createBusinessState(),{name:'Synthetic concurrency',source,sessions:parsed.sessions,basisSnapshot,reviewer:'Synthetic Reviewer',now:at,...(settings===undefined?{}:{executionSettings:settings})});
 return{parsed,catalog,basisSnapshot,state,task:state.tasks[0]};
}
test('raw settings default to four; ecommerce and structured defaults remain one',()=>{
 assert.equal(normalizeExecutionSettings(undefined,{raw:true}).concurrency,4);
 assert.equal(normalizeExecutionSettings().concurrency,1);
 for(const concurrency of [1,2,3,4])assert.equal(normalizeExecutionSettings({concurrency},{raw:true}).concurrency,concurrency);
 for(const concurrency of [0,5,1.5,NaN,'4'])assert.throws(()=>normalizeExecutionSettings({concurrency},{raw:true}));
});
test('new raw domain tasks freeze four unless an explicit valid setting was supplied',async()=>{
 const f=await fixture();assert.equal(f.task.executionSettings?.concurrency,4);
 const g=await fixture({concurrency:2});assert.equal(g.task.executionSettings.concurrency,2);
});
test('raw creation concurrency is visible before opening advanced settings',async()=>{
 const f=await fixture(),html=businessTaskDialog({type:'new-task',mode:'manual',scene:'新品产品咨询',step:3,parsed:f.parsed,catalog:f.catalog,basisSnapshot:f.basisSnapshot,effectiveDate:'2026-11-12',ruleIds:['R004'],reviewer:'Reviewer',name:'Synthetic',rawImportOptions:{timePolicy:{mode:'unavailable',timezone:'+08:00'}}},f.state).body;
 const input=html.indexOf('id="task-concurrency"');assert.ok(input>=0);assert.equal(html.slice(0,input).lastIndexOf('<details'),html.slice(0,input).lastIndexOf('</details>'),'Concurrency must be outside the advanced disclosure');
 assert.match(html,/\bid="task-concurrency"[^>]*value="4"/);
});
test('first raw execution exposes a normal start setting, while a frozen queue stays read-only',async()=>{
 const f=await fixture(),ui={dataMode:'manual',taskDetailId:f.task.id,rawStartConcurrency:{[f.task.id]:3}};
 let html=taskDetailView(f.state,ui);assert.match(html,/id="raw-start-concurrency"/);assert.match(html,/<option value="3" selected/);
 f.task.aiQueue={status:'paused',phase:'rows',settings:{concurrency:1,batchSize:20,maxWorkBytes:64000},rows:[],batches:[]};
 html=taskDetailView(f.state,ui);assert.doesNotMatch(html,/id="raw-start-concurrency"/);assert.match(html,/已冻结|冻结并发/);assert.equal(f.task.aiQueue.settings.concurrency,1);
});
