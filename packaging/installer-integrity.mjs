import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Embed the manifest's expectations in Setup itself. Verification never relies
// on an installed Node/Java binary or an editable installed manifest.
export async function writeInstallerIntegrity(root,output){
 const manifestBytes=await fs.readFile(path.join(root,'文件校验清单.json'));
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('Invalid payload manifest');
 const seen=new Set(),entries=[...manifest.files,{path:'文件校验清单.json',sha256:createHash('sha256').update(manifestBytes).digest('hex')}];
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 const lines=['procedure VerifyInstalledPayload;','begin',"  IntegrityFailures := '';",'  IntegrityChecked := 0;'];
 for(const entry of entries){
  if(typeof entry.path!=='string'||!entry.path||/[\\\r\n:{}]/.test(entry.path)||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(entry.path.toLowerCase())||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Unsafe or duplicate manifest entry');
  seen.add(entry.path.toLowerCase());
  // Setup deliberately replaces only this file with its selected UI language.
  lines.push(entry.path==='desktop-language.ini'?'  CheckInstalledLanguage;':`  CheckInstalledFile(${quote(entry.path.replaceAll('/','\\'))}, ${quote(entry.sha256)});`);
 }
 lines.push('end;','');await fs.writeFile(output,'\uFEFF'+lines.join('\r\n'));
 return{files:entries.length,mutableFiles:['desktop-language.ini'],manifestSha256:createHash('sha256').update(manifestBytes).digest('hex')};
}
