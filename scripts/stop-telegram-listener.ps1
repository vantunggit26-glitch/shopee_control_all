$ErrorActionPreference = 'Stop'

$taskName = 'ShopeeControlTelegramListener'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host 'Telegram listener task is not installed.'
  exit 0
}

if ($task.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 1
}

Write-Host 'Telegram listener task stopped.'
