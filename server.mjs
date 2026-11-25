import {createDiagnosticBundle} from './server/diagnostics.mjs';
import {createWorkspaceTransport} from './server/workspace-transport.mjs';
import {prepareTaskDeletion,filterTaskFiles} from './server/task-deletion.mjs';
import {productVersion as PRODUCT_VERSION} from './packaging/version.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createWorkspaceStore,MAX_SOURCE_BYTES} from './server/workspace-store.mjs';
import {WorkspaceError} from './server/workspace-validation.mjs';
import {createModelConfig,MODEL_CONFIG_FIELDS,modelConfigSnapshot,modelConfigFingerprint} from './server/model-config.mjs';
import {createArkClient} from './server/ark-client.mjs';
import {createAiService} from './server/ai-service.mjs';
import {createWorkflowTraceStore} from './server/workflow-traces.mjs';
import {createSpringAiFetch} from './server/spring-ai-bridge.mjs';
import {createReportJobs} from './server/report-jobs.mjs';
import {createTranslationJobs} from './server/translation-jobs.mjs';
import {createAdminDraftStore} from './server/admin-draft-store.mjs';
import {findScenario,isSceneKey} from './public/scenarios.mjs';
import {loadBundledCatalogSeed} from './server/catalog-seed.mjs';
import {loadBundledSceneSeed} from './server/scene-seed.mjs';
import {installEcommercePolicyUpgrade} from './server/builtin-scene-upgrade.mjs';
import {upgradeBuiltinOnStartup} from './server/startup-builtin-upgrade.mjs';
import {recoverStartupCreatingFiles,auditStartupRefusal} from './server/startup-maintenance.mjs';
import {readDesktopActivity} from './server/desktop-activity.mjs';
import {createImportDraftStore} from './server/import-drafts.mjs';
import {createRawStructureJobs} from './server/raw-structure-jobs.mjs';
import {createWorkspaceUsageReader} from './server/workspace-usage.mjs';
import {createWorkspaceRestore} from './server/workspace-restore.mjs';
import {encodeWorkspaceArchive,decodeWorkspaceArchive,backupSummary,MAX_BACKUP_BYTES} from './server/workspace-archive.mjs';
import {extractSceneDocument} from './server/scene-package-preparation.mjs';
import {NP_CATEGORIES} from './public/scene-configuration.mjs';
import {dependencyStaleness} from './public/scene-dependency-staleness.mjs';

const project=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const safeHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
async function json(res,status,value){if(res.workspaceEnvelope)value=await res.workspaceEnvelope(value);let bytes=Buffer.from(JSON.stringify(value));const logicalBytes=bytes.length;if(bytes.length>1024*1024&&res.paginateLarge){value=res.paginateLarge(value);bytes=Buffer.from(JSON.stringify(value));}res.writeHead(status,{...safeHeaders,...(value?.totalBytes?{'X-Workspace-Bytes':String(value.totalBytes)}:{}),'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,'X-Response-Bytes':String(bytes.length),'X-Logical-Response-Bytes':String(logicalBytes),'X-Response-Budget':String(2*1024*1024),...(logicalBytes>=2*1024*1024?{'X-Response-Warning':bytes.length===logicalBytes?'over-2mb':'paged-over-2mb'}:{})});res.end(bytes);}
async function body(req,max){
  const declared=Number(req.headers['content-length']);if(Number.isFinite(declared)&&declared>max){req.resume();throw new WorkspaceError('请求内容超过大小限制。',413);}
  const parts=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>max)throw new WorkspaceError('请求内容超过大小限制。',413);parts.push(chunk);}
  return Buffer.concat(parts,size);
}
export async function createWorkbenchServer({dataDir=process.env.DEMO_DATA_DIR||path.join(project,'data'),publicDir=path.join(project,'public'),maxBodyBytes=32*1024*1024,fsOps,modelConfig,arkClient,catalogSeed=()=>loadBundledCatalogSeed(path.join(project,'resources')),sceneSeed=()=>loadBundledSceneSeed(path.join(project,'resources')),executionEngine=process.env.QA_AI_ENGINE||'native-node',bridgeToken=process.env.WORKBENCH_BRIDGE_TOKEN,workerPort=process.env.WORKBENCH_WORKER_PORT||4192,storageMode='single',automaticBuiltinUpgrade=true}={}){
  if(!['native-node','spring-ai'].includes(executionEngine))throw new WorkspaceError('不支持的模型执行引擎。');
  const client=arkClient||createArkClient(executionEngine==='spring-ai'?{fetchImpl:createSpringAiFetch({bridgeToken,workerPort})}:{});
  const transport=createWorkspaceTransport();
  const root=path.resolve(publicDir),resolvedData=path.resolve(dataDir);
  const guardedRoot=process.platform==='win32'?root.toLowerCase():root,guardedData=process.platform==='win32'?resolvedData.toLowerCase():resolvedData;
  if(guardedData===guardedRoot||guardedData.startsWith(guardedRoot+path.sep))throw new WorkspaceError('工作区数据目录必须位于 public 目录之外。');
  let recovery;try{recovery=await createWorkspaceRestore({dataDir:resolvedData});}catch(error){error.path??='.workspace-control.lock';throw await auditStartupRefusal(resolvedData,error);}
  let store,builtinUpgrade={status:'current'},token=randomBytes(32).toString('hex'),startupMaintenancePending=true;
  const readWorkspaceUsage=createWorkspaceUsageReader(resolvedData);
  let config,ai,traces,reportJobs,translationJobs,importDrafts,adminDrafts,rawStructureJobs,serverClosing=false,maintenance=false,unavailable=false,inflight=0,mutationEpoch=0,preview=null;const connectionTests=new Set();
  async function closeServices(){await Promise.all([ai?.close(),reportJobs?.close(),translationJobs?.close(),rawStructureJobs?.close()]);await adminDrafts?.close();await importDrafts?.close();await traces?.close();await store?.close();}
  async function openServices(){
    transport.clear();store=null;config=null;ai=null;traces=null;reportJobs=null;translationJobs=null;adminDrafts=null;importDrafts=null;rawStructureJobs=null;
    let openingPath='.workspace.lock';try{
      store=await createWorkspaceStore({dataDir:resolvedData,catalogSeed,sceneSeed,storageMode,...(fsOps?{fsOps}:{})});
      openingPath='workflow-runs/.workflow.lock';
      let startupRecovery;
      traces=await createWorkflowTraceStore({dataDir:resolvedData,...(startupMaintenancePending?{beforeLoad:async traceLock=>{startupRecovery=await recoverStartupCreatingFiles({dataDir:resolvedData,ownedLocks:[recovery.lockIdentity(),store.lockIdentity(),traceLock]});}}:{})});
      openingPath='.';
      builtinUpgrade=automaticBuiltinUpgrade?await upgradeBuiltinOnStartup({store,dataDir:resolvedData,catalogSeed,sceneSeed,productVersion:PRODUCT_VERSION,recovery:startupRecovery}):{status:'current',recovery:startupRecovery};
      importDrafts=await createImportDraftStore({dataDir:resolvedData,workspaceStore:store});config=modelConfig||await createModelConfig({dataDir:resolvedData});ai=await createAiService({store,modelConfig:config,client,traceStore:traces});reportJobs=await createReportJobs({maxAttempts:3,dataDir:resolvedData,store,modelConfig:config,client,traceStore:traces});adminDrafts=await createAdminDraftStore({dataDir:resolvedData});translationJobs=await createTranslationJobs({maxAttempts:3,dataDir:resolvedData,store,modelConfig:config,client,traceStore:traces,reportJobs,adminDrafts});rawStructureJobs=await createRawStructureJobs({dataDir:resolvedData,store,modelConfig:config,client,traceStore:traces});
    }
    catch(error){error.path??=openingPath;await closeServices();throw error;}
  }
  try{await openServices();startupMaintenancePending=false;}catch(error){await recovery.close();throw await auditStartupRefusal(resolvedData,error);}
  const backupError=(message,status,code)=>Object.assign(new WorkspaceError(message,status),{code});
  const busy=()=>connectionTests.size>0||[ai,reportJobs,translationJobs,rawStructureJobs].some(service=>service.isBusy());
  async function assertTaskNotVoided(taskId){if(!taskId)return;const task=(await store.read()).state?.tasks.find(t=>t.id===taskId);if(task?.lifecycle?.voidedAt)throw new WorkspaceError('作废任务只读，不能继续生成、翻译或重跑。',409);}
  async function assertTranslationTask(source){if(source?.taskId)await assertTaskNotVoided(source.taskId);if(source?.kind==='report')await assertTaskNotVoided((await reportJobs.get(source.jobId)).taskId);}
  let buildInfo;try{buildInfo=JSON.parse(await fs.readFile(path.join(project,'packaging/build-identity.json'),'utf8'));}catch{buildInfo={version:PRODUCT_VERSION,buildId:'development',sourceCommit:null,resourceFingerprint:null};}
  const server=http.createServer(async(req,res)=>{
    let counted=false,ownsMaintenance=false,backupRequest=false;
    try{
      const address=server.address(),expectedHost=`127.0.0.1:${address.port}`,origin=`http://${expectedHost}`;
      if(req.headers.host!==expectedHost)throw new WorkspaceError('仅允许本机同源请求。',403);
      const url=new URL(req.url,origin),pathname=decodeURIComponent(url.pathname);
      if(req.headers['x-workspace-sync']==='records-v1')res.paginateLarge=value=>transport.prepareValue(value);
      if(req.headers['x-workspace-sync']==='records-v1')res.workspaceEnvelope=async value=>{
        if(!value||!(value.patch||value.unchanged||typeof value.initialized==='boolean'))return value;
        const {state:ignoredState,catalog:ignoredCatalog,patch:ignoredPatch,baseRevision:ignoredBase,revision:ignoredRevision,initialized:ignoredInit,unchanged:ignoredUnchanged,...extra}=value;
        const current=store.transportSnapshot(),meta={...extra,token,aiRuntime:ai.runtime(),reviewCommands:true,productVersion:PRODUCT_VERSION,builtinUpgrade};
        if(!current.initialized)return{...current,...meta};
        const since=Number(req.headers['x-workspace-revision']);
        if(Number.isSafeInteger(since)&&since===current.revision&&req.headers['x-workspace-epoch']===token)return{initialized:true,revision:since,unchanged:true,...meta};
        return transport.prepare({...current,...meta});
      };

      backupRequest=pathname.startsWith('/api/workspace-backup/');
      const releasePart=pathname.match(/^\/api\/workspace\/parts\/([a-f0-9]{32})\/release$/);
      if(pathname.startsWith('/api/')){
        if(maintenance||unavailable||serverClosing)throw backupError('工作区正在维护或关闭，请稍后刷新页面。',503,'WORKSPACE_MAINTENANCE');
        if(!pathname.startsWith('/api/workspace-backup/')){inflight++;counted=true;if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!(releasePart&&req.method==='POST'))mutationEpoch++;}
      }
      const requireMutation=type=>{
        if(req.headers.origin!==origin)throw new WorkspaceError('修改操作必须来自当前页面。',403);
        const provided=req.headers['x-workspace-token'];
        if(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw new WorkspaceError('工作区令牌无效，请刷新页面。',403);
        if((req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!==type)throw new WorkspaceError(`请求类型须为 ${type}。`,415);
      };
      const parseJson=async limit=>{const bytes=await body(req,limit);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WorkspaceError('请求不是有效 JSON。');}};
      if(releasePart&&req.method==='POST'){if(req.headers.origin!==origin)throw new WorkspaceError('修改操作必须来自当前页面。',403);transport.release(releasePart[1]);res.writeHead(204,safeHeaders);res.end();return;}
      const part=pathname.match(/^\/api\/workspace\/parts\/([a-f0-9]{32})\/([a-f0-9]{64})\/(\d+)$/);
      if(part&&req.method==='GET'){const bytes=transport.page(part[1],part[2],Number(part[3]));res.writeHead(200,{...safeHeaders,'Content-Type':'application/octet-stream','Content-Length':bytes.length,'X-Response-Bytes':String(bytes.length),'X-Response-Budget':String(2*1024*1024)});res.end(bytes);return;}
      const executionPage=pathname.match(/^\/api\/tasks\/([^/]+)\/execution$/);
      if(executionPage&&req.method==='GET'){
        const snapshot=store.transportSnapshot(),task=snapshot.state?.tasks.find(t=>t.id===executionPage[1]);if(!task)throw new WorkspaceError('任务不存在。',404);
        const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||25);
        if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new WorkspaceError('执行明细分页无效。');
        const rows=task.aiQueue?.rows||[];return await json(res,200,{revision:snapshot.revision,taskId:task.id,offset,total:rows.length,rows:rows.slice(offset,offset+limit).map(row=>{const session=snapshot.state.sessions.find(s=>s.id===row.sessionId),dependency=dependencyStaleness(session,task);return{...Object.fromEntries(['id','sessionId','sourceRow','status','attempts','durationMs','error'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]])),batchIndex:task.aiQueue.batches?.find(b=>b.id===row.batchId)?.index??1,businessId:session?.externalId||row.sessionId,dependency:{stale:dependency.stale,canRetry:dependency.canRetry,protected:dependency.protected,count:dependency.ruleIds.length}};})});
      }
      if(pathname==='/api/diagnostics/export'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(1024);
        if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>k!=='includeTraces')||input.includeTraces!==undefined&&typeof input.includeTraces!=='boolean')throw new WorkspaceError('诊断导出参数无效；诊断包不允许包含业务资料。');
        const result=await createDiagnosticBundle({dataDir:resolvedData,document:store.transportSnapshot(),build:buildInfo,modelConfig:config.getPrivate(),includeTraces:input.includeTraces===true});
        res.writeHead(200,{...safeHeaders,'Content-Type':'application/zip','Content-Length':result.bytes.length,'Content-Disposition':`attachment; filename="${result.name}"`,'X-Diagnostic-Path':encodeURIComponent(result.savedPath),'X-Diagnostic-Traces-Skipped':String(result.traceFilesSkipped)});res.end(result.bytes);return;
      }
      if(pathname==='/api/build-info'&&req.method==='GET'){await json(res,200,buildInfo);return;}
      if(pathname.startsWith('/api/workspace-backup/')){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        if(!['/api/workspace-backup/export','/api/workspace-backup/preview','/api/workspace-backup/restore'].includes(pathname))throw new WorkspaceError('Resource unavailable',404);
        requireMutation(pathname.endsWith('/preview')?'application/octet-stream':'application/json');
        if(inflight||busy())throw backupError('还有任务或请求正在处理。请暂停运行中的任务，并等待在途请求结束后重试。',409,'BUSY');
        maintenance=true;ownsMaintenance=true;
        if(pathname.endsWith('/export')){
          await parseJson(1024);await store.validateIntegrity();
          const {bytes}=await encodeWorkspaceArchive(resolvedData);
          res.writeHead(200,{...safeHeaders,'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Content-Disposition':`attachment; filename="workspace-${new Date().toISOString().replace(/[:.]/g,'-')}.sqwb"`});res.end(bytes);return;
        }
        if(pathname.endsWith('/preview')){
          const decoded=decodeWorkspaceArchive(await body(req,MAX_BACKUP_BYTES));
          if(preview){await recovery.discard(preview.staged);preview=null;}
          const staged=await recovery.preflight(decoded),current=await store.read();
          preview={id:randomBytes(24).toString('hex'),staged,baseRevision:current.revision,mutationEpoch,expires:Date.now()+15*60*1000};
          await json(res,200,{previewId:preview.id,expiresAt:new Date(preview.expires).toISOString(),backup:decoded.manifest,current:backupSummary(current),baseRevision:current.revision,warnings:['恢复会停用备份中的规则免审并撤回未人工复核的免审项，防止旧标定重新生效；请重新独立验证。 / Restore disables rule exemptions and recalls unreviewed exempt checks. Fresh independent validation is required.']});return;
        }
        const input=await parseJson(2048);
        if(!preview||input.previewId!==preview.id||Date.now()>preview.expires)throw backupError('备份预检已失效，请重新选择文件并预检。',409,'PREVIEW_EXPIRED');
        const current=await store.read();
        if(input.baseRevision!==preview.baseRevision||current.revision!==preview.baseRevision||mutationEpoch!==preview.mutationEpoch)throw backupError('工作区在预检后发生了变化，请重新预检。',409,'REVISION_CONFLICT');
        const selected=preview;preview=null;
        try{
          const result=await recovery.apply({staged:selected.staged,baseRevision:current.revision,closeServices,openServices});
          token=randomBytes(32).toString('hex');server.traces=traces;
          await json(res,200,{restored:true,retainedPath:result.backupPath,summary:backupSummary(await store.read())});return;
        }catch(error){
          token=randomBytes(32).toString('hex');server.traces=traces;
          if(error.fatal)unavailable=true;
          throw backupError(error.message||'恢复未完成，旧工作区已保留。请刷新后检查。',error.fatal?503:500,'RESTORE_FAILED');
        }
      }
      if(pathname==='/api/rule-calibration'){
        if(req.method==='GET')return await json(res,200,await store.calibrationSummary());
        if(req.method!=='POST')return await json(res,405,{error:'仅支持 GET/POST。'});
        requireMutation('application/json');const input=await parseJson(128*1024);
        if(input.action==='preview')return await json(res,200,await store.calibrationPreview(input));
        return await json(res,200,{...await store.calibrate(input),token,aiRuntime:ai.runtime()});
      }
      if(pathname==='/api/review'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);requireMutation('application/json');const input=await parseJson(2*1024*1024);
        if(!Number.isSafeInteger(input.baseRevision)||typeof input.expectedAI!=='string')throw new WorkspaceError('审核请求版本无效。');
        await store.reviewCommand(input,{snapshot:false});return await json(res,200,{...await(req.headers['x-workspace-sync']==='records-v1'?{initialized:true}:store.changesSince(input.baseRevision)),token,aiRuntime:ai.runtime(),reviewCommands:true,productVersion:PRODUCT_VERSION});
      }
      if(pathname==='/api/scene-config'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(2*1024*1024);
        if(input.action==='migrate'){
          const current=await store.read();if(current.state?.sceneConfigurationMigration===1)return await json(res,200,{...current,token,aiRuntime:ai.runtime()});
          if(inflight>1||busy())throw new WorkspaceError('请暂停运行并等待在途调用结束，再迁移场景配置。',409);
          maintenance=true;ownsMaintenance=true;await store.validateIntegrity();
          const {bytes}=await encodeWorkspaceArchive(resolvedData);
          const backupPath=`${resolvedData}.scene-before-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}.sqwb`;
          await fs.writeFile(backupPath,bytes,{flag:'wx',mode:0o600});
          return await json(res,200,{...await store.migrateScenes({actor:input.actor||'本机迁移',reason:input.reason||'启用场景版本配置'}),token,aiRuntime:ai.runtime(),backupPath});
        }
        if(input.action==='install-builtin'||input.action==='install-ec-policy'){
          if(typeof input.actor!=='string'||!input.actor.trim()||typeof input.reason!=='string'||!input.reason.trim()||input.confirmed!==true)throw new WorkspaceError('请确认装载并填写维护人与原因。');
          const bundledCatalog=typeof catalogSeed==='function'?await catalogSeed():catalogSeed,bundledScenes=typeof sceneSeed==='function'?await sceneSeed():sceneSeed;
          if(!bundledCatalog||!bundledScenes)throw new WorkspaceError('本安装包未包含完整内置场景；请使用内部完整包。');
          if(inflight>1||busy())throw new WorkspaceError('请暂停任务并等待在途调用完成后装载。',409);
          const upgrade={catalogSeed:bundledCatalog,sceneSeed:bundledScenes,actor:input.actor,reason:input.reason,operationId:input.operationId,...(input.action==='install-ec-policy'?{expectedVersion:input.expectedVersion}:{})};
          maintenance=true;ownsMaintenance=true;await store.validateIntegrity();
          if(input.action==='install-ec-policy')installEcommercePolicyUpgrade(await store.read(),upgrade);
          const {bytes}=await encodeWorkspaceArchive(resolvedData),backupPath=`${resolvedData}.${input.action==='install-ec-policy'?'before-ec-policy':'before-builtin'}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}.sqwb`;await fs.writeFile(backupPath,bytes,{flag:'wx',mode:0o600});
          const upgraded=await(input.action==='install-ec-policy'?store.installEcommercePolicy(upgrade):store.installBuiltinScenes(upgrade));
          return await json(res,200,{...upgraded,token,aiRuntime:ai.runtime(),backupPath});
        }
        return await json(res,200,{...await store.configureScene(input),token,aiRuntime:ai.runtime()});
      }
      if(pathname==='/api/scene-config/prepare'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);requireMutation('application/json');const input=await parseJson(4096);
        if(input.consent!==true||typeof input.sourceSha256!=='string')throw new WorkspaceError('请确认使用当前已测试的模型起草三件套。');
        const current=await store.read(),draft=current.state?.scenePackageDrafts?.find(d=>d.id===input.draftId);
        const replay=current.state?.sceneConfigurationEvents?.find(e=>e.operationId===input.operationId);
        if(replay){const previous=replay.after?.preparation;if(replay.action!=='apply-preparation'||replay.after?.id!==input.draftId||replay.before?.revision!==input.expectedRevision||replay.actor!==input.actor||replay.reason!==input.reason||previous?.source?.source?.sha256!==input.sourceSha256||previous?.model?.modelFingerprint!==modelConfigFingerprint(input.modelConfig))throw new WorkspaceError('操作标识已用于不同的模型起草请求。',409);return await json(res,200,{...current,token,aiRuntime:ai.runtime()});}
        if(!draft||draft.revision!==input.expectedRevision||draft.status!=='draft')throw new WorkspaceError('草稿已变化，请先核对当前版本。',409);
        const privateConfig=config.getPrivate();if(!privateConfig.connectionTested)throw new WorkspaceError('请先成功测试当前模型连接。',409);
        if(modelConfigFingerprint(input.modelConfig)!==modelConfigFingerprint(privateConfig))throw new WorkspaceError('模型配置已变化，请重新核对后起草。',409);
        const source=await extractSceneDocument(await store.getSource(input.sourceSha256)),allowedRuleCategories=draft.sceneId==='新品产品咨询'?NP_CATEGORIES:draft.package.configuration.allowedRuleCategories||[...new Set(current.catalog.rules.filter(r=>r.sceneIds?.includes(draft.sceneId)).map(r=>r.category))];
        if(!allowedRuleCategories.length)throw new WorkspaceError('请先在场景规则中登记允许的类别，再起草三件套。');
        if(typeof client.prepareScenePackage!=='function')throw new WorkspaceError('模型服务未提供三件套解析能力。',503);
        const controller=new AbortController(),cancel=()=>{if(!res.writableEnded)controller.abort();};connectionTests.add(controller);res.once('close',cancel);
        try{const result=await client.prepareScenePackage({config:privateConfig,input:{...source,sceneId:draft.sceneId,allowedRuleCategories},signal:controller.signal});
          const model={modelId:result.modelId||privateConfig.model,promptVersion:result.promptVersion,modelFingerprint:modelConfigFingerprint(privateConfig)};
          return await json(res,200,{...await store.applyScenePreparation({draftId:draft.id,expectedRevision:input.expectedRevision,operationId:input.operationId,actor:input.actor,reason:input.reason},{result,document:source,model}),token,aiRuntime:ai.runtime()});
        }finally{connectionTests.delete(controller);res.off('close',cancel);}
      }
      if(pathname==='/api/rules/delete'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(128*1024);
        await json(res,200,{...await store.deleteRule(input),token,aiRuntime:ai.runtime()});return;
      }
      if(pathname==='/api/workspace-usage'){
        if(req.method!=='GET')throw new WorkspaceError('Method not allowed',405);
        if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw new WorkspaceError('工作区用量仅允许当前页面读取。',403);
        const provided=req.headers['x-workspace-token'];
        if(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw new WorkspaceError('工作区令牌无效，请刷新页面。',403);
        await json(res,200,await readWorkspaceUsage());return;
      }
      if(pathname==='/api/import-drafts'||pathname.startsWith('/api/import-drafts/')){
        const provided=req.headers['x-workspace-token'];
        if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw new WorkspaceError('导入草稿仅允许当前页面读取。',403);
        if(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw new WorkspaceError('工作区令牌无效，请刷新页面。',403);
        if(req.method==='GET'){
          if(pathname==='/api/import-drafts'){await json(res,200,{drafts:await importDrafts.list()});return;}
          const match=pathname.match(/^\/api\/import-drafts\/([^/]+)$/);if(!match)throw new WorkspaceError('导入草稿地址无效。',404);
          await json(res,200,{draft:await importDrafts.get(match[1])});return;
        }
        requireMutation('application/json');if(serverClosing)throw new WorkspaceError('服务正在关闭，请稍后恢复草稿。',503);
        const match=pathname.match(/^\/api\/import-drafts\/([^/]+)(?:\/(resume|complete|discard))?$/);if(!match)throw new WorkspaceError('导入草稿地址无效。',404);
        if(req.method===(match[2]?'POST':'PUT')){const value=await parseJson(9*1024*1024);await json(res,200,{draft:await importDrafts[match[2]||'put'](match[1],value)});return;}
        throw new WorkspaceError('Method not allowed',405);
      }
      if(pathname==='/api/translation-jobs'||pathname.startsWith('/api/translation-jobs/')){
        if(req.method==='GET'){
          if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw new WorkspaceError('翻译内容仅允许当前页面读取。',403);
          const provided=req.headers['x-workspace-token'];
          if(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw new WorkspaceError('工作区令牌无效，请刷新页面。',403);
          if(pathname==='/api/translation-jobs'){
            const raw=url.searchParams.get('source');let source;
            if(raw!==null){if(raw.length>2048)throw new WorkspaceError('翻译来源查询无效。');try{source=JSON.parse(raw);}catch{throw new WorkspaceError('翻译来源查询无效。');}}
            await json(res,200,{jobs:await translationJobs.list(source)});return;
          }
          const match=pathname.match(/^\/api\/translation-jobs\/([^/]+)(?:\/(result|nodes\/([^/]+)))?$/);
          if(!match)throw new WorkspaceError('翻译任务地址不存在。',404);
          if(match[2]==='result'){await json(res,200,await translationJobs.getResult(match[1]));return;}
          if(match[3]){await json(res,200,await translationJobs.getNode(match[1],match[3]));return;}
          await json(res,200,{job:await translationJobs.get(match[1])});return;
        }
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');if(serverClosing)throw new WorkspaceError('服务正在关闭，无法创建翻译任务。',503);
        const input=await parseJson(4096);
        if(pathname==='/api/translation-jobs'){await assertTranslationTask(input.source);await json(res,202,{job:await translationJobs.create(input)});return;}
        const match=pathname.match(/^\/api\/translation-jobs\/([^/]+)\/(pause|resume|retry)$/);
        if(!match)throw new WorkspaceError('翻译任务操作不存在。',404);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new WorkspaceError('翻译操作不接收额外参数。');
        await assertTranslationTask((await translationJobs.get(match[1])).source);await json(res,200,{job:await translationJobs[match[2]](match[1])});return;
      }
      if(pathname==='/api/raw-structure-jobs'||pathname.startsWith('/api/raw-structure-jobs/')){
        if(req.method==='GET'){
          if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw new WorkspaceError('结构化产物仅允许当前页面读取。',403);
          const provided=req.headers['x-workspace-token'];if(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw new WorkspaceError('工作区令牌无效，请刷新页面。',403);
          if(pathname==='/api/raw-structure-jobs'){await json(res,200,{jobs:await rawStructureJobs.list(url.searchParams.get('taskId')||'')});return;}
          const match=pathname.match(/^\/api\/raw-structure-jobs\/([^/]+)(?:\/(result|nodes\/([^/]+)))?$/);if(!match)throw new WorkspaceError('结构化任务地址不存在。',404);
          if(match[2]==='result'){await json(res,200,await rawStructureJobs.getResult(match[1]));return;}if(match[3]){await json(res,200,await rawStructureJobs.getNode(match[1],match[3]));return;}await json(res,200,{job:await rawStructureJobs.get(match[1])});return;
        }
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);requireMutation('application/json');if(serverClosing)throw new WorkspaceError('服务正在关闭，无法生成结构化产物。',503);const input=await parseJson(8192);
        if(pathname==='/api/raw-structure-jobs'){await assertTaskNotVoided(input.taskId);await json(res,202,{job:await rawStructureJobs.create(input)});return;}
        const match=pathname.match(/^\/api\/raw-structure-jobs\/([^/]+)\/(pause|resume|retry)$/);if(!match)throw new WorkspaceError('结构化任务操作不存在。',404);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new WorkspaceError('结构化任务操作不接收额外参数。');await assertTaskNotVoided((await rawStructureJobs.get(match[1])).taskId);await json(res,200,{job:await rawStructureJobs[match[2]](match[1])});return;
      }
      if(pathname==='/api/report-jobs'||pathname.startsWith('/api/report-jobs/')){
        if(req.method==='GET'){
          if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw new WorkspaceError('交付内容仅允许当前页面读取。',403);
          const provided=req.headers['x-workspace-token'];
          if(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw new WorkspaceError('工作区令牌无效，请刷新页面。',403);
          if(pathname==='/api/report-jobs'){await json(res,200,{jobs:await reportJobs.list(url.searchParams.get('taskId')||'')});return;}
          const match=pathname.match(/^\/api\/report-jobs\/([^/]+)(?:\/(result|nodes\/([^/]+)))?$/);
          if(!match)throw new WorkspaceError('交付任务地址不存在。',404);
          if(match[2]==='result'){await json(res,200,await reportJobs.getResult(match[1]));return;}
          if(match[3]){await json(res,200,await reportJobs.getNode(match[1],match[3]));return;}
          await json(res,200,{job:await reportJobs.get(match[1])});return;
        }
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');if(serverClosing)throw new WorkspaceError('服务正在关闭，无法生成交付物。',503);
        const input=await parseJson(4096);
        if(pathname==='/api/report-jobs'){await json(res,202,{job:await reportJobs.create(input)});return;}
        const match=pathname.match(/^\/api\/report-jobs\/([^/]+)\/(pause|resume|retry)$/);
        if(!match)throw new WorkspaceError('交付任务操作不存在。',404);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new WorkspaceError('交付操作不接收额外参数。');
        await assertTaskNotVoided((await reportJobs.get(match[1])).taskId);await json(res,200,{job:await reportJobs[match[2]](match[1])});return;
      }
      if(pathname==='/api/workflow/runs'||pathname.startsWith('/api/workflow/runs/')){
        if(req.method!=='GET')throw new WorkspaceError('Method not allowed',405);
        if(req.headers.origin!==undefined&&req.headers.origin!==origin)throw new WorkspaceError('运行记录仅允许当前页面读取。',403);
        const provided=req.headers['x-workspace-token'];
        if(typeof provided!=='string'||!/^[a-f0-9]{64}$/.test(provided)||!timingSafeEqual(Buffer.from(provided),Buffer.from(token)))throw new WorkspaceError('工作区令牌无效，请刷新页面。',403);
        if(pathname==='/api/workflow/runs'){await json(res,200,{runs:await traces.list(url.searchParams.get('taskId'),{compact:url.searchParams.get('compact')==='1'})});return;}
        const traceNode=pathname.match(/^\/api\/workflow\/runs\/([^/]+)\/nodes\/([^/]+)$/);
        if(traceNode){const node=await traces.readPage(traceNode[1],{nodeId:traceNode[2]});await json(res,200,node);return;}
        const run=url.searchParams.get('summary')==='1'?await traces.readPage(pathname.slice('/api/workflow/runs/'.length),{offset:Number(url.searchParams.get('offset')||0),limit:50}):await traces.read(pathname.slice('/api/workflow/runs/'.length));if(!run)throw new WorkspaceError('运行记录不存在。',404);await json(res,200,run);return;
      }
      if(pathname==='/api/model/config'){
        if(req.method==='GET'){await json(res,200,{...config.publicConfig(),executionEngine:client.engine||'native-node'});return;}
        if(req.method!=='PUT')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(16384);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>![...MODEL_CONFIG_FIELDS,'apiKey','clearKey'].includes(key)))throw new WorkspaceError('模型配置字段无效。');
        await json(res,200,await config.update(input));return;
      }
      if(pathname==='/api/model/test'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(1024);
        if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)throw new WorkspaceError('连接测试不接收自定义文本。');
        if(serverClosing)throw new WorkspaceError('服务正在关闭，无法启动连接测试。',503);
        const pending=config.beginConnectionTest?await config.beginConnectionTest():null,privateConfig=pending?.config||config.getPrivate();if(privateConfig.authMode!=='none'&&!privateConfig.apiKey)throw new WorkspaceError('请先保存当前模型服务的 API Key。');
        const controller=new AbortController(),cancel=()=>controller.abort();connectionTests.add(controller);res.once('close',cancel);
        try{const result=await client.test({config:privateConfig,signal:controller.signal});if(controller.signal.aborted)throw new WorkspaceError('连接测试已取消，请重新测试。',409);const tested=pending?await config.finishConnectionTest(pending.token,true):config.publicConfig();await json(res,200,{...result,config:tested});}
        catch(error){if(pending)await config.finishConnectionTest(pending.token,false);throw error;}
        finally{connectionTests.delete(controller);res.off('close',cancel);}return;
      }
      if(pathname==='/api/rules/prepare'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(700000);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['text','scene','sourceName'].includes(key))||typeof input.text!=='string'||!input.text.trim()||input.text.length>100000||!isSceneKey(input.scene)||typeof input.sourceName!=='string'||!input.sourceName.trim()||input.sourceName.length>200)throw new WorkspaceError('规则整理输入无效，请核对场景、来源名称和原文。');
        const ruleWorkspace=await store.read(),ruleScenario=findScenario(ruleWorkspace.state,input.scene,{includeDisabled:false});
        if(!ruleScenario?.enabled)throw new WorkspaceError('场景未登记或已停用，请在场景管理中核对后重新选择。');
        if(serverClosing)throw new WorkspaceError('服务正在关闭，无法开始规则整理。',503);
        const privateConfig=config.getPrivate();if(privateConfig.authMode!=='none'&&!privateConfig.apiKey)throw new WorkspaceError('请先保存当前模型服务的 API Key。');
        if(typeof client.prepareRules!=='function')throw new WorkspaceError('当前模型服务未提供规则整理能力。',503);
        const controller=new AbortController(),cancel=()=>controller.abort();connectionTests.add(controller);res.once('close',cancel);
        try{const result=await client.prepareRules({config:privateConfig,input,signal:controller.signal});if(controller.signal.aborted)throw new WorkspaceError('规则起草已取消。',409);const saved=await adminDrafts.saveRulePreparation(input,result);await json(res,200,{...result,...(saved?{preparationId:saved.id}:{})});}
        finally{connectionTests.delete(controller);res.off('close',cancel);}return;
      }
      if(pathname==='/api/imports/prepare-mapping'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);requireMutation('application/json');const value=await parseJson(700000);
        if(!value||Object.keys(value).some(k=>!['input','consent','modelConfig'].includes(k))||value.consent!==true||!value.modelConfig)throw new WorkspaceError('请确认本次原表头获准发送。');
        const privateConfig=config.getPrivate();if(!privateConfig.configured||privateConfig.connectionTested!==true)throw new WorkspaceError('请先在模型设置中成功测试当前获准接口。',409);
        let approved;try{approved=modelConfigSnapshot(value.modelConfig);}catch{throw new WorkspaceError('解析接口配置无效。');}
        if(modelConfigFingerprint(approved)!==modelConfigFingerprint(privateConfig))throw new WorkspaceError('解析接口设置已变化，请重新确认。',409);
        if(serverClosing||typeof client.prepareImportMapping!=='function')throw new WorkspaceError('当前服务无法起草字段对应。',503);
        const source=await store.getSource(value.input?.fileSha256);if(source.name!==value.input?.sourceName)throw new WorkspaceError('解析原文件与已保存原件不一致。');
        const controller=new AbortController(),cancel=()=>controller.abort();connectionTests.add(controller);res.once('close',cancel);
        try{await json(res,200,await client.prepareImportMapping({config:privateConfig,input:value.input,signal:controller.signal}));}finally{connectionTests.delete(controller);res.off('close',cancel);}return;
      }
      if(pathname==='/api/conversations/clean'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const value=await parseJson(700000);
        if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['input','consent','modelConfig'].includes(k))||value.consent!==true||!value.modelConfig||Object.keys(value.modelConfig).some(k=>!MODEL_CONFIG_FIELDS.includes(k)))throw new WorkspaceError('清洗须先确认材料获准发送至当前已测试接口。');
        const workspace=await store.read(),scene=findScenario(workspace.state,value.input?.scene,{includeDisabled:false});if(!scene?.enabled||scene.engine!=='conversation')throw new WorkspaceError('请选择已登记的会话场景。');
        const privateConfig=config.getPrivate();if(!privateConfig.configured||privateConfig.connectionTested!==true)throw new WorkspaceError('请先在模型设置中成功测试当前获准接口。',409);
        let approved;try{approved=modelConfigSnapshot(value.modelConfig);}catch{throw new WorkspaceError('清洗接口配置无效，请重新核对并确认。');}
        if(modelConfigFingerprint(approved)!==modelConfigFingerprint(privateConfig))throw new WorkspaceError('清洗知情确认的模型设置与当前配置不同，请重新核对并确认。',409);
        if(serverClosing||typeof client.prepareConversationCleaning!=='function')throw new WorkspaceError('当前服务暂不能开始会话清洗。',503);
        const controller=new AbortController(),cancel=()=>controller.abort();connectionTests.add(controller);res.once('close',cancel);
        try{await json(res,200,await client.prepareConversationCleaning({config:privateConfig,input:value.input,signal:controller.signal}));}
        finally{connectionTests.delete(controller);res.off('close',cancel);}return;
      }
      if(pathname==='/api/ai/queue/pause'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);requireMutation('application/json');await parseJson(1024);
        await json(res,200,{...await ai.pauseQueue(),token,aiRuntime:ai.runtime()});return;
      }
      if(pathname==='/api/ai/queue/resume'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);requireMutation('application/json');const input=await parseJson(1024);if(!input||Array.isArray(input)||Object.keys(input).length)throw new WorkspaceError('继续队列请求字段无效。');
        await json(res,200,{...await ai.resumeQueue(),token,aiRuntime:ai.runtime()});return;
      }
      if(pathname==='/api/tasks/delete'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(10000);
        if(!input||Object.keys(input).some(k=>!['taskId','confirmTaskId','actor','reason','administratorConfirmed'].includes(k)))throw new WorkspaceError('删除参数无效。');
        if(busy()||inflight>1)throw new WorkspaceError('请先结束运行并等待在途请求完成，再删除任务。',409);
        maintenance=true;ownsMaintenance=true;
        const current=await store.validateIntegrity();prepareTaskDeletion(current,input);
        const archive=decodeWorkspaceArchive((await encodeWorkspaceArchive(resolvedData,{appVersion:PRODUCT_VERSION})).bytes);
        const staged=await recovery.preflight({...archive,files:filterTaskFiles(archive.files,archive.document,input)});
        try{
          const result=await recovery.apply({staged,baseRevision:current.revision,closeServices,openServices,taskDeletion:input});
          server.traces=traces;await json(res,200,{...await store.read(),token,aiRuntime:ai.runtime(),backupPath:result.backupPath});return;
        }catch(error){server.traces=traces;if(error.fatal)unavailable=true;throw new WorkspaceError(error.message||'删除失败，原件与备份已保留。',error.fatal?503:500);}
      }
      if(pathname==='/api/task-lifecycle'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(20000);
        if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['taskIds','action','reason','actor','deliveryId','kind','administratorConfirmed','cancelAI'].includes(key))||!['archive','restore','void','deliverable'].includes(input.action)||!Array.isArray(input.taskIds)||!input.taskIds.length||input.taskIds.some(id=>typeof id!=='string'))throw new WorkspaceError('任务操作参数无效。');
        if(input.action!=='deliverable'&&input.taskIds.length!==1)throw new WorkspaceError('请逐个核对并操作任务。');
        if(input.cancelAI!==undefined&&(input.action!=='void'||typeof input.cancelAI!=='boolean'))throw new WorkspaceError('取消运行选项仅用于作废任务。');
        if(input.action==='void'){if(input.administratorConfirmed!==true||typeof input.actor!=='string'||!input.actor.trim())throw new WorkspaceError('请确认本机管理员操作并填写操作人。');if([reportJobs,translationJobs,rawStructureJobs].some(service=>service.isBusy()))throw new WorkspaceError('请先结束正在生成的交付或文件解析任务，再作废。',409);}
        const {taskIds,action,...options}=input;await json(res,200,{...await(action==='void'?ai.voidTask(taskIds[0],options):store.updateTaskLifecycle(taskIds,action,options)),token,aiRuntime:ai.runtime()});return;
      }
      const aiTaskRoute=pathname.match(/^\/api\/tasks\/([^/]+)\/ai(?:\/(pause|resume|cancel|retry-dependencies))?$/);
      if(pathname.startsWith('/api/ai/tasks/')||aiTaskRoute){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const input=await parseJson(1024);
        const action=aiTaskRoute?.[2],taskId=aiTaskRoute?.[1]??pathname.slice('/api/ai/tasks/'.length);
        if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!(action==='retry-dependencies'?['sessionId']:action?[]:['runId','settings']).includes(key)))throw new WorkspaceError('AI任务请求字段无效。');
        if(action==='retry-dependencies'&&(typeof input.sessionId!=='string'||!input.sessionId.trim()))throw new WorkspaceError('请选择需要重试依赖项的会话。');
        const saved=action==='retry-dependencies'?await ai.retryDependencies(taskId,input.sessionId):action?await ai[action](taskId):await ai.start(taskId,input.runId,input.settings);await json(res,action?200:202,{...saved,token,aiRuntime:ai.runtime()});return;
      }
      if(pathname==='/api/workspace'){
        if(req.method==='GET'&&req.headers['x-workspace-sync']==='records-v1'){await json(res,200,{initialized:true});return;}
        if(req.method==='GET'){const since=url.searchParams.get('since');await json(res,200,{...await(since!==null?store.changesSince(Number(since)):store.read()),token,aiRuntime:ai.runtime(),reviewCommands:true,productVersion:PRODUCT_VERSION,builtinUpgrade});return;}
        if(req.method!=='PUT')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/json');const bytes=await body(req,maxBodyBytes);let request;
        try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WorkspaceError('保存请求不是有效 JSON。');}
        await json(res,200,{...await store.save(request,{snapshot:req.headers['x-workspace-sync']!=='records-v1'}),initialized:true,token});return;
      }
      if(pathname==='/api/sources'){
        if(req.method!=='POST')throw new WorkspaceError('Method not allowed',405);
        requireMutation('application/octet-stream');let name;
        try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw new WorkspaceError('原文件名称编码无效。');}
        await json(res,201,await store.putSource(await body(req,MAX_SOURCE_BYTES),name));return;
      }
      if(pathname.startsWith('/api/sources/')){
        if(!['GET','HEAD'].includes(req.method))throw new WorkspaceError('Method not allowed',405);
        const source=await store.getSource(pathname.slice('/api/sources/'.length));
        res.writeHead(200,{...safeHeaders,'Content-Type':'application/octet-stream','Content-Length':source.bytes.length,'Content-Disposition':`attachment; filename="source"; filename*=UTF-8''${encodeURIComponent(source.name)}`});res.end(req.method==='HEAD'?undefined:source.bytes);return;
      }
      if(pathname.startsWith('/api/'))throw new WorkspaceError('Resource unavailable',404);
      if(!['GET','HEAD'].includes(req.method))throw new WorkspaceError('Method not allowed',405);
      const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!target.startsWith(root+path.sep))throw new WorkspaceError('Forbidden',403);
      const data=await fs.readFile(target);res.writeHead(200,{...safeHeaders,'Content-Type':types[path.extname(target)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){
      const status=error.status||(error.code==='ENOENT'?404:400),code=error.code||(backupRequest?(status===413?'BACKUP_TOO_LARGE':status===400?'INVALID_BACKUP':null):null);if(!res.headersSent)await json(res,status,{error:error.status?error.message:'Resource unavailable',...(code?{code}:{} )});else res.end();
    }finally{
      if(counted)inflight--;
      if(ownsMaintenance)maintenance=false;
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  server.waitForAiIdle=()=>ai.waitForIdle();
  server.waitForReportsIdle=()=>reportJobs.waitForIdle();
  server.waitForRawStructureIdle=()=>rawStructureJobs.waitForIdle();
  server.waitForTranslationsIdle=()=>translationJobs.waitForIdle();
  server.traces=traces;
  server.desktopActivity=()=>readDesktopActivity({ai,report:reportJobs,translation:translationJobs,structured:rawStructureJobs});
  const cancelTests=()=>{for(const controller of connectionTests)controller.abort();};
  server.closeWorkspace=async()=>{serverClosing=true;cancelTests();await closeServices();await recovery.close();};
  const close=server.close.bind(server);server.close=callback=>{
    serverClosing=true;
    cancelTests();
    return close(error=>{closeServices().then(()=>recovery.close()).then(()=>callback?.(error),closeError=>callback?.(closeError));});
  };
  return server;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  let server;
  try{
    const rawPort=process.env.DEMO_PORT||'4186';if(!/^[1-9]\d*$/.test(rawPort)||Number(rawPort)<1024||Number(rawPort)>65535)throw new Error('端口须为1024至65535之间的整数。');
    const port=Number(rawPort);server=await createWorkbenchServer({storageMode:'sharded'});
    server.on('error',async error=>{console.error(error.code==='EADDRINUSE'?`端口${port}已被使用，请通过DEMO_PORT选择其他端口。`:error.message);await server.closeWorkspace();process.exitCode=1;});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{process.exitCode=0;}));
    server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}\n本机保存工作区，Ctrl+C停止。`));
  }catch(error){if(server)await server.closeWorkspace();console.error(error.message);process.exitCode=1;}
}
