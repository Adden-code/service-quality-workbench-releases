import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {setLocale,t as uiT} from '../public/i18n.mjs';
import {IMPORT098_EN} from '../public/import098-locale-en.mjs';
const dictionaryUrl=new URL('../public/workflow096-locale-en.mjs',import.meta.url);
const dictionary=existsSync(dictionaryUrl)?(await import(dictionaryUrl)).WORKFLOW096_EN:{};
test('workflow096 English dictionary covers cleaning, awareness, audit, recovery and release boundaries',()=>{
 for(const key of ['模型辅助清洗会话','采用首条消息时间','重新选择文件并新建清洗草稿','已恢复本页内存中的未完成清洗草稿，已有模型调用和人工修改均保留。','真实49会话/1735轮次基准验收尚未完成，需内网验收后上线；当前仅支持已授权合成内测，不代表准确率达标。','待处理片段','来源未提供，补录需写原因','清洗报告计数与逐行留痕不一致。','清洗须先确认材料获准发送至当前已测试接口。'])assert.equal(typeof dictionary[key],'string',key);
});
test('English values contain no Chinese UI copy and preserve numeric placeholders',()=>{
 assert.ok(Object.keys(dictionary).length>=100);
 for(const [key,value] of Object.entries(dictionary)){
  assert.equal(typeof value,'string',key);assert.ok(value.trim(),key);assert.doesNotMatch(value,/[\u3400-\u9fff]/u,key);
  assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...value.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),key);
 }
});
test('all static cleaning errors and source warnings have English counterparts',async()=>{
 for(const name of ['conversation-cleaning.mjs','conversation-cleaning-manager.mjs','../server/conversation-cleaning.mjs']){
  const source=await fs.readFile(new URL('../public/'+name,import.meta.url),'utf8');
  for(const match of source.matchAll(/(?:fail\(|new Error\(|notes\.push\(|warnings:\[)'([^']*[\u3400-\u9fff][^']*)'/gu))assert.equal(typeof ({...dictionary,...IMPORT098_EN})[match[1]],'string',match[1]);
 }
});
test('export labels and long final-conclusion notes translate numeric patterns in actual i18n',t=>{
 setLocale('en',{storage:null});t.after(()=>setLocale('zh',{storage:null}));
 assert.equal(uiT('已形成最终结论'),'Final conclusions');
 assert.equal(uiT('最终问题会话'),'Final failing conversations');
 assert.equal(uiT('最终结论及来源'),'Final conclusion and source');
 assert.equal(uiT('尚未运行 7 条'),'7 records not run');
 assert.equal(uiT('AI终判 12 · 人工确认 3'),'AI final 12 · Human confirmed 3');
 for(const message of ['文件工作区：AI终判 12 条，人工确认 3 条；待人工FAIL、UNCERTAIN及退回记录排除出最终质量分母。真实基准未标定。','AI终判独立标注来源；FAIL、UNCERTAIN与退回记录待本轮人工确认，初判不作为最终绩效结论。','AI终判 12 条，人工确认 3 条；仅最终质量结果进入统计，待人工记录排除；真实基准未标定。'])assert.doesNotMatch(uiT(message),/[\u3400-\u9fff]/u);
});
