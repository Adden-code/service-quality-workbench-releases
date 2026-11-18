import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook} from '../public/io.mjs';
import {createConversationCleaningManager} from '../public/conversation-cleaning-manager.mjs';
import {setLocale} from '../public/i18n.mjs';

async function fixture(config={configured:false,connectionTested:false}){
 let current={type:'new-task',scene:'新品产品咨询'},model=config,settingsOrigin,calls=0;
 const bytes=await workbook([{name:'业务',headers:['会话ID','客服','消息详情'],rows:[['SYN-1','Synthetic agent','客户：合成问题']]}]);
 const file={name:'synthetic.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 const manager=createConversationCleaningManager({getDialog:()=>current,getModelConfig:()=>model,openDialog:value=>current=value,renderDialog:()=>{},configureModel:async origin=>{settingsOrigin=origin;current={type:'model-settings'};},prepareConversationCleaning:async()=>{calls++;throw new Error('No call expected');}});
 await manager.action('cleaning-open');await manager.change({target:{id:'cleaning-file',files:[file]}});
 return{manager,get:()=>current,settings:()=>settingsOrigin,calls:()=>calls,setConfig:value=>model=value};
}
test('cleaning explains unconfigured and untested states, disables drafting and offers model setup',async()=>{
 for(const config of [{configured:false,connectionTested:false},{configured:true,connectionTested:false}]){
  const f=await fixture(config);f.manager.input({target:{id:'cleaning-consent',checked:true}});
  const html=f.manager.dialog();assert.match(html,/data-act="cleaning-configure-model"/);
  assert.match(html,/data-act="cleaning-run" disabled/);
  await f.manager.action('cleaning-run');assert.equal(f.calls(),0);
 }
});
test('model setup roundtrip keeps the same source, manual edits and review position, with fresh consent',async()=>{
 const f=await fixture(),draft=f.get();draft.reviewer='Human reviewer';draft.selectedRow=2;
 f.manager.input({target:{value:'Manual agent',dataset:{cleaningRow:'2',cleaningSegment:'row',cleaningField:'agent'}}});
 f.manager.input({target:{value:'Checked synthetic source',dataset:{cleaningRow:'2',cleaningSegment:'row',cleaningField:'agent',cleaningReason:'true'}}});
 f.manager.input({target:{id:'cleaning-consent',checked:true}});
 const source=draft.file,history=structuredClone(draft.draft.rows[0].history);
 await f.manager.action('cleaning-configure-model');assert.equal(f.settings(),draft);assert.equal(f.get().type,'model-settings');
 f.setConfig({configured:true,connectionTested:true,model:'Synthetic'});f.manager.resume(draft);
 assert.equal(f.get(),draft);assert.equal(draft.file,source);assert.equal(draft.reviewer,'Human reviewer');assert.equal(draft.selectedRow,2);
 assert.deepEqual(draft.draft.rows[0].history,history);assert.equal(draft.draft.rows[0].fields.agent,'Manual agent');
 assert.equal(draft.draft.rows[0].manual.agent.reason,'Checked synthetic source');assert.equal(draft.consent,false);assert.equal(draft.consentBinding,null);assert.equal(f.calls(),0);
 assert.match(f.manager.dialog(),/data-act="cleaning-run" disabled/);
});
test('English recovery guidance translates UI and preserves original source',async t=>{
 setLocale('en',{storage:null});t.after(()=>setLocale('zh',{storage:null}));
 const f=await fixture(),html=f.manager.dialog();
 assert.match(html,/Configure and test the model/);assert.doesNotMatch(html,/先配置并测试模型/);
 assert.ok(html.includes('客户：合成问题'));
});
