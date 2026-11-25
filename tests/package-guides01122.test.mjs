import test from 'node:test';
import assert from 'node:assert/strict';
import {builtinUsageGuide} from '../packaging/builtin-guide.mjs';
import {businessUsageGuide} from '../packaging/business-guide.mjs';
import {englishUsageGuide} from '../packaging/english-guide.mjs';
import {selfServiceGuide,acceptanceChecklist} from '../packaging/self-service-guide.mjs';
import {triageWorkflowGuide} from '../packaging/triage-guide.mjs';

const guides={
 zh:[builtinUsageGuide('0.11.22'),businessUsageGuide('0.11.22'),selfServiceGuide(),triageWorkflowGuide()],
 en:[builtinUsageGuide('0.11.22','en'),englishUsageGuide('0.11.22'),selfServiceGuide('en'),triageWorkflowGuide('en')]
};

test('current shipped guides distinguish calibrated administrator groups and fixed timing from historical snapshots',()=>{
 for(const text of guides.en){
  assert.match(text,/ec-target-calibration-v3/);
  assert.match(text,/Complaint criteria are unchanged from ec-target-calibration-v2 and remain pending business arbitration/);
  assert.match(text,/additional information is not mandatory in that case/);
  assert.match(text,/batch duplicate checks still run and can fail/);
  assert.match(text,/at least 3 distinct source rows from the same administrator/);
  assert.match(text,/every pair reaching >=85%/);
  assert.match(text,/Two replies are advisory/);
  assert.match(text,/Do not combine different administrators, infer missing identities/);
  assert.match(text,/specific explanation, clarification or situation statement plus a usable formal channel/);
  assert.match(text,/Detailed solutions or promised deadlines are not mandatory/);
  assert.match(text,/ec-first-reply-fixed24-v1/);
  assert.match(text,/Exactly 24 hours passes; more than 24 hours fails/);
  assert.match(text,/re-evaluate reply structure \(EC-STEPS\); retain the fixed timing \(EC-TIME\) verdict/);
  assert.match(text,/Historical tasks keep their frozen policy/);
 }
 for(const text of guides.zh){
  for(const phrase of ['ec-target-calibration-v3','仍待业务仲裁','不再强制增量信息','批次重复仍独立检查','同一管理员至少3条','组内每对','2条仅作建议','不同管理员不合并','缺管理员不猜测','不强制详细方案或承诺时限','ec-first-reply-fixed24-v1','恰好24小时通过','回复结构（EC-STEPS）','保留固定时效（EC-TIME）原判','历史任务依冻结版本'])assert.ok(text.includes(phrase),phrase);
 }
});

test('guide upgrade, repeat import and language instructions no longer contradict current behavior',()=>{
 for(const text of [...guides.en,...guides.zh]){
  assert.match(text,/system-upgrade/);
  assert.match(text,/\.sqwb/);
  assert.doesNotMatch(text,/at least two distinct batch|至少2条不同源记录|requires fresh manual TIME\/STEPS|时效和回复结构须重新人工判断|rejection is expected even after renaming|同内容文件拒绝再次导入|existing workspaces are never overwritten or topped up|已有工作区不覆盖、不补种|Changing interface language does not call a model|切换本身不调用模型/);
 }
 for(const text of guides.en){
  assert.match(text,/cross-batch statistics separate repeat imports by default/);
  assert.match(text,/cache miss may (?:call|request) the configured translation model/);
  assert.match(text,/never reruns inspection/);
  assert.match(text,/English translation status/);
  assert.match(text,/audit area/);
  assert.doesNotMatch(text,/shows (?:the |a )?labeled original|shows the original and translating/);
 }
 for(const text of guides.zh){
  assert.match(text,/跨批次统计默认将重复导入分开/);
  assert.match(text,/无缓存时可能(?:调用已配置|请求已配置)翻译模型/);
  assert.match(text,/不重跑质检/);
  assert.match(text,/英文翻译状态/);
  assert.match(text,/审计区/);
  assert.doesNotMatch(text,/明确标记原文及翻译|明确原文＋翻译/);
 }
});

test('operator guides document desktop runtime, service lifetime, browser fallback and separate local preferences',()=>{
 for(const language of ['zh','en'])for(const text of guides[language].slice(0,3)){
  for(const phrase of ['QualityWorkbench.exe','WebView2','Evergreen Standalone Installer','x64','https://developer.microsoft.com/microsoft-edge/webview2/','Chromium','http://127.0.0.1:4186','Start Quality Workbench.exe','Stop Quality Workbench.exe'])assert.ok(text.includes(phrase),phrase);
  if(language==='en'){
   assert.match(text,/Cancel keeps the window and work running/);
   assert.match(text,/does not automatically download or install a runtime/);
   assert.match(text,/separate browser storage/);
   assert.match(text,/server-side workspace and model settings are retained/);
  }else{
   assert.match(text,/取消则窗口与工作继续/);
   assert.match(text,/不联网自动下载或安装运行时/);
   assert.match(text,/浏览器存储与旧浏览器独立/);
   assert.match(text,/服务端工作区和模型设置保留/);
  }
 }
});

test('built-in acceptance checklists describe executable checks rather than claim test completion',()=>{
 for(const factoryReady of [false,true]){
  const zh=acceptanceChecklist('zh',{factoryProfile:'builtin-two-scenes',factoryReady});
  const en=acceptanceChecklist('en',{factoryProfile:'builtin-two-scenes',factoryReady});
  assert.match(zh,/本清单不代表已验收通过/);
  assert.match(en,/does not state that acceptance has passed/);
  assert.match(zh,/同一管理员至少3条/);assert.match(en,/at least 3 distinct rows from the same administrator/);
  assert.match(zh,/EC-TIME原判保留/);assert.match(en,/retains EC-TIME/);
  assert.match(zh,/同内容文件可再次导入/);assert.match(en,/Repeat-import the same content/);
  for(const text of [zh,en])for(const phrase of ['QualityWorkbench.exe','WebView2','Chromium','system-upgrade','.sqwb'])assert.ok(text.includes(phrase),phrase);
  assert.doesNotMatch(zh,/至少2条且|可按站点\/评价类型手工覆盖|时效\/回复结构须重新人工判断/);
  assert.doesNotMatch(en,/>=2 duplicates|optional site\/type overrides|never reseed existing data|resource checks passed/);
 }
});

test('English generated guidance keeps original template schema explicit and all instructions English',()=>{
 const all=[...guides.en,acceptanceChecklist('en',{factoryProfile:'builtin-two-scenes'}),acceptanceChecklist('en')];
 for(const text of all)assert.doesNotMatch(text.replace(/\[Raw template schema\][\s\S]*?\[\/Raw template schema\]/gu,''),/\p{Script=Han}/u);
 assert.match(selfServiceGuide('en'),/\[Raw template schema\][\s\S]*Headers: 会话ID, 业务场景, 会话开始时间[\s\S]*\[\/Raw template schema\]/u);
});
