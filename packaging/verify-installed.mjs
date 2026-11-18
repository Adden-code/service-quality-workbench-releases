import path from 'node:path';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.resolve(process.argv[2]||'');
assert.ok(process.argv[2],'Supply the absolute temporary test installation directory');
const origin='http://127.0.0.1:4187';
async function reachable(){try{await fetch(origin,{signal:AbortSignal.timeout(1500)});return true;}catch{return false;}}
assert.equal(await reachable(),false,'QA port is occupied; no process was changed');
const launcher=path.join(root,'会话质检工作台.exe');
function launch(){
  const result=spawnSync(launcher,['--no-open'],{env:{...process.env,DEMO_PORT:'4187'},stdio:'ignore',windowsHide:true,timeout:20000});
  if(result.error)throw result.error;
  assert.equal(result.status,0,'Installed launcher failed; see launcher-error.log');
}
launch();
assert.equal(await reachable(),true,'Fresh installed server is not available');
const manifest=JSON.parse(await readFile(path.join(root,'文件校验清单.json'),'utf8'));
for(const file of manifest.files){
  const full=path.resolve(root,...file.path.split('/'));
  assert.ok(full.startsWith(root+path.sep),'Unexpected manifest path');
  const data=await readFile(full);
  assert.equal(data.length,file.bytes,`${file.path} size`);
  assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,`${file.path} hash`);
  if(file.path.startsWith('public/')){
    const response=await fetch(origin+'/'+file.path.slice(7));
    assert.equal(response.status,200,`${file.path} HTTP`);
    assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'),file.sha256,`${file.path} served content`);
  }
}
launch();
assert.equal(await reachable(),true,'Second open did not retain the available server');
const info={testedAt:new Date().toISOString(),root,origin,filesVerified:manifest.files.length,publicAssets:manifest.files.filter(x=>x.path.startsWith('public/')).length,coldStart:true,reopen:true,installedBytes:(await Promise.all(manifest.files.map(x=>stat(path.join(root,...x.path.split('/')))))).reduce((sum,x)=>sum+x.size,0)};
await writeFile(path.join(path.dirname(root),'installed-verification.json'),JSON.stringify(info,null,2)+'\n','utf8');
console.log(JSON.stringify(info,null,2));
console.log('Server remains on 4187 for browser verification; uninstall the temporary installation afterwards.');
