using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Text;
using System.Windows.Forms;

internal static class PortableLauncher
{
    private static string Text(string chinese, string english)
    {
        return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh" ? chinese : english;
    }
    [STAThread]
    private static int Main(string[] args)
    {
        bool stopping = args.Contains("--stop");
#if STOP_BUILD
        stopping = true;
#endif
        bool status = args.Contains("--status");
        bool noOpen = args.Contains("--no-open");
        try
        {
            if (args.Any(value => value != "--stop" && value != "--status" && value != "--no-open") || (stopping && status))
                throw new Exception(Text("支持参数：--no-open、--status、--stop。", "Supported options: --no-open, --status, --stop."));
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "runtime", "node", "node.exe");
            string script = Path.Combine(root, "packaging", "portable-launch.mjs");
            if (!File.Exists(node) || !File.Exists(script))
                throw new FileNotFoundException(Text("便携文件不完整，请重新解压完整启动包。无需另行安装Node或Java。", "Application files are incomplete. Reinstall the complete package; no separate Node or Java installation is required."));
            string command = "\"" + script + "\"" + (stopping ? " --stop" : status ? " --status" : noOpen ? " --no-open" : "");
            ProcessStartInfo start = new ProcessStartInfo(node, command);
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.StandardOutputEncoding = Encoding.UTF8;
            start.StandardErrorEncoding = Encoding.UTF8;
            start.EnvironmentVariables["WORKBENCH_LAUNCHER_LANGUAGE"] = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh" ? "zh" : "en";
            using (Process child = Process.Start(start))
            {
                // The command prints only a short safe status; the detached supervisor inherits no pipes.
                StringBuilder output = new StringBuilder();
                StringBuilder errors = new StringBuilder();
                child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs line) { if (line.Data != null) output.AppendLine(line.Data); };
                child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs line) { if (line.Data != null) errors.AppendLine(line.Data); };
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                if (!child.WaitForExit(195000))
                {
                    // This is the command child we created, never an enumerated service process.
                    child.Kill();
                    throw new Exception(Text("便携启动检查超时，请查看数据目录logs/portable-startup.log。", "Startup timed out. See logs/portable-startup.log in the data directory."));
                }
                child.WaitForExit();
                if (child.ExitCode != 0)
                    throw new Exception(errors.Length > 0 ? Text("程序命令未能完成：", "The application command could not complete: ") + errors.ToString().Trim() : Text("便携服务未能启动，请查看数据目录logs/portable-startup.log。", "The service could not start. See logs/portable-startup.log in the data directory."));
                Console.Write(output.ToString());
            }
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.Message);
            if (!noOpen && !status && !stopping)
                MessageBox.Show(exception.Message, Text("会话质检工作台 · 便携启动提示", "Quality Workbench - Startup"), MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }
}
