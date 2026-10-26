' 大肥鱼桌宠 · 启动器
'
' 双击本文件即可。三种情况都走这里：
'   已装好      -> 无窗口静默启动
'   还没装运行时 -> 提示一下，自动调 安装.bat 下载（约 100MB），装完自动启动
'   文件不全     -> 直接说清楚缺什么

Option Explicit

Dim fso, sh, root, exePath, appDir, inst

Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

exePath = root & "\runtime\electron\electron.exe"
appDir = root & "\desktop"
inst = root & "\安装.bat"

If Not fso.FileExists(exePath) Then
  If Not fso.FileExists(inst) Then
    MsgBox "找不到运行时，也找不到 安装.bat。" & vbCrLf & vbCrLf & _
           "请确认整个文件夹都解压完整（不是只拷了其中一部分）。", 16, "大肥鱼桌宠"
    WScript.Quit 1
  End If
  MsgBox "第一次启动，需要先下载运行时（约 100MB，一般 20 秒内）。" & vbCrLf & vbCrLf & _
         "点「确定」开始安装，装好会自动把鱼放出来；" & vbCrLf & _
         "以后再双击本文件就是秒开。", 64, "大肥鱼桌宠"
  Set sh = CreateObject("WScript.Shell")
  sh.Run """" & inst & """", 1, False
  WScript.Quit 0
End If

Set sh = CreateObject("WScript.Shell")
On Error Resume Next
' 有些编辑器/终端会把 ELECTRON_RUN_AS_NODE 塞进环境，那样 electron 会当成 node 跑
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
On Error GoTo 0

sh.Run """" & exePath & """ """ & appDir & """", 0, False
