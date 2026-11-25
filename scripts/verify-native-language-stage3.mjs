// Isolated synthetic acceptance. No external model or production workspace access.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.env.R39_ACCEPTANCE_OUTPUT||path.join(project,'acceptance-results'));
await fs.mkdir(out,{recursive:true});
const tests=['native-language-stage1','native-language-stage2','native-language-stage2-service','native-language-stage2-probe','native-language-stage3-analysis','native-language-stage3-delivery','native-language-stage3-ui','report-english-manager'];
const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...tests.map(name=>`tests/${name}.test.mjs`)],{cwd:project,env:{...process.env,R39_VERIFY_DIR:path.join(out,'synthetic-workspaces')},windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
await fs.writeFile(path.join(out,'acceptance-tests.tap'),stdout);await fs.writeFile(path.join(out,'acceptance-errors.log'),stderr);
const passed=Number(stdout.match(/^# pass (\d+)/m)?.[1]||0),failed=Number(stdout.match(/^# fail (\d+)/m)?.[1]||0),total=Number(stdout.match(/^# tests (\d+)/m)?.[1]||0),status=code===0&&total>=90&&failed===0?'passed':'failed';
const report={stage:3,status,total,passed,failed,exitCode:code,createdAt:new Date().toISOString(),externalModelCalls:0,syntheticModelTransport:true,data:'Synthetic only; temporary workspaces are isolated.',productionBaseline:'0.11.24',nextStage:'Stage 4 requires business acceptance; real bilingual material publication requires its existing review gate.'};
await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
await fs.writeFile(path.join(out,'acceptance-report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>R39 Stage 3 acceptance</title><style>body{font:16px/1.7 system-ui;max-width:980px;margin:48px auto;padding:24px;background:#f3f6fa;color:#182332}article{background:white;border-radius:16px;padding:32px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.status{font-size:24px;color:${status==='passed'?'#237042':'#a82232'}}</style><article><h1>需求39 第3步验收 / R39 Stage 3</h1><p class="status">${passed}/${total} passed; ${failed} failed. ${status}</p><p>仅使用合成资料和本机脚本化模型响应，不连接外部模型、不读取业务工作区。本机技术验证不等于内网业务验收。</p><p>Synthetic data and scripted local model responses only. No external model calls or production workspace access. This is technical verification, not business acceptance.</p><ol><li>第1/2.2步回归：双语门禁、语言锁、备份恢复、原生判定与探针。</li><li>审核按任务冻结语言及材料展示，错语种保留原始审计，旧任务只读冻结。</li><li>中英报告分析、HTML与Excel原生输出，阿语/西语原文在交付时自动翻译。</li><li>错语种有限重试、部分结果合并审计、重启复用、下载同一快照。</li><li>旧工作区缺失理由低优先级逐条补齐，恢复已中断任务，用户主动暂停保持。</li></ol><p>另可双击 Open-English-Synthetic.cmd 或 Open-Chinese-Synthetic.cmd 操作合成验收界面。生产继续使用0.11.24；新品材料仍待业务双语复核，EC英文材料未入包，第4步未交付。</p><details><summary>Full test log / 完整日志</summary><pre>${esc(stdout+stderr)}</pre></details></article></html>`);
console.log(`Acceptance report: ${path.join(out,'acceptance-report.html')}`);process.exitCode=status==='passed'?0:1;
