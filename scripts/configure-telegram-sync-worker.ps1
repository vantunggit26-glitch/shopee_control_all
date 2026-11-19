$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$wranglerConfig = Join-Path $projectRoot 'cloudflare/telegram-sync-trigger/wrangler.jsonc'

Set-Location -LiteralPath $projectRoot
Write-Host ''
Write-Host 'Paste the fine-grained GitHub token when Wrangler asks for the secret value.' -ForegroundColor Cyan
Write-Host 'The input is hidden and will be sent directly to Cloudflare.' -ForegroundColor DarkGray
Write-Host ''

& npx -y wrangler@latest secret put GITHUB_TOKEN --config $wranglerConfig
if ($LASTEXITCODE -ne 0) {
  throw "Wrangler secret command failed with exit code $LASTEXITCODE."
}

Write-Host ''
Write-Host 'GitHub token saved as a Cloudflare Worker Secret.' -ForegroundColor Green
Read-Host 'Press Enter to close this window'
