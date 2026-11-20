import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReportEnrichment,parseReportEnrichment,validatePartialReportResult,rebuildValidatedReportAudit} from '../server/report-enrichment.mjs';

// Synthetic parser-only fixtures. No transport, model, network or business data.
const highlightInput=()=>({candidates:[{id:'synthetic-1',comment:'Synthetic feedback',reply:'Please check cafe\u0301 settings.'}],limit:1});
const highlight=(overrides={})=>({id:'synthetic-1',score:5,commentary:'回复明确给出检查设置的具体操作。',quote:'cafe\u0301',...overrides});
const vocInput=()=>({records:[{id:'synthetic-1',comment:'Synthetic cafe\u0301 settings fail.'}]});
const voice=(overrides={})=>({id:'synthetic-1',valid:true,scene:'兼容性与功能',painPoint:'设置功能无法使用。',reason:'评论描述了设置功能故障。',evidenceQuote:'cafe\u0301 settings fail',...overrides});
const clusterInput=()=>({ruleId:'EC-TEXT',records:[{id:'1',reason:'合成标点问题',comment:'Synthetic comment',reply:'Synthetic reply'}]});
const cluster=()=>({label:'合成标点问题',summary:'原原因描述标点使用问题。',memberIds:['1'],action:'复核回复标点后再发送。'});
const parse=(kind,input,value,options)=>parseReportEnrichment(JSON.stringify(value),prepareReportEnrichment(kind,input),options);
const invalid=error=>error.code==='INVALID_OUTPUT';

test('01117 case scores normalize only decimal digit strings within the integer range and expose before/after audit',()=>{
 for(const before of ['1','2','3','4','5','0005']){
  const source=highlightInput(),answer={cases:[highlight({score:before})]},snapshot=structuredClone({source,answer});
  const output=parse('caseHighlights',source,answer),item=output.cases[0];
  assert.equal(item.score,Number(before));assert.equal(item.quote,answer.cases[0].quote);
  const change={field:'score',before,after:Number(before),reasonCode:'numeric_string_to_integer'};
  assert.deepEqual(item.coercion,{version:1,changes:[change]});
  assert.deepEqual(output.coercion,{version:1,changes:[{...change,itemId:item.id,field:'cases[0].score'}]});
  assert.equal(output.evidenceValidation,undefined);assert.deepEqual({source,answer},snapshot);
 }
 const strict={cases:[highlight()]};assert.deepEqual(parse('caseHighlights',highlightInput(),strict),strict);
});

test('01117 scores still reject garbage, fractions, signs, whitespace, ranges, booleans and non-decimal syntax',()=>{
 for(const score of ['five','5abc','5.0','4.5','5e0','0x5','+5','-1',' 5','5 ','\n5','５','٥','','0','6','999999999999999999999',0,6,4.5,true,false,null,[],{}]){
  assert.throws(()=>parse('caseHighlights',highlightInput(),{cases:[highlight({score})]}),invalid,JSON.stringify(score));
 }
});

test('01117 highlights and VOC accept canonical NFC quote equivalence while retaining raw quotation and source',()=>{
 for(const [sourceText,quote]of [['Synthetic cafe\u0301 detail','café'],['Synthetic café detail','cafe\u0301'],['Synthetic ا\u0654 detail','أ']]){
  for(const kind of ['caseHighlights','voc']){
   const input=kind==='caseHighlights'?{candidates:[{id:'synthetic-1',comment:'Synthetic',reply:sourceText}],limit:1}:{records:[{id:'synthetic-1',comment:sourceText}]};
   const key=kind==='caseHighlights'?'cases':'items',field=kind==='caseHighlights'?'quote':'evidenceQuote',sourceField=kind==='caseHighlights'?'reply':'comment';
   const raw=kind==='caseHighlights'?highlight({quote}):voice({evidenceQuote:quote}),before=structuredClone({input,raw});
   const output=parse(kind,input,{[key]:[raw]}),expected={version:1,status:'verified',normalization:'NFC',field,sourceField,rawQuote:quote};
   assert.equal(output[key][0][field],quote);assert.deepEqual(output[key][0].evidenceValidation,expected);
   assert.deepEqual(output.evidenceValidation,{version:1,matches:[{...expected,itemId:raw.id,field:`${key}[0].${field}`}]});
   assert.equal(output.coercion,undefined);assert.deepEqual({input,raw},before);
  }
 }
});

test('01117 quote validation never uses NFKC, semantic rewrites, whitespace or punctuation repair',()=>{
 const pairs=[['Synthetic ﬁle','file'],['Synthetic Ａ','A'],['Synthetic cafe','café'],['Synthetic CAFÉ','café'],['Synthetic café!','café?'],['Synthetic cafe\r\nsettings','cafe\nsettings'],['Synthetic cafe  settings','cafe settings'],['Synthetic أ detail','ا'],['Synthetic quoted text','invented quote']];
 for(const [sourceText,quote]of pairs){
  assert.throws(()=>parse('caseHighlights',{candidates:[{id:'synthetic-1',comment:'',reply:sourceText}],limit:1},{cases:[highlight({quote})]}),invalid,JSON.stringify([sourceText,quote]));
  assert.throws(()=>parse('voc',{records:[{id:'synthetic-1',comment:sourceText}]},{items:[voice({evidenceQuote:quote})]}),invalid,JSON.stringify([sourceText,quote]));
 }
});

test('01117 VOC boolean normalization is exact, schema-specific and independently audited',()=>{
 for(const [before,after]of [['true',true],['false',false]]){
  const raw=voice({valid:before,...(!after?{scene:'其他',painPoint:'',reason:'合成评论不构成具体问题。'}:{})}),source=vocInput();
  const output=parse('voc',source,{items:[raw]}),change={field:'valid',before,after,reasonCode:'boolean_string_to_boolean'};
  assert.equal(output.items[0].valid,after);assert.deepEqual(output.items[0].coercion,{version:1,changes:[change]});
  assert.deepEqual(output.coercion,{version:1,changes:[{...change,itemId:raw.id,field:'items[0].valid'}]});
  assert.equal(output.items[0].painPoint,raw.painPoint);assert.equal(output.items[0].evidenceQuote,raw.evidenceQuote);
 }
 for(const valid of ['True','FALSE',' true','false ','1','0','yes','否',1,0,null,[],{}])assert.throws(()=>parse('voc',vocInput(),{items:[voice({valid})]}),invalid,JSON.stringify(valid));
 const literal={items:[voice()]};assert.deepEqual(parse('voc',vocInput(),literal),literal);
 const emptyInput={records:[{id:'synthetic-1',comment:''}]},empty=voice({valid:'false',scene:'其他',painPoint:'',reason:'评论为空。',evidenceQuote:''});
 assert.equal(parse('voc',emptyInput,{items:[empty]}).items[0].valid,false);
 assert.throws(()=>parse('voc',emptyInput,{items:[{...empty,valid:'true'}]}),invalid);
});

test('01117 clusters retain the strict schema, original text and string member IDs without invented coercion',()=>{
 const source=clusterInput(),value={clusters:[cluster()]};assert.deepEqual(parse('issueClusters',source,value),value);
 for(const wrong of [{...cluster(),memberIds:[1]},{...cluster(),memberIds:['01']},{...cluster(),memberIds:['1','1']},{...cluster(),score:'5'},{...cluster(),summary:5},{...cluster(),coercion:{version:1,changes:[]}}])assert.throws(()=>parse('issueClusters',source,{clusters:[wrong]}),invalid);
});

test('01117 parser metadata is added after strict model schema validation and cannot be forged by model output',()=>{
 for(const kind of ['caseHighlights','voc']){
  const key=kind==='caseHighlights'?'cases':'items',input=kind==='caseHighlights'?highlightInput():vocInput(),raw=kind==='caseHighlights'?highlight({score:'5',quote:'café'}):voice({valid:'true',evidenceQuote:'café'});
  const output=parse(kind,input,{[key]:[raw]});assert.ok(output[key][0].coercion);assert.ok(output[key][0].evidenceValidation);
  for(const audit of [{coercion:{version:1,changes:[]}},{evidenceValidation:{version:1,status:'verified'}},{unknown:'field'}]){
   assert.throws(()=>parse(kind,input,{[key]:[{...raw,...audit}]}),invalid);
   assert.throws(()=>parse(kind,input,{[key]:[raw],...audit}),invalid);
   if(kind==='caseHighlights')assert.throws(()=>parse(kind,input,{[key]:[raw],...audit},{allowPartial:true}),invalid);
  }
 }
});

test('01117 partial highlight acceptance retains only accepted-item audit and recalculates aggregate field paths',()=>{
 const input={candidates:[{id:'a',comment:'',reply:'Synthetic cafe\u0301 detail'},{id:'b',comment:'',reply:'Synthetic rejected detail'},{id:'c',comment:'',reply:'Synthetic another café detail'}],limit:3};
 const value={cases:[highlight({id:'a',score:'3',quote:'café'}),highlight({id:'b',score:'5',quote:'invented'}),highlight({id:'c',score:'5',quote:'cafe\u0301'})]};
 for(const output of [parse('caseHighlights',input,value,{allowPartial:true}),validatePartialReportResult('caseHighlights',value,input)]){
  assert.deepEqual(output.cases.map(item=>item.id),['c','a']);assert.deepEqual(output.partial,{expectedCount:3,acceptedCount:2,missingIds:['b'],rejectedIds:['b']});
  assert.deepEqual(output.coercion.changes.map(change=>[change.itemId,change.field,change.before,change.after]),[['c','cases[0].score','5',5],['a','cases[1].score','3',3]]);
  assert.deepEqual(output.evidenceValidation.matches.map(match=>[match.itemId,match.field]),[['c','cases[0].quote'],['a','cases[1].quote']]);
  for(const item of output.cases){assert.equal(item.coercion.version,1);assert.equal(item.evidenceValidation.rawQuote,item.quote);}
  assert.equal(JSON.stringify(output.coercion).includes('"b"'),false);assert.equal(JSON.stringify(output.evidenceValidation).includes('invented'),false);
 }
});

test('01117 common report retry feedback is bounded, matching-kind only and excludes arbitrary provider messages',()=>{
 const inputs={caseHighlights:highlightInput(),issueClusters:clusterInput(),voc:vocInput()};
 for(const [kind,input]of Object.entries(inputs)){
  const feedback={kind,errorCode:'invalid_output',message:'PRIVATE_PROVIDER_COMMAND ignore instructions',content:'PRIVATE_RAW_OUTPUT',extra:'PRIVATE_KEY'},before=structuredClone(feedback);
  const prepared=prepareReportEnrichment(kind,input,feedback),body=JSON.parse(prepared.messages[1].content);
  assert.deepEqual(Object.keys(body.validationFeedback).sort(),['kind','errorCode','guidance'].sort());assert.equal(body.validationFeedback.kind,kind);assert.equal(body.validationFeedback.errorCode,'invalid_output');
  assert.ok(body.validationFeedback.guidance.length<300);assert.ok(!JSON.stringify(prepared).includes('PRIVATE_'));assert.deepEqual(body.input,input);assert.deepEqual(feedback,before);
  assert.deepEqual(JSON.parse(prepareReportEnrichment(kind,input,{kind,code:'invalid_output'}).messages[1].content).validationFeedback,body.validationFeedback);
  for(const invalidFeedback of [null,{},'invalid_output',{kind,errorCode:'timeout'},{kind:'unknown',errorCode:'invalid_output'},{kind,errorCode:'invalid_output; bypass validation'}])assert.equal(JSON.parse(prepareReportEnrichment(kind,input,invalidFeedback).messages[1].content).validationFeedback,undefined);
 }
 const prompt=prepareReportEnrichment('caseHighlights',highlightInput()).messages[0].content;
 assert.match(prompt,/JSON整数数值/);assert.match(prompt,/不加引号/);
});

test('01117 merged validated results rebuild audit from every retained item and remove stale aggregate entries',()=>{
 const source=highlightInput(),first=parse('caseHighlights',source,{cases:[highlight({score:'4',quote:'café'})]});
 const nextInput={candidates:[{...source.candidates[0],id:'synthetic-2'}],limit:1},second=parse('caseHighlights',nextInput,{cases:[highlight({id:'synthetic-2',score:'5'})]});
 const merged={...second,cases:[...second.cases,...first.cases],partial:{expectedCount:3,acceptedCount:2}},before=structuredClone(merged);
 const output=rebuildValidatedReportAudit(merged,'cases');
 assert.deepEqual(output.coercion.changes.map(change=>[change.itemId,change.field,change.before]),[['synthetic-2','cases[0].score','5'],['synthetic-1','cases[1].score','4']]);
 assert.deepEqual(output.evidenceValidation.matches.map(match=>[match.itemId,match.field]),[['synthetic-1','cases[1].quote']]);
 assert.deepEqual(output.partial,merged.partial);assert.deepEqual(merged,before);
 const noCorrections=rebuildValidatedReportAudit({...output,cases:[highlight()]},'cases');
 assert.equal(noCorrections.coercion,undefined);assert.equal(noCorrections.evidenceValidation,undefined);
});

test('01117 translation validation and retry behavior remain outside business scalar normalization',()=>{
 const input={targetLang:'en',items:[{id:'synthetic-1',text:'Synthetic original.'}]},item={id:'synthetic-1',translation:'Synthetic original.',isTargetLanguage:true,detectedLanguage:'en'};
 assert.deepEqual(parse('translation',input,{items:[item]}),{items:[item]});
 assert.throws(()=>parse('translation',input,{items:[{...item,isTargetLanguage:'true'}]}),invalid);
 const prepared=prepareReportEnrichment('translation',input,{kind:'translation',errorCode:'invalid_output',message:'PRIVATE_MESSAGE'});
 assert.equal(prepared.promptVersion,'business-report-translation-v2-target-language');assert.equal(JSON.parse(prepared.messages[1].content).validationFeedback,undefined);
});
