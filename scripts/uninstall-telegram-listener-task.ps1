$ErrorActionPreference = 'Stop'

$taskName = 'ShopeeControlTelegramListener'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host 'Telegram listener task is not installed.'
  exit 0
}

if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName }
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host 'Telegram listener scheduled task removed.'
