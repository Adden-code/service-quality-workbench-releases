// This acceptance runner uses synthetic isolated data and never calls a model.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.env.R39_ACCEPTANCE_OUTPUT||path.join(project,'acceptance-results'));
await fs.mkdir(out,{recursive:true});
const child=spawn(process.execPath,['--test','--test-reporter=tap','tests/native-language-stage1.test.mjs'],{cwd:project,env:{...process.env,R39_VERIFY_DIR:path.join(out,'synthetic-workspaces')},windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
await fs.writeFile(path.join(out,'acceptance-tests.tap'),stdout);await fs.writeFile(path.join(out,'acceptance-errors.log'),stderr);
const passed=Number(stdout.match(/^# pass (\d+)/m)?.[1]||0),failed=Number(stdout.match(/^# fail (\d+)/m)?.[1]||0),total=Number(stdout.match(/^# tests (\d+)/m)?.[1]||0),status=code===0&&total>=19&&failed===0?'passed':'failed';
const report={stage:1,status,total,passed,failed,exitCode:code,createdAt:new Date().toISOString(),modelCalls:0,data:'Synthetic only; temporary workspaces are isolated.',productionBaseline:'0.11.24',nextStage:'Requires explicit business acceptance before step 2.'};
await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>需求39 第1步验收 / R39 Stage 1 acceptance</title><style>body{font:16px/1.7 system-ui;max-width:980px;margin:48px auto;padding:24px;background:#f3f6fa;color:#182332}article{background:white;border-radius:16px;padding:32px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.status{font-size:24px;color:${status==='passed'?'#237042':'#a82232'}}</style><article><h1>需求39 第1步验收 / R39 Stage 1</h1><p class="status">${status==='passed'?'自动化检查通过 / Automated checks passed':'检查失败，请反馈日志 / Failed — share the logs'}</p><p>${passed} / ${total} passed; ${failed} failed.</p><p>仅使用合成资料，不调用模型、不读取现有业务工作区。本报告是本机程序验证，不等于业务已验收。</p><p>Synthetic data only. No model calls or production workspace access. This is technical verification, not business acceptance.</p><ol><li>双语单边修改拒绝；EC英文判据等待仲裁。</li><li>并发选择语言只有一个结果，刷新/清缓存不能改锁。</li><li>完整备份恢复语言与冻结材料；旧工作区保持兼容。</li><li>英文任务不能复用旧中文B6免审资格；80%/30对与5%抽检不变。</li></ol><p>请另运行 Start-Stage1.cmd 验证首屏与备份界面。第1步通过业务验收后才进入第2步，生产继续用0.11.24。</p><details><summary>完整检查日志 / Full test log</summary><pre>${esc(stdout+stderr)}</pre></details></article></html>`;
await fs.writeFile(path.join(out,'acceptance-report.html'),html);
console.log(`Acceptance report: ${path.join(out,'acceptance-report.html')}`);process.exitCode=status==='passed'?0:1;
