# 会话质检工作台

## 0.11.9 需求五修复候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.9-full/QualityWorkbench-0.11.9-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.9-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.9-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.9-full/SHA256.txt) · [实际应用源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/db73a0b27f7f2b8eac2cc746708fb93715f6ac2b)

本版补齐辅助能力start/end整数串兼容、指定文本块内逐字唯一定位修复和原偏移留痕；多处命中与改写引文继续拒绝。额外修复电商分类恢复后旧时效判定的冻结依据冲突，原有效判定与人工记录保持不变。保留完整种子、有限重试及熔断。

本地2561通过/0失败/1既有环境跳过；实际安装后，用旧0.11.8生成的123行合成暂停任务恢复：3个失败能力各一次通过、103行继续派发，原20行判定与人工记录未改写。148项合成阿语/电商能力经包内Node→Java→本机替身通过，故意使用字符串confidence与漂移字符串偏移。无外部模型调用，真实内网批次待定点验收。本版为候选，保留原稳定入口。

安装器97717641字节；SHA256：`8529136019a64ee05455e42d7d05bd851dae01ec59f1713e8c155236f4ee1695`。7附件均无认证、无cookie完整下载并核验。

源码分支`source-v0.11.9`；构建`0.11.9-01fef74c6dfb6b8f`。含授权公开的规则与示例，不含真实会话、评价数据、工作区或密钥。

## 上一候选版0.11.8（需求五已在0.11.9补齐）

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.8-full/QualityWorkbench-0.11.8-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.8-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.8-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.8-full/SHA256.txt) · [实际应用源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/06ad23ee0a8cecfd4e6695e793be271f0e7bf361)

本版集中修复审核默认入口、初判/终判筛选与计数、暂停与重启指引、历史管理入口、首次导入关联及下载灰置说明。保留完整种子、严格证据校验、备份与审计。左下角可展开构建ID核对安装内容。

本地2555通过/0失败/1既有环境跳过；真正安装候选exe后验证新装、升级、重启、审核保存与任务生命周期。合成阿语/电商148项辅助能力经包内Node→Java→本机替身通过；未调用外部模型，不代表真实GLM准确率。本版标记为候选，保留下方上一版入口和latest指向，内网只需定点复核已列场景。

安装器97716932字节；SHA256：`6410e8293c8fb758f8fb5a9491948d9b64091ab6d9c1a8802eb7e2c29a5d58ef`。7附件均无认证、无cookie完整下载并核验。

源码分支`source-v0.11.8`；构建`0.11.8-4fde2b41538670a4`。含授权公开的规则与示例，不含真实会话、评价数据、工作区或密钥。

## 上一已发布完整安装包：0.11.7 置信度修复与任务管理

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.7-full/QualityWorkbench-0.11.7-Full-Setup-Windows-x64.exe)**

[升级及暂停续跑说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.7-full/Hotfix-Guide-zh.txt) · [发布说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.7-full) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.7-full/SHA256.txt)

新品17条规则、原文案例、两场景辅助判定与模板、14类意图及89条示例完整内置，全新空工作区自动装载。电商5项引擎内置。

本轮修复辅助能力及报告翻译confidence数值字符串兼容；非法数值仍拒绝。继续暂停任务时先补失败打标，再处理未完成行，已有规则结论与人工记录保持；重试、熔断、Unicode引文校验及内部数值校验保持。

同一文件可重复导入并标记第N次及首次任务；重复批次默认单列，标定样本排除重复。归档任务可经本机管理员确认作废；已作废任务可双确认删除，先生成完整备份，再事务清理，失败回退。任务删除审计显示备份位置；共用源文件、其他任务保留；重检/标定引用保护。历史页支持会话、规则、判定筛选。

升级前完整备份、退出程序，覆盖原安装目录并保留数据目录，打开原暂停任务点击继续。旧辅助失败的无法判定项不自动改为符合，需人工核对或独立重检。

本地2539通过/0失败/1既有环境跳过。浏览器同文件3次向导导入与完整任务生命周期通过；实际包内Node→Java→本机替身验证49条合成阿语×3能力＋1电商归类（148项），成功输出使用字符串confidence及代码围栏。0外部模型调用，不代表真实GLM准确率，内网继续验证真实批次。

安装器97710940字节；SHA256：`d247cd584937f1aae3bc1c112182dfcbffb215b6e170c7401a67d1e8834645f2`。7附件均以无认证、无cookie完整下载并核验摘要。

曾误装无种子包且目录为空：覆盖本完整包后，从质检规则提示或任务→场景管理→场景配置→从安装包装载新版，按备份与审计流程补齐；不要删除工作区。每机单独配置模型，站点标准由质检人员手工维护。

按用户明确授权公开含业务规则与示例的完整包；不含真实会话、评价批次、用户工作区或模型密钥。本仓库为程序分发仓库，发布及README提交不等于应用源码Git提交。
