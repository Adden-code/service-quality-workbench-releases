import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

test('packaged launcher validates isolated test port without changing the default origin',async()=>{
  const module=await import('../launch-demo.mjs');
  assert.equal(typeof module.configuredPort,'function','缺少可隔离验收端口的启动配置');
  assert.equal(module.configuredPort({}),4186);
  assert.equal(module.configuredPort({DEMO_PORT:'4190'}),4190);
  for(const value of ['0','80','65536','4190/path','04190','NaN','-1'])assert.throws(()=>module.configuredPort({DEMO_PORT:value}),/端口/);
});

test('installer is per-user offline and only includes explicitly staged files',async()=>{
  const source=new URL('../packaging/setup.iss',import.meta.url);
  await assert.doesNotReject(access(source),'缺少 Windows 安装脚本');
  const text=await readFile(source,'utf8');
  assert.match(text,/PrivilegesRequired=lowest/);
  assert.match(text,/MinVersion=10\.0/);
  assert.match(text,/ArchitecturesAllowed=x64compatible/);
  assert.match(text,/SolidCompression=yes/);
  assert.match(text,/Source:.*PayloadDir/);
  assert.doesNotMatch(text,/https?:\/\/|download|powershell|ExecutionPolicy/i);
  assert.match(text,/--stop/);
});

test('native launcher uses bundled runtime and scopes stopping by full executable path',async()=>{
  const source=new URL('../packaging/Launcher.cs',import.meta.url);
  await assert.doesNotReject(access(source),'缺少相对路径的原生启动器');
  const text=await readFile(source,'utf8');
  assert.match(text,/AppDomain\.CurrentDomain\.BaseDirectory/);
  assert.match(text,/"runtime", "node\.exe"/);
  assert.match(text,/MainModule\.FileName/);
  assert.match(text,/StringComparison\.OrdinalIgnoreCase/);
  assert.doesNotMatch(text,/D:\\NodeJs|taskkill|ExecutionPolicy/);
});

test('build allowlist excludes developer dependencies and sensitive files',async()=>{
  const moduleUrl=new URL('../packaging/build.mjs',import.meta.url);
  await assert.doesNotReject(access(moduleUrl),'缺少可重复打包脚本');
  const {payloadFiles,packageLimit}=await import(moduleUrl);
  assert.equal(packageLimit,49_000_000);
  assert.deepEqual(payloadFiles,['packaging/version.mjs','server/workspace-records.mjs','server.mjs','launch-demo.mjs','server/workspace-store.mjs','server/workspace-validation.mjs','server/ark-client.mjs','server/model-config.mjs','server/ai-service.mjs','server/rule-preparation.mjs','server/ecommerce-engine.mjs','server/ecommerce-semantic-prompt.mjs','server/ecommerce-comparison.mjs','server/ecommerce-comparison-wire.mjs','server/workflow-contract.mjs','server/workflow-traces.mjs','server/spring-ai-bridge.mjs','server/report-enrichment.mjs','server/report-job-store.mjs','server/report-jobs.mjs','server/consultation-source.mjs','server/consultation-enrichment.mjs','server/consultation-report-plan.mjs','server/scenario-fields.mjs','server/translation-jobs.mjs','server/translation-source.mjs','server/translation-job-store.mjs','server/admin-draft-store.mjs','server/catalog-seed.mjs','server/ai-task-scheduler.mjs','server/triage-validation.mjs','server/conversation-cleaning.mjs','server/conversation-cleaning-source.mjs','server/import-drafts.mjs','server/import-mapping.mjs','server/raw-inspection.mjs','server/raw-source.mjs','server/raw-structure-jobs.mjs','server/workspace-usage.mjs','server/workspace-archive.mjs','server/workspace-restore.mjs','server/task-deletion.mjs','server/rule-calibration.mjs','server/workspace-transport.mjs','server/bounded-job-scheduler.mjs','server/startup-builtin-upgrade.mjs','server/delivery-progress.mjs','server/desktop-activity.mjs','server/builtin-scene-upgrade.mjs','server/scene-configuration-service.mjs','server/scene-package-preparation.mjs','server/scene-capabilities.mjs','server/scene-seed.mjs','server/scene-capability-schema.mjs','server/unicode-source-quote.mjs','server/diagnostics.mjs']);
  assert.ok(!payloadFiles.some(path=>/node_modules|tests|\.env|docs|secrets|^data\//.test(path)));
  const buildSource=await readFile(moduleUrl,'utf8');
  assert.match(buildSource,/mkdir\(path\.dirname\(destination\),\{recursive:true\}\)/,'嵌套服务模块需要先创建目标目录');
});

test('native launcher never waits for inherited background-server pipe EOF',async()=>{
  const text=await readFile(new URL('../packaging/Launcher.cs',import.meta.url),'utf8');
  assert.doesNotMatch(text,/ReadToEnd/,'后台服务继承句柄时不能等待管道结束');
  assert.match(text,/WaitForExit\(15000\)/,'启动子进程必须有明确超时');
});
