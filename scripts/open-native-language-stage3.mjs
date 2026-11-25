// Interactive synthetic acceptance only. Never accepts an external data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {seedStage3Workspace,serveStage3Workspace,STAGE3_SYNTHETIC_MARKER} from '../tests/native-language-stage3-workspace.mjs';
const language=process.argv[2];if(!['zh','en'].includes(language))throw new Error('Choose zh or en.');
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dataDir=path.join(project,'acceptance-workspaces',language),port=language==='en'?4196:4197;
try{const marker=JSON.parse(await fs.readFile(path.join(dataDir,'synthetic-stage3.json'),'utf8'));if(marker.marker!==STAGE3_SYNTHETIC_MARKER||marker.language!==language)throw new Error('This folder is not a matching synthetic acceptance workspace.');}
catch(error){if(error.code!=='ENOENT')throw error;await seedStage3Workspace({dataDir,language});}
const {server,origin}=await serveStage3Workspace({dataDir,port});
console.log(`SYNTHETIC ACCEPTANCE ONLY / 仅合成验收\n${origin}\nScripted local model; no external API calls.\nCtrl+C stops this acceptance service. Production port 4186 is not used.`);
if(process.platform==='win32'){const opener=spawn('explorer.exe',[origin],{windowsHide:true,stdio:'ignore'});opener.on('error',()=>console.log(`Open ${origin} in your browser.`));opener.unref();}
let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;server.close(()=>process.exit(0));});
