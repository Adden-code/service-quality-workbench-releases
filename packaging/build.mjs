import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,copyFile,cp,readFile,writeFile,readdir,stat,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareFactoryResources,parseFactoryBuildArgs} from './factory-resources.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const payloadFiles=['packaging/version.mjs','server/workspace-records.mjs','server.mjs','launch-demo.mjs','server/workspace-store.mjs','server/workspace-validation.mjs','server/ark-client.mjs','server/model-config.mjs','server/ai-service.mjs','server/rule-preparation.mjs','server/ecommerce-engine.mjs','server/ecommerce-semantic-prompt.mjs','server/ecommerce-comparison.mjs','server/ecommerce-comparison-wire.mjs','server/workflow-contract.mjs','server/workflow-traces.mjs','server/spring-ai-bridge.mjs','server/report-enrichment.mjs','server/report-job-store.mjs','server/report-jobs.mjs','server/consultation-source.mjs','server/consultation-enrichment.mjs','server/consultation-report-plan.mjs','server/scenario-fields.mjs','server/translation-jobs.mjs','server/translation-source.mjs','server/translation-job-store.mjs'];
payloadFiles.push('server/catalog-seed.mjs','server/ai-task-scheduler.mjs','server/triage-validation.mjs','server/conversation-cleaning.mjs','server/conversation-cleaning-source.mjs','server/import-drafts.mjs','server/import-mapping.mjs');
payloadFiles.push('server/raw-inspection.mjs','server/raw-source.mjs','server/raw-structure-jobs.mjs');
payloadFiles.push('server/workspace-usage.mjs','server/workspace-archive.mjs','server/workspace-restore.mjs','server/task-deletion.mjs','server/rule-calibration.mjs');
payloadFiles.push('server/workspace-transport.mjs','server/bounded-job-scheduler.mjs');
payloadFiles.push('server/builtin-scene-upgrade.mjs','server/scene-configuration-service.mjs','server/scene-package-preparation.mjs','server/scene-capabilities.mjs','server/scene-seed.mjs','server/scene-capability-schema.mjs','server/unicode-source-quote.mjs','server/diagnostics.mjs');
export const packageLimit=49_000_000;
const run=(exe,args)=>{const result=spawnSync(exe,args,{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${path.basename(exe)} failed (${result.status})`);};
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');

/** Stage the source-runtime payload separately so resource packaging needs no installer. */
export async function stagePayload({root,nodeRuntime,nodeLicense,catalogSeedFile,sceneSeedFile,sourceDir=project,sampleFile,requireFactoryMaterials=false,factoryProfile='all-scenes',materialsKind='unverified'}={}){
  for(const file of [nodeRuntime,nodeLicense])await access(file);
  const payload=path.resolve(root);await mkdir(payload,{recursive:false});
  const factory=await prepareFactoryResources({root:payload,catalogSeedFile,sceneSeedFile,sourceDir,sampleFile,requireFactoryMaterials,factoryProfile,materialsKind});
  await mkdir(path.join(payload,'runtime'),{recursive:true});
  for(const name of payloadFiles){const destination=path.join(payload,name);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(project,name),destination);}
  await cp(path.join(project,'public'),path.join(payload,'public'),{recursive:true});
  await copyFile(nodeRuntime,path.join(payload,'runtime','node.exe'));
  await copyFile(nodeLicense,path.join(payload,'runtime','NODE-LICENSE.txt'));
  await copyFile(path.join(project,'packaging','使用说明.txt'),path.join(payload,'使用说明.txt'));
  const csc=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  run(csc,['/nologo','/target:winexe','/platform:anycpu','/optimize+','/reference:System.Windows.Forms.dll',`/out:${path.join(payload,'会话质检工作台.exe')}`,path.join(project,'packaging','Launcher.cs')]);
  const files=[];
  async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const full=path.join(folder,entry.name);if(entry.isDirectory())await walk(full);else if(entry.isFile())files.push({path:path.relative(payload,full).replaceAll('\\','/'),bytes:(await stat(full)).size,sha256:await hash(full)});else throw new Error(`Non-regular payload entry: ${entry.name}`);}}
  await walk(payload);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  await writeFile(path.join(payload,'文件校验清单.json'),JSON.stringify({version:'0.2.0',runtime:'Node.js '+process.version,files},null,2)+'\n','utf8');
  return {root:payload,files,factory};
}

export async function build({output,compiler,nodeRuntime,nodeLicense,catalogSeedFile,sceneSeedFile,sourceDir=project,sampleFile,requireFactoryMaterials=false,factoryProfile='all-scenes',materialsKind='unverified'}={}){
  await access(compiler);
  const root=path.resolve(output);await mkdir(root,{recursive:false});
  const staged=await stagePayload({root:path.join(root,'payload'),nodeRuntime,nodeLicense,catalogSeedFile,sceneSeedFile,sourceDir,sampleFile,requireFactoryMaterials,factoryProfile,materialsKind}),{root:payload,files,factory}=staged;
  run(compiler,[`/DPayloadDir=${payload}`,`/DPackageOutput=${root}`,path.join(project,'packaging','setup.iss')]);
  const installer=(await readdir(root)).find(name=>name.endsWith('_安装包.exe'));
  if(!installer)throw new Error('没有生成安装包');
  const full=path.join(root,installer),bytes=(await stat(full)).size;
  const result={installer:full,bytes,MB:Number((bytes/1_000_000).toFixed(2)),MiB:Number((bytes/1_048_576).toFixed(2)),below49M:bytes<packageLimit,sha256:await hash(full),payloadBytes:files.reduce((sum,file)=>sum+file.bytes,0),files:files.length,...factory};
  await writeFile(path.join(root,'package-info.json'),JSON.stringify(result,null,2)+'\n','utf8');
  await writeFile(path.join(root,'SHA256.txt'),`${result.sha256}  ${installer}\r\n`,'utf8');
  await copyFile(path.join(project,'packaging','使用说明.txt'),path.join(root,'使用说明.txt'));
  console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const [output,compiler,nodeRuntime,nodeLicense,...resourceArgs]=process.argv.slice(2);
  if(!output||!compiler||!nodeRuntime||!nodeLicense)throw new Error('Usage: node packaging/build.mjs OUTPUT ISCC NODE_EXE NODE_LICENSE [--catalog-seed FILE] [--factory-profile new-product] [--materials-kind synthetic|unverified|approved]');
  await build({output,compiler,nodeRuntime,nodeLicense,...parseFactoryBuildArgs(resourceArgs)});
}
