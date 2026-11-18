import fs from 'node:fs/promises';
import path from 'node:path';

const keys=['workspace','sources','traces','reports','translations','cache','drafts','backups','settings','other'];
function group(name){
 if(['workspace.json','workspace-records'].includes(name))return 'workspace';
 if(name==='sources')return 'sources';
 if(name==='workflow-runs')return 'traces';
 if(['report-jobs','raw-structure-jobs'].includes(name))return 'reports';
 if(name==='content-translations')return 'translations';
 if(['report-cache','translation-cache'].includes(name))return 'cache';
 if(name==='import-drafts')return 'drafts';
 if(name==='backups')return 'backups';
 if(name==='.secrets')return 'settings';
 return 'other';
}

/** Metadata only. Never follows directory links or reads file contents. */
export async function measureWorkspaceUsage(dataDir,{fsOps=fs,maxEntries=100000,maxDurationMs=5000,now=Date.now}={}){
 const root=path.resolve(dataDir),start=now(),rootStat=await fsOps.lstat(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('工作区用量无法读取：数据目录必须是本机普通目录。');
 const realRoot=await fsOps.realpath(root),inside=value=>value===realRoot||value.startsWith(realRoot+path.sep);
 const categories=Object.fromEntries(keys.map(key=>[key,{key,bytes:0,files:0}]));
 let entries=0,skippedLinks=0,unreadable=0,truncated=false;
 async function walk(dir,category,depth){
  if(entries>=maxEntries||now()-start>=maxDurationMs||depth>32){truncated=true;return;}
  try{
   const stat=await fsOps.lstat(dir);
   if(stat.isSymbolicLink()){skippedLinks++;return;}
   if(!stat.isDirectory()||!inside(await fsOps.realpath(dir))){unreadable++;return;}
   const children=await fsOps.readdir(dir,{withFileTypes:true});
   for(const child of children){
    if(entries>=maxEntries||now()-start>=maxDurationMs){truncated=true;break;}
    entries++;
    const filename=path.join(dir,child.name),key=category||group(child.name);
    try{
     const item=await fsOps.lstat(filename);
     if(item.isSymbolicLink()){skippedLinks++;continue;}
     if(item.isDirectory()){await walk(filename,key,depth+1);continue;}
     if(!item.isFile()||!inside(await fsOps.realpath(filename))){unreadable++;continue;}
     categories[key].bytes+=item.size;categories[key].files++;
    }catch{unreadable++;}
   }
  }catch{unreadable++;}
 }
 await walk(root,null,0);
 let disk=null;
 try{const value=await fsOps.statfs(root);disk={availableBytes:value.bavail*value.bsize,totalBytes:value.blocks*value.bsize};}catch{}
 const values=Object.values(categories);
 return {measuredAt:new Date(now()).toISOString(),workspacePath:root,totalBytes:values.reduce((n,c)=>n+c.bytes,0),files:values.reduce((n,c)=>n+c.files,0),categories:values,disk,partial:truncated||unreadable>0||skippedLinks>0,truncated,unreadable,skippedLinks};
}

export function createWorkspaceUsageReader(dataDir,options={}){
 let pending=null;
 return ()=>pending||(pending=measureWorkspaceUsage(dataDir,options).finally(()=>{pending=null;}));
}
