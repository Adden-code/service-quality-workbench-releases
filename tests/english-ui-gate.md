# 英文界面发布门禁（37C）

执行顺序：

```powershell
node scripts/check-english-ui.mjs
node --test tests/english-ui-gate.test.mjs
node tests/english-ui-release-gate.mjs
node tests/ui-i18n01124-browser.mjs
```

主证据目录为 `../outputs/service01124-20261125/english-gate`。`verification.json` 只有所有必需入口、DOM 扫描和完整应用检查通过后才写入 `passed`；每次启动先改写成 `running`，失败或中断不会沿用旧绿灯。构建校验产品版本、必需清单、零遗漏/零页面错误以及源码指纹。指纹覆盖整个 public 目录中的 MJS/HTML/CSS，以及门禁脚本和覆盖清单；任一变更都要求重新运行浏览器门禁。

`english-ui-coverage.mjs` 是持久化必需清单。当前包含 44 个入口/状态，实际渲染 52 个生产视图/弹窗，另有 13 个完整应用导航/失败/重试状态。覆盖概览、任务、详情与执行分页、失败人工审核和退回、规则详情、配置三页与候选草稿、政策列表及四个标准条款标题、详情/管理/业务导出和历史记录/节点原文、英文翻译、模型、备份恢复、四步向导、导入草稿，以及启动恢复、升级失败和保留警告。分页夹具有 76 条审核记录（生产页大小 50）、26 条执行记录（页大小 25）、101 个执行节点；断言分页控件、实际行数、政策条款数和向导规则数量均存在，不能用空页代替覆盖。

扫描检查真实 Chromium 可见 DOM，包括下拉选项、文本、输入框值、textarea、aria-label、title、placeholder、alt 和 aria-description。所有 details 展开再扫描。仅显式 `data-business-original` 元素自身原文，以及精确路径的报告源配置值、原始 AI 候选值可以保留中文；标签和属性始终扫描。没有按 textarea/pre 元素或含 Original 文案整片豁免。运行时先故意注入分页、错误、pre、textarea、占位符、标题、无障碍标签、输入值、带 Original 的正文和原文元素的属性共 10 类遗漏，断言全部被拦截，同时证明显式原文值保留。

静态扫描用现有 Playwright 附带的 Babel 解析器，检查 public MJS 中的 html 标签模板、显式翻译调用、未包裹的界面 HTML 和直接 DOM 写入；还检查 HTML 启动入口及 meta 文案。中文源字典、规范枚举和模型提示不是界面漏译。显式中文分支及仅从该分支调用的私有函数按 AST 结构识别，不使用历史哈希/大段源码基线放行。五个下载文档序列化模块（business-report、consultation-report、management-report、io、ecommerce-results）的原始 HTML 有独立报告语言约定，不按屏幕语言拦截；其中显式 i18n 调用仍扫描。

这是合成数据与本机 mock API 验证，模型调用为 0，不读取或写入真实业务库、种子或标定文件。静态扫描不是完整 JS 数据流证明；动态组合和业务数据要靠真实 DOM、状态夹具和专项测试共同覆盖。下载文件的语言质量、真实模型翻译质量、内网兼容性及最终业务验收不由本门禁证明。
