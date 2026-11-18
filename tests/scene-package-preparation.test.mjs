import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSceneDocument,parseScenePackage,prepareScenePackagePrompt} from '../server/scene-package-preparation.mjs';
import {SCENE_CONTRACT} from '../public/scene-configuration.mjs';
const text='合成规则：服务礼仪。符合：问候。不符合：辱骂。例外：原文缺失。\r\n辅助判定：用户意图。\n交付：概况与检核列。';
const input={sceneId:'新品产品咨询',allowedRuleCategories:['整体判定','服务礼仪','探需','导购'],blocks:[{id:'document',text,location:{start:0,end:text.length},headingPath:['synthetic']}],source:{name:'synthetic.txt',sha256:'a'.repeat(64),size:Buffer.byteLength(text)}};
const evidence=()=>[{blockId:'document',quote:text,start:0,end:text.length}];
const output=()=>({rules:[{title:'合成礼仪',category:'服务礼仪',scope:'合成范围',passCriteria:'问候',failCriteria:'辱骂',exceptionCriteria:'缺失时无法判定',dependencies:[],evidence:evidence()}],auxiliary:[],delivery:{title:'合成报告',groupBy:'product',sections:[{key:'overview',title:'概况',evidence:evidence()}],groups:[{key:'unrelated',label:'独立列组',parentKey:'',evidence:evidence()}],columns:[{candidateIndex:0,label:'合成检核',generator:'rule',field:'',groupKey:'unrelated',condition:null,evidence:evidence()}],evidence:evidence()},timingStandards:[],unmappedBlocks:[],warnings:[]});
test('three-part prompt explicitly forbids all AI timing numbers and retains category enum and raw blocks',()=>{
 const p=prepareScenePackagePrompt(input);assert.equal(p.promptVersion,SCENE_CONTRACT);assert.match(p.messages[0].content,/即使文档含数值也不输出/);assert.match(p.messages[0].content,/逐字子串/);assert.equal(JSON.parse(p.messages[1].content).blocks[0].text,text);
 const result=parseScenePackage(JSON.stringify(output()),input);assert.equal(result.rules.length,1);assert.equal(result.rejected.length,0);assert.equal(result.delivery.columns[0].groupKey,'unrelated');
});
test('quote text and UTF16 offsets are both mandatory, with no whitespace or CRLF normalization',()=>{
 for(const edit of [e=>e.start++,e=>e.quote=e.quote.replace('\r\n','\n'),e=>e.end--,e=>e.blockId='missing']){const o=output();edit(o.rules[0].evidence[0]);const parsed=parseScenePackage(JSON.stringify(o),input);assert.equal(parsed.rules.length,0);assert.ok(parsed.rejected.some(r=>r.kind==='rule'));assert.equal(parsed.delivery,null);}
});
test('AI invented categories and formal IDs are rejected without losing other valid suggestions',()=>{
 const o=output();o.rules.push({...structuredClone(o.rules[0]),category:'模型自造'});o.auxiliary=[{capability:'site',phase:'pre',dependsOn:[],taxonomy:null,evidence:evidence()}];const parsed=parseScenePackage(JSON.stringify(o),input);assert.equal(parsed.rules.length,1);assert.equal(parsed.auxiliary.length,1);assert.equal(parsed.rejected.length,1);
 o.rules[0].id='NP-R999';assert.equal(parseScenePackage(JSON.stringify(o),input).rules.length,0);
});
test('any supplied timing standard rejects the entire response, even if the quote is literal',()=>{
 const o=output();o.timingStandards=[{site:'合成',value:60,evidence:evidence()}];assert.throws(()=>parseScenePackage(JSON.stringify(o),input),/禁止生成/);
});
test('exception tables preserve NA versus continue-inspection and reject invented outcome types',()=>{
 const o=output();o.rules[0].exceptionTable=[{id:'case-1',condition:'合成需要继续检查的场景',requires:[],result:'继续检核',priority:1,evidence:evidence()},{id:'case-2',condition:'合成不适用场景',requires:[],result:'不适用',priority:2,evidence:evidence()}];
 const parsed=parseScenePackage(JSON.stringify(o),input);assert.deepEqual(parsed.rules[0].exceptionTable.map(e=>e.result),['继续检核','不适用']);assert.match(prepareScenePackagePrompt(input).messages[0].content,/继续检核不等于通过/);
 o.rules[0].exceptionTable[0].result='符合';assert.equal(parseScenePackage(JSON.stringify(o),input).rules.length,0);
});
test('delivery mapping cannot skip or duplicate rules and refuses unknown code fields',()=>{
 const o=output();o.delivery.columns.push({...o.delivery.columns[0],label:'重复'});assert.equal(parseScenePackage(JSON.stringify(o),input).delivery,null);
 const s=output();s.delivery.script='alert(1)';assert.equal(parseScenePackage(JSON.stringify(s),input).delivery,null);
});
test('UTF8 text extraction preserves line endings and rejects unsupported or oversized documents',async()=>{
 const b=Buffer.from(text);const doc=await extractSceneDocument({bytes:b,name:'合成.txt',size:b.length,sha256:'a'.repeat(64)});assert.equal(doc.blocks[0].text,text);
 await assert.rejects(()=>extractSceneDocument({bytes:Buffer.from([0xff]),name:'bad.txt'}),/UTF-8/);await assert.rejects(()=>extractSceneDocument({bytes:b,name:'scan.pdf'}),/当前支持/);await assert.rejects(()=>extractSceneDocument({bytes:Buffer.from('a'.repeat(100001)),name:'big.txt'}),/不会静默截断/);
});
