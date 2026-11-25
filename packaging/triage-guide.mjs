import {rawDirectGuide} from './raw-direct-guide.mjs';
import {ecommerceCurrentPolicyGuide} from './builtin-guide.mjs';
export function triageWorkflowGuide(language='zh'){
 if(language==='en')return rawDirectGuide('en')+`Structured import, legacy workflow and result sources

Unified import and AI-assisted conversion
Both scenes use the same task-name / editable local-operator labels, file upload and local preflight. The task name starts empty with a batch-name-date prompt to avoid repeated default names; fill it before continuing. Upload does not call a model. A complete standard workbook goes directly to sample confirmation and rule selection; AI conversion is optional when preflight finds missing fields or structure. Editing task labels preserves the file and preflight. Changing the file or scene requires confirmation and saves the previous import as a draft. Templates and manual field mapping remain under Templates and manual options.
For Ecommerce, AI proposes column mappings using only the original headers, without business rows or historical answers. Check 22 distinct core fields and the sample preview independently, then confirm and rerun the same preflight on the unchanged source. Extra columns remain traceable. Only existing legacy cleaning drafts retain AI-drafted roles, timestamps and turn text followed by field/sample review and explicit handling of every unresolved row. Recognized whole-cell consultation sources now use Raw direct inspection above. No missing date, role or original text is silently invented. The legacy Use First Message Time action deliberately adopts a verifiable source timestamp; it does not assert that the first message is the true conversation start.
Configure and successfully test the approved model and acknowledge the current endpoint before each new drafting session. Transcript conversion sends each original conversation separately and may include personal data; use an approved endpoint. Changing settings or restoring a draft revokes model-call consent. Confirmed conversion still passes the original standard two-sheet preflight. The cleaning audit records original spans, counts, manual edits, exclusions and both confirmation steps.

Save and resume an entire import
Import drafts save the original file, mapping, preflight and confirmed conversion progress in the local workspace. Use Save draft and close, then Import drafts to continue after restarting the page or application. Restoration does not call a model or create a task. A completed draft leaves the resumable list. If saving fails, keep the dialog open and retry; a revision conflict never overwrites another page silently. These are local operator labels, not logged-in identities.
After valid preflight and rule selection, Create and start AI inspection uses the existing serial queue; Create only lets you run it later. A successful connection test is required before automatic execution. The task and conversion report are retained before queue dispatch, so blocked dispatch does not lose the task.

Rule import and draft cleanup
AI-assisted rule import keeps the original-text comparison and only saves drafts. The app assigns editable rule IDs by advancing the existing scene catalog prefix; the model does not generate IDs. Category is a dropdown of existing scene categories, with a small starter list for an empty catalog. Unsupported model categories stay unselected. Saving reports all missing fields together before uploading the source or writing drafts, including owner, date, reference policy, candidate fields and source confirmation. Editing criteria or scope clears that item’s confirmation and explains why; editing an ID or category retains the content comparison. Check automatic Deliverable requirements classification before confirming. In rule details, Abandon draft hides a test draft from the default catalog while retaining its content and events; select Abandoned to inspect it. Publishing still requires a separate action.

Handling evidence-needed work
After marking records Evidence needed, preview the eligible records within one task and retain Unable to determine in a batch. Provide an operator label and reason. Each selected record must already have complete valid AI output or complete independent human judgments; unprocessed/failed checks cannot be closed as handled, and an unreviewed Fail must be checked first. This marks review work Handled, still unable to determine: it does not change verdicts, create Human Confirmed results, count as Pass or enter the final quality denominator. Per-record actor/time/reason history is retained. Reopen with a reason before later changes; original conclusions and processing history remain. Batch limits and eligibility are enforced again when saving, including changes since the preview.

Rule health, exemption blockers and reinspection differences
Use the management summary, task details or export area to open Rule health, Reinspection differences or Review audit. Rule health aggregates saved checks by scene, rule ID and frozen version. It shows AI answer coverage, Unable-to-determine rate, Fail trigger rate, current confirmed-human coverage and verdict-change rate among comparable AI/human pairs; technical failures are separate. Denominators are displayed; no sample is not zero percent. Archived tasks remain historical data, while voided tasks and deliverable requirements are excluded. Human changes are an observed selected sample, not model accuracy. A complete historical quotation-rejection rate is unavailable and is not invented.
Task Details > Review-exemption blockers groups saved reasons, including unavailable source time, low confidence, evidence/consistency failures and existing human work. Reasons overlap and cannot be added as a conversation total. A low-confidence-only count is not a forecast of safe exemptions after lowering the threshold. This is a read-only diagnostic, not a calibration wizard, automatic threshold recommendation or new model call.
Reinspection differences offer parent/reinspection pairs first and allow manual task selection, aligning the same archived source hash, worksheet, physical row set and rule ID. New/removed rules, versions, saved AI verdicts and human draft/confirmed records remain distinguishable. Missing or conflicting source positions/content produce an explicit Cannot compare result; conversation IDs or row order alone are not used to guess a match. It neither re-runs inspection nor establishes that a changed rule caused a better result. JSON downloads of rule health and differences are diagnostic snapshots, not final quality reports.
The overview's All batches option uses the current local workspace and existing filters. It does not import other computers' batches or establish a centralized cross-user trend service.

Audit export, printable reports and local storage
Review audit export includes saved human-review and evidence-needed processing/reopening events, with operator labels, times, reasons and retained before/after values. Missing prior snapshots stay Not recorded and are not reconstructed from today's AI judgment. Labels are editable local labels, not authenticated identities. Archived and voided records remain available for audit tracing. Exporting an active task's audit records its deliverable use for the existing void-protection rule; audit access does not reactivate a voided task.
Downloaded HTML reports include Print / Save as PDF. Open the local HTML, use the browser print dialog and check page orientation, long tables and page breaks before saving or distributing a PDF. This uses the browser's local printing capability; it does not add a PDF rendering service or change saved judgments.
Workspace usage shows aggregate logical file sizes and available disk space using file metadata only. A bounded scan labels incomplete totals and skips links/unreadable files. Refresh for updated figures while jobs are running. This page is read-only: it neither deletes historical traces/caches nor changes workspace records. Migration backups cover the prior workspace file only, not a complete backup of originals and reports. Full workspace backup/restore is available from Backup and restore; automatic cleanup is not implemented. A usage scan is not a backup operation. See the backup section for exclusions and recovery steps. Multi-user claims/coordination and automatic threshold recommendations are also outside this release.

${ecommerceCurrentPolicyGuide('en')}Repeat imports and display language
The same source content may be imported again into an independent task. Keep source identifiers/text unchanged; lineage and repeat-import labels are retained, and cross-batch statistics separate repeat imports by default. Reinspect with new rules remains the explicit parent-linked path. Within-file validation still applies.
Fixed controls switch Chinese/English immediately. AI verdict and ecommerce classification reasons use cached display translations; a cache miss may request the configured translation model. In English mode, the main reason area shows only English translation status until a verified English translation is ready; original AI text remains in the audit area. Cached views switch immediately. Translation never reruns inspection or edits source reasons, verdicts, human reviews or audit records.

Release and material boundaries
This guide describes expected behavior and checks to execute; it is not evidence of completed acceptance. Real model quality needs an intranet golden comparison; synthetic tests cannot establish business judgment accuracy. The 49-conversation / 1,735-turn count belongs only to its legacy structured benchmark and is not a raw-import turn count. An authorized intranet custodian may add approved resources/catalog-seed.json before first start and update metadata/checksums for a program-only package. Complete built-in packages load empty workspaces automatically; existing-workspace startup first makes a full .sqwb backup, then publishes newer bundled versions with a system-upgrade audit. Local maintained settings and historical task snapshots remain intact. Failure keeps the previous workspace available and displays recovery instructions; manual loading remains available. The separate synthetic catalog self-test is not a business rule set.

Navigation and recovery
Model Settings can return to conversion review while retaining the source file and manual edits. Cleaning-origin tasks export the business Excel and HTML, including an audit worksheet. Product grouping stays Unprovided when no original product-column mapping was frozen. Task progress identifies AI-final and human-confirmed sources, and report shortcuts select the current task. Invalid report inputs now identify the input/reference problem instead of reporting a provider failure. Policy metadata is kept in the frozen task but only the documented policy fields are sent to analysis.

Three-state routing and review
Legacy version-1 tasks retain their frozen PASS review exemption and configurable 0.90 threshold; new UI-created tasks use rule-level calibration described above. This threshold is unvalidated, not calibrated on real business data. PASS requires complete applicable checks, valid source quotations, confidence and rule consistency. NA still requires a traceable applicability reason. Missing/low confidence, invalid output after bounded retries, invalid evidence or unresolved conflicts go to UNCERTAIN. FAIL and UNCERTAIN require current human confirmation; a FAIL initial judgment is not a final performance finding. Execution failures remain failures even when routed to a human.
AI-final PASS and Human Confirmed are different result sources. The review badge counts FAIL + UNCERTAIN + returned records once and shows the task/scenario breakdown. New unprocessed records are listed separately; without a model, open All Records and record an independent human judgment. Mark an AI-final PASS suspicious to return one record, a task or a selected rule scope to the human queue, providing an operator label and reason. Original AI decisions and return history remain. Human evidence holds and existing human drafts are protected from AI execution. Disabling review exemption on a new task makes its final results human-only. Older tasks without a frozen policy keep their original behavior; no historical confidence is invented.
The combined business export waits for current human confirmation or a valid AI-final PASS. Historical answers stay reference data for new-policy tasks. The AI-only export is explicitly preliminary, not final performance data. Excel retains the established main columns and adds a Result provenance sheet; HTML identifies AI-final, human-confirmed and pending-human counts. Only determinate final quality outcomes enter the final pass-rate denominator. Pending, unreplied and NA are separately disclosed where applicable.

Task queue and rule selection
Multiple tasks wait in one serial queue. Position includes the running task. Queued tasks can be cancelled; paused runs can use Cancel this run after in-flight requests settle, retaining completed results. Completed, partial or failed tasks release the worker for the next task, while prior incomplete conversations remain visible. Pause stops the task queue after in-flight requests settle. A restart leaves it paused until Continue Task Queue. Before dispatch, the current successfully tested model must match the frozen configuration; restore and test it in Model Settings if blocked. Failed retries retain both the previous uncertain decision audit and successful cached work. Select All / Clear and individual rule selection update in place without returning the list to the top. Reduced-motion preferences are respected.

`;
 return rawDirectGuide('zh')+`结构化导入、旧流程与结果来源说明

统一导入与AI解析转换
两个场景均采用任务名称／可编辑的本机操作标签、上传文件、本地预检的同一布局。任务名称初始留空并提示填写“批次名-日期”，须填写后继续，避免反复使用默认同名批次。上传不自动调用模型。标准表结构齐全时，直接确认抽样预览并选择规则；预检发现字段或结构缺失时，再主动选择“AI解析转换”。修改任务信息保留文件和预检结果；更换文件或场景需确认，原导入先保存为草稿。模板与手动字段映射归入“模板与手动处理”。
电商转换仅将原表头发给模型起草列对应，不发送业务行或历史人工答案。分别核对22个核心字段与独立源列、抽样预览，再确认并对未改写的原文件重新预检；扩展列仍可追溯。仅旧清洗草稿保留AI起草角色／时间／逐轮原文及字段、抽样、未确认行逐条处理要求；新识别整段原文采用上方直判路径。日期、角色与原文均不静默补造。旧流程“采用首条消息时间”是显式采用可核验来源时间，不等于认定首条消息就是实际会话开始。
起草前须配置并成功测试获准模型，明确知情确认本次接口。会话转换逐会话发送原文，可能含个人信息，必须使用获准接口。修改模型配置或恢复草稿后，调用授权重新确认。转换产物仍走同一套会话信息与逐条发言表预检；清洗报告留存来源定位、计数、修改、弃行及两层确认记录。

整次导入保存与恢复
文件、映射、预检与已确认的转换进度保存在本机工作区。使用“保存草稿并关闭”，重开页面或应用后从“导入草稿”继续。恢复不自动调用模型或创建任务；已建成任务的草稿退出可继续列表。保存失败时保留当前页面重试；版本冲突不会静默覆盖另一页面。操作标签仅供本机留痕，不绑定登录身份。
预检通过、完成规则选择后，“创建并开始AI质检”沿用现有串行队列；也可“仅创建，稍后质检”。自动执行前模型连接须测试成功。任务与清洗报告先保存，再派发队列；派发受阻不会丢失任务。

规则导入与草稿清理
模型辅助规则导入保留原文对照，只保存草稿。程序按当前场景目录的既有前缀顺延编号，人工可改，模型仍不生成ID。类别改为场景现有分类下拉；空目录提供少量初始分类，模型给出的非目录分类保留为待选择。保存时一次列出维护人、日期、关联资料、候选字段、原文确认等全部缺项，在补齐前不上传原件、不写入草稿。修改口径或作用域会清除该项确认并说明原因；仅修改编号或类别保留内容核对。确认前核对自动识别的“交付物要求”分类。规则详情“弃用草稿”可将测试草稿从默认目录隐藏，内容与事件保留，通过“已弃用”筛选查看；发布仍是独立操作。

待补充工作处理
先将会话标为“待补充”，再在同一任务内预览可处理记录，批量保留无法判定，并填写操作人标签和原因。每条必须已有完整有效AI结果或完整独立人工判断；未执行／执行失败项不能直接结案，尚未人工核对的不符合项须先逐项处理。处理后标为“已处理，仍无法判定”，只完成审核工作，不改判、不生成人工已确认质量结论、不算通过，也不进入最终质量分母。每条独立保留操作人、时间和原因；后续修改须带原因重新打开，原结论和处理历史仍保留。保存时重新校验批量上限、资格及预览后是否发生变化。

规则健康度、免审原因与重检差异
可从管理汇总、任务详情或结果导出区进入“规则健康度”“重检差异”“人工改判审计”。规则健康度按场景、规则ID及冻结版本聚合已保存检查，显示AI回答覆盖、无法判定率、不符合触发率、当前已确认人工覆盖率及可比AI／人工判定对中的改判率，技术失败单列。页面披露分母，无样本不显示为0%；归档任务保留历史，作废任务及交付物要求排除。改判数据是已观察到的选择性样本，不等同模型准确率；完整历史引文拒绝率尚不可得，不补造数字。
任务详情“免审阻断原因”汇总已保存的来源时间不可用、低置信度、证据／一致性失败及人工处理等原因。同一会话可重复涉及多个原因，数量不能直接相加。“仅低置信度”数量不代表降低门槛后可以安全免审的数量。这是只读诊断，不是门槛标定向导，不自动推荐门槛，也不重新调用模型。
重检差异优先列出父任务与重检任务，也可手动选择；按同一归档原件摘要、工作表、物理行集合和规则ID安全对齐，区分新增／移除规则、版本、已保存AI判定和人工草稿／确认记录。来源位置或内容缺失／冲突时明确“不可比较”，不只靠会话ID或行顺序猜测匹配；不重新运行质检，也不据此宣称改规则必然提高质量。规则健康度和差异的JSON下载仅为诊断快照，不是最终质量报告。
概览“全部批次”沿用本机当前工作区及已有筛选，不导入其他电脑的批次，也不代表已建成集中式跨用户趋势服务。

审计导出、报告打印与本机空间
人工改判审计独立导出已保存的人工审核事件，以及待补充处理／重新打开事件，含操作标签、时间、原因与实际留存的前后值。缺少原前值时标记“未记录”，不从当前AI判定倒推；可编辑的本机操作标签不代表已认证身份。归档和作废记录均可追溯；有效任务导出审计后登记交付使用，沿用既有作废保护，读取作废任务审计不使其恢复有效。
下载的HTML报告增加“打印／另存PDF”。在本机浏览器打开HTML，使用打印对话框，先核对纸张方向、长表格和分页再保存或分发PDF。此功能使用浏览器本机打印能力，不新增PDF渲染服务，也不修改已保存判定。
“工作区用量”仅读取文件元数据，显示分类逻辑大小及所在磁盘可用空间；达到扫描上限、跳过链接或遇到不可读文件时明确为部分统计，运行中可刷新。该页只读，不删除历史轨迹／缓存，也不修改工作区记录。迁移备份只保护迁移前的工作区文件，不含完整原件和报告。完整备份／恢复已在“备份与恢复”入口提供；自动清理未实现。请按前文备份说明操作，用量查看不等于备份。多人认领协作、自动门槛推荐亦不在本版。

${ecommerceCurrentPolicyGuide('zh')}重复导入与展示语言
同内容源文件可再次导入为独立任务，源标识和原文无需改动；保留来源关联和重复导入标记，跨批次统计默认将重复导入分开。“使用新规则重检”仍提供明确的父任务关联。单文件内部校验继续有效。
固定操作文案即时切换中英文；AI判断理由和电商分类理由使用展示译文缓存。无缓存时可能请求已配置翻译模型；英文理由主区域仅显示英文翻译状态，合格译文就绪后再展示，原始AI文本留在审计区；缓存命中即时切换。翻译不重跑质检，不改源理由、判定、人工审核或审计记录。

版本与材料边界
本说明描述预期行为与待执行检查，不代表验收已完成。真实模型效果须在内网按金标准对照，合成测试不证明业务判断准确率。49会话／1735轮仅属于对应旧结构化基准，不作为原文导入轮次。程序包可由获准内网交付人员在首次启动前放入resources/catalog-seed.json并同步元数据和校验清单；完整内置包空工作区自动装载，存量工作区启动先完整.sqwb备份，再发布内置新版并记录system-upgrade审计。本机维护参数与历史任务冻结快照保留；失败保留旧工作区并提示恢复，手动装载入口继续可用。合成目录自检材料不得当业务规则使用。

返回与继续
模型设置可返回解析核对，保留原文件及人工修改。清洗来源任务可生成业务Excel和HTML，附表保留转换审计。未冻结原表产品列时，产品分组仍为“未提供”。任务进度分列AI终判与人工确认，报告快捷入口定位当前任务。报告输入或冻结依据不合规时明确报告输入问题；冻结快照保留完整政策元数据，模型分析仅接收约定字段。

三态判定与审核来源
旧version-1任务保留冻结的会话级免审策略，0.90为未标定自评门槛。新建任务使用前文规则级标定，未匹配达标规则时全部人工。以下会话级置信度说明仅适用于旧策略。全部适用项通过、引用有效、置信度达标且规则无冲突，才能AI终判PASS；NA也须有可追溯的不适用依据。缺失／低置信度、输出结构有限重试后仍异常、引用无效或未消解冲突均为UNCERTAIN。不通过FAIL和不确定UNCERTAIN须本轮人工确认；AI初判FAIL不作为最终绩效结论。执行失败仍保留失败状态，不因转人工而视为模型成功。
“已由AI判定”与“人工确认”分开记录。角标按FAIL＋不确定＋退回计算且不重复，点开可看任务／场景构成。新任务未运行记录单列；无模型时可在“全部记录”中独立人工检查。单条、按任务或按规则将AI终判PASS“标记可疑→退回人工”，须填写操作人和原因，原AI判定及退回历史保留。人工待补证和已有草稿不被AI覆盖。新任务关闭免审后，仅人工确认形成最终结果。旧任务缺少冻结策略时保持旧机制，不补造历史置信度。
综合业务交付仅采用本轮人工确认或有效AI终判PASS；新策略任务的原表历史答案仍保留作参考。仅AI初判口径会明确标识“非绩效最终”。Excel保持既有主表列，另加“判定来源与分流”附表；HTML分列AI终判、人工确认、待人工数量。最终通过率只以已确定的最终质量结论为分母，待判定、未回复及NA按适用口径单列。

任务排队与规则选择
多个任务进入同一串行队列，位置包含当前运行任务，尚未派发者可取消排队；暂停任务待在途请求结束后可“取消本次运行”，保留已完成结果。前序完成、部分失败或失败终态后自动执行下一任务，原未完成会话数量仍可见。暂停会暂停整条任务队列，在途请求结束后保留结果；服务重启后须明确“继续任务队列”。每次派发前重验当前成功测试的配置与本次冻结配置一致；不符时到模型设置恢复并测试。重试保留成功缓存，也保留前次不确定判定审计。逐项勾选、全选和清空规则均原位更新，不跳回列表顶部；尊重减少动画偏好。

`;
}
