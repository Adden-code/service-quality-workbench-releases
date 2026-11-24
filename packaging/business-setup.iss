#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef PackageOutput
  #error PackageOutput is required
#endif
#ifndef ProductVersion
  #error ProductVersion is required
#endif

[Setup]
AppId={{92F2894F-E647-4F16-9F59-CFB5A52C573C}
AppName={cm:ProductName}
AppVersion={#ProductVersion}
AppVerName={cm:ProductName} {#ProductVersion}
AppPublisher=MSS
DefaultDirName={code:DefaultProgramDirectory}
DefaultGroupName=Quality Workbench
DisableDirPage=no
DisableProgramGroupPage=no
AllowNoIcons=yes
PrivilegesRequired=lowest
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#PackageOutput}
OutputBaseFilename=会话质检工作台_{#ProductVersion}_Windows_x64_完整安装包
DiskSpanning=no
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={cm:ProductName}
UninstallDisplayIcon={app}\QualityWorkbench.exe
CloseApplications=no
RestartApplications=no
SetupLogging=yes
ShowLanguageDialog=yes
LanguageDetectionMethod=uilanguage
UsePreviousLanguage=yes
InfoBeforeFile={#PayloadDir}\Read Me First.txt

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"; InfoBeforeFile: "{#PayloadDir}\User Guide (English).txt"
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"; InfoBeforeFile: "{#PayloadDir}\使用说明.txt"

[CustomMessages]
english.ProductName=Quality Workbench
chinesesimp.ProductName=会话质检工作台
english.CreateDesktopShortcut=Create a desktop shortcut
chinesesimp.CreateDesktopShortcut=创建桌面快捷方式
english.OpenWorkbench=Open Quality Workbench
chinesesimp.OpenWorkbench=打开会话质检工作台
english.IncompleteInstallation=The existing installation is incomplete. Stop it using its original launcher, restore its program files, then try again.
chinesesimp.IncompleteInstallation=现有程序文件不完整。请先用原程序停止服务并恢复完整文件后重试。
english.StopCommandFailed=The stop command could not run. Stop the current application, then try again.
chinesesimp.StopCommandFailed=无法运行当前目录的停止命令。请先停止该程序后重试。
english.RuntimeIdentityMismatch=The service could not stop or its installation identity did not match. Program files have not been changed. Stop the running application using its own stop launcher, then try again.
chinesesimp.RuntimeIdentityMismatch=服务未能停止或身份与当前目录不匹配，未修改程序。请先用正在运行的旧程序自带停止入口停止服务后重试。

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopShortcut}"; Flags: checkedonce

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[INI]
Filename: "{app}\desktop-language.ini"; Section: "Desktop"; Key: "Language"; String: "{language}"; Flags: uninsdeleteentry uninsdeletesectionifempty

[Icons]
Name: "{userdesktop}\会话质检工作台"; Filename: "{app}\QualityWorkbench.exe"; WorkingDir: "{app}"; Tasks: desktopicon; Languages: chinesesimp
Name: "{userdesktop}\Quality Workbench"; Filename: "{app}\QualityWorkbench.exe"; WorkingDir: "{app}"; Tasks: desktopicon; Languages: english
Name: "{group}\会话质检工作台"; Filename: "{app}\QualityWorkbench.exe"; WorkingDir: "{app}"; Languages: chinesesimp
Name: "{group}\浏览器启动（备用）"; Filename: "{app}\启动会话质检工作台.exe"; WorkingDir: "{app}"; Languages: chinesesimp
Name: "{group}\停止会话质检工作台"; Filename: "{app}\停止会话质检工作台.exe"; WorkingDir: "{app}"; Languages: chinesesimp
Name: "{group}\使用说明"; Filename: "{app}\使用说明.txt"; Languages: chinesesimp
Name: "{group}\User Guide (English)"; Filename: "{app}\User Guide (English).txt"; Languages: english
Name: "{group}\Quality Workbench"; Filename: "{app}\QualityWorkbench.exe"; Languages: english
Name: "{group}\Browser start (fallback)"; Filename: "{app}\Start Quality Workbench.exe"; Languages: english
Name: "{group}\Stop Quality Workbench"; Filename: "{app}\Stop Quality Workbench.exe"; Languages: english
Name: "{group}\卸载会话质检工作台"; Filename: "{uninstallexe}"; Languages: chinesesimp
Name: "{group}\Uninstall Quality Workbench"; Filename: "{uninstallexe}"; Languages: english

[Run]
Filename: "{app}\QualityWorkbench.exe"; Description: "{cm:OpenWorkbench}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\packaging\portable-launch.mjs"" --stop-installation"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopVerifiedOwnRuntime"

[Code]
function DefaultProgramDirectory(Param: String): String;
begin
  if DirExists('D:\') then
    Result := 'D:\MSSQualityWorkbench'
  else
    Result := ExpandConstant('{localappdata}\Programs\MSSQualityWorkbench');
end;

function StopOwnRuntime(var Failure: String): Boolean;
var
  NodePath, ScriptPath, ShellPath: String;
  ResultCode: Integer;
begin
  Result := True;
  Failure := '';
  ShellPath := ExpandConstant('{app}\QualityWorkbench.exe');
  if FileExists(ShellPath) then begin
    if not Exec(ShellPath, '--exit-for-install', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
      Result := False;
      Failure := CustomMessage('StopCommandFailed');
      Exit;
    end;
    if ResultCode <> 0 then begin
      Result := False;
      Failure := CustomMessage('RuntimeIdentityMismatch');
      Exit;
    end;
  end;
  NodePath := ExpandConstant('{app}\runtime\node\node.exe');
  ScriptPath := ExpandConstant('{app}\packaging\portable-launch.mjs');
  if not FileExists(NodePath) and not FileExists(ScriptPath) then
    Exit;
  if not FileExists(NodePath) or not FileExists(ScriptPath) then begin
    Result := False;
    Failure := CustomMessage('IncompleteInstallation');
    Exit;
  end;
  if not Exec(NodePath, '"' + ScriptPath + '" --stop-installation', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    Result := False;
    Failure := CustomMessage('StopCommandFailed');
  end else if ResultCode <> 0 then begin
    Result := False;
    Failure := CustomMessage('RuntimeIdentityMismatch');
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Failure: String;
begin
  Result := '';
  if not StopOwnRuntime(Failure) then
    Result := Failure;
end;

function InitializeUninstall(): Boolean;
var
  Failure: String;
begin
  Result := StopOwnRuntime(Failure);
  if not Result then
    Log(Failure);
end;
