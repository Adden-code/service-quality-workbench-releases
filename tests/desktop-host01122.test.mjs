import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {getConfig,getLayout,startSupervisor,queryInstance,inspectDesktopInstance,recoverStalePortableLock,normalizeDesktopActivity} from '../packaging/portable-runtime.mjs';
import {runDesktopCommand} from '../packaging/desktop-host.mjs';
import {runPortableCommand} from '../packaging/portable-launch.mjs';
import {activeDesktopJobCount,readDesktopActivity} from '../server/desktop-activity.mjs';
import {createWorkbenchServer} from '../server.mjs';
import {javaCoreFiles} from '../packaging/startup-diagnostics.mjs';
const root=path.resolve('tests/artifacts/desktop-host01122'),idle=()=>({busy:false,counts:{ai:0,report:0,translation:0,structured:0},unknown:false});
const listen=(server,port=0)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server.address().port));});
async function unusedPort(){for(;;){const server=http.createServer(),n=await listen(server);await new Promise(resolve=>server.close(resolve));try{getConfig({env:{DEMO_PORT:String(n)}});return n;}catch{}}}
const workerCode=`const http=require('http'),s=http.createServer((req,res)=>{if(req.url!=='/internal/health'||req.headers['x-bridge-token']!==process.env.WORKBENCH_BRIDGE_TOKEN){res.writeHead(403);res.end();return;}res.end(JSON.stringify({status:'ok',engine:'spring-ai'}));});s.listen(Number(process.env.WORKBENCH_WORKER_PORT),'127.0.0.1');process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`;
async function fixture(t){
 await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'synthetic-')),home=path.join(dir,'中文 app'),layout=getLayout(home),supervisors=[],workers=[];
 t.after(async()=>{for(const supervisor of supervisors)await supervisor.stop();assert.ok(dir.startsWith(root+path.sep));await fs.rm(dir,{recursive:true,force:true});});
 for(const file of [layout.nodeExe,layout.javaExe,layout.jarPath,layout.runtimeScript,layout.launchScript,layout.serverModule,path.join(layout.publicDir,'index.html')]){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'Synthetic packaged dependency');}
 for(const relative of javaCoreFiles){const file=path.join(home,'runtime/java',relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'Synthetic packaged dependency');}
 const appPort=await unusedPort();let workerPort=await unusedPort();while(workerPort===appPort)workerPort=await unusedPort();
 const env={...process.env,LOCALAPPDATA:path.join(dir,'local'),DEMO_DATA_DIR:path.join(dir,'data'),DEMO_PORT:String(appPort),WORKBENCH_WORKER_PORT:String(workerPort)},config=getConfig({rootDir:home,env});
 const start=async(create=options=>createWorkbenchServer({...options,catalogSeed:null,sceneSeed:null}))=>{const supervisor=await startSupervisor(config,{registerSignals:false,env,createWorkbenchServer:create,spawnWorker:(executable,args,opts)=>{const worker=spawn(process.execPath,['-e',workerCode],opts);workers.push(worker);return worker;}});supervisors.push(supervisor);return supervisor;};
 return{dir,home,config,env,start,workers};
}
const run=(args,options)=>runDesktopCommand(args,{write:()=>{},...options});
test('job activity counts queued/running tasks once, ignores completed/paused and includes pending writes',()=>{
 const jobs=[{id:'a',status:'running'},{id:'b',status:'queued'},{id:'c',status:'paused'},{id:'d',status:'completed'}];assert.equal(activeDesktopJobCount({jobs,activeIds:['a']}),2);assert.equal(activeDesktopJobCount({jobs,activeIds:['c']}),3);assert.equal(activeDesktopJobCount({pendingOperations:1}),1);
});
for(const key of ['ai','report','translation','structured'])test(`${key} queued activity prevents an idle close decision`,()=>{
 const services=Object.fromEntries(['ai','report','translation','structured'].map(name=>[name,{activityCount:()=>name===key?activeDesktopJobCount({jobs:[{id:'queued',status:'queued'}]}):0}]));const value=readDesktopActivity(services);assert.equal(value.busy,true);assert.equal(value.unknown,false);assert.equal(value.counts[key],1);
});
test('missing, throwing and malformed activity is unknown and conservatively busy',()=>{
 for(const service of [undefined,{activityCount:()=>{throw Error('Synthetic unavailable');}},{activityCount:()=>-1}]){const value=readDesktopActivity({ai:service});assert.equal(value.unknown,true);assert.equal(value.busy,true);}
 assert.equal(normalizeDesktopActivity({...idle(),counts:{ai:1,report:0,translation:0,structured:0}}).busy,true);assert.deepEqual(normalizeDesktopActivity(null),{...idle(),busy:true,unknown:true});
});
test('inspect is read-only before first startup and fixed defaults remain 4186/4192',async t=>{
 const f=await fixture(t),value=await run(['--inspect'],f);assert.equal(value.ok,true);assert.equal(value.state,'stopped');assert.equal(value.dataDir,f.config.dataDir);assert.match(value.rootId,/^[a-f0-9]{64}$/);assert.deepEqual(value.activity,idle());await assert.rejects(fs.stat(f.config.dataDir),{code:'ENOENT'});
 const defaults=getConfig({rootDir:f.home,env:{LOCALAPPDATA:f.dir}});assert.equal(defaults.appPort,4186);assert.equal(defaults.workerPort,4192);
});
test('start reuses verified service, never opens browser, returns lightweight activity without workspace payload',async t=>{
 const f=await fixture(t);let starts=0,opens=0;const start=(args,options)=>runPortableCommand(args,{...options,startDetached:async()=>{starts++;await f.start();return{exitCode:null};},openBrowser:async()=>{opens++;}});
 const first=await run(['--start'],{...f,start});assert.equal(first.ok,true);assert.equal(first.state,'ready');assert.equal(first.started,true);assert.deepEqual(first.activity,idle());assert.equal(first.stateSnapshot,undefined);assert.equal(first.state?.tasks,undefined);
 const second=await run(['--start'],{...f,start});assert.equal(second.ok,true);assert.equal(second.started,false);assert.equal(starts,1);assert.equal(opens,0);assert.equal(f.workers.length,1);
 const saved=JSON.parse(await fs.readFile(f.config.instanceFile));assert.ok(!JSON.stringify(first).includes(saved.controlToken));assert.equal((await queryInstance(f.config)).activity.unknown,false);
});
test('private control reads live task activity; a missing activity provider remains unknown',async t=>{
 const f=await fixture(t);let activity={...idle(),busy:true,counts:{ai:1,report:2,translation:3,structured:4}};
 await f.start(async()=>{const server=http.createServer((req,res)=>res.end('Synthetic'));server.desktopActivity=()=>activity;return server;});
 assert.deepEqual((await run(['--inspect'],f)).activity,activity);activity=undefined;assert.equal((await run(['--inspect'],f)).activity.unknown,true);
});
test('stop waits for app persistence and actual owned worker exit before reporting stopped',async t=>{
 const f=await fixture(t),saved=path.join(f.dir,'synthetic-flushed.txt');let flushStarted;const begun=new Promise(resolve=>flushStarted=resolve);let finishFlush;const permit=new Promise(resolve=>finishFlush=resolve);
 await f.start(async()=>{const server=http.createServer(),close=server.close.bind(server);server.desktopActivity=idle;server.close=callback=>close(()=>{flushStarted();permit.then(()=>fs.writeFile(saved,'Synthetic durable state')).then(()=>callback());});return server;});
 let completed=false;const pending=run(['--stop'],f).then(v=>{completed=true;return v;});await begun;await delay(50);assert.equal(completed,false);assert.ok(await fs.stat(f.config.instanceFile));finishFlush();
 const result=await pending;assert.equal(result.ok,true);assert.equal(result.state,'stopped');assert.equal(await fs.readFile(saved,'utf8'),'Synthetic durable state');assert.ok(f.workers[0].exitCode!==null||f.workers[0].signalCode!==null);await assert.rejects(fs.stat(f.config.instanceFile),{code:'ENOENT'});
});
test('app flush failure retains verified identity and returns failure, never a false successful stop',async t=>{
 const f=await fixture(t);let failFlush=true;
 await f.start(async()=>{const server=http.createServer(),close=server.close.bind(server);server.desktopActivity=idle;server.close=callback=>close(()=>callback(failFlush?Error('Synthetic flush failure'):undefined));server.closeWorkspace=async()=>{if(failFlush)throw Error('Synthetic flush failure');};return server;});
 try{const result=await run(['--stop'],f);assert.equal(result.ok,false);assert.equal(result.error.code,'STOP_FAILED');assert.ok(await fs.stat(f.config.instanceFile));assert.ok(await fs.stat(f.config.lockFile));}finally{failFlush=false;}
});
async function deadPid(){const child=spawn(process.execPath,['-e','process.exit(0)']);await once(child,'exit');return child.pid;}
async function deadLock(f,overrides={}){await fs.mkdir(f.config.dataDir,{recursive:true});const info=await inspectDesktopInstance(f.config),value={pid:await deadPid(),nonce:'1'.repeat(32),rootDir:await fs.realpath(f.home),dataDir:await fs.realpath(f.config.dataDir),rootId:info.rootId,...overrides};await fs.writeFile(f.config.lockFile,JSON.stringify(value));return value;}
test('dead matching owner requires confirmation, recovery is idempotent and does not edit workspace bytes',async t=>{
 const f=await fixture(t);await deadLock(f);const workspace=path.join(f.config.dataDir,'workspace.json');await fs.writeFile(workspace,'Synthetic retained bytes');const status=await run(['--inspect'],f);assert.equal(status.staleLock.recoverable,true);assert.equal((await run(['--start'],f)).error.code,'STALE_LOCK_CONFIRMATION');
 const recovered=await run(['--recover-stale'],f);assert.equal(recovered.ok,true);assert.equal(recovered.recovered,true);assert.equal(recovered.staleLock.present,false);assert.equal((await run(['--recover-stale'],f)).recovered,false);assert.equal(await fs.readFile(workspace,'utf8'),'Synthetic retained bytes');
});
test('live, identity-mismatched, unknown and concurrent replacement locks are never deleted',async t=>{
 const f=await fixture(t);
 for(const override of [{pid:process.pid},{rootId:'f'.repeat(64)},{rootDir:path.join(f.dir,'foreign')}]){await deadLock(f,override);const before=await fs.readFile(f.config.lockFile);const result=await run(['--recover-stale'],f);assert.equal(result.ok,false);assert.deepEqual(await fs.readFile(f.config.lockFile),before);}
 await fs.writeFile(f.config.lockFile,'{"pid":999999,"nonce":"unknown"}');assert.equal((await run(['--recover-stale'],f)).ok,false);assert.equal((await run(['--inspect'],f)).state,'blocked');
 const original=await deadLock(f),replacement={...original,pid:process.pid,nonce:'new-live-owner'};await assert.rejects(recoverStalePortableLock(f.config,{beforeVerify:()=>fs.writeFile(f.config.lockFile,JSON.stringify(replacement))}),{code:'INSTANCE_LOCKED'});assert.deepEqual(JSON.parse(await fs.readFile(f.config.lockFile)),replacement);
});
test('duplicate supervisors refuse a second worker and keep the verified original running',async t=>{
 const f=await fixture(t);await f.start();await assert.rejects(f.start(),{code:'INSTANCE_LOCKED'});assert.equal(f.workers.length,1);assert.equal((await run(['--inspect'],f)).state,'ready');
});
test('CLI accepts home paths with spaces and writes exactly one JSON result even on errors',async t=>{
 const f=await fixture(t),script=path.resolve('packaging/desktop-host.mjs');
 for(const args of [['--inspect','--home',f.home],['--unknown','--home',f.home]]){
  const child=spawn(process.execPath,[script,...args],{env:f.env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const [code]=await once(child,'close');assert.equal(stderr,'');assert.equal(stdout.trim().split('\n').length,1);const result=JSON.parse(stdout);assert.equal(result.ok,args[0]==='--inspect');assert.equal(code,result.ok?0:1);
 }
});
