import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {getConfig,queryInstance,stopInstance,stopInstallation,validateResources,safeErrorMessage} from './portable-runtime.mjs';
import {productVersion} from './version.mjs';
import {randomBytes} from 'node:crypto';
import {readStartupFailure} from './startup-diagnostics.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=(code,message)=>Object.assign(new Error(message),{code,portable:true});
async function startDetached(config,env){
  const child=spawn(config.nodeExe,[config.runtimeScript,'--supervise'],{cwd:config.rootDir,env:{...env,DEMO_DATA_DIR:config.dataDir,DEMO_PORT:String(config.appPort),WORKBENCH_WORKER_PORT:String(config.workerPort),PORTABLE_STARTUP_TIMEOUT_MS:String(config.startupTimeoutMs)},detached:true,windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(fail('SUPERVISOR_SPAWN_FAILED','无法启动随包Node主管，请检查完整解压目录。')));});
  child.unref();return child;
}
async function openBrowser(url){
  const executable=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  const child=spawn(executable,args,{detached:true,windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(fail('BROWSER_OPEN_FAILED',`服务已就绪，请手动访问${url}`)));});child.unref();
}
export async function runPortableCommand(args=[],{config=getConfig(),env=process.env,startDetached:start=startDetached,openBrowser:open=openBrowser,write=value=>console.log(value)}={}){
  if(args.some(arg=>!['--no-open','--status','--stop','--stop-installation'].includes(arg))||(['--status','--stop','--stop-installation'].filter(arg=>args.includes(arg)).length>1))throw fail('INVALID_ARGUMENT','支持参数：--no-open、--status、--stop、--stop-installation。');
  if(args.includes('--status')){const status=await queryInstance(config)||{version:1,productVersion,state:'stopped',engine:'spring-ai',appPort:config.appPort,workerPort:config.workerPort};write(JSON.stringify(status));return status;}
  if(args.includes('--stop')){const status=await stopInstance(config);write(JSON.stringify(status));return status;}
  if(args.includes('--stop-installation')){const status=await stopInstallation(config);write(JSON.stringify(status));return status;}
  let status=await queryInstance(config),started=false,child;const attempt=randomBytes(16).toString('hex');
  if(!status){await validateResources(config);child=await start(config,{...env,WORKBENCH_START_ATTEMPT:attempt});started=true;}
  const deadline=Date.now()+config.startupTimeoutMs+5000,startTime=Date.now();
  while(status?.state!=='ready'){
    if(status?.state==='stopping')throw fail('INSTANCE_STOPPING','当前实例正在关闭，请稍后启动。');
    if(Date.now()>=deadline)throw fail('START_TIMEOUT','便携服务未在等待时间内就绪，请查看数据目录 logs/portable-startup.log。');
    await sleep(150);
    try{status=await queryInstance(config);}
    catch(cause){
      // A cold, newly spawned supervisor can briefly miss a short control
      // probe. Retry within the startup deadline; never accept an unverified
      // ready state or relax the initial check of an existing process.
      if(!started||cause.code!=='INSTANCE_UNVERIFIED')throw cause;
      status=null;
    }
    if(!status&&child&&child.exitCode!==null&&Date.now()-startTime>1000){const report=await readStartupFailure(config,attempt);if(report&&['WORKER_EXIT','WORKER_SPAWN_FAILED','WORKER_TIMEOUT','PORT_IN_USE','APP_START_FAILED','INSTANCE_LOCKED'].includes(report.code))throw Object.assign(fail(report.code,report.message),{details:report.details});throw fail('START_FAILED','便携主管未能启动，请查看数据目录 logs/portable-startup.log（端口占用或依赖不完整）。');}
  }
  if(!args.includes('--no-open'))await open(status.url);
  const result={...status,started};write(JSON.stringify(result));return result;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const args=process.argv.slice(2),homeIndex=args.indexOf('--home');let config;if(homeIndex>=0){if(!args[homeIndex+1]||args[homeIndex+1].startsWith('--'))throw fail('INVALID_ARGUMENT','缺少安装目录。');config=getConfig({rootDir:args[homeIndex+1]});args.splice(homeIndex,2);}await runPortableCommand(args,{...(config?{config}:{})});}catch(cause){console.error(safeErrorMessage(cause));process.exitCode=1;}
}
