import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {workbook} from '../public/io.mjs';
import {parseBusinessInput} from '../public/business-input.mjs';
import {parseCleaningResult} from '../server/conversation-cleaning.mjs';
const api=await import('../server/raw-structure-jobs.mjs').catch(()=>({}));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture({count=1,explicit=false}={}){
 globalThis.JSZip=JSZip;const base=path.resolve('../reports-r16/structure-data');await fs.mkdir(base,{recursive:true});const dataDir=await fs.mkdtemp(path.join(base,'case-')),headers=['会话ID','客服','消息详情','扩展'],texts=Array.from({length:count},(_,index)=>explicit?`2026-11-12T08:00:00+08:00 客户：合成问题${index+1}`:`客户：合成问题${index+1}\n客服：合成答复${index+1}`),rows=texts.map((text,index)=>[`SYN-${index+1}`,'Synthetic agent',text,'exact retained extension']);
 const bytes=Buffer.from(await workbook([{name:'合成原文',headers,rows}])),source={name:'synthetic.xlsx',sha256:sha(bytes),size:bytes.length},timePolicy={mode:explicit?'explicit':'unavailable',timezone:'+08:00'},sessions=rows.map((raw,index)=>({id:`syn-row-${index+2}`,taskId:'synthetic-task',externalId:raw[0],scene:'新品产品咨询',inputMode:'raw-transcript-v1',startedAt:'',turns:[],rawTranscript:{schemaVersion:1,text:texts[index],textSha256:sha(texts[index]),fileSha256:source.sha256,sheet:'合成原文',sheetIndex:1,headerRow:1,row:index+2,columns:{id:1,agent:2,text:3},headers,raw,timePolicy}})),task={id:'synthetic-task',name:'合成可选结构化',mode:'manual',scene:'新品产品咨询',inputMode:'raw-transcript-v1',rawImportOptions:{timePolicy,productDefault:''},source,basisSnapshot:{rules:[{id:'SYN-R',title:'合成规则'}],policies:[]}},state={tasks:[task],sessions};
 const config={baseUrl:'http://127.0.0.1:12345/v1',model:'synthetic-local',authMode:'none',timeoutMs:1000,configured:true,connectionTested:true},modelConfig={getPrivate:()=>structuredClone(config)},store={read:async()=>({revision:1,state:structuredClone(state)}),getSource:async()=>({bytes,sha256:source.sha256})};
 const calls=[];const client={prepareConversationCleaning:async({input})=>{calls.push(structuredClone(input));return cleaning(input);}};
 const cleaning=input=>parseCleaningResult(JSON.stringify({segments:[{kind:'message',sourceQuote:input.text,sourceLocator:{start:0,end:input.text.length},textQuote:explicit?'合成问题1':input.text,role:'客户',roleQuote:'客户',...(explicit?{atQuote:'2026-11-12T08:00:00+08:00'}:{})}],warnings:[]}),input);
 return{dataDir,state,store,modelConfig,config,client,calls,cleaning,bytes,source,close:()=>fs.rm(dataDir,{recursive:true,force:true})};
}
test('independent optional structure job requires explicit consent and a tested current model',async()=>{
 assert.equal(typeof api.createRawStructureJobs,'function');const f=await fixture(),jobs=await api.createRawStructureJobs(f);
 try{await assert.rejects(jobs.create({jobId:'syn-consent',taskId:'synthetic-task'}),/同意|consent/i);f.config.connectionTested=false;await assert.rejects(jobs.create({jobId:'syn-test',taskId:'synthetic-task',consent:true}),/测试|tested/i);assert.equal(f.calls.length,0);assert.equal((await jobs.list()).length,0);}finally{await jobs.close();await f.close();}
});
test('no timestamp source yields an exact-source unverified draft without mutating inspection evidence',async()=>{
 assert.equal(typeof api.createRawStructureJobs,'function');const f=await fixture({count:2}),before=JSON.stringify(f.state),jobs=await api.createRawStructureJobs(f);
 try{const created=await jobs.create({jobId:'syn-draft',taskId:'synthetic-task',consent:true});assert.equal(created.total,2);await jobs.waitForIdle();const result=await jobs.getResult(created.id);assert.equal(result.job.status,'completed');assert.equal(result.artifact.kind,'ai-unverified-draft');assert.match(result.artifact.label,/AI.*未核验/);assert.equal(result.artifact.validation.valid,false);assert.ok(result.artifact.missingInfo.some(item=>item.fields.includes('startedAt')));assert.ok(result.artifact.sheets.some(sheet=>sheet.name==='未解析原文'));assert.equal(f.calls.length,2);assert.ok(f.calls.every(input=>!input.text.includes('合成问题1')||!input.text.includes('合成问题2')));assert.equal(JSON.stringify(f.state),before);const node=await jobs.getNode(created.id,'n1');assert.equal(node.attempts.length,1);assert.equal(node.input.text,f.state.sessions[0].rawTranscript.text);}finally{await jobs.close();await f.close();}
});
test('optional structure rejects ungrounded output, retries only failed rows and preserves successful calls',async()=>{
 assert.equal(typeof api.createRawStructureJobs,'function');const f=await fixture({count:2});let bad=true;f.client.prepareConversationCleaning=async({input})=>{f.calls.push(input);const result=f.cleaning(input);if(input.row===2&&bad)result.segments[0].text='invented quote';return result;};const jobs=await api.createRawStructureJobs({...f,retryDelayMs:0});
 try{await jobs.create({jobId:'syn-retry',taskId:'synthetic-task',consent:true});await jobs.waitForIdle();assert.equal((await jobs.get('syn-retry')).failed,1);assert.equal(f.calls.length,3);bad=false;await jobs.retry('syn-retry');await jobs.waitForIdle();assert.equal((await jobs.get('syn-retry')).completed,2);assert.equal(f.calls.filter(input=>input.row===3).length,1);assert.equal(f.calls.length,4);}finally{await jobs.close();await f.close();}
});
test('pause and restart never resume calls automatically and restored snapshots reject tampering',async()=>{
 assert.equal(typeof api.createRawStructureJobs,'function');const f=await fixture({count:2});let release,started;const began=new Promise(resolve=>{started=resolve;});f.client.prepareConversationCleaning=async({input,signal})=>{f.calls.push(input);if(input.row===2){started();await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{code:'ABORTED'})),{once:true});});}return f.cleaning(input);};let jobs=await api.createRawStructureJobs(f);
 try{await jobs.create({jobId:'syn-pause',taskId:'synthetic-task',consent:true});await began;await jobs.pause('syn-pause');release();await jobs.waitForIdle();assert.equal((await jobs.get('syn-pause')).status,'paused');assert.equal(f.calls.length,1);await jobs.close();jobs=await api.createRawStructureJobs(f);assert.equal((await jobs.get('syn-pause')).status,'paused');assert.equal(f.calls.length,1);await jobs.resume('syn-pause');await jobs.waitForIdle();assert.equal((await jobs.get('syn-pause')).completed,2);
  await jobs.close();const file=path.join(f.dataDir,'raw-structure','report-jobs','syn-pause','snapshot.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));saved.records[0].rawTranscript.text+='tampered';await fs.writeFile(file,JSON.stringify(saved));jobs=await api.createRawStructureJobs(f);await assert.rejects(jobs.getResult('syn-pause'),/指纹|来源|source|storage/i);
 }finally{await jobs.close();await f.close();}
});
test('standard double-sheet is named only after actual ordinary preflight accepts all generated fields',async()=>{
 assert.equal(typeof api.createRawStructureJobs,'function');const f=await fixture({explicit:true}),jobs=await api.createRawStructureJobs(f);
 try{await jobs.create({jobId:'syn-standard',taskId:'synthetic-task',consent:true});await jobs.waitForIdle();const result=await jobs.getResult('syn-standard');assert.equal(result.artifact.kind,'standard-double-sheet');assert.equal(result.artifact.validation.valid,true);assert.match(result.artifact.label,/AI.*未核验/);const bytes=await workbook(result.artifact.sheets);const parsed=await parseBusinessInput({name:'synthetic-generated.xlsx',size:bytes.length,arrayBuffer:async()=>bytes});assert.equal(parsed.valid,true);assert.equal(parsed.sessions[0].startedAt,'2026-11-12T08:00:00+08:00');}finally{await jobs.close();await f.close();}
});
test('real transport authentication codes pause future dispatch and require retested configuration before resume',async()=>{
 const f=await fixture({count:2});let rejected=true;f.client.prepareConversationCleaning=async({input})=>{f.calls.push(input);if(rejected)throw Object.assign(new Error('synthetic authentication failure'),{code:'AUTHENTICATION'});return f.cleaning(input);};const jobs=await api.createRawStructureJobs({...f,retryDelayMs:0});
 try{await jobs.create({jobId:'syn-auth',taskId:'synthetic-task',consent:true});await jobs.waitForIdle();assert.equal((await jobs.get('syn-auth')).status,'paused');assert.equal(f.calls.length,1);f.config.connectionTested=false;await assert.rejects(jobs.resume('syn-auth'),/测试/);assert.equal(f.calls.length,1);rejected=false;f.config.connectionTested=true;await jobs.resume('syn-auth');await jobs.waitForIdle();assert.equal((await jobs.get('syn-auth')).completed,2);}finally{await jobs.close();await f.close();}
});
test('paused crash recovery adopts a saved completed row without calling it again and rejects prompt version drift',async()=>{
 const f=await fixture({count:2});let jobs=await api.createRawStructureJobs(f);
 try{await jobs.create({jobId:'syn-recovery',taskId:'synthetic-task',consent:true});await jobs.waitForIdle();await jobs.close();const file=path.join(f.dataDir,'raw-structure','report-jobs','syn-recovery','job.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));saved.status='paused';saved.units[0].status='running';delete saved.units[0].resultSha256;await fs.writeFile(file,JSON.stringify(saved));jobs=await api.createRawStructureJobs(f);assert.equal((await jobs.get('syn-recovery')).completed,2);assert.equal(f.calls.length,2);await jobs.resume('syn-recovery');await jobs.waitForIdle();assert.equal(f.calls.length,2);await jobs.close();const changed=JSON.parse(await fs.readFile(file,'utf8'));changed.promptVersion='unknown-future-prompt';await fs.writeFile(file,JSON.stringify(changed));jobs=await api.createRawStructureJobs(f);await assert.rejects(jobs.getResult('syn-recovery'),/版本|指纹|来源/);}
 finally{await jobs.close();await f.close();}
});
test('unavailable declared time stays blank even when model output quotes a valid timestamp',async()=>{
 const f=await fixture({explicit:true});f.state.tasks[0].rawImportOptions.timePolicy.mode='unavailable';for(const session of f.state.sessions)session.rawTranscript.timePolicy.mode='unavailable';const jobs=await api.createRawStructureJobs(f);
 try{await jobs.create({jobId:'syn-unavailable-time',taskId:'synthetic-task',consent:true});await jobs.waitForIdle();const result=await jobs.getResult('syn-unavailable-time');assert.equal(result.artifact.kind,'ai-unverified-draft');assert.equal(result.artifact.sheets.find(sheet=>sheet.name==='会话信息').rows[0][2],'');assert.equal(result.artifact.sheets.find(sheet=>sheet.name==='会话明细').rows[0][4],'');}finally{await jobs.close();await f.close();}
});
test('ordinary report-only injected clients can start when optional structure is unused',async()=>{
 const f=await fixture();delete f.client.prepareConversationCleaning;const jobs=await api.createRawStructureJobs(f);
 try{assert.deepEqual(await jobs.list(),[]);await assert.rejects(jobs.create({jobId:'syn-unavailable-client',taskId:'synthetic-task',consent:true}),error=>error.code==='STRUCTURE_UNAVAILABLE');}finally{await jobs.close();await f.close();}
});

test('backup busy probe includes paused raw-structure requests until their final checkpoint',async()=>{
 const f=await fixture({count:2});let enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 f.client.prepareConversationCleaning=async({input})=>{f.calls.push(input);enter();await gate;return f.cleaning(input);};const jobs=await api.createRawStructureJobs(f);
 try{
  assert.equal(jobs.isBusy(),false);const creation=jobs.create({jobId:'backup-busy',taskId:'synthetic-task',consent:true});assert.equal(jobs.isBusy(),true);await creation;await entered;
  await jobs.pause('backup-busy');assert.equal((await jobs.get('backup-busy')).status,'paused');assert.equal(jobs.isBusy(),true);
  release();await jobs.waitForIdle();assert.equal(jobs.isBusy(),false);assert.equal(f.calls.length,1);await jobs.resume('backup-busy');await jobs.waitForIdle();assert.equal(jobs.isBusy(),false);assert.equal(f.calls.length,2);
 }finally{release();await jobs.close();await f.close();}
});
test('optional structure stored node diagnostics redact model credentials from provider errors',async()=>{
 const f=await fixture(),secret='synthetic-structure-secret-12345';Object.assign(f.config,{authMode:'bearer',apiKey:secret});f.client.prepareConversationCleaning=async()=>{throw Object.assign(new Error('synthetic error'),{code:'INVALID_OUTPUT',traceOutput:{authorization:secret,content:'Provider echoed '+secret}});};const jobs=await api.createRawStructureJobs({...f,maxAttempts:1});
 try{await jobs.create({jobId:'syn-redaction',taskId:'synthetic-task',consent:true});await jobs.waitForIdle();const node=await jobs.getNode('syn-redaction','n1');assert.ok(!JSON.stringify(node).includes(secret));}finally{await jobs.close();await f.close();}
});
