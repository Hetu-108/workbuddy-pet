# 大肥鱼桌宠 · 看门狗
#
# 由计划任务 WBPet-Watch 每 5 分钟瞄一眼，只在需要时做一件事：
#   WorkBuddy 新开了一次会话、而桌宠不在 → 召唤回来
#   你自己点了「退出」（留下 quit.flag）→ 一概不动，直到下次重开 WorkBuddy
#
# 手动跑一次：powershell -ExecutionPolicy Bypass -File watchdog.ps1
# 日志：%LOCALAPPDATA%\wb-pet\watchdog.log

$ErrorActionPreference = 'SilentlyContinue'

$stateDir  = Join-Path $env:LOCALAPPDATA 'wb-pet'
$quitFlag  = Join-Path $stateDir 'quit.flag'
$stateFile = Join-Path $stateDir 'watchdog.json'
$logFile   = Join-Path $stateDir 'watchdog.log'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

function Write-Log($msg) {
  Add-Content -Path $logFile -Value ('{0}  {1}' -f (Get-Date -Format 'MM-dd HH:mm:ss'), $msg) -Encoding utf8
  $all = @(Get-Content $logFile)
  if ($all.Count -gt 300) { $all[-300..-1] | Set-Content $logFile -Encoding utf8 }
}

# 同名进程里取最早启动的那个（WorkBuddy 会开一堆子进程）
function Get-EarliestStart([string]$name) {
  $list = @([System.Diagnostics.Process]::GetProcessesByName($name))
  if ($list.Count -eq 0) { return $null }
  $best = $null
  foreach ($p in $list) {
    $t = $null
    try { $t = $p.StartTime } catch { continue }
    if ($t -and (-not $best -or $t -lt $best)) { $best = $t }
  }
  return $best
}

# ---- WorkBuddy 没开就收工 ----
$wbStart = Get-EarliestStart 'WorkBuddy'
if (-not $wbStart) { exit 0 }
$key = $wbStart.ToString('o')

# ---- 换了一次 WorkBuddy 会话 → 解除「主动退出」，允许重新召唤 ----
$prev = ''
if (Test-Path $stateFile) {
  try {
    $s = Get-Content $stateFile -Raw | ConvertFrom-Json
    if ($s.wbStart) { $prev = [string]$s.wbStart }
  } catch { $prev = '' }
}
if ($prev -ne $key) {
  if (Test-Path $quitFlag) {
    Remove-Item $quitFlag -Force
    Write-Log 'WorkBuddy 新会话 → 清除「主动退出」标记'
  }
  @{ wbStart = $key } | ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8
}

# ---- 桌宠还在（通常情况）就什么都不做 ----
if (@([System.Diagnostics.Process]::GetProcessesByName('electron')).Count -gt 0) { exit 0 }

# ---- 你主动退出的，不打扰 ----
if (Test-Path $quitFlag) { exit 0 }

# ---- 召唤：触发已有计划任务，让它以「任务根进程」身份起来 ----
Start-ScheduledTask -TaskName 'WBPet'
Write-Log 'WorkBuddy 在跑、桌宠不在、且非主动退出 → 已自动召唤'
exit 0
