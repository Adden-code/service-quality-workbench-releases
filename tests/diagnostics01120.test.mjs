import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWorkbenchServer} from '../server.mjs';
import {createDiagnosticBundle,projectDiagnosticTrace,safeModelConfiguration,projectStartupLog,MAX_DIAGNOSTIC_BYTES} from '../server/diagnostics.mjs';

const root=path.resolve('../outputs/service01120-20261123/diagnostic-tests');
const secret='SYNTHETIC_DO_NOT_EXPORT_KEY',content='SYNTHETIC_PRIVATE_CUSTOMER_MESSAGE';
async function directory(t){await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'case-'));t.after(async()=>{assert.ok(dir.startsWith(root+path.sep));await fs.rm(dir,{force:true,recursive:true});});return dir;}
async function unpack(bytes){const z=await globalThis.JSZip.loadAsync(bytes),files={};for(const [name,file]of Object.entries(z.files))if(!file.dir)files[name]=await file.async('string');return files;}
test('diagnostics allowlist drops source text and secrets at every trace level',()=>{
 const trace=projectDiagnosticTrace({id:content,taskId:content,label:content,input:{apiKey:secret},nodes:[{id:content,label:content,status:content,error:{code:content,reason:secret},output:{content},durationMs:22},{id:'r0-a1-cap-pre-intent-1-model',status:'failed',error:{code:'invalid_output',reason:content}}]});
 assert.doesNotMatch(JSON.stringify(trace),new RegExp(secret+'|'+content));assert.equal(trace.nodes[1].errorCode,'invalid_output');assert.equal(trace.nodes[1].capability,'intent');
 assert.deepEqual(safeModelConfiguration({baseUrl:`https://user:${secret}@example.invalid/v1?apiKey=${secret}#${secret}`,model:'synthetic-model',authMode:'bearer',apiKey:secret}),{baseUrl:'https://example.invalid/v1',model:'synthetic-model',authMode:'bearer'});
 assert.doesNotMatch(JSON.stringify(safeModelConfiguration({baseUrl:`https://example.invalid/${secret}`,model:secret,apiKey:secret})),new RegExp(secret));
 const logs=projectStartupLog(`2026-11-23T00:00:00.000Z READY app=4191 worker=4192\n2026-11-23T00:00:01.000Z READY ${content}\n${secret}`);assert.equal(logs.entries.length,1);assert.equal(logs.omittedLines,2);assert.doesNotMatch(JSON.stringify(logs),new RegExp(secret+'|'+content));
});
test('diagnostics skips linked log directories and refuses a linked output destination',async t=>{
 const dir=await directory(t),outside=await directory(t);await fs.writeFile(path.join(outside,'portable-startup.log'),content);
 await fs.symlink(outside,path.join(dir,'logs'),process.platform==='win32'?'junction':'dir');
 const result=await createDiagnosticBundle({dataDir:dir,document:{},build:{},modelConfig:{}}),files=await unpack(result.bytes);assert.doesNotMatch(JSON.stringify(files),new RegExp(content));assert.ok(JSON.parse(files['coverage.json']).notes.includes('startup_log_missing_large_or_unsafe'));
 const other=await directory(t);await fs.symlink(outside,path.join(other,'diagnostics'),process.platform==='win32'?'junction':'dir');await assert.rejects(createDiagnosticBundle({dataDir:other,document:{}}),/unsafe diagnostic directory/);assert.deepEqual(await fs.readdir(outside),['portable-startup.log']);
});
test('ZIP is bounded and preserves useful metadata without raw logs, source data or credentials',async t=>{
 const dir=await directory(t);await fs.mkdir(path.join(dir,'logs'));await fs.mkdir(path.join(dir,'workflow-runs'));
 await fs.writeFile(path.join(dir,'logs/portable-startup.log'),`2026-11-23T00:00:00.000Z READY app=4191 worker=4192\n${secret}\n${content}`);
 const id=randomUUID();await fs.writeFile(path.join(dir,'workflow-runs',id+'.json'),JSON.stringify({id,taskId:content,nodes:[{id:'r0-a1-validation',status:'failed',error:{code:'invalid_output',reason:content},input:{apiKey:secret},output:{quote:content}}]}));
 const options={dataDir:dir,document:{revision:1397,state:{tasks:[{name:content,aiRun:{status:'paused'}}],sessions:[{turns:[content]}],aiTaskQueue:{status:'paused',entries:[{status:'queued',error:secret}]}}},build:{version:'0.11.20',buildId:'0.11.20-0123456789abcdef'},modelConfig:{baseUrl:'https://example.invalid/v1',model:'synthetic-model',authMode:'bearer',apiKey:secret}};
 const basic=await createDiagnosticBundle(options),basicFiles=await unpack(basic.bytes);assert.ok(!Object.keys(basicFiles).some(k=>k.startsWith('workflow-runs/')));
 const full=await createDiagnosticBundle({...options,includeTraces:true}),files=await unpack(full.bytes);assert.ok(full.bytes.length<MAX_DIAGNOSTIC_BYTES);assert.deepEqual(await fs.readFile(full.savedPath),full.bytes);assert.doesNotMatch(JSON.stringify(files),new RegExp(secret+'|'+content));
 assert.equal(JSON.parse(files['metadata.json']).workspace.revision,1397);assert.equal(JSON.parse(files['workflow-runs/run-1.json']).runId,id);assert.equal(JSON.parse(files['coverage.json']).traceFilesIncluded,1);
 // Too many traces are explicitly omitted, never silently combined into an oversized file.
 for(let i=0;i<66;i++)await fs.writeFile(path.join(dir,'workflow-runs',`extra-${i}.json`),JSON.stringify({id:String(i),nodes:[]}));
 const bounded=await createDiagnosticBundle({...options,includeTraces:true});assert.equal(bounded.traceFilesSkipped,3);assert.ok(bounded.bytes.length<MAX_DIAGNOSTIC_BYTES);
});
test('diagnostic route requires current origin and token, rejects business-content options, writes readable ZIP',async t=>{
 const dir=await directory(t),server=await createWorkbenchServer({dataDir:dir,catalogSeed:null,sceneSeed:null});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}`,doc=await(await fetch(origin+'/api/workspace')).json(),headers={'Content-Type':'application/json',Origin:origin,'X-Workspace-Token':doc.token};
 let response=await fetch(origin+'/api/diagnostics/export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
 response=await fetch(origin+'/api/diagnostics/export',{method:'POST',headers,body:'{"includeBusinessData":true}'});assert.equal(response.status,400);
 response=await fetch(origin+'/api/diagnostics/export',{method:'POST',headers,body:'{"includeTraces":true}'});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');
 const bytes=Buffer.from(await response.arrayBuffer()),saved=decodeURIComponent(response.headers.get('x-diagnostic-path'));assert.ok(saved.startsWith(path.join(dir,'diagnostics')+path.sep));assert.deepEqual(await fs.readFile(saved),bytes);const files=await unpack(bytes);assert.ok(files['metadata.json']);assert.ok(files['README.txt']);
 assert.equal((await(await fetch(origin+'/api/workspace')).json()).revision,doc.revision);
});
test('standalone installed module layout loads ZIP without checkout ESM globals',async t=>{
 const dir=await directory(t);await fs.mkdir(path.join(dir,'server'));await fs.mkdir(path.join(dir,'public/vendor'),{recursive:true});await fs.mkdir(path.join(dir,'data'));
 await fs.writeFile(path.join(dir,'package.json'),'{}');await fs.copyFile(new URL('../server/diagnostics.mjs',import.meta.url),path.join(dir,'server/diagnostics.mjs'));await fs.copyFile(new URL('../public/vendor/jszip.min.js',import.meta.url),path.join(dir,'public/vendor/jszip.min.js'));
 await fs.writeFile(path.join(dir,'check.mjs'),`import {createDiagnosticBundle} from './server/diagnostics.mjs';const result=await createDiagnosticBundle({dataDir:new URL('./data',import.meta.url).pathname.replace(/^\\/(\\w:)/,'$1'),document:{},modelConfig:{},build:{}});console.log(result.bytes.length);`.replace("new URL('./data',import.meta.url).pathname.replace(/^\\/(\\w:)/,'$1')",JSON.stringify(path.join(dir,'data'))));
 const result=await promisify(execFile)(process.execPath,[path.join(dir,'check.mjs')],{windowsHide:true});assert.ok(Number(result.stdout.trim())>0);
});
