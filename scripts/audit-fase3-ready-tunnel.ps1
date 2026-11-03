# Abre túneles SSH a Postgres/Redis de Railway y lanza audit-fase3-ready.
# Uso:
#   npm run audit:fase3-ready:tunnel
#   npm run audit:fase3-ready:tunnel -- --json

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pgPort = 5433
$redisPort = 6380
$extraArgs = $args

function Get-TunnelUrlFromOutput([string]$text, [string]$scheme) {
  if ($text -match ("URL:\s+(" + [regex]::Escape($scheme) + "://\S+)")) {
    return $Matches[1].Trim()
  }
  return $null
}

Write-Host "Registrando/abriendo túneles Railway (SSH)..."
$pgJob = Start-Job -ScriptBlock {
  param($port)
  railway connect Postgres --tunnel-only --ssh -P $port 2>&1
} -ArgumentList $pgPort

$redisJob = Start-Job -ScriptBlock {
  param($port)
  railway connect Redis --tunnel-only --ssh -P $port 2>&1
} -ArgumentList $redisPort

$pgUrl = $null
$redisUrl = $null
$deadline = (Get-Date).AddSeconds(45)

while ((Get-Date) -lt $deadline -and (-not $pgUrl -or -not $redisUrl)) {
  Start-Sleep -Seconds 1
  if (-not $pgUrl) {
    $pgUrl = Get-TunnelUrlFromOutput ((Receive-Job $pgJob -Keep) -join "`n") 'postgresql'
  }
  if (-not $redisUrl) {
    $redisUrl = Get-TunnelUrlFromOutput ((Receive-Job $redisJob -Keep) -join "`n") 'redis'
  }
}

if (-not $pgUrl -or -not $redisUrl) {
  Stop-Job $pgJob, $redisJob -ErrorAction SilentlyContinue
  Remove-Job $pgJob, $redisJob -Force -ErrorAction SilentlyContinue
  throw "No se pudieron abrir los túneles. ¿railway ssh keys add -k ~/.ssh/id_ed25519.pub?"
}

Write-Host "Túneles OK. Ejecutando auditoría..."
$env:RAILWAY_PG_TUNNEL_URL = $pgUrl
$env:RAILWAY_REDIS_TUNNEL_URL = $redisUrl

try {
  railway run --service bot-localizer npm run audit:fase3-ready -- @extraArgs
  $code = $LASTEXITCODE
} finally {
  Stop-Job $pgJob, $redisJob -ErrorAction SilentlyContinue
  Remove-Job $pgJob, $redisJob -Force -ErrorAction SilentlyContinue
}

exit $code
