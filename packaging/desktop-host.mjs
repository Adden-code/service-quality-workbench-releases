import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {getConfig,inspectDesktopInstance,recoverStalePortableLock,stopInstance,safeErrorMessage} from './portable-runtime.mjs';
import {runPortableCommand} from './portable-launch.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{code,portable:true});
export async function runDesktopCommand(args=[],{config,env=process.env,start=runPortableCommand,stop=stopInstance,inspect=inspectDesktopInstance,recover=recoverStalePortableLock,write=value=>process.stdout.write(JSON.stringify(value)+'\n')}={}){
 let result;
 try{
  const commands=['--inspect','--start','--stop','--recover-stale'];let command,home;
  for(let i=0;i<args.length;i++){const arg=args[i];if(commands.includes(arg)&&!command)command=arg;else if(arg==='--home'&&!home&&typeof args[i+1]==='string'&&args[i+1]&&!args[i+1].startsWith('--'))home=args[++i];else throw fail('INVALID_ARGUMENT','桌面服务桥参数无效。');}
  if(!command)throw fail('INVALID_ARGUMENT','请选择桌面服务桥命令。');
  config??=getConfig({...(home?{rootDir:home}:{}),env});
  if(command==='--inspect')result={ok:true,...await inspect(config)};
  else if(command==='--recover-stale')result={ok:true,...await recover(config),...await inspect(config)};
  else{
   const before=await inspect(config);if(before.state==='blocked')throw fail('INSTANCE_UNVERIFIED','实例或锁身份无法核验，未控制未知进程。');
   if(command==='--start'){
    if(before.staleLock.present&&before.staleLock.recoverable)throw fail('STALE_LOCK_CONFIRMATION','检测到已退出进程的残留锁，请先确认恢复。');
    const started=await start(['--no-open'],{config,env,write:()=>{}});result={ok:true,...await inspect(config),started:started.started};
   }else{const stopped=await stop(config);result={ok:true,...await inspect(config),...stopped};}
  }
 }catch(cause){result={ok:false,error:{code:cause?.portable?cause.code:'DESKTOP_COMMAND_FAILED',message:safeErrorMessage(cause,env.WORKBENCH_LAUNCHER_LANGUAGE||'zh')}};}
 write(result);return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const result=await runDesktopCommand(process.argv.slice(2));if(!result.ok)process.exitCode=1;}
