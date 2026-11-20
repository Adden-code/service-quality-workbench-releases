import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkClient} from '../server/ark-client.mjs';
import {EC_HEADERS,EC_RULE_IDS,ecommerceSourceProjection,ecommerceRecordId} from '../public/ecommerce-schema.mjs';
import {upgradeEcommerceSemanticBasis,EC_SEMANTIC_POLICY_VERSION} from '../public/ecommerce-semantic-policy.mjs';
import {workflowInput} from '../server/workflow-contract.mjs';

// All gateway responses below are predetermined synthetic fixtures. These tests
// verify prompt routing and the wire contract, not a language model's accuracy.
const config={model:'synthetic-ec-policy',authMode:'none',baseUrl:'http://127.0.0.1:1'};
const semanticIds=EC_RULE_IDS.filter(id=>id!=='EC-TIME');
function historicalBasis(){return {executionProfile:'ec-business-v1',rules:EC_RULE_IDS.map(id=>({id,title:id,version:'V3.1',policyIds:[],passCriteria:'Synthetic original pass',failCriteria:'Synthetic original fail',exceptionCriteria:'Synthetic original unknown'})),policies:[],businessProfile:{schemaVersion:1,similarity:{method:'normalized-bigram-dice-v1',threshold:.85,minimumRecords:2,scope:'batch'},structure:{minimumSteps:3,counting:'grapheme-with-spaces-v1',closingWaiver:{zh:200,en:200}},privacy:{maskedAllowed:false},timing:{status:'pending',siteField:'国家',sites:[],standards:[]}}};}
const newBasis=(minimum=1)=>upgradeEcommerceSemanticBasis(historicalBasis(),{minimumSignificantErrors:minimum});
function row(id=1,{comment='Synthetic parcel has not arrived.',reply='Your synthetic parcel is at the local depot; delivery is scheduled for Friday.',type='好评负向'}={}){
 const raw=Array(22).fill('');raw[8]=comment;raw[9]=reply;raw[10]=type==='差评'?'1':type==='中评'?'3':'5';raw[11]='Synthetic agent';raw[12]='2026-11-20 09:00:00';raw[13]='2026-11-20 10:00:00';raw[15]='PRIVATE_HUMAN_REFERENCE';raw[21]='PRIVATE_HUMAN_EXPLANATION';
 const ecommerce={schemaVersion:1,sheet:'Sheet4',row:id+2,fileSha256:'a'.repeat(64),headers:[...EC_HEADERS],standards:Array(22).fill('Synthetic'),raw,thresholdHours:24};
 return {id:`synthetic-${id}`,externalId:ecommerceRecordId(ecommerce),...ecommerceSourceProjection(ecommerce),ecommerce,review:{notes:'PRIVATE_REVIEW_DRAFT'},sceneCapabilities:{outputs:{ecommerceClassification:{status:'completed',value:{evaluationType:type},reason:'Synthetic classified fixture'}}}};
}
const result=(ruleId,verdict='符合',reason='Synthetic fixture response')=>({ruleId,verdict,reason,evidence:[2],referenceIds:[]});
const outcomes=(override={},ids=semanticIds)=>ids.map(id=>({...result(id),...override[id]}));
const envelope=value=>new Response(JSON.stringify({model:'synthetic-ec-policy',choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}),{headers:{'content-type':'application/json'}});
function gateway(produce=()=>({results:outcomes()})){
 const sent=[];
 const client=createArkClient({fetchImpl:async(_url,options)=>{const request=JSON.parse(options.body);sent.push(request);return envelope(produce(request,sent.length));}});
 return {client,sent};
}
const prompt=request=>request.messages[0].content;
const input=request=>JSON.parse(request.messages[1].content);
function assertPolicy(request,minimum=1){
 const system=prompt(request);
 assert.match(system,/冻结电商语义执行策略 ec-human-aligned-v1/);
 assert.deepEqual(input(request).basis.businessProfile.semanticPolicy,{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:minimum}});
 assert.match(system,new RegExp(`当前冻结阈值为${minimum}处显著错误`));
 assert.match(system,/好评正向、好评负向不因缺少开头语、致歉、产品价值表达或结束语判不符合/);
 assert.match(system,/3步及以上操作指导仍须完整顺序编号/);
 assert.match(system,/少于3步只免编号要求/);
 assert.match(system,/好评正向\/好评负向已有回复但完全缺乏实质回应或明显无关时，EC-STEPS仍判不符合/);
 assert.match(system,/差评与中评继续按该任务冻结规则检查原有步骤编号要求，不套用好评类型的固定结构要求/);
 assert.match(system,/也不新增EC-STEPS空泛\/无实质回应的硬判条件；其针对性仍由EC-TARGET核查/);
 assert.match(system,/仅用客户名字作礼貌称呼（如Hi Sara），且未同时披露其他个人信息时，适用称呼例外/);
 assert.match(system,/客户姓名超出单纯礼貌称呼使用，或与其他个人信息同时公开，不适用称呼例外/);
 assert.match(system,/其他可关联个人的信息仍禁止，包括掩码或部分隐藏形式/);
 assert.match(system,/同一文本位置的错误被重复引用或归入多个类别只计一次；不同位置的显著错误按处数计入/);
 assert.match(system,/reason须说明显著错误处数、阈值、具体原文和影响理解\/专业形象的严重性依据/);
 assert.match(system,/仅复述问题关键词、表示道歉\/倾听，再给通用客服渠道而无对应问题的具体回应，判不符合/);
 assert.match(system,/必须实质回应用户的具体问题、诉求或夸赞点/);
 assert.match(system,/纯好评也可对用户认可的卖点作实质互动，不强制给没有问题的评价编造问题或解决方案/);
 assert.match(system,/原评价没有具体问题、诉求或具体夸赞点时（如只有“很好”），按评价实际可回应的内容判断/);
 assert.match(system,/不通过EC-TARGET恢复已降为建议的EC-STEPS段落义务；已有具体问题、诉求或夸赞点时仍须实质回应/);
 assert.match(system,/重试执行提醒/);
 assert.doesNotMatch(system,/不添加“明显”等门槛|任一失败即Fail|closingOptional=true才豁免结束语，其他组成仍需检查|没有至少3步操作指导时EC-STEPS为符合/);
 assert.doesNotMatch(JSON.stringify(request),/PRIVATE_HUMAN_REFERENCE|PRIVATE_HUMAN_EXPLANATION|PRIVATE_REVIEW_DRAFT/);
}

test('historical business row retains its old prompt, projection and version without the frozen gate',async()=>{
 const {client,sent}=gateway(),basis=historicalBasis();
 const value=await client.inspectEcommerceRow({config,session:row(),basis});
 assert.equal(value.promptVersion,'ec-row-ark-v1');assert.match(prompt(sent[0]),/不添加“明显”等门槛/);assert.match(prompt(sent[0]),/任一失败即Fail/);
 assert.equal(input(sent[0]).basis.businessProfile,undefined);assert.equal(input(sent[0]).ecommercePolicyFacts,undefined);assert.doesNotMatch(JSON.stringify(sent[0]),/ec-human-aligned-v1/);
 assert.equal(basis.businessProfile.semanticPolicy,undefined);
});

test('the policy field on a non-business EC profile cannot opt it into business behavior',async()=>{
 const {client,sent}=gateway(),basis=historicalBasis();basis.executionProfile='ec-working-hours-v1';
 await client.inspectEcommerceRow({config,session:row(),basis});
 basis.businessProfile.semanticPolicy={version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:2}};
 const value=await client.inspectEcommerceRow({config,session:row(),basis});
 assert.deepEqual(sent[1],sent[0]);assert.equal(value.promptVersion,'ec-row-ark-v1');
});

test('gated row sends four calibrated rules and program facts while retaining the existing result schema',async()=>{
 const {client,sent}=gateway(),basis=newBasis(),session=row(),before=structuredClone(basis);
 const value=await client.inspectEcommerceRow({config,session,basis});
 assertPolicy(sent[0]);assert.equal(value.promptVersion,EC_SEMANTIC_POLICY_VERSION);
 assert.deepEqual(input(sent[0]).basis.rules.map(r=>r.id),semanticIds);assert.equal(input(sent[0]).ecommercePolicyFacts.evaluationType,'好评负向');
 assert.equal(input(sent[0]).ecommercePolicyFacts.closingOptional,false);assert.deepEqual(Object.keys(value.results[0]),['ruleId','verdict','reason','evidence','referenceIds']);
 assert.deepEqual(basis,before,'request preparation must not mutate frozen policy or rules');
});

for(const fixture of [
 {name:'positive reply missing conventional sections is advisory',type:'好评正向',rule:'EC-STEPS',comment:'The synthetic battery lasts for my long reading sessions.',reply:'The synthetic battery supports the long reading sessions you described.',verdict:'符合',reason:'Synthetic: substantive positive response; opening, value section and closing are advisory.'},
 {name:'pure positive feedback receives a substantive response to the praised feature',type:'好评正向',rule:'EC-TARGET',comment:'The synthetic display is comfortable for long reading sessions.',reply:'The comfortable synthetic display can help make your long reading sessions more enjoyable.',verdict:'符合',reason:'Synthetic: responds to the praised display and reading use case without inventing a problem or solution.'},
 {name:'generic positive feedback does not require an invented issue or product-value paragraph',type:'好评正向',rule:'EC-TARGET',comment:'很好',reply:'感谢您的认可！',verdict:'符合',reason:'Synthetic: the generic positive review has no specific issue, request or praised feature; the reply addresses its actual content without invented requirements.'},
 {name:'negative positive-rating reply lacks apology and closing',rule:'EC-STEPS',verdict:'符合',reason:'Synthetic: targeted progress addresses delivery; missing apology and closing are advisory.'},
 {name:'three unnumbered steps still fail',rule:'EC-STEPS',reply:'Open Settings. Select Delivery. Press Reschedule.',verdict:'不符合',reason:'Synthetic: three instructions lack complete sequence numbering.'},
 {name:'empty substantive content still fails structure',rule:'EC-STEPS',reply:'Sorry, we are listening. Please contact our customer service.',verdict:'不符合',reason:'Synthetic: no substantive response to the stated delivery issue.'},
 {name:'keyword echo plus generic channel still fails targeting',rule:'EC-TARGET',reply:'Your parcel has not arrived. Sorry, please contact customer service.',verdict:'不符合',reason:'Synthetic: keyword echo and generic channel contain no targeted progress or solution.'},
 {name:'name only remains allowed',rule:'EC-PRIVACY',reply:'Dear Synthetic Mira, your parcel is at the depot and will arrive Friday.',verdict:'符合',reason:'Synthetic: salutation only with no other linkable personal information.'},
 {name:'name outside a simple salutation does not receive the greeting exception',rule:'EC-PRIVACY',reply:'The account registered under Synthetic Mira has three return requests.',verdict:'不符合',reason:'Synthetic: the name identifies account history, beyond a simple polite salutation.'},
 {name:'masked phone remains forbidden',rule:'EC-PRIVACY',reply:'Synthetic Mira, your phone is 138****1234; delivery is on Friday.',verdict:'不符合',reason:'Synthetic: masked phone is other linkable private information.'},
 {name:'minor spelling variants remain advisory',rule:'EC-TEXT',reply:'Synthetic Mira, cafe delivery for the Al Nour order is scheduled Friday.',verdict:'符合',reason:'Synthetic: 0 significant errors at threshold 1; diacritic and copied name variants are advisory.'},
 {name:'one significant error reaches threshold one',rule:'EC-TEXT',reply:'The synthetic refund will not be issued yesterday tomorrow.',verdict:'不符合',reason:'Synthetic: 1 distinct significant error at threshold 1; contradictory timing prevents understanding.'},
 {name:'one significant error stays advisory at threshold two',minimum:2,rule:'EC-TEXT',reply:'The synthetic refund will not be issued yesterday tomorrow.',verdict:'符合',reason:'Synthetic: 1 distinct significant error below threshold 2; contradictory timing is an advisory improvement.'},
 {name:'two distinct significant errors reach threshold two',minimum:2,rule:'EC-TEXT',reply:'The synthetic refund will not be issued yesterday tomorrow. Go no refund yes not.',verdict:'不符合',reason:'Synthetic: 2 distinct significant errors at threshold 2; contradictory timing and unintelligible instruction.'},
 {name:'negative rating keeps its existing numbering criterion',type:'差评',rule:'EC-STEPS',reply:'Open Settings. Select Delivery. Press Reschedule.',verdict:'不符合',reason:'Synthetic: three instructions lack numbering under the existing negative-rating criterion.'},
 {name:'middle rating keeps its existing numbering criterion',type:'中评',rule:'EC-STEPS',reply:'Open Settings. Select Delivery. Press Reschedule.',verdict:'不符合',reason:'Synthetic: three instructions lack numbering under the existing middle-rating criterion.'},
 {name:'negative rating has no new fixed paragraph requirement',type:'差评',rule:'EC-STEPS',verdict:'符合',reason:'Synthetic: substantive delivery progress; no three-step instructions and no extra fixed paragraph requirements.'},
 {name:'middle rating has no new fixed paragraph requirement',type:'中评',rule:'EC-STEPS',verdict:'符合',reason:'Synthetic: substantive delivery progress; no three-step instructions and no extra fixed paragraph requirements.'},
])test(`synthetic gateway contract: ${fixture.name}`,async()=>{
 const expected={verdict:fixture.verdict,reason:fixture.reason};
 const {client,sent}=gateway(()=>({results:outcomes({[fixture.rule]:expected})}));
 const value=await client.inspectEcommerceRow({config,session:row(1,fixture),basis:newBasis(fixture.minimum??1)});
 assertPolicy(sent[0],fixture.minimum??1);assert.deepEqual(value.results.find(r=>r.ruleId===fixture.rule),result(fixture.rule,fixture.verdict,fixture.reason));
 assert.equal(input(sent[0]).ecommercePolicyFacts.evaluationType,fixture.type??'好评负向');
});

test('caller retry repeats the frozen threshold and does not solicit minor orthographic failures',async()=>{
 const {client,sent}=gateway((_request,attempt)=>({results:attempt===1?[]:outcomes()}));
 const args={config,session:row(),basis:newBasis(2)};
 await assert.rejects(client.inspectEcommerceRow(args),{code:'INVALID_OUTPUT'});
 const value=await client.inspectEcommerceRow(args);assert.equal(value.promptVersion,EC_SEMANTIC_POLICY_VERSION);assert.equal(sent.length,2);
 for(const request of sent){assertPolicy(request,2);assert.match(prompt(request),/不得为了产出Fail而搜罗重音\/变音符号、连写、专名变体、照录客户拼写或无碍理解的小语法问题/);}
 assert.deepEqual(sent[1],sent[0]);
});

test('reliable four/five-star source ratings keep paragraph omissions advisory when polarity is unknown',async()=>{
 const {client,sent}=gateway();
 for(const rating of ['4','5']){
  const session=row();session.ecommerce.raw[10]=rating;Object.assign(session,ecommerceSourceProjection(session.ecommerce));
  session.sceneCapabilities.outputs.ecommerceClassification={status:'failed',reason:'Synthetic unavailable polarity'};
  await client.inspectEcommerceRow({config,session,basis:newBasis()});
  const request=sent.at(-1);assertPolicy(request);assert.equal(input(request).ecommercePolicyFacts.evaluationType,null);
  assert.equal(input(request).ecommercePolicyFacts.sourceRating,Number(rating));assert.equal(input(request).ecommercePolicyFacts.positiveRating,true);
  assert.match(prompt(request),/分类尚未知也不能因此对缺段落判不符合/);
 }
});

test('normal workflow projection and targeted recovery preserve source rating without ecommerce/raw',async()=>{
 for(const rating of ['1','3','4','5'])for(const targeted of [false,true]){
  const {client,sent}=gateway(()=>({results:outcomes({},targeted?['EC-STEPS']:semanticIds)}));
  const source=row();source.ecommerce.raw[10]=rating;Object.assign(source,ecommerceSourceProjection(source.ecommerce));
  const session=workflowInput(source);delete session.source;
  assert.equal(session.ecommerce,undefined);assert.equal(session.sceneCapabilities,undefined);assert.equal(session.review,undefined);
  const sceneCapabilities={outputs:{ecommerceClassification:{status:'failed',reason:'Synthetic unavailable polarity'}}};
  const basis=newBasis();if(targeted)basis.rules=basis.rules.filter(rule=>rule.id==='EC-STEPS');
  await client.inspectEcommerceRow({config,session,basis,...(targeted?{ruleIds:['EC-STEPS']}:{}),sceneCapabilities,sceneSnapshot:{configuration:{ruleDependencies:{'EC-STEPS':['ecommerceClassification']}},exceptions:[]}});
  const request=sent[0],facts=input(request).ecommercePolicyFacts;assertPolicy(request);
  assert.equal(facts.sourceRating,Number(rating));assert.equal(facts.positiveRating,Number(rating)>=4);
  assert.equal(facts.evaluationType,rating==='1'?'差评':rating==='3'?'中评':null);
  assert.doesNotMatch(JSON.stringify(request),/PRIVATE_HUMAN_REFERENCE|PRIVATE_HUMAN_EXPLANATION|PRIVATE_REVIEW_DRAFT/);
 }
});

test('source rating projection uses exact key/label, rejects ambiguity and ignores human review lookalikes',async()=>{
 const session=workflowInput(row());delete session.source;
 const original=session.contextFields.find(field=>field.key==='rating');
 for(const {fields,expected} of [
  {fields:[{...original,key:'source-score'}],expected:5},
  {fields:[{...original,label:'Source rating'}],expected:5},
  {fields:[{...original,key:'human-rating',label:'人工评分',value:'1'}],expected:null},
  {fields:[original,{...original,key:'other-source-score',value:'1'}],expected:null},
  {fields:[{...original,value:'not a rating'}],expected:null},
 ]){
  const {client,sent}=gateway();await client.inspectEcommerceRow({config,session:{...session,contextFields:fields},basis:newBasis()});
  assert.equal(input(sent[0]).ecommercePolicyFacts.sourceRating,expected);
 }
});

test('targeted dependency recovery uses repaired classification and still accepts EC-STEPS only',async()=>{
 let extra=false;const {client,sent}=gateway(()=>({results:outcomes({},extra?['EC-STEPS','EC-TEXT']:['EC-STEPS'])}));
 const basis=newBasis();basis.rules=basis.rules.filter(r=>r.id==='EC-STEPS');
 const sceneCapabilities={outputs:{ecommerceClassification:{status:'completed',value:{evaluationType:'好评负向'}}}};
 const args={config,session:row(1,{type:'好评正向'}),basis,ruleIds:['EC-STEPS'],sceneCapabilities,sceneSnapshot:{configuration:{ruleDependencies:{'EC-STEPS':['ecommerceClassification']}},exceptions:[]}};
 const value=await client.inspectEcommerceRow(args);assertPolicy(sent[0]);assert.equal(value.results.length,1);assert.equal(value.promptVersion,EC_SEMANTIC_POLICY_VERSION);
 assert.deepEqual(input(sent[0]).basis.rules.map(r=>r.id),['EC-STEPS']);assert.equal(input(sent[0]).ecommercePolicyFacts.evaluationType,'好评负向');assert.match(prompt(sent[0]),/仅检查并精确返回EC-STEPS一项/);
 extra=true;await assert.rejects(client.inspectEcommerceRow(args),{code:'INVALID_OUTPUT'});
});

test('batch entry applies frozen policy to every row and preserves its existing comparison contract',async()=>{
 const sessions=[row(1,{type:'好评正向'}),row(2,{type:'中评'}),row(3,{type:'差评'})];
 const body={records:sessions.map(s=>({sessionId:s.id,results:outcomes()})),duplicateGroups:[{sessionIds:sessions.map(s=>s.id),reason:'Synthetic identical substantive replies'}],checkedSessionIds:sessions.map(s=>s.id)};
 const {client,sent}=gateway(()=>body);
 const old=await client.inspectEcommerce({config,sessions,basis:historicalBasis()});
 assert.equal(old.promptVersion,'ec-batch-ark-v1');assert.match(prompt(sent[0]),/没有至少3步操作指导时EC-STEPS为符合/);assert.ok(input(sent[0]).sessions.every(s=>!s.ecommercePolicyFacts));
 const value=await client.inspectEcommerce({config,sessions,basis:newBasis(2)});
 assertPolicy(sent[1],2);assert.equal(value.promptVersion,EC_SEMANTIC_POLICY_VERSION);assert.deepEqual(value.duplicateGroups,old.duplicateGroups);
 assert.deepEqual(input(sent[1]).sessions.map(s=>s.ecommercePolicyFacts.evaluationType),['好评正向','中评','差评']);assert.match(prompt(sent[1]),/少于3步仅免编号要求，不能自动判符合/);
 for(const request of sent)assert.match(prompt(request),/同一非空agent内检查所有回复的重复\/高度相似，至少3条形成一组/);
 assert.equal(input(sent[1]).comparisonScope,input(sent[0]).comparisonScope);
});

test('generic inspection cannot bypass a gated business policy and invalid frozen gates send no request',async()=>{
 const {client,sent}=gateway(()=>({results:outcomes({},EC_RULE_IDS)}));
 const value=await client.inspect({config,session:row(),basis:newBasis()});assertPolicy(sent[0]);assert.equal(value.promptVersion,EC_SEMANTIC_POLICY_VERSION);
 for(const policy of [{version:'future',text:{minimumSignificantErrors:1}},{version:EC_SEMANTIC_POLICY_VERSION,text:{minimumSignificantErrors:3}},null,undefined]){
  const basis=historicalBasis();basis.businessProfile.semanticPolicy=policy;
  await assert.rejects(client.inspectEcommerceRow({config,session:row(),basis}),{code:'INVALID_INPUT'});
 }
 assert.equal(sent.length,1);
});
