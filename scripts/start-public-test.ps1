# Path B — public testing via Cloudflare quick tunnels.
# Opens HTTPS tunnels for the backend (:3000) and web (:5173), wires the public
# URLs into all .env files, launches the backend + web dev servers, then verifies
# both public URLs over HTTP (patiently — fresh tunnel DNS can take ~30-60s).
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-public-test.ps1
# Stop:   scripts\stop-public-test.ps1  (then close the server windows)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
  $default = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path $default) { $cf = $default }
}
if (-not $cf) { Write-Error "cloudflared not found. Install: winget install --id Cloudflare.cloudflared"; exit 1 }
Write-Host "Using cloudflared: $cf" -ForegroundColor Cyan

$rx = 'https://[a-z0-9-]+\.trycloudflare\.com'

# Start one tunnel and return its URL (no churn — the tunnel is stable; only DNS
# propagation lags, which we handle later with a patient HTTP check).
function Open-Tunnel($port, $tag) {
  $out = Join-Path $env:TEMP "cf-$tag-out.log"
  $err = Join-Path $env:TEMP "cf-$tag-err.log"
  Remove-Item $out, $err -ErrorAction SilentlyContinue
  Start-Process -FilePath $cf `
    -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://localhost:$port" `
    -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    foreach ($f in @($err, $out)) {
      if (Test-Path $f) {
        $m = Select-String -Path $f -Pattern $rx -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $u = $m.Matches[0].Value; Write-Host "  $tag -> $u" -ForegroundColor Green; return $u }
      }
    }
    Start-Sleep -Milliseconds 800
  }
  return $null
}

function Test-Reachable($url, $label, $timeoutSec = 150) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
      if ($r.StatusCode -eq 200) { Write-Host "  OK  $label ($url)" -ForegroundColor Green; return $true }
    } catch { Start-Sleep -Seconds 5 }
  }
  Write-Host "  ... $label not confirmed yet - it usually comes up within a minute ($url)" -ForegroundColor DarkYellow
  return $false
}

Write-Host "`nOpening tunnels..." -ForegroundColor Yellow
$apiUrl = Open-Tunnel 3000 'api'
$webUrl = Open-Tunnel 5173 'web'
if (-not $apiUrl -or -not $webUrl) { Write-Error "A tunnel failed to produce a URL. Re-run the script."; exit 1 }

Write-Host "`nWriting .env files..." -ForegroundColor Yellow
node (Join-Path $PSScriptRoot 'set-public-url.mjs') --api $apiUrl --web $webUrl

Write-Host "`nStarting backend + web servers..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd `"$root\backend`"; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd `"$root\web`"; npm run dev"

Write-Host "`nVerifying public URLs (waiting for servers + DNS)..." -ForegroundColor Yellow
Test-Reachable "$webUrl" 'Web console' | Out-Null
Test-Reachable "$apiUrl/health" 'API' | Out-Null

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " Share these with your seniors:" -ForegroundColor Cyan
Write-Host "   Web console : $webUrl" -ForegroundColor White
Write-Host "   API (health): $apiUrl/health" -ForegroundColor White
Write-Host "`n For the mobile app, in a new terminal run:" -ForegroundColor Cyan
Write-Host "   cd `"$root\mobile`"; npx expo start --tunnel" -ForegroundColor White
Write-Host "`n Stop everything: scripts\stop-public-test.ps1  (then close server windows)" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan
