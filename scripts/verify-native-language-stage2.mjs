// This acceptance runner uses synthetic isolated data and never calls a model.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.env.R39_ACCEPTANCE_OUTPUT||path.join(project,'acceptance-results'));
await fs.mkdir(out,{recursive:true});
const child=spawn(process.execPath,['--test','--test-concurrency=2','--test-reporter=tap','tests/native-language-stage1.test.mjs','tests/native-language-stage2.test.mjs','tests/native-language-stage2-service.test.mjs'],{cwd:project,env:{...process.env,R39_VERIFY_DIR:path.join(out,'synthetic-workspaces')},windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
await fs.writeFile(path.join(out,'acceptance-tests.tap'),stdout);await fs.writeFile(path.join(out,'acceptance-errors.log'),stderr);
const passed=Number(stdout.match(/^# pass (\d+)/m)?.[1]||0),failed=Number(stdout.match(/^# fail (\d+)/m)?.[1]||0),total=Number(stdout.match(/^# tests (\d+)/m)?.[1]||0),status=code===0&&total>=32&&failed===0?'passed':'failed';
const report={stage:2,status,total,passed,failed,exitCode:code,createdAt:new Date().toISOString(),externalModelCalls:0,syntheticModelTransport:true,data:'Synthetic only; temporary workspaces are isolated.',productionBaseline:'0.11.24',nextStage:'Requires business acceptance and applicable bilingual material review before step 3.'};
await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>需求39 第2步验收 / R39 Stage 2 acceptance</title><style>body{font:16px/1.7 system-ui;max-width:980px;margin:48px auto;padding:24px;background:#f3f6fa;color:#182332}article{background:white;border-radius:16px;padding:32px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.status{font-size:24px;color:${status==='passed'?'#237042':'#a82232'}}</style><article><h1>需求39 第2步验收 / R39 Stage 2</h1><p class="status">${status==='passed'?'自动化检查通过 / Automated checks passed':'检查失败，请反馈日志 / Failed — share the logs'}</p><p>${passed} / ${total} passed; ${failed} failed.</p><p>仅使用合成资料，不调用外部模型、不读取现有业务工作区。本报告是本机程序验证，不等于业务已验收。</p><p>Synthetic data only. No external model calls or production workspace access. This is technical verification, not business acceptance.</p><ol><li>第1步发布、并发初始化、语言锁、备份恢复与旧工作区兼容回归。</li><li>中英原生规则与六类新品能力请求使用冻结材料，阿语/西语原文不改写。</li><li>错语种有限重试，保留候选，语言问题不触发技术熔断、不得免审。</li><li>行级补跑前后留痕，人工并发编辑优先，换模型拒绝补跑。</li><li>落盘重开读取同一语言合同，EC原生执行仍封闭。</li></ol><p>本次新增原生规则/辅助能力、语种重试、B6排除及落盘重开验证。需内网模型核验时，按README运行显式模型探针；第2步业务验收后才进入第3步，生产继续用0.11.24。</p><details><summary>完整检查日志 / Full test log</summary><pre>${esc(stdout+stderr)}</pre></details></article></html>`;
await fs.writeFile(path.join(out,'acceptance-report.html'),html);
console.log(`Acceptance report: ${path.join(out,'acceptance-report.html')}`);process.exitCode=status==='passed'?0:1;
