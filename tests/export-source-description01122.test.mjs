import test from 'node:test';
import assert from 'node:assert/strict';
import {businessExportView} from '../public/business-export-view.mjs';
import {setLocale,getLocale} from '../public/i18n.mjs';
import {SYSTEM_EC_HEADERS} from '../public/ecommerce-system-source.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';
import {workbook} from '../public/io.mjs';
import {reportFixture,managerState,businessUI} from './business-report-fixtures.mjs';

const card=html=>{
 const match=html.match(/<article class="panel bd-file"><span class="bd-file-kind">EXCEL<\/span>[\s\S]*?<\/article>/);
 assert.ok(match,'Excel card must render');return match[0];
};
function render(state,snapshot,language){
 const previous=getLocale();
 try{setLocale(language,{storage:null});return card(businessExportView(state,businessUI(),snapshot?{result:{snapshot}}:{}));}
 finally{setLocale(previous,{storage:null});}
}
async function systemState(extraColumns=0){
 const headers=[...SYSTEM_EC_HEADERS,...Array.from({length:extraColumns},(_,i)=>`Source extension ${i+1}`)];
 const values=headers.map((_,i)=>({4:'VMALL-MX-HWB2C',5:'Synthetic review',6:'Synthetic reply',7:'5',8:'Synthetic administrator',9:'2026-11-24 09:00:00',16:'2026-11-24 10:00:00'}[i]??(i>=23?`Original extension ${i}`:'')));
 const bytes=await workbook([{name:'Synthetic source',headers,rows:[values]}]);
 const parsed=await parseEcommerceFile({name:'Synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes},{standardOnly:true});
 assert.equal(parsed.valid,true,JSON.stringify(parsed.errors));
 const state=managerState();state.sessions=parsed.sessions.map(s=>({...s,taskId:'task-delivery'}));return state;
}

test('new standard EC imports describe their actual source width without legacy human or 43-column claims',async()=>{
 for(const extra of [0,2]){
  const state=await systemState(extra),before=structuredClone(state);
  for(const language of ['zh','en']){
   const html=render(state,null,language);
   assert.match(html,language==='zh'?new RegExp(`保留${23+extra}个原始列`):new RegExp(`Preserves ${23+extra} original source columns`));
   assert.match(html,language==='zh'?/评价／回复译文、五项检核/:/comment\/reply translations, five-check results/);
   assert.match(html,language==='zh'?/冻结模板/:/frozen template/);
   assert.doesNotMatch(html,/固定43列|first 43 columns|AI与人工留痕|AI\/human history|历史人工|historical human/i);
  }
  assert.deepEqual(state,before,'rendering must preserve source rows and task data');
 }
});

test('saved new-format descriptions use frozen headers instead of changed current task width',async()=>{
 const state=await systemState(2),snapshot={...reportFixture().snapshot,sourceFormat:'business-export-23.v1',systemSourceHeaders:[...SYSTEM_EC_HEADERS,'Frozen extension']};
 const before=structuredClone({state,snapshot});
 for(const language of ['zh','en']){
  const html=render(state,snapshot,language);
  assert.match(html,language==='zh'?/保留24个原始列/:/Preserves 24 original source columns/);
  assert.doesNotMatch(html,/25|43|AI\/human history|AI与人工留痕/);
 }
 assert.deepEqual({state,snapshot},before);
});

test('legacy snapshots retain frozen 22/43-column guidance and frozen extension counts',async()=>{
 const state=await systemState(2),snapshot=reportFixture().snapshot;
 snapshot.extensions={headers:['Frozen extra'],standards:['']};
 const before=structuredClone(snapshot);
 for(const language of ['zh','en']){
  const html=render(state,snapshot,language);
  assert.match(html,language==='zh'?/原始22列.*固定43列.*保留1个原始扩展列/:/22 original columns.*first 43 columns.*1 unchanged original extension columns/);
 }
 delete snapshot.extensions;
 for(const language of ['zh','en'])assert.match(render(state,snapshot,language),language==='zh'?/保留0个原始扩展列/:/0 unchanged original extension columns/);
 assert.deepEqual({...snapshot,extensions:before.extensions},before);
});

test('new source format does not imply exactly 23 physical columns after reviewed conversion',()=>{
 const state=managerState(),snapshot={...reportFixture().snapshot,sourceFormat:'business-export-23.v1',systemSourceHeaders:Array.from({length:22},(_,i)=>`Reviewed original ${i+1}`)};
 for(const language of ['zh','en']){
  const html=render(state,snapshot,language);
  assert.match(html,language==='zh'?/保留22个原始列/:/Preserves 22 original source columns/);
  assert.doesNotMatch(html,/43|AI\/human history|AI与人工留痕/);
 }
});

test('unloaded new-format source width remains unspecified rather than fabricated',()=>{
 const state=managerState(),snapshot={...reportFixture().snapshot,sourceFormat:'business-export-23.v1'};
 for(const language of ['zh','en']){
  const html=render(state,snapshot,language);
  assert.match(html,language==='zh'?/保留全部原始列/:/Preserves all original source columns/);
  assert.doesNotMatch(html,/22|23|43/);
 }
});
