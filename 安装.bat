@echo off
setlocal
title 大肥鱼桌宠 · 安装

rem ============================================================
rem  大肥鱼桌宠 一键安装（纯 cmd，不依赖 PowerShell / Node）
rem    1) 检查 runtime\electron\electron.exe
rem    2) 没有就从国内镜像下载 Electron 运行时并解压
rem    3) 注册登录自启（计划任务；失败则写启动文件夹）
rem    4) 启动
rem  重跑本脚本是安全的：已装的会跳过，只补缺的部分。
rem ============================================================

set "VER=38.8.6"
set "ZIPNAME=electron-v%VER%-win32-x64.zip"
set "MIRROR=https://registry.npmmirror.com/-/binary/electron/%VER%/%ZIPNAME%"
set "FALLBACK=https://github.com/electron/electron/releases/download/v%VER%/%ZIPNAME%"

if not defined WBPET_HOME set "WBPET_HOME=%~dp0"
if "%WBPET_HOME:~-1%"=="\" set "WBPET_HOME=%WBPET_HOME:~0,-1%"

set "EXE=%WBPET_HOME%\runtime\electron\electron.exe"
set "APPDIR=%WBPET_HOME%\desktop"
set "DST=%WBPET_HOME%\runtime\electron"
set "TMPZIP=%TEMP%\wbpet-electron.zip"
set "TMPX=%TEMP%\wbpet-electron-x"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTVBS=%STARTUP%\大肥鱼桌宠.vbs"

echo.
echo  ============================================================
echo    大肥鱼桌宠  ·  安装
echo    位置 %WBPET_HOME%
echo  ============================================================
echo.

if exist "%EXE%" (
  echo  [OK] 运行时已就绪，跳过下载
  goto :autostart
)

if not exist "%WBPET_HOME%\assets\webm" (
  echo  [!] 找不到 assets\webm，压缩包可能没解压完整
  echo      请先把整个压缩包解压到一个文件夹，再双击本脚本
  echo.
  pause
  exit /b 1
)

where curl >nul 2>&1
if errorlevel 1 goto :nocurl

echo  [1/4] 下载运行时（约 100MB，通常 20 秒内）
echo        国内镜像 registry.npmmirror.com
echo.
del /f /q "%TMPZIP%" >nul 2>&1
curl -L --fail --retry 2 --connect-timeout 15 -# -o "%TMPZIP%" "%MIRROR%"
if not exist "%TMPZIP%" goto :dlfail
for %%A in ("%TMPZIP%") do if %%~zA LSS 50000000 goto :dlfail

echo.
echo  [2/4] 解压并安装（约 10-30 秒，请稍候）
if exist "%TMPX%" rd /s /q "%TMPX%"
mkdir "%TMPX%" 2>nul
"%SystemRoot%\System32\tar.exe" -xf "%TMPZIP%" -C "%TMPX%"
if errorlevel 1 (
  echo  [!] 解压失败，改用系统 PowerShell 解压...
  powershell -NoProfile -Command "Expand-Archive -LiteralPath '%TMPZIP%' -DestinationPath '%TMPX%' -Force"
)

set "SRC="
if exist "%TMPX%\electron.exe" set "SRC=%TMPX%"
if not defined SRC (
  for /d %%D in ("%TMPX%\*") do if exist "%%~fD\electron.exe" set "SRC=%%~fD"
)
if not defined SRC goto :unzipfail

if not exist "%DST%" mkdir "%DST%"
robocopy "%SRC%" "%DST%" /E /MOVE /NFL /NDL /NJH /NJS /NP /R:1 /W:1 >nul
if not exist "%EXE%" goto :unzipfail

del /f /q "%TMPZIP%" >nul 2>&1
rd /s /q "%TMPX%" >nul 2>&1
echo  [OK] 运行时安装完成

:autostart
echo.
echo  [3/4] 注册开机自启
schtasks /create /tn "WBPet" /tr "\"%EXE%\" \"%APPDIR%\"" /sc onlogon /delay 0000:08 /rl limited /f >nul 2>&1
if errorlevel 1 goto :auto_folder
echo        [OK] 已创建计划任务 WBPet（登录后 8 秒自动出现）
goto :auto_clean

:auto_folder
echo        计划任务建不了，改用启动文件夹（效果一样）
if not exist "%STARTUP%" mkdir "%STARTUP%" >nul 2>&1
> "%STARTVBS%" (
  echo Set sh = CreateObject^("WScript.Shell"^)
  echo sh.Run """%EXE%"" ""%APPDIR%""", 0, False
)
if exist "%STARTVBS%" (
  echo        [OK] 已写入启动文件夹
) else (
  echo        [!] 自启注册失败。可以手动把 启动桌宠.vbs 的快捷方式放进启动文件夹
)

:auto_clean
rem 清掉老版本可能残留的轮询任务
schtasks /delete /tn "WBPet-Watch" /f >nul 2>&1

:launch
if defined WBPET_NO_LAUNCH exit /b 0
echo.
echo  [4/4] 启动桌宠
echo.
echo  ------------------------------------------------------------
echo   它会出现在屏幕右下角，不占任务栏
echo   右键鱼身 = 菜单   ·   右下角托盘 = 设置
echo   Ctrl+Alt+P 收起 / 叫出      Ctrl+Alt+Q 退出
echo  ------------------------------------------------------------
echo.
start "" /b wscript.exe "%~dp0启动桌宠.vbs"
timeout /t 3 /nobreak >nul
exit /b 0

:nocurl
echo  [!] 系统里没有 curl（需要 Windows 10 1803 及以上）
echo      手动办法：下载下面这个文件
echo        %MIRROR%
echo      解压后把里面的所有文件放进
echo        %DST%
echo      然后重新双击本脚本
echo.
pause
exit /b 1

:dlfail
echo.
echo  [!] 下载失败：镜像连不上，或文件不完整
echo.
echo      方案一：再跑一次本脚本（会重新下载）
echo      方案二：手动下载后解压到 %DST%
echo        %FALLBACK%
echo.
echo      下载完成后该目录下要能直接看到 electron.exe
echo.
del /f /q "%TMPZIP%" >nul 2>&1
pause
exit /b 1

:unzipfail
echo  [!] 解压后没找到 electron.exe
echo      临时文件留在 %TMPX%，可以手动拷贝到 %DST%
pause
exit /b 1
