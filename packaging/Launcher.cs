using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string runtime = Path.GetFullPath(Path.Combine(root, "runtime", "node.exe"));
        bool headless = args.Contains("--no-open") || args.Contains("--stop");
        try
        {
            if (args.Contains("--stop"))
            {
                foreach (Process process in Process.GetProcessesByName("node"))
                {
                    using (process)
                    {
                        try
                        {
                            if (String.Equals(Path.GetFullPath(process.MainModule.FileName), runtime, StringComparison.OrdinalIgnoreCase))
                            {
                                process.Kill();
                                process.WaitForExit(5000);
                            }
                        }
                        catch (System.ComponentModel.Win32Exception) { }
                        catch (InvalidOperationException) { }
                    }
                }
                return 0;
            }
            string script = Path.Combine(root, "launch-demo.mjs");
            if (!File.Exists(runtime) || !File.Exists(script))
                throw new FileNotFoundException("安装文件不完整，请重新安装演示版。无需另行安装 Node.js。");
            ProcessStartInfo start = new ProcessStartInfo(runtime, "\"" + script + "\"" + (headless ? " --no-open" : ""));
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            using (Process child = Process.Start(start))
            {
                // The detached server may inherit pipe handles on Windows. Do not wait for pipe EOF.
                if (!child.WaitForExit(15000))
                {
                    child.Kill();
                    throw new Exception("启动检查超过15秒，请查看 launcher-error.log 后重试。");
                }
                if (child.ExitCode != 0) throw new Exception("演示服务未能启动，请查看 launcher-error.log（例如本机4186端口被其他程序占用）。");
            }
            return 0;
        }
        catch (Exception error)
        {
            try { File.AppendAllText(Path.Combine(root, "launcher-error.log"), DateTime.Now.ToString("s") + " " + error + Environment.NewLine); } catch { }
            if (!headless) MessageBox.Show(error.Message + "\n\n可查看安装目录中的 launcher-error.log。请勿关闭企业安全防护。", "会话质检工作台 · 启动提示", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }
}
