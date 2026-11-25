import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export class ReportJobError extends Error{constructor(message,status=400,code='REPORT_INPUT'){super(message);this.name='ReportJobError';this.status=status;this.code=code;}}
export function reportJobId(id){if(typeof id!=='string'||!ID.test(id))throw new ReportJobError('交付任务标识无效。');return id;}
const storage=()=>new ReportJobError('交付任务文件无法读取或保存，原有文件已保留。',500,'REPORT_STORAGE');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function createReportJobStore({dataDir}={}){
 const root=path.resolve(dataDir),jobs=path.join(root,'report-jobs'),cache=path.join(root,'report-cache');let closed=false,tail=Promise.resolve();
 async function directory(file,create=false){try{const stat=await fs.lstat(file);if(!stat.isDirectory()||stat.isSymbolicLink())throw storage();}catch(e){if(e.code==='ENOENT'&&create){await fs.mkdir(file);return;}throw e;}}
 await directory(root);await directory(jobs,true);await directory(cache,true);
 const serial=operation=>{if(closed)return Promise.reject(storage());const pending=tail.then(operation);tail=pending.catch(()=>{});return pending;};
 const folder=id=>path.join(jobs,reportJobId(id));
 async function read(file,max=64*1024*1024){try{await directory(path.dirname(file));const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw storage();return await fs.readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw storage();}}
 async function json(file,max){const bytes=await read(file,max);if(bytes===null)return null;try{return JSON.parse(bytes.toString('utf8'));}catch{throw storage();}}
 async function atomic(file,value,max=64*1024*1024){
  const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>max)throw storage();await directory(path.dirname(file));
  const old=await fs.lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(old&&(!old.isFile()||old.isSymbolicLink()))throw storage();
  const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';let handle;
  try{handle=await fs.open(temp,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);}
  catch{if(handle)await handle.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});throw storage();}
 }
 return{
  async list(){const result=[];for(const entry of await fs.readdir(jobs,{withFileTypes:true})){if(entry.isSymbolicLink()||!entry.isDirectory())throw storage();if(/^\.creating-[A-Za-z0-9_-]+-[a-f0-9]+$/.test(entry.name))continue;const id=reportJobId(entry.name);const job=await json(path.join(folder(id),'job.json'),8*1024*1024);if(!job||job.id!==id||job.schemaVersion!==1||!Array.isArray(job.units))throw storage();result.push(job);}return result;},
  create(job,snapshot){return serial(async()=>{const dir=folder(job.id);await directory(jobs);const exists=await fs.lstat(dir).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(exists)throw new ReportJobError('交付任务标识已存在。',409);const staged=path.join(jobs,`.creating-${job.id}-${randomBytes(8).toString('hex')}`);await fs.mkdir(staged);await atomic(path.join(staged,'snapshot.json'),snapshot);await atomic(path.join(staged,'job.json'),job,8*1024*1024);await fs.rename(staged,dir);});},
  save(job){job=structuredClone(job);return serial(()=>atomic(path.join(folder(job.id),'job.json'),job,8*1024*1024));},
  async snapshot(id){const value=await json(path.join(folder(id),'snapshot.json'));if(!value)throw storage();return value;},
  async result(id,nodeId){if(!/^n\d+$/.test(nodeId))throw storage();return json(path.join(folder(id),nodeId+'.json'));},
  saveResult(id,nodeId,value){return serial(async()=>{if(!/^n\d+$/.test(nodeId))throw storage();const envelope={value,sha256:sha(Buffer.from(JSON.stringify(value)))};await atomic(path.join(folder(id),nodeId+'.json'),envelope);return envelope.sha256;});},
  saveAttempt(id,nodeId,attempt,value){return serial(()=>{if(!/^n\d+$/.test(nodeId)||!Number.isSafeInteger(attempt)||attempt<1)throw storage();return atomic(path.join(folder(id),`${nodeId}-a${attempt}.json`),value,256*1024);});},
  async attempt(id,nodeId,attempt){if(!/^n\d+$/.test(nodeId)||!Number.isSafeInteger(attempt)||attempt<1)throw storage();return json(path.join(folder(id),`${nodeId}-a${attempt}.json`),256*1024);},
  saveCandidate(id,nodeId,attempt,value){return serial(()=>{if(!/^n\d+$/.test(nodeId)||!Number.isSafeInteger(attempt)||attempt<1)throw storage();return atomic(path.join(folder(id),`${nodeId}-a${attempt}-native-candidate.json`),{value,sha256:sha(Buffer.from(JSON.stringify(value)))},2*1024*1024);});},
  async candidate(id,nodeId,attempt){if(!/^n\d+$/.test(nodeId)||!Number.isSafeInteger(attempt)||attempt<1)throw storage();const saved=await json(path.join(folder(id),`${nodeId}-a${attempt}-native-candidate.json`),2*1024*1024);if(saved&&saved.sha256!==sha(Buffer.from(JSON.stringify(saved.value))))throw storage();return saved?.value??null;},
  async cache(key){if(!/^[a-f0-9]{64}$/.test(key))throw storage();const result=await json(path.join(cache,key+'.json'),1024*1024);if(!result)return null;if(result.key!==key||sha(Buffer.from(JSON.stringify(result.value)))!==result.sha256)throw storage();return result.value;},
  putCache(key,value){return serial(async()=>{if(!/^[a-f0-9]{64}$/.test(key))throw storage();const file=path.join(cache,key+'.json');if(await read(file,1024*1024))return;await atomic(file,{key,value,sha256:sha(Buffer.from(JSON.stringify(value)))},1024*1024);});},
  async close(){closed=true;await tail;},
 };
}
