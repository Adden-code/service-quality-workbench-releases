import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {capabilityBody,ruleBody} from './native-language-stage2-fixture.mjs';
const project=fileURLToPath(new URL('..',import.meta.url));
const run=args=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,args,{cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
});
test('distributed optional probe passes syntax validation',async()=>{
 const result=await run(['--check','scripts/probe-native-language-stage2.mjs']);assert.equal(result.code,0,result.stderr);
});
// User-provided synthetic GLM response. JSON.stringify restores JSON escaping
// around the quoted Chinese criterion; all field values otherwise stay intact.
const reportedZhResult={ruleId:'NP-SYNTHETIC',verdict:'PASS',reason:'客户在第1轮询问是否存在蓝色版本，客服在第2轮明确确认存在蓝色版本，直接回答了合成问题，满足通过标准"回答合成问题"。辅助需求摘要已完成且语言校验状态为 verified,与原文一致,不与原文冲突。',evidence:['1','2'],evidenceQuotes:[{turnId:'1',role:'customer',quote:'هل توجد نسخة زرقاء؟'},{turnId:'2',role:'agent',quote:'Sí, existe una versión azul.'}],fieldEvidence:['demandSummary.value.text=客户询问是否存在蓝色版本。'],referenceIds:['NP-SYNTHETIC-POLICY@V1.0#','NP-SYNTHETIC-POLICY@V1.0#source'],confidence:'0.97',conflictsWith:[]};
async function probe(t,language,{invalidField=false,repairOnFeedback=false,reportedSample=false,malformedJson=false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'r39-probe-')),requests=[];
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const server=http.createServer(async(req,res)=>{
  try{
   let body='';for await(const chunk of req)body+=chunk;
   const request=JSON.parse(body),data=JSON.parse(request.messages[1].content);requests.push({request,data});
   const result=data.capability?capabilityBody(data,language):ruleBody(data,language);
   if(!data.capability){
    const item=result.results[0];item.fieldEvidence=[];
    if(invalidField&&!(repairOnFeedback&&data.validationFeedback?.path==='results[0].fieldEvidence'))item.fieldEvidence=['demandSummary'];
    // Include verbatim non-Chinese source in Chinese prose. Language validation
    // must exempt verified quotes without translating the source or the reason.
    if(language==='zh')item.reason+=' 原文回复为“'+data.session.turns[1].text+'”。';
    if(reportedSample){result.results=[structuredClone(reportedZhResult)];if(repairOnFeedback&&data.validationFeedback?.path==='results[0].fieldEvidence')result.results[0].fieldEvidence=[];}
   }
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify({id:'synthetic-local-probe',model:'synthetic-local',choices:[{finish_reason:'stop',message:{content:malformedJson&&!data.capability?'{"results":[{"reason":"criterion "quoted""}]}':JSON.stringify(result)}}]}));
  }catch(error){res.writeHead(500);res.end('Synthetic fixture error');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const config=path.join(dir,'config.json'),out=path.join(dir,'report');
 await fs.writeFile(config,JSON.stringify({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'synthetic-local',authMode:'bearer',apiKey:'SYNTHETIC-NOT-A-REAL-SECRET'}));
 const result=await run(['scripts/probe-native-language-stage2.mjs','--config',config,'--language',language,'--output',out,'--confirm-synthetic-model-calls']);
 const reportText=await fs.readFile(path.join(out,'model-probe.json'),'utf8');
 assert.doesNotMatch(reportText,/SYNTHETIC-NOT-A-REAL-SECRET/);
 const report=JSON.parse(reportText);
 if(process.env.R39_VERIFY_DIR){const dest=path.join(process.env.R39_VERIFY_DIR,`probe-${language}-${reportedSample?'reported-sample':malformedJson?'malformed-json':invalidField?repairOnFeedback?'repair':'reject':'valid'}.json`);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,reportText);}
 return{...result,report,requests};
}
for(const language of ['zh','en'])test(`same distributed ${language} CLI probe uses real HTTP transport and valid rule contract`,async t=>{
 const {code,report,requests,stderr}=await probe(t,language);
 assert.equal(code,0,stderr);assert.equal(report.status,'language-check-passed');assert.equal(requests.length,2);
 assert.equal(report.inspection.results[0].languageValidation.status,'verified');assert.deepEqual(report.inspection.results[0].fieldEvidence,[]);
 assert.equal(report.inspection.results[0].evidenceQuotes[0].quote,'Sí, existe una versión azul.');
});
test('probe reports exact structured field failure, retains synthetic response and retries with actionable feedback',async t=>{
 const {code,report,requests,stderr}=await probe(t,'zh',{invalidField:true,repairOnFeedback:true});
 assert.equal(code,0,stderr);assert.equal(report.status,'language-check-passed');assert.equal(requests.length,3);
 const failure=report.nodes.find(n=>n.status==='failed');
 assert.equal(failure.diagnostic.layer,'structured-results');assert.equal(failure.diagnostic.path,'results[0].fieldEvidence');
 assert.equal(failure.diagnostic.reasonCode,'unknown_context_field');assert.match(failure.modelContent,/demandSummary/);
 assert.equal(requests.at(-1).data.validationFeedback.path,'results[0].fieldEvidence');
});
test('probe never accepts invented field evidence after exhausted retries',async t=>{
 const {code,report,requests}=await probe(t,'zh',{invalidField:true});
 assert.equal(code,1);assert.equal(report.status,'failed');assert.equal(requests.length,4);
 assert.equal(report.errorDiagnostic.path,'results[0].fieldEvidence');assert.equal(report.inspection,undefined);
 assert.equal(report.nodes.filter(n=>n.status==='failed'&&n.diagnostic?.reasonCode==='unknown_context_field').length,3);
});
test('reported GLM zh sample fails only fieldEvidence, corrected retry preserves verdict, reason and both original quotes',async t=>{
 const {code,report,requests}=await probe(t,'zh',{reportedSample:true,repairOnFeedback:true});
 assert.equal(code,0);assert.equal(requests.length,3);assert.equal(report.status,'language-check-passed');
 const failed=report.nodes.filter(n=>n.status==='failed');assert.equal(failed.length,1);
 assert.equal(failed[0].diagnostic.path,'results[0].fieldEvidence');assert.equal(failed[0].diagnostic.reasonCode,'unknown_context_field');
 const result=report.inspection.results[0];assert.equal(result.reason,reportedZhResult.reason);assert.equal(result.verdict,'符合');
 assert.deepEqual(result.evidence,[1,2]);assert.equal(result.confidence,0.97);assert.equal(result.languageValidation.status,'verified');assert.equal(result.evidenceValidation,undefined);
 assert.deepEqual(result.evidenceQuotes.map(q=>q.quote),reportedZhResult.evidenceQuotes.map(q=>q.quote));
 assert.deepEqual(result.referenceIds,reportedZhResult.referenceIds);
});
test('malformed JSON is diagnosed separately from field evidence and language, never silently repaired',async t=>{
 const {code,report}=await probe(t,'zh',{malformedJson:true});assert.equal(code,1);
 assert.equal(report.errorDiagnostic.layer,'native-wire');assert.equal(report.errorDiagnostic.reasonCode,'invalid_json');assert.equal(report.inspection,undefined);
});
