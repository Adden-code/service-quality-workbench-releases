import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createWorkbenchServer} from '../server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dataDir=path.join(root,'acceptance-workspace'),marker=path.join(dataDir,'.r39-acceptance-marker');
// Never open the portable production data directory or an environment-supplied
// DEMO_DATA_DIR. This launcher is only for the separately approved checkpoint.
await fs.mkdir(dataDir,{recursive:true});
const entries=await fs.readdir(dataDir);
if(entries.length&&!entries.includes(path.basename(marker)))throw new Error('Refusing to open an existing unmarked workspace. Use a fresh extracted acceptance package.');
await fs.writeFile(marker,'R39 stage 1 isolated acceptance workspace');
// Marker belongs outside the archived data roots, so actual state lives below it.
const server=await createWorkbenchServer({dataDir:path.join(dataDir,'data'),nativeLanguageStage:1,catalogSeed:null,sceneSeed:null,automaticBuiltinUpgrade:false,storageMode:'sharded'});
try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(15139,'127.0.0.1',resolve);});}catch(error){await server.closeWorkspace();throw error;}
const url='http://127.0.0.1:15139';console.log(`R39 Stage 1 acceptance: ${url}\nProduction remains on 0.11.24 / port 4186.\nClose this console or press Ctrl+C to stop this acceptance server.`);
if(process.platform==='win32')spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.close(()=>process.exit(0));};process.on('SIGINT',stop);process.on('SIGTERM',stop);
