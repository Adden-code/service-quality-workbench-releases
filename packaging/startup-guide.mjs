export function startupRecoveryGuide(language='zh'){
 return language==='en'?`Installation and startup recovery (0.11.29)

Setup verifies every installed program file against the package SHA-256 list before offering to open the workbench. A failed check shows Installation incomplete and lists the affected files; silent setup returns exit code 12. Details are saved as installation-verification.txt in the installation folder.

If the desktop reports missing files, select Repair installation. It reuses the original installer after verifying its SHA-256, or asks you to locate that same installer if it has moved. You can always run the downloaded full installer again. Business data is stored separately and is not deleted by repair.

If Java still exits immediately after repair, use View logs and send portable-startup.log to support. Startup errors now include the Java exit code, signal, and bounded startup output with credentials removed. These logs do not prove a security block. Ask IT to check application-control or antivirus events if the failure persists; do not disable protection.

---

`:`安装与启动自愈（0.11.29）

安装完成前按包内清单逐文件核验SHA-256；校验不通过会明确显示“安装不完整”与问题文件，不会提供启动勾选。静默安装校验失败返回12。安装目录中的 installation-verification.txt 留存校验结果。

桌面提示缺件时可点击“修复安装”：先核对原安装包SHA-256，再覆盖安装；若原包已移动，会请你选择同一个安装包。也可直接重新运行下载的完整安装包。修复只更新程序文件，不删除独立存放的业务数据。

重装后Java仍立即退出时，点击“查看日志”，将 portable-startup.log 交给支持人员。日志包含退出码、信号及限长去密钥的启动输出，不包含模型请求或会话内容。仅凭秒退不能认定是安全软件拦截；持续失败请IT核查应用控制或安全软件事件，不要关闭安全防护。

---

`;
}
