$ErrorActionPreference = 'Stop'

$taskName = 'ShopeeControlTelegramListener'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  & (Join-Path $PSScriptRoot 'install-telegram-listener-task.ps1')
  exit $LASTEXITCODE
}

if ($task.State -eq 'Running') {
  Write-Host 'Telegram listener task is already running.'
  exit 0
}

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -ne 'Running') { throw "Telegram listener task failed to start. State: $($task.State)" }
Write-Host 'Telegram listener task started.'
