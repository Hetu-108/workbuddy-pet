@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 清掉可能被外部环境塞进来的 ELECTRON_RUN_AS_NODE，否则 electron 会当成 node 跑
set ELECTRON_RUN_AS_NODE=
echo 正在启动大肥鱼桌宠...
start "" "%~dp0runtime\electron\electron.exe" "%~dp0desktop"
