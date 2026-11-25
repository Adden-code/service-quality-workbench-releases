export function desktopUsageGuide(language='zh'){
 if(language==='en')return `Desktop window and browser fallback
Open QualityWorkbench.exe for the standalone desktop window. The system tray offers Open and Stop. Closing the window when no background work is active gracefully stops the workbench service. If AI inspection, business deliverables, translation or optional structuring is active, confirm before stopping; Cancel keeps the window and work running. Check saved progress before continuing interrupted work after a restart.
The desktop window uses the system Microsoft WebView2 Runtime. If it is missing, obtain the Evergreen Standalone Installer for x64 from https://developer.microsoft.com/microsoft-edge/webview2/ and install it offline under your organization's IT policy. The main package does not include Chromium and does not automatically download or install a runtime.
For a browser fallback, use Start Quality Workbench.exe and Stop Quality Workbench.exe, or open http://127.0.0.1:4186 while the service is running. Closing a fallback browser tab does not stop the service. The desktop window initially has separate browser storage from an existing browser: the same server-side workspace and model settings are retained, but local language, layout and other preferences may need setting again. All original sources remain unchanged.

`;
 return `桌面窗口与浏览器兜底
默认打开QualityWorkbench.exe，使用独立桌面窗口；系统托盘提供“打开”和“停止”。无后台工作时，关闭窗口会优雅停止工作台服务。有AI质检、业务交付、翻译或可选结构化任务时，确认后才停机；取消则窗口与工作继续。重启后先核对已保存进度，再继续中断工作。
桌面窗口依赖系统Microsoft WebView2 Runtime。缺失时，从https://developer.microsoft.com/microsoft-edge/webview2/获取Evergreen Standalone Installer的x64离线安装程序，按本单位IT要求安装。主包不内置Chromium，不联网自动下载或安装运行时。
浏览器兜底保留“启动会话质检工作台.exe”／“停止会话质检工作台.exe”（Start Quality Workbench.exe／Stop Quality Workbench.exe）；服务运行时可直连http://127.0.0.1:4186。关闭兜底浏览器标签不会停服。桌面窗口首次使用的浏览器存储与旧浏览器独立：服务端工作区和模型设置保留，语言、布局等本地首选可能需要重新设置。所有来源原文保持不变。

`;
}

export function ecommerceCurrentPolicyGuide(language='zh'){
 if(language==='en')return `Current ecommerce policy and historical tasks
New tasks use the restored 0.11.22 policy (ec-target-calibration-v2). Positive replies must add relevant information about the specific praise or actual review, such as product explanation, usage advice, personalized handling or follow-up; even a general positive review requires relevant additional information, without inventing product facts or problems. Repeating praise with thanks and wishes, or listing generic selling points without relevant additional information, fails. For complaints or negative requests, a direct response or relevant progress, solution or steps qualifies; acknowledgement/apology plus a specific explanation, clarification or situation statement plus a usable formal channel also qualifies. Generic apology/referral without addressing the issue fails. Detailed solutions or promised deadlines are not mandatory, and channel names such as WhatsApp or a hotline are not automatic failures. High ratings with a negative request follow the negative boundary. Missing comments or replies remain Unable to determine. Business arbitration remains pending. Historical v3 tasks retain their frozen v3 boundaries; this release does not apply those boundaries to new v2 tasks.
Batch duplicate failure requires at least 3 distinct source rows from the same administrator, with every pair reaching >=85% normalized character-bigram Dice similarity. Two replies are advisory only. Do not combine different administrators, infer missing identities or extend a group through a chain of pairwise matches. A missing administrator leaves the batch subcheck incomplete; an evidenced individual semantic failure is still retained. Retain the original row and pair evidence.
New tasks using the uniform 24-hour policy (ec-first-reply-fixed24-v1) measure continuous elapsed time from the original comment to the first reply, or to the frozen inspection cutoff if unreplied. Exactly 24 hours passes; more than 24 hours fails. Nights, weekends and holidays count. This policy is independent of site, review type and classification; it has no site/type overrides. Missing, invalid, reversed or conflicting timestamps remain Unable to determine. After correcting classification, re-evaluate reply structure (EC-STEPS); retain the fixed timing (EC-TIME) verdict. In v3, changing to or from an invalid review also requires fresh EC-TARGET review, including independent duplicate evidence. Historical tasks keep their frozen policy, including old two-reply grouping, elapsed/working-hours calendars and classification dependencies where applicable. A new task or explicit reinspection is required to apply new standards.

`;
 return `当前电商口径与历史任务
新任务恢复0.11.22口径（ec-target-calibration-v2）：好评须围绕具体夸赞点或实际评价增加产品解释、使用建议、个性化处理或后续跟进等有效信息；只有笼统好评也须给出相关增量信息，不编造产品事实或问题。仅复述夸赞＋感谢＋祝福，或堆砌卖点、礼貌套话而无相关增量信息，不符合。中差评／负向诉求具体回应问题或提供对应进展、方案、步骤可通过；致歉／承认问题＋具体解释、澄清或情况说明＋可用正式渠道也可通过。泛泛道歉＋转渠道、未触及具体问题则不通过。不强制详细方案或承诺时限，不因出现WhatsApp、热线等渠道词机械判错。高评分含负向诉求适用负向边界，原评论或回复缺失仍为无法判定。最终口径仍待业务仲裁。历史v3任务保持其冻结边界，本包新v2任务不套用v3放宽口径。
批次模板化不通过须同一管理员至少3条不同源记录，且组内每对归一化字符二元组Dice相似度均≥85%。2条仅作建议；不同管理员不合并，缺管理员不猜测，不沿相似配对链条传递扩组。缺管理员时批次子项无法完成，已有证据的单条语义不通过仍保留。保留源行和成对依据。
使用统一24小时口径（ec-first-reply-fixed24-v1）的新任务：从原始评价时间算到首次回复，未回复则算到冻结的检核截止时间；按连续自然时间，恰好24小时通过、超过24小时不通过，夜间、周末和节假日均计入。该口径与站点、评价类型和分类无关，不提供站点／类型阈值覆盖；时间缺失、无效、倒序或冲突保留无法判定。纠正分类后重新核对回复结构（EC-STEPS），保留固定时效（EC-TIME）原判。v3分类改为或改出无效评价时，还须重新人工核对EC-TARGET及独立批次重复证据。历史任务依冻结版本，适用时仍保留旧两条相似、自然／工作时间日历及分类依赖；使用新标准须新建任务或显式重检。

`;
}

export function builtinUsageGuide(version,language='zh'){
 if(language==='en')return `Quality Workbench ${version} — complete two-scenario edition

Distribution follows the authorization recorded for this release. This complete edition includes approved rule text and examples. It does not include business conversations, evaluation batches or credentials.

New in 0.11.27
- The desktop window is the default entry. Startup automatically backs up and publishes newer bundled scenario versions while preserving historical tasks and local maintained settings.
- New ecommerce tasks restore the exact 0.11.22 v2 targeting policy; the other four EC criteria and uniform 24-hour policy remain unchanged. Historical tasks retain their frozen versions. Repeated source content can be imported into separate tasks; lineage is retained and cross-batch statistics separate repeat imports by default.
- Fixed menus switch immediately. AI reasons and ecommerce classification reasons use a display-only translation cache for Chinese/English. A cache miss may call the configured translation model. In English mode, the main reason area shows only English translation status until a verified English translation is available; the original AI text remains in the audit area. A cache hit switches immediately; switching language never reruns inspection or overwrites the original reason, verdict or audit history.
- Optional sampling-period/report-region labels, saved delivery concurrency and review-pane preferences remain available. Labels do not change row sites or timing calculations.

${desktopUsageGuide('en')}Clean installation
1. Install and launch QualityWorkbench.exe. An empty workspace receives 17 NP catalog rules and two published scenario configurations. No rule files or sample conversations are required.
2. In Scenarios > View configuration, inspect each frozen configuration. Daily task creation does not expose administrator capability settings. AI-assisted rule import is for new subjects in the administrator workflow.
3. NP site timing standards start empty; a quality administrator must enter thresholds and evidence. Example 3min/2 queries are not active defaults. Current EC tasks use uniform 24-hour elapsed time without site/type thresholds. Missing required NP standards or source times remain undetermined; other checks continue.
4. In Model Settings, save and test the approved intranet model connection. Select a scenario, upload a batch, verify its preview, enter a distinct batch name, and choose Chinese/English outputs. Only the selected output languages are frozen in the task.
5. Run AI inspection, review evidence and confirm decisions. Rule calibration is the default; unqualified rules remain manual. EC review classification must be checked by a human. Under fixed 24-hour timing, a classification correction requires fresh reply-structure review; v3 changes to or from invalid reviews also require fresh targeting review. Historical tasks follow their frozen dependencies.
6. Generate and download HTML and Excel. NP has five business sections and 16 child checks plus the derived overall column. EC has six sections and separate comment/reply translations. Both retain original columns and full audit appendices. Translation confidence is separate from inspection confidence.

Existing workspace upgrade
On startup, a newer built-in package is automatically published after a complete .sqwb backup, with a system-upgrade audit event and before/after versions. Local site standards, maintained settings, tasks, model settings and saved exports are retained. A failed upgrade leaves the previous workspace available and displays a recovery message. Manual loading remains available in Scenarios > Load new version from installation. Historical task snapshots remain unchanged. Review NP site standards and recalibrate applicability before new production batches. Restore through Backup and recovery with all jobs stopped.

${ecommerceCurrentPolicyGuide('en')}Important scope
- Chinese and English closing-phrase waivers default to more than 200 visible characters; spaces/punctuation count, a combined emoji counts once. Exactly 200 does not qualify. Administrators may set the two thresholds separately. Paragraph composition for positive replies is advisory under the current calibration; applicable substantive and operational structure checks remain.
- NP-R01 is derived, not a separate model judgment. NA, undetermined and not executed remain distinct.
- Product selling-point knowledge and the personal-information collection guide are not supplied. Dependent judgments stay undetermined; directly observable violations/proactive sending are still checked. Rule examples never replace product knowledge.
- Only Chinese/English are included. Real site standards, translation quality and model judgments require intranet acceptance. The checks in Acceptance Checklist.txt are steps to execute and record, not a claim that acceptance has passed.

Retain earlier installers and external data directories. Stop the workbench before moving program files.
`;
 return `会话质检工作台 ${version} · 两场景完整内置版

传播范围以本次发行记录的授权为准。本完整版包含获准的规则原文与案例，不包含真实业务会话、评价批次或凭据。

0.11.27 使用变化
• 默认从桌面窗口进入。启动时自动备份并发布内置新版，历史任务与本机维护参数保留。
• 电商新任务逐字恢复0.11.22 v2针对性口径，其他四项EC及统一24小时口径不变；历史任务保持冻结版本。同内容源文件可再次导入为独立任务，保留来源关联，跨批次统计默认将重复导入分开。
• 固定菜单即时切换；AI判断理由与电商分类理由通过只读展示译文缓存适配中英文。无缓存时可能调用已配置翻译模型；英文模式的理由主区域仅显示英文翻译状态，获得合格英文译文后再展示，原始AI文本仅在审计区保留；命中缓存即时切换。语言切换不重跑质检，不覆盖原理由、判定或审计。
• 抽检周期／报告地区选填、交付并发与审核分栏记忆继续保留；显示标签不改变源站点或计时。

${desktopUsageGuide('zh')}全新安装
1. 安装并启动QualityWorkbench.exe。空工作区自动装载17条新品目录规则、两个已发布场景配置，无需导入规则或会话示例。
2. 场景管理→查看配置：只读核对各场景。日常建任务仅显示运行参数；模型辅助规则导入属于管理员新增科目路径。
3. 新品各站点时效标准首次为空，由质检人员填写阈值与依据，3分钟/2次等示例不自动生效。当前电商新任务统一24小时连续自然时间，不配置站点／类型阈值。必要的新品标准或来源时间缺失时相关项无法判定，其余项继续检核。
4. 模型设置中保存并测试获准的内网模型。建任务选择场景→上传批次→核对预览→填写可辨识批次名→选择中文/英文输出。语种、规则和运行参数随任务冻结。
5. AI运行后对照原文复核。默认规则级标定，未达标规则转人工。电商评价归类必须人工复核；固定24小时口径下纠正分类重新核对回复结构；v3改为或改出无效评价还须重审针对性，旧任务按冻结依赖处理。
6. 生成HTML及Excel：新品五部分，16子项+1整体派生列；电商六部分，评价/回复双翻译列。保留全部源列、固定声明、完整审计附页及译文置信度。翻译置信度与检核置信度分开。

已有工作区升级
完整包启动时检测内置新版，先生成完整.sqwb备份，再发布新规则/场景版本，记录system-upgrade操作者、原因和前后版本；本机站点标准等维护参数、任务、模型设置和已存交付物保留。升级失败显示指引并保留旧工作区。场景管理的“从安装包装载新版”手动入口继续保留；历史任务冻结不变。新任务投入前核对新品站点标准，并重新验证标定适用范围。恢复须在任务停止后通过“备份与恢复”操作。

${ecommerceCurrentPolicyGuide('zh')}口径提示
• 中英文结束语豁免均默认“超过200个可见字符”。空格、标点计入，组合表情按一个字符；恰好200不豁免，管理员可分别调整。当前校准下好评段落构成仅作建议，适用的实质回应与操作步骤要求仍需检查。
• NP-R01为整体派生，不独立送模型。NA、无法判定、未执行分别展示。
• 分产品卖点合集和个人信息收集指引尚未提供：依赖知识的维度明确无法判定；显性泄露、是否主动发送卖点等直接可观察维度继续检核。案例产品参数不得替代知识库。
• 本版仅中英文。真实站点标准、译文质量和模型判断须在内网验收。“验收自检清单.txt”是待执行并记录结果的步骤，不代表已验收通过。

保留旧安装包及外置数据目录。移动程序文件前先停止工作台。
`;
}
