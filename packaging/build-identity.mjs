import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
export async function writeBuildIdentity({root,sourceDir,version}){
 const git=spawnSync('git',['-C',sourceDir,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
 const commit=git.status===0?git.stdout.trim():null;
 const hashes=[];
 async function walk(dir,relative){for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=relative+'/'+entry.name;if(entry.isDirectory())await walk(path.join(dir,entry.name),rel);else if(entry.isFile()&&!/\/build-identity\.(mjs|json)$/.test(rel))hashes.push([rel,createHash('sha256').update(await fs.readFile(path.join(dir,entry.name))).digest('hex')]);}}
 for(const dir of ['public','server','resources','packaging']){try{await walk(path.join(root,dir),dir);}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const rel of ['server.mjs','service/spring-ai-worker.jar','QualityWorkbench.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll']){try{hashes.push([rel,createHash('sha256').update(await fs.readFile(path.join(root,rel))).digest('hex')]);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const fingerprint=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
 const info={version,sourceCommit:commit,buildId:`${version}-${fingerprint(hashes).slice(0,16)}`,resourceFingerprint:fingerprint(hashes.filter(([name])=>name.startsWith('resources/')))};
 await fs.writeFile(path.join(root,'public/build-identity.mjs'),'export const clientBuild='+JSON.stringify(info)+';\n');
 await fs.writeFile(path.join(root,'packaging/build-identity.json'),JSON.stringify(info,null,2)+'\n');
 return info;
}
