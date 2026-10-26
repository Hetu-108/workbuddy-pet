@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在唤起大肥鱼...
start "" /min node "%~dp0server.mjs" --port 7715 --open
timeout /t 2 >nul
echo 服务地址 http://127.0.0.1:7715/
echo 想让它跟着 WorkBuddy 联动：node install-hooks.mjs
timeout /t 3 >nul
