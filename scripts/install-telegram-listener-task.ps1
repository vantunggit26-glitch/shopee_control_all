$ErrorActionPreference = 'Stop'

$taskName = 'ShopeeControlTelegramListener'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDirectory = Join-Path $projectRoot '.telegram'
$envFile = Join-Path $projectRoot '.env.telegram.local'
$sessionFile = Join-Path $runtimeDirectory 'session.txt'
$serviceAccountFile = Join-Path $runtimeDirectory 'firebase-service-account.json'
$runnerFile = Join-Path $PSScriptRoot 'run-telegram-listener.ps1'

if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing $envFile" }
if (-not (Test-Path -LiteralPath $sessionFile)) { throw 'Run npm run telegram:listen once to sign in first.' }
if (-not (Test-Path -LiteralPath $serviceAccountFile)) { throw "Missing $serviceAccountFile" }

$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$actionArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerFile`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $actionArguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Listen to Telegram messages and save filtered todos to Firestore.' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -ne 'Running') { throw "Task installation completed but start failed. State: $($task.State)" }
Write-Host 'Telegram listener scheduled task installed and started.'
