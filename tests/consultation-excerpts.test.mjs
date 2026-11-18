import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../public/consultation-excerpts.mjs',import.meta.url);
async function selector(){assert.ok(existsSync(url),'缺少咨询案例关键选摘共享函数');return(await import(url)).selectConsultationCaseExcerpts;}
test('consultation excerpts select grounded Fail evidence and adjacent customer/service turns in source order',async()=>{
  const select=await selector(),record={turns:[{id:1,role:'客户',text:'背景'},{id:2,role:'系统',text:'系统内容'},{id:3,role:'客户',text:'原始问题'},{id:4,role:'客服',text:'原始回答'},{id:5,role:'客户',text:'后续追问'},{id:6,role:'客服',text:'后续回答'}],final:[{verdict:'Fail',evidence:[4,4,999]},{verdict:'Pass',evidence:[1]}]};
  assert.deepEqual(select(record),[{id:3,role:'客户',text:'原始问题',basis:'context'},{id:4,role:'客服',text:'原始回答',basis:'evidence'},{id:5,role:'客户',text:'后续追问',basis:'context'}]);
});
test('consultation excerpts cap six unique turns and label an evidence-free fallback as context',async()=>{
  const select=await selector(),turns=Array.from({length:12},(_,i)=>({id:i+1,role:i%2?'客服':'客户',text:`完整原文${i+1}`}));
  assert.equal(select({turns,final:[{verdict:'Fail',evidence:[2,4,6,8,10,12]}]}).length,6);
  assert.deepEqual(select({turns,final:[{verdict:'Fail',evidence:[999]}]}),[{...turns[0],basis:'context'},{...turns[1],basis:'context'}]);
  assert.deepEqual(select({turns:[{id:1,role:'系统',text:'不输出'}],final:[]}),[]);
});
