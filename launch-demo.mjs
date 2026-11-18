import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {appendFile} from 'node:fs/promises';

const project=path.dirname(fileURLToPath(import.meta.url));
export function configuredPort(env=process.env){
  const value=env.DEMO_PORT||'4186';
  if(!/^[1-9]\d*$/.test(value)||Number(value)<1024||Number(value)>65535)throw new Error('演示端口须为1024至65535之间的整数');
  return Number(value);
}
const baseUrl=`http://127.0.0.1:${configuredPort()}`;

function probe(url){
  return new Promise(resolve=>{
    const request=http.get(url,response=>{
      let body='',length=0;response.setEncoding('utf8');
      response.on('data',chunk=>{length+=Buffer.byteLength(chunk);if(length>65536)request.destroy();else body+=chunk;});
      response.on('end',()=>resolve(response.statusCode===200&&body.includes('服务会话质检工作台')&&body.includes('./app.mjs')?'ready':'occupied'));
      response.on('error',()=>resolve('occupied'));
    });
    request.setTimeout(1200,()=>request.destroy());
    request.on('error',error=>resolve(error.code==='ECONNREFUSED'?'offline':'occupied'));
    request.on('close',()=>resolve('occupied'));
  });
}

function startServer(){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(project,'server.mjs')],{
      cwd:project,env:{...process.env,DEMO_PORT:String(configuredPort())},detached:true,windowsHide:true,stdio:'ignore',
    });
    child.once('error',reject);
    child.once('spawn',()=>{child.unref();resolve();});
  });
}

export async function ensureDemoReady({baseUrl:address=baseUrl,start=startServer,timeout=8000}={}){
  const url=new URL(address);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error('启动器仅支持本机地址');
  const initial=await probe(url);
  if(initial==='ready')return {url:`${url.origin}/#review`,started:false};
  if(initial!=='offline')throw new Error(`端口 ${url.port} 被其它程序占用或未响应；没有修改该程序。`);
  await start();
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    const status=await probe(url);
    if(status==='ready')return {url:`${url.origin}/#review`,started:true};
    if(status==='occupied')throw new Error(`端口 ${url.port} 被其它程序占用或未响应；没有修改该程序。`);
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw new Error('Demo未能在8秒内启动，请检查Node.js和项目文件。');
}

async function openBrowser(url){
  await new Promise((resolve,reject)=>{
    const opener=path.join(process.env.SystemRoot||'C:\\Windows','System32','rundll32.exe');
    const child=spawn(opener,['url.dll,FileProtocolHandler',url],{detached:true,windowsHide:true,stdio:'ignore'});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    const result=await ensureDemoReady();
    if(!process.argv.includes('--no-open'))await openBrowser(result.url);
    process.stdout.write(`${result.started?'Started':'Reused'}: ${result.url}\n`);
  }catch(error){
    const message=`${new Date().toISOString()} ${error.stack||error.message}\n`;
    await appendFile(path.join(project,'launcher-error.log'),message,'utf8').catch(()=>{});
    process.stderr.write(`${error.message}\n`);process.exitCode=1;
  }
}
