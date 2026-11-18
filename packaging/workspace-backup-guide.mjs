export function workspaceBackupGuide(language='zh'){
 return language==='en'?`Workspace backup and restore (0.10.6)

Open Backup and restore in the sidebar. Pause running inspection, report, translation and structure jobs, then wait for in-flight requests to finish. Create and download full backup produces a local .sqwb file; confirm that your browser saved it to another drive or an approved backup location. It contains rules, tasks, results, source files, review history, generated reports, import drafts, execution traces and caches. The archive is uncompressed, limited to 512 MiB total, 64 MiB per file and 20,000 files. Files outside the supported business directories cause a clear refusal rather than a partial backup.

Model settings, Windows-user-bound keys, launcher control files and startup logs are not portable business data and are excluded. Restore keeps the receiving computer's existing model configuration and keys. On a new computer, configure and test the model connection separately.

To restore, choose the .sqwb file, preview its date, version and counts, then confirm replacement. Restore replaces the entire business workspace; it does not merge batches or deduplicate data from different computers. Any workspace mutation after preview requires previewing again. The program checks archive paths, file hashes, workspace records and referenced sources before replacing data. A selectable pre-restore .sqwb file and the old business files are saved beside the data directory; the success screen gives the exact backup path. Keep these files until you have accepted the restored workspace. To undo a restore, use the same Restore flow with that pre-restore .sqwb file.

Do not close the application during restoration. Interrupted swaps are rolled back on the next startup; an unresolvable storage error keeps the evidence and blocks further writes. After success or an uncertain network response, reload and verify the workspace before continuing. Do not blindly retry. Other open pages must also reload. Synthetic engineering checks do not establish real intranet data acceptance.

`:`工作区备份与恢复（0.10.6）

从侧边栏打开“备份与恢复”。暂停正在运行的质检、报告、翻译及结构化任务，等待在途请求结束，再“生成并下载完整备份”。在浏览器下载列表确认 .sqwb 文件保存完成，建议放到另一磁盘或公司允许的备份位置。档案包含规则、任务、结果、原文件、审核历史、生成报告、导入草稿、运行轨迹和缓存。采用未压缩格式，上限为总计 512 MiB、单文件 64 MiB、20000 个文件。遇到未支持的业务目录外文件会明确拒绝，避免生成不完整备份。

模型设置、绑定 Windows 用户的密钥、启动器控制文件和启动日志不随业务备份迁移。恢复时保留接收电脑已有模型设置和密钥；新电脑需要另行配置并测试模型连接。

恢复时选择 .sqwb 文件，先预览日期、版本和数量，再确认替换。恢复会替换整个业务工作区，不是合并批次，也不处理跨电脑重复数据。预览后任何工作区修改都会要求重新预览。程序先校验文件路径、摘要、工作区记录与关联原件，再替换数据；替换前在数据目录旁生成可再次选择恢复的 .sqwb 备份，并保留旧业务文件，成功页显示备份完整路径。确认恢复结果之前请保留这些文件。如需撤销恢复，按同样流程选择该恢复前 .sqwb 文件。

恢复中请勿关闭程序。交换中断后，下次启动会先回退；无法安全恢复的存储错误会保留证据并阻止继续写入。恢复成功或网络返回不明确时，先重新加载并核对工作区，不要盲目重试；其他打开的页面也须刷新。合成工程测试不代替内网真实业务验收。

`;
}
