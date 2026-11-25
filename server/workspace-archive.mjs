import {verifyLanguageFileSet} from './workspace-language-service.mjs';
import {isRecordIndex,readRecordDocument} from './workspace-records.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {WorkspaceError,validateWorkspace} from './workspace-validation.mjs';

// Uncompressed, length-delimited archive: no executable payload or decompressor.
const MAGIC=Buffer.from('SQWB0001');
export const MAX_BACKUP_BYTES=512*1024*1024;
const MAX_MANIFEST=8*1024*1024,MAX_FILE=64*1024*1024,MAX_FILES=20000;
const roots=new Set(['sources','workflow-runs','report-jobs','raw-structure','content-translations','report-cache','translation-cache','import-drafts','admin-drafts','backups','language-materials']);
// Exact top-level local outputs, never business sources or restore targets.
// Skip before lstat/realpath so legacy WebView2 locks and junctions are untouched.
// diagnostics contains generated, allowlisted metadata ZIPs, not source records.
export const isLocalWorkspaceOutput=name=>['desktop-profile','diagnostics'].includes(process.platform==='win32'?name.toLowerCase():name);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new WorkspaceError(message,400);};
const transient=name=>/^\..*\.tmp$/.test(name)||/^\.(workspace|workflow)\.lock(?:\.recovery)?$/.test(name);
export function backupSummary(document){return {taskCount:document?.state?.tasks?.length||0,sessionCount:document?.state?.sessions?.length||0,ruleCount:document?.catalog?.rules?.length||0};}
export function validateBackupPath(name){
 if(typeof name!=='string'||!name||name.length>600||name.includes('\\')||name.startsWith('/')||/[\u0000-\u001f\u007f:]/.test(name))fail('备份包含无效文件路径。');
 const parts=name.split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||transient(part)))fail('备份包含不安全或临时文件路径。');
 if(!(name==='workspace.json'||parts.length>1&&roots.has(parts[0])))fail('备份包含不支持的文件类型或本机凭据。');
 return name;
}
export function validateBackupDocument(bytes){
 let document;try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('备份中的工作区记录不是有效 JSON。');}
 if(document?.schemaVersion!==1||!Number.isSafeInteger(document.revision)||document.revision<1||!Array.isArray(document.mutations)||new Set(document.mutations.map(item=>item?.id)).size!==document.mutations.length||document.mutations.some(item=>!item||typeof item.id!=='string'||!/^[a-f0-9]{64}$/.test(item.digest)))fail('备份工作区格式不受支持。');
 validateWorkspace(document.state,document.catalog);
 return document;
}
export function decodeWorkspaceArchive(input){
 const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
 if(bytes.length>MAX_BACKUP_BYTES)throw new WorkspaceError('工作区备份超过 512 MB 上限。',413);
 if(bytes.length<12||!bytes.subarray(0,8).equals(MAGIC))fail('请选择工作台生成的 .sqwb 备份文件。');
 const size=bytes.readUInt32BE(8);if(size<2||size>MAX_MANIFEST||12+size>bytes.length)fail('备份目录长度无效或文件不完整。');
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+size)));}catch{fail('备份目录损坏。');}
 if(manifest?.format!=='service-quality-workspace'||manifest.version!==1||!/^\d+\.\d+\.\d+$/.test(manifest.appVersion)||!Number.isFinite(Date.parse(manifest.createdAt))||!Array.isArray(manifest.files)||manifest.files.length<1||manifest.files.length>MAX_FILES)fail('备份版本或目录不受支持。');
 const files=new Map(),names=new Set();let offset=12+size,totalBytes=0;
 for(const entry of manifest.files){
  validateBackupPath(entry?.path);const folded=entry.path.toLowerCase();
  if(names.has(folded)||!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>MAX_FILE||!/^[a-f0-9]{64}$/.test(entry.sha256))fail('备份文件重复或大小摘要无效。');
  names.add(folded);if(offset+entry.size>bytes.length)fail('备份文件不完整。');
  const content=bytes.subarray(offset,offset+entry.size);if(hash(content)!==entry.sha256)fail('备份文件校验失败，当前工作区未改变。');
  files.set(entry.path,content);offset+=entry.size;totalBytes+=entry.size;
 }
 for(const name of names){const parts=name.split('/');for(let i=1;i<parts.length;i++)if(names.has(parts.slice(0,i).join('/')))fail('备份文件和目录路径冲突。');}
 if(offset!==bytes.length||manifest.totalBytes!==totalBytes||manifest.fileCount!==files.size||!files.has('workspace.json'))fail('备份长度或工作区目录不匹配。');
 const document=validateBackupDocument(files.get('workspace.json'));
 verifyLanguageFileSet(document.state,files);
 return {manifest:{...manifest,...backupSummary(document)},files,document};
}
export async function encodeWorkspaceArchive(dataDir,{appVersion='0.10.6'}={}){
 const root=path.resolve(dataDir),rootStat=await fs.lstat(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('工作区必须是本机普通目录。');
 const real=await fs.realpath(root),files=[],contents=[];let totalBytes=0;
 async function walk(dir,relative='',depth=0){
  if(depth>32)fail('工作区目录层级过深。');
  for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(!relative&&(isLocalWorkspaceOutput(entry.name)||['workspace-records','.secrets','logs','.portable-instance.json','.portable-instance.lock','.workspace-control.lock','.workspace-control.lock.recovery','.workspace-restore.json'].includes(entry.name))||transient(entry.name))continue;
   const name=relative?`${relative}/${entry.name}`:entry.name,full=path.join(dir,entry.name),stat=await fs.lstat(full);
   if(stat.isSymbolicLink()||!(await fs.realpath(full)).startsWith(real+path.sep))fail('工作区包含目录链接，无法保证完整备份。');
   if(stat.isDirectory()){
    if(!relative&&!roots.has(entry.name))fail(`工作区包含未支持的目录：${entry.name}。`);
    if(entry.name.startsWith('.creating-'))fail(`工作区存在未完成的写入目录：${name}。启动恢复未能确认其安全归属，请关闭工作台并由维护人核对该路径；保留原件并移至工作区外后重新启动以自动重试。`);
    await walk(full,name,depth+1);continue;
   }
   validateBackupPath(name);
   if(!stat.isFile()||stat.nlink!==1)fail('工作区包含非普通文件或硬链接。');
   if(stat.size>MAX_FILE||files.length>=MAX_FILES||totalBytes+stat.size>MAX_BACKUP_BYTES-MAX_MANIFEST)throw new WorkspaceError('工作区超过备份上限（512 MB、单文件 64 MB、20000 个文件）。',413);
   const bytes=await fs.readFile(full),after=await fs.lstat(full);
   if(bytes.length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino||!after.isFile()||after.isSymbolicLink()||after.nlink!==1||!(await fs.realpath(full)).startsWith(real+path.sep))fail('工作区文件在备份中发生变化，请稍后重试。');
   let content=bytes;
   if(name==='workspace.json'){const disk=JSON.parse(bytes);if(isRecordIndex(disk))content=Buffer.from(JSON.stringify(await readRecordDocument(root,disk)));}
   if(content.length>MAX_FILE||totalBytes+content.length>MAX_BACKUP_BYTES-MAX_MANIFEST)throw new WorkspaceError('工作区超过备份容量上限。',413);
   files.push({path:name,size:content.length,sha256:hash(content)});contents.push(content);totalBytes+=content.length;
  }
 }
 await walk(root);
 const at=files.findIndex(file=>file.path==='workspace.json');if(at<0)fail('工作区尚未初始化，请先打开工作台。');
 const document=validateBackupDocument(contents[at]);
 verifyLanguageFileSet(document.state,new Map(files.map((file,i)=>[file.path,contents[i]])));
 const manifest={format:'service-quality-workspace',version:1,appVersion,createdAt:new Date().toISOString(),fileCount:files.length,totalBytes,...backupSummary(document),files};
 const json=Buffer.from(JSON.stringify(manifest));if(json.length>MAX_MANIFEST)fail('备份目录超过大小限制。');
 const header=Buffer.alloc(12);MAGIC.copy(header);header.writeUInt32BE(json.length,8);
 const bytes=Buffer.concat([header,json,...contents]);if(bytes.length>MAX_BACKUP_BYTES)throw new WorkspaceError('工作区备份超过 512 MB 上限。',413);
 return {bytes,manifest};
}
