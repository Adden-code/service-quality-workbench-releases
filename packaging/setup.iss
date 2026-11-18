#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef PackageOutput
  #error PackageOutput is required
#endif

[Setup]
AppId={{BCC52644-680B-418E-89AF-B1C676E3DB8A}
AppName=会话质检工作台 · 演示版
AppVersion=0.2.0
AppVerName=会话质检工作台 · 演示版 0.2.0
AppPublisher=MSS AI产品演示
DefaultDirName={localappdata}\Programs\MSSServiceQualityDemo
DefaultGroupName=会话质检工作台演示版
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#PackageOutput}
OutputBaseFilename=会话质检工作台_演示版_0.2.0_Windows_x64_安装包
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=会话质检工作台演示版
UninstallDisplayIcon={app}\会话质检工作台.exe
CloseApplications=no
RestartApplications=no
SetupLogging=yes
InfoBeforeFile={#PayloadDir}\使用说明.txt

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面演示快捷方式"; Flags: checkedonce

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userdesktop}\会话质检工作台演示版"; Filename: "{app}\会话质检工作台.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{group}\会话质检工作台演示版"; Filename: "{app}\会话质检工作台.exe"; WorkingDir: "{app}"
Name: "{group}\停止演示服务"; Filename: "{app}\会话质检工作台.exe"; Parameters: "--stop"; WorkingDir: "{app}"
Name: "{group}\卸载演示版"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\会话质检工作台.exe"; Description: "打开会话质检工作台演示版"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\会话质检工作台.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopOwnRuntime"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\会话质检工作台.exe')) then
    if not Exec(ExpandConstant('{app}\会话质检工作台.exe'), '--stop', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      Result := '请先关闭当前演示服务后重试。';
end;
