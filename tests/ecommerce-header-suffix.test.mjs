import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {workbook} from '../public/io.mjs';
import {EC_HEADERS} from '../public/ecommerce-schema.mjs';
import {parseEcommerceFile} from '../public/ecommerce-input.mjs';

const original=()=>Array.from({length:22},(_,index)=>({8:'生成评论：产品体验良好。',9:'生成回复：感谢您的评价。',11:'生成管理员',12:'2026-10-30 10:00:00',13:'2026-10-30 11:00:00',14:'好评正向'}[index]||''));
const build=(headers=[...EC_HEADERS])=>workbook([{name:'Sheet4',headers,rows:[Array(22).fill(''),original()]}]);
const parse=bytes=>parseEcommerceFile({name:'表头兼容性生成.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
const accepted=async bytes=>{const result=await parse(bytes);assert.equal(result.valid,true,result.errors.join('；'));assert.equal(result.sessions.length,1);return result;};
const rejected=async bytes=>{const result=await parse(bytes);assert.equal(result.valid,false,'错位、跨列或额外实值必须拒绝');assert.deepEqual(result.sessions,[]);assert.equal(result.turnCount,0);assert.match(result.errors.join('；'),/第1行|第3行|22列|表头/);};
async function edit(bytes,change){const zip=await JSZip.loadAsync(bytes);await change(zip);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});}
async function sheet(zip,change){const name='xl/worksheets/sheet1.xml';zip.file(name,change(await zip.file(name).async('string')));}
const realForms=[
  [14,'评价类型 好评正向：4-5分，评论内容积极； 好评负向：4-5分，评论内容消极； 中评：2-3分 差评：1分'],
  [20,'Overall Passed If one item fails, the test is failed. 整体是否通过 如果有一项判定为Fail，则为Fail'],
  [21,'Description of the specific problem point. 具体问题点描述'],
];
for(const[index,header]of realForms)test(`business header accepts undelimited explanatory suffix at column ${index+1}`,async()=>{
  const headers=[...EC_HEADERS];headers[index]=header;const result=await accepted(await build(headers));assert.equal(result.sessions[0].ecommerce.headers[index],header);assert.deepEqual(result.sessions[0].ecommerce.raw,original());
});

for(const format of ['inline','shared'])test(`business header accepts two ${format} rich-text runs with whitespace and newline`,async()=>{
  const expected='评价类型   \n好评正向：4-5分，评论内容积极； 好评负向：4-5分，评论内容消极。';
  const runs='<r><rPr><b/></rPr><t xml:space="preserve">评价类型   \n</t></r><r><t>好评正向：4-5分，评论内容积极； 好评负向：4-5分，评论内容消极。</t></r>';
  const bytes=await edit(await build(),async zip=>{
    await sheet(zip,xml=>xml.replace(/<c r="O1"[^>]*>[\s\S]*?<\/c>/,format==='inline'?`<c r="O1" t="inlineStr"><is>${runs}</is></c>`:'<c r="O1" t="s"><v>0</v></c>'));
    if(format==='shared'){
      zip.file('xl/sharedStrings.xml',`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si>${runs}</si></sst>`);
      const contentTypes='[Content_Types].xml',relations='xl/_rels/workbook.xml.rels';
      zip.file(contentTypes,(await zip.file(contentTypes).async('string')).replace('</Types>','<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'));
      zip.file(relations,(await zip.file(relations).async('string')).replace('</Relationships>','<Relationship Id="rIdSharedHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'));
    }
  });
  const result=await accepted(bytes);assert.equal(result.sessions[0].ecommerce.headers[14],expected);
});

test('arbitrary suffixes and explanatory mentions of other columns are accepted without arbitrary contains matching',async()=>{
  for(const[index,header]of [[14,'评价类型X'],[12,'Comment Timezone'],[12,'Comment Timeline'],[12,'评论时间戳错误'],[9,'回复内容 应结合评论内容和评价类型进行针对性回复']]){
    const headers=[...EC_HEADERS];headers[index]=header;await accepted(await build(headers));
  }
  for(const header of ['before 评价类型','not 评价类型']){const headers=[...EC_HEADERS];headers[14]=header;await rejected(await build(headers));}
});

test('concatenated labels from different columns cannot be assigned to any of the 22 positions',async()=>{
  for(let index=0;index<22;index++){const headers=[...EC_HEADERS];headers[index]='展示商品ID评价类型';await rejected(await build(headers));}
  for(const[index,header]of [[4,'展示商品ID评价类型评分'],[12,'Comment Time / First Reply Time'],[8,'Comment Time']]){
    const headers=[...EC_HEADERS];headers[index]=header;await rejected(await build(headers));
  }
});

test('all22 core fields remain mandatory and reordered unique headers map after trimming empty styled tails',async()=>{
  const swapped=[...EC_HEADERS];[swapped[8],swapped[9]]=[swapped[9],swapped[8]];
  const reordered=await accepted(await build(swapped));assert.equal(reordered.sessions[0].ecommerce.raw[8],original()[9]);assert.equal(reordered.sessions[0].ecommerce.raw[9],original()[8]);await rejected(await build(EC_HEADERS.slice(0,-1)));
  const extraHeader=await edit(await build([...EC_HEADERS,'额外实值列']),zip=>sheet(zip,xml=>xml.replace('</row>','<c r="AD1" s="1"/></row>')));const withHeader=await accepted(extraHeader);assert.deepEqual(withHeader.sessions[0].ecommerce.extensions.headers,['额外实值列']);
  const extraValue=await edit(await build(),zip=>sheet(zip,xml=>xml.replace(/(<row r="3"[^>]*>[\s\S]*?)<\/row>/,'$1<c r="W3" t="inlineStr"><is><t>额外实值</t></is></c><c r="AD3" s="1"/></row>')));const withValue=await accepted(extraValue);assert.deepEqual(withValue.sessions[0].ecommerce.extensions.raw,['额外实值']);
  const stylesOnly=await edit(await build(),zip=>sheet(zip,xml=>xml.replace('</row>','<c r="W1" s="1"/><c r="AD1" s="1"/></row>')));await accepted(stylesOnly);
});

test('maximum header text remains usable while oversized repeated labels reject before record creation',async()=>{
  const headers=[...EC_HEADERS];headers[14]='评价类型'.repeat(5000);
  const result=await accepted(await build(headers));assert.equal(result.sessions[0].ecommerce.headers[14].length,20000);
  headers[14]='评价类型'.repeat(250000);
  const invalid=await parse(await build(headers));assert.equal(invalid.valid,false);assert.deepEqual(invalid.sessions,[]);assert.match(invalid.errors.join('；'),/第1行.*20000/);
});
