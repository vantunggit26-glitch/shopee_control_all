$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDirectory = Join-Path $projectRoot '.telegram'
$logsDirectory = Join-Path $runtimeDirectory 'logs'
$envFile = Join-Path $projectRoot '.env.telegram.local'
$listenerFile = Join-Path $projectRoot 'scripts/telegram-listener.js'
$outputLog = Join-Path $logsDirectory 'output.log'
$errorLog = Join-Path $logsDirectory 'error.log'
$nodePath = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $logsDirectory | Out-Null
Set-Location -LiteralPath $projectRoot
& $nodePath "--env-file=$envFile" $listenerFile 1>> $outputLog 2>> $errorLog
exit $LASTEXITCODE
