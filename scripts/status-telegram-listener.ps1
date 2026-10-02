$taskName = 'ShopeeControlTelegramListener'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host 'Telegram listener task: not installed.'
  exit 1
}

$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host "Telegram listener task: $($task.State)."
Write-Host "Last result: $($taskInfo.LastTaskResult)."
Write-Host "Last run: $($taskInfo.LastRunTime)."
Write-Host "Next run: $($taskInfo.NextRunTime)."
if ($task.State -eq 'Running') { exit 0 }
exit 1
