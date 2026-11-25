import {startupMaintenanceGuide} from './startup-maintenance-guide.mjs';
import {triageWorkflowGuide} from './triage-guide.mjs';
import {rawDirectGuide} from './raw-direct-guide.mjs';
import {desktopUsageGuide} from './builtin-guide.mjs';
export function selfServiceGuide(language='zh'){
 if(language==='en')return `Business self-service

Quick start
1. Open QualityWorkbench.exe for the desktop window. One workspace supports all configured scenarios; browser launch/stop tools remain available as a fallback.
2. Select Inspection Tasks > New Task > New Product Consultation.
3. Upload the file and read the local preflight. A recognized whole-cell transcript opens Raw direct inspection: confirm the original preview and source time declaration, then select rules. A complete standard workbook keeps the structured path; ecommerce may use AI-assisted header conversion. Templates and manual mapping are under Templates and manual options. Existing legacy cleaning drafts retain their original review requirements.
4. Enter the task name and reviewer label. Select the basis date and the published rules for this scenario. Rules and policies are frozen with the task.
5. Choose Create only to save without an inspection call, or Create and start AI inspection to join the existing queue after the model connection is tested. Explicitly requested AI conversion is also a model call.
6. Open Model Settings. Save the approved HTTP/HTTPS OpenAI-compatible base URL, exact model ID and Bearer/no-key mode; then Test Connection. AI inspection requires a successful test for the current configuration. Changing the endpoint, model, key or execution options requires another test. Manual review remains available without a model.
7. If you created without starting, start AI Inspection from Task Details. Otherwise the task is already queued. Additional tasks wait in the visible serial queue; cancel waiting tasks or pause/continue the queue. Completed items are retained.
8. Valid AI-final PASS records are exempt from review. Review FAIL, UNCERTAIN and returned records against original evidence, then confirm human decisions. Check the task/scenario badge breakdown and both result sources.
9. A complete built-in package automatically loads an empty workspace and, when a newer bundled version exists, backs up an existing workspace to .sqwb before publishing the new version with a system-upgrade audit. Local maintained settings and historical tasks remain intact. Failure leaves the old workspace available; manual loading in Scenario Management remains a recovery option. Create a new task or reinspect to use new standards. A warning identifies incomplete frozen NP exception content. Archived tasks leave the review queue and are read-only (export allowed); restore before further review. Voided tasks cannot be edited.
10. Open Results Export, select the task, conclusion policy and report language, generate deliverables and download Excel and the self-contained HTML report. Model-generated translation/analysis has separate progress and missing-item warnings.

${startupMaintenanceGuide('en')}${desktopUsageGuide('en')}${triageWorkflowGuide('en')}Preparing a structured standard workbook (separate from raw direct inspection)
Use Download Standard Template. Keep both sheets and their headers unchanged.
The fixed source-template labels below are retained verbatim for copying; they are not untranslated instructions. Their order corresponds to: conversation ID, scenario, start time, topic, channel, product, agent, customer, completeness, missing note; and conversation ID, turn number, role, speaker, timestamp, original text.
[Raw template schema]
Conversation Information sheet: 会话信息
Headers: 会话ID, 业务场景, 会话开始时间, 会话主题, 渠道, 产品型号, 客服标识, 客户标识, 会话完整性, 缺失说明
Conversation Details sheet: 会话明细
Headers: 会话ID, 轮次序号, 发言角色, 发言方标识, 发言时间, 原文内容
Role codes (customer / agent / system): 客户 / 客服 / 系统
Completeness codes (complete / partly missing): 完整 / 部分缺失
[/Raw template schema]
All headers must exist; optional values may be blank. IDs must link the two sheets. The scenario must be the selected registered scenario. Start time is required. Turn number must be a unique positive integer within the conversation; use the role/completeness codes above and nonempty original text. Partly missing conversations require a missing-data note. Nonempty timestamps use a real ISO date with a timezone, for example 2026-11-04T09:30:00+08:00 or 2026-11-04T01:30:00Z. Empty optional speaker/time values remain blank. Maximum 8 MB, 500 conversations per file and 500 turns per conversation.

Troubleshooting
Wrong sheet/header error: raw direct input needs conversation ID, associated agent and whole-cell message details. Correct missing or ambiguous columns; select the source sheet when required. For structured sources, use Templates and manual options > Map fields manually and select the sheet/header row. Ecommerce can separately request AI-assisted header conversion.
Missing required mapping in the structured path: map id (conversation ID), startedAt (conversation start time), role and text for multi-turn sources, or id, startedAt, customerText and agentText for question/answer pairs. These required values must come from actual source columns. Recognized whole-cell transcripts instead use Raw direct inspection without a start-time or role column. Only legacy cleaning drafts retain manual source-span/time review. Optional product/topic defaults never replace required source identity or text.
No selectable rules: open Rules for the selected scenario; check assignment, Published status, effective/expiry dates and the task basis date. A future-effective rule becomes selectable only on or after its effective date. Use Download Template > Import > verify > Publish, or create a rule draft manually; publish the referenced policy as well. Return to the saved task draft to continue.
Repeated imports: the same source content may be imported again as a separate task, without renaming the file or changing original identifiers/text. Source lineage and repeat-import labels are retained; each task has its own frozen rules, results and review history, and cross-batch statistics separate repeat imports by default. To apply new rules to an archived raw task, Reinspect with new rules remains available with an explicit parent-task link. Required-field and within-file identity checks still apply.
AI start blocked: save settings and successfully Test Connection. In no-key mode no Bearer header is sent. Endpoint changes discard the previous endpoint's saved credential. A successful test confirms connectivity, not business judgment accuracy.
Resume settings differ: restore all public model settings shown in the run's frozen configuration, then test that configuration with the current key. Testing model B cannot authorize resuming frozen model A. Alternatively start a new run with the current tested settings; previous results remain retained.
Missing analysis/translation: inspect the node error and Retry Missing Items; failed output remains missing and never becomes a pass automatically.
Source roles unreliable: structured tasks need corrected source roles. In raw direct inspection, unclear speaker attribution that affects a rule remains Unable to determine; report quotations retain unverified attribution. Neither a report setting nor an optional structure draft repairs earlier decisions.

`;
 return `业务自助使用

快速开始
1. 默认打开QualityWorkbench.exe桌面窗口，一个入口使用全部已配置场景；浏览器启动／停止工具保留作兜底。
2. 打开“质检任务→新建质检任务”，选择“新品产品咨询”。
3. 上传文件并查看本地预检；识别整段文本时进入“原文直判”，确认原始预览和来源时间声明后选规则。完整会话信息与逐条发言表保留结构化路径；电商可主动使用AI表头映射。模板与手动字段映射位于“模板与手动处理”，旧清洗草稿保留原确认要求。
4. 填任务名称和审核人标签，选择依据基准日期、本场景已发布且生效的规则。规则与政策随任务冻结。
5. “仅创建，稍后质检”保存任务而不发起质检调用；“创建并开始AI质检”在模型连接测试通过后进入现有队列。主动触发AI解析转换也会调用模型。
6. 打开“模型设置”，保存获准的HTTP/HTTPS OpenAI兼容基础地址、准确模型名、Bearer或“无需密钥”，再点“测试连接”。当前配置测试成功才能开始AI质检；地址、模型、密钥或执行选项改变后须重测。未配置模型时仍可人工独立检查。
7. 若选择仅创建，在任务详情开始AI质检；若已选择创建并开始，任务已经入队。其他任务进入可见串行队列，可取消等待任务、暂停或继续整队；已完成项保留。
8. 有效AI终判PASS免审；FAIL、不确定和退回项结合原文与冻结依据人工确认，查看角标任务／场景构成及两类最终来源。
9. 打开“结果导出”，选择任务、结论口径和报告语言，生成交付物后下载Excel及单文件HTML。翻译和分析另有进度，缺失项有提示。

${startupMaintenanceGuide('zh')}${desktopUsageGuide('zh')}${triageWorkflowGuide('zh')}结构化标准模板格式（独立于原文直判）
请从工作台下载标准模板，保留双表名称和表头。
“会话信息”：会话ID、业务场景、会话开始时间、会话主题、渠道、产品型号、客服标识、客户标识、会话完整性、缺失说明。
“会话明细”：会话ID、轮次序号、发言角色、发言方标识、发言时间、原文内容。
所有列名必须存在，可选值允许留空。两表以会话ID对应，场景为当前登记场景；会话开始时间必填。轮次为会话内唯一正整数，角色仅客户/客服/系统，原文非空。完整性填“完整”或“部分缺失”，后者须填缺失说明。非空时间须为真实且带时区的ISO格式，例如2026-11-04T09:30:00+08:00或2026-11-04T01:30:00Z；可选的发言标识和时间允许空。单文件最多8MB、500会话，每会话最多500轮。

常见报错与处理
缺少工作表/表头：原文直判须有会话ID、客服和整段消息详情，修正缺失或歧义列，多来源表时按提示选择。结构化业务原表可展开“模板与手动处理→手动字段映射”，明确工作表与表头行；电商可另外主动请求AI表头映射。
结构化路径必填映射缺失：多轮会话映射id、startedAt、role、text，单行问答映射id、startedAt、customerText、agentText，值来自实际源列。新识别整段文本走原文直判，不要求补出开始时间或角色列；只有旧清洗草稿保留来源片段及时间的人工核对。产品等可选默认值不能替代必需的来源标识和原文。
无可选规则：打开本场景“质检规则”，核对场景归属、已发布状态、生效/失效日期和任务基准日期。未来生效版本须到生效日才可选。按“下载模板→导入→核对→发布”，也可手工新增草稿；引用的政策也须发布。处理后返回保留的任务草稿继续。
升级与存储：完整内置包全新首启自动装载；已有工作区启动时检测内置新版，先生成完整.sqwb备份，再发布新版本并写system-upgrade审计。本机维护参数保留，历史任务冻结不改；失败保留旧工作区并显示恢复指引。“从安装包装载新版”继续作为手动恢复入口。旧单文件记录迁移为任务／会话分片时保留迁移前文件，但迁移文件不等于完整.sqwb备份。请勿直接降级读取分片目录；回退使用升级前完整备份。

发布口径核对：自动升级完成后新建任务或使用新规则重检才采用新版本；旧任务冻结口径不会自动补写。核对NP-R13例外含①至⑧、NP-R17含售后维修NA，NP-R15至R17标明销售阶段。归档任务退出审核队列且只读，可查看／导出，恢复后才能审核；作废终止操作。待处理项优先排列，报告翻译与优秀案例最多3次自动重试，已验证的部分内容保留并明确标记缺失。

重复导入：同内容源文件允许再次导入为独立任务，无需改文件名、造标识或改原文。保留来源关联和重复导入标记；各任务分别冻结规则、结果和审核历史，跨批次统计默认将重复导入分开。已归档原文任务也可使用“使用新规则重检”建立显式父任务关联。必填字段及单文件内部标识校验仍须满足。
无法开始AI质检：保存设置后成功测试当前连接。无需密钥模式不发送Bearer头；换地址后原接口密钥不沿用。连接成功仅证明接口可用，不代表业务判断已验收。
继续运行提示配置不同：按运行详情恢复全部冻结模型设置，并用当前有效密钥测试该配置；测试模型B不能代替模型A。也可用当前已测试设置开启新运行，原有结果保留。
分析/翻译缺失：查看节点诊断并重试缺失项；失败输出保留缺失，不自动当通过。
源角色错误：结构化任务须修正源角色；原文直判中归属不明且影响规则时保留无法判定，报告引文标明角色未核验。报告口径或可选结构化草稿不会修复此前结论。

`;}

export function acceptanceChecklist(language='zh',{factoryReady=false,catalogSeedIncluded=false,sampleIncluded=false,factoryProfile='all-scenes'}={}){
 const zh=language!=='en';
 if(factoryProfile==='builtin-two-scenes')return zh?`两场景内置版 · 验收自检清单
资源状态：${factoryReady?'完整内置资源已配齐，以下检查仍须逐项执行并记录':'尚未满足完整出厂条件，不可作为一线正式交付包'}。本清单不代表已验收通过。
□ 1 全新独立数据目录首启，无需导入规则或示例；目录仅NP-R01至NP-R17，共17条会话检核规则。
□ 2 场景管理可只读查看新品、电商各自配置；查看不产生草稿。日常规则页不展示模型辅助导入入口；新增科目在管理路径操作。
□ 3 对照权威原表逐字核对17条规则的Pass/Fail案例、14个二级分类及双语示例、独立8场景例外表；记录原表摘要和版本。
□ 4 新品站点标准保持空白待人工维护；未配置则无法判定，不套用示例数值。新电商任务固定24小时：恰好24小时通过，超过不通过；夜间、周末、节假日全额计入，与站点／评价分类无关，不提供站点／类型阈值覆盖。时间缺失、倒序或冲突保留无法判定。
□ 5 新品合成跑批：原始列完整，单翻译列、5打标列、规则映射、整体结论及原因/正确做法；两行列组，NP-R14进入销售意识组。NA、无法判定、未执行分别展示。
□ 6 电商合成跑批：原始列完整、评价/回复双翻译列、五项检核及整体结论/原因；同语标记（同原文）。
□ 7 新品报告五部分、电商六部分；电商评价类型分布独立成节；10个错误案例按维度覆盖与严重程度选取，5个优秀案例展示原文与点评；无足够样本时说明数量，不编造。
□ 8 合成边界：同一管理员至少3条不同源记录，组内每对Dice均≥85%；2条仅建议，不同管理员不合并，缺管理员不猜。好评回应任一具体夸赞点或有相关增量即可，模板措辞中明确复述具体夸赞可通过；仅完全未回应具体夸赞且无相关增量才不通过；无效评价语义NA但重复子项独立检查；负向口径仍待业务仲裁、本次沿用v2：具体解释＋可用正式渠道可以通过，泛泛道歉＋转渠道不通过，不强制承诺时限。另核对200字符结束语豁免、掩码个人信息及低信息量负面VOC。历史任务按冻结口径。
□ 9 完整Excel/HTML保留固定声明与审计附页；规则/分类/例外/模板/运行参数随任务冻结，修改只影响新任务；升级保留本机维护参数、历史任务与已有结果。
□ 10 已有工作区启动时自动升级内置新版：先完整.sqwb备份，再发布新版本并记录system-upgrade审计；历史任务不变。失败仍可用旧工作区并按提示手动重试，手动装载入口保留。
□ 11 电商评价分类人工复核并纠正：固定24小时口径重审EC-STEPS回复结构，EC-TIME原判保留；v3改为或改出无效评价时还须重审EC-TARGET及其重复子项；旧任务依冻结依赖。检查译文置信度附页。
□ 12 相似块失败只影响关联记录的模板化③维度；逐行其他判定可查看和审核，重跑仅补未完成块。五项内联审核，符合免填理由，异常须说明；页面打开不会自动确认。
□ 13 新任务B6每规则每批抽检5%、至少5条且不超过候选量；旧任务保留冻结20%策略。17条新品规则英文标题/摘要/范围可查看，中文证据与审计不改写。
□ 14 旧安装包及外置数据目录保留，确认材料传播授权；合成测试不代表内网模型或译文效果。
□ 15 默认QualityWorkbench.exe独立窗口；托盘“打开／停止”可用，无后台工作关窗优雅停机。有AI、交付、翻译或结构化任务时提示确认，取消继续，确认后核对已保存进度。
□ 16 核对系统WebView2 Runtime；缺失时从https://developer.microsoft.com/microsoft-edge/webview2/获取Evergreen Standalone Installer x64离线安装。主包不内置Chromium，不联网自动安装。浏览器启动／停止exe及http://127.0.0.1:4186兜底可用；桌面首次本地首选独立，服务端工作区／模型保留，来源原文不改。
□ 17 中英文操作页、弹窗与报告系统文案可核对；来源原文明确标识。AI判断和分类理由缓存命中即时切换，缺失时英文理由主区域仅显示英文翻译状态，原始AI文本仅在审计区保留；翻译只作展示，不重跑质检、不改原文／判定／审核。核对英文报告理由与原判语义一致。
□ 18 同内容文件可再次导入为独立任务，来源关联与重复导入标记保留；各任务结果独立，跨批次统计默认分开，不通过改原文规避校验。
记录：程序版本____ 数据／规则版本____ 模型____ 日期____ 执行人____ 未通过项与处理____
`: `Two built-in scenarios - acceptance checklist
Resources: ${factoryReady?'complete built-in resources declared; execute and record each check below':'incomplete; not a frontline delivery package'}. This checklist does not state that acceptance has passed.
[ ] Clean startup loads exactly NP-R01..NP-R17 without a rules/sample import; EC checks are engine owned.
[ ] Both published configurations are viewable without creating drafts. Model-assisted subject creation is an administrator workflow.
[ ] Verify literal rule cases, all 14 intent categories and bilingual examples, and the independent 8-case exception table against the authoritative originals.
[ ] NP site standards start blank and require manual sources. New EC tasks use uniform 24-hour timing: exactly 24 hours passes, more fails; nights/weekends count, independent of site/classification, with no site/type overrides. Missing, reversed or conflicting timestamps remain undetermined.
[ ] NP: preserve source columns, one translation column, five tags, mapped rule/group columns, overall result and handling guidance; two header rows, separate NA/undetermined/not executed.
[ ] EC: preserve source columns, separate comment/reply translations, five checks, overall result and reasons; mark same-language text.
[ ] NP has five report sections; EC has six including review-type distribution. Check failing/excellent source excerpts, coverage, comments and recommendations.
[ ] Duplicate boundaries: at least 3 distinct rows from the same administrator with every pair reaching >=85% Dice; two replies are advisory. Do not combine administrators or infer missing identities. Positive replies may address any specific praised point or provide relevant additional information; concrete praise repeated in template wording may pass. Fail only when neither condition is met. Invalid-review semantic targeting is NA, while duplicate checks remain independent. Complaint criteria remain v2 pending business arbitration. For negative issues, a specific explanation plus a usable formal channel qualifies; generic apology/referral fails. Promised deadlines are not mandatory. Also check the 200-character closing exception, masked personal data and low-information negative VOC. Historical tasks keep their frozen policy.
[ ] Preserve declarations, full audit appendices and frozen task versions. Existing-workspace startup makes a full .sqwb backup, publishes newer built-in versions and retains system-upgrade audit, local settings and historical tasks. Upgrade failure keeps the old workspace available with manual retry.
[ ] Classification correction under fixed 24-hour timing requires fresh EC-STEPS review and retains EC-TIME; v3 changes to or from invalid reviews also require fresh EC-TARGET review. Historical dependencies remain frozen. Check translation confidence and reason meaning against the original.
[ ] Verify partial-block recovery and five-check inline review. Opening a review does not confirm drafts. New B6 tasks sample 5% per rule/batch, minimum 5, capped at candidate count; old tasks keep their frozen policy.
[ ] Retain earlier installers and data. Real standards/model quality require intranet acceptance; confirm distribution rights before publishing business materials.
[ ] Default QualityWorkbench.exe standalone window, tray Open/Stop, graceful idle-window shutdown, and confirmation with active AI/deliverable/translation/structuring work. Cancel must keep work running; verify saved progress after confirming shutdown.
[ ] Check system WebView2 Runtime. If missing, obtain the Evergreen Standalone Installer x64 offline package from https://developer.microsoft.com/microsoft-edge/webview2/. No bundled Chromium or automatic network installation. Verify browser launch/stop exe and http://127.0.0.1:4186 fallback, separate initial desktop preferences, preserved server-side workspace/model settings and unchanged originals.
[ ] Verify English/Chinese controls, dialogs and report labels; mark original content. Cached AI/classification reasons switch immediately; a cache miss shows only English translation status in the main AI reason area until a verified English translation is ready. Original AI text remains in the audit area. Display translation never reruns inspection or changes originals, verdicts or reviews.
[ ] Repeat-import the same content as separate tasks, retaining source lineage and repeat labels; results stay independent and cross-batch statistics separate repeat imports by default. Do not alter originals to bypass validation.
Record version____ Data/rule versions____ Model____ Date____ Tester____ Failed checks/actions____
`;
 return rawDirectGuide(language)+(zh?'会话质检工作台 · 出厂/业务验收自检（九步）\n':'Quality Workbench - factory/user acceptance (nine steps)\n')+
 (factoryReady?'':zh?`资源状态：目录种子${catalogSeedIncluded?'已包含':'未包含'}，标准示例${sampleIncluded?'已包含':'未包含'}。本轮真实材料留在内网；22规则、49/1735的出厂联合验收尚未完成，可按以下步骤自助配置。\n`:`Resources: catalog seed ${catalogSeedIncluded?'included':'not included'}; standard example ${sampleIncluded?'included':'not included'}. Business materials remain on the intranet; the 22-rule, 49/1735 factory acceptance is pending. Configure them there using the steps below.\n`)+
 (zh?`□ 1 启动：QualityWorkbench.exe打开独立窗口，无需开发环境；核对系统WebView2、托盘打开／停止、闲时关窗停机及忙时确认／取消。浏览器兜底保留，具体前提见使用说明。
□ 2 建任务：选择新品产品咨询。
□ 3 上传：${factoryReady?'结构化路径选择docs/samples/新品产品咨询_标准示例.xlsx，预检0错误，显示49会话、1735轮。':'使用内网获准原表，原文直判仅核对源行记录数、原文空格／换行和缺失时间声明，不补算轮次；会话信息与逐条发言表另核对真实轮次。49/1735仅在使用对应旧结构化内网样本时核对。'}
□ 4 选规则：${factoryReady?'不做规则导入，第3步见22条本场景已发布规则；基准日期不早于2026-11-04，可勾选。':'在规则管理按场景导入并发布获准标准；无规则时可跳转处理后返回草稿。内网预置种子联合验收另核对22条。'}
□ 5 创建：任务保存，原文、产品来源和依据快照可核对。
□ 6 配模型：保存获准网关/模型/鉴权，测试连接成功；未成功前AI启动受阻，人工审核可用。
□ 7 AI：运行逐会话质检，全部记录完成。存在失败则本步尚未通过，查看节点原因并重试；失败不当作成功。
□ 8 分流与人工：高置信有效PASS显示AI终判；FAIL／不确定／退回项进入人工队列，角标按任务构成可核对。原文双栏定位重复引文，改判须理由与连续原文；标记一条PASS可疑退回，确认后保留原判与审计；未执行不能显示全部完成。
□ 9 导出与对照：下载同快照Excel+HTML，核对行数、冻结规则、语言、原文引文及AI终判／人工确认／待人工来源；最终通过率另按口径披露。用本任务金标准并列正确率、无法判定率、FAIL召回率和错误免审PASS及完整分母／覆盖／缺失／技术失败，实测可选结构化的授权、暂停与未核验草稿说明。HTML离线打开。
记录：程序版本____ 示例SHA____ 规则/政策版本____ 网关/模型____ 日期____ 执行人____
仅本地替身通过不代表目标网关及真实业务质量验收；第7和第9步须在获准内网实测。
`:`[ ] 1 Launch: QualityWorkbench.exe opens the standalone window without a development environment. Verify system WebView2, tray Open/Stop, idle shutdown and busy confirmation/Cancel. Browser fallback remains available; see the user guide for prerequisites.
[ ] 2 New task: select New Product Consultation.
[ ] 3 ${factoryReady?'For the structured path, upload the bundled standard workbook: zero precheck errors, 49 conversations and 1,735 turns.':'Upload an approved original workbook. Raw direct inspection verifies source-record count, literal whitespace/line breaks and the unavailable-time declaration, without inventing turn counts. Check actual turns only for structured input; 49/1735 belongs to its legacy intranet sample.'}
[ ] 4 ${factoryReady?'Without importing any rules, step 3 lists 22 published scenario rules. Basis date must be 2026-11-04 or later.':'Import and publish the approved scenario standards in Rules. If empty, open Rules and return to the retained task draft. The 22-rule seeded-package test is separate.'}
[ ] 5 Create: original text, product provenance and frozen references are retained.
[ ] 6 Model: save the approved gateway/model/auth mode and successfully Test Connection. AI is blocked before success; manual review remains available.
[ ] 7 Inspect: all conversations complete. If any fail, this step is not passed; inspect the node and retry. Failure never counts as success.
[ ] 8 Routing: valid high-confidence PASS shows AI final; FAIL/UNCERTAIN/returned records enter human review. In the two-pane raw review, locate repeated quotations and edit verdicts with reasons/literal evidence. Verify the task breakdown and return a suspicious PASS; human confirmation retains the original audit. Unprocessed records must not appear complete.
[ ] 9 Export and compare: download Excel + HTML from the same snapshot; verify rows, frozen rules, language, original quotations and AI-final/human-confirmed/pending-human sources. Keep final pass-rate policy separate. Compare accuracy, uncertainty, FAIL recall and wrong original AI-final PASS together with full denominators, coverage, missing and technical-failure counts. Exercise optional structure consent, pause and unverified-draft notes. HTML opens offline.
Record version____ Sample SHA____ Rule/policy versions____ Gateway/model____ Date____ Tester____
A controlled local provider is not target-gateway or business-quality acceptance. Verify steps 7 and 9 in the approved intranet.
`);
}
