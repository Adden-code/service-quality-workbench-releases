import {workspaceBackupGuide} from './workspace-backup-guide.mjs';
/** Shared delivery instructions for the R16 path; no runtime or model calls. */
export function rawDirectGuide(language='zh'){
 if(language==='en')return workspaceBackupGuide(language)+`0.11.0 prerelease - Scene configuration

Administrator path: Tasks > Scenario management > Configure. First entry creates a full workspace backup beside the data directory. Existing tasks and default legacy execution retain their original behavior. Create a draft, edit Auxiliary / Deliverables, confirm all content, then publish. Changed configurations affect only new tasks. Published scenarios pin exact rule versions; scene and draft references protect rule deletion.

New subject: register name and allowed rule categories, upload UTF-8 TXT/MD or XLSX, explicitly authorize one model drafting request, then compare the Checks / Auxiliary / Deliverables tabs against the archived source. Source quotations and block offsets must match exactly. Timing standards are always blank after AI drafting; staff maintain the site tables and their sources. Bundled rules, taxonomy examples and NA exception tables depend on the package resource manifest; site threshold values remain manually maintained.

Site means service site. Maintain first-response seconds, each query-wait seconds and repeated-query count per issue. Source site columns take precedence; AI identifies only the site, with evidence and independent confidence. Explicit batch overrides and fallbacks are audited. Missing reliable facts remain undetermined. Technical failures are separate: default rolling 50 rows, minimum 20, above 10% pauses; global authentication/executor faults pause immediately. Fix the cause before manually resuming.

The daily wizard shows frozen rules and runtime parameters only. B6 rule calibration is the default and does not stack the legacy 0.9 confidence threshold. Underqualified rules remain human-reviewed. Site and translation confidence are independent. Export languages follow the frozen task selection. Reports preserve original data and complete audit appendices even when business columns are hidden; NA, undetermined and not executed remain distinct. English business labels use the existing source-bound translation workflow; original evidence and audit records remain verbatim.

This prerelease has synthetic local validation only; use approved intranet standards and validate model behavior before replacing the pilot. Previous 0.10.8 pilot installer remains available.

0.10.8 - Raw direct inspection

0.10.8 interface and calibration risk clarification
Ecommerce criteria management is shown only in the applicable workspace/scenario. Ecommerce task creation displays its five built-in checks as a read-only list. Calibration validation errors explain the cause. PASS candidate error rate has its own denominator: human-checked AI PASS candidates. No candidates means no calculable sample; above 20% shows an advisory without changing the approved 80% agreement / 30-pair eligibility rule. The earlier 0.10.8 patch did not include scene configuration.

0.10.7 rule-level calibration and review recovery
Open Rule calibration and exemption from Overview or Inspection rules. Select separate reference and validation batches with completed AI results and current human-confirmed labels. Shared source files, repeated transcripts and reused holdouts are rejected. Preview, register, then explicitly enable qualifying rules with an operator label and reason. Each rule needs at least 30 independent decision pairs and at least 80% AI/human agreement. Shadow results cannot exempt checks. Only valid PASS checks under matching frozen rules, model and prompt version can be exempted. New tasks freeze eligible policies; old task policies remain unchanged.
New tasks sample 5% of eligible PASS checks per rule per batch, with at least 5 checked (all candidates if fewer than 5). Previously frozen tasks retain the legacy 20% policy. Error rate uses completed human checks of exemption candidates, not all rule pairs. Above 20%, that rule stops and unreviewed exempt checks are recalled; original AI decisions remain. Forbidden rules cannot enable; lifting a prohibition does not auto-enable them. Confirm mixed reviews without pretending AI-exempt checks were human reviewed. Reports preserve per-rule provenance. Overall agreement and PASS candidate errors are shown separately; estimates are not measured time savings or a statistical guarantee. Restoring a workspace disables calibration until fresh independent validation.
During review, unrelated workspace updates safely refresh/retry once. Changes to the same conversation or its frozen basis require explicit reload; Reload workspace retains current dialog input. Retired rule versions may be deleted only when no task references them (including archived/voided tasks). Enter an operator label and reason; the full snapshot remains in Rule deletion audit. Task selection hides meta rules by default; Show all lists them disabled and unchecked.

Upload the original workbook with a conversation ID, associated agent account and whole-cell message details. A recognized whole-cell source opens Raw direct inspection: check the literal row preview, declare the source time interpretation once, select the published conversation checks and enter a batch-name-date task name before creating the task. Upload and preview are local. Create only saves without inspection; Create and start AI inspection joins the existing task queue after a successful connection test. Each normal inspection request contains one original row and its selected frozen conversation checks, excluding program-handled timing items as described below. Retries, report analysis, translation and separately requested structure generation can make additional calls.

New raw tasks default to four concurrent rows; choose one to four in the visible task-creation settings. Before its first run, Task Details also lets you select concurrency. The actual queue concurrency is always shown. Running, queued and paused/resumed work keeps its frozen setting. After a failed, partially failed or cancelled run, select one to four rows before starting a new retry; successful results and human records are retained. Historical queues are not silently changed.

Task Details shows the execution stage and an estimated remaining-time range after at least three usable timings in the current run. Estimates use saved row timings, actual concurrency and scheduling segments; queue wait and pause time are excluded. Queued, paused, failed, retrying, unusually slow and whole-batch comparison stages show status without a numeric completion promise. A row-stage estimate does not include the later ecommerce duplicate comparison. Batches of 500 or more rows show a background-segmentation notice; keep ecommerce in one business task so whole-batch comparison remains valid.

The rule catalog now separates Conversation checks from Deliverable requirements. Import detects report-structure and export-format requirements; check the suggested scope and correct it in the candidate or Manage rule scope. Existing unclassified catalog records are classified during upgrade with a saved original-workspace backup. Explicit manual classifications are retained. New task selection excludes deliverable requirements; Show all displays them unchecked and disabled. They do not enter new model contracts or become check columns. Previously frozen tasks and their saved decisions are not rewritten: create a new task or use Reinspect with new rules to apply the new classification.

For this batch, reliable source timestamps are unavailable. Choose the unavailable-time declaration. Pure time-dependent checks are handled by the program as Unable to determine with reason "Reliable source timestamps were not provided." They are excluded from the model-request rule list and do not need a model answer. Extra answers for those exact IDs are ignored without quote validation; other selected rules still need complete valid answers. If every selected rule is program-handled, no model request is made. The affected frozen rule list is disclosed; the program must not infer start times from the inspection date, fabricate roles or report invented turn counts. Other checks continue independently. An associated agent account does not prove who spoke in the transcript. Explicit source-time mode is only for verifiable source times, not permission to fill missing dates.

The original cell, whitespace, line breaks and file/row provenance remain unchanged. Review original text on the left and rule judgments on the right. Fail and Unable to determine items open first. Locate quotation uses contiguous source text with only CRLF/LF line-ending equivalence; stored evidence is sliced from the unchanged original and retains original UTF16 spans. Spaces, punctuation, case and content are not normalized; repeated passages have Previous match / Next match. A changed character, translation or joined excerpt is not valid evidence. A match proves that the source text exists, not that the business judgment is correct. Human reviewers can retain or edit the four verdicts, enter a reason and add separate literal quotations or select a contiguous source passage. Human edits retain the original AI judgment. Valid AI-final PASS requires no separate confirmation of every passing rule; return a suspicious record, task or rule scope with an operator label and reason. Active review time excludes idle/background periods.

Review shortcuts: J moves to the next conversation in the currently filtered list; K moves to the previous one, without wrapping. E opens the first enabled rule editor in the current result list. Ctrl+Enter uses the current confirmation action, retaining its existing evidence checks, prompts and save behavior; Enter alone does not confirm. Shortcuts are inactive in inputs, text areas, selects, editable text, IME composition, dialogs, saves or unsaved/conflicted workspace state. They do not act from the completion summary. Open Review shortcuts for the key reference.

The configurable 0.90 model self-confidence threshold is uncalibrated and independent of the 90% rule-accuracy target against approved intranet human labels. Use the task's local golden template without changing the task, source row, conversation ID, rule ID, rule version or source hash. Labels stay local and are never sent to a model. Show all four together: rule accuracy, uncertainty rate, FAIL recall and wrong original AI-final PASS row count. Accuracy and uncertainty use the complete expected row-by-rule denominator, including missing answers and technical failures. FAIL recall is recalled human-labelled Fail checks divided by all human-labelled Fail checks; no Fail labels means not evaluated. Report golden coverage, missing labels, accepted/unanswered checks, technical-failure rows and fully labelled original AI-final PASS coverage beside the metrics. Wrong original AI-final PASS rows count once per originally exempt row containing a human-labelled Fail or Unable to determine, or a fully labelled all-Not-applicable row. Retain active human review time, model request attempts for inspection only, and return-to-review count together; unrecorded legacy request counts remain unknown rather than inferred. Incomplete labels cannot establish acceptance, and program failure placeholders cannot earn correctness merely by matching Unable to determine. Local synthetic checks do not establish real intranet model accuracy or the real 49-record acceptance.

Task Details > Reinspect with new rules reuses the verified archived source in a new task with new frozen rules; prior AI results and human records remain. Repeated imports are allowed directly and receive an import ordinal and first-task link. Reinspection remains the explicit rule-comparison workflow. Repeated batches are separate from aggregate statistics by default and excluded from calibration samples; the same file or text still cannot cross calibration groups. Excel/HTML consume original quotations directly, retain result provenance and disclose unavailable time and unverified speaker roles. Translation is an additional view and never replaces the quotation anchor. Review frozen report snapshots separately after later workspace edits.

Task list > Archive hides a task from the default list without changing results or deleting data. Use the Archived filter to view or restore it. Void accepts archived tasks even with historical confirmations and deliverables, once processing has stopped. Enter an operator label and reason and confirm local administrator operation (not a logged-in identity); the task, original file, results and audit history remain. Voided tasks are excluded from quality statistics and cannot continue inspection, human review or report export. For an unwanted paused run, wait for in-flight requests to settle, then use Cancel this run before voiding; successful results remain. Archive can be restored. Voided tasks offer Delete: confirm local administrator operation, enter a reason and retype the full task ID. A full workspace backup is written before the transactional deletion; audit shows its path. Shared source files and other tasks remain; regenerable caches are cleared. Tasks referenced by reinspection or calibration are protected. Use workspace restore to recover the complete pre-deletion state.

Task Details > Optional structured export starts a separate background job only after consent for the current tested model endpoint. It has processed/total progress, pause, continue and failed-item retry. It adds no manual per-row conversion-review UI, does not block direct inspection or reinspection, and never replaces the archived evidence or human decisions. Missing dates remain blank and unparsed text remains retained. Only a workbook that passes the full standard-template preflight is labelled a standard two-sheet workbook; otherwise download the AI-generated unverified draft with conversion notes. Format validation is not business verification. Changing model settings revokes new-job consent; restart does not authorize an automatic new model call.

Complete standard two-sheet workbooks and structured ecommerce retain their previous path. Existing legacy cleaning drafts keep the original manual mapping/sample/row review requirements and remain resumable without an automatic model call. New recognized whole-cell sources do not require cleaning or per-row conversion confirmation. To reuse an old draft's source as direct input, explicitly create a new raw task from the original; do not mutate its historical task or snapshot.

The public 0.11.0 delivery contains no catalog seed, synthetic business rules, sample workbook, business data or credentials; no sample is required to start the application. Public metadata remains catalogSeedIncluded=false and factoryReady=false. Import and publish approved intranet standards before business inspection. Separate synthetic verification artifacts are not business rules or evidence of intranet acceptance. Preserve the external data directory, model settings, archived originals and earlier installers when upgrading.

`;
 return workspaceBackupGuide(language)+`0.11.0 预发布 · 场景配置化

管理员入口：质检任务 → 场景管理 → 配置。首次进入会在数据目录旁生成完整备份；旧任务及兼容默认配置继续原执行路径。创建草稿后在辅助判定、交付形式两页核对确认，整套发布。改动仅影响新任务；发布场景冻结具体规则版本，场景和草稿引用均保护规则删除。

新增科目：登记名称和允许类别 → 上传UTF-8 TXT/MD或XLSX规则文档 → 明确同意本次模型起草 → 在检核规则、辅助判定、交付形式三页对照归档原文。引文与文本块位置必须逐字一致。AI不生成任何时效标准数值，标准表始终留空，由质检人员按站点手工填写并记录依据。不附带真实站点标准、分类双语示例或8场景例外业务原文。

站点时效维护首次响应秒数、单次查询等待秒数、同一问题重复查询次数。原表站点字段优先；AI只识别站点，附依据和独立置信度。批次覆盖、默认站点、兜底标准必须明确配置并留痕。缺少可靠事实转无法判定。技术故障单独统计：默认按能力滚动最近50条、至少20条后超过10%暂停；鉴权或执行器整体故障立即暂停，排查后人工继续。

业务员建任务只看到冻结规则和本批运行参数。默认B6规则级标定，不叠加旧0.9置信度门槛；未达标规则仍全转人工。站点识别和翻译置信度各自独立。输出语种按建任务时所选值冻结。模板主视图可隐藏列，但Excel/HTML完整附页保留原始数据与审计链；NA、无法判定、未执行独立展示。英文业务标签走现有逐字段翻译流程，证据与审计原记录逐字保留。

本包仅完成合成资料本地验证；真实站点标准和模型效果须在内网验收。0.10.8试点安装包继续保留。

0.10.8 · 原文直判

0.10.8 入口与标定风险说明
电商检核口径入口按工作区/场景显示，纯新品场景不出现空白电商弹窗；电商建任务显示内置五项只读清单与管理说明。标定回测校验错误显示具体原因。候选符合项错误率单独使用“AI判符合且已人工核验”的分母；无样本不显示0%，大于20%提示风险并建议暂缓免审，不改变已拍板的80%一致率/30对启用条件。场景配置大改不包含在本次小修安装包内。

0.10.7 规则级标定与审核恢复
从工作概览或规则目录进入“规则级标定与免审”。选择参考／调优批次和独立验证批次，要求完整AI结果和本轮人工确认；同文件、重复原文、重检副本不能跨组，已登记验证集不复用。先影子预览、登记，再填写操作标签和原因启用达标规则。每条规则须独立判定对≥30、一致率≥80%；未达标只试标定，不能免审。匹配冻结规则、模型、提示版本且证据合格的“符合”项才可免审。新任务冻结当前有效规则策略，旧任务不改写。
新任务按每规则每批候选量5%强制抽检，至少5条，不足5条全检；既有任务保留冻结的旧20%策略。免审错误率按已人工核验候选统计，与整体一致率分母不同；大于20%即停用该规则并回溯未复核免审项，保留原AI判定。可设置禁止免审，解除后不自动启用。混合会话仅补齐须人工的规则，交付明细分别保留AI免审与人工确认来源。界面同时显示候选错误、未完成抽检和预计人工量；估计不代表实测工时或统计保证。恢复备份后标定统一停用，须新独立验证。
审核遇无关工作区更新时安全刷新并重试一次；同会话或冻结依据改变时需显式重新加载，按钮保留当前弹窗输入。已停用规则版本仅在任何任务（包括归档／作废）均未引用时可删除，须填操作人标签和原因；“规则删除审计”保留完整内容快照。新任务规则选择默认隐藏meta，“显示全部”仅展示禁选、未勾选项。

上传包含会话ID、关联客服账号与整段消息详情的原表。识别到整段文本时直接进入“原文直判”：核对逐字源行预览，一次性声明来源时间口径，选择已发布的会话检核规则，填写“批次名-日期”形式的任务名称后创建任务。上传和预览仅在本机执行；“仅创建，稍后质检”不发起质检调用，“创建并开始AI质检”在连接测试成功后进入现有任务队列。常规质检一次只发送一行原文与冻结的会话检核规则，下述程序处理的纯时效项不进入模型请求；重试、报告分析、翻译和另外触发的结构化会增加独立调用。

新原文任务默认同时处理4条，创建步骤可直接选1—4条；首次运行前也可在任务详情调整。页面常驻显示队列实际并发。运行、排队、暂停继续沿用冻结设置；失败、部分失败或取消后，可为下一次新运行选择1—4并发再重试，保留已成功结果和人工记录。历史队列不会被静默改写。

任务详情显示执行阶段，本次运行至少积累3条有效耗时样本后给出预计剩余时间区间。估算采用已保存的逐行时间、实际并发与调度段，不计排队和暂停时间。排队、暂停、失败、重试、明显慢请求及整批重复比较时只说明当前状态，不承诺数值结束时间。逐条检核估算不包含后续电商整批重复比较。500条起提示后台分段处理；电商应保持在同一业务任务内，避免拆成独立任务后丢失跨行比较范围。

规则目录现分为“会话检核”和“交付物要求”。导入时识别报告结构、导出格式等特征，须核对建议作用域，可在候选或“维护规则作用域”中改标。升级会为尚未分类的存量目录补分类，并保留迁移前原工作区备份；已有人工分类保持不变。新任务默认排除交付物要求，“显示全部”仅展示未勾选、不可选择的条目。它们不进入新任务的模型合同，也不生成检核列。历史任务的冻结规则与已保存判定不改写，需新建任务或“使用新规则重检”后应用新分类。

本批没有可靠来源时间戳，应选“无可靠时间戳”。纯时间依赖检核由程序固定为无法判定（未提供可靠来源时间），从模型请求规则中剔除，不要求模型回答；模型额外输出这些精确时效ID时直接忽略，不校验其引文。其他所选规则仍须完整回答并严格核验引文。若所选全为程序处理项，则不调用模型。界面披露受影响的冻结规则；不拿质检日期代替会话时间，不补造角色或轮次，也不声称已识别多少轮。其他项独立继续。客服关联账号不能证明原文每句话的说话人。“原文有可核验时间”仅用于真实来源时间，不授权补齐缺失日期。

原始单元格、空格、换行、文件和物理行位置保持原样。人工审核左侧看原文、右侧看规则，不符合和无法判定项默认展开。“定位引文”只中和CRLF/LF换行编码差异，采纳证据仍保存未改写的原文切片和原始UTF16坐标；空格、标点、大小写和内容不归一化。重复片段可用“上一处／下一处”；改字、译文或拼接片段不能成为有效证据。命中只证明原文有这段文字，不证明业务判断正确。人工可维持或修改四值判定、填写理由，分别添加连续引文或选取左侧原文，保留AI原判。有效AI终判PASS无需逐项再确认；可按单条、任务或规则范围退回人工，并记录操作标签和原因。人工活跃审核时间不含空闲或后台运行时间。

审核快捷键：J进入当前筛选列表的下一条，K进入上一条，到边界不循环；E打开当前结果列表中首个可处理规则的编辑窗口。Ctrl+Enter复用当前确认动作，保留原有证据校验、提示和保存流程；普通Enter不会确认。输入框、文本框、下拉框、可编辑文字、输入法组字、弹窗、保存或未保存／冲突状态期间均不触发，完成汇总页不切换会话。可打开“审核快捷键”查看键位。

旧任务可配置0.90仅为未标定模型自评门槛。下述旧金标准对照工具的90%参考目标与新版规则级标定80%／30对启用条件分开，不作为新免审门槛。下载本任务金标准模板，保持任务、来源行、会话ID、规则ID、规则版本和源摘要不变；人工标签仅本机比对，不发送模型。四项必须并列：规则级正确率、无法判定率、FAIL召回率、错误免审PASS行数。正确率和无法判定率采用完整“源行×冻结规则”分母，缺失回答、程序占位和技术失败不从分母剔除。FAIL召回率=找回的人工不符合项／全部已标注人工不符合项；无不符合标签时标未评估。旁列人工标注覆盖、缺失标签、有效／未回答项、技术失败行、原始AI终判PASS的完整标注覆盖；一条原始免审行含人工不符合／无法判定，或完整金标全NA时，仅计一次错误免审PASS。并列保留人工活跃审核时长、仅质检的AI调用尝试次数与退回人工次数；旧任务未记录的调用数保持未知，不推算补造。标注不全不得宣称验收通过；程序失败占位不能仅因与“无法判定”标签相同而赚取正确数。本机合成测试不代表真实内网模型准确率，也不代表49条真实记录已验收。

任务详情“使用新规则重检”在新任务中复用校验过的归档原件，冻结新规则，保留原AI结果和人工记录；同一文件允许直接再次导入，标记第N次并关联首次任务；重检入口用于显式对照新旧规则。重复批次默认从跨批统计单列，可在管理分析选择并入或仅看重复批次。标定样本自动排除再次导入；同文件、重复原文跨组防线保持。Excel／HTML直接消费原文引文，保留结果来源、缺失时间和角色未核验说明；翻译只作辅助展示，不替换证据锚点。后续改判需重新生成匹配的报告快照。

任务列表“归档”只从默认列表隐藏任务，不改判、不删数据；可在“已归档”筛选查看并恢复。归档任务即使已有人工确认或交付物也可作废；须先结束或取消排队、运行或暂停的质检，并等待在途生成完成。须填写原因与操作人并勾选本机管理员确认（操作标签不是登录身份验证），任务、原文件、结果与审计历史均保留；作废任务不进入质量统计，也不能继续质检、人工审核或导出报告。废弃的暂停任务应等在途请求结束后，先“取消本次运行”，再作废，成功结果仍保留。归档可恢复。已作废任务可删除：填写维护人与原因，勾选管理员确认，再输入完整任务编号。删除前自动写入完整工作区备份，事务失败自动回退。任务页删除审计显示备份路径；可经工作区恢复找回删除前状态。其他任务共用源文件保留，可再生缓存清理；重检与标定仍引用的任务保护不删。

任务详情“可选结构化导出”是另行同意当前已测试接口后启动的后台任务，显示已处理／总数，可暂停、继续和重试失败项。没有人工逐行转换核对界面，不阻塞直判或新规则重检，不反向替换归档原文、证据和人工结论。缺失日期保持空，未解析原文完整保留；仅完整通过标准模板预检时称标准双表，否则明确为“AI生成未核验草稿”并提供转换说明。格式检查不代表业务事实核验。更改模型设置需重新确认新任务授权；重启不自动授权新的模型调用。

完整标准双表与结构化电商保留原路径。旧清洗草稿保持原字段／抽样／逐行确认要求，可恢复而不自动调用模型；新识别的整段原文不再要求先清洗或逐行确认转换。若复用旧草稿的原件做直判，应显式新建原文任务，不改写历史任务和冻结快照。

公开0.10.7交付不含目录种子、合成业务规则、示例文件、业务数据或凭据；启动程序不依赖示例。公开元数据保持catalogSeedIncluded=false、factoryReady=false。实际业务须在内网导入并发布获准标准，单独合成自检材料不能作为业务规则或内网验收证据。升级保留外部data目录、模型设置、归档原件与旧安装器。

`;
}
