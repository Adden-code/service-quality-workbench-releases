# 会话质检工作台

## 当前完整安装包：0.11.6 r1 阿语辅助打标修复版

**[免登录下载完整安装包（17条规则＋两场景）](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.6-r1-full/QualityWorkbench-0.11.6-r1-Full-Setup-Windows-x64.exe)**

[升级与暂停批次续跑说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.6-r1-full/Hotfix-Guide-zh.txt) · [发布说明](https://github.com/Adden-code/service-quality-workbench-releases/releases/tag/v0.11.6-r1-full) · [SHA256](https://github.com/Adden-code/service-quality-workbench-releases/releases/download/v0.11.6-r1-full/SHA256.txt)

包含新品17条规则、原文与案例、两场景辅助判定/交付模板、14类意图及双语示例。全新空工作区首启自动装载。电商五项引擎内置。

本轮修复辅助打标JSON代码围栏解析、必填合同和JSON对象模式透传、两次自动纠正重试；增加独立validation轨迹和失败辅助检查点续跑。阿语引文仅对可追溯的Unicode等价显示形式作保守定位，最终保存原文切片，词义差异仍交人工。原熔断保留。

升级前备份、退出工作台，覆盖原安装目录后继续原暂停任务。先补失败打标再跑未完成行；原有效规则结论与人工记录保留。旧前置失败留下的无法判定项不会自动变成符合，仍需人工核对或新建重检任务。

本地2524项通过、0失败、1既有环境跳过；实际安装后的49条合成阿语、147个辅助能力项通过，含可控缺字段/围栏故障。全程0外部模型调用，不代表真实GLM识别率。已验证新装种子、旧合成工作区保全及两场景导出结构。

安装器97705650字节。SHA256：`3d51e9345d5d061407a77ee1b6fe4bb48746610cffcff7e3e7f34a95d6749b94`。7个附件已无认证、无cookie完整下载校验。

曾误装无种子包且目录为空：覆盖本完整包后，执行任务→场景管理→新品产品咨询→辅助判定与交付形式→从安装包装载新版，填写维护人与原因并备份装载。不要删除数据目录。模型每机单独配置，站点标准手工维护。

按用户明确授权公开含规则与示例的完整包；不含真实会话、评价批次、工作区或模型密钥。本仓库为程序分发仓库，发布与README提交不等于应用源码Git提交。
