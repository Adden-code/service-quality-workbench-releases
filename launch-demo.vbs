Option Explicit
Dim shell, files, folder, command, result, noOpen
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & "D:\NodeJs\node.exe" & Chr(34) & " " & Chr(34) & folder & "\launch-demo.mjs" & Chr(34)
noOpen = False
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--no-open" Then
    noOpen = True
    command = command & " --no-open"
  End If
End If
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then result = 1
On Error GoTo 0
If result <> 0 Then
  If noOpen Then
    WScript.Echo "Demo launch failed. Check launcher-error.log in the project folder."
  Else
    MsgBox "Demo could not start. Please ask Codex to check launcher-error.log in the project folder.", 48, "Service Quality Demo"
  End If
End If
WScript.Quit result
