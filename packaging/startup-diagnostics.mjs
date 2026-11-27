import fs from 'node:fs/promises';
import path from 'node:path';

export const javaCoreFiles=Object.freeze(['bin/java.exe','bin/server/jvm.dll','bin/jli.dll','bin/java.dll','bin/zip.dll','bin/verify.dll','bin/vcruntime140.dll','bin/vcruntime140_1.dll','lib/modules','conf/security/java.security']);
export function boundedOutput(env={},limit=4096){
 let tail='';
 const secrets=Object.entries(env).filter(([key,value])=>/token|secret|password|api.?key|authorization/i.test(key)&&String(value).length>=6).map(([,value])=>String(value));
 return {
  append(chunk){tail=(tail+String(chunk)).slice(-limit-1024);},
  value(){let safe=tail;for(const secret of secrets)safe=safe.split(secret).join('[REDACTED]');return safe.replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\r\n]+/gi,'$1[REDACTED]').replace(/((?:api[_-]?key|password|secret|token)\s*["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,'$1[REDACTED]').replace(/\bsk-[A-Za-z0-9_-]+/g,'[REDACTED]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(-limit);}
 };
}
const attemptPattern=/^[a-f0-9]{32}$/;
export async function saveStartupFailure(config,attempt,cause){
 if(!attemptPattern.test(attempt||''))return;
 const file=path.join(config.logsDir,'startup-failure-'+attempt+'.json');
 await fs.mkdir(config.logsDir,{recursive:true});
 await fs.writeFile(file,JSON.stringify({attempt,rootDir:config.rootDir,appPort:config.appPort,workerPort:config.workerPort,code:cause.code,message:cause.message,details:cause.details||null}),{mode:0o600,flag:'wx'});
}
export async function readStartupFailure(config,attempt){
 if(!attemptPattern.test(attempt||''))return null;
 const file=path.join(config.logsDir,'startup-failure-'+attempt+'.json');
 try{
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)return null;
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(value.attempt!==attempt||value.rootDir!==config.rootDir||value.appPort!==config.appPort||value.workerPort!==config.workerPort)return null;
  return value;
 }catch{return null;}finally{await fs.unlink(file).catch(()=>{});}
}
