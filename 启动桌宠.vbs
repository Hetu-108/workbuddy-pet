Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
On Error Resume Next
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
On Error GoTo 0
exe = root & "\runtime\electron\electron.exe"
app = root & "\desktop"
sh.Run """" & exe & """ """ & app & """", 0, False
