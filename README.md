# 会话质检工作台

当前版本：**0.11.4**

[免登录下载 Windows 完整安装包](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.4/QualityWorkbench-0.11.4-Windows-x64.exe) · [本版发布说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.4) · [SHA256 校验](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.4/SHA256.txt)

本版改进人工审核保存性能：单会话命令、任务/会话分片持久化、工作区增量同步、审核节点复用及规则证据按需展开。质检规则页顶部可直达既有的安装包规则装载流程。

本机合成34条长原文、17条规则、约5.1 MB工作区，连续保存并下一条由约1.2–1.4秒降至约90毫秒。2515测试通过、0失败、1条件跳过；实际安装、重启、旧工作区升级、备份恢复及中英报告/明细结构通过。真实内网性能与模型语义仍由业务验收。

升级前请完整备份。已装载完整NP-R13 V1.1的工作区无需重复装载规则；旧任务依据保持冻结，用新规则重检。0.11.4启用分片存储，请勿直接用旧程序读取新版目录；回退使用升级前备份。

按已确认授权公开规则与示例完整版。安装包不含真实会话、评价批次、模型密钥或工作区。本仓库首页提交属于分发说明，安装包发行不等于应用源码Git提交。

## 之前的发布说明（历史）

# service-quality-workbench-releases

会话质检工作台 Windows 安装包下载。

## 最新版：0.11.3

[免登录下载 Windows x64 完整安装包](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.3/QualityWorkbench-0.11.3-Windows-x64.exe)

[版本说明与全部附件](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.3) · [SHA256 校验清单](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.3/SHA256.txt) · [发布范围说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.3/Release-Scope.txt)

本完整版包含获准公开的两场景规则、案例和分类示例，不含真实业务会话、评价批次或模型凭据。

本次更新：核对探需八场景例外，补齐挽留与导购范围、完整政策原文索引和旧口径提示；归档/作废移出审核队列并禁止写入，启动恢复跳过历史任务；审核需处理项置顶；保留翻译与优秀案例的有效部分并补跑缺失项；下载按钮旁增加生成前置提示。

**已有工作区升级：先备份 → 场景管理 → 配置 → 从安装包装载新版 → 新建任务或重检。** 安装器保留原数据，旧任务冻结依据不会自动改写。0.11.2发行种子中的探需八场景已完整，工作区中的通用短句需通过装载新版更新。

验证：2509项测试，2508通过、0失败、1项环境条件跳过；浏览器8条路径、实际安装/重启/旧工作区升级，以及中英双场景HTML/Excel导出通过。测试使用合成会话和本地模型响应，真实内网模型效果仍需复测。

安装包大小：97,703,407 字节。SHA256：

`60b2a837459397cf8bb624695eb1c700be6c51112f1f9f05cdfcb0335e69ddc6`

此仓库用于安装包分发，发行包与首页说明提交不等于提交应用源码。
