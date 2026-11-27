using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// No service implementation lives here. All ownership/lock/process decisions
// are delegated to the packaged JSON bridge, never to process enumeration.
public static class DesktopPolicy
{
    public static string[] MissingStartupFiles(string root)
    {
        string[] required = new string[] { "runtime/node/node.exe", "packaging/desktop-host.mjs", "runtime/java/bin/java.exe", "runtime/java/bin/server/jvm.dll", "runtime/java/bin/jli.dll", "runtime/java/bin/java.dll", "runtime/java/bin/zip.dll", "runtime/java/bin/verify.dll", "runtime/java/bin/vcruntime140.dll", "runtime/java/bin/vcruntime140_1.dll", "runtime/java/lib/modules", "runtime/java/conf/security/java.security", "service/spring-ai-worker.jar" };
        List<string> missing = new List<string>();
        foreach (string relative in required) { try { FileInfo file = new FileInfo(Path.Combine(root, relative)); if (!file.Exists || file.Length == 0 || (file.Attributes & FileAttributes.ReparsePoint) != 0) missing.Add(relative); } catch (IOException) { missing.Add(relative); } catch (UnauthorizedAccessException) { missing.Add(relative); } }
        return missing.ToArray();
    }
    public static Dictionary<string, string> RepairSettings(string root)
    {
        Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string file = Path.Combine(root, "installer-repair.ini");
        if (!File.Exists(file) || new FileInfo(file).Length > 16384) return result;
        bool section = false;
        foreach (string raw in File.ReadAllLines(file)) { string line = raw.Trim(); if (line.StartsWith("[")) { section = line.Equals("[Repair]", StringComparison.OrdinalIgnoreCase); continue; } int index = line.IndexOf('='); if (section && index > 0) result[line.Substring(0, index).Trim()] = line.Substring(index + 1).Trim(); }
        return result;
    }
    public static bool InstallerMatches(string file, string expected)
    {
        if (System.String.IsNullOrWhiteSpace(file) || !File.Exists(file) || expected == null || expected.Length != 64) return false;
        using (FileStream stream = File.OpenRead(file)) using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").Equals(expected, StringComparison.OrdinalIgnoreCase);
    }
    public static string PathKey(string value) { return Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).ToLowerInvariant(); }
    public static string InstanceKey(string root, string userSid)
    {
        using (SHA256 sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(PathKey(root) + "\n" + userSid))).Replace("-", "").ToLowerInvariant();
    }
    public static string ProfileDirectory(string dataDirectory)
    {
        string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (System.String.IsNullOrWhiteSpace(local)) local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        // WebView2 owns this disposable browser state. Keep it outside the
        // backed-up workspace, isolated by workspace even across installations.
        // Legacy dataDirectory/desktop-profile is deliberately left untouched.
        string dataKey = PathKey(dataDirectory), key = InstanceKey(dataDirectory, "webview2-profile");
        List<string> bases = new List<string> { Path.GetFullPath(local), Path.GetTempPath() };
        DirectoryInfo parent = Directory.GetParent(Path.GetFullPath(dataDirectory).TrimEnd(Path.DirectorySeparatorChar));
        if (parent != null) bases.Add(parent.FullName);
        foreach (string directory in bases) {
            string candidate = Path.Combine(directory, "MSSQualityWorkbench-shell", "profile", key);
            string candidateKey = PathKey(candidate);
            if (candidateKey != dataKey && !candidateKey.StartsWith(dataKey + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return candidate;
        }
        throw new IOException("Cannot place browser profile outside this workspace. Choose a dedicated workspace folder instead of a drive root.");
    }
    public static string Language(string root, string osLanguage)
    {
        try {
            string file = Path.Combine(root, "desktop-language.ini");
            if (File.Exists(file) && new FileInfo(file).Length <= 4096) {
                bool section = false;
                foreach (string raw in File.ReadAllLines(file, Encoding.UTF8)) {
                    string line = raw.Trim();
                    if (line.StartsWith("[")) { section = System.String.Equals(line, "[Desktop]", StringComparison.OrdinalIgnoreCase); continue; }
                    if (!section || line.StartsWith(";")) continue;
                    int equals = line.IndexOf('=');
                    if (equals < 0 || !System.String.Equals(line.Substring(0, equals).Trim(), "Language", StringComparison.OrdinalIgnoreCase)) continue;
                    string value = line.Substring(equals + 1).Trim();
                    if (value == "english") return "en";
                    if (value == "chinesesimp") return "zh";
                }
            }
        } catch (IOException) { } catch (UnauthorizedAccessException) { }
        return osLanguage != null && osLanguage.StartsWith("zh", StringComparison.OrdinalIgnoreCase) ? "zh" : "en";
    }
    public static string QuoteArgument(string value)
    {
        StringBuilder result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); slashes = 0; continue; }
            result.Append('\\', slashes); slashes = 0; result.Append(c);
        }
        result.Append('\\', slashes * 2); return result.Append('"').ToString();
    }
    public static Uri WorkbenchUri(string value)
    {
        Uri uri;
        if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1" || !System.String.IsNullOrEmpty(uri.UserInfo) || uri.Port < 1024 || uri.Port > 65535)
            throw new InvalidOperationException("The host did not return a verified local workbench URL.");
        return uri;
    }
    public static bool InternalNavigation(string value, Uri workbench)
    {
        if (value == "about:blank") return true;
        if (value.StartsWith("blob:", StringComparison.OrdinalIgnoreCase)) value = value.Substring(5);
        Uri uri;
        return workbench != null && Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == workbench.Scheme && uri.Host == workbench.Host && uri.Port == workbench.Port && System.String.IsNullOrEmpty(uri.UserInfo);
    }
    public static Dictionary<string, object> Object(Dictionary<string, object> value, string key)
    { object item; return value != null && value.TryGetValue(key, out item) ? item as Dictionary<string, object> : null; }
    public static string String(Dictionary<string, object> value, string key)
    { object item; return value != null && value.TryGetValue(key, out item) && item is string ? (string)item : ""; }
    public static bool True(Dictionary<string, object> value, string key)
    { object item; return value != null && value.TryGetValue(key, out item) && item is bool && (bool)item; }
    public static bool NeedsCloseConfirmation(Dictionary<string, object> inspection)
    {
        Dictionary<string, object> activity = Object(inspection, "activity");
        object busy, unknown;
        return activity == null || !activity.TryGetValue("busy", out busy) || !(busy is bool) || !activity.TryGetValue("unknown", out unknown) || !(unknown is bool) || (bool)busy || (bool)unknown || String(inspection, "state") == "blocked";
    }
}

public sealed class DesktopHostException : Exception
{
    public readonly string Code;
    public DesktopHostException(string code, string message) : base(message) { Code = code; }
}

public sealed class DesktopBridge
{
    public readonly string Root;
    public readonly string Language;
    public DesktopBridge(string root, string language) { Root = Path.GetFullPath(root); Language = language; }
    public Task<Dictionary<string, object>> CallAsync(string command)
    { return Task.Run(() => Call(command)); }
    public Dictionary<string, object> Call(string command)
    {
        if (command != "--inspect" && command != "--start" && command != "--stop" && command != "--recover-stale") throw new ArgumentException("Unsupported desktop host command.");
        string node = Path.Combine(Root, "runtime", "node", "node.exe"), script = Path.Combine(Root, "packaging", "desktop-host.mjs");
        if (!File.Exists(node) || !File.Exists(script)) throw new DesktopHostException("MISSING_DEPENDENCY", Language == "en" ? "The package is incomplete. Reinstall the complete workbench package." : "程序文件不完整，请重新安装或解压完整工作台安装包。");
        ProcessStartInfo info = new ProcessStartInfo(node, DesktopPolicy.QuoteArgument(script) + " " + command + " --home " + DesktopPolicy.QuoteArgument(Root));
        info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden; info.WorkingDirectory = Root;
        info.RedirectStandardOutput = true; info.RedirectStandardError = true; info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
        info.EnvironmentVariables["WORKBENCH_LAUNCHER_LANGUAGE"] = Language;
        string configuredData = Environment.GetEnvironmentVariable("DEMO_DATA_DIR");
        if (!String.IsNullOrWhiteSpace(configuredData)) info.EnvironmentVariables["DEMO_DATA_DIR"] = Path.GetFullPath(configuredData);
        using (Process child = Process.Start(info)) {
            StringBuilder output = new StringBuilder(); bool oversized = false;
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs line) { if (line.Data != null) { lock (output) { if (output.Length + line.Data.Length > 1024 * 1024) oversized = true; else output.AppendLine(line.Data); } } };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs line) { /* Never expose raw process output or credentials. */ };
            child.BeginOutputReadLine(); child.BeginErrorReadLine();
            int timeout = command == "--start" ? 195000 : command == "--stop" ? 90000 : 30000;
            if (!child.WaitForExit(timeout)) {
                // Only the command child created above; never an enumerated service PID.
                try { child.Kill(); } catch (InvalidOperationException) { }
                throw new DesktopHostException("HOST_TIMEOUT", Language == "en" ? "The service command timed out. The window will remain open. Inspect the logs before retrying." : "服务命令超时。窗口会保留，请查看日志后重试。");
            }
            child.WaitForExit(); Dictionary<string, object> result = null;
            try { if (!oversized) result = new JavaScriptSerializer().DeserializeObject(output.ToString().Trim().TrimStart('\uFEFF')) as Dictionary<string, object>; } catch (ArgumentException) { }
            if (result == null) throw new DesktopHostException("INVALID_HOST_RESPONSE", Language == "en" ? "The service bridge returned an unreadable response. Check the installation and logs." : "服务桥返回格式无效，请检查安装文件和日志。");
            if (!DesktopPolicy.True(result, "ok")) { Dictionary<string, object> error = DesktopPolicy.Object(result, "error"); throw new DesktopHostException(DesktopPolicy.String(error, "code"), DesktopPolicy.String(error, "message")); }
            if (child.ExitCode != 0) throw new DesktopHostException("HOST_EXIT", Language == "en" ? "The service command did not complete successfully." : "服务命令未成功完成。");
            return result;
        }
    }
}

internal sealed class DesktopInstancePipe : IDisposable
{
    private readonly string name; private readonly WorkbenchWindow window; private volatile bool disposed; private NamedPipeServerStream current;
    public DesktopInstancePipe(string key, WorkbenchWindow form) { name = "MSSQualityWorkbench.Desktop." + key; window = form; Thread thread = new Thread(Listen); thread.IsBackground = true; thread.Start(); }
    private void Listen()
    {
        while (!disposed) {
            try {
                PipeSecurity security = new PipeSecurity(); security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
                using (NamedPipeServerStream pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security)) {
                    current = pipe; pipe.WaitForConnection(); if (disposed) return;
                    using (StreamReader reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true))
                    using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true)) {
                        Task<string> read = reader.ReadLineAsync(); if (!read.Wait(5000)) continue;
                        string command = read.Result; int code = 5;
                        if (command == "activate") { window.BeginInvoke(new Action(window.ShowWorkbench)); code = 0; }
                        else if (command == "exit-install") {
                            TaskCompletionSource<int> ready = new TaskCompletionSource<int>();
                            window.BeginInvoke(new Action(async delegate { try { ready.TrySetResult(await window.PrepareCloseAsync()); } catch { ready.TrySetResult(3); } }));
                            code = ready.Task.Wait(230000) ? ready.Task.Result : 4;
                        }
                        writer.WriteLine(code.ToString(CultureInfo.InvariantCulture)); writer.Flush();
                        if (code == 0 && command == "exit-install") window.BeginInvoke(new Action(window.CloseAfterStop));
                    }
                }
            } catch (ObjectDisposedException) { return; } catch (IOException) { } catch (InvalidOperationException) { if (disposed) return; }
        }
    }
    public static int Send(string key, string command, int timeout)
    {
        try {
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", "MSSQualityWorkbench.Desktop." + key, PipeDirection.InOut, PipeOptions.Asynchronous)) {
                pipe.Connect(10000);
                using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 1024, true))
                using (StreamReader reader = new StreamReader(pipe, Encoding.UTF8, false, 1024, true)) {
                    writer.WriteLine(command); writer.Flush(); Task<string> read = reader.ReadLineAsync();
                    if (!read.Wait(timeout)) return 4; int code; return Int32.TryParse(read.Result, out code) && code >= 0 && code <= 5 ? code : 4;
                }
            }
        } catch (IOException) { return 4; } catch (TimeoutException) { return 4; } catch (AggregateException) { return 4; } catch (UnauthorizedAccessException) { return 4; }
    }
    public void Dispose() { disposed = true; if (current != null) current.Dispose(); }
}

internal sealed class WorkbenchWindow : Form
{
    private readonly string root, language, expectedDataDir; private string dataDir; private readonly DesktopBridge bridge;
    private readonly NotifyIcon tray = new NotifyIcon(); private readonly Panel content = new Panel(); private readonly Panel messagePanel = new Panel();
    private readonly Label message = new Label(); private readonly ToolStrip toolbar = new ToolStrip(); private readonly ToolStripStatusLabel status = new ToolStripStatusLabel();
    private readonly ToolStripButton retry, browser, repair; private WebView2 web; private CoreWebView2Environment environment; private Uri workbench;
    private readonly List<Form> children = new List<Form>(); private Task initialization; private Task<int> closeWork; private bool allowClose, browserFallback, runtimeAvailable, serviceStarted;
    private TaskCompletionSource<bool> browserExited; private bool browserCreated, startupIncomplete; private FormWindowState restoredState = FormWindowState.Maximized;
    private string T(string zh, string en) { return language == "en" ? en : zh; }
    public WorkbenchWindow(string appRoot, string selectedLanguage, string configuredDataDir)
    {
        root = appRoot; language = selectedLanguage; expectedDataDir = configuredDataDir; dataDir = configuredDataDir; bridge = new DesktopBridge(root, language);
        Text = T("会话质检工作台", "Quality Workbench"); Icon = SystemIcons.Application; Width = 1320; Height = 900; MinimumSize = new Size(800, 560); StartPosition = FormStartPosition.CenterScreen; WindowState = FormWindowState.Maximized;
        Font = new Font("Microsoft YaHei UI", 9F); AutoScaleMode = AutoScaleMode.Dpi; toolbar.GripStyle = ToolStripGripStyle.Hidden; toolbar.Padding = new Padding(8, 6, 8, 6);
        retry = new ToolStripButton(T("重新连接", "Reconnect")); retry.Click += async delegate { if (initialization == null || initialization.IsCompleted) { initialization = InitializeAsync(); await initialization; } };
        ToolStripButton home = new ToolStripButton(T("工作台首页", "Workbench home")); home.Click += delegate { if (web != null && web.CoreWebView2 != null && workbench != null) web.CoreWebView2.Navigate(workbench.AbsoluteUri); };
        browser = new ToolStripButton(T("在浏览器中打开", "Open in browser")); browser.Click += async delegate { if (workbench == null) { browserFallback = true; initialization = InitializeAsync(); await initialization; } else OpenExternal(workbench.AbsoluteUri); };
        ToolStripButton logs = new ToolStripButton(T("查看日志", "View logs")); logs.Click += delegate { OpenLogs(); };
        repair = new ToolStripButton(T("修复安装", "Repair installation")); repair.Visible = false; repair.Click += async delegate { await RepairInstallationAsync(); };
        ToolStripButton help = new ToolStripButton(T("WebView2离线安装说明", "WebView2 offline setup")); help.Click += delegate { RuntimeHelp(); };
        ToolStripButton stop = new ToolStripButton(T("停止并退出", "Stop and exit")); stop.Click += delegate { Close(); };
        toolbar.Items.AddRange(new ToolStripItem[] { home, retry, browser, repair, logs, help, stop }); toolbar.Dock = DockStyle.Top;
        content.Dock = DockStyle.Fill; content.BackColor = Color.White; messagePanel.Dock = DockStyle.Fill; messagePanel.Padding = new Padding(32); message.Dock = DockStyle.Fill; message.TextAlign = ContentAlignment.MiddleLeft; message.Font = new Font(Font.FontFamily, 11F); messagePanel.Controls.Add(message); content.Controls.Add(messagePanel);
        StatusStrip strip = new StatusStrip(); strip.Items.Add(status); status.Spring = true; status.TextAlign = ContentAlignment.MiddleLeft;
        Controls.Add(content); Controls.Add(toolbar); Controls.Add(strip);
        ContextMenuStrip menu = new ContextMenuStrip(); menu.Items.Add(T("打开工作台", "Open workbench"), null, delegate { ShowWorkbench(); }); menu.Items.Add(T("停止服务并退出", "Stop service and exit"), null, delegate { ShowWorkbench(); Close(); });
        tray.Icon = Icon; tray.Text = T("会话质检工作台", "Quality Workbench"); tray.ContextMenuStrip = menu; tray.Visible = true; tray.DoubleClick += delegate { ShowWorkbench(); };
        Resize += delegate { if (WindowState == FormWindowState.Minimized) Hide(); else restoredState = WindowState; };
        Shown += async delegate { initialization = InitializeAsync(); await initialization; };
        FormClosing += async delegate(object sender, FormClosingEventArgs args) { if (allowClose) return; args.Cancel = true; int code = await PrepareCloseAsync(); if (code == 0) CloseAfterStop(); };
        FormClosed += delegate { tray.Visible = false; tray.Dispose(); };
    }
    public void ShowWorkbench() { Show(); if (WindowState == FormWindowState.Minimized) WindowState = restoredState; Activate(); BringToFront(); }
    private void SetMessage(string value) { message.Text = value; messagePanel.Visible = true; messagePanel.BringToFront(); status.Text = value.Replace("\r\n", " ").Replace("\n", " "); }
    private void ShowFailure(Exception error)
    {
        DesktopHostException host = error as DesktopHostException;
        repair.Visible = host != null && (host.Code == "MISSING_DEPENDENCY" || host.Code == "WORKER_EXIT" || host.Code == "WORKER_SPAWN_FAILED");
        SetMessage(T("暂未完成操作，窗口已保留。\r\n", "The operation did not complete. This window remains open.\r\n") + (host == null ? error.Message : host.Code + ": " + host.Message) + "\r\n\r\n" + T("可点击“重新连接”或“查看日志”。旧版浏览器启动/停止入口仍可使用。\r\n数据目录：", "Select Reconnect or View logs. The existing browser start/stop launchers remain available.\r\nData directory: ") + dataDir);
        ShowWorkbench();
    }
    private bool CheckRuntime()
    {
        try { runtimeAvailable = !String.IsNullOrWhiteSpace(CoreWebView2Environment.GetAvailableBrowserVersionString(null)); } catch (WebView2RuntimeNotFoundException) { runtimeAvailable = false; }
        return runtimeAvailable;
    }
    private void RuntimeHelp()
    {
        MessageBox.Show(this, T("本桌面窗口使用系统 Microsoft Edge WebView2 Runtime，不捆绑 Chromium。\r\n\r\n离线安装：在可联网电脑从微软官方下载 Evergreen Standalone Installer（x64），复制到本电脑安装，再点击“重新连接”。下载页：\r\nhttps://developer.microsoft.com/microsoft-edge/webview2/\r\n\r\n也可选择“在浏览器中打开”，继续使用原有浏览器入口。尚未选择浏览器入口时不会启动后台服务。", "This desktop window uses the system Microsoft Edge WebView2 Runtime. Chromium is not bundled.\r\n\r\nOffline setup: download the Microsoft Evergreen Standalone Installer (x64) on an online computer, copy it here, install it, then select Reconnect. Official download:\r\nhttps://developer.microsoft.com/microsoft-edge/webview2/\r\n\r\nYou may instead select Open in browser to use the existing browser workflow. No service is started until you choose that fallback."), Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
    private void CheckInspection(Dictionary<string, object> inspection)
    {
        string selected = DesktopPolicy.String(inspection, "dataDir");
        if (String.IsNullOrWhiteSpace(selected) || DesktopPolicy.PathKey(selected) != DesktopPolicy.PathKey(expectedDataDir)) throw new DesktopHostException("DATA_IDENTITY", T("宿主返回的数据目录不匹配，未执行后续操作。", "The host returned a different data directory. No further action was taken."));
        dataDir = selected;
    }
    private async Task InitializeAsync()
    {
        retry.Enabled = false; browser.Enabled = false;
        try {
            string[] missing = DesktopPolicy.MissingStartupFiles(root); startupIncomplete = missing.Length > 0;
            if (startupIncomplete) throw new DesktopHostException("MISSING_DEPENDENCY", T("安装不完整，请重新运行安装包即可修复，数据不会丢失。也可点击顶部“修复安装”。\r\n缺失或空文件：\r\n", "The installation is incomplete. Run the installer again to repair it. Your business data will not be lost. You can also select Repair installation above.\r\nMissing or empty files:\r\n") + String.Join("\r\n", missing));
            repair.Visible = false;
            SetMessage(T("正在检查桌面运行环境…", "Checking the desktop runtime…"));
            if (!CheckRuntime() && !browserFallback) { SetMessage(T("未找到 Microsoft Edge WebView2 Runtime。\r\n后台服务尚未启动。\r\n\r\n请查看顶部“WebView2离线安装说明”，安装后重新连接；或选择“在浏览器中打开”继续使用。", "Microsoft Edge WebView2 Runtime was not found.\r\nThe background service has not been started.\r\n\r\nUse WebView2 offline setup above, then reconnect, or choose Open in browser.")); return; }
            Dictionary<string, object> inspection = await bridge.CallAsync("--inspect"); CheckInspection(inspection);
            Dictionary<string, object> stale = DesktopPolicy.Object(inspection, "staleLock");
            // A verified live instance normally has a present lock too. Only a
            // recoverable dead owner requires consent; blocked identity is refused below.
            if (DesktopPolicy.True(stale, "present") && DesktopPolicy.True(stale, "recoverable")) {
                ShowWorkbench();
                if (MessageBox.Show(this, T("检测到已核验的失效占用记录。\r\n确认清理该失效记录并继续启动吗？业务数据不会删除。", "A verified stale ownership record was found.\r\nRecover this stale record and continue? Business data will not be deleted."), Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) { SetMessage(T("已取消清理，服务未启动。可在确认后重新连接。", "Recovery was cancelled. The service was not started. Reconnect when ready.")); return; }
                await bridge.CallAsync("--recover-stale"); inspection = await bridge.CallAsync("--inspect"); CheckInspection(inspection);
            }
            if (DesktopPolicy.String(inspection, "state") == "blocked") throw new DesktopHostException("INSTANCE_UNVERIFIED", T("现有服务身份无法核验，未启动或停止任何未知进程。", "The existing service identity cannot be verified. No unknown process was started or stopped."));
            SetMessage(T("正在启动并等待本机服务就绪…", "Starting the local service and waiting for it to become ready…"));
            Dictionary<string, object> ready = await bridge.CallAsync("--start"); CheckInspection(ready);
            if (DesktopPolicy.String(ready, "state") != "ready") throw new DesktopHostException("NOT_READY", T("服务尚未通过就绪检查。", "The service has not passed its readiness check."));
            workbench = DesktopPolicy.WorkbenchUri(DesktopPolicy.String(ready, "url")); serviceStarted = true;
            if (!runtimeAvailable || browserFallback) { OpenExternal(workbench.AbsoluteUri); SetMessage(T("已在默认浏览器中打开工作台。\r\n本窗口和托盘继续管理服务；关闭窗口会先停止服务。", "The workbench is open in your default browser.\r\nThis window and its tray icon continue to manage the service. Closing the window first stops the service.")); return; }
            await LoadWebViewAsync(); messagePanel.Visible = false; status.Text = workbench.AbsoluteUri + " · " + T("最小化到托盘可保留运行中的任务", "Minimize to tray to keep running tasks active");
        } catch (Exception error) { ShowFailure(error); } finally { retry.Enabled = true; browser.Enabled = true; }
    }
    private async Task LoadWebViewAsync()
    {
        if (web != null && web.CoreWebView2 != null) { web.CoreWebView2.Navigate(workbench.AbsoluteUri); return; }
        CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions(); options.Language = language == "en" ? "en-US" : "zh-CN";
        environment = await CoreWebView2Environment.CreateAsync(null, DesktopPolicy.ProfileDirectory(dataDir), options);
        browserExited = new TaskCompletionSource<bool>(); environment.BrowserProcessExited += delegate { browserExited.TrySetResult(true); };
        web = new WebView2(); web.Dock = DockStyle.Fill; content.Controls.Add(web); await web.EnsureCoreWebView2Async(environment); browserCreated = true; ConfigureWebView(web); web.CoreWebView2.Navigate(workbench.AbsoluteUri);
    }
    private void ConfigureWebView(WebView2 view)
    {
        view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true; view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true; view.CoreWebView2.Settings.IsStatusBarEnabled = false;
        view.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args) { if (!DesktopPolicy.InternalNavigation(args.Uri, workbench)) { args.Cancel = true; OpenExternal(args.Uri); } };
        view.CoreWebView2.NewWindowRequested += async delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args) {
            args.Handled = true;
            if (!DesktopPolicy.InternalNavigation(args.Uri, workbench)) { OpenExternal(args.Uri); return; }
            using (CoreWebView2Deferral deferral = args.GetDeferral()) {
                Form popup = new Form(); popup.Text = Text; popup.Icon = Icon; popup.Width = 1120; popup.Height = 820; popup.StartPosition = FormStartPosition.CenterParent;
                WebView2 child = new WebView2(); child.Dock = DockStyle.Fill; popup.Controls.Add(child); children.Add(popup); popup.FormClosed += delegate { children.Remove(popup); child.Dispose(); };
                try { popup.Show(this); await child.EnsureCoreWebView2Async(environment); ConfigureWebView(child); args.NewWindow = child.CoreWebView2; }
                // Dispose completes the deferral. Calling Complete here as well
                // invokes the COM deferral twice and can raise E_ILLEGAL_METHOD_CALL.
                catch (Exception error) { popup.Close(); ShowFailure(error); }
            }
        };
        view.CoreWebView2.ProcessFailed += delegate { SetMessage(T("桌面网页进程已中断。服务与业务数据仍单独保留，请重新连接或查看日志。", "The desktop web process was interrupted. Service and business data are retained separately. Reconnect or inspect the logs.")); };
        // Default WebView2 file chooser, download dialog and Ctrl+P/window.print
        // are intentionally preserved. No file-picker/download interception.
    }
    private void OpenExternal(string value)
    {
        Uri uri; if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https") || !System.String.IsNullOrEmpty(uri.UserInfo)) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch (Exception error) { ShowFailure(error); }
    }
    private void OpenLogs()
    {
        string logs = Path.Combine(dataDir, "logs"), target = Directory.Exists(logs) ? logs : Directory.Exists(dataDir) ? dataDir : root;
        try { Process.Start(new ProcessStartInfo("explorer.exe", DesktopPolicy.QuoteArgument(target)) { UseShellExecute = true }); } catch (Exception error) { ShowFailure(error); }
    }
    private async Task RepairInstallationAsync()
    {
        repair.Enabled = false;
        try {
            Dictionary<string, string> settings = DesktopPolicy.RepairSettings(root); string file, expected;
            if (!settings.TryGetValue("SHA256", out expected)) { MessageBox.Show(this, T("未找到原安装包校验记录，请重新运行已下载的完整安装包。业务数据不会丢失。", "No original installer record is available. Run your downloaded full installer again. Your business data will not be lost."), Text); return; }
            if (!settings.TryGetValue("Installer", out file) || !File.Exists(file)) {
                using (OpenFileDialog picker = new OpenFileDialog()) { picker.Title = T("选择本版本原安装包", "Select this version's original installer"); picker.Filter = "Installer (*.exe)|*.exe"; if (picker.ShowDialog(this) != DialogResult.OK) return; file = picker.FileName; }
            }
            if (!await Task.Run(() => DesktopPolicy.InstallerMatches(file, expected))) throw new DesktopHostException("REPAIR_INSTALLER_MISMATCH", T("文件与本版本原安装包不一致，未运行。请重新下载完整安装包并直接运行。", "This file does not match the original installer. It was not run. Download the full installer again and run it directly."));
            if (serviceStarted && await PrepareCloseAsync() != 0) return;
            // The installer independently stops verified background instances
            // using its own intact tools before it replaces any program file.
            Process.Start(new ProcessStartInfo(file, "/SILENT /NORESTART /DIR=" + DesktopPolicy.QuoteArgument(root)) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(file), WindowStyle = ProcessWindowStyle.Normal });
            CloseAfterStop();
        } catch (Exception error) { ShowFailure(error); } finally { repair.Enabled = true; }
    }
    private string ActivityDescription(Dictionary<string, object> inspection)
    {
        Dictionary<string, object> activity = DesktopPolicy.Object(inspection, "activity"), counts = DesktopPolicy.Object(activity, "counts");
        string[] keys = new string[] { "ai", "report", "translation", "structured" }; List<string> values = new List<string>();
        string[] labels = language == "en" ? new string[] { "AI batches", "Deliveries", "Translations", "Structured conversions" } : new string[] { "AI批次", "业务交付", "翻译", "会话整理" };
        for (int i = 0; i < keys.Length; i++) { object value; values.Add(labels[i] + ": " + (counts != null && counts.TryGetValue(keys[i], out value) ? Convert.ToString(value, CultureInfo.InvariantCulture) : "?")); }
        return String.Join(" · ", values.ToArray()) + (activity == null || DesktopPolicy.True(activity, "unknown") ? "\r\n" + T("部分任务状态无法核验。", "Some activity could not be verified.") : "");
    }
    public Task<int> PrepareCloseAsync()
    {
        if (closeWork == null || closeWork.IsCompleted) closeWork = StopForCloseAsync(); return closeWork;
    }
    private async Task<int> StopForCloseAsync()
    {
        try {
            if (initialization != null && !initialization.IsCompleted) await initialization;
            // Startup file validation runs before any bridge/service process.
            // A missing runtime must not trap a never-started window on close.
            if (startupIncomplete && !serviceStarted) { await DisposeBrowserAsync(); return 0; }
            Dictionary<string, object> inspection = await bridge.CallAsync("--inspect"); CheckInspection(inspection);
            if (DesktopPolicy.NeedsCloseConfirmation(inspection)) {
                ShowWorkbench(); string prompt = T("仍有任务运行或任务状态未知。\r\n", "Tasks are still running or their status is unknown.\r\n") + ActivityDescription(inspection) + "\r\n\r\n" + T("停止服务并退出吗？未完成任务会中断，可按已有检查点恢复。选择“否”将保留服务和任务。", "Stop the service and exit? Unfinished tasks will be interrupted and can resume from saved checkpoints. No keeps the service and tasks running.");
                if (MessageBox.Show(this, prompt, Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return 2;
            }
            SetMessage(T("正在停止服务，请等待…", "Stopping the service. Please wait…"));
            Dictionary<string, object> stopped = await bridge.CallAsync("--stop");
            if (DesktopPolicy.String(stopped, "state") != "stopped") throw new DesktopHostException("STOP_NOT_CONFIRMED", T("尚未确认服务已停止，窗口保留。", "Service shutdown has not been confirmed. The window remains open."));
            serviceStarted = false; await DisposeBrowserAsync(); return 0;
        } catch (Exception error) { ShowFailure(error); return 3; }
    }
    private async Task DisposeBrowserAsync()
    {
        foreach (Form popup in new List<Form>(children)) popup.Close();
        if (web != null) { web.Dispose(); web = null; }
        if (browserCreated && browserExited != null && !browserExited.Task.IsCompleted) {
            Task finished = await Task.WhenAny(browserExited.Task, Task.Delay(15000));
            if (finished != browserExited.Task) throw new DesktopHostException("WEBVIEW_EXIT_TIMEOUT", T("WebView2仍在退出，窗口保留。请稍后再次停止并退出。", "WebView2 is still exiting. The window remains open. Try Stop and exit again shortly."));
        }
        browserCreated = false;
    }
    public void CloseAfterStop() { allowClose = true; tray.Visible = false; Close(); }
}

internal static class WorkbenchDesktop
{
    private static string DataDirectory()
    {
        string configured = Environment.GetEnvironmentVariable("DEMO_DATA_DIR");
        string local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (String.IsNullOrWhiteSpace(local)) local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.GetFullPath(String.IsNullOrWhiteSpace(configured) ? Path.Combine(local, "MSSQualityWorkbench", "portable") : configured);
    }
    [STAThread]
    private static int Main(string[] args)
    {
        bool installExit = (args.Length == 1 || args.Length == 3 && args[1] == "--home") && args[0] == "--exit-for-install";
        string root = installExit && args.Length == 3 ? Path.GetFullPath(args[2]) : AppDomain.CurrentDomain.BaseDirectory, language = DesktopPolicy.Language(root, CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
        try {
            if (args.Length == 2 && args[0] == "--diagnostics") {
                string runtime = ""; try { runtime = CoreWebView2Environment.GetAvailableBrowserVersionString(null); } catch (WebView2RuntimeNotFoundException) { }
                File.WriteAllText(Path.GetFullPath(args[1]), new JavaScriptSerializer().Serialize(new { runtimeAvailable = runtime.Length > 0, runtimeVersion = runtime, language = language, root = root, dataDir = DataDirectory(), architecture = Environment.Is64BitProcess ? "x64" : "x86" }), new UTF8Encoding(false)); return 0;
            }
            if (args.Length != 0 && !installExit) return 5;
            string key = DesktopPolicy.InstanceKey(root, WindowsIdentity.GetCurrent().User.Value), mutexName = "Local\\MSSQualityWorkbench.Desktop." + key;
            if (installExit) {
                Mutex existing; if (!Mutex.TryOpenExisting(mutexName, out existing)) return 0;
                using (existing) {
                    int code = DesktopInstancePipe.Send(key, "exit-install", 235000); if (code != 0) return code;
                    try { if (!existing.WaitOne(15000)) return 4; existing.ReleaseMutex(); } catch (AbandonedMutexException) { existing.ReleaseMutex(); }
                    return 0;
                }
            }
            bool owner;
            using (Mutex mutex = new Mutex(true, mutexName, out owner)) {
                if (!owner) return DesktopInstancePipe.Send(key, "activate", 15000);
                try {
                    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
                    using (WorkbenchWindow window = new WorkbenchWindow(root, language, DataDirectory())) {
                        IntPtr handle = window.Handle;
                        using (DesktopInstancePipe pipe = new DesktopInstancePipe(key, window)) Application.Run(window);
                    }
                } finally { mutex.ReleaseMutex(); }
            }
            return 0;
        } catch (Exception error) {
            if (!installExit) MessageBox.Show((language == "en" ? "Desktop startup failed. The existing browser start/stop launchers are still available.\r\n" : "桌面启动未完成，可继续使用原有浏览器启动/停止入口。\r\n") + error.Message, language == "en" ? "Quality Workbench" : "会话质检工作台", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 3;
        }
    }
}
