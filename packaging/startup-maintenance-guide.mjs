export function startupMaintenanceGuide(language='zh'){
 return language==='en'?`Startup recovery and upgrade storage

After an interrupted shutdown, startup checks exclusive workspace ownership before recovering abandoned .creating-* temporary writes. Saved task data and original AI/audit records are not rewritten. The startup banner provides a maintenance record with exact paths. Unknown, linked or unsafe entries are preserved for a maintainer to inspect; restarting repeatedly is not a substitute for following that record.

After a successful automatic bundled update, the two most recent recognized pre-update .sqwb snapshots are retained. Older automatic-update snapshots are removed and logged. Manual backups, restore backups and unrelated files are not covered by this retention policy. If an archive cannot be verified safely it is retained and reported. A failed update never triggers snapshot pruning.

This release changes display and startup maintenance only. The bundled rules and all EC calibration criteria are unchanged from 0.11.23. Existing tasks retain their original snapshots.

`:`启动恢复与升级备份

异常关机或被强制退出后，程序先确认当前进程独占工作区，再恢复遗留的 .creating-* 临时写入。已保存的任务数据、AI原始记录与审计记录不改写。启动横幅可展开维护记录，查看具体路径；无法安全识别的文件或链接会保留并提示维护人检查，不需要反复盲目重启。

自动口径升级成功后，只保留最近两份可核验的升级前 .sqwb 快照，清理更旧的自动升级快照并留痕；手动备份、恢复前备份及无关文件不参与清理。无法安全核验的档案会保留并提示。升级失败时不执行快照清理。

本版只调整显示与启动维护，内置规则及全部EC判据保持0.11.23原样，历史任务继续使用原冻结口径。

`;
}
