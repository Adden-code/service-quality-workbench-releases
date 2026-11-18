import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {productVersion} from '../packaging/version.mjs';

const runtimeUrl=new URL('../packaging/portable-runtime.mjs',import.meta.url);
const launchUrl=new URL('../packaging/portable-launch.mjs',import.meta.url);
const ownedSupervisors=new Map();
async function implementation(){assert.ok(existsSync(runtimeUrl),'缺少独立便携主管实现');const runtime=await import(runtimeUrl);return {...runtime,startSupervisor:async(config,options)=>{const supervisor=await runtime.startSupervisor(config,options);ownedSupervisors.set(config.dataDir,supervisor);return supervisor;}};}
const listen=(server,port=0)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});});
const close=server=>new Promise(resolve=>server.close(resolve));
async function unusedPort(pick=async()=>{const server=http.createServer();const value=await listen(server);await close(server);return value;}){
  const {getConfig}=await implementation();
  for(let attempt=0;attempt<64;attempt++){
    const value=await pick();
    try{getConfig({rootDir:'.',env:{DEMO_PORT:String(value),WORKBENCH_WORKER_PORT:value===4192?'4193':'4192'}});return value;}
    catch(error){if(error.code!=='UNSAFE_FETCH_PORT')throw error;}
  }
  throw new Error('测试未找到Fetch可用的空闲端口。');
}
async function fixture(t,env={}){
  const base='D:/Codex project/outputs/service-installer-tests';await fs.mkdir(base,{recursive:true});
  const temporary=await fs.mkdtemp(path.join(base,'portable supervisor '));
  t.after(async()=>{for(const [dataDir,supervisor] of ownedSupervisors)if(dataDir.startsWith(temporary+path.sep)){await supervisor.stop();ownedSupervisors.delete(dataDir);}await fs.rm(temporary,{recursive:true,force:true});});
  const rootDir=path.join(temporary,'中文 包含空格');
  const {getLayout,getConfig}=await implementation();
  const layout=getLayout(rootDir);
  for(const target of [layout.nodeExe,layout.javaExe,layout.jarPath,layout.runtimeScript,layout.launchScript,layout.serverModule,path.join(layout.publicDir,'index.html')]){await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'fixture');}
  const appPort=await unusedPort();let workerPort=await unusedPort();while(workerPort===appPort)workerPort=await unusedPort();
  const config=getConfig({rootDir,env:{LOCALAPPDATA:path.join(temporary,'local data'),DEMO_PORT:String(appPort),WORKBENCH_WORKER_PORT:String(workerPort),...env}});
  return {rootDir,config,temporary};
}
const workerScript=`const http=require('http');const token=process.env.WORKBENCH_BRIDGE_TOKEN;const s=http.createServer((req,res)=>{if(req.url!=='/internal/health'||req.headers['x-bridge-token']!==token){res.writeHead(401);res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',engine:'spring-ai'}));});s.listen(Number(process.env.WORKBENCH_WORKER_PORT),'127.0.0.1');process.once('SIGTERM',()=>s.close(()=>process.exit(0)));`;
function workerSpawn(capture=[]){return (executable,args,options)=>{capture.push({executable,args,options});return spawn(process.execPath,['-e',workerScript],options);};}
async function readJson(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function replaceControlProbe(t,config,supervisor,{transient=false,mismatch=false}={}){
 const record=await readJson(config.instanceFile);let calls=0;
 const proxy=http.createServer((req,res)=>{calls++;if(req.headers['x-portable-token']!==record.controlToken){res.writeHead(403);res.end();return;}if(transient&&calls===1){req.socket.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...supervisor.status(),...(mismatch?{pid:record.pid+1}:{})}));});
 const controlPort=await listen(proxy);await fs.writeFile(config.instanceFile,JSON.stringify({...record,controlPort}));t.after(()=>close(proxy));return()=>calls;
}

test('its own new startup tolerates one transient control failure but still verifies ready identity',async t=>{
 const {runPortableCommand}=await import(launchUrl),{startSupervisor}=await implementation(),{config}=await fixture(t);let calls;
 const result=await runPortableCommand(['--no-open'],{config,write:()=>{},startDetached:async()=>{const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});calls=await replaceControlProbe(t,config,supervisor,{transient:true});return{exitCode:null};}});
 assert.equal(result.state,'ready');assert.equal(result.started,true);assert.equal(calls(),2);
});

test('an unverifiable existing instance is rejected before starting another process',async t=>{
 const {runPortableCommand}=await import(launchUrl),{startSupervisor}=await implementation(),{config}=await fixture(t),supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});
 await replaceControlProbe(t,config,supervisor,{transient:true});let starts=0;
 await assert.rejects(runPortableCommand(['--no-open'],{config,write:()=>{},startDetached:async()=>{starts++;}}),error=>error.code==='INSTANCE_UNVERIFIED');assert.equal(starts,0);
});

test('even its own startup immediately rejects a mismatched control identity',async t=>{
 const {runPortableCommand}=await import(launchUrl),{startSupervisor}=await implementation(),{config}=await fixture(t);let calls;
 await assert.rejects(runPortableCommand(['--no-open'],{config,write:()=>{},startDetached:async()=>{const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});calls=await replaceControlProbe(t,config,supervisor,{mismatch:true});return{exitCode:null};}}),error=>error.code==='INSTANCE_IDENTITY');assert.equal(calls(),1);
});
async function locatorPath(config,record){const root=await fs.realpath(config.rootDir),key=createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex');return path.join(config.installationIndexDir,key,record.rootId+'.json');}
function request(port,route,{token,method='GET',origin,host}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{...(token?{'X-Portable-Token':token}:{}),...(origin?{Origin:origin}:{}),...(host?{Host:host}:{})}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>{let value=raw;try{value=raw?JSON.parse(raw):null;}catch{}resolve({status:res.statusCode,value});});});req.on('error',reject);req.end();});}

test('测试端口选择跳过系统分配的Fetch禁用端口',async()=>{
  const choices=[5061,6000,42001];let calls=0;
  assert.equal(await unusedPort(async()=>{calls++;return choices.shift();}),42001);assert.equal(calls,3);
});

test('便携布局在中文空格路径中只使用包内运行时和扁平文件',async()=>{
  const {getLayout}=await implementation();const root=path.resolve('portable 中文 space');const layout=getLayout(root);
  assert.equal(layout.nodeExe,path.join(root,'runtime','node','node.exe'));
  assert.equal(layout.javaExe,path.join(root,'runtime','java','bin','java.exe'));
  assert.equal(layout.jarPath,path.join(root,'service','spring-ai-worker.jar'));
  assert.equal(layout.serverModule,path.join(root,'server.mjs'));
  assert.equal(layout.runtimeScript,path.join(root,'packaging','portable-runtime.mjs'));
});

test('默认数据使用新LocalAppData目录，显式配置可隔离且无原工作区复制',async t=>{
  const {getConfig}=await implementation();const {rootDir,temporary}=await fixture(t);
  const config=getConfig({rootDir,env:{LOCALAPPDATA:path.join(temporary,'user local')}});
  assert.equal(config.dataDir,path.join(temporary,'user local','MSSQualityWorkbench','portable'));
  assert.equal(config.appPort,4186);assert.equal(config.workerPort,4192);
  assert.equal(getConfig({rootDir,env:{DEMO_DATA_DIR:path.join(temporary,'chosen')}}).dataDir,path.join(temporary,'chosen'));
});

test('本机端口拒绝非整数、越界、重叠和Fetch禁用的4190执行端口',async()=>{
  const {getConfig}=await implementation();
  for(const raw of ['0','1023','65536','4192.5',' 4192','NaN'])assert.throws(()=>getConfig({rootDir:'.',env:{DEMO_PORT:raw}}),/端口/);
  assert.throws(()=>getConfig({rootDir:'.',env:{DEMO_PORT:'4192',WORKBENCH_WORKER_PORT:'4192'}}),/不同/);
  assert.throws(()=>getConfig({rootDir:'.',env:{WORKBENCH_WORKER_PORT:'4190'}}),/4190/);
});

test('工作台和Java执行端口都拒绝随包Fetch完整禁用清单中的高位端口',async()=>{
  const {getConfig}=await implementation();
  const bundledFetch=process.binding('natives')['internal/deps/undici/undici'];
  const constants=bundledFetch.match(/badPorts = \([\s\S]*?\[([\s\S]*?)\]/);
  assert.ok(constants,'应能核对随包Node实际Fetch端口清单');
  const badPorts=[...constants[1].matchAll(/"(\d+)"/g)].map(match=>Number(match[1])).filter(value=>value>=1024);
  assert.equal(badPorts.length,19);
  for(const blocked of badPorts)for(const field of ['DEMO_PORT','WORKBENCH_WORKER_PORT']){
    assert.throws(()=>getConfig({rootDir:'.',env:{DEMO_PORT:'14186',WORKBENCH_WORKER_PORT:'14192',[field]:String(blocked)}}),/Fetch|浏览器/,`${field}=${blocked} 应在启动前明确拒绝`);
  }
  for(const allowed of [1024,4186,4192,14186,65535]){
    assert.equal(getConfig({rootDir:'.',env:{DEMO_PORT:String(allowed),WORKBENCH_WORKER_PORT:'14192'}}).appPort,allowed);
    assert.equal(getConfig({rootDir:'.',env:{DEMO_PORT:'14192',WORKBENCH_WORKER_PORT:String(allowed)}}).workerPort,allowed);
  }
});

test('缺少随包Java时拒绝启动，不调用其他运行时',async t=>{
  const {startSupervisor}=await implementation();const {config}=await fixture(t);await fs.unlink(config.javaExe);let spawns=0;
  await assert.rejects(startSupervisor(config,{spawnWorker:()=>spawns++,registerSignals:false}),/依赖|Java/);assert.equal(spawns,0);
  assert.equal(existsSync(config.instanceFile),false);assert.equal(existsSync(config.lockFile),false);
});

test('工作台或执行端口占用时拒绝且保留占用程序',async t=>{
  const {startSupervisor}=await implementation();
  for(const field of ['appPort','workerPort']){
    const {config}=await fixture(t);const occupied=http.createServer((req,res)=>res.end('unrelated'));await listen(occupied,config[field]);t.after(()=>occupied.listening?close(occupied):undefined);let spawns=0;
    await assert.rejects(startSupervisor(config,{spawnWorker:()=>spawns++,registerSignals:false}),/占用/);assert.equal(spawns,0);assert.equal(occupied.listening,true);
    assert.equal(existsSync(config.instanceFile),false);assert.equal(existsSync(config.lockFile),false);
  }
});

test('真实HTTP生命周期等待Java健康，内存桥接令牌不落盘且Java不继承方舟密钥',async t=>{
  const {startSupervisor,queryInstance}=await implementation();const {config}=await fixture(t);const captures=[];
  const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(captures),registerSignals:false,env:{...process.env,ARK_API_KEY:'DO_NOT_PERSIST_TEST_KEY'}});t.after(()=>supervisor.stop());
  const record=await readJson(config.instanceFile);const status=await queryInstance(config);
  assert.equal(status.state,'ready');assert.equal(status.engine,'spring-ai');assert.equal(status.appPort,config.appPort);assert.equal(status.workerPort,config.workerPort);
  assert.equal(status.version,1);assert.equal(status.productVersion,productVersion);assert.equal(status.url,`http://127.0.0.1:${config.appPort}/#tasks`);
  assert.equal(captures.length,1);assert.equal(captures[0].executable,config.javaExe);assert.deepEqual(captures[0].args,['-jar',config.jarPath]);
  assert.equal(captures[0].options.env.ARK_API_KEY,undefined);assert.match(captures[0].options.env.WORKBENCH_BRIDGE_TOKEN,/^[a-f0-9]{64}$/);
  const privateFile=await fs.readFile(config.instanceFile,'utf8');assert.ok(!privateFile.includes(captures[0].options.env.WORKBENCH_BRIDGE_TOKEN));assert.ok(!privateFile.includes('DO_NOT_PERSIST_TEST_KEY'));
  assert.equal(status.controlToken,undefined);assert.equal(status.bridgeToken,undefined);
  const page=await request(config.appPort,'/api/model/config');assert.equal(page.status,200);assert.equal(page.value.executionEngine,'spring-ai');
  assert.equal(record.pid,process.pid);await supervisor.stop();assert.equal(existsSync(config.instanceFile),false);assert.equal(existsSync(config.lockFile),false);
});

test('控制接口拒绝缺少令牌、浏览器Origin和错误Host',async t=>{
  const {startSupervisor}=await implementation();const {config}=await fixture(t);const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});t.after(()=>supervisor.stop());const record=await readJson(config.instanceFile);
  assert.equal((await request(record.controlPort,'/status')).status,403);
  assert.equal((await request(record.controlPort,'/stop',{token:record.controlToken,method:'POST',origin:'http://127.0.0.1:'+record.controlPort})).status,403);
  assert.equal((await request(record.controlPort,'/status',{token:record.controlToken,host:'localhost:'+record.controlPort})).status,403);
  assert.equal((await request(record.controlPort,'/status',{token:record.controlToken})).value.state,'ready');
});

test('命令端重复启动只复用已验证实例，停止仅作用于该实例',async t=>{
  assert.ok(existsSync(launchUrl),'缺少便携命令端');const {runPortableCommand}=await import(launchUrl);const {startSupervisor}=await implementation();const {config}=await fixture(t);
  const unrelated=http.createServer((req,res)=>res.end('unrelated'));const unrelatedPort=await listen(unrelated);t.after(()=>close(unrelated));
  const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});t.after(()=>supervisor.stop());let starts=0,opens=0;
  const options={config,startDetached:()=>starts++,openBrowser:()=>opens++,write:()=>{}};
  const first=await runPortableCommand(['--no-open'],options);assert.equal(first.started,false);assert.equal(starts,0);assert.equal(opens,0);
  await runPortableCommand([],options);assert.equal(opens,1);assert.equal(starts,0);
  await runPortableCommand(['--stop'],options);assert.equal(existsSync(config.instanceFile),false);assert.equal((await request(unrelatedPort,'/')).status,200);
});

test('安装停止能发现同root的临时数据目录实例并保留其他root服务',async t=>{
 const {getConfig,startSupervisor,queryInstance}=await implementation();const {runPortableCommand}=await import(launchUrl);
 const current=await fixture(t),other=await fixture(t);
 const common={LOCALAPPDATA:path.join(current.temporary,'local data')};
 const custom=getConfig({rootDir:current.rootDir,env:{...common,DEMO_DATA_DIR:path.join(current.temporary,'temporary env A'),DEMO_PORT:String(current.config.appPort),WORKBENCH_WORKER_PORT:String(current.config.workerPort)}});
 const customSecond=getConfig({rootDir:current.rootDir,env:{...common,DEMO_DATA_DIR:path.join(current.temporary,'temporary env C'),DEMO_PORT:String(await unusedPort()),WORKBENCH_WORKER_PORT:String(await unusedPort())}});
 const unrelated=getConfig({rootDir:other.rootDir,env:{...common,DEMO_DATA_DIR:path.join(other.temporary,'unrelated'),DEMO_PORT:String(other.config.appPort),WORKBENCH_WORKER_PORT:String(other.config.workerPort)}});
 const own=await startSupervisor(custom,{spawnWorker:workerSpawn(),registerSignals:false}),second=await startSupervisor(customSecond,{spawnWorker:workerSpawn(),registerSignals:false}),otherSupervisor=await startSupervisor(unrelated,{spawnWorker:workerSpawn(),registerSignals:false});
 t.after(async()=>{await own.stop();await second.stop();await otherSupervisor.stop();});
 const firstRecord=await readJson(custom.instanceFile),firstLocator=await locatorPath(custom,firstRecord);
 assert.equal((await fs.readdir(path.dirname(firstLocator))).length,2,'同root的两个dataDir应独立登记');
 assert.ok(!(await fs.readFile(firstLocator,'utf8')).includes(firstRecord.controlToken),'定位索引不得复制控制令牌');
 assert.equal(existsSync(current.config.instanceFile),false,'环境B默认目录没有运行记录');
 const result=await runPortableCommand(['--stop-installation'],{config:current.config,write:()=>{}});
 assert.equal(result.state,'stopped');assert.equal(existsSync(custom.instanceFile),false);
 assert.equal(existsSync(customSecond.instanceFile),false);
 assert.equal((await queryInstance(unrelated)).state,'ready');
});

test('安装定位仍活跃但私有实例记录缺失时拒绝宣称停止',async t=>{
 const {startSupervisor,stopInstallation}=await implementation();const {config}=await fixture(t);
 const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});t.after(()=>supervisor.stop());
 const record=await readJson(config.instanceFile),file=await locatorPath(config,record),locator=await fs.readFile(file);
 await fs.unlink(config.instanceFile);
 try{await assert.rejects(stopInstallation(config),/实例|核验|停止/);assert.equal(existsSync(file),true);}
 finally{await fs.writeFile(config.instanceFile,JSON.stringify(record));await fs.writeFile(file,locator);}
});

test('并发安装停止幂等清理已死实例定位',async t=>{
 const {startSupervisor,stopInstallation}=await implementation();const {config}=await fixture(t);
 const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});t.after(()=>supervisor.stop());
 const record=await readJson(config.instanceFile),file=await locatorPath(config,record),locator=await readJson(file);
 await supervisor.stop();
 const dead=spawn(process.execPath,['-e','process.exit(0)']);await new Promise(resolve=>dead.once('exit',resolve));
 for(let round=0;round<10;round++){
  await fs.writeFile(file,JSON.stringify({...locator,pid:dead.pid}));
  const results=await Promise.allSettled([stopInstallation(config),stopInstallation(config)]);
  assert.ok(results.every(result=>result.status==='fulfilled'),JSON.stringify(results.map(result=>result.reason?.code||result.status)));
  assert.equal(existsSync(file),false);
 }
});

test('实例记录根目录或数据目录不匹配时不复用不停止',async t=>{
  const {queryInstance,startSupervisor}=await implementation();const {config}=await fixture(t);const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});t.after(()=>supervisor.stop());
  await assert.rejects(queryInstance({...config,rootDir:path.join(config.rootDir,'other')}),/身份|目录/);
  const record=await readJson(config.instanceFile);await fs.writeFile(config.instanceFile,JSON.stringify({...record,dataDir:path.join(config.dataDir,'other')}));
  await assert.rejects(queryInstance(config),/身份|目录/);await fs.writeFile(config.instanceFile,JSON.stringify(record));assert.equal((await queryInstance(config)).state,'ready');
});

test('Java启动失败回收私有记录并保留安全诊断日志',async t=>{
  const {startSupervisor}=await implementation();const {config}=await fixture(t);
  await assert.rejects(startSupervisor(config,{spawnWorker:(_exe,_args,options)=>spawn(process.execPath,['-e','process.exit(7)'],options),registerSignals:false}),/Java|执行服务/);
  assert.equal(existsSync(config.instanceFile),false);assert.equal(existsSync(config.lockFile),false);
  assert.match(await fs.readFile(path.join(config.logsDir,'portable-startup.log'),'utf8'),/WORKER_EXIT/);
});

test('自有Java始终无法退出时停止失败并保留实例身份，禁止安装器误判已停',async t=>{
 const {startSupervisor,queryInstance,stopInstance}=await implementation();const {config}=await fixture(t);
 const child=Object.assign(new EventEmitter(),{pid:12345,exitCode:null,signalCode:null,kill(){return true;}});
 let health;
 const supervisor=await startSupervisor(config,{registerSignals:false,spawnWorker:(_exe,_args,options)=>{
  health=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',engine:'spring-ai'}));});
  health.listen(Number(options.env.WORKBENCH_WORKER_PORT),'127.0.0.1');return child;
 }});
 const exitWorker=()=>{child.exitCode=0;child.emit('exit',0,null);};
 t.after(async()=>{exitWorker();await supervisor.stop();if(health.listening)await close(health);});
 const before=await readJson(config.instanceFile);
 await assert.rejects(supervisor.stop(),/停止|退出/);
 assert.deepEqual(await readJson(config.instanceFile),before);assert.equal(existsSync(config.lockFile),true);
 const status=await queryInstance(config);assert.equal(status.state,'stopping');assert.equal(status.stopFailure,'WORKER_CLOSE_FAILED');
 await assert.rejects(stopInstance(config),/停止|退出/);
 exitWorker();await supervisor.stop();assert.equal(existsSync(config.instanceFile),false);
});

test('工作台创建失败会结束自有Java进程和释放端口',async t=>{
  const {startSupervisor}=await implementation();const {config}=await fixture(t);let child;
  await assert.rejects(startSupervisor(config,{spawnWorker:(...args)=>(child=workerSpawn()(...args)),createWorkbenchServer:async()=>{throw new Error('injected');},registerSignals:false}),/工作台/);
  assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(existsSync(config.instanceFile),false);const probe=http.createServer();await listen(probe,config.workerPort);await close(probe);
});

test('活跃未知锁拒绝启动，死进程锁才允许恢复',async t=>{
  const {startSupervisor}=await implementation();const {config}=await fixture(t);await fs.mkdir(config.dataDir,{recursive:true});
  await fs.writeFile(config.lockFile,JSON.stringify({pid:process.pid,nonce:'unknown-live-owner'}));let spawns=0;
  await assert.rejects(startSupervisor(config,{spawnWorker:()=>spawns++,registerSignals:false}),/占用|锁|进程/);assert.equal(spawns,0);
  const dead=spawn(process.execPath,['-e','process.exit(0)']);await new Promise(resolve=>dead.once('exit',resolve));
  await fs.writeFile(config.lockFile,JSON.stringify({pid:dead.pid,nonce:'dead-owner'}));
  const supervisor=await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});t.after(()=>supervisor.stop());assert.equal(supervisor.status().state,'ready');
});

test('冷启动命令报告新实例，重启保留虚构工作区资料',async t=>{
  const {runPortableCommand}=await import(launchUrl);const {startSupervisor}=await implementation();const {config}=await fixture(t);let starts=0;
  const options={config,startDetached:async()=>{starts++;await startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false});},write:()=>{}};
  const stoppedStatus=await runPortableCommand(['--status'],options);
  assert.equal(stoppedStatus.state,'stopped');assert.equal(stoppedStatus.version,1);assert.equal(stoppedStatus.productVersion,productVersion);
  const first=await runPortableCommand(['--no-open'],options);assert.equal(first.started,true);assert.equal(starts,1);
  const origin=`http://127.0.0.1:${config.appPort}`,initial=await(await fetch(origin+'/api/workspace')).json();
  const {createInitialState}=await import('../public/domain.mjs');const {createCatalog}=await import('../public/catalog.mjs');
  // This test explicitly stores a modern fixture; legacy migration has separate coverage.
  const state={...createInitialState(),businessMigrationVersion:1},catalog=createCatalog();
  const saved=await fetch(origin+'/api/workspace',{method:'PUT',headers:{Origin:origin,'X-Workspace-Token':initial.token,'Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,mutationId:'portable-fictional',state,catalog})});assert.equal(saved.status,200);
  await runPortableCommand(['--stop'],options);const second=await runPortableCommand(['--no-open'],options);
  assert.equal(second.started,true);assert.notEqual(second.instanceId,first.instanceId);assert.equal(starts,2);
  const reloaded=await(await fetch(origin+'/api/workspace')).json();assert.equal(reloaded.revision,1);assert.deepEqual(reloaded.state,state);
});

test('Java未健康时工作台端口不可访问，超时后只回收自有资源',async t=>{
  const {startSupervisor}=await implementation();const {config}=await fixture(t);config.startupTimeoutMs=300;let appCreates=0,child;
  await assert.rejects(startSupervisor(config,{spawnWorker:(_exe,_args,options)=>(child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],options)),createWorkbenchServer:()=>appCreates++,registerSignals:false}),/健康检查超时/);
  assert.equal(appCreates,0);assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(existsSync(config.instanceFile),false);
  const probe=http.createServer();await listen(probe,config.appPort);await close(probe);
});

test('Java就绪后异常退出会关闭工作台及私有控制记录',async t=>{
  const {startSupervisor}=await implementation();const {config}=await fixture(t);let child;
  const supervisor=await startSupervisor(config,{spawnWorker:(...args)=>(child=workerSpawn()(...args)),registerSignals:false});
  child.kill();for(let i=0;i<100&&existsSync(config.instanceFile);i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(existsSync(config.instanceFile),false);assert.equal(supervisor.status().state,'stopping');
  const probe=http.createServer();await listen(probe,config.appPort);await close(probe);
});

test('工作台异步创建期间停止会回收随后创建的HTTP服务和数据锁',async t=>{
  const {startSupervisor,stopInstance}=await implementation();const {config}=await fixture(t);const {createWorkbenchServer}=await import('../server.mjs');
  let allowCreate,createdApp;const gate=new Promise(resolve=>allowCreate=resolve);let enteredCreate;const entered=new Promise(resolve=>enteredCreate=resolve);
  const startup=startSupervisor(config,{spawnWorker:workerSpawn(),registerSignals:false,createWorkbenchServer:async options=>{enteredCreate();await gate;createdApp=await createWorkbenchServer(options);return createdApp;}});
  await entered;const stopping=stopInstance(config);await new Promise(resolve=>setTimeout(resolve,100));allowCreate();
  try{
    await assert.rejects(startup,/退出|停止/);await stopping;
    const probe=http.createServer();await listen(probe,config.appPort);await close(probe);assert.equal(existsSync(path.join(config.dataDir,'.workspace.lock')),false);
  }finally{if(createdApp?.listening)await close(createdApp);else await createdApp?.closeWorkspace?.();}
});
