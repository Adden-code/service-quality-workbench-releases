import test from 'node:test';
import assert from 'node:assert/strict';
import {workbook} from '../public/io.mjs';
import {parseCleaningResult} from '../server/conversation-cleaning.mjs';
import {updateCleaningField,confirmCleaningRow} from '../public/conversation-cleaning.mjs';
import {createConversationCleaningManager} from '../public/conversation-cleaning-manager.mjs';
test('leaving during finish and reopening the paid draft never leaves it permanently loading',async()=>{
 let dialog=null,started,release;const entered=new Promise(r=>started=r),upload=new Promise(r=>release=r);
 const bytes=await workbook([{name:'Raw',headers:['会话ID','客服','消息详情'],rows:[['SYN-FINISH','Synthetic agent','Customer: synthetic message']]}]),file={name:'synthetic-finish.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
 let handedOff=0;
 const ctx={getDialog:()=>dialog,openDialog:d=>dialog=d,closeDialog:()=>dialog=null,renderDialog:()=>{},toast:()=>{},getModelConfig:()=>({configured:true,connectionTested:true,model:'synthetic'}),prepareConversationCleaning:async input=>parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:input.text,textQuote:input.text,role:'客户'}]}),input),uploadSource:async()=>{started();await upload;return{sha256:'b'.repeat(64),name:file.name,size:bytes.byteLength};},beginCleanedTask:()=>handedOff++};
 const manager=createConversationCleaningManager(ctx);await manager.action('cleaning-open');await manager.change({target:{id:'cleaning-file',files:[file]}});manager.input({target:{id:'cleaning-consent',checked:true}});await manager.action('cleaning-run');const paid=dialog;paid.reviewer='Reviewer';
 paid.draft=updateCleaningField(paid.draft,2,null,'startedAt','2026-11-11T09:00:00+08:00',{reason:'Verified the source timestamp.'});paid.draft=updateCleaningField(paid.draft,2,null,'completeness','完整',{reason:'Manually compared the complete source.'});paid.draft=confirmCleaningRow(paid.draft,2,{reviewer:paid.reviewer});
 const finishing=manager.action('cleaning-finish');await entered;await manager.action('cleaning-close');release();await finishing;assert.equal(handedOff,0);
 ctx.openDialog({type:'new-task',scene:'新品产品咨询'});await manager.action('cleaning-open');assert.equal(dialog,paid);assert.equal(dialog.loading,false);assert.equal(dialog.draft.rows[0].attempts.length,1);assert.doesNotMatch(manager.dialog(),/data-act="cleaning-finish" disabled/);
 await manager.action('cleaning-finish');assert.equal(handedOff,1);
});
