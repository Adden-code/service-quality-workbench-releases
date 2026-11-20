export function builtinUsageGuide(version,language='zh'){
 if(language==='en')return `Quality Workbench ${version} — complete two-scenario edition

Distribution follows the authorization recorded for this release. This complete edition includes approved rule text and examples. It does not include business conversations, evaluation batches or credentials.

New in 0.11.19
- EC import can freeze an optional sampling period and report region. Manual report region overrides the banner only; row sites and timing standards do not change. Blank labels stay unknown.
- New delivery jobs default to four parallel batches. Your 2/3/4 choice is remembered in this browser. Existing jobs keep their saved concurrency; rate limits still trigger slowdown.
- EC review shows one compact status row; expand it for execution details. Drag the divider up to 85%; the width is remembered per task. Confirm-button help explains draft versus final decisions.

Clean installation
1. Install and launch Quality Workbench. An empty workspace receives 17 NP catalog rules and two published scenario configurations. No rule files or sample conversations are required.
2. In Scenarios > View configuration, inspect each frozen configuration. Daily task creation does not expose administrator capability settings. AI-assisted rule import is for new subjects in the administrator workflow.
3. NP site timing standards start empty; a quality administrator must enter thresholds and evidence. Example 3min/2 queries are not active defaults. EC uses continuous elapsed time, including nights, weekends and holidays; its bundled default is 24 hours. Confirm the applicable EC threshold before creating a batch. Missing required standards remain undetermined; other checks continue.
4. In Model Settings, save and test the approved intranet model connection. Select a scenario, upload a batch, verify its preview, enter a distinct batch name, and choose Chinese/English outputs. Only the selected output languages are frozen in the task.
5. Run AI inspection, review evidence and confirm decisions. Rule calibration is the default; unqualified rules remain manual. EC review classification must be checked by a human. Correcting it requires fresh manual TIME/STEPS decisions.
6. Generate and download HTML and Excel. NP has five business sections and 16 child checks plus the derived overall column. EC has six sections and separate comment/reply translations. Both retain original columns and full audit appendices. Translation confidence is separate from inspection confidence.

Existing workspace upgrade
Installing or restarting does not replace existing rules, tasks, model settings or exports. To adopt the new built-ins, open Scenarios > Load new version from installation, enter operator and reason, then choose Back up and load. The tool first saves a complete .sqwb backup, then publishes new rule/configuration versions. Historical task snapshots remain unchanged. Review site standards and recalibrate applicability before new production batches. Restore through Backup and recovery with all jobs stopped.

Important scope
- Chinese and English closing-phrase waivers default to more than 200 visible characters; spaces/punctuation count, a combined emoji counts once. Exactly 200 does not qualify. Administrators may set the two thresholds separately. Other structure requirements still apply.
- Duplicate replies require at least two distinct batch source rows and >=85% normalized character-bigram Dice similarity. These are deterministic pair witnesses, not model estimates or transitive groups.
- NP-R01 is derived, not a separate model judgment. NA, undetermined and not executed remain distinct.
- Product selling-point knowledge and the personal-information collection guide are not supplied. Dependent judgments stay undetermined; directly observable violations/proactive sending are still checked. Rule examples never replace product knowledge.
- Only Chinese/English are included. Real site standards and model quality require intranet acceptance. This release was checked using synthetic conversations and local fake model responses.

Retain earlier installers and external data directories. Use Stop Quality Workbench before moving program files. See Acceptance Checklist.txt for the handoff checks.
`;
 return `会话质检工作台 ${version} · 两场景完整内置版

传播范围以本次发行记录的授权为准。本完整版包含获准的规则原文与案例，不包含真实业务会话、评价批次或凭据。

0.11.19 使用变化
• 电商上传核对可选填抽检周期与报告地区，随新任务冻结。手工报告地区优先显示，但不改变逐条站点与时效；留空如实显示未提供。
• 新交付任务默认同时生成4路，2/3/4选择在本机浏览器记忆；旧任务保持原并发，接口限流仍自动降速。
• 电商审核头部默认一行摘要，点击展开查看执行记录；拖动分隔条最大85%，按任务记忆。确认按钮悬停提示草稿与最终结论的区别。

全新安装
1. 安装并启动。空工作区自动装载17条新品目录规则、两个已发布场景配置，无需导入规则或会话示例。
2. 场景管理→查看配置：只读核对各场景。日常建任务仅显示运行参数；模型辅助规则导入属于管理员新增科目路径。
3. 新品各站点时效标准首次为空，由质检人员填写阈值与依据，3分钟/2次等示例不自动生效。电商按连续自然时间计时，夜间、周末和节假日均计入，随包默认24小时；建批前确认适用阈值。缺少必要标准的相关项显示无法判定，其余项继续检核。
4. 模型设置中保存并测试获准的内网模型。建任务选择场景→上传批次→核对预览→填写可辨识批次名→选择中文/英文输出。语种、规则和运行参数随任务冻结。
5. AI运行后对照原文复核。默认规则级标定，未达标规则转人工。电商评价归类必须人工复核；纠正分类后，时效和回复结构须重新人工判断。
6. 生成HTML及Excel：新品五部分，16子项+1整体派生列；电商六部分，评价/回复双翻译列。保留全部源列、固定声明、完整审计附页及译文置信度。翻译置信度与检核置信度分开。

已有工作区升级
安装/重启不会覆盖已有规则、任务、模型设置或交付物。需采用新版内置口径时，在场景管理点击“从安装包装载新版”，填操作者和原因，选择“备份并装载内置新版”。程序先生成完整.sqwb备份，再发布新规则与场景版本；历史任务冻结不变。新任务投入前核对站点标准，并重新验证标定适用范围。恢复须在任务停止后通过“备份与恢复”操作。

口径提示
• 中英文结束语豁免均默认“超过200个可见字符”。空格、标点计入，组合表情按一个字符；恰好200不豁免。管理员可分别调整。豁免仅针对结束语，不豁免其他结构要求。
• 模板化重复按批次中至少2条不同源记录、归一化字符二元组Dice相似度≥85%计算，保存成对依据，不传递扩展为相似组。
• NP-R01为整体派生，不独立送模型。NA、无法判定、未执行分别展示。
• 分产品卖点合集和个人信息收集指引尚未提供：依赖知识的维度明确无法判定；显性泄露、是否主动发送卖点等直接可观察维度继续检核。案例产品参数不得替代知识库。
• 本版仅中英文。自测使用合成会话与本地模型替身；真实站点标准和模型效果由内网验收。

保留旧安装包及外置数据目录。移动程序文件前先停止工作台。逐项交付检查见“验收自检清单.txt”。
`;
}
