// Local synthetic OpenAI-compatible gateway for installed WebView2 acceptance.
import http from 'node:http';
let hold=false,calls=0;const waiters=new Set();
function reply(body){
 let input;try{input=JSON.parse(body.messages?.filter(m=>m.role==='user').at(-1)?.content);}catch{return 'OK';}
 if(input.capability){const block=input.blocks[0];return{status:'completed',value:{polarity:'positive',vocKind:'none'},confidence:.95,reason:'合成评价明确称赞产品续航。',evidence:[{blockId:block.id,quote:block.text,start:0,end:block.text.length}]};}
 if(input.kind==='translation'){const p=input.input;return{items:p.items.map(i=>{const detectedLanguage=/\p{Script=Han}/u.test(i.text)?'zh':'en',same=detectedLanguage===p.targetLang;return{id:i.id,translation:same?i.text:p.targetLang==='en'?'Synthetic translated service explanation.':'合成客服具体说明产品续航与使用建议。',isTargetLanguage:same,detectedLanguage,...(p.includeConfidence?{confidence:.95}:{})};})};}
 if(input.kind==='caseHighlights')return{cases:input.input.candidates.slice(0,input.input.limit).map(c=>({id:c.id,score:5,commentary:'合成客服回应续航夸赞并提供了省电设置方法。',quote:c.reply}))};
 if(input.kind==='issueClusters')return{clusters:[{label:'合成问题回应不足',summary:'合成原因说明缺少具体处理。',action:'结合具体问题给出处理步骤。',memberIds:input.input.records.map(r=>r.id)}]};
 if(input.kind==='voc')return{items:input.input.records.map(r=>({id:r.id,valid:false,scene:'其他',painPoint:'',reason:'合成正面评价没有负面诉求。',evidenceQuote:r.comment}))};
 if(input.session&&input.basis){const turn=input.session.turns.find(t=>t.role==='客服')||input.session.turns.at(-1);return{results:input.basis.rules.map(r=>({ruleId:r.id,verdict:'符合',reason:'合成客服针对续航给出省电设置建议。',evidence:[turn.id],referenceIds:input.basis.policies.filter(p=>r.policyIds.includes(p.id)).map(p=>p.referenceKey),confidence:.95,evidenceQuotes:[{turnId:turn.id,quote:turn.text,role:turn.role}],conflictsWith:[]}))};}
 throw new Error('Unsupported synthetic contract: '+Object.keys(input).join(','));
}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/gate'){hold=url.searchParams.get('hold')==='1';if(!hold)for(const done of waiters)done();res.end(JSON.stringify({hold,calls,waiting:waiters.size}));return;}
 if(url.pathname==='/stats'){res.end(JSON.stringify({hold,calls,waiting:waiters.size}));return;}
 if(url.pathname!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
 let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);calls++;
 if(hold)await new Promise(resolve=>{const done=()=>{waiters.delete(done);resolve();};waiters.add(done);res.once('close',done);});
 if(res.destroyed)return;const output=reply(input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'synthetic-'+calls,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'synthetic-desktop',choices:[{index:0,message:{role:'assistant',content:typeof output==='string'?output:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
}catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}});
server.listen(16186,'127.0.0.1',()=>console.log('Synthetic gateway listening on 16186; no external calls.'));
