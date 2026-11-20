# 会话质检工作台

## 0.11.17 报告分析与历史交付候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.17-full/QualityWorkbench-0.11.17-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.17-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.17-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.17-full/SHA256.txt) · [源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/1f4b0808f67427d8558b509b5b545a71a724cb28)

报告评分数字字符串和NFC规范等价引文可通过校验；节点保留转换原值/新值审计。历史交付可重新载入进度、节点、缺失重试和文件；导航刷新后续看。相同冻结内容由服务端原子防重，人工改判产生新快照时才新建作业。

升级前备份停服、覆盖安装并刷新旧页面；本轮无需装载规则/场景新版。已有失败报告在历史列表载入→重试缺失项，已成功内容保持。只查看、挂载、下载不触发新的模型生成。

实际安装后180行合成批次85节点、导航/刷新/历史恢复、防重、6个缺失节点重试及HTML/Excel下载通过。无外部模型调用；内网GLM真实效果待复测。17规则与两场景种子保持0.11.16原始字节。

安装器97756808字节；SHA256：`f013aed2161534934223df50027c0c0bf494005094e16dfa4293008572f94d9f`。7附件匿名完整下载核验。源码分支`source-v0.11.17`；含已授权公开规则示例，不含客户批次或凭据。

## 0.11.16 电商报告按客服分组候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.16-full/QualityWorkbench-0.11.16-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.16-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.16-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.16-full/SHA256.txt) · [源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/af14b36acf0946f67aeb4298a3c063ea49e8f3f3)

EC概况默认按客服(管理员)，可配置客服/站点/意图/产品并随任务冻结。超过30个非空组保留会话数前30，其他合并；“未提供”始终单列。历史任务、新品场景不改分组；典型案例保留产品信息。修复报告配置单独发布后相同规则版本误挡新任务的问题。

已有工作区先备份停服并升级；随后进入场景管理→电商辅助判定与交付形式→设置报告分组，选客服、确认两Tab后发布。此次无需重新装载整套场景，原站点标准可保留。新任务生效，旧任务继续冻结维度。

实际安装后四种分组页面完整链路、旧任务冻结与NP保护通过。180行合成高分散HTML约46KB；无外部模型调用，内网真实数据效果待复测。

安装器97749955字节；SHA256：`f41b0ae460f4995f963dbcc753d654ca051a1e2b8bcfbcb1e210dc405efbddcf`。7附件匿名完整下载核验。源码分支`source-v0.11.16`；含已授权公开规则示例，不含客户批次或凭据。

## 0.11.15 人工结案与报告交付候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.15-full/QualityWorkbench-0.11.15-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.15-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.15-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.15-full/SHA256.txt) · [源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/fa13b2f7e69cfc0e3c9ed02291d6bc695eb7daf6)

AI失败行可人工复核分类并完成五项确认；能力恢复后定向重算技术依赖未知项，人工行只保留候选、逐项重新确认后清除提示。恢复业务报告横幅、编号、图表与审计页脚；完整冻结快照移至Excel审计分块，180行合成HTML约40–45KB。独立任务并行，默认2路，可选3/4路，限流自动降速。

包括0.11.14的增量同步、Worker解析、分页与体积响应头。实际安装版44MB级合成工作区40次保存约47–90ms；失败行结案、依赖人工保护、报告与Excel审计、旧工作区升级、两场景种子和本机Java替身验证通过。零外部模型调用，内网真实环境待复测。升级前备份停服，覆盖安装后刷新旧标签页，无需重新装载场景。

180行23批、每请求1秒合成计时：串行23.067秒，并发2为12.578秒，并发3为8.540秒；默认2不承诺严格减半。真实网关限流和模型时延须内网复测。

安装器97742299字节；SHA256：`63771e53f652210c6e7db560b0a31e13a596f789a2f2aa0ef55f72facc695a67`。7附件匿名完整下载核验。源码分支`source-v0.11.15`；含授权公开的规则示例，不含客户批次、用户工作区或密钥。

## 0.11.14 工作区增量同步与审核性能候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.14-full/QualityWorkbench-0.11.14-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.14-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.14-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.14-full/SHA256.txt) · [源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/562450b46d980a09edc483d7007c5de0f91d6362)

含上一版评价归类修复；工作区按记录指纹增量传输、Web Worker解析与SHA核验，保存/重启/冲突恢复统一同步。审核列表50条、执行明细25条、轨迹50节点分页及选中快照读取；同步分片512KiB，响应体积可监控。首次仍按分片构造本机状态缓存，旧接口保留兼容。

实际安装版以9任务430会话、180行审核批次验证27MB/44MB合成工作区，两组各40次保存均低于500ms；重启、丢回执、双标签冲突、分页及完整轨迹导出通过。零外部模型调用，内网真实环境待复测。升级后刷新旧标签页，无需重新装载场景。

安装器97736596字节；SHA256：`de06446baca90d5194bc0b5238ff381919c094c45f491b9cc9ca298f4310d43a`。7附件匿名完整下载核验。源码分支`source-v0.11.14`；含授权公开的规则示例，不含客户批次、用户工作区或密钥。

## 0.11.13 评价归类组合修复候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.13-full/QualityWorkbench-0.11.13-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.13-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.13-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.13-full/SHA256.txt) · [源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/0a118c92cace083ff03751a81f96b8f8cb2a6838)

高分含实质负面内容仍派生好评负向；正向与实质负面冲突组合精确归一化，无法确定时清空候选分类，修改前后值留痕并强制人工复核。升级后可直接恢复暂停队列，无需重导原文件或装载场景；原判定及冻结依据保留。

2590项回归通过、0失败、1既有环境跳过；实际安装与存量升级、180行首次运行及旧版20/180暂停恢复、浏览器人工复核与审计、包内Java链路通过。合成模型替身，零外部模型调用；真实内网效果待复测。

安装器97731386字节；SHA256：`0c1ad8ddf6e5e6382de7e396fa34741763fde8753cbca57889930f771d65dd7c`。7附件匿名完整下载核验。源码分支`source-v0.11.13`；含授权公开的规则示例，不含客户批次、用户工作区或密钥。

## 0.11.12 系统导出与审核优化候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.12-full/QualityWorkbench-0.11.12-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.12-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.12-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.12-full/SHA256.txt) · [源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/7f6f337ba65aa14401de4eafe9b42b8389476ff5)

电商23列系统导出直接导入、非标AI转换、原始列完整保留且不再映射历史人工质量答案；新品规则卡片内联改判保存，头部精简；新版整体只看Fail，无Fail的已判会话Pass并注明未知子项数。旧任务冻结不变，既有工作区需装载新版后新建或重检。

2583项测试通过、0失败、1既有环境跳过；实际安装、存量升级、两场景浏览器操作和中英文交付结构通过。本机合成模型替身，零外部模型调用；真实内网质量待验。

安装器97731562字节；SHA256：`f58c1799503f152e224cc1d9ecded6afadc72e58a835446a229e7c1d841c5c34`。7附件匿名完整下载核验。源码分支`source-v0.11.12`；含授权公开的规则示例，不含客户批次、用户工作区或密钥。

## 0.11.11 审核与引文标注候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.11-full/QualityWorkbench-0.11.11-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.11-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.11-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.11-full/SHA256.txt) · [运行源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/08fc6b00e9c1a5a4b08e7c2e9f501a27c3947813)

引文定位失败保留字段合法的AI结论与能力值，标注依据未核验，进入普通待确认；不因引文单独失败熔断。未核验及其依赖规则仍不能进入B6标定或免审。人工待办计数排除派生汇总项，支持可记忆分栏/全宽/字号；移除审核调试JSON；新增导出核验状态与逐规则审计。

2576项测试通过、0失败、1既有环境跳过；实际安装的种子、升级、浏览器人工确认、两场景双语导出、34行重复话术和123行旧暂停续跑回归通过。包内Node→Java使用本机合成HTTP替身，未调用外部模型；内网真实效果待复测。

安装器97720896字节；SHA256：`d4781afff04e900d7292318f806a2e01cea3ec329d4e063bd2a39977317ca437`。7附件匿名完整下载核验。源码分支`source-v0.11.11`；构建`0.11.11-75ddc8604b84db94`。含授权公开的规则和示例，不含真实批次、工作区或密钥。

## 0.11.10 需求六修复候选版 · 完整内置

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.10-full/QualityWorkbench-0.11.10-Full-Setup-Windows-x64.exe)**

[发布与验收说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.10-full) · [升级指引](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.10-full/Hotfix-Guide-zh.txt) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.10-full/SHA256.txt) · [实际应用源码提交](https://github.com/Adden-code/service-quality-workbench-releases/commit/2ed8ee7d0afd3553f34bb88b25368dc65b5ea508)

本版增加扩展引文的唯一性引导；重试后仍无法唯一定位则转人工，单列引文歧义、不计入技术失败率。鉴权、网络、缺字段、编造引文等仍熔断。恢复时校正旧歧义统计，保护已有人工作业和原判定。严格定位与需求五修复保留。

本地2568通过/0失败/1既有环境跳过；实际安装后验证34行合成重复话术一次跑完：6行转人工、2行扩展引文自愈；旧0.11.9暂停工作区升级继续完成，含人工备注的20条已判记录保留。需求五123行恢复与包内Node→Java原148能力回归通过，并验证歧义分流。无外部模型调用，真实内网批次待定点验收。

安装器97720726字节；SHA256：`5e8d4840e8aac342a354b0da990070bbf49bfbd70bcfc598a7d51fc19209947e`。7附件均无认证、无cookie完整下载并核验。

源码分支`source-v0.11.10`；构建`0.11.10-6f848931c68fffc6`。含授权公开的规则与示例，不含真实会话、评价数据、工作区或密钥。

## 上一候选版0.11.9（需求六已在0.11.10补齐）

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
