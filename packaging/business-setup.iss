#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef PackageOutput
  #error PackageOutput is required
#endif
#ifndef ProductVersion
  #error ProductVersion is required
#endif
#ifndef IntegrityInclude
  #error IntegrityInclude is required
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
english.IntegrityChecking=Verifying all installed program files...
chinesesimp.IntegrityChecking=正在校验全部安装文件…
english.IntegrityFailed=Installation incomplete — verification failed
chinesesimp.IntegrityFailed=安装不完整：文件校验失败
english.IntegrityRepair=Run this installer again to repair it. Your business data will not be lost. If the same files keep disappearing, ask IT to check application-control or antivirus events. Details:
chinesesimp.IntegrityRepair=请重新运行本安装包即可修复，业务数据不会丢失。若同一文件反复缺失，请联系IT检查应用控制或安全软件事件。问题文件：
english.IntegrityPassed=All installed program files passed verification.
chinesesimp.IntegrityPassed=全部安装文件校验通过。

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopShortcut}"; Flags: checkedonce

[Files]
; Recovery runs trusted copies from THIS installer, not a possibly incomplete installation.
Source: "{#PayloadDir}\runtime\node\node.exe"; Flags: dontcopy
Source: "{#PayloadDir}\packaging\portable-launch.mjs"; Flags: dontcopy
Source: "{#PayloadDir}\packaging\portable-runtime.mjs"; Flags: dontcopy
Source: "{#PayloadDir}\packaging\startup-diagnostics.mjs"; Flags: dontcopy
Source: "{#PayloadDir}\packaging\version.mjs"; Flags: dontcopy
Source: "{#PayloadDir}\QualityWorkbench.exe"; Flags: dontcopy
Source: "{#PayloadDir}\Microsoft.Web.WebView2.Core.dll"; Flags: dontcopy
Source: "{#PayloadDir}\Microsoft.Web.WebView2.WinForms.dll"; Flags: dontcopy
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
Filename: "{app}\QualityWorkbench.exe"; Description: "{cm:OpenWorkbench}"; Flags: nowait postinstall skipifsilent; Check: InstallationVerified

[UninstallRun]
Filename: "{app}\runtime\node\node.exe"; Parameters: """{app}\packaging\portable-launch.mjs"" --stop-installation"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "StopVerifiedOwnRuntime"

[Code]
var
  IntegrityFailures, IntegrityReport: String;
  IntegrityChecked: Integer;
  IntegrityPassed: Boolean;
  IntegrityMemo: TNewMemo;

function InstallationVerified: Boolean;
begin
  Result := IntegrityPassed;
end;

procedure CheckInstalledFile(RelativePath, ExpectedHash: String);
var
  Filename, Issue: String;
begin
  IntegrityChecked := IntegrityChecked + 1;
  Filename := AddBackslash(ExpandConstant('{app}')) + RelativePath;
  Issue := '';
  if not FileExists(Filename) then
    Issue := 'MISSING: ' + RelativePath
  else begin
    try
      if CompareText(GetSHA256OfFile(Filename), ExpectedHash) <> 0 then
        Issue := 'HASH_MISMATCH: ' + RelativePath;
    except
      Issue := 'UNREADABLE: ' + RelativePath;
    end;
  end;
  if Issue <> '' then begin
    IntegrityFailures := IntegrityFailures + Issue + #13#10;
    Log(Issue);
  end;
end;

procedure CheckInstalledLanguage;
begin
  IntegrityChecked := IntegrityChecked + 1;
  if GetIniString('Desktop', 'Language', '', ExpandConstant('{app}\desktop-language.ini')) <> ActiveLanguage then
    IntegrityFailures := IntegrityFailures + 'INVALID_SETTING: desktop-language.ini' + #13#10;
end;

#include IntegrityInclude

procedure CurStepChanged(CurStep: TSetupStep);
var
  RepairInfo, Summary: String;
begin
  if CurStep = ssPostInstall then begin
    WizardForm.StatusLabel.Caption := CustomMessage('IntegrityChecking');
    VerifyInstalledPayload;
    IntegrityPassed := IntegrityFailures = '';
    Summary := 'version={#ProductVersion}' + #13#10 + 'checked=' + IntToStr(IntegrityChecked) + #13#10;
    if IntegrityPassed then Summary := Summary + 'status=passed' else Summary := Summary + 'status=failed';
    IntegrityReport := ExpandConstant('{app}\installation-verification.txt');
    if not SaveStringToFile(IntegrityReport, UTF8Encode(Summary + #13#10 + IntegrityFailures), False) then begin
      IntegrityReport := ExpandConstant('{tmp}\installation-verification.txt');
      SaveStringToFile(IntegrityReport, UTF8Encode(Summary + #13#10 + IntegrityFailures), False);
    end;
    Log(Summary + ' report=' + IntegrityReport);
    if IntegrityPassed then begin
      RepairInfo := ExpandConstant('{app}\installer-repair.ini');
      SetIniString('Repair', 'Installer', ExpandConstant('{srcexe}'), RepairInfo);
      SetIniString('Repair', 'SHA256', GetSHA256OfFile(ExpandConstant('{srcexe}')), RepairInfo);
      SetIniString('Repair', 'Version', '{#ProductVersion}', RepairInfo);
    end;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then begin
    if not IntegrityPassed then begin
      WizardForm.FinishedHeadingLabel.Caption := CustomMessage('IntegrityFailed');
      WizardForm.FinishedLabel.Caption := CustomMessage('IntegrityRepair');
      WizardForm.RunList.Visible := False;
      IntegrityMemo := TNewMemo.Create(WizardForm);
      IntegrityMemo.Parent := WizardForm.FinishedPage;
      IntegrityMemo.Left := WizardForm.FinishedLabel.Left;
      IntegrityMemo.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(8);
      IntegrityMemo.Width := WizardForm.FinishedLabel.Width;
      IntegrityMemo.Height := WizardForm.FinishedPage.ClientHeight - IntegrityMemo.Top - ScaleY(8);
      IntegrityMemo.ScrollBars := ssVertical;
      IntegrityMemo.ReadOnly := True;
      IntegrityMemo.Text := IntegrityFailures + #13#10 + IntegrityReport;
    end else WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10 + CustomMessage('IntegrityPassed');
  end;
end;

function GetCustomSetupExitCode: Integer;
begin
  if IntegrityPassed then Result := 0 else Result := 12;
end;

function DefaultProgramDirectory(Param: String): String;
begin
  if DirExists('D:\') then
    Result := 'D:\MSSQualityWorkbench'
  else
    Result := ExpandConstant('{localappdata}\Programs\MSSQualityWorkbench');
end;

function StopOwnRuntime(UseBundledTools: Boolean; var Failure: String): Boolean;
var
  NodePath, ScriptPath, ShellPath: String;
  ResultCode: Integer;
begin
  Result := True;
  Failure := '';
  ShellPath := ExpandConstant('{app}\QualityWorkbench.exe');
  NodePath := ExpandConstant('{app}\runtime\node\node.exe');
  ScriptPath := ExpandConstant('{app}\packaging\portable-launch.mjs');
  if UseBundledTools then begin
    ExtractTemporaryFile('node.exe');
    ExtractTemporaryFile('portable-launch.mjs');
    ExtractTemporaryFile('portable-runtime.mjs');
    ExtractTemporaryFile('startup-diagnostics.mjs');
    ExtractTemporaryFile('version.mjs');
    ExtractTemporaryFile('QualityWorkbench.exe');
    ExtractTemporaryFile('Microsoft.Web.WebView2.Core.dll');
    ExtractTemporaryFile('Microsoft.Web.WebView2.WinForms.dll');
    ShellPath := ExpandConstant('{tmp}\QualityWorkbench.exe');
    NodePath := ExpandConstant('{tmp}\node.exe');
    ScriptPath := ExpandConstant('{tmp}\portable-launch.mjs');
  end;
  if FileExists(ShellPath) then begin
    if not Exec(ShellPath, '--exit-for-install --home "' + ExpandConstant('{app}') + '"', ExtractFileDir(ShellPath), SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
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
  if not FileExists(NodePath) and not FileExists(ScriptPath) then
    Exit;
  if not FileExists(NodePath) or not FileExists(ScriptPath) then begin
    Result := False;
    Failure := CustomMessage('IncompleteInstallation');
    Exit;
  end;
  if not Exec(NodePath, '"' + ScriptPath + '" --stop-installation --home "' + ExpandConstant('{app}') + '"', ExtractFileDir(NodePath), SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
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
  if not DirExists(ExpandConstant('{app}')) then
    if not ForceDirectories(ExpandConstant('{app}')) then begin
      Result := CustomMessage('StopCommandFailed');
      Exit;
    end;
  if not StopOwnRuntime(True, Failure) then
    Result := Failure;
end;

function InitializeUninstall(): Boolean;
var
  Failure: String;
begin
  Result := StopOwnRuntime(False, Failure);
  if not Result then
    Log(Failure);
end;
