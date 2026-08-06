# Stops the Cloudflare tunnels started by start-public-test.ps1.
# (The backend/web/expo server windows are separate — close those manually.)
$stopped = 0
Get-Process cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Stopping cloudflared pid $($_.Id)"
  Stop-Process -Id $_.Id -Force
  $stopped++
}
if ($stopped -eq 0) { Write-Host "No cloudflared tunnels running." }
else { Write-Host "Stopped $stopped tunnel(s). Close the backend/web/expo windows to fully stop." }
