import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import JSZip from 'jszip';
import {workbook,readXlsx} from '../public/io.mjs';

const url=new URL('../public/input-profiles.mjs',import.meta.url),api=existsSync(url)?await import(url):{};
const need=name=>{assert.equal(typeof api[name],'function','应实现 '+name);return api[name];};
const file=(bytes,name='原业务表.xlsx',size=bytes.byteLength)=>({name,size,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
const chatHeaders=['记录号','创建时间','发言人类型','聊天内容','配送阶段','星级','留档备注','机型'];
const chatRow=(id='CHAT-1',role='buyer',content='虚构客户询问颜色',extra={})=>[id,'2026-10-29 09:30:00',role,content,extra.stage||'待发货',extra.rating??'5',extra.note||'仅留档',extra.product||'虚构清音Q3'];
const profile=(overrides={})=>({id:'PROFILE-CHAT',name:'虚构聊天原表',version:1,scene:'新品产品咨询',layout:'turns',sheet:'聊天记录',headerRow:1,fields:{id:'记录号',startedAt:'创建时间',role:'发言人类型',text:'聊天内容',product:'机型'},roleMap:{buyer:'客户',seller:'客服'},dateFormat:'beijing',defaults:{channel:'虚构业务渠道',completeness:'完整'},extras:[{key:'stage',column:'配送阶段',label:'配送阶段',type:'text',purpose:'inspect',required:false},{key:'rating',column:'星级',label:'评价星级',type:'number',purpose:'inspect',required:true},{key:'note',column:'留档备注',label:'备注',type:'text',purpose:'retain',required:false}],ruleIds:['R001'] ,...overrides});
const pairHeaders=['评论编号','评论时间','用户评价','商家答复','评分','工单'];
const pairProfile=(overrides={})=>profile({id:'PROFILE-PAIR',name:'虚构评论原表',scene:'电商评论回复',layout:'pair',sheet:'评论',fields:{id:'评论编号',startedAt:'评论时间',customerText:'用户评价',agentText:'商家答复'},roleMap:{},dateFormat:'iso',extras:[{key:'rating',column:'评分',label:'评分',type:'number',purpose:'inspect',required:true},{key:'ticket',column:'工单',label:'工单',type:'text',purpose:'retain',required:false}],...overrides});
const sheet=(name,headers,rows)=>workbook([{name,headers,rows}]);
async function parse(bytes,p=profile()){return need('parseMappedInput')(file(bytes),p);}
async function reject(bytes,p,pattern){const result=await parse(bytes,p);assert.equal(result.valid,false);assert.deepEqual(result.sessions,[]);assert.equal(result.turnCount,0);assert.match(result.errors.join('；'),pattern);assert.equal(result.importMappingSnapshot,undefined);return result;}
async function mutate(bytes,change){const zip=await JSZip.loadAsync(bytes);const location='xl/worksheets/sheet1.xml';zip.file(location,change(await zip.file(location).async('string')));return zip.generateAsync({type:'uint8array'});}

test('profile validation returns a detached pure configuration and rejects embedded samples',()=>{
 const p=profile(),checked=need('validateInputProfile')(p);
 assert.deepEqual(checked,p);checked.fields.id='别的列';assert.equal(p.fields.id,'记录号');
 for(const addition of [{sampleRows:[['不应保存样本']]},{apiKey:'not-a-real-key'},{fileName:'客户原文.xlsx'}])assert.throws(()=>api.validateInputProfile({...p,...addition}),/字段|配置|样本|不支持/);
 assert.throws(()=>api.validateInputProfile({...p,version:0}),/版本|version/);
 assert.throws(()=>api.validateInputProfile({...p,scene:'任意新场景'}),/场景/);
});

test('profiles require explicit factual mappings and completeness, and bounded unique extras',()=>{
 const validate=need('validateInputProfile');
 assert.throws(()=>validate(profile({fields:{role:'发言人类型',text:'聊天内容'}})),/标识|id|时间|startedAt/);
 assert.throws(()=>validate(profile({defaults:{}})),/完整性|completeness/);
 assert.throws(()=>validate(profile({defaults:{completeness:'完整',startedAt:'2026-10-29'}})),/默认|常量|字段/);
 assert.throws(()=>validate(profile({extras:[profile().extras[0],profile().extras[0]]})),/重复/);
 assert.throws(()=>validate(profile({extras:[{...profile().extras[0],key:'ambiguous@1'}]})),/key|键|字段标识/);
 assert.throws(()=>validate(profile({extras:[{...profile().extras[0],purpose:'anything'}]})),/用途|purpose/);
});

test('XLSX inspection exposes physical rows so a later header row is selectable',async()=>{
 const bytes=await sheet('聊天记录',['虚构导出说明',...Array(chatHeaders.length-1).fill('')],[chatHeaders,chatRow()]);
 const inspected=await need('inspectMappedFile')(file(bytes));
 assert.equal(inspected.valid,true,inspected.errors.join('；'));assert.equal(inspected.sheets[0].name,'聊天记录');
 assert.deepEqual(inspected.sheets[0].rows.map(r=>r.row),[1,2,3]);
 assert.equal(inspected.sheets[0].rows[1].values[0],'记录号');assert.ok(Array.isArray(inspected.sheets[0].headers));
 const mapped=await parse(bytes,profile({headerRow:2}));assert.equal(mapped.valid,true,mapped.errors.join('；'));
 assert.equal(mapped.sessions[0].contextFields[0].source.row,3);
});

test('turn layout groups stable IDs, maps roles and preserves row-specific context and retained columns',async()=>{
 const bytes=await sheet('聊天记录',chatHeaders,[chatRow(),chatRow('CHAT-1','seller','虚构客服说明有银白色',{stage:'已出库',rating:'0'}),chatRow('CHAT-2')]);
 const result=await parse(bytes);
 assert.equal(result.valid,true,result.errors.join('；'));assert.equal(result.sessions.length,2);assert.equal(result.turnCount,3);
 const first=result.sessions[0];
 assert.equal(first.startedAt,'2026-10-29T09:30:00+08:00');assert.equal(first.scene,'新品产品咨询');
 assert.equal(first.completeness,'完整');assert.equal(first.channel,'虚构业务渠道');
 assert.deepEqual(first.turns.map(t=>[t.id,t.role,t.text]),[[1,'客户','虚构客户询问颜色'],[2,'客服','虚构客服说明有银白色']]);
 assert.deepEqual(first.contextFields.map(f=>[f.key,f.value,f.turnId]),[['stage@1','待发货',1],['rating@1',5,1],['stage@2','已出库',2],['rating@2',0,2]]);
 assert.deepEqual(first.contextFields[2].source,{sheet:'聊天记录',row:3,column:'配送阶段'});
 assert.equal(first.turns[0].metadata['留档备注'],'仅留档');
 assert.ok(first.contextFields.every(f=>!f.key.startsWith('note')));
 assert.deepEqual(result.importMappingSnapshot,{profile:profile()});assert.notEqual(result.importMappingSnapshot.profile,profile());
 assert.equal(result.importMappingSnapshot.profile.sampleRows,undefined);
});

test('pair layout creates real customer and agent turns without treating numeric zero as missing',async()=>{
 const result=await parse(await sheet('评论',pairHeaders,[['COMMENT-1','2026-10-29T09:00:00+08:00','虚构用户称充电慢','虚构商家请核对充电器','0','TICKET-7']]),pairProfile());
 assert.equal(result.valid,true,result.errors.join('；'));assert.equal(result.sessions[0].scene,'电商评论回复');assert.equal(result.turnCount,2);
 assert.deepEqual(result.sessions[0].turns.map(t=>[t.id,t.role,t.text]),[[1,'客户','虚构用户称充电慢'],[2,'客服','虚构商家请核对充电器']]);
 assert.deepEqual(result.sessions[0].contextFields,[{key:'rating',label:'评分',type:'number',value:0,source:{sheet:'评论',row:2,column:'评分'}}]);
 assert.equal(result.sessions[0].metadata['工单'],'TICKET-7');
});

test('empty reply is visible as a warning and never becomes invented reply content',async()=>{
 const result=await parse(await sheet('评论',pairHeaders,[['COMMENT-1','2026-10-29T09:00:00Z','只有客户评论','','5','']]),pairProfile());
 assert.equal(result.valid,true,result.errors.join('；'));assert.equal(result.turnCount,1);
 assert.equal(result.sessions[0].turns[0].role,'客户');assert.ok(result.warnings.some(w=>/回复.*空|未.*回复/.test(w)));
});

test('different nonempty session attributes within one chat are rejected rather than overwritten',async()=>{
 await reject(await sheet('聊天记录',chatHeaders,[chatRow(),chatRow('CHAT-1','seller','回复',{product:'另一虚构型号'})]),profile(),/聊天记录第3行.*机型.*冲突/);
 const later=chatRow('CHAT-1','seller','回复');later[1]='2026-10-29 10:00:00';
 await reject(await sheet('聊天记录',chatHeaders,[chatRow(),later]),profile(),/聊天记录第3行.*创建时间.*冲突/);
});

test('required missing columns, duplicate headers and populated unnamed columns reject whole input',async()=>{
 await reject(await sheet('聊天记录',chatHeaders.map(h=>h==='记录号'?'未映射':h),[chatRow()]),profile(),/记录号.*缺|缺.*记录号/);
 await reject(await sheet('聊天记录',[...chatHeaders,'星级'],[[...chatRow(),'1']]),profile(),/表头.*重复|重复.*表头/);
 await reject(await sheet('聊天记录',[...chatHeaders,''],[[...chatRow(),'不能丢弃']]),profile(),/第2行.*列.*表头|第2行.*列.*字段/);
});

test('missing IDs, unmapped roles and blank content are never silently skipped',async()=>{
 await reject(await sheet('聊天记录',chatHeaders,[chatRow(),chatRow('')]),profile(),/第3行.*记录号/);
 await reject(await sheet('聊天记录',chatHeaders,[chatRow('CHAT-1','unknown')]),profile(),/第2行.*发言人类型.*角色/);
 await reject(await sheet('聊天记录',chatHeaders,[chatRow('CHAT-1','buyer',' ')]),profile(),/第2行.*聊天内容/);
});

test('date formats require a real calendar and do not interpret numeric serials or guess zones',async()=>{
 const invalid=chatRow();invalid[1]='2026-02-30 09:00:00';await reject(await sheet('聊天记录',chatHeaders,[invalid]),profile(),/第2行.*创建时间.*日期|第2行.*创建时间.*时间/);
 const serial=chatRow();serial[1]='46324.5';await reject(await sheet('聊天记录',chatHeaders,[serial]),profile(),/创建时间/);
 const nozone=chatRow();nozone[1]='2026-10-29T09:30:00';await reject(await sheet('聊天记录',chatHeaders,[nozone]),profile({dateFormat:'iso'}),/创建时间/);
 const leap=chatRow();leap[1]='2024-02-29 09:30';const result=await parse(await sheet('聊天记录',chatHeaders,[leap]));
 assert.equal(result.valid,true,result.errors.join('；'));assert.equal(result.sessions[0].startedAt,'2024-02-29T09:30:00+08:00');
});

test('required extras and numeric conversions identify original row and field',async()=>{
 const empty=chatRow();empty[5]='';await reject(await sheet('聊天记录',chatHeaders,[empty]),profile(),/第2行.*星级.*必填/);
 const unit=chatRow();unit[5]='5星';await reject(await sheet('聊天记录',chatHeaders,[unit]),profile(),/第2行.*星级.*数/);
 const sparse=await mutate(await sheet('聊天记录',chatHeaders,[unit]),xml=>xml.replace(/r="([A-Z]*)2"/g,(_,col)=>'r="'+col+'20"').replace('A1:H2','A1:H20'));
 await reject(sparse,profile(),/第20行.*星级.*数/);
});

test('unmapped original columns are retained but excluded from model context',async()=>{
 const p=profile({extras:[]}),bytes=await sheet('聊天记录',[...chatHeaders,'隐藏备注'],[[...chatRow(),'只供人工留档']]);
 const result=await parse(bytes,p);assert.equal(result.valid,true,result.errors.join('；'));
 assert.deepEqual(result.sessions[0].contextFields,[]);assert.equal(result.sessions[0].turns[0].metadata['隐藏备注'],'只供人工留档');
});

test('selected worksheet is explicit and nonselected populated sheets are named in warnings',async()=>{
 const bytes=await workbook([{name:'聊天记录',headers:chatHeaders,rows:[chatRow()]},{name:'辅助表',headers:['说明'],rows:[['不在本次导入范围']]}]);
 const result=await parse(bytes);assert.equal(result.valid,true,result.errors.join('；'));assert.ok(result.warnings.some(w=>w.includes('辅助表')));
 await reject(bytes,profile({sheet:'不存在'}),/不存在|工作表/);
});

test('file and standard business limits remain enforced by mapped import',async()=>{
 const inspect=need('inspectMappedFile'),bytes=await sheet('聊天记录',chatHeaders,[chatRow()]);
 for(const bad of [file(bytes,'unsafe.csv'),file(bytes,'large.xlsx',8*1024*1024+1),file(new Uint8Array(),'empty.xlsx')]){
  const result=await inspect(bad);assert.equal(result.valid,false);assert.deepEqual(result.sheets,[]);
 }
 await reject(await sheet('聊天记录',chatHeaders,[chatRow('CHAT-1','buyer','文'.repeat(20001))]),profile(),/20000/);
 await reject(await sheet('聊天记录',chatHeaders,Array.from({length:501},(_,i)=>chatRow('CHAT-1','buyer','第'+i+'轮'))),profile(),/500/);
 await reject(await sheet('聊天记录',chatHeaders,Array.from({length:501},(_,i)=>chatRow('CHAT-'+i))),profile(),/500/);
});

test('existing XLSX protections reject formulas before both inspection and parsing',async()=>{
 const bytes=await mutate(await sheet('聊天记录',chatHeaders,[chatRow()]),xml=>xml.replace('<is>','<f>SUM(1,1)</f><is>'));
 const inspected=await need('inspectMappedFile')(file(bytes));assert.equal(inspected.valid,false);assert.match(inspected.errors.join('；'),/公式/);
 await reject(bytes,profile(),/公式/);
});

test('mapped numeric evidence never silently rounds unsafe integer values',async()=>{
 const unsafe=chatRow();unsafe[5]='9007199254740993';
 await reject(await sheet('聊天记录',chatHeaders,[unsafe]),profile(),/第2行.*星级.*精度|第2行.*星级.*安全/);
 const decimal=chatRow();decimal[5]='4.5';
 const result=await parse(await sheet('聊天记录',chatHeaders,[decimal]));assert.equal(result.valid,true,result.errors.join('；'));
 assert.equal(result.sessions[0].contextFields.find(f=>f.key==='rating@1').value,4.5);
});

test('mapped context cannot emit worksheet positions outside the backend evidence contract',async()=>{
 const tooLarge=await mutate(await sheet('聊天记录',chatHeaders,[chatRow()]),xml=>xml.replace(/r="([A-Z]*)2"/g,(_,col)=>'r="'+col+'1048577"'));
 await reject(tooLarge,profile(),/物理行|行号/);
 const repeated=await mutate(await sheet('聊天记录',chatHeaders,[chatRow(),chatRow('CHAT-1','seller','回复')]),xml=>xml.replace(/r="([A-Z]*)3"/g,(_,col)=>'r="'+col+'02"'));
 await reject(repeated,profile(),/物理行|行号/);
});

test('mapped ISO timestamps preserve the precision already accepted by standard input',async()=>{
 const p=pairProfile(),row=['COMMENT-1','2026-10-29T09:00:00.123456789+08:00','虚构评论','虚构回复','5',''];
 const result=await parse(await sheet('评论',pairHeaders,[row]),p);
 assert.equal(result.valid,true,result.errors.join('；'));assert.equal(result.sessions[0].startedAt,row[1]);
});
