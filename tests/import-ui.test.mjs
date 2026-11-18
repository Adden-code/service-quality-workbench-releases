import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog} from '../public/catalog.mjs';
import {tasksView} from '../public/views.mjs';
import {catalogPage} from '../public/catalog-view.mjs';
import {manualResultCard} from '../public/business-review.mjs';
import {workbook} from '../public/io.mjs';

async function api(){const module=await import('../public/import-manager.mjs').catch(()=>null);assert.equal(typeof module?.createImportManager,'function','需要独立导入管理器');return module;}
function profile(){return{id:'P1',name:'业务颜色咨询',version:1,scene:'新品产品咨询',layout:'turns',sheet:'业务原表',headerRow:2,fields:{id:'业务编号',startedAt:'开始时间',role:'发言方',text:'内容'},roleMap:{访客:'客户',坐席:'客服'},dateFormat:'beijing',defaults:{completeness:'完整'},extras:[{key:'amount',column:'订单金额',label:'订单金额',type:'number',purpose:'inspect',required:true}],ruleIds:['R001']};}
function harness(initialDialog=null){
  let dialog=initialDialog,state={schemaVersion:1,tasks:[],sessions:[],activity:[]},catalog=createCatalog(),uploads=0,preparations=0,commits=0,begin=null;
  const ctx={getState:()=>state,getCatalog:()=>catalog,getUi:()=>({dataMode:'manual'}),getDialog:()=>dialog,openDialog:value=>{dialog=value;},closeDialog:()=>{dialog=null;},render(){},renderDialog(){},toast(){},download(){},
    commitWorkspace:async(updater)=>{commits++;const next=await updater({state:structuredClone(state),catalog:structuredClone(catalog)});state=next.state;catalog=next.catalog;return{state,catalog};},
    uploadSource:async()=>{uploads++;return{name:'规则原文.txt',sha256:'a'.repeat(64),size:20};},
    prepareRules:async()=>{preparations++;throw new Error('合成网络错误');},beginMappedTask:value=>{begin=value;}};
  return{ctx,get dialog(){return dialog;},get state(){return state;},get catalog(){return catalog;},get uploads(){return uploads;},get preparations(){return preparations;},get commits(){return commits;},get begin(){return begin;}};
}
const event=(id,value,extra={})=>({target:{id,value,dataset:{},...extra}});

test('file tasks and rule catalogs expose original-table, reusable profile and rule import entries',()=>{
  const state={tasks:[],sessions:[],activity:[]},html=tasksView(state,{dataMode:'manual',taskStatus:'全部',taskQuery:''});
  assert.match(html,/新建质检任务/);assert.match(html,/字段映射方案/);assert.doesNotMatch(html,/data-act="input-import"/);assert.match(html,/data-act="input-profiles"/);
  assert.match(catalogPage(createCatalog(),'rules',{}),/data-act="rule-import-open"/);
});

test('mapping dialog exposes explicit scene, layout, physical header row, date, roles and field purpose',async()=>{
  const {createImportManager}=await api(),h=harness({type:'input-mapping',profile:profile(),inspected:{sheets:[{name:'业务原表',headers:[],rows:[{row:2,values:['业务编号','开始时间','发言方','内容','订单金额']}]}]}}),manager=createImportManager(h.ctx),html=manager.dialog(h.dialog);
  for(const text of ['新品产品咨询','每行一轮','评论与回复成对','表头物理行','北京时间','角色对应','参与质检','仅留存','默认检查项'])assert.match(html,new RegExp(text));
  assert.match(html,/原表行列预览/);assert.match(html,/第2行/);
  assert.match(html,/订单金额/);assert.match(html,/input-preview/);assert.match(html,/input-save-profile/);assert.doesNotMatch(html,/data-act="input-begin"[^>]*>进入/);
});

test('profile changes save pure configuration and increment the existing version',async()=>{
  const {createImportManager}=await api(),h=harness(),manager=createImportManager(h.ctx);
  await manager.action('input-import',{});Object.assign(h.dialog,{profile:profile()});
  assert.equal(await manager.action('input-save-profile',{}),true);assert.equal(h.state.inputProfiles[0].version,1);
  await manager.action('input-profile-edit',{dataset:{id:'P1'}});manager.input(event('input-name','更新的配置名'));
  await manager.action('input-save-profile',{});assert.equal(h.state.inputProfiles[0].version,2);assert.equal(h.state.inputProfiles[0].name,'更新的配置名');assert.doesNotMatch(JSON.stringify(h.state.inputProfiles),/preview|inspected|sourceText|apiKey/);
});

test('profile save rejection retains the edited mapping and reports no success',async()=>{
  const {createImportManager}=await api(),h=harness({type:'input-mapping',profile:profile()}),manager=createImportManager({...h.ctx,commitWorkspace:async()=>{throw new Error('版本冲突');}});
  await manager.action('input-save-profile',{});assert.equal(h.dialog.profile.name,'业务颜色咨询');assert.match(h.dialog.error,/版本冲突/);assert.equal(h.state.inputProfiles,undefined);
});

test('a parsed preview hands the original file and frozen mapping back to the existing wizard',async()=>{
  const {createImportManager}=await api(),file={name:'业务.xlsx'},parsed={valid:true,sessions:[{id:'A1',scene:'新品产品咨询',topic:'颜色',turns:[{id:1,role:'客户',text:'红色？'}]}],turnCount:1,importMappingSnapshot:{profile:profile()}},h=harness({type:'input-mapping',profile:profile(),file,preview:parsed}),manager=createImportManager(h.ctx);
  assert.match(manager.dialog(h.dialog),/A1/);await manager.action('input-begin',{});assert.equal(h.begin.file,file);assert.deepEqual(h.begin.parsed,parsed);assert.deepEqual(h.begin.ruleIds,['R001']);assert.deepEqual(h.begin.importMappingSnapshot,parsed.importMappingSnapshot);
});

test('rule import explicitly prepares candidates and preserves the original text after a failed request',async()=>{
  const {createImportManager}=await api(),h=harness(),manager=createImportManager(h.ctx);await manager.action('rule-import-open',{});
  manager.input(event('rule-import-source-name','业务规则.txt'));manager.input(event('rule-import-text','必须回答客户关于颜色的提问。'));
  const html=manager.dialog(h.dialog);assert.match(html,/AI整理/);assert.match(html,/rule-import-prepare/);
  manager.change(event('rule-import-mode','excel'));assert.match(manager.dialog(h.dialog),/rule-import-file/);manager.change(event('rule-import-mode','text'));
  await manager.action('rule-import-prepare',{});assert.equal(h.preparations,1);assert.equal(h.dialog.sourceText,'必须回答客户关于颜色的提问。');assert.match(h.dialog.error,/合成网络错误/);assert.equal(h.commits,0);
});

function prepared(){return{type:'rule-import',scene:'新品产品咨询',sourceName:'规则原文.txt',sourceText:'原文：须回答颜色问题。',owner:'规则维护人',effectiveAt:'2026-10-29',policyIds:['P001'],mode:'text',prepared:{modelId:'glm-5.3-flash',promptVersion:'rule-preparation-ark-v1',requestId:'req-synthetic'},preparedAt:'2026-10-29T10:00:00+08:00',candidates:[{id:'NEW-COLOR',title:'颜色响应',category:'产品信息',scope:'颜色咨询',passCriteria:'完整回答颜色',failCriteria:'未回答颜色',exceptionCriteria:'未问颜色时不适用',sourceQuote:'须回答颜色问题。',sourceLocator:{start:3,end:11},warnings:[],included:true,confirmed:true}]};}

test('rule preview escapes original evidence, shows locator and only permits creating drafts',async()=>{
  const {createImportManager}=await api(),dialog=prepared();dialog.candidates[0].sourceQuote='<img onerror=bad>';const h=harness(dialog),html=createImportManager(h.ctx).dialog(dialog);
  assert.match(html,/&lt;img onerror=bad&gt;/);assert.match(html,/字符/);assert.match(html,/只保存草稿|保存规则草稿/);assert.match(html,/对照原文/);assert.doesNotMatch(html,/data-act=".*publish/);
});

test('missing mandatory rule criteria and unchecked original comparison cannot commit',async()=>{
  const {createImportManager}=await api();for(const mutate of [d=>d.candidates[0].passCriteria='',d=>d.candidates[0].confirmed=false]){
    const d=prepared();mutate(d);const h=harness(d);await createImportManager(h.ctx).action('rule-import-save',{});assert.ok(h.dialog.error);assert.equal(h.commits,0);
  }
});

test('rule import saves a source-backed draft atomically without publishing',async()=>{
  const {createImportManager}=await api(),h=harness(prepared());await createImportManager(h.ctx).action('rule-import-save',{});
  assert.equal(h.uploads,1);assert.equal(h.commits,1);const rule=h.catalog.rules.find(r=>r.id==='NEW-COLOR');assert.ok(rule);assert.equal(rule.status,'草稿');assert.equal(rule.provenance.quote,'须回答颜色问题。');assert.equal(rule.provenance.preparedBy.modelId,'glm-5.3-flash');assert.equal(rule.publishedAt,'');
});

test('field evidence shows selected values with physical source locations separately from turn evidence',()=>{
  const session={id:'S',taskId:'T',expectedRuleIds:['R001'],turns:[{id:1,role:'客户',text:'原文'}],aiExecution:{status:'completed'},aiResults:[{ruleId:'R001',verdict:'符合',reason:'依据订单金额判断',evidence:[1],referenceIds:[],fieldEvidence:['amount']}],contextFields:[{key:'amount',label:'订单金额',type:'number',value:399,source:{sheet:'订单数据',row:7,column:'支付金额'}},{key:'note',label:'备注',type:'text',value:'<脚本>',source:{sheet:'订单数据',row:7,column:'备注'}}],review:{drafts:{},status:'待审核'}};
  const state={tasks:[{id:'T',basisSnapshot:{rules:[{id:'R001',name:'自定义检查',policyIds:[]}],policies:[]}}],sessions:[session]},html=manualResultCard(state,session,session.aiResults[0],{openRules:['R001']},false);
  assert.match(html,/订单金额/);assert.match(html,/399/);assert.match(html,/订单数据/);assert.match(html,/第7行/);assert.match(html,/支付金额/);assert.match(html,/定位第1轮/);assert.doesNotMatch(html,/<脚本>/);
});

test('an unfinished role-map edit cannot silently save the previous valid role mapping',async()=>{
  const {createImportManager}=await api(),h=harness({type:'input-mapping',profile:profile()}),manager=createImportManager(h.ctx);
  manager.input(event('input-role-map','访客=客户\n尚未写完'));
  await manager.action('input-save-profile',{});assert.equal(h.commits,0);assert.match(h.dialog.error,/角色对应/);
  assert.match(manager.dialog(h.dialog),/尚未写完/);
});

test('switching layouts removes stale per-turn mappings before the pair fields are chosen',async()=>{
  const {createImportManager}=await api(),h=harness({type:'input-mapping',profile:profile()}),manager=createImportManager(h.ctx);
  manager.change(event('input-layout','pair'));assert.equal(h.dialog.profile.fields.role,undefined);assert.equal(h.dialog.profile.fields.text,undefined);
  assert.match(manager.dialog(h.dialog),/客户内容/);assert.match(manager.dialog(h.dialog),/客服回复/);
});

test('editing a candidate invalidates its visible source-confirm checkbox',async()=>{
  const {createImportManager}=await api(),h=harness(prepared()),manager=createImportManager(h.ctx),checkbox={checked:true};
  const prior=globalThis.document;globalThis.document={querySelector:()=>checkbox};
  try{manager.input(event('rule-import-candidate-0-scope','修改后的范围',{dataset:{candidateIndex:'0',candidateKey:'scope'}}));assert.equal(h.dialog.candidates[0].confirmed,false);assert.equal(checkbox.checked,false);}
  finally{globalThis.document=prior;}
});

test('one explicit prepare action produces one request even when clicked twice before it resolves',async()=>{
  const {createImportManager}=await api(),h=harness(prepared());let calls=0,resolve;
  const manager=createImportManager({...h.ctx,prepareRules:()=>{calls++;return new Promise(r=>{resolve=r;});}}),first=manager.action('rule-import-prepare',{});
  await manager.action('rule-import-prepare',{});assert.equal(calls,1);
  resolve({modelId:'glm-5.3-flash',promptVersion:'rule-preparation-ark-v1',candidates:[{...prepared().candidates[0]}]});await first;assert.equal(h.dialog.candidates[0].confirmed,false);assert.equal(h.dialog.candidates[0].id,'R008');
});

test('changing a source or mapping invalidates the previously accepted preview',async()=>{
  const {createImportManager}=await api(),d=prepared(),h=harness(d),manager=createImportManager(h.ctx);
  manager.input(event('rule-import-text','新原文'));assert.equal(d.prepared,null);assert.deepEqual(d.candidates,[]);
  await manager.action('input-import',{});h.dialog.profile=profile();h.dialog.preview={valid:true};manager.input(event('input-name','修改配置'));assert.equal(h.dialog.preview,null);
});

test('the manager previews a real synthetic workbook and keeps physical field evidence in the wizard handoff',async()=>{
  const {createImportManager}=await api(),bytes=await workbook([{name:'业务原表',headers:['说明','列2','列3','列4','列5'],rows:[['业务编号','开始时间','发言方','内容','订单金额'],['SYNTHETIC-X1','2026-10-29 09:00','访客','有颜色吗？','399'],['SYNTHETIC-X1','2026-10-29 09:00','坐席','有松青。','399']]}]);
  const file={name:'合成业务.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  const h=harness({type:'input-mapping',profile:profile(),file}),manager=createImportManager(h.ctx);await manager.action('input-preview',{});
  assert.equal(h.dialog.error,'');assert.equal(h.dialog.preview.valid,true);assert.equal(h.dialog.preview.sessions[0].turns.length,2);
  assert.equal(h.dialog.preview.sessions[0].contextFields[0].source.row,3);assert.match(manager.dialog(h.dialog),/第3行/);
  await manager.action('input-begin',{});assert.equal(h.begin.parsed.sessions[0].contextFields[0].key,'amount@1');assert.deepEqual(h.begin.importMappingSnapshot.profile.fields,profile().fields);
});

test('rule import rejects a source mismatch before uploading or changing catalog',async()=>{
  const {createImportManager}=await api(),d=prepared();d.candidates[0].sourceQuote='不在原文中的句子';const h=harness(d);await createImportManager(h.ctx).action('rule-import-save',{});
  assert.equal(h.uploads,0);assert.equal(h.commits,0);assert.match(h.dialog.error,/原文引用/);
});

test('a failed draft commit retains all candidate edits and reuses its uploaded source without another model request',async()=>{
  const {createImportManager}=await api(),h=harness(prepared());let attempt=0;
  const manager=createImportManager({...h.ctx,commitWorkspace:async(...args)=>{if(attempt++===0)throw new Error('磁盘保存失败');return h.ctx.commitWorkspace(...args);}});
  await manager.action('rule-import-save',{});assert.match(h.dialog.error,/磁盘保存失败/);assert.equal(h.dialog.candidates[0].id,'NEW-COLOR');
  await manager.action('rule-import-save',{});assert.equal(h.uploads,1);assert.equal(h.preparations,0);assert.equal(h.catalog.rules.find(r=>r.id==='NEW-COLOR').status,'草稿');
});

test('reusing another profile removes unfinished role-map input and its validation error',async()=>{
  const {createImportManager}=await api(),h=harness(),manager=createImportManager(h.ctx);await manager.action('input-import',{});h.dialog.profile=profile();await manager.action('input-save-profile',{});
  manager.input(event('input-role-map','没写完'));manager.change(event('input-profile-select','P1'));await manager.action('input-save-profile',{});
  assert.equal(h.state.inputProfiles[0].version,2);assert.doesNotMatch(manager.dialog(h.dialog),/没写完/);
});

test('failure refreshes recovery controls without rebuilding the live input DOM',async()=>{
  const {createImportManager}=await api(),h=harness(prepared()),forces=[],slot={textContent:''};
  const prior=globalThis.document;globalThis.document={getElementById:()=>slot,querySelectorAll:()=>[]};
  try{await createImportManager({...h.ctx,renderDialog:force=>forces.push(force)}).action('rule-import-prepare',{});assert.ok(forces.includes(false));assert.equal(forces.includes(true),false);assert.equal(h.dialog.sourceText,'原文：须回答颜色问题。');}
  finally{globalThis.document=prior;}
});

async function excelRuleFixture(){
  const module=await api(),sheet={name:'原规则A',rows:[{row:1,values:['须回答颜色问题。']}]};
  const bytes=await workbook([{name:sheet.name,headers:sheet.rows[0].values,rows:[]}]);
  const file=new File([bytes],'规则原件A.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  return{...module,sheet,file,dialog:{...prepared(),mode:'excel',file,sheet:sheet.name,inspected:{sheets:[sheet]},sourceName:file.name,sourceText:module.worksheetText(sheet)}};
}
function preparedResponse(text,quote){const start=text.indexOf(quote);return{modelId:'glm-5.3-flash',promptVersion:'rule-preparation-ark-v1',candidates:[{...prepared().candidates[0],sourceQuote:quote,sourceLocator:{start,end:start+quote.length}}]};}

test('Excel A to edited text B and back prepares A and saves the same A original with a matching quote',async()=>{
  const {createImportManager,worksheetText,sheet,file,dialog}=await excelRuleFixture(),h=harness(dialog);let preparedInput,uploaded;
  const manager=createImportManager({...h.ctx,prepareRules:async input=>{preparedInput=input;return preparedResponse(input.text,'须回答颜色问题。');},uploadSource:async source=>{uploaded=source;return{name:source.name,size:source.size,sha256:'a'.repeat(64)};}});
  manager.change(event('rule-import-mode','text'));manager.input(event('rule-import-text','文本B：须核对预算。'));manager.input(event('rule-import-source-name','编辑的文字B.txt'));
  manager.change(event('rule-import-mode','excel'));
  assert.equal(h.dialog.sourceText,worksheetText(sheet));assert.equal(h.dialog.sourceName,file.name);assert.equal(h.dialog.prepared,null);
  await manager.action('rule-import-prepare',{});assert.equal(preparedInput.text,worksheetText(sheet));assert.equal(preparedInput.sourceName,file.name);
  Object.assign(h.dialog.candidates[0],{id:'COLOR-A',confirmed:true});await manager.action('rule-import-save',{});
  assert.equal(uploaded,file);const rule=h.catalog.rules.find(rule=>rule.id==='COLOR-A');assert.equal(rule.provenance.source.name,file.name);assert.equal(rule.provenance.quote,'须回答颜色问题。');assert.ok(worksheetText(sheet).includes(rule.provenance.quote));
});

test('Excel A switched to editable text B uploads the current B text rather than the retained Excel file',async()=>{
  const {createImportManager,dialog,file}=await excelRuleFixture(),h=harness(dialog);let uploaded;
  const text='文本B：须核对预算。',manager=createImportManager({...h.ctx,prepareRules:async input=>preparedResponse(input.text,'须核对预算。'),uploadSource:async source=>{uploaded=source;return{name:source.name,size:source.size,sha256:'b'.repeat(64)};}});
  manager.change(event('rule-import-mode','text'));manager.input(event('rule-import-text',text));manager.input(event('rule-import-source-name','文字B.txt'));
  await manager.action('rule-import-prepare',{});Object.assign(h.dialog.candidates[0],{id:'BUDGET-B',confirmed:true});await manager.action('rule-import-save',{});
  assert.notEqual(uploaded,file);assert.equal(uploaded.name,'文字B.txt');assert.equal(await uploaded.text(),text);
  const rule=h.catalog.rules.find(rule=>rule.id==='BUDGET-B');assert.equal(rule.provenance.source.name,'文字B.txt');assert.equal(rule.provenance.quote,'须核对预算。');
});

test('stale Excel text inconsistent with its selected worksheet cannot prepare or save a confirmed rule',async()=>{
  const {createImportManager,dialog}=await excelRuleFixture(),h=harness(dialog),text='文本B：须核对预算。';let calls=0;
  h.dialog.sourceText=text;h.dialog.candidates[0]={...h.dialog.candidates[0],sourceQuote:'须核对预算。',sourceLocator:{start:4,end:text.length}};
  const manager=createImportManager({...h.ctx,prepareRules:async input=>{calls++;return preparedResponse(input.text,'须核对预算。');}});
  await manager.action('rule-import-prepare',{});assert.equal(calls,0);assert.match(h.dialog.error,/原文|来源/);
  await manager.action('rule-import-save',{});assert.equal(h.uploads,0);assert.equal(h.commits,0);assert.match(h.dialog.error,/原文|来源/);
});

test('selecting an invalid replacement file immediately invalidates the old mapped preview but preserves mapping edits',async()=>{
  const {createImportManager}=await api(),d={type:'input-mapping',profile:profile(),file:{name:'旧原件.xlsx'},inspected:{sheets:[]},preview:{valid:true,sessions:[],turnCount:0}},h=harness(d),manager=createImportManager(h.ctx);
  const file=new File([],'无效替换.xlsx');manager.change(event('input-file','',{files:[file]}));
  assert.equal(d.file,null);assert.equal(d.preview,null);assert.equal(d.inspected,null);assert.deepEqual(d.profile,profile());
  await manager.action('input-begin',{});assert.equal(h.begin,null);
  for(let i=0;i<100&&d.loading;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.match(d.error,/文件为空/);assert.equal(d.preview,null);
});

test('an invalid replacement rule workbook clears the previous source and candidates before parsing',async()=>{
  const {createImportManager,dialog}=await excelRuleFixture(),h=harness(dialog),manager=createImportManager(h.ctx);dialog.savedSource={name:'旧原件.xlsx'};
  manager.change(event('rule-import-file','',{files:[new File([],'损坏.xlsx')]}));
  assert.equal(dialog.file,null);assert.equal(dialog.inspected,null);assert.equal(dialog.prepared,null);assert.equal(dialog.savedSource,null);assert.equal(dialog.sourceText,'');assert.equal(dialog.sheet,'');assert.deepEqual(dialog.candidates,[]);
  for(let i=0;i<100&&dialog.loading;i++)await new Promise(resolve=>setTimeout(resolve,1));await manager.action('rule-import-save',{});assert.equal(h.uploads,0);assert.equal(h.commits,0);
});

function uncertainSaveHarness(){
  const h=harness(prepared()),status={hasPending:false,conflicted:false};let visibleCatalog=h.catalog,diskCatalog=null,calls=0;
  return{h,status,get diskCatalog(){return diskCatalog;},get calls(){return calls;},recover(transform=value=>value){visibleCatalog=transform(diskCatalog);status.hasPending=false;status.conflicted=false;},
    ctx:{...h.ctx,getCatalog:()=>visibleCatalog,getWorkspaceStatus:()=>({...status}),commitWorkspace:async updater=>{calls++;const next=await updater({state:h.state,catalog:visibleCatalog});diskCatalog=next.catalog;status.hasPending=true;throw new Error('本次保存结果未确认，请先重试保存');}}};
}

test('a lost save acknowledgement is reconciled by exact saved drafts and never creates another version',async()=>{
  const {createImportManager}=await api(),h=uncertainSaveHarness(),manager=createImportManager(h.ctx);await manager.action('rule-import-save',{});
  assert.equal(h.calls,1);assert.equal(h.h.dialog.expectedSavedRules.length,1);assert.equal(h.h.dialog.expectedSavedRules[0].version,'V1.0');assert.equal(manager.reconcile(),'pending');
  const title=h.h.dialog.candidates[0].title;manager.input(event('rule-import-candidate-0-title','保存未确认期间的新编辑',{dataset:{candidateIndex:'0',candidateKey:'title'}}));assert.equal(h.h.dialog.candidates[0].title,title);
  h.recover();assert.equal(manager.reconcile(),'saved');assert.equal(h.h.dialog,null);assert.equal(h.diskCatalog.rules.filter(r=>r.id==='NEW-COLOR').length,1);assert.equal(h.calls,1);
});

test('saving again after recovery recognizes the same exact drafts before calling createDraft',async()=>{
  const {createImportManager}=await api(),h=uncertainSaveHarness(),manager=createImportManager(h.ctx);await manager.action('rule-import-save',{});h.recover();
  await manager.action('rule-import-save',{});assert.equal(h.calls,1);assert.equal(h.h.dialog,null);assert.deepEqual(h.diskCatalog.rules.filter(r=>r.id==='NEW-COLOR').map(r=>r.version),['V1.0']);
});

test('recovery rejects a same-ID/version draft with different complete content and cannot create a new version',async()=>{
  const {createImportManager}=await api(),h=uncertainSaveHarness(),manager=createImportManager(h.ctx);await manager.action('rule-import-save',{});
  h.recover(catalog=>{const copy=structuredClone(catalog);copy.rules.find(rule=>rule.id==='NEW-COLOR').passCriteria='另一个窗口保存的不同口径';return copy;});
  assert.equal(manager.reconcile(),'conflict');assert.match(h.h.dialog.error,/冲突|不同/);await manager.action('rule-import-save',{});assert.equal(h.calls,1);assert.equal(h.h.uploads,1);assert.ok(h.h.dialog);
});
