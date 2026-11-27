import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {productVersion} from './version.mjs';
import {javaCoreFiles,boundedOutput,saveStartupFailure} from './startup-diagnostics.mjs';

const bundleRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// WHATWG Fetch bad ports >=1024, verified against the bundled Node 24 Undici constants.
// Lower ports are already excluded by the common 1024..65535 validation.
const badFetchPorts=new Set([1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
const error=(code,message)=>Object.assign(new Error(message),{code,portable:true});
const englishErrors=Object.freeze({
 INVALID_PORT:'The application and Spring AI ports must be integers between 1024 and 65535.',
 UNSAFE_FETCH_PORT:'The configured port is blocked by Fetch and web browsers. Choose a different port.',
 PORT_COLLISION:'The application and Spring AI worker must use different ports.',
 INVALID_TIMEOUT:'Startup timeout must be an integer between 1000 and 180000 milliseconds.',
 UNSAFE_FILE:'An instance or dependency file has an unsupported file type. Restore the complete package.',
 MISSING_DEPENDENCY:'The installation is incomplete. Run the installer again to repair it. Your business data will not be lost.',
 INVALID_DIRECTORY:'The program or data directory is unavailable. Check access before retrying.',
 UNSAFE_DATA_DIRECTORY:'The business data directory must be outside the public web directory.',
 INVALID_INSTANCE:'The saved instance record is invalid. No unknown process has been controlled. Check the data directory and logs.',
 INSTANCE_LOCKED:'The data directory is in use or has an unverified lock. Stop its existing application before starting another instance.',
 INSTANCE_IDENTITY:'The instance identity does not match this installation or data directory. No unknown process has been stopped.',
 INSTANCE_UNVERIFIED:'An existing instance is active but its identity cannot be verified. Use its own stop launcher and check the data-directory logs.',
 INSTANCE_STOPPING:'The current instance is stopping. Wait for it to finish before starting again.',
 STOP_FAILED:'The verified service could not stop completely. Use its own stop launcher and check the logs before replacing program files.',
 STOP_TIMEOUT:'Shutdown has not completed within 20 seconds. No other process has been stopped. Check the logs before retrying.',
 PORT_IN_USE:'A required local port is already in use. Choose different application and worker ports, or stop the service that owns the port.',
 WORKER_EXIT:'The bundled Java service exited before it became ready. Run the installer again to repair program files; your business data will not be lost. If it still fails, send logs/portable-startup.log to support. Ask IT to check application-control or antivirus events; a security block has not been confirmed.',
 WORKER_SPAWN_FAILED:'Windows could not start the bundled Java service. Run the installer again; if it still fails, ask IT to check application-control or antivirus events. Your business data is retained. See logs/portable-startup.log.',
 WORKER_TIMEOUT:'The Java worker health check timed out. The application was not started. Check the data-directory logs.',
 START_CANCELLED:'Application startup was cancelled.',
 STALE_LOCK_CONFIRMATION:'A lock belongs to an exited process. Confirm recovery before starting.',
 SUPERVISOR_SPAWN_FAILED:'The bundled Node supervisor could not start. Check that the complete package is installed.',
 INVALID_ARGUMENT:'Unsupported command. Use the start or stop launcher, or --no-open, --status, --stop or --stop-installation.',
 START_TIMEOUT:'The service did not become ready before the startup deadline. Check logs/portable-startup.log in the data directory.',
 START_FAILED:'The application supervisor could not start. Check bundled files, port availability and logs/portable-startup.log.',
 APP_START_FAILED:'The application could not start. Its own worker was cleaned up. Check logs/portable-startup.log.',
});
export function safeErrorMessage(value,language=process.env.WORKBENCH_LAUNCHER_LANGUAGE||'zh'){
 if(language==='en')return value?.portable&&Object.hasOwn(englishErrors,value.code)?englishErrors[value.code]+(Array.isArray(value.details?.missingFiles)?'\n'+value.details.missingFiles.filter(p=>typeof p==='string'&&/^[\w./ -]+$/.test(p)).join('\n'):''):'The service command failed. Check logs/portable-startup.log in the data directory.';
 return value?.portable?value.message:'便携服务启动失败，请查看数据目录 logs/portable-startup.log。';
}

export function getLayout(rootDir=bundleRoot){
  const root=path.resolve(rootDir);
  return {rootDir:root,nodeExe:path.join(root,'runtime','node','node.exe'),javaExe:path.join(root,'runtime','java','bin','java.exe'),jarPath:path.join(root,'service','spring-ai-worker.jar'),runtimeScript:path.join(root,'packaging','portable-runtime.mjs'),launchScript:path.join(root,'packaging','portable-launch.mjs'),publicDir:path.join(root,'public'),serverModule:path.join(root,'server.mjs')};
}
function port(raw,label){
  const value=String(raw);
  if(!/^[1-9]\d*$/.test(value)||Number(value)<1024||Number(value)>65535)throw error('INVALID_PORT',`${label}端口须为1024至65535之间的整数。`);
  if(badFetchPorts.has(Number(value)))throw error('UNSAFE_FETCH_PORT',`${label}端口${value}被Fetch和浏览器禁用，请显式指定其他端口。`);
  return Number(value);
}
export function getConfig({rootDir=bundleRoot,env=process.env}={}){
  const layout=getLayout(rootDir),appPort=port(env.DEMO_PORT??'4186','工作台'),workerPort=port(env.WORKBENCH_WORKER_PORT??'4192','Spring AI');
  if(appPort===workerPort)throw error('PORT_COLLISION','工作台与Spring AI执行端口必须不同。');
  const dataDir=path.resolve(env.DEMO_DATA_DIR||path.join(env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'MSSQualityWorkbench','portable'));
  const rawTimeout=env.PORTABLE_STARTUP_TIMEOUT_MS??'90000';
  if(!/^\d+$/.test(rawTimeout)||Number(rawTimeout)<1000||Number(rawTimeout)>180000)throw error('INVALID_TIMEOUT','启动等待时间须为1000至180000毫秒。');
  const installationIndexDir=path.resolve(env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'MSSQualityWorkbench','instances');
  return {...layout,dataDir,installationIndexDir,appPort,workerPort,instanceFile:path.join(dataDir,'.portable-instance.json'),lockFile:path.join(dataDir,'.portable-instance.lock'),logsDir:path.join(dataDir,'logs'),startupTimeoutMs:Number(rawTimeout)};
}

async function plainFile(file,{optional=false}={}){
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw error('UNSAFE_FILE','便携实例或依赖文件类型无效。');return stat;}
  catch(cause){if(optional&&cause.code==='ENOENT')return null;throw cause;}
}
export async function validateResources(config){
  const files=[config.nodeExe,config.jarPath,config.runtimeScript,config.launchScript,config.serverModule,path.join(config.publicDir,'index.html'),...javaCoreFiles.map(p=>path.join(config.rootDir,'runtime/java',p))],missingFiles=[];
  for(const file of files){try{const stat=await plainFile(file);if(!stat.size)throw new Error();}catch{missingFiles.push(path.relative(config.rootDir,file).replaceAll('\\','/'));}}
  if(missingFiles.length)throw Object.assign(error('MISSING_DEPENDENCY',`安装不完整，请重新运行安装包即可修复，数据不会丢失。\n缺失或空文件：\n${missingFiles.join('\n')}`),{details:{missingFiles}});
}
async function identity(config,{create=false}={}){
  let rootDir,dataDir;
  try{rootDir=await fs.realpath(config.rootDir);}catch{throw error('INVALID_DIRECTORY','便携程序目录不可访问，无法核验实例身份。');}
  try{if(create)await fs.mkdir(config.dataDir,{recursive:true,mode:0o700});dataDir=await fs.realpath(config.dataDir);}
  catch(cause){if(!create&&cause.code==='ENOENT')return null;throw error('INVALID_DIRECTORY','便携数据目录不可访问，无法核验实例身份。');}
  const publicDir=path.resolve(rootDir,'public'),relative=path.relative(publicDir,dataDir);
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw error('UNSAFE_DATA_DIRECTORY','数据目录必须位于public目录之外。');
  const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
  return {rootDir,dataDir,rootId:createHash('sha256').update(normalized(rootDir)+'\0'+normalized(dataDir)).digest('hex')};
}
async function readPrivateJson(file){
  const stat=await plainFile(file,{optional:true});if(!stat)return null;
  if(stat.size>8192)throw error('INVALID_INSTANCE','便携实例记录无效，拒绝控制未知进程。');
  try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(cause){if(cause.code==='ENOENT')return null;throw error('INVALID_INSTANCE','便携实例记录无法核验，拒绝控制未知进程。');}
}
function validOwner(value){return value&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.nonce==='string'&&value.nonce.length>0;}
function isDead(pid){try{process.kill(pid,0);return false;}catch(cause){return cause.code==='ESRCH';}}
function matchesLock(value,id){return validOwner(value)&&typeof value.rootDir==='string'&&typeof value.dataDir==='string'&&samePath(value.rootDir,id.rootDir)&&samePath(value.dataDir,id.dataDir)&&value.rootId===id.rootId;}
function matchesRecord(record,id){
  return record?.version===1&&validOwner({pid:record.pid,nonce:record.instanceId})&&/^[a-f0-9]{32}$/.test(record.instanceId)&&typeof record.rootDir==='string'&&typeof record.dataDir==='string'&&samePath(record.rootDir,id.rootDir)&&samePath(record.dataDir,id.dataDir)&&record.rootId===id.rootId&&Number.isInteger(record.controlPort)&&record.controlPort>0&&record.controlPort<=65535&&/^[a-f0-9]{64}$/.test(record.controlToken);
}
async function acquireLock(config,id,nonce){
  const unavailable=()=>error('INSTANCE_LOCKED','数据目录已有运行进程或未知锁，无法启动第二个实例。');
  async function create(){const handle=await fs.open(config.lockFile,'wx',0o600);try{await handle.writeFile(JSON.stringify({pid:process.pid,nonce,...id}));await handle.sync();return handle;}catch(cause){await handle.close();await fs.unlink(config.lockFile).catch(()=>{});throw cause;}}
  try{return await create();}catch(cause){if(cause.code!=='EEXIST')throw cause;}
  const original=await readPrivateJson(config.lockFile).catch(()=>null);
  if(!matchesLock(original,id)||!isDead(original.pid))throw unavailable();
  const recoveryFile=config.lockFile+'.recovery';let recovery;
  try{recovery=await fs.open(recoveryFile,'wx',0o600);}catch{throw unavailable();}
  try{
    const current=await readPrivateJson(config.lockFile);
    if(JSON.stringify(current)!==JSON.stringify(original)||!isDead(current.pid))throw unavailable();
    await fs.unlink(config.lockFile);return await create();
  }finally{await recovery.close();await fs.unlink(recoveryFile).catch(()=>{});}
}
async function publishRecord(config,record){
  const temporary=config.instanceFile+'.'+record.instanceId+'.tmp';
  try{await fs.writeFile(temporary,JSON.stringify(record),{flag:'wx',mode:0o600});await fs.rename(temporary,config.instanceFile);}finally{await fs.unlink(temporary).catch(()=>{});}
}
function installationIndex(config,rootDir){
  const normalized=process.platform==='win32'?rootDir.toLowerCase():rootDir;
  return path.join(config.installationIndexDir,createHash('sha256').update(normalized).digest('hex'));
}
async function registerInstallation(config,record){
  const directory=installationIndex(config,record.rootDir);await fs.mkdir(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,record.rootId+'.json'),temporary=file+'.'+record.instanceId+'.tmp';
  // Discovery carries only identity and location, never either private control or model tokens.
  const locator={version:1,rootDir:record.rootDir,dataDir:record.dataDir,rootId:record.rootId,instanceId:record.instanceId,pid:record.pid};
  try{await fs.writeFile(temporary,JSON.stringify(locator),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}
  return file;
}
async function unregisterInstallation(file,instanceId){
  if(!file)return;
  try{const locator=await readPrivateJson(file);if(locator?.instanceId===instanceId)await fs.unlink(file);}
  catch(cause){
    if(cause.code==='ENOENT')return;
    // Windows may report EPERM while another verified cleaner finishes the same deletion.
    if(cause.code==='EPERM'){await sleep(5);if(!(await plainFile(file,{optional:true})))return;}
    throw cause;
  }
}
function requestJson(portNumber,route,{token,method='GET',timeout=1200}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:portNumber,path:route,method,headers:{...(token?{'X-Portable-Token':token}:{}),Connection:'close'},timeout},res=>{
      let raw='',size=0;res.on('data',chunk=>{size+=chunk.length;if(size>8192){res.destroy();reject(error('INVALID_CONTROL_REPLY','便携实例响应无效。'));}else raw+=chunk;});
      res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(raw)});}catch{reject(error('INVALID_CONTROL_REPLY','便携实例响应无效。'));}});
    });req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);req.end();
  });
}
export function normalizeDesktopActivity(value){
 const keys=['ai','report','translation','structured'],counts={ai:0,report:0,translation:0,structured:0};
 if(!value||typeof value.busy!=='boolean'||typeof value.unknown!=='boolean'||!value.counts||keys.some(key=>!Number.isSafeInteger(value.counts[key])||value.counts[key]<0))return{busy:true,counts,unknown:true};
 for(const key of keys)counts[key]=value.counts[key];return{busy:value.busy||value.unknown||Object.values(counts).some(n=>n>0),counts,unknown:value.unknown};
}
function publicStatus(record,state,stopFailure,activity){
  return {version:1,productVersion,instanceId:record.instanceId,pid:record.pid,rootDir:record.rootDir,dataDir:record.dataDir,rootId:record.rootId,appPort:record.appPort,workerPort:record.workerPort,engine:'spring-ai',state,...(['WORKER_CLOSE_FAILED','APP_CLOSE_FAILED'].includes(stopFailure)?{stopFailure}:{}),url:`http://127.0.0.1:${record.appPort}/#tasks`,activity:normalizeDesktopActivity(activity)};
}
async function verifiedRecord(config){
  const id=await identity(config);if(!id)return null;
  const record=await readPrivateJson(config.instanceFile);if(!record)return null;
  if(!matchesRecord(record,id))throw error('INSTANCE_IDENTITY','便携实例身份与当前程序或数据目录不匹配，拒绝复用或停止。');
  if(isDead(record.pid))return null;
  let response;
  try{response=await requestJson(record.controlPort,'/status',{token:record.controlToken});}
  catch{throw error('INSTANCE_UNVERIFIED','现有实例进程仍存活但控制身份无法核验；请查看数据目录日志，不会结束未知进程。');}
  const status=response.value;
  if(response.status!==200||status?.instanceId!==record.instanceId||status.pid!==record.pid||status.rootId!==id.rootId||!samePath(status.rootDir||'',id.rootDir)||!samePath(status.dataDir||'',id.dataDir)||status.engine!=='spring-ai'||!['starting','ready','stopping'].includes(status.state)||status.appPort!==record.appPort||status.workerPort!==record.workerPort)throw error('INSTANCE_IDENTITY','便携控制接口身份不匹配，拒绝复用或停止。');
  return {record,status:publicStatus(record,status.state,status.stopFailure,status.activity)};
}
export async function queryInstance(config){return (await verifiedRecord(config))?.status||null;}
export async function inspectDesktopInstance(config){
 let id=await identity(config);
 if(!id){const rootDir=await fs.realpath(config.rootDir),dataDir=path.resolve(config.dataDir),normalized=s=>process.platform==='win32'?s.toLowerCase():s;id={rootDir,dataDir,rootId:createHash('sha256').update(normalized(rootDir)+'\0'+normalized(dataDir)).digest('hex')};}
 const base={state:'stopped',url:`http://127.0.0.1:${config.appPort}/#tasks`,dataDir:id.dataDir,rootId:id.rootId,staleLock:{present:false,recoverable:false,reason:'none'},activity:{busy:false,counts:{ai:0,report:0,translation:0,structured:0},unknown:false}};
 let lock,record,status;
 try{lock=await readPrivateJson(config.lockFile);record=await readPrivateJson(config.instanceFile);status=await queryInstance(config);}catch(cause){return{...base,state:'blocked',staleLock:{present:Boolean(lock)||Boolean(await plainFile(config.lockFile,{optional:true}).catch(()=>true)),recoverable:false,reason:cause.code||'INSTANCE_UNVERIFIED'},activity:normalizeDesktopActivity(null)};}
 if(status)return{...base,...status,staleLock:{present:Boolean(lock),recoverable:false,reason:'owner-alive'}};
 if(lock){
  const matching=matchesLock(lock,id)&&(!record||matchesRecord(record,id)&&record.pid===lock.pid&&record.instanceId===lock.nonce),dead=validOwner(lock)&&isDead(lock.pid),recoverable=matching&&dead;
  return{...base,state:recoverable?'stopped':'blocked',staleLock:{present:true,recoverable,reason:!matching?'identity-mismatch':dead?'owner-dead':'owner-alive'},activity:recoverable?base.activity:normalizeDesktopActivity(null)};
 }
 return base;
}
export async function recoverStalePortableLock(config,{beforeVerify}={}){
 const id=await identity(config);if(!id)return{recovered:false};
 const original=await readPrivateJson(config.lockFile);if(!original)return{recovered:false};
 const record=await readPrivateJson(config.instanceFile);
 if(!matchesLock(original,id)||record&&(!matchesRecord(record,id)||record.pid!==original.pid||record.instanceId!==original.nonce))throw error('INSTANCE_IDENTITY','残留锁与当前程序、数据目录或实例身份不一致，未恢复。');
 if(!isDead(original.pid))throw error('INSTANCE_LOCKED','锁的进程仍存活或无法确认已退出，未恢复。');
 const originalBytes=await fs.readFile(config.lockFile),recoveryFile=config.lockFile+'.recovery';let recovery;
 try{recovery=await fs.open(recoveryFile,'wx',0o600);}catch{throw error('INSTANCE_LOCKED','其他进程正在核对残留锁，请稍后重试。');}
 try{
  // Test-only race injection; the desktop CLI never supplies this hook.
  if(beforeVerify)await beforeVerify();
  const current=await readPrivateJson(config.lockFile),currentRecord=await readPrivateJson(config.instanceFile),currentId=await identity(config);
  if(!currentId||currentId.rootId!==id.rootId||!matchesLock(current,id)||JSON.stringify(current)!==JSON.stringify(original)||!(await fs.readFile(config.lockFile)).equals(originalBytes)||JSON.stringify(currentRecord)!==JSON.stringify(record)||!isDead(current.pid))throw error('INSTANCE_LOCKED','残留锁在恢复前已变化，未删除当前锁。');
  await fs.unlink(config.lockFile);return{recovered:true};
 }finally{await recovery.close();await fs.unlink(recoveryFile).catch(()=>{});}
}
export async function stopInstance(config){
  const verified=await verifiedRecord(config);if(!verified)return {state:'stopped',stopped:false};
  let reply;
  try{reply=await requestJson(verified.record.controlPort,'/stop',{token:verified.record.controlToken,method:'POST'});}catch{throw error('STOP_FAILED','已验证实例暂时无法停止，请查看数据目录日志。');}
  if(reply.status!==200||reply.value?.instanceId!==verified.record.instanceId)throw error('INSTANCE_IDENTITY','停止响应身份不匹配。');
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    const record=await readPrivateJson(config.instanceFile);if(!record||record.instanceId!==verified.record.instanceId)return {state:'stopped',stopped:true};
    // A verified supervisor may close its control listener just before removing the completion marker.
    const current=await queryInstance(config).catch(cause=>{if(cause.code==='INSTANCE_UNVERIFIED')return null;throw cause;});
    if(current?.stopFailure==='WORKER_CLOSE_FAILED'||current?.stopFailure==='APP_CLOSE_FAILED')throw error('STOP_FAILED','工作台落盘关闭或自有Java执行服务退出未完成；已保留实例身份，请勿覆盖程序文件。');
    await sleep(100);
  }
  throw error('STOP_TIMEOUT','实例正在关闭，20秒内尚未完成；没有结束其他进程。');
}
export async function stopInstallation(config){
  let rootDir;try{rootDir=await fs.realpath(config.rootDir);}catch{throw error('INVALID_DIRECTORY','程序目录不可访问，无法核验安装实例。');}
  const directory=installationIndex(config,rootDir);let entries=[];
  try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(cause){if(cause.code!=='ENOENT')throw cause;}
  if(entries.length>1000)throw error('INVALID_INSTANCE','安装实例索引数量异常，拒绝继续。');
  const candidates=new Map();
  for(const entry of entries){
    if(!entry.isFile()||!(/^[a-f0-9]{64}\.json$/.test(entry.name)))throw error('INVALID_INSTANCE','安装实例索引无效，拒绝控制未知实例。');
    const file=path.join(directory,entry.name),locator=await readPrivateJson(file);
    if(!locator)continue; // A concurrent verified stop may already have removed this entry.
    if(locator?.version!==1||!samePath(locator.rootDir||'',rootDir)||typeof locator.dataDir!=='string'||!path.isAbsolute(locator.dataDir)||!(/^[a-f0-9]{64}$/.test(locator.rootId||''))||entry.name!==locator.rootId+'.json'||!(/^[a-f0-9]{32}$/.test(locator.instanceId||''))||!validOwner({pid:locator.pid,nonce:locator.instanceId}))throw error('INSTANCE_IDENTITY','安装实例索引身份无效，未停止任何未知进程。');
    const candidate={...config,rootDir,dataDir:locator.dataDir,instanceFile:path.join(locator.dataDir,'.portable-instance.json'),lockFile:path.join(locator.dataDir,'.portable-instance.lock'),logsDir:path.join(locator.dataDir,'logs')};
    const id=await identity(candidate);
    if(!id||id.rootId!==locator.rootId)throw error('INSTANCE_IDENTITY','安装实例数据目录无法核验，未覆盖程序。');
    candidates.set(locator.rootId,{config:candidate,file,locator});
  }
  // Include the current environment for older bundles without a discovery entry.
  const currentId=await identity(config);
  if(currentId&&!candidates.has(currentId.rootId))candidates.set(currentId.rootId,{config});
  let stopped=false;
  for(const candidate of candidates.values()){
    if(candidate.locator){
      const record=await readPrivateJson(candidate.config.instanceFile);
      if(!record&&!isDead(candidate.locator.pid))throw error('INSTANCE_UNVERIFIED','安装实例定位仍活跃但私有记录缺失，无法核验停止；未覆盖程序。');
      if(record&&(record.instanceId!==candidate.locator.instanceId||record.pid!==candidate.locator.pid||record.rootId!==candidate.locator.rootId))throw error('INSTANCE_IDENTITY','安装实例定位与私有记录不一致，未停止未知实例。');
    }
    const result=await stopInstance(candidate.config);stopped||=result.stopped;
    if(candidate.file)await unregisterInstallation(candidate.file,candidate.locator.instanceId);
  }
  return {state:'stopped',stopped};
}
async function assertPortFree(portNumber){
  const server=net.createServer();
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(portNumber,'127.0.0.1',resolve);});}
  catch{throw error('PORT_IN_USE',`本机端口${portNumber}已被占用，未启动其他实例；请显式调整端口。`);}
  finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
async function listen(server,portNumber){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(portNumber,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});});}
async function closeServer(server,workspace=false){
  if(!server)return;
  if(!server.listening){if(workspace)await server.closeWorkspace?.();return;}
  await new Promise((resolve,reject)=>{server.close(cause=>cause?reject(cause):resolve());server.closeAllConnections?.();});
}
async function stopChild(child){
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  const waitForExit=timeout=>new Promise(resolve=>{
    if(child.exitCode!==null||child.signalCode!==null){resolve(true);return;}
    const finish=exited=>{clearTimeout(timer);child.off('exit',onExit);resolve(exited);};
    const onExit=()=>finish(true),timer=setTimeout(()=>finish(false),timeout);child.once('exit',onExit);
  });
  child.kill();
  if(!(await waitForExit(5000))&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await waitForExit(3000);}
  if(child.exitCode===null&&child.signalCode===null)throw error('STOP_FAILED','自有Java执行服务未能退出，停止失败。');
}
function healthyWorker(workerPort,bridgeToken){
  return new Promise(resolve=>{
    const req=http.get({hostname:'127.0.0.1',port:workerPort,path:'/internal/health',headers:{'X-Bridge-Token':bridgeToken,Connection:'close'},timeout:1000},res=>{
      let raw='';res.on('data',chunk=>{raw+=chunk;if(raw.length>4096)res.destroy();});res.on('error',()=>resolve(false));res.on('end',()=>{try{const value=JSON.parse(raw);resolve(res.statusCode===200&&value.status==='ok'&&value.engine==='spring-ai');}catch{resolve(false);}});
    });req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(false));
  });
}

export async function startSupervisor(config,{spawnWorker=spawn,createWorkbenchServer,registerSignals=true,env=process.env,appendLog=fs.appendFile}={}){
  // Dependency injection is only for isolated lifecycle tests; production always uses the packaged Java.
  await validateResources(config);
  const id=await identity(config,{create:true}),nonce=randomBytes(16).toString('hex'),bridgeToken=randomBytes(32).toString('hex');
  let lock,record,control,app,child,state='starting',workerExited=false,stopping,ready=false,stopFailure,installationFile,workerFailure,workerClosed;
  let finishStartup;const startupFinished=new Promise(resolve=>finishStartup=resolve);
  const signalHandlers=new Map();
  const log=async(code,detail)=>{try{await fs.mkdir(config.logsDir,{recursive:true,mode:0o700});await appendLog(path.join(config.logsDir,'portable-startup.log'),`${new Date().toISOString()} ${code} app=${config.appPort} worker=${config.workerPort}${detail?' '+JSON.stringify(detail):''}\n`,{mode:0o600});}catch{/* Do not log process environments, request bodies, or model secrets. */}};
  async function stop(){
    if(stopping)return stopping;
    state='stopping';stopFailure=undefined;
    const attempt=(async()=>{
      // A stop during asynchronous app creation must also close resources created later.
      await startupFinished;
      for(const [signal,handler] of signalHandlers)process.off(signal,handler);
      try{await closeServer(app,true);}catch{await log('APP_CLOSE_FAILED');throw Object.assign(error('STOP_FAILED','工作台落盘关闭未成功，已保留实例身份。'),{stopFailure:'APP_CLOSE_FAILED'});}
      try{await stopChild(child);}catch{
        await log('WORKER_CLOSE_FAILED');
        // Keep the control channel, identity record and lock until our worker has actually exited.
        throw Object.assign(error('STOP_FAILED','自有Java执行服务未能退出，停止失败；已保留实例身份。'),{stopFailure:'WORKER_CLOSE_FAILED'});
      }
      try{await closeServer(control);}catch{await log('CONTROL_CLOSE_FAILED');}
      if(lock){await lock.close().catch(()=>{});const current=await readPrivateJson(config.lockFile).catch(()=>null);if(current?.nonce===nonce)await fs.unlink(config.lockFile).catch(()=>{});}
      // The instance file is the command client's completion marker: remove it after the lock.
      if(record){const current=await readPrivateJson(config.instanceFile).catch(()=>null);if(current?.instanceId===nonce)await fs.unlink(config.instanceFile).catch(()=>{});}
      await unregisterInstallation(installationFile,nonce);
      await log('STOPPED');
    })();
    stopping=attempt;
    // Publish a terminal failure only after this attempt has settled. A client
    // must not retry into a still-pending promise while failure logging awaits I/O.
    try{return await attempt;}catch(cause){if(stopping===attempt){stopping=undefined;stopFailure=cause.stopFailure;}throw cause;}
  }
  try{
    lock=await acquireLock(config,id,nonce);
    if(registerSignals)for(const signal of ['SIGINT','SIGTERM']){const handler=()=>void stop().catch(()=>{});signalHandlers.set(signal,handler);process.once(signal,handler);}
    const old=await readPrivateJson(config.instanceFile);
    if(old){if(!matchesRecord(old,id)||!isDead(old.pid))throw error('INSTANCE_UNVERIFIED','数据目录存在仍存活或身份未知的实例记录，拒绝覆盖。');await fs.unlink(config.instanceFile);}
    await assertPortFree(config.appPort);await assertPortFree(config.workerPort);
    const controlToken=randomBytes(32).toString('hex');
    control=http.createServer((req,res)=>{
      const expected=`127.0.0.1:${control.address()?.port}`,provided=req.headers['x-portable-token'];
      const allowed=req.socket.remoteAddress==='127.0.0.1'&&req.headers.host===expected&&req.headers.origin===undefined&&typeof provided==='string'&&/^[a-f0-9]{64}$/.test(provided)&&timingSafeEqual(Buffer.from(provided),Buffer.from(controlToken));
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
      if(!allowed){res.writeHead(403);res.end(JSON.stringify({error:'Control denied'}));req.resume();return;}
      if(req.url==='/status'&&req.method==='GET'){let activity;try{activity=app?.desktopActivity?.();}catch{}res.end(JSON.stringify(publicStatus(record,state,stopFailure,activity)));return;}
      if(req.url==='/stop'&&req.method==='POST'){const requested=stop();res.end(JSON.stringify({instanceId:nonce,state:'stopping'}));req.resume();void requested.catch(()=>{});return;}
      res.writeHead(404);res.end(JSON.stringify({error:'Unavailable'}));req.resume();
    });control.requestTimeout=3000;control.headersTimeout=3000;
    const controlPort=await listen(control,0);
    control.on('error',()=>{if(registerSignals)process.exitCode=1;void log('CONTROL_ERROR');void stop().catch(()=>{});});
    record={version:1,...id,instanceId:nonce,pid:process.pid,controlPort,controlToken,appPort:config.appPort,workerPort:config.workerPort,engine:'spring-ai',startedAt:new Date().toISOString()};
    await publishRecord(config,record);installationFile=await registerInstallation(config,record);await log('STARTING');
    const childEnv={...env,WORKBENCH_BRIDGE_TOKEN:bridgeToken,WORKBENCH_WORKER_PORT:String(config.workerPort)};
    for(const key of Object.keys(childEnv))if(key.toUpperCase()==='ARK_API_KEY')delete childEnv[key];
    // Only bounded startup output is retained. After readiness, drain and discard
    // both streams so no model requests, business text or credentials are logged.
    const stderr=boundedOutput(childEnv),stdout=boundedOutput(childEnv);
    child=spawnWorker(config.javaExe,['-jar',config.jarPath],{cwd:id.rootDir,env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stderr?.on('data',chunk=>{if(!ready)stderr.append(chunk);});child.stdout?.on('data',chunk=>{if(!ready)stdout.append(chunk);});
    workerClosed=new Promise(resolve=>child.once('close',resolve));
    const failed=(code,message)=>Object.assign(error(code,message),{details:{exitCode:child.exitCode,signal:child.signalCode,stderrTail:stderr.value(),stdoutTail:stdout.value()}});
    child.once('error',cause=>{workerExited=true;workerFailure=failed('WORKER_SPAWN_FAILED','Windows未能启动内置Java服务。请重新运行安装包修复，数据不会丢失；仍失败时请联系IT检查应用控制或安全软件事件，尚不能确认是拦截。详见 logs/portable-startup.log。');workerFailure.details.spawnCode=cause.code||'UNKNOWN';if(ready){void log(workerFailure.code,{spawnCode:workerFailure.details.spawnCode});void stop().catch(()=>{});}});
    child.once('exit',(exitCode,signal)=>{workerExited=true;workerFailure??=failed('WORKER_EXIT','内置Java服务启动后退出。请重新运行安装包修复，数据不会丢失；仍失败时将 logs/portable-startup.log 交给支持人员，并请IT检查应用控制或安全软件事件（尚未确认拦截）。');workerFailure.details.exitCode=exitCode;workerFailure.details.signal=signal;if(ready){void log('WORKER_EXIT',{exitCode,signal});if(registerSignals)process.exitCode=1;void stop().catch(()=>{});}});
    child.once('close',()=>{if(workerFailure&&!ready){workerFailure.details.stderrTail=stderr.value();workerFailure.details.stdoutTail=stdout.value();}});
    const deadline=Date.now()+config.startupTimeoutMs;
    while(!(await healthyWorker(config.workerPort,bridgeToken))){if(workerExited||stopping)throw workerFailure||error('START_CANCELLED','启动已取消。');if(Date.now()>=deadline)throw Object.assign(error('WORKER_TIMEOUT','Java执行服务健康检查超时，未启动工作台。'),{details:{stderrTail:stderr.value(),stdoutTail:stdout.value()}});await sleep(100);}
    if(workerExited||stopping)throw error('WORKER_EXIT','Java执行服务在启动时退出。');
    await log('WORKER_HEALTHY');
    try{
      const create=createWorkbenchServer||(await import('../server.mjs')).createWorkbenchServer;
      app=await create({dataDir:id.dataDir,storageMode:'sharded',nativeLanguageStage:4,publicDir:config.publicDir,executionEngine:'spring-ai',bridgeToken,workerPort:config.workerPort});
      if(stopping)throw error('START_CANCELLED','工作台启动已停止。');
      await listen(app,config.appPort);
    }catch(cause){if(cause?.portable)throw cause;throw error(cause?.code==='EADDRINUSE'?'PORT_IN_USE':'APP_START_FAILED',cause?.code==='EADDRINUSE'?`工作台端口${config.appPort}已被占用，启动已回收。`:'工作台启动失败，已回收自有执行服务。');}
    if(workerExited||stopping)throw error('WORKER_EXIT','Java执行服务在启动时退出。');
    app.on('error',()=>{if(registerSignals)process.exitCode=1;void log('APP_ERROR');void stop().catch(()=>{});});
    ready=true;state='ready';finishStartup();await log('READY');
    return {status:()=>publicStatus(record,state,stopFailure,app?.desktopActivity?.()),stop};
  }catch(cause){finishStartup();if(workerClosed&&workerExited)await Promise.race([workerClosed,sleep(1000)]);const failure=workerFailure||cause;await log(failure?.portable?failure.code:'START_FAILED',failure.details);await saveStartupFailure(config,env.WORKBENCH_START_ATTEMPT,failure).catch(()=>{});await stop();throw failure?.portable?failure:error('START_FAILED','便携主管启动失败，请查看数据目录日志。');}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{if(process.argv.length!==3||process.argv[2]!=='--supervise')throw error('INVALID_ARGUMENT','主管仅支持--supervise，请使用便携启动器。');await startSupervisor(getConfig());}
  catch(cause){console.error(safeErrorMessage(cause));process.exitCode=1;}
}
