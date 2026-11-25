# Windows desktop shell

`buildDesktopShell({root, sdkDir})` from `build-desktop.mjs` compiles a staged package using the Windows .NET Framework C# compiler. `root` is the package root; `sdkDir` is the extracted Microsoft.Web.WebView2 **1.0.4370.26** NuGet root. If omitted, `sdkDir` uses `WEBVIEW2_SDK_DIR`. The builder never downloads dependencies or starts services. It verifies each SDK redistribution file against the pinned SHA-256 values before writing output. The SDK package URL and package hash are exported as `WEBVIEW2_SDK` and included in the output manifest.

```powershell
$env:WEBVIEW2_SDK_DIR = '<extracted official NuGet package>'
node packaging/build-desktop.mjs --root '<staged package>'
```

The result contains `executable`, `architecture`, `framework`, `sdk`, and `files` (relative file name, byte count, SHA-256). It emits `QualityWorkbench.exe`, its .NET configuration, three WebView2 SDK DLLs, SDK license/notice, C# source and application manifest, `desktop-shell-manifest.json`, and initial `desktop-language.ini`. It does not bundle Chromium or a WebView2 browser runtime. Windows x64, .NET Framework 4.6.2 or later, and the Microsoft Evergreen WebView2 Runtime are required. Missing Runtime is detected before starting the service; the window gives official offline installation instructions and an explicit browser fallback. Existing browser start/stop executables remain supported.

`desktop-language.ini` supports `[Desktop]` with `Language=english`, `chinesesimp`, or `auto`. Installer choice overrides OS language for the shell and WebView2 environment. Auto/absent/invalid values use Chinese for a Chinese OS and English otherwise. In-app language, concurrency and reading-layout choices remain browser-profile preferences; the first start with the new external profile uses defaults until those preferences are selected again.

## Service boundary

The shell runs bundled `runtime/node/node.exe packaging/desktop-host.mjs --inspect|--start|--stop|--recover-stale --home <root>` with a hidden child process and strict JSON stdout. It never locates or kills service processes itself. A command timeout terminates only the command child. Start waits for a verified `ready` response; stop must return `stopped`. Activity or ownership that cannot be verified requires confirmation or is refused by the service bridge. Dead-owner recovery requires confirmation; cancellation never calls recovery/start/stop.

Bridge data directory must match the shell's configured data directory. The WebView2 profile is `%LOCALAPPDATA%/MSSQualityWorkbench-shell/profile/<workspace-path-hash>`, keyed by the normalized data-directory path so independent workspaces have separate browser state. Legacy `<dataDir>/desktop-profile` remains untouched. Backup and startup recovery skip only the exact top-level legacy profile and generated `diagnostics` output before inspecting their contents or links; these paths are still forbidden in incoming backup archives. Business sources, frozen tasks and audit records remain in server workspace storage. Shutdown disposes WebViews and waits for `BrowserProcessExited`. No profile or business data is deleted.

Single instance uses installation root plus Windows user SID (independent of `DEMO_DATA_DIR`). A second launch activates the existing window. Named pipes accept commands only from the same user. Main-frame navigation remains on the verified loopback origin; outside HTTP(S) links open the default browser. Same-origin/blob popups, default downloads, file chooser, browser keyboard shortcuts, and printing remain available.

## Installer command and diagnostics

`QualityWorkbench.exe --exit-for-install` contacts an existing instance for this installation and user, requests the same graceful stop as window close, and waits for shell release. With no instance it immediately returns 0 without creating a window or starting a service. The caller's data-directory environment does not select a different shell.

Exit codes: 0 = no instance or clean shutdown/activation; 2 = user cancelled shutdown; 3 = bridge/stop/runtime failure; 4 = IPC or shutdown timeout; 5 = invalid arguments. Installer must proceed only on 0, then run the existing installation-wide service stop. Busy/unknown tasks always require user confirmation; stop failure leaves the window available with logs guidance.

`QualityWorkbench.exe --diagnostics <output.json>` writes Runtime availability/version, resolved language, root, data directory and architecture. It never calls the service bridge or creates a window. For isolated native QA, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<test-port>` may be set by the test process only; production does not enable debugging.

Run `node --test tests/desktop-shell01122.test.mjs` with the pinned SDK available. Real UI/integration tests require an isolated package and workspace. Never aim lifecycle checks at a real business workspace.

自定义业务数据目录若与默认浏览器配置路径重叠，壳会选用经目录包含检查的临时目录或业务目录父级位置，绝不把新 profile 写入业务数据目录。
