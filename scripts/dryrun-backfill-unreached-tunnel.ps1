# Abre túneles SSH a Postgres/Redis de Railway y lanza dry-run de backfill + audit fase3.
# Uso:
#   npm run dryrun:backfill-unreached:tunnel
#   npm run dryrun:backfill-unreached:tunnel -- --skip-audit

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pgPort = 5433
$redisPort = 6380
$skipAudit = $args -contains '--skip-audit'

function Get-TunnelUrlFromOutput([string]$text, [string]$scheme) {
  if ($text -match ("URL:\s+(" + [regex]::Escape($scheme) + "://\S+)")) {
    return $Matches[1].Trim()
  }
  return $null
}

Write-Host "Opening Railway SSH tunnels (read-only dry-run)..."
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
$deadline = (Get-Date).AddSeconds(60)

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
  throw "Could not open Railway tunnels. Check railway login / ssh keys."
}

Write-Host "Tunnels OK."
$env:RAILWAY_PG_TUNNEL_URL = $pgUrl
$env:RAILWAY_REDIS_TUNNEL_URL = $redisUrl

$code = 0
try {
  Write-Host ""
  Write-Host "=== DRY-RUN BACKFILL FASE 3 (Sheet + quota) ==="
  railway run --service bot-localizer npm run dryrun:backfill-unreached
  if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }

  if (-not $skipAudit) {
    Write-Host ""
    Write-Host "=== AUDIT FASE 3 READY (DB + BullMQ) ==="
    railway run --service bot-localizer npm run audit:fase3-ready -- --json
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
  }
} finally {
  Stop-Job $pgJob, $redisJob -ErrorAction SilentlyContinue
  Remove-Job $pgJob, $redisJob -Force -ErrorAction SilentlyContinue
}

exit $code
